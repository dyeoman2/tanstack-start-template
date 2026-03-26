import { Loader2 } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Field, FieldError, FieldLabel } from '~/components/ui/field';
import { Textarea } from '~/components/ui/textarea';
import type { OrganizationLegalHoldSummary } from '~/features/organizations/lib/organization-management';

export function OrganizationLegalHoldCard({
  canManagePolicies,
  hold,
  holdError,
  holdReason,
  isApplying,
  isReleasing,
  onApply,
  onHoldReasonChange,
  onRelease,
}: {
  canManagePolicies: boolean;
  hold: OrganizationLegalHoldSummary | null | undefined;
  holdError: string | null;
  holdReason: string;
  isApplying: boolean;
  isReleasing: boolean;
  onApply: () => void;
  onHoldReasonChange: (value: string) => void;
  onRelease: () => void;
}) {
  const isBusy = isApplying || isReleasing;
  const isActive = hold?.status === 'active';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Retention hold</CardTitle>
        <CardDescription>
          Block destructive retention work across PHI-bearing chat records for this organization.
          Audited exports remain available while a hold is active.
        </CardDescription>
      </CardHeader>
      <div className="space-y-4 px-6 pb-6">
        <div className="rounded-lg border bg-muted/30 px-4 py-3">
          <p className="text-sm font-medium text-foreground">
            {isActive ? 'Legal hold active' : 'No active legal hold'}
          </p>
          <p className="text-sm text-muted-foreground">
            {isActive
              ? `Opened ${new Date(hold.openedAt).toLocaleString()}`
              : 'Timed PHI record retention and cleanup will continue on schedule.'}
          </p>
          {isActive ? <p className="mt-2 text-sm text-muted-foreground">{hold.reason}</p> : null}
        </div>

        <Field>
          <FieldLabel htmlFor="organization-legal-hold-reason">Hold reason</FieldLabel>
          <Textarea
            id="organization-legal-hold-reason"
            value={holdReason}
            onChange={(event) => onHoldReasonChange(event.target.value)}
            disabled={isBusy || !canManagePolicies || isActive}
            placeholder="Litigation hold, incident investigation, customer preservation request..."
            rows={4}
          />
        </Field>

        {holdError ? <FieldError>{holdError}</FieldError> : null}

        <div className="flex flex-wrap justify-end gap-3">
          {isActive ? (
            <Button
              type="button"
              variant="outline"
              onClick={onRelease}
              disabled={isBusy || !canManagePolicies}
            >
              {isReleasing ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Releasing hold...
                </>
              ) : (
                'Release hold'
              )}
            </Button>
          ) : (
            <Button type="button" onClick={onApply} disabled={isBusy || !canManagePolicies}>
              {isApplying ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Applying hold...
                </>
              ) : (
                'Apply hold'
              )}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
