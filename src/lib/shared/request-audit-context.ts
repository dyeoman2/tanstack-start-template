import { z } from 'zod';

export const requestAuditContextSchema = z.object({
  requestId: z.string().min(1),
  ipAddress: z.string().min(1).nullable(),
  userAgent: z.string().min(1).nullable(),
});

export type RequestAuditContext = z.infer<typeof requestAuditContextSchema>;
