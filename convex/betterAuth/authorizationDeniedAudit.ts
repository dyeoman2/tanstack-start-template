type AuditRecorder = (event: {
  createdAt?: number;
  eventType: string;
  actorUserId?: string;
  identifier?: string;
  ipAddress?: string;
  metadata?: string;
  organizationId?: string;
  outcome?: 'success' | 'failure';
  resourceId?: string;
  resourceLabel?: string;
  resourceType?: string;
  severity?: 'info' | 'warning' | 'critical';
  sourceSurface?: string;
  userAgent?: string;
}) => Promise<void>;

function normalizeOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function getResourceType(path: string) {
  if (
    path.startsWith('/admin/list-user-sessions') ||
    path.startsWith('/admin/revoke-user-session')
  ) {
    return 'session';
  }

  if (path.startsWith('/organization/')) {
    return 'organization_membership';
  }

  if (path.startsWith('/admin/')) {
    return 'user';
  }

  if (path === '/reset-password' || path === '/verify-email') {
    return 'verification_token';
  }

  return 'session';
}

function getResourceLabel(path: string) {
  switch (path) {
    case '/organization/accept-invitation':
      return 'Invitation acceptance denied';
    case '/organization/invite-member':
      return 'Invitation create denied';
    case '/organization/remove-member':
      return 'Member removal denied';
    case '/organization/update-member-role':
      return 'Member role update denied';
    case '/organization/delete':
      return 'Organization deletion denied';
    case '/organization/update':
      return 'Organization update denied';
    case '/admin/list-user-sessions':
      return 'Admin session inspection denied';
    case '/admin/revoke-user-session':
      return 'Admin session revoke denied';
    case '/admin/revoke-user-sessions':
      return 'Admin revoke all sessions denied';
    case '/sign-up/email':
      return 'Sign-up denied';
    case '/sign-in/email':
      return 'Sign-in denied';
    case '/reset-password':
      return 'Password reset denied';
    case '/verify-email':
      return 'Email verification denied';
    default:
      return 'Authorization denied';
  }
}

function getSourceSurface(path: string) {
  if (path.startsWith('/organization/')) {
    return 'auth.endpoint.organization';
  }

  if (path.startsWith('/admin/')) {
    return 'auth.endpoint.admin_user';
  }

  if (path === '/reset-password') {
    return 'auth.endpoint.password_reset';
  }

  if (path === '/verify-email') {
    return 'auth.endpoint.email_verification';
  }

  return path === '/sign-up/email' ? 'auth.endpoint.sign_up' : 'auth.endpoint.sign_in';
}

export async function recordAuthorizationDeniedAuditEvent(
  recordAuditEvent: AuditRecorder,
  input: {
    actorUserId?: string;
    email?: string;
    errorCode?: string;
    ipAddress?: string;
    invitationId?: string;
    message: string;
    organizationId?: string;
    path: string;
    provider?: string;
    resourceId?: string;
    responseStatus?: number;
    userAgent?: string;
  },
) {
  await recordAuditEvent({
    createdAt: Date.now(),
    eventType: 'authorization_denied',
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    ...(normalizeOptionalString(input.organizationId)
      ? { organizationId: normalizeOptionalString(input.organizationId) }
      : {}),
    ...(normalizeOptionalString(input.email) ? { identifier: normalizeOptionalString(input.email) } : {}),
    ...(normalizeOptionalString(input.ipAddress) ? { ipAddress: normalizeOptionalString(input.ipAddress) } : {}),
    outcome: 'failure',
    ...(normalizeOptionalString(input.resourceId ?? input.invitationId)
      ? { resourceId: normalizeOptionalString(input.resourceId ?? input.invitationId) }
      : {}),
    resourceLabel: getResourceLabel(input.path),
    resourceType: getResourceType(input.path),
    severity: 'warning',
    sourceSurface: getSourceSurface(input.path),
    ...(normalizeOptionalString(input.userAgent)
      ? { userAgent: normalizeOptionalString(input.userAgent) }
      : {}),
    metadata: JSON.stringify({
      attemptedIdentifier: normalizeOptionalString(input.email),
      invitationId: normalizeOptionalString(input.invitationId),
      path: input.path,
      ...(normalizeOptionalString(input.provider)
        ? { provider: normalizeOptionalString(input.provider) }
        : {}),
      ...(normalizeOptionalString(input.errorCode)
        ? { responseErrorCode: normalizeOptionalString(input.errorCode) }
        : {}),
      responseErrorMessage: input.message,
      ...(input.responseStatus !== undefined ? { responseStatus: input.responseStatus } : {}),
    }),
  });
}
