"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Flag, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { ApiError, clientErrorMessage } from "@multica/core/api";
import { useWorkspaceId } from "@multica/core/hooks";
import { useIssueStatuses } from "@multica/core/issue-statuses/hooks";
import { statusColumnKeys } from "@multica/core/issues";
import { useCreateIssueWorkflow, useUpdateIssueWorkflow } from "@multica/core/issue-workflows";
import {
  agentListOptions,
  memberListOptions,
  squadListOptions,
} from "@multica/core/workspace/queries";
import type {
  IssueWorkflow,
  IssueWorkflowHandlerType,
  IssueWorkflowMappingPlan,
  IssueWorkflowStep,
} from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { Input } from "@multica/ui/components/ui/input";
import { Label as FieldLabel } from "@multica/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select";
import { Spinner } from "@multica/ui/components/ui/spinner";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { cn } from "@multica/ui/lib/utils";
import { StatusIcon } from "../issues/components/status-icon";
import { useT } from "../i18n";
import { WorkflowMappingDialog } from "./workflow-mapping-dialog";

const HANDLER_TYPES: IssueWorkflowHandlerType[] = [
  "none",
  "agent",
  "squad",
  "member",
  "project_lead",
  "creator",
];

const NONE = "__none__";

interface Draft {
  name: string;
  description: string;
  initial: string;
  steps: IssueWorkflowStep[];
}

function draftFrom(workflow: IssueWorkflow | null): Draft {
  if (!workflow) return { name: "", description: "", initial: "", steps: [] };
  return {
    name: workflow.name,
    description: workflow.description,
    initial: workflow.initial_status_key,
    steps: workflow.steps.map((s) => ({ ...s, handler: { ...s.handler } })),
  };
}

/** A step's next/back pointers must name a step still in the workflow. */
function pruneRefs(steps: IssueWorkflowStep[]): IssueWorkflowStep[] {
  const keys = new Set(steps.map((s) => s.status_key));
  return steps.map((s) => ({
    ...s,
    next_status_key: s.next_status_key && keys.has(s.next_status_key) ? s.next_status_key : undefined,
    back_status_key: s.back_status_key && keys.has(s.back_status_key) ? s.back_status_key : undefined,
  }));
}

function mappingPlanFrom(err: unknown): IssueWorkflowMappingPlan | null {
  if (!(err instanceof ApiError) || err.status !== 409 || !err.body || typeof err.body !== "object") return null;
  const body = err.body as { code?: unknown; plan?: IssueWorkflowMappingPlan };
  return body.code === "workflow_status_mapping_required" && body.plan ? body.plan : null;
}

/**
 * Creates or edits a workflow (MUL-7420): pick statuses from the library, order
 * them, mark the starting step, and configure each step's handoff. Saving an
 * edit that removes a status issues still use asks where they go first.
 */
