"use client";

import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Filter,
  X,
} from "lucide-react";
import { ALL_ACCESS_SCOPES, effectiveAccessScope } from "@multica/core/agents";
import type { MemberWithUser } from "@multica/core/types";
import { runtimeDisplayLabel } from "@multica/core/runtimes";
import { resolvePublicFileUrl } from "@multica/core/workspace/avatar-url";
import {
  AGENT_COLUMN_KEYS,
  AGENT_SCOPES,
  type AgentColumnKey,
  type AgentGroupBy,
  type AgentListFilters,
  type AgentsScope,
  type AgentSortDirection,
  type AgentSortField,
} from "@multica/core/agents/stores";
import { Button } from "@multica/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@multica/ui/components/ui/popover";
import { Switch } from "@multica/ui/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@multica/ui/components/ui/tooltip";
import { ActorAvatar } from "@multica/ui/components/common/actor-avatar";
import { FILTER_ITEM_CLASS, HoverCheck } from "../../common/hover-check";
import { useT } from "../../i18n";
import { ScopeToggle, StatusSummaryTabs } from "../../layout/status-summary";
import type { AgentListRow } from "./agents-page";
import { PAGE_GUTTER } from "../../layout/page-header";
import { cn } from "@multica/ui/lib/utils";

const SORT_FIELDS: AgentSortField[] = [
  "lastActive",
  "name",
  "runs",
  "created",
];

/** Status tabs above the list: "all" plus the four list statuses. */
export type AgentStatusTab = "all" | "attention" | "working" | "idle" | "offline";

const STATUS_TABS: AgentStatusTab[] = [
  "all",
  "attention",
  "working",
  "idle",
  "offline",
];

export function countActiveFilterDimensions(
  filters: AgentListFilters,
): number {
  let count = 0;
  if (filters.runtimes.length > 0) count++;
  if (filters.owners.length > 0) count++;
  if (filters.models.length > 0) count++;
  if (filters.access.length > 0) count++;
  return count;
}

const ACCESS_SCOPES = ALL_ACCESS_SCOPES;

