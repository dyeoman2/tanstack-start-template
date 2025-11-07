import { api } from '@convex/_generated/api';
import { createAuth } from '@convex/auth';
import { setupFetchClient } from '@convex-dev/better-auth/react-start';
import { createServerFn } from '@tanstack/react-start';
import { getCookie, getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';
import { handleServerError } from '~/lib/server/error-utils.server';
import { USER_ROLES } from '../types';

// Zod schemas for user management
const signUpWithFirstAdminSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required'),
});

// User management functions

// Custom signup server function that assigns admin role to first user
export const signUpWithFirstAdminServerFn = createServerFn({ method: 'POST' })
  .inputValidator(signUpWithFirstAdminSchema)
  .handler(async ({ data }) => {
    const { email, password, name } = data;
    const rateLimitToken = process.env.BETTER_AUTH_SECRET;
    if (!rateLimitToken) {
      throw new Error('BETTER_AUTH_SECRET environment variable is required');
    }

    try {
      // Get client IP for rate limiting (defense-in-depth)
      const request = getRequest();
      const clientIP =
        request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        request?.headers.get('x-real-ip') ||
        'unknown';

      // Initialize Convex fetch client for server-side calls
      const { fetchQuery, fetchMutation, fetchAction } = await setupFetchClient(
        createAuth,
        getCookie,
      );

      // Apply server-side rate limiting (defense-in-depth)
      // Skip rate limiting in development mode
      if (!import.meta.env.DEV) {
        const rateLimitResult = await fetchAction(api.auth.rateLimitAction, {
          token: rateLimitToken,
          name: 'signup',
          key: `signup:${clientIP}`,
          config: {
            kind: 'token bucket',
            rate: 5, // 5 attempts
            period: 60 * 60 * 1000, // per hour
            capacity: 5,
          },
        });

        if (!rateLimitResult.ok) {
          const retryMinutes = Math.ceil(rateLimitResult.retryAfter / (60 * 1000));
          throw new Error(
            `Rate limit exceeded. Too many signup attempts. Please try again in ${retryMinutes} minutes.`,
          );
        }
      }

      // Check if this would be the first user (using Convex)
      const userCountResult = await fetchQuery(api.users.getUserCount, {});
      const isFirstUser = userCountResult.isFirstUser;

      // Get Convex site URL for Better Auth HTTP calls
      const convexSiteUrl = import.meta.env.VITE_CONVEX_SITE_URL;
      if (!convexSiteUrl) {
        throw new Error('VITE_CONVEX_SITE_URL environment variable is required');
      }

      // Create user via Convex Better Auth HTTP handler
      const signUpResponse = await fetch(`${convexSiteUrl}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
          name,
          rememberMe: true,
        }),
      });

      if (!signUpResponse.ok) {
        let errorData: { message?: string; code?: string; details?: unknown } = {};
        try {
          const responseText = await signUpResponse.text();

          try {
            errorData = JSON.parse(responseText);
          } catch {
            errorData = {
              message: responseText || signUpResponse.statusText || 'Failed to create user',
            };
          }
        } catch {
          // If response isn't JSON, use status text
          errorData = { message: signUpResponse.statusText || 'Failed to create user' };
        }

        // Extract the actual error message from Better Auth response
        // Better Auth returns errors in format: { code: "...", message: "..." }
        // Check for specific error codes from Better Auth
        let errorMessage = errorData.message || 'Failed to create user';

        // Only map to "user exists" if Better Auth explicitly says so
        if (errorData.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
          errorMessage = 'User already exists. Please use a different email or sign in instead.';
        } else if (errorData.code === 'FAILED_TO_CREATE_USER' && signUpResponse.status === 422) {
          // FAILED_TO_CREATE_USER can have various causes - don't assume it's duplicate email
          // Better Auth might return this for schema validation errors, missing fields, etc.
          // Keep the original message or provide a generic one
          errorMessage =
            errorData.message ||
            'Failed to create account. Please check your information and try again.';
        }

        // Preserve the original error from Better Auth
        const error = new Error(errorMessage);
        // @ts-expect-error - Adding status code to error for better error handling
        error.statusCode = signUpResponse.status;
        // @ts-expect-error - Adding error code if available
        error.code = errorData.code;
        throw error;
      }

      const signUpResult = await signUpResponse.json();

      // Create user profile with role AFTER Better Auth user creation
      // Better Auth manages user auth data in betterAuth.user table
      // We store app-specific data (like role) in app.userProfiles table
      if (signUpResult?.user?.id) {
        const roleToSet = isFirstUser ? USER_ROLES.ADMIN : USER_ROLES.USER;

        // Small delay to ensure Better Auth user is committed to Convex database
        await new Promise((resolve) => setTimeout(resolve, 100));

        try {
          // Store role in userProfiles table (app-specific data)
          // Use allowBootstrap flag for first admin user creation
          await fetchMutation(api.users.setUserRole, {
            userId: signUpResult.user.id,
            role: roleToSet,
            allowBootstrap: isFirstUser, // Allow bootstrap for first admin
          });
        } catch (roleError) {
          // Log but don't fail signup if role update fails
          // Role can be set manually later if needed
          console.warn('[Signup] Failed to set user role after creation:', roleError);
          // Continue with signup success - role update is non-critical
        }
      }

      return {
        success: true,
        isFirstUser,
        message: isFirstUser
          ? 'Admin account created successfully!'
          : 'Account created successfully!',
        userCredentials: {
          email,
        },
      };
    } catch (error) {
      throw handleServerError(error, 'User signup');
    }
  });
