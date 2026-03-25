import { describe, expect, it } from 'vitest';
import { classifyConvexFunction, scanConvexFunctionsFromSource } from './code-health-audit';

describe('code health auth audit', () => {
  it('classifies approved builder wrappers as protected', () => {
    const [record] = scanConvexFunctionsFromSource(
      `
        export const listUsers = siteAdminQuery({
          args: {},
          returns: v.null(),
          handler: async (ctx) => null,
        });
      `,
      'convex/admin.ts',
    );

    expect(classifyConvexFunction(record)).toMatchObject({
      classification: 'builder-protected',
    });
  });

  it('classifies allowlisted public functions explicitly', () => {
    const [record] = scanConvexFunctionsFromSource(
      `
        export const getUserCount = query({
          args: {},
          returns: v.null(),
          handler: async () => null,
        });
      `,
      'convex/users.ts',
    );

    expect(classifyConvexFunction(record)).toMatchObject({
      classification: 'allowlisted-public',
    });
  });

  it('classifies approved auth helpers as protected', () => {
    const [record] = scanConvexFunctionsFromSource(
      `
        export const listThreads = query({
          args: {},
          returns: v.null(),
          handler: async (ctx) => {
            const viewer = await getCurrentChatContextOrNull(ctx);
            return viewer;
          },
        });
      `,
      'convex/agentChat.ts',
    );

    expect(classifyConvexFunction(record)).toMatchObject({
      classification: 'explicit-helper-protected',
    });
  });

  it('classifies setup auth helpers as protected', () => {
    const [record] = scanConvexFunctionsFromSource(
      `
        export const bootstrapCurrentUserContext = action({
          args: {},
          returns: v.null(),
          handler: async (ctx) => {
            const viewer = await getCurrentSetupAuthUserFromActionOrThrow(ctx);
            return viewer;
          },
        });
      `,
      'convex/users.ts',
    );

    expect(classifyConvexFunction(record)).toMatchObject({
      classification: 'explicit-helper-protected',
    });
  });

  it('classifies SCIM lifecycle bridge as allowlisted', () => {
    const [record] = scanConvexFunctionsFromSource(
      `
        export const handleScimOrganizationLifecycle = action({
          args: {},
          returns: v.null(),
          handler: async (ctx) => {
            return ctx;
          },
        });
      `,
      'convex/auth.ts',
    );

    expect(classifyConvexFunction(record)).toMatchObject({
      classification: 'allowlisted-public',
    });
  });

  it('fails unprotected public functions', () => {
    const [record] = scanConvexFunctionsFromSource(
      `
        export const unsafeQuery = query({
          args: {},
          returns: v.null(),
          handler: async (ctx) => {
            return await ctx.db.query('users').take(1);
          },
        });
      `,
      'convex/example.ts',
    );

    expect(classifyConvexFunction(record)).toMatchObject({
      classification: 'unprotected',
    });
  });
});
