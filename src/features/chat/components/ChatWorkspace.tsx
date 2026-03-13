import { api } from '@convex/_generated/api';
import { useUIMessages } from '@convex-dev/agent/react';
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
import { mapAgentMessagesToChatMessages } from '~/features/chat/lib/agent-messages';
import { toPersonaId, toRunId, toStorageId, toThreadId } from '~/features/chat/lib/ids';
import { clearOptimisticThread, setOptimisticThread } from '~/features/chat/lib/optimistic-threads';
import {
  clearPendingThreadSubmission,
  setPendingThreadSubmission,
  updatePendingThreadSubmission,
  usePendingThreadSubmission,
} from '~/features/chat/lib/pending-thread-submission';
import { useChatStream } from '~/features/chat/hooks/useChatStream';
import type {
  ChatAttachment,
  ChatMessage,
  ChatMessagePart,
  ChatPersona,
} from '~/features/chat/types';
import { deriveThreadTitle, resolveRequestedModelId } from '~/features/chat/lib/utils';
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

function getPartComparisonKey(part: ChatMessagePart) {
  switch (part.type) {
    case 'text':
      return `text:${part.text}`;
    case 'attachment':
      return `attachment:${part.attachmentId}:${part.kind}:${part.name}:${part.promptSummary}`;
    case 'document':
      return `document:${part.name}:${part.mimeType}:${part.content}`;
    case 'file':
      return `file:${part.mediaType}:${part.filename ?? ''}:${part.url}`;
    case 'image':
      return `image:${part.mimeType ?? ''}:${part.name ?? ''}:${part.image}`;
    case 'source-url':
      return `source-url:${part.sourceId}:${part.url}:${part.title ?? ''}`;
    case 'source-document':
      return `source-document:${part.sourceId}:${part.mediaType}:${part.title}:${part.filename ?? ''}`;
    default:
      return 'unknown';
  }
}

function getTextFromMessageParts(parts: ChatMessagePart[]) {
  return parts
    .map((part) => {
      if (part.type === 'text') {
        return part.text;
      }

      return '';
    })
    .join('\n\n')
    .trim();
}

