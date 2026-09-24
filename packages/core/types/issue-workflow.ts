/**
 * Workspace workflows (MUL-7420).
 *
 * A workflow picks and orders statuses from the shared status catalog. Each
 * step can hand the issue off: entering the step through a status change
 * assigns the issue to the step's handler and, for an agent or squad, starts
 * its run with the step's instructions. A project without a workflow uses the
 * implicit Default workflow — every active status, no handoffs.
 */

export type IssueWorkflowHandlerType =
  | "none"
  | "agent"
  | "squad"
  | "member"
  | "project_lead"
  | "creator";

export interface IssueWorkflowHandler {
  type: IssueWorkflowHandlerType;
  /** Set only for agent, squad and member handlers. */
  id?: string;
}

export interface IssueWorkflowStep {
  status_key: string;
  handler: IssueWorkflowHandler;
  instructions: string;
  /** Suggested status once the step is done; named in the handler's brief. */
  next_status_key?: string;
  /** Status to send the issue back to when it needs changes. */
  back_status_key?: string;
}

export interface IssueWorkflow {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  initial_status_key: string;
  steps: IssueWorkflowStep[];
  /** Projects currently using this workflow. */
  project_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface ListIssueWorkflowsResponse {
  workflows: IssueWorkflow[];
  total: number;
}

export interface IssueWorkflowWriteRequest {
  name?: string;
  description?: string;
  initial_status_key?: string;
  steps?: IssueWorkflowStep[];
  /** Destination for issues on statuses an edit removes, keyed by removed status. */
  status_mapping?: Record<string, string>;
  dry_run?: boolean;
}

/** A status some issues are on that the target workflow does not list. */
export interface IssueWorkflowMappingRequirement {
  status_key: string;
  issue_count: number;
  suggested_status_key: string;
}

export interface IssueWorkflowMappingPlan {
  required: IssueWorkflowMappingRequirement[];
  total_issues: number;
  affected_issues: number;
}

export interface SetProjectWorkflowRequest {
  /** null switches the project back to the Default workflow. */
  workflow_id: string | null;
  status_mapping?: Record<string, string>;
  dry_run?: boolean;
}

export interface IssueWorkflowDryRunResponse {
  dry_run: true;
  plan: IssueWorkflowMappingPlan;
}
