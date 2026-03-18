import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationSsoEnforcementManagement } from './OrganizationSsoEnforcementManagement';

const {
  routerInvalidateMock,
  useQueryMock,
  invalidateQueriesMock,
  showToastMock,
  notifyMock,
  updatePoliciesMock,
} = vi.hoisted(() => ({
  routerInvalidateMock: vi.fn(),
  useQueryMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
  showToastMock: vi.fn(),
  notifyMock: vi.fn(),
  updatePoliciesMock: vi.fn(),
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
  updateOrganizationPoliciesServerFn: (...args: unknown[]) => updatePoliciesMock(...args),
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
    capabilities: {
      canUpdateSettings: true,
    },
    policies: {
      invitePolicy: 'owners_admins',
      verifiedDomainsOnly: false,
      memberCap: null,
      mfaRequired: false,
      enterpriseAuthMode: 'off',
      enterpriseProviderKey: 'google-workspace',
      enterpriseProtocol: 'oidc',
      allowBreakGlassPasswordLogin: true,
      ...(overrides?.policies as Record<string, unknown> | undefined),
    },
    enterpriseAuth: {
      providerKey: 'google-workspace',
      providerLabel: 'Google Workspace',
      protocol: 'oidc',
      providerStatus: 'active',
      managedDomains: [],
      scimProviderId: 'google-workspace--org-1',
      scimConnectionConfigured: false,
      ...(overrides?.enterpriseAuth as Record<string, unknown> | undefined),
    },
    availableEnterpriseProviders: [
      {
        key: 'google-workspace',
        label: 'Google Workspace',
        protocol: 'oidc',
        status: 'active',
        selectable: true,
      },
    ],
    ...overrides,
  };
}

describe('OrganizationSsoEnforcementManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useQueryMock.mockReturnValue(buildSettings());
  });

  it('renders enforcement as a later step', () => {
    render(<OrganizationSsoEnforcementManagement slug="cottage-hospital" />);

    expect(screen.getByText('Step 3: Enforcement')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Enforcement' })).toBeInTheDocument();
    expect(screen.getByText('Allow email and password sign-in for all users.')).toBeInTheDocument();
  });

  it('renders the enforced no-break-glass copy when SSO is required', () => {
    useQueryMock.mockReturnValue(
      buildSettings({
        policies: {
          enterpriseAuthMode: 'required',
        },
      }),
    );

    render(<OrganizationSsoEnforcementManagement slug="cottage-hospital" />);

    expect(screen.getByText('Emergency password fallback disabled')).toBeInTheDocument();
    expect(
      screen.queryByRole('switch', { name: 'Keep Emergency Admin Sign-In Enabled' }),
    ).not.toBeInTheDocument();
  });

  it('hides the emergency admin sign-in switch unless SSO is required', () => {
    render(<OrganizationSsoEnforcementManagement slug="cottage-hospital" />);

    expect(
      screen.queryByRole('switch', { name: 'Keep Emergency Admin Sign-In Enabled' }),
    ).not.toBeInTheDocument();
  });

  it('saves immediately when a new enforcement option is selected', async () => {
    const user = userEvent.setup();

    render(<OrganizationSsoEnforcementManagement slug="cottage-hospital" />);

    await user.click(screen.getByRole('radio', { name: /sso preferred/i }));

    await waitFor(() => {
      expect(updatePoliciesMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org-1',
          enterpriseAuthMode: 'optional',
          enterpriseProviderKey: 'google-workspace',
        }),
      });
    });
    expect(showToastMock).toHaveBeenCalledWith('SSO enforcement updated.', 'success');
  });
});
