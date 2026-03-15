import { api } from '@convex/_generated/api';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { Switch } from '~/components/ui/switch';
import { useToast } from '~/components/ui/toast';
import type {
  OrganizationEnterpriseAuthMode,
  OrganizationEnterpriseProviderOption,
  OrganizationEnterpriseProviderKey,
} from '~/features/organizations/lib/organization-management';
import { refreshOrganizationClientState } from '~/features/organizations/lib/organization-session';
import { updateOrganizationPoliciesServerFn } from '~/features/organizations/server/organization-management';

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

function enforcementDescription(mode: OrganizationEnterpriseAuthMode) {
  switch (mode) {
    case 'off':
      return 'Allow email and password sign-in for all users.';
    case 'optional':
      return 'Users on verified domains see SSO first, but password sign-in remains available.';
    case 'required':
      return 'Users on verified domains must sign in with SSO.';
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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
  const availableProviders = settings?.availableEnterpriseProviders ?? [];

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

  return (
    <Card>
        <CardHeader>
          <CardTitle>Single sign-on</CardTitle>
          <CardDescription>
            Choose an identity provider and set how SSO should apply to your organization.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <p className="text-sm font-medium">Identity provider</p>
            <div className="space-y-3">
              <Select
                value={providerKey}
                onValueChange={(value) =>
                  setProviderKey(value as OrganizationEnterpriseProviderKey)
                }
              >
                <SelectTrigger className="w-full" aria-label="Identity provider">
                  <SelectValue placeholder="Select identity provider" />
                </SelectTrigger>
                <SelectContent>
                  {availableProviders.map((provider: OrganizationEnterpriseProviderOption) => (
                    <SelectItem
                      key={provider.key}
                      value={provider.key}
                      disabled={!provider.selectable}
                    >
                      {provider.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedProvider ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={providerStatusBadgeVariant(selectedProvider.status)}>
                    {providerStatusLabel(selectedProvider.status)}
                  </Badge>
                </div>
              ) : null}
            </div>
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

            <div className="space-y-3">
              <Select
                value={enterpriseAuthMode}
                onValueChange={(value) =>
                  setEnterpriseAuthMode(value as OrganizationEnterpriseAuthMode)
                }
              >
                <SelectTrigger className="w-full" aria-label="Enforcement">
                  <SelectValue placeholder="Select enforcement" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">Off</SelectItem>
                  <SelectItem value="optional">SSO preferred</SelectItem>
                  <SelectItem value="required">SSO required</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                {enforcementDescription(enterpriseAuthMode)}
              </p>
            </div>

            {enterpriseAuthMode === 'required' && !hasVerifiedDomains ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Add and verify a company domain before saving required SSO.
              </p>
            ) : null}

            {enterpriseAuthMode === 'required' ? (
              <div className="flex items-center gap-3 text-sm">
                <Switch
                  checked={allowBreakGlassPasswordLogin}
                  onCheckedChange={(checked) => setAllowBreakGlassPasswordLogin(checked === true)}
                  aria-label="Keep emergency admin sign-in enabled"
                />
                <div className="space-y-1">
                  <p className="font-medium">Keep emergency admin sign-in enabled</p>
                  <p className="text-muted-foreground">
                    Allow organization owners to bypass required SSO if your identity provider is
                    unavailable.
                  </p>
                </div>
              </div>
            ) : null}

            {hasVerifiedDomains ? (
              <div className="flex flex-wrap gap-2">
                {managedDomains.map((domain: string) => (
                  <Badge key={domain} variant="outline">
                    {domain}
                  </Badge>
                ))}
              </div>
            ) : null}
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
  );
}