export function WorkflowEditorDialog({
  open,
  onOpenChange,
  workflow,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null creates a new workflow. */
  workflow: IssueWorkflow | null;
}) {
  const { t } = useT("issues");
  const wsId = useWorkspaceId();
  const catalog = useIssueStatuses(wsId);
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: squads = [] } = useQuery(squadListOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const createWorkflow = useCreateIssueWorkflow();
  const updateWorkflow = useUpdateIssueWorkflow();

  const [draft, setDraft] = useState<Draft>(() => draftFrom(workflow));
  const [selected, setSelected] = useState<string | null>(null);
  const [mappingPlan, setMappingPlan] = useState<IssueWorkflowMappingPlan | null>(null);

  useEffect(() => {
    if (!open) return;
    const next = draftFrom(workflow);
    setDraft(next);
    setSelected(next.steps[0]?.status_key ?? null);
    setMappingPlan(null);
  }, [open, workflow]);

  const pending = createWorkflow.isPending || updateWorkflow.isPending;
  const stepKeys = draft.steps.map((s) => s.status_key);
  const addable = useMemo(
    () => statusColumnKeys(catalog).filter((key) => !stepKeys.includes(key)),
    [catalog, stepKeys],
  );
  const selectedStep = draft.steps.find((s) => s.status_key === selected);
  const canSave = draft.name.trim().length > 0 && draft.steps.length > 0 && !pending;

  const setSteps = (update: (steps: IssueWorkflowStep[]) => IssueWorkflowStep[]) =>
    setDraft((current) => {
      const steps = pruneRefs(update(current.steps));
      const initial = steps.some((s) => s.status_key === current.initial)
        ? current.initial
        : steps[0]?.status_key ?? "";
      return { ...current, steps, initial };
    });

  const patchStep = (key: string, patch: Partial<IssueWorkflowStep>) =>
    setSteps((steps) => steps.map((s) => (s.status_key === key ? { ...s, ...patch } : s)));

  const move = (index: number, delta: number) =>
    setSteps((steps) => {
      const target = index + delta;
      if (target < 0 || target >= steps.length) return steps;
      const next = [...steps];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item!);
      return next;
    });

  const save = async (mapping?: Record<string, string>) => {
    const body = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      initial_status_key: draft.initial,
      steps: draft.steps,
      ...(mapping ? { status_mapping: mapping } : {}),
    };
    try {
      if (workflow) {
        await updateWorkflow.mutateAsync({ id: workflow.id, ...body });
        toast.success(t(($) => $.workflows.editor.saved));
      } else {
        await createWorkflow.mutateAsync(body);
        toast.success(t(($) => $.workflows.editor.created));
      }
      setMappingPlan(null);
      onOpenChange(false);
    } catch (err) {
      const plan = mappingPlanFrom(err);
      if (plan) {
        setMappingPlan(plan);
        return;
      }
      toast.error(clientErrorMessage(err) ?? t(($) => $.workflows.editor.error));
    }
  };

  const targetOptions = (type: IssueWorkflowHandlerType) => {
    if (type === "agent") return agents.filter((a) => !a.archived_at).map((a) => ({ value: a.id, label: a.name }));
    if (type === "squad") return squads.map((s) => ({ value: s.id, label: s.name }));
    if (type === "member") return members.map((m) => ({ value: m.user_id, label: m.name }));
    return [];
  };

  const stepLabel = (key: string) => catalog.labelOf(key);
  const stepRefItems = [
    { value: NONE, label: t(($) => $.workflows.editor.none_option) },
    ...draft.steps
      .filter((s) => s.status_key !== selected)
      .map((s) => ({ value: s.status_key, label: stepLabel(s.status_key) })),
  ];
  const handlerItems = HANDLER_TYPES.map((type) => ({ value: type, label: t(($) => $.workflows.handler[type]) }));

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {workflow ? t(($) => $.workflows.editor.edit_title) : t(($) => $.workflows.editor.create_title)}
            </DialogTitle>
            <DialogDescription>{t(($) => $.workflows.settings.description)}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2">
              <FieldLabel htmlFor="workflow-name">{t(($) => $.workflows.editor.name)}</FieldLabel>
              <Input
                id="workflow-name"
                maxLength={64}
                value={draft.name}
                placeholder={t(($) => $.workflows.editor.name_placeholder)}
                onChange={(e) => setDraft((c) => ({ ...c, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <FieldLabel htmlFor="workflow-description">{t(($) => $.workflows.editor.description)}</FieldLabel>
              <Input
                id="workflow-description"
                maxLength={256}
                value={draft.description}
                onChange={(e) => setDraft((c) => ({ ...c, description: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid min-h-72 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-caption font-medium text-muted-foreground">
                  {t(($) => $.workflows.editor.steps)}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    disabled={addable.length === 0}
                    render={
                      <Button type="button" variant="ghost" size="xs" className="gap-1">
                        <Plus className="size-3.5" />
                        {t(($) => $.workflows.editor.add_step)}
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end" className="max-h-72 w-52 overflow-y-auto">
                    {addable.map((key) => (
                      <DropdownMenuItem
                        key={key}
                        onClick={() => {
                          setSteps((steps) => [
                            ...steps,
                            { status_key: key, handler: { type: "none" }, instructions: "" },
                          ]);
                          setSelected(key);
                        }}
                      >
                        <StatusIcon
                          status={key}
                          category={catalog.categoryOf(key)}
                          color={catalog.colorOf(key)}
                          icon={catalog.iconOf(key)}
                          className="h-3.5 w-3.5"
                        />
                        <span className="truncate">{stepLabel(key)}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <ol className="space-y-1 rounded-lg border border-surface-border p-1">
                {draft.steps.map((step, index) => (
                  <li key={step.status_key}>
                    <div
                      className={cn(
                        "group flex items-center gap-2 rounded-md px-2 py-1.5",
                        step.status_key === selected ? "bg-surface-selected text-surface-selected-foreground" : "hover:bg-accent/60",
                      )}
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        onClick={() => setSelected(step.status_key)}
                        aria-pressed={step.status_key === selected}
                      >
                        <StatusIcon
                          status={step.status_key}
                          category={catalog.categoryOf(step.status_key)}
                          color={catalog.colorOf(step.status_key)}
                          icon={catalog.iconOf(step.status_key)}
                          className="h-3.5 w-3.5 shrink-0"
                        />
                        <span className="truncate text-body">{stepLabel(step.status_key)}</span>
                        {draft.initial === step.status_key && (
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-micro text-muted-foreground">
                            {t(($) => $.workflows.editor.start)}
                          </span>
                        )}
                        {step.handler.type !== "none" && (
                          <span className="ml-auto shrink-0 text-micro text-muted-foreground">
                            {t(($) => $.workflows.handler[step.handler.type])}
                          </span>
                        )}
                      </button>
                      <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <Button type="button" variant="ghost" size="icon-xs" aria-label={t(($) => $.workflows.editor.move_up)} disabled={index === 0} onClick={() => move(index, -1)}>
                          <ArrowUp className="size-3.5" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon-xs" aria-label={t(($) => $.workflows.editor.move_down)} disabled={index === draft.steps.length - 1} onClick={() => move(index, 1)}>
                          <ArrowDown className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={t(($) => $.workflows.editor.remove)}
                          onClick={() => {
                            setSteps((steps) => steps.filter((s) => s.status_key !== step.status_key));
                            if (selected === step.status_key) setSelected(null);
                          }}
                        >
                          <X className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="min-w-0 space-y-4 rounded-lg bg-muted/30 p-3">
              {selectedStep ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-body font-medium">{stepLabel(selectedStep.status_key)}</span>
                    {draft.initial !== selectedStep.status_key && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="gap-1"
                        onClick={() => setDraft((c) => ({ ...c, initial: selectedStep.status_key }))}
                      >
                        <Flag className="size-3.5" />
                        {t(($) => $.workflows.editor.set_start)}
                      </Button>
                    )}
                  </div>
                  <div className="space-y-2">
                    <FieldLabel>{t(($) => $.workflows.editor.on_enter)}</FieldLabel>
                    <div className="flex gap-2">
                      <Select
                        items={handlerItems}
                        value={selectedStep.handler.type}
                        onValueChange={(value) =>
                          value &&
                          patchStep(selectedStep.status_key, {
                            handler: { type: value as IssueWorkflowHandlerType },
                          })
                        }
                      >
                        <SelectTrigger className="w-40 shrink-0" aria-label={t(($) => $.workflows.editor.on_enter)}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {handlerItems.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {(selectedStep.handler.type === "agent" ||
                        selectedStep.handler.type === "squad" ||
                        selectedStep.handler.type === "member") && (
                        <Select
                          items={targetOptions(selectedStep.handler.type)}
                          value={selectedStep.handler.id ?? ""}
                          onValueChange={(value) =>
                            value &&
                            patchStep(selectedStep.status_key, {
                              handler: { type: selectedStep.handler.type, id: value },
                            })
                          }
                        >
                          <SelectTrigger className="min-w-0 flex-1" aria-label={t(($) => $.workflows.handler[selectedStep.handler.type])}>
                            <SelectValue placeholder={t(($) => $.workflows.editor.choose_target)} />
                          </SelectTrigger>
                          <SelectContent>
                            {targetOptions(selectedStep.handler.type).map((item) => (
                              <SelectItem key={item.value} value={item.value}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                  {selectedStep.handler.type !== "none" && (
                    <div className="space-y-2">
                      <FieldLabel htmlFor="workflow-step-instructions">
                        {t(($) => $.workflows.editor.instructions)}
                      </FieldLabel>
                      <Textarea
                        id="workflow-step-instructions"
                        rows={4}
                        maxLength={8000}
                        value={selectedStep.instructions}
                        placeholder={t(($) => $.workflows.editor.instructions_placeholder)}
                        onChange={(e) => patchStep(selectedStep.status_key, { instructions: e.target.value })}
                      />
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(["next", "back"] as const).map((kind) => {
                      const field = kind === "next" ? "next_status_key" : "back_status_key";
                      return (
                        <div key={kind} className="space-y-2">
                          <FieldLabel>{t(($) => $.workflows.editor[kind])}</FieldLabel>
                          <Select
                            items={stepRefItems}
                            value={selectedStep[field] ?? NONE}
                            onValueChange={(value) =>
                              patchStep(selectedStep.status_key, {
                                [field]: !value || value === NONE ? undefined : value,
                              })
                            }
                          >
                            <SelectTrigger aria-label={t(($) => $.workflows.editor[kind])}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {stepRefItems.map((item) => (
                                <SelectItem key={item.value} value={item.value}>
                                  {item.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              {t(($) => $.workflows.editor.cancel)}
            </Button>
            <Button onClick={() => void save()} disabled={!canSave} aria-busy={pending}>
              {pending && <Spinner className="size-3.5" />}
              {workflow ? t(($) => $.workflows.editor.save) : t(($) => $.workflows.editor.create)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <WorkflowMappingDialog
        open={mappingPlan !== null}
        onOpenChange={(v) => !v && setMappingPlan(null)}
        workflowName={draft.name.trim()}
        plan={mappingPlan}
        targetKeys={stepKeys}
        confirmLabel={t(($) => $.workflows.mapping.confirm_save)}
        pending={pending}
        onConfirm={(mapping) => void save(mapping)}
      />
    </>
  );
}