export function AgentListToolbar({
  statusTabs,
  scope,
  onScopeChange,
  scopeCounts,
  groupBy,
  onGroupByChange,
  filters,
  onToggleFilter,
  onClearFilters,
  sortField,
  sortDirection,
  onSortFieldChange,
  onSortDirectionChange,
  hiddenColumns,
  onToggleColumn,
  allRows,
  members,
}: {
  /** Absent in the archived scope, where every row shares one status. */
  statusTabs: {
    value: AgentStatusTab;
    onChange: (value: AgentStatusTab) => void;
    counts: Record<AgentStatusTab, number>;
    labels: Record<AgentStatusTab, string>;
  } | null;
  scope: AgentsScope;
  onScopeChange: (scope: AgentsScope) => void;
  /** Per-scope totals from the FULL set — scope counts ignore filters. */
  scopeCounts: Record<AgentsScope, number>;
  groupBy: AgentGroupBy;
  /** Null when grouping doesn't apply (archived scope). */
  onGroupByChange: ((groupBy: AgentGroupBy) => void) | null;
  filters: AgentListFilters;
  onToggleFilter: (key: keyof AgentListFilters, value: string) => void;
  onClearFilters: () => void;
  sortField: AgentSortField;
  sortDirection: AgentSortDirection;
  onSortFieldChange: (field: AgentSortField) => void;
  onSortDirectionChange: (direction: AgentSortDirection) => void;
  hiddenColumns: AgentColumnKey[];
  onToggleColumn: (key: AgentColumnKey) => void;
  /** Rows within the current scope, unfiltered — filter option lists and
   *  counts derive from this set. */
  allRows: AgentListRow[];
  members: MemberWithUser[];
}) {
  const { t } = useT("agents");

  const activeCount = countActiveFilterDimensions(filters);
  const hasActiveFilters = activeCount > 0;

  // Option lists with counts, derived from the scope's unfiltered rows so
  // toggling one dimension doesn't make the others' options vanish.
  const runtimeOptions = new Map<string, { name: string; count: number }>();
  const accessCounts = new Map<string, number>();
  for (const row of allRows) {
    const rt = row.runtime;
    if (rt) {
      const entry = runtimeOptions.get(rt.id);
      if (entry) entry.count += 1;
      else runtimeOptions.set(rt.id, { name: runtimeDisplayLabel(rt), count: 1 });
    }
    const a = effectiveAccessScope(row.agent.permission_mode, row.agent.invocation_targets);
    accessCounts.set(a, (accessCounts.get(a) ?? 0) + 1);
  }

  // Owner options: members who own at least one agent in the current scope.
  const memberById = new Map(members.map((m) => [m.user_id, m]));
  const ownerCounts = new Map<string, number>();
  const modelCounts = new Map<string, number>();
  for (const row of allRows) {
    const oid = row.agent.owner_id;
    if (oid) ownerCounts.set(oid, (ownerCounts.get(oid) ?? 0) + 1);
    const model = row.agent.model;
    if (model) modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
  }

  const SCOPE_LABELS: Record<AgentsScope, string> = {
    mine: t(($) => $.scope.mine),
    all: t(($) => $.scope.all),
    archived: t(($) => $.scope.archived),
  };

  const SORT_LABELS: Record<AgentSortField, string> = {
    lastActive: t(($) => $.columns.last_active),
    name: t(($) => $.columns.agent),
    runs: t(($) => $.columns.runs),
    created: t(($) => $.columns.created),
  };

  const COLUMN_LABELS: Record<AgentColumnKey, string> = {
    status: t(($) => $.columns.now),
    runtime: t(($) => $.columns.runtime),
    activity: t(($) => $.columns.activity_7d),
    owner: t(($) => $.columns.owner),
    access: t(($) => $.columns.access),
    model: t(($) => $.columns.model),
    created: t(($) => $.columns.created),
  };
  const GROUP_LABELS: Record<AgentGroupBy, string> = {
    status: t(($) => $.list.group.status),
    none: t(($) => $.list.group.none),
  };
  const sortLabel = SORT_LABELS[sortField];

  const countBadge = (n: number) => (
    <span className="ml-auto pl-3 text-caption text-muted-foreground">{n}</span>
  );

  return (
    <div className={cn("h-12 shrink-0 overflow-x-auto [-webkit-overflow-scrolling:touch]", PAGE_GUTTER)}>
      <div className="flex h-full w-max min-w-full items-center justify-between gap-2">
        {/* Left: the status tabs summarise the list and filter it. */}
      <div className="flex min-w-0 items-center gap-2">
        {statusTabs ? (
          <StatusSummaryTabs
            items={STATUS_TABS.map((key) => ({
              key,
              label: statusTabs.labels[key],
              count: statusTabs.counts[key],
              tone: key === "all" ? undefined : key,
            }))}
            value={statusTabs.value}
            onChange={statusTabs.onChange}
            ariaLabel={t(($) => $.list.status_aria)}
          />
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {/* Scope mixes the ownership lens (mine/all) with the archived
            lifecycle stage. */}
        <ScopeToggle
          options={AGENT_SCOPES.map((key) => ({
            key,
            label: SCOPE_LABELS[key],
            count: scopeCounts[key],
          }))}
          value={scope}
          onChange={onScopeChange}
        />

        {onGroupByChange ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="hidden shrink-0 gap-1 text-muted-foreground md:inline-flex"
                >
                  {t(($) => $.list.group_by)}
                  <span className="font-medium text-foreground">
                    {GROUP_LABELS[groupBy]}
                  </span>
                  <ChevronDown className="size-3 text-muted-foreground" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-auto">
              <DropdownMenuRadioGroup
                value={groupBy}
                onValueChange={(value) =>
                  onGroupByChange(value as AgentGroupBy)
                }
              >
                {(["status", "none"] as const).map((value) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {GROUP_LABELS[value]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        {/* Filter */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant={hasActiveFilters ? "default" : "outline"}
                size="sm"
                className={
                  hasActiveFilters
                    ? "h-8 w-8 gap-1 bg-brand px-0 text-white hover:bg-brand/90 md:w-auto md:px-2.5"
                    : "h-8 w-8 gap-1 px-0 text-muted-foreground md:w-auto md:px-2.5"
                }
              >
                <Filter className="size-3.5" />
                {hasActiveFilters ? (
                  <>
                    <span className="hidden md:inline">
                      {t(($) => $.toolbar.filter_active_count, {
                        count: activeCount,
                      })}
                    </span>
                    <span className="tabular-nums md:hidden">
                      {activeCount}
                    </span>
                  </>
                ) : (
                  <span className="hidden md:inline">
                    {t(($) => $.toolbar.filter_label)}
                  </span>
                )}
                {hasActiveFilters && (
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={t(($) => $.toolbar.clear_filters)}
                    className="-mr-1 ml-0.5 hidden rounded-sm p-0.5 hover:bg-white/20 md:inline-flex"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onClearFilters();
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <X className="size-3" />
                  </span>
                )}
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-auto">
            {/* Access — effective access scope (workspace / specific-people / owner-only).
                Mirrors Availability's keyboard/ARIA pattern. */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span className="flex-1">
                  {t(($) => $.toolbar.section_access)}
                </span>
                {filters.access.length > 0 && (
                  <span className="text-caption font-medium text-primary">
                    {filters.access.length}
                  </span>
                )}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-auto min-w-44">
                {ACCESS_SCOPES.map((value) => (
                  <DropdownMenuCheckboxItem
                    key={value}
                    checked={filters.access.includes(value)}
                    onCheckedChange={() => onToggleFilter("access", value)}
                    className={FILTER_ITEM_CLASS}
                  >
                    <HoverCheck checked={filters.access.includes(value)} />
                    <span className="min-w-0 truncate">
                      {t(($) =>
                        value === "workspace"
                          ? $.access.scope_labels.workspace
                          : value === "specific-people"
                            ? $.access.scope_labels.specific_people
                            : $.access.scope_labels.owner_only,
                      )}
                    </span>
                    {countBadge(accessCounts.get(value) ?? 0)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            {/* Runtime */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span className="flex-1">
                  {t(($) => $.toolbar.section_runtime)}
                </span>
                {filters.runtimes.length > 0 && (
                  <span className="text-caption font-medium text-primary">
                    {filters.runtimes.length}
                  </span>
                )}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 w-auto min-w-48 overflow-y-auto">
                {[...runtimeOptions.entries()].map(([id, { name, count }]) => (
                  <DropdownMenuCheckboxItem
                    key={id}
                    checked={filters.runtimes.includes(id)}
                    onCheckedChange={() => onToggleFilter("runtimes", id)}
                    className={FILTER_ITEM_CLASS}
                  >
                    <HoverCheck checked={filters.runtimes.includes(id)} />
                    <span className="min-w-0 truncate">{name}</span>
                    {countBadge(count)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            {/* Owner — the same person-axis as the Mine scope. Picking an
                owner here leaves the clean "mine" view for "all" (store
                rule), so Mine + owner never coexist. */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span className="flex-1">
                  {t(($) => $.toolbar.section_owner)}
                </span>
                {filters.owners.length > 0 && (
                  <span className="text-caption font-medium text-primary">
                    {filters.owners.length}
                  </span>
                )}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 w-auto min-w-48 overflow-y-auto">
                {[...ownerCounts.entries()].map(([userId, count]) => {
                  const m = memberById.get(userId);
                  return (
                    <DropdownMenuCheckboxItem
                      key={userId}
                      checked={filters.owners.includes(userId)}
                      onCheckedChange={() => onToggleFilter("owners", userId)}
                      className={FILTER_ITEM_CLASS}
                    >
                      <HoverCheck checked={filters.owners.includes(userId)} />
                      <ActorAvatar
                        name={m?.name ?? userId.slice(0, 8)}
                        initials={(m?.name ?? "?").slice(0, 2).toUpperCase()}
                        avatarUrl={resolvePublicFileUrl(m?.avatar_url ?? null)}
                        size="sm"
                      />
                      <span className="min-w-0 truncate">
                        {m?.name ?? userId.slice(0, 8)}
                      </span>
                      {countBadge(count)}
                    </DropdownMenuCheckboxItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            {/* Model — runtime-native model id (categorical column → filter) */}
            {modelCounts.size > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <span className="flex-1">
                    {t(($) => $.toolbar.section_model)}
                  </span>
                  {filters.models.length > 0 && (
                    <span className="text-caption font-medium text-primary">
                      {filters.models.length}
                    </span>
                  )}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-72 w-auto min-w-44 overflow-y-auto">
                  {[...modelCounts.entries()].map(([model, count]) => (
                    <DropdownMenuCheckboxItem
                      key={model}
                      checked={filters.models.includes(model)}
                      onCheckedChange={() => onToggleFilter("models", model)}
                      className={FILTER_ITEM_CLASS}
                    >
                      <HoverCheck checked={filters.models.includes(model)} />
                      <span className="min-w-0 truncate">{model}</span>
                      {countBadge(count)}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Display settings */}
        <Popover>
          <Tooltip>
            <PopoverTrigger
              render={
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 gap-1 px-0 text-muted-foreground md:w-auto md:px-2.5"
                    >
                      {sortDirection === "asc" ? (
                        <ArrowUp className="size-3.5" />
                      ) : (
                        <ArrowDown className="size-3.5" />
                      )}
                      <span className="hidden md:inline">{sortLabel}</span>
                    </Button>
                  }
                />
              }
            />
            <TooltipContent side="bottom">
              {t(($) => $.toolbar.display)}
            </TooltipContent>
          </Tooltip>
          <PopoverContent align="end" className="w-64 p-0">
            <div className="border-b px-3 py-2.5">
              <span className="text-caption font-medium text-muted-foreground">
                {t(($) => $.toolbar.sort_by)}
              </span>
              <div className="mt-2 flex items-center gap-1.5">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 justify-between text-caption"
                      >
                        {sortLabel}
                        <ChevronDown className="size-3 text-muted-foreground" />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="start" className="w-auto">
                    <DropdownMenuRadioGroup
                      value={sortField}
                      onValueChange={(v) =>
                        onSortFieldChange(v as AgentSortField)
                      }
                    >
                      {SORT_FIELDS.map((field) => (
                        <DropdownMenuRadioItem key={field} value={field}>
                          {SORT_LABELS[field]}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={() =>
                    onSortDirectionChange(
                      sortDirection === "asc" ? "desc" : "asc",
                    )
                  }
                  title={
                    sortDirection === "asc"
                      ? t(($) => $.toolbar.direction_asc)
                      : t(($) => $.toolbar.direction_desc)
                  }
                >
                  {sortDirection === "asc" ? (
                    <ArrowUp className="size-3.5" />
                  ) : (
                    <ArrowDown className="size-3.5" />
                  )}
                </Button>
              </div>
            </div>

            <div className="px-3 py-2.5">
              <span className="text-caption font-medium text-muted-foreground">
                {t(($) => $.toolbar.section_columns)}
              </span>
              <div className="mt-2 space-y-2">
                {AGENT_COLUMN_KEYS.map((key) => (
                  <label
                    key={key}
                    className="flex cursor-pointer items-center justify-between"
                  >
                    <span className="text-body">{COLUMN_LABELS[key]}</span>
                    <Switch
                      size="sm"
                      checked={!hiddenColumns.includes(key)}
                      onCheckedChange={() => onToggleColumn(key)}
                    />
                  </label>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      </div>
    </div>
  );
}
