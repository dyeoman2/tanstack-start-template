import { api } from '@convex/_generated/api';
import { useAction } from 'convex/react';
import { Check, Copy, ExternalLink, FileText, Pencil, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { Button } from '~/components/ui/button';
import { useToast } from '~/components/ui/toast';
import { Markdown } from '~/features/chat/components/Markdown';
import { useCopyToClipboard } from '~/features/chat/hooks/useCopyToClipboard';
import type { PendingThreadSubmission } from '~/features/chat/lib/pending-thread-submission';
import type { ChatMessage, ChatMessagePart } from '~/features/chat/types';
import { cn } from '~/lib/utils';

type ChatMessageSource =
  | { type: 'url'; id: string; url: string; title?: string }
  | { type: 'document'; id: string; mediaType: string; title: string; filename?: string };

function getTextFromParts(parts: ChatMessagePart[]) {
  return parts
    .map((part) => {
      if (part.type === 'text') {
        return part.text;
      }

      if (part.type === 'document') {
        return part.content;
      }

      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

function dedupeSources(sources: ChatMessageSource[]) {
  const seen = new Set<string>();
  const deduped: ChatMessageSource[] = [];

  for (const source of sources) {
    const key =
      source.type === 'url'
        ? `url:${source.url}`
        : `document:${source.mediaType}:${source.filename ?? ''}:${source.title}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(source);
  }

  return deduped;
}

function getSourcesFromParts(parts: ChatMessagePart[]) {
  const sources: ChatMessageSource[] = [];

  for (const part of parts) {
    if (part.type === 'source-url') {
      sources.push({
        type: 'url',
        id: part.sourceId,
        url: part.url,
        title: part.title,
      });
    } else if (part.type === 'source-document') {
      sources.push({
        type: 'document',
        id: part.sourceId,
        mediaType: part.mediaType,
        title: part.title,
        filename: part.filename,
      });
    }
  }

  return dedupeSources(sources);
}

function stripTrailingSourceMarkdownLinks(text: string, sources: ChatMessageSource[]) {
  const urlSources = sources.filter((source) => source.type === 'url');
  if (urlSources.length === 0) {
    return text;
  }

  const urls = new Set(urlSources.map((source) => source.url));
  let working = text.trimEnd();
  let strippedCount = 0;

  while (true) {
    const match = working.match(/\[([^\]]+)\]\(([^)]+)\)\s*$/);
    if (!match || !urls.has(match[2])) {
      break;
    }

    strippedCount += 1;
    working = working.slice(0, Math.max(0, working.length - match[0].length)).trimEnd();
  }

  return strippedCount >= 2 ? working : text;
}

function getSourceTitle(source: ChatMessageSource) {
  if (source.type === 'url') {
    return source.title || source.url;
  }

  if (source.filename) {
    return source.title || `Document: ${source.filename}`;
  }

  return source.title || 'Document';
}

function getUserPartKey(part: ChatMessagePart) {
  if (part.type === 'text') {
    return `${part.type}-${part.text}`;
  }

  if (part.type === 'image') {
    return `${part.type}-${part.name ?? 'image'}-${part.image.slice(0, 24)}`;
  }

  if (part.type === 'document') {
    return `${part.type}-${part.name}-${part.content.slice(0, 24)}`;
  }

  if (part.type === 'source-url') {
    return `${part.type}-${part.url}`;
  }

  return `${part.type}-${part.sourceId}`;
}

function Sources({ sources }: { sources: ChatMessageSource[] }) {
  if (sources.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <ExternalLink className="size-4" />
        <span>Sources</span>
      </div>
      <div className="space-y-1.5">
        {sources.map((source, index) => {
          const title = getSourceTitle(source);

          if (source.type === 'url') {
            return (
              <a
                key={source.id}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-2 rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-xs transition-colors hover:bg-accent/40"
              >
                <span className="shrink-0 text-muted-foreground">[{index + 1}]</span>
                <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
                <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
              </a>
            );
          }

          return (
            <div
              key={source.id}
              className="flex items-start gap-2 rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-xs"
            >
              <span className="shrink-0 text-muted-foreground">[{index + 1}]</span>
              <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UserPart({ part }: { part: ChatMessagePart }) {
  if (part.type === 'text') {
    return <span className="whitespace-pre-wrap">{part.text}</span>;
  }

  if (part.type === 'image') {
    return (
      <img
        src={part.image}
        alt={part.name || 'Uploaded image'}
        className="mt-2 max-h-[320px] max-w-full rounded-xl object-contain"
      />
    );
  }

  if (part.type !== 'document') {
    return null;
  }

  return (
    <div className="mt-2 rounded-xl border border-border/60 bg-background/60 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <FileText className="size-4" />
        <span>{part.name}</span>
      </div>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
        {part.content.slice(0, 500)}
        {part.content.length > 500 ? '...' : ''}
      </pre>
    </div>
  );
}

function EditableUserMessage({
  message,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  isEditing,
  isRegenerating,
}: {
  message: ChatMessage;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (text: string) => Promise<void>;
  isEditing: boolean;
  isRegenerating: boolean;
}) {
  const { copy, copied } = useCopyToClipboard();
  const textPart =
    message.parts.length === 1 && message.parts[0]?.type === 'text' ? message.parts[0] : null;
  const [draftText, setDraftText] = useState(textPart?.text ?? '');
  const copyText = useMemo(() => getTextFromParts(message.parts), [message.parts]);

  return (
    <div className="group/message ml-auto flex max-w-[90%] flex-col items-end md:max-w-[80%]">
      <div className="rounded-2xl rounded-br-md bg-primary px-4 py-3 text-primary-foreground shadow-sm">
        {isEditing && textPart ? (
          <textarea
            value={draftText}
            rows={1}
            onChange={(event) => setDraftText(event.target.value)}
            className="min-h-[1.75rem] w-full resize-none bg-transparent text-base leading-relaxed outline-none [field-sizing:content]"
          />
        ) : (
          message.parts.map((part) => (
            <UserPart
              key={
                part.type === 'text'
                  ? `${message._id}-${part.type}-${part.text.slice(0, 24)}`
                  : part.type === 'image'
                    ? `${message._id}-${part.type}-${part.image.slice(0, 24)}`
                    : part.type === 'document'
                      ? `${message._id}-${part.type}-${part.name}-${part.content.slice(0, 24)}`
                      : part.type === 'source-url'
                        ? `${message._id}-${part.type}-${part.url}`
                        : `${message._id}-${part.type}-${part.sourceId}`
              }
              part={part}
            />
          ))
        )}
      </div>
      <div
        className={cn(
          'mt-0.5 flex justify-end gap-1 transition-opacity',
          isEditing ? 'opacity-100' : 'opacity-0 group-hover/message:opacity-100',
        )}
      >
          {isEditing ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full"
                onClick={onCancelEdit}
                disabled={isRegenerating}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full"
                onClick={() => void onSaveEdit(draftText)}
                disabled={isRegenerating}
              >
                {isRegenerating ? 'Saving...' : 'Save'}
              </Button>
            </>
          ) : (
            <>
              <Button
                size="icon-sm"
                variant="ghost"
                className="rounded-full text-muted-foreground"
                onClick={() => {
                  void copy(copyText);
                }}
                aria-label={copied ? 'Copied' : 'Copy message'}
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
              {textPart ? (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="rounded-full text-muted-foreground"
                  onClick={() => {
                    setDraftText(textPart.text);
                    onStartEdit();
                  }}
                  aria-label="Edit message"
                >
                  <Pencil className="size-4" />
                </Button>
              ) : null}
            </>
          )}
      </div>
    </div>
  );
}

function AssistantMessage({ message, thinking }: { message: ChatMessage; thinking?: boolean }) {
  const sources = useMemo(() => getSourcesFromParts(message.parts), [message.parts]);
  const text = useMemo(
    () => stripTrailingSourceMarkdownLinks(getTextFromParts(message.parts), sources),
    [message.parts, sources],
  );
  const { copy, copied } = useCopyToClipboard();
  const [isSpeaking, setIsSpeaking] = useState(false);

  const handleCopy = useCallback(() => {
    void copy(text);
  }, [copy, text]);

  const handleSpeak = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text.trim()) {
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setIsSpeaking(true);
  }, [isSpeaking, text]);

  return (
    <div className="flex justify-start">
      <div className="max-w-[95%] px-1 py-1 md:max-w-[88%]">
        {thinking && !text.trim() ? (
          <span className="text-base font-medium text-muted-foreground">Thinking...</span>
        ) : (
          <Markdown>{text}</Markdown>
        )}
        <div className="mt-1 flex items-center gap-1.5 text-muted-foreground">
          <Button
            size="icon-sm"
            variant="ghost"
            className={cn('rounded-full', copied && 'text-foreground')}
            onClick={handleCopy}
            aria-label={copied ? 'Copied' : 'Copy'}
            disabled={!text.trim()}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            className="rounded-full"
            onClick={handleSpeak}
            aria-label={isSpeaking ? 'Stop speaking' : 'Read aloud'}
            disabled={!text.trim()}
          >
            {isSpeaking ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </Button>
          {sources.length > 0 ? (
            <div className="ml-2 flex items-center gap-2 text-sm font-medium">
              <ExternalLink className="size-4" />
              <span>Sources</span>
            </div>
          ) : null}
        </div>
        <Sources sources={sources} />
        {message.status === 'error' && message.errorMessage ? (
          <p className="mt-3 text-sm text-destructive">{message.errorMessage}</p>
        ) : null}
      </div>
    </div>
  );
}

function StaticUserMessage({ parts }: { parts: ChatMessagePart[] }) {
  return (
    <div className="ml-auto flex max-w-[90%] flex-col items-end md:max-w-[80%]">
      <div className="rounded-2xl rounded-br-md bg-primary px-4 py-3 text-primary-foreground shadow-sm">
        {parts.map((part) => (
          <UserPart key={getUserPartKey(part)} part={part} />
        ))}
      </div>
    </div>
  );
}

function PendingAssistantMessage({
  stage,
  errorMessage,
}: {
  stage: PendingThreadSubmission['stage'];
  errorMessage?: string;
}) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[95%] px-1 py-1 md:max-w-[88%]">
        {stage === 'error' ? (
          <p className="text-sm text-destructive">{errorMessage ?? 'Failed to generate a response.'}</p>
        ) : (
          <span className="text-base font-medium text-muted-foreground">Thinking...</span>
        )}
      </div>
    </div>
  );
}

export function MessageList({
  messages,
  isStreaming,
  pendingSubmission,
  scrollTargetClientMessageId,
  scrollTargetMessageRef,
}: {
  messages: ChatMessage[];
  isStreaming: boolean;
  pendingSubmission?: {
    submission: PendingThreadSubmission;
    showUserMessage: boolean;
    showAssistantPlaceholder: boolean;
  };
  scrollTargetClientMessageId?: string;
  scrollTargetMessageRef?: RefObject<HTMLDivElement | null>;
}) {
  const editUserMessageAndRegenerate = useAction(api.chatActions.editUserMessageAndRegenerate);
  const { showToast } = useToast();
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [regeneratingMessageId, setRegeneratingMessageId] = useState<string | null>(null);
  const [optimisticEdits, setOptimisticEdits] = useState<Record<string, string>>({});
  const lastAssistantId = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant')?._id;
  const optimisticMessages = useMemo(
    () =>
      messages.map((message) => {
        const optimisticText = optimisticEdits[message._id];
        if (
          !optimisticText ||
          message.role !== 'user' ||
          message.parts.length !== 1 ||
          message.parts[0]?.type !== 'text'
        ) {
          return message;
        }

        return {
          ...message,
          parts: [{ type: 'text', text: optimisticText }] as ChatMessagePart[],
        };
      }),
    [messages, optimisticEdits],
  );
  useEffect(() => {
    setOptimisticEdits((current) => {
      let changed = false;
      const next = { ...current };

      for (const message of messages) {
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
  }, [messages]);
  const visibleMessages = useMemo(() => {
    if (!regeneratingMessageId) {
      return optimisticMessages;
    }

    const cutoffIndex = optimisticMessages.findIndex(
      (message) => message._id === regeneratingMessageId,
    );
    if (cutoffIndex === -1) {
      return optimisticMessages;
    }

    return optimisticMessages.slice(0, cutoffIndex + 1);
  }, [optimisticMessages, regeneratingMessageId]);

  return (
    <div className="space-y-4">
      {visibleMessages.map((message) =>
        message.role === 'user' ? (
          <div
            key={message._id}
            ref={
              scrollTargetClientMessageId && message.clientMessageId === scrollTargetClientMessageId
                ? scrollTargetMessageRef
                : undefined
            }
          >
            <EditableUserMessage
              message={message}
              isEditing={editingMessageId === message._id}
              isRegenerating={regeneratingMessageId === message._id}
              onStartEdit={() => setEditingMessageId(message._id)}
              onCancelEdit={() => setEditingMessageId(null)}
              onSaveEdit={async (text) => {
                try {
                  setOptimisticEdits((current) => ({
                    ...current,
                    [message._id]: text,
                  }));
                  setRegeneratingMessageId(message._id);
                  setEditingMessageId(null);
                  await editUserMessageAndRegenerate({
                    messageId: message._id,
                    text,
                  });
                } catch (error) {
                  setOptimisticEdits((current) => {
                    const next = { ...current };
                    delete next[message._id];
                    return next;
                  });
                  showToast(
                    error instanceof Error ? error.message : 'Failed to edit message.',
                    'error',
                  );
                } finally {
                  setRegeneratingMessageId(null);
                }
              }}
            />
          </div>
        ) : (
          <AssistantMessage
            key={message._id}
            message={message}
            thinking={(isStreaming && message._id === lastAssistantId) || false}
          />
        ),
      )}
      {regeneratingMessageId ? (
        <AssistantMessage
          message={{
            _id: 'regenerating' as never,
            threadId: visibleMessages[0]?.threadId as never,
            role: 'assistant',
            parts: [{ type: 'text', text: '' }],
            status: 'pending',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }}
          thinking
        />
      ) : null}
      {pendingSubmission?.showUserMessage ? (
        <div ref={scrollTargetMessageRef}>
          <StaticUserMessage parts={pendingSubmission.submission.parts} />
        </div>
      ) : null}
      {pendingSubmission?.showAssistantPlaceholder ? (
        <PendingAssistantMessage
          stage={pendingSubmission.submission.stage}
          errorMessage={pendingSubmission.submission.errorMessage}
        />
      ) : null}
    </div>
  );
}
