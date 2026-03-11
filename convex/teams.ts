import { v } from 'convex/values';
import { getSiteUrl } from '../src/lib/server/env.server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { action, mutation, query } from './_generated/server';
import {
  buildCurrentUserProfile,
  checkTeamAccess,
  getCurrentUserOrNull,
  getCurrentUserOrThrow,
  isAdminRole,
  normalizeTeamName,
} from './auth/access';
import { teamQuery } from './auth/authorized';
import { throwConvexError } from './auth/errors';
import { authComponent } from './auth';
import {
  fetchAllBetterAuthUsers,
  fetchBetterAuthUsersByIds,
  findBetterAuthUserByEmail,
} from './lib/betterAuth';

const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isInviteExpired(invite: Doc<'teamInvites'>) {
  return invite.expiresAt <= Date.now();
}

async function getTeamOrThrow(
  ctx: Pick<QueryCtx | MutationCtx, 'db'>,
  teamId: Id<'teams'>,
) {
  const team = await ctx.db.get(teamId);
  if (!team) {
    throwConvexError('NOT_FOUND', 'Team not found');
  }

  return team;
}

async function requireTeamAdminAccess(
  ctx: MutationCtx,
  teamId: Id<'teams'>,
) {
  const user = await getCurrentUserOrThrow(ctx);
  const access = user.isSiteAdmin
    ? { admin: true, edit: true, view: true, delete: true, siteAdmin: true }
    : await checkTeamAccess(ctx, teamId, { user });

  if (!access.admin) {
    throwConvexError('ADMIN_REQUIRED', 'Admin access required for this team');
  }

  const team = await getTeamOrThrow(ctx, teamId);
  return { user, team };
}

async function listMembersWithAuthUsers(
  ctx: QueryCtx | MutationCtx,
  teamId: Id<'teams'>,
) {
  const memberships = await ctx.db
    .query('teamUsers')
    .withIndex('by_team', (q) => q.eq('teamId', teamId))
    .collect();

  const appUsers = await Promise.all(memberships.map((membership) => ctx.db.get(membership.userId)));
  const resolvedAppUsers = appUsers.filter((user): user is NonNullable<typeof user> => user !== null);
  const authUsers = await fetchBetterAuthUsersByIds(
    ctx,
    resolvedAppUsers.map((user) => user.authUserId),
  );
  const authUsersById = new Map(authUsers.map((user) => [user.id ?? user._id ?? '', user]));

  return memberships
    .map((membership) => {
      const appUser = resolvedAppUsers.find((candidate) => candidate._id === membership.userId);
      if (!appUser) {
        return null;
      }

      const authUser = authUsersById.get(appUser.authUserId);
      return {
        membershipId: membership._id,
        userId: appUser._id,
        authUserId: appUser.authUserId,
        email: authUser?.email ?? '',
        name: authUser?.name ?? null,
        role: membership.role,
        isSiteAdmin: authUser?.role === 'admin',
      };
    })
    .filter((member): member is NonNullable<typeof member> => member !== null);
}

export const listMyTeams = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrNull(ctx);
    if (!user) {
      return {
        currentTeamId: null,
        teams: [],
      };
    }

    const profile = await buildCurrentUserProfile(ctx, user);
    return {
      currentTeamId: profile.currentTeam?.id ?? null,
      teams: profile.teams,
    };
  },
});

export const getCurrentTeam = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrNull(ctx);
    if (!user?.lastActiveTeamId) {
      return null;
    }

    const team = await ctx.db.get(user.lastActiveTeamId);
    if (!team) {
      return null;
    }

    const access = await checkTeamAccess(ctx, team._id, { user });
    if (!access.view) {
      return null;
    }

    return {
      id: team._id,
      name: normalizeTeamName(team.name),
      access,
    };
  },
});

export const getTeamDetails = teamQuery(async (ctx) => {
  const team = await getTeamOrThrow(ctx, ctx.teamId);
  const members = await listMembersWithAuthUsers(ctx, ctx.teamId);
  const invites = await ctx.db
    .query('teamInvites')
    .withIndex('by_team', (q) => q.eq('teamId', ctx.teamId))
    .collect();

  return {
    team: {
      id: team._id,
      name: normalizeTeamName(team.name),
    },
    access: ctx.access,
    members,
    invites: invites.map((invite) => ({
      id: invite._id,
      email: invite.email,
      role: invite.role,
      status: isInviteExpired(invite) && invite.status === 'pending' ? 'expired' : invite.status,
      expiresAt: invite.expiresAt,
      createdAt: invite.createdAt,
    })),
  };
});

