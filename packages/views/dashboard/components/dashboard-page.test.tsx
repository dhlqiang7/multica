import { useMemo, useState } from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithI18n } from "../../test/i18n";
import { NavigationProvider } from "../../navigation";
import type { NavigationAdapter } from "../../navigation";

// Capture every queryKey passed to useQuery. queryOptions() inside the
// dashboard options builders runs for real, so the key is the production key.
const queryKeys = vi.hoisted(() => [] as unknown[][]);
const dashboardDataRef = vi.hoisted(() => ({ current: false }));
// Swaps the failure fixtures for enough agents to exercise the offender cap.
const manyAgentsRef = vi.hoisted(() => ({ current: false }));
// Adds rows the server folded onto its `__restricted_agents__` bucket — what
// a plain member receives for agents they may not view (MUL-5409).
const restrictedBucketRef = vi.hoisted(() => ({ current: false }));

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function ago(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

type IssueFixture = Record<string, unknown>;

function issue(over: IssueFixture): IssueFixture {
  return {
    issue_id: `issue-${String(over.identifier)}`,
    title: `Title of ${String(over.identifier)}`,
    status: "done",
    status_kind: "done",
    project_id: null,
    source: "member",
    agent_id: "agent-1",
    assigned_at: ago(3 * HOUR),
    delivered_at: null,
    accepted_at: null,
    bounce_count: 0,
    last_bounce_at: null,
    run_count: 1,
    failed_run_count: 0,
    run_seconds: 600,
    ...over,
  };
}

// Current period (last 30 days, UTC):
//   Agent One  MUL-1 done first time · MUL-2 in review for 3 days ·
//              MUL-3 sent back twice, reworking · MUL-4 blocked, undelivered
//   Agent Two  MUL-11..16 all done, five of them sent back once; 12 runs,
//              6 failed
// Previous period: MUL-0, done.
//
// So: 10 picked up, 9 delivered, 7 done, 3 first pass (33%), 6 reworked with
// 7 bounces, and one issue in each of in_review / reworking / blocked.
function deliveryFixture() {
  const windowStart = new Date(`${todayIso()}T00:00:00Z`);
  windowStart.setUTCDate(windowStart.getUTCDate() - 29);
  const previousStart = new Date(windowStart);
  previousStart.setUTCDate(previousStart.getUTCDate() - 30);
  const issues = [
    issue({
      identifier: "MUL-1",
      delivered_at: ago(2 * HOUR),
      accepted_at: ago(HOUR),
      run_count: 2,
    }),
    issue({
      identifier: "MUL-2",
      status: "in_review",
      status_kind: "in_review",
      assigned_at: ago(3 * DAY + HOUR),
      delivered_at: ago(3 * DAY),
    }),
    issue({
      identifier: "MUL-3",
      status: "in_progress",
      status_kind: "in_progress",
      assigned_at: ago(2 * DAY),
      delivered_at: ago(DAY),
      bounce_count: 2,
      last_bounce_at: ago(20 * HOUR),
    }),
    issue({
      identifier: "MUL-4",
      status: "blocked",
      status_kind: "blocked",
      assigned_at: ago(5 * HOUR),
    }),
    ...Array.from({ length: 6 }, (_, i) =>
      issue({
        identifier: `MUL-1${i + 1}`,
        agent_id: "agent-2",
        source: i < 2 ? "autopilot" : "member",
        assigned_at: ago(2 * DAY),
        delivered_at: ago(DAY),
        accepted_at: ago(12 * HOUR),
        bounce_count: i < 5 ? 1 : 0,
        last_bounce_at: i < 5 ? ago(20 * HOUR) : null,
        run_count: 2,
        failed_run_count: 1,
      }),
    ),
    issue({
      identifier: "MUL-0",
      assigned_at: ago(40 * DAY),
      delivered_at: ago(39 * DAY),
      accepted_at: ago(38 * DAY),
    }),
  ];
  if (restrictedBucketRef.current) {
    issues.push(
      issue({
        identifier: "MUL-99",
        agent_id: "__restricted_agents__",
        delivered_at: ago(HOUR),
        accepted_at: ago(HOUR),
      }),
    );
  }
  return {
    window_start: windowStart.toISOString(),
    previous_window_start: previousStart.toISOString(),
    issues,
  };
}

const BREAKDOWN = [
  {
    agent_id: "agent-1",
    runtime_id: "rt-1",
    project_id: "",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    input_tokens: 1_000,
    output_tokens: 2_000,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    task_count: 2,
  },
  {
    agent_id: "agent-2",
    runtime_id: "rt-gone",
    project_id: "proj-1",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    input_tokens: 2_000,
    output_tokens: 4_000,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    task_count: 4,
  },
];

vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>(
      "@tanstack/react-query",
    );
  return {
    ...actual,
    // The page reads the client only to invalidate the dashboard keys from
    // the refresh button; there is no provider in these renders.
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
    useQuery: (opts: { queryKey: unknown[] }) => {
      queryKeys.push(opts.queryKey);
      if (!dashboardDataRef.current) return { data: undefined, isLoading: true };
      const ok = (data: unknown) => ({
        data,
        isLoading: false,
        isSuccess: true,
        dataUpdatedAt: Date.now(),
      });
      const [root, , kind] = opts.queryKey;
      if (root === "workspaces" && kind === "agents") {
        return ok(
          manyAgentsRef.current
            ? Array.from({ length: 12 }, (_, i) => ({ id: `bulk-${i}`, name: `Bulk Agent ${i}` }))
            : [
                { id: "agent-1", name: "Agent One" },
                { id: "agent-2", name: "Agent Two" },
              ],
        );
      }
      if (root === "projects") return ok([{ id: "proj-1", title: "Website", icon: null }]);
      if (root === "runtimes") {
        return ok([{ id: "rt-1", name: "Claude (studio)", custom_name: null, provider: "claude" }]);
      }
      if (root !== "dashboard") return ok([]);

      if (manyAgentsRef.current && kind === "failures-by-agent") {
        return ok(
          Array.from({ length: 12 }, (_, i) => [
            { agent_id: `bulk-${i}`, failure_reason: "", task_count: 100 },
            { agent_id: `bulk-${i}`, failure_reason: "timeout", task_count: 12 - i },
          ]).flat(),
        );
      }
      switch (kind) {
        case "delivery":
          return ok(deliveryFixture());
        case "usage-breakdown":
          return ok(
            restrictedBucketRef.current
              ? [...BREAKDOWN, { ...BREAKDOWN[0], agent_id: "__restricted_agents__" }]
              : BREAKDOWN,
          );
        case "daily":
          return ok([
            {
              date: todayIso(),
              provider: "anthropic",
              model: "claude-sonnet-4-6",
              input_tokens: 3_000,
              output_tokens: 6_000,
              cache_read_tokens: 0,
              cache_write_tokens: 0,
              task_count: 6,
            },
          ]);
        case "runtime-daily":
          return ok([
            { date: todayIso(), total_seconds: 3 * 3_600, task_count: 12, failed_count: 1 },
          ]);
        // `failure_reason: ""` is the succeeded bucket — the denominator
        // behind every rate the Reliability tab shows.
        case "failures-daily":
          return ok([
            { date: todayIso(), failure_reason: "", task_count: 6 },
            {
              date: todayIso(),
              failure_reason: "agent_error.provider_auth_or_access",
              task_count: 3,
            },
            { date: todayIso(), failure_reason: "timeout", task_count: 1 },
          ]);
        case "failures-by-agent":
          return ok([
            { agent_id: "agent-1", failure_reason: "", task_count: 6 },
            {
              agent_id: "agent-1",
              failure_reason: "agent_error.provider_auth_or_access",
              task_count: 3,
            },
            { agent_id: "agent-1", failure_reason: "timeout", task_count: 1 },
            // Not in the agent list — a private agent this member cannot see,
            // or a deleted one. The rollup still returns it.
            {
              agent_id: "0f9d1c2e-private-agent-uuid",
              failure_reason: "agent_error.provider_auth_or_access",
              task_count: 2,
            },
          ]);
        default:
          return ok([]);
      }
    },
  };
});

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

