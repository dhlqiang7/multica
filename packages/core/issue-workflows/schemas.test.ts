// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseWithFallback } from "../api/schema";
import {
  EMPTY_ISSUE_WORKFLOW_DRY_RUN,
  EMPTY_LIST_ISSUE_WORKFLOWS_RESPONSE,
  IssueWorkflowDryRunResponseSchema,
  IssueWorkflowSchema,
  ListIssueWorkflowsResponseSchema,
} from "../api/schemas";

const baseWorkflow = {
  id: "wf-1",
  workspace_id: "ws-1",
  name: "Delivery",
  description: "",
  initial_status_key: "todo",
  steps: [
    { status_key: "todo", handler: { type: "none" }, instructions: "" },
    {
      status_key: "code_review",
      handler: { type: "agent", id: "agent-1" },
      instructions: "Review the PR.",
      next_status_key: "done",
      back_status_key: "todo",
    },
  ],
  project_ids: ["project-1"],
  created_at: "2026-09-24T00:00:00Z",
  updated_at: "2026-09-24T00:00:00Z",
};

describe("workflow schemas (MUL-7420)", () => {
  it("parses a workflow list", () => {
    const parsed = ListIssueWorkflowsResponseSchema.parse({ workflows: [baseWorkflow], total: 1 });
    expect(parsed.workflows[0]?.steps[1]?.handler).toEqual({ type: "agent", id: "agent-1" });
    expect(parsed.workflows[0]?.project_ids).toEqual(["project-1"]);
  });

  it("falls back to an empty list on a malformed response", () => {
    const parsed = parseWithFallback(
      { workflows: "nope" },
      ListIssueWorkflowsResponseSchema,
      EMPTY_LIST_ISSUE_WORKFLOWS_RESPONSE,
      { endpoint: "GET /api/issue-workflows" },
    );
    expect(parsed).toEqual(EMPTY_LIST_ISSUE_WORKFLOWS_RESPONSE);
  });

  it("degrades an unknown handler type to a manual step", () => {
    const parsed = IssueWorkflowSchema.parse({
      ...baseWorkflow,
      steps: [{ status_key: "todo", handler: { type: "robot", id: "x" } }],
    });
    expect(parsed.steps[0]?.handler.type).toBe("none");
    expect(parsed.steps[0]?.instructions).toBe("");
  });

  it("defaults the optional fields an older server may omit", () => {
    const { description: _d, project_ids: _p, ...minimal } = baseWorkflow;
    const parsed = IssueWorkflowSchema.parse({ ...minimal, steps: [{ status_key: "todo" }] });
    expect(parsed.description).toBe("");
    expect(parsed.project_ids).toEqual([]);
    expect(parsed.steps[0]?.handler.type).toBe("none");
  });

  it("falls back to an empty plan on a malformed dry run", () => {
    const parsed = parseWithFallback(
      { plan: { required: 5 } },
      IssueWorkflowDryRunResponseSchema,
      EMPTY_ISSUE_WORKFLOW_DRY_RUN,
      { endpoint: "POST /api/projects/{id}/workflow (dry run)" },
    );
    expect(parsed).toEqual(EMPTY_ISSUE_WORKFLOW_DRY_RUN);
  });
});
