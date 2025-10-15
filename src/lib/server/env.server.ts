import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_NAME: z.string().min(1, 'APP_NAME is required').default('TanStack Start Template'),
  RESEND_API_KEY: z.string().min(1, 'RESEND_API_KEY is required for email functionality'),
  RESEND_EMAIL_SENDER: z.string().optional().default('onboarding@resend.dev'),

  // S3-compatible storage configuration (MinIO in dev, S3 in prod)
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-west-1'),
  S3_ACCESS_KEY_ID: z.string().min(1, 'S3_ACCESS_KEY_ID is required'),
  S3_SECRET_ACCESS_KEY: z.string().min(1, 'S3_SECRET_ACCESS_KEY is required'),
  S3_BUCKET_NAME: z.string().min(1, 'S3_BUCKET_NAME is required'),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default('false')
    .transform((value) => value.toLowerCase() === 'true'),
  S3_PUBLIC_URL: z.string().url(),
});

export function getEnv() {
  const parsed = EnvSchema.safeParse(process.env as unknown);
  if (!parsed.success) {
    throw new Error(`Invalid/missing environment configuration: ${parsed.error.message}`);
  }
  return parsed.data as z.infer<typeof EnvSchema>;
}
