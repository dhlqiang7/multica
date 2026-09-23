"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  Agent,
  AgentRuntime,
  MemberWithUser,
} from "@multica/core/types";
import { providerSupportsMcpConfig } from "@multica/core/agents";
import { useFeatureEnabled } from "@multica/core/config";
import { COMPOSIO_MCP_APPS_FLAG } from "@multica/core/feature-flags";
import { useWorkspaceId } from "@multica/core/hooks";
import { larkInstallationsOptions } from "@multica/core/lark";
import { slackInstallationsOptions } from "@multica/core/slack";
import { dingtalkInstallationsOptions } from "@multica/core/dingtalk";
import { wecomInstallationsOptions } from "@multica/core/wecom";
import { telegramInstallationsOptions } from "@multica/core/telegram";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../../i18n";
import {
  AgentExecutionSettings,
  AgentProfileSettings,
} from "./agent-detail-inspector";
import { AgentAccessSettings } from "./agent-access-settings";
import { ConfigDraftProvider, ConfigSaveBar } from "./config-drafts";
import {
  ConfigSection,
  ConfigSubsection,
  configAnchorDomId,
} from "./config-section";
import { InstructionsTab } from "./tabs/instructions-tab";
import { SkillsTab } from "./tabs/skills-tab";
import { McpConfigTab } from "./tabs/mcp-config-tab";
import { AgentMcpTab } from "./tabs/agent-mcp-tab";
import { IntegrationsTab } from "./tabs/integrations-tab";
import { EnvTab } from "./tabs/env-tab";
import { CustomArgsTab } from "./tabs/custom-args-tab";
import { RuntimeConfigTab } from "./tabs/runtime-config-tab";

/**
 * Addressable places on the configuration page. Top-level groups appear in
 * the table of contents; the rest are blocks inside a group that deep links
 * (`?view=skills`) can still land on directly.
 */
const CONFIG_ANCHORS = [
  "profile",
  "instructions",
  "execution",
  "tools",
  "skills",
  "mcp_config",
  "composio_mcp",
  "integrations",
  "access",
  "advanced",
  "env",
  "custom_args",
  "runtime_config",
] as const;

export type ConfigAnchor = (typeof CONFIG_ANCHORS)[number];

export function isConfigAnchor(value: string | null): value is ConfigAnchor {
  return value !== null && (CONFIG_ANCHORS as readonly string[]).includes(value);
}

interface ConfigGroup {
  anchor: ConfigAnchor;
  label: string;
  children: ConfigAnchor[];
}

// A block below this line (from the top of the scroll area) counts as the one
// being read, so the table of contents follows the heading the eye is on.
const ACTIVE_OFFSET_PX = 96;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The agent's whole definition on one scrolling page: who it is, what it is
 * told, how and where it runs, which tools it can reach, who may run it.
 * Explicit-save editors report into one save bar instead of each carrying a
 * Save button, so nothing is lost by scrolling past a section.
 */
