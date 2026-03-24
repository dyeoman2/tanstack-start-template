import { describe, expect, it } from 'vitest';
import { getDefaultChatModelCatalogEntry } from '../src/lib/shared/chat-models';
import { filterVisibleModels } from './chatModels';

describe('filterVisibleModels', () => {
  const publicModel = getDefaultChatModelCatalogEntry();
  const adminModel = {
    ...getDefaultChatModelCatalogEntry(),
    modelId: 'openai/gpt-5',
    label: 'GPT-5',
    access: 'admin' as const,
  };

  it('hides admin-only entries from non-admin callers', () => {
    expect(filterVisibleModels([publicModel, adminModel], false)).toEqual([publicModel]);
  });

  it('returns the full catalog for site admins', () => {
    expect(filterVisibleModels([publicModel, adminModel], true)).toEqual([publicModel, adminModel]);
  });
});
