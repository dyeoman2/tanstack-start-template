/**
 * Canonical metadata shapes for selected PHI-adjacent audit events.
 *
 * Persisted audit ledger metadata is stored as stringified JSON. For covered
 * event families, the audit append path validates the structure documented here.
 */

export type ChatAttachmentUploadedMetadata = {
  readonly attachmentId: string;
  readonly kind: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
};

export type ChatAttachmentScanResultMetadata = {
  readonly attachmentId: string;
  readonly scanResult: 'clean' | 'infected' | 'quarantined_unscanned';
  readonly scannerEngine?: string;
};

export type FileAccessTicketIssuedMetadata = {
  readonly expiresInMinutes: number;
  readonly issuedIpAddress: string;
  readonly issuedUserAgent: string;
  readonly ticketId: string;
  readonly purpose: 'external_share' | 'interactive_open';
};

export type FileAccessRedeemedMetadata = {
  readonly ipAddress: string | null;
  readonly purpose: 'external_share' | 'interactive_open';
  readonly sourceSurface: string;
  readonly ticketId: string;
  readonly userAgent: string | null;
};

export type FileAccessRedeemFailedMetadata = {
  readonly attemptedSessionId: string | null;
  readonly attemptedUserId: string | null;
  readonly error: string;
  readonly expiresAt: number | null;
  readonly ipAddress: string | null;
  readonly sourceSurface: string | null;
  readonly ticketId: string;
  readonly userAgent: string | null;
};

export type OutboundVendorAccessUsedMetadata = {
  readonly vendor: string;
  readonly runId: string;
  readonly useWebSearch: boolean;
};

export type OutboundVendorAccessDeniedMetadata = {
  readonly vendor: string;
  readonly reason: string;
  readonly violation?: string;
  readonly violatedValues?: readonly string[];
  readonly runId?: string;
};

export type ChatWebSearchUsedMetadata = {
  readonly runId: string;
  readonly model: string | null;
  readonly fetchedDomains: readonly string[];
  readonly sourceCount: number;
};

export type RetentionPurgeCompletedMetadata = {
  readonly batchId: string;
  readonly deletedCount: number;
  readonly failedCount: number;
};

export type ChatRunCompletedMetadata = {
  readonly runId: string;
  readonly model: string | null;
  readonly provider: string | null;
  readonly useWebSearch: boolean;
};
