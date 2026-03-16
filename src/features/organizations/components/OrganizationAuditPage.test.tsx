import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationAuditPage } from './OrganizationAuditPage';

type AuditEvent = {
  id: string;
  eventType: string;
  label: string;
  actorLabel?: string;
  targetLabel?: string;
  identifier?: string;
  userId?: string;
  createdAt: number;
  metadata?: unknown;
};

const {
  navigateMock,
  exportAuditCsvMock,
  useQueryMock,
  showToastMock,
  useLocationMock,
  createObjectURLMock,
  revokeObjectURLMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  exportAuditCsvMock: vi.fn(),
  useQueryMock: vi.fn(),
  showToastMock: vi.fn(),
  useLocationMock: vi.fn<() => { state: unknown }>(() => ({ state: undefined })),
  createObjectURLMock: vi.fn(() => 'blob:mock'),
  revokeObjectURLMock: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => useLocationMock(),
}));

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useAction:
    () =>
    (...args: unknown[]) =>
      exportAuditCsvMock(...args),
}));

vi.mock('~/components/ui/toast', () => ({
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

vi.mock('~/features/organizations/components/OrganizationWorkspaceTabs', () => ({
  OrganizationWorkspaceTabs: () => <div>Organization tabs</div>,
}));

function buildAuditResponse(events: AuditEvent[]) {
  return {
    organization: {
      id: 'org-1',
      slug: 'cottage-hospital',
      name: 'Cottage Hospital',
      logo: null,
    },
    capabilities: {
      canViewAudit: true,
    },
    events,
    pagination: {
      page: 1,
      pageSize: 10,
      total: events.length,
      totalPages: events.length === 0 ? 0 : 1,
    },
  };
}

const DEFAULT_SEARCH_PARAMS = {
  page: 1,
  pageSize: 10,
  sortBy: 'createdAt' as const,
  sortOrder: 'desc' as const,
  eventType: 'all' as const,
  search: '',
  startDate: '',
  endDate: '',
  failuresOnly: false,
};

function buildSettingsResponse(
  overrides?: Partial<{
    enterpriseAuthMode: 'off' | 'optional' | 'required';
    scimConnectionConfigured: boolean;
  }>,
) {
  return {
    organization: {
      id: 'org-1',
      slug: 'cottage-hospital',
      name: 'Cottage Hospital',
      logo: null,
    },
    policies: {
      invitePolicy: 'owners_admins',
      verifiedDomainsOnly: false,
      memberCap: null,
      mfaRequired: false,
      enterpriseAuthMode: overrides?.enterpriseAuthMode ?? 'required',
      enterpriseProviderKey: 'google-workspace',
      enterpriseProtocol: 'oidc',
      enterpriseEnabledAt: null,
      enterpriseEnforcedAt: null,
      allowBreakGlassPasswordLogin: true,
    },
    enterpriseAuth: {
      providerKey: 'google-workspace',
      providerLabel: 'Google Workspace',
      protocol: 'oidc',
      providerStatus: 'active',
      managedDomains: ['scriptflow.com'],
      scimProviderId: 'google-workspace--org-1',
      scimConnectionConfigured: overrides?.scimConnectionConfigured ?? true,
    },
    availableEnterpriseProviders: [],
    access: {
      view: true,
      manage: true,
      admin: true,
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
    isMember: true,
    viewerRole: 'owner',
    canManage: true,
  };
}

function buildDomainsResponse(verifiedCount = 1) {
  const domains = Array.from({ length: verifiedCount }, (_, index) => ({
    id: `domain-${index + 1}` as never,
    organizationId: 'org-1',
    domain: index === 0 ? 'scriptflow.com' : `verified-${index}.example.com`,
    normalizedDomain: index === 0 ? 'scriptflow.com' : `verified-${index}.example.com`,
    status: 'verified' as const,
    verificationMethod: 'dns_txt' as const,
    verificationToken: 'token',
    verificationRecordName: '_verify',
    verificationRecordValue: 'value',
    verifiedAt: 1,
    createdByUserId: 'user-1',
    createdAt: 1,
  }));

  return {
    organization: {
      id: 'org-1',
      slug: 'cottage-hospital',
      name: 'Cottage Hospital',
      logo: null,
    },
    enterpriseAuth: {
      providerKey: 'google-workspace',
      providerLabel: 'Google Workspace',
      protocol: 'oidc',
      providerStatus: 'active',
      managedDomains: ['scriptflow.com'],
      scimProviderId: 'google-workspace--org-1',
      scimConnectionConfigured: true,
    },
    capabilities: {
      canManageDomains: true,
      canViewAudit: true,
    },
    domains,
  };
}

function mockAuditQueries(
  rawEvents: AuditEvent[],
  summaryEvents = rawEvents,
  options?: {
    settings?: ReturnType<typeof buildSettingsResponse> | null | undefined;
    domains?: ReturnType<typeof buildDomainsResponse> | null | undefined;
  },
) {
  let slugOnlyQueryCount = 0;

  useQueryMock.mockImplementation((_, args) => {
    if (args && typeof args === 'object' && 'eventType' in (args as Record<string, unknown>)) {
      return 'includeAllMatching' in (args as Record<string, unknown>)
        ? buildAuditResponse(summaryEvents)
        : buildAuditResponse(rawEvents);
    }

    if (
      args &&
      typeof args === 'object' &&
      Object.keys(args as Record<string, unknown>).length === 1
    ) {
      slugOnlyQueryCount += 1;
      return slugOnlyQueryCount % 2 === 1
        ? (options?.settings ?? buildSettingsResponse())
        : (options?.domains ?? buildDomainsResponse());
    }

    return undefined;
  });
}

describe('OrganizationAuditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLocationMock.mockReturnValue({ state: undefined });
    mockAuditQueries([
      {
        id: 'event-1',
        eventType: 'member_invited',
        label: 'Invitation sent',
        identifier: 'invitee@example.com',
        createdAt: Date.now(),
        metadata: { invitationId: 'invite-1' },
      },
    ]);
    Object.defineProperty(window.URL, 'createObjectURL', {
      writable: true,
      value: createObjectURLMock,
    });
    Object.defineProperty(window.URL, 'revokeObjectURL', {
      writable: true,
      value: revokeObjectURLMock,
    });
  });

  it('navigates audit search changes through route search params', async () => {
    const user = userEvent.setup();

    render(<OrganizationAuditPage slug="cottage-hospital" searchParams={DEFAULT_SEARCH_PARAMS} />);

    await user.type(
      screen.getByRole('textbox', { name: /search organization audit events/i }),
      'invitee',
    );

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/app/organizations/$slug/audit',
        params: { slug: 'cottage-hospital' },
        search: {
          ...DEFAULT_SEARCH_PARAMS,
          search: 'invitee',
        },
      });
    });
  });

  it('exports the visible audit log filters as CSV', async () => {
    const user = userEvent.setup();
    const clickMock = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    exportAuditCsvMock.mockResolvedValueOnce({
      filename: 'cottage-hospital-audit-log.csv',
      csv: 'timestamp,event_type\n',
    });
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName === 'a') {
        Object.assign(element, { click: clickMock });
      }
      return element;
    }) as typeof document.createElement);

    render(
      <OrganizationAuditPage
        slug="cottage-hospital"
        searchParams={{
          ...DEFAULT_SEARCH_PARAMS,
          eventType: 'member_invited',
          search: 'invitee',
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /export csv/i }));

    await waitFor(() => {
      expect(exportAuditCsvMock).toHaveBeenCalledWith({
        slug: 'cottage-hospital',
        sortBy: 'createdAt',
        sortOrder: 'desc',
        eventType: 'member_invited',
        search: 'invitee',
        startDate: '',
        endDate: '',
        failuresOnly: false,
      });
    });
    expect(showToastMock).toHaveBeenCalledWith('Audit log exported.', 'success');
    expect(createObjectURLMock).toHaveBeenCalled();
    expect(revokeObjectURLMock).toHaveBeenCalled();
  });

  it('keeps the breadcrumb organization name while the audit query warms up', () => {
    let slugOnlyQueryCount = 0;
    useQueryMock.mockImplementation((_, args) => {
      if (args && typeof args === 'object' && 'eventType' in (args as Record<string, unknown>)) {
        return undefined;
      }

      if (
        args &&
        typeof args === 'object' &&
        Object.keys(args as Record<string, unknown>).length === 1
      ) {
        slugOnlyQueryCount += 1;
        return slugOnlyQueryCount % 2 === 1 ? buildSettingsResponse() : buildDomainsResponse();
      }

      return undefined;
    });
    useLocationMock.mockReturnValue({
      state: {
        organizationBreadcrumb: {
          slug: 'cottage-hospital',
          name: 'Cottage Hospital',
        },
      },
    });

    render(<OrganizationAuditPage slug="cottage-hospital" searchParams={DEFAULT_SEARCH_PARAMS} />);

    expect(screen.getByRole('heading', { name: 'Cottage Hospital' })).toBeInTheDocument();
    expect(screen.getByText('Loading audit history...')).toBeInTheDocument();
  });

  it('renders the current organization posture summary in summary view', () => {
    render(<OrganizationAuditPage slug="cottage-hospital" searchParams={DEFAULT_SEARCH_PARAMS} />);

    expect(screen.getByText('Domain verification')).toBeInTheDocument();
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByText('SCIM provisioning')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Enterprise auth mode')).toBeInTheDocument();
    expect(screen.getByText('Required')).toBeInTheDocument();
  });

  it('filters to the relevant event type when a posture card is clicked', async () => {
    const user = userEvent.setup();

    mockAuditQueries(
      [
        {
          id: 'policy-1',
          eventType: 'organization_policy_updated',
          label: 'Organization policies updated',
          actorLabel: 'Organization admin',
          targetLabel: 'Organization policies',
          createdAt: 10,
          metadata: {
            changedKeys: ['enterpriseAuthMode'],
          },
        },
      ],
      undefined,
      {
        settings: buildSettingsResponse({
          enterpriseAuthMode: 'optional',
          scimConnectionConfigured: false,
        }),
      },
    );

    render(
      <OrganizationAuditPage
        slug="cottage-hospital"
        searchParams={{
          ...DEFAULT_SEARCH_PARAMS,
          page: 2,
          search: 'enterprise',
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /enterprise auth mode/i }));

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/app/organizations/$slug/audit',
      params: { slug: 'cottage-hospital' },
      search: {
        ...DEFAULT_SEARCH_PARAMS,
        page: 1,
        eventType: 'enterprise_auth_mode_updated',
        search: 'enterprise',
      },
    });
  });

  it('applies investigation filters through route search params', async () => {
    const user = userEvent.setup();

    render(<OrganizationAuditPage slug="cottage-hospital" searchParams={DEFAULT_SEARCH_PARAMS} />);

    await user.type(screen.getByLabelText(/filter audit events from date/i), '2026-03-10');

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/app/organizations/$slug/audit',
        params: { slug: 'cottage-hospital' },
        search: {
          ...DEFAULT_SEARCH_PARAMS,
          page: 1,
          startDate: '2026-03-10',
        },
      });
    });

    await user.click(screen.getByRole('button', { name: 'Failures only' }));

    expect(navigateMock).toHaveBeenLastCalledWith({
      to: '/app/organizations/$slug/audit',
      params: { slug: 'cottage-hospital' },
      search: {
        ...DEFAULT_SEARCH_PARAMS,
        page: 1,
        failuresOnly: true,
      },
    });
  });

  it('groups repeated domain verification events in summary view', async () => {
    mockAuditQueries(
      [
        {
          id: 'raw-event-1',
          eventType: 'domain_verification_failed',
          label: 'Domain verification failed',
          targetLabel: 'scriptflow.com',
          identifier: 'scriptflow.com',
          createdAt: 1,
          metadata: { domain: 'scriptflow.com' },
        },
      ],
      [
        {
          id: 'event-1',
          eventType: 'domain_verification_failed',
          label: 'Domain verification failed',
          actorLabel: 'alice@example.com',
          targetLabel: 'scriptflow.com',
          identifier: 'scriptflow.com',
          createdAt: 10,
          metadata: { domain: 'scriptflow.com' },
        },
        {
          id: 'event-2',
          eventType: 'domain_verification_failed',
          label: 'Domain verification failed',
          actorLabel: 'alice@example.com',
          targetLabel: 'scriptflow.com',
          identifier: 'scriptflow.com',
          createdAt: 20,
          metadata: { domain: 'scriptflow.com' },
        },
        {
          id: 'event-3',
          eventType: 'domain_verification_succeeded',
          label: 'Domain verified',
          actorLabel: 'alice@example.com',
          targetLabel: 'scriptflow.com',
          identifier: 'scriptflow.com',
          createdAt: 30,
          metadata: { domain: 'scriptflow.com' },
        },
      ],
    );

    render(<OrganizationAuditPage slug="cottage-hospital" searchParams={DEFAULT_SEARCH_PARAMS} />);

    expect(screen.getByRole('button', { name: 'Summary view' })).toBeInTheDocument();
    expect(screen.getAllByText('Domain verified').length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        'Verification failed 2 times before succeeding. Includes 3 raw domain verification events.',
      ),
    ).toBeInTheDocument();
  });

  it('groups repeated scim token events and can toggle to raw events', async () => {
    const user = userEvent.setup();

    mockAuditQueries(
      [
        {
          id: 'raw-scim-1',
          eventType: 'enterprise_scim_token_generated',
          label: 'SCIM token created',
          targetLabel: 'Google Workspace',
          identifier: 'google-workspace--org-1',
          createdAt: 10,
          metadata: { providerId: 'google-workspace--org-1' },
        },
      ],
      [
        {
          id: 'scim-1',
          eventType: 'enterprise_scim_token_generated',
          label: 'SCIM token created',
          actorLabel: 'alice@example.com',
          targetLabel: 'Google Workspace',
          identifier: 'google-workspace--org-1',
          createdAt: 10,
          metadata: { providerId: 'google-workspace--org-1' },
        },
        {
          id: 'scim-2',
          eventType: 'enterprise_scim_token_deleted',
          label: 'SCIM token revoked',
          actorLabel: 'alice@example.com',
          targetLabel: 'Google Workspace',
          identifier: 'google-workspace--org-1',
          createdAt: 20,
          metadata: { providerId: 'google-workspace--org-1' },
        },
        {
          id: 'scim-3',
          eventType: 'enterprise_scim_token_generated',
          label: 'SCIM token created',
          actorLabel: 'alice@example.com',
          targetLabel: 'Google Workspace',
          identifier: 'google-workspace--org-1',
          createdAt: 30,
          metadata: { providerId: 'google-workspace--org-1' },
        },
      ],
    );

    render(<OrganizationAuditPage slug="cottage-hospital" searchParams={DEFAULT_SEARCH_PARAMS} />);

    expect(screen.getAllByText('SCIM token created').length).toBeGreaterThan(0);
    expect(screen.getAllByText('SCIM token').length).toBeGreaterThan(0);
    expect(screen.queryByText('google-workspace--org-1')).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'SCIM token rotated 1 time. Latest token is active. Includes 3 raw SCIM token events.',
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View raw events' }));

    expect(screen.getByText('SCIM token created raw events')).toBeInTheDocument();
    expect(
      screen.getAllByText('A new SCIM token was created for this provider.').length,
    ).toBeGreaterThan(0);
  });

  it('keeps non-noisy events as raw rows in summary view', () => {
    mockAuditQueries([
      {
        id: 'invite-1',
        eventType: 'member_invited',
        label: 'Invitation sent',
        actorLabel: 'owner@example.com',
        targetLabel: 'invitee@example.com',
        identifier: 'invitee@example.com',
        createdAt: 10,
      },
    ]);

    render(<OrganizationAuditPage slug="cottage-hospital" searchParams={DEFAULT_SEARCH_PARAMS} />);

    expect(screen.getAllByText('Invitation sent').length).toBeGreaterThan(0);
    expect(screen.getByText('owner@example.com')).toBeInTheDocument();
    expect(screen.getByText('invitee@example.com')).toBeInTheDocument();
  });

  it('humanizes policy and auth summaries and exposes exact provenance in the sheet', async () => {
    const user = userEvent.setup();

    mockAuditQueries([
      {
        id: 'policy-1',
        eventType: 'organization_policy_updated',
        label: 'Organization policies updated',
        actorLabel: 'Organization admin',
        targetLabel: 'Organization policies',
        userId: 'user-123',
        identifier: 'admin@example.com',
        createdAt: 10,
        metadata: {
          actorEmail: 'admin@example.com',
          changedKeys: ['enterpriseProviderKey', 'enterpriseProtocol'],
        },
      },
      {
        id: 'auth-1',
        eventType: 'enterprise_auth_mode_updated',
        label: 'Enterprise auth mode updated',
        actorLabel: 'Organization admin',
        targetLabel: 'Enterprise auth settings',
        userId: 'user-123',
        identifier: 'admin@example.com',
        createdAt: 20,
        metadata: {
          previousMode: 'optional',
          nextMode: 'required',
        },
      },
    ]);

    render(<OrganizationAuditPage slug="cottage-hospital" searchParams={DEFAULT_SEARCH_PARAMS} />);

    expect(screen.getByText('Changed: Enterprise provider, Protocol')).toBeInTheDocument();
    expect(screen.getByText('Changed from Optional to Required.')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'View details' })[1]);

    expect(screen.getByText('Organization policies updated details')).toBeInTheDocument();
    expect(screen.getByText('Timestamp')).toBeInTheDocument();
    expect(screen.getByText(/"exactEmail": "admin@example.com"/)).toBeInTheDocument();
    expect(screen.getByText(/"userId": "user-123"/)).toBeInTheDocument();
    expect(screen.getByText(/"display": "Organization policies"/)).toBeInTheDocument();
  });
});
