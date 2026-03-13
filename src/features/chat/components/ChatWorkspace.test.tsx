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
const sendChatMessageMock = vi.fn();
const editMessageMock = vi.fn();
const uploadAttachmentMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useAction: (...args: unknown[]) => useActionMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

describe('ChatWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigateMock.mockResolvedValue(undefined);
    sendChatMessageMock.mockResolvedValue({
      threadId: 'thread-123',
      assistantMessageId: 'assistant-123',
    });
    editMessageMock.mockResolvedValue({
      threadId: 'thread-123',
      assistantMessageId: 'assistant-123',
    });
    uploadAttachmentMock.mockResolvedValue(null);
    useQueryMock.mockReturnValue(undefined);

    let actionCallIndex = 0;
    useActionMock.mockImplementation(() => {
      actionCallIndex += 1;
      if (actionCallIndex === 1) {
        return sendChatMessageMock;
      }

      if (actionCallIndex === 2) {
        return editMessageMock;
      }

      return uploadAttachmentMock;
    });

    useMutationMock.mockReturnValue(vi.fn());
  });

  it('creates a new conversation through sendChatMessage without pre-creating a thread', async () => {
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
      expect(sendChatMessageMock).toHaveBeenCalledWith({
        threadId: undefined,
        personaId: undefined,
        model: 'openai/gpt-4o-mini',
        useWebSearch: false,
        text: 'Start a new conversation',
        attachmentIds: [],
        clientMessageId: expect.any(String),
      });
    });

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/app/chat/$threadId',
      params: { threadId: 'thread-123' },
    });
  });
});
