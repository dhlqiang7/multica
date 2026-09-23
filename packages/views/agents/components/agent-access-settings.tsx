"use client";

import type { Agent, MemberWithUser } from "@multica/core/types";
import { SettingsCard } from "../../settings/components/settings-layout";
import type { ConfigDraftSlot } from "./config-drafts";
import { AccessPicker } from "./inspector/access-picker";

export function AgentAccessSettings({
  agent,
  members,
  currentUserId,
  draftSlot,
  onUpdate,
}: {
  agent: Agent;
  members: MemberWithUser[];
  currentUserId: string | null;
  draftSlot?: ConfigDraftSlot;
  onUpdate: (id: string, data: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <SettingsCard>
      <AccessPicker
        permissionMode={agent.permission_mode}
        invocationTargets={agent.invocation_targets}
        visibility={agent.visibility}
        members={members}
        ownerId={agent.owner_id}
        canEdit={currentUserId !== null && agent.owner_id === currentUserId}
        hasComposioAllowlist={
          (agent.composio_toolkit_allowlist ?? []).length > 0
        }
        draftSlot={draftSlot}
        onChange={(next) => onUpdate(agent.id, next)}
      />
    </SettingsCard>
  );
}
