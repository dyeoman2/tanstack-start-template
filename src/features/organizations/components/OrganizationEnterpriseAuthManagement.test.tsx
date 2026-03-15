import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@testing-library/react';
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

    expect(screen.getByText('Step 1: identity provider')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Identity provider' })).toBeInTheDocument();
  });

  it('does not render a save button when no actionable identity provider is available', () => {
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

    expect(screen.queryByRole('button', { name: /save identity provider/i })).not.toBeInTheDocument();
  });

  it('keeps Google Workspace selectable even when it is not yet configured', () => {
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

    expect(screen.getByRole('radio', { name: /google workspace/i })).toBeInTheDocument();
  });

  it('shows the saved provider as selected', () => {
    useQueryMock.mockReturnValue(
      buildSettings({
        policies: { enterpriseProviderKey: 'google-workspace' },
      }),
    );

    render(<OrganizationEnterpriseAuthManagement slug="cottage-hospital" />);

    expect(screen.getByRole('radio', { name: /google workspace/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('saves immediately and shows a success toast when a selectable provider is chosen', async () => {
    const user = userEvent.setup();

    useQueryMock.mockReturnValue(
      buildSettings({
        policies: { enterpriseProviderKey: 'google-workspace' },
        availableEnterpriseProviders: [
          {
            key: 'google-workspace',
            label: 'Google Workspace',
            protocol: 'oidc',
            status: 'active',
            selectable: true,
          },
          {
            key: 'okta',
            label: 'Okta',
            protocol: 'oidc',
            status: 'active',
            selectable: true,
          },
        ],
      }),
    );

    render(<OrganizationEnterpriseAuthManagement slug="cottage-hospital" />);

    await user.click(screen.getByRole('radio', { name: /okta/i }));

    await waitFor(() => {
      expect(updatePoliciesMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org-1',
          enterpriseProviderKey: 'okta',
          enterpriseProtocol: 'oidc',
        }),
      });
    });
    expect(showToastMock).toHaveBeenCalledWith('Identity provider updated.', 'success');
    expect(screen.getByRole('radio', { name: /okta/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('does not auto-save when the selected provider is not yet actionable', async () => {
    const user = userEvent.setup();

    useQueryMock.mockReturnValue(
      buildSettings({
        policies: { enterpriseProviderKey: 'google-workspace' },
        availableEnterpriseProviders: [
          {
            key: 'google-workspace',
            label: 'Google Workspace',
            protocol: 'oidc',
            status: 'active',
            selectable: true,
          },
          {
            key: 'okta',
            label: 'Okta',
            protocol: 'oidc',
            status: 'not_configured',
            selectable: false,
          },
        ],
      }),
    );

    render(<OrganizationEnterpriseAuthManagement slug="cottage-hospital" />);

    await user.click(screen.getByRole('radio', { name: /okta/i }));

    expect(updatePoliciesMock).not.toHaveBeenCalled();
    expect(showToastMock).not.toHaveBeenCalledWith('Identity provider updated.', 'success');
    expect(screen.getByText(/Okta is not configured for this deployment yet/i)).toBeInTheDocument();
  });

  it('clears the selected provider when the saved card is clicked again', async () => {
    const user = userEvent.setup();

    useQueryMock.mockReturnValue(
      buildSettings({
        policies: { enterpriseProviderKey: 'google-workspace' },
        availableEnterpriseProviders: [
          {
            key: 'google-workspace',
            label: 'Google Workspace',
            protocol: 'oidc',
            status: 'active',
            selectable: true,
          },
        ],
      }),
    );

    render(<OrganizationEnterpriseAuthManagement slug="cottage-hospital" />);

    await user.click(screen.getByRole('radio', { name: /google workspace/i }));

    await waitFor(() => {
      expect(updatePoliciesMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org-1',
          enterpriseProviderKey: null,
          enterpriseProtocol: null,
        }),
      });
    });
    expect(showToastMock).toHaveBeenCalledWith('Identity provider removed.', 'success');
  });

  it('shows a spinner on the clicked card while deselecting the saved provider', async () => {
    const user = userEvent.setup();
    let resolveUpdate!: () => void;
    updatePoliciesMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveUpdate = resolve;
        }),
    );

    useQueryMock.mockReturnValue(
      buildSettings({
        policies: { enterpriseProviderKey: 'google-workspace' },
        availableEnterpriseProviders: [
          {
            key: 'google-workspace',
            label: 'Google Workspace',
            protocol: 'oidc',
            status: 'active',
            selectable: true,
          },
        ],
      }),
    );

    const { container } = render(<OrganizationEnterpriseAuthManagement slug="cottage-hospital" />);

    await user.click(screen.getByRole('radio', { name: /google workspace/i }));

    expect(container.querySelector('.animate-spin')).toBeInTheDocument();

    resolveUpdate();

    await waitFor(() => {
      expect(showToastMock).toHaveBeenCalledWith('Identity provider removed.', 'success');
    });
  });

});
