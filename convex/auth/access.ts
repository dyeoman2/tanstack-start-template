import { assertUserId } from '../../src/lib/shared/user-id';
import type { Doc, Id } from '../_generated/dataModel';
import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server';
import { authComponent } from '../auth';
import { throwConvexError } from './errors';

type AuthzCtx = QueryCtx | MutationCtx | ActionCtx;

type BetterAuthUserWithRole = {
  _id?: string;
  id?: string;
  email?: string;
  name?: string | null;
  phoneNumber?: string | null;
  emailVerified?: boolean;
  role?: string | string[];
  createdAt?: string | number | Date;
  updatedAt?: string | number | Date;
};

export interface ACCESS {
  admin: boolean;
  delete: boolean;
  edit: boolean;
  view: boolean;
  siteAdmin: boolean;
}

export const SITE_ADMIN_ACCESS: ACCESS = {
  admin: true,
  delete: true,
  edit: true,
  view: true,
  siteAdmin: true,
};

export const ADMIN_ACCESS: ACCESS = {
  admin: true,
  delete: true,
  edit: true,
  view: true,
  siteAdmin: false,
};

export const EDIT_ACCESS: ACCESS = {
  admin: false,
  delete: false,
  edit: true,
  view: true,
  siteAdmin: false,
};

export const VIEW_ACCESS: ACCESS = {
  admin: false,
  delete: false,
  edit: false,
  view: true,
  siteAdmin: false,
};

export const NO_ACCESS: ACCESS = {
  admin: false,
  delete: false,
  edit: false,
  view: false,
  siteAdmin: false,
};

export type CurrentUser = Doc<'users'> & {
  authUserId: string;
  authUser: BetterAuthUserWithRole;
  isSiteAdmin: boolean;
};

const LEGACY_TEAM_NAME_REWRITES = new Map<string, string>([
  ['personal', 'New Team'],
  ['my team', 'New Team'],
]);

