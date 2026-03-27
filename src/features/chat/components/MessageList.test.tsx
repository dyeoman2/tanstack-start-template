import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MessageList } from '~/features/chat/components/MessageList';

vi.mock('next-themes', () => ({
  useTheme: () => ({
    resolvedTheme: 'light',
  }),
}));

describe('MessageList', () => {
  it('renders pending assistant stream output as plain text while streaming', async () => {
    render(
      <MessageList
        messages={[
          {
            _id: 'assistant-1',
            threadId: 'thread-1',
            order: 1,
            stepOrder: 0,
            role: 'assistant',
            parts: [{ type: 'text', text: '# Streaming title' }],
            status: 'streaming',
            createdAt: 1,
            updatedAt: 1,
          },
        ]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('# Streaming title')).toBeInTheDocument();
    });
    expect(screen.queryByRole('heading', { name: 'Streaming title' })).not.toBeInTheDocument();
  });

  it('renders completed assistant output as markdown after streaming finishes', () => {
    render(
      <MessageList
        messages={[
          {
            _id: 'assistant-1',
            threadId: 'thread-1',
            order: 1,
            stepOrder: 0,
            role: 'assistant',
            parts: [{ type: 'text', text: '# Streaming title' }],
            status: 'complete',
            createdAt: 1,
            updatedAt: 2,
          },
        ]}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Streaming title' })).toBeInTheDocument();
  });

  it('renders Thinking... for an empty pending assistant message', () => {
    render(
      <MessageList
        messages={[
          {
            _id: 'assistant-1',
            threadId: 'thread-1',
            order: 1,
            stepOrder: 0,
            role: 'assistant',
            parts: [{ type: 'text', text: '' }],
            status: 'pending',
            createdAt: 1,
            updatedAt: 1,
          },
        ]}
      />,
    );

    expect(screen.getByText('Thinking...')).toBeInTheDocument();
  });

  it('renders a retry icon next to copy and calls retry for a saved assistant message', async () => {
    const user = userEvent.setup();
    const onRetryMessage = vi.fn();

    render(
      <MessageList
        messages={[
          {
            _id: 'assistant-1',
            threadId: 'thread-1',
            order: 1,
            stepOrder: 0,
            role: 'assistant',
            parts: [{ type: 'text', text: 'Answer' }],
            status: 'complete',
            createdAt: 1,
            updatedAt: 2,
          },
        ]}
        retryRunIdByMessageId={{ 'assistant-1': 'run-1' }}
        onRetryMessage={onRetryMessage}
      />,
    );

    const copyButton = screen.getByRole('button', { name: 'Copy' });
    const retryButton = screen.getByRole('button', { name: 'Retry response' });

    expect(copyButton).toBeInTheDocument();
    expect(retryButton).toBeInTheDocument();

    await user.click(retryButton);

    expect(onRetryMessage).toHaveBeenCalledWith('assistant-1', 'run-1');
  });

  it('renders a retry icon for saved assistant messages when a retryable run id exists', async () => {
    const user = userEvent.setup();
    const onRetryMessage = vi.fn();

    render(
      <MessageList
        messages={[
          {
            _id: 'assistant-1',
            threadId: 'thread-1',
            order: 1,
            stepOrder: 0,
            role: 'assistant',
            parts: [{ type: 'text', text: 'Answer' }],
            status: 'complete',
            createdAt: 1,
            updatedAt: 2,
          },
        ]}
        retryRunIdByMessageId={{ 'assistant-1': 'run-1' }}
        onRetryMessage={onRetryMessage}
      />,
    );

    const retryButton = screen.getByRole('button', { name: 'Retry response' });

    await user.click(retryButton);

    expect(onRetryMessage).toHaveBeenCalledWith('assistant-1', 'run-1');
  });

  it('hides the retried assistant message immediately and shows only the pending placeholder', () => {
    const { rerender } = render(
      <MessageList
        messages={[
          {
            _id: 'assistant-1',
            threadId: 'thread-1',
            order: 1,
            stepOrder: 0,
            role: 'assistant',
            parts: [{ type: 'text', text: 'Old answer' }],
            status: 'complete',
            createdAt: 1,
            updatedAt: 1,
          },
        ]}
      />,
    );

    rerender(
      <MessageList
        messages={[
          {
            _id: 'assistant-1',
            threadId: 'thread-1',
            order: 1,
            stepOrder: 0,
            role: 'assistant',
            parts: [{ type: 'text', text: 'Old answer' }],
            status: 'complete',
            createdAt: 1,
            updatedAt: 1,
          },
        ]}
        regeneratingTarget={{
          messageId: 'assistant-1',
          hideMessage: true,
        }}
      />,
    );

    expect(screen.queryByText('Old answer')).not.toBeInTheDocument();
    expect(screen.getByText('Thinking...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
  });

  it('shows the regenerated assistant message immediately once retry is no longer pending', () => {
    const { rerender } = render(
      <MessageList
        messages={[
          {
            _id: 'assistant-1',
            threadId: 'thread-1',
            order: 1,
            stepOrder: 0,
            role: 'assistant',
            parts: [{ type: 'text', text: 'Updated answer' }],
            status: 'complete',
            createdAt: 1,
            updatedAt: 2,
          },
        ]}
        regeneratingTarget={{
          messageId: 'assistant-1',
          hideMessage: true,
        }}
      />,
    );

    rerender(
      <MessageList
        messages={[
          {
            _id: 'assistant-1',
            threadId: 'thread-1',
            order: 1,
            stepOrder: 0,
            role: 'assistant',
            parts: [{ type: 'text', text: 'Updated answer' }],
            status: 'complete',
            createdAt: 1,
            updatedAt: 2,
          },
        ]}
      />,
    );

    expect(screen.getByText('Updated answer')).toBeInTheDocument();
    expect(screen.queryByText('Thinking...')).not.toBeInTheDocument();
  });

  it('renders the user author name and edit affordance only when editing is allowed', () => {
    const { rerender } = render(
      <MessageList
        messages={[
          {
            _id: 'user-1',
            threadId: 'thread-1',
            order: 1,
            stepOrder: 0,
            role: 'user',
            parts: [{ type: 'text', text: 'Draft message' }],
            status: 'complete',
            createdAt: 1,
            updatedAt: 1,
            authorName: 'Casey',
            canEdit: true,
          },
        ]}
      />,
    );

    expect(screen.getByText('Casey')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit message' })).toBeInTheDocument();

    rerender(
      <MessageList
        messages={[
          {
            _id: 'user-1',
            threadId: 'thread-1',
            order: 1,
            stepOrder: 0,
            role: 'user',
            parts: [{ type: 'text', text: 'Draft message' }],
            status: 'complete',
            createdAt: 1,
            updatedAt: 1,
            authorName: 'Casey',
            canEdit: false,
          },
        ]}
      />,
    );

    expect(screen.getByText('Casey')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit message' })).not.toBeInTheDocument();
  });

  it('uses the same-origin favicon proxy for URL sources', () => {
    const { container } = render(
      <MessageList
        messages={[
          {
            _id: 'assistant-1',
            threadId: 'thread-1',
            order: 1,
            stepOrder: 0,
            role: 'assistant',
            parts: [
              { type: 'text', text: 'Answer with sources' },
              {
                type: 'source-url',
                sourceId: 'source-1',
                title: 'Example',
                url: 'https://www.example.com/articles/1',
              },
            ],
            status: 'complete',
            createdAt: 1,
            updatedAt: 1,
          },
        ]}
      />,
    );

    const favicon = container.querySelector('img');
    expect(favicon).not.toBeNull();
    expect(favicon).toHaveAttribute('src', '/api/chat/source-favicon?hostname=www.example.com');
  });
});