// ActorAvatar resolves avatar URLs through the api singleton.
vi.mock("@multica/core/api", () => ({
  api: { getBaseUrl: () => "https://example.test" },
}));

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({
    agentDetail: (id: string) => `/acme/agents/${id}`,
    issueDetail: (id: string) => `/acme/issues/${id}`,
  }),
}));

const tzRef = vi.hoisted(() => ({ current: "UTC" as string | null }));

vi.mock("@multica/core/auth", () => {
  type AuthState = { user: { timezone: string | null } | null };
  const state = (): AuthState => ({ user: { timezone: tzRef.current } });
  const useAuthStore = Object.assign(
    (sel?: (s: AuthState) => unknown) => (sel ? sel(state()) : state()),
    { getState: state },
  );
  return { useAuthStore };
});

vi.mock("@multica/core/runtimes/custom-pricing-store", () => {
  const state = () => ({ pricings: {} });
  const useCustomPricingStore = Object.assign(
    (sel?: (s: ReturnType<typeof state>) => unknown) =>
      sel ? sel(state()) : state(),
    { getState: state },
  );
  return { useCustomPricingStore };
});

import { DashboardPage } from "./dashboard-page";

const replaceSpy = vi.fn();

/**
 * A navigation adapter that actually holds the query string, because the tab
 * IS the URL: the page reads `?tab=` and writes it back through `replace`.
 */
