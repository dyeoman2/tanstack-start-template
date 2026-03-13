import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { ChatActiveStream, ChatStreamRequest } from '~/features/chat/types';

const OWNER_SESSION_STORAGE_KEY = 'chat-owner-session-id';

type ChatStreamRecord = Record<string, ChatActiveStream | undefined>;

let streamStore: ChatStreamRecord = {};
const listeners = new Set<() => void>();
const controllersByThreadId = new Map<string, AbortController>();
let pendingController: AbortController | null = null;

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function setStream(threadId: string, stream: ChatActiveStream) {
  streamStore = {
    ...streamStore,
    [threadId]: stream,
  };
  emitChange();
}

function patchStream(
  threadId: string,
  updater: (stream: ChatActiveStream | undefined) => ChatActiveStream | undefined,
) {
  const next = updater(streamStore[threadId]);
  if (next === streamStore[threadId]) {
    return;
  }

  if (!next) {
    const { [threadId]: _removed, ...rest } = streamStore;
    streamStore = rest;
  } else {
    streamStore = {
      ...streamStore,
      [threadId]: next,
    };
  }

  emitChange();
}

function movePendingController(threadId: string, controller: AbortController) {
  if (pendingController === controller) {
    pendingController = null;
  }
  controllersByThreadId.set(threadId, controller);
}

function clearController(threadId: string) {
  const controller = controllersByThreadId.get(threadId);
  if (controller) {
    controllersByThreadId.delete(threadId);
  }
}

function getOwnerSessionId() {
  if (typeof window === 'undefined') {
    return 'server-session';
  }

  const existing = window.sessionStorage.getItem(OWNER_SESSION_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const next =
    window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.sessionStorage.setItem(OWNER_SESSION_STORAGE_KEY, next);
  return next;
}

async function readErrorMessage(response: Response) {
  try {
    const text = await response.text();
    return text.trim() || `Request failed with status ${response.status}.`;
  } catch {
    return `Request failed with status ${response.status}.`;
  }
}

function parsePreparedHeaders(response: Response) {
  const threadId = response.headers.get('x-chat-thread-id');
  const runId = response.headers.get('x-chat-run-id');
  const assistantMessageId = response.headers.get('x-chat-assistant-message-id');

  if (!threadId || !runId || !assistantMessageId) {
    throw new Error('Stream response headers were incomplete.');
  }

  return {
    threadId,
    runId,
    assistantMessageId,
  };
}

async function pumpStream(
  response: Response,
  prepared: {
    threadId: string;
    runId: string;
    assistantMessageId: string;
    ownerSessionId: string;
    request: ChatStreamRequest;
  },
  controller: AbortController,
) {
  const reader = response.body?.getReader();
  if (!reader) {
    patchStream(prepared.threadId, (stream) =>
      stream
        ? {
            ...stream,
            status: 'complete',
          }
        : stream,
    );
    clearController(prepared.threadId);
    return;
  }

  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      if (!chunk) {
        continue;
      }

      patchStream(prepared.threadId, (stream) =>
        stream
          ? {
              ...stream,
              text: `${stream.text}${chunk}`,
            }
          : stream,
      );
    }

    patchStream(prepared.threadId, (stream) =>
      stream
        ? {
            ...stream,
            status: 'complete',
          }
        : stream,
    );
  } catch (error) {
    const aborted = controller.signal.aborted;
    patchStream(prepared.threadId, (stream) =>
      stream
        ? {
            ...stream,
            status: aborted ? 'aborted' : 'error',
            errorMessage: aborted
              ? 'Stopped by user.'
              : error instanceof Error
                ? error.message
                : 'Streaming failed.',
          }
        : stream,
    );
  } finally {
    clearController(prepared.threadId);
  }
}

export function clearChatStream(threadId: string) {
  patchStream(threadId, () => undefined);
  clearController(threadId);
}

