"use client";

import type { ReactNode } from "react";
import { ArrowRight, Ban, Hourglass, RotateCcw, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../../i18n";
import {
  DELIVERY_STAGES,
  type DeliveryInsight,
  type DeliveryStage,
  type DeliverySummary,
} from "../delivery";

const STAGE_DOT: Record<DeliveryStage, string> = {
  in_review: "bg-chart-2",
  reworking: "bg-warning",
  in_progress: "bg-chart-4",
  blocked: "bg-destructive",
  cancelled: "bg-faint-foreground",
};

export function useStageLabel(): (stage: DeliveryStage) => string {
  const { t } = useT("usage");
  return (stage) => {
    switch (stage) {
      case "in_review":
        return t(($) => $.overview.stage.in_review);
      case "reworking":
        return t(($) => $.overview.stage.reworking);
      case "in_progress":
        return t(($) => $.overview.stage.in_progress);
      case "blocked":
        return t(($) => $.overview.stage.blocked);
      case "cancelled":
        return t(($) => $.overview.stage.cancelled);
    }
  };
}

export function AnalyticsCardHeader({
  title,
  caption,
  action,
}: {
  title: string;
  caption?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 pt-4">
      <div className="min-w-0">
        <h4 className="text-body font-semibold">{title}</h4>
        {caption ? (
          <p className="mt-0.5 text-caption text-muted-foreground">{caption}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/**
 * Picked up → delivered → done for this period's cohort, then where every
 * issue that is not done yet sits. Every count opens the issues behind it.
 */
export function FunnelCard({
  summary,
  locales,
  onOpenStage,
  onOpenBounced,
  className,
}: {
  summary: DeliverySummary;
  locales: Intl.LocalesArgument;
  onOpenStage: (stage: DeliveryStage) => void;
  onOpenBounced: () => void;
  className?: string;
}) {
  const { t } = useT("usage");
  const stageLabel = useStageLabel();
  const percent = new Intl.NumberFormat(locales, {
    style: "percent",
    maximumFractionDigits: 0,
  });
  const steps = [
    { key: "assigned", label: t(($) => $.overview.funnel_assigned), value: summary.assigned, from: null },
    {
      key: "delivered",
      label: t(($) => $.overview.funnel_delivered),
      value: summary.delivered,
      from: summary.assigned,
    },
    {
      key: "accepted",
      label: t(($) => $.overview.funnel_accepted),
      value: summary.accepted,
      from: summary.delivered,
    },
  ];
  const open = summary.assigned - summary.accepted;

  return (
    <div className={cn("flex flex-col rounded-lg border bg-card", className)}>
      <AnalyticsCardHeader
        title={t(($) => $.overview.funnel_title)}
        caption={t(($) => $.overview.funnel_caption)}
      />
      <div className="flex flex-col gap-2.5 p-4">
        {steps.map((step) => (
          <div
            key={step.key}
            className="grid grid-cols-[4.5rem_minmax(0,1fr)_6.5rem] items-center gap-3"
          >
            <span className="truncate text-label text-muted-foreground">{step.label}</span>
            <div className="relative h-7 overflow-hidden rounded-md bg-muted">
              <div
                className="flex h-full items-center rounded-md bg-chart-1 px-2.5 text-label font-semibold tabular-nums text-primary-foreground transition-[width] duration-300 ease-out"
                style={{
                  width: `${summary.assigned > 0 ? (step.value / summary.assigned) * 100 : 0}%`,
                  minWidth: step.value > 0 ? "2.5rem" : 0,
                }}
              >
                {step.value > 0 ? step.value : null}
              </div>
              {step.value === 0 ? (
                <span className="absolute inset-y-0 left-2.5 flex items-center text-label font-semibold tabular-nums text-muted-foreground">
                  0
                </span>
              ) : null}
            </div>
            <span className="flex items-baseline justify-end gap-1.5">
              {step.from === null ? (
                <span className="text-caption text-muted-foreground">
                  {t(($) => $.overview.funnel_start)}
                </span>
              ) : (
                <>
                  <span className="text-body font-semibold tabular-nums">
                    {step.from > 0 ? percent.format(step.value / step.from) : "—"}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {t(($) => $.overview.funnel_conversion)}
                  </span>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
      {open > 0 ? (
        <>
          <p className="px-4 pb-2 text-caption text-muted-foreground">
            {t(($) => $.overview.open_caption, { count: open })}
          </p>
          <div className="grid grid-cols-2 gap-2 px-4 pb-4 sm:grid-cols-5">
            {DELIVERY_STAGES.map((stage) => (
              <button
                key={stage}
                type="button"
                disabled={summary.stages[stage] === 0}
                onClick={() => onOpenStage(stage)}
                className="flex flex-col items-start gap-0.5 rounded-md border bg-surface px-2.5 py-2 text-left transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default disabled:hover:bg-surface"
              >
                <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
                  <span aria-hidden className={cn("size-2 rounded-full", STAGE_DOT[stage])} />
                  {stageLabel(stage)}
                </span>
                <span className="text-title-sm font-semibold tabular-nums">
                  {summary.stages[stage]}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}
      {summary.reworked > 0 ? (
        <button
          type="button"
          onClick={onOpenBounced}
          className="mx-4 mb-4 flex items-center gap-2 rounded-md bg-muted px-3 py-2.5 text-left text-label transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <RotateCcw aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            {t(($) => $.overview.rework_line, {
              issues: summary.reworked,
              bounces: summary.bounces,
            })}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-caption font-medium text-brand">
            {t(($) => $.overview.view)}
            <ArrowRight aria-hidden className="size-3" />
          </span>
        </button>
      ) : null}
    </div>
  );
}

const INSIGHT_VISUAL: Record<DeliveryInsight["kind"], { icon: LucideIcon; tone: string }> = {
  failure_spike: { icon: TriangleAlert, tone: "bg-destructive/10 text-destructive" },
  review_backlog: { icon: Hourglass, tone: "bg-warning/15 text-warning" },
  low_first_pass: { icon: RotateCcw, tone: "bg-info/10 text-info" },
  blocked: { icon: Ban, tone: "bg-destructive/10 text-destructive" },
};

/**
 * "Worth a look": at most three rule-based findings, each with the reason in
 * numbers and a way into the issues (or tab) behind it.
 */
export function InsightsCard({
  insights,
  agentName,
  locales,
  onOpen,
  className,
}: {
  insights: DeliveryInsight[];
  agentName: (agentId: string) => string;
  locales: Intl.LocalesArgument;
  onOpen: (insight: DeliveryInsight) => void;
  className?: string;
}) {
  const { t } = useT("usage");
  const percent = (v: number) =>
    new Intl.NumberFormat(locales, { style: "percent", maximumFractionDigits: 0 }).format(v);

  const copy = (insight: DeliveryInsight) => {
    switch (insight.kind) {
      case "failure_spike":
        return {
          title: t(($) => $.insights.failure_spike_title, {
            agent: agentName(insight.agentId),
            rate: percent(insight.rate),
          }),
          body:
            insight.previousRate === null
              ? t(($) => $.insights.failure_spike_body_new, {
                  failed: insight.failed,
                  runs: insight.runs,
                })
              : t(($) => $.insights.failure_spike_body, {
                  failed: insight.failed,
                  runs: insight.runs,
                  previous: percent(insight.previousRate),
                }),
          link: t(($) => $.insights.failure_spike_link),
        };
      case "review_backlog":
        return {
          title: t(($) => $.insights.review_backlog_title, { count: insight.count }),
          body: t(($) => $.insights.review_backlog_body, {
            inReview: insight.inReview,
            identifier: insight.oldestIdentifier,
            days: insight.oldestDays,
          }),
          link: t(($) => $.insights.review_backlog_link),
        };
      case "low_first_pass":
        return {
          title: t(($) => $.insights.low_first_pass_title, {
            agent: agentName(insight.agentId),
            rate: percent(insight.rate),
          }),
          body: t(($) => $.insights.low_first_pass_body, {
            reworked: insight.reworked,
            delivered: insight.delivered,
            team: percent(insight.teamRate),
          }),
          link: t(($) => $.insights.low_first_pass_link),
        };
      case "blocked":
        return {
          title: t(($) => $.insights.blocked_title, { count: insight.count }),
          body: t(($) => $.insights.blocked_body),
          link: t(($) => $.insights.blocked_link),
        };
    }
  };

  return (
    <div className={cn("flex flex-col rounded-lg border bg-card", className)}>
      <AnalyticsCardHeader
        title={t(($) => $.insights.title)}
        caption={t(($) => $.insights.caption)}
      />
      {insights.length === 0 ? (
        <p className="flex flex-1 items-center justify-center px-4 py-8 text-center text-caption text-muted-foreground">
          {t(($) => $.insights.empty)}
        </p>
      ) : (
        <ul className="mt-1.5 divide-y">
          {insights.map((insight) => {
            const { icon: Icon, tone } = INSIGHT_VISUAL[insight.kind];
            const text = copy(insight);
            return (
              <li key={insight.kind} className="flex gap-2.5 px-4 py-3">
                <span
                  aria-hidden
                  className={cn("flex size-7 shrink-0 items-center justify-center rounded-md", tone)}
                >
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-body font-medium">{text.title}</p>
                  <p className="mt-0.5 text-caption text-muted-foreground">{text.body}</p>
                  <button
                    type="button"
                    onClick={() => onOpen(insight)}
                    className="mt-1.5 inline-flex items-center gap-1 rounded-sm text-caption font-medium text-brand hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {text.link}
                    <ArrowRight aria-hidden className="size-3" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
