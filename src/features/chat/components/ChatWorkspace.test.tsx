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
const messageListPropsMock = vi.fn();
const useActionMock = vi.fn();
const useMutationMock = vi.fn();
const uploadAttachmentMock = vi.fn();
const createThreadMock = vi.fn();
const sendMessageMock = vi.fn();
const editUserMessageMock = vi.fn();
const retryAssistantResponseMock = vi.fn();
const defaultMutationMock = vi.fn();
const useChatRateLimitMock = vi.fn();
let threadQueryResult:
  | {
      _id: string;
      title: string;
      personaId: string | undefined;
      model: string | undefined;
    }
  | null
  | undefined;
let activeRunQueryResult: unknown;
let retryableRunIdsQueryResult: Record<string, string> | undefined;
let personasQueryResult: unknown[];
let modelOptionsQueryResult: unknown[];

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

vi.mock('~/features/chat/hooks/useChatRateLimit', () => ({
  useChatRateLimit: (...args: unknown[]) => useChatRateLimitMock(...args),
}));

vi.mock('~/features/chat/components/MessageList', () => ({
  MessageList: (props: unknown) => {
    messageListPropsMock(props);
    return <div data-testid="message-list" />;
  },
}));

function createMutationMock(fn: ReturnType<typeof vi.fn>) {
  const mutation = fn as typeof fn & {
    withOptimisticUpdate: (updater: unknown) => typeof fn;
  };
  mutation.withOptimisticUpdate = vi.fn(() => fn);
  return mutation;
}

describe('ChatWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigateMock.mockResolvedValue(undefined);
    uploadAttachmentMock.mockResolvedValue(null);
    createThreadMock.mockResolvedValue({ threadId: 'thread-123' });
    sendMessageMock.mockResolvedValue({ threadId: 'thread-123', runId: 'run-123' });
    editUserMessageMock.mockResolvedValue({ threadId: 'thread-123', runId: 'run-456' });
    retryAssistantResponseMock.mockResolvedValue({ threadId: 'thread-123', runId: 'run-789' });
    defaultMutationMock.mockResolvedValue(undefined);
    useChatRateLimitMock.mockReset();
    useChatRateLimitMock.mockReturnValue({
      frequency: { ok: true, retryAfter: 0 },
      tokens: { ok: true, retryAfter: 0 },
      estimatedInputTokens: 0,
    });
    useActionMock.mockReset();
    useActionMock.mockReturnValue(uploadAttachmentMock);
    useMutationMock.mockReset();
    let mutationCallIndex = 0;
    useMutationMock.mockImplementation(() => {
      const slot = mutationCallIndex % 9;
      mutationCallIndex += 1;

      switch (slot) {
        case 0:
          return uploadAttachmentMock;
        case 1:
          return createThreadMock;
        case 2:
          return createMutationMock(sendMessageMock);
        case 3:
          return editUserMessageMock;
        case 4:
          return retryAssistantResponseMock;
        default:
          return defaultMutationMock;
      }
    });
    useUIMessagesMock.mockReturnValue({
      results: [],
      status: 'Loaded',
      loadMore: vi.fn(),
    });
    threadQueryResult = {
      _id: 'thread-123',
      title: 'Thread',
      personaId: undefined,
      model: undefined,
    };
    activeRunQueryResult = null;
    retryableRunIdsQueryResult = {};
    personasQueryResult = [];
    modelOptionsQueryResult = [];
    let queryCallIndex = 0;
    useQueryMock.mockImplementation((_query: unknown, args?: unknown) => {
      const slot = queryCallIndex % 5;
      queryCallIndex += 1;

      if (args === 'skip') {
        return undefined;
      }

      switch (slot) {
        case 0:
          return threadQueryResult;
        case 1:
          return activeRunQueryResult;
        case 2:
          return retryableRunIdsQueryResult;
        case 3:
          return personasQueryResult;
        case 4:
          return modelOptionsQueryResult;
        default:
          return undefined;
      }
    });
  });

  it('precreates a thread, navigates, and then sends the first message through the mutation path', async () => {
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
      expect(createThreadMock).toHaveBeenCalledWith({
        text: 'Start a new conversation',
        attachmentIds: [],
        personaId: undefined,
        model: 'openai/gpt-4o-mini',
      });
    });
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/app/chat/$threadId',
        params: { threadId: 'thread-123' },
      });
    });
    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith({
        threadId: 'thread-123',
        text: 'Start a new conversation',
        attachmentIds: [],
        clientMessageId: expect.any(String),
        ownerSessionId: expect.any(String),
        personaId: undefined,
        model: 'openai/gpt-4o-mini',
        useWebSearch: false,
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
      expect(createThreadMock).toHaveBeenCalled();
    });

    expect(messageInput).toHaveValue('Hold draft until route change');
    resolveNavigate?.();
  });

  it('passes retryable run ids from the query through to MessageList', async () => {
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
    retryableRunIdsQueryResult = { 'assistant-123': 'run-123' };

    render(
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
