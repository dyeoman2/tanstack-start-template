import { api } from '@convex/_generated/api';
import { createAuth } from '@convex/auth';
import { setupFetchClient } from '@convex-dev/better-auth/react-start';
import { createServerFn } from '@tanstack/react-start';
import { getCookie } from '@tanstack/react-start/server';
import { generateText, type LanguageModel, streamText } from 'ai';
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

interface AiUsageMetadata {
  provider?: string;
  model?: string;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}

function buildReservationError(reservation: {
  requiresUpgrade?: boolean;
  reason?: string;
  errorMessage?: string;
  freeLimit: number;
  usage: { freeMessagesRemaining: number };
}) {
  if (reservation.requiresUpgrade && reservation.reason !== 'autumn_not_configured') {
    return new Error(
      `You have used all ${reservation.freeLimit} free messages. Upgrade your plan to continue.`,
    );
  }

  if (reservation.reason === 'autumn_not_configured') {
    return new Error(
      'Autumn billing is not configured. Follow docs/AUTUMN_SETUP.md to enable paid AI access.',
    );
  }

  if (reservation.reason === 'autumn_check_failed') {
    const detail = reservation.errorMessage ? ` (${reservation.errorMessage})` : '';
    return new Error(`Unable to verify your AI subscription${detail}. Please try again shortly.`);
  }

  return new Error('Unable to reserve an message. Please try again in a moment.');
}

function extractUsageMetadata(
  usage: {
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
  } | null,
  provider?: string,
  model?: string,
): AiUsageMetadata {
  return {
    provider,
    model,
    totalTokens: usage?.totalTokens,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
  };
}

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

// Streaming version for real-time text updates
export const streamWithWorkersAI = createServerFn({ method: 'POST' })
  .inputValidator(textGenerationSchema)
  .handler(async function* ({ data }) {
    await requireAuth();
    const { fetchAction } = await setupFetchClient(createAuth, getCookie);

    const reservation = await fetchAction(api.ai.reserveAiMessage, {
      metadata: { provider: 'cloudflare-workers-ai', model: data.model },
    });

    if (!reservation.allowed) {
      throw buildReservationError(reservation);
    }

    let usageFinalized = false;
    const releaseReservation = async () => {
      if (usageFinalized) {
        return;
      }
      usageFinalized = true;
      try {
        await fetchAction(api.ai.releaseAiMessage, {});
      } catch (releaseError) {
        console.error('[AI] Failed to release AI reservation', releaseError);
      }
    };

    let providerFromMetadata: string | undefined;
    let modelFromMetadata: string | undefined;

    try {
      const stream = await streamWithWorkersAIHelper(data.prompt, data.model);

      for await (const chunk of stream) {
        if (chunk.type === 'metadata') {
          providerFromMetadata = 'provider' in chunk ? chunk.provider : undefined;
          modelFromMetadata = 'model' in chunk ? chunk.model : undefined;
          yield chunk;
          continue;
        }

        if (chunk.type === 'complete') {
          try {
            const completion = await fetchAction(api.ai.completeAiMessage, {
              mode: reservation.mode,
              metadata: extractUsageMetadata(
                chunk.usage ?? null,
                providerFromMetadata ?? 'cloudflare-workers-ai',
                modelFromMetadata ?? data.model,
              ),
            });
            usageFinalized = true;
            if (completion.trackError) {
              console.warn('[AI] Autumn usage tracking failed', completion.trackError);
            }
          } catch (completionError) {
            await releaseReservation();
            throw completionError instanceof Error
              ? completionError
              : new Error('Failed to finalize AI usage.');
          }

          yield chunk;
          continue;
        }

        yield chunk;
      }

      if (!usageFinalized) {
        await releaseReservation();
      }
    } catch (error) {
      if (!usageFinalized) {
        await releaseReservation();
      }
      throw error;
    }
  });

