"use client";

import { useState } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type {
  Agent,
  AgentRuntime,
  AgentTask,
  RuntimeProfile,
} from "@multica/core/types";
import { isRuntimeUsableForUser } from "@multica/core/runtimes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { DeleteRuntimeDialog } from "./delete-runtime-dialog";
import { DeleteRuntimeProfileDialog } from "./delete-runtime-profile-dialog";
import { RuntimeProfilesDialog } from "./runtime-profiles-dialog";
import { useT } from "../../i18n";

// Shared runtime pieces for the machines list and the machine page: the
// per-runtime workload index, the usage-read rule and the runtime actions
// menu (edit a custom runtime, delete).

interface RuntimeWorkload {
  agentIds: string[];
  runningCount: number;
  queuedCount: number;
}

// Per-runtime workload snapshot — agent IDs serving this runtime (drives
// the avatar stack; .length doubles as the agent count) plus task counts
// split by status. Built once per render off the workspace-wide
// agents / agent-task-snapshot caches; filtered locally — no extra requests.
export function buildWorkloadIndex(
  agents: Agent[],
  tasks: AgentTask[],
): Map<string, RuntimeWorkload> {
  const result = new Map<string, RuntimeWorkload>();
  const agentToRuntime = new Map<string, string>();

  for (const a of agents) {
    if (!a.runtime_id || a.archived_at) continue;
    agentToRuntime.set(a.id, a.runtime_id);
    const entry =
      result.get(a.runtime_id) ?? {
        agentIds: [],
        runningCount: 0,
        queuedCount: 0,
      };
    entry.agentIds.push(a.id);
    result.set(a.runtime_id, entry);
  }
  for (const t of tasks) {
    const rid = agentToRuntime.get(t.agent_id);
    if (!rid) continue;
    const entry = result.get(rid);
    if (!entry) continue;
    if (t.status === "running") entry.runningCount += 1;
    else if (t.status === "queued" || t.status === "dispatched")
      entry.queuedCount += 1;
  }
  return result;
}

export function canReadRuntimeUsage(
  runtime: AgentRuntime,
  currentUserId: string | null,
): boolean {
  return isRuntimeUsableForUser(runtime, currentUserId);
}

export function RuntimeRowMenu({
  runtime,
  profile,
  wsId,
  canDelete,
}: {
  runtime: AgentRuntime;
  profile: RuntimeProfile | null;
  wsId: string;
  canDelete: boolean;
}) {
  const { t } = useT("runtimes");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const isCustomRuntime = !!runtime.profile_id;
  // Delete is the row's only management action; if the row can't run it, drop
  // the kebab entirely so the column doesn't render a near-empty popover. We
  // used to also hide it for self-healing runtimes (live local daemon
  // re-registers within seconds), but MUL-3352 surfaced that owners read
  // a missing kebab as "I lost my permission" rather than "the daemon
  // would undo this". The dialog now carries the self-heal warning and
  // the user gets to decide.

  if (!canDelete) {
    return <span aria-hidden />;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={t(($) => $.list.row_actions_aria)}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/row:opacity-100 data-popup-open:bg-accent data-popup-open:opacity-100 data-popup-open:text-accent-foreground"
            >
              <MoreHorizontal className="size-4" />
            </button>
          }
        />
        <DropdownMenuContent align="end" className="w-40">
          {isCustomRuntime && profile && (
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
              {t(($) => $.list.edit_action)}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
            title={t(($) => $.list.delete_permission_hint)}
          >
            <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
            {isCustomRuntime
              ? t(($) => $.list.delete_profile_action)
              : t(($) => $.list.delete_action)}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {isCustomRuntime && profile && editOpen && (
        <RuntimeProfilesDialog
          wsId={wsId}
          intent="edit"
          initialProfile={profile}
          onClose={() => setEditOpen(false)}
        />
      )}
      {isCustomRuntime && profile ? (
        <DeleteRuntimeProfileDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          profile={profile}
          wsId={wsId}
          onDeleted={() => setDeleteOpen(false)}
        />
      ) : (
        <DeleteRuntimeDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          runtime={runtime}
          wsId={wsId}
          onDeleted={() => {
            setDeleteOpen(false);
            toast.success(t(($) => $.detail.toast_deleted));
          }}
        />
      )}
    </>
  );
}
