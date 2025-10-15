import { createServerFn } from '@tanstack/react-start';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '~/db/schema';
import { requireAuth } from '~/features/auth/server/auth-guards';
import { getDb } from '~/lib/server/db-config.server';
import { handleServerError } from '~/lib/server/error-utils.server';

// Zod schemas for profile operations
const updateProfileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name is too long'),
  phoneNumber: z.string().optional(),
});

// Get user profile
export const getUserProfileServerFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const { user } = await requireAuth();

    const userRecord = await getDb()
      .select({
        id: schema.user.id,
        email: schema.user.email,
        name: schema.user.name,
        phoneNumber: schema.user.phoneNumber,
        role: schema.user.role,
        emailVerified: schema.user.emailVerified,
        createdAt: schema.user.createdAt,
        updatedAt: schema.user.updatedAt,
      })
      .from(schema.user)
      .where(eq(schema.user.id, user.id))
      .limit(1);

    if (userRecord.length === 0) {
      throw new Error('User not found');
    }

    return {
      success: true,
      profile: userRecord[0],
    };
  } catch (error) {
    throw handleServerError(error, 'Get user profile');
  }
});

// Update user profile
export const updateUserProfileServerFn = createServerFn({ method: 'POST' })
  .inputValidator(updateProfileSchema)
  .handler(async ({ data }) => {
    try {
      const { user } = await requireAuth();

      const { name, phoneNumber } = data;

      await getDb()
        .update(schema.user)
        .set({
          name,
          phoneNumber: phoneNumber || null,
          updatedAt: new Date(),
        })
        .where(eq(schema.user.id, user.id));

      // Return the updated profile
      const updatedRecord = await getDb()
        .select({
          id: schema.user.id,
          email: schema.user.email,
          name: schema.user.name,
          phoneNumber: schema.user.phoneNumber,
          role: schema.user.role,
          emailVerified: schema.user.emailVerified,
          createdAt: schema.user.createdAt,
          updatedAt: schema.user.updatedAt,
        })
        .from(schema.user)
        .where(eq(schema.user.id, user.id))
        .limit(1);

      return {
        success: true,
        profile: updatedRecord[0],
        message: 'Profile updated successfully',
      };
    } catch (error) {
      throw handleServerError(error, 'Update user profile');
    }
  });
