import { api } from '@convex/_generated/api';
import type { OptimisticLocalStore } from 'convex/browser';
import { sortThreads } from '~/features/chat/lib/utils';
import type { ChatThread } from '~/features/chat/types';

type ThreadPinningStore = Pick<OptimisticLocalStore, 'getQuery' | 'setQuery'>;

export type OptimisticSetThreadPinnedArgs<TThreadId extends string = string> = {
  threadId: TThreadId;
  pinned: boolean;
};

export function applyOptimisticPinnedState<
  T extends {
    _id: string;
    pinned: boolean;
    updatedAt: number;
  },
>(threads: T[], args: OptimisticSetThreadPinnedArgs<T['_id']>, updatedAt: number) {
  return sortThreads(
    threads.map((thread) =>
      thread._id === args.threadId ? { ...thread, pinned: args.pinned, updatedAt } : thread,
    ),
  );
}

export function optimisticallySetThreadPinned(
  store: ThreadPinningStore,
  args: OptimisticSetThreadPinnedArgs<ChatThread['_id']>,
) {
  const updatedAt = Date.now();
  const currentThreads = store.getQuery(api.agentChat.listThreads, {});

  if (currentThreads) {
    store.setQuery(
      api.agentChat.listThreads,
      {},
      applyOptimisticPinnedState(currentThreads, args, updatedAt),
    );
  }

  const currentThread = store.getQuery(api.agentChat.getThread, { threadId: args.threadId });
  if (!currentThread) {
    return;
  }

  store.setQuery(
    api.agentChat.getThread,
    { threadId: args.threadId },
    {
      ...currentThread,
      pinned: args.pinned,
      updatedAt,
    },
  );
}
