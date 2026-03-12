import { api } from '@convex/_generated/api';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery } from 'convex/react';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { OrganizationWorkspaceNav } from '~/features/organizations/components/OrganizationWorkspaceNav';
import { Button } from '~/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { DeleteConfirmationDialog } from '~/components/ui/delete-confirmation-dialog';
import { Field, FieldError, FieldLabel } from '~/components/ui/field';
import { Input } from '~/components/ui/input';
import { useToast } from '~/components/ui/toast';

export function OrganizationSettingsManagement({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const settings = useQuery(api.organizationManagement.getOrganizationSettings, { slug });
  const updateSettings = useMutation(api.organizationManagement.updateOrganizationSettings);
  const deleteOrganization = useMutation(api.organizationManagement.deleteOrganization);

  const [name, setName] = useState('');
  const [logo, setLogo] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setName(settings.organization.name);
    setLogo(settings.organization.logo ?? '');
  }, [settings]);

  if (settings === undefined) {
    return (
      <div className="space-y-6">
        <OrganizationWorkspaceNav
          slug={slug}
          view="SETTINGS"
          title="Loading organization"
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

  const canManage = settings.canManage;

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);

    try {
      await updateSettings({
        organizationId: settings.organization.id,
        name,
        logo: logo.trim().length > 0 ? logo.trim() : null,
      });
      showToast('Organization settings updated.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update organization';
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
        organizationId: settings.organization.id,
      });
      setIsDeleteDialogOpen(false);
      showToast('Organization deleted.', 'success');
      void navigate({ to: '/app/organizations' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete organization';
      setDeleteError(message);
      showToast(message, 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <OrganizationWorkspaceNav
        slug={slug}
        view="SETTINGS"
        title={settings.organization.name}
        description="Manage organization settings with site-admin-aware controls."
      />

      {canManage ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Organization details</CardTitle>
              <CardDescription>Update the name and logo used across the app.</CardDescription>
            </CardHeader>
            <div className="space-y-4 px-6 pb-6">
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

              <div className="flex justify-end">
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
                    'Save settings'
                  )}
                </Button>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Delete organization</CardTitle>
              <CardDescription>
                This permanently deletes the organization, its memberships, invitations, and
                org-scoped AI data.
              </CardDescription>
            </CardHeader>
            <div className="px-6 pb-6">
              <Button
                type="button"
                variant="destructive"
                onClick={() => setIsDeleteDialogOpen(true)}
              >
                Delete organization
              </Button>
            </div>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Management access required</CardTitle>
            <CardDescription>
              Organization owners, organization admins, and site admins can edit settings here.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

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
    </div>
  );
}
