import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationEnterpriseAuthManagement } from './OrganizationEnterpriseAuthManagement';

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

    expect(screen.getByText('Single sign-on')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Identity provider' })).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();
  });

  it('shows the required-SSO prerequisite warning when no verified domains exist', async () => {
    render(<OrganizationEnterpriseAuthManagement slug="cottage-hospital" />);

    expect(screen.getByRole('combobox', { name: 'Enforcement' })).toBeInTheDocument();
    expect(screen.getByText('Allow email and password sign-in for all users.')).toBeInTheDocument();
  });

  it('renders the emergency admin sign-in copy', () => {
    useQueryMock.mockReturnValue(
      buildSettings({
        policies: {
          enterpriseAuthMode: 'required',
        },
      }),
    );

    render(<OrganizationEnterpriseAuthManagement slug="cottage-hospital" />);

    expect(screen.getByText('Keep emergency admin sign-in enabled')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Keep emergency admin sign-in enabled' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Allow organization owners to bypass required SSO if your identity provider is unavailable.',
      ),
    ).toBeInTheDocument();
  });

  it('hides the emergency admin sign-in switch unless SSO is required', () => {
    render(<OrganizationEnterpriseAuthManagement slug="cottage-hospital" />);

    expect(
      screen.queryByRole('switch', { name: 'Keep emergency admin sign-in enabled' }),
    ).not.toBeInTheDocument();
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

  it('keeps Google Workspace in the primary area even when it is not yet selectable', () => {
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

    expect(screen.getAllByText('Google Workspace').length).toBeGreaterThan(0);
    expect(screen.getByText('Not configured')).toBeInTheDocument();
  });

  it('shows the selected provider in the select field', () => {
    render(<OrganizationEnterpriseAuthManagement slug="cottage-hospital" />);

    expect(screen.getByRole('combobox', { name: 'Identity provider' })).toHaveTextContent(
      'Google Workspace',
    );
  });

});
