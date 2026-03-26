import { v } from 'convex/values';

export const storageBackendModeValidator = v.union(
  v.literal('convex'),
  v.literal('s3-primary'),
  v.literal('s3-mirror'),
);

export const uploadBackendValidator = v.union(v.literal('convex'), v.literal('s3'));
export const uploadMethodValidator = v.union(v.literal('POST'), v.literal('PUT'));
export const malwareStatusValidator = v.union(
  v.literal('NOT_STARTED'),
  v.literal('PENDING'),
  v.literal('CLEAN'),
  v.literal('INFECTED'),
  v.literal('QUARANTINED_UNSCANNED'),
);
export const inspectionStatusValidator = v.union(
  v.literal('PENDING'),
  v.literal('PASSED'),
  v.literal('REJECTED'),
  v.literal('FAILED'),
);
export const inspectionReasonValidator = v.union(
  v.literal('checksum_mismatch'),
  v.literal('file_signature_mismatch'),
  v.literal('inspection_error'),
  v.literal('office_macro_enabled'),
  v.literal('office_password_protected'),
  v.literal('pdf_active_content'),
  v.literal('pdf_embedded_files'),
  v.literal('pdf_encrypted'),
  v.literal('pdf_javascript'),
  v.literal('pdf_launch_action'),
  v.literal('pdf_malformed'),
  v.literal('pdf_open_action'),
  v.literal('pdf_rich_media'),
  v.literal('pdf_xfa'),
  v.literal('size_limit_exceeded'),
  v.literal('unsupported_type'),
);
export const mirrorStatusValidator = v.union(
  v.literal('PENDING'),
  v.literal('MIRRORED'),
  v.literal('FAILED'),
);
export const quarantineReasonValidator = v.union(
  v.literal('INFECTED'),
  v.literal('QUARANTINED_UNSCANNED'),
  v.literal('INSPECTION_REJECTED'),
);
export const storagePlacementValidator = v.union(
  v.literal('QUARANTINE'),
  v.literal('PROMOTED'),
  v.literal('REJECTED'),
);

export const uploadTargetResultValidator = v.object({
  backend: uploadBackendValidator,
  storageId: v.string(),
  uploadMethod: uploadMethodValidator,
  uploadUrl: v.string(),
  uploadHeaders: v.optional(v.record(v.string(), v.string())),
  uploadFields: v.optional(v.record(v.string(), v.string())),
  expiresAt: v.number(),
});

export const fileUrlResultValidator = v.object({
  storageId: v.string(),
  url: v.union(v.string(), v.null()),
});

export type StorageBackendMode = 'convex' | 's3-primary' | 's3-mirror';
export type UploadBackend = 'convex' | 's3';
export type UploadMethod = 'POST' | 'PUT';
export type MalwareStatus =
  | 'NOT_STARTED'
  | 'PENDING'
  | 'CLEAN'
  | 'INFECTED'
  | 'QUARANTINED_UNSCANNED';
export type InspectionStatus = 'PENDING' | 'PASSED' | 'REJECTED' | 'FAILED';
export type InspectionReason =
  | 'checksum_mismatch'
  | 'file_signature_mismatch'
  | 'inspection_error'
  | 'office_macro_enabled'
  | 'office_password_protected'
  | 'pdf_active_content'
  | 'pdf_embedded_files'
  | 'pdf_encrypted'
  | 'pdf_javascript'
  | 'pdf_launch_action'
  | 'pdf_malformed'
  | 'pdf_open_action'
  | 'pdf_rich_media'
  | 'pdf_xfa'
  | 'size_limit_exceeded'
  | 'unsupported_type';
export type MirrorStatus = 'PENDING' | 'MIRRORED' | 'FAILED';
export type QuarantineReason = 'INFECTED' | 'QUARANTINED_UNSCANNED' | 'INSPECTION_REJECTED';
export type StoragePlacement = 'QUARANTINE' | 'PROMOTED' | 'REJECTED';

export type CreateUploadTargetArgs = {
  contentType: string;
  fileName: string;
  fileSize: number;
  organizationId?: string | null;
  sha256Hex?: string;
  sourceId?: string;
  sourceType: string;
};

export type UploadTargetResult = {
  backend: UploadBackend;
  storageId: string;
  uploadMethod: UploadMethod;
  uploadUrl: string;
  uploadHeaders?: Record<string, string>;
  uploadFields?: Record<string, string>;
  expiresAt: number;
};

export type FinalizeUploadArgs = {
  backendMode: StorageBackendMode;
  storageId: string;
  parentStorageId?: string;
  organizationId?: string | null;
  sourceId: string;
  sourceType: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  sha256Hex?: string;
  uploadedById?: string;
};

export type RegisterFileForLifecycleTrackingArgs = FinalizeUploadArgs;

export type ResolveFileUrlArgs = {
  storageId: string;
};

export type DeleteStoredFileArgs = {
  storageId: string;
};

export type StorageLifecycleRecord = {
  backendMode: StorageBackendMode;
  canonicalBucket?: string;
  canonicalKey?: string;
  canonicalVersionId?: string;
  deletedAt?: number;
  fileSize?: number;
  inspectionDetails?: string;
  inspectionEngine?: string;
  inspectionReason?: InspectionReason;
  inspectionScannedAt?: number;
  inspectionStatus?: InspectionStatus;
  malwareDetectedAt?: number;
  malwareFindingId?: string;
  malwareScannedAt?: number;
  malwareStatus?: MalwareStatus;
  mimeType?: string;
  mirrorAttempts?: number;
  mirrorBucket?: string;
  mirrorDeadlineAt?: number;
  mirrorKey?: string;
  mirrorLastError?: string;
  mirrorStatus?: MirrorStatus;
  mirrorVersionId?: string;
  parentStorageId?: string;
  organizationId?: string;
  originalFileName: string;
  rejectedBucket?: string;
  rejectedKey?: string;
  rejectedVersionId?: string;
  quarantineBucket?: string;
  quarantineKey?: string;
  quarantineVersionId?: string;
  sha256Hex?: string;
  quarantinedAt?: number;
  quarantineReason?: QuarantineReason;
  sourceId: string;
  sourceType: string;
  storageId: string;
  storagePlacement?: StoragePlacement;
  uploadedById?: string;
  updatedAt: number;
};
