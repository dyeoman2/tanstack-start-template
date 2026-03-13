import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarProvider } from '~/components/ui/sidebar';
import { ChatSidebarGroup } from '~/features/chat/components/ChatSidebarGroup';

const navigateMock = vi.fn();
const useQueryMock = vi.fn();
const useMutationMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  useLocation: () => ({ pathname: '/app/chat/thread-1' }),
  useNavigate: () => navigateMock,
}));

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock('~/features/chat/lib/optimistic-threads', () => ({
  useOptimisticThreads: () => [],
}));

function createMutationMock(fn: ReturnType<typeof vi.fn>) {
  const mutation = fn as typeof fn & {
    withOptimisticUpdate: (updater: unknown) => typeof fn;
  };
  mutation.withOptimisticUpdate = vi.fn(() => fn);
  return mutation;
}

describe('ChatSidebarGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useQueryMock.mockReturnValue([]);
    useMutationMock.mockImplementation(() => createMutationMock(vi.fn()));
  });

  it('renders an explicit New chat button in the expanded sidebar', () => {
    render(
      <SidebarProvider defaultOpen>
        <ChatSidebarGroup />
      </SidebarProvider>,
    );

    expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument();
    expect(screen.getByText('New chat')).toBeInTheDocument();
  });

  it('keeps the collapsed New chat control accessible and navigates to the new-thread route', async () => {
    const user = userEvent.setup();

    render(
      <SidebarProvider defaultOpen={false}>
        <ChatSidebarGroup />
      </SidebarProvider>,
    );

    const button = screen.getByRole('button', { name: 'New chat' });

    expect(screen.queryByText('New chat')).not.toBeInTheDocument();
    expect(button).toHaveAttribute('title', 'New chat');

    await user.click(button);

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/app/chat',
      search: { new: true },
    });
  });
});
