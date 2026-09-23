// The one status an agent shows in lists and summaries. It answers "does a
// person need to step in right now?" and is derived from the same presence
// facts as the status dot (runtime reachability + the task snapshot), so it
// needs no extra request. Each agent lands in exactly one status: the checks
// below run in priority order and the first match wins.
//
// Only current facts count. A failed run is history (the 7-day chart, the
// detail page and the inbox carry it), and an offline runtime with nothing
// waiting on it is not a problem until work queues up behind it.

import type { Agent } from "../types";
import type { AgentPresenceDetail } from "./types";
import { isAgentRuntimeBound } from "./runtime-binding";

export type AgentListStatus =
  | "attention"
  | "working"
  | "idle"
  | "offline"
  | "archived";

export type AgentAttentionReason = "no_runtime" | "runtime_offline_queued";

export interface AgentListStatusDetail {
  status: AgentListStatus;
  /** Set only when status is "attention". */
  reason: AgentAttentionReason | null;
}

/** Group order in lists: what needs a person first, then live work. */
export const AGENT_LIST_STATUS_ORDER: readonly Exclude<
  AgentListStatus,
  "archived"
>[] = ["attention", "working", "idle", "offline"];

export function deriveAgentListStatus(
  agent: Pick<Agent, "archived_at" | "runtime_id" | "runtime_bound">,
  presence: AgentPresenceDetail | null,
): AgentListStatusDetail {
  if (agent.archived_at) return { status: "archived", reason: null };
  if (!isAgentRuntimeBound(agent)) {
    return { status: "attention", reason: "no_runtime" };
  }
  // Presence still loading: read as idle rather than guessing a problem.
  if (!presence) return { status: "idle", reason: null };
  // `offline` availability already excludes the five-minute "unstable"
  // grace window, so a brief network blip never flips a row into this group.
  if (presence.availability === "offline" && presence.queuedCount > 0) {
    return { status: "attention", reason: "runtime_offline_queued" };
  }
  if (presence.runningCount > 0 || presence.queuedCount > 0) {
    return { status: "working", reason: null };
  }
  if (presence.availability === "offline") {
    return { status: "offline", reason: null };
  }
  return { status: "idle", reason: null };
}
