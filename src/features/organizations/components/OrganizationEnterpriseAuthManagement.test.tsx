import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationEnterpriseAuthManagement } from './OrganizationEnterpriseAuthManagement';

const {
  routerInvalidateMock,
  useQueryMock,
  invalidateQueriesMock,
  showToastMock,
  notifyMock,
  updatePoliciesMock,
  generateScimTokenMock,
  deleteScimProviderMock,
} = vi.hoisted(() => ({
  routerInvalidateMock: vi.fn(),
  useQueryMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
  showToastMock: vi.fn(),
  notifyMock: vi.fn(),
  updatePoliciesMock: vi.fn(),
  generateScimTokenMock: vi.fn(),
  deleteScimProviderMock: vi.fn(),
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
  generateOrganizationScimTokenServerFn: (...args: unknown[]) => generateScimTokenMock(...args),
  deleteOrganizationScimProviderServerFn: (...args: unknown[]) => deleteScimProviderMock(...args),
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
      enterpriseProviderKey: null,
      enterpriseProtocol: null,
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
      {
        key: 'entra',
        label: 'Microsoft Entra ID',
        protocol: 'oidc',
        status: 'coming_soon',
        selectable: false,
      },
      {
        key: 'okta',
        label: 'Okta',
        protocol: 'oidc',
        status: 'coming_soon',
        selectable: false,
      },
    ],
    ...(overrides ?? {}),
  };
}

describe('OrganizationEnterpriseAuthManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useQueryMock.mockReturnValue(buildSettings());
  });

  it('renders updated enterprise headings and separates planned providers', () => {
    render(<OrganizationEnterpriseAuthManagement slug="cottage-hospital" />);

    expect(screen.getByText('SSO & provisioning overview')).toBeInTheDocument();
    expect(screen.getByText('Single sign-on')).toBeInTheDocument();
    expect(screen.getByText('User provisioning')).toBeInTheDocument();
    expect(screen.getByText('Identity provider')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Configure' })).toBeEnabled();
    expect(screen.getByText('Planned providers')).toBeInTheDocument();
    expect(screen.getByText('Microsoft Entra ID')).toBeInTheDocument();
    expect(screen.getByText('Okta')).toBeInTheDocument();
  });

  it('shows the required-SSO prerequisite warning when no verified domains exist', async () => {
    const user = userEvent.setup();

    render(<OrganizationEnterpriseAuthManagement slug="cottage-hospital" />);

    await user.click(screen.getByRole('radio', { name: /SSO required/ }));

    expect(
      screen.getByText('Add and verify a company domain before saving required SSO.'),
    ).toBeInTheDocument();
  });

  it('renders the emergency admin sign-in copy', () => {
    render(<OrganizationEnterpriseAuthManagement slug="cottage-hospital" />);

    expect(screen.getByText('Keep emergency admin sign-in enabled')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Allow organization owners to sign in with password if your identity provider is unavailable.',
      ),
    ).toBeInTheDocument();
  });

  it('hides SCIM setup details until provisioning is configured or started', async () => {
    const user = userEvent.setup();
    generateScimTokenMock.mockResolvedValueOnce({ scimToken: 'scim-secret-token' });

    render(<OrganizationEnterpriseAuthManagement slug="cottage-hospital" />);

    expect(screen.queryByText('SCIM base URL')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /set up provisioning/i }));

    await waitFor(() => {
      expect(generateScimTokenMock).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          providerKey: 'google-workspace',
        },
      });
    });

    expect(screen.getByText('SCIM base URL')).toBeInTheDocument();
    expect(screen.getByText('Provisioning token')).toBeInTheDocument();
  });

  it('disables saving when no actionable identity provider is available', () => {
    useQueryMock.mockReturnValue(
      buildSettings({
        availableEnterpriseProviders: [
          {
            key: 'google-workspace',
            label: 'Google Workspace',
            protocol: 'oidc',
            status: 'not_configured',
            selectable: false,
          },
          {
            key: 'entra',
            label: 'Microsoft Entra ID',
            protocol: 'oidc',
            status: 'coming_soon',
            selectable: false,
          },
          {
            key: 'okta',
            label: 'Okta',
            protocol: 'oidc',
            status: 'coming_soon',
            selectable: false,
          },
        ],
      }),
    );

    render(<OrganizationEnterpriseAuthManagement slug="cottage-hospital" />);

    expect(screen.getByRole('button', { name: /save sso settings/i })).toBeDisabled();
  });
});
