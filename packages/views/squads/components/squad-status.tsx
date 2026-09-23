"use client";

import { AlertTriangle, WifiOff } from "lucide-react";
import {
  deriveAgentListStatus,
  type AgentPresenceDetail,
} from "@multica/core/agents";
import {
  deriveSquadListStatus,
  type SquadListStatusDetail,
} from "@multica/core/squads";
import type { Agent, SquadMemberStatus } from "@multica/core/types";
import { StatusDot } from "../../layout/status-summary";
import { useT } from "../../i18n";

/** A squad's status from its roster, via each agent member's list status. */
export function squadStatusFromRoster(
  leaderId: string,
  roster: readonly Pick<SquadMemberStatus, "member_type" | "member_id">[],
  agentsById: ReadonlyMap<string, Agent>,
  presenceMap: ReadonlyMap<string, AgentPresenceDetail>,
): SquadListStatusDetail {
  const agentMembers = roster.flatMap((member) => {
    if (member.member_type !== "agent") return [];
    const agent = agentsById.get(member.member_id);
    if (!agent) return [];
    return [
      {
        agentId: agent.id,
        detail: deriveAgentListStatus(agent, presenceMap.get(agent.id) ?? null),
      },
    ];
  });
  return deriveSquadListStatus(leaderId, agentMembers);
}

/**
 * A squad's status spelled out: who is blocking it when it needs a person
 * (the leader first — without one nobody picks up the squad's issues), how
 * many members are working, or idle.
 */
export function SquadStatusLabel({ detail }: { detail: SquadListStatusDetail }) {
  const { t } = useT("squads");
  if (detail.status === "attention") {
    const Icon = detail.noRuntimeCount > 0 ? AlertTriangle : WifiOff;
    const label = detail.leaderAttention
      ? t(($) => $.list.now.leader_unavailable)
      : detail.noRuntimeCount > 0
        ? t(($) => $.list.now.members_need_runtime, {
            count: detail.noRuntimeCount,
          })
        : t(($) => $.list.now.members_offline, {
            count: detail.offlineQueuedCount,
          });
    return (
      <>
        <Icon aria-hidden="true" className="size-3.5 shrink-0 text-warning" />
        <span className="min-w-0 truncate text-caption">{label}</span>
      </>
    );
  }
  if (detail.status === "working") {
    return (
      <>
        <StatusDot tone="working" />
        <span className="min-w-0 truncate text-caption">
          {t(($) => $.list.now.working, { count: detail.workingCount })}
        </span>
      </>
    );
  }
  return (
    <>
      <StatusDot tone="idle" />
      <span className="min-w-0 truncate text-caption text-muted-foreground">
        {t(($) => $.list.status.idle)}
      </span>
    </>
  );
}
