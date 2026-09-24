"use client";

import { createContext, useContext } from "react";
import type { IssueStatus, IssueWorkflow, Project } from "@multica/core/types";

/**
 * Workflow facts a board column needs (MUL-7420), provided once by BoardView
 * so every column variant can read them without threading props.
 */
export interface BoardWorkflowContextValue {
  /** Workflow of the project this board is scoped to; heads name each step's handler. */
  scopeWorkflow: IssueWorkflow | null;
  scopeProject: Project | null;
  /**
   * While a card is dragged, why it cannot be dropped on a status column —
   * its project's workflow does not list the status — or null when it can.
   */
  dropBlockedReason: (status: IssueStatus) => string | null;
}

const NO_WORKFLOW: BoardWorkflowContextValue = {
  scopeWorkflow: null,
  scopeProject: null,
  dropBlockedReason: () => null,
};

export const BoardWorkflowContext = createContext<BoardWorkflowContextValue>(NO_WORKFLOW);

export function useBoardWorkflow(): BoardWorkflowContextValue {
  return useContext(BoardWorkflowContext);
}
