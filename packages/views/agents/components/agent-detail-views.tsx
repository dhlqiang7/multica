"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  Agent,
  AgentRuntime,
  MemberWithUser,
} from "@multica/core/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@multica/ui/components/ui/alert-dialog";
import { cn } from "@multica/ui/lib/utils";
import { PAGE_GUTTER, PAGE_RAIL } from "../../layout/page-header";
import { ActorIssuesPanel } from "../../common/actor-issues-panel";
import { useT } from "../../i18n";
import { useNavigation } from "../../navigation";
import { AgentActivityView } from "./agent-activity-view";
import {
  AgentConfigView,
  isConfigAnchor,
  type ConfigAnchor,
} from "./agent-config-view";

type AgentView = "activity" | "issues" | "config";

/** Anything `?view=` can point at: a view, or a place on the config page. */
export type AgentViewTarget = "activity" | "issues" | "config" | ConfigAnchor;

const VIEWS: { id: AgentView; labelKey: "activity" | "issues" | "configuration" }[] = [
  { id: "activity", labelKey: "activity" },
  { id: "issues", labelKey: "issues" },
  { id: "config", labelKey: "configuration" },
];

function viewOf(target: AgentViewTarget): AgentView {
  if (target === "activity" || target === "issues") return target;
  return "config";
}

/** The anchor to scroll to for a URL. A `focus` param means the target editor
 *  brings its exact control into view itself (e.g. the conversation starters
 *  inside Instructions), so the page must not scroll over it. */
function anchorFromParams(params: URLSearchParams): ConfigAnchor | null {
  const target = targetFromParam(params.get("view"));
  return isConfigAnchor(target) && !params.has("focus") ? target : null;
}

function targetFromParam(param: string | null): AgentViewTarget {
  if (param === "issues" || param === "config") return param;
  if (isConfigAnchor(param)) return param;
  return "activity";
}

/**
 * Three views instead of a tab strip over two sidebars: Activity (what it is
 * doing and has done), Issues (the work assigned to it) and Configuration
 * (its whole definition on one page). `?view=` carries either a view or a
 * configuration anchor, so links like `?view=instructions` land on the block.
 */
export function AgentDetailViews({
  agent,
  runtime,
  owner,
  runtimes,
  members,
  onUpdate,
  currentUserId,
  canEdit,
  notice,
  readOnlyNotice,
  navIntent,
  onNavIntentHandled,
}: {
  agent: Agent;
  runtime: AgentRuntime | null;
  owner: MemberWithUser | null;
  runtimes: AgentRuntime[];
  members: MemberWithUser[];
  onUpdate: (id: string, data: Record<string, unknown>) => Promise<void>;
  currentUserId: string | null;
  canEdit: boolean;
  /** The page's health callout, shown above every view. */
  notice?: ReactNode;
  /** Explains why the configuration is read-only for this viewer. */
  readOnlyNotice?: ReactNode;
  navIntent?: AgentViewTarget | null;
  onNavIntentHandled?: () => void;
}) {
  const { t } = useT("agents");
  const navigation = useNavigation();
  const urlView = navigation.searchParams.get("view");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [view, setView] = useState<AgentView>(() =>
    viewOf(targetFromParam(urlView)),
  );
  const [targetAnchor, setTargetAnchor] = useState<ConfigAnchor | null>(() =>
    anchorFromParams(navigation.searchParams),
  );
  const [configDirty, setConfigDirty] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<AgentViewTarget | null>(
    null,
  );
  const lastUrlViewRef = useRef(urlView);

  const writeUrl = useCallback(
    (target: AgentViewTarget) => {
      const params = new URLSearchParams(navigation.searchParams);
      if (target === "activity") params.delete("view");
      else params.set("view", target);
      const query = params.toString();
      lastUrlViewRef.current = params.get("view");
      navigation.replace(`${navigation.pathname}${query ? `?${query}` : ""}`);
    },
    [navigation],
  );

  const commitTarget = useCallback(
    (target: AgentViewTarget) => {
      const nextView = viewOf(target);
      if (nextView !== view) scrollRef.current?.scrollTo?.({ top: 0 });
      setView(nextView);
      setTargetAnchor(isConfigAnchor(target) ? target : null);
      writeUrl(target);
    },
    [view, writeUrl],
  );

  const requestTarget = useCallback(
    (target: AgentViewTarget) => {
      if (view === "config" && configDirty && viewOf(target) !== "config") {
        setPendingTarget(target);
        return;
      }
      commitTarget(target);
    },
    [commitTarget, configDirty, view],
  );

  // Back/forward and in-app links change `?view=` underneath us.
  useEffect(() => {
    if (urlView === lastUrlViewRef.current) return;
    lastUrlViewRef.current = urlView;
    setView(viewOf(targetFromParam(urlView)));
    setTargetAnchor(anchorFromParams(navigation.searchParams));
    // Keyed on the view param alone; the adapter object is not stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlView]);

  useEffect(() => {
    if (navIntent == null) return;
    requestTarget(navIntent);
    onNavIntentHandled?.();
  }, [navIntent, onNavIntentHandled, requestTarget]);

  const clearTargetAnchor = useCallback(() => setTargetAnchor(null), []);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div
        className="shrink-0 overflow-x-auto border-b"
        role="tablist"
        aria-label={t(($) => $.tabs.page_navigation_aria)}
      >
        <div className={cn(PAGE_RAIL, PAGE_GUTTER, "flex items-center gap-6")}>
          {VIEWS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={view === item.id}
              onClick={() => requestTarget(item.id)}
              className={cn(
                "relative shrink-0 py-3 text-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                view === item.id
                  ? "text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(($) => $.tabs[item.labelKey])}
            </button>
          ))}
        </div>
      </div>

      {/* Header, tabs and every view read PAGE_RAIL, so the page is one
          centred column at every width (MUL-7107). The issue list owns its
          own toolbar gutter, so it takes a bare rail. */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {view === "issues" ? (
          <div className={cn(PAGE_RAIL, "flex min-h-[620px] flex-col")}>
            {/* The callout renders nothing when the agent is healthy. */}
            <div className={cn(PAGE_GUTTER, "pt-4 empty:hidden")}>{notice}</div>
            <ActorIssuesPanel actorType="agent" actorId={agent.id} />
          </div>
        ) : (
          <div className={cn(PAGE_RAIL, PAGE_GUTTER, "py-4 sm:py-6")}>
            <div className="mb-6 empty:hidden">{notice}</div>
            {view === "activity" ? (
              <AgentActivityView
                agent={agent}
                runtime={runtime}
                owner={owner}
                onOpenConfig={requestTarget}
              />
            ) : (
              <AgentConfigView
                agent={agent}
                runtime={runtime}
                runtimes={runtimes}
                members={members}
                currentUserId={currentUserId}
                canEdit={canEdit}
                onUpdate={onUpdate}
                readOnlyNotice={readOnlyNotice}
                scrollRef={scrollRef}
                targetAnchor={targetAnchor}
                onTargetHandled={clearTargetAnchor}
                onNavigate={writeUrl}
                onDirtyChange={setConfigDirty}
              />
            )}
          </div>
        )}
      </div>

      {pendingTarget !== null && (
        <AlertDialog
          open
          onOpenChange={(open) => {
            if (!open) setPendingTarget(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t(($) => $.tabs.discard_dialog_title)}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t(($) => $.tabs.discard_dialog_description)}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {t(($) => $.tabs.discard_keep)}
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  const target = pendingTarget;
                  setPendingTarget(null);
                  setConfigDirty(false);
                  commitTarget(target);
                }}
              >
                {t(($) => $.tabs.discard_confirm)}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
