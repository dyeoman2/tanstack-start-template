import { api } from '@convex/_generated/api';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { BiLogoMicrosoft } from 'react-icons/bi';
import { SiGoogle, SiOkta } from 'react-icons/si';
import { Badge } from '~/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { useToast } from '~/components/ui/toast';
import type {
  OrganizationEnterpriseProviderKey,
  OrganizationEnterpriseProviderOption,
} from '~/features/organizations/lib/organization-management';
import {
  getServerFunctionErrorMessage,
  refreshOrganizationClientState,
} from '~/features/organizations/lib/organization-session';
import { updateOrganizationPoliciesServerFn } from '~/features/organizations/server/organization-management';
import { cn } from '~/lib/utils';

function getProviderLogo(providerKey: OrganizationEnterpriseProviderKey) {
  switch (providerKey) {
    case 'google-workspace':
      return <SiGoogle className="size-5 text-[#4285F4]" aria-hidden="true" />;
    case 'entra':
      return <BiLogoMicrosoft className="size-5 text-[#5E5E5E]" aria-hidden="true" />;
    case 'okta':
      return <SiOkta className="size-5 text-[#007DC1]" aria-hidden="true" />;
    default:
      return null;
  }
}

export function OrganizationEnterpriseAuthManagement({
  slug,
  highlight = false,
  embedded = false,
}: {
  slug: string;
  highlight?: boolean;
  embedded?: boolean;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { showToast } = useToast();
  const settings = useQuery(api.organizationManagement.getOrganizationEnterpriseAuthSettings, {
    slug,
  });
  const [providerKey, setProviderKey] = useState<OrganizationEnterpriseProviderKey | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingProviderKey, setPendingProviderKey] =
    useState<OrganizationEnterpriseProviderKey | null>(null);

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

  const availableProviders = settings?.availableEnterpriseProviders ?? [];
  const persistedProviderKey = settings?.policies.enterpriseProviderKey ?? null;

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

  const handleProviderChange = async (
    nextProviderKey: OrganizationEnterpriseProviderKey | null,
    actionProviderKey: OrganizationEnterpriseProviderKey | null = nextProviderKey,
  ) => {
    if (isSaving) {
      setProviderKey(nextProviderKey);
      setSaveError(null);
      return;
    }

    const nextProvider = nextProviderKey
      ? settings.availableEnterpriseProviders.find(
          (provider: OrganizationEnterpriseProviderOption) => provider.key === nextProviderKey,
        )
      : null;

    setProviderKey(nextProviderKey);
    setSaveError(null);

    if (nextProviderKey === persistedProviderKey) {
      if (nextProviderKey !== null) {
        await handleProviderChange(null);
      }
      return;
    }

    if (nextProviderKey !== null && !nextProvider?.selectable) {
      return;
    }

    setIsSaving(true);
    setPendingProviderKey(actionProviderKey);

    try {
      await updateOrganizationPoliciesServerFn({
        data: {
          organizationId: settings.organization.id,
          invitePolicy: settings.policies.invitePolicy,
          verifiedDomainsOnly: settings.policies.verifiedDomainsOnly,
          memberCap: settings.policies.memberCap,
          mfaRequired: settings.policies.mfaRequired,
          enterpriseAuthMode: settings.policies.enterpriseAuthMode,
          enterpriseProviderKey: nextProviderKey,
          enterpriseProtocol: nextProviderKey ? 'oidc' : null,
          allowBreakGlassPasswordLogin: settings.policies.allowBreakGlassPasswordLogin,
        },
      });
      await refreshState();
      showToast(
        nextProviderKey ? 'Identity provider updated.' : 'Identity provider removed.',
        'success',
      );
    } catch (error) {
      const message = getServerFunctionErrorMessage(error, 'Failed to update identity provider');
      setProviderKey(persistedProviderKey);
      setSaveError(message);
      showToast(message, 'error');
    } finally {
      setIsSaving(false);
      setPendingProviderKey(null);
    }
  };

  const content = (
    <div className="space-y-6">
      <div className="space-y-3">
        <div
          role="radiogroup"
          aria-label="Identity provider"
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        >
          {availableProviders.map((provider: OrganizationEnterpriseProviderOption) => {
            const isSelected = provider.key === providerKey;
            const isPersisted = provider.key === persistedProviderKey;
            const isDisabled = isSaving || provider.status === 'coming_soon';
            const isPending = isSaving && pendingProviderKey === provider.key;

            return (
              <button
                key={provider.key}
                type="button"
                role="radio"
                aria-checked={isSelected}
                disabled={isDisabled}
                onClick={() =>
                  void handleProviderChange(isPersisted ? null : provider.key, provider.key)
                }
                className={cn(
                  'flex w-full flex-col items-start gap-4 rounded-xl border px-4 py-4 text-left transition-colors',
                  'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none',
                  isSelected
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-border bg-background hover:border-primary/40 hover:bg-accent/30',
                  isDisabled &&
                    'cursor-not-allowed opacity-60 hover:border-border hover:bg-background',
                )}
              >
                <span className="flex w-full items-start justify-between gap-3">
                  <span className="flex items-center gap-3">
                    <span className="flex size-9 items-center justify-center rounded-lg border border-border/70 bg-muted/40">
                      {getProviderLogo(provider.key)}
                    </span>
                    <span className="block text-sm font-semibold text-foreground">
                      {provider.label}
                    </span>
                  </span>
                  {isPending ? (
                    <Loader2 className="mt-0.5 size-4 animate-spin text-muted-foreground" />
                  ) : isPersisted ? (
                    <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="mt-0.5 size-4 rounded-full border border-muted-foreground/40"
                    />
                  )}
                </span>
                <span className="flex items-center gap-2">
                  {provider.status === 'coming_soon' ? (
                    <Badge variant="secondary" className="font-normal">
                      Coming soon
                    </Badge>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {selectedProvider && !selectedProvider.selectable ? (
        <div className="rounded-lg border border-amber-200/70 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {selectedProvider.label} is not configured for this deployment yet. Set up the OAuth
          integration before saving.
        </div>
      ) : null}

      {saveError ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {saveError}
        </p>
      ) : null}
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <Card className={cn(highlight ? 'border-primary shadow-md shadow-primary/5' : undefined)}>
      <CardHeader>
        <CardTitle>Step 1: identity provider</CardTitle>
        <CardDescription>
          Choose the provider your organization will use for single sign-on.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">{content}</CardContent>
    </Card>
  );
}
