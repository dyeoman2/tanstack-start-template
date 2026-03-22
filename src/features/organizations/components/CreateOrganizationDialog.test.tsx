import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateOrganizationDialog } from './CreateOrganizationDialog';

const {
  navigateMock,
  routerInvalidateMock,
  showToastMock,
  invalidateQueriesMock,
  useQueryMock,
  checkOrganizationSlugMock,
  createOrganizationMock,
  notifyMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  routerInvalidateMock: vi.fn(),
  showToastMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
  useQueryMock: vi.fn(),
  checkOrganizationSlugMock: vi.fn(),
  createOrganizationMock: vi.fn(),
  notifyMock: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
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

vi.mock('~/features/auth/auth-client', () => ({
  authClient: {
    $store: {
      notify: notifyMock,
    },
  },
}));

vi.mock('~/components/ui/toast', () => ({
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

vi.mock('~/features/organizations/server/organization-management', () => ({
  checkOrganizationSlugServerFn: (...args: unknown[]) => checkOrganizationSlugMock(...args),
  createOrganizationServerFn: (...args: unknown[]) => createOrganizationMock(...args),
}));

describe('CreateOrganizationDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkOrganizationSlugMock.mockResolvedValue({
      available: true,
      slug: 'cottage-hospital-12345678',
    });
  });

  it('disables creation and explains the cap when the user is at the limit', () => {
    useQueryMock.mockReturnValue({
      count: 2,
      limit: 2,
      canCreate: false,
      reason: 'You can belong to up to 2 organizations.',
      isUnlimited: false,
    });

    render(<CreateOrganizationDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByText('You can belong to up to 2 organizations.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create organization/i })).toBeDisabled();
  });

  it('creates an organization through the server function when the user is eligible', async () => {
    const user = userEvent.setup();
    useQueryMock.mockReturnValue({
      count: 1,
      limit: 2,
      canCreate: true,
      reason: null,
      isUnlimited: false,
    });
    createOrganizationMock.mockResolvedValueOnce({
      id: 'org-1',
      name: 'Cottage Hospital',
      slug: 'cottage-hospital',
    });

    render(<CreateOrganizationDialog open onOpenChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Cottage Hospital' },
    });
    await user.click(screen.getByRole('button', { name: /create organization/i }));

    await waitFor(() => {
      expect(checkOrganizationSlugMock).toHaveBeenCalledWith({
        data: {
          slug: expect.stringMatching(/^cottage-hospital-/),
        },
      });
      expect(createOrganizationMock).toHaveBeenCalledWith({
        data: {
          name: 'Cottage Hospital',
          slug: 'cottage-hospital-12345678',
        },
      });
    });

    expect(showToastMock).toHaveBeenCalledWith('Organization created successfully.', 'success');
    expect(notifyMock).toHaveBeenCalledWith('$activeOrgSignal');
    expect(notifyMock).toHaveBeenCalledWith('$sessionSignal');
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['organizations'] });
    expect(routerInvalidateMock).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/app/organizations/$slug/settings',
      params: { slug: 'cottage-hospital' },
      state: {
        organizationBreadcrumb: {
          name: 'Cottage Hospital',
          slug: 'cottage-hospital',
        },
      },
    });
  });

  it('surfaces a slug availability error before create when Better Auth rejects the slug', async () => {
    const user = userEvent.setup();
    useQueryMock.mockReturnValue({
      count: 1,
      limit: 2,
      canCreate: true,
      reason: null,
      isUnlimited: false,
    });
    checkOrganizationSlugMock.mockResolvedValueOnce({
      available: false,
      slug: 'cottage-hospital-12345678',
    });

    render(<CreateOrganizationDialog open onOpenChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Cottage Hospital' },
    });
    await user.click(screen.getByRole('button', { name: /create organization/i }));

    await waitFor(() => {
      expect(createOrganizationMock).not.toHaveBeenCalled();
    });

    expect(
      screen.getByText('That organization URL is already in use. Try a different name.'),
    ).toBeInTheDocument();
  });
});
