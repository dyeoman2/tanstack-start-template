import {
  AlertCircle,
  ArrowUp,
  Bot,
  ChevronDown,
  FileText,
  Mic,
  MicOff,
  Paperclip,
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
  buildComposerParts,
  isDocumentFile,
  isImageFile,
  readFileAsDataUrl,
  type UploadedDocument,
  type UploadedImage,
} from '~/features/chat/lib/attachments';
import { DEFAULT_CHAT_PERSONA, DEFAULT_CHAT_PERSONA_ID } from '~/features/chat/lib/constants';
import { parseFile } from '~/features/chat/lib/file-parser';
import type { ChatPersona } from '~/features/chat/types';
import type {
  SpeechRecognitionErrorEvent,
  SpeechRecognitionEvent,
  SpeechRecognitionInstance,
} from '~/features/chat/types/speech-recognition';
import {
  CHAT_MODEL_OPTIONS,
  type ChatModelId,
  DEFAULT_CHAT_MODEL_ID,
  getChatModelOption,
  isChatModelId,
} from '~/lib/shared/chat-models';

type ChatComposerProps = {
  disabled?: boolean;
  isSending: boolean;
  personas?: ChatPersona[];
  selectedModelId?: ChatModelId;
  selectedPersonaId?: string;
  selectedPersonaLabel?: string;
  onSelectModel?: (modelId: ChatModelId) => void;
  onSelectPersona?: (personaId?: string) => void;
  onManagePersonas?: () => void;
  onSend: (payload: {
    text: string;
    parts: ReturnType<typeof buildComposerParts>;
    clear: () => void;
  }) => Promise<void>;
};

export function ChatComposer({
  disabled = false,
  isSending,
  personas = [],
  selectedModelId = DEFAULT_CHAT_MODEL_ID,
  selectedPersonaId,
  selectedPersonaLabel,
  onSelectModel,
  onSelectPersona,
  onManagePersonas,
  onSend,
}: ChatComposerProps) {
  const { showToast } = useToast();
  const [message, setMessage] = useState('');
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [uploadedDocuments, setUploadedDocuments] = useState<UploadedDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const isListeningRef = useRef(false);
  const isManualStopRef = useRef(false);
  const inputId = useId();

  const hasContent = useMemo(
    () => message.trim() || uploadedImages.length > 0 || uploadedDocuments.length > 0,
    [message, uploadedDocuments.length, uploadedImages.length],
  );
  const isDefaultPersona = !selectedPersonaId;
  const personaButtonLabel =
    !isDefaultPersona && selectedPersonaLabel ? selectedPersonaLabel : null;
  const selectedModel = getChatModelOption(selectedModelId);

  const clearComposer = useCallback(() => {
    setMessage('');
    setUploadedImages([]);
    setUploadedDocuments([]);
    setError(null);
    setInterimTranscript('');
  }, []);

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

  const handleFileUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files?.length) {
        return;
      }

      for (const file of Array.from(files)) {
        try {
          if (isImageFile(file)) {
            const image = await readFileAsDataUrl(file);
            setUploadedImages((previous) => [
              ...previous,
              { image, mimeType: file.type || 'image/png', name: file.name },
            ]);
            continue;
          }

          if (isDocumentFile(file)) {
            const parsed = await parseFile(file);
            setUploadedDocuments((previous) => [...previous, parsed]);
            continue;
          }

          showToast(`Unsupported file type: ${file.name}`, 'error');
        } catch (uploadError) {
          showToast(
            uploadError instanceof Error ? uploadError.message : `Failed to parse ${file.name}`,
            'error',
          );
        }
      }

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [showToast],
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
    const parts = buildComposerParts(message, uploadedImages, uploadedDocuments);
    if (parts.length === 0) {
      setError('Please enter a message or upload a file to continue.');
      return;
    }

    setError(null);
    await onSend({
      text: message,
      parts,
      clear: clearComposer,
    });
  }, [clearComposer, message, onSend, uploadedDocuments, uploadedImages]);

  return (
    <div className="rounded-[20px] border border-[#e3e1dc] bg-white px-5 py-2 shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
      <div className="flex flex-wrap gap-2 pb-1.5">
        {uploadedImages.map((image, index) => (
          <div key={`${image.name || 'image'}-${image.image.slice(0, 32)}`} className="relative">
            <img
              src={image.image}
              alt={image.name || 'Upload'}
              className="h-16 w-16 rounded-2xl object-cover"
            />
            <button
              type="button"
              className="absolute -top-2 -right-2 rounded-full bg-white/95 p-1 text-[#6f6c66] shadow-sm"
              onClick={() => {
                setUploadedImages((previous) =>
                  previous.filter((_, itemIndex) => itemIndex !== index),
                );
              }}
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        {uploadedDocuments.map((document, index) => (
          <div
            key={`${document.name}-${document.content.slice(0, 32)}`}
            className="flex items-center gap-2 rounded-2xl border border-[#ddd9d2] bg-white/80 px-3 py-2 text-sm text-[#403d39]"
          >
            <FileText className="size-4" />
            <span className="max-w-[180px] truncate">{document.name}</span>
            <button
              type="button"
              className="rounded-full p-0.5 text-[#7c7871] transition hover:bg-black/5 hover:text-[#403d39]"
              onClick={() => {
                setUploadedDocuments((previous) =>
                  previous.filter((_, itemIndex) => itemIndex !== index),
                );
              }}
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
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

            if (disabled || isSending || !hasContent) {
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

            void readFileAsDataUrl(file).then((image) => {
              setUploadedImages((previous) => [
                ...previous,
                {
                  image,
                  mimeType: file.type,
                  name: file.name,
                },
              ]);
            });
          }
        }}
        disabled={disabled}
        placeholder="Ask anything"
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
            accept="image/*,.heic,.heif,.txt,.csv,.pdf,.xlsx,.xls,text/plain,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={(event) => {
              void handleFileUpload(event);
            }}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled}
                className="size-9 rounded-full border-0 text-[#8e8a84] shadow-none hover:bg-black/5 hover:text-[#4d4b46]"
              >
                <Paperclip className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Attach files</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size={personaButtonLabel ? 'sm' : 'icon'}
                    disabled={disabled}
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
                {selectedPersonaLabel ? `Persona: ${selectedPersonaLabel}` : 'Choose persona'}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel>Persona</DropdownMenuLabel>
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
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                className="max-w-44 gap-2 rounded-full px-3 text-[#403d39] shadow-none hover:bg-black/5 hover:text-[#24211d]"
                aria-label={`Choose model: ${selectedModel.label}`}
              >
                <span className="max-w-32 truncate text-xs">{selectedModel.label}</span>
                <ChevronDown className="size-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel>Model</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={selectedModel.id}
                onValueChange={(value) => {
                  if (isChatModelId(value)) {
                    onSelectModel?.(value);
                  }
                }}
              >
                {CHAT_MODEL_OPTIONS.map((model) => (
                  <DropdownMenuRadioItem key={model.id} value={model.id}>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{model.label}</span>
                      <span className="text-muted-foreground truncate text-xs">
                        {model.description}
                      </span>
                    </div>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
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
              void handleSubmit();
            }}
            disabled={disabled || isSending || !hasContent}
            className="rounded-full"
          >
            <ArrowUp className="size-4" />
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
