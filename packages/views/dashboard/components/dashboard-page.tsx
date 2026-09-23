"use client";

import { useMemo, useState } from "react";
import { BarChart3, RefreshCw } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@multica/ui/components/ui/button";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@multica/ui/components/ui/tabs";
import {
  CompactNumberFlow,
  CurrencyNumberFlow,
  NumberFlow,
} from "@multica/ui/components/ui/number-flow";
import { useWorkspaceId } from "@multica/core/hooks";
import type {
  Agent,
  DashboardDelivery,
  DashboardUsageBreakdown,
} from "@multica/core/types";
import { agentListOptions } from "@multica/core/workspace/queries";
import { projectListOptions } from "@multica/core/projects/queries";
import { runtimeDisplayLabel, runtimeListOptions } from "@multica/core/runtimes";
import {
  dashboardKeys,
  dashboardDeliveryOptions,
  dashboardFailuresByAgentOptions,
  dashboardFailuresDailyOptions,
  dashboardRunTimeDailyOptions,
  dashboardUsageBreakdownOptions,
  dashboardUsageDailyOptions,
} from "@multica/core/dashboard";
import { useCustomPricingStore } from "@multica/core/runtimes/custom-pricing-store";
import { cn } from "@multica/ui/lib/utils";
import { useViewingTimezone } from "../../common/use-viewing-timezone";
import { PAGE_GUTTER } from "../../layout/page-header";
import { CollectionPageHeader } from "../../layout/collection-page";
import { useNavigation } from "../../navigation";
import {
  addDaysIso,
  aggregateByWeek,
  estimateCost,
  formatTokens,
  todayIso,
} from "../../runtimes/utils";
import { useT } from "../../i18n";
import {
  aggregateAgentFailures,
  aggregateAgentTokens,
  aggregateDailyCost,
  aggregateDailyErrors,
  aggregateDailyTasks,
  aggregateDailyTime,
  aggregateDailyTokens,
  aggregateFailureClasses,
  aggregateFailureReasons,
  aggregateWeeklyErrors,
  aggregateWeeklyTasks,
  aggregateWeeklyTime,
  anonymizeUnresolvedAgentRows,
  computeDailyTotals,
  computeFailureTotals,
  DELETED_AGENTS_ROW_ID,
  formatDuration,
  RESTRICTED_AGENTS_ROW_ID,
} from "../utils";
import {
  aggregateDeliveryByAgent,
  aggregateDeliverySources,
  bucketDeliveries,
  deriveDeliveryInsights,
  filterDeliveryIssues,
  foldUnknownDeliveryAgents,
  median,
  cycleSeconds,
  pointChange,
  relativeChange,
  splitDeliveryPeriods,
  summarizeDelivery,
  trailingDailySeries,
  type DeliveryInsight,
  type DeliveryStage,
  type DeliverySummary,
} from "../delivery";
import { ALL_PROJECTS, DurationNumberFlow, dimsForDays, type TimeRange } from "./dashboard-shared";
import { ProjectFilter, TimeRangeFilter } from "./dashboard-filters";
import { UsageTrendCard } from "./usage-trend-card";
import { ErrorsTab } from "./errors-tab";
import { AnalyticsKpi, KpiRow, KpiUnit, type KpiDelta } from "./analytics-kpi";
import { FunnelCard, InsightsCard, useStageLabel } from "./overview-cards";
import { Scorecard } from "./scorecard";
import { DeliveredChartCard, SourcesCard, TimeBreakdownCard } from "./delivery-cards";
import { CostBreakdownCard, UnitCostCard, type CostGroup } from "./cost-cards";
import { DeliveryIssuesSheet, type DeliveryDrill } from "./delivery-issues-sheet";

// Stable references — `data ?? []` would create a new empty array on every
// render while a query is loading, which breaks useMemo's reference check.
const EMPTY_DAILY: import("@multica/core/types").DashboardUsageDaily[] = [];
const EMPTY_RUNTIME_DAILY: import("@multica/core/types").DashboardRunTimeDaily[] = [];
const EMPTY_FAILURE_DAILY: import("@multica/core/types").DashboardFailureDaily[] = [];
const EMPTY_FAILURE_BY_AGENT: import("@multica/core/types").DashboardFailureByAgent[] =
  [];
const EMPTY_BREAKDOWN: DashboardUsageBreakdown[] = [];
const EMPTY_DELIVERY: DashboardDelivery = {
  window_start: "",
  previous_window_start: "",
  issues: [],
};
const EMPTY_AGENTS: Agent[] = [];

