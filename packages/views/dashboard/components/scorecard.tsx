"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { EyeOff, Trash2, Users } from "lucide-react";
import type { DashboardDeliveryIssue } from "@multica/core/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@multica/ui/components/ui/tooltip";
import { cn } from "@multica/ui/lib/utils";
import { ActorAvatar } from "../../common/actor-avatar";
import { useT } from "../../i18n";
import {
  bucketDeliveries,
  isFailureRateHigh,
  isFirstPassLow,
  type AgentDeliveryRow,
  type DeliverySummary,
} from "../delivery";
import { DELETED_AGENTS_ROW_ID, formatDuration, RESTRICTED_AGENTS_ROW_ID } from "../utils";
import { AnalyticsCardHeader } from "./overview-cards";
import "./analytics-scroll-region.css";

// Enough rows to answer "who is doing the work"; the tail is one toggle away.
const SCORECARD_LIMIT = 10;

// Flexible agent column with a readable floor; the metric columns are fixed so
// the numbers line up down the table. `fit-content` lets narrow viewports
// scroll horizontally instead of crushing the columns.
const SCORECARD_GRID_STYLE = {
  minWidth: "fit-content",
  gridTemplateColumns:
    "minmax(10rem, 1.6fr) 4.5rem 6rem 5.5rem 6rem 7rem 5.5rem 5.5rem",
} satisfies CSSProperties;

const SCORECARD_GRID = "grid items-center gap-3";

export interface ScorecardTrend {
  tz: string;
  firstDay: string;
  lastDay: string;
  grain: "daily" | "weekly";
}

/**
 * One row per agent: what it delivered, how much of that passed review first
 * time, how much rework it took, how fast, what each delivery cost and how
 * often its runs failed — with the team as the reference row. Cells well below
 * the team are flagged rather than the rows being ranked on a blended score:
 * agents do different work, and one number would hide which part is off.
 */
