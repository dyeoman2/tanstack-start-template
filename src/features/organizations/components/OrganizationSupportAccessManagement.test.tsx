import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationSupportAccessManagement } from './OrganizationSupportAccessManagement';

const {
  routerInvalidateMock,
  useQueryMock,
  invalidateQueriesMock,
  showToastMock,
  notifyMock,
  createGrantMock,
  revokeGrantMock,
} = vi.hoisted(() => ({
  routerInvalidateMock: vi.fn(),
  useQueryMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
  showToastMock: vi.fn(),
  notifyMock: vi.fn(),
  createGrantMock: vi.fn(),
  revokeGrantMock: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
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

vi.mock('~/features/organizations/server/organization-management', () => ({
  createOrganizationSupportAccessGrantServerFn: (...args: unknown[]) => createGrantMock(...args),
  revokeOrganizationSupportAccessGrantServerFn: (...args: unknown[]) => revokeGrantMock(...args),
}));

vi.mock('~/components/ui/toast', () => ({
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

function buildSettings(overrides?: Record<string, unknown>) {
  return {
    organization: {
      id: 'org-1',
      slug: 'cottage-hospital',
      name: 'Cottage Hospital',
      logo: null,
    },
    canManageSupportAccess: true,
    availableSiteAdmins: [
      {
        authUserId: 'site-admin-1',
        email: 'support@example.com',
        name: 'Support Admin',
      },
    ],
    grants: [
      {
        id: 'grant-1',
        createdAt: 1,
        expiresAt: Date.now() + 60_000,
        grantedByEmail: 'owner@example.com',
        grantedByName: 'Owner',
        grantedByUserId: 'owner-1',
        reason: 'Investigate tenant issue',
        revokedAt: null,
        revokedByEmail: null,
        revokedByName: null,
        revokedByUserId: null,
        scope: 'read_only',
        siteAdminEmail: 'support@example.com',
        siteAdminName: 'Support Admin',
        siteAdminUserId: 'site-admin-1',
      },
    ],
    ...overrides,
  };
}

describe('OrganizationSupportAccessManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useQueryMock.mockReturnValue(buildSettings());
  });

  it('creates temporary support grants', async () => {
    const user = userEvent.setup();

    render(<OrganizationSupportAccessManagement slug="cottage-hospital" />);

    await user.type(
      screen.getByLabelText('Reason'),
      'Investigate incident INC-42 and confirm document intake state.',
    );
    await user.click(screen.getByRole('button', { name: 'Issue temporary grant' }));

    await waitFor(() => {
      expect(createGrantMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org-1',
          siteAdminUserId: 'site-admin-1',
          scope: 'read_only',
          reason: 'Investigate incident INC-42 and confirm document intake state.',
        }),
      });
    });
    expect(showToastMock).toHaveBeenCalledWith('Support access grant created.', 'success');
  });

  it('revokes active grants', async () => {
    const user = userEvent.setup();

    render(<OrganizationSupportAccessManagement slug="cottage-hospital" />);

    await user.click(screen.getByRole('button', { name: 'Revoke' }));

    await waitFor(() => {
      expect(revokeGrantMock).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          grantId: 'grant-1',
          reason: 'Owner revoked support access.',
        },
      });
    });
    expect(showToastMock).toHaveBeenCalledWith('Support access grant revoked.', 'success');
  });
});
