"use client";

import { useState } from "react";
import { Check, Workflow } from "lucide-react";
import { toast } from "sonner";
import { api, clientErrorMessage } from "@multica/core/api";
import { useFeatureEnabled } from "@multica/core/config";
import { PROJECT_WORKFLOWS_V1_FLAG } from "@multica/core/feature-flags";
import { useWorkspaceId } from "@multica/core/hooks";
import { useIssueStatuses } from "@multica/core/issue-statuses/hooks";
import { statusColumnKeys } from "@multica/core/issues";
import { useIssueWorkflows, useSetProjectWorkflow } from "@multica/core/issue-workflows";
import type { IssueWorkflowMappingPlan, Project } from "@multica/core/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { useT } from "../i18n";
import { WorkflowMappingDialog } from "./workflow-mapping-dialog";

interface PendingSwitch {
  workflowId: string | null;
  name: string;
  plan: IssueWorkflowMappingPlan;
  targetKeys: string[];
}

/**
 * The project's Workflow property (MUL-7420). Switching asks the server which
 * issues sit on statuses the new workflow does not list; when none do, the
 * switch applies directly, otherwise the mapping dialog collects destinations.
 * Adopting a workflow is behind project_workflows_v1; switching back to the
 * Default workflow always stays available.
 */
export function ProjectWorkflowControl({ project }: { project: Project }) {
  const { t } = useT("issues");
  const wsId = useWorkspaceId();
  const enabled = useFeatureEnabled(PROJECT_WORKFLOWS_V1_FLAG, false);
  const { workflows } = useIssueWorkflows(wsId);
  const catalog = useIssueStatuses(wsId);
  const setWorkflow = useSetProjectWorkflow();
  const [pending, setPending] = useState<PendingSwitch | null>(null);
  const [checking, setChecking] = useState(false);

  const current = workflows.find((w) => w.id === project.workflow_id) ?? null;
  const currentName = current?.name ?? t(($) => $.workflows.default_name);

  const apply = async (workflowId: string | null, mapping?: Record<string, string>) => {
    try {
      await setWorkflow.mutateAsync({ projectId: project.id, workflow_id: workflowId, status_mapping: mapping });
      toast.success(t(($) => $.workflows.project.switched));
      setPending(null);
    } catch (err) {
      toast.error(clientErrorMessage(err) ?? t(($) => $.workflows.project.error));
    }
  };

  const choose = async (workflowId: string | null) => {
    if (workflowId === (project.workflow_id ?? null)) return;
    setChecking(true);
    try {
      const { plan } = await api.dryRunProjectWorkflow(project.id, workflowId);
      if (plan.required.length === 0) {
        await apply(workflowId);
        return;
      }
      const target = workflows.find((w) => w.id === workflowId) ?? null;
      setPending({
        workflowId,
        name: target?.name ?? t(($) => $.workflows.default_name),
        plan,
        targetKeys: target ? target.steps.map((s) => s.status_key) : statusColumnKeys(catalog),
      });
    } catch (err) {
      toast.error(clientErrorMessage(err) ?? t(($) => $.workflows.project.error));
    } finally {
      setChecking(false);
    }
  };

  // Without the flag a Default project has nothing to choose, so the row stays
  // out of the way entirely.
  if (!enabled && !project.workflow_id) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={checking || setWorkflow.isPending}
          render={
            <button type="button" className="inline-flex min-w-0 items-center gap-1.5 text-caption hover:text-foreground transition-colors">
              <Workflow className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{currentName}</span>
            </button>
          }
        />
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem onClick={() => void choose(null)}>
            <span className="truncate">{t(($) => $.workflows.default_name)}</span>
            {!project.workflow_id && <Check className="ml-auto h-3.5 w-3.5" />}
          </DropdownMenuItem>
          {enabled && workflows.length > 0 && <DropdownMenuSeparator />}
          {(enabled ? workflows : current ? [current] : []).map((w) => (
            <DropdownMenuItem key={w.id} onClick={() => void choose(w.id)}>
              <span className="truncate">{w.name}</span>
              {w.id === project.workflow_id && <Check className="ml-auto h-3.5 w-3.5" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <WorkflowMappingDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        workflowName={pending?.name ?? ""}
        plan={pending?.plan ?? null}
        targetKeys={pending?.targetKeys ?? []}
        confirmLabel={t(($) => $.workflows.mapping.confirm)}
        pending={setWorkflow.isPending}
        onConfirm={(mapping) => pending && void apply(pending.workflowId, mapping)}
      />
    </>
  );
}
