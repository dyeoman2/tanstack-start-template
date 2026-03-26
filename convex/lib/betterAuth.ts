import type { GenericCtx } from '@convex-dev/better-auth';
import { deriveIsSiteAdmin, normalizeUserRole } from '../../src/features/auth/lib/user-role';
import {
  type BetterAuthAdapterUserDoc,
  normalizeAdapterFindManyResult,
} from '../../src/lib/server/better-auth/adapter-utils';
import { assertUserId } from '../../src/lib/shared/user-id';
import { components } from '../_generated/api';
import type { DataModel } from '../_generated/dataModel';
import type { ActionCtx, MutationCtx } from '../_generated/server';

type CtxWithRunMutation = {
  runMutation: MutationCtx['runMutation'] | ActionCtx['runMutation'];
};

type BetterAuthModel =
  | 'user'
  | 'account'
  | 'organization'
  | 'member'
  | 'invitation'
  | 'passkey'
  | 'session'
  | 'scimProvider';

export type BetterAuthUser = BetterAuthAdapterUserDoc & {
  role?: string | string[];
  banned?: boolean;
  banReason?: string | null;
  banExpires?: Date | string | number | null;
};

type BetterAuthRecord = {
  _id: string;
  _creationTime: number;
  id?: string;
  createdAt?: Date | string | number;
  updatedAt?: Date | string | number;
  [key: string]: unknown;
};

export type BetterAuthOrganization = BetterAuthRecord & {
  name: string;
  slug: string;
  logo?: string | null;
  metadata?: string | null;
};

export type BetterAuthMember = BetterAuthRecord & {
  organizationId: string;
  userId: string;
  role: string;
};

export type BetterAuthInvitation = BetterAuthRecord & {
  organizationId: string;
  email: string;
  role: string;
  status: string;
  inviterId: string;
  expiresAt?: Date | string | number;
};

export type BetterAuthAccountRecord = BetterAuthRecord & {
  accessToken?: string | null;
  accountId: string;
  googleHostedDomain?: string | null;
  idToken?: string | null;
  providerId: string;
  refreshToken?: string | null;
  scope?: string | null;
  userId: string;
};

export type BetterAuthSessionRecord = BetterAuthRecord & {
  activeOrganizationId?: string | null;
  authMethod?: string | null;
  enterpriseOrganizationId?: string | null;
  enterpriseProviderKey?: string | null;
  enterpriseProtocol?: string | null;
  expiresAt?: Date | string | number | null;
  token: string;
  userId: string;
};

export type BetterAuthScimProviderRecord = BetterAuthRecord & {
  organizationId?: string | null;
  providerId: string;
  scimToken: string;
  userId?: string | null;
};

export type BetterAuthPasskeyRecord = BetterAuthRecord & {
  userId: string;
  credentialID: string;
  publicKey: string;
  counter: number;
  deviceType: string;
  backedUp: boolean;
  name?: string | null;
  transports?: string | null;
  createdAt?: Date | string | number | null;
  aaguid?: string | null;
};

