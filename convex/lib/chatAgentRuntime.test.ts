import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@convex-dev/agent', () => ({
  Agent: class {},
  createTool: vi.fn(),
  getThreadMetadata: vi.fn(),
}));

vi.mock('ai', () => ({
  generateText: vi.fn(),
  stepCountIs: vi.fn(),
}));

vi.mock('./agentChat', () => ({
  DEFAULT_CHAT_AGENT_NAME: 'chat-assistant',
  DEFAULT_PERSONA_PROMPT: 'You are helpful.',
  getChatLanguageModel: vi.fn(() => ({ model: 'mock-model' })),
  getOpenRouterProvider: vi.fn(() => ({
    chat: vi.fn(() => ({ model: 'mock-model' })),
  })),
}));

vi.mock('../../src/features/chat/lib/openrouter-web-search', () => ({
  getOpenRouterWebSearchPlugin: vi.fn(),
  getOpenRouterWebSearchProviderOptions: vi.fn(),
}));

let recordChatUsageEvent: typeof import('./chatAgentRuntime').recordChatUsageEvent;

beforeAll(async () => {
  ({ recordChatUsageEvent } = await import('./chatAgentRuntime'));
});

describe('recordChatUsageEvent', () => {
  it('records usage even when no active run can be resolved', async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: 'thread-123',
        organizationId: 'org-123',
        userId: 'user-123',
      })
      .mockResolvedValueOnce(null);
    const runMutation = vi.fn().mockResolvedValue('usage-event-123');

    await recordChatUsageEvent(
      {
        runQuery,
        runMutation,
      },
      {
        agentThreadId: 'agent-thread-123',
        agentName: 'chat-assistant',
        model: 'openai/gpt-4o-mini',
        provider: 'openrouter',
        inputTokens: 120,
        outputTokens: 40,
        totalTokens: 160,
      },
    );

    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        threadId: 'thread-123',
        runId: undefined,
        totalTokens: 160,
        inputTokens: 120,
        outputTokens: 40,
      }),
    );
  });

  it('associates usage with the latest active run when one exists', async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: 'thread-123',
        organizationId: 'org-123',
        userId: 'user-123',
      })
      .mockResolvedValueOnce({
        _id: 'run-123',
      });
    const runMutation = vi.fn().mockResolvedValue('usage-event-123');

    await recordChatUsageEvent(
      {
        runQuery,
        runMutation,
      },
      {
        agentThreadId: 'agent-thread-123',
        model: 'openai/gpt-4o-mini',
        provider: 'openrouter',
        inputTokens: 75,
        outputTokens: 25,
      },
    );

    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        threadId: 'thread-123',
        runId: 'run-123',
        totalTokens: 100,
        inputTokens: 75,
        outputTokens: 25,
      }),
    );
  });
});
