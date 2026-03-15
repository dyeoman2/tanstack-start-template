import { api } from '@convex/_generated/api';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { ChevronDown, ChevronUp, Copy, Loader2, RefreshCcw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible';
import { DeleteConfirmationDialog } from '~/components/ui/delete-confirmation-dialog';
import { useToast } from '~/components/ui/toast';
import type {
  OrganizationEnterpriseProviderOption,
  OrganizationEnterpriseProviderKey,
} from '~/features/organizations/lib/organization-management';
import { refreshOrganizationClientState } from '~/features/organizations/lib/organization-session';
import {
  deleteOrganizationScimProviderServerFn,
  generateOrganizationScimTokenServerFn,
} from '~/features/organizations/server/organization-management';

export function OrganizationProvisioningManagement({
  slug,
}: {
  slug: string;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { showToast } = useToast();
  const settings = useQuery(api.organizationManagement.getOrganizationEnterpriseAuthSettings, { slug });
  const [providerKey, setProviderKey] = useState<OrganizationEnterpriseProviderKey>('google-workspace');
  const [revealedScimToken, setRevealedScimToken] = useState<string | null>(null);
  const [isGeneratingScimToken, setIsGeneratingScimToken] = useState(false);
  const [isDeletingScimProvider, setIsDeletingScimProvider] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setProviderKey(settings.policies.enterpriseProviderKey ?? 'google-workspace');
  }, [settings]);

  const selectedProvider = useMemo(
    () =>
      settings?.availableEnterpriseProviders.find(
        (provider: OrganizationEnterpriseProviderOption) => provider.key === providerKey,
      ) ??
      settings?.availableEnterpriseProviders[0] ??
      null,
    [providerKey, settings?.availableEnterpriseProviders],
  );

  const refreshState = async () => {
    await refreshOrganizationClientState(queryClient, {
      invalidateRouter: async () => {
        await router.invalidate();
      },
    });
  };

  useEffect(() => {
    if (revealedScimToken) {
      setShowDetails(true);
    }
  }, [revealedScimToken]);

  if (settings === undefined || settings === null || !settings.capabilities.canUpdateSettings) {
    return null;
  }

  const scimConnectionConfigured = settings.enterpriseAuth?.scimConnectionConfigured ?? false;
  const showProvisioningDetails = scimConnectionConfigured || revealedScimToken !== null;

  const handleGenerateScimToken = async () => {
    setIsGeneratingScimToken(true);

    try {
      const result = await generateOrganizationScimTokenServerFn({
        data: {
          organizationId: settings.organization.id,
          providerKey,
        },
      });
      setRevealedScimToken(result.scimToken);
      await refreshState();
      showToast(scimConnectionConfigured ? 'Provisioning token rotated.' : 'Provisioning token created.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate provisioning token';
      showToast(message, 'error');
    } finally {
      setIsGeneratingScimToken(false);
    }
  };

  const handleDeleteScimProvider = async () => {
    setIsDeletingScimProvider(true);

    try {
      await deleteOrganizationScimProviderServerFn({
        data: {
          organizationId: settings.organization.id,
          providerKey,
        },
      });
      setRevealedScimToken(null);
      setIsDeleteDialogOpen(false);
      await refreshState();
      showToast('Provisioning token revoked.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to revoke provisioning token';
      showToast(message, 'error');
    } finally {
      setIsDeletingScimProvider(false);
    }
  };

  const copyScimToken = async () => {
    if (!revealedScimToken) {
      return;
    }

    try {
      await navigator.clipboard.writeText(revealedScimToken);
      showToast('Provisioning token copied.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to copy provisioning token', 'error');
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>User provisioning</CardTitle>
          <CardDescription>
            Optional: automatically create and update users from your identity provider using SCIM.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={scimConnectionConfigured ? 'success' : 'secondary'}>
              {scimConnectionConfigured ? 'Configured' : 'Not configured'}
            </Badge>
            {selectedProvider ? <Badge variant="outline">{selectedProvider.label}</Badge> : null}
          </div>

          <p className="text-sm text-muted-foreground">
            Set this up after your identity provider and verified domains are in place. SCIM
            deprovisioning removes access to this organization only, and deactivated users do not
            regain access by signing in again. Restore access through SCIM reprovisioning or an
            admin action.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => void handleGenerateScimToken()}
              disabled={isGeneratingScimToken || !selectedProvider?.selectable}
            >
              {isGeneratingScimToken ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCcw className="size-4" />
              )}
              {scimConnectionConfigured ? 'Rotate token' : 'Set up provisioning'}
            </Button>
            {scimConnectionConfigured ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsDeleteDialogOpen(true)}
                disabled={isDeletingScimProvider}
              >
                <Trash2 className="size-4" />
                Revoke token
              </Button>
            ) : null}
            {(showProvisioningDetails || scimConnectionConfigured) ? (
              <Collapsible open={showDetails} onOpenChange={setShowDetails}>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="outline">
                    {showDetails ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                    {showDetails ? 'Hide setup details' : 'View setup details'}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="w-full">
                  <div className="mt-4 rounded-lg border border-border p-4 text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">SCIM base URL</p>
                    <p className="mt-1 font-mono text-foreground">/api/auth/scim/v2</p>
                    <p className="mt-3">
                      Provisioned users are added to the organization as <span className="font-medium">member</span>,
                      and deprovisioning removes only this organization membership without deleting
                      the global user.
                    </p>
                  </div>

                  {revealedScimToken ? (
                    <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-4">
                      <p className="text-sm font-medium">Provisioning token</p>
                      <p className="mt-2 break-all font-mono text-sm text-foreground">{revealedScimToken}</p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        This token is only shown once. Copy it now and store it securely.
                      </p>
                      <Button className="mt-3" variant="outline" type="button" onClick={() => void copyScimToken()}>
                        <Copy className="size-4" />
                        Copy token
                      </Button>
                    </div>
                  ) : null}
                </CollapsibleContent>
              </Collapsible>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <DeleteConfirmationDialog
        open={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        title="Revoke provisioning token"
        description="Revoke the current SCIM token for this organization."
        confirmationPhrase={settings.organization.name}
        confirmationPlaceholder={settings.organization.name}
        deleteText="Revoke token"
        isDeleting={isDeletingScimProvider}
        onConfirm={handleDeleteScimProvider}
        variant="danger"
      />
    </>
  );
}
