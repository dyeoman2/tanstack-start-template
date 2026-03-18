import { beforeEach, describe, expect, it, vi } from 'vitest';

type RoutePostHandler = (input: { request: Request }) => Promise<Response>;

const { handlerMock, handleScimOrganizationLifecycleRequestMock } = vi.hoisted(() => ({
  handlerMock: vi.fn(),
  handleScimOrganizationLifecycleRequestMock: vi.fn(),
}));

vi.mock('~/features/auth/server/convex-better-auth-react-start', () => ({
  convexAuthReactStart: {
    handler: handlerMock,
  },
}));

vi.mock('~/features/auth/server/scim-route.server', () => ({
  handleScimOrganizationLifecycleRequest: handleScimOrganizationLifecycleRequestMock,
}));

describe('/api/auth/$ route', () => {
  function requirePostHandler(postHandler: RoutePostHandler | undefined): RoutePostHandler {
    if (!postHandler) {
      throw new Error('Expected POST handler to be defined');
    }

    return postHandler;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    handleScimOrganizationLifecycleRequestMock.mockResolvedValue(null);
  });

  it('passes through Better Auth responses for non-SCIM POST requests', async () => {
    handlerMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          message: 'Response from Better Auth',
        }),
        { status: 403 },
      ),
    );

    const { Route } = await import('./$');
    const serverHandlers = Route.options.server?.handlers as
      | Record<string, RoutePostHandler>
      | undefined;
    const postHandler = serverHandlers?.POST;
    const response = await requirePostHandler(postHandler)({
      request: new Request('http://127.0.0.1:3000/api/auth/change-email', {
        method: 'POST',
      }),
    });

    expect(handleScimOrganizationLifecycleRequestMock).toHaveBeenCalledOnce();
    expect(handlerMock).toHaveBeenCalledOnce();
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({
      message: 'Response from Better Auth',
    });
  });

  it('short-circuits POST requests when the SCIM lifecycle handler returns a response', async () => {
    handleScimOrganizationLifecycleRequestMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Handled by SCIM' }), { status: 202 }),
    );

    const { Route } = await import('./$');
    const serverHandlers = Route.options.server?.handlers as
      | Record<string, RoutePostHandler>
      | undefined;
    const postHandler = serverHandlers?.POST;
    const response = await requirePostHandler(postHandler)({
      request: new Request('http://127.0.0.1:3000/api/auth/scim/v2/Users/user-1', {
        method: 'POST',
      }),
    });

    expect(handleScimOrganizationLifecycleRequestMock).toHaveBeenCalledOnce();
    expect(handlerMock).not.toHaveBeenCalled();
    expect(response?.status).toBe(202);
    await expect(response?.json()).resolves.toEqual({
      message: 'Handled by SCIM',
    });
  });
});
