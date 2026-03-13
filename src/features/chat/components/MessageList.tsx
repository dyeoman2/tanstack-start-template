import {
  Check,
  Copy,
  ExternalLink,
  FileText,
  Pencil,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { memo, useCallback, useMemo, useState, type RefObject } from 'react';
import { Button } from '~/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { Markdown } from '~/features/chat/components/Markdown';
import { useCopyToClipboard } from '~/features/chat/hooks/useCopyToClipboard';
import { useSmoothStreamText } from '~/features/chat/hooks/useSmoothStreamText';
import type {
  ChatMessage,
  ChatMessagePart,
} from '~/features/chat/types';
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

      if (part.type === 'attachment') {
        return part.kind === 'document' ? part.promptSummary : part.name;
      }

      if (part.type === 'document') {
        return part.content;
      }

      if (part.type === 'file') {
        return part.filename ?? 'Attachment';
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

function getSourceHostname(source: ChatMessageSource) {
  if (source.type !== 'url') {
    return 'Document';
  }

  try {
    return new URL(source.url).hostname.replace(/^www\./, '');
  } catch {
    return source.url;
  }
}

function getSourceInitial(source: ChatMessageSource) {
  const label = getSourceHostname(source);
  const match = label.match(/[A-Za-z0-9]/);

  return match?.[0]?.toUpperCase() ?? 'S';
}

function getSourceFaviconUrl(source: ChatMessageSource) {
  if (source.type !== 'url') {
    return null;
  }

  try {
    const url = new URL(source.url);
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=64`;
  } catch {
    return null;
  }
}

function SourceAvatar({ source, className }: { source: ChatMessageSource; className?: string }) {
  const [showFallback, setShowFallback] = useState(source.type !== 'url');
  const faviconUrl = getSourceFaviconUrl(source);

  return (
    <span
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/70 bg-muted text-[10px] font-semibold text-foreground',
        className,
      )}
    >
      {!showFallback && faviconUrl ? (
        <img
          src={faviconUrl}
          alt=""
          className="size-full object-cover"
          onError={() => setShowFallback(true)}
        />
      ) : null}
      {showFallback ? <span>{getSourceInitial(source)}</span> : null}
    </span>
  );
}

function getUserPartKey(part: ChatMessagePart) {
  if (part.type === 'text') {
    return `${part.type}-${part.text}`;
  }

  if (part.type === 'file') {
    return `${part.type}-${part.filename ?? 'file'}-${part.url}`;
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

  if (part.type === 'source-document') {
    return `${part.type}-${part.sourceId}`;
  }

  return `${part.type}-${part.attachmentId}`;
}

function Sources({ sources }: { sources: ChatMessageSource[] }) {
  if (sources.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 rounded-full px-2.5 text-muted-foreground hover:text-foreground"
        >
          <span className="flex items-center">
            {sources.slice(0, 4).map((source, index) => (
              <SourceAvatar
                key={source.id}
                source={source}
                className={cn(
                  'size-5 shadow-xs',
                  index > 0 ? '-ml-1.5 ring-2 ring-background' : '',
                )}
              />
            ))}
          </span>
          <span>Sources</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="w-[min(32rem,calc(100vw-2rem))] rounded-3xl p-0"
      >
        <div className="border-b border-border/60 px-5 py-4">
          <p className="text-lg font-semibold">Sources</p>
        </div>
        <div className="max-h-[min(28rem,60vh)] overflow-y-auto px-5 py-2">
          {sources.map((source, index) => {
            const title = getSourceTitle(source);
            const hostname = getSourceHostname(source);

            if (source.type === 'url') {
              return (
                <a
                  key={source.id}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 border-b border-border/60 py-4 last:border-b-0 hover:bg-accent/20"
                >
                  <SourceAvatar source={source} className="mt-0.5 size-10 text-sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-muted-foreground">{hostname}</p>
                    <p className="mt-1 text-base font-semibold leading-snug">{title}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
                    <span className="hidden sm:inline">[{index + 1}]</span>
                    <ExternalLink className="size-4" />
                  </div>
                </a>
              );
            }

            return (
              <div
                key={source.id}
                className="flex items-start gap-3 border-b border-border/60 py-4 last:border-b-0"
              >
                <SourceAvatar source={source} className="mt-0.5 size-10 text-sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-muted-foreground">{hostname}</p>
                  <p className="mt-1 text-base font-semibold leading-snug">{title}</p>
                </div>
                <span className="shrink-0 text-sm text-muted-foreground">[{index + 1}]</span>
              </div>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserPart({ part }: { part: ChatMessagePart }) {
  if (part.type === 'text') {
    return <span className="whitespace-pre-wrap">{part.text}</span>;
  }

  if (part.type === 'file') {
    const isImage = part.mediaType.startsWith('image/');
    if (isImage) {
      return (
        <img
          src={part.url}
          alt={part.filename || 'Uploaded image'}
          className="mt-2 max-h-[320px] max-w-full rounded-xl object-contain"
        />
      );
    }

    return (
      <a
        href={part.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 flex items-center gap-2 rounded-xl border border-border/60 bg-background/60 p-3 text-sm"
      >
        <FileText className="size-4" />
        <span>{part.filename ?? 'Attachment'}</span>
        <ExternalLink className="ml-auto size-4" />
      </a>
    );
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

  if (part.type === 'attachment') {
    if (part.kind === 'image' && part.previewUrl) {
      return (
        <div className="mt-2">
          <img
            src={part.previewUrl}
            alt={part.name || 'Uploaded image'}
            className="max-h-[320px] max-w-full rounded-xl object-contain"
          />
          {part.status !== 'ready' ? (
            <p className="mt-2 text-xs text-primary-foreground/80">
              {part.status === 'error'
                ? part.errorMessage ?? 'Attachment failed.'
                : 'Uploading attachment...'}
            </p>
          ) : null}
        </div>
      );
    }

    return (
      <div className="mt-2 rounded-xl border border-border/60 bg-background/60 p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <FileText className="size-4" />
          <span>{part.name}</span>
        </div>
        <p className="whitespace-pre-wrap text-xs text-muted-foreground">
          {part.promptSummary}
        </p>
        {part.status !== 'ready' ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {part.status === 'error'
              ? part.errorMessage ?? 'Attachment failed.'
              : 'Attachment is still processing.'}
          </p>
        ) : null}
      </div>
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
  showActions = true,
}: {
  message: ChatMessage;
  onStartEdit: () => void;
  showActions?: boolean;
}) {
  const { copy, copied } = useCopyToClipboard();
  const textPart =
    message.parts.length === 1 && message.parts[0]?.type === 'text' ? message.parts[0] : null;
  const copyText = useMemo(() => getTextFromParts(message.parts), [message.parts]);

  return (
    <div className="group/message ml-auto flex max-w-[90%] flex-col items-end md:max-w-[80%]">
      <div className="rounded-2xl rounded-br-md bg-primary px-4 py-3 text-primary-foreground shadow-sm">
        {message.parts.map((part) => (
          <UserPart key={`${message._id}-${getUserPartKey(part)}`} part={part} />
        ))}
      </div>
      <div
        className={cn(
          'mt-0.5 flex justify-end gap-1 transition-opacity',
          showActions ? 'opacity-0 group-hover/message:opacity-100' : 'opacity-0',
        )}
      >
        <Button
          size="icon-sm"
          variant="ghost"
          className="rounded-full text-muted-foreground"
          onClick={() => {
            void copy(copyText);
          }}
          aria-label={copied ? 'Copied' : 'Copy message'}
          tabIndex={showActions ? 0 : -1}
          disabled={!showActions}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
        {textPart ? (
          <Button
            size="icon-sm"
            variant="ghost"
            className="rounded-full text-muted-foreground"
            onClick={onStartEdit}
            aria-label="Edit message"
            tabIndex={showActions ? 0 : -1}
            disabled={!showActions}
          >
            <Pencil className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function AssistantMessage({
  message,
  draftText,
  thinking,
  retryRunId,
  onRetry,
}: {
  message: ChatMessage;
  draftText?: string;
  thinking?: boolean;
  retryRunId?: string;
  onRetry?: (messageId: string, runId: string) => void;
}) {
  const sources = useMemo(() => getSourcesFromParts(message.parts), [message.parts]);
  const rawText = draftText ?? getTextFromParts(message.parts);
  const streaming = message.status === 'pending' || message.status === 'streaming';
  const activelyStreaming = streaming && Boolean(draftText);
  const settling = !streaming && Boolean(draftText);
  const showAsStreaming = streaming || settling;
  const smoothedText = useSmoothStreamText(rawText, activelyStreaming);
  const displayText =
    thinking && !rawText.trim()
      ? ''
      : activelyStreaming && !smoothedText && rawText
        ? rawText
        : smoothedText;
  const finalText = useMemo(
    () => (showAsStreaming ? displayText : stripTrailingSourceMarkdownLinks(displayText, sources)),
    [displayText, sources, showAsStreaming],
  );
  const showActions = !showAsStreaming;
  const canRetry = Boolean(retryRunId && !streaming);
  const { copy, copied } = useCopyToClipboard();
  const [isSpeaking, setIsSpeaking] = useState(false);

  const handleCopy = useCallback(() => {
    void copy(finalText);
  }, [copy, finalText]);

  const handleSpeak = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !finalText.trim()) {
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(finalText);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setIsSpeaking(true);
  }, [finalText, isSpeaking]);

  return (
    <div className="flex justify-start">
      <div className="max-w-[95%] px-1 py-1 md:max-w-[88%]">
        {thinking && !finalText.trim() ? (
          <span className="chat-thinking-label text-base font-medium text-muted-foreground">
            Thinking...
          </span>
        ) : showAsStreaming ? (
          <div className="whitespace-pre-wrap text-base leading-relaxed text-foreground">
            {finalText}
          </div>
        ) : (
          <Markdown>{finalText}</Markdown>
        )}
        <div
          className={cn(
            'mt-1 flex min-h-8 items-center gap-1.5 text-muted-foreground',
            !showActions && 'pointer-events-none invisible',
          )}
          aria-hidden={!showActions}
        >
          <Button
            size="icon-sm"
            variant="ghost"
            className={cn('rounded-full', copied && 'text-foreground')}
            onClick={handleCopy}
            aria-label={copied ? 'Copied' : 'Copy'}
            disabled={!finalText.trim()}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </Button>
          {canRetry ? (
            <Button
              size="icon-sm"
              variant="ghost"
              className="rounded-full"
              onClick={() => {
                if (retryRunId) {
                  onRetry?.(message._id, retryRunId);
                }
              }}
              aria-label="Retry response"
            >
              <RotateCcw className="size-4" />
            </Button>
          ) : null}
          <Button
            size="icon-sm"
            variant="ghost"
            className="rounded-full"
            onClick={handleSpeak}
            aria-label={isSpeaking ? 'Stop speaking' : 'Read aloud'}
            disabled={!finalText.trim()}
          >
            {isSpeaking ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </Button>
          {sources.length > 0 ? <Sources sources={sources} /> : null}
        </div>
        {message.status === 'error' && message.errorMessage ? (
          <p className="mt-3 text-sm text-destructive">{message.errorMessage}</p>
        ) : null}
      </div>
    </div>
  );
}

const MemoAssistantMessage = memo(
  AssistantMessage,
  (previous, next) =>
    previous.thinking === next.thinking &&
    previous.retryRunId === next.retryRunId &&
    previous.message._id === next.message._id &&
    previous.message.status === next.message.status &&
    previous.message.updatedAt === next.message.updatedAt &&
    previous.message.errorMessage === next.message.errorMessage &&
    previous.draftText === next.draftText,
);

export function MessageList({
  messages,
  retryRunIdByMessageId = {},
  onRetryMessage,
  regeneratingTarget,
  optimisticEdits = {},
  onStartEditMessage,
  scrollTargetClientMessageId,
  scrollTargetMessageRef,
}: {
  messages: ChatMessage[];
  retryRunIdByMessageId?: Record<string, string>;
  onRetryMessage?: (messageId: string, runId: string) => void;
  regeneratingTarget?: {
    messageId: string;
    hideMessage: boolean;
  } | null;
  optimisticEdits?: Record<string, string>;
  onStartEditMessage?: (message: ChatMessage) => void;
  scrollTargetClientMessageId?: string;
  scrollTargetMessageRef?: RefObject<HTMLDivElement | null>;
}) {
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

  const visibleMessages = useMemo(() => {
    if (!regeneratingTarget) {
      return optimisticMessages;
    }

    const cutoffIndex = optimisticMessages.findIndex(
      (message) => message._id === regeneratingTarget.messageId,
    );
    if (cutoffIndex === -1) {
      return optimisticMessages;
    }

    return optimisticMessages.slice(0, cutoffIndex + (regeneratingTarget.hideMessage ? 0 : 1));
  }, [optimisticMessages, regeneratingTarget]);

  const regenerationPlaceholder = useMemo(() => {
    if (!regeneratingTarget?.hideMessage) {
      return null;
    }

    const targetMessage = optimisticMessages.find(
      (message) => message._id === regeneratingTarget.messageId,
    );
    if (!targetMessage || targetMessage.role !== 'assistant') {
      return null;
    }

    return {
      ...targetMessage,
      parts: [{ type: 'text', text: '' }] as ChatMessagePart[],
      status: 'pending' as const,
      errorMessage: undefined,
    };
  }, [optimisticMessages, regeneratingTarget]);

  return (
    <div className="space-y-4">
      {visibleMessages.map((message) => {
        if (message.role === 'user') {
          return (
            <div
              key={message._id}
              ref={
                scrollTargetClientMessageId &&
                message.clientMessageId === scrollTargetClientMessageId
                  ? scrollTargetMessageRef
                  : undefined
              }
            >
              <EditableUserMessage
                message={message}
                onStartEdit={() => {
                  onStartEditMessage?.(message);
                }}
              />
            </div>
          );
        }

        const isRegeneratingMessage = regeneratingTarget?.messageId === message._id;
        const renderedMessage = isRegeneratingMessage
          ? {
              ...message,
              parts:
                message.status === 'complete'
                  ? message.parts
                  : ([{ type: 'text', text: '' }] as ChatMessagePart[]),
              status: message.status === 'complete' ? ('complete' as const) : ('pending' as const),
              errorMessage: undefined,
            }
          : message;
        const persistedAssistantText = getTextFromParts(renderedMessage.parts);
        const assistantText = persistedAssistantText;
        const hideEmptyAssistantMessage =
          (renderedMessage.status === 'pending' || renderedMessage.status === 'streaming') &&
          !assistantText.trim() &&
          !renderedMessage.errorMessage &&
          !isRegeneratingMessage;

        if (hideEmptyAssistantMessage) {
          return null;
        }

        return (
          <MemoAssistantMessage
            key={message._id}
            message={renderedMessage}
            retryRunId={retryRunIdByMessageId[message._id]}
            thinking={
              (renderedMessage.status === 'pending' || renderedMessage.status === 'streaming') &&
              !assistantText.trim()
            }
            onRetry={onRetryMessage}
          />
        );
      })}
      {regenerationPlaceholder ? (
        <MemoAssistantMessage
          key={`regenerating-${regenerationPlaceholder._id}`}
          message={regenerationPlaceholder}
          thinking
          onRetry={onRetryMessage}
        />
      ) : null}
    </div>
  );
}
