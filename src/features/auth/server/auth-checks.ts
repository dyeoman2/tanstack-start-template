import { createServerFn } from '@tanstack/react-start';
import { getEnv } from '~/lib/server/env.server';
import { requireAdmin, requireAuth } from './auth-guards';

// Check if email service is configured (used by forgot password page)
export const checkEmailServiceConfiguredServerFn = createServerFn({
  method: 'GET',
}).handler(async () => {
  const env = getEnv();
  const isConfigured = !!env.RESEND_API_KEY;

  return {
    isConfigured,
    message: isConfigured
      ? null
      : 'Email service is not configured. Password reset functionality is unavailable.',
  };
});

// Lightweight admin check server function for route guards
export const checkAdminServerFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { user } = await requireAdmin();
  return {
    authenticated: true,
    isAdmin: true,
    user,
  };
});

// Get current user session data for client-side auth state
export const getCurrentUserServerFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const { user } = await requireAuth();
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      authenticated: true,
    };
  } catch (_error) {
    return {
      user: null,
      authenticated: false,
    };
  }
});
