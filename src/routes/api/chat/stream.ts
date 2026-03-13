import * as Sentry from '@sentry/tanstackstart-react';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import {
  generateText,
  stepCountIs,
  streamText,
  tool,
  type ModelMessage,
  type TextStreamPart,
  type ToolSet,
} from 'ai';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { api } from '@convex/_generated/api';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';
import {
  getOpenRouterWebSearchPlugin,
  getOpenRouterWebSearchProviderOptions,
} from '~/features/chat/lib/openrouter-web-search';
import { getOpenRouterConfig } from '~/lib/server/openrouter';

const sendRequestSchema = z.object({
  mode: z.literal('send').optional(),
  threadId: z.string().optional(),
  personaId: z.string().optional(),
  model: z.string().optional(),
  useWebSearch: z.boolean().optional(),
  text: z.string(),
  attachmentIds: z.array(z.string()),
  clientMessageId: z.string().optional(),
  ownerSessionId: z.string(),
});

const editRequestSchema = z.object({
  mode: z.literal('edit'),
  messageId: z.string(),
  text: z.string(),
  model: z.string().optional(),
  useWebSearch: z.boolean().optional(),
  ownerSessionId: z.string(),
});

const retryRequestSchema = z.object({
  mode: z.literal('retry'),
  runId: z.string(),
  model: z.string().optional(),
  useWebSearch: z.boolean().optional(),
  ownerSessionId: z.string(),
});

const requestSchema = z.discriminatedUnion('mode', [
  sendRequestSchema.extend({ mode: z.literal('send') }),
  editRequestSchema,
  retryRequestSchema,
]).or(sendRequestSchema);

type PreparedStreamResult = {
  preparedMessages: unknown[];
  promptMessageId: string;
  runId: string;
  systemPrompt: string;
  threadId: string;
  assistantMessageId: string;
  model: string;
  provider: 'openrouter';
  supportsWebSearch: boolean;
};

let openRouterProvider: ReturnType<typeof createOpenRouter> | null = null;

function getOpenRouter() {
  if (!openRouterProvider) {
    const config = getOpenRouterConfig();
    openRouterProvider = createOpenRouter({
      apiKey: config.apiKey,
      compatibility: config.compatibility,
      ...(config.headers ? { headers: config.headers } : {}),
    });
  }

  return openRouterProvider;
}

function toUsage(
  usage:
    | {
        totalTokens?: number;
        inputTokens?: number;
        outputTokens?: number;
      }
    | undefined,
) {
  return {
    totalTokens: usage?.totalTokens,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
  };
}

function isTextDeltaPart(
  part: TextStreamPart<ToolSet>,
): part is Extract<TextStreamPart<ToolSet>, { type: 'text-delta' }> {
  return part.type === 'text-delta';
}

function mapOpenRouterSources(sources: unknown[] | undefined) {
  if (!sources) {
    return undefined;
  }

  return sources.flatMap((source) => {
    if (!source || typeof source !== 'object') {
      return [];
    }

    const value = source as {
      sourceType?: string;
      id?: string;
      url?: string;
      title?: string;
    };
    if (value.sourceType !== 'url' || !value.id || !value.url) {
      return [];
    }

    return [
      {
        sourceType: 'url' as const,
        id: value.id,
        url: value.url,
        title: value.title,
      },
    ];
  });
}

function dedupeSources(
  sources: Array<{
    sourceType: 'url';
    id: string;
    url: string;
    title?: string;
  }>,
) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.url)) {
      return false;
    }
    seen.add(source.url);
    return true;
  });
}

function jsonError(status: number, errorMessage: string) {
  return Response.json({ errorMessage }, { status });
}

async function enforceChatRateLimit(args: {
  rateLimitKey: string;
  hasAttachments: boolean;
}) {
  const token = process.env.BETTER_AUTH_SECRET?.trim();
  if (!token) {
    throw new Error('BETTER_AUTH_SECRET environment variable is required');
  }

  const result = await convexAuthReactStart.fetchAuthAction(api.auth.rateLimitAction, {
    token,
    name: args.hasAttachments ? 'chatStreamWithAttachments' : 'chatStream',
    key: args.rateLimitKey,
    config: {
      kind: 'token bucket',
      rate: args.hasAttachments ? 4 : 12,
      period: 60 * 1000,
      capacity: args.hasAttachments ? 4 : 12,
    },
  });

  if (!result.ok) {
    const retrySeconds = Math.max(1, Math.ceil((result.retryAfter ?? 0) / 1000));
    return jsonError(429, `Rate limit exceeded. Try again in ${retrySeconds} seconds.`);
  }

  return null;
}

