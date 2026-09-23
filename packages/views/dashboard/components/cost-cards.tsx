"use client";

import { useMemo, useState, type CSSProperties } from "react";
import type { DashboardUsageBreakdown } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../../i18n";
import { estimateCost, formatTokens, modelGroupingKey } from "../../runtimes/utils";
import { AnalyticsCardHeader } from "./overview-cards";
import { Segmented } from "./dashboard-shared";
import "./analytics-scroll-region.css";

export type CostGroup = "agent" | "model" | "runtime" | "project";

export interface CostRow {
  key: string;
  cost: number;
  tokens: number;
  cacheRead: number;
  input: number;
}

// Model rows fold on the same key the pricing table uses, so a model the
// provider reports under two spellings is one row, not two half-rows.
function groupKey(row: DashboardUsageBreakdown, group: CostGroup): string {
  switch (group) {
    case "agent":
      return row.agent_id;
    case "model":
      return modelGroupingKey(row.model, row.provider);
    case "runtime":
      return row.runtime_id;
    case "project":
      return row.project_id;
  }
}

export function groupUsageBreakdown(
  rows: readonly DashboardUsageBreakdown[],
  group: CostGroup,
): CostRow[] {
  const map = new Map<string, CostRow>();
  for (const r of rows) {
    const key = groupKey(r, group);
    const entry = map.get(key) ?? { key, cost: 0, tokens: 0, cacheRead: 0, input: 0 };
    entry.cost += estimateCost(r);
    entry.tokens += r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens;
    entry.cacheRead += r.cache_read_tokens;
    entry.input += r.input_tokens;
    map.set(key, entry);
  }
  return [...map.values()].toSorted((a, b) => b.cost - a.cost);
}

const TABLE_GRID_STYLE = {
  minWidth: "fit-content",
  gridTemplateColumns: "minmax(12rem, 1.6fr) minmax(10rem, 1.2fr) 4rem 6rem 6rem",
} satisfies CSSProperties;

/**
 * Spend regrouped by any dimension the hourly rollup keeps. The daily chart
 * above stays by model; this table is where the "who / on what" question is
 * answered.
 */
export function CostBreakdownCard({
  rows,
  labelFor,
  locales,
}: {
  rows: readonly DashboardUsageBreakdown[];
  labelFor: (group: CostGroup, key: string) => string;
  locales: Intl.LocalesArgument;
}) {
  const { t } = useT("usage");
  const [group, setGroup] = useState<CostGroup>("agent");
  const grouped = useMemo(() => groupUsageBreakdown(rows, group), [rows, group]);
  const total = grouped.reduce((sum, r) => sum + r.cost, 0);
  const top = grouped[0]?.cost ?? 0;
  const percent = new Intl.NumberFormat(locales, { style: "percent", maximumFractionDigits: 0 });

  const options = [
    { value: "agent" as const, label: t(($) => $.cost.group_agent) },
    { value: "model" as const, label: t(($) => $.cost.group_model) },
    { value: "runtime" as const, label: t(($) => $.cost.group_runtime) },
    { value: "project" as const, label: t(($) => $.cost.group_project) },
  ];
  const groupLabel = options.find((o) => o.value === group)?.label ?? "";

  return (
    <div className="rounded-lg border bg-card">
      <AnalyticsCardHeader
        title={t(($) => $.cost.breakdown_title)}
        action={
          <Segmented
            label={t(($) => $.cost.group_label)}
            value={group}
            onChange={setGroup}
            options={options}
          />
        }
      />
      {grouped.length === 0 ? (
        <p className="px-4 py-8 text-center text-caption text-muted-foreground">
          {t(($) => $.cost.no_data)}
        </p>
      ) : (
        <div
          role="region"
          aria-label={t(($) => $.cost.breakdown_title)}
          tabIndex={0}
          className="analytics-scroll-region mt-3 overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]"
        >
          <div
            className="grid items-center gap-3 border-b px-4 py-2 text-caption font-medium text-muted-foreground"
            style={TABLE_GRID_STYLE}
          >
            <span>{groupLabel}</span>
            <span>{t(($) => $.cost.header_cost)}</span>
            <span className="text-right">{t(($) => $.cost.header_share)}</span>
            <span className="text-right">{t(($) => $.cost.header_tokens)}</span>
            <span className="text-right">{t(($) => $.cost.header_cache)}</span>
          </div>
          <ul className="divide-y">
            {grouped.map((row) => {
              const cacheBase = row.input + row.cacheRead;
              return (
                <li
                  key={row.key}
                  className="grid items-center gap-3 px-4 py-2.5"
                  style={TABLE_GRID_STYLE}
                >
                  <span className="truncate text-body font-medium">
                    {labelFor(group, row.key)}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-body font-medium tabular-nums">
                      ${row.cost.toFixed(2)}
                    </span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-chart-1"
                        style={{ width: `${top > 0 ? (row.cost / top) * 100 : 0}%` }}
                      />
                    </span>
                  </span>
                  <span className="text-right text-caption tabular-nums text-muted-foreground">
                    {total > 0 ? percent.format(row.cost / total) : "—"}
                  </span>
                  <span className="text-right text-caption tabular-nums text-muted-foreground">
                    {formatTokens(row.tokens)}
                  </span>
                  <span className="text-right text-caption tabular-nums text-muted-foreground">
                    {cacheBase > 0 ? percent.format(row.cacheRead / cacheBase) : "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export interface UnitCostRow {
  agentId: string;
  name: string;
  cost: number;
  delivered: number;
}

/** Each agent's spend divided by what it delivered, cheapest delivery last. */
export function UnitCostCard({
  rows,
  className,
}: {
  rows: UnitCostRow[];
  className?: string;
}) {
  const { t } = useT("usage");
  const withUnit = rows
    .map((r) => ({ ...r, unit: r.delivered > 0 ? r.cost / r.delivered : null }))
    .toSorted((a, b) => (b.unit ?? -1) - (a.unit ?? -1));
  const max = Math.max(0, ...withUnit.map((r) => r.unit ?? 0));

  return (
    <div className={cn("flex flex-col rounded-lg border bg-card", className)}>
      <AnalyticsCardHeader
        title={t(($) => $.cost.unit_title)}
        caption={t(($) => $.cost.unit_caption)}
      />
      {withUnit.length === 0 ? (
        <p className="flex flex-1 items-center justify-center px-4 py-8 text-center text-caption text-muted-foreground">
          {t(($) => $.cost.no_data)}
        </p>
      ) : (
        <ul className="flex flex-col gap-3 p-4">
          {withUnit.slice(0, 8).map((row) => (
            <li key={row.agentId}>
              <div className="flex items-center gap-2 text-label">
                <span className="min-w-0 flex-1 truncate font-medium">{row.name}</span>
                <span className="shrink-0 tabular-nums">
                  {row.unit === null ? (
                    <span className="text-caption text-muted-foreground">
                      {t(($) => $.cost.unit_none)}
                    </span>
                  ) : (
                    `$${row.unit.toFixed(2)}`
                  )}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-chart-2"
                  style={{ width: `${max > 0 && row.unit !== null ? (row.unit / max) * 100 : 0}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
