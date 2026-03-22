import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationDomainManagement } from './OrganizationDomainManagement';

const {
  addDomainMock,
  removeDomainMock,
  regenerateTokenMock,
  verifyDomainMock,
  detectDnsProviderMock,
  useQueryMock,
  useMutationMock,
  useActionMock,
  mutationHookCallCount,
  actionHookCallCount,
  invalidateQueriesMock,
  showToastMock,
} = vi.hoisted(() => ({
  addDomainMock: vi.fn(),
  removeDomainMock: vi.fn(),
  regenerateTokenMock: vi.fn(),
  verifyDomainMock: vi.fn(),
  detectDnsProviderMock: vi.fn(),
  useQueryMock: vi.fn(),
  useMutationMock: vi.fn(),
  useActionMock: vi.fn(),
  mutationHookCallCount: { value: 0 },
  actionHookCallCount: { value: 0 },
  invalidateQueriesMock: vi.fn(),
  showToastMock: vi.fn(),
}));

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
  useAction: (reference: unknown) => useActionMock(reference),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: invalidateQueriesMock,
  }),
}));

vi.mock('~/components/ui/toast', () => ({
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

vi.mock('~/features/auth/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { email: 'admin@example.com' },
    isAuthenticated: true,
    isPending: false,
    error: null,
  }),
}));

const domainResponse = {
  organization: {
    id: 'org-1',
    slug: 'cottage-hospital',
    name: 'Cottage Hospital',
    logo: null,
  },
  capabilities: {
    canManageDomains: true,
    canViewAudit: true,
  },
  domains: [
    {
      id: 'domain-1',
      organizationId: 'org-1',
      domain: 'example.com',
      normalizedDomain: 'example.com',
      status: 'pending_verification' as const,
      verificationMethod: 'dns_txt' as const,
      verificationToken: 'token-1',
      verificationRecordName: '_ba-verify.example.com',
      verificationRecordValue: 'better-auth-verify=token-1',
      verifiedAt: null,
      createdByUserId: 'user-1',
      createdAt: 1,
    },
  ],
};

describe('OrganizationDomainManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useQueryMock.mockReturnValue(domainResponse);
    detectDnsProviderMock.mockResolvedValue({
      domainId: 'domain-1',
      providerName: null,
      providerUrl: null,
      confidence: null,
    });
    mutationHookCallCount.value = 0;
    actionHookCallCount.value = 0;
    useMutationMock.mockImplementation(() => {
      mutationHookCallCount.value += 1;

      if (mutationHookCallCount.value === 1) {
        return (...args: unknown[]) => addDomainMock(...args);
      }

      if (mutationHookCallCount.value === 2) {
        return (...args: unknown[]) => removeDomainMock(...args);
      }

      return (...args: unknown[]) => regenerateTokenMock(...args);
    });
    useActionMock.mockImplementation(() => {
      actionHookCallCount.value += 1;

      if (actionHookCallCount.value === 1) {
        return (...args: unknown[]) => verifyDomainMock(...args);
      }

      return (...args: unknown[]) => detectDnsProviderMock(...args);
    });
  });

  it('renders verification details for existing domains', () => {
    render(<OrganizationDomainManagement slug="cottage-hospital" />);

    expect(screen.getByText('Step 2: Verify Domains')).toBeInTheDocument();
    expect(screen.getByText('example.com')).toBeInTheDocument();
    expect(screen.getByText('_ba-verify.example.com')).toBeInTheDocument();
    expect(screen.getByText('better-auth-verify=token-1')).toBeInTheDocument();
    expect(screen.getByText('Check DNS Record')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add another domain/i })).toBeEnabled();
  });

  it('shows the likely DNS provider hint when one can be inferred', async () => {
    detectDnsProviderMock.mockResolvedValueOnce({
      domainId: 'domain-1',
      providerName: 'Cloudflare',
      providerUrl: 'https://dash.cloudflare.com/',
      confidence: 'high',
    });

    render(<OrganizationDomainManagement slug="cottage-hospital" />);

    await waitFor(() => {
      expect(screen.getByText(/most likely managed in/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /^cloudflare$/i })).toHaveAttribute(
      'href',
      'https://dash.cloudflare.com/',
    );
  });

  it('renders an inline domain input prefilled from the user email when no domains exist', () => {
    useQueryMock.mockReturnValue({
      ...domainResponse,
      domains: [],
    });

    render(<OrganizationDomainManagement slug="cottage-hospital" />);

    const input = screen.getByLabelText(/^domain$/i);
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('example.com');
    expect(screen.getByRole('button', { name: /add domain/i })).toBeEnabled();
  });

  it('opens the add-domain modal and enables creation after input', async () => {
    const user = userEvent.setup();

    render(<OrganizationDomainManagement slug="cottage-hospital" />);

    await user.click(screen.getByRole('button', { name: /add another domain/i }));
    const dialog = await screen.findByRole('dialog', { name: /add domain/i });
    const submitButton = within(dialog).getByRole('button', { name: /^add domain$/i });
    const domainInput = within(dialog).getByLabelText(/^domain$/i);

    fireEvent.change(domainInput, { target: { value: '' } });
    expect(submitButton).toBeDisabled();

    fireEvent.change(domainInput, { target: { value: 'example.org' } });
    expect(submitButton).toBeEnabled();
  });

  it('verifies a domain and shows success feedback', async () => {
    const user = userEvent.setup();
    verifyDomainMock.mockResolvedValueOnce({
      verified: true,
      checkedAt: Date.now(),
      domain: {
        ...domainResponse.domains[0],
        status: 'verified',
        verifiedAt: Date.now(),
      },
      reason: null,
    });

    render(<OrganizationDomainManagement slug="cottage-hospital" />);

    await user.click(screen.getByRole('button', { name: /^check dns record$/i }));

    await waitFor(() => {
      expect(verifyDomainMock).toHaveBeenCalledWith({
        organizationId: 'org-1',
        domainId: 'domain-1',
      });
    });
    expect(showToastMock).toHaveBeenCalledWith('Domain verified.', 'success');
  });

  it('shows a friendly message when domain verification leaks a Convex validator error', async () => {
    const user = userEvent.setup();
    verifyDomainMock.mockRejectedValueOnce(
      new Error('ReturnsValidationError: Value does not match validator.'),
    );

    render(<OrganizationDomainManagement slug="cottage-hospital" />);

    await user.click(screen.getByRole('button', { name: /^check dns record$/i }));

    await waitFor(() => {
      expect(showToastMock).toHaveBeenCalledWith(
        'Unable to verify the domain right now. Refresh the page and try again.',
        'error',
      );
    });
  });
});
