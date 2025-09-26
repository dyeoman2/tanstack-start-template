import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).optional(),
  APP_NAME: z.string().min(1, 'APP_NAME is required').default('TanStack Start Template'),
  RESEND_API_KEY: z.string().min(1, 'RESEND_API_KEY is required for email functionality'),
  RESEND_EMAIL_SENDER: z.string().optional().default('onboarding@resend.dev'),
});

export function getEnv() {
  const parsed = EnvSchema.safeParse(process.env as unknown);
  if (!parsed.success) {
    throw new Error(`Invalid/missing environment configuration: ${parsed.error.message}`);
  }
  return parsed.data as z.infer<typeof EnvSchema>;
}
