import { api } from '@convex/_generated/api';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
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
import {
  getServerFunctionErrorMessage,
  refreshOrganizationClientState,
} from '~/features/organizations/lib/organization-session';
import {
  createOrganizationSupportAccessGrantServerFn,
  revokeOrganizationSupportAccessGrantServerFn,
} from '~/features/organizations/server/organization-management';

const DURATION_OPTIONS = [
  { label: '1 hour', value: '1' },
  { label: '4 hours', value: '4' },
  { label: '8 hours', value: '8' },
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

export function OrganizationSupportAccessManagement({ slug }: { slug: string }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { showToast } = useToast();
  const settings = useQuery(api.organizationManagement.getOrganizationSupportAccessSettings, {
    slug,
  });
  const [siteAdminUserId, setSiteAdminUserId] = useState('');
  const [scope, setScope] = useState<'read_only' | 'read_write'>('read_only');
  const [durationHours, setDurationHours] =
    useState<(typeof DURATION_OPTIONS)[number]['value']>('1');
  const [reason, setReason] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [revokingGrantId, setRevokingGrantId] = useState<string | null>(null);

  useEffect(() => {
    if (!settings?.availableSiteAdmins.length) {
      return;
    }

    setSiteAdminUserId(
      (currentValue) => currentValue || settings.availableSiteAdmins[0]?.authUserId || '',
    );
  }, [settings]);

  const refreshState = async () => {
    await refreshOrganizationClientState(queryClient, {
      invalidateRouter: async () => {
        await router.invalidate();
      },
    });
  };

  const grants = useMemo(() => settings?.grants ?? [], [settings?.grants]);

  if (settings === undefined || settings === null || !settings.canManageSupportAccess) {
    return null;
  }

  const handleCreateGrant = async () => {
    if (!siteAdminUserId || !reason.trim()) {
      setSaveError('Choose a site admin and provide a reason for access.');
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      await createOrganizationSupportAccessGrantServerFn({
        data: {
          organizationId: settings.organization.id,
          siteAdminUserId,
          scope,
          reason: reason.trim(),
          expiresAt: Date.now() + Number.parseInt(durationHours, 10) * 60 * 60 * 1000,
        },
      });
      await refreshState();
      setReason('');
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
    setRevokingGrantId(grantId);
    setSaveError(null);

    try {
      await revokeOrganizationSupportAccessGrantServerFn({
        data: {
          organizationId: settings.organization.id,
          grantId,
          reason: 'Owner revoked support access.',
        },
      });
      await refreshState();
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
          External collaborators are blocked when SSO Required is on. If provider support needs
          tenant data access, an organization owner must issue a short-lived grant first.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <p>
              Grants are limited to provider site admins, expire within 8 hours, and are recorded in
              the audit log.
            </p>
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
                {settings.availableSiteAdmins.map((option) => (
                  <SelectItem key={option.authUserId} value={option.authUserId}>
                    {option.name ? `${option.name} (${option.email})` : option.email}
                  </SelectItem>
                ))}
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
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
          <div className="space-y-2">
            <Label htmlFor="support-reason">Reason</Label>
            <Textarea
              id="support-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ticket number, incident context, and what support needs to inspect."
              rows={4}
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
                {DURATION_OPTIONS.map((option) => (
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
              disabled={isSaving}
            >
              {isSaving ? 'Issuing…' : 'Issue temporary grant'}
            </Button>
          </div>
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
              {grants.map((grant) => {
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
                        </div>
                        <p className="text-sm text-muted-foreground">{grant.reason}</p>
                        <p className="text-xs text-muted-foreground">
                          Issued by{' '}
                          {grant.grantedByName ?? grant.grantedByEmail ?? grant.grantedByUserId}
                          {' · '}
                          Expires {formatTimestamp(grant.expiresAt)}
                          {grant.revokedAt
                            ? ` · Revoked ${formatTimestamp(grant.revokedAt)}`
                            : null}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={status !== 'active' || revokingGrantId === grant.id}
                          onClick={() => void handleRevokeGrant(grant.id)}
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
    </Card>
  );
}
