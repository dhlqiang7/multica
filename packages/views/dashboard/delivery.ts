import type {
  DashboardDelivery,
  DashboardDeliveryIssue,
  DashboardDeliverySource,
} from "@multica/core/types";
import { addDaysIso, weekStartIso } from "../runtimes/utils";
import { DELETED_AGENTS_ROW_ID, RESTRICTED_AGENTS_ROW_ID } from "./utils";

// ---------------------------------------------------------------------------
// Delivery analytics — pure folds over GET /api/dashboard/delivery.
//
// The unit is the issue, not the run. The cohort of a period is every issue
// whose first agent task started inside it; every figure on the Overview and
// Delivery tabs is folded from that one cohort, which is what keeps the KPI
// row, the funnel and the scorecard reconciling with each other.
//
//   delivered   reached in_review or done at least once after the agent
//               started (or sits in done now)
//   accepted    sits in a done status now (see DashboardDeliveryIssue.status_kind)
//   first pass  delivered and never sent back from in_review
//   bounce      one move from in_review back to backlog / todo / in_progress
// ---------------------------------------------------------------------------

export function isDelivered(issue: DashboardDeliveryIssue): boolean {
  return issue.delivered_at !== null || issue.status_kind === "done";
}

export function isAccepted(issue: DashboardDeliveryIssue): boolean {
  return issue.status_kind === "done";
}

function secondsBetween(from: string, to: string): number | null {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, (b - a) / 1000);
}

/** Assignment → first delivery, in seconds. */
export function cycleSeconds(issue: DashboardDeliveryIssue): number | null {
  if (!issue.delivered_at) return null;
  return secondsBetween(issue.assigned_at, issue.delivered_at);
}

/** First delivery → acceptance, in seconds: the review loop, rework included. */
export function reviewSeconds(issue: DashboardDeliveryIssue): number | null {
  if (!issue.delivered_at || !issue.accepted_at) return null;
  return secondsBetween(issue.delivered_at, issue.accepted_at);
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export interface DeliveryPeriods {
  current: DashboardDeliveryIssue[];
  previous: DashboardDeliveryIssue[];
}

/** Splits the payload on the server's own period boundary. */
export function splitDeliveryPeriods(delivery: DashboardDelivery): DeliveryPeriods {
  const boundary = Date.parse(delivery.window_start);
  if (Number.isNaN(boundary)) {
    return { current: delivery.issues, previous: [] };
  }
  const current: DashboardDeliveryIssue[] = [];
  const previous: DashboardDeliveryIssue[] = [];
  for (const issue of delivery.issues) {
    if (Date.parse(issue.assigned_at) >= boundary) current.push(issue);
    else previous.push(issue);
  }
  return { current, previous };
}

/**
 * Re-points issues attributed to an agent this viewer cannot name (deleted,
 * or not yet in the loaded list) onto the deleted bucket, so the scorecard
 * never renders a bare UUID and still adds up to the workspace total. Skipped
 * until the agent list has loaded (`knownIds === null`).
 */
export function foldUnknownDeliveryAgents(
  issues: readonly DashboardDeliveryIssue[],
  knownIds: ReadonlySet<string> | null,
): DashboardDeliveryIssue[] {
  if (!knownIds) return [...issues];
  return issues.map((issue) =>
    issue.agent_id === RESTRICTED_AGENTS_ROW_ID || knownIds.has(issue.agent_id)
      ? issue
      : { ...issue, agent_id: DELETED_AGENTS_ROW_ID },
  );
}

// ---------------------------------------------------------------------------
// Summary + funnel
// ---------------------------------------------------------------------------

/** Where an issue that has not been accepted currently sits. */
export type DeliveryStage =
  | "in_review"
  | "reworking"
  | "in_progress"
  | "blocked"
  | "cancelled";

export const DELIVERY_STAGES: readonly DeliveryStage[] = [
  "in_review",
  "reworking",
  "in_progress",
  "blocked",
  "cancelled",
];

/** null for an accepted issue; otherwise the stage it is stuck in. */
export function deliveryStageOf(issue: DashboardDeliveryIssue): DeliveryStage | null {
  switch (issue.status_kind) {
    case "done":
      return null;
    case "in_review":
      return "in_review";
    case "blocked":
      return "blocked";
    case "cancelled":
      return "cancelled";
    default:
      // backlog / todo / in_progress, and any category a newer backend adds:
      // work is still open. Once delivered it is back in rework.
      return isDelivered(issue) ? "reworking" : "in_progress";
  }
}

export interface DeliverySummary {
  assigned: number;
  delivered: number;
  accepted: number;
  firstPass: number;
  /** Delivered issues that were sent back at least once. */
  reworked: number;
  /** Total bounces across delivered issues. */
  bounces: number;
  /** firstPass / delivered; null with nothing delivered. */
  firstPassRate: number | null;
  medianCycleSeconds: number | null;
  medianReviewSeconds: number | null;
  /** Median agent run time before the first delivery, over delivered issues. */
  medianRunSeconds: number | null;
  runs: number;
  failedRuns: number;
  stages: Record<DeliveryStage, number>;
}

export function summarizeDelivery(
  issues: readonly DashboardDeliveryIssue[],
): DeliverySummary {
  const stages: Record<DeliveryStage, number> = {
    in_review: 0,
    reworking: 0,
    in_progress: 0,
    blocked: 0,
    cancelled: 0,
  };
  let delivered = 0;
  let accepted = 0;
  let firstPass = 0;
  let reworked = 0;
  let bounces = 0;
  let runs = 0;
  let failedRuns = 0;
  const cycles: number[] = [];
  const reviews: number[] = [];
  const runTimes: number[] = [];

  for (const issue of issues) {
    runs += issue.run_count;
    failedRuns += issue.failed_run_count;
    const stage = deliveryStageOf(issue);
    if (stage) stages[stage] += 1;
    else accepted += 1;
    if (!isDelivered(issue)) continue;
    delivered += 1;
    bounces += issue.bounce_count;
    if (issue.bounce_count === 0) firstPass += 1;
    else reworked += 1;
    runTimes.push(issue.run_seconds);
    const cycle = cycleSeconds(issue);
    if (cycle !== null) cycles.push(cycle);
    const review = reviewSeconds(issue);
    if (review !== null) reviews.push(review);
  }

  return {
    assigned: issues.length,
    delivered,
    accepted,
    firstPass,
    reworked,
    bounces,
    firstPassRate: delivered > 0 ? firstPass / delivered : null,
    medianCycleSeconds: median(cycles),
    medianReviewSeconds: median(reviews),
    medianRunSeconds: median(runTimes),
    runs,
    failedRuns,
    stages,
  };
}

// ---------------------------------------------------------------------------
// Period-over-period deltas
// ---------------------------------------------------------------------------

/** Relative change; null when there is no baseline to compare against. */
export function relativeChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / previous;
}

