import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '~/components/ui/toast';
import { TooltipProvider } from '~/components/ui/tooltip';
import { ChatComposer } from '~/features/chat/components/ChatComposer';

const useChatRateLimitMock = vi.fn();

vi.mock('~/features/chat/hooks/useChatRateLimit', () => ({
  useChatRateLimit: (...args: unknown[]) => useChatRateLimitMock(...args),
}));

describe('ChatComposer', () => {
  beforeEach(() => {
    useChatRateLimitMock.mockReturnValue({
      frequency: { ok: true, retryAfter: 0 },
      tokens: { ok: true, retryAfter: 0 },
      estimatedInputTokens: 1,
    });
  });

  it('renders searchable models in the model picker', async () => {
    const user = userEvent.setup();

    render(
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
              {
                id: 'openai/gpt-4o-search-preview',
                label: 'GPT-4o Search',
                description: 'Search-enabled model',
                access: 'public',
                selectable: true,
                supportsWebSearch: true,
              },
            ]}
            onUploadAttachment={vi.fn().mockResolvedValue(null)}
            onSend={vi.fn().mockResolvedValue(undefined)}
          />
        </TooltipProvider>
      </ToastProvider>,
    );

    await user.click(screen.getByLabelText('Choose model: GPT-4o Mini'));

    expect(await screen.findByText('GPT-4o Search')).toBeInTheDocument();
  });

  it('renders a globe toggle for explicit web search', () => {
    render(
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
            onToggleWebSearch={vi.fn()}
            onUploadAttachment={vi.fn().mockResolvedValue(null)}
            onSend={vi.fn().mockResolvedValue(undefined)}
          />
        </TooltipProvider>
      </ToastProvider>,
    );

    expect(screen.getByLabelText('Enable web search')).toBeInTheDocument();
  });

  it('focuses the message input when autoFocus is enabled', () => {
    render(
      <ToastProvider>
        <TooltipProvider>
          <ChatComposer
            autoFocus
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
          />
        </TooltipProvider>
      </ToastProvider>,
    );

    expect(screen.getByLabelText('Message')).toHaveFocus();
  });

  it('loads the main composer into edit mode and saves through the edit callback', async () => {
    const user = userEvent.setup();
    const onSubmitEdit = vi.fn().mockResolvedValue(undefined);

    render(
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
            editingMessage={{ messageId: 'message-1', text: 'tell me more' }}
            onCancelEdit={vi.fn()}
            onSubmitEdit={onSubmitEdit}
            onUploadAttachment={vi.fn().mockResolvedValue(null)}
            onSend={vi.fn().mockResolvedValue(undefined)}
          />
        </TooltipProvider>
      </ToastProvider>,
    );

    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByDisplayValue('tell me more')).toBeInTheDocument();
    expect(screen.getByLabelText('Cancel edit')).toBeInTheDocument();

    await user.clear(screen.getByDisplayValue('tell me more'));
    await user.type(screen.getByLabelText('Message'), 'tell me even more');
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

    render(
      <ToastProvider>
        <TooltipProvider>
          <ChatComposer
            isSending={false}
            canStop
            onStop={onStop}
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
          />
        </TooltipProvider>
      </ToastProvider>,
    );

    const stopButton = screen.getByLabelText('Stop generating');
    expect(stopButton).toBeInTheDocument();
    expect(screen.queryByLabelText('Send message')).not.toBeInTheDocument();

    await user.click(stopButton);

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('disables send and shows proactive rate-limit feedback before submit', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);

    useChatRateLimitMock.mockReturnValue({
      frequency: { ok: false, retryAfter: 5_000 },
      tokens: { ok: true, retryAfter: 0 },
      estimatedInputTokens: 120,
    });

    render(
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
            onSend={onSend}
          />
        </TooltipProvider>
      </ToastProvider>,
    );

    await user.type(screen.getByLabelText('Message'), 'blocked prompt');

    expect(screen.getByText('Rate limit exceeded. Try again in 5 seconds.')).toBeInTheDocument();
    expect(screen.getByLabelText('Send message')).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
  });
});
