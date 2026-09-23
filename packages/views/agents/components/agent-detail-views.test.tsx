// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent, AgentRuntime } from "@multica/core/types";
import { I18nProvider } from "@multica/core/i18n/react";
import enCommon from "../../locales/en/common.json";
import enAgents from "../../locales/en/agents.json";
import {
  NavigationProvider,
  type NavigationAdapter,
} from "../../navigation";
import type { ConfigDraftSlot } from "./config-drafts";

const TEST_RESOURCES = { en: { common: enCommon, agents: enAgents } };

const RAIL_SENTINEL = "rail-sentinel";
const GUTTER_SENTINEL = "gutter-sentinel";
vi.mock("../../layout/page-header", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../layout/page-header")>()),
  PAGE_RAIL: "rail-sentinel",
  PAGE_GUTTER: "gutter-sentinel",
}));

// The views decide which sections exist and where the page goes; what each
// editor does is covered by its own tests, so they are stubbed here.
vi.mock("./tabs/activity-tab", () => ({
  ActivityTab: () => <div>activity-tab</div>,
  AgentPerformanceSummary: () => <div>performance-summary</div>,
}));
vi.mock("./agent-detail-inspector", () => ({
  AgentProfileSettings: () => <div>profile-settings</div>,
  AgentExecutionSettings: () => <div>execution-settings</div>,
}));
vi.mock("./agent-access-settings", () => ({
  AgentAccessSettings: () => <div>agent-access-settings</div>,
}));
// A minimal explicit-save editor, so the page's draft plumbing is exercised
// for real: it reports dirty through the same hook the real editors use.
vi.mock("./tabs/instructions-tab", async () => {
  const { useState } = await import("react");
  const { useConfigDraft } = await import("./config-drafts");
  return {
    InstructionsTab: ({ draftSlot }: { draftSlot?: ConfigDraftSlot }) => {
      const [dirty, setDirty] = useState(false);
      useConfigDraft(draftSlot, {
        dirty,
        valid: true,
        save: async () => setDirty(false),
        discard: () => setDirty(false),
      });
      return (
        <button type="button" onClick={() => setDirty(true)}>
          edit-instructions
        </button>
      );
    },
  };
});
vi.mock("./tabs/skills-tab", () => ({
  SkillsTab: () => <div>skills-tab</div>,
}));
vi.mock("./tabs/env-tab", () => ({
  EnvTab: () => <div>env-tab</div>,
}));
vi.mock("./tabs/custom-args-tab", () => ({
  CustomArgsTab: () => <div>custom-args-tab</div>,
}));
vi.mock("./tabs/mcp-config-tab", () => ({
  McpConfigTab: () => <div>mcp-config-tab</div>,
}));
vi.mock("./tabs/agent-mcp-tab", () => ({
  AgentMcpTab: () => <div>agent-mcp-tab</div>,
}));
vi.mock("./tabs/integrations-tab", () => ({
  IntegrationsTab: () => <div>integrations-tab</div>,
}));
vi.mock("./tabs/runtime-config-tab", () => ({
  RuntimeConfigTab: () => <div>runtime-config-tab</div>,
}));
vi.mock("../../common/actor-issues-panel", () => ({
  ActorIssuesPanel: () => <div>actor-issues-panel</div>,
}));

// The configuration page reads workspace context to decide whether the
// Integrations section is worth showing. Each listing is backed by a ref so
// a test can flip `configured`.
const larkListingRef = vi.hoisted(() => ({
  current: { installations: [] as unknown[], configured: false },
}));
const slackListingRef = vi.hoisted(() => ({
  current: { installations: [] as unknown[], configured: false },
}));
const telegramListingRef = vi.hoisted(() => ({
  current: { installations: [] as unknown[], configured: false },
}));
vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));
vi.mock("@multica/core/lark", () => ({
  larkInstallationsOptions: () => ({
    queryKey: ["lark", "installations"],
    queryFn: () => Promise.resolve(larkListingRef.current),
  }),
}));
vi.mock("@multica/core/slack", () => ({
  slackInstallationsOptions: () => ({
    queryKey: ["slack", "installations"],
    queryFn: () => Promise.resolve(slackListingRef.current),
  }),
}));
vi.mock("@multica/core/telegram", () => ({
  telegramInstallationsOptions: () => ({
    queryKey: ["telegram", "installations"],
    queryFn: () => Promise.resolve(telegramListingRef.current),
  }),
}));

