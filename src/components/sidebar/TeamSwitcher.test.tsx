import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarProvider } from '~/components/ui/sidebar';
import { OrganizationSwitcher } from './TeamSwitcher';

const {
  navigateMock,
  routerInvalidateMock,
  showToastMock,
  invalidateQueriesMock,
  useQueryMock,
  useListOrganizationsMock,
  useActiveOrganizationMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  routerInvalidateMock: vi.fn(),
  showToastMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
  useQueryMock: vi.fn(),
  useListOrganizationsMock: vi.fn(),
  useActiveOrganizationMock: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: '/app/organizations' }),
  useNavigate: () => navigateMock,
  useRouter: () => ({ invalidate: routerInvalidateMock }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: invalidateQueriesMock,
  }),
}));

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock('~/components/ui/toast', () => ({
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

vi.mock('~/features/auth/auth-client', () => ({
  authClient: {
    organization: {
      setActive: vi.fn(),
    },
  },
  authHooks: {
    useListOrganizations: () => useListOrganizationsMock(),
    useActiveOrganization: () => useActiveOrganizationMock(),
  },
}));

describe('OrganizationSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useListOrganizationsMock.mockReturnValue({
      data: [{ id: 'org-1', slug: 'cottage-hospital', name: 'Cottage Hospital' }],
      isPending: false,
    });
    useActiveOrganizationMock.mockReturnValue({
      data: { id: 'org-1', slug: 'cottage-hospital', name: 'Cottage Hospital' },
    });
  });

  it('disables the add organization action when the user is at the cap', async () => {
    const user = userEvent.setup();
    useQueryMock.mockReturnValue({
      count: 2,
      limit: 2,
      canCreate: false,
      reason: 'You can belong to up to 2 organizations.',
      isUnlimited: false,
    });

    render(
      <SidebarProvider defaultOpen>
        <OrganizationSwitcher />
      </SidebarProvider>,
    );

    await user.click(screen.getByRole('button', { name: /cottage hospital/i }));

    const item = screen.getByRole('menuitem', {
      name: /you can belong to up to 2 organizations\./i,
    });
    expect(item).toHaveAttribute('data-disabled', '');
  });

  it('keeps the add organization action enabled for unlimited creators', async () => {
    const user = userEvent.setup();
    useQueryMock.mockReturnValue({
      count: 4,
      limit: null,
      canCreate: true,
      reason: null,
      isUnlimited: true,
    });

    render(
      <SidebarProvider defaultOpen>
        <OrganizationSwitcher />
      </SidebarProvider>,
    );

    await user.click(screen.getByRole('button', { name: /cottage hospital/i }));

    expect(screen.getByRole('menuitem', { name: /add organization/i })).not.toHaveAttribute(
      'data-disabled',
    );
  });

  it('shows an explicit empty current-org state when no active organization is set', () => {
    useQueryMock.mockReturnValue({
      count: 1,
      limit: 2,
      canCreate: true,
      reason: null,
      isUnlimited: false,
    });
    useActiveOrganizationMock.mockReturnValue({
      data: null,
    });

    render(
      <SidebarProvider defaultOpen>
        <OrganizationSwitcher />
      </SidebarProvider>,
    );

    expect(screen.getByRole('button', { name: /select organization/i })).toBeInTheDocument();
    expect(screen.getByText('Choose a workspace')).toBeInTheDocument();
  });
});
