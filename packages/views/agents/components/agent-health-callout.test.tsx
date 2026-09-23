// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { AgentPresenceDetail } from "@multica/core/agents";
import { renderWithI18n } from "../../test/i18n";
import {
  NavigationProvider,
  type NavigationAdapter,
} from "../../navigation";
import { AgentHealthCallout } from "./agent-health-callout";

const navigation: NavigationAdapter = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  pathname: "/acme/agents/agent-1",
  searchParams: new URLSearchParams(),
  hash: "",
  getShareableUrl: (path) => path,
};

function presence(
  availability: AgentPresenceDetail["availability"],
  queuedCount: number,
): AgentPresenceDetail {
  return {
    availability,
    workload: queuedCount > 0 ? "queued" : "idle",
    runningCount: 0,
    queuedCount,
    capacity: 2,
  };
}

function renderCallout(
  props: Partial<ComponentProps<typeof AgentHealthCallout>> = {},
) {
  const onRestore = vi.fn();
  const onBindRuntime = vi.fn();
  const view = renderWithI18n(
    <NavigationProvider value={navigation}>
      <AgentHealthCallout
        archived={false}
        runtimeBound
        presence={presence("online", 0)}
        canEdit
        runtimeHref="/acme/runtimes/runtime-1"
        onRestore={onRestore}
        onBindRuntime={onBindRuntime}
        {...props}
      />
    </NavigationProvider>,
  );
  return { onRestore, onBindRuntime, ...view };
}

afterEach(() => cleanup());

describe("AgentHealthCallout", () => {
  it("renders nothing for a healthy agent", () => {
    const { container } = renderCallout();
    expect(container).toBeEmptyDOMElement();
  });

  it("explains a stuck queue on an offline runtime and offers the fixes", () => {
    const { onBindRuntime } = renderCallout({
      presence: presence("offline", 3),
    });

    expect(screen.getByText("Runs need attention")).toBeInTheDocument();
    expect(
      screen.getByText("3 runs are queued while the runtime is unavailable."),
    ).toBeInTheDocument();
    // A link styled as a button: Base UI gives it the button role.
    expect(screen.getByRole("button", { name: "View runtime" })).toHaveAttribute(
      "href",
      "/acme/runtimes/runtime-1",
    );
    fireEvent.click(screen.getByRole("button", { name: "Switch runtime" }));
    expect(onBindRuntime).toHaveBeenCalled();
  });

  it("stays quiet while the runtime is only briefly unstable", () => {
    // Under five minutes the runtime usually comes back on its own; the
    // amber status dot is enough.
    const { container } = renderCallout({ presence: presence("unstable", 3) });
    expect(container).toBeEmptyDOMElement();
  });

  it("stays quiet for an offline runtime with nothing waiting on it", () => {
    const { container } = renderCallout({ presence: presence("offline", 0) });
    expect(container).toBeEmptyDOMElement();
  });

  it("does not offer switching the runtime to someone who cannot edit", () => {
    renderCallout({ presence: presence("offline", 1), canEdit: false });

    expect(
      screen.getByRole("button", { name: "View runtime" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Switch runtime" }),
    ).not.toBeInTheDocument();
  });

  it("puts an unbound runtime ahead of the queue", () => {
    const { onBindRuntime } = renderCallout({
      runtimeBound: false,
      presence: presence("offline", 2),
    });

    expect(screen.queryByText("Runs need attention")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bind runtime" }));
    expect(onBindRuntime).toHaveBeenCalled();
  });

  it("puts archiving ahead of everything and offers a restore", () => {
    const { onRestore } = renderCallout({
      archived: true,
      runtimeBound: false,
      presence: presence("offline", 2),
    });

    expect(
      screen.getByText(/This agent is archived/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Bind runtime" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(onRestore).toHaveBeenCalled();
  });
});
