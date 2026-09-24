"use client";

import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  ChevronDown,
  CircleDashed,
  Clock3,
  Info,
  MessageSquare,
  Plus,
  RefreshCw,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useCreateIssueWakeup } from "@multica/core/issues";
import { isAgentRuntimeBound } from "@multica/core/agents";
import { ApiError } from "@multica/core/api";
import { agentListOptions, memberListOptions } from "@multica/core/workspace/queries";
import { shortcutMatchesEvent, useShortcut } from "@multica/core/shortcuts";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Textarea } from "@multica/ui/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@multica/ui/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { cn } from "@multica/ui/lib/utils";
import { ActorAvatar } from "../../common/actor-avatar";
import { ShortcutKeycaps } from "../../common/shortcut-keycaps";
import { useViewingTimezone } from "../../common/use-viewing-timezone";
import { useT } from "../../i18n";
import { matchesPinyin } from "../../editor/extensions/pinyin-match";
import { PickerEmpty, PickerItem, PickerSection, PropertyPicker } from "./pickers/property-picker";
import { useWakeupText } from "./wakeup-presentation";
import {
  WAKEUP_EVENT_TYPES,
  WAKEUP_WAIT_DAYS,
  buildWakeupInput,
  emptyWakeupDraft,
  isEventCondition,
  type WakeupAtPreset,
  type WakeupCondition,
  type WakeupDraft,
  type WakeupDraftError,
  type WakeupRecurrence,
} from "./wakeup-draft";

const pillClass =
  "inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md border border-surface-border bg-surface px-2 text-label outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-accent [&_svg]:shrink-0";

/**
 * Lets a member add a wakeup from the issue sidebar. It creates the same rule
 * an agent creates with `multica issue wakeup create`.
 */
