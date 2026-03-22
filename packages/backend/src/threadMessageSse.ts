import type { Response } from "express";

const threadMessageStreams = new Map<string, Set<Response>>();

export function emitThreadMessage(threadId: string, payload: unknown): void {
  const listeners = threadMessageStreams.get(threadId);
  if (!listeners || listeners.size === 0) return;
  const event = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of listeners) {
    res.write(event);
  }
}

/** Register an SSE subscriber for new messages on a thread; returns unsubscribe. */
export function subscribeThreadMessageStream(threadId: string, res: Response): () => void {
  let listeners = threadMessageStreams.get(threadId);
  if (!listeners) {
    listeners = new Set();
    threadMessageStreams.set(threadId, listeners);
  }
  listeners.add(res);
  return () => {
    listeners!.delete(res);
    if (listeners!.size === 0) {
      threadMessageStreams.delete(threadId);
    }
  };
}