function toTimestamp(value: string | number | Date | undefined | null): number {
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

export function normalizeBetterAuthUserProfile(authUser: BetterAuthUser) {
  const authUserId = assertUserId(authUser, 'Better Auth user missing id');
  const email = authUser.email ?? '';
  const name = authUser.name ?? null;
  const role = normalizeUserRole(authUser.role);

  return {
    authUserId,
    email,
    emailLower: email.toLowerCase(),
    name,
    nameLower: name ? name.toLowerCase() : null,
    phoneNumber: authUser.phoneNumber ?? null,
    role,
    isSiteAdmin: deriveIsSiteAdmin(role),
    emailVerified: authUser.emailVerified ?? false,
    banned: authUser.banned === true,
    banReason: authUser.banReason ?? null,
    banExpires: authUser.banExpires ? toTimestamp(authUser.banExpires) : null,
    createdAt: toTimestamp(authUser.createdAt),
    updatedAt: toTimestamp(authUser.updatedAt),
  };
}

async function fetchAllRecords<T extends BetterAuthRecord>(
  ctx: GenericCtx<DataModel>,
  model: BetterAuthModel,
  where?: Array<{
    field: string;
    operator?:
      | 'lt'
      | 'lte'
      | 'gt'
      | 'gte'
      | 'eq'
      | 'in'
      | 'not_in'
      | 'ne'
      | 'contains'
      | 'starts_with'
      | 'ends_with';
    value: string | number | boolean | string[] | number[] | null;
    connector?: 'AND' | 'OR';
  }>,
): Promise<T[]> {
  const records: T[] = [];
  let cursor: string | null = null;

  while (true) {
    const rawResult: unknown = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: model as never,
      where,
      paginationOpts: {
        cursor,
        numItems: 1000,
        id: 0,
      },
    });

    const normalized = normalizeAdapterFindManyResult<T>(rawResult);
    records.push(...normalized.page);

    if (normalized.isDone || !normalized.continueCursor) {
      break;
    }

    cursor = normalized.continueCursor;
  }

  return records;
}

export async function fetchAllBetterAuthUsers(
  ctx: GenericCtx<DataModel>,
): Promise<BetterAuthUser[]> {
  return await fetchAllRecords<BetterAuthUser>(ctx, 'user');
}

export async function fetchAllBetterAuthPasskeys(
  ctx: GenericCtx<DataModel>,
): Promise<BetterAuthPasskeyRecord[]> {
  return await fetchAllRecords<BetterAuthPasskeyRecord>(ctx, 'passkey');
}

export async function fetchAllBetterAuthSessions(
  ctx: GenericCtx<DataModel>,
): Promise<BetterAuthSessionRecord[]> {
  return await fetchAllRecords<BetterAuthSessionRecord>(ctx, 'session');
}

export async function fetchBetterAuthUsersByIds(
  ctx: GenericCtx<DataModel>,
  userIds: string[],
): Promise<BetterAuthUser[]> {
  if (userIds.length === 0) {
    return [];
  }

  return await fetchAllRecords<BetterAuthUser>(ctx, 'user', [
    {
      field: '_id',
      operator: 'in',
      value: [...new Set(userIds)],
    },
  ]);
}

export async function findBetterAuthUserByEmail(
  ctx: GenericCtx<DataModel>,
  email: string,
): Promise<BetterAuthUser | null> {
  const rawUser = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'user',
    where: [
      {
        field: 'email',
        operator: 'eq',
        value: email,
      },
    ],
  })) as BetterAuthUser | null;

  return rawUser;
}

export async function updateBetterAuthUserRecord(
  ctx: CtxWithRunMutation,
  userId: string,
  data: Record<string, unknown>,
) {
  await ctx.runMutation(components.betterAuth.adapter.updateMany, {
    input: {
      model: 'user',
      update: {
        ...data,
        updatedAt: Date.now(),
      },
      where: [
        {
          field: '_id',
          operator: 'eq',
          value: userId,
        },
      ],
    },
    paginationOpts: {
      cursor: null,
      numItems: 1,
      id: 0,
    },
  });
}

export async function createBetterAuthOrganization(
  ctx: CtxWithRunMutation,
  data: {
    name: string;
    slug: string;
    createdAt: number;
    logo?: string | null;
    metadata?: string | null;
  },
): Promise<BetterAuthOrganization> {
  return (await ctx.runMutation(components.betterAuth.adapter.create, {
    input: {
      model: 'organization',
      data,
    },
  })) as BetterAuthOrganization;
}

export async function createBetterAuthMember(
  ctx: CtxWithRunMutation,
  data: {
    organizationId: string;
    userId: string;
    role: string;
    createdAt: number;
  },
): Promise<BetterAuthMember> {
  return (await ctx.runMutation(components.betterAuth.adapter.create, {
    input: {
      model: 'member',
      data,
    },
  })) as BetterAuthMember;
}

