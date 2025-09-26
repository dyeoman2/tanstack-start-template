import { randomBytes } from 'node:crypto';

/**
 * Generate a cryptographically secure secret of specified byte length
 * Returns base64url-encoded string suitable for environment variables
 */
export async function generateSecret(bytes: number = 32): Promise<string> {
  const key = randomBytes(bytes);
  return key.toString('base64url');
}
