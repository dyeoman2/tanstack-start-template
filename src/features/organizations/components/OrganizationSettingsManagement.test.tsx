import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationSettingsManagement } from './OrganizationSettingsManagement';

const navigateMock = vi.fn();
const showToastMock = vi.fn();
const updateSettingsMock = vi.fn();
const deleteOrganizationMock = vi.fn();
const useQueryMock = vi.fn();
const useMutationMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock('~/components/ui/toast', () => ({
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

describe('OrganizationSettingsManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const mutationValues = [updateSettingsMock, deleteOrganizationMock];
    let mutationIndex = 0;
    useMutationMock.mockImplementation(() => {
      const mutation = mutationValues[mutationIndex % mutationValues.length];
      mutationIndex += 1;
      return mutation;
    });
  });

  it('renders access guidance when the viewer cannot manage settings', () => {
    useQueryMock.mockReturnValue({
      organization: {
        id: 'org-1',
        slug: 'cottage-hospital',
        name: 'Cottage Hospital',
        logo: null,
      },
      access: {
        admin: false,
        delete: false,
        edit: false,
        view: true,
        siteAdmin: false,
      },
      viewerRole: 'member',
      canManage: false,
    });

    render(<OrganizationSettingsManagement slug="cottage-hospital" />);

    expect(screen.getByText('Management access required')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save settings/i })).not.toBeInTheDocument();
  });

  it('updates and deletes an organization for managers', async () => {
    const user = userEvent.setup();

    useQueryMock.mockReturnValue({
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
      viewerRole: 'site-admin',
      canManage: true,
    });
    updateSettingsMock.mockResolvedValueOnce({ success: true });
    deleteOrganizationMock.mockResolvedValueOnce({ success: true });

    render(<OrganizationSettingsManagement slug="cottage-hospital" />);

    const nameInput = screen.getByLabelText('Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'New Cottage Hospital');
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith({
        organizationId: 'org-1',
        name: 'New Cottage Hospital',
        logo: null,
      });
    });

    await user.click(screen.getByRole('button', { name: /delete organization/i }));
    await user.type(screen.getByPlaceholderText('Cottage Hospital'), 'Cottage Hospital');
    await user.click(screen.getByRole('button', { name: /^delete organization$/i }));

    await waitFor(() => {
      expect(deleteOrganizationMock).toHaveBeenCalledWith({
        organizationId: 'org-1',
      });
    });
    expect(showToastMock).toHaveBeenCalledWith('Organization deleted.', 'success');
  });
});
