import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { forwardRef, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TimelineEntry } from "@multica/core/types";
import { renderWithI18n } from "../../test/i18n";

// Comment "more actions" menu layout: resolve is the most used action, so it
// leads the menu in its own group, followed by copy/derive actions and then
// the author's edit/delete group. Pins order and grouping for both the thread
// root and a reply.

vi.mock("@multica/core/api", () => ({
  api: { uploadFile: vi.fn() },
  dispatchReasonCode: () => undefined,
  errorCode: () => undefined,
}));

vi.mock("../../navigation", () => ({
  useNavigation: () => ({
    push: vi.fn(),
    pathname: "/acme/issues",
    getShareableUrl: (p: string) => `https://app.example${p}`,
  }),
}));

vi.mock("@multica/core/workspace/hooks", () => ({
  useActorName: () => ({ getActorName: () => "Ada" }),
}));

vi.mock("../../common/actor-avatar", () => ({
  ActorAvatar: () => null,
}));

vi.mock("../hooks/use-comment-trigger-preview", () => ({
  useCommentTriggerPreview: () => ({ agents: [], blocked: [] }),
}));

vi.mock("../../editor", async () => ({
  ...(await vi.importActual<typeof import("../../editor/use-upload-gate")>("../../editor/use-upload-gate")),
  ...(await vi.importActual<typeof import("../../editor/use-lazy-editor")>("../../editor/use-lazy-editor")),
  ...(await vi.importActual<typeof import("../../editor/use-composer-submit")>("../../editor/use-composer-submit")),
  useEditorUpload: () => ({ uploadWithToast: vi.fn(), upload: vi.fn(), uploading: false }),
  useFileDropZone: () => ({ isDragOver: false, dropZoneProps: {} }),
  FileDropOverlay: () => null,
  ReadonlyContent: ({ content }: { content: string }) => <div>{content}</div>,
  Attachment: () => null,
  AttachmentDownloadProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContentEditor: forwardRef(function MockContentEditor() {
    return <textarea data-testid="editor" />;
  }),
}));

import { CommentCard } from "./comment-card";

function comment(id: string, parentId: string | null): TimelineEntry {
  return {
    type: "comment",
    id,
    actor_type: "member",
    actor_id: "user-1",
    content: `body ${id}`,
    parent_id: parentId,
    comment_type: "comment",
    reactions: [],
    attachments: [],
    created_at: "2026-09-11T07:00:00Z",
    updated_at: "2026-09-11T07:00:00Z",
    revision: 1,
  };
}

function renderThread(root: TimelineEntry, replies: TimelineEntry[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithI18n(
    <QueryClientProvider client={qc}>
      <CommentCard
        issueId="issue-1"
        entry={root}
        replies={replies}
        currentUserId="user-1"
        onReply={vi.fn().mockResolvedValue(true)}
        onEdit={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn()}
        onToggleReaction={vi.fn()}
        onCopyLink={vi.fn()}
        onCreateSubIssue={vi.fn()}
        onResolveToggle={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

const SEPARATOR = "---";

// Menu items and separators in document order, separators as "---".
async function openMenuLayout(index: number): Promise<string[]> {
  fireEvent.click(screen.getAllByRole("button", { name: "Comment actions" })[index]!);
  const menu = await screen.findByRole("menu");
  return Array.from(
    menu.querySelectorAll('[role="menuitem"], [data-slot="dropdown-menu-separator"]'),
    (el) => (el.getAttribute("data-slot") === "dropdown-menu-separator" ? SEPARATOR : el.textContent?.trim() ?? ""),
  );
}

describe("CommentCard — actions menu layout", () => {
  it("leads the root menu with Resolve thread, then copy/derive, then edit/delete", async () => {
    renderThread(comment("root", null), []);

    expect(await openMenuLayout(0)).toEqual([
      "Resolve thread",
      SEPARATOR,
      "Copy",
      "Copy link",
      "Create sub-issue from here",
      SEPARATOR,
      "Edit",
      "Delete",
    ]);
  });

  it("leads a reply's menu with Resolve thread with comment", async () => {
    renderThread(comment("root", null), [comment("reply", "root")]);

    // Menus render in order: root first, then the reply.
    expect(await openMenuLayout(1)).toEqual([
      "Resolve thread with comment",
      SEPARATOR,
      "Copy",
      "Copy link",
      "Create sub-issue from here",
      SEPARATOR,
      "Edit",
      "Delete",
    ]);
  });
});
