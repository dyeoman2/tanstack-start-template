import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useQueryClient } from '@tanstack/react-query';
import { useAction, useMutation, useQuery } from 'convex/react';
import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Loader2,
  MoreVertical,
  RefreshCcw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert';
import { Badge } from '~/components/ui/badge';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '~/components/ui/field';
import { Input } from '~/components/ui/input';
import { useToast } from '~/components/ui/toast';
import { useAuth } from '~/features/auth/hooks/useAuth';
import { getServerFunctionErrorMessage } from '~/features/organizations/lib/organization-session';
import { cn } from '~/lib/utils';

function getVerifyDomainErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return 'Unable to verify the domain right now. Refresh the page and try again.';
  }

  if (
    error.message.includes('ReturnsValidationError') ||
    error.message.includes('Value does not match validator')
  ) {
    return 'Unable to verify the domain right now. Refresh the page and try again.';
  }

  return getServerFunctionErrorMessage(error, error.message);
}

type DnsProviderHint = {
  providerName: string | null;
  providerUrl: string | null;
  confidence: 'high' | 'medium' | null;
};

export function OrganizationDomainManagement({
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
  const { showToast } = useToast();
  const { user } = useAuth();
  const userEmailDomain = user?.email?.split('@')[1] ?? '';
  const response = useQuery(api.organizationManagement.listOrganizationDomains, { slug });
  const addDomain = useMutation(api.organizationManagement.addOrganizationDomain);
  const removeDomain = useMutation(api.organizationManagement.removeOrganizationDomain);
  const regenerateDomainToken = useMutation(
    api.organizationManagement.regenerateOrganizationDomainToken,
  );
  const verifyDomain = useAction(api.organizationDomains.verifyOrganizationDomain);
  const detectDnsProvider = useAction(api.organizationDomains.detectOrganizationDomainDnsProvider);
  const [domain, setDomain] = useState(userEmailDomain);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [pendingDomainId, setPendingDomainId] = useState<Id<'organizationDomains'> | null>(null);
  const [removingDomain, setRemovingDomain] = useState<{
    id: Id<'organizationDomains'>;
    domain: string;
    organizationId: string;
  } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [dnsProviderHints, setDnsProviderHints] = useState<Record<string, DnsProviderHint>>({});
  const requestedProviderHintsRef = useRef<Set<string>>(new Set());

  const canManageDomains = response?.capabilities.canManageDomains ?? false;
  const domains = response?.domains;
  const organizationId = response?.organization.id ?? null;
  const sortedDomains = useMemo(
    () => [...(domains ?? [])].sort((left, right) => left.domain.localeCompare(right.domain)),
    [domains],
  );

  useEffect(() => {
    if (response === undefined || !canManageDomains) {
      return;
    }

    for (const item of sortedDomains) {
      if (item.status === 'verified') {
        continue;
      }

      if (dnsProviderHints[item.id] || requestedProviderHintsRef.current.has(item.id)) {
        continue;
      }

      requestedProviderHintsRef.current.add(item.id);

      void detectDnsProvider({
        organizationId: item.organizationId,
        domainId: item.id,
      })
        .then((hint) => {
          if (!hint.providerName) {
            return;
          }

          setDnsProviderHints((current) => ({
            ...current,
            [item.id]: {
              providerName: hint.providerName,
              providerUrl: hint.providerUrl,
              confidence: hint.confidence,
            },
          }));
        })
        .catch(() => {
          // Best-effort hint only; ignore resolver failures.
        });
    }
  }, [canManageDomains, detectDnsProvider, dnsProviderHints, response, sortedDomains]);

  const invalidateDomainQueries = async () => {
    await queryClient.invalidateQueries({ queryKey: ['organizations'] });
  };

  const handleAddDomain = async () => {
    if (!organizationId) {
      return;
    }

    setIsAdding(true);
    setError(null);

    try {
      await addDomain({
        organizationId,
        domain,
      });
      setDomain('');
      setIsAddDialogOpen(false);
      await invalidateDomainQueries();
      showToast('Domain added.', 'success');
    } catch (nextError) {
      const message = getServerFunctionErrorMessage(nextError, 'Failed to add domain');
      setError(message);
      showToast(message, 'error');
    } finally {
      setIsAdding(false);
    }
  };

  const handleCopyField = async (value: string, label: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(key);
      window.setTimeout(() => {
        setCopiedField((current) => (current === key ? null : current));
      }, 1500);
      showToast(`${label} copied.`, 'success');
    } catch (error) {
      showToast(
        getServerFunctionErrorMessage(error, `Failed to copy ${label.toLowerCase()}`),
        'error',
      );
    }
  };

  const handleVerify = async (domainId: Id<'organizationDomains'>) => {
    if (!organizationId) {
      return;
    }

    setPendingDomainId(domainId);

    try {
      const result = await verifyDomain({
        organizationId,
        domainId,
      });
      await invalidateDomainQueries();

      if (result.verified) {
        showToast('Domain verified.', 'success');
      } else {
        showToast(result.reason ?? 'Domain verification failed', 'error');
      }
    } catch (error) {
      showToast(getVerifyDomainErrorMessage(error), 'error');
    } finally {
      setPendingDomainId(null);
    }
  };

  const handleRegenerate = async (domainId: Id<'organizationDomains'>) => {
    if (!organizationId) {
      return;
    }

    setPendingDomainId(domainId);

    try {
      await regenerateDomainToken({
        organizationId,
        domainId,
      });
      await invalidateDomainQueries();
      showToast('Verification token regenerated.', 'success');
    } catch (error) {
      showToast(getServerFunctionErrorMessage(error, 'Failed to regenerate token'), 'error');
    } finally {
      setPendingDomainId(null);
    }
  };

  const handleRemove = async () => {
    if (!removingDomain) {
      return;
    }

    setPendingDomainId(removingDomain.id);

    try {
      await removeDomain({
        organizationId: removingDomain.organizationId,
        domainId: removingDomain.id,
      });
      await invalidateDomainQueries();
      setRemovingDomain(null);
      showToast('Domain removed.', 'success');
    } catch (error) {
      showToast(getServerFunctionErrorMessage(error, 'Failed to remove domain'), 'error');
    } finally {
      setPendingDomainId(null);
    }
  };

  const addDomainButton = canManageDomains ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        setError(null);
        setIsAddDialogOpen(true);
      }}
      disabled={blockedMessage !== null}
    >
      <ShieldCheck data-icon="inline-start" />
      Add another domain
    </Button>
  ) : null;

  const domainContent = (
    <div className="flex flex-col gap-6">
      {blockedMessage ? (
        <Alert variant="warning">
          <ShieldCheck aria-hidden="true" />
          <AlertTitle>Domain Verification Blocked</AlertTitle>
          <AlertDescription>{blockedMessage}</AlertDescription>
        </Alert>
      ) : null}
      {response === undefined ? (
        <div className="flex min-h-32 items-center justify-center gap-2 rounded-2xl border border-dashed border-border/70 bg-muted/20 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading Domains…
        </div>
      ) : sortedDomains.length === 0 ? (
        canManageDomains ? (
          <FieldGroup className="mt-1 w-full gap-3">
            <Field>
              <FieldLabel htmlFor="first-domain" className="sr-only">
                Domain
              </FieldLabel>
              <FieldContent>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                  <Input
                    id="first-domain"
                    name="domain"
                    value={domain}
                    onChange={(event) => setDomain(event.target.value)}
                    placeholder="company.com…"
                    autoComplete="off"
                    spellCheck={false}
                    className="lg:flex-1"
                    disabled={isAdding || blockedMessage !== null}
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      void handleAddDomain();
                    }}
                    disabled={isAdding || domain.trim().length === 0 || blockedMessage !== null}
                  >
                    {isAdding ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <ShieldCheck data-icon="inline-start" />
                    )}
                    Add Domain
                  </Button>
                </div>
                <FieldDescription className="text-left">
                  Enter the company email domain you want to use for SSO, such as ` company.com`.
                </FieldDescription>
                {error ? <FieldError>{error}</FieldError> : null}
              </FieldContent>
            </Field>
          </FieldGroup>
        ) : (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">No Verified Domains Yet</p>
            <p className="mt-2">
              Ask an organization owner to add and verify a company domain before you enable SSO
              enforcement.
            </p>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-4">
          {sortedDomains.map((item) => {
            const isPending = pendingDomainId === item.id;
            const isVerified = item.status === 'verified';
            const dnsProviderHint = dnsProviderHints[item.id];

            return (
              <div
                key={item.id}
                className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm"
              >
                <div className="flex flex-col gap-4">
                  {/* Header: domain name, status badge, and actions */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-foreground">{item.domain}</p>
                        <Badge variant={isVerified ? 'success' : 'warning'}>
                          {isVerified ? 'Verified' : 'Pending Verification'}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {canManageDomains ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              disabled={isPending}
                            >
                              <MoreVertical />
                              <span className="sr-only">More actions</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {isVerified ? (
                              <DropdownMenuItem
                                onClick={() => {
                                  void handleVerify(item.id);
                                }}
                              >
                                <CheckCircle2 className="size-4" />
                                Re-verify
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuItem
                              onClick={() => {
                                void handleRegenerate(item.id);
                              }}
                            >
                              <RefreshCcw className="size-4" />
                              Regenerate token
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() =>
                                setRemovingDomain({
                                  id: item.id,
                                  domain: item.domain,
                                  organizationId: item.organizationId,
                                })
                              }
                            >
                              <Trash2 className="size-4" />
                              Remove domain
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </div>
                  </div>

                  {!isVerified ? (
                    <div className="flex flex-col gap-2.5 text-sm text-muted-foreground">
                      <p className="font-medium text-foreground">DNS Setup</p>
                      <ol className="list-inside list-decimal">
                        <li className="space-y-2">
                          <span>
                            Open DNS settings for {item.domain}.
                            {dnsProviderHint?.providerName ? (
                              <>
                                {' '}
                                Most likely managed in{' '}
                                {dnsProviderHint.providerUrl ? (
                                  <a
                                    href={dnsProviderHint.providerUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-4 transition-colors hover:text-primary"
                                  >
                                    {dnsProviderHint.providerName}
                                    <ExternalLink className="size-3.5" />
                                  </a>
                                ) : (
                                  <span className="font-medium text-foreground">
                                    {dnsProviderHint.providerName}
                                  </span>
                                )}
                                .
                              </>
                            ) : null}
                          </span>
                        </li>
                        <li>
                          Add a TXT record in your provider&apos;s DNS settings using the host and
                          value shown below.
                        </li>
                      </ol>

                      <div className="overflow-hidden rounded-xl border border-border/70">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-muted/50">
                              <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                                Type
                              </th>
                              <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                                Host
                              </th>
                              <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                                TXT Value
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="border-t">
                              <td className="px-3 py-2.5 font-mono text-xs text-foreground">TXT</td>
                              <td className="px-3 py-2.5 align-top">
                                <div className="flex items-center gap-2">
                                  <code className="break-all font-mono text-xs text-foreground">
                                    {item.verificationRecordName}
                                  </code>
                                  {(() => {
                                    const copyKey = `${item.id}-record-name`;
                                    const isCopied = copiedField === copyKey;

                                    return (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        className="text-muted-foreground hover:text-foreground"
                                        onClick={() =>
                                          void handleCopyField(
                                            item.verificationRecordName,
                                            'Record name',
                                            copyKey,
                                          )
                                        }
                                        aria-label={
                                          isCopied ? 'Record name copied' : 'Copy record name'
                                        }
                                      >
                                        {isCopied ? <Check /> : <Copy />}
                                        <span className="sr-only">
                                          {isCopied ? 'Record name copied' : 'Copy record name'}
                                        </span>
                                      </Button>
                                    );
                                  })()}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 align-top">
                                <div className="flex items-center gap-2">
                                  <code className="break-all font-mono text-xs text-foreground">
                                    {item.verificationRecordValue}
                                  </code>
                                  {(() => {
                                    const copyKey = `${item.id}-record-value`;
                                    const isCopied = copiedField === copyKey;

                                    return (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        className="text-muted-foreground hover:text-foreground"
                                        onClick={() =>
                                          void handleCopyField(
                                            item.verificationRecordValue,
                                            'Record value',
                                            copyKey,
                                          )
                                        }
                                        aria-label={
                                          isCopied ? 'Record value copied' : 'Copy record value'
                                        }
                                      >
                                        {isCopied ? <Check /> : <Copy />}
                                        <span className="sr-only">
                                          {isCopied ? 'Record value copied' : 'Copy record value'}
                                        </span>
                                      </Button>
                                    );
                                  })()}
                                </div>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      <p className="text-xs text-muted-foreground">
                        Use the values exactly as shown. Some DNS providers automatically append the
                        domain.
                      </p>
                      <p>
                        3. Check whether the DNS record is available by clicking the button below.
                      </p>
                      <div className="flex flex-wrap items-center gap-3">
                        {canManageDomains ? (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                              void handleVerify(item.id);
                            }}
                            disabled={isPending}
                          >
                            {isPending ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <CheckCircle2 data-icon="inline-start" />
                            )}
                            Check DNS Record
                          </Button>
                        ) : null}
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock className="size-3.5" />
                          DNS changes usually show up within a few minutes, but can take up to 48
                          hours.
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {item.verifiedAt ? (
                    <p className="text-xs text-muted-foreground">
                      Verified {new Date(item.verifiedAt).toLocaleString()}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
          {addDomainButton ? <div className="flex justify-end">{addDomainButton}</div> : null}
        </div>
      )}
    </div>
  );

  return (
    <>
      {embedded ? (
        domainContent
      ) : (
        <Card className={cn(highlight ? 'border-primary shadow-md shadow-primary/5' : undefined)}>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <CardTitle>Step 2: Verify Domains</CardTitle>
              <CardDescription>
                Verify company domains so SSO can route and enforce sign-in for the right users.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">{domainContent}</CardContent>
        </Card>
      )}

      <Dialog
        open={isAddDialogOpen}
        onOpenChange={(open) => {
          setIsAddDialogOpen(open);
          if (!open) {
            setDomain('');
            setError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add domain</DialogTitle>
            <DialogDescription>
              Add a domain to verify organization ownership with a DNS TXT record.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="organization-domain">Domain</FieldLabel>
              <FieldContent>
                <FieldDescription>
                  Add the company domain you want to verify with a TXT record.
                </FieldDescription>
                <Input
                  id="organization-domain"
                  name="domain"
                  value={domain}
                  onChange={(event) => setDomain(event.target.value)}
                  placeholder="company.com…"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={isAdding}
                />
              </FieldContent>
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsAddDialogOpen(false);
              }}
              disabled={isAdding}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleAddDomain();
              }}
              disabled={isAdding || domain.trim().length === 0}
            >
              {isAdding ? (
                <Loader2 className="animate-spin" />
              ) : (
                <ShieldCheck data-icon="inline-start" />
              )}
              Add Domain
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={removingDomain !== null}
        onClose={() => setRemovingDomain(null)}
        title="Remove domain"
        description={
          removingDomain
            ? `Remove ${removingDomain.domain} from this organization. This will release the claim so another organization can add it later.`
            : 'Remove domain'
        }
        confirmationPhrase={removingDomain?.domain ?? ''}
        confirmationPlaceholder={removingDomain?.domain ?? ''}
        deleteText="Remove domain"
        isDeleting={removingDomain !== null && pendingDomainId === removingDomain.id}
        onConfirm={handleRemove}
        variant="danger"
      />
    </>
  );
}
