import type { ChatMessagePart } from '~/features/chat/types';
import { NEW_CHAT_TITLE } from '~/features/chat/lib/constants';
import { DEFAULT_CHAT_MODEL_ID, type ChatModelId } from '~/lib/shared/chat-models';

const BR_TAG_REGEX = /<br\s*\/?>/gi;
const HTML_TAG_REGEX = /<[^>]*>/g;

export function sortThreads<
  T extends {
    _id: string;
    pinned: boolean;
    updatedAt: number;
  },
>(threads: T[]) {
  return [...threads].sort((a, b) => {
    const pinnedDiff = Number(b.pinned) - Number(a.pinned);
    if (pinnedDiff !== 0) {
      return pinnedDiff;
    }

    return b.updatedAt - a.updatedAt;
  });
}

function getTextFromParts(parts: ChatMessagePart[]) {
  return parts
    .map((part) => {
      if (part.type === 'text') {
        return part.text;
      }

      if (part.type === 'document') {
        return part.name;
      }

      return '';
    })
    .filter(Boolean)
    .join(' ');
}

function stripHtmlTags(text: string) {
  return text.replace(BR_TAG_REGEX, ' ').replace(HTML_TAG_REGEX, '');
}

export function deriveThreadTitle(parts: ChatMessagePart[], fallback = NEW_CHAT_TITLE) {
  const candidate = stripHtmlTags(getTextFromParts(parts)).trim();
  if (!candidate) {
    return fallback;
  }

  return candidate || fallback;
}

export function resolveRequestedModelId({
  threadId,
  draftModelId,
  threadModelOverride,
  threadModelId,
  inferredThreadModelId,
}: {
  threadId?: string;
  draftModelId: ChatModelId;
  threadModelOverride?: ChatModelId;
  threadModelId?: ChatModelId;
  inferredThreadModelId?: ChatModelId;
}) {
  if (!threadId) {
    return draftModelId;
  }

  return (
    threadModelOverride ??
    threadModelId ??
    inferredThreadModelId ??
    DEFAULT_CHAT_MODEL_ID
  );
}