function DashboardHarness({ initialSearch = "" }: { initialSearch?: string }) {
  const [search, setSearch] = useState(initialSearch);
  const adapter = useMemo<NavigationAdapter>(
    () => ({
      push: vi.fn(),
      replace: (path: string) => {
        replaceSpy(path);
        setSearch(path.split("?")[1] ?? "");
      },
      back: vi.fn(),
      pathname: "/acme/usage",
      searchParams: new URLSearchParams(search),
      hash: "",
      getShareableUrl: (path: string) => `https://example.test${path}`,
    }),
    [search],
  );
  return (
    <NavigationProvider value={adapter}>
      <DashboardPage />
    </NavigationProvider>
  );
}

function renderDashboard(initialSearch = "") {
  return renderWithI18n(<DashboardHarness initialSearch={initialSearch} />);
}

async function openTab(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("tab", { name }));
}

function offenderSort(): HTMLElement {
  return screen.getByRole("group", { name: "Rank offenders by" });
}

function offenderBar(index: number): HTMLElement {
  const rows = within(
    screen.getByRole("list", { name: "Top offenders" }),
  ).getAllByRole("listitem");
  return within(rows[index] as HTMLElement).getByRole("img");
}

function scorecardRows(): HTMLElement[] {
  return within(screen.getByRole("list", { name: "Agent scorecard" })).getAllByRole(
    "listitem",
  );
}

function resetFixtures() {
  queryKeys.length = 0;
  dashboardDataRef.current = true;
  manyAgentsRef.current = false;
  restrictedBucketRef.current = false;
  tzRef.current = "UTC";
  replaceSpy.mockClear();
  cleanup();
}

describe("DashboardPage — viewing timezone drives the query key", () => {
  beforeEach(() => {
    resetFixtures();
    dashboardDataRef.current = false;
  });

  // The `tz` segment is the last element of every dashboard key.
  function tzSegments(): unknown[] {
    return queryKeys
      .filter((k) => k[0] === "dashboard")
      .map((k) => k[k.length - 1]);
  }

  it("uses the stored timezone in every dashboard query key", () => {
    renderDashboard();

    const tzs = tzSegments();
    expect(tzs.length).toBeGreaterThan(0);
    expect(tzs.every((tz) => tz === "UTC")).toBe(true);
  });

  it("flips the query key when the stored timezone changes", () => {
    renderDashboard();
    const utcKeys = queryKeys.filter((k) => k[0] === "dashboard");

    queryKeys.length = 0;
    cleanup();

    tzRef.current = "Asia/Tokyo";
    renderDashboard();
    const tokyoKeys = queryKeys.filter((k) => k[0] === "dashboard");

    expect(utcKeys.length).toBe(tokyoKeys.length);
    expect(utcKeys.length).toBeGreaterThan(0);
    for (let i = 0; i < utcKeys.length; i++) {
      expect(utcKeys[i]).not.toEqual(tokyoKeys[i]);
    }
  });

  it("fetches the per-date series far enough back to compare with the previous period", () => {
    renderDashboard();

    // days=30 by default: the headline deltas need days 31-60 too.
    const daily = queryKeys.find((k) => k[0] === "dashboard" && k[2] === "daily");
    expect(daily?.[3]).toBe(60);
    const delivery = queryKeys.find((k) => k[0] === "dashboard" && k[2] === "delivery");
    expect(delivery?.[3]).toBe(30);
  });
});

