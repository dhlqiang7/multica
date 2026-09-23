"use client";

import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../../i18n";

/**
 * Which direction of change is good news. Colour encodes good or bad, never
 * up or down: a falling cycle time is green, a rising one red, and a metric
 * that is neither (total spend, token volume) stays neutral.
 */
export type DeltaTone = "up_is_good" | "down_is_good" | "neutral";

export interface KpiDelta {
  /** Relative change (0.23 = +23%) or, with `points`, a rate change in pp. */
  change: number | null;
  points?: boolean;
  tone: DeltaTone;
  /** The previous period's value, already formatted. null = no baseline. */
  previous: string | null;
}

function deltaClass(change: number, tone: DeltaTone): string {
  if (tone === "neutral" || change === 0) return "text-muted-foreground";
  const good = tone === "up_is_good" ? change > 0 : change < 0;
  return good ? "text-success" : "text-destructive";
}

function DeltaLine({ delta, locales }: { delta: KpiDelta; locales: Intl.LocalesArgument }) {
  const { t } = useT("usage");
  if (delta.previous === null) {
    return (
      <span className="text-caption text-muted-foreground">
        {t(($) => $.delta.no_baseline)}
      </span>
    );
  }
  const { change } = delta;
  const magnitude =
    change === null
      ? null
      : delta.points
        ? t(($) => $.delta.points, {
            value: new Intl.NumberFormat(locales, { maximumFractionDigits: 0 }).format(
              Math.abs(change),
            ),
          })
        : new Intl.NumberFormat(locales, {
            style: "percent",
            maximumFractionDigits: 0,
          }).format(Math.abs(change));
  const Arrow = change !== null && change < 0 ? ArrowDownRight : ArrowUpRight;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
      {magnitude !== null && change !== null && Math.round(Math.abs(change) * (delta.points ? 1 : 100)) !== 0 ? (
        <span className={cn("inline-flex shrink-0 items-center gap-0.5 font-medium tabular-nums", deltaClass(change, delta.tone))}>
          <Arrow aria-hidden className="size-3" />
          {magnitude}
        </span>
      ) : null}
      <span className="truncate">
        {t(($) => $.delta.vs_previous, { value: delta.previous })}
      </span>
    </span>
  );
}

/** A small area sparkline; nothing below three points, where it cannot show a trend. */
export function TrendSparkline({
  values,
  width = 84,
  height = 28,
}: {
  values: readonly number[];
  width?: number;
  height?: number;
}) {
  if (values.length < 3) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (width - 2) + 1;
    const y = height - 2 - ((v - min) / span) * (height - 4);
    return [x, y] as const;
  });
  const line = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${width - 1} ${height} L1 ${height} Z`;
  const last = points[points.length - 1]!;
  return (
    <svg
      aria-hidden
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0 text-chart-1"
    >
      <path d={area} fill="currentColor" opacity={0.1} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last[0]} cy={last[1]} r={2.25} fill="currentColor" />
    </svg>
  );
}

export function AnalyticsKpi({
  label,
  value,
  delta,
  sparkline,
  hint,
  locales,
}: {
  label: string;
  value: ReactNode;
  delta?: KpiDelta | null;
  sparkline?: readonly number[];
  hint?: ReactNode;
  locales: Intl.LocalesArgument;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 p-5">
      {/* The row keeps the sparkline's height with or without one, so values
          line up across a KPI row that mixes the two. */}
      <div className="flex min-h-7 items-start justify-between gap-3">
        <div className="text-caption font-medium text-muted-foreground">{label}</div>
        {sparkline ? <TrendSparkline values={sparkline} /> : null}
      </div>
      <div className="-mt-1 flex items-baseline gap-0.5 text-display font-semibold leading-none tabular-nums">
        {value}
      </div>
      {delta ? <DeltaLine delta={delta} locales={locales} /> : null}
      {hint != null ? (
        <div className="truncate text-caption text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

/** The KPI row container — the same divided card grid the old usage tiles used. */
export function KpiRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 divide-y rounded-lg border bg-card sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
      {children}
    </div>
  );
}

/** A unit suffix inside a KPI value ("小时", "%") — quieter than the number. */
export function KpiUnit({ children }: { children: ReactNode }) {
  return (
    <span className="text-title-sm font-medium text-muted-foreground">{children}</span>
  );
}
