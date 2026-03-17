import { Loader2 } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Checkbox } from '~/components/ui/checkbox';
import { Field, FieldError, FieldLabel } from '~/components/ui/field';
import { Input } from '~/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import type { OrganizationInvitePolicy } from '~/features/organizations/lib/organization-management';

export function OrganizationPoliciesCard({
  canManagePolicies,
  invitePolicy,
  verifiedDomainsOnly,
  memberCap,
  policyError,
  isSavingPolicies,
  onInvitePolicyChange,
  onVerifiedDomainsOnlyChange,
  onMemberCapChange,
  onSave,
}: {
  canManagePolicies: boolean;
  invitePolicy: OrganizationInvitePolicy;
  verifiedDomainsOnly: boolean;
  memberCap: string;
  policyError: string | null;
  isSavingPolicies: boolean;
  onInvitePolicyChange: (value: OrganizationInvitePolicy) => void;
  onVerifiedDomainsOnlyChange: (value: boolean) => void;
  onMemberCapChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Access policies</CardTitle>
        <CardDescription>
          Control who can invite, whether invites must use verified domains, and member caps.
          Regulated security controls are enforced globally.
        </CardDescription>
      </CardHeader>
      <div className="space-y-4 px-6 pb-6">
        <Field>
          <FieldLabel>Invite permissions</FieldLabel>
          <Select
            value={invitePolicy}
            onValueChange={(value) => onInvitePolicyChange(value as OrganizationInvitePolicy)}
            disabled={isSavingPolicies || !canManagePolicies}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="owners_admins">Owners and admins</SelectItem>
              <SelectItem value="owners_only">Owners only</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field orientation="horizontal">
          <Checkbox
            checked={verifiedDomainsOnly}
            onCheckedChange={(checked) => onVerifiedDomainsOnlyChange(checked === true)}
            disabled={isSavingPolicies || !canManagePolicies}
            aria-label="Require verified domains for invitations"
          />
          <div className="space-y-1">
            <FieldLabel>Require verified domains for invitations</FieldLabel>
            <p className="text-sm text-muted-foreground">
              New invitations must use one of this organization&apos;s verified domains.
            </p>
          </div>
        </Field>

        <Field>
          <FieldLabel htmlFor="organization-member-cap">Member cap</FieldLabel>
          <Input
            id="organization-member-cap"
            type="number"
            min="1"
            step="1"
            value={memberCap}
            onChange={(event) => onMemberCapChange(event.target.value)}
            disabled={isSavingPolicies || !canManagePolicies}
            placeholder="Unlimited"
          />
          <p className="text-sm text-muted-foreground">
            Counts active members and pending invitations.
          </p>
        </Field>

        <div className="rounded-lg border bg-muted/30 px-4 py-3">
          <p className="text-sm font-medium text-foreground">Always enforced</p>
          <p className="text-sm text-muted-foreground">
            Verified email, MFA or passkey enrollment, step-up for sensitive exports, and core chat
            egress controls are always on and cannot be disabled per organization.
          </p>
        </div>

        {policyError ? <FieldError>{policyError}</FieldError> : null}

        <div className="flex justify-end">
          <Button type="button" onClick={onSave} disabled={isSavingPolicies || !canManagePolicies}>
            {isSavingPolicies ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving access policies...
              </>
            ) : (
              'Save access policies'
            )}
          </Button>
        </div>
      </div>
    </Card>
  );
}
