import { describe, expect, it, vi } from 'vitest';
import { optimisticallySendChatMessage } from '~/features/chat/lib/optimistic-send';

const optimisticallySendMessageMock = vi.fn();

vi.mock('@convex-dev/agent/react', () => ({
  optimisticallySendMessage: () => optimisticallySendMessageMock,
}));

describe('optimisticallySendChatMessage', () => {
  it('adds an empty pending assistant placeholder after the optimistic user prompt', () => {
    const setQuery = vi.fn();
    const store = {
      getAllQueries: vi.fn(() => [
        {
          args: { threadId: 'thread-123' },
          value: {
            page: [
              {
                id: 'user-1',
                _creationTime: 1,
                order: 1,
                stepOrder: 0,
                role: 'user',
                status: 'pending',
                parts: [{ type: 'text', text: '' }],
                text: '',
                metadata: {},
              },
            ],
          },
        },
      ]),
      setQuery,
    };

    optimisticallySendChatMessage(store as never, {
      threadId: 'thread-123',
      text: 'Need help with this',
      parts: [{ type: 'text', text: 'Need help with this' }],
      clientMessageId: 'client-123',
    });

    expect(optimisticallySendMessageMock).toHaveBeenCalled();
    expect(setQuery).toHaveBeenCalledWith(
      expect.anything(),
      { threadId: 'thread-123' },
      expect.objectContaining({
        page: [
          expect.objectContaining({
            role: 'user',
            status: 'pending',
            parts: [{ type: 'text', text: 'Need help with this' }],
          }),
          expect.objectContaining({
            role: 'assistant',
            status: 'pending',
            parts: [{ type: 'text', text: '' }],
          }),
        ],
      }),
    );
  });
});
