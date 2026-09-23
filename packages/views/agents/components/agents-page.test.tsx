import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import type { Agent } from "@multica/core/types";
import type { AgentActivity } from "@multica/core/agents";
import type { SupportedLocale } from "@multica/core/i18n";
import { renderWithI18n } from "../../test/i18n";
import { NavigationProvider, type NavigationAdapter } from "../../navigation";
import { AgentsPage } from "./agents-page";

// These tests pin the `listReady` render gate (MUL-4511) and the status
// grouping (MUL-7661): the Agents list must not paint real rows until the
// auxiliary queries the view depends on have landed, or it places rows on
// placeholder values and visibly re-orders when each query resolves. Sorting
// by last active / runs waits on activity; the status groups wait on
// presence. The empty state never waits on either.

const mocks = vi.hoisted(() => ({
  agents: [] as Agent[],
  agentsLoading: false,
  activity: {
    byAgent: new Map<string, AgentActivity>(),
    loading: false,
  },
  presence: {
    byAgent: new Map<string, unknown>(),
    loading: false,
  },
  viewState: {
    scope: "all",
    sortField: "lastActive" as string,
    sortDirection: "desc" as string,
    hiddenColumns: ["access", "model", "created"] as string[],
    groupBy: "status" as string,
    filters: {
      runtimes: [] as string[],
      owners: [] as string[],
      models: [] as string[],
      access: [] as string[],
    },
    setScope: vi.fn(),
    setGroupBy: vi.fn(),
    toggleSort: vi.fn(),
    setSortField: vi.fn(),
    setSortDirection: vi.fn(),
    toggleColumn: vi.fn(),
    toggleFilter: vi.fn(),
    clearFilters: vi.fn(),
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey?: readonly unknown[] }) => {
    const key = options.queryKey?.[0];
    if (key === "agents") {
      return {
        data: mocks.agents,
        isLoading: mocks.agentsLoading,
        error: null,
        refetch: vi.fn(),
      };
    }
    return { data: [], isLoading: false, isPending: false };
  },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// The list virtualizes; render every row so DOM order reflects sort order.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 64,
        end: (index + 1) * 64,
        size: 64,
      })),
    getTotalSize: () => count * 64,
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@multica/core/agents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@multica/core/agents")>()),
  agentTaskSnapshotOptions: () => ({ queryKey: ["agent-task-snapshot"] }),
  useWorkspaceActivityMap: () => mocks.activity,
  useWorkspacePresenceMap: () => mocks.presence,
}));

vi.mock("@multica/core/agents/stores", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@multica/core/agents/stores")>()),
  useAgentsViewStore: (selector: (state: unknown) => unknown) =>
    selector(mocks.viewState),
}));

vi.mock("@multica/core/permissions", () => ({
  useAgentPermissions: () => ({
    canAssign: { allowed: true },
    canEdit: { allowed: true },
    isLoading: false,
  }),
}));

vi.mock("@multica/core/api", () => ({
  api: { archiveAgent: vi.fn(), restoreAgent: vi.fn() },
}));

vi.mock("@multica/core/auth", () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ user: { id: "user-1" } }),
}));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "workspace-1",
}));

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({
    chat: () => "/test-workspace/chat",
    newAgent: () => "/test-workspace/agents/new",
    newAgentManual: () => "/test-workspace/agents/new/manual",
    agentDetail: (id: string) => `/test-workspace/agents/${id}`,
  }),
}));

vi.mock("@multica/core/workspace/queries", () => ({
  agentListOptions: () => ({ queryKey: ["agents"] }),
  memberListOptions: () => ({ queryKey: ["members"] }),
  workspaceKeys: { agents: (wsId: string) => ["agents", wsId] },
}));

vi.mock("@multica/core/runtimes", () => ({
  runtimeListOptions: () => ({ queryKey: ["runtimes"] }),
  runtimeDisplayLabel: (runtime: { name: string }) => runtime.name,
}));

// View-layer children with heavy / portal deps — stub to keep the test focused
// on the gate, not on avatars, row menus, the toolbar, or tooltip portals.
vi.mock("../../common/actor-avatar", () => ({ ActorAvatar: () => null }));
vi.mock("./agent-row-actions", () => ({ AgentRowActions: () => null }));
vi.mock("./agent-list-toolbar", () => ({
  AgentListToolbar: () => <div data-testid="agent-list-toolbar" />,
  countActiveFilterDimensions: () => 0,
}));
vi.mock("@multica/ui/components/ui/skeleton", () => ({
  Skeleton: (props: Record<string, unknown>) => (
    <div data-testid="skeleton" {...props} />
  ),
}));
vi.mock("@multica/ui/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render }: { render: React.ReactNode }) => <>{render}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div role="tooltip">{children}</div>
  ),
}));

const BASE_AGENT: Agent = {
  id: "agent-base",
  workspace_id: "workspace-1",
  runtime_id: "runtime-1",
  name: "Base Agent",
  description: "",
  instructions: "",
  avatar_url: null,
  runtime_mode: "cloud",
  runtime_config: {},
  custom_args: [],
  visibility: "workspace",
  permission_mode: "private",
  invocation_targets: [],
  status: "idle",
  max_concurrent_tasks: 1,
  model: "claude",
  owner_id: "user-1",
  skills: [],
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
  archived_at: null,
  archived_by: null,
};

function makeAgent(over: Partial<Agent>): Agent {
  return { ...BASE_AGENT, ...over };
}

