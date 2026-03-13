import { api } from '@convex/_generated/api';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '~/components/ui/toast';
import { TooltipProvider } from '~/components/ui/tooltip';
import { ChatWorkspace } from '~/features/chat/components/ChatWorkspace';

const navigateMock = vi.fn();
const useQueryMock = vi.fn();
const useUIMessagesMock = vi.fn();
const useChatStreamMock = vi.fn();
const messageListPropsMock = vi.fn();
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
  useUIMessages: (...args: unknown[]) => useUIMessagesMock(...args),
}));

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useAction: (...args: unknown[]) => useActionMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock('~/features/chat/hooks/useChatStream', () => ({
  useChatStream: (...args: unknown[]) => useChatStreamMock(...args),
}));

vi.mock('~/features/chat/components/MessageList', () => ({
  MessageList: (props: unknown) => {
    messageListPropsMock(props);
    return <div data-testid="message-list" />;
  },
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
    useUIMessagesMock.mockReturnValue({
      results: [],
      status: 'Loaded',
      loadMore: vi.fn(),
    });
    useChatStreamMock.mockReturnValue({
      ownerSessionId: 'session-1',
      activeStream: null,
      startStream: startStreamMock,
      stopStream: vi.fn(),
      clearStream: vi.fn(),
    });
    useQueryMock.mockImplementation((query: unknown) => {
      if (query === api.agentChat.getThread) {
        return {
          _id: 'thread-123',
          title: 'Thread',
          personaId: undefined,
          model: undefined,
        };
      }

      if (query === api.agentChat.getActiveRun) {
        return null;
      }

      if (query === api.agentChat.getRetryableRunIds) {
        return {};
      }

      if (query === api.agentChat.listPersonas) {
        return [];
      }

      if (query === api.chatModels.listAvailableChatModels) {
        return [];
      }
      return undefined;
    });
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
    expect(useUIMessagesMock).toHaveBeenCalledWith(
      api.agentChat.listThreadMessages,
      'skip',
      expect.objectContaining({
        initialNumItems: 100,
        stream: true,
      }),
    );

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

  it('keeps the retry action stable after the stream completes until retryable runs catch up', async () => {
    let retryableRunIds: Record<string, string> = {};
    let activeStream: ReturnType<typeof useChatStreamMock>['activeStream'] = {
      threadId: 'thread-123',
      runId: 'run-123',
      assistantMessageId: 'assistant-123',
      ownerSessionId: 'session-1',
      text: 'Finished answer',
      status: 'complete',
      startedAt: 1,
      request: {
        mode: 'send',
        threadId: 'thread-123',
        text: 'Prompt',
        attachmentIds: [],
        clientMessageId: 'client-123',
      },
    };

    useUIMessagesMock.mockReturnValue({
      results: [
        {
          id: 'assistant-123',
          _creationTime: 1,
          order: 1,
          stepOrder: 0,
          role: 'assistant',
          status: 'complete',
          parts: [{ type: 'text', text: 'Finished answer' }],
          metadata: {},
        },
      ],
      status: 'Loaded',
      loadMore: vi.fn(),
    });
    useChatStreamMock.mockImplementation(() => ({
      ownerSessionId: 'session-1',
      activeStream,
      startStream: startStreamMock,
      stopStream: vi.fn(),
      clearStream: vi.fn(),
    }));
    useQueryMock.mockImplementation((query: unknown) => {
      if (query === api.agentChat.getThread) {
        return {
          _id: 'thread-123',
          title: 'Thread',
          personaId: undefined,
          model: undefined,
        };
      }

      if (query === api.agentChat.getActiveRun) {
        return null;
      }

      if (query === api.agentChat.getRetryableRunIds) {
        return retryableRunIds;
      }

      if (query === api.agentChat.listPersonas) {
        return [];
      }

      if (query === api.chatModels.listAvailableChatModels) {
        return [];
      }
      return undefined;
    });

    const { rerender } = render(
      <ToastProvider>
        <TooltipProvider>
          <ChatWorkspace threadId="thread-123" />
        </TooltipProvider>
      </ToastProvider>,
    );

    await waitFor(() => {
      const props = messageListPropsMock.mock.calls.at(-1)?.[0] as {
        retryRunIdByMessageId: Record<string, string>;
      };
      expect(props.retryRunIdByMessageId).toEqual({ 'assistant-123': 'run-123' });
    });

    activeStream = null;
    rerender(
      <ToastProvider>
        <TooltipProvider>
          <ChatWorkspace threadId="thread-123" />
        </TooltipProvider>
      </ToastProvider>,
    );

    await waitFor(() => {
      const props = messageListPropsMock.mock.calls.at(-1)?.[0] as {
        retryRunIdByMessageId: Record<string, string>;
      };
      expect(props.retryRunIdByMessageId).toEqual({ 'assistant-123': 'run-123' });
    });

    retryableRunIds = { 'assistant-123': 'run-123' };
    rerender(
      <ToastProvider>
        <TooltipProvider>
          <ChatWorkspace threadId="thread-123" />
        </TooltipProvider>
      </ToastProvider>,
    );

    await waitFor(() => {
      const props = messageListPropsMock.mock.calls.at(-1)?.[0] as {
        retryRunIdByMessageId: Record<string, string>;
      };
      expect(props.retryRunIdByMessageId).toEqual({ 'assistant-123': 'run-123' });
    });
  });
});
