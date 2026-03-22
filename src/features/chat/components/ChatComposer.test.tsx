import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '~/components/ui/toast';
import { TooltipProvider } from '~/components/ui/tooltip';
import { ChatComposer } from '~/features/chat/components/ChatComposer';

const useChatRateLimitMock = vi.fn();
const showToastMock = vi.fn();

vi.mock('~/features/chat/hooks/useChatRateLimit', () => ({
  useChatRateLimit: (...args: unknown[]) => useChatRateLimitMock(...args),
}));

vi.mock('~/components/ui/toast', () => ({
  ToastProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

function renderChatComposer(props: Partial<ComponentProps<typeof ChatComposer>> = {}) {
  return render(
    <ToastProvider>
      <TooltipProvider>
        <ChatComposer
          isSending={false}
          modelOptions={[
            {
              id: 'openai/gpt-4o-mini',
              label: 'GPT-4o Mini',
              description: 'Default model',
              access: 'public',
              selectable: true,
            },
          ]}
          onUploadAttachment={vi.fn().mockResolvedValue(null)}
          onSend={vi.fn().mockResolvedValue(undefined)}
          {...props}
        />
      </TooltipProvider>
    </ToastProvider>,
  );
}

describe('ChatComposer', () => {
  beforeEach(() => {
    showToastMock.mockReset();
    useChatRateLimitMock.mockReturnValue({
      request: { ok: true, retryAfter: 0 },
      estimatedTokens: { ok: true, retryAfter: 0 },
      estimatedInputTokens: 1,
    });
  });

  it('renders searchable models in the model picker', async () => {
    const user = userEvent.setup();

    renderChatComposer({
      modelOptions: [
        {
          id: 'openai/gpt-4o-mini',
          label: 'GPT-4o Mini',
          description: 'Default model',
          access: 'public',
          selectable: true,
        },
        {
          id: 'openai/gpt-4o-search-preview',
          label: 'GPT-4o Search',
          description: 'Search-enabled model',
          access: 'public',
          selectable: true,
          supportsWebSearch: true,
        },
      ],
    });

    await user.click(screen.getByLabelText('Choose model: GPT-4o Mini'));

    expect(await screen.findByText('GPT-4o Search')).toBeInTheDocument();
  });

  it('renders a globe toggle for explicit web search', () => {
    renderChatComposer({
      onToggleWebSearch: vi.fn(),
    });

    expect(screen.getByLabelText('Enable web search')).toBeInTheDocument();
  });

  it('disables web search for models that do not support it and explains why', async () => {
    const user = userEvent.setup();

    renderChatComposer({
      selectedModelId: 'anthropic/claude-3.5-sonnet',
      modelOptions: [
        {
          id: 'openai/gpt-4o-mini',
          label: 'GPT-4o Mini',
          description: 'Default model',
          access: 'public',
          selectable: true,
          supportsWebSearch: true,
        },
        {
          id: 'anthropic/claude-3.5-sonnet',
          label: 'Claude 3.5 Sonnet',
          description: 'Reasoning model',
          access: 'public',
          selectable: true,
          supportsWebSearch: false,
        },
      ],
      onToggleWebSearch: vi.fn(),
    });

    const button = screen.getByLabelText('Web search unavailable for selected model');
    expect(button).toBeDisabled();

    await user.hover(button.parentElement as HTMLElement);

    expect(
      (await screen.findAllByText('Claude 3.5 Sonnet does not support web search.')).length,
    ).toBeGreaterThan(0);
  });

  it('focuses the message input when focusOnMount is enabled', () => {
    renderChatComposer({
      focusOnMount: true,
    });

    expect(screen.getByLabelText('Message')).toHaveFocus();
  });

  it('loads the main composer into edit mode and saves through the edit callback', async () => {
    const user = userEvent.setup();
    const onSubmitEdit = vi.fn().mockResolvedValue(undefined);

    renderChatComposer({
      editingMessage: { messageId: 'message-1', text: 'tell me more' },
      onCancelEdit: vi.fn(),
      onSubmitEdit,
    });

    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByDisplayValue('tell me more')).toBeInTheDocument();
    expect(screen.getByLabelText('Cancel edit')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'tell me even more' },
    });
    await user.click(screen.getByLabelText('Save edit'));

    expect(onSubmitEdit).toHaveBeenCalledWith({
      messageId: 'message-1',
      text: 'tell me even more',
      clear: expect.any(Function),
    });
  });

  it('replaces the send button with a stop control while streaming', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();

    renderChatComposer({
      canStop: true,
      onStop,
    });

    const stopButton = screen.getByLabelText('Stop generating');
    expect(stopButton).toBeInTheDocument();
    expect(screen.queryByLabelText('Send message')).not.toBeInTheDocument();

    await user.click(stopButton);

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('disables send and shows proactive rate-limit feedback before submit', () => {
    const onSend = vi.fn().mockResolvedValue(undefined);

    useChatRateLimitMock.mockReturnValue({
      request: { ok: false, retryAfter: 5_000 },
      estimatedTokens: { ok: true, retryAfter: 0 },
      estimatedInputTokens: 120,
    });

    renderChatComposer({
      onSend,
    });

    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'blocked prompt' },
    });

    expect(screen.getByText('Rate limit exceeded. Try again in 5 seconds.')).toBeInTheDocument();
    expect(screen.getByLabelText('Send message')).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
  });
});