export async function createBetterAuthInvitation(
  ctx: CtxWithRunMutation,
  data: {
    organizationId: string;
    email: string;
    role: string;
    status: 'pending' | 'accepted' | 'rejected' | 'canceled';
    inviterId: string;
    expiresAt: number;
    createdAt: number;
  },
): Promise<BetterAuthInvitation> {
  return (await ctx.runMutation(components.betterAuth.adapter.create, {
    input: {
      model: 'invitation',
      data,
    },
  })) as BetterAuthInvitation;
}

export async function findBetterAuthOrganizationById(
  ctx: GenericCtx<DataModel>,
  organizationId: string,
): Promise<BetterAuthOrganization | null> {
  return (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'organization',
    where: [{ field: '_id', operator: 'eq', value: organizationId }],
  })) as BetterAuthOrganization | null;
}

export async function findBetterAuthOrganizationBySlug(
  ctx: GenericCtx<DataModel>,
  slug: string,
): Promise<BetterAuthOrganization | null> {
  return (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'organization',
    where: [{ field: 'slug', operator: 'eq', value: slug }],
  })) as BetterAuthOrganization | null;
}

export async function fetchBetterAuthOrganizationsByIds(
  ctx: GenericCtx<DataModel>,
  organizationIds: string[],
): Promise<BetterAuthOrganization[]> {
  if (organizationIds.length === 0) {
    return [];
  }

  return await fetchAllRecords<BetterAuthOrganization>(ctx, 'organization', [
    {
      field: '_id',
      operator: 'in',
      value: organizationIds,
    },
  ]);
}

export async function fetchAllBetterAuthOrganizations(
  ctx: GenericCtx<DataModel>,
): Promise<BetterAuthOrganization[]> {
  return await fetchAllRecords<BetterAuthOrganization>(ctx, 'organization');
}

export async function findBetterAuthMember(
  ctx: GenericCtx<DataModel>,
  organizationId: string,
  userId: string,
): Promise<BetterAuthMember | null> {
  return (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'member',
    where: [
      { field: 'organizationId', operator: 'eq', value: organizationId },
      { field: 'userId', operator: 'eq', value: userId, connector: 'AND' },
    ],
  })) as BetterAuthMember | null;
}

export async function fetchBetterAuthMembersByOrganizationId(
  ctx: GenericCtx<DataModel>,
  organizationId: string,
): Promise<BetterAuthMember[]> {
  return await fetchAllRecords<BetterAuthMember>(ctx, 'member', [
    {
      field: 'organizationId',
      operator: 'eq',
      value: organizationId,
    },
  ]);
}

export async function fetchAllBetterAuthMembers(
  ctx: GenericCtx<DataModel>,
): Promise<BetterAuthMember[]> {
  return await fetchAllRecords<BetterAuthMember>(ctx, 'member');
}

export async function fetchBetterAuthMembersByUserId(
  ctx: GenericCtx<DataModel>,
  userId: string,
): Promise<BetterAuthMember[]> {
  return await fetchAllRecords<BetterAuthMember>(ctx, 'member', [
    {
      field: 'userId',
      operator: 'eq',
      value: userId,
    },
  ]);
}

export async function fetchBetterAuthInvitationsByOrganizationId(
  ctx: GenericCtx<DataModel>,
  organizationId: string,
): Promise<BetterAuthInvitation[]> {
  return await fetchAllRecords<BetterAuthInvitation>(ctx, 'invitation', [
    {
      field: 'organizationId',
      operator: 'eq',
      value: organizationId,
    },
  ]);
}

export async function findBetterAuthAccountByUserIdAndProviderId(
  ctx: GenericCtx<DataModel>,
  userId: string,
  providerId: string,
): Promise<BetterAuthAccountRecord | null> {
  return (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'account',
    where: [
      { field: 'userId', operator: 'eq', value: userId },
      { field: 'providerId', operator: 'eq', value: providerId },
    ],
  })) as BetterAuthAccountRecord | null;
}

