import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";
import type { IssueWorkflow, IssueWorkflowStep, Project } from "../types";

/**
 * Workspace workflows (MUL-7420).
 *
 * A project either names a workflow or uses the implicit Default workflow:
 * every active catalog status, no handoffs. Every helper here returns null
 * for Default so callers keep their pre-workflow behavior unchanged.
 */

export const issueWorkflowKeys = {
  all: (wsId: string) => ["issue-workflows", wsId] as const,
  list: (wsId: string) => [...issueWorkflowKeys.all(wsId), "list"] as const,
};

export function issueWorkflowListOptions(wsId: string) {
  return queryOptions({
    queryKey: issueWorkflowKeys.list(wsId),
    queryFn: () => api.listIssueWorkflows(),
    select: (data) => data.workflows,
    // Workflows change only when an admin edits one; the
    // `issue_workflow:changed` event refreshes every client when that happens.
    staleTime: 5 * 60_000,
  });
}

/** The workflow a project uses, or null for the Default workflow. */
export function resolveProjectWorkflow(
  workflows: readonly IssueWorkflow[] | undefined,
  project: Pick<Project, "workflow_id"> | null | undefined,
): IssueWorkflow | null {
  const id = project?.workflow_id;
  if (!id || !workflows) return null;
  return workflows.find((w) => w.id === id) ?? null;
}

export function workflowStep(
  workflow: IssueWorkflow | null | undefined,
  statusKey: string,
): IssueWorkflowStep | undefined {
  return workflow?.steps.find((s) => s.status_key === statusKey);
}

/** Whether entering the step reassigns the issue. */
export function stepHandsOff(step: IssueWorkflowStep | undefined): boolean {
  return !!step && step.handler.type !== "none";
}

/** Whether a status is allowed for issues of a project using `workflow`. */
export function workflowAllowsStatus(
  workflow: IssueWorkflow | null | undefined,
  statusKey: string,
): boolean {
  if (!workflow) return true;
  return workflow.steps.some((s) => s.status_key === statusKey);
}
