import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { useEffect } from 'react';
import { api } from '@convex/_generated/api';
import { z } from 'zod';
import { ChatWorkspace, ChatWorkspaceSkeleton } from '~/features/chat/components/ChatWorkspace';

export const Route = createFileRoute('/app/chat/')({
  validateSearch: z.object({
    new: z.boolean().optional(),
  }),
  component: ChatIndexRoute,
});

function ChatIndexRoute() {
  const navigate = useNavigate();
  const { new: isNewThread } = Route.useSearch();
  const latestThreadId = useQuery(api.chat.getLatestThreadId, {});

  useEffect(() => {
    if (isNewThread) {
      return;
    }

    if (!latestThreadId) {
      return;
    }

    void navigate({
      to: '/app/chat/$threadId',
      params: { threadId: latestThreadId },
      replace: true,
    });
  }, [isNewThread, latestThreadId, navigate]);

  if (latestThreadId === undefined) {
    return <ChatWorkspaceSkeleton />;
  }

  if (latestThreadId && !isNewThread) {
    return null;
  }

  return <ChatWorkspace />;
}
