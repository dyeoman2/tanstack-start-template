import { createServerFn } from '@tanstack/react-start';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '~/db/schema';
import { getDb } from '~/lib/server/db-config.server';
import { handleServerError } from '~/lib/server/error-utils.server';
import { auth } from './betterAuth';

// Zod schemas for user management

const signUpWithFirstAdminSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required'),
});

// User management functions

// Custom signup server function that assigns admin role to first user
export const signUpWithFirstAdminServerFn = createServerFn({ method: 'POST' })
  .inputValidator(signUpWithFirstAdminSchema)
  .handler(async ({ data }) => {
    const { email, password, name } = data;

    const _db = getDb();

    try {
      // Check if this would be the first user
      const userCount = await getDb().select({ count: sql<number>`count(*)` }).from(schema.user);

      const totalUsers = Number(userCount[0]?.count ?? 0);
      const isFirstUser = totalUsers === 0;

      // Create user via Better Auth API to ensure password and related records are handled correctly
      const signUpResult = await auth.api.signUpEmail({
        body: {
          email,
          password,
          name,
          rememberMe: true,
        },
      });

      // If this was the first user, update their role to admin
      if (isFirstUser) {
        console.log('🔑 First user created, setting admin role for:', email);

        // Find the newly created user (prefer id returned by Better Auth when available)
        const newUserId = signUpResult?.user?.id;
        const newUser = newUserId
          ? [{ id: newUserId }]
          : await getDb()
              .select({ id: schema.user.id })
              .from(schema.user)
              .where(eq(schema.user.email, email))
              .limit(1);

        if (newUser.length > 0) {
          await getDb()
            .update(schema.user)
            .set({
              role: 'admin',
              updatedAt: new Date(),
            })
            .where(eq(schema.user.id, newUser[0].id));

          console.log('✅ Admin role assigned to first user');
        }
      }

      return {
        success: true,
        isFirstUser,
        message: isFirstUser
          ? 'Admin account created successfully!'
          : 'Account created successfully!',
      };
    } catch (error) {
      throw handleServerError(error, 'User signup');
    }
  });

// Check if there are any users in the system (for determining first admin)
export const checkIsFirstUserServerFn = createServerFn({
  method: 'GET',
}).handler(async () => {
  const _db = getDb();

  const userCount = await getDb().select({ count: sql<number>`count(*)` }).from(schema.user);

  const totalUsers = Number(userCount[0]?.count ?? 0);
  return {
    isFirstUser: totalUsers === 0,
    totalUsers,
  };
});
