"use client";

import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { clientErrorMessage } from "@multica/core/api";
import { useAuthStore } from "@multica/core/auth";
import { useWorkspaceId } from "@multica/core/hooks";
import { useIssueStatuses } from "@multica/core/issue-statuses/hooks";
import { useDeleteIssueWorkflow, useIssueWorkflows } from "@multica/core/issue-workflows";
import { projectListOptions } from "@multica/core/projects/queries";
import { memberListOptions } from "@multica/core/workspace/queries";
import type { IssueWorkflow } from "@multica/core/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@multica/ui/components/ui/alert-dialog";
import { Button } from "@multica/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { StatusIcon } from "../issues/components/status-icon";
import { SettingsTab } from "../settings/components/settings-layout";
import { useT } from "../i18n";
import { useStepHandlerLabel } from "./step-handler";
import { WorkflowEditorDialog } from "./workflow-editor-dialog";

/**
 * Settings → Workflows (MUL-7420). The Default workflow heads the list: it is
 * what every project without a workflow uses, and it cannot be edited here —
 * its statuses are the library itself.
 */
export function WorkflowsTab() {
  const { t } = useT("issues");
  const wsId = useWorkspaceId();
  const { workflows, isLoaded } = useIssueWorkflows(wsId);
  const { data: projects = [] } = useQuery(projectListOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const currentUser = useAuthStore((s) => s.user);
  const role = members.find((m) => m.user_id === currentUser?.id)?.role;
  const isAdmin = role === "owner" || role === "admin";
  const deleteWorkflow = useDeleteIssueWorkflow();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<IssueWorkflow | null>(null);
  const [deleting, setDeleting] = useState<IssueWorkflow | null>(null);

  const defaultProjectCount = projects.filter((p) => !p.workflow_id).length;

  const openEditor = (workflow: IssueWorkflow | null) => {
    setEditing(workflow);
    setEditorOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteWorkflow.mutateAsync(deleting.id);
      toast.success(t(($) => $.workflows.settings.deleted));
      setDeleting(null);
    } catch (err) {
      toast.error(clientErrorMessage(err) ?? t(($) => $.workflows.settings.delete_error));
    }
  };

  return (
    <SettingsTab
      title={t(($) => $.workflows.settings.title)}
      description={t(($) => $.workflows.settings.description)}
    >
      <div className="space-y-3">
        {isAdmin && (
          <div className="flex justify-end">
            <Button className="gap-2" onClick={() => openEditor(null)}>
              <Plus className="size-4" />
              {t(($) => $.workflows.settings.new)}
            </Button>
          </div>
        )}
        <div className="divide-y divide-surface-border overflow-hidden rounded-lg border border-surface-border bg-card">
          <div className="flex items-center gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-body font-medium">{t(($) => $.workflows.default_name)}</div>
              <div className="text-caption text-muted-foreground">{t(($) => $.workflows.default_summary)}</div>
            </div>
            <span className="shrink-0 text-caption text-muted-foreground">
              {t(($) => $.workflows.settings.default_projects)} · {defaultProjectCount}
            </span>
            <span className="w-7 shrink-0" />
          </div>
          {isLoaded &&
            workflows.map((workflow) => (
              <WorkflowRow
                key={workflow.id}
                workflow={workflow}
                isAdmin={isAdmin}
                onEdit={() => openEditor(workflow)}
                onDelete={() => setDeleting(workflow)}
              />
            ))}
        </div>
      </div>

      <WorkflowEditorDialog open={editorOpen} onOpenChange={setEditorOpen} workflow={editing} />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $.workflows.settings.delete_title, { name: deleting?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && deleting.project_ids.length > 0
                ? t(($) => $.workflows.settings.delete_in_use)
                : t(($) => $.workflows.settings.delete_description)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(($) => $.workflows.editor.cancel)}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!deleting || deleting.project_ids.length > 0 || deleteWorkflow.isPending}
              onClick={() => void confirmDelete()}
            >
              {t(($) => $.workflows.settings.delete)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsTab>
  );
}

function WorkflowRow({
  workflow,
  isAdmin,
  onEdit,
  onDelete,
}: {
  workflow: IssueWorkflow;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useT("issues");
  const wsId = useWorkspaceId();
  const catalog = useIssueStatuses(wsId);
  // Project-relative handlers render generically in the settings list; the
  // project board names the concrete lead.
  const handlerLabel = useStepHandlerLabel(null);
  const chain = useMemo(() => workflow.steps, [workflow.steps]);

  return (
    <div className="flex items-start gap-4 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-body font-medium">{workflow.name}</span>
          {workflow.description && (
            <span className="truncate text-caption text-muted-foreground">{workflow.description}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
          {chain.map((step, index) => {
            const handler = handlerLabel(step);
            return (
              <Fragment key={step.status_key}>
                {index > 0 && <ChevronRight aria-hidden className="size-3 text-muted-foreground" />}
                <span className="inline-flex items-center gap-1 rounded-md bg-muted/50 px-1.5 py-0.5 text-caption">
                  <StatusIcon
                    status={step.status_key}
                    category={catalog.categoryOf(step.status_key)}
                    color={catalog.colorOf(step.status_key)}
                    icon={catalog.iconOf(step.status_key)}
                    className="h-3 w-3"
                  />
                  {catalog.labelOf(step.status_key)}
                  {handler && <span className="text-muted-foreground">· {handler}</span>}
                </span>
              </Fragment>
            );
          })}
        </div>
      </div>
      <span className="shrink-0 pt-0.5 text-caption text-muted-foreground">
        {workflow.project_ids.length > 0
          ? t(($) => $.workflows.settings.projects, { count: workflow.project_ids.length })
          : t(($) => $.workflows.settings.no_projects)}
      </span>
      {isAdmin ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-xs" aria-label={workflow.name}>
                <MoreHorizontal className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-3.5" />
              {t(($) => $.workflows.settings.edit)}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="size-3.5" />
              {t(($) => $.workflows.settings.delete)}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="w-7 shrink-0" />
      )}
    </div>
  );
}
