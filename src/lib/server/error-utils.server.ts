import { APIError } from 'better-auth/api';

/**
 * Standard error handler for server functions
 * Provides consistent error logging and formatting
 */
export class ServerError extends Error {
  constructor(
    message: string,
    public code: number = 500,
    public originalError?: unknown,
  ) {
    super(message);
    this.name = 'ServerError';
  }
}

/**
 * Converts HTTP status codes (string or number) to numbers
 */
const normalizeStatusCode = (status: string | number | undefined): number => {
  if (typeof status === 'string') {
    const parsed = parseInt(status, 10);
    return Number.isNaN(parsed) ? 500 : parsed;
  }
  return status || 500;
};

/**
 * Build a sanitized representation of an error for structured logging.
 * Strips properties that could contain request bodies, headers, cookies,
 * or other user-submitted content that may include PHI.
 */
function sanitizeErrorForLogging(error: unknown): Record<string, unknown> {
  if (error instanceof APIError) {
    return { name: 'APIError', message: error.message, status: error.status };
  }

  if (error instanceof ServerError) {
    return { name: error.name, message: error.message, code: error.code };
  }

  if (error instanceof Error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    return {
      name: error.name,
      message: error.message,
      ...(statusCode !== undefined ? { statusCode } : {}),
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
    };
  }

  return { type: typeof error, message: String(error).slice(0, 200) };
}

/**
 * Standard error handler for server functions
 * Logs errors consistently and returns formatted error information
 */
export const handleServerError = (error: unknown, context?: string): ServerError => {
  const contextPrefix = context ? `[${context}] ` : '';

  console.error(`${contextPrefix}Server function error:`, sanitizeErrorForLogging(error));

  // Handle APIError from better-auth
  if (error instanceof APIError) {
    return new ServerError(
      error.message || 'Authentication error',
      normalizeStatusCode(error.status),
      error,
    );
  }

  // Handle ServerError (already formatted)
  if (error instanceof ServerError) {
    return error;
  }

  // Handle standard Error objects with status codes
  if (error instanceof Error) {
    // Check if error has statusCode property (from fetch responses)
    const statusCode = (error as { statusCode?: number }).statusCode;

    return new ServerError(
      error.message || 'An unexpected error occurred',
      statusCode || 500,
      error,
    );
  }

  // Handle unknown errors
  return new ServerError('An unexpected error occurred', 500, error);
};