// Build a 30-bucket activity series whose most-recent bucket with runs is
// `daysAgo` days back — `lastActiveDaysAgo` reads exactly this.
function activityLastActive(daysAgo: number): AgentActivity {
  const buckets = Array.from({ length: 30 }, () => ({ total: 0, failed: 0, completed: 0, cancelled: 0 }));
  buckets[29 - daysAgo] = { total: 1, failed: 0, completed: 1, cancelled: 0 };
  return { buckets, daysSinceCreated: 30 };
}

const ALPHA = makeAgent({ id: "a-alpha", name: "Alpha Agent" });
const BETA = makeAgent({ id: "a-beta", name: "Beta Agent" });

function makeAdapter(
  overrides: Partial<NavigationAdapter> = {},
): NavigationAdapter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/test-workspace/agents",
    searchParams: new URLSearchParams(),
    hash: "",
    getShareableUrl: (p) => p,
    ...overrides,
  };
}

function renderPage(locale?: SupportedLocale) {
  renderWithI18n(
    <NavigationProvider value={makeAdapter()}>
      <AgentsPage />
    </NavigationProvider>,
    { locale },
  );
}

/** Beta before Alpha in document order? */
function betaPrecedesAlpha(): boolean {
  const alpha = screen.getByText("Alpha Agent");
  const beta = screen.getByText("Beta Agent");
  return Boolean(
    beta.compareDocumentPosition(alpha) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

beforeEach(() => {
  mocks.agents = [ALPHA, BETA];
  mocks.agentsLoading = false;
  mocks.activity = { byAgent: new Map(), loading: false };
  mocks.presence = { byAgent: new Map(), loading: false };
  mocks.viewState.scope = "all";
  mocks.viewState.sortField = "lastActive";
  mocks.viewState.sortDirection = "desc";
  mocks.viewState.hiddenColumns = ["access", "model", "created"];
  mocks.viewState.groupBy = "status";
  mocks.viewState.filters = {
    runtimes: [],
    owners: [],
    models: [],
    access: [],
  };
});

describe("AgentsPage listReady gate", () => {
  it("shows only a skeleton (no real rows) while lastActive deps are pending", () => {
    // Default lastActive sort depends on activity.
    mocks.activity = { byAgent: new Map(), loading: true };

    renderPage();

    expect(screen.queryByText("Alpha Agent")).not.toBeInTheDocument();
    expect(screen.queryByText("Beta Agent")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  it("renders rows in the resolved lastActive order once deps land", () => {
    // Alpha active 5d ago, Beta active today → lastActive desc puts Beta first,
    // the opposite of the name-order fallback the ungated list would show.
    mocks.activity = {
      byAgent: new Map<string, AgentActivity>([
        [ALPHA.id, activityLastActive(5)],
        [BETA.id, activityLastActive(0)],
      ]),
      loading: false,
    };

    renderPage();

    expect(screen.getByText("Alpha Agent")).toBeInTheDocument();
    expect(screen.getByText("Beta Agent")).toBeInTheDocument();
    expect(betaPrecedesAlpha()).toBe(true);
  });

  it("renders rows for name sort without waiting on activity", () => {
    mocks.viewState.sortField = "name";
    mocks.viewState.sortDirection = "asc";
    // Activity is still in flight — name sort must not wait on it.
    mocks.activity = { byAgent: new Map(), loading: true };

    renderPage();

    expect(screen.getByText("Alpha Agent")).toBeInTheDocument();
    expect(screen.getByText("Beta Agent")).toBeInTheDocument();
    // name asc → Alpha before Beta.
    expect(betaPrecedesAlpha()).toBe(false);
  });

  it("holds a skeleton while the status groups wait on presence", () => {
    // Ungated, every row would land in "Idle" and then jump to its real
    // group once presence arrives.
    mocks.viewState.sortField = "name";
    mocks.presence = { byAgent: new Map(), loading: true };

    renderPage();

    expect(screen.queryByText("Alpha Agent")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  it("shows the empty state without blocking on auxiliary queries when there are no agents", () => {
    mocks.agents = [];
    // All auxiliary queries pending — the empty state must not wait on them.
    mocks.activity = { byAgent: new Map(), loading: true };
    mocks.presence = { byAgent: new Map(), loading: true };

    renderPage();

    expect(screen.getByText("No agents yet")).toBeInTheDocument();
    expect(screen.queryByTestId("skeleton")).not.toBeInTheDocument();
  });
});

describe("AgentsPage status groups", () => {
  it("puts agents that need a person first, under their own group", () => {
    mocks.viewState.sortField = "name";
    mocks.viewState.sortDirection = "asc";
    // Beta has no runtime; Alpha is idle.
    mocks.agents = [ALPHA, makeAgent({ id: "a-beta", name: "Beta Agent", runtime_id: "" })];

    renderPage();

    const attention = screen.getByRole("rowheader", { name: /Needs attention/ });
    const idle = screen.getByRole("rowheader", { name: /Idle/ });
    expect(
      attention.compareDocumentPosition(idle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(betaPrecedesAlpha()).toBe(true);
    expect(screen.getByText("Needs a runtime")).toBeInTheDocument();
  });

  it("lists rows without group dividers when grouping is off", () => {
    mocks.viewState.groupBy = "none";

    renderPage();

    expect(screen.queryByRole("rowheader")).not.toBeInTheDocument();
    expect(screen.getByText("Alpha Agent")).toBeInTheDocument();
  });
});

describe("AgentsPage docs link", () => {
  it("points Learn more at the viewer's docs locale", () => {
    renderPage("fr");

    expect(
      screen.getByRole("link", { name: "En savoir plus →" }),
    ).toHaveAttribute("href", "https://multica.ai/docs/fr/agents");
  });
});
