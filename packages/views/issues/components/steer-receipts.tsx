"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Check, CornerDownRight, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { taskMessagesOptions } from "@multica/core/chat/queries";
import { useCreateComment, useRetryTaskSupplement } from "@multica/core/issues/mutations";
import { issueTasksOptions } from "@multica/core/issues/queries";
import { commentSupplementReceipts, isSupplementInFlight } from "@multica/core/issues/run-steering";
import type { AgentTask, CommentSupplementReceipt, TimelineEntry } from "@multica/core/types";
import { useActorName } from "@multica/core/workspace/hooks";
import { Button } from "@multica/ui/components/ui/button";
import { buildSteps, type TraceStep } from "../../common/task-transcript/build-steps";
import { buildTimeline } from "../../common/task-transcript/build-timeline";
import { useLocale, useT } from "../../i18n";

const TERMINAL = new Set<AgentTask["status"]>(["completed", "failed", "cancelled"]);

/** How many of a turn's steps had started when a message reached it. */
export function stepsBeforeDelivery(steps: readonly TraceStep[], deliveredAt: string | undefined): number | null {
  const at = deliveredAt ? Date.parse(deliveredAt) : Number.NaN;
  if (!Number.isFinite(at)) return null;
  let count = 0;
  for (const step of steps) {
    const started = step.startedAt ? Date.parse(step.startedAt) : Number.NaN;
    if (Number.isFinite(started) && started <= at) count++;
  }
  return count;
}

function useReceiptAgentName(issueId: string, receipt: CommentSupplementReceipt) {
  const { getActorName } = useActorName();
  // Servers that predate multi-run receipts omit the agent; the run knows it.
  const { data: task } = useQuery({
    ...issueTasksOptions(issueId),
    enabled: !!issueId,
    select: (tasks) => tasks.find((candidate) => candidate.id === receipt.task_id),
  });
  const agentId = receipt.agent_id || task?.agent_id;
  return { name: agentId ? getActorName("agent", agentId) : "", task };
}

/** "Added to Lambda's run": marks a message that steered a running turn. */
export function SteerBadge({ issueId, entry }: { issueId: string; entry: TimelineEntry }) {
  const { t } = useT("issues");
  const locale = useLocale();
  const receipts = commentSupplementReceipts(entry);
  const { getActorName } = useActorName();
  if (receipts.length === 0) return null;
  // Every receipt from a current server names its agent; the legacy single
  // receipt resolves the name from its run instead.
  const names = receipts.every((receipt) => receipt.agent_id)
    ? new Intl.ListFormat(locale, { type: "conjunction" }).format(receipts.map((receipt) => getActorName("agent", receipt.agent_id!)))
    : null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-caption text-muted-foreground">
      <CornerDownRight aria-hidden className="size-3 shrink-0" />
      <span className="truncate">
        {names !== null
          ? t(($) => $.inline_run.steer_badge, { names })
          : <BadgeLegacyName issueId={issueId} receipt={receipts[0]!} />}
      </span>
    </span>
  );
}

function BadgeLegacyName({ issueId, receipt }: { issueId: string; receipt: CommentSupplementReceipt }) {
  const { t } = useT("issues");
  const { name } = useReceiptAgentName(issueId, receipt);
  return <>{t(($) => $.inline_run.steer_badge, { names: name })}</>;
}

/** One line per running turn the message steered, following its delivery. */
export function SteerReceipts({ issueId, entry }: { issueId: string; entry: TimelineEntry }) {
  const receipts = commentSupplementReceipts(entry);
  if (receipts.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-1">
      {receipts.map((receipt) => (
        <SteerReceipt key={receipt.task_id} issueId={issueId} entry={entry} receipt={receipt} />
      ))}
    </div>
  );
}

function SteerReceipt({ issueId, entry, receipt }: {
  issueId: string;
  entry: TimelineEntry;
  receipt: CommentSupplementReceipt;
}) {
  const { t } = useT("issues");
  const { name, task } = useReceiptAgentName(issueId, receipt);
  const retry = useRetryTaskSupplement(issueId);
  const resend = useCreateComment(issueId);
  const [resent, setResent] = useState(false);
  // Count steps only from a transcript the run already loaded; a receipt
  // never fetches a whole log just to number it.
  // (No `select`: this cache's structural sharing merges message lists.)
  const { data: messages } = useQuery({ ...taskMessagesOptions(receipt.task_id), enabled: false });
  const step = useMemo(
    () => (messages && receipt.status === "delivered"
      ? stepsBeforeDelivery(buildSteps(buildTimeline(messages)), receipt.delivered_at)
      : null),
    [messages, receipt.status, receipt.delivered_at],
  );
  const terminal = !!task && TERMINAL.has(task.status);
  const inFlight = isSupplementInFlight(receipt);

  if (inFlight && !terminal) {
    return (
      <p role="status" className="flex items-center gap-1.5 text-caption text-muted-foreground">
        <Loader2 aria-hidden className="size-3.5 shrink-0 motion-safe:animate-spin" />
        <span>{t(($) => $.inline_run.steer_waiting, { name })}</span>
      </p>
    );
  }
  if (receipt.status === "delivered") {
    return (
      <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
        <Check aria-hidden className="size-3.5 shrink-0 text-success" />
        <span>
          {step
            ? t(($) => $.inline_run.steer_read_after_step, { name, step })
            : t(($) => $.inline_run.steer_read, { name })}
        </span>
      </p>
    );
  }

  // A run that ended before delivery settles the receipt as turn_ended; the
  // task status can show it before the receipt update arrives.
  const reasonCode = inFlight ? "turn_ended" : receipt.failure_reason;
  const reason = reasonCode === "turn_ended"
    ? t(($) => $.inline_run.supplement_failure_turn_ended)
    : reasonCode === "turn_not_started"
      ? t(($) => $.inline_run.supplement_failure_turn_not_started)
      : reasonCode === "provider_rejected"
        ? t(($) => $.inline_run.supplement_failure_provider_rejected)
        : reasonCode === "timeout"
          ? t(($) => $.inline_run.supplement_failure_timeout)
          : t(($) => $.inline_run.supplement_failure_unknown);
  const canRetry = !terminal && reasonCode !== "turn_ended";
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-destructive">
      <span className="inline-flex items-center gap-1.5">
        <AlertCircle aria-hidden className="size-3.5 shrink-0" />
        {t(($) => $.inline_run.steer_not_received, { name, reason })}
      </span>
      {canRetry && (
        <Button type="button" size="xs" variant="outline" className="text-foreground" disabled={retry.isPending}
          onClick={() => retry.mutate({ taskId: receipt.task_id, commentId: entry.id }, {
            onError: () => toast.error(t(($) => $.inline_run.supplement_retry_failed)),
          })}>
          {retry.isPending ? <Loader2 className="size-3 motion-safe:animate-spin" /> : <RotateCcw className="size-3" />}
          {t(($) => $.inline_run.supplement_retry)}
        </Button>
      )}
      {!resent && (
        <Button type="button" size="xs" variant="outline" className="text-foreground" disabled={resend.isPending}
          onClick={() => resend.mutate({ content: entry.content ?? "", parentId: entry.parent_id ?? undefined }, {
            onSuccess: () => setResent(true),
            onError: () => toast.error(t(($) => $.inline_run.steer_resend_failed)),
          })}>
          {resend.isPending ? <Loader2 className="size-3 motion-safe:animate-spin" /> : <CornerDownRight className="size-3" />}
          {t(($) => $.inline_run.steer_resend)}
        </Button>
      )}
    </div>
  );
}
