import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import * as schema from '~/db/schema';
import { sendResetPasswordEmail } from '~/features/auth/server/emails/password-reset';
import { getDb } from '~/lib/server/db-config.server';

// Import the same base URL logic used by the client
const getAuthBaseURL = () => {
  // Server-side: use the same logic as the client
  if (process.env.NODE_ENV === 'production') {
    // Try platform-specific environment variables
    const platformUrls = [
      process.env.URL, // Netlify, Render, Railway
      process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null, // Vercel
      process.env.HEROKU_APP_NAME ? `https://${process.env.HEROKU_APP_NAME}.herokuapp.com` : null, // Heroku
      process.env.SITE_URL, // Generic site URL
      process.env.PUBLIC_URL, // Create React App / Next.js
      process.env.BASE_URL, // Generic base URL
    ];

    const platformUrl = platformUrls.find((url) => url && typeof url === 'string');
    if (platformUrl) {
      return platformUrl;
    }

    // No URL detected - production deployments need explicit URL configuration
    throw new Error(
      'Production deployment detected but no base URL found. Set URL, VERCEL_URL, SITE_URL, or other platform-specific URL environment variable.',
    );
  }

  // Development: default to HTTP for local development (same as client)
  return 'http://localhost:3000';
};

// Initialize Better Auth with unified database instance
const authInstance = betterAuth({
  database: drizzleAdapter(getDb(), {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.authAccount,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
    sendResetPassword: sendResetPasswordEmail,
  },
  baseURL: getAuthBaseURL(),
  secret: process.env.BETTER_AUTH_SECRET || 'fallback-secret',
  trustedOrigins: [
    // Use consistent URLs based on environment
    ...(process.env.NODE_ENV === 'production'
      ? [getAuthBaseURL()] // Production: use the detected platform URL
      : [
          'http://localhost:3000', // Development server
        ]),
    // Also include any explicitly set BETTER_AUTH_URL
    ...(process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL] : []),
  ],
  user: {
    // Include role field in user data that gets stored in session
    additionalFields: {
      role: {
        type: 'string',
        required: false,
        defaultValue: 'user', // Default to user, will be updated for first user
      },
    },
  },
});

// Export the auth instance directly - Better Auth handles complexity internally
export const auth = authInstance;
