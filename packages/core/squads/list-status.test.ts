// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { AgentListStatusDetail } from "../agents/list-status";
import { deriveSquadListStatus } from "./list-status";

const idle: AgentListStatusDetail = { status: "idle", reason: null };
const working: AgentListStatusDetail = { status: "working", reason: null };
const noRuntime: AgentListStatusDetail = {
  status: "attention",
  reason: "no_runtime",
};
const stuck: AgentListStatusDetail = {
  status: "attention",
  reason: "runtime_offline_queued",
};

describe("deriveSquadListStatus", () => {
  it("flags the squad when the leader is unavailable", () => {
    const result = deriveSquadListStatus("lead", [
      { agentId: "lead", detail: stuck },
      { agentId: "a", detail: working },
    ]);
    expect(result.status).toBe("attention");
    expect(result.leaderAttention).toBe(true);
    expect(result.offlineQueuedCount).toBe(1);
  });

  it("flags the squad when any member needs attention", () => {
    const result = deriveSquadListStatus("lead", [
      { agentId: "lead", detail: idle },
      { agentId: "a", detail: noRuntime },
    ]);
    expect(result).toMatchObject({
      status: "attention",
      leaderAttention: false,
      noRuntimeCount: 1,
    });
  });

  it("is working while any member works, idle otherwise", () => {
    expect(
      deriveSquadListStatus("lead", [
        { agentId: "lead", detail: idle },
        { agentId: "a", detail: working },
      ]),
    ).toMatchObject({ status: "working", workingCount: 1 });
    expect(
      deriveSquadListStatus("lead", [{ agentId: "lead", detail: idle }]).status,
    ).toBe("idle");
  });
});