export function AgentConfigView({
  agent,
  runtime,
  runtimes,
  members,
  currentUserId,
  canEdit,
  onUpdate,
  readOnlyNotice,
  scrollRef,
  targetAnchor,
  onTargetHandled,
  onNavigate,
  onDirtyChange,
}: {
  agent: Agent;
  runtime: AgentRuntime | null;
  runtimes: AgentRuntime[];
  members: MemberWithUser[];
  currentUserId: string | null;
  canEdit: boolean;
  onUpdate: (id: string, data: Record<string, unknown>) => Promise<void>;
  readOnlyNotice?: ReactNode;
  /** The element that scrolls the page body. */
  scrollRef: RefObject<HTMLElement | null>;
  /** An anchor to bring into view (deep link or rail shortcut). */
  targetAnchor: ConfigAnchor | null;
  onTargetHandled: () => void;
  /** Records a table-of-contents jump in the URL. */
  onNavigate: (anchor: ConfigAnchor) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useT("agents");
  const wsId = useWorkspaceId();
  const composioMCPAppsEnabled = useFeatureEnabled(
    COMPOSIO_MCP_APPS_FLAG,
    false,
  );

  const { data: larkListing } = useQuery({
    ...larkInstallationsOptions(wsId),
    enabled: !!wsId,
  });
  const { data: slackListing } = useQuery({
    ...slackInstallationsOptions(wsId),
    enabled: !!wsId,
  });
  const { data: dingtalkListing } = useQuery({
    ...dingtalkInstallationsOptions(wsId),
  });
  const { data: wecomListing } = useQuery({
    ...wecomInstallationsOptions(wsId),
    enabled: !!wsId,
  });
  const { data: telegramListing } = useQuery({
    ...telegramInstallationsOptions(wsId),
    enabled: !!wsId,
  });
  const integrationsConfigured =
    larkListing?.configured === true ||
    slackListing?.configured === true ||
    dingtalkListing?.configured === true ||
    wecomListing?.configured === true ||
    telegramListing?.configured === true;

  // Unknown provider (runtime row not loaded yet) keeps MCP visible rather
  // than flashing it away.
  const showMcp = runtime ? providerSupportsMcpConfig(runtime.provider) : true;
  const showComposioMcp =
    composioMCPAppsEnabled &&
    !!currentUserId &&
    !!agent.owner_id &&
    agent.owner_id === currentUserId;
  // GET/PUT /api/agents/{id}/env admits the agent owner or a workspace
  // owner/admin (MUL-5438) — the rule `canEdit` encodes — so anyone else
  // would only reach a guaranteed 403 on "Reveal & edit".
  const showEnv = canEdit;
  const showRouting = runtime?.provider === "openclaw";

  const groups = useMemo<ConfigGroup[]>(() => {
    const list: ConfigGroup[] = [
      {
        anchor: "profile",
        label: t(($) => $.inspector.section_profile),
        children: [],
      },
      {
        anchor: "instructions",
        label: t(($) => $.tabs.instructions),
        children: [],
      },
      {
        anchor: "execution",
        label: t(($) => $.inspector.section_execution),
        children: [],
      },
      {
        anchor: "tools",
        label: t(($) => $.config.tools),
        children: [
          "skills",
          ...(showMcp ? (["mcp_config"] as const) : []),
          ...(showComposioMcp ? (["composio_mcp"] as const) : []),
        ],
      },
    ];
    if (integrationsConfigured) {
      list.push({
        anchor: "integrations",
        label: t(($) => $.tabs.integrations),
        children: [],
      });
    }
    list.push(
      { anchor: "access", label: t(($) => $.tabs.access), children: [] },
      {
        anchor: "advanced",
        label: t(($) => $.config.advanced),
        children: [
          ...(showEnv ? (["env"] as const) : []),
          "custom_args",
          ...(showRouting ? (["runtime_config"] as const) : []),
        ],
      },
    );
    return list;
  }, [
    integrationsConfigured,
    showComposioMcp,
    showEnv,
    showMcp,
    showRouting,
    t,
  ]);

  const groupOf = useCallback(
    (anchor: ConfigAnchor) =>
      groups.find(
        (group) => group.anchor === anchor || group.children.includes(anchor),
      )?.anchor ?? null,
    [groups],
  );

  const [activeGroup, setActiveGroup] = useState<ConfigAnchor>("profile");

  const scrollToAnchor = useCallback(
    (anchor: string) => {
      const container = scrollRef.current;
      const target = document.getElementById(configAnchorDomId(anchor));
      if (!container || !target) return;
      // Scroll only the page body. scrollIntoView would also move every
      // scrollable ancestor, which on desktop drags the shell (#3929).
      const top =
        target.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop -
        16;
      container.scrollTo?.({
        top,
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    },
    [scrollRef],
  );

  // Deep links can target a block this viewer does not have (MCP on a
  // provider that ignores it, Environment for a non-manager); those settle
  // at the top of the page instead of pointing at nothing.
  useEffect(() => {
    if (targetAnchor === null) return;
    const group = groupOf(targetAnchor);
    const frame = requestAnimationFrame(() => {
      if (group) {
        scrollToAnchor(targetAnchor);
        setActiveGroup(group);
      }
      onTargetHandled();
    });
    return () => cancelAnimationFrame(frame);
  }, [groupOf, onTargetHandled, scrollToAnchor, targetAnchor]);

  // Table of contents follows the reader.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = container.getBoundingClientRect().top + ACTIVE_OFFSET_PX;
      const atBottom =
        container.scrollTop + container.clientHeight >=
        container.scrollHeight - 2;
      let current = groups[0]?.anchor ?? "profile";
      for (const group of groups) {
        const el = document.getElementById(configAnchorDomId(group.anchor));
        if (el && el.getBoundingClientRect().top <= top) current = group.anchor;
      }
      if (atBottom && container.scrollTop > 0) {
        current = groups[groups.length - 1]?.anchor ?? current;
      }
      setActiveGroup(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [groups, scrollRef]);

  const jump = (anchor: ConfigAnchor) => {
    const group = groupOf(anchor);
    if (group) setActiveGroup(group);
    scrollToAnchor(anchor);
    onNavigate(anchor);
  };

  const saveTo = (updates: Record<string, unknown>) =>
    onUpdate(agent.id, updates);

  return (
    <ConfigDraftProvider onDirtyChange={onDirtyChange}>
      <div className="grid gap-8 lg:grid-cols-[176px_minmax(0,1fr)]">
        <nav
          aria-label={t(($) => $.tabs.section_navigation_aria)}
          className="hidden lg:block"
        >
          <ul className="sticky top-6 flex flex-col gap-0.5">
            {groups.map((group) => {
              const active = group.anchor === activeGroup;
              return (
                <li key={group.anchor}>
                  <button
                    type="button"
                    aria-current={active ? "location" : undefined}
                    onClick={() => jump(group.anchor)}
                    className={cn(
                      "flex h-8 w-full items-center rounded-md px-2.5 text-left text-label transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "bg-surface-selected font-medium text-surface-selected-foreground hover:bg-surface-selected"
                        : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                    )}
                  >
                    {group.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0 max-w-3xl">
          <div className="mb-6 empty:hidden">{readOnlyNotice}</div>
          <div className="space-y-12">
            <AgentProfileSettings
              agent={agent}
              canEdit={canEdit}
              onUpdate={onUpdate}
              anchor="profile"
              title={t(($) => $.inspector.section_profile)}
            />

            <ConfigSection
              anchor="instructions"
              title={t(($) => $.tabs.instructions)}
            >
              <InstructionsTab
                agent={agent}
                onSave={saveTo}
                draftSlot={{
                  id: "instructions",
                  anchor: "instructions",
                  label: t(($) => $.tabs.instructions),
                }}
              />
            </ConfigSection>

            <ConfigSection
              anchor="execution"
              title={t(($) => $.inspector.section_execution)}
            >
              <AgentExecutionSettings
                agent={agent}
                runtime={runtime}
                runtimes={runtimes}
                members={members}
                currentUserId={currentUserId}
                canEdit={canEdit}
                onUpdate={onUpdate}
              />
            </ConfigSection>

            <ConfigSection anchor="tools" title={t(($) => $.config.tools)}>
              <div className="space-y-10">
                <ConfigSubsection anchor="skills" title={t(($) => $.tabs.skills)}>
                  <SkillsTab
                    agent={agent}
                    runtime={runtime}
                    currentUserId={currentUserId}
                    canEdit={canEdit}
                  />
                </ConfigSubsection>
                {showMcp ? (
                  <ConfigSubsection
                    anchor="mcp_config"
                    title={t(($) => $.tabs.mcp_config)}
                  >
                    <McpConfigTab
                      agent={agent}
                      runtime={runtime}
                      currentUserId={currentUserId}
                      canEdit={canEdit}
                      onSave={saveTo}
                    />
                  </ConfigSubsection>
                ) : null}
                {showComposioMcp ? (
                  <ConfigSubsection
                    anchor="composio_mcp"
                    title={t(($) => $.tabs.composio_mcp)}
                  >
                    <AgentMcpTab agent={agent} />
                  </ConfigSubsection>
                ) : null}
              </div>
            </ConfigSection>

            {integrationsConfigured ? (
              <ConfigSection
                anchor="integrations"
                title={t(($) => $.tabs.integrations)}
              >
                <IntegrationsTab agent={agent} />
              </ConfigSection>
            ) : null}

            <ConfigSection anchor="access" title={t(($) => $.tabs.access)}>
              <AgentAccessSettings
                agent={agent}
                members={members}
                currentUserId={currentUserId}
                onUpdate={onUpdate}
                draftSlot={{
                  id: "access",
                  anchor: "access",
                  label: t(($) => $.tabs.access),
                }}
              />
            </ConfigSection>

            <ConfigSection anchor="advanced" title={t(($) => $.config.advanced)}>
              <div className="space-y-10">
                {showEnv ? (
                  <ConfigSubsection
                    anchor="env"
                    title={t(($) => $.tabs.environment)}
                  >
                    <EnvTab
                      agent={agent}
                      draftSlot={{
                        id: "env",
                        anchor: "env",
                        label: t(($) => $.tabs.environment),
                      }}
                    />
                  </ConfigSubsection>
                ) : null}
                <ConfigSubsection
                  anchor="custom_args"
                  title={t(($) => $.tabs.custom_args)}
                >
                  <CustomArgsTab
                    agent={agent}
                    runtimeDevice={runtime ?? undefined}
                    onSave={saveTo}
                    draftSlot={{
                      id: "custom_args",
                      anchor: "custom_args",
                      label: t(($) => $.tabs.custom_args),
                    }}
                  />
                </ConfigSubsection>
                {showRouting ? (
                  <ConfigSubsection
                    anchor="runtime_config"
                    title={t(($) => $.tabs.runtime_config)}
                  >
                    <RuntimeConfigTab
                      agent={agent}
                      onSave={saveTo}
                      draftSlot={{
                        id: "runtime_config",
                        anchor: "runtime_config",
                        label: t(($) => $.tabs.runtime_config),
                      }}
                    />
                  </ConfigSubsection>
                ) : null}
              </div>
            </ConfigSection>
          </div>

          {/* Sticks to the bottom of the scroll area while anything is
              unsaved; centred in the content column so it never sits in the
              corner the chat launcher owns. */}
          <div className="pointer-events-none sticky bottom-4 z-10 mt-8 flex justify-center max-lg:pr-[var(--chat-launcher-clearance)]">
            <ConfigSaveBar onJump={(anchor) => scrollToAnchor(anchor)} />
          </div>
        </div>
      </div>
    </ConfigDraftProvider>
  );
}
