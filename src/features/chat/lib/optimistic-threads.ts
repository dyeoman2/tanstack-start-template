import { useSyncExternalStore } from 'react';
import type { ChatThread } from '~/features/chat/types';

export type OptimisticChatThread = {
  _id: ChatThread['_id'];
  createdAt: number;
  lastMessageAt: number;
  pinned: false;
  title: string;
  updatedAt: number;
};

type OptimisticThreadStore = Record<string, OptimisticChatThread | undefined>;

let store: OptimisticThreadStore = {};
const listeners = new Set<() => void>();
let cachedThreadsSnapshot: OptimisticChatThread[] = [];

function emitChange() {
  cachedThreadsSnapshot = Object.values(store).filter(
    (thread): thread is OptimisticChatThread => Boolean(thread),
  );

  for (const listener of listeners) {
    listener();
  }
}

export function setOptimisticThread(thread: OptimisticChatThread) {
  store = {
    ...store,
    [thread._id]: thread,
  };
  emitChange();
}

export function clearOptimisticThread(threadId: string) {
  if (!(threadId in store)) {
    return;
  }

  const { [threadId]: _removed, ...rest } = store;
  store = rest;
  emitChange();
}

export function useOptimisticThreads() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => cachedThreadsSnapshot,
    () => [],
  );
}

export function useOptimisticThreadTitle(threadId?: string) {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => (threadId ? store[threadId]?.title : undefined),
    () => undefined,
  );
}
