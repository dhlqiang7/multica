"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { cn } from "@multica/ui/lib/utils";

/**
 * Shared status vocabulary for the AI Team lists. Every list speaks the
 * same four tones so "amber" means "a person should look" on agents,
 * squads and machines alike.
 */
export type StatusTone = "attention" | "working" | "idle" | "offline";

export const STATUS_TONE_DOT: Record<StatusTone, string> = {
  attention: "bg-warning",
  working: "bg-brand",
  idle: "bg-success",
  offline: "bg-muted-foreground/40",
};

export const STATUS_TONE_TEXT: Record<StatusTone, string> = {
  attention: "text-warning",
  working: "text-brand",
  idle: "text-success",
  offline: "text-muted-foreground",
};

export function StatusDot({
  tone,
  className,
}: {
  tone: StatusTone;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("size-1.5 shrink-0 rounded-full", STATUS_TONE_DOT[tone], className)}
    />
  );
}

export interface StatusSummaryItem<K extends string> {
  key: K;
  label: ReactNode;
  count: number;
  tone?: StatusTone;
}

/**
 * The row of counts above a list: it summarises the list and filters it in
 * one control ("All 12 · Needs attention 2 · Working 3"). The first item
 * (all) always shows; others with no members drop out so the row only names
 * what is actually there, except the selected one, which stays so the
 * filter can be cleared.
 */
export function StatusSummaryTabs<K extends string>({
  items,
  value,
  onChange,
  ariaLabel,
}: {
  items: readonly StatusSummaryItem<K>[];
  value: K;
  onChange: (next: K) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex min-w-0 shrink-0 items-center gap-1"
    >
      {items
        .filter(
          (item, index) => index === 0 || item.count > 0 || item.key === value,
        )
        .map((item) => {
          const selected = item.key === value;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(item.key)}
              className={cn(
                "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-body transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              {item.tone ? <StatusDot tone={item.tone} /> : null}
              {item.label}
              <span className="text-caption tabular-nums text-muted-foreground">
                {item.count}
              </span>
            </button>
          );
        })}
    </div>
  );
}

/**
 * Ownership lens beside the status tabs ("Mine / All"). A segmented control
 * from md up; a dropdown below it, where the status tabs need the room.
 */
export function ScopeToggle<K extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { key: K; label: string; count: number }[];
  value: K;
  onChange: (next: K) => void;
}) {
  const current = options.find((option) => option.key === value);
  return (
    <>
      <div className="hidden shrink-0 items-center rounded-md bg-muted p-0.5 md:flex">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={value === option.key}
            onClick={() => onChange(option.key)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-xs px-2.5 text-caption font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              value === option.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
            <span className="tabular-nums text-muted-foreground">
              {option.count}
            </span>
          </button>
        ))}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 gap-1 text-muted-foreground md:hidden"
            >
              <span className="truncate">{current?.label}</span>
              <ChevronDown className="size-3 text-muted-foreground" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-auto">
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next) => onChange(next as K)}
          >
            {options.map((option) => (
              <DropdownMenuRadioItem key={option.key} value={option.key}>
                {option.label}
                <span className="ml-2 tabular-nums text-caption text-muted-foreground">
                  {option.count}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
