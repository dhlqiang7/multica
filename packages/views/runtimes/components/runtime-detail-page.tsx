"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Cloud,
  Loader2,
  Monitor,
  MoreHorizontal,
  Pencil,
  Plus,
  Server,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Agent,
  AgentRuntime,
  AgentTask,
  RuntimeProfile,
} from "@multica/core/types";
import { useAuthStore } from "@multica/core/auth";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  agentTaskSnapshotOptions,
  deriveAgentListStatus,
  useWorkspacePresenceMap,
} from "@multica/core/agents";
import { issueDetailOptions } from "@multica/core/issues/queries";
import { runtimeProfileListOptions } from "@multica/core/runtimes";
import { runtimeKeys, runtimeListOptions } from "@multica/core/runtimes/queries";
import { useWSEvent } from "@multica/core/realtime";
import {
  agentListOptions,
  memberListOptions,
} from "@multica/core/workspace/queries";
import { Button } from "@multica/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { cn } from "@multica/ui/lib/utils";
import { PAGE_GUTTER, PAGE_RAIL } from "../../layout/page-header";
import {
  DETAIL_CARD,
  DetailIconMark,
  DetailStatusPill,
  DetailSubline,
  EntityDetailHeader,
} from "../../layout/detail-header";
import { StatusDot, type StatusTone } from "../../layout/status-summary";
import { ActorAvatar } from "../../common/actor-avatar";
import { AppLink, useNavigation } from "../../navigation";
import { buildWorkloadIndex, canReadRuntimeUsage } from "./runtime-list";
import {
  buildRuntimeMachines,
  runtimeRowLabel,
  sharedCustomName,
  type RuntimeMachine,
} from "./runtime-machines";
import { RenameMachineDialog } from "./rename-machine-dialog";
import { RuntimeProfilesDialog } from "./runtime-profiles-dialog";
import { pendingRuntimesForProfiles } from "./pending-runtime";
import { MachineCliSection } from "./machine-cli-section";
import { RuntimeCard } from "./runtime-card";
import { UsageSection } from "./usage-section";
import { HealthIcon, useHealthLabel } from "./shared";
import { useT, useTimeAgo } from "../../i18n";

export interface RuntimeDetailPageProps {
  /** A machine id, or a legacy runtime id that locates its machine. */
  runtimeId: string;
  /** Runtime to focus on the machine page (the old nested runtime URL). */
  focusRuntimeId?: string;
  localDaemonId?: string | null;
  localMachineName?: string | null;
  localMachineActions?: React.ReactNode;
  hasLocalMachine?: boolean;
  bootstrapping?: boolean;
}

