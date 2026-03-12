import type { Id } from '@convex/_generated/dataModel';

export function toThreadId(value: string): Id<'aiThreads'> {
  return value as Id<'aiThreads'>;
}

export function toPersonaId(value: string): Id<'aiPersonas'> {
  return value as Id<'aiPersonas'>;
}
