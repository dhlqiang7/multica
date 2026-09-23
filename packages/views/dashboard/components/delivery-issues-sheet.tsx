"use client";

import { RotateCcw } from "lucide-react";
import type { DashboardDeliveryIssue, IssueStatusCategory } from "@multica/core/types";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@multica/ui/components/ui/sheet";
import { StatusIcon } from "../../issues/components/status-icon";
import { AppLink } from "../../navigation";
import { useT } from "../../i18n";
import { waitingReviewSeconds } from "../delivery";

/** What the sheet is showing: a title plus the already-filtered issues. */
export interface DeliveryDrill {
  title: string;
  issues: DashboardDeliveryIssue[];
}

// The delivery payload carries the status kind, not the workspace's status
// catalog, so a custom status draws with its lifecycle category's glyph.
function categoryOf(issue: DashboardDeliveryIssue): IssueStatusCategory | undefined {
  switch (issue.status_kind) {
    case "backlog":
    case "todo":
      return "unstarted";
    case "in_progress":
    case "in_review":
    case "blocked":
      return "started";
    case "done":
      return "done";
    case "cancelled":
      return "closed";
    default:
      return undefined;
  }
}

/**
 * The drill-down behind every number on the Overview and Delivery tabs: the
 * issues a count was made of, each one a link into the issue itself.
 */
export function DeliveryIssuesSheet({
  drill,
  onOpenChange,
}: {
  drill: DeliveryDrill | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT("usage");
  const wsPaths = useWorkspacePaths();
  // Read once per render: the sheet shows a snapshot, and a live clock would
  // re-sort rows under the reader's pointer.
  const now = Date.now();

  return (
    <Sheet open={drill !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-lg">
        {drill ? (
          <>
            <SheetHeader className="border-b pr-12">
              <SheetTitle>{drill.title}</SheetTitle>
              <SheetDescription className="text-caption">
                {t(($) => $.drill.summary, { count: drill.issues.length })}
              </SheetDescription>
            </SheetHeader>
            {drill.issues.length === 0 ? (
              <p className="px-4 py-8 text-center text-caption text-muted-foreground">
                {t(($) => $.drill.empty)}
              </p>
            ) : (
              <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
                {drill.issues.map((issue) => {
                  const waiting = waitingReviewSeconds(issue, now);
                  return (
                    <li key={issue.issue_id}>
                      <AppLink
                        href={wsPaths.issueDetail(issue.issue_id)}
                        className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <StatusIcon
                            status={issue.status}
                            category={categoryOf(issue)}
                            className="size-3.5 shrink-0"
                          />
                          <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                            {issue.identifier}
                          </span>
                          <span className="min-w-0 truncate text-body font-medium">
                            {issue.title}
                          </span>
                        </span>
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-5.5 text-caption text-muted-foreground">
                          {issue.bounce_count > 0 ? (
                            <span className="inline-flex items-center gap-1">
                              <RotateCcw aria-hidden className="size-3" />
                              {t(($) => $.drill.bounces, { count: issue.bounce_count })}
                            </span>
                          ) : null}
                          <span>{t(($) => $.drill.runs, { count: issue.run_count })}</span>
                          {waiting !== null ? (
                            <span>
                              {t(($) => $.drill.waiting_days, {
                                days: Math.floor(waiting / 86_400),
                              })}
                            </span>
                          ) : null}
                        </span>
                      </AppLink>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
