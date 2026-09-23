"use client";

import type { ReactNode } from "react";
import { Archive, Server, WifiOff } from "lucide-react";
import type { AgentPresenceDetail } from "@multica/core/agents";
import { Button } from "@multica/ui/components/ui/button";
import { cn } from "@multica/ui/lib/utils";
import { AppLink } from "../../navigation";
import { useT } from "../../i18n";

/**
 * The one thing standing between this agent and running, if anything. Only
 * the most pressing condition shows — archived beats unbound beats a stuck
 * queue — and each comes with the action that clears it, so the page never
 * stacks banners of different shapes.
 *
 * A runtime that is offline with nothing queued is not a problem yet and
 * stays out of here; the status pill already says "Offline". Likewise the
 * sub-five-minute "unstable" window, which usually heals by itself.
 */
export function AgentHealthCallout({
  archived,
  runtimeBound,
  presence,
  canEdit,
  runtimeHref,
  onRestore,
  onBindRuntime,
}: {
  archived: boolean;
  runtimeBound: boolean;
  presence: AgentPresenceDetail | null;
  canEdit: boolean;
  /** Where the bound runtime's page is, when this viewer can open it. */
  runtimeHref: string | null;
  onRestore: () => void;
  onBindRuntime: () => void;
}) {
  const { t } = useT("agents");

  if (archived) {
    return (
      <Callout
        tone="muted"
        icon={<Archive className="size-4" aria-hidden="true" />}
        body={t(($) => $.detail.archived_banner)}
        actions={
          canEdit ? (
            <Button variant="outline" size="sm" onClick={onRestore}>
              {t(($) => $.detail.restore)}
            </Button>
          ) : null
        }
      />
    );
  }

  if (!runtimeBound) {
    return (
      <Callout
        tone="warning"
        icon={<Server className="size-4" aria-hidden="true" />}
        body={t(($) => $.detail.runtime_required_banner)}
        actions={
          canEdit ? (
            <Button variant="outline" size="sm" onClick={onBindRuntime}>
              {t(($) => $.detail.bind_runtime)}
            </Button>
          ) : null
        }
      />
    );
  }

  if (presence?.availability === "offline" && presence.queuedCount > 0) {
    return (
      <Callout
        tone="warning"
        icon={<WifiOff className="size-4" aria-hidden="true" />}
        title={t(($) => $.overview.attention_title)}
        body={t(($) => $.overview.attention_queued, {
          count: presence.queuedCount,
        })}
        actions={
          runtimeHref || canEdit ? (
            <>
              {runtimeHref ? (
                <Button
                  variant="outline"
                  size="sm"
                  render={<AppLink href={runtimeHref} />}
                  nativeButton={false}
                >
                  {t(($) => $.callout.view_runtime)}
                </Button>
              ) : null}
              {canEdit ? (
                <Button variant="outline" size="sm" onClick={onBindRuntime}>
                  {t(($) => $.callout.switch_runtime)}
                </Button>
              ) : null}
            </>
          ) : null
        }
      />
    );
  }

  return null;
}

function Callout({
  tone,
  icon,
  title,
  body,
  actions,
}: {
  tone: "muted" | "warning";
  icon: ReactNode;
  title?: string;
  body: string;
  actions: ReactNode;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center",
        tone === "warning"
          ? "border-warning/40 bg-warning/10"
          : "border-surface-border bg-muted/50",
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          className={cn(
            "mt-0.5 shrink-0",
            tone === "warning" ? "text-warning" : "text-muted-foreground",
          )}
        >
          {icon}
        </span>
        <div className="min-w-0">
          {title ? <p className="text-body font-medium">{title}</p> : null}
          <p
            className={cn(
              "text-caption leading-5",
              title ? "mt-0.5 text-muted-foreground" : "text-foreground",
            )}
          >
            {body}
          </p>
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2 max-sm:pl-7">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