/** Absolute change of a rate, in percentage points. */
export function pointChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return (current - previous) * 100;
}

// ---------------------------------------------------------------------------
// Per-agent scorecard
// ---------------------------------------------------------------------------

export interface AgentDeliveryRow {
  agentId: string;
  assigned: number;
  delivered: number;
  firstPass: number;
  bounces: number;
  firstPassRate: number | null;
  /** Bounces per delivered issue. */
  reworkRounds: number | null;
  medianCycleSeconds: number | null;
  runs: number;
  failedRuns: number;
  failureRate: number | null;
}

export function aggregateDeliveryByAgent(
  issues: readonly DashboardDeliveryIssue[],
): AgentDeliveryRow[] {
  const byAgent = new Map<string, DashboardDeliveryIssue[]>();
  for (const issue of issues) {
    const list = byAgent.get(issue.agent_id);
    if (list) list.push(issue);
    else byAgent.set(issue.agent_id, [issue]);
  }
  const rows: AgentDeliveryRow[] = [];
  for (const [agentId, list] of byAgent) {
    const s = summarizeDelivery(list);
    rows.push({
      agentId,
      assigned: s.assigned,
      delivered: s.delivered,
      firstPass: s.firstPass,
      bounces: s.bounces,
      firstPassRate: s.firstPassRate,
      reworkRounds: s.delivered > 0 ? s.bounces / s.delivered : null,
      medianCycleSeconds: s.medianCycleSeconds,
      runs: s.runs,
      failedRuns: s.failedRuns,
      failureRate: s.runs > 0 ? s.failedRuns / s.runs : null,
    });
  }
  // Most deliveries first; ties go to the agent picked up more work.
  return rows.toSorted(
    (a, b) => b.delivered - a.delivered || b.assigned - a.assigned,
  );
}

// Below these samples a rate says more about luck than about the agent, so
// the scorecard does not flag it and the insights do not cite it.
export const MIN_DELIVERED_SAMPLE = 5;
export const MIN_RUN_SAMPLE = 10;

/** First-pass rate this far under the team's is flagged. */
export const FIRST_PASS_GAP = 0.1;
/** A failure rate at or above this is flagged. */
export const FAILURE_RATE_ALERT = 0.15;

export function isFirstPassLow(
  row: Pick<AgentDeliveryRow, "delivered" | "firstPassRate">,
  teamRate: number | null,
): boolean {
  return (
    row.delivered >= MIN_DELIVERED_SAMPLE &&
    row.firstPassRate !== null &&
    teamRate !== null &&
    row.firstPassRate < teamRate - FIRST_PASS_GAP
  );
}