export function Scorecard({
  rows,
  team,
  costByAgent,
  teamCost,
  issues,
  trend,
  agentName,
  lessThanMinuteLabel,
  locales,
  onOpenDelivered,
  onOpenBounced,
}: {
  rows: AgentDeliveryRow[];
  team: DeliverySummary;
  costByAgent: ReadonlyMap<string, number>;
  teamCost: number;
  issues: readonly DashboardDeliveryIssue[];
  trend: ScorecardTrend;
  agentName: (agentId: string) => string;
  lessThanMinuteLabel: string;
  locales: Intl.LocalesArgument;
  onOpenDelivered: (agentId: string) => void;
  onOpenBounced: (agentId: string) => void;
}) {
  const { t } = useT("usage");
  const [showAll, setShowAll] = useState(false);
  const visibleRows = showAll ? rows : rows.slice(0, SCORECARD_LIMIT);

  const percent = (v: number | null) =>
    v === null
      ? "—"
      : new Intl.NumberFormat(locales, { style: "percent", maximumFractionDigits: 0 }).format(v);
  const money = (v: number | null) => (v === null ? "—" : `$${v.toFixed(2)}`);
  const rounds = (v: number | null) =>
    v === null
      ? "—"
      : t(($) => $.scorecard.rework_rounds, {
          value: new Intl.NumberFormat(locales, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(v),
        });
  const duration = (v: number | null) =>
    v === null ? "—" : formatDuration(v, lessThanMinuteLabel);

  const trendByAgent = useMemo(() => {
    const byAgent = new Map<string, DashboardDeliveryIssue[]>();
    for (const issue of issues) {
      const list = byAgent.get(issue.agent_id);
      if (list) list.push(issue);
      else byAgent.set(issue.agent_id, [issue]);
    }
    const out = new Map<string, number[]>();
    for (const [agentId, list] of byAgent) {
      out.set(
        agentId,
        bucketDeliveries(list, trend.tz, trend.firstDay, trend.lastDay, trend.grain).map(
          (b) => b.firstPass + b.reworked,
        ),
      );
    }
    return out;
  }, [issues, trend]);

  const teamRework = team.delivered > 0 ? team.bounces / team.delivered : null;
  const teamFailure = team.runs > 0 ? team.failedRuns / team.runs : null;

  const header = (label: string, align: "left" | "right" = "right") => (
    <span className={align === "right" ? "text-right" : undefined}>{label}</span>
  );

  return (
    <div className="rounded-lg border bg-card">
      <AnalyticsCardHeader
        title={t(($) => $.scorecard.title)}
        caption={t(($) => $.scorecard.caption)}
        action={
          rows.length > SCORECARD_LIMIT ? (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="shrink-0 text-caption text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {showAll
                ? t(($) => $.scorecard.show_less, { n: SCORECARD_LIMIT })
                : t(($) => $.scorecard.show_all)}
            </button>
          ) : null
        }
      />
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-caption text-muted-foreground">
          {t(($) => $.scorecard.no_data)}
        </p>
      ) : (
        <div
          role="region"
          aria-label={t(($) => $.scorecard.title)}
          tabIndex={0}
          className="analytics-scroll-region mt-3 overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]"
        >
          <div
            className={`${SCORECARD_GRID} border-b px-4 py-2 text-caption font-medium text-muted-foreground`}
            style={SCORECARD_GRID_STYLE}
          >
            {header(t(($) => $.scorecard.header_agent), "left")}
            {header(t(($) => $.scorecard.header_delivered))}
            {header(t(($) => $.scorecard.header_first_pass))}
            {header(t(($) => $.scorecard.header_rework))}
            {header(t(($) => $.scorecard.header_cycle))}
            {header(t(($) => $.scorecard.header_unit_cost))}
            {header(t(($) => $.scorecard.header_failure))}
            {header(t(($) => $.scorecard.header_trend))}
          </div>
          <ul aria-label={t(($) => $.scorecard.title)} className="divide-y">
            {visibleRows.map((row) => {
              const name = agentName(row.agentId);
              const isDeleted = row.agentId === DELETED_AGENTS_ROW_ID;
              const isRestricted = row.agentId === RESTRICTED_AGENTS_ROW_ID;
              const cost = costByAgent.get(row.agentId);
              const unitCost =
                cost !== undefined && row.delivered > 0 ? cost / row.delivered : null;
              const firstPassLow = isFirstPassLow(row, team.firstPassRate);
              const failureHigh = isFailureRateHigh(row);
              const buckets = trendByAgent.get(row.agentId) ?? [];
              return (
                <li
                  key={row.agentId}
                  className={`${SCORECARD_GRID} px-4 py-2.5`}
                  style={SCORECARD_GRID_STYLE}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {isDeleted || isRestricted ? (
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        {isDeleted ? <Trash2 className="size-3" /> : <EyeOff className="size-3" />}
                      </span>
                    ) : (
                      <ActorAvatar
                        actorType="agent"
                        actorId={row.agentId}
                        size="md"
                        enableHoverCard
                      />
                    )}
                    <span
                      className={cn(
                        "truncate text-body font-medium",
                        (isDeleted || isRestricted) && "italic text-muted-foreground",
                      )}
                    >
                      {name}
                    </span>
                  </span>
                  <span className="text-right">
                    <button
                      type="button"
                      disabled={row.delivered === 0}
                      onClick={() => onOpenDelivered(row.agentId)}
                      aria-label={t(($) => $.scorecard.open_delivered, { agent: name })}
                      className="rounded-sm text-body font-medium tabular-nums underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:no-underline"
                    >
                      {row.delivered}
                    </button>
                  </span>
                  <span className="text-right tabular-nums">
                    {firstPassLow ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              onClick={() => onOpenBounced(row.agentId)}
                              aria-label={t(($) => $.scorecard.open_bounced, { agent: name })}
                              className="inline-flex h-6 items-center rounded-sm bg-destructive/10 px-1.5 text-body font-medium text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                            />
                          }
                        >
                          {percent(row.firstPassRate)}
                        </TooltipTrigger>
                        <TooltipContent>
                          {t(($) => $.scorecard.first_pass_low, {
                            team: percent(team.firstPassRate),
                          })}
                        </TooltipContent>
                      </Tooltip>
                    ) : row.delivered > row.firstPass ? (
                      <button
                        type="button"
                        onClick={() => onOpenBounced(row.agentId)}
                        aria-label={t(($) => $.scorecard.open_bounced, { agent: name })}
                        className="rounded-sm text-body underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        {percent(row.firstPassRate)}
                      </button>
                    ) : (
                      <span className="text-body">{percent(row.firstPassRate)}</span>
                    )}
                  </span>
                  <span className="text-right text-caption tabular-nums text-muted-foreground">
                    {rounds(row.reworkRounds)}
                  </span>
                  <span className="text-right text-caption tabular-nums text-muted-foreground">
                    {duration(row.medianCycleSeconds)}
                  </span>
                  <span className="text-right text-caption tabular-nums text-muted-foreground">
                    {money(unitCost)}
                  </span>
                  <span className="text-right tabular-nums">
                    {failureHigh ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span className="inline-flex h-6 items-center rounded-sm bg-destructive/10 px-1.5 text-body font-medium text-destructive" />
                          }
                        >
                          {percent(row.failureRate)}
                        </TooltipTrigger>
                        <TooltipContent>
                          {t(($) => $.scorecard.failure_high, {
                            failed: row.failedRuns,
                            runs: row.runs,
                          })}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-caption text-muted-foreground">
                        {percent(row.failureRate)}
                      </span>
                    )}
                  </span>
                  <span className="flex justify-end">
                    <TrendBars values={buckets} />
                  </span>
                </li>
              );
            })}
            <li
              className={`${SCORECARD_GRID} rounded-b-lg bg-muted/60 px-4 py-2 text-caption text-muted-foreground`}
              style={SCORECARD_GRID_STYLE}
            >
              <span className="flex items-center gap-2">
                <span className="flex size-6 shrink-0 items-center justify-center">
                  <Users className="size-3.5" />
                </span>
                <span className="text-body font-medium text-foreground">
                  {t(($) => $.scorecard.team)}
                </span>
              </span>
              <span className="text-right text-body font-medium tabular-nums text-foreground">
                {team.delivered}
              </span>
              <span className="text-right tabular-nums">{percent(team.firstPassRate)}</span>
              <span className="text-right tabular-nums">{rounds(teamRework)}</span>
              <span className="text-right tabular-nums">{duration(team.medianCycleSeconds)}</span>
              <span className="text-right tabular-nums">
                {money(team.delivered > 0 ? teamCost / team.delivered : null)}
              </span>
              <span className="text-right tabular-nums">{percent(teamFailure)}</span>
              <span />
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

/** Deliveries per bucket, scaled to the row's own peak so each shape reads. */
function TrendBars({ values }: { values: readonly number[] }) {
  if (values.length < 2) return null;
  const width = 72;
  const height = 20;
  const max = Math.max(...values, 1);
  const bw = width / values.length;
  return (
    <svg aria-hidden width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {values.map((v, i) => {
        const h = v === 0 ? 1.5 : Math.max(2, (v / max) * (height - 2));
        return (
          <rect
            key={i}
            x={i * bw + 0.5}
            y={height - h}
            width={Math.max(1, bw - 1.5)}
            height={h}
            rx={1}
            className={v === 0 ? "fill-border" : "fill-chart-2"}
          />
        );
      })}
    </svg>
  );
}
