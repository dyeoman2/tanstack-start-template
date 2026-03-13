'use node';

import { definePlaygroundAPI } from '@convex-dev/agent';
import { components } from './_generated/api';
import { createChatAgent } from './lib/chatAgentRuntime';

export const playground = definePlaygroundAPI(components.agent, {
  agents: [createChatAgent()],
});
