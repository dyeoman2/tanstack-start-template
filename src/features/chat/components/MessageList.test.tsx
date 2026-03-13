import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MessageList } from '~/features/chat/components/MessageList';

vi.mock('next-themes', () => ({
  useTheme: () => ({
    resolvedTheme: 'light',
  }),
}));

describe('MessageList', () => {
  it('renders pending assistant stream output as plain text while streaming', () => {
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
            status: 'streaming',
            createdAt: 1,
            updatedAt: 1,
          },
        ]}
        activeStream={{
          threadId: 'thread-1',
          runId: 'run-1',
          assistantMessageId: 'assistant-1',
          ownerSessionId: 'session-1',
          text: '# Streaming title',
          status: 'streaming',
          startedAt: 1,
          request: {
            mode: 'send',
            text: 'Prompt',
            attachmentIds: [],
          },
        }}
      />,
    );

    expect(screen.getByText('# Streaming title')).toBeInTheDocument();
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
        isRegenerationPending
      />,
    );

    expect(screen.queryByText('Old answer')).not.toBeInTheDocument();
    expect(screen.getByText('Thinking...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
  });

  it('shows the regenerated assistant message immediately once retry is no longer pending', () => {
    render(
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
        isRegenerationPending={false}
      />,
    );

    expect(screen.getByText('Updated answer')).toBeInTheDocument();
    expect(screen.queryByText('Thinking...')).not.toBeInTheDocument();
  });

  it('keeps showing the completed retry text until the saved assistant message has content', () => {
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
            status: 'complete',
            createdAt: 1,
            updatedAt: 2,
          },
        ]}
        fallbackDraftTextByMessageId={{ 'assistant-1': 'Updated answer' }}
        regeneratingTarget={{
          messageId: 'assistant-1',
          hideMessage: true,
        }}
        isRegenerationPending={false}
      />,
    );

    expect(screen.getByText('Updated answer')).toBeInTheDocument();
    expect(screen.queryByText('Thinking...')).not.toBeInTheDocument();
  });

  it('shows the completed retry text even while regeneration is still marked pending', () => {
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
            updatedAt: 2,
          },
        ]}
        fallbackDraftTextByMessageId={{ 'assistant-1': 'Updated answer' }}
        regeneratingTarget={{
          messageId: 'assistant-1',
          hideMessage: true,
        }}
        isRegenerationPending
      />,
    );

    expect(screen.getByText('Updated answer')).toBeInTheDocument();
    expect(screen.queryByText('Thinking...')).not.toBeInTheDocument();
  });

  it('shows a synthetic retry row when the retried assistant message is temporarily missing', () => {
    render(
      <MessageList
        messages={[]}
        fallbackDraftTextByMessageId={{ 'assistant-1': 'Updated answer' }}
        regeneratingTarget={{
          messageId: 'assistant-1',
          hideMessage: true,
        }}
        isRegenerationPending
      />,
    );

    expect(screen.getByText('Updated answer')).toBeInTheDocument();
    expect(screen.queryByText('Thinking...')).not.toBeInTheDocument();
  });

  it('renders the pending user submission with a thinking placeholder before text arrives', () => {
    render(
      <MessageList
        messages={[]}
        activeStream={{
          threadId: 'thread-1',
          runId: 'run-1',
          assistantMessageId: 'assistant-1',
          ownerSessionId: 'session-1',
          text: '',
          status: 'streaming',
          startedAt: 2,
          request: {
            mode: 'send',
            threadId: 'thread-1',
            text: 'Tell me a joke',
            attachmentIds: [],
          },
        }}
        pendingSubmission={{
          submission: {
            clientMessageId: 'client-1',
            parts: [{ type: 'text', text: 'Tell me a joke' }],
            submittedAt: 1,
            stage: 'submitting',
          },
          showUserMessage: true,
          showAssistantPlaceholder: true,
        }}
      />,
    );

    expect(screen.getByText('Tell me a joke')).toBeInTheDocument();
    expect(screen.getByText('Thinking...')).toBeInTheDocument();
  });
});
