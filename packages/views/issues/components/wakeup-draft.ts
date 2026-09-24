import type { IssueWakeupInput } from "@multica/core/types";

/** The 25 issue-scoped events, in catalog order. */
export const WAKEUP_EVENT_TYPES = [
  "task.queued",
  "task.dispatched",
  "task.started",
  "task.deferred",
  "task.waiting_local_directory",
  "task.completed",
  "task.failed",
  "task.cancelled",
  "issue.updated",
  "issue.status_changed",
  "issue.assignee_changed",
  "issue.parent_changed",
  "issue.project_changed",
  "issue.labels_changed",
  "issue.properties_changed",
  "issue.metadata_changed",
  "comment.created",
  "comment.updated",
  "comment.deleted",
  "comment.resolved",
  "comment.unresolved",
  "reaction.added",
  "reaction.removed",
  "attachment.attached",
  "attachment.detached",
] as const;

const RUN_END_EVENTS = ["task.completed", "task.failed", "task.cancelled"];

export type WakeupCondition = "at" | "recurring" | "reply" | "run_end" | "custom";
export type WakeupAtPreset = "10m" | "1h" | "tomorrow" | "custom";
export type WakeupRecurrence = "hourly" | "daily" | "weekdays";
export const WAKEUP_WAIT_DAYS = [1, 3, 7, 30] as const;

export interface WakeupDraft {
  condition: WakeupCondition | null;
  atPreset: WakeupAtPreset;
  /** A `datetime-local` value, read in the browser's timezone. */
  atCustom: string;
  recurrence: WakeupRecurrence;
  /** A `date` value; the rule ends at the end of that local day. */
  until: string;
  /** Null waits for anyone's reply. */
  replyActor: { type: "member" | "agent"; id: string } | null;
  /** Empty waits for any agent's run. */
  runAgentId: string;
  events: string[];
  agentId: string;
  instruction: string;
  mode: "once" | "continuous";
  waitDays: number;
  onTimeout: "wake" | "end";
  /** IANA zone that gives daily schedules their meaning. */
  timezone: string;
}

export type WakeupDraftError =
  | "missing_condition"
  | "missing_agent"
  | "missing_events"
  | "instruction_invalid"
  | "future_time"
  | "until_future";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function localDate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function emptyWakeupDraft(agentId: string, timezone: string, now = new Date()): WakeupDraft {
  const until = new Date(now);
  until.setDate(until.getDate() + 7);
  return {
    condition: null,
    atPreset: "1h",
    atCustom: "",
    recurrence: "daily",
    until: localDate(until),
    replyActor: null,
    runAgentId: "",
    events: [],
    agentId,
    instruction: "",
    mode: "once",
    waitDays: 7,
    onTimeout: "wake",
    timezone,
  };
}

export function isEventCondition(condition: WakeupCondition | null) {
  return condition === "reply" || condition === "run_end" || condition === "custom";
}

/** Maps what a person chose onto the wakeup API; the server re-validates. */
export function buildWakeupInput(
  d: WakeupDraft,
  now = new Date(),
): { input: IssueWakeupInput } | { error: WakeupDraftError } {
  if (!d.condition) return { error: "missing_condition" };
  if (!d.agentId) return { error: "missing_agent" };
  const instruction = d.instruction.trim();
  if (!instruction || new TextEncoder().encode(instruction).length > 12000) {
    return { error: "instruction_invalid" };
  }
  const base = { agent_id: d.agentId, instruction };
  switch (d.condition) {
    case "at": {
      let at: Date;
      if (d.atPreset === "10m") at = new Date(now.getTime() + 10 * 60_000);
      else if (d.atPreset === "1h") at = new Date(now.getTime() + 60 * 60_000);
      else if (d.atPreset === "tomorrow") {
        at = new Date(now);
        at.setDate(at.getDate() + 1);
        at.setHours(9, 0, 0, 0);
      } else at = new Date(d.atCustom);
      if (!Number.isFinite(at.getTime()) || at.getTime() <= now.getTime()) return { error: "future_time" };
      return { input: { ...base, kind: "at", mode: "once", at: at.toISOString() } };
    }
    case "recurring": {
      const end = new Date(`${d.until}T23:59:59`);
      if (!Number.isFinite(end.getTime()) || end.getTime() <= now.getTime()) return { error: "until_future" };
      const schedule: Pick<IssueWakeupInput, "kind" | "interval_seconds" | "cron_expression" | "timezone"> =
        d.recurrence === "hourly"
          ? { kind: "every", interval_seconds: 3600 }
          : { kind: "cron", cron_expression: d.recurrence === "daily" ? "0 9 * * *" : "0 9 * * 1-5", timezone: d.timezone };
      return { input: { ...base, ...schedule, mode: "continuous", expires_at: end.toISOString() } };
    }
    default: {
      const input: IssueWakeupInput = {
        ...base,
        kind: "event",
        mode: d.mode,
        expires_in_seconds: d.waitDays * 86400,
        on_timeout: d.onTimeout,
      };
      if (d.condition === "reply") {
        input.event_types = ["comment.created"];
        if (d.replyActor) {
          input.filter_actor_type = d.replyActor.type;
          input.filter_actor_id = d.replyActor.id;
        }
      } else if (d.condition === "run_end") {
        input.event_types = RUN_END_EVENTS;
        if (d.runAgentId) input.filter_agent_id = d.runAgentId;
      } else {
        if (d.events.length === 0) return { error: "missing_events" };
        input.event_types = d.events;
      }
      return { input };
    }
  }
}
