"use client";

import {
  AlertTriangle,
  Bot,
  Globe,
  Loader2,
  Lock,
} from "lucide-react";
import { toast } from "sonner";
import type {
  Agent,
  AgentRuntime,
  RuntimeProfile,
} from "@multica/core/types";
import { useWorkspaceId } from "@multica/core/hooks";
import { useUpdateRuntime } from "@multica/core/runtimes/mutations";
import { deriveRuntimeHealth } from "@multica/core/runtimes";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@multica/ui/components/ui/tooltip";
import { cn } from "@multica/ui/lib/utils";
import { ProviderLogo } from "./provider-logo";
import { HealthIcon, useHealthLabel } from "./shared";
import { RuntimeRowMenu } from "./runtime-list";
import { runtimeRowLabel } from "./runtime-machines";
import {
  customRuntimeRegistrationFailure,
  isDisabledCustomRuntime,
  isPendingCustomRuntime,
  isPendingCustomRuntimeWarning,
  pendingRuntimeCommandName,
} from "./pending-runtime";
import { useT, useTimeAgo } from "../../i18n";

function runtimeVersion(runtime: AgentRuntime): string | null {
  if (isPendingCustomRuntime(runtime)) return pendingRuntimeCommandName(runtime);
  if (runtime.runtime_mode === "cloud") return null;
  const meta = runtime.metadata as Record<string, unknown> | null;
  // `version` is the agent CLI's own version, distinct per provider; the
  // shared daemon CLI version belongs to the machine, not to a runtime.
  return meta && typeof meta.version === "string" ? meta.version : null;
}

/**
 * One CLI runtime on a machine. Everything that used to need its own page —
 * who it serves, what it is running, who can use it, edit and delete — sits
 * on the card, so the machine page is the last level. Selecting a card
 * points the usage chart at it.
 */
export function RuntimeCard({
  runtime,
  machineTitle,
  agents,
  runningCount,
  queuedCount,
  profile,
  selected,
  onSelect,
  now,
  currentUserId,
  isAdmin,
}: {
  runtime: AgentRuntime;
  machineTitle: string;
  /** Non-archived agents bound to this runtime. */
  agents: Agent[];
  runningCount: number;
  queuedCount: number;
  profile: RuntimeProfile | null;
  selected: boolean;
  onSelect?: () => void;
  now: number;
  currentUserId: string | null;
  isAdmin: boolean;
}) {
  const { t } = useT("runtimes");
  const wsId = useWorkspaceId();
  const label = runtimeRowLabel(runtime, machineTitle);
  const version = runtimeVersion(runtime);
  const pending = isPendingCustomRuntime(runtime);
  const failure = customRuntimeRegistrationFailure(runtime);
  const isOwner = !!currentUserId && runtime.owner_id === currentUserId;
  const isCustom = !!runtime.profile_id;
  const canDelete = isCustom
    ? isAdmin && !!profile
    : !pending && (isAdmin || isOwner);
  const busy = runningCount + queuedCount;

  return (
    <div
      className={cn(
        "group/row flex min-w-0 flex-col gap-3 rounded-xl border bg-surface p-4 shadow-[var(--surface-shadow)] transition-colors",
        failure ? "border-destructive/40" : "border-surface-border",
        selected && !failure && "border-brand/60 ring-1 ring-brand/30",
        onSelect && "cursor-pointer hover:border-foreground/20",
      )}
      onClick={onSelect}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-surface-border bg-background">
          <ProviderLogo provider={runtime.provider} className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            {onSelect ? (
              <button
                type="button"
                aria-pressed={selected}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect();
                }}
                className="min-w-0 truncate rounded-xs text-left text-body font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {label}
              </button>
            ) : (
              <span className="min-w-0 truncate text-body font-medium">
                {label}
              </span>
            )}
            {isCustom ? (
              <span className="inline-flex shrink-0 items-center rounded-xs bg-info/10 px-1 text-micro font-medium text-info">
                {t(($) => $.list.badge_custom)}
              </span>
            ) : null}
          </div>
          {version ? (
            <div
              className="mt-0.5 truncate font-mono text-caption text-muted-foreground"
              title={version}
            >
              {version}
            </div>
          ) : null}
        </div>
        <span
          className="-mr-1 -mt-1 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <RuntimeRowMenu
            runtime={runtime}
            profile={profile}
            wsId={wsId}
            canDelete={canDelete}
          />
        </span>
      </div>

      <RuntimeHealthLine runtime={runtime} now={now} />

      <div className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
        <Bot aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          {agents.length === 0
            ? t(($) => $.card.no_agents)
            : agents.length <= 3
              ? agents.map((agent) => agent.name).join(", ")
              : t(($) => $.card.agents_more, {
                  names: agents
                    .slice(0, 2)
                    .map((agent) => agent.name)
                    .join(", "),
                  count: agents.length - 2,
                })}
        </span>
      </div>

      <div className="mt-auto flex min-w-0 items-center justify-between gap-2 border-t border-surface-border pt-3">
        <span className="min-w-0 truncate text-caption text-muted-foreground">
          {busy > 0
            ? t(($) => $.machine.metrics.workload_hint, {
                running: runningCount,
                queued: queuedCount,
              })
            : t(($) => $.machine.metrics.workload_value_idle)}
        </span>
        {pending ? null : (
          <span onClick={(e) => e.stopPropagation()} className="shrink-0">
            {isOwner ? (
              <VisibilityEditor runtime={runtime} />
            ) : (
              <VisibilityReadout runtime={runtime} />
            )}
          </span>
        )}
      </div>
    </div>
  );
}

