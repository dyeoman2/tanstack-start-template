import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationDomainManagement } from './OrganizationDomainManagement';

const {
  addDomainMock,
  removeDomainMock,
  regenerateTokenMock,
  verifyDomainMock,
  useQueryMock,
  useMutationMock,
  mutationHookCallCount,
  invalidateQueriesMock,
  showToastMock,
} = vi.hoisted(() => ({
  addDomainMock: vi.fn(),
  removeDomainMock: vi.fn(),
  regenerateTokenMock: vi.fn(),
  verifyDomainMock: vi.fn(),
  useQueryMock: vi.fn(),
  useMutationMock: vi.fn(),
  mutationHookCallCount: { value: 0 },
  invalidateQueriesMock: vi.fn(),
  showToastMock: vi.fn(),
}));

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
  useAction: () => (...args: unknown[]) => verifyDomainMock(...args),
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
    mutationHookCallCount.value = 0;
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
  });

  it('renders verification details for existing domains', () => {
    render(<OrganizationDomainManagement slug="cottage-hospital" />);

    expect(screen.getByText('example.com')).toBeInTheDocument();
    expect(screen.getByText('_ba-verify.example.com')).toBeInTheDocument();
    expect(screen.getByText('better-auth-verify=token-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add domain/i })).toBeEnabled();
  });

  it('opens the add-domain modal and enables creation after input', async () => {
    const user = userEvent.setup();

    render(<OrganizationDomainManagement slug="cottage-hospital" />);

    await user.click(screen.getByRole('button', { name: /add domain/i }));
    const dialog = await screen.findByRole('dialog', { name: /add domain/i });
    const submitButton = within(dialog).getByRole('button', { name: /^add domain$/i });

    expect(submitButton).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/^domain$/i), 'example.org');

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

    await user.click(screen.getByRole('button', { name: /^verify$/i }));

    await waitFor(() => {
      expect(verifyDomainMock).toHaveBeenCalledWith({
        organizationId: 'org-1',
        domainId: 'domain-1',
      });
    });
    expect(showToastMock).toHaveBeenCalledWith('Domain verified.', 'success');
  });
});
