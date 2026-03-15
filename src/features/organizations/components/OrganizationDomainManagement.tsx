import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useQueryClient } from '@tanstack/react-query';
import { useAction, useMutation, useQuery } from 'convex/react';
import { CheckCircle2, Copy, Loader2, RefreshCcw, ShieldCheck, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { DeleteConfirmationDialog } from '~/components/ui/delete-confirmation-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '~/components/ui/field';
import { Input } from '~/components/ui/input';
import { useToast } from '~/components/ui/toast';

export function OrganizationDomainManagement({
  slug,
}: {
  slug: string;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const response = useQuery(api.organizationManagement.listOrganizationDomains, { slug });
  const addDomain = useMutation(api.organizationManagement.addOrganizationDomain);
  const removeDomain = useMutation(api.organizationManagement.removeOrganizationDomain);
  const regenerateDomainToken = useMutation(api.organizationManagement.regenerateOrganizationDomainToken);
  const verifyDomain = useAction(api.organizationDomains.verifyOrganizationDomain);
  const [domain, setDomain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [pendingDomainId, setPendingDomainId] = useState<Id<'organizationDomains'> | null>(null);
  const [removingDomain, setRemovingDomain] = useState<{
    id: Id<'organizationDomains'>;
    domain: string;
    organizationId: string;
  } | null>(null);

  const canManageDomains = response?.capabilities.canManageDomains ?? false;
  const domains = response?.domains ?? [];
  const organizationId = response?.organization.id ?? null;
  const sortedDomains = useMemo(
    () => [...domains].sort((left, right) => left.domain.localeCompare(right.domain)),
    [domains],
  );

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
      const message = nextError instanceof Error ? nextError.message : 'Failed to add domain';
      setError(message);
      showToast(message, 'error');
    } finally {
      setIsAdding(false);
    }
  };

  const handleCopyVerification = async (recordName: string, recordValue: string) => {
    try {
      await navigator.clipboard.writeText(`${recordName}\n${recordValue}`);
      showToast('DNS verification details copied.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to copy verification details', 'error');
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
      showToast(error instanceof Error ? error.message : 'Failed to verify domain', 'error');
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
      showToast(error instanceof Error ? error.message : 'Failed to regenerate token', 'error');
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
      showToast(error instanceof Error ? error.message : 'Failed to remove domain', 'error');
    } finally {
      setPendingDomainId(null);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle>Domains</CardTitle>
            <CardDescription>
              Verified domains establish organization ownership and identity. They do not change
              sign-in or membership behavior in this release.
            </CardDescription>
          </div>
          {canManageDomains ? (
            <Button
              type="button"
              onClick={() => {
                setError(null);
                setIsAddDialogOpen(true);
              }}
            >
              <ShieldCheck className="size-4" />
              Add domain
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-6">
          {response === undefined ? (
            <div className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              Loading domains...
            </div>
          ) : (
            <>
              {sortedDomains.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  No domains added yet.
                </div>
              ) : (
                <div className="space-y-4">
                  {sortedDomains.map((item) => {
                    const isPending = pendingDomainId === item.id;

                    return (
                      <div key={item.id} className="rounded-lg border border-border p-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-foreground">{item.domain}</p>
                              <Badge variant={item.status === 'verified' ? 'success' : 'secondary'}>
                                {item.status === 'verified' ? 'Verified' : 'Pending verification'}
                              </Badge>
                            </div>
                            <div className="text-sm text-muted-foreground">
                              <div>
                                Add a DNS TXT record:
                                <span className="ml-1 font-mono text-foreground">
                                  {item.verificationRecordName}
                                </span>
                              </div>
                              <div className="mt-1 break-all">
                                Value:
                                <span className="ml-1 font-mono text-foreground">
                                  {item.verificationRecordValue}
                                </span>
                              </div>
                              {item.verifiedAt ? (
                                <div className="mt-1">Verified {new Date(item.verifiedAt).toLocaleString()}</div>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                void handleCopyVerification(
                                  item.verificationRecordName,
                                  item.verificationRecordValue,
                                )
                              }
                            >
                              <Copy className="size-4" />
                              Copy DNS details
                            </Button>
                            {canManageDomains ? (
                              <>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    void handleVerify(item.id);
                                  }}
                                  disabled={isPending}
                                >
                                  {isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                                  Verify
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    void handleRegenerate(item.id);
                                  }}
                                  disabled={isPending}
                                >
                                  <RefreshCcw className="size-4" />
                                  Regenerate token
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost-destructive"
                                  size="sm"
                                  onClick={() =>
                                    setRemovingDomain({
                                      id: item.id,
                                      domain: item.domain,
                                      organizationId: item.organizationId,
                                    })
                                  }
                                  disabled={isPending}
                                >
                                  <Trash2 className="size-4" />
                                  Remove
                                </Button>
                              </>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

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
          <div className="space-y-4">
            <Field>
              <FieldLabel htmlFor="organization-domain">Domain</FieldLabel>
              <Input
                id="organization-domain"
                value={domain}
                onChange={(event) => setDomain(event.target.value)}
                placeholder="example.com"
                disabled={isAdding}
              />
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
              {isAdding ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              Add domain
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
