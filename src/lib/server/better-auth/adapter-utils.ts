import type { User } from 'better-auth';
import type { PaginationResult } from 'convex/server';

type GenericConvexDocument = {
  _id: string;
  _creationTime: number;
  [key: string]: unknown;
};

export type BetterAuthAdapterUserDoc = GenericConvexDocument &
  Partial<User> & {
    email: string;
    name: string | null;
    emailVerified: boolean;
    phoneNumber?: string | null;
    createdAt?: Date | string | number;
    updatedAt?: Date | string | number;
  };

export type AdapterResultVariant<T extends GenericConvexDocument> =
  | PaginationResult<T>
  | {
      page?: T[];
      data?: T[];
      results?: T[];
      items?: T[];
      continueCursor?: string | null;
      isDone?: boolean;
    }
  | T[];

export type NormalizedAdapterResult<T extends GenericConvexDocument> = {
  page: T[];
  continueCursor: string | null;
  isDone: boolean;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeAdapterFindManyResult<T extends GenericConvexDocument>(
  result: AdapterResultVariant<T> | unknown,
): NormalizedAdapterResult<T> {
  if (Array.isArray(result)) {
    return {
      page: result,
      continueCursor: null,
      isDone: true,
    };
  }

  if (!isObject(result)) {
    return {
      page: [],
      continueCursor: null,
      isDone: true,
    };
  }

  const adapterResult = result as Record<string, unknown>;

  const readArray = (value: unknown): T[] | undefined => {
    return Array.isArray(value) ? (value as T[]) : undefined;
  };

  const page =
    readArray(adapterResult.page) ??
    readArray(adapterResult.data) ??
    readArray(adapterResult.results) ??
    readArray(adapterResult.items) ??
    [];

  const rawCursor = adapterResult.continueCursor;
  const continueCursor =
    typeof rawCursor === 'string' && rawCursor.length > 0 ? (rawCursor as string) : null;

  const rawIsDone = adapterResult.isDone;
  const isDone =
    typeof rawIsDone === 'boolean'
      ? (rawIsDone as boolean)
      : continueCursor === null || continueCursor === '[]';

  return {
    page,
    continueCursor,
    isDone,
  };
}