type DashboardTab = "overview" | "delivery" | "cost" | "reliability";
const DASHBOARD_TABS: readonly DashboardTab[] = ["overview", "delivery", "cost", "reliability"];
const TAB_QUERY_KEY = "tab";
const DEFAULT_TAB: DashboardTab = "overview";

// `?tab=errors` links predate the redesign and are what people pasted at each
// other; they keep landing on the same content under its new name.
function tabFromParam(value: string | null): DashboardTab {
  if (value === "errors") return "reliability";
  return DASHBOARD_TABS.find((tab) => tab === value) ?? DEFAULT_TAB;
}

/** Local time of the most recent successful fetch, in the viewer's timezone. */
function useDataFreshness(
  updatedAts: (number | undefined)[],
  viewTZ: string,
  locales: Intl.LocalesArgument,
): { tzLabel: string | null; updatedLabel: string | null } {
  return useMemo(() => {
    const stamps = updatedAts.filter(
      (n): n is number => typeof n === "number" && n > 0,
    );
    const latest = stamps.length > 0 ? Math.max(...stamps) : null;
    // A stored timezone is user input and reaches us unvalidated; Intl throws
    // on a string it does not recognise, and a header label is not worth
    // taking the page down for.
    try {
      const tzLabel =
        new Intl.DateTimeFormat(locales, {
          timeZone: viewTZ,
          timeZoneName: "shortOffset",
        })
          .formatToParts(new Date())
          .find((part) => part.type === "timeZoneName")?.value ?? null;
      const updatedLabel =
        latest === null
          ? null
          : new Intl.DateTimeFormat(locales, {
              timeZone: viewTZ,
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(latest));
      return { tzLabel, updatedLabel };
    } catch {
      return { tzLabel: null, updatedLabel: null };
    }
    // `updatedAts` is a fresh array each render; spreading it into the dep list
    // keeps the memo keyed on the values rather than the identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...updatedAts, viewTZ, locales]);
}

/**
 * Workspace analytics at `/{slug}/usage`.
 *
 * The page reads as a report on the AI team rather than a meter: what the
 * agents delivered, whether it was worth what it cost, and where to look. Four
 * tabs, split by the question the reader arrives with:
 *
 *   Overview     the headline figures, the delivery funnel, what stands out,
 *                and one scorecard row per agent
 *   Delivery     throughput over time, where issues come from, and where the
 *                time between pickup and done goes
 *   Cost         spend with unit economics, regrouped by any dimension
 *   Reliability  what broke (the former Errors tab)
 *
 * The unit is the issue, not the run: the Overview and Delivery tabs fold one
 * cohort — issues agents picked up in the period — so their figures reconcile
 * with each other. Every headline figure carries a period-over-period delta,
 * and every count on those two tabs opens the issues it was made of.
 *
 * Cost math runs client-side via the runtimes utils, so this page and the
 * runtime page price with one table.
 */
export function DashboardPage() {
  const { t, i18n } = useT("usage");
  const wsId = useWorkspaceId();
  const viewTZ = useViewingTimezone();
  const navigation = useNavigation();
  const locales = i18n.resolvedLanguage ?? i18n.language;
  const [days, setDays] = useState<TimeRange>(30);
  const [projectValue, setProjectValue] = useState<string>(ALL_PROJECTS);
  const [drill, setDrill] = useState<DeliveryDrill | null>(null);
  const stageLabel = useStageLabel();

  // The tab lives in the URL so a view can be linked to. `replace`, not
  // `push`, so flipping tabs does not stack up history entries.
  const tab = tabFromParam(navigation.searchParams.get(TAB_QUERY_KEY));
  const handleTabChange = (next: string) => {
    const params = new URLSearchParams(navigation.searchParams);
    if (next === DEFAULT_TAB) params.delete(TAB_QUERY_KEY);
    else params.set(TAB_QUERY_KEY, next);
    const query = params.toString();
    navigation.replace(query ? `${navigation.pathname}?${query}` : navigation.pathname);
  };

  // Re-render when the user saves a model price on the runtimes page.
  useCustomPricingStore((s) => s.pricings);

  const { data: projects = [] } = useQuery(projectListOptions(wsId));
  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));
  const agentsQuery = useQuery(agentListOptions(wsId));
  const agents = agentsQuery.data ?? EMPTY_AGENTS;

  // A stale project UUID (deleted project, previous workspace) would filter
  // every query to nothing while the header still reads "All projects".
  const projectId = useMemo(() => {
    if (projectValue === ALL_PROJECTS) return null;
    return projects.some((p) => p.id === projectValue) ? projectValue : null;
  }, [projectValue, projects]);

  // The weekly charts paint `ceil(days / 7)` trailing calendar weeks, whose
  // leftmost Monday can sit `weekCount * 7 - 1` days back; the headline deltas
  // need the whole previous period. The per-date series fetch the wider of the
  // two, and every daily figure trims back to its own window client-side.
  const weekCount = Math.max(1, Math.ceil(days / 7));
  const chartFetchDays = weekCount * 7;
  const compareFetchDays = Math.min(365, Math.max(chartFetchDays, days * 2));

  const dailyQuery = useQuery(
    dashboardUsageDailyOptions(wsId, compareFetchDays, projectId, viewTZ),
  );
  const runTimeDailyQuery = useQuery(
    dashboardRunTimeDailyOptions(wsId, compareFetchDays, projectId, viewTZ),
  );
  const failuresDailyQuery = useQuery(
    dashboardFailuresDailyOptions(wsId, chartFetchDays, projectId, viewTZ),
  );
  // Rows without a date are closed server-side to exactly `days` (MUL-5551).
  const failuresByAgentQuery = useQuery(
    dashboardFailuresByAgentOptions(wsId, days, projectId, viewTZ),
  );
  const breakdownQuery = useQuery(
    dashboardUsageBreakdownOptions(wsId, days, projectId, viewTZ),
  );
  const deliveryQuery = useQuery(dashboardDeliveryOptions(wsId, days, projectId, viewTZ));

  const dailyUsage = dailyQuery.data ?? EMPTY_DAILY;
  const runTimeDailyRows = runTimeDailyQuery.data ?? EMPTY_RUNTIME_DAILY;
  const failureDailyRows = failuresDailyQuery.data ?? EMPTY_FAILURE_DAILY;
  const failureByAgentRows = failuresByAgentQuery.data ?? EMPTY_FAILURE_BY_AGENT;
  const breakdownRows = breakdownQuery.data ?? EMPTY_BREAKDOWN;
  const delivery = deliveryQuery.data ?? EMPTY_DELIVERY;

  const queryClient = useQueryClient();
  const allQueries = [
    dailyQuery,
    runTimeDailyQuery,
    failuresDailyQuery,
    failuresByAgentQuery,
    breakdownQuery,
    deliveryQuery,
  ];
  const isRefreshing = allQueries.some((q) => q.isFetching);
  const handleRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.all(wsId) });
  };
  const { tzLabel, updatedLabel } = useDataFreshness(
    allQueries.map((q) => q.dataUpdatedAt),
    viewTZ,
    locales,
  );

  // Day windows in the viewer's timezone — the same axis the backend slices
  // on. `today` is read per render so the page rolls over at midnight.
  const today = todayIso(viewTZ);
  const windowStartIso = addDaysIso(today, -(days - 1));
  const previousStartIso = addDaysIso(windowStartIso, -days);
  const inWindow = <T extends { date: string }>(rows: T[]) =>
    rows.filter((r) => r.date >= windowStartIso);
  const inPrevious = <T extends { date: string }>(rows: T[]) =>
    rows.filter((r) => r.date >= previousStartIso && r.date < windowStartIso);

  const dailyUsageInWindow = useMemo(
    () => inWindow(dailyUsage),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dailyUsage, windowStartIso],
  );
  const dailyUsagePrevious = useMemo(
    () => inPrevious(dailyUsage),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dailyUsage, windowStartIso, previousStartIso],
  );
  const runTimeDailyInWindow = useMemo(
    () => inWindow(runTimeDailyRows),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runTimeDailyRows, windowStartIso],
  );
  const runTimeDailyPrevious = useMemo(
    () => inPrevious(runTimeDailyRows),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runTimeDailyRows, windowStartIso, previousStartIso],
  );
  const failureDailyInWindow = useMemo(
    () => inWindow(failureDailyRows),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [failureDailyRows, windowStartIso],
  );

  const totals = useMemo(() => computeDailyTotals(dailyUsageInWindow), [dailyUsageInWindow]);
  const previousTotals = useMemo(
    () => computeDailyTotals(dailyUsagePrevious),
    [dailyUsagePrevious],
  );
  const runsInWindow = runTimeDailyInWindow.reduce((sum, r) => sum + r.task_count, 0);
  const runsPrevious = runTimeDailyPrevious.reduce((sum, r) => sum + r.task_count, 0);
  // The previous period only has a baseline when the backend has data that
  // old; a workspace younger than two periods shows "no data" instead of a
  // meaningless +∞%.
  const hasPreviousUsage = dailyUsagePrevious.length > 0;

  // ---- Usage charts (Cost tab) -------------------------------------------
  const dailyCost = useMemo(() => aggregateDailyCost(dailyUsageInWindow), [dailyUsageInWindow]);
  const dailyTokens = useMemo(
    () => aggregateDailyTokens(dailyUsageInWindow),
    [dailyUsageInWindow],
  );
  const dailyTime = useMemo(() => aggregateDailyTime(runTimeDailyInWindow), [runTimeDailyInWindow]);
  const dailyTasks = useMemo(
    () => aggregateDailyTasks(runTimeDailyInWindow),
    [runTimeDailyInWindow],
  );
  const weekly = useMemo(
    () => aggregateByWeek(dailyUsage, viewTZ, weekCount),
    [dailyUsage, viewTZ, weekCount],
  );
  const weeklyTime = useMemo(
    () => aggregateWeeklyTime(runTimeDailyRows, viewTZ, weekCount),
    [runTimeDailyRows, viewTZ, weekCount],
  );
  const weeklyTasks = useMemo(
    () => aggregateWeeklyTasks(runTimeDailyRows, viewTZ, weekCount),
    [runTimeDailyRows, viewTZ, weekCount],
  );

  // ---- Reliability ----------------------------------------------------------
  // Totals / classes / reasons come from the date-bucketed rollup after the
  // same trim the charts use, so the summary never spans a wider window than
  // the chart beside it.
  const dailyErrors = useMemo(() => aggregateDailyErrors(failureDailyInWindow), [failureDailyInWindow]);
  const weeklyErrors = useMemo(
    () => aggregateWeeklyErrors(failureDailyRows, viewTZ, weekCount),
    [failureDailyRows, viewTZ, weekCount],
  );
  const failureTotals = useMemo(() => computeFailureTotals(failureDailyInWindow), [failureDailyInWindow]);
  const failureClassRows = useMemo(
    () => aggregateFailureClasses(failureDailyInWindow),
    [failureDailyInWindow],
  );
  const failureReasonRows = useMemo(
    () => aggregateFailureReasons(failureDailyInWindow),
    [failureDailyInWindow],
  );
  const knownAgentIds = useMemo(
    () => (agentsQuery.isSuccess ? new Set(agents.map((a) => a.id)) : null),
    [agentsQuery.isSuccess, agents],
  );
  const agentFailureRows = useMemo(
    () => aggregateAgentFailures(anonymizeUnresolvedAgentRows(failureByAgentRows, knownAgentIds)),
    [failureByAgentRows, knownAgentIds],
  );

  // ---- Delivery ------------------------------------------------------------
  const periods = useMemo(
    () =>
      splitDeliveryPeriods({
        ...delivery,
        issues: foldUnknownDeliveryAgents(delivery.issues, knownAgentIds),
      }),
    [delivery, knownAgentIds],
  );
  const summary = useMemo(() => summarizeDelivery(periods.current), [periods]);
  const previousSummary = useMemo(() => summarizeDelivery(periods.previous), [periods]);
  const hasPreviousDelivery = periods.previous.length > 0;
  const agentRows = useMemo(() => aggregateDeliveryByAgent(periods.current), [periods]);
  const agentSummaries = useMemo(() => {
    const map = new Map<string, DeliverySummary>();
    for (const row of agentRows) {
      map.set(
        row.agentId,
        summarizeDelivery(periods.current.filter((i) => i.agent_id === row.agentId)),
      );
    }
    return map;
  }, [agentRows, periods]);
  // Anchor "now" on the fetch, not the render, so the waiting-for-review rule
  // does not drift between renders of the same data.
  const deliveryNow = deliveryQuery.dataUpdatedAt || Date.now();
  const insights = useMemo(
    () => deriveDeliveryInsights(periods, deliveryNow),
    [periods, deliveryNow],
  );
  const sources = useMemo(() => aggregateDeliverySources(periods.current), [periods]);

  // Agent spend, with rows for agents this viewer cannot name folded exactly
  // like the delivery rows so the two line up in the scorecard.
  const foldedBreakdown = useMemo(
    () =>
      knownAgentIds
        ? breakdownRows.map((r) =>
            r.agent_id === RESTRICTED_AGENTS_ROW_ID || knownAgentIds.has(r.agent_id)
              ? r
              : { ...r, agent_id: DELETED_AGENTS_ROW_ID },
          )
        : breakdownRows,
    [breakdownRows, knownAgentIds],
  );
  const costByAgent = useMemo(
    () => new Map(aggregateAgentTokens(foldedBreakdown).map((r) => [r.agentId, r.cost])),
    [foldedBreakdown],
  );

  // ---- Sparklines ------------------------------------------------------------
  const sparkDelivered = useMemo(
    () =>
      bucketDeliveries(periods.current, viewTZ, windowStartIso, today, "daily").map(
        (b) => b.firstPass + b.reworked,
      ),
    [periods, viewTZ, windowStartIso, today],
  );
  const sparkFirstPass = useMemo(
    () =>
      trailingDailySeries(periods.current, viewTZ, windowStartIso, today, (window) =>
        window.length > 0 ? window.filter((i) => i.bounce_count === 0).length / window.length : null,
      ),
    [periods, viewTZ, windowStartIso, today],
  );
  const sparkCycle = useMemo(
    () =>
      trailingDailySeries(periods.current, viewTZ, windowStartIso, today, (window) =>
        median(window.map(cycleSeconds).filter((v): v is number => v !== null)),
      ),
    [periods, viewTZ, windowStartIso, today],
  );
  const sparkUnitCost = useMemo(() => {
    const costByDay = new Map<string, number>();
    for (const row of dailyUsageInWindow) {
      costByDay.set(row.date, (costByDay.get(row.date) ?? 0) + estimateCost(row));
    }
    const deliveredByDay = new Map(
      bucketDeliveries(periods.current, viewTZ, windowStartIso, today, "daily").map((b) => [
        b.start,
        b.firstPass + b.reworked,
      ]),
    );
    const series: number[] = [];
    let last = 0;
    for (let day = windowStartIso; day <= today; day = addDaysIso(day, 1)) {
      let cost = 0;
      let delivered = 0;
      for (let back = 0; back < 7; back++) {
        const d = addDaysIso(day, -back);
        cost += costByDay.get(d) ?? 0;
        delivered += deliveredByDay.get(d) ?? 0;
      }
      if (delivered > 0) last = cost / delivered;
      series.push(last);
    }
    return series;
  }, [dailyUsageInWindow, periods, viewTZ, windowStartIso, today]);

  // ---- Formatting ------------------------------------------------------------
  const lessThanMinuteLabel = t(($) => $.duration.less_than_minute);
  const percentFmt = new Intl.NumberFormat(locales, { style: "percent", maximumFractionDigits: 0 });
  const fmtPercent = (v: number | null) => (v === null ? "—" : percentFmt.format(v));
  const fmtMoney = (v: number | null) => (v === null ? "—" : `$${v.toFixed(2)}`);
  const fmtDuration = (v: number | null) =>
    v === null ? "—" : formatDuration(v, lessThanMinuteLabel);

  const unitCost = summary.delivered > 0 ? totals.cost / summary.delivered : null;
  const previousUnitCost =
    previousSummary.delivered > 0 && hasPreviousUsage
      ? previousTotals.cost / previousSummary.delivered
      : null;
  const runCost = runsInWindow > 0 ? totals.cost / runsInWindow : null;
  const previousRunCost =
    runsPrevious > 0 && hasPreviousUsage ? previousTotals.cost / runsPrevious : null;

  const deliveryDelta = (
    current: number | null,
    previous: number | null,
    format: (v: number | null) => string,
    tone: KpiDelta["tone"],
    points = false,
  ): KpiDelta => ({
    change: points ? pointChange(current, previous) : relativeChange(current, previous),
    points,
    tone,
    previous: hasPreviousDelivery && previous !== null ? format(previous) : null,
  });

  const agentName = (agentId: string) => {
    if (agentId === DELETED_AGENTS_ROW_ID) return t(($) => $.scorecard.deleted_agents);
    if (agentId === RESTRICTED_AGENTS_ROW_ID) return t(($) => $.scorecard.other_agents);
    return agents.find((a) => a.id === agentId)?.name ?? agentId;
  };

  const costLabel = (group: CostGroup, key: string) => {
    switch (group) {
      case "agent":
        return agentName(key);
      case "model":
        return key;
      case "runtime": {
        const runtime = runtimes.find((r) => r.id === key);
        return runtime ? runtimeDisplayLabel(runtime) : t(($) => $.cost.unknown_runtime);
      }
      case "project":
        if (!key) return t(($) => $.cost.no_project);
        return projects.find((p) => p.id === key)?.title ?? t(($) => $.cost.unknown_project);
    }
  };

  // ---- Drill-down ------------------------------------------------------------
  const openStage = (stage: DeliveryStage) =>
    setDrill({
      title: stageLabel(stage),
      issues: filterDeliveryIssues(periods.current, { kind: "stage", stage }, deliveryNow),
    });
  const openBounced = (agentId?: string) =>
    setDrill({
      title: agentId
        ? t(($) => $.drill.bounced_agent_title, { agent: agentName(agentId) })
        : t(($) => $.drill.bounced_title),
      issues: filterDeliveryIssues(periods.current, { kind: "bounced", agentId }, deliveryNow),
    });
  const openDelivered = (agentId: string) =>
    setDrill({
      title: t(($) => $.drill.delivered_agent_title, { agent: agentName(agentId) }),
      issues: filterDeliveryIssues(periods.current, { kind: "delivered", agentId }, deliveryNow),
    });
  const openInsight = (insight: DeliveryInsight) => {
    switch (insight.kind) {
      case "failure_spike":
        handleTabChange("reliability");
        return;
      case "review_backlog":
        setDrill({
          title: t(($) => $.drill.waiting_title),
          issues: filterDeliveryIssues(
            [...periods.current, ...periods.previous],
            { kind: "waiting_review" },
            deliveryNow,
          ),
        });
        return;
      case "low_first_pass":
        openBounced(insight.agentId);
        return;
      case "blocked":
        openStage("blocked");
        return;
    }
  };

  // ---- Loading / empty, per tab ------------------------------------------------
  const deliveryLoading = deliveryQuery.isLoading || dailyQuery.isLoading;
  const costLoading = dailyQuery.isLoading || runTimeDailyQuery.isLoading || breakdownQuery.isLoading;
  const errorsLoading = failuresDailyQuery.isLoading || failuresByAgentQuery.isLoading;
  const usageHasNoData =
    !costLoading && dailyUsage.length === 0 && runTimeDailyRows.length === 0;
  const deliveryHasNoData = !deliveryLoading && delivery.issues.length === 0 && usageHasNoData;

  const allowedDims = dimsForDays(days);
  const trend = useMemo(
    () => ({
      tz: viewTZ,
      firstDay: windowStartIso,
      lastDay: today,
      grain: days >= 30 ? ("weekly" as const) : ("daily" as const),
    }),
    [viewTZ, windowStartIso, today, days],
  );

  const deliveredKpi = (
    <AnalyticsKpi
      label={t(($) => $.overview.kpi_delivered)}
      value={
        <NumberFlow
          value={summary.delivered}
          locales={locales}
          format={{ maximumFractionDigits: 0 }}
        />
      }
      delta={deliveryDelta(summary.delivered, previousSummary.delivered, (v) => String(v ?? 0), "up_is_good")}
      sparkline={sparkDelivered}
      locales={locales}
    />
  );
  const cycleKpi = (
    <AnalyticsKpi
      label={t(($) => $.overview.kpi_cycle)}
      value={
        summary.medianCycleSeconds === null ? (
          "—"
        ) : (
          <DurationNumberFlow
            seconds={summary.medianCycleSeconds}
            lessThanMinuteLabel={lessThanMinuteLabel}
            locales={locales}
          />
        )
      }
      delta={deliveryDelta(
        summary.medianCycleSeconds,
        previousSummary.medianCycleSeconds,
        fmtDuration,
        "down_is_good",
      )}
      sparkline={sparkCycle}
      locales={locales}
    />
  );
  const unitCostKpi = (
    <AnalyticsKpi
      label={t(($) => $.overview.kpi_unit_cost)}
      value={
        unitCost === null ? "—" : <CurrencyNumberFlow value={unitCost} locales={locales} />
      }
      delta={{
        change: relativeChange(unitCost, previousUnitCost),
        tone: "down_is_good",
        previous: previousUnitCost === null ? null : fmtMoney(previousUnitCost),
      }}
      sparkline={sparkUnitCost}
      locales={locales}
    />
  );

  return (
    <Tabs
      value={tab}
      onValueChange={handleTabChange}
      className="flex h-full min-h-0 flex-col gap-0"
    >
      <CollectionPageHeader
        icon={BarChart3}
        title={t(($) => $.title)}
        actions={
          <div className="flex items-center gap-1">
            {tzLabel ? (
              <span className="hidden text-caption text-muted-foreground lg:inline">
                {updatedLabel
                  ? t(($) => $.header.timezone_and_updated, {
                      tz: tzLabel,
                      time: updatedLabel,
                    })
                  : tzLabel}
              </span>
            ) : null}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t(($) => $.header.refresh)}
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={isRefreshing ? "animate-spin" : undefined} />
            </Button>
          </div>
        }
      />

      {/* View switching on the left, the two page-scoped filters on the right —
          the same grammar as the issues toolbar. */}
      <div className={cn("h-12 shrink-0 overflow-x-auto border-b [-webkit-overflow-scrolling:touch]", PAGE_GUTTER)}>
        <div className="flex h-full w-max min-w-full items-center justify-between gap-2">
          <TabsList variant="line" className="gap-0 p-0 group-data-horizontal/tabs:h-full">
            {DASHBOARD_TABS.map((value) => (
              <TabsTrigger
                key={value}
                value={value}
                className="h-full rounded-none px-2.5 text-label group-data-horizontal/tabs:after:bottom-0"
              >
                {value === "overview"
                  ? t(($) => $.tabs.overview)
                  : value === "delivery"
                    ? t(($) => $.tabs.delivery)
                    : value === "cost"
                      ? t(($) => $.tabs.cost)
                      : t(($) => $.tabs.reliability)}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex shrink-0 items-center gap-2">
            <TimeRangeFilter days={days} onChange={setDays} />
            <ProjectFilter
              projects={projects}
              projectValue={projectValue}
              onProjectChange={setProjectValue}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl p-6">
          <TabsContent value="overview" className="space-y-5">
            {deliveryLoading ? (
              <DashboardSkeleton />
            ) : deliveryHasNoData ? (
              <DashboardEmpty />
            ) : (
              <>
                <KpiRow>
                  {deliveredKpi}
                  <AnalyticsKpi
                    label={t(($) => $.overview.kpi_first_pass)}
                    value={
                      summary.firstPassRate === null ? (
                        "—"
                      ) : (
                        <>
                          <NumberFlow
                            value={Math.round(summary.firstPassRate * 100)}
                            locales={locales}
                            format={{ maximumFractionDigits: 0 }}
                          />
                          <KpiUnit>%</KpiUnit>
                        </>
                      )
                    }
                    delta={deliveryDelta(
                      summary.firstPassRate,
                      previousSummary.firstPassRate,
                      fmtPercent,
                      "up_is_good",
                      true,
                    )}
                    sparkline={sparkFirstPass}
                    locales={locales}
                  />
                  {cycleKpi}
                  {unitCostKpi}
                </KpiRow>
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                  <FunnelCard
                    className="lg:col-span-2"
                    summary={summary}
                    locales={locales}
                    onOpenStage={openStage}
                    onOpenBounced={() => openBounced()}
                  />
                  <InsightsCard
                    insights={insights}
                    agentName={agentName}
                    locales={locales}
                    onOpen={openInsight}
                  />
                </div>
                <Scorecard
                  rows={agentRows}
                  team={summary}
                  costByAgent={costByAgent}
                  teamCost={totals.cost}
                  issues={periods.current}
                  trend={trend}
                  agentName={agentName}
                  lessThanMinuteLabel={lessThanMinuteLabel}
                  locales={locales}
                  onOpenDelivered={openDelivered}
                  onOpenBounced={openBounced}
                />
              </>
            )}
          </TabsContent>

          <TabsContent value="delivery" className="space-y-5">
            {deliveryLoading ? (
              <DashboardSkeleton />
            ) : deliveryHasNoData ? (
              <DashboardEmpty />
            ) : (
              <>
                <KpiRow>
                  {deliveredKpi}
                  <AnalyticsKpi
                    label={t(($) => $.delivery.kpi_accepted)}
                    value={
                      <NumberFlow
                        value={summary.accepted}
                        locales={locales}
                        format={{ maximumFractionDigits: 0 }}
                      />
                    }
                    delta={deliveryDelta(
                      summary.accepted,
                      previousSummary.accepted,
                      (v) => String(v ?? 0),
                      "up_is_good",
                    )}
                    locales={locales}
                  />
                  {cycleKpi}
                  <AnalyticsKpi
                    label={t(($) => $.delivery.kpi_review)}
                    value={
                      summary.medianReviewSeconds === null ? (
                        "—"
                      ) : (
                        <DurationNumberFlow
                          seconds={summary.medianReviewSeconds}
                          lessThanMinuteLabel={lessThanMinuteLabel}
                          locales={locales}
                        />
                      )
                    }
                    delta={deliveryDelta(
                      summary.medianReviewSeconds,
                      previousSummary.medianReviewSeconds,
                      fmtDuration,
                      "down_is_good",
                    )}
                    locales={locales}
                  />
                </KpiRow>
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                  <DeliveredChartCard
                    className="lg:col-span-2"
                    issues={periods.current}
                    summary={summary}
                    tz={viewTZ}
                    firstDay={windowStartIso}
                    lastDay={today}
                    allowedDims={allowedDims}
                  />
                  <SourcesCard rows={sources} locales={locales} />
                </div>
                <TimeBreakdownCard
                  team={summary}
                  agentRows={agentRows}
                  agentSummaries={agentSummaries}
                  agentName={agentName}
                  lessThanMinuteLabel={lessThanMinuteLabel}
                />
              </>
            )}
          </TabsContent>

          <TabsContent value="cost" className="space-y-5">
            {costLoading ? (
              <DashboardSkeleton />
            ) : usageHasNoData ? (
              <DashboardEmpty />
            ) : (
              <>
                <KpiRow>
                  <AnalyticsKpi
                    label={t(($) => $.cost.kpi_total)}
                    value={<CurrencyNumberFlow value={totals.cost} locales={locales} />}
                    delta={{
                      change: relativeChange(totals.cost, hasPreviousUsage ? previousTotals.cost : null),
                      tone: "neutral",
                      previous: hasPreviousUsage ? fmtMoney(previousTotals.cost) : null,
                    }}
                    locales={locales}
                  />
                  {unitCostKpi}
                  <AnalyticsKpi
                    label={t(($) => $.cost.kpi_run)}
                    value={
                      runCost === null ? "—" : <CurrencyNumberFlow value={runCost} locales={locales} />
                    }
                    delta={{
                      change: relativeChange(runCost, previousRunCost),
                      tone: "down_is_good",
                      previous: previousRunCost === null ? null : fmtMoney(previousRunCost),
                    }}
                    locales={locales}
                  />
                  <AnalyticsKpi
                    label={t(($) => $.cost.kpi_tokens)}
                    value={
                      <CompactNumberFlow
                        value={totals.input + totals.output + totals.cacheRead + totals.cacheWrite}
                        locales={locales}
                      />
                    }
                    hint={t(($) => $.cost.tokens_hint, {
                      input: formatTokens(totals.input),
                      output: formatTokens(totals.output),
                    })}
                    locales={locales}
                  />
                </KpiRow>
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                  <div className="lg:col-span-2">
                    <UsageTrendCard
                      allowedDims={allowedDims}
                      dailyCost={dailyCost}
                      dailyTokens={dailyTokens}
                      dailyTime={dailyTime}
                      dailyTasks={dailyTasks}
                      weeklyCost={weekly.weeklyCostStack}
                      weeklyTokens={weekly.weeklyTokens}
                      weeklyTime={weeklyTime}
                      weeklyTasks={weeklyTasks}
                      lessThanMinuteLabel={lessThanMinuteLabel}
                    />
                  </div>
                  <UnitCostCard
                    rows={[...costByAgent.entries()].map(([agentId, cost]) => ({
                      agentId,
                      name: agentName(agentId),
                      cost,
                      delivered: agentRows.find((r) => r.agentId === agentId)?.delivered ?? 0,
                    }))}
                  />
                </div>
                <CostBreakdownCard rows={foldedBreakdown} labelFor={costLabel} locales={locales} />
              </>
            )}
          </TabsContent>

          <TabsContent value="reliability">
            {errorsLoading ? (
              <DashboardSkeleton />
            ) : (
              <ErrorsTab
                days={days}
                allowedDims={allowedDims}
                totals={failureTotals}
                classRows={failureClassRows}
                reasonRows={failureReasonRows}
                agentRows={agentFailureRows}
                dailyErrors={dailyErrors}
                weeklyErrors={weeklyErrors}
                agents={agents}
                locales={locales}
              />
            )}
          </TabsContent>
        </div>
      </div>

      <DeliveryIssuesSheet
        drill={drill}
        onOpenChange={(open) => {
          if (!open) setDrill(null);
        }}
      />
    </Tabs>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-28 rounded-lg" />
      <Skeleton className="h-56 rounded-lg" />
      <Skeleton className="h-48 rounded-lg" />
    </div>
  );
}

function DashboardEmpty() {
  const { t } = useT("usage");
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed py-12 text-center">
      <BarChart3 className="h-6 w-6 text-faint-foreground" />
      <p className="mt-3 text-body font-medium">{t(($) => $.empty.title)}</p>
      <p className="mt-1 max-w-md text-caption text-muted-foreground">
        {t(($) => $.empty.body)}
      </p>
    </div>
  );
}
