import type { ChatPersona } from '~/features/chat/types';

export const DEFAULT_CHAT_PERSONA_ID = 'default';

export const DEFAULT_CHAT_PERSONA: Pick<ChatPersona, 'name' | 'prompt'> & { _id: undefined } = {
  _id: undefined,
  name: 'Default',
  prompt: 'You are an AI assistant that helps people find information.',
};

export const NEW_CHAT_TITLE = 'New Chat';

export const CHAT_ROUTE = '/app/chat';
