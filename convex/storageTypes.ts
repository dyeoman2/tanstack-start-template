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
export const mirrorStatusValidator = v.union(
  v.literal('PENDING'),
  v.literal('MIRRORED'),
  v.literal('FAILED'),
);
export const quarantineReasonValidator = v.union(
  v.literal('INFECTED'),
  v.literal('QUARANTINED_UNSCANNED'),
);
export const storagePlacementValidator = v.union(v.literal('QUARANTINE'), v.literal('PROMOTED'));

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
export type MirrorStatus = 'PENDING' | 'MIRRORED' | 'FAILED';
export type QuarantineReason = 'INFECTED' | 'QUARANTINED_UNSCANNED';
export type StoragePlacement = 'QUARANTINE' | 'PROMOTED';

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
  quarantineBucket?: string;
  quarantineKey?: string;
  quarantineVersionId?: string;
  quarantinedAt?: number;
  quarantineReason?: QuarantineReason;
  sourceId: string;
  sourceType: string;
  storageId: string;
  storagePlacement?: StoragePlacement;
  uploadedById?: string;
  updatedAt: number;
};
