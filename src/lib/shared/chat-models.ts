export const CHAT_MODEL_OPTIONS = [
  {
    id: '@cf/nvidia/nemotron-3-120b-a12b',
    label: 'Nemotron 3 120B',
    description: 'Free Cloudflare text-generation model for chat and playground requests.',
  },
] as const;

export type ChatModelId = (typeof CHAT_MODEL_OPTIONS)[number]['id'];
export type ChatModelOption = (typeof CHAT_MODEL_OPTIONS)[number];

export const DEFAULT_CHAT_MODEL_ID: ChatModelId = CHAT_MODEL_OPTIONS[0].id;
export const DEFAULT_CHAT_MODEL: ChatModelOption = CHAT_MODEL_OPTIONS[0];

export function isChatModelId(value: string): value is ChatModelId {
  return CHAT_MODEL_OPTIONS.some((model) => model.id === value);
}

export function getChatModelOption(modelId?: string): ChatModelOption {
  if (!modelId) {
    return DEFAULT_CHAT_MODEL;
  }

  return CHAT_MODEL_OPTIONS.find((model) => model.id === modelId) ?? DEFAULT_CHAT_MODEL;
}