export function WakeupCreate({
  workspaceId,
  issueId,
  defaultAgentId,
}: {
  workspaceId: string;
  issueId: string;
  defaultAgentId?: string;
}) {
  const { t } = useT("issues");
  const [open, setOpen] = useState(false);
  const busy = useRef(false);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!busy.current) setOpen(next);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            aria-label={t(($) => $.wakeups.create.open)}
          />
        }
      >
        <Plus aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="start"
        sideOffset={12}
        className="w-[420px] max-w-[calc(100vw-2rem)] gap-0 p-4"
      >
        {open && (
          <WakeupCreateForm
            workspaceId={workspaceId}
            issueId={issueId}
            defaultAgentId={defaultAgentId ?? ""}
            onBusy={(value) => (busy.current = value)}
            onClose={() => setOpen(false)}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

export function WakeupCreateForm({
  workspaceId,
  issueId,
  defaultAgentId,
  onBusy,
  onClose,
}: {
  workspaceId: string;
  issueId: string;
  defaultAgentId: string;
  onBusy?: (busy: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useT("issues");
  const text = useWakeupText();
  const timezone = useViewingTimezone();
  const id = useId();
  const [draft, setDraft] = useState(() => emptyWakeupDraft(defaultAgentId, timezone));
  const [error, setError] = useState("");
  const create = useCreateIssueWakeup(workspaceId, issueId);
  const sendShortcut = useShortcut("send");
  const { data: agents = [] } = useQuery(agentListOptions(workspaceId));
  const update = (patch: Partial<WakeupDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setError("");
  };
  const agentName = agents.find((a) => a.id === draft.agentId)?.name;
  const draftErrors: Record<WakeupDraftError, string> = {
    missing_condition: t(($) => $.wakeups.create.missing_condition),
    missing_agent: t(($) => $.wakeups.create.missing_agent),
    missing_events: t(($) => $.wakeups.create.missing_events),
    instruction_invalid: t(($) => $.wakeups.instruction_invalid),
    future_time: t(($) => $.wakeups.future_time),
    until_future: t(($) => $.wakeups.create.until_future),
  };

  const submit = async () => {
    if (create.isPending) return;
    const result = buildWakeupInput(draft);
    if ("error" in result) {
      setError(draftErrors[result.error]);
      return;
    }
    onBusy?.(true);
    try {
      await create.mutateAsync(result.input);
      onClose();
    } catch (err) {
      const code =
        err instanceof ApiError && err.body && typeof err.body === "object" && "code" in err.body
          ? err.body.code
          : undefined;
      setError(
        code === "wakeup_capacity_exceeded"
          ? t(($) => $.wakeups.create.capacity_error)
          : text.error(err, t(($) => $.wakeups.create.error)),
      );
    } finally {
      onBusy?.(false);
    }
  };

  return (
    <form
      aria-labelledby={`${id}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if (sendShortcut && shortcutMatchesEvent(sendShortcut, event.nativeEvent) && !event.nativeEvent.isComposing) {
          event.preventDefault();
          void submit();
        }
      }}
    >
      <PopoverTitle id={`${id}-title`} className="text-title-sm font-semibold">
        {t(($) => $.wakeups.create.title)}
      </PopoverTitle>
      <div className="mt-3.5 grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-y-2.5">
        <span className="text-label text-muted-foreground">{t(($) => $.wakeups.create.when)}</span>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <ConditionMenu value={draft.condition} onChange={(condition) => update({ condition })} />
          <ConditionParams draft={draft} workspaceId={workspaceId} update={update} />
        </div>
        <span className="text-label text-muted-foreground">{t(($) => $.wakeups.create.wake)}</span>
        <div className="flex min-w-0 items-center gap-1.5">
          <AgentChoice
            workspaceId={workspaceId}
            value={draft.agentId}
            onChange={(agentId) => update({ agentId })}
            placeholder={t(($) => $.wakeups.create.choose_agent)}
          />
        </div>
      </div>
      {draft.condition === "at" && draft.atPreset === "custom" && (
        <Input
          type="datetime-local"
          aria-label={t(($) => $.wakeups.local_time, { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
          className="mt-2.5"
          value={draft.atCustom}
          onChange={(event) => update({ atCustom: event.target.value })}
        />
      )}
      <label htmlFor={`${id}-instruction`} className="mt-4 mb-1.5 block text-caption font-medium">
        {t(($) => $.wakeups.instruction_title)}
      </label>
      <Textarea
        id={`${id}-instruction`}
        rows={3}
        value={draft.instruction}
        placeholder={t(($) => $.wakeups.create.instruction_placeholder)}
        className="max-h-[30dvh] resize-y text-base md:text-label"
        onChange={(event) => update({ instruction: event.target.value })}
      />
      {draft.condition === "recurring" && (
        <div className="mt-4 grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-y-2.5">
          <label htmlFor={`${id}-until`} className="text-caption text-muted-foreground">
            {t(($) => $.wakeups.create.until)}
          </label>
          <Input
            id={`${id}-until`}
            type="date"
            className="h-7 w-44"
            value={draft.until}
            onChange={(event) => update({ until: event.target.value })}
          />
        </div>
      )}
      {isEventCondition(draft.condition) && (
        <div className="mt-4 grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-y-2.5">
          <span className="text-caption text-muted-foreground">{t(($) => $.wakeups.create.trigger_count)}</span>
          <Segmented
            label={t(($) => $.wakeups.create.trigger_count)}
            value={draft.mode}
            options={[
              { value: "once", label: t(($) => $.wakeups.once) },
              { value: "continuous", label: t(($) => $.wakeups.continuous) },
            ]}
            onChange={(mode) => update({ mode })}
          />
          <span className="text-caption text-muted-foreground">{t(($) => $.wakeups.create.max_wait)}</span>
          <div className="flex min-w-0">
            <PillMenu
              label={t(($) => $.wakeups.create.max_wait)}
              value={String(draft.waitDays)}
              options={WAKEUP_WAIT_DAYS.map((days) => ({
                value: String(days),
                label: t(($) => $.wakeups.create.wait_days, { count: days }),
              }))}
              onChange={(value) => update({ waitDays: Number(value) })}
            />
          </div>
          <span className="text-caption text-muted-foreground">{t(($) => $.wakeups.create.on_timeout)}</span>
          <div className="flex min-w-0">
            <PillMenu
              label={t(($) => $.wakeups.create.on_timeout)}
              value={draft.onTimeout}
              options={[
                {
                  value: "wake",
                  label: t(($) => $.wakeups.create.timeout_wake, {
                    agent: agentName ?? t(($) => $.wakeups.create.the_agent),
                  }),
                },
                { value: "end", label: t(($) => $.wakeups.create.timeout_end) },
              ]}
              onChange={(value) => update({ onTimeout: value as WakeupDraft["onTimeout"] })}
            />
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-caption text-destructive">
          {error}
        </p>
      )}
      <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
        <span className="flex min-w-0 flex-1 items-center gap-1 text-caption text-muted-foreground">
          <Info className="size-3 shrink-0" aria-hidden="true" />
          {t(($) => $.wakeups.create.on_behalf)}
        </span>
        <Button type="button" variant="ghost" size="sm" disabled={create.isPending} onClick={onClose}>
          {t(($) => $.wakeups.create.cancel)}
        </Button>
        <Button type="submit" size="sm" disabled={create.isPending} aria-busy={create.isPending}>
          {t(($) => (create.isPending ? $.wakeups.create.submitting : $.wakeups.create.submit))}
          {sendShortcut && !create.isPending ? (
            <ShortcutKeycaps
              shortcut={sendShortcut}
              decorative
              className="ml-1 max-sm:hidden"
              keyClassName="border-background/30 bg-background/15 text-primary-foreground shadow-none"
            />
          ) : null}
        </Button>
      </div>
    </form>
  );
}

function ConditionMenu({
  value,
  onChange,
}: {
  value: WakeupCondition | null;
  onChange: (value: WakeupCondition) => void;
}) {
  const { t } = useT("issues");
  const items: Record<WakeupCondition, { icon: LucideIcon; label: string; hint: string }> = {
    at: { icon: Clock3, label: t(($) => $.wakeups.create.cond_at), hint: t(($) => $.wakeups.create.cond_at_hint) },
    recurring: { icon: RefreshCw, label: t(($) => $.wakeups.create.cond_recurring), hint: t(($) => $.wakeups.create.cond_recurring_hint) },
    reply: { icon: MessageSquare, label: t(($) => $.wakeups.create.cond_reply), hint: t(($) => $.wakeups.create.cond_reply_hint) },
    run_end: { icon: Bot, label: t(($) => $.wakeups.create.cond_run_end), hint: t(($) => $.wakeups.create.cond_run_end_hint) },
    custom: { icon: Zap, label: t(($) => $.wakeups.create.cond_custom), hint: t(($) => $.wakeups.create.cond_custom_hint, { count: WAKEUP_EVENT_TYPES.length }) },
  };
  const groups: [string, WakeupCondition[]][] = [
    [t(($) => $.wakeups.create.group_time), ["at", "recurring"]],
    [t(($) => $.wakeups.create.group_collaboration), ["reply"]],
    [t(($) => $.wakeups.create.group_runs), ["run_end"]],
  ];
  const selected = value ? items[value] : null;
  const SelectedIcon = selected?.icon ?? CircleDashed;
  const option = (key: WakeupCondition) => {
    const Icon = items[key].icon;
    return (
      <DropdownMenuItem key={key} onClick={() => onChange(key)} className="gap-2 py-1.5">
        <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span>{items[key].label}</span>
        <span className="ml-auto pl-4 text-caption text-muted-foreground">{items[key].hint}</span>
      </DropdownMenuItem>
    );
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<button type="button" className={cn(pillClass, !value && "border-ring")} />}
      >
        <SelectedIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected?.label ?? t(($) => $.wakeups.create.choose_condition)}
        </span>
        <ChevronDown className="size-3 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[22rem]">
        {groups.map(([label, keys]) => (
          <DropdownMenuGroup key={label}>
            <DropdownMenuLabel>{label}</DropdownMenuLabel>
            {keys.map(option)}
          </DropdownMenuGroup>
        ))}
        <DropdownMenuSeparator />
        {option("custom")}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ConditionParams({
  draft,
  workspaceId,
  update,
}: {
  draft: WakeupDraft;
  workspaceId: string;
  update: (patch: Partial<WakeupDraft>) => void;
}) {
  const { t } = useT("issues");
  const text = useWakeupText();
  switch (draft.condition) {
    case "at":
      return (
        <PillMenu
          label={t(($) => $.wakeups.create.cond_at)}
          value={draft.atPreset}
          options={[
            { value: "10m", label: t(($) => $.wakeups.create.at_10m) },
            { value: "1h", label: t(($) => $.wakeups.create.at_1h) },
            { value: "tomorrow", label: t(($) => $.wakeups.create.at_tomorrow) },
            { value: "custom", label: t(($) => $.wakeups.create.at_custom) },
          ]}
          onChange={(atPreset) => update({ atPreset: atPreset as WakeupAtPreset })}
        />
      );
    case "recurring":
      return (
        <PillMenu
          label={t(($) => $.wakeups.create.cond_recurring)}
          value={draft.recurrence}
          options={[
            { value: "hourly", label: t(($) => $.wakeups.create.hourly) },
            { value: "daily", label: t(($) => $.wakeups.create.daily) },
            { value: "weekdays", label: t(($) => $.wakeups.create.weekdays) },
          ]}
          onChange={(recurrence) => update({ recurrence: recurrence as WakeupRecurrence })}
        />
      );
    case "reply":
      return <ActorChoice workspaceId={workspaceId} value={draft.replyActor} onChange={(replyActor) => update({ replyActor })} />;
    case "run_end":
      return (
        <AgentChoice
          workspaceId={workspaceId}
          value={draft.runAgentId}
          onChange={(runAgentId) => update({ runAgentId })}
          placeholder={t(($) => $.wakeups.create.any_agent)}
          allowAny
        />
      );
    case "custom":
      return (
        <DropdownMenu>
          <DropdownMenuTrigger render={<button type="button" className={pillClass} />}>
            <span className={cn(draft.events.length === 0 && "text-muted-foreground")}>
              {t(($) => $.wakeups.create.events_selected, { count: draft.events.length })}
            </span>
            <ChevronDown className="size-3 text-muted-foreground" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-80 w-80">
            {WAKEUP_EVENT_TYPES.map((event) => (
              <DropdownMenuCheckboxItem
                key={event}
                checked={draft.events.includes(event)}
                closeOnClick={false}
                onCheckedChange={(checked) =>
                  update({
                    events: checked
                      ? WAKEUP_EVENT_TYPES.filter((e) => e === event || draft.events.includes(e))
                      : draft.events.filter((e) => e !== event),
                  })
                }
              >
                {text.eventName(event)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    default:
      return null;
  }
}

function PillMenu({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const current = options.find((option) => option.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<button type="button" className={pillClass} aria-label={`${label}: ${current?.label ?? ""}`} />}>
        <span className="truncate">{current?.label}</span>
        <ChevronDown className="size-3 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(String(next))}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-fit gap-0.5 rounded-lg bg-muted p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-6 rounded-md px-2.5 text-caption text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            value === option.value && "bg-surface font-medium text-foreground shadow-[var(--surface-shadow)]",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function useMatches() {
  const [filter, setFilter] = useState("");
  const query = filter.trim().toLowerCase();
  const matches = (name: string) => !query || name.toLowerCase().includes(query) || matchesPinyin(name, query);
  return { setFilter, matches };
}

function AgentChoice({
  workspaceId,
  value,
  onChange,
  placeholder,
  allowAny = false,
}: {
  workspaceId: string;
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  allowAny?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { setFilter, matches } = useMatches();
  const { data = [] } = useQuery(agentListOptions(workspaceId));
  const agents = useMemo(() => data.filter((a) => !a.archived_at), [data]);
  const selected = agents.find((a) => a.id === value);
  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };
  return (
    <PropertyPicker
      open={open}
      onOpenChange={setOpen}
      width="w-56"
      align="start"
      searchable
      onSearchChange={setFilter}
      triggerRender={<button type="button" className={pillClass} />}
      trigger={
        <>
          {selected ? (
            <ActorAvatar actorType="agent" actorId={selected.id} size="sm" />
          ) : (
            <Bot className="size-3.5 text-muted-foreground" aria-hidden="true" />
          )}
          <span className={cn("truncate", !selected && "text-muted-foreground")}>{selected?.name ?? placeholder}</span>
          <ChevronDown className="size-3 text-muted-foreground" aria-hidden="true" />
        </>
      }
    >
      {allowAny && (
        <PickerItem selected={!value} onClick={() => pick("")}>
          <Bot className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{placeholder}</span>
        </PickerItem>
      )}
      {agents.filter((a) => matches(a.name)).length === 0 && !allowAny ? (
        <PickerEmpty />
      ) : (
        agents
          .filter((a) => matches(a.name))
          .map((a) => (
            <PickerItem
              key={a.id}
              selected={a.id === value}
              disabled={!allowAny && !isAgentRuntimeBound(a)}
              onClick={() => pick(a.id)}
            >
              <ActorAvatar actorType="agent" actorId={a.id} size="sm" showStatusDot />
              <span className="truncate">{a.name}</span>
            </PickerItem>
          ))
      )}
    </PropertyPicker>
  );
}

function ActorChoice({
  workspaceId,
  value,
  onChange,
}: {
  workspaceId: string;
  value: WakeupDraft["replyActor"];
  onChange: (value: WakeupDraft["replyActor"]) => void;
}) {
  const { t } = useT("issues");
  const [open, setOpen] = useState(false);
  const { setFilter, matches } = useMatches();
  const { data: members = [] } = useQuery(memberListOptions(workspaceId));
  const { data: agentRows = [] } = useQuery(agentListOptions(workspaceId));
  const agents = agentRows.filter((a) => !a.archived_at);
  const name =
    value?.type === "member"
      ? members.find((m) => m.user_id === value.id)?.name
      : value?.type === "agent"
        ? agents.find((a) => a.id === value.id)?.name
        : undefined;
  const pick = (next: WakeupDraft["replyActor"]) => {
    onChange(next);
    setOpen(false);
  };
  const section = (label: string, rows: ReactNode[]) =>
    rows.length > 0 && <PickerSection label={label}>{rows}</PickerSection>;
  return (
    <PropertyPicker
      open={open}
      onOpenChange={setOpen}
      width="w-56"
      align="start"
      searchable
      onSearchChange={setFilter}
      triggerRender={<button type="button" className={pillClass} />}
      trigger={
        <>
          {value ? (
            <ActorAvatar actorType={value.type} actorId={value.id} size="sm" />
          ) : null}
          <span className="truncate">{name ?? t(($) => $.wakeups.create.anyone)}</span>
          <ChevronDown className="size-3 text-muted-foreground" aria-hidden="true" />
        </>
      }
    >
      <PickerItem selected={!value} onClick={() => pick(null)}>
        <span className="truncate">{t(($) => $.wakeups.create.anyone)}</span>
      </PickerItem>
      {section(
        t(($) => $.wakeups.create.members),
        members
          .filter((m) => matches(m.name))
          .map((m) => (
            <PickerItem
              key={m.user_id}
              selected={value?.type === "member" && value.id === m.user_id}
              onClick={() => pick({ type: "member", id: m.user_id })}
            >
              <ActorAvatar actorType="member" actorId={m.user_id} size="sm" />
              <span className="truncate">{m.name}</span>
            </PickerItem>
          )),
      )}
      {section(
        t(($) => $.wakeups.create.agents),
        agents
          .filter((a) => matches(a.name))
          .map((a) => (
            <PickerItem
              key={a.id}
              selected={value?.type === "agent" && value.id === a.id}
              onClick={() => pick({ type: "agent", id: a.id })}
            >
              <ActorAvatar actorType="agent" actorId={a.id} size="sm" />
              <span className="truncate">{a.name}</span>
            </PickerItem>
          )),
      )}
    </PropertyPicker>
  );
}
