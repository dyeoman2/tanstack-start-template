import * as Sentry from '@sentry/tanstackstart-react';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText, type ModelMessage, type TextStreamPart, type ToolSet } from 'ai';
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

export const Route = createFileRoute('/api/chat/stream' as never)({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const parsed = requestSchema.safeParse(await request.json());
          if (!parsed.success) {
            return new Response(parsed.error.message, { status: 400 });
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
                ...(parsed.data.useWebSearch && prepared.supportsWebSearch
                  ? getOpenRouterWebSearchProviderOptions(prepared.model)
                  : {}),
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
              const result = await streamText({
                model: getOpenRouter().chat(prepared.model, {
                  ...(parsed.data.useWebSearch && prepared.supportsWebSearch
                    ? { plugins: [getOpenRouterWebSearchPlugin(prepared.model)] }
                    : {}),
                }),
                system: prepared.systemPrompt,
                messages: prepared.preparedMessages as ModelMessage[],
                providerOptions,
                abortSignal: request.signal,
                onChunk(event) {
                  if (isTextDeltaPart(event.chunk)) {
                    pendingText += event.chunk.text;
                  }
                },
                async onFinish(event) {
                  await convexAuthReactStart.fetchAuthAction(api.agentChatActions.finalizeStream, {
                    runId: prepared.runId as never,
                    finalText: event.text || pendingText,
                    usage: toUsage(event.totalUsage),
                    sources: mapOpenRouterSources(event.sources),
                  });
                },
                async onAbort() {
                  await convexAuthReactStart.fetchAuthAction(api.agentChatActions.abortStream, {
                    runId: prepared.runId as never,
                    reason: 'Stopped by user.',
                    status: 'aborted',
                    partialText: pendingText,
                  });
                },
                async onError(event) {
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
