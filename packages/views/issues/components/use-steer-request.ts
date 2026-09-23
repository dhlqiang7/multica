"use client";

import { useCallback, useRef } from "react";
import type { CommentSteerRequest } from "@multica/core/issues/run-steering";

/**
 * One logical steering send per draft text. A retry of the same text after a
 * lost response reuses its request id, so the server returns the original
 * comment instead of delivering the message twice; edited text is a new send.
 */
export function useSteerRequest() {
  const current = useRef<{ content: string; id: string } | null>(null);
  const request = useCallback((content: string, taskIds: string[]): CommentSteerRequest | undefined => {
    if (taskIds.length === 0) return undefined;
    if (current.current?.content !== content) current.current = { content, id: crypto.randomUUID() };
    return { taskIds, clientRequestId: current.current.id };
  }, []);
  const settle = useCallback(() => {
    current.current = null;
  }, []);
  return { request, settle };
}
