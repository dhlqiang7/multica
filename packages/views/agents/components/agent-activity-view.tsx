"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type {
  Agent,
  AgentRuntime,
  MemberWithUser,
} from "@multica/core/types";
import { runtimeDisplayLabel } from "@multica/core/runtimes";
import { ActorAvatar } from "../../common/actor-avatar";
import { useT } from "../../i18n";
import { ActivityTab, AgentPerformanceSummary } from "./tabs/activity-tab";
import { VisibilityBadge } from "./visibility-badge";
import type { ConfigAnchor } from "./agent-config-view";

const CARD =
  "rounded-xl border border-surface-border bg-surface p-5 shadow-[var(--surface-shadow)]";

/**
 * What the agent is doing and how it has been doing. The run feed owns the
 * main column; the rail carries the 30-day record and a read-only summary of
 * the configuration whose rows open the matching configuration section, so
 * the header no longer has to repeat model, runtime and access.
 */
export function AgentActivityView({
  agent,
  runtime,
  owner,
  onOpenConfig,
}: {
  agent: Agent;
  runtime: AgentRuntime | null;
  owner: MemberWithUser | null;
  onOpenConfig: (anchor: ConfigAnchor) => void;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <ActivityTab agent={agent} showPerformance={false} />
      <aside className="flex flex-col gap-4 self-start xl:sticky xl:top-6">
        <div className={CARD}>
          <AgentPerformanceSummary agent={agent} />
        </div>
        <AgentConfigSummary
          agent={agent}
          runtime={runtime}
          owner={owner}
          onOpenConfig={onOpenConfig}
        />
      </aside>
    </div>
  );
}

function AgentConfigSummary({
  agent,
  runtime,
  owner,
  onOpenConfig,
}: {
  agent: Agent;
  runtime: AgentRuntime | null;
  owner: MemberWithUser | null;
  onOpenConfig: (anchor: ConfigAnchor) => void;
}) {
  const { t } = useT("agents");
  const runtimeOnline = runtime?.status === "online";

  return (
    <section className={CARD}>
      <h2 className="text-body font-medium">
        {t(($) => $.tabs.configuration)}
      </h2>
      <div className="-mx-2 mt-3 text-caption">
        {owner && (
          <SummaryRow label={t(($) => $.inspector.prop_owner)}>
            <span className="flex min-w-0 items-center gap-1.5">
              <ActorAvatar actorType="member" actorId={owner.user_id} size="xs" />
              <span className="min-w-0 truncate text-foreground">{owner.name}</span>
            </span>
          </SummaryRow>
        )}
        <SummaryRow
          label={t(($) => $.inspector.prop_runtime)}
          onOpen={() => onOpenConfig("execution")}
        >
          <span className="flex min-w-0 items-center gap-1.5 text-foreground">
            {runtime ? (
              <span
                className={`size-1.5 shrink-0 rounded-full ${
                  runtimeOnline ? "bg-success" : "bg-faint-foreground"
                }`}
                aria-hidden="true"
              />
            ) : null}
            <span className="min-w-0 truncate">
              {runtime
                ? runtimeDisplayLabel(runtime)
                : t(($) => $.pickers.runtime_none)}
            </span>
          </span>
        </SummaryRow>
        <SummaryRow
          label={t(($) => $.inspector.prop_model)}
          onOpen={() => onOpenConfig("execution")}
        >
          <span className="min-w-0 truncate text-foreground">
            {agent.model || t(($) => $.pickers.model_default)}
          </span>
        </SummaryRow>
        <SummaryRow
          label={t(($) => $.inspector.prop_concurrency)}
          onOpen={() => onOpenConfig("execution")}
        >
          <span className="font-mono tabular-nums text-foreground">
            {agent.max_concurrent_tasks}
          </span>
        </SummaryRow>
        <SummaryRow
          label={t(($) => $.tabs.skills)}
          onOpen={() => onOpenConfig("skills")}
        >
          <span className="min-w-0 truncate text-foreground">
            {agent.skills.length > 0
              ? agent.skills.map((skill) => skill.name).join(", ")
              : t(($) => $.tab_body.skills.empty_title)}
          </span>
        </SummaryRow>
        <SummaryRow
          label={t(($) => $.tabs.access)}
          onOpen={() => onOpenConfig("access")}
        >
          <VisibilityBadge value={agent.visibility} />
        </SummaryRow>
      </div>
    </section>
  );
}

function SummaryRow({
  label,
  onOpen,
  children,
}: {
  label: string;
  /** When set the whole row opens the matching configuration section. */
  onOpen?: () => void;
  children: ReactNode;
}) {
  const body = (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center">{children}</span>
      <span className="text-faint-foreground" aria-hidden="true">
        {onOpen ? <ChevronRight className="size-3.5" /> : null}
      </span>
    </>
  );
  const grid =
    "grid min-h-8 w-full grid-cols-[80px_minmax(0,1fr)_14px] items-center gap-3 rounded-md px-2 text-left";
  if (!onOpen) return <div className={grid}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`${grid} transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
    >
      {body}
    </button>
  );
}
