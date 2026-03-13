import {
  AlertCircle,
  ArrowUp,
  Bot,
  ChevronDown,
  FileText,
  Globe,
  Mic,
  MicOff,
  Pencil,
  Paperclip,
  Square,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '~/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { useToast } from '~/components/ui/toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';
import {
  getChatAttachmentKind,
  inferChatAttachmentMimeType,
} from '~/features/chat/lib/attachments';
import { DEFAULT_CHAT_PERSONA, DEFAULT_CHAT_PERSONA_ID } from '~/features/chat/lib/constants';
import type {
  ChatAttachment,
  ChatAttachmentKind,
  ChatAttachmentPart,
  ChatMessagePart,
  ChatPersona,
} from '~/features/chat/types';
import type {
  SpeechRecognitionErrorEvent,
  SpeechRecognitionEvent,
  SpeechRecognitionInstance,
} from '~/features/chat/types/speech-recognition';
import {
  type ChatModelId,
  type ChatModelOption,
  DEFAULT_CHAT_MODEL_ID,
  getChatModelOption,
} from '~/lib/shared/chat-models';

type ComposerAttachmentDraft = {
  localId: string;
  attachmentId?: ChatAttachment['_id'];
  kind: ChatAttachmentKind;
  name: string;
  mimeType: string;
  promptSummary: string;
  previewUrl?: string | null;
  status: 'uploading' | ChatAttachment['status'];
  errorMessage?: string;
};

type ChatComposerProps = {
  disabled?: boolean;
  autoFocus?: boolean;
  isSending: boolean;
  canStop?: boolean;
  modelOptions?: ChatModelOption[];
  modelsReady?: boolean;
  personas?: ChatPersona[];
  personasReady?: boolean;
  selectedModelId?: ChatModelId;
  useWebSearch?: boolean;
  selectedPersonaId?: string;
  selectedPersonaLabel?: string;
  onSelectModel?: (modelId: ChatModelId) => void;
  onToggleWebSearch?: () => void;
  onSelectPersona?: (personaId?: string) => void;
  onManagePersonas?: () => void;
  onStop?: () => void;
  onUploadAttachment: (file: File) => Promise<ChatAttachment>;
  editingMessage?: {
    messageId: string;
    text: string;
  };
  isSavingEdit?: boolean;
  onCancelEdit?: () => void;
  onSubmitEdit?: (payload: { messageId: string; text: string; clear: () => void }) => Promise<void>;
  onSend: (payload: {
    text: string;
    attachmentIds: ChatAttachment['_id'][];
    parts: ChatMessagePart[];
    clear: () => void;
  }) => Promise<void>;
};

function createComposerAttachmentId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function toComposerAttachmentPart(
  attachment: ComposerAttachmentDraft,
): ChatAttachmentPart | null {
  if (!attachment.attachmentId || attachment.status !== 'ready') {
    return null;
  }

  return {
    type: 'attachment',
    attachmentId: attachment.attachmentId,
    kind: attachment.kind,
    name: attachment.name,
    mimeType: attachment.mimeType,
    status: attachment.status,
    previewUrl: attachment.previewUrl ?? null,
    promptSummary: attachment.promptSummary,
    errorMessage: attachment.errorMessage,
  };
}

export function ChatComposer({
  disabled = false,
  autoFocus = false,
  isSending,
  canStop = false,
  modelOptions = [],
  modelsReady = true,
  personas = [],
  personasReady = true,
  selectedModelId = DEFAULT_CHAT_MODEL_ID,
  useWebSearch = false,
  selectedPersonaId,
  selectedPersonaLabel,
  onSelectModel,
  onToggleWebSearch,
  onSelectPersona,
  onManagePersonas,
  onStop,
  onUploadAttachment,
  editingMessage,
  isSavingEdit = false,
  onCancelEdit,
  onSubmitEdit,
  onSend,
}: ChatComposerProps) {
  const { showToast } = useToast();
  const [message, setMessage] = useState('');
  const [attachmentDrafts, setAttachmentDrafts] = useState<ComposerAttachmentDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const isListeningRef = useRef(false);
  const isManualStopRef = useRef(false);
  const messageRef = useRef(message);
  const attachmentDraftsRef = useRef(attachmentDrafts);
  const preEditDraftRef = useRef<{
    message: string;
    attachmentDrafts: ComposerAttachmentDraft[];
  } | null>(null);
  const activeEditMessageIdRef = useRef<string | null>(null);
  const inputId = useId();
  const isEditing = Boolean(editingMessage);
  const hasBlockingAttachmentState = useMemo(
    () => attachmentDrafts.some((attachment) => attachment.status !== 'ready'),
    [attachmentDrafts],
  );
  const readyAttachmentParts = useMemo(
    () =>
      attachmentDrafts
        .map(toComposerAttachmentPart)
        .filter((attachment): attachment is ChatAttachmentPart => attachment !== null),
    [attachmentDrafts],
  );
  const readyAttachmentIds = useMemo(
    () => readyAttachmentParts.map((attachment) => attachment.attachmentId),
    [readyAttachmentParts],
  );
  const hasContent = useMemo(
    () => message.trim() || attachmentDrafts.length > 0,
    [attachmentDrafts.length, message],
  );
  const sendButtonDisabled = disabled || isSavingEdit || (!canStop && (!hasContent || hasBlockingAttachmentState));
  const isDefaultPersona = !selectedPersonaId;
  const personaButtonLabel =
    !isDefaultPersona && selectedPersonaLabel ? selectedPersonaLabel : null;
  const selectedModel = getChatModelOption(modelOptions, selectedModelId);
  const selectedModelLabel = modelsReady ? selectedModel.label : 'Loading models...';
  const personaControlDisabled = disabled || isEditing || !personasReady;
  const modelControlDisabled = disabled || isEditing || !modelsReady;
  const editingMessageId = editingMessage?.messageId ?? null;
  const editingMessageText = editingMessage?.text ?? '';

  const clearComposer = useCallback(() => {
    setMessage('');
    setAttachmentDrafts([]);
    setError(null);
    setInterimTranscript('');
  }, []);

  useEffect(() => {
    messageRef.current = message;
  }, [message]);

  useEffect(() => {
    attachmentDraftsRef.current = attachmentDrafts;
  }, [attachmentDrafts]);

  useEffect(() => {
    if (!editingMessageId) {
      if (activeEditMessageIdRef.current !== null) {
        const draft = preEditDraftRef.current;
        if (draft) {
          setMessage(draft.message);
          setAttachmentDrafts(draft.attachmentDrafts);
        }
        preEditDraftRef.current = null;
        activeEditMessageIdRef.current = null;
        setError(null);
        setInterimTranscript('');
      }

      return;
    }

    const isNewEditSession = activeEditMessageIdRef.current === null;
    const isSameMessage = activeEditMessageIdRef.current === editingMessageId;

    if (isNewEditSession) {
      preEditDraftRef.current = {
        message: messageRef.current,
        attachmentDrafts: attachmentDraftsRef.current,
      };
    }

    if (!isSameMessage && !isNewEditSession) {
      activeEditMessageIdRef.current = editingMessageId;
      setMessage(editingMessageText);
      setAttachmentDrafts([]);
      setError(null);
      setInterimTranscript('');
      textAreaRef.current?.focus();
      return;
    }

    activeEditMessageIdRef.current = editingMessageId;
    if (messageRef.current !== editingMessageText) {
      setMessage(editingMessageText);
    }
    if (attachmentDraftsRef.current.length > 0) {
      setAttachmentDrafts([]);
    }
    setError(null);
    setInterimTranscript('');
    textAreaRef.current?.focus();
  }, [editingMessageId, editingMessageText]);

  useEffect(() => {
    if (!autoFocus || disabled || isEditing) {
      return;
    }

    textAreaRef.current?.focus();
  }, [autoFocus, disabled, isEditing]);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = '';
      let interim = '';

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0].transcript;

        if (result.isFinal) {
          finalTranscript += transcript;
        } else {
          interim += transcript;
        }
      }

      setInterimTranscript(interim);
      if (finalTranscript) {
        setMessage((previous) => previous + finalTranscript);
        setInterimTranscript('');
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'not-allowed') {
        showToast(
          'Microphone access denied. Please allow microphone access in your browser.',
          'error',
        );
      } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
        showToast(`Speech recognition error: ${event.error}`, 'error');
      }

      setIsListening(false);
      isListeningRef.current = false;
      isManualStopRef.current = true;
    };

    recognition.onend = () => {
      if (isManualStopRef.current) {
        setIsListening(false);
        isListeningRef.current = false;
        isManualStopRef.current = false;
        return;
      }

      if (isListeningRef.current) {
        recognition.start();
      } else {
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.stop();
      recognitionRef.current = null;
    };
  }, [showToast]);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        const kind = getChatAttachmentKind(file);
        if (!kind) {
          showToast(`Unsupported file type: ${file.name}`, 'error');
          continue;
        }

        const localId = createComposerAttachmentId();
        setAttachmentDrafts((previous) => [
          ...previous,
          {
            localId,
            kind,
            name: file.name,
            mimeType: inferChatAttachmentMimeType(file),
            promptSummary: '',
            previewUrl: null,
            status: 'uploading',
          },
        ]);

        try {
          const uploadedAttachment = await onUploadAttachment(file);
          setAttachmentDrafts((previous) =>
            previous.map((attachment) =>
              attachment.localId === localId
                ? {
                    localId,
                    attachmentId: uploadedAttachment._id,
                    kind: uploadedAttachment.kind,
                    name: uploadedAttachment.name,
                    mimeType: uploadedAttachment.mimeType,
                    promptSummary: uploadedAttachment.promptSummary,
                    previewUrl: uploadedAttachment.previewUrl ?? null,
                    status: uploadedAttachment.status,
                    errorMessage: uploadedAttachment.errorMessage,
                  }
                : attachment,
            ),
          );
        } catch (uploadError) {
          const message =
            uploadError instanceof Error ? uploadError.message : `Failed to upload ${file.name}`;
          setAttachmentDrafts((previous) =>
            previous.map((attachment) =>
              attachment.localId === localId
                ? {
                    ...attachment,
                    status: 'error',
                    errorMessage: message,
                  }
                : attachment,
            ),
          );
          showToast(message, 'error');
        }
      }

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [onUploadAttachment, showToast],
  );

  const toggleVoiceInput = useCallback(() => {
    if (!recognitionRef.current) {
      showToast('Speech recognition is not supported in your browser.', 'error');
      return;
    }

    try {
      if (isListening) {
        isManualStopRef.current = true;
        isListeningRef.current = false;
        recognitionRef.current.stop();
        setIsListening(false);
      } else {
        isManualStopRef.current = false;
        isListeningRef.current = true;
        recognitionRef.current.start();
        setIsListening(true);
      }
    } catch (voiceError) {
      showToast(
        voiceError instanceof Error ? voiceError.message : 'Failed to start speech recognition.',
        'error',
      );
    }
  }, [isListening, showToast]);

  const handleSubmit = useCallback(async () => {
    if (editingMessage) {
      const text = message.trim();
      if (!text) {
        setError('Please enter a message to continue.');
        return;
      }

      setError(null);
      await onSubmitEdit?.({
        messageId: editingMessage.messageId,
        text,
        clear: () => {
          preEditDraftRef.current = null;
          activeEditMessageIdRef.current = null;
          clearComposer();
        },
      });
      return;
    }

    if (hasBlockingAttachmentState) {
      setError('Please wait for attachments to finish uploading, or remove failed files.');
      return;
    }

    const parts: ChatMessagePart[] = [];
    if (message.trim()) {
      parts.push({ type: 'text', text: message });
    }
    parts.push(...readyAttachmentParts);

    if (parts.length === 0) {
      setError('Please enter a message or upload a file to continue.');
      return;
    }

    setError(null);
    await onSend({
      text: message,
      attachmentIds: readyAttachmentIds,
      parts,
      clear: clearComposer,
    });
  }, [
    clearComposer,
    editingMessage,
    hasBlockingAttachmentState,
    message,
    onSend,
    onSubmitEdit,
    readyAttachmentIds,
    readyAttachmentParts,
  ]);

  return (
    <div className="rounded-[20px] border border-[#e3e1dc] bg-white px-5 py-2 shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
      {editingMessage ? (
        <div className="mb-3 flex items-center justify-between rounded-[18px] border border-[#e8e5df] bg-[#faf9f7] px-4 py-3">
          <div className="flex items-center gap-3">
            <Pencil className="size-5 text-[#24211d]" />
            <span className="text-lg font-semibold text-[#24211d]">Edit</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onCancelEdit}
            className="size-9 rounded-full text-[#6f6c66] shadow-none hover:bg-black/5 hover:text-[#24211d]"
            aria-label="Cancel edit"
          >
            <X className="size-5" />
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2 pb-1.5">
        {attachmentDrafts.map((attachment) =>
          attachment.kind === 'image' && attachment.previewUrl ? (
            <div key={attachment.localId} className="relative">
              <img
                src={attachment.previewUrl}
                alt={attachment.name || 'Upload'}
                className="h-16 w-16 rounded-2xl object-cover"
              />
              <div className="absolute right-2 bottom-2 rounded-full bg-black/65 px-2 py-0.5 text-[10px] font-medium text-white">
                {attachment.status === 'uploading'
                  ? 'Uploading'
                  : attachment.status === 'error'
                    ? 'Failed'
                    : 'Ready'}
              </div>
              <button
                type="button"
                className="absolute -top-2 -right-2 rounded-full bg-white/95 p-1 text-[#6f6c66] shadow-sm"
                onClick={() => {
                  setAttachmentDrafts((previous) =>
                    previous.filter((candidate) => candidate.localId !== attachment.localId),
                  );
                }}
              >
                <X className="size-3" />
              </button>
            </div>
          ) : (
            <div
              key={attachment.localId}
              className="flex items-center gap-2 rounded-2xl border border-[#ddd9d2] bg-white/80 px-3 py-2 text-sm text-[#403d39]"
            >
              <FileText className="size-4" />
              <div className="min-w-0">
                <div className="max-w-[180px] truncate">{attachment.name}</div>
                <div
                  className={
                    attachment.status === 'error'
                      ? 'text-xs text-destructive'
                      : 'text-xs text-[#7c7871]'
                  }
                >
                  {attachment.status === 'uploading'
                    ? 'Uploading...'
                    : attachment.status === 'error'
                      ? attachment.errorMessage ?? 'Upload failed'
                      : attachment.kind === 'image'
                        ? 'Image attached'
                        : 'Document ready'}
                </div>
              </div>
              <button
                type="button"
                className="rounded-full p-0.5 text-[#7c7871] transition hover:bg-black/5 hover:text-[#403d39]"
                onClick={() => {
                  setAttachmentDrafts((previous) =>
                    previous.filter((candidate) => candidate.localId !== attachment.localId),
                  );
                }}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ),
        )}
      </div>
      <label htmlFor={inputId} className="sr-only">
        Message
      </label>
      <textarea
        id={inputId}
        ref={textAreaRef}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) {
            return;
          }

          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();

            if (canStop) {
              onStop?.();
              return;
            }

            if (sendButtonDisabled || isSending) {
              return;
            }

            void handleSubmit();
          }
        }}
        onPaste={(event) => {
          const items = event.clipboardData?.items;
          if (!items) {
            return;
          }

          for (const item of Array.from(items)) {
            if (!item.type.startsWith('image/')) {
              continue;
            }

            event.preventDefault();
            const file = item.getAsFile();
            if (!file) {
              continue;
            }

            void uploadFiles([file]);
          }
        }}
        disabled={disabled}
        placeholder={editingMessage ? 'Edit your message' : 'Ask anything'}
        className="min-h-[58px] w-full resize-none bg-transparent px-1 pt-0 text-[15px] leading-6 text-[#403d39] outline-none placeholder:font-normal placeholder:text-[#b8b5af]"
      />
      {interimTranscript ? (
        <p className="pb-1.5 text-sm text-[#6f6c66]">{interimTranscript}</p>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            accept="image/*,.heic,.heif,.txt,.csv,.pdf,.xlsx,text/plain,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => {
              const files = event.target.files;
              if (!files?.length) {
                return;
              }

              void uploadFiles(Array.from(files));
            }}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || isEditing}
                className="size-9 rounded-full border-0 text-[#8e8a84] shadow-none hover:bg-black/5 hover:text-[#4d4b46]"
              >
                <Paperclip className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Attach files</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled}
                onClick={onToggleWebSearch}
                aria-pressed={useWebSearch}
                aria-label={useWebSearch ? 'Disable web search' : 'Enable web search'}
                className={
                  useWebSearch
                    ? 'size-9 rounded-full bg-[#e7f0ff] text-[#1f5cab] shadow-none hover:bg-[#d8e7ff] hover:text-[#184f96]'
                    : 'size-9 rounded-full border-0 text-[#8e8a84] shadow-none hover:bg-black/5 hover:text-[#4d4b46]'
                }
              >
                <Globe className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {useWebSearch
                ? 'Web search enabled for next message'
                : 'Enable web search for next message'}
            </TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size={personaButtonLabel ? 'sm' : 'icon'}
                    disabled={personaControlDisabled}
                    className={
                      personaButtonLabel
                        ? 'max-w-44 gap-2 rounded-full pl-3 pr-3 text-[#8e8a84] shadow-none hover:bg-black/5 hover:text-[#4d4b46]'
                        : 'size-9 rounded-full text-[#8e8a84] shadow-none hover:bg-black/5 hover:text-[#4d4b46]'
                    }
                    aria-label={`Choose persona${selectedPersonaLabel ? `: ${selectedPersonaLabel}` : ''}`}
                  >
                    <Bot className="size-4" />
                    {personaButtonLabel ? (
                      <span className="max-w-24 truncate text-xs">{personaButtonLabel}</span>
                    ) : null}
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                {!personasReady
                  ? 'Loading personas...'
                  : selectedPersonaLabel
                    ? `Persona: ${selectedPersonaLabel}`
                    : 'Choose persona'}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel>Persona</DropdownMenuLabel>
              {personasReady ? (
                <>
                  <DropdownMenuRadioGroup
                    value={selectedPersonaId ?? DEFAULT_CHAT_PERSONA_ID}
                    onValueChange={(value) => {
                      onSelectPersona?.(value === DEFAULT_CHAT_PERSONA_ID ? undefined : value);
                    }}
                  >
                    <DropdownMenuRadioItem value={DEFAULT_CHAT_PERSONA_ID}>
                      <div className="flex min-w-0 flex-col">
                        <span>{DEFAULT_CHAT_PERSONA.name}</span>
                        <span className="text-muted-foreground truncate text-xs">
                          {DEFAULT_CHAT_PERSONA.prompt}
                        </span>
                      </div>
                    </DropdownMenuRadioItem>
                    {personas.map((persona) => (
                      <DropdownMenuRadioItem key={persona._id} value={persona._id}>
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate">{persona.name}</span>
                          <span className="text-muted-foreground truncate text-xs">
                            {persona.prompt}
                          </span>
                        </div>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      onManagePersonas?.();
                    }}
                  >
                    Manage personas
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem disabled>Loading personas...</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={modelControlDisabled}
                className="max-w-44 gap-2 rounded-full px-3 text-[#403d39] shadow-none hover:bg-black/5 hover:text-[#24211d]"
                aria-label={`Choose model: ${selectedModelLabel}`}
              >
                <span className="max-w-32 truncate text-xs">{selectedModelLabel}</span>
                <ChevronDown className="size-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel>Model</DropdownMenuLabel>
              {modelsReady ? (
                <DropdownMenuRadioGroup
                  value={selectedModel.id}
                  onValueChange={(value) => {
                    onSelectModel?.(value);
                  }}
                >
                  {modelOptions.map((model) => (
                    <DropdownMenuRadioItem
                      key={model.id}
                      value={model.id}
                      disabled={!model.selectable}
                    >
                      <div className="flex min-w-0 flex-col">
                        <div className="flex items-center gap-2">
                          <span className="truncate">{model.label}</span>
                          {model.badge ? (
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              {model.badge}
                            </span>
                          ) : null}
                        </div>
                        <span className="text-muted-foreground truncate text-xs">
                          {model.priceLabel
                            ? `${model.description} • ${model.priceLabel}`
                            : model.description}
                        </span>
                      </div>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              ) : (
                <DropdownMenuItem disabled>Loading models...</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={toggleVoiceInput}
                disabled={isEditing}
                className="size-9 rounded-full border-0 text-[#8e8a84] shadow-none hover:bg-black/5 hover:text-[#4d4b46]"
              >
                {isListening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isListening ? 'Stop voice input' : 'Start voice input'}
            </TooltipContent>
          </Tooltip>
          <Button
            type="button"
            size="icon"
            onClick={() => {
              if (canStop) {
                onStop?.();
                return;
              }

              void handleSubmit();
            }}
            disabled={canStop ? disabled : sendButtonDisabled || isSending}
            className={canStop ? 'rounded-full bg-black text-white hover:bg-black/90' : 'rounded-full'}
            aria-label={canStop ? 'Stop generating' : editingMessage ? 'Save edit' : 'Send message'}
          >
            {canStop ? <Square className="size-4 fill-current" /> : <ArrowUp className="size-4" />}
          </Button>
        </div>
      </div>
      {error ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="size-4" />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}
