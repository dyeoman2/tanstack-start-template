/**
 * Local Better Auth component schema.
 *
 * This repo uses a local install so plugin-owned fields like the admin
 * plugin's `user.role` are part of the component validator.
 */

import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export const tables = {
  user: defineTable({
    name: v.string(),
    email: v.string(),
    emailVerified: v.boolean(),
    image: v.optional(v.union(v.null(), v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
    twoFactorEnabled: v.optional(v.union(v.null(), v.boolean())),
    isAnonymous: v.optional(v.union(v.null(), v.boolean())),
    username: v.optional(v.union(v.null(), v.string())),
    displayUsername: v.optional(v.union(v.null(), v.string())),
    phoneNumber: v.optional(v.union(v.null(), v.string())),
    phoneNumberVerified: v.optional(v.union(v.null(), v.boolean())),
    userId: v.optional(v.union(v.null(), v.string())),
    role: v.optional(v.union(v.null(), v.string())),
    banned: v.optional(v.union(v.null(), v.boolean())),
    banReason: v.optional(v.union(v.null(), v.string())),
    banExpires: v.optional(v.union(v.null(), v.number())),
  })
    .index('email_name', ['email', 'name'])
    .index('name', ['name'])
    .index('userId', ['userId'])
    .index('username', ['username'])
    .index('phoneNumber', ['phoneNumber']),
  session: defineTable({
    expiresAt: v.number(),
    token: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    ipAddress: v.optional(v.union(v.null(), v.string())),
    userAgent: v.optional(v.union(v.null(), v.string())),
    userId: v.string(),
    impersonatedBy: v.optional(v.union(v.null(), v.string())),
    activeOrganizationId: v.optional(v.union(v.null(), v.string())),
    authMethod: v.optional(v.union(v.null(), v.string())),
    enterpriseOrganizationId: v.optional(v.union(v.null(), v.string())),
    enterpriseProviderKey: v.optional(v.union(v.null(), v.string())),
    enterpriseProtocol: v.optional(v.union(v.null(), v.string())),
  })
    .index('expiresAt', ['expiresAt'])
    .index('expiresAt_userId', ['expiresAt', 'userId'])
    .index('token', ['token'])
    .index('userId', ['userId'])
    .index('userId_expiresAt', ['userId', 'expiresAt']),
  account: defineTable({
    accountId: v.string(),
    providerId: v.string(),
    userId: v.string(),
    accessToken: v.optional(v.union(v.null(), v.string())),
    refreshToken: v.optional(v.union(v.null(), v.string())),
    idToken: v.optional(v.union(v.null(), v.string())),
    googleHostedDomain: v.optional(v.union(v.null(), v.string())),
    accessTokenExpiresAt: v.optional(v.union(v.null(), v.number())),
    refreshTokenExpiresAt: v.optional(v.union(v.null(), v.number())),
    scope: v.optional(v.union(v.null(), v.string())),
    password: v.optional(v.union(v.null(), v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('accountId', ['accountId'])
    .index('accountId_providerId', ['accountId', 'providerId'])
    .index('providerId_userId', ['providerId', 'userId'])
    .index('userId', ['userId']),
  verification: defineTable({
    identifier: v.string(),
    value: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('expiresAt', ['expiresAt'])
    .index('identifier', ['identifier']),
  twoFactor: defineTable({
    secret: v.string(),
    backupCodes: v.string(),
    userId: v.string(),
  }).index('userId', ['userId']),
  passkey: defineTable({
    name: v.optional(v.union(v.null(), v.string())),
    publicKey: v.string(),
    userId: v.string(),
    credentialID: v.string(),
    counter: v.number(),
    deviceType: v.string(),
    backedUp: v.boolean(),
    transports: v.optional(v.union(v.null(), v.string())),
    createdAt: v.optional(v.union(v.null(), v.number())),
    aaguid: v.optional(v.union(v.null(), v.string())),
  })
    .index('credentialID', ['credentialID'])
    .index('userId', ['userId']),
  oauthApplication: defineTable({
    name: v.optional(v.union(v.null(), v.string())),
    icon: v.optional(v.union(v.null(), v.string())),
    metadata: v.optional(v.union(v.null(), v.string())),
    clientId: v.optional(v.union(v.null(), v.string())),
    clientSecret: v.optional(v.union(v.null(), v.string())),
    redirectURLs: v.optional(v.union(v.null(), v.string())),
    type: v.optional(v.union(v.null(), v.string())),
    disabled: v.optional(v.union(v.null(), v.boolean())),
    userId: v.optional(v.union(v.null(), v.string())),
    createdAt: v.optional(v.union(v.null(), v.number())),
    updatedAt: v.optional(v.union(v.null(), v.number())),
  })
    .index('clientId', ['clientId'])
    .index('userId', ['userId']),
  oauthAccessToken: defineTable({
    accessToken: v.optional(v.union(v.null(), v.string())),
    refreshToken: v.optional(v.union(v.null(), v.string())),
    accessTokenExpiresAt: v.optional(v.union(v.null(), v.number())),
    refreshTokenExpiresAt: v.optional(v.union(v.null(), v.number())),
    clientId: v.optional(v.union(v.null(), v.string())),
    userId: v.optional(v.union(v.null(), v.string())),
    scopes: v.optional(v.union(v.null(), v.string())),
    createdAt: v.optional(v.union(v.null(), v.number())),
    updatedAt: v.optional(v.union(v.null(), v.number())),
  })
    .index('accessToken', ['accessToken'])
    .index('refreshToken', ['refreshToken'])
    .index('clientId', ['clientId'])
    .index('userId', ['userId']),
  oauthConsent: defineTable({
    clientId: v.optional(v.union(v.null(), v.string())),
    userId: v.optional(v.union(v.null(), v.string())),
    scopes: v.optional(v.union(v.null(), v.string())),
    createdAt: v.optional(v.union(v.null(), v.number())),
    updatedAt: v.optional(v.union(v.null(), v.number())),
    consentGiven: v.optional(v.union(v.null(), v.boolean())),
  })
    .index('clientId_userId', ['clientId', 'userId'])
    .index('userId', ['userId']),
  jwks: defineTable({
    publicKey: v.string(),
    privateKey: v.string(),
    createdAt: v.number(),
  }),
  organization: defineTable({
    name: v.string(),
    slug: v.string(),
    logo: v.optional(v.union(v.null(), v.string())),
    metadata: v.optional(v.union(v.null(), v.string())),
    createdAt: v.number(),
  })
    .index('slug', ['slug'])
    .index('name', ['name']),
  member: defineTable({
    organizationId: v.string(),
    userId: v.string(),
    role: v.string(),
    createdAt: v.number(),
  })
    .index('organizationId', ['organizationId'])
    .index('userId', ['userId'])
    .index('organizationId_userId', ['organizationId', 'userId']),
  invitation: defineTable({
    organizationId: v.string(),
    email: v.string(),
    role: v.string(),
    status: v.union(
      v.literal('pending'),
      v.literal('accepted'),
      v.literal('rejected'),
      v.literal('canceled'),
    ),
    inviterId: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index('organizationId', ['organizationId'])
    .index('email', ['email'])
    .index('organizationId_email', ['organizationId', 'email'])
    .index('inviterId', ['inviterId']),
  rateLimit: defineTable({
    key: v.optional(v.union(v.null(), v.string())),
    count: v.optional(v.union(v.null(), v.number())),
    lastRequest: v.optional(v.union(v.null(), v.number())),
  }).index('key', ['key']),
  scimProvider: defineTable({
    providerId: v.string(),
    scimToken: v.string(),
    organizationId: v.optional(v.union(v.null(), v.string())),
    userId: v.optional(v.union(v.null(), v.string())),
  })
    .index('providerId', ['providerId'])
    .index('organizationId', ['organizationId'])
    .index('userId', ['userId'])
    .index('scimToken', ['scimToken']),
};

const schema = defineSchema(tables);

export default schema;
