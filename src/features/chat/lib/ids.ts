import type { Id } from '@convex/_generated/dataModel';

export function toThreadId(value: string): Id<'aiThreads'> {
  return value as Id<'aiThreads'>;
}

export function toPersonaId(value: string): Id<'aiPersonas'> {
  return value as Id<'aiPersonas'>;
}

export function toStorageId(value: string): Id<'_storage'> {
  return value as Id<'_storage'>;
}
