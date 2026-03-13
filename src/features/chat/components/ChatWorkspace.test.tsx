import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '~/components/ui/toast';
import { TooltipProvider } from '~/components/ui/tooltip';
import { ChatWorkspace } from '~/features/chat/components/ChatWorkspace';

const navigateMock = vi.fn();
const useQueryMock = vi.fn();
const useActionMock = vi.fn();
const useMutationMock = vi.fn();
const startStreamMock = vi.fn();
const uploadAttachmentMock = vi.fn();
const defaultMutationMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));

vi.mock('@convex-dev/agent/react', () => ({
  useUIMessages: () => ({
    results: [],
    status: 'Loaded',
    loadMore: vi.fn(),
  }),
}));

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useAction: (...args: unknown[]) => useActionMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock('~/features/chat/hooks/useChatStream', () => ({
  useChatStream: () => ({
    ownerSessionId: 'session-1',
    activeStream: null,
    startStream: startStreamMock,
    stopStream: vi.fn(),
    clearStream: vi.fn(),
  }),
}));

describe('ChatWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigateMock.mockResolvedValue(undefined);
    startStreamMock.mockResolvedValue({
      threadId: 'thread-123',
      assistantMessageId: 'assistant-123',
    });
    uploadAttachmentMock.mockResolvedValue(null);
    useQueryMock.mockReturnValue(undefined);
    useActionMock.mockReset();
    useActionMock.mockReturnValue(uploadAttachmentMock);
    defaultMutationMock.mockReset();
    defaultMutationMock.mockResolvedValue(undefined);
    useMutationMock.mockReset();
    useMutationMock.mockReturnValue(defaultMutationMock);
  });

  it('starts the first stream without precreating a thread shell', async () => {
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <TooltipProvider>
          <ChatWorkspace />
        </TooltipProvider>
      </ToastProvider>,
    );

    await user.type(screen.getByLabelText('Message'), 'Start a new conversation');
    await user.click(screen.getByLabelText('Send message'));

    await waitFor(() => {
      expect(startStreamMock).toHaveBeenCalledWith({
        mode: 'send',
        threadId: undefined,
        personaId: undefined,
        model: 'openai/gpt-4o-mini',
        useWebSearch: false,
        text: 'Start a new conversation',
        attachmentIds: [],
        clientMessageId: expect.any(String),
      });
    });

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/app/chat/$threadId',
      params: { threadId: 'thread-123' },
    });
  });

  it('keeps the composer text until the new thread navigation resolves', async () => {
    let resolveNavigate: (() => void) | undefined;
    navigateMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveNavigate = resolve;
        }),
    );

    const user = userEvent.setup();

    render(
      <ToastProvider>
        <TooltipProvider>
          <ChatWorkspace />
        </TooltipProvider>
      </ToastProvider>,
    );

    const messageInput = screen.getByLabelText('Message');
    await user.type(messageInput, 'Hold draft until route change');
    await user.click(screen.getByLabelText('Send message'));

    await waitFor(() => {
      expect(startStreamMock).toHaveBeenCalled();
    });

    expect(messageInput).toHaveValue('Hold draft until route change');
    resolveNavigate?.();
  });
});
