import { APIError } from 'better-auth/api';
import { describe, expect, it, vi } from 'vitest';
import { ServerError, handleServerError } from '~/lib/server/error-utils.server';

describe('handleServerError', () => {
  it('wraps Better Auth API errors with normalized status codes', () => {
    const error = new APIError(401, { message: 'Auth failed' });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = handleServerError(error, 'Auth');

    expect(result).toBeInstanceOf(ServerError);
    expect(result.message).toBe('Auth failed');
    expect(result.code).toBe(401);
    expect(result.originalError).toBe(error);
    expect(consoleSpy).toHaveBeenCalledWith('[Auth] Server function error:', error);
  });

  it('passes through existing ServerError instances', () => {
    const error = new ServerError('Already formatted', 409);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(handleServerError(error)).toBe(error);
  });

  it('uses statusCode from standard errors when available', () => {
    const error = new Error('Conflict');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    Object.assign(error, { statusCode: 409 });

    const result = handleServerError(error);

    expect(result.message).toBe('Conflict');
    expect(result.code).toBe(409);
    expect(result.originalError).toBe(error);
    expect(consoleSpy).toHaveBeenCalledWith('Server function error:', error);
  });

  it('falls back to a generic server error for unknown values', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = handleServerError({ message: 'opaque' });

    expect(result.message).toBe('An unexpected error occurred');
    expect(result.code).toBe(500);
  });
});
