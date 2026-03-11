import { describe, expect, it } from 'vitest';
import { normalizeAdapterFindManyResult } from '~/lib/server/better-auth/adapter-utils';

type TestDoc = {
  _id: string;
  _creationTime: number;
  name: string;
};

const docs: TestDoc[] = [
  { _id: '1', _creationTime: 1, name: 'Ada' },
  { _id: '2', _creationTime: 2, name: 'Linus' },
];

describe('normalizeAdapterFindManyResult', () => {
  it('normalizes plain arrays', () => {
    expect(normalizeAdapterFindManyResult(docs)).toEqual({
      page: docs,
      continueCursor: null,
      isDone: true,
    });
  });

  it('reads the first available array-like property', () => {
    expect(
      normalizeAdapterFindManyResult({
        results: docs,
        continueCursor: 'cursor-1',
      }),
    ).toEqual({
      page: docs,
      continueCursor: 'cursor-1',
      isDone: false,
    });
  });

  it('treats empty or missing cursors as done', () => {
    expect(
      normalizeAdapterFindManyResult({
        items: docs,
        continueCursor: '',
      }),
    ).toEqual({
      page: docs,
      continueCursor: null,
      isDone: true,
    });
  });

  it('respects an explicit isDone boolean over cursor heuristics', () => {
    expect(
      normalizeAdapterFindManyResult({
        page: docs,
        continueCursor: 'cursor-2',
        isDone: true,
      }),
    ).toEqual({
      page: docs,
      continueCursor: 'cursor-2',
      isDone: true,
    });
  });

  it('returns an empty terminal page for invalid results', () => {
    expect(normalizeAdapterFindManyResult(null)).toEqual({
      page: [],
      continueCursor: null,
      isDone: true,
    });
  });
});
