import { describe, expect, it, vi } from 'vitest';
import {
  buildChatRateLimitKey,
  buildChatUsageAggregatePatch,
  chargeActualChatTokens,
  enforceChatAttachmentProcessingRateLimitOrThrow,
  enforceChatAttachmentUploadsRateLimitOrThrow,
  enforceChatPreflightOrThrow,
  estimateChatInputTokens,
  getAdvisoryChatRateLimit,
  normalizeChatUsage,
} from './chatRateLimits';

describe('chatRateLimits', () => {
  it('uses the organization/user pair as the per-user limiter key', () => {
    expect(
      buildChatRateLimitKey({
        organizationId: 'org_123',
        userId: 'user_456',
      }),
    ).toBe('org_123:user_456');
  });

  it('rejects the preflight when the per-user request limit is exceeded', async () => {
    const ctx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, retryAfter: undefined })
        .mockResolvedValueOnce({ ok: true, retryAfter: undefined }),
      runMutation: vi.fn().mockResolvedValueOnce({ ok: false, retryAfter: 5_000 }),
    };

    let caught: unknown;
    try {
      await enforceChatPreflightOrThrow(ctx, {
        organizationId: 'org_123',
        userId: 'user_456',
        textLength: 120,
      });
    } catch (error) {
      caught = error;
    }

    expect(String(caught)).toContain('Rate limit exceeded. Try again in 5 seconds.');
    expect(ctx.runQuery).toHaveBeenCalledTimes(2);
    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
  });

  it('checks the global request limiter with a shared key across users', async () => {
    const ctx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, retryAfter: undefined })
        .mockResolvedValueOnce({ ok: true, retryAfter: undefined }),
      runMutation: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, retryAfter: undefined })
        .mockResolvedValueOnce({ ok: false, retryAfter: 30_000 }),
    };

    await expect(
      enforceChatPreflightOrThrow(ctx, {
        organizationId: 'org_a',
        userId: 'user_a',
        textLength: 40,
      }),
    ).rejects.toThrow('AI capacity is temporarily full. Try again in 30 seconds.');
    expect(ctx.runMutation).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        name: 'chatGlobalRequests',
        key: 'chat-provider-global',
      }),
    );
  });

  it('rejects oversized prompts via query-only estimated token checks without mutating token state', async () => {
    const ctx = {
      runMutation: vi.fn(),
      runQuery: vi.fn().mockResolvedValueOnce({ ok: false, retryAfter: 12_000 }),
    };

    await expect(
      enforceChatPreflightOrThrow(ctx, {
        organizationId: 'org_123',
        userId: 'user_456',
        textLength: 250_000,
        hasAttachments: true,
      }),
    ).rejects.toThrow('Token budget exceeded. Try again in 12 seconds.');
    expect(ctx.runMutation).not.toHaveBeenCalled();
    expect(ctx.runQuery).toHaveBeenCalledTimes(1);
  });

  it('returns advisory request and estimated token checks for the composer', async () => {
    const ctx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, retryAfter: undefined })
        .mockResolvedValueOnce({ ok: true, retryAfter: undefined }),
    };

    const result = await getAdvisoryChatRateLimit(ctx, {
      organizationId: 'org_123',
      userId: 'user_456',
      textLength: 32,
      hasAttachments: true,
    });

    expect(result).toEqual({
      request: { ok: true, retryAfter: undefined },
      estimatedTokens: { ok: true, retryAfter: undefined },
      estimatedInputTokens: estimateChatInputTokens({ textLength: 32, hasAttachments: true }),
    });
  });

  it('charges actual usage against both token budgets using reservation debt', async () => {
    const ctx = {
      runQuery: vi.fn(),
      runMutation: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, retryAfter: 0 })
        .mockResolvedValueOnce({ ok: true, retryAfter: 0 }),
    };

    const usage = await chargeActualChatTokens(ctx, {
      organizationId: 'org_123',
      userId: 'user_456',
      inputTokens: 100,
      outputTokens: 50,
    });

    expect(usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });
    expect(ctx.runMutation).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        name: 'chatUserActualTokens',
        key: 'org_123:user_456',
        count: 150,
        reserve: true,
      }),
    );
    expect(ctx.runMutation).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        name: 'chatGlobalActualTokens',
        key: 'chat-provider-global',
        count: 150,
        reserve: true,
      }),
    );
  });

  it('rejects when the attachment upload URL rate limit is exceeded', async () => {
    const ctx = {
      runQuery: vi.fn(),
      runMutation: vi.fn().mockResolvedValueOnce({ ok: false, retryAfter: 7_000 }),
    };

    await expect(
      enforceChatAttachmentUploadsRateLimitOrThrow(ctx, {
        organizationId: 'org_123',
        userId: 'user_456',
      }),
    ).rejects.toThrow('Attachment rate limit exceeded. Try again in 7 seconds.');
    expect(ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: 'chatAttachmentUploads',
        key: 'org_123:user_456',
      }),
    );
  });

  it('rejects when the attachment processing rate limit is exceeded', async () => {
    const ctx = {
      runQuery: vi.fn(),
      runMutation: vi.fn().mockResolvedValueOnce({ ok: false, retryAfter: 9_000 }),
    };

    await expect(
      enforceChatAttachmentProcessingRateLimitOrThrow(ctx, {
        organizationId: 'org_123',
        userId: 'user_456',
      }),
    ).rejects.toThrow('Attachment rate limit exceeded. Try again in 9 seconds.');
    expect(ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: 'chatAttachmentProcessing',
        key: 'org_123:user_456',
      }),
    );
  });

  it('accumulates run usage totals across multiple callbacks', () => {
    const usage = normalizeChatUsage({
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 160,
    });

    expect(
      buildChatUsageAggregatePatch(
        {
          actualInputTokens: 80,
          actualOutputTokens: 20,
          actualTotalTokens: 110,
          usageEventCount: 1,
        },
        usage,
        1234,
      ),
    ).toEqual({
      actualInputTokens: 200,
      actualOutputTokens: 50,
      actualTotalTokens: 270,
      usageEventCount: 2,
      usageRecordedAt: 1234,
    });
  });
});
