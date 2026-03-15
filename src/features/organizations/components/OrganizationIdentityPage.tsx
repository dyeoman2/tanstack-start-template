import { api } from '@convex/_generated/api';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { CheckCircle2, Lock } from 'lucide-react';
import { useEffect, useRef } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '~/components/ui/accordion';
import { Badge } from '~/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Separator } from '~/components/ui/separator';
import { OrganizationDomainManagement } from '~/features/organizations/components/OrganizationDomainManagement';
import { OrganizationEnterpriseAuthManagement } from '~/features/organizations/components/OrganizationEnterpriseAuthManagement';
import { OrganizationProvisioningManagement } from '~/features/organizations/components/OrganizationProvisioningManagement';
import { OrganizationSsoEnforcementManagement } from '~/features/organizations/components/OrganizationSsoEnforcementManagement';
import { OrganizationWorkspaceNav } from '~/features/organizations/components/OrganizationWorkspaceNav';
import { OrganizationWorkspaceTabs } from '~/features/organizations/components/OrganizationWorkspaceTabs';
import { getOrganizationBreadcrumbName } from '~/features/organizations/lib/organization-breadcrumb-state';
import { cn } from '~/lib/utils';

type StepKey = 'step-1' | 'step-2' | 'step-3' | 'step-4';