describe("DashboardPage — overview reads as a delivery report", () => {
  beforeEach(resetFixtures);

  it("leads with deliveries and their quality, each against the previous period", () => {
    const { container } = renderDashboard();

    // 9 delivered this period against 1 in the previous one.
    expect(container).toHaveTextContent("Delivered");
    expect(container).toHaveTextContent("vs 1 last period");
    expect(container).toHaveTextContent("First-pass rate");
    expect(container).toHaveTextContent("Cost per delivery");
    // No token count in the headline: that belongs to the Cost tab.
    expect(screen.queryByText("Tokens")).not.toBeInTheDocument();
  });

  it("walks the funnel from pickup to done and splits what is still open", () => {
    renderDashboard();

    expect(screen.getByText("Where the 3 issues not done yet are")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /In review\s*1/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Reworking\s*1/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Blocked\s*1/ })).toBeEnabled();
    // A stage with nothing in it has nothing to open.
    expect(screen.getByRole("button", { name: /Cancelled\s*0/ })).toBeDisabled();
    expect(
      screen.getByText("6 delivered issues were sent back, 7 times in total"),
    ).toBeInTheDocument();
  });

  it("opens the issues behind a funnel count, each linking to the issue", async () => {
    const user = userEvent.setup();
    renderDashboard();

    await user.click(screen.getByRole("button", { name: /In review\s*1/ }));

    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("1 issue")).toBeInTheDocument();
    const link = within(sheet).getByRole("link", { name: /MUL-2/ });
    expect(link).toHaveAttribute("href", "/acme/issues/issue-MUL-2");
    // In review for three days: the wait is on the row.
    expect(link).toHaveTextContent("Waiting 3 days");
  });

  it("lists sent-back issues with how often each went back", async () => {
    const user = userEvent.setup();
    renderDashboard();

    await user.click(screen.getByRole("button", { name: /were sent back/ }));

    const sheet = await screen.findByRole("dialog");
    const links = within(sheet).getAllByRole("link");
    expect(links).toHaveLength(6);
    // Most-bounced first.
    expect(links[0]).toHaveTextContent("MUL-3");
    expect(links[0]).toHaveTextContent("Sent back 2 times");
  });

  it("surfaces at most three findings, most actionable first", () => {
    renderDashboard();

    const card = screen.getByText("Worth a look").closest("div.rounded-lg") as HTMLElement;
    const items = within(card).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Agent Two's failure rate is up to 50%");
    expect(items[1]).toHaveTextContent("1 issue has waited over 2 days for review");
    expect(items[2]).toHaveTextContent("Agent Two's first-pass rate is only 17%");
  });

  it("sends a failure finding to the Reliability tab", async () => {
    const user = userEvent.setup();
    renderDashboard();

    await user.click(screen.getByRole("button", { name: "Open Reliability" }));

    expect(replaceSpy).toHaveBeenLastCalledWith("/acme/usage?tab=reliability");
    expect(screen.getByRole("list", { name: "Top offenders" })).toBeInTheDocument();
  });
});

describe("DashboardPage — agent scorecard", () => {
  beforeEach(resetFixtures);
  afterEach(() => {
    restrictedBucketRef.current = false;
  });

  it("gives every agent one row plus the team as the reference", () => {
    renderDashboard();

    const rows = scorecardRows();
    // Two agents, most deliveries first, then the team row.
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Agent Two");
    expect(rows[1]).toHaveTextContent("Agent One");
    expect(rows[2]).toHaveTextContent("Team");
    expect(rows[2]).toHaveTextContent("9");
  });

  it("flags a first-pass rate well below the team's, and opens its sent-back issues", async () => {
    const user = userEvent.setup();
    renderDashboard();

    const agentTwo = scorecardRows()[0] as HTMLElement;
    const flagged = within(agentTwo).getByRole("button", {
      name: "Show Agent Two's sent-back issues",
    });
    expect(flagged).toHaveTextContent("17%");
    expect(flagged).toHaveClass("text-destructive");

    await user.click(flagged);
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Agent Two's sent-back issues")).toBeInTheDocument();
    expect(within(sheet).getAllByRole("link")).toHaveLength(5);
  });

  it("prices each delivery from the agent's own spend", () => {
    renderDashboard();

    // Agent One: $0.033 of spend over 3 deliveries.
    expect(scorecardRows()[1]).toHaveTextContent("$0.01");
  });

  it("labels the server's restricted bucket neutrally and never prints its id", () => {
    restrictedBucketRef.current = true;
    const { container } = renderDashboard();

    const bucket = scorecardRows().find((r) => r.textContent?.includes("Other agents"));
    expect(bucket).toBeDefined();
    expect(container).not.toHaveTextContent("__restricted_agents__");
    expect(container).not.toHaveTextContent("Deleted agents");
  });

  it("exposes wide columns through a named keyboard-focusable local scroller", () => {
    renderDashboard();

    const scroller = screen.getByRole("region", { name: "Agent scorecard" });
    expect(scroller).toHaveAttribute("tabindex", "0");
    expect(scroller).toHaveClass("overflow-x-auto", "overscroll-x-contain");
  });
});