export const createTeam = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const trimmedName = args.name.trim();
    if (!trimmedName) {
      throwConvexError('VALIDATION', 'Team name is required');
    }

    const now = Date.now();
    const teamId = await ctx.db.insert('teams', {
      name: trimmedName,
      createdById: user._id,
      updatedById: user._id,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert('teamUsers', {
      userId: user._id,
      teamId,
      role: 'admin',
      createdById: user._id,
      updatedById: user._id,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(user._id, {
      lastActiveTeamId: teamId,
      updatedAt: now,
    });

    return {
      teamId,
    };
  },
});

export const setActiveTeam = mutation({
  args: {
    teamId: v.id('teams'),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const access = await checkTeamAccess(ctx, args.teamId, { user });
    if (!access.view) {
      throwConvexError('FORBIDDEN', 'Not authorized to access this team');
    }

    await ctx.db.patch(user._id, {
      lastActiveTeamId: args.teamId,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

export const renameTeam = mutation({
  args: {
    teamId: v.id('teams'),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const { user, team } = await requireTeamAdminAccess(ctx, args.teamId);
    const trimmedName = args.name.trim();
    if (!trimmedName) {
      throwConvexError('VALIDATION', 'Team name is required');
    }

    await ctx.db.patch(team._id, {
      name: trimmedName,
      updatedById: user._id,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

export const createInvite = mutation({
  args: {
    teamId: v.id('teams'),
    email: v.string(),
    role: v.union(v.literal('admin'), v.literal('edit'), v.literal('view')),
  },
  handler: async (ctx, args) => {
    const { user, team } = await requireTeamAdminAccess(ctx, args.teamId);

    const normalizedEmail = normalizeEmail(args.email);
    const existingInvite = await ctx.db
      .query('teamInvites')
      .withIndex('by_team_email', (q) => q.eq('teamId', args.teamId).eq('email', normalizedEmail))
      .first();

    if (existingInvite && existingInvite.status === 'pending' && !isInviteExpired(existingInvite)) {
      throwConvexError('VALIDATION', 'An active invite already exists for this email');
    }

    const authUser = await findBetterAuthUserByEmail(ctx, normalizedEmail);
    if (authUser) {
      const appUser = await ctx.db
        .query('users')
        .withIndex('by_auth_user_id', (q) =>
          q.eq('authUserId', authUser.id ?? authUser._id ?? ''),
        )
        .first();

      if (appUser) {
        const existingMembership = await ctx.db
          .query('teamUsers')
          .withIndex('by_user_team', (q) => q.eq('userId', appUser._id).eq('teamId', args.teamId))
          .first();

        if (existingMembership) {
          throwConvexError('VALIDATION', 'That user is already a team member');
        }
      }
    }

    const now = Date.now();
    const token = crypto.randomUUID();
    const inviteId = await ctx.db.insert('teamInvites', {
      teamId: args.teamId,
      email: normalizedEmail,
      role: args.role,
      token,
      status: 'pending',
      invitedById: user._id,
      expiresAt: now + INVITE_EXPIRY_MS,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.emails.sendTeamInviteEmailMutation, {
      email: normalizedEmail,
      inviteUrl: `${getSiteUrl()}/invite/${token}`,
      inviterName: user.authUser.name ?? user.authUser.email ?? 'A teammate',
      teamName: team.name,
      role: args.role,
    });

    return {
      inviteId,
      token,
    };
  },
});

export const getInvitePreview = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query('teamInvites')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .first();

    if (!invite) {
      return null;
    }

    const team = await ctx.db.get(invite.teamId);
    if (!team) {
      return null;
    }

    return {
      email: invite.email,
      role: invite.role,
      status: isInviteExpired(invite) && invite.status === 'pending' ? 'expired' : invite.status,
      team: {
        id: team._id,
        name: normalizeTeamName(team.name),
      },
      expiresAt: invite.expiresAt,
    };
  },
});

export const acceptInvite = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    const invite = await ctx.db
      .query('teamInvites')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .first();

    if (!invite) {
      throwConvexError('NOT_FOUND', 'Invite not found');
    }

    if (invite.status !== 'pending') {
      throwConvexError('VALIDATION', 'This invite is no longer pending');
    }

    if (isInviteExpired(invite)) {
      await ctx.db.patch(invite._id, {
        status: 'expired',
        updatedAt: Date.now(),
      });
      throwConvexError('VALIDATION', 'This invite has expired');
    }

    const typedAuthUser = currentUser.authUser;
    const email = normalizeEmail(typedAuthUser.email ?? '');
    if (email !== invite.email) {
      throwConvexError('FORBIDDEN', 'Invite email does not match the signed-in user');
    }

    const team = await getTeamOrThrow(ctx, invite.teamId);

    const existingMembership = await ctx.db
      .query('teamUsers')
      .withIndex('by_user_team', (q) => q.eq('userId', currentUser._id).eq('teamId', team._id))
      .first();

    const now = Date.now();
    if (!existingMembership) {
      await ctx.db.insert('teamUsers', {
        userId: currentUser._id,
        teamId: team._id,
        role: invite.role,
        createdById: currentUser._id,
        updatedById: currentUser._id,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.patch(invite._id, {
      status: 'accepted',
      acceptedById: currentUser._id,
      updatedAt: now,
    });

    await ctx.db.patch(currentUser._id, {
      lastActiveTeamId: team._id,
      updatedAt: now,
    });

    return {
      teamId: team._id,
      teamName: team.name,
    };
  },
});

export const revokeInvite = mutation({
  args: {
    inviteId: v.id('teamInvites'),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId);
    if (!invite) {
      throwConvexError('NOT_FOUND', 'Invite not found');
    }

    await requireTeamAdminAccess(ctx, invite.teamId);

    await ctx.db.patch(invite._id, {
      status: 'revoked',
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

export const updateMemberRole = mutation({
  args: {
    teamId: v.id('teams'),
    membershipId: v.id('teamUsers'),
    role: v.union(v.literal('admin'), v.literal('edit'), v.literal('view')),
  },
  handler: async (ctx, args) => {
    const { user, team } = await requireTeamAdminAccess(ctx, args.teamId);

    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.teamId !== team._id) {
      throwConvexError('NOT_FOUND', 'Team member not found');
    }

    await ctx.db.patch(membership._id, {
      role: args.role,
      updatedById: user._id,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

export const removeMember = mutation({
  args: {
    teamId: v.id('teams'),
    membershipId: v.id('teamUsers'),
  },
  handler: async (ctx, args) => {
    const { user, team } = await requireTeamAdminAccess(ctx, args.teamId);

    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.teamId !== team._id) {
      throwConvexError('NOT_FOUND', 'Team member not found');
    }

    if (membership.userId === user._id) {
      throwConvexError('VALIDATION', 'You cannot remove yourself from the active team');
    }

    await ctx.db.delete(membership._id);

    const memberUser = await ctx.db.get(membership.userId);
    if (memberUser?.lastActiveTeamId === team._id) {
      const memberships = await ctx.db
        .query('teamUsers')
        .withIndex('by_user', (q) => q.eq('userId', memberUser._id))
        .collect();

      const fallbackTeam = await Promise.all(
        memberships
          .filter((candidate) => candidate.teamId !== team._id)
          .map(async (candidate) => await ctx.db.get(candidate.teamId)),
      ).then((teams) => teams.find((candidate) => candidate !== null) ?? null);

      if (fallbackTeam) {
        await ctx.db.patch(memberUser._id, {
          lastActiveTeamId: fallbackTeam._id,
          updatedAt: Date.now(),
        });
      } else {
        await ctx.db.patch(memberUser._id, {
          lastActiveTeamId: undefined,
          updatedAt: Date.now(),
        });
      }
    }

    return { success: true };
  },
});

export const backfillAllUsersAndTeams = action({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser || !isAdminRole((authUser as { role?: string | string[] }).role)) {
      throwConvexError('ADMIN_REQUIRED', 'Site admin access required');
    }

    const authUsers = await fetchAllBetterAuthUsers(ctx);
    let processed = 0;

    for (const authUser of authUsers) {
      const authUserId = authUser.id ?? authUser._id;
      if (!authUserId) {
        continue;
      }

      await ctx.runMutation(internal.users.ensureUserContextForAuthUser, {
        authUserId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      processed += 1;
    }

    return { success: true, processed };
  },
});
