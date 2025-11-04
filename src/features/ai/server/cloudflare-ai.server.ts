import { createServerFn } from '@tanstack/react-start';
import { generateObject, generateText, type LanguageModel } from 'ai';
import { createWorkersAI } from 'workers-ai-provider';
import { z } from 'zod';
import { requireAuth } from '~/features/auth/server/auth-guards';

// Helper function to get and validate environment variables
function getCloudflareConfig() {
  const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
  const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;

  if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
    throw new Error(
      'Missing required Cloudflare AI environment variables: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID. Please set them in your .env file.',
    );
  }

  return {
    apiToken: CLOUDFLARE_API_TOKEN,
    accountId: CLOUDFLARE_ACCOUNT_ID,
    gatewayId: process.env.CLOUDFLARE_GATEWAY_ID,
  };
}

// Cached providers to avoid re-initialization
let workersaiProvider: ReturnType<typeof createWorkersAI> | null = null;
let llamaModel: LanguageModel | null = null;
let falconModel: LanguageModel | null = null;

function getWorkersAIProvider() {
  if (!workersaiProvider) {
    const config = getCloudflareConfig();

    workersaiProvider = createWorkersAI({
      accountId: config.accountId,
      apiKey: config.apiToken,
    });

    if (workersaiProvider) {
      llamaModel = workersaiProvider('@cf/meta/llama-3.1-8b-instruct');
      falconModel = workersaiProvider('@cf/tiiuae/falcon-7b-instruct');
    }
  }

  if (!llamaModel || !falconModel) {
    throw new Error('Failed to initialize AI models');
  }

  return { llamaModel, falconModel };
}

// Zod schemas for input validation
const textGenerationSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  model: z.enum(['llama', 'falcon']).default('llama'),
});

const structuredGenerationSchema = z.object({
  topic: z.string().min(1, 'Topic is required'),
  style: z.enum(['formal', 'casual', 'technical']).default('formal'),
});

// Helper functions for AI operations
async function generateWithWorkersAIHelper(prompt: string, model: 'llama' | 'falcon' = 'llama') {
  const { llamaModel, falconModel } = getWorkersAIProvider();
  const selectedModel = model === 'llama' ? llamaModel : falconModel;

  const result = await generateText({
    model: selectedModel,
    prompt,
  });

  return {
    provider: 'cloudflare-workers-ai',
    model: model === 'llama' ? '@cf/meta/llama-3.1-8b-instruct' : '@cf/tiiuae/falcon-7b-instruct',
    response: result.text,
    usage: result.usage,
    finishReason: result.finishReason,
  };
}

async function generateWithGatewayHelper(prompt: string, model: 'llama' | 'falcon' = 'llama') {
  const config = getCloudflareConfig();

  if (!config.gatewayId) {
    throw new Error(
      'CLOUDFLARE_GATEWAY_ID environment variable is required for gateway functionality. Please set it in your .env file.',
    );
  }

  // Create gateway-specific provider using workers-ai-provider
  const gatewayWorkersAI = createWorkersAI({
    accountId: config.accountId,
    apiKey: config.apiToken,
    gateway: {
      id: config.gatewayId,
      metadata: {
        userId: 'authenticated-user',
        requestType: 'demo',
        timestamp: new Date().toISOString(),
      },
    },
  });

  const selectedModel =
    model === 'llama'
      ? gatewayWorkersAI('@cf/meta/llama-3.1-8b-instruct')
      : gatewayWorkersAI('@cf/tiiuae/falcon-7b-instruct');

  const result = await generateText({
    model: selectedModel,
    prompt,
  });

  return {
    provider: 'cloudflare-gateway-workers-ai',
    model: model === 'llama' ? '@cf/meta/llama-3.1-8b-instruct' : '@cf/tiiuae/falcon-7b-instruct',
    response: result.text,
    usage: result.usage,
    finishReason: result.finishReason,
  };
}

// Direct inference via Workers AI REST API
export const generateWithWorkersAI = createServerFn({ method: 'POST' })
  .inputValidator(textGenerationSchema)
  .handler(async ({ data }) => {
    await requireAuth();
    return await generateWithWorkersAIHelper(data.prompt, data.model);
  });

// Inference via AI Gateway (with monitoring/logging)
export const generateWithGateway = createServerFn({ method: 'POST' })
  .inputValidator(textGenerationSchema)
  .handler(async ({ data }) => {
    await requireAuth();
    return await generateWithGatewayHelper(data.prompt, data.model);
  });

// Structured output example using Workers AI
export const generateStructuredResponse = createServerFn({ method: 'POST' })
  .inputValidator(structuredGenerationSchema)
  .handler(async ({ data }) => {
    await requireAuth();

    const { llamaModel } = getWorkersAIProvider();
    const result = await generateObject({
      model: llamaModel,
      schema: z.object({
        title: z.string(),
        summary: z.string(),
        keyPoints: z.array(z.string()),
        category: z.string(),
        difficulty: z.enum(['beginner', 'intermediate', 'advanced']),
      }),
      prompt: `Generate a structured explanation about "${data.topic}" in a ${data.style} style.`,
    });

    return {
      provider: 'cloudflare-workers-ai-structured',
      model: '@cf/meta/llama-3.1-8b-instruct',
      structuredData: result.object,
      usage: result.usage,
    };
  });

// Test gateway connectivity
export const testGatewayConnectivity = createServerFn({ method: 'POST' }).handler(async () => {
  await requireAuth();

  const config = getCloudflareConfig();

  if (!config.gatewayId) {
    return {
      success: false,
      error: 'CLOUDFLARE_GATEWAY_ID not configured',
      gatewayUrl: null,
    };
  }

  // Test if gateway provider can be initialized (basic connectivity test)
  try {
    const testWorkersAI = createWorkersAI({
      accountId: config.accountId,
      apiKey: config.apiToken,
      gateway: {
        id: config.gatewayId,
        metadata: {
          userId: 'test-user',
          requestType: 'connectivity-test',
          timestamp: new Date().toISOString(),
        },
      },
    });

    // Try to create a model and make a simple request
    const testModel = testWorkersAI('@cf/meta/llama-3.1-8b-instruct');

    // This will test the actual connectivity
    const result = await generateText({
      model: testModel,
      prompt: 'Hello',
    });

    return {
      success: true,
      status: 200,
      statusText: 'OK',
      gatewayUrl: `https://gateway.ai.cloudflare.com/v1/${config.accountId}/${config.gatewayId}`,
      response: result.text,
    };
  } catch (error) {
    console.error('❌ Gateway connectivity test failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      gatewayUrl: `https://gateway.ai.cloudflare.com/v1/${config.accountId}/${config.gatewayId}`,
    };
  }
});

// Comparison endpoint that runs both in parallel
export const compareInferenceMethods = createServerFn({ method: 'POST' })
  .inputValidator(textGenerationSchema)
  .handler(async ({ data }) => {
    await requireAuth();

    const [directResult, gatewayResult] = await Promise.allSettled([
      generateWithWorkersAIHelper(data.prompt, data.model),
      generateWithGatewayHelper(data.prompt, data.model),
    ]);

    return {
      direct:
        directResult.status === 'fulfilled' ? directResult.value : { error: directResult.reason },
      gateway:
        gatewayResult.status === 'fulfilled'
          ? gatewayResult.value
          : { error: gatewayResult.reason },
      comparison: {
        timestamp: new Date().toISOString(),
        promptLength: data.prompt.length,
        model: data.model,
      },
    };
  });
