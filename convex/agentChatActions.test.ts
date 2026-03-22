import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@convex-dev/agent', () => ({
  getFile: vi.fn(),
  serializeMessage: vi.fn(),
  storeFile: vi.fn(),
}));

vi.mock('./lib/chatAgentRuntime', () => ({
  buildChatRequestConfig: vi.fn(),
  getBaseChatAgent: vi.fn(() => ({
    createThread: vi.fn(),
  })),
}));

let isValidContinuationPromptMessage: typeof import('./agentChatActions').isValidContinuationPromptMessage;

beforeAll(async () => {
  ({ isValidContinuationPromptMessage } = await import('./agentChatActions'));
});

describe('isValidContinuationPromptMessage', () => {
  it('accepts user prompts that belong to the expected thread', () => {
    expect(
      isValidContinuationPromptMessage(
        {
          _id: 'msg-1',
          threadId: 'thread-1',
          order: 1,
          stepOrder: 0,
          status: 'success',
          message: {
            role: 'user',
            content: 'Continue this response',
          },
        },
        'thread-1',
      ),
    ).toBe(true);
  });

  it('rejects prompts from a different thread', () => {
    expect(
      isValidContinuationPromptMessage(
        {
          _id: 'msg-1',
          threadId: 'thread-2',
          order: 1,
          stepOrder: 0,
          status: 'success',
          message: {
            role: 'user',
            content: 'Continue this response',
          },
        },
        'thread-1',
      ),
    ).toBe(false);
  });

  it('rejects non-user messages even if the thread matches', () => {
    expect(
      isValidContinuationPromptMessage(
        {
          _id: 'msg-1',
          threadId: 'thread-1',
          order: 1,
          stepOrder: 0,
          status: 'success',
          message: {
            role: 'assistant',
            content: 'Answer',
          },
        },
        'thread-1',
      ),
    ).toBe(false);
  });
});