// Streaming version for gateway
export const streamWithGateway = createServerFn({ method: 'POST' })
  .inputValidator(textGenerationSchema)
  .handler(async function* ({ data }) {
    await requireAuth();
    const { fetchAction } = await setupFetchClient(createAuth, getCookie);

    const reservation = await fetchAction(api.ai.reserveAiMessage, {
      metadata: { provider: 'cloudflare-gateway-workers-ai', model: data.model },
    });

    if (!reservation.allowed) {
      throw buildReservationError(reservation);
    }

    let usageFinalized = false;
    const releaseReservation = async () => {
      if (usageFinalized) {
        return;
      }
      usageFinalized = true;
      try {
        await fetchAction(api.ai.releaseAiMessage, {});
      } catch (releaseError) {
        console.error('[AI] Failed to release AI reservation', releaseError);
      }
    };

    let providerFromMetadata: string | undefined;
    let modelFromMetadata: string | undefined;

    try {
      const stream = await streamWithGatewayHelper(data.prompt, data.model);

      for await (const chunk of stream) {
        if (chunk.type === 'metadata') {
          providerFromMetadata = 'provider' in chunk ? chunk.provider : undefined;
          modelFromMetadata = 'model' in chunk ? chunk.model : undefined;
          yield chunk;
          continue;
        }

        if (chunk.type === 'complete') {
          try {
            const completion = await fetchAction(api.ai.completeAiMessage, {
              mode: reservation.mode,
              metadata: extractUsageMetadata(
                chunk.usage ?? null,
                providerFromMetadata ?? 'cloudflare-gateway-workers-ai',
                modelFromMetadata ?? data.model,
              ),
            });
            usageFinalized = true;
            if (completion.trackError) {
              console.warn('[AI] Autumn usage tracking failed', completion.trackError);
            }
          } catch (completionError) {
            await releaseReservation();
            throw completionError instanceof Error
              ? completionError
              : new Error('Failed to finalize AI usage.');
          }

          yield chunk;
          continue;
        }

        yield chunk;
      }

      if (!usageFinalized) {
        await releaseReservation();
      }
    } catch (error) {
      if (!usageFinalized) {
        await releaseReservation();
      }
      throw error;
    }
  });

// Streaming version for structured output
export const streamStructuredResponse = createServerFn({ method: 'POST' })
  .inputValidator(structuredGenerationSchema)
  .handler(async function* ({ data }) {
    await requireAuth();
    const { fetchAction } = await setupFetchClient(createAuth, getCookie);

    const reservation = await fetchAction(api.ai.reserveAiMessage, {
      metadata: {
        provider: 'cloudflare-workers-ai-structured',
        model: '@cf/meta/llama-3.1-8b-instruct',
      },
    });

    if (!reservation.allowed) {
      throw buildReservationError(reservation);
    }

    let usageFinalized = false;
    const releaseReservation = async () => {
      if (usageFinalized) {
        return;
      }
      usageFinalized = true;
      try {
        await fetchAction(api.ai.releaseAiMessage, {});
      } catch (releaseError) {
        console.error('[AI] Failed to release AI reservation', releaseError);
      }
    };

    try {
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

      const usage = await result.usage;
      const finishReason = await result.finishReason;

      const estimatedUsage =
        !usage || !usage.totalTokens || usage.totalTokens === 0
          ? {
              inputTokens: estimateTokens(prompt),
              outputTokens: estimateTokens(accumulatedText),
              totalTokens: estimateTokens(prompt) + estimateTokens(accumulatedText),
            }
          : usage;

      try {
        const completion = await fetchAction(api.ai.completeAiMessage, {
          mode: reservation.mode,
          metadata: extractUsageMetadata(
            estimatedUsage,
            'cloudflare-workers-ai-structured',
            '@cf/meta/llama-3.1-8b-instruct',
          ),
        });
        usageFinalized = true;
        if (completion.trackError) {
          console.warn('[AI] Autumn usage tracking failed', completion.trackError);
        }
      } catch (completionError) {
        await releaseReservation();
        throw completionError instanceof Error
          ? completionError
          : new Error('Failed to finalize AI usage.');
      }

      yield {
        type: 'complete',
        usage: estimatedUsage,
        finishReason: finishReason || 'stop',
        structuredData: structuredData,
        parseError: parseError,
        rawText: accumulatedText,
      };
    } catch (error) {
      if (!usageFinalized) {
        await releaseReservation();
      }
      throw error;
    }
  });

