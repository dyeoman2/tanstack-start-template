import { api } from '@convex/_generated/api';
import { useUIMessages } from '@convex-dev/agent/react';
import { useNavigate } from '@tanstack/react-router';
import { useAction, useMutation, useQuery } from 'convex/react';
import { AlertCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '~/components/ui/button';
import { useToast } from '~/components/ui/toast';
import { ChatComposer } from '~/features/chat/components/ChatComposer';
import { MessageList } from '~/features/chat/components/MessageList';
import { PersonaDialog } from '~/features/chat/components/PersonaDialog';
import { mapAgentMessagesToChatMessages } from '~/features/chat/lib/agent-messages';
import { inferChatAttachmentMimeType } from '~/features/chat/lib/attachments';
import { CHAT_ROUTE, DEFAULT_CHAT_PERSONA } from '~/features/chat/lib/constants';
import { toPersonaId, toRunId, toStorageId, toThreadId } from '~/features/chat/lib/ids';
import { optimisticallySendChatMessage } from '~/features/chat/lib/optimistic-send';
import {
  clearOptimisticThread,
  clearOptimisticThreadBootstrap,
  setOptimisticThread,
  setOptimisticThreadBootstrap,
  useOptimisticThreadBootstrap,
} from '~/features/chat/lib/optimistic-threads';
import { deriveThreadTitle, resolveRequestedModelId } from '~/features/chat/lib/utils';
import type {
  ChatAttachment,
  ChatLatestRunState,
  ChatMessage,
  ChatMessagePart,
  ChatPersona,
  ChatRunFailureKind,
} from '~/features/chat/types';
import {
  type ChatModelId,
  chatModelSupportsWebSearch,
  DEFAULT_CHAT_MODEL_ID,
  getChatModelOption,
} from '~/lib/shared/chat-models';

const OWNER_SESSION_STORAGE_KEY = 'chat-owner-session-id';

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

function createOptimisticBootstrapMessages({
  clientMessageId,
  parts,
  text,
  threadId,
}: {
  clientMessageId: string;
  parts: ChatMessagePart[];
  text: string;
  threadId: string;
}): ChatMessage[] {
  const now = Date.now();

  return [
    {
      _id: `optimistic-user-${clientMessageId}`,
      threadId,
      order: 1,
      stepOrder: 0,
      role: 'user',
      parts,
      status: 'complete',
      createdAt: now,
      updatedAt: now,
      clientMessageId,
    },
    {
      _id: `optimistic-assistant-${clientMessageId}`,
      threadId,
      order: 2,
      stepOrder: 0,
      role: 'assistant',
      parts: [{ type: 'text', text: '' }],
      status: 'pending',
      createdAt: now + 1,
      updatedAt: now + 1,
      metadata: { promptText: text },
    },
  ];
}

function getRunFailureCopy(failureKind: ChatRunFailureKind | undefined, errorMessage?: string) {
  switch (failureKind) {
    case 'provider_policy':
      return {
        title: 'No compatible private endpoint is available for this model.',
        detail:
          errorMessage ??
          'The current OpenRouter privacy mode blocks all compatible endpoints for this request.',
      };
    case 'provider_unavailable':
      return {
        title: 'No compatible endpoint is currently available.',
        detail:
          errorMessage ??
          'The selected model is temporarily unavailable through the configured provider.',
      };
    default:
      return {
        title: 'The assistant response failed.',
        detail: errorMessage ?? 'The request did not complete successfully.',
      };
  }
}

function RunErrorBanner({
  runState,
  onRetry,
  onDismiss,
}: {
  runState: ChatLatestRunState;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const copy = getRunFailureCopy(runState.failureKind, runState.errorMessage);

  return (
    <div className="mb-5 rounded-2xl border border-destructive/25 bg-destructive/5 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="text-sm font-medium text-foreground">{copy.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{copy.detail}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry response
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ChatWorkspace({ threadId }: { threadId?: string }) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const ownerSessionId = useMemo(() => getOwnerSessionId(), []);
  const [isSending, setIsSending] = useState(false);
  const [personaDialogOpen, setPersonaDialogOpen] = useState(false);
  const [draftPersonaId, setDraftPersonaId] = useState<string | undefined>(undefined);
  const [draftModelId, setDraftModelId] = useState<ChatModelId>(DEFAULT_CHAT_MODEL_ID);
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [threadModelOverrides, setThreadModelOverrides] = useState<
    Partial<Record<string, ChatModelId>>
  >({});
  const [editingMessage, setEditingMessage] = useState<{ messageId: string; text: string } | null>(
    null,
  );
  const [isStoppingRun, setIsStoppingRun] = useState(false);
  const [regeneratingTarget, setRegeneratingTarget] = useState<{
    messageId: string;
    hideMessage: boolean;
    originalUpdatedAt: number;
  } | null>(null);
  const [optimisticEdits, setOptimisticEdits] = useState<Record<string, string>>({});
  const [pendingAssistantPlaceholder, setPendingAssistantPlaceholder] = useState<{
    threadId: string;
    clientMessageId: string;
  } | null>(null);
  const [scrollAnchorClientMessageId, setScrollAnchorClientMessageId] = useState<string>();
  const [dismissedRunErrorKey, setDismissedRunErrorKey] = useState<string | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const scrollTargetMessageRef = useRef<HTMLDivElement | null>(null);
  const optimisticPartsByClientMessageIdRef = useRef<Record<string, ChatMessagePart[]>>({});

  const typedThreadId = threadId ? toThreadId(threadId) : undefined;
  const optimisticThreadBootstrap = useOptimisticThreadBootstrap(threadId);
  const thread = useQuery(
    api.agentChat.getThread,
    typedThreadId ? { threadId: typedThreadId } : 'skip',
  );
  const messageFeed = useUIMessages(
    api.agentChat.listThreadMessages,
    threadId ? { threadId } : 'skip',
    {
      initialNumItems: 100,
      stream: true,
    },
  );
  const latestRunState = useQuery(
    api.agentChat.getLatestRunState,
    typedThreadId ? { threadId: typedThreadId } : 'skip',
  );
  const retryableRunIds = useQuery(
    api.agentChat.getRetryableRunIds,
    typedThreadId ? { threadId: typedThreadId } : 'skip',
  );
  const personas = useQuery(api.agentChat.listPersonas, {});
  const modelOptions = useQuery(api.chatModels.listAvailableChatModels, {});
  const createChatAttachmentFromUpload = useAction(
    api.agentChatActions.createChatAttachmentFromUpload,
  );
  const stopRun = useAction(api.agentChatActions.stopRun);
  const generateChatAttachmentUploadUrl = useMutation(
    api.agentChat.generateChatAttachmentUploadUrl,
  );
  const precreateThread = useMutation(api.agentChat.precreateThread);
  const sendMessage = useMutation(api.agentChat.sendMessage).withOptimisticUpdate((store, args) => {
    if (!args.clientMessageId) {
      return;
    }

    const parts = optimisticPartsByClientMessageIdRef.current[args.clientMessageId];
    if (!parts) {
      return;
    }

    optimisticallySendChatMessage(store, {
      threadId: args.threadId,
      text: args.text,
      parts,
      clientMessageId: args.clientMessageId,
    });
  });
  const editUserMessage = useMutation(api.agentChat.editUserMessage);
  const retryAssistantResponse = useMutation(api.agentChat.retryAssistantResponse);
  const createPersona = useMutation(api.agentChat.createPersona);
  const updatePersona = useMutation(api.agentChat.updatePersona);
  const deletePersona = useMutation(api.agentChat.deletePersona);
  const setThreadPersona = useMutation(api.agentChat.setThreadPersona);
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
  const displayedMessages = useMemo(() => {
    const bootstrapMessages = optimisticThreadBootstrap?.messages ?? [];

    if (currentMessages.length === 0) {
      return bootstrapMessages;
    }

    const bootstrapAssistantMessage = bootstrapMessages.find(
      (message) => message.role === 'assistant',
    );
    const hasAssistantMessage = currentMessages.some((message) => message.role === 'assistant');

    const baseMessages =
      !bootstrapAssistantMessage || hasAssistantMessage
        ? currentMessages
        : [...currentMessages, bootstrapAssistantMessage];

    if (!threadId || pendingAssistantPlaceholder?.threadId !== threadId) {
      return baseMessages;
    }

    const hasPendingAssistant = baseMessages.some(
      (message) =>
        message.role === 'assistant' &&
        (message.status === 'pending' || message.status === 'streaming'),
    );
    if (hasPendingAssistant) {
      return baseMessages;
    }

    const targetIndex = baseMessages.findIndex(
      (message) =>
        message.role === 'user' &&
        message.clientMessageId === pendingAssistantPlaceholder.clientMessageId,
    );
    const anchorMessage = targetIndex === -1 ? baseMessages.at(-1) : baseMessages[targetIndex];
    if (!anchorMessage) {
      return baseMessages;
    }

    const hasAssistantAfterTarget =
      targetIndex === -1
        ? false
        : baseMessages.slice(targetIndex + 1).some((message) => message.role === 'assistant');
    if (hasAssistantAfterTarget) {
      return baseMessages;
    }

    const placeholder: ChatMessage = {
      _id: `pending-assistant-${pendingAssistantPlaceholder.clientMessageId}`,
      threadId,
      order: anchorMessage.order + 1,
      stepOrder: 0,
      role: 'assistant',
      parts: [{ type: 'text', text: '' }],
      status: 'pending',
      createdAt: anchorMessage.updatedAt + 1,
      updatedAt: anchorMessage.updatedAt + 1,
    };

    if (targetIndex === -1) {
      return [...baseMessages, placeholder];
    }

    return [
      ...baseMessages.slice(0, targetIndex + 1),
      placeholder,
      ...baseMessages.slice(targetIndex + 1),
    ];
  }, [currentMessages, optimisticThreadBootstrap, pendingAssistantPlaceholder, threadId]);
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
    inferredThreadModelId,
  });
  const selectedModelOption = getChatModelOption(availableModelOptions, requestedModelId);
  const selectedModelSupportsWebSearch = chatModelSupportsWebSearch(selectedModelOption);
  const effectiveModelId = selectedModelOption.selectable
    ? selectedModelOption.id
    : DEFAULT_CHAT_MODEL_ID;
  const shouldAutoFocusComposer = !threadId;
  const showEmptyState = displayedMessages.length === 0 && !latestRunState;
  const hasThreadActivity = displayedMessages.length > 0 || Boolean(latestRunState);
  const isThreadPending = Boolean(
    threadId &&
      !hasThreadActivity &&
      (thread === undefined || messageFeed.status === 'LoadingFirstPage'),
  );
  const shouldShowCenteredComposer = !isThreadPending && showEmptyState;
  const composerDisabled =
    isThreadPending || (latestRunState?.status === 'streaming' && latestRunState.canStop === false);
  const canStopGeneration =
    latestRunState?.status === 'streaming' && latestRunState.canStop !== false;
  const latestRunErrorKey =
    threadId && latestRunState ? `${threadId}:${latestRunState.runId}` : null;
  const promptMessageOrder =
    latestRunState?.promptMessageId !== undefined
      ? currentMessages.find((message) => message._id === latestRunState.promptMessageId)?.order
      : undefined;
  const hasRenderedAssistantErrorForLatestRun =
    promptMessageOrder !== undefined &&
    currentMessages.some(
      (message) =>
        message.role === 'assistant' &&
        message.order > promptMessageOrder &&
        message.status === 'error' &&
        Boolean(message.errorMessage),
    );
  const shouldShowRunErrorBanner = Boolean(
    latestRunState &&
      latestRunState.status === 'error' &&
      latestRunState.runId &&
      latestRunErrorKey !== dismissedRunErrorKey &&
      !hasRenderedAssistantErrorForLatestRun,
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
    if (!threadId) {
      return;
    }

    if (
      thread !== null &&
      !currentMessages.some((message) => message.role === 'assistant') &&
      latestRunState?.status !== 'error'
    ) {
      return;
    }

    clearOptimisticThreadBootstrap(threadId);
  }, [currentMessages, latestRunState?.status, thread, threadId]);

  useEffect(() => {
    if (!pendingAssistantPlaceholder || pendingAssistantPlaceholder.threadId !== threadId) {
      return;
    }

    const targetIndex = currentMessages.findIndex(
      (message) =>
        message.role === 'user' &&
        message.clientMessageId === pendingAssistantPlaceholder.clientMessageId,
    );
    if (targetIndex === -1) {
      if (latestRunState?.status === 'error') {
        setPendingAssistantPlaceholder(null);
      }
      return;
    }

    const assistantAfterTarget = currentMessages
      .slice(targetIndex + 1)
      .find((message) => message.role === 'assistant');
    const hasCommittedAssistantAfterTarget =
      Boolean(assistantAfterTarget) && assistantAfterTarget?.status !== 'pending';

    if (hasCommittedAssistantAfterTarget || latestRunState?.status === 'error') {
      setPendingAssistantPlaceholder(null);
    }
  }, [currentMessages, latestRunState?.status, pendingAssistantPlaceholder, threadId]);

  useEffect(() => {
    if (selectedModelSupportsWebSearch || !useWebSearch) {
      return;
    }

    setUseWebSearch(false);
  }, [selectedModelSupportsWebSearch, useWebSearch]);

  useEffect(() => {
    if (latestRunState?.status === 'streaming') {
      return;
    }

    setIsStoppingRun(false);
  }, [latestRunState?.status]);

  useEffect(() => {
    if (!latestRunErrorKey) {
      setDismissedRunErrorKey(null);
      return;
    }

    if (dismissedRunErrorKey && dismissedRunErrorKey !== latestRunErrorKey) {
      setDismissedRunErrorKey(null);
    }
  }, [dismissedRunErrorKey, latestRunErrorKey]);

  useEffect(() => {
    if (!editingMessage) {
      return;
    }

    const matchingMessage = currentMessages.find(
      (message) => message._id === editingMessage.messageId,
    );
    if (!matchingMessage || matchingMessage.role !== 'user') {
      setEditingMessage(null);
      return;
    }

    if (matchingMessage.parts.length !== 1 || matchingMessage.parts[0]?.type !== 'text') {
      setEditingMessage(null);
      return;
    }

    const nextText = optimisticEdits[editingMessage.messageId] ?? matchingMessage.parts[0].text;
    if (nextText !== editingMessage.text) {
      setEditingMessage({ messageId: editingMessage.messageId, text: nextText });
    }
  }, [currentMessages, editingMessage, optimisticEdits]);

  useEffect(() => {
    if (!regeneratingTarget) {
      return;
    }

    const targetIndex = currentMessages.findIndex(
      (message) => message._id === regeneratingTarget.messageId,
    );
    if (targetIndex === -1) {
      setRegeneratingTarget(null);
      return;
    }

    const replacementAssistant = currentMessages
      .slice(targetIndex + 1)
      .find((message) => message.role === 'assistant' && message.status !== 'streaming');
    const matchingMessage = currentMessages[targetIndex];
    const hasReplacement =
      Boolean(replacementAssistant) ||
      (matchingMessage.role === 'assistant' &&
        matchingMessage.updatedAt !== regeneratingTarget.originalUpdatedAt &&
        matchingMessage.status !== 'streaming');

    if (hasReplacement) {
      setRegeneratingTarget(null);
    }
  }, [currentMessages, regeneratingTarget]);

  useEffect(() => {
    if (!threadId || messageFeed.status === 'LoadingFirstPage') {
      return;
    }

    requestAnimationFrame(() => {
      messageEndRef.current?.scrollIntoView({ block: 'end' });
    });
  }, [messageFeed.status, threadId]);

  useEffect(() => {
    if (!scrollAnchorClientMessageId || !scrollTargetMessageRef.current) {
      return;
    }

    requestAnimationFrame(() => {
      scrollTargetMessageRef.current?.scrollIntoView({ block: 'start' });
    });
  }, [scrollAnchorClientMessageId]);

  if (threadId && thread === null) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center rounded-3xl border border-dashed border-border/70 bg-card/40 px-6 text-center">
        <h2 className="text-2xl font-medium tracking-tight">Thread not found</h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          This conversation does not exist, is not visible to you, or it was deleted.
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

  const handleToggleWebSearch = () => {
    if (!selectedModelSupportsWebSearch) {
      return;
    }

    setUseWebSearch((current) => !current);
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
    const uploadUrlWithToken = await generateChatAttachmentUploadUrl({});
    const uploadUrl = new URL(uploadUrlWithToken);
    const fragmentParams = new URLSearchParams(
      uploadUrl.hash.startsWith('#') ? uploadUrl.hash.slice(1) : uploadUrl.hash,
    );
    const uploadToken = fragmentParams.get('chat-upload-token');

    if (!uploadToken) {
      throw new Error('Upload token was not issued for this attachment.');
    }

    uploadUrl.hash = '';
    const mimeType = inferChatAttachmentMimeType(file);
    const uploadResponse = await fetch(uploadUrl.toString(), {
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
      uploadToken,
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
    const personaId = thread
      ? thread.personaId
      : draftPersonaId
        ? toPersonaId(draftPersonaId)
        : undefined;
    let targetThreadId = threadId;

    optimisticPartsByClientMessageIdRef.current[clientMessageId] = parts;
    setScrollAnchorClientMessageId(clientMessageId);
    setIsSending(true);

    try {
      let navigatePromise: Promise<void> | null = null;

      if (!threadId) {
        const created = await precreateThread({
          text,
          attachmentIds,
          personaId,
          model: effectiveModelId,
        });
        const createdThreadId = created.threadId;
        targetThreadId = createdThreadId;
        setOptimisticThread({
          _id: toThreadId(createdThreadId),
          title: deriveThreadTitle(parts),
          pinned: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastMessageAt: Date.now(),
          canManage: true,
        });
        setOptimisticThreadBootstrap(createdThreadId, {
          messages: createOptimisticBootstrapMessages({
            clientMessageId,
            parts,
            text,
            threadId: createdThreadId,
          }),
        });
        setPendingAssistantPlaceholder({
          threadId: createdThreadId,
          clientMessageId,
        });
        navigatePromise = navigate({
          to: '/app/chat/$threadId',
          params: { threadId: createdThreadId },
        });
      } else if (targetThreadId) {
        setPendingAssistantPlaceholder({
          threadId: targetThreadId,
          clientMessageId,
        });
      }

      if (!targetThreadId) {
        throw new Error('Failed to resolve chat thread.');
      }

      clear();
      const sendPromise = sendMessage({
        threadId: toThreadId(targetThreadId),
        text,
        attachmentIds,
        clientMessageId,
        ownerSessionId,
        personaId,
        model: effectiveModelId,
        useWebSearch,
      });

      await Promise.all([sendPromise, navigatePromise]);
    } catch (error) {
      setPendingAssistantPlaceholder((current) =>
        current?.clientMessageId === clientMessageId ? null : current,
      );
      if (!threadId && targetThreadId) {
        clearOptimisticThreadBootstrap(targetThreadId);
      }
      showToast(error instanceof Error ? error.message : 'Failed to send message.', 'error');
    } finally {
      delete optimisticPartsByClientMessageIdRef.current[clientMessageId];
      setIsSending(false);
    }
  };

  const handleStopActiveRun = async () => {
    if (!typedThreadId || !canStopGeneration || isStoppingRun) {
      return;
    }

    setIsStoppingRun(true);

    try {
      await stopRun({
        threadId: typedThreadId,
      });
    } catch (error) {
      setIsStoppingRun(false);
      showToast(error instanceof Error ? error.message : 'Failed to stop generation.', 'error');
    }
  };

  const handleRetryRun = async (messageId: string | undefined, runId: string) => {
    if (!runId) {
      return;
    }

    const targetMessage = messageId
      ? currentMessages.find((message) => message._id === messageId)
      : undefined;
    setIsSending(true);
    if (messageId) {
      setRegeneratingTarget({
        messageId,
        hideMessage: true,
        originalUpdatedAt: targetMessage?.updatedAt ?? 0,
      });
    }

    try {
      await retryAssistantResponse({
        runId: toRunId(runId),
        ownerSessionId,
        model: effectiveModelId,
        useWebSearch,
      });
    } catch (error) {
      if (messageId) {
        setRegeneratingTarget(null);
      }
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
                  canStop={canStopGeneration}
                  isStopping={isStoppingRun}
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
                  onToggleWebSearch={handleToggleWebSearch}
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
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
                  <div className="mx-auto w-full max-w-5xl">
                    {shouldShowRunErrorBanner && latestRunState ? (
                      <RunErrorBanner
                        runState={latestRunState}
                        onRetry={() => {
                          void handleRetryRun(latestRunState.promptMessageId, latestRunState.runId);
                        }}
                        onDismiss={() => {
                          setDismissedRunErrorKey(latestRunErrorKey);
                        }}
                      />
                    ) : null}
                    <MessageList
                      messages={displayedMessages}
                      retryRunIdByMessageId={retryableRunIds ?? {}}
                      onRetryMessage={(messageId, runId) => {
                        void handleRetryRun(messageId, runId);
                      }}
                      regeneratingTarget={regeneratingTarget}
                      optimisticEdits={optimisticEdits}
                      onStartEditMessage={(message) => {
                        if (
                          !message.canEdit ||
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
                      scrollTargetClientMessageId={scrollAnchorClientMessageId}
                      scrollTargetMessageRef={scrollTargetMessageRef}
                    />
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
                    canStop={canStopGeneration}
                    isStopping={isStoppingRun}
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
                    onToggleWebSearch={handleToggleWebSearch}
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
                        await editUserMessage({
                          messageId,
                          text,
                          ownerSessionId,
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
          if (effectivePersonaId === personaId) {
            handleSelectPersona(undefined);
          }
        }}
      />
    </>
  );
}
