import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '~/components/ui/toast';
import { TooltipProvider } from '~/components/ui/tooltip';
import { ChatComposer } from '~/features/chat/components/ChatComposer';

describe('ChatComposer', () => {
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
            onSend={vi.fn().mockResolvedValue(undefined)}
          />
        </TooltipProvider>
      </ToastProvider>,
    );

    expect(screen.getByLabelText('Enable web search')).toBeInTheDocument();
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
});