export const Route = createFileRoute('/api/chat/stream' as never)({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const parsed = requestSchema.safeParse(await request.json());
          if (!parsed.success) {
            return new Response(parsed.error.message, { status: 400 });
          }

          const rateLimitContext = await convexAuthReactStart.fetchAuthQuery(
            api.agentChat.getCurrentRateLimitContext,
            {},
          );
          const rateLimitResponse = await enforceChatRateLimit({
            rateLimitKey: rateLimitContext.key,
            hasAttachments: parsed.data.mode === 'send' && parsed.data.attachmentIds.length > 0,
          });
          if (rateLimitResponse) {
            return rateLimitResponse;
          }

          let prepared: PreparedStreamResult;
          if (parsed.data.mode === 'edit') {
            prepared = (await convexAuthReactStart.fetchAuthAction(
              api.agentChatActions.prepareEditedStream,
              {
                messageId: parsed.data.messageId,
                text: parsed.data.text,
                model: parsed.data.model,
                useWebSearch: parsed.data.useWebSearch,
                ownerSessionId: parsed.data.ownerSessionId,
              } as never,
            )) as PreparedStreamResult;
          } else if (parsed.data.mode === 'retry') {
            prepared = (await convexAuthReactStart.fetchAuthAction(
              api.agentChatActions.prepareRetryStream,
              {
                runId: parsed.data.runId as never,
                model: parsed.data.model,
                useWebSearch: parsed.data.useWebSearch,
                ownerSessionId: parsed.data.ownerSessionId,
              } as never,
            )) as PreparedStreamResult;
          } else {
            prepared = (await convexAuthReactStart.fetchAuthAction(api.agentChatActions.prepareStream, {
              threadId: parsed.data.threadId as never,
              personaId: parsed.data.personaId as never,
              model: parsed.data.model,
              useWebSearch: parsed.data.useWebSearch,
              text: parsed.data.text,
              attachmentIds: parsed.data.attachmentIds as never,
              clientMessageId: parsed.data.clientMessageId,
              ownerSessionId: parsed.data.ownerSessionId,
            } as never)) as PreparedStreamResult;
          }

          const headers = new Headers({
            'x-chat-thread-id': prepared.threadId,
            'x-chat-run-id': prepared.runId,
            'x-chat-assistant-message-id': prepared.assistantMessageId,
          });

          const providerOptions = {
            openrouter: {
              provider: {
                zdr: true,
                data_collection: 'deny',
              },
            },
          };

          const response = await Sentry.startSpan(
            {
              name: 'chat.stream.route',
              op: 'ai.stream',
            },
            async () => {
              let pendingText = '';
              let pendingDeltaText = '';
              let deltaSequence = 0;
              let flushTimer: ReturnType<typeof setTimeout> | null = null;
              let flushPromise: Promise<void> = Promise.resolve();
              const collectedSources: Array<{
                sourceType: 'url';
                id: string;
                url: string;
                title?: string;
              }> = [];

              const flushDeltaText = async () => {
                if (!pendingDeltaText) {
                  return;
                }
                const text = pendingDeltaText;
                pendingDeltaText = '';
                deltaSequence += 1;
                await convexAuthReactStart.fetchAuthAction(api.agentChatActions.appendStreamDelta, {
                  runId: prepared.runId as never,
                  threadId: prepared.threadId as never,
                  assistantMessageId: prepared.assistantMessageId,
                  sequence: deltaSequence,
                  text,
                });
              };

              const scheduleDeltaFlush = () => {
                if (flushTimer) {
                  return;
                }
                flushTimer = setTimeout(() => {
                  flushTimer = null;
                  flushPromise = flushPromise.then(() => flushDeltaText()).catch(() => {});
                }, 250);
              };

              const webSearchTool =
                parsed.data.useWebSearch && prepared.supportsWebSearch
                  ? tool({
                      description:
                        'Search the web for current information and return a concise summary plus cited sources.',
                      inputSchema: z.object({
                        query: z.string().min(2),
                      }),
                      execute: async ({ query }) => {
                        const searchModel = getOpenRouter().chat(prepared.model, {
                          plugins: [getOpenRouterWebSearchPlugin(prepared.model)],
                        });
                        const webSearchProviderOptions =
                          getOpenRouterWebSearchProviderOptions(prepared.model) ?? {};
                        const searchResult = await generateText({
                          model: searchModel,
                          prompt: `Search the web for: ${query}\n\nReturn a concise factual summary of the most relevant results.`,
                          providerOptions: {
                            openrouter: {
                              provider: {
                                zdr: true,
                                data_collection: 'deny',
                                ...webSearchProviderOptions,
                              },
                            },
                          },
                        });
                        const sources = dedupeSources(
                          mapOpenRouterSources(searchResult.sources as unknown[] | undefined) ?? [],
                        );
                        collectedSources.push(...sources);
                        return {
                          query,
                          summary: searchResult.text,
                          results: sources.map((source) => ({
                            id: source.id,
                            url: source.url,
                            title: source.title,
                          })),
                        };
                      },
                    })
                  : undefined;

              const result = await streamText({
                model: getOpenRouter().chat(prepared.model, {
                }),
                system: parsed.data.useWebSearch
                  ? `${prepared.systemPrompt}\n\nWhen current or recent web information is needed, use the web_search tool.`
                  : prepared.systemPrompt,
                messages: prepared.preparedMessages as ModelMessage[],
                providerOptions,
                tools: webSearchTool ? { web_search: webSearchTool } : undefined,
                stopWhen: stepCountIs(webSearchTool ? 4 : 1),
                abortSignal: request.signal,
                onChunk(event) {
                  if (isTextDeltaPart(event.chunk)) {
                    pendingText += event.chunk.text;
                    pendingDeltaText += event.chunk.text;
                    scheduleDeltaFlush();
                  }
                },
                async onFinish(event) {
                  if (flushTimer) {
                    clearTimeout(flushTimer);
                    flushTimer = null;
                  }
                  await flushPromise;
                  await flushDeltaText();
                  await convexAuthReactStart.fetchAuthAction(api.agentChatActions.finalizeStream, {
                    runId: prepared.runId as never,
                    finalText: event.text || pendingText,
                    usage: toUsage(event.totalUsage),
                    sources: dedupeSources([
                      ...(mapOpenRouterSources(event.sources) ?? []),
                      ...collectedSources,
                    ]),
                  });
                },
                async onAbort() {
                  if (flushTimer) {
                    clearTimeout(flushTimer);
                    flushTimer = null;
                  }
                  await flushPromise;
                  await flushDeltaText();
                  await convexAuthReactStart.fetchAuthAction(api.agentChatActions.abortStream, {
                    runId: prepared.runId as never,
                    reason: 'Stopped by user.',
                    status: 'aborted',
                    partialText: pendingText,
                  });
                },
                async onError(event) {
                  if (flushTimer) {
                    clearTimeout(flushTimer);
                    flushTimer = null;
                  }
                  await flushPromise;
                  await flushDeltaText();
                  await convexAuthReactStart.fetchAuthAction(api.agentChatActions.abortStream, {
                    runId: prepared.runId as never,
                    reason:
                      event.error instanceof Error ? event.error.message : 'Streaming failed.',
                    status: request.signal.aborted ? 'aborted' : 'error',
                    partialText: pendingText,
                  });
                },
              });

              return result.toTextStreamResponse({
                status: 200,
                headers,
              });
            },
          );

          return response;
        } catch (error) {
          console.error('[chat.stream.route] failed to start stream', error);
          const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : undefined;
          const payload = import.meta.env.DEV
            ? {
                errorName: error instanceof Error ? error.name : typeof error,
                errorMessage: error instanceof Error ? error.message : String(error),
                cause:
                  cause instanceof Error
                    ? {
                        name: cause.name,
                        message: cause.message,
                      }
                    : cause,
              }
            : {
                errorMessage: 'Failed to start chat stream.',
              };
          return Response.json(payload, { status: 500 });
        }
      },
    },
  },
});