export async function findBetterAuthAccountByAccountIdAndProviderId(
  ctx: GenericCtx<DataModel>,
  accountId: string,
  providerId: string,
): Promise<BetterAuthAccountRecord | null> {
  return (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'account',
    where: [
      { field: 'accountId', operator: 'eq', value: accountId },
      { field: 'providerId', operator: 'eq', value: providerId, connector: 'AND' },
    ],
  })) as BetterAuthAccountRecord | null;
}

export async function fetchBetterAuthInvitationsByOrganizationAndEmail(
  ctx: GenericCtx<DataModel>,
  organizationId: string,
  email: string,
): Promise<BetterAuthInvitation[]> {
  return await fetchAllRecords<BetterAuthInvitation>(ctx, 'invitation', [
    {
      field: 'organizationId',
      operator: 'eq',
      value: organizationId,
    },
    {
      field: 'email',
      operator: 'eq',
      value: email.toLowerCase(),
      connector: 'AND',
    },
  ]);
}

export async function findBetterAuthInvitationById(
  ctx: GenericCtx<DataModel>,
  invitationId: string,
): Promise<BetterAuthInvitation | null> {
  return (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'invitation',
    where: [{ field: '_id', operator: 'eq', value: invitationId }],
  })) as BetterAuthInvitation | null;
}

export async function fetchBetterAuthSessionsByUserId(
  ctx: GenericCtx<DataModel>,
  userId: string,
): Promise<BetterAuthSessionRecord[]> {
  return await fetchAllRecords<BetterAuthSessionRecord>(ctx, 'session', [
    {
      field: 'userId',
      operator: 'eq',
      value: userId,
    },
  ]);
}

export async function updateBetterAuthSessionRecord(
  ctx: CtxWithRunMutation,
  sessionId: string,
  data: Record<string, unknown>,
) {
  await ctx.runMutation(components.betterAuth.adapter.updateMany, {
    input: {
      model: 'session',
      update: {
        ...data,
        updatedAt: Date.now(),
      },
      where: [
        {
          field: '_id',
          operator: 'eq',
          value: sessionId,
        },
      ],
    },
    paginationOpts: {
      cursor: null,
      numItems: 1,
      id: 0,
    },
  });
}

export async function updateBetterAuthAccountRecord(
  ctx: CtxWithRunMutation,
  accountRecordId: string,
  data: Record<string, unknown>,
) {
  await ctx.runMutation(components.betterAuth.adapter.updateMany, {
    input: {
      model: 'account',
      update: {
        ...data,
        updatedAt: Date.now(),
      },
      where: [
        {
          field: '_id',
          operator: 'eq',
          value: accountRecordId,
        },
      ],
    },
    paginationOpts: {
      cursor: null,
      numItems: 1,
      id: 0,
    },
  });
}

export async function deleteBetterAuthMemberRecord(ctx: CtxWithRunMutation, memberId: string) {
  await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
    input: {
      model: 'member',
      where: [
        {
          field: '_id',
          operator: 'eq',
          value: memberId,
        },
      ],
    },
    paginationOpts: {
      cursor: null,
      numItems: 1,
      id: 0,
    },
  });
}

export async function findBetterAuthScimProviderById(
  ctx: GenericCtx<DataModel>,
  providerId: string,
): Promise<BetterAuthScimProviderRecord | null> {
  return (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'scimProvider' as never,
    where: [{ field: 'providerId', operator: 'eq', value: providerId }],
  })) as BetterAuthScimProviderRecord | null;
}

export async function findBetterAuthScimProviderByOrganizationId(
  ctx: GenericCtx<DataModel>,
  organizationId: string,
): Promise<BetterAuthScimProviderRecord | null> {
  return (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'scimProvider' as never,
    where: [{ field: 'organizationId', operator: 'eq', value: organizationId }],
  })) as BetterAuthScimProviderRecord | null;
}

export async function fetchAllBetterAuthScimProviders(
  ctx: GenericCtx<DataModel>,
): Promise<BetterAuthScimProviderRecord[]> {
  return await fetchAllRecords<BetterAuthScimProviderRecord>(ctx, 'scimProvider');
}
