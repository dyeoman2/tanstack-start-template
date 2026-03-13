import type { ChatModelId } from '../../../lib/shared/chat-models';

export const OPENROUTER_WEB_SEARCH_PLUGIN = {
  id: 'web' as const,
};

export function isAnthropicChatModel(modelId: ChatModelId) {
  return modelId.startsWith('anthropic/');
}

export function shouldUseOpenRouterWebSearch(modelId: ChatModelId) {
  void modelId;
  return true;
}

export function getOpenRouterWebSearchPlugin(modelId: ChatModelId) {
  void modelId;
  return OPENROUTER_WEB_SEARCH_PLUGIN;
}

export function getOpenRouterWebSearchProviderOptions(modelId: ChatModelId) {
  void modelId;
  return undefined;
}

export type OpenRouterWebSearchSource =
  | {
      sourceType: 'url';
      id: string;
      url: string;
      title?: string;
    }
  | {
      sourceType: string;
      id: string;
    };

export type SourceUrlPart = {
  type: 'source-url';
  sourceId: string;
  url: string;
  title?: string;
};

function isSourceUrl(
  source: OpenRouterWebSearchSource,
): source is Extract<OpenRouterWebSearchSource, { sourceType: 'url' }> {
  return source.sourceType === 'url';
}

export function toSourceUrlParts(sources: OpenRouterWebSearchSource[]): SourceUrlPart[] {
  const seen = new Set<string>();
  const sourceParts: SourceUrlPart[] = [];

  for (const source of sources) {
    if (!isSourceUrl(source)) {
      continue;
    }

    const url = source.url.trim();
    if (!url || seen.has(url)) {
      continue;
    }

    seen.add(url);
    sourceParts.push({
      type: 'source-url',
      sourceId: source.id,
      url,
      ...(source.title ? { title: source.title } : {}),
    });
  }

  return sourceParts;
}
