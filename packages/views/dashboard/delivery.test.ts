// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { DashboardDeliveryIssue } from "@multica/core/types";
import {
  aggregateDeliveryByAgent,
  aggregateDeliverySources,
  bucketDeliveries,
  deliveryStageOf,
  deriveDeliveryInsights,
  filterDeliveryIssues,
  foldUnknownDeliveryAgents,
  isFailureRateHigh,
  isFirstPassLow,
  median,
  pointChange,
  relativeChange,
  splitDeliveryPeriods,
  summarizeDelivery,
  trailingDailySeries,
} from "./delivery";
import { DELETED_AGENTS_ROW_ID, RESTRICTED_AGENTS_ROW_ID } from "./utils";

const NOW = Date.parse("2026-09-24T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

let seq = 0;
function issue(over: Partial<DashboardDeliveryIssue> = {}): DashboardDeliveryIssue {
  seq += 1;
  return {
    issue_id: `i-${seq}`,
    identifier: `MUL-${seq}`,
    title: `Issue ${seq}`,
    status: "done",
    status_kind: "done",
    project_id: null,
    source: "member",
    agent_id: "a",
    assigned_at: at(10 * HOUR),
    delivered_at: at(8 * HOUR),
    accepted_at: at(4 * HOUR),
    bounce_count: 0,
    last_bounce_at: null,
    run_count: 1,
    failed_run_count: 0,
    run_seconds: 600,
    ...over,
  };
}

describe("splitDeliveryPeriods", () => {
  it("splits on the server's boundary, inclusive of the current period", () => {
    const current = issue({ assigned_at: "2026-09-01T00:00:00Z" });
    const previous = issue({ assigned_at: "2026-08-31T23:59:59Z" });
    const periods = splitDeliveryPeriods({
      window_start: "2026-09-01T00:00:00Z",
      previous_window_start: "2026-08-02T00:00:00Z",
      issues: [current, previous],
    });
    expect(periods.current).toEqual([current]);
    expect(periods.previous).toEqual([previous]);
  });

  it("treats everything as current when the boundary is missing", () => {
    const only = issue();
    const periods = splitDeliveryPeriods({
      window_start: "",
      previous_window_start: "",
      issues: [only],
    });
    expect(periods).toEqual({ current: [only], previous: [] });
  });
});

describe("deliveryStageOf", () => {
  it("files open work by category and splits delivered-then-reopened work into rework", () => {
    expect(deliveryStageOf(issue())).toBeNull();
    expect(deliveryStageOf(issue({ status_kind: "in_review" }))).toBe("in_review");
    expect(deliveryStageOf(issue({ status_kind: "blocked" }))).toBe("blocked");
    expect(deliveryStageOf(issue({ status_kind: "cancelled" }))).toBe("cancelled");
    expect(
      deliveryStageOf(issue({ status_kind: "in_progress", delivered_at: null })),
    ).toBe("in_progress");
    expect(deliveryStageOf(issue({ status_kind: "todo" }))).toBe("reworking");
    // A category a newer backend adds is still open work, never dropped.
    expect(
      deliveryStageOf(issue({ status_kind: "someday", delivered_at: null })),
    ).toBe("in_progress");
  });
});

describe("summarizeDelivery", () => {
  it("counts the funnel so every stage adds back up to what was picked up", () => {
    const issues = [
      issue(),
      issue({ bounce_count: 2 }),
      issue({ status_kind: "in_review", accepted_at: null }),
      issue({ status_kind: "in_progress", accepted_at: null, bounce_count: 1 }),
      issue({ status_kind: "blocked", delivered_at: null, accepted_at: null }),
      issue({ status_kind: "cancelled", delivered_at: null, accepted_at: null }),
    ];
    const s = summarizeDelivery(issues);

    expect(s).toMatchObject({
      assigned: 6,
      delivered: 4,
      accepted: 2,
      firstPass: 2,
      reworked: 2,
      bounces: 3,
      stages: { in_review: 1, reworking: 1, in_progress: 0, blocked: 1, cancelled: 1 },
    });
    expect(s.firstPassRate).toBe(0.5);
    const openStages = Object.values(s.stages).reduce((a, b) => a + b, 0);
    expect(openStages).toBe(s.assigned - s.accepted);
  });

  it("counts an issue sitting in done as delivered even without a recorded delivery", () => {
    const s = summarizeDelivery([issue({ delivered_at: null })]);
    expect(s.delivered).toBe(1);
    // No timestamp, so it cannot contribute a cycle time.
    expect(s.medianCycleSeconds).toBeNull();
  });

  it("takes medians of cycle, review and pre-delivery run time", () => {
    const s = summarizeDelivery([
      issue({ assigned_at: at(10 * HOUR), delivered_at: at(9 * HOUR), run_seconds: 100 }),
      issue({ assigned_at: at(10 * HOUR), delivered_at: at(7 * HOUR), run_seconds: 300 }),
      issue({
        assigned_at: at(10 * HOUR),
        delivered_at: at(5 * HOUR),
        accepted_at: null,
        status_kind: "in_review",
        run_seconds: 500,
      }),
    ]);
    expect(s.medianCycleSeconds).toBe(3 * 3_600);
    expect(s.medianRunSeconds).toBe(300);
    // Only the two accepted issues have a review time: 5h and 3h.
    expect(s.medianReviewSeconds).toBe(4 * 3_600);
  });

  it("returns null rates on an empty period instead of 0%", () => {
    const s = summarizeDelivery([]);
    expect(s.firstPassRate).toBeNull();
    expect(s.medianCycleSeconds).toBeNull();
  });
});

describe("median", () => {
  it("handles odd, even and empty inputs without mutating them", () => {
    const values = [3, 1, 2];
    expect(median(values)).toBe(2);
    expect(values).toEqual([3, 1, 2]);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("period deltas", () => {
  it("has no relative change without a baseline", () => {
    expect(relativeChange(10, 0)).toBeNull();
    expect(relativeChange(null, 4)).toBeNull();
    expect(relativeChange(12, 10)).toBeCloseTo(0.2);
  });

  it("reports rates in percentage points", () => {
    expect(pointChange(0.71, 0.65)).toBeCloseTo(6);
    expect(pointChange(0.5, null)).toBeNull();
  });
});

describe("aggregateDeliveryByAgent", () => {
  it("ranks by deliveries and derives each agent's rates", () => {
    const rows = aggregateDeliveryByAgent([
      issue({ agent_id: "a" }),
      issue({ agent_id: "b", bounce_count: 1, run_count: 4, failed_run_count: 1 }),
      issue({ agent_id: "b" }),
      issue({ agent_id: "b", delivered_at: null, accepted_at: null, status_kind: "todo" }),
    ]);
    expect(rows.map((r) => r.agentId)).toEqual(["b", "a"]);
    expect(rows[0]).toMatchObject({
      assigned: 3,
      delivered: 2,
      firstPass: 1,
      bounces: 1,
      firstPassRate: 0.5,
      reworkRounds: 0.5,
      runs: 6,
      failedRuns: 1,
    });
    expect(rows[0]?.failureRate).toBeCloseTo(1 / 6);
  });
});

describe("scorecard flags", () => {
  it("flags a first-pass rate only with enough deliveries and a clear gap", () => {
    expect(isFirstPassLow({ delivered: 5, firstPassRate: 0.5 }, 0.71)).toBe(true);
    // Within ten points of the team.
    expect(isFirstPassLow({ delivered: 5, firstPassRate: 0.65 }, 0.71)).toBe(false);
    // Too few deliveries to say anything.
    expect(isFirstPassLow({ delivered: 4, firstPassRate: 0 }, 0.71)).toBe(false);
  });

  it("flags a failure rate only above the alert line with enough runs", () => {
    expect(isFailureRateHigh({ runs: 10, failureRate: 0.15 })).toBe(true);
    expect(isFailureRateHigh({ runs: 10, failureRate: 0.1 })).toBe(false);
    expect(isFailureRateHigh({ runs: 9, failureRate: 1 })).toBe(false);
  });
});

describe("bucketDeliveries", () => {
  it("buckets on the delivery day in the viewer's timezone", () => {
    // 2026-09-23T20:00Z is already the 24th in Tokyo.
    const late = issue({ delivered_at: "2026-09-23T20:00:00Z", bounce_count: 1 });
    const early = issue({ delivered_at: "2026-09-23T01:00:00Z" });
    const utc = bucketDeliveries([late, early], "UTC", "2026-09-22", "2026-09-24", "daily");
    expect(utc).toEqual([
      { start: "2026-09-22", firstPass: 0, reworked: 0 },
      { start: "2026-09-23", firstPass: 1, reworked: 1 },
      { start: "2026-09-24", firstPass: 0, reworked: 0 },
    ]);
    const tokyo = bucketDeliveries([late, early], "Asia/Tokyo", "2026-09-22", "2026-09-24", "daily");
    expect(tokyo[1]).toMatchObject({ firstPass: 1, reworked: 0 });
    expect(tokyo[2]).toMatchObject({ firstPass: 0, reworked: 1 });
  });

  it("groups into Monday-started weeks and keeps empty buckets", () => {
    const weeks = bucketDeliveries(
      [issue({ delivered_at: "2026-09-16T12:00:00Z" })],
      "UTC",
      "2026-09-02",
      "2026-09-24",
      "weekly",
    );
    expect(weeks.map((w) => w.start)).toEqual([
      "2026-08-31",
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
    ]);
    expect(weeks[2]?.firstPass).toBe(1);
  });

  it("ignores undelivered issues and deliveries outside the range", () => {
    const buckets = bucketDeliveries(
      [
        issue({ delivered_at: null, accepted_at: null, status_kind: "todo" }),
        issue({ delivered_at: "2026-08-01T12:00:00Z" }),
      ],
      "UTC",
      "2026-09-24",
      "2026-09-24",
      "daily",
    );
    expect(buckets).toEqual([{ start: "2026-09-24", firstPass: 0, reworked: 0 }]);
  });
});

describe("trailingDailySeries", () => {
  it("reads a trailing 7-day window per day and carries the last value over gaps", () => {
    // 01: first-pass delivery, 02: reworked delivery.
    const series = trailingDailySeries(
      [
        issue({ delivered_at: "2026-09-01T12:00:00Z" }),
        issue({ delivered_at: "2026-09-02T12:00:00Z", bounce_count: 1 }),
      ],
      "UTC",
      "2026-08-31",
      "2026-09-10",
      (window) =>
        window.length > 0
          ? window.filter((i) => i.bounce_count === 0).length / window.length
          : null,
    );
    expect(series).toHaveLength(11);
    // No sample yet on the first day.
    expect(series[0]).toBe(0);
    expect(series[1]).toBe(1);
    expect(series[2]).toBe(0.5);
    // By the 8th only the reworked delivery is left in the window.
    expect(series[8]).toBe(0);
    // Both have left it by the 9th: the last value is carried, not reset.
    expect(series[9]).toBe(0);
    expect(series[10]).toBe(0);
  });
});

describe("filterDeliveryIssues", () => {
  it("measures a review wait from the last bounce when there was one", () => {
    const waitingLong = issue({
      status_kind: "in_review",
      accepted_at: null,
      delivered_at: at(5 * DAY),
    });
    // First delivered long ago, but re-delivered after a bounce a day ago.
    const recentlyRedelivered = issue({
      status_kind: "in_review",
      accepted_at: null,
      delivered_at: at(6 * DAY),
      bounce_count: 1,
      last_bounce_at: at(DAY),
    });
    const out = filterDeliveryIssues(
      [waitingLong, recentlyRedelivered, issue()],
      { kind: "waiting_review" },
      NOW,
    );
    expect(out).toEqual([waitingLong]);
  });

  it("scopes sent-back issues to one agent and puts the most-bounced first", () => {
    const a1 = issue({ agent_id: "a", bounce_count: 1 });
    const a2 = issue({ agent_id: "a", bounce_count: 3 });
    const b1 = issue({ agent_id: "b", bounce_count: 5 });
    expect(filterDeliveryIssues([a1, a2, b1], { kind: "bounced", agentId: "a" }, NOW)).toEqual([
      a2,
      a1,
    ]);
    expect(filterDeliveryIssues([a1, a2, b1], { kind: "bounced" }, NOW)[0]).toBe(b1);
  });
});

describe("foldUnknownDeliveryAgents", () => {
  it("folds unnamed agents into the deleted bucket but keeps the server's restricted one", () => {
    const out = foldUnknownDeliveryAgents(
      [
        issue({ agent_id: "known" }),
        issue({ agent_id: "gone" }),
        issue({ agent_id: RESTRICTED_AGENTS_ROW_ID }),
      ],
      new Set(["known"]),
    );
    expect(out.map((i) => i.agent_id)).toEqual([
      "known",
      DELETED_AGENTS_ROW_ID,
      RESTRICTED_AGENTS_ROW_ID,
    ]);
  });

  it("leaves rows alone until the agent list has loaded", () => {
    const rows = [issue({ agent_id: "anything" })];
    expect(foldUnknownDeliveryAgents(rows, null)).toEqual(rows);
  });
});

describe("aggregateDeliverySources", () => {
  it("reports every source, including empty ones", () => {
    const rows = aggregateDeliverySources([
      issue({ source: "autopilot" }),
      issue({ source: "autopilot", delivered_at: null, accepted_at: null, status_kind: "todo" }),
    ]);
    expect(rows).toEqual([
      { source: "member", assigned: 0, delivered: 0 },
      { source: "autopilot", assigned: 2, delivered: 1 },
      { source: "agent", assigned: 0, delivered: 0 },
    ]);
  });
});

describe("deriveDeliveryInsights", () => {
  const flaky = (over: Partial<DashboardDeliveryIssue> = {}) =>
    issue({ agent_id: "flaky", run_count: 2, failed_run_count: 1, ...over });

  it("orders findings by how actionable they are and caps them at three", () => {
    const current = [
      ...Array.from({ length: 5 }, () => flaky({ bounce_count: 1 })),
      flaky(),
      issue({ agent_id: "steady" }),
      issue({ agent_id: "steady" }),
      issue({
        agent_id: "steady",
        status_kind: "in_review",
        accepted_at: null,
        delivered_at: at(3 * DAY),
      }),
      issue({ status_kind: "blocked", delivered_at: null, accepted_at: null }),
    ];
    const insights = deriveDeliveryInsights({ current, previous: [] }, NOW);
    expect(insights.map((i) => i.kind)).toEqual([
      "failure_spike",
      "review_backlog",
      "low_first_pass",
    ]);
    expect(insights[0]).toMatchObject({ agentId: "flaky", rate: 0.5, previousRate: null });
    expect(insights[1]).toMatchObject({ count: 1, oldestDays: 3 });
  });

  it("does not call a failure rate a spike when it was already that high", () => {
    const current = Array.from({ length: 6 }, () => flaky());
    const previous = Array.from({ length: 6 }, () => flaky());
    const insights = deriveDeliveryInsights({ current, previous }, NOW);
    expect(insights.find((i) => i.kind === "failure_spike")).toBeUndefined();
  });

  it("never cites an agent the viewer cannot name", () => {
    const current = Array.from({ length: 6 }, () =>
      issue({ agent_id: RESTRICTED_AGENTS_ROW_ID, run_count: 2, failed_run_count: 2 }),
    );
    expect(deriveDeliveryInsights({ current, previous: [] }, NOW)).toEqual([]);
  });
});
