import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationPoliciesPage } from './OrganizationPoliciesPage';

const {
  applyHoldMock,
  releaseHoldMock,
  routerInvalidateMock,
  showToastMock,
  useQueryMock,
  updatePoliciesMock,
  invalidateQueriesMock,
  notifyMock,
  locationMock,
} = vi.hoisted(() => ({
  applyHoldMock: vi.fn(),
  releaseHoldMock: vi.fn(),
  routerInvalidateMock: vi.fn(),
  showToastMock: vi.fn(),
  useQueryMock: vi.fn(),
  updatePoliciesMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
  notifyMock: vi.fn(),
  locationMock: {
    pathname: '/app/organizations/cottage-hospital/policies',
    state: {},
  },
}));

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: routerInvalidateMock }),
  useLocation: () => locationMock,
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
  applyOrganizationLegalHoldServerFn: (...args: unknown[]) => applyHoldMock(...args),
  releaseOrganizationLegalHoldServerFn: (...args: unknown[]) => releaseHoldMock(...args),
  updateOrganizationPoliciesServerFn: (...args: unknown[]) => updatePoliciesMock(...args),
}));

vi.mock('~/components/ui/toast', () => ({
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

vi.mock('~/features/organizations/components/OrganizationWorkspaceTabs', () => ({
  OrganizationWorkspaceTabs: () => <div>Organization tabs</div>,
}));

describe('OrganizationPoliciesPage', () => {
  function buildSettingsResponse() {
    return {
      organization: {
        id: 'org-1',
        slug: 'cottage-hospital',
        name: 'Cottage Hospital',
        logo: null,
      },
      access: {
        admin: true,
        delete: true,
        edit: true,
        view: true,
        siteAdmin: true,
      },
      capabilities: {
        availableInviteRoles: ['owner', 'admin', 'member'],
        canInvite: true,
        canUpdateSettings: true,
        canDeleteOrganization: true,
        canLeaveOrganization: true,
        canManageMembers: true,
        canManageDomains: true,
        canViewAudit: true,
        canManagePolicies: true,
      },
      policies: {
        invitePolicy: 'owners_admins',
        verifiedDomainsOnly: false,
        memberCap: null,
        mfaRequired: false,
        enterpriseAuthMode: 'off',
        enterpriseProviderKey: null,
        enterpriseProtocol: null,
        allowBreakGlassPasswordLogin: true,
        dataRetentionDays: 30,
      },
      isMember: true,
      viewerRole: 'site-admin' as const,
      canManage: true,
    };
  }

  function mockPageQueries(legalHold: unknown = null) {
    const settingsResponse = buildSettingsResponse();
    let callCount = 0;
    useQueryMock.mockImplementation(() => {
      callCount += 1;
      const position = (callCount - 1) % 3;
      if (position === 0) {
        return settingsResponse;
      }
      if (position === 1) {
        return undefined;
      }
      return legalHold;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockPageQueries(null);
  });

  it('updates organization policies from the dedicated page', async () => {
    const user = userEvent.setup();
    updatePoliciesMock.mockResolvedValueOnce({ success: true });

    render(<OrganizationPoliciesPage slug="cottage-hospital" />);

    await user.click(screen.getByRole('checkbox', { name: /require verified domains/i }));
    fireEvent.change(screen.getByLabelText(/member cap/i), {
      target: { value: '25' },
    });
    await user.click(screen.getByRole('button', { name: /save access policies/i }));

    await waitFor(() => {
      expect(updatePoliciesMock).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          invitePolicy: 'owners_admins',
          verifiedDomainsOnly: true,
          memberCap: 25,
          mfaRequired: false,
          enterpriseAuthMode: 'off',
          enterpriseProviderKey: null,
          enterpriseProtocol: null,
          allowBreakGlassPasswordLogin: true,
        },
      });
    });
    expect(screen.getByText(/always enforced/i)).toBeInTheDocument();
    expect(showToastMock).toHaveBeenCalledWith('Organization policies updated.', 'success');
    expect(notifyMock).toHaveBeenCalledWith('$activeOrgSignal');
    expect(notifyMock).toHaveBeenCalledWith('$sessionSignal');
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['organizations'] });
    expect(routerInvalidateMock).toHaveBeenCalled();
    expect(
      screen.getAllByText(/legal holds pause destructive chat retention/i).length,
    ).toBeGreaterThan(0);
  });

  it('applies an organization legal hold from the policies page', async () => {
    const user = userEvent.setup();
    applyHoldMock.mockResolvedValueOnce({ success: true });
    mockPageQueries(null);

    render(<OrganizationPoliciesPage slug="cottage-hospital" />);

    fireEvent.change(screen.getByLabelText(/hold reason/i), {
      target: { value: 'Preserve records for pending litigation' },
    });
    await user.click(screen.getByRole('button', { name: /apply hold/i }));

    await waitFor(() => {
      expect(applyHoldMock).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          reason: 'Preserve records for pending litigation',
        },
      });
    });
    expect(showToastMock).toHaveBeenCalledWith('Retention hold applied.', 'success');
    expect(routerInvalidateMock).toHaveBeenCalled();
  });

  it('releases an active organization legal hold from the policies page', async () => {
    const user = userEvent.setup();
    releaseHoldMock.mockResolvedValueOnce({ success: true });
    mockPageQueries({
      id: 'hold-1',
      organizationId: 'org-1',
      reason: 'Preserve records for pending litigation',
      status: 'active',
      openedAt: 1_710_000_000_000,
      openedByUserId: 'user-1',
      releasedAt: null,
      releasedByUserId: null,
    });

    render(<OrganizationPoliciesPage slug="cottage-hospital" />);

    await user.click(screen.getByRole('button', { name: /release hold/i }));

    await waitFor(() => {
      expect(releaseHoldMock).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
        },
      });
    });
    expect(showToastMock).toHaveBeenCalledWith('Retention hold released.', 'success');
    expect(routerInvalidateMock).toHaveBeenCalled();
  });
});
