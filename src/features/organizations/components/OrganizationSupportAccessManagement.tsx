import { api } from '@convex/_generated/api';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Checkbox } from '~/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { Textarea } from '~/components/ui/textarea';
import { useToast } from '~/components/ui/toast';
import { createSupportAccessApprovalStepUpChallengeServerFn } from '~/features/auth/server/step-up';
import {
  getServerFunctionErrorMessage,
  refreshOrganizationClientState,
} from '~/features/organizations/lib/organization-session';
import {
  createOrganizationSupportAccessGrantServerFn,
  revokeOrganizationSupportAccessGrantServerFn,
  updateOrganizationSupportAccessPolicyServerFn,
} from '~/features/organizations/server/organization-management';

const DURATION_OPTIONS = [
  { label: '1 hour', value: '1' },
  { label: '4 hours', value: '4' },
  { label: '8 hours', value: '8' },
] as const;

const SUPPORT_ACCESS_REASON_OPTIONS = [
  { label: 'Incident response', value: 'incident_response' },
  { label: 'Customer-requested change', value: 'customer_requested_change' },
  { label: 'Data repair', value: 'data_repair' },
  { label: 'Account recovery', value: 'account_recovery' },
  { label: 'Other', value: 'other' },
] as const;

function formatTimestamp(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function getGrantStatus(grant: { expiresAt: number; revokedAt: number | null }) {
  if (grant.revokedAt !== null) {
    return 'revoked' as const;
  }

  return grant.expiresAt > Date.now() ? 'active' : 'expired';
}

function humanizeScope(scope: 'read_only' | 'read_write') {
  return scope === 'read_write' ? 'Read / write' : 'Read only';
}

function humanizeReasonCategory(category: (typeof SUPPORT_ACCESS_REASON_OPTIONS)[number]['value']) {
  return (
    SUPPORT_ACCESS_REASON_OPTIONS.find((option) => option.value === category)?.label ?? category
  );
}

export function OrganizationSupportAccessManagement({ slug }: { slug: string }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { showToast } = useToast();
  const settings = useQuery(api.organizationManagement.getOrganizationSupportAccessSettings, {
    slug,
  });
  const [siteAdminUserId, setSiteAdminUserId] = useState('');
  const [supportAccessEnabled, setSupportAccessEnabled] = useState(true);
  const [scope, setScope] = useState<'read_only' | 'read_write'>('read_only');
  const [durationHours, setDurationHours] =
    useState<(typeof DURATION_OPTIONS)[number]['value']>('1');
  const [reasonCategory, setReasonCategory] =
    useState<(typeof SUPPORT_ACCESS_REASON_OPTIONS)[number]['value']>('incident_response');
  const [ticketId, setTicketId] = useState('');
  const [reasonDetails, setReasonDetails] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingPolicy, setIsSavingPolicy] = useState(false);
  const [revokingGrantId, setRevokingGrantId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [selectedGrantId, setSelectedGrantId] = useState<string | null>(null);

  useEffect(() => {
    if (!settings?.availableSiteAdmins.length) {
      return;
    }

    setSiteAdminUserId(
      (currentValue) => currentValue || settings.availableSiteAdmins[0]?.authUserId || '',
    );
  }, [settings]);

  useEffect(() => {
    setSupportAccessEnabled(settings?.supportAccessEnabled ?? true);
  }, [settings?.supportAccessEnabled]);

  useEffect(() => {
    if (scope === 'read_write') {
      setDurationHours('1');
    }
  }, [scope]);

  const refreshState = async () => {
    await refreshOrganizationClientState(queryClient, {
      invalidateRouter: async () => {
        await router.invalidate();
      },
    });
  };

  const grants = useMemo(() => settings?.grants ?? [], [settings?.grants]);
  const selectedGrant =
    grants.find((grant: (typeof grants)[number]) => grant.id === selectedGrantId) ?? null;

  if (settings === undefined || settings === null || !settings.canManageSupportAccess) {
    return null;
  }

  const ensureFreshApprovalStepUp = async () => {
    if (settings.stepUpSatisfied) {
      return true;
    }

    const challenge = await createSupportAccessApprovalStepUpChallengeServerFn({
      data: {
        redirectTo: `/app/organizations/${slug}/identity`,
      },
    });
    await router.navigate({
      to: '/step-up',
      search: { challengeId: challenge.challengeId },
    });
    return false;
  };

  const handleSavePolicy = async () => {
    setIsSavingPolicy(true);
    setSaveError(null);

    try {
      if (!(await ensureFreshApprovalStepUp())) {
        return;
      }

      await updateOrganizationSupportAccessPolicyServerFn({
        data: {
          organizationId: settings.organization.id,
          supportAccessEnabled,
        },
      });
      await refreshState();
      showToast('Support access policy updated.', 'success');
    } catch (error) {
      const message = getServerFunctionErrorMessage(
        error,
        'Failed to update support access policy.',
      );
      setSaveError(message);
      showToast(message, 'error');
    } finally {
      setIsSavingPolicy(false);
    }
  };

  const handleCreateGrant = async () => {
    if (!supportAccessEnabled) {
      setSaveError('Enable provider support access before issuing a temporary grant.');
      return;
    }

    if (!siteAdminUserId || !ticketId.trim() || !reasonDetails.trim()) {
      setSaveError('Choose a site admin, ticket ID, and reason details for access.');
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      if (!(await ensureFreshApprovalStepUp())) {
        return;
      }

      await createOrganizationSupportAccessGrantServerFn({
        data: {
          organizationId: settings.organization.id,
          siteAdminUserId,
          scope,
          reasonCategory,
          ticketId: ticketId.trim(),
          reasonDetails: reasonDetails.trim(),
          expiresAt: Date.now() + Number.parseInt(durationHours, 10) * 60 * 60 * 1000,
        },
      });
      await refreshState();
      setTicketId('');
      setReasonDetails('');
      showToast('Support access grant created.', 'success');
    } catch (error) {
      const message = getServerFunctionErrorMessage(
        error,
        'Failed to create support access grant.',
      );
      setSaveError(message);
      showToast(message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRevokeGrant = async (grantId: string) => {
    if (!revokeReason.trim()) {
      setSaveError('Provide a revoke reason before closing this support grant.');
      return;
    }

    setRevokingGrantId(grantId);
    setSaveError(null);

    try {
      if (!(await ensureFreshApprovalStepUp())) {
        return;
      }

      await revokeOrganizationSupportAccessGrantServerFn({
        data: {
          organizationId: settings.organization.id,
          grantId,
          reason: revokeReason.trim(),
        },
      });
      await refreshState();
      setSelectedGrantId(null);
      setRevokeReason('');
      showToast('Support access grant revoked.', 'success');
    } catch (error) {
      const message = getServerFunctionErrorMessage(
        error,
        'Failed to revoke support access grant.',
      );
      setSaveError(message);
      showToast(message, 'error');
    } finally {
      setRevokingGrantId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Temporary Support Access</CardTitle>
        <CardDescription>
          External collaborators are blocked when SSO Required is on. If provider support needs any
          tenant-scoped access, an organization owner must issue a short-lived grant first.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <p>
              Approval model: single owner. Grants are limited to provider site admins, are fully
              audited, and must reference a customer ticket. Read / write grants are capped at 1
              hour and can be revoked immediately.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium text-foreground">Support access policy</p>
                <p className="text-sm text-muted-foreground">
                  Keep provider support disabled until a customer owner intentionally opens a
                  time-bounded grant.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={supportAccessEnabled}
                  onCheckedChange={(checked) => setSupportAccessEnabled(checked === true)}
                  aria-label="Enable provider support access"
                  disabled={isSavingPolicy}
                />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Enable provider support access
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Current approval model: {settings.approvalModel.replaceAll('_', ' ')}
                  </p>
                </div>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleSavePolicy()}
              disabled={isSavingPolicy}
            >
              {isSavingPolicy ? 'Saving…' : 'Save policy'}
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="support-site-admin">Site admin</Label>
            <Select value={siteAdminUserId} onValueChange={setSiteAdminUserId}>
              <SelectTrigger id="support-site-admin">
                <SelectValue placeholder="Select a site admin" />
              </SelectTrigger>
              <SelectContent>
                {settings.availableSiteAdmins.map(
                  (option: (typeof settings.availableSiteAdmins)[number]) => (
                    <SelectItem key={option.authUserId} value={option.authUserId}>
                      {option.name ? `${option.name} (${option.email})` : option.email}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="support-scope">Scope</Label>
            <Select
              value={scope}
              onValueChange={(value: 'read_only' | 'read_write') => setScope(value)}
            >
              <SelectTrigger id="support-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read_only">Read only</SelectItem>
                <SelectItem value="read_write">Read / write</SelectItem>
              </SelectContent>
            </Select>
            {scope === 'read_write' ? (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Read / write support grants use the same single-owner approval model, but are
                limited to 1 hour, fully audited, and should be revoked as soon as the work is
                complete.
              </p>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
          <div className="space-y-2">
            <Label htmlFor="support-ticket-id">Ticket ID</Label>
            <Input
              id="support-ticket-id"
              value={ticketId}
              onChange={(event) => setTicketId(event.target.value)}
              placeholder="INC-42"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="support-duration">Duration</Label>
            <Select
              value={durationHours}
              onValueChange={(value) => setDurationHours(value as '1' | '4' | '8')}
            >
              <SelectTrigger id="support-duration">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATION_OPTIONS.filter(
                  (option) => scope === 'read_only' || option.value === '1',
                ).map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              className="w-full"
              onClick={() => void handleCreateGrant()}
              disabled={isSaving || !supportAccessEnabled}
            >
              {isSaving ? 'Issuing…' : 'Issue temporary grant'}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="support-reason-category">Reason category</Label>
          <Select
            value={reasonCategory}
            onValueChange={(value: (typeof SUPPORT_ACCESS_REASON_OPTIONS)[number]['value']) =>
              setReasonCategory(value)
            }
          >
            <SelectTrigger id="support-reason-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORT_ACCESS_REASON_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="support-reason">Reason details</Label>
          <Textarea
            id="support-reason"
            value={reasonDetails}
            onChange={(event) => setReasonDetails(event.target.value)}
            placeholder="Ticket context and what support needs to inspect or change."
            rows={4}
          />
        </div>

        {saveError ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {saveError}
          </p>
        ) : null}

        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Recent grants</h3>
            <p className="text-sm text-muted-foreground">
              Active and recent support sessions for this organization.
            </p>
          </div>

          {grants.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No temporary support grants have been issued.
            </div>
          ) : (
            <div className="space-y-3">
              {grants.map((grant: (typeof grants)[number]) => {
                const status = getGrantStatus(grant);
                return (
                  <div
                    key={grant.id}
                    className="rounded-xl border border-border/70 bg-background p-4"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-foreground">
                            {grant.siteAdminName
                              ? `${grant.siteAdminName} (${grant.siteAdminEmail})`
                              : grant.siteAdminEmail}
                          </p>
                          <Badge variant={status === 'active' ? 'default' : 'secondary'}>
                            {status}
                          </Badge>
                          <Badge variant="outline">{humanizeScope(grant.scope)}</Badge>
                          <Badge variant="outline">
                            {humanizeReasonCategory(grant.reasonCategory)}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{grant.reasonDetails}</p>
                        <p className="text-xs text-muted-foreground">
                          Ticket {grant.ticketId}
                          {' · '}
                          Approved {formatTimestamp(grant.approvedAt)}
                          {' · '}
                          Issued by{' '}
                          {grant.grantedByName ?? grant.grantedByEmail ?? grant.grantedByUserId}
                          {' · '}
                          Approval model {grant.approvalMethod.replaceAll('_', ' ')}
                          {' · '}
                          Uses {grant.useCount}
                          {grant.firstUsedAt
                            ? ` · First used ${formatTimestamp(grant.firstUsedAt)}`
                            : ''}
                          {grant.lastUsedAt
                            ? ` · Last used ${formatTimestamp(grant.lastUsedAt)}`
                            : ''}
                          {' · '}
                          Expires {formatTimestamp(grant.expiresAt)}
                          {grant.revokedAt
                            ? ` · Revoked ${formatTimestamp(grant.revokedAt)}${grant.revocationReason ? ` (${grant.revocationReason})` : ''}`
                            : null}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={status !== 'active' || revokingGrantId === grant.id}
                          onClick={() => {
                            setSelectedGrantId(grant.id);
                            setSaveError(null);
                          }}
                        >
                          {revokingGrantId === grant.id ? 'Revoking…' : 'Revoke'}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>

      <Dialog
        open={selectedGrant !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedGrantId(null);
            setRevokeReason('');
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Revoke temporary support access</DialogTitle>
            <DialogDescription>
              Add a revoke reason so the customer-visible audit and notification trail is complete.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="support-revoke-reason">Revoke reason</Label>
            <Textarea
              id="support-revoke-reason"
              value={revokeReason}
              onChange={(event) => setRevokeReason(event.target.value)}
              placeholder="Explain why provider support access is being closed."
              rows={4}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSelectedGrantId(null);
                setRevokeReason('');
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!selectedGrant || revokingGrantId === selectedGrant.id}
              onClick={() => selectedGrant && void handleRevokeGrant(selectedGrant.id)}
            >
              {selectedGrant && revokingGrantId === selectedGrant.id
                ? 'Revoking…'
                : 'Confirm revoke'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
