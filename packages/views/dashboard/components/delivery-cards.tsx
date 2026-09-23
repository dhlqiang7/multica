"use client";

import { useMemo, useState } from "react";
import { Bot, UserRoundCheck, Zap, Users, type LucideIcon } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { DashboardDeliveryIssue, DashboardDeliverySource } from "@multica/core/types";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@multica/ui/components/ui/chart";
import { cn } from "@multica/ui/lib/utils";
import { ActorAvatar } from "../../common/actor-avatar";
import { useT } from "../../i18n";
import { formatShortDate } from "../../runtimes/utils";
import {
  bucketDeliveries,
  type AgentDeliveryRow,
  type DeliverySummary,
  type SourceRow,
} from "../delivery";
import { DELETED_AGENTS_ROW_ID, formatDuration, RESTRICTED_AGENTS_ROW_ID } from "../utils";
import type { Dim } from "./dashboard-shared";
import { DimSegmented } from "./dim-segmented";
import { AnalyticsCardHeader } from "./overview-cards";

/**
 * Deliveries over time, split into those that passed review first time and
 * those that needed rework — so a rising bar that is mostly rework reads as
 * more churn, not more output.
 */
export function DeliveredChartCard({
  issues,
  summary,
  tz,
  firstDay,
  lastDay,
  allowedDims,
  className,
}: {
  issues: readonly DashboardDeliveryIssue[];
  summary: DeliverySummary;
  tz: string;
  firstDay: string;
  lastDay: string;
  allowedDims: readonly Dim[];
  className?: string;
}) {
  const { t } = useT("usage");
  const [dim, setDim] = useState<Dim>("daily");
  const effectiveDim: Dim = allowedDims.includes(dim) ? dim : allowedDims[0]!;
  const config = useMemo(
    () =>
      ({
        firstPass: { label: t(($) => $.delivery.series_first_pass), color: "var(--chart-1)" },
        reworked: { label: t(($) => $.delivery.series_reworked), color: "var(--chart-3)" },
      }) satisfies ChartConfig,
    [t],
  );
  const data = useMemo(
    () =>
      bucketDeliveries(issues, tz, firstDay, lastDay, effectiveDim).map((b) => ({
        ...b,
        label: formatShortDate(b.start),
      })),
    [issues, tz, firstDay, lastDay, effectiveDim],
  );

  return (
    <div className={cn("flex flex-col rounded-lg border bg-card", className)}>
      <AnalyticsCardHeader
        title={
          effectiveDim === "weekly"
            ? t(($) => $.delivery.chart_title_weekly)
            : t(($) => $.delivery.chart_title_daily)
        }
        caption={t(($) => $.delivery.chart_caption, {
          firstPass: summary.firstPass,
          reworked: summary.reworked,
        })}
        action={
          <DimSegmented allowedDims={allowedDims} value={effectiveDim} onChange={setDim} />
        }
      />
      <div className="p-4">
        <ChartContainer config={config} className="aspect-[3/1] w-full">
          <BarChart data={data} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              interval="preserveStartEnd"
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              allowDecimals={false}
              width="auto"
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="firstPass" stackId="delivered" fill="var(--color-firstPass)" />
            <Bar
              dataKey="reworked"
              stackId="delivered"
              fill="var(--color-reworked)"
              radius={[3, 3, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
      </div>
    </div>
  );
}

const SOURCE_ICON: Record<DashboardDeliverySource, LucideIcon> = {
  member: UserRoundCheck,
  autopilot: Zap,
  agent: Bot,
};

export function SourcesCard({
  rows,
  locales,
  className,
}: {
  rows: SourceRow[];
  locales: Intl.LocalesArgument;
  className?: string;
}) {
  const { t } = useT("usage");
  const total = rows.reduce((sum, r) => sum + r.assigned, 0);
  const label = (source: DashboardDeliverySource) => {
    switch (source) {
      case "member":
        return t(($) => $.delivery.source_member);
      case "autopilot":
        return t(($) => $.delivery.source_autopilot);
      case "agent":
        return t(($) => $.delivery.source_agent);
    }
  };
  const percent = new Intl.NumberFormat(locales, { style: "percent", maximumFractionDigits: 0 });

  return (
    <div className={cn("flex flex-col rounded-lg border bg-card", className)}>
      <AnalyticsCardHeader
        title={t(($) => $.delivery.sources_title)}
        caption={t(($) => $.delivery.sources_caption)}
      />
      <ul className="flex flex-col gap-4 p-4">
        {rows.map((row) => {
          const Icon = SOURCE_ICON[row.source];
          return (
            <li key={row.source}>
              <div className="flex items-center gap-2 text-label">
                <Icon aria-hidden className="size-3.5 text-muted-foreground" />
                <span className="flex-1 font-medium">{label(row.source)}</span>
                <span className="font-medium tabular-nums">{row.assigned}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-chart-1"
                  style={{ width: `${total > 0 ? (row.assigned / total) * 100 : 0}%` }}
                />
              </div>
              <p className="mt-1.5 text-caption tabular-nums text-muted-foreground">
                {t(($) => $.delivery.source_delivered, {
                  delivered: row.delivered,
                  rate: row.assigned > 0 ? percent.format(row.delivered / row.assigned) : "—",
                })}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface TimeParts {
  run: number;
  wait: number;
  review: number | null;
  cycle: number | null;
}

// Medians do not add up, so each stage is its own median: the agent's own run
// time before delivery, the rest of the cycle, then delivery → done.
function timeParts(
  s: Pick<DeliverySummary, "medianRunSeconds" | "medianCycleSeconds" | "medianReviewSeconds">,
): TimeParts {
  const run = s.medianRunSeconds ?? 0;
  const cycle = s.medianCycleSeconds;
  return {
    run,
    wait: cycle === null ? 0 : Math.max(0, cycle - run),
    review: s.medianReviewSeconds,
    cycle,
  };
}

const PHASE_CLASS = {
  run: "bg-chart-1",
  wait: "bg-chart-4",
  review: "bg-warning/50",
} as const;

/**
 * Where the time between pickup and done goes, team first and then per
 * agent. The review stage is usually the long one — the part of the loop
 * that is waiting on a person, not on an agent.
 */
export function TimeBreakdownCard({
  team,
  agentRows,
  agentSummaries,
  agentName,
  lessThanMinuteLabel,
}: {
  team: DeliverySummary;
  agentRows: AgentDeliveryRow[];
  agentSummaries: ReadonlyMap<string, DeliverySummary>;
  agentName: (agentId: string) => string;
  lessThanMinuteLabel: string;
}) {
  const { t } = useT("usage");
  const rows = [
    { id: "__team__", name: t(($) => $.scorecard.team), parts: timeParts(team) },
    ...agentRows
      .filter((r) => r.delivered > 0)
      .map((r) => ({
        id: r.agentId,
        name: agentName(r.agentId),
        parts: timeParts(agentSummaries.get(r.agentId) ?? team),
      })),
  ];
  const max = Math.max(
    1,
    ...rows.map((r) => r.parts.run + r.parts.wait + (r.parts.review ?? 0)),
  );
  const fmt = (s: number) => formatDuration(s, lessThanMinuteLabel);
  const phases = [
    { key: "run" as const, label: t(($) => $.delivery.phase_run) },
    { key: "wait" as const, label: t(($) => $.delivery.phase_wait) },
    { key: "review" as const, label: t(($) => $.delivery.phase_review) },
  ];

  return (
    <div className="rounded-lg border bg-card">
      <AnalyticsCardHeader
        title={t(($) => $.delivery.time_title)}
        caption={t(($) => $.delivery.time_caption)}
      />
      <div className="flex flex-wrap gap-4 px-4 pt-3 text-caption text-muted-foreground">
        {phases.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2.5 rounded-xs", PHASE_CLASS[p.key])} />
            {p.label}
          </span>
        ))}
      </div>
      {team.delivered === 0 ? (
        <p className="px-4 py-8 text-center text-caption text-muted-foreground">
          {t(($) => $.delivery.no_data)}
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5 p-4">
          {rows.map((row) => {
            const isTeam = row.id === "__team__";
            const isBucket =
              row.id === DELETED_AGENTS_ROW_ID || row.id === RESTRICTED_AGENTS_ROW_ID;
            const total = row.parts.run + row.parts.wait + (row.parts.review ?? 0);
            return (
              <li
                key={row.id}
                className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_minmax(0,14rem)] items-center gap-4"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {isTeam || isBucket ? (
                    <span className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
                      <Users className="size-3.5" />
                    </span>
                  ) : (
                    <ActorAvatar actorType="agent" actorId={row.id} size="md" />
                  )}
                  <span className={cn("truncate text-body", isTeam ? "font-semibold" : "font-medium")}>
                    {row.name}
                  </span>
                </span>
                <div
                  className="flex h-5 gap-0.5 overflow-hidden rounded-sm"
                  style={{ width: `${(total / max) * 100}%` }}
                  title={phases
                    .map((p) => `${p.label} ${fmt(row.parts[p.key] ?? 0)}`)
                    .join(" · ")}
                >
                  {phases.map((p) => {
                    const v = row.parts[p.key] ?? 0;
                    return v > 0 ? (
                      <div
                        key={p.key}
                        className={cn("h-full min-w-0.5", PHASE_CLASS[p.key])}
                        style={{ flexGrow: v }}
                      />
                    ) : null;
                  })}
                </div>
                <span className="truncate text-right text-caption tabular-nums text-muted-foreground">
                  {row.parts.cycle === null
                    ? "—"
                    : row.parts.review === null
                      ? t(($) => $.delivery.time_row_no_review, { cycle: fmt(row.parts.cycle) })
                      : t(($) => $.delivery.time_row, {
                          cycle: fmt(row.parts.cycle),
                          review: fmt(row.parts.review),
                        })}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
