import { api } from '@convex/_generated/api';
import { useQuery, useMutation } from 'convex/react';
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
  const [newTeamName, setNewTeamName] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'edit' | 'view'>('edit');

  const teamList = useQuery(api.teams.listMyTeams, authState.isAuthenticated ? {} : 'skip');
  const currentTeamId = authState.isAuthenticated ? teamList?.currentTeamId ?? null : null;
  const teamDetails = useQuery(
    api.teams.getTeamDetails,
    authState.isAuthenticated && currentTeamId ? { teamId: currentTeamId } : 'skip',
  );

  const createTeam = useMutation(api.teams.createTeam);
  const setActiveTeam = useMutation(api.teams.setActiveTeam);
  const renameTeam = useMutation(api.teams.renameTeam);
  const createInvite = useMutation(api.teams.createInvite);
  const revokeInvite = useMutation(api.teams.revokeInvite);
  const updateMemberRole = useMutation(api.teams.updateMemberRole);
  const removeMember = useMutation(api.teams.removeMember);

  const teams = teamList?.teams ?? [];
  const currentTeam = teamDetails?.team ?? null;
  const members = teamDetails?.members ?? [];
  const invites = teamDetails?.invites ?? [];

  async function handleCreateTeam() {
    try {
      const result = await createTeam({ name: newTeamName });
      setNewTeamName('');
      toast.showToast('Team created.', 'success');
      setRenameValue('');
      await setActiveTeam({ teamId: result.teamId });
    } catch (error) {
      toast.showToast(error instanceof Error ? error.message : 'Failed to create team.', 'error');
    }
  }

  async function handleRenameTeam() {
    if (!currentTeamId) return;

    try {
      await renameTeam({ teamId: currentTeamId, name: renameValue });
      toast.showToast('Team settings updated.', 'success');
    } catch (error) {
      toast.showToast(error instanceof Error ? error.message : 'Failed to update team.', 'error');
    }
  }

  async function handleInvite() {
    if (!currentTeamId) return;

    try {
      await createInvite({
        teamId: currentTeamId,
        email: inviteEmail,
        role: inviteRole,
      });
      setInviteEmail('');
      setInviteRole('edit');
      toast.showToast('Invite sent.', 'success');
    } catch (error) {
      toast.showToast(error instanceof Error ? error.message : 'Failed to send invite.', 'error');
    }
  }

  if (authState.isPending || !teamList || (currentTeamId && teamDetails === undefined)) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Teams"
          description="Manage your teams."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Teams"
        description="Manage your teams."
      />

      <Card className="p-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            value={newTeamName}
            onChange={(event) => setNewTeamName(event.target.value)}
            placeholder="Create a new team"
          />
          <Button onClick={() => void handleCreateTeam()} disabled={!newTeamName.trim()}>
            Create Team
          </Button>
        </div>

        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Your teams</h2>
          <div className="flex flex-wrap gap-2">
            {teams.map((team) => (
              <Button
                key={team.id}
                variant={team.id === currentTeamId ? 'default' : 'outline'}
                onClick={() => void setActiveTeam({ teamId: team.id })}
              >
                {team.name}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      {currentTeam && (
        <Card className="p-6 space-y-6">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">{currentTeam.name}</h2>
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Team settings</h3>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                placeholder={currentTeam.name}
              />
              <Button onClick={() => void handleRenameTeam()} disabled={!renameValue.trim()}>
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
                placeholder="teammate@example.com"
              />
              <Select
                value={inviteRole}
                onValueChange={(value: 'admin' | 'edit' | 'view') => setInviteRole(value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="edit">Edit</SelectItem>
                  <SelectItem value="view">View</SelectItem>
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
                      onValueChange={(value: 'admin' | 'edit' | 'view') =>
                        void updateMemberRole({
                          teamId: currentTeam.id,
                          membershipId: member.membershipId,
                          role: value,
                        })
                      }
                    >
                      <SelectTrigger className="w-[120px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="edit">Edit</SelectItem>
                        <SelectItem value="view">View</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      onClick={() =>
                        void removeMember({
                          teamId: currentTeam.id,
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
                <p className="text-sm text-muted-foreground">No invites for this team yet.</p>
              )}
              {invites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex flex-col gap-3 rounded-md border p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <div className="font-medium">{invite.email}</div>
                    <div className="text-sm text-muted-foreground capitalize">
                      {invite.role} • {invite.status}
                    </div>
                  </div>
                  {invite.status === 'pending' && (
                    <Button
                      variant="outline"
                      onClick={() => void revokeInvite({ inviteId: invite.id })}
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
