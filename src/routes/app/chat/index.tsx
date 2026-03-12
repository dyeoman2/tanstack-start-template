import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { useEffect } from 'react';
import { api } from '@convex/_generated/api';
import { z } from 'zod';
import { ChatWorkspace, ChatWorkspaceSkeleton } from '~/features/chat/components/ChatWorkspace';
import { sortThreads } from '~/features/chat/lib/utils';

export const Route = createFileRoute('/app/chat/')({
  validateSearch: z.object({
    new: z.boolean().optional(),
  }),
  component: ChatIndexRoute,
});

function ChatIndexRoute() {
  const navigate = useNavigate();
  const { new: isNewThread } = Route.useSearch();
  const threads = useQuery(api.chat.listThreads, {});

  useEffect(() => {
    if (isNewThread) {
      return;
    }

    if (!threads?.length) {
      return;
    }

    const nextThread = sortThreads(threads)[0];
    if (!nextThread) {
      return;
    }

    void navigate({
      to: '/app/chat/$threadId',
      params: { threadId: nextThread._id },
      replace: true,
    });
  }, [isNewThread, navigate, threads]);

  if (threads === undefined) {
    return <ChatWorkspaceSkeleton />;
  }

  if (threads.length > 0 && !isNewThread) {
    return null;
  }

  return <ChatWorkspace />;
}