export function useChatStream(threadId?: string) {
  const ownerSessionId = useMemo(() => getOwnerSessionId(), []);
  const activeStream = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => (threadId ? streamStore[threadId] : undefined),
    () => undefined,
  );

  const startStream = useCallback(
    async (request: ChatStreamRequest) => {
      const requestedThreadId = 'threadId' in request ? request.threadId : undefined;
      if (request.mode !== 'retry' && requestedThreadId) {
        controllersByThreadId.get(requestedThreadId)?.abort();
      }

      const provisionalRunId = `pending-run:${Date.now()}`;
      const provisionalAssistantMessageId =
        `pending-assistant:${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const controller = new AbortController();
      pendingController = controller;

      if (requestedThreadId) {
        setStream(requestedThreadId, {
          threadId: requestedThreadId,
          runId: provisionalRunId,
          assistantMessageId: provisionalAssistantMessageId,
          ownerSessionId,
          text: '',
          status: 'streaming',
          startedAt: Date.now(),
          request,
        });
      }

      let response: Response;
      try {
        response = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(
            request.mode === 'send'
              ? {
                  ...request,
                  ownerSessionId,
                }
              : {
                  ...request,
                  ownerSessionId,
                },
          ),
          signal: controller.signal,
        });
      } catch (error) {
        pendingController = null;
        if (requestedThreadId) {
          patchStream(requestedThreadId, (stream) =>
            stream
              ? {
                  ...stream,
                  status: controller.signal.aborted ? 'aborted' : 'error',
                  errorMessage: controller.signal.aborted
                    ? 'Stopped by user.'
                    : error instanceof Error
                      ? error.message
                      : 'Streaming failed.',
                }
              : stream,
          );
        }
        throw error;
      }

      if (!response.ok) {
        pendingController = null;
        if (requestedThreadId) {
          const errorMessage = await readErrorMessage(response);
          patchStream(requestedThreadId, (stream) =>
            stream
              ? {
                  ...stream,
                  status: 'error',
                  errorMessage,
                }
              : stream,
          );
          throw new Error(errorMessage);
        }
        throw new Error(await readErrorMessage(response));
      }

      let prepared: ReturnType<typeof parsePreparedHeaders>;
      try {
        prepared = parsePreparedHeaders(response);
      } catch (error) {
        pendingController = null;
        if (requestedThreadId) {
          patchStream(requestedThreadId, (stream) =>
            stream
              ? {
                  ...stream,
                  status: 'error',
                  errorMessage:
                    error instanceof Error ? error.message : 'Streaming failed to initialize.',
                }
              : stream,
          );
        }
        throw error;
      }

      movePendingController(prepared.threadId, controller);
      const nextStream: ChatActiveStream = {
        threadId: prepared.threadId,
        runId: prepared.runId,
        assistantMessageId: prepared.assistantMessageId,
        ownerSessionId,
        text:
          requestedThreadId && streamStore[requestedThreadId]?.request === request
            ? streamStore[requestedThreadId]?.text ?? ''
            : '',
        status: 'streaming',
        startedAt: Date.now(),
        request,
      };
      if (requestedThreadId === prepared.threadId || !requestedThreadId) {
        setStream(prepared.threadId, nextStream);
      } else {
        const { [requestedThreadId]: _removed, ...rest } = streamStore;
        streamStore = {
          ...rest,
          [prepared.threadId]: nextStream,
        };
        emitChange();
      }

      void pumpStream(
        response,
        {
          threadId: prepared.threadId,
          runId: prepared.runId,
          assistantMessageId: prepared.assistantMessageId,
          ownerSessionId,
          request,
        },
        controller,
      );

      return prepared;
    },
    [ownerSessionId],
  );

  const stopStream = useCallback(
    (targetThreadId?: string) => {
      const nextThreadId = targetThreadId ?? threadId;
      if (nextThreadId) {
        const controller = controllersByThreadId.get(nextThreadId);
        if (controller) {
          controller.abort();
          return true;
        }
      }

      if (pendingController) {
        pendingController.abort();
        pendingController = null;
        return true;
      }

      return false;
    },
    [threadId],
  );

  const clearStream = useCallback((targetThreadId?: string) => {
    const nextThreadId = targetThreadId ?? threadId;
    if (!nextThreadId) {
      return;
    }

    clearChatStream(nextThreadId);
  }, [threadId]);

  return {
    ownerSessionId,
    activeStream: activeStream ?? null,
    startStream,
    stopStream,
    clearStream,
  };
}
