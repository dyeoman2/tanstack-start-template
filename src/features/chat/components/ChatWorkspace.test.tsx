import { api } from '@convex/_generated/api';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '~/components/ui/toast';
import { TooltipProvider } from '~/components/ui/tooltip';
import { ChatWorkspace } from '~/features/chat/components/ChatWorkspace';
import {
  clearOptimisticThreadBootstrap,
  setOptimisticThreadBootstrap,
} from '~/features/chat/lib/optimistic-threads';

const navigateMock = vi.fn();
const useQueryMock = vi.fn();
const useUIMessagesMock = vi.fn();
const messageListPropsMock = vi.fn();
const useActionMock = vi.fn();
const useMutationMock = vi.fn();
const uploadAttachmentMock = vi.fn();
const stopRunMock = vi.fn();
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
      canManage: boolean;
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
    clearOptimisticThreadBootstrap('thread-123');
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    navigateMock.mockResolvedValue(undefined);
    uploadAttachmentMock.mockResolvedValue(null);
    createThreadMock.mockResolvedValue({ threadId: 'thread-123' });
    sendMessageMock.mockResolvedValue({ threadId: 'thread-123', runId: 'run-123' });
    editUserMessageMock.mockResolvedValue({ threadId: 'thread-123', runId: 'run-456' });
    retryAssistantResponseMock.mockResolvedValue({ threadId: 'thread-123', runId: 'run-789' });
    defaultMutationMock.mockResolvedValue(undefined);
    useChatRateLimitMock.mockReset();
    useChatRateLimitMock.mockReturnValue({
      request: { ok: true, retryAfter: 0 },
      estimatedTokens: { ok: true, retryAfter: 0 },
      estimatedInputTokens: 0,
    });
    useActionMock.mockReset();
    stopRunMock.mockReset();
    stopRunMock.mockResolvedValue(true);
    let actionCallIndex = 0;
    useActionMock.mockImplementation(() => {
      const slot = actionCallIndex % 2;
      actionCallIndex += 1;
      return slot === 0 ? uploadAttachmentMock : stopRunMock;
    });
    useMutationMock.mockReset();
    let mutationCallIndex = 0;
    useMutationMock.mockImplementation(() => {
      const normalizedSlot = mutationCallIndex % 9;
      mutationCallIndex += 1;

      switch (normalizedSlot) {
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
      canManage: true,
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

  it('starts sending the first message before the new thread navigation resolves', async () => {
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

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith({
        threadId: 'thread-123',
        text: 'Hold draft until route change',
        attachmentIds: [],
        clientMessageId: expect.any(String),
        ownerSessionId: expect.any(String),
        personaId: undefined,
        model: 'openai/gpt-4o-mini',
        useWebSearch: false,
      });
    });
    expect(messageInput).toHaveValue('');
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

  it('renders the message list while a new thread is still loading if optimistic messages already exist', async () => {
    threadQueryResult = undefined;
    useUIMessagesMock.mockReturnValue({
      results: [
        {
          id: 'user-123',
          _creationTime: 1,
          order: 1,
          stepOrder: 0,
          role: 'user',
          status: 'complete',
          parts: [{ type: 'text', text: 'Start a new conversation' }],
          metadata: { clientMessageId: 'client-123' },
        },
        {
          id: 'assistant-123',
          _creationTime: 2,
          order: 2,
          stepOrder: 0,
          role: 'assistant',
          status: 'pending',
          parts: [{ type: 'text', text: '' }],
          metadata: {},
        },
      ],
      status: 'LoadingFirstPage',
      loadMore: vi.fn(),
    });

    render(
      <ToastProvider>
        <TooltipProvider>
          <ChatWorkspace threadId="thread-123" />
        </TooltipProvider>
      </ToastProvider>,
    );

    await waitFor(() => {
      const props = messageListPropsMock.mock.calls.at(-1)?.[0] as {
        messages: Array<{ role: string; status: string }>;
      };
      expect(props.messages).toEqual([
        expect.objectContaining({ role: 'user', status: 'complete' }),
        expect.objectContaining({ role: 'assistant', status: 'pending' }),
      ]);
    });
  });

  it('renders bootstrap messages immediately for a newly created thread before the feed hydrates', async () => {
    threadQueryResult = undefined;
    useUIMessagesMock.mockReturnValue({
      results: [],
      status: 'LoadingFirstPage',
      loadMore: vi.fn(),
    });
    setOptimisticThreadBootstrap('thread-123', {
      messages: [
        {
          _id: 'optimistic-user-1',
          threadId: 'thread-123',
          order: 1,
          stepOrder: 0,
          role: 'user',
          parts: [{ type: 'text', text: 'Start a new conversation' }],
          status: 'complete',
          createdAt: 1,
          updatedAt: 1,
          clientMessageId: 'client-123',
        },
        {
          _id: 'optimistic-assistant-1',
          threadId: 'thread-123',
          order: 2,
          stepOrder: 0,
          role: 'assistant',
          parts: [{ type: 'text', text: '' }],
          status: 'pending',
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    });

    render(
      <ToastProvider>
        <TooltipProvider>
          <ChatWorkspace threadId="thread-123" />
        </TooltipProvider>
      </ToastProvider>,
    );

    await waitFor(() => {
      const props = messageListPropsMock.mock.calls.at(-1)?.[0] as {
        messages: Array<{ role: string; status: string }>;
      };
      expect(props.messages).toEqual([
        expect.objectContaining({ role: 'user', status: 'complete' }),
        expect.objectContaining({ role: 'assistant', status: 'pending' }),
      ]);
    });
  });

  it('keeps the bootstrap assistant placeholder visible while the hydrated feed only contains the user prompt', async () => {
    useUIMessagesMock.mockReturnValue({
      results: [
        {
          id: 'user-123',
          _creationTime: 1,
          order: 1,
          stepOrder: 0,
          role: 'user',
          status: 'complete',
          parts: [{ type: 'text', text: 'Start a new conversation' }],
          metadata: { clientMessageId: 'client-123' },
        },
      ],
      status: 'Loaded',
      loadMore: vi.fn(),
    });
    setOptimisticThreadBootstrap('thread-123', {
      messages: [
        {
          _id: 'optimistic-user-1',
          threadId: 'thread-123',
          order: 1,
          stepOrder: 0,
          role: 'user',
          parts: [{ type: 'text', text: 'Start a new conversation' }],
          status: 'complete',
          createdAt: 1,
          updatedAt: 1,
          clientMessageId: 'client-123',
        },
        {
          _id: 'optimistic-assistant-1',
          threadId: 'thread-123',
          order: 2,
          stepOrder: 0,
          role: 'assistant',
          parts: [{ type: 'text', text: '' }],
          status: 'pending',
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    });

    render(
      <ToastProvider>
        <TooltipProvider>
          <ChatWorkspace threadId="thread-123" />
        </TooltipProvider>
      </ToastProvider>,
    );

    await waitFor(() => {
      const props = messageListPropsMock.mock.calls.at(-1)?.[0] as {
        messages: Array<{ role: string; status: string }>;
      };
      expect(props.messages).toEqual([
        expect.objectContaining({ role: 'user', status: 'complete' }),
        expect.objectContaining({ role: 'assistant', status: 'pending' }),
      ]);
    });
  });

  it('shows the provider-capacity error when sendMessage fails fast', async () => {
    const user = userEvent.setup();
    sendMessageMock.mockRejectedValueOnce(
      new Error('AI capacity is temporarily full. Try again in 30 seconds.'),
    );

    render(
      <ToastProvider>
        <TooltipProvider>
          <ChatWorkspace threadId="thread-123" />
        </TooltipProvider>
      </ToastProvider>,
    );

    await user.type(screen.getByLabelText('Message'), 'Need a response');
    await user.click(screen.getByLabelText('Send message'));

    expect(
      await screen.findByText('AI capacity is temporarily full. Try again in 30 seconds.'),
    ).toBeInTheDocument();
  });

  it('clears pending web search when the selected model does not support it', async () => {
    const user = userEvent.setup();
    modelOptionsQueryResult = [
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
    ];

    render(
      <ToastProvider>
        <TooltipProvider>
          <ChatWorkspace />
        </TooltipProvider>
      </ToastProvider>,
    );

    await user.click(screen.getByLabelText('Enable web search'));
    expect(screen.getByLabelText('Disable web search')).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByLabelText('Choose model: GPT-4o Mini'));
    await user.click(await screen.findByText('Claude 3.5 Sonnet'));

    await waitFor(() => {
      const button = screen.getByLabelText('Web search unavailable for selected model');
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-pressed', 'false');
    });
  });

  it('stops the active thread by thread id and exits stop mode once the run clears', async () => {
    const user = userEvent.setup();
    activeRunQueryResult = {
      runId: 'run-123',
      status: 'streaming',
      canStop: true,
    };

    const view = render(
      <ToastProvider>
        <TooltipProvider>
          <ChatWorkspace threadId="thread-123" />
        </TooltipProvider>
      </ToastProvider>,
    );

    await user.click(await screen.findByLabelText('Stop generating'));

    expect(stopRunMock).toHaveBeenCalledWith({
      threadId: 'thread-123',
    });

    activeRunQueryResult = null;

    view.rerender(
      <ToastProvider>
        <TooltipProvider>
          <ChatWorkspace threadId="thread-123" />
        </TooltipProvider>
      </ToastProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByLabelText('Stop generating')).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText('Send message')).toBeInTheDocument();
  });

  it('disables the composer when another user owns the active streaming run', () => {
    activeRunQueryResult = {
      runId: 'run-123',
      status: 'streaming',
      canStop: false,
    };

    render(
      <ToastProvider>
        <TooltipProvider>
          <ChatWorkspace threadId="thread-123" />
        </TooltipProvider>
      </ToastProvider>,
    );

    expect(screen.getByLabelText('Send message')).toBeDisabled();
    expect(screen.queryByLabelText('Stop generating')).not.toBeInTheDocument();
  });

  it('shows a run failure banner and retries using the failed run id', async () => {
    const user = userEvent.setup();
    activeRunQueryResult = {
      runId: 'run-999',
      status: 'error',
      canStop: false,
      failureKind: 'provider_policy',
      errorMessage: 'No endpoints available matching your guardrail restrictions and data policy.',
      promptMessageId: 'user-123',
    };
    useUIMessagesMock.mockReturnValue({
      results: [
        {
          id: 'user-123',
          _creationTime: 1,
          order: 1,
          stepOrder: 0,
          role: 'user',
          status: 'complete',
          parts: [{ type: 'text', text: 'Existing thread' }],
          metadata: {},
        },
      ],
      status: 'Loaded',
      loadMore: vi.fn(),
    });

    render(
      <ToastProvider>
        <TooltipProvider>
          <ChatWorkspace threadId="thread-123" />
        </TooltipProvider>
      </ToastProvider>,
    );

    expect(
      screen.getByText('No compatible private endpoint is available for this model.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry response' }));

    expect(retryAssistantResponseMock).toHaveBeenCalledWith({
      runId: 'run-999',
      ownerSessionId: expect.any(String),
      model: 'openai/gpt-4o-mini',
      useWebSearch: false,
    });
  });

  it('dismisses the run failure banner until a newer run appears', async () => {
    const user = userEvent.setup();
    activeRunQueryResult = {
      runId: 'run-999',
      status: 'error',
      canStop: false,
      failureKind: 'unknown',
      errorMessage: 'Streaming failed.',
      promptMessageId: 'user-123',
    };
    useUIMessagesMock.mockReturnValue({
      results: [
        {
          id: 'user-123',
          _creationTime: 1,
          order: 1,
          stepOrder: 0,
          role: 'user',
          status: 'complete',
          parts: [{ type: 'text', text: 'Existing thread' }],
          metadata: {},
        },
      ],
      status: 'Loaded',
      loadMore: vi.fn(),
    });

    const view = render(
      <ToastProvider>
        <TooltipProvider>
          <ChatWorkspace threadId="thread-123" />
        </TooltipProvider>
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByText('The assistant response failed.')).not.toBeInTheDocument();

    activeRunQueryResult = {
      runId: 'run-1000',
      status: 'error',
      canStop: false,
      failureKind: 'provider_unavailable',
      errorMessage: 'No endpoints available for this request.',
      promptMessageId: 'user-123',
    };

    view.rerender(
      <ToastProvider>
        <TooltipProvider>
          <ChatWorkspace threadId="thread-123" />
        </TooltipProvider>
      </ToastProvider>,
    );

    expect(screen.getByText('No compatible endpoint is currently available.')).toBeInTheDocument();
  });
});
