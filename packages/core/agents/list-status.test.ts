// @vitest-environment node
import { describe, expect, it } from "vitest";
import { deriveAgentListStatus } from "./list-status";
import type { AgentPresenceDetail } from "./types";

const bound = { archived_at: null, runtime_id: "rt-1", runtime_bound: true };

function presence(
  availability: AgentPresenceDetail["availability"],
  runningCount = 0,
  queuedCount = 0,
): AgentPresenceDetail {
  return {
    availability,
    workload: runningCount > 0 ? "working" : queuedCount > 0 ? "queued" : "idle",
    runningCount,
    queuedCount,
    capacity: 2,
  };
}

describe("deriveAgentListStatus", () => {
  it("puts archived first, whatever the runtime says", () => {
    expect(
      deriveAgentListStatus(
        { ...bound, archived_at: "2026-09-01T00:00:00Z" },
        presence("online", 1),
      ),
    ).toEqual({ status: "archived", reason: null });
  });

  it("needs attention without a runtime", () => {
    expect(
      deriveAgentListStatus({ ...bound, runtime_id: "" }, presence("online")),
    ).toEqual({ status: "attention", reason: "no_runtime" });
  });

  it("needs attention when work queues behind an offline runtime", () => {
    expect(deriveAgentListStatus(bound, presence("offline", 0, 3))).toEqual({
      status: "attention",
      reason: "runtime_offline_queued",
    });
  });

  it("keeps a queue on a briefly unstable runtime as working", () => {
    expect(deriveAgentListStatus(bound, presence("unstable", 0, 2)).status).toBe(
      "working",
    );
  });

  it("is working while something runs or is about to start", () => {
    expect(deriveAgentListStatus(bound, presence("online", 1)).status).toBe(
      "working",
    );
    expect(deriveAgentListStatus(bound, presence("online", 0, 1)).status).toBe(
      "working",
    );
  });

  it("separates idle from offline with nothing queued", () => {
    expect(deriveAgentListStatus(bound, presence("online")).status).toBe("idle");
    expect(deriveAgentListStatus(bound, presence("unstable")).status).toBe(
      "idle",
    );
    expect(deriveAgentListStatus(bound, presence("offline")).status).toBe(
      "offline",
    );
  });

  it("reads as idle while presence is still loading", () => {
    expect(deriveAgentListStatus(bound, null).status).toBe("idle");
  });
});
