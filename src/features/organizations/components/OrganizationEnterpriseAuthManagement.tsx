import { api } from '@convex/_generated/api';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { Copy, Loader2, RefreshCcw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { DeleteConfirmationDialog } from '~/components/ui/delete-confirmation-dialog';
import { useToast } from '~/components/ui/toast';
import type {
  OrganizationEnterpriseAuthMode,
  OrganizationEnterpriseProviderOption,
  OrganizationEnterpriseProviderKey,
} from '~/features/organizations/lib/organization-management';
import { refreshOrganizationClientState } from '~/features/organizations/lib/organization-session';
import {
  deleteOrganizationScimProviderServerFn,
  generateOrganizationScimTokenServerFn,
  updateOrganizationPoliciesServerFn,
} from '~/features/organizations/server/organization-management';

function providerStatusBadgeVariant(status: 'active' | 'not_configured' | 'coming_soon') {
  switch (status) {
    case 'active':
      return 'success' as const;
    case 'not_configured':
      return 'warning' as const;
    case 'coming_soon':
      return 'secondary' as const;
  }
}

function providerStatusLabel(status: 'active' | 'not_configured' | 'coming_soon') {
  switch (status) {
    case 'active':
      return 'Available';
    case 'not_configured':
      return 'Not configured';
    case 'coming_soon':
      return 'Planned';
  }
}

function enterpriseModeLabel(mode: OrganizationEnterpriseAuthMode) {
  switch (mode) {
    case 'off':
      return 'Off';
    case 'optional':
      return 'SSO preferred';
    case 'required':
      return 'SSO required';
  }
}

export function OrganizationEnterpriseAuthManagement({
  slug,
}: {
  slug: string;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { showToast } = useToast();
  const settings = useQuery(api.organizationManagement.getOrganizationEnterpriseAuthSettings, { slug });
  const [providerKey, setProviderKey] = useState<OrganizationEnterpriseProviderKey>('google-workspace');
  const [enterpriseAuthMode, setEnterpriseAuthMode] =
    useState<OrganizationEnterpriseAuthMode>('off');
  const [allowBreakGlassPasswordLogin, setAllowBreakGlassPasswordLogin] = useState(true);
  const [revealedScimToken, setRevealedScimToken] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingScimToken, setIsGeneratingScimToken] = useState(false);
  const [isDeletingScimProvider, setIsDeletingScimProvider] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setProviderKey(settings.policies.enterpriseProviderKey ?? 'google-workspace');
    setEnterpriseAuthMode(settings.policies.enterpriseAuthMode);
    setAllowBreakGlassPasswordLogin(settings.policies.allowBreakGlassPasswordLogin);
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

  const managedDomains = settings?.enterpriseAuth?.managedDomains ?? [];
  const hasVerifiedDomains = managedDomains.length > 0;
  const verifiedDomainCount = managedDomains.length;
  const scimConnectionConfigured = settings?.enterpriseAuth?.scimConnectionConfigured ?? false;
  const ssoConfigured =
    settings?.policies.enterpriseAuthMode !== 'off' && settings?.policies.enterpriseProviderKey !== null;
  const configurableProviders =
    settings?.availableEnterpriseProviders.filter(
      (provider: OrganizationEnterpriseProviderOption) => provider.selectable,
    ) ?? [];
  const plannedProviders =
    settings?.availableEnterpriseProviders.filter(
      (provider: OrganizationEnterpriseProviderOption) => !provider.selectable,
    ) ?? [];
  const provisioningConfigured = scimConnectionConfigured;
  const showProvisioningDetails = provisioningConfigured || revealedScimToken !== null;

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

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);

    try {
      await updateOrganizationPoliciesServerFn({
        data: {
          organizationId: settings.organization.id,
          invitePolicy: settings.policies.invitePolicy,
          verifiedDomainsOnly: settings.policies.verifiedDomainsOnly,
          memberCap: settings.policies.memberCap,
          mfaRequired: settings.policies.mfaRequired,
          enterpriseAuthMode,
          enterpriseProviderKey: enterpriseAuthMode === 'off' ? null : providerKey,
          enterpriseProtocol: enterpriseAuthMode === 'off' ? null : 'oidc',
          allowBreakGlassPasswordLogin,
        },
      });
      setRevealedScimToken(null);
      await refreshState();
      showToast('SSO settings updated.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update SSO settings';
      setSaveError(message);
      showToast(message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

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
          <CardTitle>SSO &amp; provisioning overview</CardTitle>
          <CardDescription>
            Track your current sign-in, provisioning, and domain setup at a glance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-border p-4">
              <p className="text-sm font-medium">SSO</p>
              <p className="mt-2 text-lg font-semibold">{ssoConfigured ? 'Configured' : 'Not configured'}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {ssoConfigured
                  ? `${selectedProvider?.label ?? 'Identity provider'} · ${enterpriseModeLabel(enterpriseAuthMode)}`
                  : 'No identity provider is enabled yet.'}
              </p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <p className="text-sm font-medium">Provisioning</p>
              <p className="mt-2 text-lg font-semibold">
                {provisioningConfigured ? 'Configured' : 'Not configured'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {provisioningConfigured
                  ? `${selectedProvider?.label ?? 'Provider'} user sync is ready.`
                  : 'No provisioning token has been generated yet.'}
              </p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <p className="text-sm font-medium">Domains</p>
              <p className="mt-2 text-lg font-semibold">
                {verifiedDomainCount} verified domain{verifiedDomainCount === 1 ? '' : 's'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {hasVerifiedDomains
                  ? 'Verified domains determine who can be routed to SSO.'
                  : 'Add and verify a company domain before requiring SSO.'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Single sign-on</CardTitle>
          <CardDescription>
            Connect an identity provider so users can sign in with their work account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <p className="text-sm font-medium">Identity provider</p>
            <div className="grid gap-3">
              {configurableProviders.map((provider: OrganizationEnterpriseProviderOption) => {
                const isSelected = provider.key === providerKey;
                const providerConfigured =
                  settings.policies.enterpriseProviderKey === provider.key &&
                  settings.policies.enterpriseAuthMode !== 'off';

                return (
                  <div
                    key={provider.key}
                    className={`rounded-lg border p-4 transition ${
                      isSelected ? 'border-primary bg-primary/5' : 'border-border'
                    }`}
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{provider.label}</p>
                          <Badge variant={providerStatusBadgeVariant(provider.status)}>
                            {providerStatusLabel(provider.status)}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">Enterprise SSO</p>
                      </div>
                      <Button
                        type="button"
                        variant={providerConfigured ? 'outline' : 'default'}
                        onClick={() => setProviderKey(provider.key)}
                      >
                        {providerConfigured ? 'View setup' : 'Configure'}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            {plannedProviders.length > 0 ? (
              <div className="space-y-3 rounded-lg border border-dashed border-border p-4">
                <p className="text-sm font-medium">Planned providers</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {plannedProviders.map((provider: OrganizationEnterpriseProviderOption) => (
                    <div
                      key={provider.key}
                      className="rounded-lg border border-border/70 bg-muted/30 p-4 text-left opacity-80"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">{provider.label}</p>
                        <Badge variant={providerStatusBadgeVariant(provider.status)}>
                          {providerStatusLabel(provider.status)}
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">Enterprise SSO</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Enforcement</p>
              {selectedProvider ? (
                <Badge variant={providerStatusBadgeVariant(selectedProvider.status)}>
                  {selectedProvider.label}
                </Badge>
              ) : null}
            </div>

            {!hasVerifiedDomains ? (
              <div className="rounded-lg border border-orange-200/70 bg-orange-50 px-4 py-3 text-sm text-orange-800">
                Verify at least one company domain before turning on required SSO.
              </div>
            ) : null}

            <div className="space-y-2">
              {([
                {
                  mode: 'off' as const,
                  label: 'Off',
                  description: 'Allow email and password sign-in for all users.',
                },
                {
                  mode: 'optional' as const,
                  label: 'SSO preferred',
                  description:
                    'Users on verified domains see SSO first, but password sign-in remains available.',
                },
                {
                  mode: 'required' as const,
                  label: 'SSO required',
                  description: 'Users on verified domains must sign in with SSO.',
                },
              ]).map((option) => (
                <label
                  key={option.mode}
                  className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm"
                >
                  <input
                    type="radio"
                    name="enterprise-auth-mode"
                    value={option.mode}
                    checked={enterpriseAuthMode === option.mode}
                    onChange={() => setEnterpriseAuthMode(option.mode)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block font-medium">{option.label}</span>
                    <span className="text-muted-foreground">{option.description}</span>
                  </span>
                </label>
              ))}
            </div>

            {enterpriseAuthMode === 'required' && !hasVerifiedDomains ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Add and verify a company domain before saving required SSO.
              </p>
            ) : null}

            <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
              <input
                type="checkbox"
                checked={allowBreakGlassPasswordLogin}
                onChange={(event) => setAllowBreakGlassPasswordLogin(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium">Keep emergency admin sign-in enabled</span>
                <span className="text-muted-foreground">
                  Allow organization owners to sign in with password if your identity provider is
                  unavailable.
                </span>
              </span>
            </label>

            <div className="rounded-lg border border-border p-4">
              <p className="text-sm font-medium">Verified domains in scope</p>
              {hasVerifiedDomains ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {managedDomains.map((domain: string) => (
                    <Badge key={domain} variant="outline">
                      {domain}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  No verified domains yet. Add one below to route and enforce SSO for your
                  organization.
                </p>
              )}
            </div>
          </div>

          {saveError ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {saveError}
            </p>
          ) : null}

          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving || !selectedProvider?.selectable}
            >
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
              Save SSO settings
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>User provisioning</CardTitle>
          <CardDescription>
            Automatically create and update users from your identity provider using SCIM.
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
            Removing users from your identity provider revokes access to this organization only and
            preserves the global user record for auditability and reprovisioning.
          </p>

          {showProvisioningDetails ? (
            <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">SCIM base URL</p>
              <p className="mt-1 font-mono text-foreground">/api/auth/scim/v2</p>
              <p className="mt-3">
                Provisioned users are added to the organization as <span className="font-medium">member</span>,
                and deprovisioning removes only this organization membership.
              </p>
            </div>
          ) : null}

          {revealedScimToken ? (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
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
