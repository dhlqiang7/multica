// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { IssueWorkflow } from "../types";
import { resolveProjectWorkflow, stepHandsOff, workflowAllowsStatus, workflowStep } from "./queries";

const workflow: IssueWorkflow = {
  id: "wf-1",
  workspace_id: "ws-1",
  name: "Delivery",
  description: "",
  initial_status_key: "todo",
  steps: [
    { status_key: "todo", handler: { type: "none" }, instructions: "" },
    { status_key: "in_review", handler: { type: "project_lead" }, instructions: "" },
  ],
  project_ids: [],
  created_at: "",
  updated_at: "",
};

describe("workflow helpers (MUL-7420)", () => {
  it("resolves a project's workflow and treats everything else as Default", () => {
    expect(resolveProjectWorkflow([workflow], { workflow_id: "wf-1" })).toBe(workflow);
    expect(resolveProjectWorkflow([workflow], { workflow_id: null })).toBeNull();
    expect(resolveProjectWorkflow([workflow], undefined)).toBeNull();
    // A dangling reference renders as Default, like the server treats it.
    expect(resolveProjectWorkflow([workflow], { workflow_id: "gone" })).toBeNull();
    expect(resolveProjectWorkflow(undefined, { workflow_id: "wf-1" })).toBeNull();
  });

  it("allows any status under Default and only listed ones under a workflow", () => {
    expect(workflowAllowsStatus(null, "blocked")).toBe(true);
    expect(workflowAllowsStatus(workflow, "todo")).toBe(true);
    expect(workflowAllowsStatus(workflow, "blocked")).toBe(false);
  });

  it("reports which steps hand off", () => {
    expect(stepHandsOff(workflowStep(workflow, "in_review"))).toBe(true);
    expect(stepHandsOff(workflowStep(workflow, "todo"))).toBe(false);
    expect(stepHandsOff(workflowStep(workflow, "missing"))).toBe(false);
  });
});
