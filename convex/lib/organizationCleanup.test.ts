import { describe, expect, it, vi } from 'vitest';
import { listStandaloneAttachmentsForOrganization } from './organizationCleanup';

describe('listStandaloneAttachmentsForOrganization', () => {
  it('queries only standalone attachments for the organization', async () => {
    const eqMock = vi.fn().mockReturnThis();
    const takeMock = vi.fn().mockResolvedValue([]);
    const orderMock = vi.fn().mockReturnValue({ take: takeMock });
    const withIndexMock = vi.fn(
      (_indexName: string, buildIndexRange: (q: { eq: typeof eqMock }) => unknown) => {
        buildIndexRange({ eq: eqMock });
        return { order: orderMock };
      },
    );
    const queryMock = vi.fn().mockReturnValue({ withIndex: withIndexMock });

    await listStandaloneAttachmentsForOrganization(
      {
        db: {
          query: queryMock,
        },
      } as never,
      {
        organizationId: 'org_1',
        limit: 50,
      },
    );

    expect(queryMock).toHaveBeenCalledWith('chatAttachments');
    expect(withIndexMock).toHaveBeenCalledWith(
      'by_organizationId_and_threadId_and_createdAt',
      expect.any(Function),
    );
    expect(eqMock).toHaveBeenNthCalledWith(1, 'organizationId', 'org_1');
    expect(eqMock).toHaveBeenNthCalledWith(2, 'threadId', undefined);
    expect(orderMock).toHaveBeenCalledWith('asc');
    expect(takeMock).toHaveBeenCalledWith(50);
  });
});
