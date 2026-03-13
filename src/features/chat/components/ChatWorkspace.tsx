import { api } from '@convex/_generated/api';
import { useNavigate } from '@tanstack/react-router';
import { useAction, useMutation, useQuery } from 'convex/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '~/components/ui/button';
import { useToast } from '~/components/ui/toast';
import { ChatComposer } from '~/features/chat/components/ChatComposer';
import { MessageList } from '~/features/chat/components/MessageList';
import { PersonaDialog } from '~/features/chat/components/PersonaDialog';
import { CHAT_ROUTE, DEFAULT_CHAT_PERSONA } from '~/features/chat/lib/constants';
import { toPersonaId, toThreadId } from '~/features/chat/lib/ids';
import {
  clearPendingThreadSubmission,
  setPendingThreadSubmission,
  updatePendingThreadSubmission,
  usePendingThreadSubmission,
} from '~/features/chat/lib/pending-thread-submission';
import type { ChatMessagePart } from '~/features/chat/types';
import {
  type ChatModelId,
  DEFAULT_CHAT_MODEL_ID,
  getChatModelOption,
} from '~/lib/shared/chat-models';

export function ChatWorkspaceSkeleton() {
  return (
    <div className="flex min-h-[60vh] flex-col overflow-hidden px-4 py-5 md:px-6">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
        <div className="flex-1 space-y-4">
          <div className="ml-auto h-20 w-[min(32rem,80%)] animate-pulse rounded-2xl rounded-br-md bg-muted/70" />
          <div className="h-24 w-[min(42rem,88%)] animate-pulse rounded-2xl bg-muted/55" />
          <div className="ml-auto h-16 w-[min(28rem,72%)] animate-pulse rounded-2xl rounded-br-md bg-muted/70" />
        </div>
        <div className="pt-6">
          <div className="h-24 animate-pulse rounded-[20px] bg-muted/60" />
        </div>
      </div>
    </div>
  );
}

function ChatMessagesSkeleton() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <div className="ml-auto h-20 w-[min(32rem,80%)] animate-pulse rounded-2xl rounded-br-md bg-muted/70" />
        <div className="h-24 w-[min(42rem,88%)] animate-pulse rounded-2xl bg-muted/55" />
        <div className="ml-auto h-16 w-[min(28rem,72%)] animate-pulse rounded-2xl rounded-br-md bg-muted/70" />
      </div>
    </div>
  );
}