function RuntimeHealthLine({
  runtime,
  now,
}: {
  runtime: AgentRuntime;
  now: number;
}) {
  const { t } = useT("runtimes");
  const labelOf = useHealthLabel();
  const timeAgo = useTimeAgo();

  if (isDisabledCustomRuntime(runtime)) {
    return (
      <p className="text-caption text-muted-foreground">
        {t(($) => $.list.pending_health_disabled)}
      </p>
    );
  }
  const failure = customRuntimeRegistrationFailure(runtime);
  if (failure) {
    return (
      <p className="flex min-w-0 items-start gap-1.5 text-caption text-destructive">
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0 break-words">
          <span className="font-medium">
            {t(($) => $.list.pending_health_error)}
          </span>
          {" · "}
          {failure}
        </span>
      </p>
    );
  }
  if (isPendingCustomRuntime(runtime)) {
    const warning = isPendingCustomRuntimeWarning(runtime, now);
    return (
      <p className="flex items-center gap-1.5 text-caption">
        {warning ? (
          <AlertTriangle aria-hidden="true" className="size-3.5 text-warning" />
        ) : (
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin text-info" />
        )}
        {warning
          ? t(($) => $.list.pending_health_warning)
          : t(($) => $.list.pending_health)}
      </p>
    );
  }
  const health = deriveRuntimeHealth(runtime, now);
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-caption">
      <HealthIcon health={health} />
      <span className="min-w-0 truncate">
        {labelOf(health)}
        {health !== "online" && runtime.last_seen_at ? (
          <span className="text-muted-foreground">
            {" · "}
            {t(($) => $.detail.last_seen, {
              when: timeAgo(runtime.last_seen_at),
            })}
          </span>
        ) : null}
      </span>
    </p>
  );
}

// VisibilityReadout renders a static "Private" / "Public" pill for everyone
// who is not the runtime owner — workspace admins included (MUL-6126). Its
// tooltip is phrased in the third person for that reason; the editor's own
// hints stay in the second person. Older backends that omit the field render
// as "Private" to match the strict default.
export function VisibilityReadout({ runtime }: { runtime: AgentRuntime }) {
  const { t } = useT("runtimes");
  const visibility = runtime.visibility === "public" ? "public" : "private";
  const Icon = visibility === "public" ? Globe : Lock;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex items-center gap-1 rounded-md border bg-muted/30 px-1.5 py-0.5 text-caption">
            <Icon className="size-3 text-muted-foreground" />
            <span className="font-medium">
              {t(($) => $.detail.visibility_label[visibility])}
            </span>
          </span>
        }
      />
      <TooltipContent>
        {t(($) => $.detail.visibility_hint_readonly[visibility])}
      </TooltipContent>
    </Tooltip>
  );
}

// VisibilityEditor lets the runtime owner flip public↔private. Owner only —
// the PATCH endpoint refuses a workspace admin here (canSetRuntimeVisibility);
// this is a UI gate, not a security boundary.
export function VisibilityEditor({ runtime }: { runtime: AgentRuntime }) {
  const { t } = useT("runtimes");
  const wsId = useWorkspaceId();
  const updateRuntime = useUpdateRuntime(wsId);
  const current = runtime.visibility === "public" ? "public" : "private";

  const flip = (next: "private" | "public") => {
    if (next === current) return;
    updateRuntime.mutate(
      { runtimeId: runtime.id, patch: { visibility: next } },
      {
        onSuccess: () =>
          toast.success(
            t(($) => $.detail.visibility_toast_updated, {
              visibility: t(($) => $.detail.visibility_label[next]),
            }),
          ),
        onError: (err) =>
          toast.error(
            err instanceof Error && err.message
              ? err.message
              : t(($) => $.detail.visibility_toast_failed),
          ),
      },
    );
  };

  return (
    <div
      role="group"
      aria-label={t(($) => $.detail.diagnostics_visibility)}
      className="inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5"
    >
      {(["private", "public"] as const).map((value) => (
        <Tooltip key={value}>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-pressed={current === value}
                onClick={() => flip(value)}
                disabled={updateRuntime.isPending}
                className={cn(
                  "inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-caption font-medium transition-colors",
                  current === value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                  updateRuntime.isPending && "cursor-not-allowed opacity-60",
                )}
              >
                {value === "public" ? (
                  <Globe className="size-3" />
                ) : (
                  <Lock className="size-3" />
                )}
                {t(($) => $.detail.visibility_label[value])}
              </button>
            }
          />
          <TooltipContent>
            {t(($) => $.detail.visibility_hint[value])}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
