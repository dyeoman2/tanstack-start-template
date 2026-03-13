import { describe, expect, it } from 'vitest';
import { buildComposerParts } from '~/features/chat/lib/attachments';
import { deriveThreadTitle, resolveRequestedModelId, sortThreads } from '~/features/chat/lib/utils';

describe('chat utils', () => {
  it('sorts pinned threads before recency', () => {
    const sorted = sortThreads([
      {
        _id: 'thread-1' as never,
        agentThreadId: 'agent-thread-1',
        title: 'Recent',
        pinned: false,
        titleManuallyEdited: false,
        createdAt: 1,
        updatedAt: 20,
        lastMessageAt: 20,
      },
      {
        _id: 'thread-2' as never,
        agentThreadId: 'agent-thread-2',
        title: 'Pinned older',
        pinned: true,
        titleManuallyEdited: false,
        createdAt: 1,
        updatedAt: 10,
        lastMessageAt: 10,
      },
    ]);

    expect(sorted.map((thread) => thread.title)).toEqual(['Pinned older', 'Recent']);
  });

  it('derives a title from the full first user content', () => {
    expect(
      deriveThreadTitle([
        { type: 'text', text: 'Write me a launch plan for tomorrow morning' },
      ]),
    ).toBe('Write me a launch plan for tomorrow morning');
  });

  it('builds composer parts for text, images, and documents', () => {
    expect(
      buildComposerParts(
        'hello',
        [{ image: 'data:image/png;base64,abc', mimeType: 'image/png', name: 'image.png' }],
        [
          {
            name: 'notes.txt',
            mimeType: 'text/plain',
            content: 'hello world',
          },
        ],
      ),
    ).toEqual([
      { type: 'text', text: 'hello' },
      {
        type: 'image',
        image: 'data:image/png;base64,abc',
        mimeType: 'image/png',
        name: 'image.png',
      },
      {
        type: 'document',
        name: 'notes.txt',
        mimeType: 'text/plain',
        content: 'hello world',
      },
    ]);
  });

  it('keeps the pending submission model selected after navigating to a new thread', () => {
    expect(
      resolveRequestedModelId({
        threadId: 'thread-1',
        draftModelId: 'openai/gpt-4o-mini',
        pendingSubmissionModelId: 'anthropic/claude-3.5-sonnet',
      }),
    ).toBe('anthropic/claude-3.5-sonnet');
  });

  it('prefers the persisted thread model over the default before responses arrive', () => {
    expect(
      resolveRequestedModelId({
        threadId: 'thread-1',
        draftModelId: 'openai/gpt-4o-mini',
        threadModelId: 'anthropic/claude-3.5-sonnet',
      }),
    ).toBe('anthropic/claude-3.5-sonnet');
  });
});
