'use node';

import { definePlaygroundAPI } from '@convex-dev/agent';
import { components } from './_generated/api';
import { baseChatAgent } from './lib/chatAgentRuntime';

export const playground = definePlaygroundAPI(components.agent, {
  agents: [baseChatAgent],
});
