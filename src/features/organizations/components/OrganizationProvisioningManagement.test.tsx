import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationProvisioningManagement } from './OrganizationProvisioningManagement';

const {
  routerInvalidateMock,
  useQueryMock,
  invalidateQueriesMock,
  showToastMock,
  notifyMock,
  generateScimTokenMock,
  deleteScimProviderMock,
} = vi.hoisted(() => ({
  routerInvalidateMock: vi.fn(),
  useQueryMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
  showToastMock: vi.fn(),
  notifyMock: vi.fn(),
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
      enterpriseProviderKey: 'google-workspace' as const,
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
    ...(overrides ?? {}),
  };
}

describe('OrganizationProvisioningManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useQueryMock.mockReturnValue(buildSettings());
  });

  it('renders provisioning as a later setup step', () => {
    render(<OrganizationProvisioningManagement slug="cottage-hospital" />);

    expect(screen.getByText('Step 4: Provisioning')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Optional: automatically create and update users from your identity provider using SCIM.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('SCIM endpoint URL')).toBeInTheDocument();
  });

  it('shows the endpoint immediately and reveals the token after generation', async () => {
    const user = userEvent.setup();
    generateScimTokenMock.mockResolvedValueOnce({ scimToken: 'scim-secret-token' });

    render(<OrganizationProvisioningManagement slug="cottage-hospital" />);

    expect(screen.getByText('SCIM endpoint URL')).toBeInTheDocument();
    expect(screen.queryByText('scim-secret-token')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^generate token$/i }));

    await waitFor(() => {
      expect(generateScimTokenMock).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          providerKey: 'google-workspace',
        },
      });
    });

    expect(screen.getByText('scim-secret-token')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument();
  });

  it('shows token management copy for an existing provisioning connection', () => {
    useQueryMock.mockReturnValue(
      buildSettings({
        enterpriseAuth: {
          scimConnectionConfigured: true,
        },
      }),
    );

    render(<OrganizationProvisioningManagement slug="cottage-hospital" />);

    expect(screen.getByText(/current bearer token is hidden after setup/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate new token/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /revoke token/i })).toBeInTheDocument();
  });
});
