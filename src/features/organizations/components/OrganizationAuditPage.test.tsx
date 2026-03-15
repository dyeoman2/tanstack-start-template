import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationAuditPage } from './OrganizationAuditPage';

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
  useAction: () => (...args: unknown[]) => exportAuditCsvMock(...args),
}));

vi.mock('~/components/ui/toast', () => ({
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

vi.mock('~/features/organizations/components/OrganizationWorkspaceTabs', () => ({
  OrganizationWorkspaceTabs: () => <div>Organization tabs</div>,
}));

describe('OrganizationAuditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLocationMock.mockReturnValue({ state: undefined });
    useQueryMock.mockReturnValue({
      organization: {
        id: 'org-1',
        slug: 'cottage-hospital',
        name: 'Cottage Hospital',
        logo: null,
      },
      capabilities: {
        canViewAudit: true,
      },
      events: [
        {
          id: 'event-1',
          eventType: 'member_invited',
          label: 'Invitation sent',
          identifier: 'invitee@example.com',
          createdAt: Date.now(),
          metadata: { invitationId: 'invite-1' },
        },
      ],
      pagination: {
        page: 1,
        pageSize: 10,
        total: 1,
        totalPages: 1,
      },
    });
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

    render(
      <OrganizationAuditPage
        slug="cottage-hospital"
        searchParams={{
          page: 1,
          pageSize: 10,
          sortBy: 'createdAt',
          sortOrder: 'desc',
          eventType: 'all',
          search: '',
        }}
      />,
    );

    await user.type(screen.getByRole('textbox', { name: /search organization audit events/i }), 'invitee');

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/app/organizations/$slug/audit',
        params: { slug: 'cottage-hospital' },
        search: {
          page: 1,
          pageSize: 10,
          sortBy: 'createdAt',
          sortOrder: 'desc',
          eventType: 'all',
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
          page: 1,
          pageSize: 10,
          sortBy: 'createdAt',
          sortOrder: 'desc',
          eventType: 'member_invited',
          search: 'invitee',
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /export csv/i }));

    await waitFor(() => {
      expect(exportAuditCsvMock).toHaveBeenCalledWith({
        slug: 'cottage-hospital',
        sortOrder: 'desc',
        eventType: 'member_invited',
        search: 'invitee',
      });
    });
    expect(showToastMock).toHaveBeenCalledWith('Audit log exported.', 'success');
    expect(createObjectURLMock).toHaveBeenCalled();
    expect(revokeObjectURLMock).toHaveBeenCalled();
  });

  it('keeps the breadcrumb organization name while the audit query warms up', () => {
    useQueryMock.mockReturnValue(undefined);
    useLocationMock.mockReturnValue({
      state: {
        organizationBreadcrumb: {
          slug: 'cottage-hospital',
          name: 'Cottage Hospital',
        },
      },
    });

    render(
      <OrganizationAuditPage
        slug="cottage-hospital"
        searchParams={{
          page: 1,
          pageSize: 10,
          sortBy: 'createdAt',
          sortOrder: 'desc',
          eventType: 'all',
          search: '',
        }}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Cottage Hospital' })).toBeInTheDocument();
    expect(screen.getByText('Loading audit history...')).toBeInTheDocument();
  });
});
