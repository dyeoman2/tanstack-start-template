import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatModelCatalogEntry } from '~/lib/shared/chat-models';
import { createBufferedChunkWriter, resolveChatModelId } from '../../../../convex/chatActions';

const publicModel: ChatModelCatalogEntry = {
  modelId: 'openai/gpt-4o-mini',
  label: 'GPT-4o Mini',
  description: 'Fast default model',
  task: 'chat',
  access: 'public',
  source: 'openrouter',
  isActive: true,
  refreshedAt: 1,
};

const adminModel: ChatModelCatalogEntry = {
  modelId: 'openai/gpt-5',
  label: 'GPT-5',
  description: 'Admin model',
  task: 'chat',
  access: 'admin',
  source: 'openrouter',
  isActive: true,
  refreshedAt: 1,
};

afterEach(() => {
  vi.useRealTimers();
});

describe('resolveChatModelId', () => {
  it('prefers an explicitly requested authorized model', () => {
    expect(
      resolveChatModelId(
        'openai/gpt-4o-mini',
        undefined,
        [],
        [publicModel, adminModel],
        false,
      ),
    ).toBe('openai/gpt-4o-mini');
  });

  it('rejects explicit admin-only models for non-admin users', () => {
    expect(() =>
      resolveChatModelId('openai/gpt-5', undefined, [], [publicModel, adminModel], false),
    ).toThrowError(ConvexError);
  });

  it('falls back to the thread model before scanning assistant history', () => {
    expect(
      resolveChatModelId(
        undefined,
        'openai/gpt-4o-mini',
        [
          {
            _id: 'assistant-1',
            role: 'assistant',
            model: 'openai/gpt-5',
          },
        ] as never,
        [publicModel, adminModel],
        false,
      ),
    ).toBe('openai/gpt-4o-mini');
  });

  it('falls back to the latest authorized assistant model when the thread model is unavailable', () => {
    expect(
      resolveChatModelId(
        undefined,
        'missing-model',
        [
          {
            _id: 'assistant-1',
            role: 'assistant',
            model: 'openai/gpt-4o-mini',
          },
        ] as never,
        [publicModel],
        false,
      ),
    ).toBe('openai/gpt-4o-mini');
  });
});

describe('createBufferedChunkWriter', () => {
  it('batches multiple chunks into fewer flushes while preserving the final text', async () => {
    const writes: string[] = [];
    const writer = createBufferedChunkWriter({
      flush: async (content) => {
        writes.push(content);
      },
      flushCharThreshold: 6,
      flushIntervalMs: 1_000,
    });

    await writer.push('ab');
    await writer.push('cd');
    await writer.push('ef');
    await writer.push('gh');
    await writer.flushAndClose();

    expect(writes.length).toBeLessThan(4);
    expect(writes.join('')).toBe('abcdefgh');
  });

  it('flushes buffered text on the timer when the threshold is not reached', async () => {
    vi.useFakeTimers();

    const writes: string[] = [];
    const writer = createBufferedChunkWriter({
      flush: async (content) => {
        writes.push(content);
      },
      flushCharThreshold: 100,
      flushIntervalMs: 150,
    });

    await writer.push('hello');
    expect(writes).toEqual([]);

    await vi.advanceTimersByTimeAsync(150);

    expect(writes).toEqual(['hello']);
  });
});
