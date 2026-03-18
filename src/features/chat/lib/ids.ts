import type { Id } from '@convex/_generated/dataModel';

export function toThreadId(value: string): Id<'chatThreads'> {
  return value as Id<'chatThreads'>;
}

export function toPersonaId(value: string): Id<'aiPersonas'> {
  return value as Id<'aiPersonas'>;
}

export function toRunId(value: string): Id<'chatRuns'> {
  return value as Id<'chatRuns'>;
}