function useNowTick(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function decodeRouteParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function findMachine(
  machines: ReturnType<typeof buildRuntimeMachines>,
  locator: string,
) {
  return (
    machines.find(
      (candidate) =>
        candidate.id === locator ||
        candidate.runtimes.some((runtime) => runtime.id === locator),
    ) ??
    (locator === "local:placeholder"
      ? machines.find((candidate) => candidate.isCurrent) ?? null
      : null)
  );
}

const ACTIVE_STATUSES = new Set<AgentTask["status"]>([
  "running",
  "queued",
  "dispatched",
  "waiting_local_directory",
]);

/**
 * The machine page — the second and last level under Runtimes. Daemons,
 * network and versions are per machine, so the machine is the object; each
 * CLI runtime on it is a card here rather than a page of its own. The page
 * answers the same questions as the other AI Team detail pages: what is
 * running on it now, what is wrong and how to fix it, and who depends on it.
 *
 * Legacy links that carry a runtime id resolve to the runtime's machine and
 * focus that runtime.
 */
export function RuntimeDetailPage({
  runtimeId,
  focusRuntimeId,
  localDaemonId,
  localMachineName,
  localMachineActions,
  hasLocalMachine,
  bootstrapping,
}: RuntimeDetailPageProps) {
  const { t } = useT("runtimes");
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const qc = useQueryClient();
  const healthLabel = useHealthLabel();
  const currentUserId = useAuthStore((state) => state.user?.id);
  const { data: runtimes = [], isLoading } = useQuery(runtimeListOptions(wsId));
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: tasks = [] } = useQuery(agentTaskSnapshotOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { data: runtimeProfiles = [] } = useQuery(
    runtimeProfileListOptions(wsId),
  );
  const now = useNowTick();
  const machineLocator = decodeRouteParam(runtimeId);
  const [renameOpen, setRenameOpen] = useState(false);
  const [createProfileOpen, setCreateProfileOpen] = useState(false);
  const workloadIndex = useMemo(
    () => buildWorkloadIndex(agents, tasks),
    [agents, tasks],
  );
  const machines = useMemo(
    () =>
      buildRuntimeMachines(runtimes, {
        now,
        localDaemonId,
        localMachineName,
        currentUserId,
        workloadByRuntimeId: workloadIndex,
        ensureLocalMachine: hasLocalMachine,
      }),
    [
      runtimes,
      now,
      localDaemonId,
      localMachineName,
      currentUserId,
      workloadIndex,
      hasLocalMachine,
    ],
  );
  const machine = findMachine(machines, machineLocator);
  const profileRows = useMemo(
    () =>
      runtimeProfiles.map((profile) => {
        const createdAt = Date.parse(profile.created_at);
        return {
          profile,
          createdAt: Number.isFinite(createdAt) ? createdAt : 0,
        };
      }),
    [runtimeProfiles],
  );
  const machineRuntimes = useMemo(() => {
    if (!machine) return [];
    if (machine.mode !== "local") return machine.runtimes;
    return pendingRuntimesForProfiles({
      pendingProfiles: profileRows,
      runtimes: machine.runtimes,
      localDaemonId: machine.daemonId,
      localMachineName: machine.title,
      fallbackMachineName: machine.title,
    });
  }, [machine, profileRows]);
  const handleDaemonEvent = useCallback(() => {
    qc.invalidateQueries({ queryKey: runtimeKeys.all(wsId) });
  }, [qc, wsId]);
  useWSEvent("daemon:register", handleDaemonEvent);

  const currentMember = currentUserId
    ? members.find((member) => member.user_id === currentUserId)
    : null;
  const isAdmin =
    currentMember?.role === "owner" || currentMember?.role === "admin";
  const canAddRuntime =
    isAdmin && machine?.mode === "local" && !!machine.daemonId;
  const renameTarget = useMemo(() => {
    if (!machine || machine.runtimes.length === 0) return null;
    const editable = isAdmin
      ? machine.runtimes[0]
      : machine.runtimes.find((runtime) => runtime.owner_id === currentUserId);
    if (!editable) return null;
    return {
      runtimeId: editable.id,
      currentName: sharedCustomName(machine.runtimes) ?? "",
    };
  }, [machine, isAdmin, currentUserId]);

  // Usage is readable only on registered runtimes this viewer may use
  // (their own or a public one) — the same rule the API enforces. Pending
  // custom runtimes are synthesized rows with nothing to report yet.
  const usageRuntimes = useMemo(
    () =>
      (machine?.runtimes ?? []).filter((runtime) =>
        canReadRuntimeUsage(runtime, currentUserId ?? null),
      ),
    [machine, currentUserId],
  );
  const selectedParam =
    navigation.searchParams.get("runtime") ?? focusRuntimeId ?? null;
  const selectedRuntime =
    usageRuntimes.find((runtime) => runtime.id === selectedParam) ??
    usageRuntimes[0] ??
    null;
  const selectRuntime = (id: string) => {
    const params = new URLSearchParams(navigation.searchParams);
    params.set("runtime", id);
    navigation.replace(`${navigation.pathname}?${params.toString()}`);
  };

  if (isLoading) return <MachineDetailSkeleton />;

  if (!machine) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <div>
            <p className="text-body font-medium">
              {t(($) => $.machine.not_found_title)}
            </p>
            <p className="mt-1 text-caption text-muted-foreground">
              {t(($) => $.machine.not_found_hint)}
            </p>
          </div>
          <Button
            size="sm"
            render={<AppLink href={paths.runtimes()} />}
            nativeButton={false}
          >
            {t(($) => $.detail.all_runtimes)}
          </Button>
        </div>
      </div>
    );
  }

  const Icon = machine.section === "cloud" ? Cloud : Monitor;
  const busyCount = machine.runningCount + machine.queuedCount;
  const ownerId = machine.runtimes[0]?.owner_id ?? null;
  const owner = ownerId
    ? members.find((member) => member.user_id === ownerId) ?? null
    : null;
  const sectionLabel =
    machine.section === "cloud"
      ? t(($) => $.machine.section_cloud)
      : machine.isCurrent
        ? t(($) => $.machine.this_machine)
        : t(($) => $.machine.section_remote);
  const machineRuntimeIds = new Set(machineRuntimes.map((runtime) => runtime.id));
  const machineAgents = agents.filter(
    (agent) => !agent.archived_at && machineRuntimeIds.has(agent.runtime_id),
  );
  const activeTasks = tasks
    .filter(
      (task) =>
        machineRuntimeIds.has(task.runtime_id) && ACTIVE_STATUSES.has(task.status),
    )
    .sort((a, b) => {
      const rank = (task: AgentTask) => (task.status === "running" ? 0 : 1);
      return (
        rank(a) - rank(b) ||
        (a.started_at ?? a.dispatched_at ?? "").localeCompare(
          b.started_at ?? b.dispatched_at ?? "",
        )
      );
    });
  const profileById = new Map<string, RuntimeProfile>(
    runtimeProfiles.map((profile) => [profile.id, profile]),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EntityDetailHeader
        parent={{ href: paths.runtimes(), label: t(($) => $.page.title) }}
        media={
          <DetailIconMark>
            <Icon aria-hidden="true" />
          </DetailIconMark>
        }
        title={machine.title}
        status={
          <DetailStatusPill>
            <HealthIcon health={machine.health} />
            <span>{healthLabel(machine.health)}</span>
            <span className="text-muted-foreground">
              {"· "}
              {busyCount > 0
                ? t(($) => $.machine.metrics.workload_hint, {
                    running: machine.runningCount,
                    queued: machine.queuedCount,
                  })
                : t(($) => $.machine.metrics.workload_value_idle)}
            </span>
          </DetailStatusPill>
        }
        description={
          <DetailSubline>
            {[
              sectionLabel,
              machine.subtitle,
              machine.cliVersion
                ? t(($) => $.detail_page.daemon_version, {
                    version: machine.cliVersion,
                  })
                : null,
              owner ? t(($) => $.detail_page.owned_by, { name: owner.name }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </DetailSubline>
        }
        actions={
          <>
            {machine.isCurrent && localMachineActions}
            {canAddRuntime && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setCreateProfileOpen(true)}
              >
                <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                {t(($) => $.profiles.add_custom)}
              </Button>
            )}
            {renameTarget && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon-sm" />}
                  aria-label={t(($) => $.detail_page.more_actions_aria)}
                >
                  <MoreHorizontal
                    className="h-4 w-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-auto">
                  <DropdownMenuItem onClick={() => setRenameOpen(true)}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    {t(($) => $.machine.rename)}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto border-t bg-background">
        <div
          className={cn(
            PAGE_RAIL,
            PAGE_GUTTER,
            "grid gap-6 py-4 sm:py-6 xl:grid-cols-[minmax(0,1fr)_320px]",
          )}
        >
          <div className="flex min-w-0 flex-col gap-8">
            <section>
              <SectionHeading
                title={t(($) => $.machine.metrics.runtimes)}
                hint={t(($) => $.machine.runtime_count, {
                  count: machineRuntimes.length,
                })}
              />
              {machineRuntimes.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                  {machineRuntimes.map((runtime) => {
                    const workload = workloadIndex.get(runtime.id);
                    const readable = usageRuntimes.some(
                      (candidate) => candidate.id === runtime.id,
                    );
                    return (
                      <RuntimeCard
                        key={runtime.id}
                        runtime={runtime}
                        machineTitle={machine.title}
                        agents={agents.filter(
                          (agent) =>
                            !agent.archived_at && agent.runtime_id === runtime.id,
                        )}
                        runningCount={workload?.runningCount ?? 0}
                        queuedCount={workload?.queuedCount ?? 0}
                        profile={
                          runtime.profile_id
                            ? profileById.get(runtime.profile_id) ?? null
                            : null
                        }
                        selected={selectedRuntime?.id === runtime.id}
                        onSelect={
                          readable && usageRuntimes.length > 1
                            ? () => selectRuntime(runtime.id)
                            : undefined
                        }
                        now={now}
                        currentUserId={currentUserId ?? null}
                        isAdmin={isAdmin}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed px-6 text-center">
                  <Server
                    aria-hidden="true"
                    className="h-7 w-7 text-faint-foreground"
                  />
                  <p className="mt-3 text-body font-medium">
                    {bootstrapping
                      ? t(($) => $.page.bootstrapping.title)
                      : t(($) => $.machine.no_runtimes_title)}
                  </p>
                  <p className="mt-1 max-w-sm text-caption text-muted-foreground">
                    {bootstrapping
                      ? t(($) => $.page.bootstrapping.hint)
                      : t(($) => $.machine.no_runtimes_hint)}
                  </p>
                </div>
              )}
            </section>

            <section>
              <SectionHeading
                title={t(($) => $.detail_page.running_title)}
                hint={
                  activeTasks.length > 0
                    ? t(($) => $.machine.metrics.workload_hint, {
                        running: machine.runningCount,
                        queued: machine.queuedCount,
                      })
                    : undefined
                }
              />
              {activeTasks.length > 0 ? (
                <div className="divide-y divide-surface-border overflow-hidden rounded-xl border border-surface-border bg-surface">
                  {activeTasks.map((task) => (
                    <ActiveTaskRow
                      key={task.id}
                      task={task}
                      agent={agents.find((agent) => agent.id === task.agent_id)}
                      runtime={machineRuntimes.find(
                        (runtime) => runtime.id === task.runtime_id,
                      )}
                      machineTitle={machine.title}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-caption italic text-muted-foreground">
                  {t(($) => $.detail_page.running_empty)}
                </p>
              )}
            </section>

            {selectedRuntime ? (
              <section>
                <SectionHeading
                  title={t(($) => $.detail_page.usage_title)}
                  hint={
                    usageRuntimes.length > 1
                      ? runtimeRowLabel(selectedRuntime, machine.title)
                      : undefined
                  }
                />
                <UsageSection runtime={selectedRuntime} />
              </section>
            ) : null}
          </div>

          <aside className="flex flex-col gap-4 self-start xl:sticky xl:top-6">
            <ServedAgentsCard
              agents={machineAgents}
              runtimes={machineRuntimes}
              machineTitle={machine.title}
            />
            <TechnicalCard
              machine={machine}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
            />
          </aside>
        </div>
      </div>

      {renameTarget && (
        <RenameMachineDialog
          open={renameOpen}
          onOpenChange={setRenameOpen}
          wsId={wsId}
          runtimeId={renameTarget.runtimeId}
          currentName={renameTarget.currentName}
        />
      )}
      {canAddRuntime && createProfileOpen && (
        <RuntimeProfilesDialog
          wsId={wsId}
          intent="create"
          machineName={machine.title}
          onClose={() => setCreateProfileOpen(false)}
        />
      )}
    </div>
  );
}

function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3 flex min-w-0 items-baseline gap-2">
      <h2 className="text-body font-semibold">{title}</h2>
      {hint ? (
        <span className="min-w-0 truncate text-caption text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function ActiveTaskRow({
  task,
  agent,
  runtime,
  machineTitle,
}: {
  task: AgentTask;
  agent: Agent | undefined;
  runtime: AgentRuntime | undefined;
  machineTitle: string;
}) {
  const { t } = useT("runtimes");
  const timeAgo = useTimeAgo();
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const { data: issue } = useQuery({
    ...issueDetailOptions(wsId, task.issue_id),
    enabled: task.issue_id !== "",
    staleTime: 60 * 1000,
  });
  const running = task.status === "running";
  const href = task.issue_id
    ? paths.issueDetail(task.issue_id)
    : paths.agentDetail(task.agent_id);
  return (
    <AppLink
      href={href}
      className="flex min-w-0 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
    >
      <ActorAvatar actorType="agent" actorId={task.agent_id} size="sm" />
      <span className="w-24 shrink-0 truncate text-caption font-medium">
        {agent?.name ?? "—"}
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-2 text-caption">
        {issue ? (
          <>
            <span className="shrink-0 font-mono text-muted-foreground">
              {issue.identifier}
            </span>
            <span className="min-w-0 truncate">{issue.title}</span>
          </>
        ) : (
          <span className="min-w-0 truncate text-muted-foreground">
            {t(($) => $.detail_page.run_without_issue)}
          </span>
        )}
      </span>
      {runtime ? (
        <span className="hidden w-32 shrink-0 truncate text-caption text-muted-foreground md:block">
          {runtimeRowLabel(runtime, machineTitle)}
        </span>
      ) : null}
      <span className="inline-flex w-28 shrink-0 items-center justify-end gap-1.5 text-caption text-muted-foreground">
        {running ? (
          <Loader2 aria-hidden="true" className="size-3 animate-spin text-brand" />
        ) : null}
        {running && task.started_at
          ? t(($) => $.detail_page.started, { when: timeAgo(task.started_at) })
          : t(($) => $.detail_page.queued)}
      </span>
    </AppLink>
  );
}

const AGENT_TONE: Record<string, StatusTone> = {
  attention: "attention",
  working: "working",
  idle: "idle",
  offline: "offline",
  archived: "offline",
};

function ServedAgentsCard({
  agents,
  runtimes,
  machineTitle,
}: {
  agents: Agent[];
  runtimes: AgentRuntime[];
  machineTitle: string;
}) {
  const { t } = useT("runtimes");
  const { t: tAgents } = useT("agents");
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const { byAgent: presenceMap } = useWorkspacePresenceMap(wsId);
  return (
    <section className={DETAIL_CARD}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-body font-medium">
          {t(($) => $.detail_page.served_agents)}
        </h2>
        <span className="text-caption tabular-nums text-muted-foreground">
          {agents.length}
        </span>
      </div>
      {agents.length === 0 ? (
        <p className="mt-3 text-caption text-muted-foreground">
          {t(($) => $.detail_page.no_served_agents)}
        </p>
      ) : (
        <ul className="-mx-2 mt-2">
          {agents.map((agent) => {
            const status = deriveAgentListStatus(
              agent,
              presenceMap.get(agent.id) ?? null,
            ).status;
            const runtime = runtimes.find((r) => r.id === agent.runtime_id);
            return (
              <li key={agent.id}>
                <AppLink
                  href={paths.agentDetail(agent.id)}
                  className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/50"
                >
                  <ActorAvatar
                    actorType="agent"
                    actorId={agent.id}
                    size="sm"
                    showStatusDot
                  />
                  <span className="min-w-0 flex-1 truncate text-caption font-medium">
                    {agent.name}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-caption text-muted-foreground">
                    {runtime ? runtimeRowLabel(runtime, machineTitle) : null}
                    <StatusDot tone={AGENT_TONE[status] ?? "offline"} />
                    {status === "archived"
                      ? null
                      : tAgents(($) => $.list.status[status])}
                  </span>
                </AppLink>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function TechnicalCard({
  machine,
  currentUserId,
  isAdmin,
}: {
  machine: RuntimeMachine;
  currentUserId: string | undefined;
  isAdmin: boolean;
}) {
  const { t } = useT("runtimes");
  const timeAgo = useTimeAgo();
  return (
    <section className={DETAIL_CARD}>
      <h2 className="text-body font-medium">
        {t(($) => $.detail.technical_details)}
      </h2>
      <dl className="mt-3 grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-caption">
        {machine.daemonId ? (
          <>
            <dt className="text-muted-foreground">
              {t(($) => $.detail.fact_daemon_id)}
            </dt>
            <dd className="truncate font-mono" title={machine.daemonId}>
              {machine.daemonId}
            </dd>
          </>
        ) : null}
        {machine.cliVersion || machine.mode === "local" ? (
          // The update control labels its own version line.
          <dd className="col-span-2 min-w-0">
            <MachineCliSection
              machine={machine}
              currentUserId={currentUserId}
              canManagePublicRuntimes={isAdmin}
            />
          </dd>
        ) : null}
        {machine.deviceInfo ? (
          <>
            <dt className="text-muted-foreground">
              {t(($) => $.detail.fact_device)}
            </dt>
            <dd className="truncate" title={machine.deviceInfo}>
              {machine.deviceInfo}
            </dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">
          {t(($) => $.detail_page.last_seen_label)}
        </dt>
        <dd>
          {machine.lastSeenAt
            ? timeAgo(machine.lastSeenAt)
            : t(($) => $.detail.never_seen)}
        </dd>
      </dl>
    </section>
  );
}

function MachineDetailSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="pb-4 pt-3">
        <div className={cn(PAGE_RAIL, PAGE_GUTTER)}>
          <Skeleton className="h-3 w-36" />
          <div className="mt-4 flex items-start gap-4">
            <Skeleton className="h-14 w-14 rounded-xl" />
            <div className="flex-1">
              <Skeleton className="h-7 w-64" />
              <Skeleton className="mt-2 h-4 w-80" />
            </div>
          </div>
        </div>
      </div>
      <div
        className={cn(
          PAGE_RAIL,
          PAGE_GUTTER,
          "grid gap-6 border-t py-6 xl:grid-cols-[minmax(0,1fr)_320px]",
        )}
      >
        <div>
          <Skeleton className="h-4 w-24" />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, index) => (
              <Skeleton key={index} className="h-40 rounded-xl" />
            ))}
          </div>
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}
