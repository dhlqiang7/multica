"use client";

import type { ReactNode } from "react";
import { cn } from "@multica/ui/lib/utils";
import { AppLink } from "../navigation";
import { PAGE_GUTTER, PAGE_RAIL } from "./page-header";

/**
 * The top of every AI Team detail page (agent, squad, skill, machine): a
 * breadcrumb back to the list, the entity's mark and name, one status pill
 * that says whether it can work right now, an optional line of context, and
 * the page's actions on the right. Facts that already live in the page body
 * (model, owner, counts) stay out of here so the header never repeats them.
 */
export function EntityDetailHeader({
  parent,
  crumb,
  media,
  title,
  titleClassName,
  status,
  description,
  actions,
}: {
  parent: { href: string; label: ReactNode };
  /** Breadcrumb leaf; defaults to the title. */
  crumb?: ReactNode;
  media: ReactNode;
  title: ReactNode;
  titleClassName?: string;
  status?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="shrink-0 bg-background pb-4 pt-3">
      <div className={cn(PAGE_RAIL, PAGE_GUTTER)}>
        <div className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
          <AppLink
            href={parent.href}
            className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {parent.label}
          </AppLink>
          <span aria-hidden="true">/</span>
          <span className="truncate text-foreground">{crumb ?? title}</span>
        </div>

        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            {media}
            <div className="min-w-0 pt-0.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <h1
                  className={cn(
                    "min-w-0 text-balance text-title-lg font-semibold tracking-tight sm:text-display-sm",
                    titleClassName,
                  )}
                >
                  {title}
                </h1>
                {status}
              </div>
              {description}
            </div>
          </div>
          {actions ? (
            <div className="flex shrink-0 items-center gap-2 self-end lg:self-start">
              {actions}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

/** Rounded pill that holds the header's status line. */
export function DetailStatusPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-6 min-w-0 items-center gap-1.5 rounded-full border border-surface-border bg-surface px-2.5 text-caption">
      {children}
    </span>
  );
}

/** Square mark for entities without an avatar (skills, machines). */
export function DetailIconMark({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-surface-border bg-surface text-muted-foreground sm:size-14 [&_svg]:size-5 sm:[&_svg]:size-6">
      {children}
    </span>
  );
}

/** Supporting line under the title. */
export function DetailSubline({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1.5 text-body text-muted-foreground">{children}</p>
  );
}

/**
 * The view switcher under the header. Views are few (at most three) and
 * each is a whole page, so they read as tabs on a full-width rule.
 */
export function DetailViewTabs<T extends string>({
  views,
  value,
  onChange,
  ariaLabel,
}: {
  views: readonly { id: T; label: ReactNode }[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      className="shrink-0 overflow-x-auto border-b"
      role="tablist"
      aria-label={ariaLabel}
    >
      <div className={cn(PAGE_RAIL, PAGE_GUTTER, "flex items-center gap-6")}>
        {views.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={value === item.id}
            onClick={() => onChange(item.id)}
            className={cn(
              "relative shrink-0 py-3 text-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              value === item.id
                ? "text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Rail card used beside a detail page's main column. */
export const DETAIL_CARD =
  "rounded-xl border border-surface-border bg-surface p-5 shadow-[var(--surface-shadow)]";