import { AgentDetailViews } from "./agent-detail-views";

const baseAgent: Agent = {
  id: "agent-1",
  workspace_id: "ws-1",
  runtime_id: "runtime-1",
  name: "Agent",
  description: "",
  instructions: "",
  avatar_url: null,
  runtime_mode: "local",
  runtime_config: {},
  custom_args: [],
  visibility: "workspace",
  permission_mode: "public_to",
  invocation_targets: [{ target_type: "workspace", target_id: null }],
  status: "idle",
  max_concurrent_tasks: 1,
  model: "",
  owner_id: "user-1",
  skills: [],
  created_at: "2026-05-28T00:00:00Z",
  updated_at: "2026-05-28T00:00:00Z",
  archived_at: null,
  archived_by: null,
};

function makeRuntime(provider: string): AgentRuntime {
  return {
    id: "runtime-1",
    workspace_id: "ws-1",
    daemon_id: null,
    name: "Runtime",
    runtime_mode: "local",
    provider,
    launch_header: "",
    status: "online",
    device_info: "",
    metadata: {},
    owner_id: null,
    visibility: "private",
    last_seen_at: null,
    created_at: "2026-05-28T00:00:00Z",
    updated_at: "2026-05-28T00:00:00Z",
  };
}

function renderViews(
  runtimes: AgentRuntime[],
  {
    canEdit = true,
    search = "",
  }: { canEdit?: boolean; search?: string } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const replace = vi.fn();
  const navigation: NavigationAdapter = {
    push: vi.fn(),
    replace,
    back: vi.fn(),
    pathname: "/acme/agents/agent-1",
    searchParams: new URLSearchParams(search),
    hash: "",
    getShareableUrl: (path) => path,
  };
  const view = render(
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      <NavigationProvider value={navigation}>
        <QueryClientProvider client={queryClient}>
          <AgentDetailViews
            agent={baseAgent}
            runtime={runtimes[0] ?? null}
            owner={null}
            runtimes={runtimes}
            members={[]}
            onUpdate={vi.fn().mockResolvedValue(undefined)}
            currentUserId="user-1"
            canEdit={canEdit}
          />
        </QueryClientProvider>
      </NavigationProvider>
    </I18nProvider>,
  );
  return { replace, ...view };
}

function openConfiguration() {
  fireEvent.click(screen.getByRole("tab", { name: /^Configuration$/i }));
}

function sectionNav() {
  return within(screen.getByRole("navigation", { name: "Agent section" }));
}

beforeEach(() => {
  larkListingRef.current = { installations: [], configured: false };
  slackListingRef.current = { installations: [], configured: false };
  telegramListingRef.current = { installations: [], configured: false };
});

