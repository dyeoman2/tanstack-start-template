import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireAdmin } from '~/features/auth/server/auth-guards';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';
import { getBetterAuthRequest } from '~/lib/server/better-auth/http';
import { handleServerError } from '~/lib/server/error-utils.server';
import { resolveRequestAuditContext } from '~/lib/server/request-audit-context';

const evidenceReportIdSchema = z.object({
  id: z.string().min(1),
});

const reviewEvidenceReportSchema = z.object({
  customerSummary: z.string().optional(),
  id: z.string().min(1),
  internalNotes: z.string().optional(),
  reviewStatus: z.enum(['needs_follow_up', 'reviewed']),
});

const generateEvidenceReportSchema = z.object({
  reportKind: z
    .enum([
      'security_posture',
      'audit_integrity',
      'audit_readiness',
      'annual_review',
      'findings_snapshot',
      'vendor_posture_snapshot',
      'control_workspace_snapshot',
    ])
    .optional(),
});

export const reviewEvidenceReportServerFn = createServerFn({ method: 'POST' })
  .inputValidator(reviewEvidenceReportSchema)
  .handler(async ({ data }) => {
    try {
      await requireAdmin();
      const requestContext = resolveRequestAuditContext(getBetterAuthRequest());

      return await convexAuthReactStart.fetchAuthMutation(
        api.securityReports.reviewEvidenceReport,
        {
          ...data,
          id: data.id as Id<'evidenceReports'>,
          requestContext,
        },
      );
    } catch (error) {
      throw handleServerError(error, 'Review evidence report');
    }
  });

export const exportEvidenceReportServerFn = createServerFn({ method: 'POST' })
  .inputValidator(evidenceReportIdSchema)
  .handler(async ({ data }) => {
    try {
      await requireAdmin();
      const requestContext = resolveRequestAuditContext(getBetterAuthRequest());

      return await convexAuthReactStart.fetchAuthAction(api.securityReports.exportEvidenceReport, {
        id: data.id as Id<'evidenceReports'>,
        requestContext,
      });
    } catch (error) {
      throw handleServerError(error, 'Export evidence report');
    }
  });

export const generateEvidenceReportServerFn = createServerFn({ method: 'POST' })
  .inputValidator(generateEvidenceReportSchema)
  .handler(async ({ data }) => {
    try {
      await requireAdmin();
      const requestContext = resolveRequestAuditContext(getBetterAuthRequest());

      return await convexAuthReactStart.fetchAuthAction(
        api.securityReports.generateEvidenceReport,
        {
          ...data,
          requestContext,
        },
      );
    } catch (error) {
      throw handleServerError(error, 'Generate evidence report');
    }
  });
