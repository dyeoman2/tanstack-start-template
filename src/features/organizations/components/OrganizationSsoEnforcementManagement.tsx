import { api } from '@convex/_generated/api';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Switch } from '~/components/ui/switch';
import { useToast } from '~/components/ui/toast';
import type {
  OrganizationEnterpriseAuthMode,
  OrganizationEnterpriseProviderOption,
} from '~/features/organizations/lib/organization-management';
import {
  getServerFunctionErrorMessage,
  refreshOrganizationClientState,
} from '~/features/organizations/lib/organization-session';
import { updateOrganizationPoliciesServerFn } from '~/features/organizations/server/organization-management';
import { cn } from '~/lib/utils';

const ENFORCEMENT_OPTIONS: Array<{
  value: OrganizationEnterpriseAuthMode;
  label: string;
  description: string;
}> = [
  {
    value: 'off',
    label: 'Off',
    description: 'Allow email and password sign-in for all users.',
  },
  {
    value: 'optional',
    label: 'SSO Preferred',
    description: 'Route verified users to SSO first, while keeping password sign-in available.',
  },
  {
    value: 'required',
    label: 'SSO Required',
    description: 'Require users on verified domains to sign in with SSO.',
  },
];

export function OrganizationSsoEnforcementManagement({
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
  const [enterpriseAuthMode, setEnterpriseAuthMode] =
    useState<OrganizationEnterpriseAuthMode>('off');
  const [allowBreakGlassPasswordLogin, setAllowBreakGlassPasswordLogin] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingMode, setPendingMode] = useState<OrganizationEnterpriseAuthMode | null>(null);
  const [isSavingBreakGlass, setIsSavingBreakGlass] = useState(false);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setEnterpriseAuthMode(settings.policies.enterpriseAuthMode);
    setAllowBreakGlassPasswordLogin(settings.policies.allowBreakGlassPasswordLogin);
  }, [settings]);

  const selectedProvider = useMemo(
    () =>
      settings?.availableEnterpriseProviders.find(
        (provider: OrganizationEnterpriseProviderOption) =>
          provider.key === settings.policies.enterpriseProviderKey,
      ) ?? null,
    [settings],
  );

  const managedDomains = settings?.enterpriseAuth?.managedDomains ?? [];
  const hasVerifiedDomains = managedDomains.length > 0;

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

  const persistEnforcement = async ({
    nextMode,
    nextBreakGlass,
  }: {
    nextMode: OrganizationEnterpriseAuthMode;
    nextBreakGlass: boolean;
  }) => {
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
          enterpriseAuthMode: nextMode,
          enterpriseProviderKey: nextMode === 'off' ? null : settings.policies.enterpriseProviderKey,
          enterpriseProtocol:
            nextMode === 'off' ? null : (settings.policies.enterpriseProtocol ?? 'oidc'),
          allowBreakGlassPasswordLogin: nextBreakGlass,
        },
      });
      await refreshState();
      showToast('SSO enforcement updated.', 'success');
    } catch (error) {
      const message = getServerFunctionErrorMessage(
        error,
        'Failed to update SSO enforcement. Check your provider settings and try again.',
      );
      setEnterpriseAuthMode(settings.policies.enterpriseAuthMode);
      setAllowBreakGlassPasswordLogin(settings.policies.allowBreakGlassPasswordLogin);
      setSaveError(message);
      showToast(message, 'error');
    } finally {
      setIsSaving(false);
      setPendingMode(null);
      setIsSavingBreakGlass(false);
    }
  };

  const handleModeChange = async (nextMode: OrganizationEnterpriseAuthMode) => {
    if (isSaving || blockedMessage !== null) {
      return;
    }

    if (nextMode === enterpriseAuthMode) {
      return;
    }

    if (nextMode !== 'off' && !selectedProvider?.selectable) {
      return;
    }

    const nextBreakGlass =
      nextMode === 'required'
        ? allowBreakGlassPasswordLogin
        : settings.policies.allowBreakGlassPasswordLogin;

    setEnterpriseAuthMode(nextMode);
    setPendingMode(nextMode);
    await persistEnforcement({
      nextMode,
      nextBreakGlass,
    });
  };

  const handleBreakGlassChange = async (checked: boolean) => {
    if (isSaving || enterpriseAuthMode !== 'required') {
      return;
    }

    setAllowBreakGlassPasswordLogin(checked);
    setIsSavingBreakGlass(true);
    await persistEnforcement({
      nextMode: enterpriseAuthMode,
      nextBreakGlass: checked,
    });
  };

  const content = (
    <div className="space-y-6">
      {embedded ? null : null}
      <div className="space-y-4">
        {!blockedMessage && !hasVerifiedDomains ? (
          <div className="rounded-lg border border-orange-200/70 bg-orange-50 px-4 py-3 text-sm text-orange-800">
            Decide how SSO should be enforced for this organization
          </div>
        ) : null}

        <div role="radiogroup" aria-label="Enforcement" className="grid gap-3 lg:grid-cols-3">
          {ENFORCEMENT_OPTIONS.map((option) => {
            const isSelected = option.value === enterpriseAuthMode;
            const isDisabled =
              blockedMessage !== null ||
              isSaving ||
              (option.value !== 'off' && !selectedProvider?.selectable);
            const isPending = pendingMode === option.value;

            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={isSelected}
                disabled={isDisabled}
                onClick={() => void handleModeChange(option.value)}
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
                  <span className="block text-sm font-semibold text-foreground">
                    {option.label}
                  </span>
                  {isPending ? (
                    <Loader2 className="mt-0.5 size-4 animate-spin text-muted-foreground" />
                  ) : isSelected ? (
                    <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="mt-0.5 size-4 rounded-full border border-muted-foreground/40"
                    />
                  )}
                </span>
                <span className="text-sm text-muted-foreground">{option.description}</span>
              </button>
            );
          })}
        </div>
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
            onCheckedChange={(checked) => {
              void handleBreakGlassChange(checked === true);
            }}
            aria-label="Keep Emergency Admin Sign-In Enabled"
            disabled={isSavingBreakGlass}
          />
          <div className="space-y-1">
            <p className="font-medium">Keep Emergency Admin Sign-In Enabled</p>
            <p className="text-muted-foreground">
              Allow organization owners to bypass required SSO if your identity provider is
              unavailable.
            </p>
          </div>
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
        <CardTitle>Step 3: Enforcement</CardTitle>
        <CardDescription>Decide how SSO should be enforced for this organization.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">{content}</CardContent>
    </Card>
  );
}
