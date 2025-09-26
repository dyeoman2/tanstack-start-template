import { createAuthClient } from 'better-auth/react';

// Dynamic auth base URL that works in all environments
const getAuthBaseURL = () => {
  if (typeof window !== 'undefined') {
    // Client-side: always use current origin
    return window.location.origin;
  }

  // Server-side: fallback to platform detection since we don't have request context
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

  // Development: default to HTTP for local development
  return 'http://localhost:3000';
};

export const authClient = createAuthClient({
  baseURL: getAuthBaseURL(),
});

export const { signIn, signOut, useSession } = authClient;
