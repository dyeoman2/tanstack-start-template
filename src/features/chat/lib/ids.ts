import type { Id } from '@convex/_generated/dataModel';

export function toThreadId(value: string): Id<'chatThreads'> {
  return value as Id<'chatThreads'>;
}

export function toAttachmentId(value: string): Id<'chatAttachments'> {
  return value as Id<'chatAttachments'>;
}

export function toPersonaId(value: string): Id<'aiPersonas'> {
  return value as Id<'aiPersonas'>;
}

export function toRunId(value: string): Id<'chatRuns'> {
  return value as Id<'chatRuns'>;
}

export function toStorageId(value: string): Id<'_storage'> {
  return value as Id<'_storage'>;
}
