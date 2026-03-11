import { api } from '@convex/_generated/api';
import { useMutation, useQuery } from 'convex/react';
import { useState } from 'react';
import { PageHeader } from '~/components/PageHeader';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { useToast } from '~/components/ui/toast';
import { useAuthState } from '~/features/auth/hooks/useAuthState';

export function TeamManagementPage() {
  const authState = useAuthState();
  const toast = useToast();
  const [newOrganizationName, setNewOrganizationName] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');

  const organizationList = useQuery(
    api.orgs.listMyOrganizations,
    authState.isAuthenticated ? {} : 'skip',
  );
  const currentOrganizationId = authState.isAuthenticated
    ? organizationList?.currentOrganizationId ?? null
    : null;
  const organizationDetails = useQuery(
    api.orgs.getOrganizationDetails,
    authState.isAuthenticated && currentOrganizationId
      ? { organizationId: currentOrganizationId }
      : 'skip',
  );

  const createOrganization = useMutation(api.orgs.createOrganization);
  const setActiveOrganization = useMutation(api.orgs.setActiveOrganization);
  const renameOrganization = useMutation(api.orgs.renameOrganization);
  const createInvitation = useMutation(api.orgs.createInvitation);
  const revokeInvitation = useMutation(api.orgs.revokeInvitation);
  const updateMemberRole = useMutation(api.orgs.updateMemberRole);
  const removeMember = useMutation(api.orgs.removeMember);

  const organizations = organizationList?.organizations ?? [];
  const currentOrganization = organizationDetails?.organization ?? null;
  const members = organizationDetails?.members ?? [];
  const invites = organizationDetails?.invites ?? [];

  async function handleCreateOrganization() {
    try {
      const result = await createOrganization({ name: newOrganizationName });
      setNewOrganizationName('');
      setRenameValue('');
      toast.showToast('Organization created.', 'success');
      await setActiveOrganization({ organizationId: result.organizationId });
    } catch (error) {
      toast.showToast(
        error instanceof Error ? error.message : 'Failed to create organization.',
        'error',
      );
    }
  }

  async function handleRenameOrganization() {
    if (!currentOrganizationId) return;

    try {
      await renameOrganization({ organizationId: currentOrganizationId, name: renameValue });
      toast.showToast('Organization settings updated.', 'success');
    } catch (error) {
      toast.showToast(
        error instanceof Error ? error.message : 'Failed to update organization.',
        'error',
      );
    }
  }

  async function handleInvite() {
    if (!currentOrganizationId) return;

    try {
      await createInvitation({
        organizationId: currentOrganizationId,
        email: inviteEmail,
        role: inviteRole,
      });
      setInviteEmail('');
      setInviteRole('member');
      toast.showToast('Invite sent.', 'success');
    } catch (error) {
      toast.showToast(error instanceof Error ? error.message : 'Failed to send invite.', 'error');
    }
  }

  if (
    authState.isPending ||
    !organizationList ||
    (currentOrganizationId && organizationDetails === undefined)
  ) {
    return (
      <div className="space-y-6">
        <PageHeader title="Organizations" description="Manage your organizations." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Organizations" description="Manage your organizations." />

      <Card className="space-y-4 p-6">
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            value={newOrganizationName}
            onChange={(event) => setNewOrganizationName(event.target.value)}
            placeholder="Create a new organization"
          />
          <Button
            onClick={() => void handleCreateOrganization()}
            disabled={!newOrganizationName.trim()}
          >
            Create Organization
          </Button>
        </div>

        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Your organizations</h2>
          <div className="flex flex-wrap gap-2">
            {organizations.map((organization) => (
              <Button
                key={organization.id}
                variant={organization.id === currentOrganizationId ? 'default' : 'outline'}
                onClick={() =>
                  void setActiveOrganization({ organizationId: organization.id })
                }
              >
                {organization.name}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      {currentOrganization && (
        <Card className="space-y-6 p-6">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">{currentOrganization.name}</h2>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Organization settings</h3>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                placeholder={currentOrganization.name}
              />
              <Button
                onClick={() => void handleRenameOrganization()}
                disabled={!renameValue.trim()}
              >
                Save Name
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Invite members</h3>
            <div className="grid gap-3 sm:grid-cols-[2fr,1fr,auto]">
              <Input
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="member@example.com"
              />
              <Select
                value={inviteRole}
                onValueChange={(value: 'admin' | 'member') => setInviteRole(value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="member">Member</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={() => void handleInvite()} disabled={!inviteEmail.trim()}>
                Send Invite
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Members</h3>
            <div className="space-y-3">
              {members.map((member) => (
                <div
                  key={member.membershipId}
                  className="flex flex-col gap-3 rounded-md border p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <div className="font-medium">{member.name || member.email}</div>
                    <div className="text-sm text-muted-foreground">{member.email}</div>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Select
                      value={member.role}
                      disabled={member.role === 'owner'}
                      onValueChange={(value: 'admin' | 'member') =>
                        void updateMemberRole({
                          organizationId: currentOrganization.id,
                          membershipId: member.membershipId,
                          role: value,
                        })
                      }
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="owner">Owner</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="member">Member</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      disabled={member.role === 'owner'}
                      onClick={() =>
                        void removeMember({
                          organizationId: currentOrganization.id,
                          membershipId: member.membershipId,
                        })
                      }
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Pending invites</h3>
            <div className="space-y-3">
              {invites.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No invites for this organization yet.
                </p>
              )}
              {invites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex flex-col gap-3 rounded-md border p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <div className="font-medium">{invite.email}</div>
                    <div className="text-sm capitalize text-muted-foreground">
                      {invite.role} • {invite.status}
                    </div>
                  </div>
                  {invite.status === 'pending' && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        void revokeInvitation({
                          organizationId: currentOrganization.id,
                          invitationId: invite.id,
                        })
                      }
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