describe("AgentDetailViews navigation", () => {
  it("opens on Activity with three views on offer", () => {
    renderViews([makeRuntime("claude")]);

    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["Activity", "Issues", "Configuration"]);
    expect(
      screen.getByRole("tab", { name: "Activity" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("activity-tab")).toBeInTheDocument();
  });

  it("records the view in the URL and drops it again for Activity", () => {
    const { replace } = renderViews([makeRuntime("claude")]);

    openConfiguration();
    expect(replace).toHaveBeenLastCalledWith("/acme/agents/agent-1?view=config");
    expect(screen.getByText("profile-settings")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
    expect(replace).toHaveBeenLastCalledWith("/acme/agents/agent-1");
  });

  it("lands a configuration anchor on the configuration page", () => {
    // Deep links (chat's runtime banner, autopilots) address a block, not a
    // view: ?view=execution must open Configuration.
    renderViews([makeRuntime("claude")], { search: "view=execution" });

    expect(
      screen.getByRole("tab", { name: "Configuration" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("execution-settings")).toBeInTheDocument();
  });

  it("opens the matching configuration section from the Activity rail", () => {
    const { replace } = renderViews([makeRuntime("claude")]);

    fireEvent.click(screen.getByRole("button", { name: /Concurrency/ }));

    expect(replace).toHaveBeenLastCalledWith(
      "/acme/agents/agent-1?view=execution",
    );
    expect(screen.getByText("execution-settings")).toBeInTheDocument();
  });

  it("shows the assigned issues on the Issues view", () => {
    renderViews([makeRuntime("claude")], { search: "view=issues" });

    expect(screen.getByText("actor-issues-panel")).toBeInTheDocument();
  });
});

describe("AgentDetailViews unsaved configuration", () => {
  it("collects unsaved work into one save bar", () => {
    renderViews([makeRuntime("claude")]);
    openConfiguration();

    fireEvent.click(screen.getByRole("button", { name: "edit-instructions" }));

    const bar = within(screen.getByRole("region", { name: "Unsaved changes" }));
    expect(bar.getByText("1 unsaved change")).toBeInTheDocument();
    expect(bar.getByRole("button", { name: "Instructions" })).toBeInTheDocument();
  });

  it("asks before leaving the configuration with unsaved work", () => {
    renderViews([makeRuntime("claude")]);
    openConfiguration();
    fireEvent.click(screen.getByRole("button", { name: "edit-instructions" }));

    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
    expect(
      screen.getByRole("alertdialog", { name: "Discard unsaved changes?" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(
      screen.getByRole("tab", { name: "Configuration" }),
    ).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(
      screen.getByRole("tab", { name: "Activity" }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("leaves without asking when nothing is unsaved", () => {
    renderViews([makeRuntime("claude")]);
    openConfiguration();

    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByText("activity-tab")).toBeInTheDocument();
  });
});

describe("AgentDetailViews MCP section visibility", () => {
  it.each([
    ["Claude", "claude"],
    ["Codex", "codex"],
    ["Cursor", "cursor"],
    ["Hermes", "hermes"],
    ["Kimi", "kimi"],
    ["Kiro", "kiro"],
    ["OpenCode", "opencode"],
    ["OpenClaw", "openclaw"],
    ["Oh My Pi", "omp"],
  ])("renders MCP when the agent runs on the %s runtime", (_label, provider) => {
    renderViews([makeRuntime(provider)]);
    openConfiguration();
    expect(screen.getByRole("heading", { name: "MCP" })).toBeInTheDocument();
  });

  it("hides MCP for providers whose backend does not read mcp_config", () => {
    // Saving an MCP config on e.g. Gemini would be a silent no-op at run
    // time — that's the bug this hiding logic is meant to prevent.
    renderViews([makeRuntime("gemini")]);
    openConfiguration();
    expect(
      screen.queryByRole("heading", { name: "MCP" }),
    ).not.toBeInTheDocument();
  });

  it("keeps MCP visible when the runtime row hasn't loaded yet", () => {
    // Empty runtimes[] mimics the brief window between the page mounting and
    // the runtimes query resolving. Hiding the section would flicker it off
    // and then back on, which reads as a bug.
    renderViews([]);
    openConfiguration();
    expect(screen.getByRole("heading", { name: "MCP" })).toBeInTheDocument();
  });
});

describe("AgentDetailViews Integrations section visibility", () => {
  it("shows Integrations once the deployment has Lark configured", async () => {
    larkListingRef.current = { installations: [], configured: true };
    renderViews([makeRuntime("claude")]);
    openConfiguration();
    expect(
      await sectionNav().findByRole("button", { name: "Integrations" }),
    ).toBeInTheDocument();
  });

  it("shows Integrations when only Slack is configured (Lark off)", async () => {
    // Regression: the gate must consider Slack too, not just Lark — a
    // Slack-only deployment was hiding the section (and its bind entry).
    slackListingRef.current = { installations: [], configured: true };
    renderViews([makeRuntime("claude")]);
    openConfiguration();
    expect(
      await sectionNav().findByRole("button", { name: "Integrations" }),
    ).toBeInTheDocument();
  });

  it("shows Integrations when only Telegram is configured", async () => {
    telegramListingRef.current = { installations: [], configured: true };
    renderViews([makeRuntime("claude")]);
    openConfiguration();
    expect(
      await sectionNav().findByRole("button", { name: "Integrations" }),
    ).toBeInTheDocument();
  });

  it("hides Integrations when no channel integration is configured", () => {
    // Default refs are configured:false; the section must not appear on a
    // deployment without any channel integration, the common case.
    renderViews([makeRuntime("claude")]);
    openConfiguration();
    expect(
      sectionNav().queryByRole("button", { name: "Integrations" }),
    ).not.toBeInTheDocument();
  });
});

describe("AgentDetailViews Environment visibility", () => {
  it("shows Environment to someone who can manage the agent", () => {
    renderViews([makeRuntime("claude")]);
    openConfiguration();
    expect(
      screen.getByRole("heading", { name: "Environment" }),
    ).toBeInTheDocument();
  });

  it("hides Environment from users who cannot manage the agent", () => {
    // The env endpoints admit the agent owner or a workspace owner/admin
    // (MUL-5438) — the rule `canEdit` already encodes. Anyone else would hit
    // a guaranteed 403 on "Reveal & edit".
    renderViews([makeRuntime("claude")], { canEdit: false });
    openConfiguration();
    expect(
      screen.queryByRole("heading", { name: "Environment" }),
    ).not.toBeInTheDocument();
  });
});

// MUL-7107: the header, the tab bar and every panel share one leading edge.
// The regression these guard against is a centred width cap: `mx-auto` plus a
// `max-w-*` moves an element's edge as the viewport grows, so chrome on a
// centred rail and a panel on the page gutter agreed at 1440px and drifted
// hundreds of pixels apart above it.
describe("AgentDetailViews horizontal alignment", () => {
  // The constants are overridden with sentinels rather than compared against
  // their real values, which are ordinary Tailwind classes a hand-written
  // element could match by accident. Only an element that reads the constant
  // picks a sentinel up.
  const panelFor = (container: HTMLElement) =>
    container.querySelector('[role="tablist"]')?.nextElementSibling
      ?.firstElementChild;

  it("puts the tab bar row on the rail", () => {
    const { container } = renderViews([makeRuntime("claude")]);
    const row = container.querySelector('[role="tablist"] > div');

    expect(row).toHaveClass(RAIL_SENTINEL);
    expect(row).toHaveClass(GUTTER_SENTINEL);
  });

  it.each([
    ["Activity", null],
    ["Configuration", openConfiguration],
  ])("puts the %s view on the same rail", (_name, open) => {
    const { container } = renderViews([makeRuntime("claude")]);
    open?.();

    expect(panelFor(container as HTMLElement)).toHaveClass(RAIL_SENTINEL);
    expect(panelFor(container as HTMLElement)).toHaveClass(GUTTER_SENTINEL);
  });

  it("puts the Issues view on a bare rail", () => {
    const { container } = renderViews([makeRuntime("claude")]);
    fireEvent.click(screen.getByRole("tab", { name: "Issues" }));

    // The issues toolbar carries the gutter already, so adding one here would
    // inset it past the tabs.
    const panel = panelFor(container as HTMLElement);
    expect(panel).toHaveClass(RAIL_SENTINEL);
    expect(panel).not.toHaveClass(GUTTER_SENTINEL);
  });
});