export function isFailureRateHigh(
  row: Pick<AgentDeliveryRow, "runs" | "failureRate">,
): boolean {
  return (
    row.runs >= MIN_RUN_SAMPLE &&
    row.failureRate !== null &&
    row.failureRate >= FAILURE_RATE_ALERT
  );
}

// ---------------------------------------------------------------------------
// Time series
// ---------------------------------------------------------------------------

/** Calendar date (YYYY-MM-DD) of an instant in the viewer's timezone. */
export function isoDateInTz(timestamp: string, tz: string): string | null {
  const ms = Date.parse(timestamp);
  if (Number.isNaN(ms)) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

export interface DeliveryBucket {
  /** First day of the bucket (YYYY-MM-DD). */
  start: string;
  firstPass: number;
  reworked: number;
}

/**
 * Deliveries per day (or per Monday-started week) from `firstDay` through
 * `lastDay`, bucketed on the day the FIRST delivery happened, split into
 * first-pass and reworked. Empty buckets are kept so the axis is continuous.
 */
export function bucketDeliveries(
  issues: readonly DashboardDeliveryIssue[],
  tz: string,
  firstDay: string,
  lastDay: string,
  grain: "daily" | "weekly",
): DeliveryBucket[] {
  const keyOf = (day: string) => (grain === "weekly" ? weekStartIso(day) : day);
  const step = grain === "weekly" ? 7 : 1;
  const buckets = new Map<string, DeliveryBucket>();
  for (let day = keyOf(firstDay); day <= lastDay; day = addDaysIso(day, step)) {
    buckets.set(day, { start: day, firstPass: 0, reworked: 0 });
  }
  for (const issue of issues) {
    if (!isDelivered(issue)) continue;
    const day = isoDateInTz(issue.delivered_at ?? issue.accepted_at ?? "", tz);
    if (!day || day < firstDay || day > lastDay) continue;
    const bucket = buckets.get(keyOf(day));
    if (!bucket) continue;
    if (issue.bounce_count === 0) bucket.firstPass += 1;
    else bucket.reworked += 1;
  }
  return [...buckets.values()];
}

/**
 * A per-day trend of `metric` over the trailing 7 days ending on each day, so
 * a sparkline of a rate or a median reads as a trend rather than as daily
 * noise. Days whose trailing window has no sample repeat the last value.
 */
export function trailingDailySeries(
  issues: readonly DashboardDeliveryIssue[],
  tz: string,
  firstDay: string,
  lastDay: string,
  metric: (window: DashboardDeliveryIssue[]) => number | null,
): number[] {
  const byDay = new Map<string, DashboardDeliveryIssue[]>();
  for (const issue of issues) {
    if (!isDelivered(issue)) continue;
    const day = isoDateInTz(issue.delivered_at ?? issue.accepted_at ?? "", tz);
    if (!day) continue;
    const list = byDay.get(day);
    if (list) list.push(issue);
    else byDay.set(day, [issue]);
  }
  const series: number[] = [];
  let last: number | null = null;
  for (let day = firstDay; day <= lastDay; day = addDaysIso(day, 1)) {
    const window: DashboardDeliveryIssue[] = [];
    for (let back = 0; back < 7; back++) {
      window.push(...(byDay.get(addDaysIso(day, -back)) ?? []));
    }
    const value = metric(window);
    if (value !== null) last = value;
    series.push(last ?? 0);
  }
  return series;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export const DELIVERY_SOURCES: readonly DashboardDeliverySource[] = [
  "member",
  "autopilot",
  "agent",
];

export interface SourceRow {
  source: DashboardDeliverySource;
  assigned: number;
  delivered: number;
}

export function aggregateDeliverySources(
  issues: readonly DashboardDeliveryIssue[],
): SourceRow[] {
  return DELIVERY_SOURCES.map((source) => {
    const list = issues.filter((i) => i.source === source);
    return {
      source,
      assigned: list.length,
      delivered: list.filter(isDelivered).length,
    };
  });
}

// ---------------------------------------------------------------------------
// Drill-down filters
// ---------------------------------------------------------------------------

export type DeliveryIssueFilter =
  | { kind: "stage"; stage: DeliveryStage }
  | { kind: "bounced"; agentId?: string }
  | { kind: "waiting_review" }
  | { kind: "delivered"; agentId: string };

// An in_review issue has waited at least since its last bounce (it was
// re-delivered after that) or, never bounced, since its first delivery.
function reviewWaitStart(issue: DashboardDeliveryIssue): string | null {
  return issue.bounce_count > 0 ? issue.last_bounce_at : issue.delivered_at;
}

export const LONG_REVIEW_WAIT_SECONDS = 2 * 24 * 60 * 60;

export function waitingReviewSeconds(
  issue: DashboardDeliveryIssue,
  now: number,
): number | null {
  if (issue.status_kind !== "in_review") return null;
  const since = reviewWaitStart(issue);
  if (!since) return null;
  const ms = Date.parse(since);
  return Number.isNaN(ms) ? null : Math.max(0, (now - ms) / 1000);
}

export function filterDeliveryIssues(
  issues: readonly DashboardDeliveryIssue[],
  filter: DeliveryIssueFilter,
  now: number,
): DashboardDeliveryIssue[] {
  switch (filter.kind) {
    case "stage":
      return issues.filter((i) => deliveryStageOf(i) === filter.stage);
    case "bounced":
      return issues
        .filter(
          (i) =>
            i.bounce_count > 0 &&
            (filter.agentId === undefined || i.agent_id === filter.agentId),
        )
        .toSorted((a, b) => b.bounce_count - a.bounce_count);
    case "delivered":
      return issues.filter((i) => i.agent_id === filter.agentId && isDelivered(i));
    case "waiting_review":
      return issues
        .filter(
          (i) => (waitingReviewSeconds(i, now) ?? 0) >= LONG_REVIEW_WAIT_SECONDS,
        )
        .toSorted(
          (a, b) =>
            (waitingReviewSeconds(b, now) ?? 0) - (waitingReviewSeconds(a, now) ?? 0),
        );
  }
}

// ---------------------------------------------------------------------------
// Insights — rule-based, so every line can be checked against the numbers
// on the same page. Most actionable first, at most three.
// ---------------------------------------------------------------------------

export type DeliveryInsight =
  | {
      kind: "failure_spike";
      agentId: string;
      rate: number;
      previousRate: number | null;
      runs: number;
      failed: number;
    }
  | {
      kind: "review_backlog";
      count: number;
      inReview: number;
      oldestIdentifier: string;
      oldestDays: number;
    }
  | {
      kind: "low_first_pass";
      agentId: string;
      rate: number;
      teamRate: number;
      delivered: number;
      reworked: number;
    }
  | { kind: "blocked"; count: number };

export const MAX_INSIGHTS = 3;

export function deriveDeliveryInsights(
  periods: DeliveryPeriods,
  now: number,
): DeliveryInsight[] {
  const insights: DeliveryInsight[] = [];
  const currentByAgent = aggregateDeliveryByAgent(periods.current);
  const previousByAgent = new Map(
    aggregateDeliveryByAgent(periods.previous).map((r) => [r.agentId, r]),
  );
  const isNamed = (agentId: string) =>
    agentId !== DELETED_AGENTS_ROW_ID && agentId !== RESTRICTED_AGENTS_ROW_ID;

  // A failure rate that is both high and clearly up on the previous period.
  const spikes = currentByAgent
    .filter((row) => isNamed(row.agentId) && isFailureRateHigh(row))
    .map((row) => {
      const prev = previousByAgent.get(row.agentId);
      const previousRate =
        prev && prev.runs >= MIN_RUN_SAMPLE ? prev.failureRate : null;
      return { row, previousRate };
    })
    .filter(
      ({ row, previousRate }) =>
        previousRate === null || row.failureRate! - previousRate >= 0.05,
    )
    .toSorted((a, b) => b.row.failureRate! - a.row.failureRate!);
  const spike = spikes[0];
  if (spike) {
    insights.push({
      kind: "failure_spike",
      agentId: spike.row.agentId,
      rate: spike.row.failureRate!,
      previousRate: spike.previousRate,
      runs: spike.row.runs,
      failed: spike.row.failedRuns,
    });
  }

  // Review backlog reads across both periods: an issue picked up last period
  // can still be waiting for review now.
  const everything = [...periods.current, ...periods.previous];
  const waiting = filterDeliveryIssues(everything, { kind: "waiting_review" }, now);
  const oldest = waiting[0];
  if (oldest) {
    insights.push({
      kind: "review_backlog",
      count: waiting.length,
      inReview: everything.filter((i) => i.status_kind === "in_review").length,
      oldestIdentifier: oldest.identifier,
      oldestDays: Math.floor(
        (waitingReviewSeconds(oldest, now) ?? 0) / (24 * 60 * 60),
      ),
    });
  }

  const team = summarizeDelivery(periods.current);
  const low = currentByAgent
    .filter((row) => isNamed(row.agentId) && isFirstPassLow(row, team.firstPassRate))
    .toSorted((a, b) => a.firstPassRate! - b.firstPassRate!)[0];
  if (low && team.firstPassRate !== null) {
    insights.push({
      kind: "low_first_pass",
      agentId: low.agentId,
      rate: low.firstPassRate!,
      teamRate: team.firstPassRate,
      delivered: low.delivered,
      reworked: low.delivered - low.firstPass,
    });
  }

  const blocked = periods.current.filter((i) => deliveryStageOf(i) === "blocked").length;
  if (blocked > 0) insights.push({ kind: "blocked", count: blocked });

  return insights.slice(0, MAX_INSIGHTS);
}
