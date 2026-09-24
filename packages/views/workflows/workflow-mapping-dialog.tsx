"use client";

import { useEffect, useState } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select";
import { Spinner } from "@multica/ui/components/ui/spinner";
import { useWorkspaceId } from "@multica/core/hooks";
import { useIssueStatuses } from "@multica/core/issue-statuses/hooks";
import type { IssueWorkflowMappingPlan } from "@multica/core/types";
import { StatusIcon } from "../issues/components/status-icon";
import { useT } from "../i18n";

/**
 * Asks where issues on statuses a workflow does not list should go (MUL-7420).
 * Used for switching a project's workflow and for removing steps from a
 * workflow in use. Only the listed statuses move; every other issue stays.
 */
export function WorkflowMappingDialog({
  open,
  onOpenChange,
  workflowName,
  plan,
  targetKeys,
  confirmLabel,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowName: string;
  plan: IssueWorkflowMappingPlan | null;
  /** Statuses the issues may move to, in display order. */
  targetKeys: string[];
  confirmLabel: string;
  pending: boolean;
  onConfirm: (mapping: Record<string, string>) => void;
}) {
  const { t } = useT("issues");
  const wsId = useWorkspaceId();
  const { labelOf, categoryOf, colorOf, iconOf } = useIssueStatuses(wsId);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!plan) return;
    setMapping(
      Object.fromEntries(
        plan.required.map((r) => [
          r.status_key,
          targetKeys.includes(r.suggested_status_key) ? r.suggested_status_key : targetKeys[0] ?? "",
        ]),
      ),
    );
  }, [plan, targetKeys]);

  const complete = !!plan && plan.required.every((r) => !!mapping[r.status_key]);
  const items = targetKeys.map((key) => ({ value: key, label: labelOf(key) }));

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(($) => $.workflows.mapping.title, { name: workflowName })}</DialogTitle>
          <DialogDescription>{t(($) => $.workflows.mapping.description)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          {plan?.required.map((req) => (
            <div key={req.status_key} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <StatusIcon
                  status={req.status_key}
                  category={categoryOf(req.status_key)}
                  color={colorOf(req.status_key)}
                  icon={iconOf(req.status_key)}
                  className="h-3.5 w-3.5 shrink-0"
                />
                <span className="truncate text-body">{labelOf(req.status_key)}</span>
                <span className="shrink-0 text-caption text-muted-foreground tabular-nums">
                  {t(($) => $.workflows.mapping.issues, { count: req.issue_count })}
                </span>
              </div>
              <span aria-hidden className="text-muted-foreground">→</span>
              <Select
                items={items}
                value={mapping[req.status_key] ?? ""}
                onValueChange={(value) =>
                  value && setMapping((current) => ({ ...current, [req.status_key]: value }))
                }
              >
                <SelectTrigger aria-label={labelOf(req.status_key)}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {items.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
          <p className="pt-2 text-caption text-muted-foreground">{t(($) => $.workflows.mapping.no_handoff)}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t(($) => $.workflows.mapping.cancel)}
          </Button>
          <Button onClick={() => onConfirm(mapping)} disabled={!complete || pending} aria-busy={pending}>
            {pending && <Spinner className="size-3.5" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
