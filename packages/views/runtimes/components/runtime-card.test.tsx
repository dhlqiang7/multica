// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { AgentRuntime, RuntimeProfile } from "@multica/core/types";
import { I18nProvider } from "@multica/core/i18n/react";
import enCommon from "../../locales/en/common.json";
import enRuntimes from "../../locales/en/runtimes.json";
import enAgents from "../../locales/en/agents.json";

const TEST_RESOURCES = {
  en: { common: enCommon, runtimes: enRuntimes, agents: enAgents },
};

// The card's dialogs reach into workspace queries; none of them feed what is
// asserted here, but useQuery still has to resolve.
vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>(
      "@tanstack/react-query",
    );
  return {
    ...actual,
    useQuery: vi.fn(() => ({ data: [], isLoading: false })),
  };
});

const mockUpdateRuntime = vi.hoisted(() => vi.fn());

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/runtimes/mutations", () => ({
  useUpdateRuntime: () => ({
    mutate: (
      args: { runtimeId: string; patch: Record<string, unknown> },
      opts?: { onSuccess?: () => void },
    ) => {
      mockUpdateRuntime(args.runtimeId, args.patch);
      opts?.onSuccess?.();
    },
    isPending: false,
  }),
  useDeleteRuntime: () => ({ mutate: vi.fn(), isPending: false, mutateAsync: vi.fn() }),
  useUnbindAgentsAndDeleteRuntime: () => ({
    mutate: vi.fn(),
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}));

vi.mock("@multica/core/runtimes", () => ({
  deriveRuntimeHealth: () => "online",
  runtimeUsageOptions: () => ({ kind: "usage" }),
  runtimeProfileListOptions: () => ({ kind: "runtime-profiles" }),
  parseRuntimeProfileBoundConflict: () => null,
  useDeleteRuntimeProfile: () => ({
    mutate: vi.fn(),
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useCreateRuntimeProfile: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useUpdateRuntimeProfile: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}));

vi.mock("@multica/core/agents", () => ({
  deriveWorkload: () => "idle",
  useWorkspacePresenceMap: () => ({ byAgent: new Map(), loading: false }),
}));

// The unified DeleteRuntimeDialog the kebab now opens reaches into auth +
// the api singleton. The dialog never renders in these tests (`open=false`
// throughout) but its hooks still mount; stub them so module init is clean.
vi.mock("@multica/core/auth", () => ({
  useAuthStore: (sel: (s: { user: { id: string } }) => unknown) =>
    sel({ user: { id: "user-me" } }),
}));

vi.mock("@multica/core/api", () => ({
  api: {
    deleteRuntime: vi.fn(),
    unbindAgentsAndDeleteRuntime: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("./provider-logo", () => ({ ProviderLogo: () => null }));
vi.mock("./shared", () => ({
  HealthIcon: () => null,
  useHealthLabel: () => () => "Online",
}));

import { RuntimeCard } from "./runtime-card";

function makeRuntime(overrides: Partial<AgentRuntime>): AgentRuntime {
  return {
    id: "rt-1",
    workspace_id: "ws-1",
    daemon_id: null,
    name: "Claude (host.local)",
    runtime_mode: "local",
    provider: "claude",
    launch_header: "",
    status: "online",
    device_info: "",
    metadata: {},
    owner_id: "user-me",
    visibility: "private",
    last_seen_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeProfile(overrides: Partial<RuntimeProfile> = {}): RuntimeProfile {
  return {
    id: "profile-1",
    workspace_id: "ws-1",
    display_name: "Custom Codex",
    protocol_family: "codex",
    command_name: "custom-codex",
    description: null,
    fixed_args: [],
    visibility: "workspace",
    created_by: "user-me",
    enabled: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderCard(
  runtime: AgentRuntime,
  options: {
    isAdmin?: boolean;
    profile?: RuntimeProfile | null;
    machineTitle?: string;
  } = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      <QueryClientProvider client={qc}>
        <RuntimeCard
          runtime={runtime}
          machineTitle={options.machineTitle ?? "host.local"}
          agents={[]}
          runningCount={0}
          queuedCount={0}
          profile={options.profile ?? null}
          selected={false}
          now={Date.parse("2026-01-01T00:00:00Z")}
          currentUserId="user-me"
          isAdmin={options.isAdmin ?? false}
        />
      </QueryClientProvider>
    </I18nProvider>,
  );
}

describe("RuntimeCard actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers delete to the owner of a live local runtime (self-healing is not hidden)", () => {
    // MUL-3352: hiding the menu on a self-healing runtime read as a missing
    // permission. The dialog carries the self-heal warning instead.
    renderCard(makeRuntime({ status: "online" }));
    expect(screen.getByLabelText("Row actions")).toBeInTheDocument();
  });

  it("hides the menu when the viewer can neither edit nor delete", () => {
    renderCard(makeRuntime({ owner_id: "someone-else" }));
    expect(screen.queryByLabelText("Row actions")).not.toBeInTheDocument();
  });

  it("lets a workspace admin edit a custom runtime from its card", () => {
    const profile = makeProfile();
    renderCard(makeRuntime({ profile_id: profile.id }), {
      isAdmin: true,
      profile,
    });

    fireEvent.click(screen.getByLabelText("Row actions"));
    fireEvent.click(screen.getByText("Edit custom runtime"));

    expect(
      screen.getByRole("heading", { name: "Edit custom runtime" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toHaveValue("Custom Codex");
  });

  it("keeps custom runtime deletion from non-admin owners", () => {
    const profile = makeProfile();
    renderCard(makeRuntime({ profile_id: profile.id }), { profile });
    expect(screen.queryByLabelText("Row actions")).not.toBeInTheDocument();
  });
});

describe("RuntimeCard identity", () => {
  // #3838: every runtime showed the same number because the shared daemon
  // `cli_version` was rendered. The card shows the agent CLI's own version.
  it("shows the agent's own CLI version, not the shared daemon version", () => {
    renderCard(
      makeRuntime({
        metadata: { version: "2.1.5 (Claude Code)", cli_version: "0.3.17" },
      }),
    );
    expect(screen.getByText("2.1.5 (Claude Code)")).toBeInTheDocument();
    expect(screen.queryByText("0.3.17")).not.toBeInTheDocument();
  });

  it("uses the provider name when the runtime alias is the machine name", () => {
    renderCard(makeRuntime({ custom_name: "Studio Mac" }), {
      machineTitle: "Studio Mac",
    });
    expect(screen.getByText("Claude")).toBeInTheDocument();
  });

  it("keeps a runtime-specific alias that differs from the machine name", () => {
    renderCard(makeRuntime({ custom_name: "Night shift" }), {
      machineTitle: "Studio Mac",
    });
    expect(screen.getByText("Night shift")).toBeInTheDocument();
  });
});

describe("RuntimeCard visibility", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lets the owner switch the runtime to public", () => {
    renderCard(makeRuntime({ visibility: "private" }));
    fireEvent.click(screen.getByRole("button", { name: /Public/ }));
    expect(mockUpdateRuntime).toHaveBeenCalledWith("rt-1", {
      visibility: "public",
    });
  });

  it("keeps visibility read-only for a workspace admin who does not own it", () => {
    // MUL-6126: sharing a machine is the owner's call.
    renderCard(makeRuntime({ owner_id: "someone-else", visibility: "public" }), {
      isAdmin: true,
    });
    expect(
      screen.queryByRole("button", { name: /Private/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Public")).toBeInTheDocument();
  });
});
