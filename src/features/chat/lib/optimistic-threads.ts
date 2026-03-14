import { useSyncExternalStore } from 'react';
import type { ChatMessage, ChatThread } from '~/features/chat/types';

export type OptimisticChatThread = {
  _id: ChatThread['_id'];
  createdAt: number;
  lastMessageAt: number;
  pinned: false;
  title: string;
  updatedAt: number;
  canManage: true;
};

type OptimisticThreadStore = Record<string, OptimisticChatThread | undefined>;
type OptimisticThreadBootstrap = {
  messages: ChatMessage[];
};
type OptimisticBootstrapStore = Record<string, OptimisticThreadBootstrap | undefined>;

let store: OptimisticThreadStore = {};
let bootstrapStore: OptimisticBootstrapStore = {};
const listeners = new Set<() => void>();
let cachedThreadsSnapshot: OptimisticChatThread[] = [];

function emitChange() {
  cachedThreadsSnapshot = Object.values(store).filter((thread): thread is OptimisticChatThread =>
    Boolean(thread),
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

export function setOptimisticThreadBootstrap(
  threadId: string,
  bootstrap: OptimisticThreadBootstrap,
) {
  bootstrapStore = {
    ...bootstrapStore,
    [threadId]: bootstrap,
  };
  emitChange();
}

export function clearOptimisticThreadBootstrap(threadId: string) {
  if (!(threadId in bootstrapStore)) {
    return;
  }

  const { [threadId]: _removed, ...rest } = bootstrapStore;
  bootstrapStore = rest;
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

export function useOptimisticThreadBootstrap(threadId?: string) {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => (threadId ? bootstrapStore[threadId] : undefined),
    () => undefined,
  );
}
