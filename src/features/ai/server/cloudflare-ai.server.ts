import { createServerFn } from '@tanstack/react-start';
import { generateObject, generateText, type LanguageModel, streamText } from 'ai';
import { createWorkersAI } from 'workers-ai-provider';
import { z } from 'zod';
import { requireAuth } from '~/features/auth/server/auth-guards';

// Simple token estimation function (rough approximation)
function estimateTokens(text: string): number {
  // Rough approximation: ~4 characters per token for English text
  return Math.ceil(text.length / 4);
}

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

  // If usage data is not available or all zeros, estimate based on text
  const estimatedUsage =
    !result.usage || !result.usage.totalTokens || result.usage.totalTokens === 0
      ? {
          inputTokens: estimateTokens(prompt),
          outputTokens: estimateTokens(result.text),
          totalTokens: estimateTokens(prompt) + estimateTokens(result.text),
        }
      : result.usage;

  return {
    provider: 'cloudflare-workers-ai',
    model: model === 'llama' ? '@cf/meta/llama-3.1-8b-instruct' : '@cf/tiiuae/falcon-7b-instruct',
    response: result.text,
    usage: estimatedUsage,
    finishReason: result.finishReason || 'stop',
  };
}

// Streaming version for real-time text updates
async function* streamWithWorkersAIHelper(prompt: string, model: 'llama' | 'falcon' = 'llama') {
  const { llamaModel, falconModel } = getWorkersAIProvider();
  const selectedModel = model === 'llama' ? llamaModel : falconModel;

  const result = await streamText({
    model: selectedModel,
    prompt,
  });

  // Yield metadata first
  yield {
    type: 'metadata',
    provider: 'cloudflare-workers-ai',
    model: model === 'llama' ? '@cf/meta/llama-3.1-8b-instruct' : '@cf/tiiuae/falcon-7b-instruct',
  };

  let accumulatedText = '';

  // Yield text chunks as they come in
  for await (const delta of result.textStream) {
    accumulatedText += delta;
    yield {
      type: 'text',
      content: delta,
    };
  }

  // Yield final result with usage (estimated if not available)
  const usage = await result.usage;
  const finishReason = await result.finishReason;

  // If usage data is not available or all zeros, estimate based on text
  const estimatedUsage =
    !usage || !usage.totalTokens || usage.totalTokens === 0
      ? {
          inputTokens: estimateTokens(prompt),
          outputTokens: estimateTokens(accumulatedText),
          totalTokens: estimateTokens(prompt) + estimateTokens(accumulatedText),
        }
      : usage;

  yield {
    type: 'complete',
    usage: estimatedUsage,
    finishReason: finishReason || 'stop',
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

  // If usage data is not available or all zeros, estimate based on text
  const estimatedUsage =
    !result.usage || !result.usage.totalTokens || result.usage.totalTokens === 0
      ? {
          inputTokens: estimateTokens(prompt),
          outputTokens: estimateTokens(result.text),
          totalTokens: estimateTokens(prompt) + estimateTokens(result.text),
        }
      : result.usage;

  return {
    provider: 'cloudflare-gateway-workers-ai',
    model: model === 'llama' ? '@cf/meta/llama-3.1-8b-instruct' : '@cf/tiiuae/falcon-7b-instruct',
    response: result.text,
    usage: estimatedUsage,
    finishReason: result.finishReason || 'stop',
  };
}

// Streaming version for gateway
async function* streamWithGatewayHelper(prompt: string, model: 'llama' | 'falcon' = 'llama') {
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

  const result = await streamText({
    model: selectedModel,
    prompt,
  });

  // Yield metadata first
  yield {
    type: 'metadata',
    provider: 'cloudflare-gateway',
    model: model === 'llama' ? '@cf/meta/llama-3.1-8b-instruct' : '@cf/tiiuae/falcon-7b-instruct',
  };

  let accumulatedText = '';

  // Yield text chunks as they come in
  for await (const delta of result.textStream) {
    accumulatedText += delta;
    yield {
      type: 'text',
      content: delta,
    };
  }

  // Yield final result with usage (estimated if not available)
  const usage = await result.usage;
  const finishReason = await result.finishReason;
  console.log('Gateway usage data:', usage);
  console.log('Gateway finish reason:', finishReason);

  // If usage data is not available or all zeros, estimate based on text
  const estimatedUsage =
    !usage || !usage.totalTokens || usage.totalTokens === 0
      ? {
          inputTokens: estimateTokens(prompt),
          outputTokens: estimateTokens(accumulatedText),
          totalTokens: estimateTokens(prompt) + estimateTokens(accumulatedText),
        }
      : usage;

  yield {
    type: 'complete',
    usage: estimatedUsage,
    finishReason: finishReason || 'stop',
  };
}

// Direct inference via Workers AI REST API
export const generateWithWorkersAI = createServerFn({ method: 'POST' })
  .inputValidator(textGenerationSchema)
  .handler(async ({ data }) => {
    await requireAuth();
    return await generateWithWorkersAIHelper(data.prompt, data.model);
  });

// Streaming version for real-time text updates
export const streamWithWorkersAI = createServerFn({ method: 'POST' })
  .inputValidator(textGenerationSchema)
  .handler(async function* ({ data }) {
    await requireAuth();
    yield* streamWithWorkersAIHelper(data.prompt, data.model);
  });

// Inference via AI Gateway (with monitoring/logging)
export const generateWithGateway = createServerFn({ method: 'POST' })
  .inputValidator(textGenerationSchema)
  .handler(async ({ data }) => {
    await requireAuth();
    return await generateWithGatewayHelper(data.prompt, data.model);
  });

// Streaming version for gateway
export const streamWithGateway = createServerFn({ method: 'POST' })
  .inputValidator(textGenerationSchema)
  .handler(async function* ({ data }) {
    await requireAuth();
    yield* streamWithGatewayHelper(data.prompt, data.model);
  });

// Structured output example using Workers AI
// Structured output generation
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

    // If usage data is not available or all zeros, estimate based on text
    const estimatedUsage =
      !result.usage || !result.usage.totalTokens || result.usage.totalTokens === 0
        ? {
            inputTokens: estimateTokens(
              `Generate a structured explanation about "${data.topic}" in a ${data.style} style.`,
            ),
            outputTokens: estimateTokens(JSON.stringify(result.object)),
            totalTokens:
              estimateTokens(
                `Generate a structured explanation about "${data.topic}" in a ${data.style} style.`,
              ) + estimateTokens(JSON.stringify(result.object)),
          }
        : result.usage;

    return {
      provider: 'cloudflare-workers-ai-structured',
      model: '@cf/meta/llama-3.1-8b-instruct',
      structuredData: result.object,
      usage: estimatedUsage,
    };
  });

