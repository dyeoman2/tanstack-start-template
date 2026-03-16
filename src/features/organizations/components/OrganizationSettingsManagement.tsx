import { api } from '@convex/_generated/api';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useRouter } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { Loader2, LogOut, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { DeleteConfirmationDialog } from '~/components/ui/delete-confirmation-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '~/components/ui/field';
import { Input } from '~/components/ui/input';
import { useToast } from '~/components/ui/toast';
import { OrganizationWorkspaceNav } from '~/features/organizations/components/OrganizationWorkspaceNav';
import { OrganizationWorkspaceTabs } from '~/features/organizations/components/OrganizationWorkspaceTabs';
import { useStableOrganizationName } from '~/features/organizations/lib/organization-breadcrumb-state';
import type { OrganizationDirectorySearchParams } from '~/features/organizations/lib/organization-management';
import { getServerFunctionErrorMessage, refreshOrganizationClientState } from '~/features/organizations/lib/organization-session';
import {
  deleteOrganizationServerFn,
  updateOrganizationSettingsServerFn,
} from '~/features/organizations/server/organization-management';
import { leaveOrganizationServerFn } from '~/features/organizations/server/organization-membership';

export function OrganizationSettingsManagement({
  searchParams: _searchParams,
  slug,
}: {
  searchParams: OrganizationDirectorySearchParams;
  slug: string;
}) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const router = useRouter();
  const { showToast } = useToast();
  const settings = useQuery(api.organizationManagement.getOrganizationSettings, { slug });
  const updateSettings = updateOrganizationSettingsServerFn;
  const deleteOrganization = deleteOrganizationServerFn;

  const [name, setName] = useState('');
  const [logo, setLogo] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isLeaveDialogOpen, setIsLeaveDialogOpen] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setName(settings.organization.name);
    setLogo(settings.organization.logo ?? '');
  }, [settings]);

  const organizationName = useStableOrganizationName({
    names: [settings?.organization.name],
    slug,
    state: location.state,
  });

  if (settings === undefined) {
    return (
      <div className="space-y-6">
        <OrganizationWorkspaceNav
          title={organizationName}
          description="Preparing the organization settings."
        />
      </div>
    );
  }

  if (!settings) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Organization not found</CardTitle>
          <CardDescription>
            The requested organization is unavailable or you no longer have access to it.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const canUpdateSettings = settings.capabilities.canUpdateSettings;
  const canLeaveOrganization = settings.capabilities.canLeaveOrganization;
  const canDelete = settings.capabilities.canDeleteOrganization;
  const canShowAccessWarning = !canUpdateSettings;

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);

    try {
      await updateSettings({
        data: {
          organizationId: settings.organization.id,
          name,
          logo: logo.trim().length > 0 ? logo.trim() : null,
        },
      });
      await refreshOrganizationClientState(queryClient, {
        invalidateRouter: async () => {
          await router.invalidate();
        },
      });
      setIsEditDialogOpen(false);
      showToast('Organization settings updated.', 'success');
    } catch (error) {
      const message = getServerFunctionErrorMessage(error, 'Failed to update organization');
      setSaveError(message);
      showToast(message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    setDeleteError(null);

    try {
      await deleteOrganization({
        data: {
          organizationId: settings.organization.id,
        },
      });
      await refreshOrganizationClientState(queryClient, {
        invalidateRouter: async () => {
          await router.invalidate();
        },
      });
      setIsDeleteDialogOpen(false);
      showToast('Organization deleted.', 'success');
      void navigate({ to: '/app/organizations' });
    } catch (error) {
      const message = getServerFunctionErrorMessage(error, 'Failed to delete organization');
      setDeleteError(message);
      showToast(message, 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleLeave = async () => {
    setIsLeaving(true);
    setLeaveError(null);

    try {
      await leaveOrganizationServerFn({
        data: {
          organizationId: settings.organization.id,
        },
      });
      await refreshOrganizationClientState(queryClient, {
        invalidateRouter: async () => {
          await router.invalidate();
        },
      });
      setIsLeaveDialogOpen(false);
      showToast('You left the organization.', 'success');
      await navigate({ to: '/app/organizations' });
    } catch (error) {
      const message = getServerFunctionErrorMessage(error, 'Failed to leave organization');
      setLeaveError(message);
      showToast(message, 'error');
    } finally {
      setIsLeaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <OrganizationWorkspaceNav
        title={organizationName}
        description="Manage the organization profile and sensitive lifecycle controls."
        actions={
          canUpdateSettings ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setIsEditDialogOpen(true)}>
              <Pencil className="size-4" />
              Edit profile
            </Button>
          ) : undefined
        }
      />
      <OrganizationWorkspaceTabs slug={slug} organizationName={organizationName} />

      {canShowAccessWarning ? (
        <Card>
          <CardHeader>
            <CardTitle>Management access required</CardTitle>
            <CardDescription>
              Organization owners, organization admins, and site admins can manage general settings
              here.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Organization profile</CardTitle>
          <CardDescription>
            Update the core identity used across the app for this organization.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-border p-4">
              <p className="text-sm font-medium text-foreground">Display name</p>
              <p className="mt-2 text-sm text-muted-foreground">{settings.organization.name}</p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <p className="text-sm font-medium text-foreground">Logo URL</p>
              <p className="mt-2 break-all text-sm text-muted-foreground">
                {settings.organization.logo ?? 'Not set'}
              </p>
            </div>
          </div>

        </CardContent>
      </Card>

      {(canLeaveOrganization || canDelete) ? (
        <Card>
          <CardHeader>
            <CardTitle>Danger zone</CardTitle>
            <CardDescription>
              Destructive organization actions live here so they remain visible and clearly scoped.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {canLeaveOrganization ? (
              <Button type="button" variant="outline" onClick={() => setIsLeaveDialogOpen(true)}>
                <LogOut className="size-4" />
                Leave organization
              </Button>
            ) : null}
            {canDelete ? (
              <Button type="button" variant="destructive" onClick={() => setIsDeleteDialogOpen(true)}>
                <Trash2 className="size-4" />
                Delete organization
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      <Dialog
        open={isEditDialogOpen}
        onOpenChange={(open) => {
          setIsEditDialogOpen(open);
          if (!open) {
            setSaveError(null);
            setName(settings.organization.name);
            setLogo(settings.organization.logo ?? '');
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit organization</DialogTitle>
            <DialogDescription>Update the name and logo used across the app.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Field>
              <FieldLabel htmlFor="organization-name">Name</FieldLabel>
              <Input
                id="organization-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={isSaving}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="organization-logo">Logo URL</FieldLabel>
              <Input
                id="organization-logo"
                value={logo}
                onChange={(event) => setLogo(event.target.value)}
                disabled={isSaving}
                placeholder="https://example.com/logo.png"
              />
            </Field>

            {saveError ? <FieldError>{saveError}</FieldError> : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsEditDialogOpen(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={isSaving || name.trim().length === 0}
            >
              {isSaving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={isDeleteDialogOpen}
        onClose={() => {
          setIsDeleteDialogOpen(false);
          setDeleteError(null);
        }}
        title="Delete organization"
        description={`Delete ${settings.organization.name} and all organization-scoped data.`}
        confirmationPhrase={settings.organization.name}
        confirmationPlaceholder={settings.organization.name}
        deleteText="Delete organization"
        isDeleting={isDeleting}
        error={deleteError ?? undefined}
        onConfirm={handleDelete}
        variant="danger"
      />

      <DeleteConfirmationDialog
        open={isLeaveDialogOpen}
        onClose={() => {
          setIsLeaveDialogOpen(false);
          setLeaveError(null);
        }}
        title="Leave organization"
        description={`Leave ${settings.organization.name}. You will lose access to its members, invitations, and organization-scoped data.`}
        confirmationPhrase={settings.organization.name}
        confirmationPlaceholder={settings.organization.name}
        deleteText="Leave organization"
        cancelText="Stay"
        isDeleting={isLeaving}
        error={leaveError ?? undefined}
        onConfirm={handleLeave}
        variant="danger"
      />
    </div>
  );
}
