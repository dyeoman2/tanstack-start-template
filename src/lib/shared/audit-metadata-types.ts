/**
 * Typed metadata shapes for PHI-adjacent audit events.
 *
 * These types improve the integrity story for compliance evidence exports by
 * ensuring metadata is structurally validated at the call site. The audit ledger
 * hash chain protects against post-hoc tampering; typed metadata ensures the
 * data captured at emission time is complete and well-formed.
 */

export type ChatAttachmentUploadedMetadata = {
  readonly attachmentId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly fileSizeBytes: number;
};

export type ChatAttachmentScanResultMetadata = {
  readonly attachmentId: string;
  readonly scanResult: 'clean' | 'infected' | 'quarantined_unscanned';
  readonly scannerEngine?: string;
};

export type FileAccessTicketIssuedMetadata = {
  readonly ticketId: string;
  readonly storageId: string;
  readonly purpose: 'external_share' | 'interactive_open';
  readonly expiresInMinutes: number;
};

export type FileAccessRedeemedMetadata = {
  readonly ticketId: string;
  readonly storageId: string;
};

export type FileAccessRedeemFailedMetadata = {
  readonly ticketId: string;
  readonly reason: 'expired' | 'already_redeemed' | 'invalid_signature' | 'not_found';
};

export type OutboundVendorAccessUsedMetadata = {
  readonly vendor: string;
  readonly runId?: string;
  readonly useWebSearch?: boolean;
};

export type OutboundVendorAccessDeniedMetadata = {
  readonly vendor: string;
  readonly reason: string;
  readonly violation?: string;
  readonly violatedValues?: readonly string[];
  readonly runId?: string;
};

export type ChatWebSearchUsedMetadata = {
  readonly runId?: string;
  readonly fetchedDomains: readonly string[];
  readonly sourceCount: number;
};

export type RetentionPurgeCompletedMetadata = {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly organizationId: string;
  readonly retentionDays: number;
};

export type ChatRunCompletedMetadata = {
  readonly runId: string;
  readonly modelId: string;
  readonly usedWebSearch: boolean;
  readonly tokenUsage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
  };
};
