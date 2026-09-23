// @vitest-environment jsdom

import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";
import {
  ConfigDraftProvider,
  ConfigSaveBar,
  useConfigDraft,
} from "./config-drafts";

function Editor({
  id,
  label,
  valid = true,
  save = vi.fn(async () => {}),
  discard = vi.fn(),
  slotted = true,
}: {
  id: string;
  label: string;
  valid?: boolean;
  save?: () => Promise<void>;
  discard?: () => void;
  slotted?: boolean;
}) {
  const [dirty, setDirty] = useState(false);
  const managed = useConfigDraft(
    slotted ? { id, anchor: id, label } : undefined,
    {
      dirty,
      valid,
      save: async () => {
        await save();
        setDirty(false);
      },
      discard: () => {
        discard();
        setDirty(false);
      },
    },
  );
  return (
    <div>
      <button type="button" onClick={() => setDirty(true)}>
        edit {label}
      </button>
      {managed ? null : <button type="button">own save {label}</button>}
    </div>
  );
}

function bar() {
  return within(screen.getByRole("region", { name: "Unsaved changes" }));
}

afterEach(() => cleanup());

describe("ConfigSaveBar", () => {
  it("stays out of the way until something is unsaved", () => {
    renderWithI18n(
      <ConfigDraftProvider>
        <Editor id="instructions" label="Instructions" />
        <ConfigSaveBar onJump={vi.fn()} />
      </ConfigDraftProvider>,
    );

    expect(screen.queryByRole("region", { name: "Unsaved changes" })).toBeNull();
    // Inside the page the editor hands its Save button to the bar.
    expect(screen.queryByText("own save Instructions")).toBeNull();
  });

  it("names every unsaved section and jumps to it", () => {
    const onJump = vi.fn();
    renderWithI18n(
      <ConfigDraftProvider>
        <Editor id="instructions" label="Instructions" />
        <Editor id="env" label="Environment" />
        <ConfigSaveBar onJump={onJump} />
      </ConfigDraftProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "edit Instructions" }));
    fireEvent.click(screen.getByRole("button", { name: "edit Environment" }));

    expect(bar().getByText("2 unsaved changes")).toBeInTheDocument();
    fireEvent.click(bar().getByRole("button", { name: "Environment" }));
    expect(onJump).toHaveBeenCalledWith("env");
  });

  it("saves every unsaved section, carrying on past a failure", async () => {
    const failing = vi.fn(async () => {
      throw new Error("boom");
    });
    const passing = vi.fn(async () => {});
    renderWithI18n(
      <ConfigDraftProvider>
        <Editor id="instructions" label="Instructions" save={failing} />
        <Editor id="env" label="Environment" save={passing} />
        <ConfigSaveBar onJump={vi.fn()} />
      </ConfigDraftProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "edit Instructions" }));
    fireEvent.click(screen.getByRole("button", { name: "edit Environment" }));

    await act(async () => {
      fireEvent.click(bar().getByRole("button", { name: "Save" }));
    });

    expect(failing).toHaveBeenCalledTimes(1);
    expect(passing).toHaveBeenCalledTimes(1);
    // The failed section keeps its draft; the saved one leaves the bar.
    expect(bar().getByText("1 unsaved change")).toBeInTheDocument();
    expect(bar().getByRole("button", { name: "Instructions" })).toBeInTheDocument();
  });

  it("discards every unsaved section", () => {
    const discard = vi.fn();
    renderWithI18n(
      <ConfigDraftProvider>
        <Editor id="instructions" label="Instructions" discard={discard} />
        <ConfigSaveBar onJump={vi.fn()} />
      </ConfigDraftProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "edit Instructions" }));

    fireEvent.click(bar().getByRole("button", { name: "Discard" }));

    expect(discard).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("region", { name: "Unsaved changes" })).toBeNull();
  });

  it("blocks saving while a section cannot be committed and says which", () => {
    renderWithI18n(
      <ConfigDraftProvider>
        <Editor id="custom_args" label="Custom Args" valid={false} />
        <ConfigSaveBar onJump={vi.fn()} />
      </ConfigDraftProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "edit Custom Args" }));

    expect(bar().getByRole("button", { name: "Save" })).toBeDisabled();
    expect(bar().getByText("Fix before saving: Custom Args")).toBeInTheDocument();
  });

  it("reports whether anything is unsaved to the page", () => {
    const onDirtyChange = vi.fn();
    renderWithI18n(
      <ConfigDraftProvider onDirtyChange={onDirtyChange}>
        <Editor id="instructions" label="Instructions" />
      </ConfigDraftProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "edit Instructions" }));

    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });
});

describe("useConfigDraft", () => {
  it("leaves an editor its own Save button outside the configuration page", () => {
    renderWithI18n(<Editor id="instructions" label="Instructions" />);

    expect(screen.getByText("own save Instructions")).toBeInTheDocument();
  });

  it("leaves an editor its own Save button when it was given no slot", () => {
    renderWithI18n(
      <ConfigDraftProvider>
        <Editor id="instructions" label="Instructions" slotted={false} />
      </ConfigDraftProvider>,
    );

    expect(screen.getByText("own save Instructions")).toBeInTheDocument();
  });
});
