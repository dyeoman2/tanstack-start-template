import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MessageList } from '~/features/chat/components/MessageList';

vi.mock('next-themes', () => ({
  useTheme: () => ({
    resolvedTheme: 'light',
  }),
}));

describe('MessageList', () => {
  it('renders pending assistant output as plain text while streaming', () => {
    render(
      <MessageList
        messages={[
          {
            _id: 'assistant-1' as never,
            threadId: 'thread-1' as never,
            role: 'assistant',
            parts: [{ type: 'text', text: '# Streaming title' }],
            status: 'pending',
            createdAt: 1,
            updatedAt: 1,
          },
        ]}
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
            _id: 'assistant-1' as never,
            threadId: 'thread-1' as never,
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
});