// Test gateway connectivity
export const testGatewayConnectivity = createServerFn({ method: 'POST' }).handler(async () => {
  await requireAuth();
  if (!process.env.AUTUMN_SECRET_KEY) {
    return {
      success: false,
      error:
        'Autumn billing is not configured. Follow docs/AUTUMN_SETUP.md to enable paid AI access.',
      gatewayUrl: null,
    };
  }

  const { fetchAction } = await setupFetchClient(createAuth, getCookie);

  const reservation = await fetchAction(api.ai.reserveAiMessage, {
    metadata: {
      provider: 'cloudflare-gateway-connectivity-test',
      model: '@cf/meta/llama-3.1-8b-instruct',
    },
  });

  if (!reservation.allowed) {
    throw buildReservationError(reservation);
  }

  let usageFinalized = false;
  const releaseReservation = async () => {
    if (usageFinalized) {
      return;
    }
    usageFinalized = true;
    try {
      await fetchAction(api.ai.releaseAiMessage, {});
    } catch (releaseError) {
      console.error('[AI] Failed to release AI reservation', releaseError);
    }
  };

  const config = getCloudflareConfig();

  if (!config.gatewayId) {
    await releaseReservation();
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

    try {
      const result = await generateText({
        model: testModel,
        prompt: 'Hello',
      });

      try {
        const completion = await fetchAction(api.ai.completeAiMessage, {
          mode: reservation.mode,
          metadata: extractUsageMetadata(
            result.usage ?? null,
            'cloudflare-gateway-connectivity-test',
            '@cf/meta/llama-3.1-8b-instruct',
          ),
        });
        usageFinalized = true;
        if (completion.trackError) {
          console.warn('[AI] Autumn usage tracking failed', completion.trackError);
        }
      } catch (completionError) {
        await releaseReservation();
        throw completionError instanceof Error
          ? completionError
          : new Error('Failed to finalize AI usage.');
      }

      return {
        success: true,
        status: 200,
        statusText: 'OK',
        gatewayUrl: `https://gateway.ai.cloudflare.com/v1/${config.accountId}/${config.gatewayId}`,
        response: result.text,
      };
    } catch (error) {
      await releaseReservation();
      throw error;
    }
  } catch (error) {
    console.error('❌ Gateway connectivity test failed:', error);
    await releaseReservation();
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
    const { fetchAction } = await setupFetchClient(createAuth, getCookie);

    const reservation = await fetchAction(api.ai.reserveAiMessage, {
      metadata: { provider: 'cloudflare-ai-comparison', model: data.model },
    });

    if (!reservation.allowed) {
      throw buildReservationError(reservation);
    }

    let usageFinalized = false;
    const releaseReservation = async () => {
      if (usageFinalized) {
        return;
      }
      usageFinalized = true;
      try {
        await fetchAction(api.ai.releaseAiMessage, {});
      } catch (releaseError) {
        console.error('[AI] Failed to release AI reservation', releaseError);
      }
    };

    try {
      const [directResult, gatewayResult] = await Promise.allSettled([
        generateWithWorkersAIHelper(data.prompt, data.model),
        generateWithGatewayHelper(data.prompt, data.model),
      ]);

      const directUsage =
        directResult.status === 'fulfilled' ? (directResult.value.usage ?? null) : null;
      const gatewayUsage =
        gatewayResult.status === 'fulfilled' ? (gatewayResult.value.usage ?? null) : null;

      try {
        const totalTokens =
          (directUsage?.totalTokens ?? 0) + (gatewayUsage?.totalTokens ?? 0) || undefined;
        const completion = await fetchAction(api.ai.completeAiMessage, {
          mode: reservation.mode,
          metadata: {
            provider: 'cloudflare-ai-comparison',
            model: data.model,
            totalTokens,
          },
        });
        usageFinalized = true;
        if (completion.trackError) {
          console.warn('[AI] Autumn usage tracking failed', completion.trackError);
        }
      } catch (completionError) {
        await releaseReservation();
        throw completionError instanceof Error
          ? completionError
          : new Error('Failed to finalize AI usage.');
      }

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
    } catch (error) {
      await releaseReservation();
      throw error;
    }
  });
