# Schema Migration Documentation

This document tracks the migration from Drizzle/PostgreSQL schema to Convex schema.

## Schema Mapping

### Better Auth Tables

| Drizzle Table | Convex Table | Notes |
|--------------|--------------|-------|
| `user` | `users` | Table name pluralized in Convex |
| `session` | `sessions` | Table name pluralized in Convex |
| `auth_account` | `accounts` | Renamed for Better Auth compatibility |
| `verification` | `verificationTokens` | Renamed for Better Auth compatibility |

### Application Tables

| Drizzle Table | Convex Table | Notes |
|--------------|--------------|-------|
| `audit_log` | `auditLogs` | Table name camelCase in Convex |

## Field Type Mappings

### Timestamp Conversion
- **Drizzle**: `timestamp()` → PostgreSQL `TIMESTAMP`
- **Convex**: `v.number()` → Unix timestamp (milliseconds since epoch)

### Data Type Conversions
- `text()` → `v.string()`
- `boolean()` → `v.boolean()` (wrapped in `v.optional()` if nullable)
- `integer()` → `v.number()`
- `timestamp()` → `v.number()` (Unix timestamp)

### Nullable Fields
- Drizzle: `.notNull()` vs no constraint
- Convex: `v.optional(v.type())` for nullable fields

## Index Mapping

### Users Table
- `by_email` - Unique email lookups (replaces Drizzle unique constraint)

### Sessions Table
- `by_token` - Session token lookups (replaces Drizzle unique constraint)
- `by_userId` - User session queries

### Accounts Table
- `by_userId` - User account lookups

### Verification Tokens Table
- `by_identifier` - Verification identifier lookups
- `by_value` - Verification token value lookups

### Audit Logs Table
- `by_userId` - User audit history queries
- `by_createdAt` - Time-based audit queries

## Field Mappings

### Users Table
All fields mapped:
- `id` (string) ✅
- `email` (string, indexed) ✅
- `emailVerified` (optional boolean) ✅
- `name` (optional string) ✅
- `image` (optional string) ✅
- `phoneNumber` (optional string) ✅
- `role` (string) ✅
- `failedLoginAttempts` (number) ✅
- `lastFailedLoginAt` (optional number) ✅
- `lockedUntil` (optional number) ✅
- `createdAt` (number) ✅
- `updatedAt` (number) ✅

### Sessions Table
All fields mapped:
- `id` (string) ✅
- `expiresAt` (number) ✅
- `token` (string, indexed) ✅
- `createdAt` (number) ✅
- `updatedAt` (number) ✅
- `ipAddress` (optional string) ✅
- `userAgent` (optional string) ✅
- `userId` (string, indexed) ✅

### Accounts Table
All fields mapped:
- `id` (string) ✅
- `accountId` (string) ✅
- `providerId` (string) ✅
- `userId` (string, indexed) ✅
- `accessToken` (optional string) ✅
- `refreshToken` (optional string) ✅
- `idToken` (optional string) ✅
- `accessTokenExpiresAt` (optional number) ✅
- `refreshTokenExpiresAt` (optional number) ✅
- `scope` (optional string) ✅
- `password` (optional string) ✅
- `createdAt` (number) ✅
- `updatedAt` (number) ✅

### Verification Tokens Table
All fields mapped:
- `id` (string) ✅
- `identifier` (string, indexed) ✅
- `value` (string, indexed) ✅
- `expiresAt` (number) ✅
- `createdAt` (optional number) ✅
- `updatedAt` (optional number) ✅

### Audit Logs Table
All fields mapped:
- `id` (string) ✅
- `userId` (string, indexed) ✅
- `action` (string) ✅
- `entityType` (string) ✅
- `entityId` (optional string) ✅
- `metadata` (optional string) ✅
- `createdAt` (number, indexed) ✅
- `ipAddress` (optional string) ✅
- `userAgent` (optional string) ✅

## Unused Enums

The Drizzle schema includes several enums that are not currently used in any tables:
- `projectTypeEnum` - Not migrated (unused)
- `utilityTypeEnum` - Not migrated (unused)
- `ownershipTypeEnum` - Not migrated (unused)
- `agentTypeEnum` - Not migrated (unused)
- `checklistAreaEnum` - Not migrated (unused)
- `checklistItemStatusEnum` - Not migrated (unused)
- `completionSourceEnum` - Not migrated (unused)
- `reviewStatusEnum` - Not migrated (unused)

These can be added to Convex schema later if needed using `v.union()` or `v.string()` with validation.

## Notes

1. **Foreign Keys**: Convex doesn't have foreign key constraints. Relationships are maintained through application logic using string IDs.

2. **Unique Constraints**: Replaced with indexes in Convex. Application logic must enforce uniqueness where needed.

3. **Cascade Deletes**: Not supported in Convex. Application logic must handle cascading deletions.

4. **Default Values**: Convex doesn't support default values in schema. Application logic must set defaults when creating documents.

5. **Reserved Index Names**: Convex reserves `by_id` and `by_creation_time` - cannot be used.

## Validation Status

✅ Schema compiles successfully  
✅ All indexes created  
✅ Type checking passes  
✅ No reserved index names used  

