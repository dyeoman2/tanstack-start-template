import { api } from '@convex/_generated/api';
import { useNavigate } from '@tanstack/react-router';
import { useAction, useMutation, useQuery } from 'convex/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import { Button } from '~/components/ui/button';
import { useToast } from '~/components/ui/toast';
import { ChatComposer } from '~/features/chat/components/ChatComposer';
import { MessageList } from '~/features/chat/components/MessageList';
import { PersonaDialog } from '~/features/chat/components/PersonaDialog';
import { inferChatAttachmentMimeType } from '~/features/chat/lib/attachments';
import { CHAT_ROUTE, DEFAULT_CHAT_PERSONA } from '~/features/chat/lib/constants';
import { toPersonaId, toStorageId, toThreadId } from '~/features/chat/lib/ids';
import {
  clearPendingThreadSubmission,
  setPendingThreadSubmission,
  updatePendingThreadSubmission,
  usePendingThreadSubmission,
} from '~/features/chat/lib/pending-thread-submission';
import type { ChatAttachment, ChatMessage, ChatMessagePart, ChatPersona } from '~/features/chat/types';
import { resolveRequestedModelId } from '~/features/chat/lib/utils';
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
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [scrollAnchorClientMessageId, setScrollAnchorClientMessageId] = useState<string>();
  const [scrollSpacerHeight, setScrollSpacerHeight] = useState(0);
  const [settledViewportSpacerHeight, setSettledViewportSpacerHeight] = useState(0);
  const [settledScrollBottomLimit, setSettledScrollBottomLimit] = useState<number | null>(null);
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
  const activeDraft = useQuery(
    api.chat.getActiveAssistantDraft,
    typedThreadId ? { threadId: typedThreadId } : 'skip',
  );
  const personas = useQuery(api.chat.listPersonas, {});
  const modelOptions = useQuery(api.chatModels.listAvailableChatModels, {});
  const sendChatMessage = useAction(api.chatActions.sendChatMessage);
  const editUserMessageAndRegenerate = useAction(api.chatActions.editUserMessageAndRegenerate);
  const createChatAttachmentFromUpload = useAction(api.chatActions.createChatAttachmentFromUpload);
  const generateChatAttachmentUploadUrl = useMutation(api.chat.generateChatAttachmentUploadUrl);
  const createPersona = useMutation(api.chat.createPersona);
  const updatePersona = useMutation(api.chat.updatePersona);
  const deletePersona = useMutation(api.chat.deletePersona);
  const setThreadPersona = useMutation(api.chat.setThreadPersona);
  const pendingSubmission = usePendingThreadSubmission(threadId);
  const [editingMessage, setEditingMessage] = useState<{ messageId: string; text: string } | null>(
    null,
  );
  const [regeneratingMessageId, setRegeneratingMessageId] = useState<string | null>(null);
  const [optimisticEdits, setOptimisticEdits] = useState<Record<string, string>>({});
  const personasList = personas ?? [];
  const availableModelOptions = modelOptions ?? [];

  const effectivePersonaId = thread?.personaId ?? draftPersonaId;
  const currentPersonaLabel = useMemo(() => {
    if (!effectivePersonaId) {
      return DEFAULT_CHAT_PERSONA.name;
    }

    return (
      personasList.find((persona: ChatPersona) => persona._id === effectivePersonaId)?.name ??
      'Persona'
    );
  }, [effectivePersonaId, personasList]);
  const currentMessages: ChatMessage[] = messages ?? [];
  const inferredThreadModelId = useMemo(() => {
    for (let index = currentMessages.length - 1; index >= 0; index -= 1) {
      const message = currentMessages[index];
      if (message.role === 'assistant' && message.model) {
        return message.model;
      }
    }

    return undefined;
  }, [currentMessages]);
  const requestedModelId = resolveRequestedModelId({
    threadId,
    draftModelId,
    threadModelOverride: threadId ? threadModelOverrides[threadId] : undefined,
    threadModelId: thread?.model,
    pendingSubmissionModelId: pendingSubmission?.modelId,
    inferredThreadModelId,
  });
  const selectedModelOption = getChatModelOption(availableModelOptions, requestedModelId);
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
  const hasPendingAssistantResponse = currentMessages.some(
    (message) => message.role === 'assistant' && message.status === 'pending',
  );
  const targetClientMessageId = scrollAnchorClientMessageId ?? pendingSubmission?.clientMessageId;
  const pendingScrollTargetVisible = Boolean(
    targetClientMessageId &&
      (pendingPreview?.showUserMessage ||
        currentMessages.some(
          (message) =>
            message.role === 'user' && message.clientMessageId === targetClientMessageId,
        )),
  );
  const alignPendingMessageToTop = useCallback(() => {
    const viewportNode = messageViewportRef.current;
    const targetNode = scrollTargetMessageRef.current;

    if (!viewportNode || !targetNode) {
      return 0;
    }

    const topOffset = 0;
    const viewportRect = viewportNode.getBoundingClientRect();
    const targetRect = targetNode.getBoundingClientRect();
    const nextTop = viewportNode.scrollTop + (targetRect.top - viewportRect.top) - topOffset;
    const maxScrollTop = viewportNode.scrollHeight - viewportNode.clientHeight;
    const requiredSpacer = Math.max(0, nextTop - maxScrollTop);

    viewportNode.scrollTo({
      top: Math.max(0, nextTop + requiredSpacer),
      behavior: 'auto',
    });

    return requiredSpacer;
  }, []);

  const handleMessageViewportScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (settledScrollBottomLimit === null) {
        return;
      }

      const viewportNode = event.currentTarget;
      if (viewportNode.scrollTop <= settledScrollBottomLimit) {
        return;
      }

      viewportNode.scrollTop = settledScrollBottomLimit;
    },
    [settledScrollBottomLimit],
  );

  useEffect(() => {
    setOptimisticEdits((current) => {
      let changed = false;
      const next = { ...current };

      for (const message of currentMessages) {
        const optimisticText = next[message._id];
        if (
          !optimisticText ||
          message.role !== 'user' ||
          message.parts.length !== 1 ||
          message.parts[0]?.type !== 'text'
        ) {
          continue;
        }

        if (message.parts[0].text === optimisticText) {
          delete next[message._id];
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [currentMessages]);

  useEffect(() => {
    if (!editingMessage) {
      return;
    }

    const matchingMessage = currentMessages.find((message) => message._id === editingMessage.messageId);
    if (!matchingMessage || matchingMessage.role !== 'user') {
      setEditingMessage(null);
      return;
    }

    if (matchingMessage.parts.length !== 1 || matchingMessage.parts[0]?.type !== 'text') {
      setEditingMessage(null);
      return;
    }

    if (regeneratingMessageId === editingMessage.messageId) {
      return;
    }

    const nextText = optimisticEdits[editingMessage.messageId] ?? matchingMessage.parts[0].text;
    if (nextText !== editingMessage.text) {
      setEditingMessage({ messageId: editingMessage.messageId, text: nextText });
    }
  }, [currentMessages, editingMessage, optimisticEdits, regeneratingMessageId]);

  useLayoutEffect(() => {
    if (pendingSubmission || hasPendingAssistantResponse) {
      setSettledScrollBottomLimit(null);
      return;
    }

    if (!scrollAnchorClientMessageId) {
      setSettledScrollBottomLimit(null);
      return;
    }

    if (scrollSpacerHeight <= 0) {
      return;
    }

    setSettledScrollBottomLimit(messageViewportRef.current?.scrollTop ?? null);
    setSettledViewportSpacerHeight((current) => Math.max(current, scrollSpacerHeight));
    setScrollSpacerHeight(0);
  }, [
    hasPendingAssistantResponse,
    pendingSubmission,
    scrollAnchorClientMessageId,
    scrollSpacerHeight,
  ]);

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

  useLayoutEffect(() => {
    if (!pendingScrollTargetVisible) {
      setScrollSpacerHeight(0);
      return;
    }

    let frameId = 0;
    const requiredSpacer = alignPendingMessageToTop();
    setScrollSpacerHeight((current) =>
      pendingSubmission || hasPendingAssistantResponse
        ? Math.abs(current - requiredSpacer) < 1
          ? current
          : requiredSpacer
        : Math.max(current, requiredSpacer),
    );

    frameId = requestAnimationFrame(() => {
      const stabilizedSpacer = alignPendingMessageToTop();
      setScrollSpacerHeight((current) =>
        pendingSubmission || hasPendingAssistantResponse
          ? Math.abs(current - stabilizedSpacer) < 1
            ? current
            : stabilizedSpacer
          : Math.max(current, stabilizedSpacer),
      );
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [
    alignPendingMessageToTop,
    hasPendingAssistantResponse,
    pendingScrollTargetVisible,
    pendingSubmission,
  ]);

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

  const handleSelectModel = (modelId: ChatModelId) => {
    if (threadId) {
      setThreadModelOverrides((previous) => ({
        ...previous,
        [threadId]: modelId,
      }));
      return;
    }

    setDraftModelId(modelId);
  };

  const handleSelectPersona = (personaId?: string) => {
    if (threadId) {
      void setThreadPersona({
        threadId: toThreadId(threadId),
        personaId: personaId ? toPersonaId(personaId) : undefined,
      }).catch((error) => {
        showToast(error instanceof Error ? error.message : 'Failed to update persona.', 'error');
      });
      return;
    }

    setDraftPersonaId(personaId);
  };

  const handleUploadAttachment = async (file: File): Promise<ChatAttachment> => {
    const uploadUrl = await generateChatAttachmentUploadUrl({});
    const mimeType = inferChatAttachmentMimeType(file);
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': mimeType,
      },
      body: file,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Failed to upload ${file.name}.`);
    }

    const uploadPayload: unknown = await uploadResponse.json();
    if (
      !uploadPayload ||
      typeof uploadPayload !== 'object' ||
      !('storageId' in uploadPayload) ||
      typeof uploadPayload.storageId !== 'string'
    ) {
      throw new Error('Upload did not return a storage identifier.');
    }

    const attachment = await createChatAttachmentFromUpload({
      storageId: toStorageId(uploadPayload.storageId),
      name: file.name,
      mimeType,
      sizeBytes: file.size,
    });

    if (!attachment) {
      throw new Error('Attachment processing did not return a result.');
    }

    return attachment;
  };

  const handleSend = async ({
    text,
    attachmentIds,
    parts,
    clear,
  }: {
    text: string;
    attachmentIds: ChatAttachment['_id'][];
    parts: ChatMessagePart[];
    clear: () => void;
  }) => {
    const clientMessageId =
      globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setScrollAnchorClientMessageId(clientMessageId);
    setIsSending(true);
    setSettledViewportSpacerHeight(0);
    setSettledScrollBottomLimit(null);

    try {
      clear();
      const personaId = thread
        ? thread.personaId
        : draftPersonaId
          ? toPersonaId(draftPersonaId)
          : undefined;

      const submittedAt = Date.now();
      if (threadId) {
        setPendingThreadSubmission(threadId, {
          clientMessageId,
          modelId: effectiveModelId,
          parts,
          submittedAt,
          stage: 'submitting',
        });
      }

      const response = await sendChatMessage({
        threadId: typedThreadId,
        personaId,
        model: effectiveModelId,
        useWebSearch,
        text,
        attachmentIds,
        clientMessageId,
      });

      if (!threadId) {
        setPendingThreadSubmission(response.threadId, {
          clientMessageId,
          modelId: effectiveModelId,
          parts,
          submittedAt,
          stage: 'submitting',
        });

        await navigate({
          to: '/app/chat/$threadId',
          params: { threadId: response.threadId },
        });
      }
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
                  modelOptions={availableModelOptions}
                  modelsReady={modelOptions !== undefined}
                  personas={personasList}
                  personasReady={personas !== undefined}
                  selectedModelId={effectiveModelId}
                  useWebSearch={useWebSearch}
                  selectedPersonaId={effectivePersonaId}
                  selectedPersonaLabel={currentPersonaLabel}
                  onSelectModel={handleSelectModel}
                  onSelectPersona={handleSelectPersona}
                  onToggleWebSearch={() => setUseWebSearch((current) => !current)}
                  onManagePersonas={() => setPersonaDialogOpen(true)}
                  onUploadAttachment={handleUploadAttachment}
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
                  onScroll={handleMessageViewportScroll}
                  className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6"
                >
                  <div className="mx-auto w-full max-w-5xl">
                    <MessageList
                      messages={currentMessages}
                      activeDraft={activeDraft ?? null}
                      pendingSubmission={pendingPreview}
                      regeneratingMessageId={regeneratingMessageId}
                      optimisticEdits={optimisticEdits}
                      onStartEditMessage={(message) => {
                        if (
                          message.role !== 'user' ||
                          message.parts.length !== 1 ||
                          message.parts[0]?.type !== 'text'
                        ) {
                          return;
                        }

                        setEditingMessage({
                          messageId: message._id,
                          text: optimisticEdits[message._id] ?? message.parts[0].text,
                        });
                      }}
                      scrollTargetClientMessageId={targetClientMessageId}
                      scrollTargetMessageRef={scrollTargetMessageRef}
                    />
                    <div aria-hidden="true" style={{ height: scrollSpacerHeight }} />
                    <div ref={messageEndRef} aria-hidden="true" />
                  </div>
                </div>
              )}
              {settledViewportSpacerHeight > 0 ? (
                <div
                  aria-hidden="true"
                  className="shrink-0"
                  style={{ height: settledViewportSpacerHeight }}
                />
              ) : null}
              <div className="sticky bottom-0 shrink-0 bg-gradient-to-t from-background via-background/95 to-transparent px-4 pb-4 pt-6 md:px-6">
                <div className="mx-auto w-full max-w-5xl">
                  <ChatComposer
                    disabled={composerDisabled}
                    isSending={isSending}
                    modelOptions={availableModelOptions}
                    modelsReady={modelOptions !== undefined}
                    personas={personasList}
                    personasReady={personas !== undefined}
                    selectedModelId={effectiveModelId}
                    useWebSearch={useWebSearch}
                    selectedPersonaId={effectivePersonaId}
                    selectedPersonaLabel={currentPersonaLabel}
                    onSelectModel={handleSelectModel}
                    onSelectPersona={handleSelectPersona}
                    onToggleWebSearch={() => setUseWebSearch((current) => !current)}
                    onManagePersonas={() => setPersonaDialogOpen(true)}
                    onUploadAttachment={handleUploadAttachment}
                    editingMessage={editingMessage ?? undefined}
                    isSavingEdit={Boolean(regeneratingMessageId)}
                    onCancelEdit={() => setEditingMessage(null)}
                    onSubmitEdit={async ({ messageId, text, clear }) => {
                      try {
                        setOptimisticEdits((current) => ({
                          ...current,
                          [messageId]: text,
                        }));
                        setRegeneratingMessageId(messageId);
                        setEditingMessage(null);
                        clear();
                        await editUserMessageAndRegenerate({
                          messageId: messageId as never,
                          text,
                          model: effectiveModelId,
                          useWebSearch,
                        });
                      } catch (error) {
                        setOptimisticEdits((current) => {
                          const next = { ...current };
                          delete next[messageId];
                          return next;
                        });
                        setEditingMessage({ messageId, text });
                        showToast(
                          error instanceof Error ? error.message : 'Failed to edit message.',
                          'error',
                        );
                      } finally {
                        setRegeneratingMessageId(null);
                      }
                    }}
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
        personas={personasList}
        selectedPersonaId={effectivePersonaId}
        onSelectPersona={handleSelectPersona}
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
