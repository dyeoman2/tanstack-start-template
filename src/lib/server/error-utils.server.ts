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
 * Standard error handler for server functions
 * Logs errors consistently and returns formatted error information
 */
export const handleServerError = (error: unknown, context?: string): ServerError => {
  const contextPrefix = context ? `[${context}] ` : '';

  console.error(`${contextPrefix}Server function error:`, error);

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

  // Handle standard Error objects
  if (error instanceof Error) {
    return new ServerError(error.message || 'An unexpected error occurred', 500, error);
  }

  // Handle unknown errors
  return new ServerError('An unexpected error occurred', 500, error);
};

/**
 * Utility for consistent error throwing in server functions
 */
export const throwServerError = (
  message: string,
  code: number = 500,
  originalError?: unknown,
): never => {
  throw new ServerError(message, code, originalError);
};
