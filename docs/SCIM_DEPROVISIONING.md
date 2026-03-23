# SCIM Deprovisioning Semantics

## Status

SCIM user creation and update are enabled.

SCIM user deletion plus `PATCH active=false` and `PATCH active=true` now use the org-scoped lifecycle path in
[src/routes/api/auth/$.ts](/Users/yeoman/Desktop/tanstack/tanstack-start-template/src/routes/api/auth/$.ts)
and
[convex/auth.ts](/Users/yeoman/Desktop/tanstack/tanstack-start-template/convex/auth.ts).

## Goal

SCIM deprovisioning must revoke access to a single organization without destroying the
global Better Auth user record or affecting memberships in other organizations.

This keeps lifecycle behavior aligned with our multi-org model, preserves audit history,
and avoids cross-tenant side effects.

## Required Semantics

When a SCIM deprovision event arrives for organization `O`:

- Resolve the SCIM provider connection by `providerId` and `organizationId`.
- Resolve the target user by the provider payload identifier or normalized primary email.
- Remove or deactivate the membership in organization `O` only.
- Preserve the Better Auth user, account, session history, and audit trail.
- Preserve memberships in every other organization.
- Revoke organization `O` access immediately.
- If organization `O` is the user’s active organization, clear it or switch to another valid org.
- If the current session is marked with `enterpriseOrganizationId === O`, clear the enterprise org context.
- Make the operation idempotent so repeated SCIM calls are safe.

## Preferred State Model

For this codebase, the cleanest behavior is membership deactivation rather than global
user deletion.

That means:

- The org membership becomes inactive or is deleted in an org-scoped way.
- The user record remains intact for audit and future reprovisioning.
- Reprovisioning recreates or reactivates the org membership as `member`.

If Better Auth organization membership records cannot represent an inactive state cleanly,
deleting the membership row is acceptable as long as the user record survives and the flow
stays idempotent.

## Session Handling

After org-scoped deprovision:

- Existing sessions should no longer authorize access to the deprovisioned organization.
- App-side authorization in Convex must continue to enforce membership presence on every org
  read and write path.
- Enterprise session markers should not be treated as sufficient if the membership is gone.

## Audit Requirements

The implementation should emit explicit audit events:

- `scim_member_deprovisioned`
- `scim_member_reactivated`
- `scim_member_deprovision_failed`

Each event should include:

- organization id
- provider id
- actor type (`scim`)
- target user id when resolved
- normalized email when present
- reason or error details when applicable

## Supported Lifecycle Contract

Org-scoped SCIM lifecycle handling is the supported contract for this codebase:

- `DELETE /scim/v2/Users/:id` deprovisions one organization membership only.
- `PATCH active=false` deprovisions one organization membership only.
- `PATCH active=true` restores the organization membership without recreating the global user.
- Session cleanup and audit emission happen in the Convex lifecycle handler, not in Better Auth's global delete path.

## Test Cases

- Deprovisioning a user in one org does not affect another org membership.
- Deprovisioning a user removes access to org-scoped queries immediately.
- Repeating the same deprovision request is a no-op.
- Reprovisioning restores access as `member`.
- Deprovisioning the active org clears or replaces `activeOrganizationId`.
- Site admin access remains unaffected.
