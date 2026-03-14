import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Id } from '../_generated/dataModel';

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
  getChatEmbeddingModel: vi.fn(() => ({ model: 'mock-embedding-model' })),
  getChatLanguageModel: vi.fn(() => ({ model: 'mock-model' })),
  getOpenRouterProviderOptions: vi.fn(() => ({
    openrouter: {
      provider: {
        zdr: true,
      },
    },
  })),
  getOpenRouterProvider: vi.fn(() => ({
    chat: vi.fn(() => ({ model: 'mock-model' })),
  })),
}));

vi.mock('../../src/features/chat/lib/openrouter-web-search', () => ({
  getOpenRouterWebSearchPlugin: vi.fn(),
  getOpenRouterWebSearchProviderOptions: vi.fn(),
}));

let recordChatUsageEvent: typeof import('./chatAgentRuntime').recordChatUsageEvent;
let trackedGenerateText: typeof import('./chatAgentRuntime').trackedGenerateText;
let buildChatContextMessages: typeof import('./chatAgentRuntime').buildChatContextMessages;
let buildChatRequestConfig: typeof import('./chatAgentRuntime').buildChatRequestConfig;
let generateTextMock: ReturnType<typeof vi.fn>;
let createToolMock: ReturnType<typeof vi.fn>;
let stepCountIsMock: ReturnType<typeof vi.fn>;
let getChatLanguageModelMock: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  ({ buildChatContextMessages, buildChatRequestConfig, recordChatUsageEvent, trackedGenerateText } =
    await import('./chatAgentRuntime'));
  ({ generateText: generateTextMock } = (await import('ai')) as unknown as {
    generateText: ReturnType<typeof vi.fn>;
  });
  ({ createTool: createToolMock } = (await import('@convex-dev/agent')) as unknown as {
    createTool: ReturnType<typeof vi.fn>;
  });
  ({ stepCountIs: stepCountIsMock } = (await import('ai')) as unknown as {
    stepCountIs: ReturnType<typeof vi.fn>;
  });
  ({ getChatLanguageModel: getChatLanguageModelMock } = (await import(
    './agentChat'
  )) as unknown as {
    getChatLanguageModel: ReturnType<typeof vi.fn>;
  });
});

describe('recordChatUsageEvent', () => {
  it('records usage even when no active run can be resolved', async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: 'thread-123',
        organizationId: 'org-123',
        ownerUserId: 'user-123',
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
        actorUserId: 'user-123',
        threadOwnerUserId: 'user-123',
        operationKind: 'chat_turn',
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
        ownerUserId: 'user-123',
      })
      .mockResolvedValueOnce({
        _id: 'run-123',
        initiatedByUserId: 'user-456',
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
        actorUserId: 'user-456',
        threadOwnerUserId: 'user-123',
        operationKind: 'chat_turn',
        totalTokens: 100,
        inputTokens: 75,
        outputTokens: 25,
      }),
    );
  });
});

describe('trackedGenerateText', () => {
  it('records non-agent model calls with explicit actor and operation metadata', async () => {
    generateTextMock.mockResolvedValueOnce({
      text: 'Thread title',
      usage: {
        inputTokens: 20,
        outputTokens: 8,
        totalTokens: 28,
      },
      providerMetadata: {
        openrouter: {
          routedModel: 'openai/gpt-4o-mini',
        },
      },
    });

    const runMutation = vi.fn().mockResolvedValue('usage-event-456');

    const result = await trackedGenerateText(
      {
        runQuery: vi.fn(),
        runMutation,
      },
      {
        thread: {
          _id: 'thread-123' as Id<'chatThreads'>,
          agentThreadId: 'agent-thread-123',
          organizationId: 'org-123',
          ownerUserId: 'owner-123',
        },
        actorUserId: 'actor-456',
        runId: 'run-789' as Id<'chatRuns'>,
        operationKind: 'thread_title',
        model: { model: 'mock-model' } as unknown as ReturnType<
          ReturnType<typeof import('./agentChat').getOpenRouterProvider>['chat']
        >,
        modelId: 'openai/gpt-4o-mini',
        provider: 'openrouter',
        prompt: 'Write a short title.',
      },
    );

    expect(result.text).toBe('Thread title');
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        threadId: 'thread-123',
        runId: 'run-789',
        actorUserId: 'actor-456',
        threadOwnerUserId: 'owner-123',
        operationKind: 'thread_title',
        totalTokens: 28,
        inputTokens: 20,
        outputTokens: 8,
      }),
    );
  });
});

describe('buildChatRequestConfig', () => {
  it('returns a single-step config without tools when web search is unsupported', () => {
    stepCountIsMock.mockReturnValueOnce('one-step');

    const config = buildChatRequestConfig({
      model: {
        modelId: 'openai/gpt-4o-mini',
        supportsWebSearch: false,
      },
      instructions: 'Be concise.',
      useWebSearch: true,
      thread: {
        _id: 'thread-123' as Id<'chatThreads'>,
        agentThreadId: 'agent-thread-123',
        organizationId: 'org-123',
        ownerUserId: 'owner-123',
      },
      actorUserId: 'actor-123',
    });

    expect(getChatLanguageModelMock).toHaveBeenCalledWith('openai/gpt-4o-mini', false);
    expect(config).toMatchObject({
      model: { model: 'mock-model' },
      system: 'Be concise.',
      stopWhen: 'one-step',
    });
    expect('providerOptions' in config).toBe(false);
    expect('tools' in config && config.tools).toBeFalsy();
  });

  it('returns a multi-step config with the web search tool when supported', () => {
    createToolMock.mockReturnValueOnce('mock-tool');
    stepCountIsMock.mockReturnValueOnce('four-step');

    const config = buildChatRequestConfig({
      model: {
        modelId: 'openai/gpt-4o-search-preview',
        supportsWebSearch: true,
      },
      instructions: 'Answer with citations.',
      useWebSearch: true,
      thread: {
        _id: 'thread-123' as Id<'chatThreads'>,
        agentThreadId: 'agent-thread-123',
        organizationId: 'org-123',
        ownerUserId: 'owner-123',
      },
      actorUserId: 'actor-123',
    });

    expect(config).toMatchObject({
      model: { model: 'mock-model' },
      system:
        'Answer with citations.\n\nWhen current or recent web information is needed, use the web_search tool.',
      stopWhen: 'four-step',
      tools: {
        web_search: 'mock-tool',
      },
    });
    expect('providerOptions' in config).toBe(false);
  });
});

describe('buildChatContextMessages', () => {
  it('prepends the summary and preserves the default Convex context order', () => {
    expect(
      buildChatContextMessages({
        summary: 'User is planning a launch.',
        context: {
          search: [{ role: 'user', content: 'search result' }],
          recent: [{ role: 'assistant', content: 'recent reply' }],
          inputMessages: [{ role: 'user', content: 'draft context' }],
          inputPrompt: [{ role: 'user', content: 'current prompt' }],
          existingResponses: [{ role: 'assistant', content: 'prior tool result' }],
        },
      }),
    ).toEqual([
      { role: 'system', content: 'Conversation summary:\nUser is planning a launch.' },
      { role: 'user', content: 'search result' },
      { role: 'assistant', content: 'recent reply' },
      { role: 'user', content: 'draft context' },
      { role: 'user', content: 'current prompt' },
      { role: 'assistant', content: 'prior tool result' },
    ]);
  });
});
