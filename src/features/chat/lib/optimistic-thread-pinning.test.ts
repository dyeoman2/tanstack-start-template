import { describe, expect, it } from 'vitest';
import { applyOptimisticPinnedState } from '~/features/chat/lib/optimistic-thread-pinning';

describe('applyOptimisticPinnedState', () => {
  it('moves a newly pinned thread ahead of newer unpinned threads', () => {
    const result = applyOptimisticPinnedState(
      [
        { _id: 'older-pinned-candidate', pinned: false, updatedAt: 100 },
        { _id: 'newer-unpinned', pinned: false, updatedAt: 200 },
      ],
      { threadId: 'older-pinned-candidate', pinned: true },
      300,
    );

    expect(result.map((thread) => thread._id)).toEqual([
      'older-pinned-candidate',
      'newer-unpinned',
    ]);
    expect(result[0]).toMatchObject({ pinned: true, updatedAt: 300 });
  });

  it('keeps pinned threads sorted by the optimistic updated timestamp', () => {
    const result = applyOptimisticPinnedState(
      [
        { _id: 'existing-pinned', pinned: true, updatedAt: 200 },
        { _id: 'target', pinned: true, updatedAt: 100 },
      ],
      { threadId: 'target', pinned: true },
      300,
    );

    expect(result.map((thread) => thread._id)).toEqual(['target', 'existing-pinned']);
    expect(result[0]).toMatchObject({ pinned: true, updatedAt: 300 });
  });
});