// Streaming version for structured output
export const streamStructuredResponse = createServerFn({ method: 'POST' })
  .inputValidator(structuredGenerationSchema)
  .handler(async function* ({ data }) {
    await requireAuth();

    const { llamaModel } = getWorkersAIProvider();
    const prompt = `Generate a structured explanation about "${data.topic}" in a ${data.style} style. Return ONLY valid JSON with this exact structure: {"title": "string", "summary": "string", "keyPoints": ["string1", "string2"], "category": "string", "difficulty": "beginner|intermediate|advanced"}`;

    const result = await streamText({
      model: llamaModel,
      prompt,
    });

    // Yield metadata first
    yield {
      type: 'metadata',
      provider: 'cloudflare-workers-ai-structured',
      model: '@cf/meta/llama-3.1-8b-instruct',
    };

    let accumulatedText = '';

    // Yield text chunks as they come in
    for await (const delta of result.textStream) {
      accumulatedText += delta;
      yield {
        type: 'text',
        content: delta,
      };
    }

    // Try to parse the accumulated text as JSON
    let structuredData = null;
    let parseError = null;

    try {
      // Clean up the text (remove markdown code blocks if present)
      let jsonText = accumulatedText.trim();
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      structuredData = JSON.parse(jsonText);
    } catch (error) {
      parseError = error instanceof Error ? error.message : 'Failed to parse JSON';
      // Try to extract JSON from the text if parsing failed
      const jsonMatch = accumulatedText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          structuredData = JSON.parse(jsonMatch[0]);
          parseError = null;
        } catch {
          // Keep the original error
        }
      }
    }

    // Yield final result with usage and parsed data
    const usage = await result.usage;
    const finishReason = await result.finishReason;

    // If usage data is not available or all zeros, estimate based on text
    const estimatedUsage =
      !usage || !usage.totalTokens || usage.totalTokens === 0
        ? {
            inputTokens: estimateTokens(prompt),
            outputTokens: estimateTokens(accumulatedText),
            totalTokens: estimateTokens(prompt) + estimateTokens(accumulatedText),
          }
        : usage;

    yield {
      type: 'complete',
      usage: estimatedUsage,
      finishReason: finishReason || 'stop',
      structuredData: structuredData,
      parseError: parseError,
      rawText: accumulatedText,
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
