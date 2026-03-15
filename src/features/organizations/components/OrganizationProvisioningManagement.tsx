import { api } from '@convex/_generated/api';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { Check, ChevronDown, ChevronUp, Copy, Loader2, RefreshCcw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible';
import { DeleteConfirmationDialog } from '~/components/ui/delete-confirmation-dialog';
import { useToast } from '~/components/ui/toast';
import type {
  OrganizationEnterpriseProviderKey,
  OrganizationEnterpriseProviderOption,
} from '~/features/organizations/lib/organization-management';
import {
  getServerFunctionErrorMessage,
  refreshOrganizationClientState,
} from '~/features/organizations/lib/organization-session';
import {
  deleteOrganizationScimProviderServerFn,
  generateOrganizationScimTokenServerFn,
} from '~/features/organizations/server/organization-management';
import { cn } from '~/lib/utils';

type IdentitySearchState = {
  step?: 'step-1' | 'step-2' | 'step-3' | 'step-4';
  provisioningDetails: boolean;
};

export function OrganizationProvisioningManagement({
  slug,
  highlight = false,
  blockedMessage = null,
  embedded = false,
  detailsOpen,
}: {
  slug: string;
  highlight?: boolean;
  blockedMessage?: string | null;
  embedded?: boolean;
  detailsOpen?: boolean;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const settings = useQuery(api.organizationManagement.getOrganizationEnterpriseAuthSettings, {
    slug,
  });
  const [providerKey, setProviderKey] = useState<OrganizationEnterpriseProviderKey | null>(null);
  const [revealedScimToken, setRevealedScimToken] = useState<string | null>(null);
  const [isGeneratingScimToken, setIsGeneratingScimToken] = useState(false);
  const [isDeletingScimProvider, setIsDeletingScimProvider] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [uncontrolledDetailsOpen, setUncontrolledDetailsOpen] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setProviderKey(settings.policies.enterpriseProviderKey ?? null);
  }, [settings]);

  const selectedProvider = useMemo(
    () =>
      providerKey
        ? (settings?.availableEnterpriseProviders.find(
            (provider: OrganizationEnterpriseProviderOption) => provider.key === providerKey,
          ) ?? null)
        : null,
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
      setUncontrolledDetailsOpen(true);
      void navigate({
        to: '/app/organizations/$slug/identity',
        params: { slug },
        search: (previous: IdentitySearchState) => ({
          ...previous,
          provisioningDetails: true,
        }),
        replace: true,
      });
    }
  }, [navigate, revealedScimToken, slug]);

  if (settings === undefined || settings === null || !settings.capabilities.canUpdateSettings) {
    return null;
  }

  const scimConnectionConfigured = settings.enterpriseAuth?.scimConnectionConfigured ?? false;
  const showProvisioningDetails = scimConnectionConfigured || revealedScimToken !== null;
  const resolvedDetailsOpen = detailsOpen ?? uncontrolledDetailsOpen;

  const handleGenerateScimToken = async () => {
    if (!providerKey) return;
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
      showToast(
        scimConnectionConfigured ? 'Provisioning token rotated.' : 'Provisioning token created.',
        'success',
      );
    } catch (error) {
      showToast(
        getServerFunctionErrorMessage(
          error,
          'Failed to generate provisioning token. Try again or verify your provider setup.',
        ),
        'error',
      );
    } finally {
      setIsGeneratingScimToken(false);
    }
  };

  const handleDeleteScimProvider = async () => {
    if (!providerKey) return;
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
      showToast(
        getServerFunctionErrorMessage(
          error,
          'Failed to revoke provisioning token. Try again to confirm the token was removed.',
        ),
        'error',
      );
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
      setTokenCopied(true);
      window.setTimeout(() => {
        setTokenCopied(false);
      }, 1500);
      showToast('Provisioning token copied.', 'success');
    } catch (error) {
      showToast(
        getServerFunctionErrorMessage(
          error,
          'Failed to copy provisioning token. Copy it manually and store it securely.',
        ),
        'error',
      );
    }
  };

  const provisioningContent = (
    <div className="space-y-4">
      {embedded ? null : null}
      {embedded && !blockedMessage ? (
        <div className="rounded-lg border border-border/70 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          Optional: automatically create and update users from your identity provider using SCIM.
        </div>
      ) : null}
      {!blockedMessage ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={scimConnectionConfigured ? 'success' : 'secondary'}>
            {scimConnectionConfigured ? 'Configured' : 'Not configured'}
          </Badge>
          {selectedProvider ? <Badge variant="outline">{selectedProvider.label}</Badge> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => void handleGenerateScimToken()}
          disabled={
            isGeneratingScimToken || !selectedProvider?.selectable || blockedMessage !== null
          }
        >
          {isGeneratingScimToken ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCcw className="size-4" />
          )}
          {scimConnectionConfigured ? 'Rotate Token' : 'Set Up Provisioning'}
        </Button>
        {scimConnectionConfigured ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsDeleteDialogOpen(true)}
            disabled={isDeletingScimProvider}
          >
            <Trash2 className="size-4" />
            Revoke Token
          </Button>
        ) : null}
        {showProvisioningDetails || scimConnectionConfigured ? (
          <Collapsible
            open={resolvedDetailsOpen}
            onOpenChange={(open) => {
              setUncontrolledDetailsOpen(open);
              void navigate({
                to: '/app/organizations/$slug/identity',
                params: { slug },
                search: (previous: IdentitySearchState) => ({
                  ...previous,
                  provisioningDetails: open,
                }),
                replace: true,
              });
            }}
          >
            <CollapsibleTrigger asChild>
              <Button type="button" variant="outline">
                {resolvedDetailsOpen ? (
                  <ChevronUp className="size-4" />
                ) : (
                  <ChevronDown className="size-4" />
                )}
                {resolvedDetailsOpen ? 'Hide Setup Details' : 'View Setup Details'}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="w-full">
              <div className="mt-4 rounded-lg border border-border p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">SCIM base URL</p>
                <p className="mt-1 font-mono text-foreground">/api/auth/scim/v2</p>
                <p className="mt-3">
                  Provisioned users are added to the organization as{' '}
                  <span className="font-medium">member</span>, and deprovisioning removes only this
                  organization membership without deleting the global user.
                </p>
              </div>

              {revealedScimToken ? (
                <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-4">
                  <p className="text-sm font-medium">Provisioning token</p>
                  <p className="mt-2 break-all font-mono text-sm text-foreground">
                    {revealedScimToken}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    This token is only shown once. Copy it now and store it securely.
                  </p>
                  <Button
                    className="mt-3"
                    variant="outline"
                    type="button"
                    onClick={() => void copyScimToken()}
                  >
                    {tokenCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
                    {tokenCopied ? 'Copied' : 'Copy Token'}
                  </Button>
                </div>
              ) : null}
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </div>
    </div>
  );

  return (
    <>
      {embedded ? (
        provisioningContent
      ) : (
        <Card className={cn(highlight ? 'border-primary shadow-md shadow-primary/5' : undefined)}>
          <CardHeader>
            <CardTitle>Step 4: Provisioning</CardTitle>
            <CardDescription>
              Optional: automatically create and update users from your identity provider using
              SCIM.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">{provisioningContent}</CardContent>
        </Card>
      )}

      <DeleteConfirmationDialog
        open={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        title="Revoke provisioning token"
        description="Revoke the current SCIM token for this organization."
        confirmationPhrase={settings.organization.name}
        confirmationPlaceholder={settings.organization.name}
        deleteText="Revoke Token"
        isDeleting={isDeletingScimProvider}
        onConfirm={handleDeleteScimProvider}
        variant="danger"
      />
    </>
  );
}