describe("DashboardPage — delivery and cost tabs", () => {
  beforeEach(resetFixtures);

  it("splits pickups by who created the issue", async () => {
    const user = userEvent.setup();
    renderDashboard();
    await openTab(user, "Delivery");

    expect(screen.getByText("Created by autopilots")).toBeInTheDocument();
    expect(screen.getByText("Where the time goes")).toBeInTheDocument();
  });

  it("regroups spend by runtime and project, naming what no longer exists", async () => {
    const user = userEvent.setup();
    renderDashboard();
    await openTab(user, "Cost");

    const group = screen.getByRole("group", { name: "Group by" });
    await user.click(within(group).getByRole("button", { name: "Runtime" }));
    const table = screen.getByRole("region", { name: "Cost breakdown" });
    expect(table).toHaveTextContent("Claude (studio)");
    expect(table).toHaveTextContent("Removed runtime");

    await user.click(within(group).getByRole("button", { name: "Project" }));
    expect(table).toHaveTextContent("Website");
    expect(table).toHaveTextContent("No project");
  });

  it("keeps the spend trend and its metric toggle on the Cost tab", async () => {
    const user = userEvent.setup();
    renderDashboard();
    await openTab(user, "Cost");

    const metrics = within(screen.getByRole("group", { name: "Metric" }));
    expect(metrics.getByRole("button", { name: "Tokens" })).toBeInTheDocument();
    expect(metrics.queryByRole("button", { name: "Errors" })).not.toBeInTheDocument();
  });
});

describe("DashboardPage — reliability", () => {
  beforeEach(resetFixtures);

  it("states the error rate with its denominator spelled out", async () => {
    const user = userEvent.setup();
    renderDashboard();
    await openTab(user, "Reliability");

    expect(screen.getByText("4 of 10 runs failed · 40%")).toBeInTheDocument();
  });

  it("breaks failures down by class and links the offending agent to its runs", async () => {
    const user = userEvent.setup();
    renderDashboard();
    await openTab(user, "Reliability");

    const byClass = within(screen.getByRole("list", { name: "Failure mix" }));
    expect(byClass.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Auth3",
      "Timeout1",
    ]);

    const byAgent = within(screen.getByRole("list", { name: "Top offenders" }));
    const link = byAgent.getByRole("link", { name: /Agent One/ });
    expect(link).toHaveAttribute("href", "/acme/agents/agent-1?view=overview");
    const row = byAgent.getAllByRole("listitem")[0] as HTMLElement;
    expect(within(row).getByRole("img")).toHaveAccessibleName("Auth 3 · Timeout 1");
  });

  it("moves the bar onto whichever metric the list is ranked by", async () => {
    const user = userEvent.setup();
    renderDashboard();
    await openTab(user, "Reliability");

    expect(offenderBar(1).style.width).toBe("50%");
    await user.click(within(offenderSort()).getByRole("button", { name: "Rate" }));
    expect(offenderBar(1).style.width).toBe("100%");
  });

  it("folds an unresolvable agent into an anonymous row instead of printing its UUID", async () => {
    const user = userEvent.setup();
    const { container } = renderDashboard();
    await openTab(user, "Reliability");

    expect(container).not.toHaveTextContent("0f9d1c2e-private-agent-uuid");
    const byAgent = within(screen.getByRole("list", { name: "Top offenders" }));
    expect(byAgent.getByText("Other agents")).toBeInTheDocument();
    expect(byAgent.queryByRole("link", { name: /Other agents/ })).not.toBeInTheDocument();
  });

  it("caps the offender list and expands it on demand", async () => {
    manyAgentsRef.current = true;
    const user = userEvent.setup();
    renderDashboard();
    await openTab(user, "Reliability");

    const list = () => screen.getByRole("list", { name: "Top offenders" });
    expect(within(list()).getAllByRole("listitem")).toHaveLength(8);
    await user.click(screen.getByRole("button", { name: "Show all 12" }));
    expect(within(list()).getAllByRole("listitem")).toHaveLength(12);
  });
});

describe("DashboardPage — tabs live in the URL", () => {
  beforeEach(resetFixtures);

  it("writes the tab to the URL and drops it for the default view", async () => {
    const user = userEvent.setup();
    renderDashboard();

    await openTab(user, "Cost");
    expect(replaceSpy).toHaveBeenLastCalledWith("/acme/usage?tab=cost");

    await openTab(user, "Overview");
    expect(replaceSpy).toHaveBeenLastCalledWith("/acme/usage");
  });

  it("keeps links to the old Errors tab working", () => {
    renderDashboard("tab=errors");

    expect(screen.getByRole("list", { name: "Top offenders" })).toBeInTheDocument();
  });

  it("falls back to Overview for a tab value it does not recognise", () => {
    renderDashboard("tab=nonsense");

    expect(screen.getByRole("list", { name: "Agent scorecard" })).toBeInTheDocument();
  });
});
