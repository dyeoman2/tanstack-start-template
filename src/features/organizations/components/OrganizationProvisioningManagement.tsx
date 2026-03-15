import { api } from '@convex/_generated/api';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { Check, Copy, Loader2, RefreshCcw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
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

export function OrganizationProvisioningManagement({
  slug,
  highlight = false,
  blockedMessage = null,
  embedded = false,
}: {
  slug: string;
  highlight?: boolean;
  blockedMessage?: string | null;
  embedded?: boolean;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { showToast } = useToast();
  const settings = useQuery(api.organizationManagement.getOrganizationEnterpriseAuthSettings, {
    slug,
  });
  const [providerKey, setProviderKey] = useState<OrganizationEnterpriseProviderKey | null>(null);
  const [revealedScimToken, setRevealedScimToken] = useState<string | null>(null);
  const [isGeneratingScimToken, setIsGeneratingScimToken] = useState(false);
  const [isDeletingScimProvider, setIsDeletingScimProvider] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [endpointCopied, setEndpointCopied] = useState(false);

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

  if (settings === undefined || settings === null || !settings.capabilities.canUpdateSettings) {
    return null;
  }

  const scimConnectionConfigured = settings.enterpriseAuth?.scimConnectionConfigured ?? false;
  const scimBaseUrl =
    typeof window === 'undefined' ? '/api/auth/scim/v2' : `${window.location.origin}/api/auth/scim/v2`;

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
      let copiedToClipboard = false;
      try {
        await navigator.clipboard.writeText(result.scimToken);
        setTokenCopied(true);
        copiedToClipboard = true;
        window.setTimeout(() => {
          setTokenCopied(false);
        }, 1500);
      } catch {
        setTokenCopied(false);
      }
      setIsGeneratingScimToken(false);
      await refreshState();
      showToast(
        copiedToClipboard
          ? scimConnectionConfigured
            ? 'Provisioning token generated and copied to your clipboard.'
            : 'Provisioning token created and copied to your clipboard.'
          : scimConnectionConfigured
            ? 'Provisioning token generated.'
            : 'Provisioning token created.',
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
      setIsGeneratingScimToken(false);
    } finally {
      // Loading state is cleared as soon as the token request completes, even if
      // follow-up refresh work is still settling.
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

  const copyScimBaseUrl = async () => {
    try {
      await navigator.clipboard.writeText(scimBaseUrl);
      setEndpointCopied(true);
      window.setTimeout(() => {
        setEndpointCopied(false);
      }, 1500);
      showToast('SCIM endpoint copied.', 'success');
    } catch (error) {
      showToast(
        getServerFunctionErrorMessage(
          error,
          'Failed to copy the SCIM endpoint. Copy it manually and try again.',
        ),
        'error',
      );
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
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Use this endpoint URL and bearer token in your identity provider&apos;s SCIM settings.
        </p>

        <div className="overflow-hidden rounded-lg border border-border/70 bg-muted/20">
          <div className="p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-medium text-foreground">SCIM endpoint URL</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void copyScimBaseUrl()}
              >
                {endpointCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {endpointCopied ? 'Copied' : 'Copy URL'}
              </Button>
            </div>
            <p className="mt-2 break-all font-mono text-sm text-foreground">{scimBaseUrl}</p>
          </div>

          <div className="border-t border-border/70 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-medium text-foreground">Bearer token</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={scimConnectionConfigured ? 'outline' : 'default'}
                  size="sm"
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
                  {scimConnectionConfigured ? 'Generate New Token' : 'Generate Token'}
                </Button>
                {revealedScimToken ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      onClick={() => void copyScimToken()}
                    >
                      {tokenCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
                      {tokenCopied ? 'Copied' : 'Copy'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setIsDeleteDialogOpen(true)}
                      disabled={isDeletingScimProvider}
                    >
                      <Trash2 className="size-4" />
                      Revoke
                    </Button>
                  </>
                ) : scimConnectionConfigured ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsDeleteDialogOpen(true)}
                    disabled={isDeletingScimProvider}
                  >
                    <Trash2 className="size-4" />
                    Revoke Token
                  </Button>
                ) : null}
              </div>
            </div>

            {revealedScimToken ? (
              <>
                <p className="mt-2 break-all font-mono text-sm text-foreground">
                  {revealedScimToken}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  This token is only shown once and was copied automatically. Store it securely.
                </p>
              </>
            ) : scimConnectionConfigured ? (
              <p className="mt-2 text-sm text-muted-foreground">
                The current bearer token is hidden after setup. Generate a new token if you need to
                reconnect your identity provider.
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                Generate a bearer token to finish SCIM setup.
              </p>
            )}
          </div>
        </div>
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
