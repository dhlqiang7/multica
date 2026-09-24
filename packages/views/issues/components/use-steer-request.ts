"use client";

import { useCallback, useRef } from "react";
import type { CommentSteerRequest } from "@multica/core/issues/run-steering";

/**
 * One logical steering send per draft text. Until the send is settled, a
 * retry of the same text repeats its first steering request exactly — the
 * same request id and the same chosen turns, even if a turn has since ended —
 * so a first attempt that was saved but never acknowledged comes back as the
 * original comment instead of being posted again. Edited text is a new send.
 */
export function useSteerRequest() {
  const current = useRef<{ content: string; request: CommentSteerRequest } | null>(null);
  const request = useCallback((content: string, taskIds: string[]): CommentSteerRequest | undefined => {
    if (current.current?.content === content) return current.current.request;
    if (taskIds.length === 0) return undefined;
    current.current = { content, request: { taskIds, clientRequestId: crypto.randomUUID() } };
    return current.current.request;
  }, []);
  const settle = useCallback(() => {
    current.current = null;
  }, []);
  return { request, settle };
}
