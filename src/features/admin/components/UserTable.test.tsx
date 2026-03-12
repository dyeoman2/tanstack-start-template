import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { USER_ROLES } from '~/features/auth/types';
import { UserTable } from './UserTable';

const navigateMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  Link: ({
    children,
    to,
    params,
    ...props
  }: PropsWithChildren<{
    to: string;
    params?: { slug?: string };
  }>) => {
    const href = params?.slug ? to.replace('$slug', params.slug) : to;
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
}));

const baseProps = {
  pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
  searchParams: {
    page: 1,
    pageSize: 10,
    sortBy: 'name' as const,
    sortOrder: 'asc' as const,
    secondarySortBy: 'email' as const,
    secondarySortOrder: 'asc' as const,
    search: '',
    role: 'all' as const,
  },
  isLoading: false,
  onEditUser: vi.fn(),
  onDeleteUser: vi.fn(),
  onManageBan: vi.fn(),
  onManageSessions: vi.fn(),
  onResetPassword: vi.fn(),
  onImpersonateUser: vi.fn(),
  pendingImpersonationUserId: null,
};

function renderTable(users: Parameters<typeof UserTable>[0]['users'], currentUserId?: string) {
  const queryClient = new QueryClient();

  return render(
    <QueryClientProvider client={queryClient}>
      <UserTable {...baseProps} users={users} currentUserId={currentUserId} />
    </QueryClientProvider>,
  );
}

describe('UserTable', () => {
  it('does not show impersonate for admin rows', async () => {
    const user = userEvent.setup();

    renderTable([
      {
        id: 'admin-1',
        email: 'admin@example.com',
        name: 'Admin',
        role: USER_ROLES.ADMIN,
        emailVerified: true,
        banned: false,
        banReason: null,
        banExpires: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        organizations: [],
      },
    ]);

    const row = screen.getByRole('row', { name: /admin admin@example.com/i });
    await user.click(within(row).getByRole('button', { name: 'More actions' }));

    expect(screen.queryByRole('menuitem', { name: /impersonate user/i })).not.toBeInTheDocument();
  });

  it('does not show impersonate for the current user row', async () => {
    const user = userEvent.setup();

    renderTable(
      [
        {
          id: 'user-1',
          email: 'me@example.com',
          name: 'Me',
          role: USER_ROLES.USER,
          emailVerified: true,
          banned: false,
          banReason: null,
          banExpires: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          organizations: [],
        },
      ],
      'user-1',
    );

    const row = screen.getByRole('row', { name: /me me@example.com/i });
    await user.click(within(row).getByRole('button', { name: 'More actions' }));

    expect(screen.queryByRole('menuitem', { name: /impersonate user/i })).not.toBeInTheDocument();
  });

  it('shows unban instead of ban for banned users', async () => {
    const user = userEvent.setup();

    renderTable([
      {
        id: 'user-2',
        email: 'banned@example.com',
        name: 'Banned User',
        role: USER_ROLES.USER,
        emailVerified: true,
        banned: true,
        banReason: 'Abuse',
        banExpires: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        organizations: [],
      },
    ]);

    const row = screen.getByRole('row', { name: /banned user banned@example.com/i });
    await user.click(within(row).getByRole('button', { name: 'More actions' }));

    expect(screen.getByRole('menuitem', { name: /unban user/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^ban user$/i })).not.toBeInTheDocument();
  });

  it('renders organization avatars as links', () => {
    renderTable([
      {
        id: 'user-3',
        email: 'member@example.com',
        name: 'Member User',
        role: USER_ROLES.USER,
        emailVerified: true,
        banned: false,
        banReason: null,
        banExpires: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        organizations: [
          {
            id: 'org-1',
            slug: 'cottage-hospital',
            name: 'Cottage Hospital',
            logo: null,
          },
        ],
      },
    ]);

    expect(screen.getByRole('link', { name: /open cottage hospital/i })).toHaveAttribute(
      'href',
      '/app/organizations/cottage-hospital/settings',
    );
  });
});
