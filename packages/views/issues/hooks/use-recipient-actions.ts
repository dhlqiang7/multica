"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { issueTasksOptions } from "@multica/core/issues/queries";
import { useCommentComposerStore } from "@multica/core/issues/stores";
import {
  agentRunState,
  recipientActions,
  recipientRouting,
  resolveRecipientAction,
  steerTarget,
  type AgentRunState,
  type RecipientAction,
  type RecipientRouting,
} from "@multica/core/issues/run-steering";
import type { AgentTask, CommentTriggerPreviewAgent } from "@multica/core/types";

const NO_TASKS: AgentTask[] = [];
const ACTIVE_STATUSES = new Set<AgentTask["status"]>(["queued", "deferred", "dispatched", "waiting_local_directory", "running"]);
const NO_CHOICES: Record<string, RecipientAction> = {};

export interface RecipientEntry {
  agent: CommentTriggerPreviewAgent;
  state: AgentRunState;
  action: RecipientAction;
  actions: RecipientAction[];
}

export interface RecipientNotices {
  /** Recipients whose run ended while the message was still being written. */
  endedAgentNames: string[];
  /** A recipient would take this in its running turn, but files cannot go there. */
  attachmentsBlockSteer: boolean;
}

/**
 * The composer's per-recipient choice. The preview decides WHO receives the
 * message (existing trigger rules); each recipient's live run on this issue
 * decides what can happen to it: steer a running turn, fold into a queued
 * run, or start a new one.
 */
export function useRecipientActions({
  issueId,
  agents,
  allowSteer,
  hasAttachments = false,
  hasDraft,
  steerByDefault: steerHere,
  resetKey,
}: {
  issueId: string;
  agents: CommentTriggerPreviewAgent[];
  /** False for edits: an edit neither steers nor stops a run. */
  allowSteer: boolean;
  hasAttachments?: boolean;
  hasDraft: boolean;
  /** Whether a running turn takes the message by default from this composer. */
  steerByDefault: (task: AgentTask) => boolean;
  /** Choices reset when the composer's context changes. */
  resetKey: string;
}) {
  // Every comment row mounts this hook for its edit composer, so it reads only
  // the active runs of its own recipients: with none (the usual idle row) it
  // neither fetches nor re-renders on unrelated task events.
  const agentKey = agents.map((agent) => agent.id).join(",");
  const selectActive = useCallback((all: AgentTask[]) => {
    const ids = new Set(agentKey.split(","));
    return all.filter((task) => ids.has(task.agent_id) && ACTIVE_STATUSES.has(task.status));
  }, [agentKey]);
  const { data: tasks = NO_TASKS } = useQuery({
    ...issueTasksOptions(issueId),
    enabled: !!issueId && agents.length > 0,
    select: selectActive,
  });
  // The personal default can turn steering off for every composer; it only
  // decides what happens without a per-message choice.
  const steerWithoutChoice = useCommentComposerStore((s) => s.runningAgentReply !== "after_run");
  const steerByDefault = useCallback(
    (task: AgentTask) => steerWithoutChoice && steerHere(task),
    [steerWithoutChoice, steerHere],
  );
  const [chosen, setChosen] = useState<Record<string, RecipientAction>>(NO_CHOICES);
  const [endedAgentIds, setEndedAgentIds] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    setChosen(NO_CHOICES);
    setEndedAgentIds(new Set());
  }, [resetKey]);

  // Forget choices for agents that are no longer recipients (an @mention removed).
  useEffect(() => {
    const visible = new Set(agents.map((agent) => agent.id));
    setChosen((prev) => {
      const next = Object.fromEntries(Object.entries(prev).filter(([id]) => visible.has(id)));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [agents]);

  const recipients = useMemo<RecipientEntry[]>(() => {
    const entries = agents.map((agent) => {
      const state = agentRunState(tasks, agent.id);
      const opts = {
        canSteer: allowSteer && !hasAttachments,
        canRestart: allowSteer,
        steerByDefault: state.kind === "running" && steerByDefault(state.task),
      };
      return {
        agent,
        state,
        opts,
        action: resolveRecipientAction(state, chosen[agent.id], opts),
        actions: recipientActions(state, opts),
      };
    });
    // One message steers one turn for now: every other recipient that would
    // steer takes its next action instead, and can still take the steer over.
    const target = steerTarget(entries.map((entry) => ({
      agentId: entry.agent.id, action: entry.action, chosen: chosen[entry.agent.id],
    })));
    return entries.map(({ opts, ...entry }) => (entry.action !== "steer" || entry.agent.id === target
      ? entry
      : { ...entry, action: resolveRecipientAction(entry.state, undefined, { ...opts, steerByDefault: false }) }));
  }, [agents, tasks, chosen, allowSteer, hasAttachments, steerByDefault]);

  // A recipient that would have taken the message in its running turn, and
  // whose run ended before it was sent, now starts a new run. Say so once,
  // next to the preserved draft, instead of silently changing what Send does.
  const steeringRef = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const steering = new Set(recipients.filter((r) => r.action === "steer").map((r) => r.agent.id));
    const ended = recipients
      .filter((r) => steeringRef.current.has(r.agent.id) && !steering.has(r.agent.id) && r.state.kind !== "running")
      .map((r) => r.agent.id);
    steeringRef.current = steering;
    if (ended.length > 0 && hasDraft) {
      setEndedAgentIds((prev) => new Set([...prev, ...ended]));
    }
  }, [recipients, hasDraft]);
  useEffect(() => {
    if (!hasDraft) setEndedAgentIds((prev) => (prev.size === 0 ? prev : new Set()));
  }, [hasDraft]);

  const notices = useMemo<RecipientNotices>(() => ({
    endedAgentNames: recipients
      .filter((r) => endedAgentIds.has(r.agent.id) && r.state.kind !== "running")
      .map((r) => r.agent.name),
    attachmentsBlockSteer: allowSteer && hasAttachments && recipients.some((r) =>
      r.state.kind === "running" && r.state.steerable
      && (chosen[r.agent.id] === "steer" || (!chosen[r.agent.id] && steerByDefault(r.state.task)))),
  }), [recipients, endedAgentIds, allowSteer, hasAttachments, chosen, steerByDefault]);

  const setAction = useCallback((agentId: string, action: RecipientAction) => {
    setChosen((prev) => {
      if (prev[agentId] === action) return prev;
      const next = { ...prev, [agentId]: action };
      // Steering this recipient takes the one steer from any other.
      if (action === "steer") {
        for (const id of Object.keys(next)) if (id !== agentId && next[id] === "steer") delete next[id];
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setChosen(NO_CHOICES);
    setEndedAgentIds(new Set());
  }, []);

  const routing = useMemo<RecipientRouting>(() => recipientRouting(recipients.map((r) => ({
    agentId: r.agent.id, action: r.action, state: r.state,
  }))), [recipients]);

  return { recipients, notices, routing, setAction, reset };
}