function toMillis(value: string | number | Date | undefined): number {
  if (!value) {
    return Date.now();
  }

  if (typeof value === 'number') {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  return new Date(value).getTime();
}

export function isAdminRole(role: string | string[] | undefined): boolean {
  if (!role) {
    return false;
  }

  if (Array.isArray(role)) {
    return role.includes('admin');
  }

  return role === 'admin';
}

export function normalizeTeamName(name: string): string {
  const normalized = name.trim().toLowerCase();
  return LEGACY_TEAM_NAME_REWRITES.get(normalized) ?? name;
}

export async function getCurrentAuthUserOrThrow(ctx: AuthzCtx): Promise<BetterAuthUserWithRole> {
  const authUser = (await authComponent.getAuthUser(ctx)) as BetterAuthUserWithRole | null;
  if (!authUser) {
    throwConvexError('UNAUTHENTICATED', 'Not authenticated');
  }

  return authUser;
}

export async function getCurrentAuthUserOrNull(
  ctx: QueryCtx | MutationCtx,
): Promise<BetterAuthUserWithRole | null> {
  return (await authComponent.safeGetAuthUser(ctx)) as BetterAuthUserWithRole | null;
}

async function findAppUserByAuthUserId(ctx: QueryCtx | MutationCtx, authUserId: string) {
  return await ctx.db
    .query('users')
    .withIndex('by_auth_user_id', (q) => q.eq('authUserId', authUserId))
    .first();
}

export async function getCurrentUserOrNull(
  ctx: QueryCtx | MutationCtx,
): Promise<CurrentUser | null> {
  const authUser = await getCurrentAuthUserOrNull(ctx);
  if (!authUser) {
    return null;
  }

  const authUserId = assertUserId(authUser, 'User ID not found in auth user');
  const user = await findAppUserByAuthUserId(ctx, authUserId);
  if (!user) {
    return null;
  }

  return {
    ...user,
    authUserId,
    authUser,
    isSiteAdmin: isAdminRole(authUser.role),
  };
}

export async function getCurrentUserOrThrow(ctx: QueryCtx | MutationCtx): Promise<CurrentUser> {
  const authUser = await getCurrentAuthUserOrThrow(ctx);
  const authUserId = assertUserId(authUser, 'User ID not found in auth user');
  const user = await findAppUserByAuthUserId(ctx, authUserId);
  if (!user) {
    throwConvexError('UNAUTHENTICATED', 'User context not initialized');
  }

  return {
    ...user,
    authUserId,
    authUser,
    isSiteAdmin: isAdminRole(authUser.role),
  };
}

export async function getCurrentTeamOrNull(
  ctx: QueryCtx | MutationCtx,
  user?: CurrentUser,
): Promise<Doc<'teams'> | null> {
  const resolvedUser = user ?? (await getCurrentUserOrNull(ctx));
  if (!resolvedUser?.lastActiveTeamId) {
    return null;
  }

  return (await ctx.db.get(resolvedUser.lastActiveTeamId)) ?? null;
}

type TeamAccessOptions = {
  bypassSiteAdmin?: boolean;
};

export async function checkTeamAccess(
  ctx: QueryCtx | MutationCtx,
  teamId: Id<'teams'>,
  userCtx?: { user: CurrentUser },
  options: TeamAccessOptions = {},
): Promise<ACCESS> {
  const user = userCtx?.user ?? (await getCurrentUserOrThrow(ctx));
  const bypassSiteAdmin = options.bypassSiteAdmin ?? true;

  if (bypassSiteAdmin && user.isSiteAdmin) {
    return SITE_ADMIN_ACCESS;
  }

  const membership = await ctx.db
    .query('teamUsers')
    .withIndex('by_user_team', (q) => q.eq('userId', user._id).eq('teamId', teamId))
    .first();

  if (!membership) {
    return NO_ACCESS;
  }

  switch (membership.role) {
    case 'admin':
      return ADMIN_ACCESS;
    case 'edit':
      return EDIT_ACCESS;
    case 'view':
      return VIEW_ACCESS;
    default:
      return NO_ACCESS;
  }
}

export async function checkAiResponseAccess(
  ctx: QueryCtx | MutationCtx,
  responseId: Id<'aiResponses'>,
  userCtx?: { user: CurrentUser },
): Promise<ACCESS> {
  const response = await ctx.db.get(responseId);
  if (!response?.teamId) {
    return NO_ACCESS;
  }

  return await checkTeamAccess(ctx, response.teamId, userCtx, {
    bypassSiteAdmin: false,
  });
}

export async function checkAiUsageAccess(
  ctx: QueryCtx | MutationCtx,
  usageId: Id<'aiMessageUsage'>,
  userCtx?: { user: CurrentUser },
): Promise<ACCESS> {
  const usage = await ctx.db.get(usageId);
  if (!usage?.teamId) {
    return NO_ACCESS;
  }

  return await checkTeamAccess(ctx, usage.teamId, userCtx, {
    bypassSiteAdmin: false,
  });
}

export type CurrentUserProfile = {
  id: string;
  email: string;
  name: string | null;
  phoneNumber: string | null;
  role: 'user' | 'admin';
  isSiteAdmin: boolean;
  emailVerified: boolean;
  createdAt: number;
  updatedAt: number;
  currentTeam: {
    id: Id<'teams'>;
    name: string;
    role: Doc<'teamUsers'>['role'];
  } | null;
  teams: Array<{
    id: Id<'teams'>;
    name: string;
    role: Doc<'teamUsers'>['role'];
  }>;
};

export async function buildCurrentUserProfile(
  ctx: QueryCtx | MutationCtx,
  user: CurrentUser,
): Promise<CurrentUserProfile> {
  const memberships = await ctx.db
    .query('teamUsers')
    .withIndex('by_user', (q) => q.eq('userId', user._id))
    .collect();

  const teams = await Promise.all(
    memberships.map(async (membership) => {
      const team = await ctx.db.get(membership.teamId);
      if (!team) {
        return null;
      }

      return {
        id: team._id,
        name: normalizeTeamName(team.name),
        role: membership.role,
      };
    }),
  );

  const teamList = teams.filter((team): team is NonNullable<typeof team> => team !== null);
  const currentTeam =
    teamList.find((team) => team.id === user.lastActiveTeamId) ??
    teamList[0] ??
    null;

  return {
    id: user.authUserId,
    email: user.authUser.email ?? '',
    name: user.authUser.name ?? null,
    phoneNumber: user.authUser.phoneNumber ?? null,
    role: user.isSiteAdmin ? 'admin' : 'user',
    isSiteAdmin: user.isSiteAdmin,
    emailVerified: user.authUser.emailVerified ?? false,
    createdAt: toMillis(user.authUser.createdAt),
    updatedAt: toMillis(user.authUser.updatedAt),
    currentTeam,
    teams: teamList.sort((left, right) => left.name.localeCompare(right.name)),
  };
}
