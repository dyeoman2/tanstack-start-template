'use node';

import { definePlaygroundAPI } from '@convex-dev/agent';
import { components } from './_generated/api';
import { getBaseChatAgent, isChatAgentConfigured } from './lib/chatAgentRuntime';

export const playground = definePlaygroundAPI(components.agent, {
  agents: isChatAgentConfigured() ? [getBaseChatAgent()] : [],
});