function matchesPendingSubmission(
  message: ChatMessage,
  pendingSubmission: NonNullable<ReturnType<typeof usePendingThreadSubmission>>,
) {
  if (message.role !== 'user') {
    return false;
  }

  if (
    message.clientMessageId &&
    message.clientMessageId === pendingSubmission.clientMessageId
  ) {
    return true;
  }

  if (message.createdAt < pendingSubmission.submittedAt - 5_000) {
    return false;
  }

  if (message.parts.length !== pendingSubmission.parts.length) {
    return false;
  }

  return message.parts.every((part, index) => {
    const pendingPart = pendingSubmission.parts[index];
    return pendingPart ? getPartComparisonKey(part) === getPartComparisonKey(pendingPart) : false;
  });
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
  const [settledScrollBottomLimit, setSettledScrollBottomLimit] = useState<number | null>(null);
  const [threadModelOverrides, setThreadModelOverrides] = useState<
    Partial<Record<string, ChatModelId>>
  >({});
  const messageViewportRef = useRef<HTMLDivElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const scrollTargetMessageRef = useRef<HTMLDivElement | null>(null);
  const scrollRequestThreadIdRef = useRef<string | null>(null);

  const typedThreadId = threadId ? toThreadId(threadId) : undefined;
  const { activeStream, startStream, stopStream, clearStream } = useChatStream(threadId);
  const thread = useQuery(api.agentChat.getThread, typedThreadId ? { threadId: typedThreadId } : 'skip');
  const messageFeed = useUIMessages(
    api.agentChat.listThreadMessages,
    threadId ? { threadId } : 'skip',
    {
      initialNumItems: 100,
      stream: true,
      skipStreamIds: activeStream?.streamId ? [activeStream.streamId] : undefined,
    },
  );
  const activeRun = useQuery(
    api.agentChat.getActiveRun,
    typedThreadId ? { threadId: typedThreadId } : 'skip',
  );
  const retryableRunIds = useQuery(
    api.agentChat.getRetryableRunIds,
    typedThreadId ? { threadId: typedThreadId } : 'skip',
  );
  const personas = useQuery(api.agentChat.listPersonas, {});
  const modelOptions = useQuery(api.chatModels.listAvailableChatModels, {});
  const createChatAttachmentFromUpload = useAction(api.agentChatActions.createChatAttachmentFromUpload);
  const quickCreateThread = useAction(api.agentChatActions.quickCreateThread);
  const stopRun = useAction(api.agentChatActions.stopRun);
  const generateChatAttachmentUploadUrl = useMutation(api.agentChat.generateChatAttachmentUploadUrl);
  const createPersona = useMutation(api.agentChat.createPersona);
  const updatePersona = useMutation(api.agentChat.updatePersona);
  const deletePersona = useMutation(api.agentChat.deletePersona);
  const setThreadPersona = useMutation(api.agentChat.setThreadPersona);
  const pendingSubmission = usePendingThreadSubmission(threadId);
  const [editingMessage, setEditingMessage] = useState<{ messageId: string; text: string } | null>(
    null,
  );
  const [regeneratingTarget, setRegeneratingTarget] = useState<{
    messageId: string;
    hideMessage: boolean;
    originalUpdatedAt: number;
  } | null>(null);
  const [fallbackRetryRunIdByMessageId, setFallbackRetryRunIdByMessageId] = useState<
    Record<string, string>
  >({});
  const [fallbackDraftTextByMessageId, setFallbackDraftTextByMessageId] = useState<
    Record<string, string>
  >({});
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
  const currentMessages: ChatMessage[] = useMemo(
    () => (threadId ? mapAgentMessagesToChatMessages(threadId, messageFeed.results) : []),
    [messageFeed.results, threadId],
  );
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
  const effectiveRetryRunIdByMessageId = useMemo(
    () => ({
      ...fallbackRetryRunIdByMessageId,
      ...(retryableRunIds ?? {}),
    }),
    [fallbackRetryRunIdByMessageId, retryableRunIds],
  );
  const shouldAutoFocusComposer = !threadId;
  const pendingPreview =
    pendingSubmission && threadId
      ? {
          submission: pendingSubmission,
          showUserMessage: !currentMessages.some(
            (message) => matchesPendingSubmission(message, pendingSubmission),
          ),
          showAssistantPlaceholder:
            (!(activeStream?.text ?? '').trim() ||
              pendingSubmission.stage === 'error') &&
            !currentMessages.some(
              (message) =>
                message.role === 'assistant' && message.createdAt >= pendingSubmission.submittedAt,
            ),
        }
      : undefined;
  const showEmptyState =
    currentMessages.length === 0 && !pendingSubmission && !activeStream;
  const isThreadPending = Boolean(
    threadId &&
      !pendingSubmission &&
      (thread === undefined || messageFeed.status === 'LoadingFirstPage'),
  );
  const shouldShowCenteredComposer = !isThreadPending && showEmptyState;
  const composerDisabled = isThreadPending;
  const hasPendingAssistantResponse =
    currentMessages.some(
      (message) => message.role === 'assistant' && message.status === 'streaming',
    ) ||
    activeRun?.status === 'streaming' ||
    activeStream?.status === 'streaming';
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
    if (!thread?.title || !threadId) {
      return;
    }

    clearOptimisticThread(threadId);
  }, [thread?.title, threadId]);

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

    if (regeneratingTarget?.messageId === editingMessage.messageId) {
      return;
    }

    const nextText = optimisticEdits[editingMessage.messageId] ?? matchingMessage.parts[0].text;
    if (nextText !== editingMessage.text) {
      setEditingMessage({ messageId: editingMessage.messageId, text: nextText });
    }
  }, [currentMessages, editingMessage, optimisticEdits, regeneratingTarget]);

  useEffect(() => {
    if (!regeneratingTarget) {
      return;
    }

    const matchingMessage = currentMessages.find(
      (message) => message._id === regeneratingTarget.messageId,
    );
    if (!matchingMessage) {
      return;
    }

    if (matchingMessage.role !== 'assistant') {
      if (!isSending && !hasPendingAssistantResponse) {
        setRegeneratingTarget(null);
      }
      return;
    }

    const persistedText = getTextFromMessageParts(matchingMessage.parts).trim();
    const streamedRetryText =
      fallbackDraftTextByMessageId[regeneratingTarget.messageId]?.trim() ?? '';
    const hasPersistedRetryResult =
      matchingMessage.updatedAt !== regeneratingTarget.originalUpdatedAt &&
      matchingMessage.status === 'complete' &&
      Boolean(persistedText) &&
      (!streamedRetryText || persistedText === streamedRetryText);
    const hasPersistedRetryError =
      matchingMessage.updatedAt !== regeneratingTarget.originalUpdatedAt &&
      matchingMessage.status === 'error';

    if (hasPersistedRetryResult || hasPersistedRetryError) {
      setRegeneratingTarget(null);
    }
  }, [
    currentMessages,
    fallbackDraftTextByMessageId,
    hasPendingAssistantResponse,
    isSending,
    regeneratingTarget,
  ]);

  useEffect(() => {
    if (!activeStream) {
      return;
    }

    if (
      activeStream.runId.startsWith('pending-run:') ||
      activeStream.assistantMessageId.startsWith('pending-assistant:')
    ) {
      return;
    }

    setFallbackRetryRunIdByMessageId((current) =>
      current[activeStream.assistantMessageId] === activeStream.runId
        ? current
        : {
            ...current,
            [activeStream.assistantMessageId]: activeStream.runId,
          },
    );
  }, [activeStream]);

  useEffect(() => {
    setFallbackRetryRunIdByMessageId((current) => {
      if (Object.keys(current).length === 0) {
        return current;
      }

      const visibleAssistantMessageIds = new Set(
        currentMessages
          .filter((message) => message.role === 'assistant')
          .map((message) => message._id),
      );
      let next = current;

      for (const [messageId, runId] of Object.entries(current)) {
        const persistedRunId = retryableRunIds?.[messageId];
        const isActiveStreamMessage = activeStream?.assistantMessageId === messageId;
        const shouldClearFallback =
          persistedRunId === runId ||
          (!visibleAssistantMessageIds.has(messageId) && !isActiveStreamMessage);

        if (!shouldClearFallback) {
          continue;
        }

        if (next === current) {
          next = { ...current };
        }

        delete next[messageId];
      }

      return next;
    });
  }, [activeStream, currentMessages, retryableRunIds]);

  useEffect(() => {
    const streamedText = activeStream?.text.trim();
    if (!activeStream || !streamedText) {
      return;
    }

    setFallbackDraftTextByMessageId((current) =>
      current[activeStream.assistantMessageId] === streamedText
        ? current
        : {
            ...current,
            [activeStream.assistantMessageId]: streamedText,
          },
    );
  }, [activeStream]);

  useEffect(() => {
    setFallbackDraftTextByMessageId((current) => {
      if (Object.keys(current).length === 0) {
        return current;
      }

      let next = current;

      for (const message of currentMessages) {
        if (message.role !== 'assistant') {
          continue;
        }

        const persistedText = getTextFromMessageParts(message.parts).trim();
        const fallbackText = current[message._id]?.trim() ?? '';
        const isRetryTarget = regeneratingTarget?.messageId === message._id;
        const hasRetriedVersion =
          !isRetryTarget || message.updatedAt !== regeneratingTarget.originalUpdatedAt;
        const shouldClearFallback =
          (message.status === 'complete' &&
            Boolean(persistedText) &&
            Boolean(fallbackText) &&
            persistedText === fallbackText &&
            hasRetriedVersion) ||
          (message.status === 'error' && hasRetriedVersion);

        if (!shouldClearFallback) {
          continue;
        }

        if (!(message._id in next)) {
          continue;
        }

        if (next === current) {
          next = { ...current };
        }

        delete next[message._id];
      }

      return next;
    });
  }, [currentMessages, regeneratingTarget]);

  useLayoutEffect(() => {
    if (pendingSubmission || hasPendingAssistantResponse) {
      setSettledScrollBottomLimit(null);
      return;
    }

    if (!scrollAnchorClientMessageId) {
      setSettledScrollBottomLimit(null);
      return;
    }

    if (scrollSpacerHeight > 0) {
      setSettledScrollBottomLimit(messageViewportRef.current?.scrollTop ?? null);
    }

    setScrollAnchorClientMessageId(undefined);
  }, [
    hasPendingAssistantResponse,
    pendingSubmission,
    scrollAnchorClientMessageId,
    scrollSpacerHeight,
  ]);

  useEffect(() => {
    if (!threadId || !pendingSubmission || messageFeed.status === 'LoadingFirstPage') {
      return;
    }

    const hasUserMessage = currentMessages.some(
      (message) =>
        message.role === 'user' && message.clientMessageId === pendingSubmission.clientMessageId,
    );
    const hasAssistantMessage = currentMessages.some(
      (message) =>
        message.role === 'assistant' &&
        message.createdAt >= pendingSubmission.submittedAt &&
        message.status !== 'streaming',
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
  }, [currentMessages, messageFeed.status, pendingSubmission, threadId]);

  useEffect(() => {
    if (
      !threadId ||
      messageFeed.status === 'LoadingFirstPage' ||
      scrollRequestThreadIdRef.current === threadId
    ) {
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
  }, [messageFeed.status, threadId]);

  useEffect(() => {
    if (!threadId || !activeStream || activeStream.threadId !== threadId) {
      return;
    }

    const matchingMessage = currentMessages.find(
      (message) => message._id === activeStream.assistantMessageId,
    );
    if (!matchingMessage) {
      return;
    }

    const finalizedMessageText = getTextFromMessageParts(matchingMessage.parts);
    const streamedText = activeStream.text.trim();
    const hasSynchronizedContent =
      !streamedText || finalizedMessageText === streamedText;

    if (
      activeStream.status === 'complete' &&
      matchingMessage.status === 'complete' &&
      hasSynchronizedContent
    ) {
      clearStream(threadId);
    }
  }, [activeStream, clearStream, currentMessages, threadId]);

  useLayoutEffect(() => {
    if (!pendingScrollTargetVisible) {
      if (settledScrollBottomLimit === null) {
        setScrollSpacerHeight(0);
      }
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
    settledScrollBottomLimit,
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
    setScrollSpacerHeight(0);
    setSettledScrollBottomLimit(null);
    let targetThreadId = threadId;

    try {
      const personaId = thread
        ? thread.personaId
        : draftPersonaId
          ? toPersonaId(draftPersonaId)
          : undefined;

      const submittedAt = Date.now();

      if (!threadId) {
        // New chat: fast-create thread + save message, navigate, then stream
        const created = await quickCreateThread({
          personaId: personaId as never,
          model: effectiveModelId,
          text,
          attachmentIds: attachmentIds as never,
          clientMessageId,
        });
        targetThreadId = created.threadId as string;
        setOptimisticThread({
          _id: toThreadId(targetThreadId),
          title: deriveThreadTitle(parts),
          pinned: false,
          createdAt: submittedAt,
          updatedAt: submittedAt,
          lastMessageAt: submittedAt,
        });
        setPendingThreadSubmission(targetThreadId, {
          clientMessageId,
          modelId: effectiveModelId,
          parts,
          submittedAt,
          stage: 'submitting',
        });
        await navigate({
          to: '/app/chat/$threadId',
          params: { threadId: targetThreadId },
        });
        clear();

        // Fire streaming in the background — no need to await
        const newThreadId = targetThreadId;
        void startStream({
          mode: 'continue',
          threadId: newThreadId,
          promptMessageId: created.promptMessageId,
          personaId: personaId as string | undefined,
          model: effectiveModelId,
          useWebSearch,
        }).catch((error) => {
          updatePendingThreadSubmission(newThreadId, (submission) =>
            submission
              ? {
                  ...submission,
                  stage: 'error',
                  errorMessage:
                    error instanceof Error ? error.message : 'Failed to start AI response.',
                }
              : submission,
          );
        });
      } else {
        // Existing thread: use the original send flow
        const existingThreadId = threadId;
        clear();
        setPendingThreadSubmission(existingThreadId, {
          clientMessageId,
          modelId: effectiveModelId,
          parts,
          submittedAt,
          stage: 'submitting',
        });

        await startStream({
          mode: 'send',
          threadId: existingThreadId,
          personaId: personaId,
          model: effectiveModelId,
          useWebSearch,
          text,
          attachmentIds,
          clientMessageId,
        });
      }
    } catch (error) {
      const failedThreadId = targetThreadId;
      if (failedThreadId) {
        updatePendingThreadSubmission(failedThreadId, (submission) =>
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

  const handleStopActiveRun = async () => {
    const stopped = stopStream(threadId);
    if (stopped || !activeRun?._id) {
      return;
    }

    await stopRun({
      runId: toRunId(activeRun._id),
    });
  };

  const handleRetryRun = async (messageId: string, runId: string) => {
    if (!runId) {
      return;
    }

    const targetMessage = currentMessages.find((message) => message._id === messageId);

    setIsSending(true);
    setFallbackDraftTextByMessageId((current) => {
      if (!(messageId in current)) {
        return current;
      }

      const next = { ...current };
      delete next[messageId];
      return next;
    });
    setRegeneratingTarget({
      messageId,
      hideMessage: true,
      originalUpdatedAt: targetMessage?.updatedAt ?? 0,
    });
    try {
      await startStream({
        mode: 'retry',
        runId,
        model: effectiveModelId,
        useWebSearch,
      });
    } catch (error) {
      setRegeneratingTarget(null);
      showToast(error instanceof Error ? error.message : 'Failed to retry message.', 'error');
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
                  autoFocus={shouldAutoFocusComposer}
                  disabled={composerDisabled}
                  isSending={isSending}
                  canStop={hasPendingAssistantResponse}
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
                  onStop={() => {
                    void handleStopActiveRun();
                  }}
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
                      activeStream={activeStream}
                      retryRunIdByMessageId={effectiveRetryRunIdByMessageId}
                      onRetryMessage={(messageId, runId) => {
                        void handleRetryRun(messageId, runId);
                      }}
                      pendingSubmission={pendingPreview}
                      regeneratingTarget={regeneratingTarget}
                      fallbackDraftTextByMessageId={fallbackDraftTextByMessageId}
                      isRegenerationPending={Boolean(regeneratingTarget)}
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
              <div className="sticky bottom-0 shrink-0 bg-gradient-to-t from-background via-background/95 to-transparent px-4 pb-4 pt-6 md:px-6">
                <div className="mx-auto w-full max-w-5xl">
                  <ChatComposer
                    autoFocus={shouldAutoFocusComposer}
                    disabled={composerDisabled}
                    isSending={isSending}
                    canStop={hasPendingAssistantResponse}
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
                    onStop={() => {
                      void handleStopActiveRun();
                    }}
                    onUploadAttachment={handleUploadAttachment}
                    editingMessage={editingMessage ?? undefined}
                    isSavingEdit={Boolean(regeneratingTarget)}
                    onCancelEdit={() => setEditingMessage(null)}
                    onSubmitEdit={async ({ messageId, text, clear }) => {
                      try {
                        setOptimisticEdits((current) => ({
                          ...current,
                          [messageId]: text,
                        }));
                        setRegeneratingTarget({
                          messageId,
                          hideMessage: false,
                          originalUpdatedAt:
                            currentMessages.find((message) => message._id === messageId)
                              ?.updatedAt ?? 0,
                        });
                        setEditingMessage(null);
                        clear();
                        await startStream({
                          mode: 'edit',
                          messageId,
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
                        setRegeneratingTarget(null);
                        showToast(
                          error instanceof Error ? error.message : 'Failed to edit message.',
                          'error',
                        );
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