export function ChatWorkspace({ threadId }: { threadId?: string }) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [isSending, setIsSending] = useState(false);
  const [personaDialogOpen, setPersonaDialogOpen] = useState(false);
  const [draftPersonaId, setDraftPersonaId] = useState<string | undefined>(undefined);
  const [draftModelId, setDraftModelId] = useState<ChatModelId>(DEFAULT_CHAT_MODEL_ID);
  const [threadModelOverrides, setThreadModelOverrides] = useState<
    Partial<Record<string, ChatModelId>>
  >({});
  const messageViewportRef = useRef<HTMLDivElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const scrollTargetMessageRef = useRef<HTMLDivElement | null>(null);
  const scrollRequestThreadIdRef = useRef<string | null>(null);

  const typedThreadId = threadId ? toThreadId(threadId) : undefined;
  const thread = useQuery(api.chat.getThread, typedThreadId ? { threadId: typedThreadId } : 'skip');
  const messages = useQuery(
    api.chat.listMessages,
    typedThreadId ? { threadId: typedThreadId } : 'skip',
  );
  const personas = useQuery(api.chat.listPersonas, {});
  const modelOptions = useQuery(api.chatModels.listAvailableChatModels, {});
  const sendChatMessage = useAction(api.chatActions.sendChatMessage);
  const createThread = useMutation(api.chat.createThread);
  const createPersona = useMutation(api.chat.createPersona);
  const updatePersona = useMutation(api.chat.updatePersona);
  const deletePersona = useMutation(api.chat.deletePersona);
  const setThreadPersona = useMutation(api.chat.setThreadPersona);
  const pendingSubmission = usePendingThreadSubmission(threadId);

  const effectivePersonaId = thread?.personaId ?? draftPersonaId;
  const currentPersonaLabel = useMemo(() => {
    if (!effectivePersonaId) {
      return DEFAULT_CHAT_PERSONA.name;
    }

    return personas?.find((persona) => persona._id === effectivePersonaId)?.name ?? 'Persona';
  }, [effectivePersonaId, personas]);
  const currentMessages = messages ?? [];
  const inferredThreadModelId = useMemo(() => {
    for (let index = currentMessages.length - 1; index >= 0; index -= 1) {
      const message = currentMessages[index];
      if (message.role === 'assistant' && message.model) {
        return message.model;
      }
    }

    return undefined;
  }, [currentMessages]);
  const requestedModelId = threadId
    ? (threadModelOverrides[threadId] ?? inferredThreadModelId ?? DEFAULT_CHAT_MODEL_ID)
    : draftModelId;
  const selectedModelOption = getChatModelOption(modelOptions ?? [], requestedModelId);
  const effectiveModelId = selectedModelOption.selectable
    ? selectedModelOption.id
    : DEFAULT_CHAT_MODEL_ID;
  const pendingPreview =
    pendingSubmission && threadId
      ? {
          submission: pendingSubmission,
          showUserMessage: !currentMessages.some(
            (message) =>
              message.role === 'user' &&
              message.clientMessageId === pendingSubmission.clientMessageId,
          ),
          showAssistantPlaceholder: !currentMessages.some(
            (message) =>
              message.role === 'assistant' && message.createdAt >= pendingSubmission.submittedAt,
          ),
        }
      : undefined;
  const showEmptyState = currentMessages.length === 0 && !pendingPreview;
  const isThreadPending = Boolean(threadId && (thread === undefined || messages === undefined));
  const shouldShowCenteredComposer = !isThreadPending && showEmptyState;
  const composerDisabled = isThreadPending;
  const alignPendingMessageToTop = useCallback(() => {
    const viewportNode = messageViewportRef.current;
    const targetNode = scrollTargetMessageRef.current;

    if (!viewportNode || !targetNode) {
      return;
    }

    const topOffset = 24;
    const viewportRect = viewportNode.getBoundingClientRect();
    const targetRect = targetNode.getBoundingClientRect();
    const nextTop = viewportNode.scrollTop + (targetRect.top - viewportRect.top) - topOffset;

    viewportNode.scrollTo({
      top: Math.max(0, nextTop),
      behavior: 'auto',
    });
  }, []);

  useEffect(() => {
    if (!threadId || !pendingSubmission || !messages) {
      return;
    }

    const hasUserMessage = messages.some(
      (message) =>
        message.role === 'user' && message.clientMessageId === pendingSubmission.clientMessageId,
    );
    const hasAssistantMessage = messages.some(
      (message) =>
        message.role === 'assistant' && message.createdAt >= pendingSubmission.submittedAt,
    );

    if (hasAssistantMessage) {
      clearPendingThreadSubmission(threadId);
      return;
    }

    if (hasUserMessage && pendingSubmission.stage === 'submitting') {
      updatePendingThreadSubmission(threadId, (submission) =>
        submission
          ? {
              ...submission,
              stage: 'streaming',
            }
          : submission,
      );
    }
  }, [messages, pendingSubmission, threadId]);

  useEffect(() => {
    if (!threadId || messages === undefined || scrollRequestThreadIdRef.current === threadId) {
      return;
    }

    scrollRequestThreadIdRef.current = threadId;

    const endNode = messageEndRef.current;
    if (!endNode) {
      return;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        endNode.scrollIntoView({ block: 'end' });
      });
    });
  }, [messages, threadId]);

  useEffect(() => {
    if (!pendingSubmission?.clientMessageId) {
      return;
    }

    let outerFrame = 0;
    let innerFrame = 0;

    outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => {
        alignPendingMessageToTop();
      });
    });

    return () => {
      cancelAnimationFrame(outerFrame);
      cancelAnimationFrame(innerFrame);
    };
  }, [alignPendingMessageToTop, pendingSubmission?.clientMessageId]);

  if (threadId && thread === null) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center rounded-3xl border border-dashed border-border/70 bg-card/40 px-6 text-center">
        <h2 className="text-2xl font-medium tracking-tight">Thread not found</h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          This conversation does not exist in your active organization, or it was deleted.
        </p>
        <Button className="mt-6" onClick={() => void navigate({ to: CHAT_ROUTE })}>
          Back to chat
        </Button>
      </div>
    );
  }

  if (personas === undefined || modelOptions === undefined) {
    return <ChatWorkspaceSkeleton />;
  }

  const handleSend = async ({ parts, clear }: { parts: ChatMessagePart[]; clear: () => void }) => {
    const clientMessageId =
      globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setIsSending(true);

    try {
      clear();
      const personaId = thread
        ? thread.personaId
        : draftPersonaId
          ? toPersonaId(draftPersonaId)
          : undefined;

      if (!threadId) {
        const nextThreadId = await createThread({ personaId });

        setPendingThreadSubmission(nextThreadId, {
          clientMessageId,
          parts,
          submittedAt: Date.now(),
          stage: 'submitting',
        });

        await navigate({
          to: '/app/chat/$threadId',
          params: { threadId: nextThreadId },
        });

        void sendChatMessage({
          threadId: nextThreadId,
          personaId,
          model: effectiveModelId,
          parts,
          clientMessageId,
        }).catch((error) => {
          updatePendingThreadSubmission(nextThreadId, (submission) =>
            submission
              ? {
                  ...submission,
                  stage: 'error',
                  errorMessage: error instanceof Error ? error.message : 'Failed to send message.',
                }
              : submission,
          );
          showToast(error instanceof Error ? error.message : 'Failed to send message.', 'error');
        });

        return;
      }

      setPendingThreadSubmission(threadId, {
        clientMessageId,
        parts,
        submittedAt: Date.now(),
        stage: 'submitting',
      });

      await sendChatMessage({
        threadId: typedThreadId,
        personaId,
        model: effectiveModelId,
        parts,
        clientMessageId,
      });
    } catch (error) {
      if (threadId) {
        updatePendingThreadSubmission(threadId, (submission) =>
          submission
            ? {
                ...submission,
                stage: 'error',
                errorMessage: error instanceof Error ? error.message : 'Failed to send message.',
              }
            : submission,
        );
      }
      showToast(error instanceof Error ? error.message : 'Failed to send message.', 'error');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-full min-h-0 flex-1 flex-col">
          {shouldShowCenteredComposer ? (
            <div className="flex min-h-[50vh] flex-1 flex-col items-center justify-center px-4 text-center">
              <h1 className="text-4xl font-medium tracking-tight md:text-5xl">
                What shall we explore?
              </h1>
              <p className="mt-4 max-w-lg text-balance font-serif text-lg text-muted-foreground">
                I&apos;m here to help you think, write, and discover.
              </p>
              <div className="mt-8 w-full max-w-3xl">
                <ChatComposer
                  disabled={composerDisabled}
                  isSending={isSending}
                  modelOptions={modelOptions}
                  personas={personas ?? []}
                  selectedModelId={effectiveModelId}
                  selectedPersonaId={effectivePersonaId}
                  selectedPersonaLabel={currentPersonaLabel}
                  onSelectModel={(modelId) => {
                    if (threadId) {
                      setThreadModelOverrides((previous) => ({
                        ...previous,
                        [threadId]: modelId,
                      }));
                    } else {
                      setDraftModelId(modelId);
                    }
                  }}
                  onSelectPersona={(personaId) => {
                    if (threadId) {
                      void setThreadPersona({
                        threadId: toThreadId(threadId),
                        personaId: personaId ? toPersonaId(personaId) : undefined,
                      }).catch((error) => {
                        showToast(
                          error instanceof Error ? error.message : 'Failed to update persona.',
                          'error',
                        );
                      });
                    } else {
                      setDraftPersonaId(personaId);
                    }
                  }}
                  onManagePersonas={() => setPersonaDialogOpen(true)}
                  onSend={handleSend}
                />
              </div>
            </div>
          ) : (
            <>
              {isThreadPending ? (
                <ChatMessagesSkeleton />
              ) : (
                <div
                  ref={messageViewportRef}
                  className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6"
                >
                  <div className="mx-auto w-full max-w-5xl">
                    <MessageList
                      messages={currentMessages}
                      isStreaming={isSending}
                      pendingSubmission={pendingPreview}
                      scrollTargetClientMessageId={pendingSubmission?.clientMessageId}
                      scrollTargetMessageRef={scrollTargetMessageRef}
                    />
                    <div ref={messageEndRef} aria-hidden="true" />
                  </div>
                </div>
              )}
              <div className="sticky bottom-0 shrink-0 bg-gradient-to-t from-background via-background/95 to-transparent px-4 pb-4 pt-6 md:px-6">
                <div className="mx-auto w-full max-w-5xl">
                  <ChatComposer
                    disabled={composerDisabled}
                    isSending={isSending}
                    modelOptions={modelOptions}
                    personas={personas ?? []}
                    selectedModelId={effectiveModelId}
                    selectedPersonaId={effectivePersonaId}
                    selectedPersonaLabel={currentPersonaLabel}
                    onSelectModel={(modelId) => {
                      if (threadId) {
                        setThreadModelOverrides((previous) => ({
                          ...previous,
                          [threadId]: modelId,
                        }));
                      } else {
                        setDraftModelId(modelId);
                      }
                    }}
                    onSelectPersona={(personaId) => {
                      if (threadId) {
                        void setThreadPersona({
                          threadId: toThreadId(threadId),
                          personaId: personaId ? toPersonaId(personaId) : undefined,
                        }).catch((error) => {
                          showToast(
                            error instanceof Error ? error.message : 'Failed to update persona.',
                            'error',
                          );
                        });
                      } else {
                        setDraftPersonaId(personaId);
                      }
                    }}
                    onManagePersonas={() => setPersonaDialogOpen(true)}
                    onSend={handleSend}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      <PersonaDialog
        open={personaDialogOpen}
        onOpenChange={setPersonaDialogOpen}
        personas={personas ?? []}
        selectedPersonaId={effectivePersonaId}
        onSelectPersona={(personaId) => {
          if (threadId) {
            void setThreadPersona({
              threadId: toThreadId(threadId),
              personaId: personaId ? toPersonaId(personaId) : undefined,
            }).catch((error) => {
              showToast(
                error instanceof Error ? error.message : 'Failed to update persona.',
                'error',
              );
            });
          } else {
            setDraftPersonaId(personaId);
          }
        }}
        onCreatePersona={async (values) => {
          await createPersona(values);
        }}
        onUpdatePersona={async (values) => {
          await updatePersona({ ...values, personaId: toPersonaId(values.personaId) });
        }}
        onDeletePersona={async (personaId) => {
          await deletePersona({ personaId: toPersonaId(personaId) });
          if (!threadId && draftPersonaId === personaId) {
            setDraftPersonaId(undefined);
          }
        }}
      />
    </>
  );
}
