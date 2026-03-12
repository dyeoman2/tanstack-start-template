import { api } from '@convex/_generated/api';
import { useNavigate } from '@tanstack/react-router';
import { useAction, useMutation, useQuery } from 'convex/react';
import { useEffect, useMemo, useState } from 'react';
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

export function ChatWorkspace({ threadId }: { threadId?: string }) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [isSending, setIsSending] = useState(false);
  const [personaDialogOpen, setPersonaDialogOpen] = useState(false);
  const [draftPersonaId, setDraftPersonaId] = useState<string | undefined>(undefined);

  const typedThreadId = threadId ? toThreadId(threadId) : undefined;
  const thread = useQuery(api.chat.getThread, typedThreadId ? { threadId: typedThreadId } : 'skip');
  const messages = useQuery(
    api.chat.listMessages,
    typedThreadId ? { threadId: typedThreadId } : 'skip',
  );
  const personas = useQuery(api.chat.listPersonas, {});
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

  useEffect(() => {
    if (!threadId || !pendingSubmission || !messages) {
      return;
    }

    const hasUserMessage = messages.some(
      (message) =>
        message.role === 'user' && message.clientMessageId === pendingSubmission.clientMessageId,
    );
    const hasAssistantMessage = messages.some(
      (message) => message.role === 'assistant' && message.createdAt >= pendingSubmission.submittedAt,
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

  if ((threadId && thread === undefined) || (threadId && messages === undefined) || personas === undefined) {
    return <div className="min-h-[60vh] animate-pulse rounded-3xl border border-border/60 bg-card/30" />;
  }

  const handleSend = async ({
    parts,
    clear,
  }: {
    parts: ChatMessagePart[];
    clear: () => void;
  }) => {
    const clientMessageId =
      globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setIsSending(true);

    try {
      clear();
      const personaId = thread ? thread.personaId : draftPersonaId ? toPersonaId(draftPersonaId) : undefined;

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
          parts,
          clientMessageId,
        }).catch((error) => {
          updatePendingThreadSubmission(nextThreadId, (submission) =>
            submission
              ? {
                  ...submission,
                  stage: 'error',
                  errorMessage:
                    error instanceof Error ? error.message : 'Failed to send message.',
                }
              : submission,
          );
          showToast(error instanceof Error ? error.message : 'Failed to send message.', 'error');
        });

        return;
      }

      await sendChatMessage({
        threadId: typedThreadId,
        personaId,
        parts,
        clientMessageId,
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to send message.', 'error');
    } finally {
      setIsSending(false);
    }
  };

  const currentMessages = messages ?? [];
  const pendingPreview =
    pendingSubmission && threadId
      ? {
          submission: pendingSubmission,
          showUserMessage: !currentMessages.some(
            (message) =>
              message.role === 'user' && message.clientMessageId === pendingSubmission.clientMessageId,
          ),
          showAssistantPlaceholder: !currentMessages.some(
            (message) =>
              message.role === 'assistant' && message.createdAt >= pendingSubmission.submittedAt,
          ),
        }
      : undefined;
  const showEmptyState = currentMessages.length === 0 && !pendingPreview;

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col">
          {showEmptyState ? (
            <div className="flex min-h-[50vh] flex-1 flex-col items-center justify-center px-4 text-center">
              <h1 className="text-4xl font-medium tracking-tight md:text-5xl">What shall we explore?</h1>
              <p className="mt-4 max-w-lg text-balance font-serif text-lg text-muted-foreground">
                I&apos;m here to help you think, write, and discover.
              </p>
              <div className="mt-8 w-full max-w-3xl">
                <ChatComposer
                  isSending={isSending}
                  personas={personas ?? []}
                  selectedPersonaId={effectivePersonaId}
                  selectedPersonaLabel={currentPersonaLabel}
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
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
                <div className="mx-auto w-full max-w-5xl">
                  <MessageList
                    messages={currentMessages}
                    isStreaming={isSending}
                    pendingSubmission={pendingPreview}
                  />
                </div>
              </div>
              <div className="px-4 py-4 md:px-6">
                <div className="mx-auto w-full max-w-5xl">
                  <ChatComposer
                    isSending={isSending}
                    personas={personas ?? []}
                    selectedPersonaId={effectivePersonaId}
                    selectedPersonaLabel={currentPersonaLabel}
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
              showToast(error instanceof Error ? error.message : 'Failed to update persona.', 'error');
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
