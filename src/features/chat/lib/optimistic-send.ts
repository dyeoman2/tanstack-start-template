import { api } from '@convex/_generated/api';
import { optimisticallySendMessage } from '@convex-dev/agent/react';
import type { OptimisticLocalStore } from 'convex/browser';
import type { ChatMessagePart } from '~/features/chat/types';

type SendMessageArgs = {
  threadId: string;
  text: string;
  parts: ChatMessagePart[];
  clientMessageId?: string;
};

export function optimisticallySendChatMessage(
  store: OptimisticLocalStore,
  args: SendMessageArgs,
) {
  optimisticallySendMessage(api.agentChat.listThreadMessages)(store, {
    threadId: args.threadId,
    prompt: args.text,
  });

  for (const queryResult of store.getAllQueries(api.agentChat.listThreadMessages)) {
    if (queryResult.args?.threadId !== args.threadId || queryResult.args?.streamArgs) {
      continue;
    }

    const value = queryResult.value;
    if (!value?.page?.length) {
      continue;
    }

    const maxOrder = Math.max(...value.page.map((message: (typeof value.page)[number]) => message.order));
    let pendingUserOrder: number | null = null;
    const nextPage = value.page.map((message: (typeof value.page)[number]) => {
      if (
        message.order !== maxOrder ||
        message.role !== 'user' ||
        message.status !== 'pending'
      ) {
        return message;
      }

      pendingUserOrder = message.order;
      return {
        ...message,
        parts: args.parts as (typeof value.page)[number]['parts'],
        text: args.text,
        metadata: {
          ...(typeof message.metadata === 'object' && message.metadata ? message.metadata : {}),
          ...(args.clientMessageId ? { clientMessageId: args.clientMessageId } : {}),
        },
      } as (typeof value.page)[number];
    });

    const hasTrailingAssistantPlaceholder = nextPage.some(
      (message: (typeof nextPage)[number]) =>
        message.role === 'assistant' &&
        (pendingUserOrder === null || message.order > pendingUserOrder) &&
        (message.status === 'pending' || message.status === 'streaming'),
    );

    const finalPage =
      pendingUserOrder !== null && !hasTrailingAssistantPlaceholder
        ? ([
            ...nextPage,
            {
              id: `optimistic-assistant-${args.clientMessageId ?? pendingUserOrder}`,
              _creationTime: Date.now(),
              order: pendingUserOrder + 1,
              stepOrder: 0,
              role: 'assistant',
              status: 'pending',
              parts: [{ type: 'text', text: '' }],
              text: '',
              metadata: args.clientMessageId ? { clientMessageId: args.clientMessageId } : {},
            },
          ] as typeof value.page)
        : (nextPage as typeof value.page);

    store.setQuery(api.agentChat.listThreadMessages, queryResult.args, {
      ...value,
      page: finalPage,
    });
  }
}