export function OrganizationIdentityPage({
  slug,
  searchParams,
}: {
  slug: string;
  searchParams: {
    step?: StepKey;
  };
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const settings = useQuery(api.organizationManagement.getOrganizationSettings, { slug });

  // Pre-warm Convex subscriptions so data is cached before accordion panels open.
  // Without these, each panel fetches on mount and shows a loading spinner.
  useQuery(api.organizationManagement.getOrganizationEnterpriseAuthSettings, { slug });
  useQuery(api.organizationManagement.listOrganizationDomains, { slug });
  const optimisticOrganizationName = getOrganizationBreadcrumbName(location.state, slug);
  const organizationName =
    settings?.organization.name ?? optimisticOrganizationName ?? 'Loading organization';
  const availableEnterpriseProviders = settings?.availableEnterpriseProviders ?? [];

  const hasProviderSelected = settings?.policies.enterpriseProviderKey != null;
  const selectedProvider = hasProviderSelected
    ? (availableEnterpriseProviders.find(
        (provider: (typeof availableEnterpriseProviders)[number]) =>
          provider.key === settings?.policies.enterpriseProviderKey,
      ) ?? null)
    : null;
  const settingsLoaded = settings !== undefined;
  const providerReady = selectedProvider?.status === 'active';
  const hasVerifiedDomains = (settings?.enterpriseAuth?.managedDomains.length ?? 0) > 0;
  const enforcementConfigured =
    settings?.policies.enterpriseAuthMode !== undefined &&
    settings.policies.enterpriseAuthMode !== 'off';
  const provisioningConfigured = settings?.enterpriseAuth?.scimConnectionConfigured ?? false;

  const currentStep: StepKey | null = !providerReady
    ? 'step-1'
    : !hasVerifiedDomains
      ? 'step-2'
      : !enforcementConfigured
        ? 'step-3'
        : !provisioningConfigured
          ? 'step-4'
          : null;

  const domainBlockedMessage = settingsLoaded && !hasProviderSelected
    ? 'Select and save an identity provider before verifying domains.'
    : null;

  const enforcementBlockedMessage = !settingsLoaded
    ? null
    : !providerReady
    ? 'Complete identity provider setup before choosing an enforcement level.'
    : !hasVerifiedDomains
      ? 'Verify at least one company domain before choosing an enforcement level.'
      : null;

  const provisioningBlockedMessage = !settingsLoaded
    ? null
    : !providerReady
    ? 'Complete identity provider setup before provisioning users.'
    : !hasVerifiedDomains
      ? 'Verify at least one company domain before provisioning users.'
      : !enforcementConfigured
        ? 'Choose an enforcement level before setting up provisioning.'
        : null;

  const prevCurrentStep = useRef(currentStep);
  const openStep = searchParams.step ?? currentStep ?? '';

  useEffect(() => {
    if (!currentStep) {
      prevCurrentStep.current = currentStep;
      return;
    }

    const shouldSyncStep =
      searchParams.step === undefined || searchParams.step === prevCurrentStep.current;

    if (shouldSyncStep && searchParams.step !== currentStep) {
      void navigate({
        to: '/app/organizations/$slug/identity',
        params: { slug },
        search: {
          ...searchParams,
          step: currentStep,
        },
        replace: true,
      });
    }

    prevCurrentStep.current = currentStep;
  }, [currentStep, navigate, searchParams, slug]);

  if (settings === null) {
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

  const steps: {
    key: StepKey;
    number: number;
    label: string;
    sublabel?: string;
    completed: boolean;
    blockedMessage: string | null;
    summary: string;
    content: React.ReactNode;
  }[] = [
    {
      key: 'step-1',
      number: 1,
      label: 'Identity provider',
      completed: providerReady,
      blockedMessage: null,
      summary: 'Choose the single identity provider your organization will use for SSO.',
      content: <OrganizationEnterpriseAuthManagement slug={slug} embedded />,
    },
    {
      key: 'step-2',
      number: 2,
      label: 'Domains',
      completed: hasVerifiedDomains,
      blockedMessage: domainBlockedMessage,
      summary: 'Add and verify the company domains that should use SSO.',
      content: (
        <OrganizationDomainManagement slug={slug} blockedMessage={domainBlockedMessage} embedded />
      ),
    },
    {
      key: 'step-3',
      number: 3,
      label: 'Enforcement',
      completed: enforcementConfigured,
      blockedMessage: enforcementBlockedMessage,
      summary: 'Decide how SSO should be enforced for your users.',
      content: (
        <OrganizationSsoEnforcementManagement
          slug={slug}
          blockedMessage={enforcementBlockedMessage}
          embedded
        />
      ),
    },
    {
      key: 'step-4',
      number: 4,
      label: 'Provisioning',
      sublabel: '(optional)',
      completed: provisioningConfigured,
      blockedMessage: provisioningBlockedMessage,
      summary: 'Automatically create, update, and deprovision users from your identity provider using SCIM.',
      content: (
        <OrganizationProvisioningManagement
          slug={slug}
          blockedMessage={provisioningBlockedMessage}
          embedded
        />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <OrganizationWorkspaceNav
        title={organizationName}
        description="Manage single sign-on, user provisioning, and verified domains for your organization."
      />
      <OrganizationWorkspaceTabs slug={slug} organizationName={organizationName} />

      <Card className="overflow-hidden border-border/70 shadow-sm">
        <CardHeader className="flex flex-col gap-1">
          <CardTitle>Set Up SSO & Provisioning</CardTitle>
          <CardDescription>
            Complete these steps to configure SSO, domain verification, enforcement, and optional
            SCIM provisioning.
          </CardDescription>
        </CardHeader>
        <Separator />
        <CardContent className="px-4 pt-2 pb-1 md:px-6 md:pt-3 md:pb-2">
          <Accordion
            type="single"
            collapsible
            value={openStep}
            onValueChange={(value) => {
              void navigate({
                to: '/app/organizations/$slug/identity',
                params: { slug },
                search: {
                  ...searchParams,
                  step: value === '' ? undefined : (value as StepKey),
                },
                replace: true,
              });
            }}
            className="flex flex-col gap-3"
          >
            {steps.map((step) => {
              const isCurrent = currentStep === step.key;
              const isBlocked = step.blockedMessage !== null;
              const statusCopy = step.summary;
              const blockedBadgeLabel =
                step.key === 'step-4' ? 'Enforcement Setup Required' : 'Domain Setup Required';

              return (
                <AccordionItem
                  key={step.key}
                  value={step.key}
                  className={cn(
                    'overflow-hidden rounded-2xl border border-border/70 bg-background shadow-sm',
                    isCurrent && 'border-primary/25 shadow-md shadow-primary/5',
                    step.completed && 'border-emerald-200/80',
                  )}
                >
                  <AccordionTrigger className="px-5 py-5 hover:no-underline md:px-6">
                    <div className="flex min-w-0 flex-1 items-start gap-4">
                      <div
                        className={cn(
                          'flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors',
                          step.completed && 'bg-emerald-500 text-white',
                          isCurrent && !step.completed && 'bg-primary text-primary-foreground',
                          !isCurrent && !step.completed && 'bg-muted text-muted-foreground',
                        )}
                      >
                        {step.completed ? <CheckCircle2 className="size-4" /> : step.number}
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              'text-base font-semibold',
                              isBlocked && !step.completed && 'text-muted-foreground',
                            )}
                          >
                            Step {step.number}: {step.label}
                          </span>
                          {step.sublabel ? (
                            <span className="text-xs text-muted-foreground">{step.sublabel}</span>
                          ) : null}
                          {isBlocked ? (
                            <Badge variant="warning" className="items-center">
                              <Lock aria-hidden="true" />
                              {blockedBadgeLabel}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-sm text-muted-foreground">{statusCopy}</p>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-5 pb-5 md:px-6 md:pb-6">
                    {step.content}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
