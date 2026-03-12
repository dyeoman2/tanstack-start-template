import type { ChatMessagePart, ChatThread } from '~/features/chat/types';
import { NEW_CHAT_TITLE } from '~/features/chat/lib/constants';

const WORD_SPLIT_REGEX = /\s+/;
const BR_TAG_REGEX = /<br\s*\/?>/gi;
const HTML_TAG_REGEX = /<[^>]*>/g;

export function sortThreads(threads: ChatThread[]) {
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

function truncateWords(text: string, maxWords: number) {
  return text.trim().split(WORD_SPLIT_REGEX).slice(0, maxWords).join(' ');
}

function stripHtmlTags(text: string) {
  return text.replace(BR_TAG_REGEX, ' ').replace(HTML_TAG_REGEX, '');
}

export function deriveThreadTitle(parts: ChatMessagePart[], fallback = NEW_CHAT_TITLE) {
  const candidate = stripHtmlTags(getTextFromParts(parts)).trim();
  if (!candidate) {
    return fallback;
  }

  return truncateWords(candidate, 4) || fallback;
}
