/**
 * Environment variable utilities for server-side code.
 * Provides automatic inference of common environment variables.
 */

/**
 * Automatically infer the site URL based on deployment environment.
 * Supports Netlify production and local development only.
 */
export function getSiteUrl(): string {
  // Netlify production - provides URL environment variable
  const netlifyUrl = process.env.URL;
  if (netlifyUrl) {
    return netlifyUrl;
  }

  // Local development - default fallback
  return 'http://localhost:3000';
}

/**
 * Get the Better Auth secret, with validation.
 */
export function getBetterAuthSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      'BETTER_AUTH_SECRET environment variable is required. ' +
        'Generate one with: openssl rand -base64 32',
    );
  }

  // Basic validation - should be at least 32 bytes when base64 encoded
  if (secret.length < 32) {
    console.warn(
      'BETTER_AUTH_SECRET appears to be too short. Should be at least 32 bytes base64 encoded.',
    );
  }

  return secret;
}
