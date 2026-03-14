import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';

export function useChatRateLimit(args: { textLength?: number; hasAttachments?: boolean }) {
  return useQuery(api.agentChat.getChatRateLimit, args);
}
