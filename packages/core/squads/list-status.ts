// A squad's list status, rolled up from its agent members' list statuses
// (see agents/list-status.ts). Squads are few, so the list sorts by this
// instead of grouping. The leader is what makes a squad work: while it is
// unavailable nobody can pick up issues assigned to the squad, so a leader
// that needs attention flags the squad even when every other member is fine.

import type { AgentListStatusDetail } from "../agents/list-status";

export type SquadListStatus = "attention" | "working" | "idle";

export const SQUAD_LIST_STATUS_ORDER: readonly SquadListStatus[] = [
  "attention",
  "working",
  "idle",
];

export interface SquadListStatusDetail {
  status: SquadListStatus;
  leaderAttention: boolean;
  /** Agent members, leader included, without a runtime. */
  noRuntimeCount: number;
  /** Agent members, leader included, with work stuck on an offline runtime. */
  offlineQueuedCount: number;
  workingCount: number;
}

export function deriveSquadListStatus(
  leaderId: string,
  agentMembers: readonly { agentId: string; detail: AgentListStatusDetail }[],
): SquadListStatusDetail {
  let leaderAttention = false;
  let noRuntimeCount = 0;
  let offlineQueuedCount = 0;
  let workingCount = 0;
  for (const { agentId, detail } of agentMembers) {
    if (detail.status === "attention") {
      if (agentId === leaderId) leaderAttention = true;
      if (detail.reason === "no_runtime") noRuntimeCount += 1;
      else offlineQueuedCount += 1;
    } else if (detail.status === "working") {
      workingCount += 1;
    }
  }
  const status: SquadListStatus =
    noRuntimeCount + offlineQueuedCount > 0
      ? "attention"
      : workingCount > 0
        ? "working"
        : "idle";
  return {
    status,
    leaderAttention,
    noRuntimeCount,
    offlineQueuedCount,
    workingCount,
  };
}
