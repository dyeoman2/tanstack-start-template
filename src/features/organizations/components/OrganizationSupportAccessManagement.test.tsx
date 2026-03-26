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
  createSupportAccessStepUpMock,
  createGrantMock,
  revokeGrantMock,
  updatePolicyMock,
} = vi.hoisted(() => ({
  routerInvalidateMock: vi.fn(),
  useQueryMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
  showToastMock: vi.fn(),
  notifyMock: vi.fn(),
  createSupportAccessStepUpMock: vi.fn(),
  createGrantMock: vi.fn(),
  revokeGrantMock: vi.fn(),
  updatePolicyMock: vi.fn(),
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

vi.mock('~/features/auth/server/step-up', () => ({
  createSupportAccessApprovalStepUpChallengeServerFn: (...args: unknown[]) =>
    createSupportAccessStepUpMock(...args),
}));

vi.mock('~/features/organizations/server/organization-management', () => ({
  createOrganizationSupportAccessGrantServerFn: (...args: unknown[]) => createGrantMock(...args),
  revokeOrganizationSupportAccessGrantServerFn: (...args: unknown[]) => revokeGrantMock(...args),
  updateOrganizationSupportAccessPolicyServerFn: (...args: unknown[]) => updatePolicyMock(...args),
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
    approvalModel: 'single_owner',
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
        approvalMethod: 'single_owner',
        approvedAt: 1,
        createdAt: 1,
        expiresAt: Date.now() + 60_000,
        expiredNotificationSentAt: null,
        firstUsedAt: null,
        grantedByEmail: 'owner@example.com',
        grantedByName: 'Owner',
        grantedByUserId: 'owner-1',
        reason: 'Investigate tenant issue',
        reasonCategory: 'incident_response',
        reasonDetails: 'Investigate tenant issue',
        lastUsedAt: null,
        revokedAt: null,
        revokedByEmail: null,
        revokedByName: null,
        revocationReason: null,
        revokedByUserId: null,
        scope: 'read_only',
        siteAdminEmail: 'support@example.com',
        siteAdminName: 'Support Admin',
        siteAdminUserId: 'site-admin-1',
        ticketId: 'INC-17',
        useCount: 0,
      },
    ],
    supportAccessEnabled: true,
    stepUpSatisfied: true,
    stepUpValidUntil: Date.now() + 5 * 60_000,
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

    await user.type(screen.getByLabelText('Ticket ID'), 'INC-42');
    await user.type(
      screen.getByLabelText('Reason details'),
      'Investigate incident INC-42 and confirm document intake state.',
    );
    await user.click(screen.getByRole('button', { name: 'Issue temporary grant' }));

    await waitFor(() => {
      expect(createGrantMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org-1',
          siteAdminUserId: 'site-admin-1',
          scope: 'read_only',
          reasonCategory: 'incident_response',
          ticketId: 'INC-42',
          reasonDetails: 'Investigate incident INC-42 and confirm document intake state.',
        }),
      });
    });
    expect(showToastMock).toHaveBeenCalledWith('Support access grant created.', 'success');
  });

  it('revokes active grants', async () => {
    const user = userEvent.setup();

    render(<OrganizationSupportAccessManagement slug="cottage-hospital" />);

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await user.type(
      screen.getByLabelText('Revoke reason'),
      'Issue resolved and the provider no longer needs temporary access.',
    );
    await user.click(screen.getByRole('button', { name: 'Confirm revoke' }));

    await waitFor(() => {
      expect(revokeGrantMock).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          grantId: 'grant-1',
          reason: 'Issue resolved and the provider no longer needs temporary access.',
        },
      });
    });
    expect(showToastMock).toHaveBeenCalledWith('Support access grant revoked.', 'success');
  });
});
