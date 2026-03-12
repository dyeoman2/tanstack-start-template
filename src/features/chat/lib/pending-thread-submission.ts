import { useSyncExternalStore } from 'react';
import type { ChatMessagePart } from '~/features/chat/types';

export type PendingThreadSubmission = {
  clientMessageId: string;
  parts: ChatMessagePart[];
  submittedAt: number;
  stage: 'submitting' | 'streaming' | 'error';
  errorMessage?: string;
};

type PendingThreadSubmissionStore = Record<string, PendingThreadSubmission | undefined>;

let store: PendingThreadSubmissionStore = {};
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function setPendingThreadSubmission(threadId: string, submission: PendingThreadSubmission) {
  store = {
    ...store,
    [threadId]: submission,
  };
  emitChange();
}

export function updatePendingThreadSubmission(
  threadId: string,
  updater: (submission: PendingThreadSubmission | undefined) => PendingThreadSubmission | undefined,
) {
  const nextSubmission = updater(store[threadId]);
  if (nextSubmission === store[threadId]) {
    return;
  }

  if (!nextSubmission) {
    const { [threadId]: _removed, ...rest } = store;
    store = rest;
  } else {
    store = {
      ...store,
      [threadId]: nextSubmission,
    };
  }

  emitChange();
}

export function clearPendingThreadSubmission(threadId: string) {
  if (!(threadId in store)) {
    return;
  }

  const { [threadId]: _removed, ...rest } = store;
  store = rest;
  emitChange();
}

export function usePendingThreadSubmission(threadId?: string) {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => (threadId ? store[threadId] : undefined),
    () => undefined,
  );
}
