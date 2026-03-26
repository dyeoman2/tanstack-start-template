'use node';

import { inflateSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

export type AllowedFileKind = 'document' | 'image' | 'pdf';
export type AllowedDocumentFormat = 'csv' | 'ooxml' | 'plain_text';
export type StorageInspectionProfile = 'regulated_document' | 'standard';

export type StorageInspectionStatus = 'FAILED' | 'PASSED' | 'REJECTED';

export type StorageInspectionReason =
  | 'archive_encrypted'
  | 'archive_suspicious_structure'
  | 'checksum_mismatch'
  | 'file_signature_mismatch'
  | 'inspection_error'
  | 'office_macro_enabled'
  | 'office_password_protected'
  | 'ooxml_embedded_content'
  | 'ooxml_external_relationship'
  | 'ooxml_malformed'
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

export type StorageInspectionResult = {
  details?: string;
  engine: 's3-intake-policy';
  inspectedAt: number;
  reason?: StorageInspectionReason;
  status: StorageInspectionStatus;
};

export type StorageInspectionPolicy = {
  allowedDocumentFormats: AllowedDocumentFormat[];
  allowedKinds: AllowedFileKind[];
  intakeProfile: StorageInspectionProfile;
  maxBytes: number;
};

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const GIF_SIGNATURE = [0x47, 0x49, 0x46, 0x38];
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const WEBP_SIGNATURE = [0x52, 0x49, 0x46, 0x46];
const ZIP_SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
];

const MAX_SECURITY_EVIDENCE_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const PDF_TOKEN_WINDOW_BYTES = 16 * 1024;
const TEXT_SIGNATURE_WINDOW_BYTES = 512;
const ARCHIVE_MAX_ENTRY_COUNT = 256;
const ARCHIVE_MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const ARCHIVE_MAX_TOTAL_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const ARCHIVE_MAX_COMPRESSION_RATIO = 150;
const OOXML_XML_ENTRY_MAX_BYTES = 2 * 1024 * 1024;
const ZIP_EOCD_MIN_BYTES = 22;
const ZIP_EOCD_MAX_COMMENT_BYTES = 0xffff;
const ZIP_LOCAL_FILE_HEADER_BYTES = 30;
const ZIP_CENTRAL_DIRECTORY_HEADER_BYTES = 46;

const OOXML_MIME_TYPES = new Set([
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.ms-excel.template.macroenabled.12',
  'application/vnd.ms-powerpoint.presentation.macroenabled.12',
  'application/vnd.ms-powerpoint.slideshow.macroenabled.12',
  'application/vnd.ms-powerpoint.template.macroenabled.12',
  'application/vnd.ms-word.document.macroenabled.12',
  'application/vnd.ms-word.template.macroenabled.12',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  'application/vnd.openxmlformats-officedocument.presentationml.template',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
]);

const OOXML_EXTENSIONS = new Set([
  '.docm',
  '.docx',
  '.dotm',
  '.dotx',
  '.potm',
  '.potx',
  '.ppsm',
  '.ppsx',
  '.pptm',
  '.pptx',
  '.xlam',
  '.xlsm',
  '.xlsx',
  '.xltm',
  '.xltx',
]);

const OOXML_MACRO_EXTENSIONS = new Set([
  '.docm',
  '.dotm',
  '.potm',
  '.ppsm',
  '.pptm',
  '.xlam',
  '.xlsm',
  '.xltm',
]);

const OLE_MIME_TYPES = new Set([
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
]);

const OLE_EXTENSIONS = new Set(['.doc', '.ppt', '.xls']);

const OOXML_EMBEDDED_PATH_PATTERNS = [
  '/activex/',
  '/embeddings/',
  '/media/oleobject',
  '/oleobject',
] as const;

const NESTED_ARCHIVE_EXTENSIONS = ['.7z', '.gz', '.jar', '.rar', '.tar', '.zip'] as const;

type DocumentFormat = AllowedDocumentFormat | 'ole' | 'unknown';

type OoxmlArchiveEntry = {
  compressedData: Uint8Array;
  compressedSize: number;
  compressionMethod: number;
  fileName: string;
  isEncrypted: boolean;
  uncompressedSize: number;
};

const xmlParser = new XMLParser({
  attributeNamePrefix: '',
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: false,
  trimValues: true,
});

function startsWithSignature(bytes: Uint8Array, signature: number[]) {
  if (bytes.length < signature.length) {
    return false;
  }

  return signature.every((value, index) => bytes[index] === value);
}

function startsWithAnySignature(bytes: Uint8Array, signatures: number[][]) {
  return signatures.some((signature) => startsWithSignature(bytes, signature));
}

function normalizeMimeType(mimeType: string) {
  return mimeType.trim().toLowerCase().split(';', 1)[0] ?? '';
}

function getFileExtension(fileName: string) {
  const normalizedFileName = fileName.trim().toLowerCase();
  const extensionIndex = normalizedFileName.lastIndexOf('.');
  return extensionIndex >= 0 ? normalizedFileName.slice(extensionIndex) : '';
}

function looksLikeUtf8Text(bytes: Uint8Array) {
  if (bytes.length === 0) {
    return true;
  }

  let printable = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      return false;
    }
    if (byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e)) {
      printable += 1;
    }
  }

  return printable / bytes.length >= 0.9;
}

function resolveDocumentFormat(mimeType: string, fileName: string): DocumentFormat {
  const normalizedMimeType = normalizeMimeType(mimeType);
  const extension = getFileExtension(fileName);

  if (normalizedMimeType === 'text/csv' || extension === '.csv') {
    return 'csv';
  }

  if (normalizedMimeType === 'text/plain' || extension === '.txt') {
    return 'plain_text';
  }

  if (OOXML_MIME_TYPES.has(normalizedMimeType) || OOXML_EXTENSIONS.has(extension)) {
    return 'ooxml';
  }

  if (OLE_MIME_TYPES.has(normalizedMimeType) || OLE_EXTENSIONS.has(extension)) {
    return 'ole';
  }

  return 'unknown';
}

function resolveKnownKind(mimeType: string, fileName: string): AllowedFileKind | null {
  const normalizedMimeType = normalizeMimeType(mimeType);
  const normalizedFileName = fileName.trim().toLowerCase();

  if (normalizedMimeType === 'application/pdf' || normalizedFileName.endsWith('.pdf')) {
    return 'pdf';
  }

  if (
    normalizedMimeType === 'image/png' ||
    normalizedMimeType === 'image/jpeg' ||
    normalizedMimeType === 'image/gif' ||
    normalizedMimeType === 'image/webp' ||
    normalizedFileName.endsWith('.png') ||
    normalizedFileName.endsWith('.jpg') ||
    normalizedFileName.endsWith('.jpeg') ||
    normalizedFileName.endsWith('.gif') ||
    normalizedFileName.endsWith('.webp')
  ) {
    return 'image';
  }

  if (resolveDocumentFormat(mimeType, fileName) !== 'unknown') {
    return 'document';
  }

  return null;
}

function signatureMatches(bytes: Uint8Array, mimeType: string, fileName: string) {
  const normalizedMimeType = normalizeMimeType(mimeType);
  const normalizedFileName = fileName.trim().toLowerCase();

  if (normalizedMimeType === 'application/pdf' || normalizedFileName.endsWith('.pdf')) {
    return startsWithSignature(bytes, PDF_SIGNATURE);
  }

  if (normalizedMimeType === 'image/png' || normalizedFileName.endsWith('.png')) {
    return startsWithSignature(bytes, PNG_SIGNATURE);
  }

  if (
    normalizedMimeType === 'image/jpeg' ||
    normalizedFileName.endsWith('.jpg') ||
    normalizedFileName.endsWith('.jpeg')
  ) {
    return startsWithSignature(bytes, JPEG_SIGNATURE);
  }

  if (normalizedMimeType === 'image/gif' || normalizedFileName.endsWith('.gif')) {
    return startsWithSignature(bytes, GIF_SIGNATURE);
  }

  if (normalizedMimeType === 'image/webp' || normalizedFileName.endsWith('.webp')) {
    return startsWithSignature(bytes, WEBP_SIGNATURE);
  }

  const documentFormat = resolveDocumentFormat(mimeType, fileName);
  if (documentFormat === 'plain_text' || documentFormat === 'csv') {
    return looksLikeUtf8Text(bytes.slice(0, TEXT_SIGNATURE_WINDOW_BYTES));
  }

  if (documentFormat === 'ooxml') {
    return startsWithAnySignature(bytes, ZIP_SIGNATURES);
  }

  if (documentFormat === 'ole') {
    return startsWithSignature(bytes, OLE_SIGNATURE);
  }

  return false;
}

function decodePdfWindow(bytes: Uint8Array) {
  const head = bytes.slice(0, Math.min(bytes.length, PDF_TOKEN_WINDOW_BYTES));
  const tail = bytes.slice(Math.max(0, bytes.length - PDF_TOKEN_WINDOW_BYTES));
  const decoder = new TextDecoder('latin1');
  return {
    head: decoder.decode(head),
    tail: decoder.decode(tail),
    text: decoder.decode(bytes),
  };
}

function rejectInspection(details: string, inspectedAt: number, reason: StorageInspectionReason) {
  return {
    details,
    engine: 's3-intake-policy' as const,
    inspectedAt,
    reason,
    status: 'REJECTED' as const,
  };
}

function decodeBinaryText(bytes: Uint8Array) {
  return new TextDecoder('latin1').decode(bytes);
}

function containsToken(binaryText: string, token: string) {
  return binaryText.includes(token);
}

function readUInt16LE(bytes: Uint8Array, offset: number) {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUInt32LE(bytes: Uint8Array, offset: number) {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

function decodeZipFileName(bytes: Uint8Array) {
  return new TextDecoder('utf-8').decode(bytes);
}

function findEndOfCentralDirectory(bytes: Uint8Array) {
  const searchStart = Math.max(0, bytes.length - (ZIP_EOCD_MIN_BYTES + ZIP_EOCD_MAX_COMMENT_BYTES));

  for (let offset = bytes.length - ZIP_EOCD_MIN_BYTES; offset >= searchStart; offset -= 1) {
    if (readUInt32LE(bytes, offset) !== 0x06054b50) {
      continue;
    }

    const commentLength = readUInt16LE(bytes, offset + 20);
    if (offset + ZIP_EOCD_MIN_BYTES + commentLength === bytes.length) {
      return offset;
    }
  }

  throw new Error('End of central directory record not found.');
}

function parseZipEntries(bytes: Uint8Array): OoxmlArchiveEntry[] {
  const eocdOffset = findEndOfCentralDirectory(bytes);
  const diskNumber = readUInt16LE(bytes, eocdOffset + 4);
  const centralDirectoryDiskNumber = readUInt16LE(bytes, eocdOffset + 6);
  if (diskNumber !== 0 || centralDirectoryDiskNumber !== 0) {
    throw new Error('Multi-disk ZIP files are not supported.');
  }

  const entryCount = readUInt16LE(bytes, eocdOffset + 10);
  const centralDirectorySize = readUInt32LE(bytes, eocdOffset + 12);
  const centralDirectoryOffset = readUInt32LE(bytes, eocdOffset + 16);

  if (
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    throw new Error('ZIP64 archives are not supported.');
  }

  const entries: OoxmlArchiveEntry[] = [];
  let offset = centralDirectoryOffset;
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + ZIP_CENTRAL_DIRECTORY_HEADER_BYTES > centralDirectoryEnd) {
      throw new Error('Central directory is truncated.');
    }
    if (readUInt32LE(bytes, offset) !== 0x02014b50) {
      throw new Error('Invalid central directory header.');
    }

    const generalPurposeBitFlag = readUInt16LE(bytes, offset + 8);
    const compressionMethod = readUInt16LE(bytes, offset + 10);
    const compressedSize = readUInt32LE(bytes, offset + 20);
    const uncompressedSize = readUInt32LE(bytes, offset + 24);
    const fileNameLength = readUInt16LE(bytes, offset + 28);
    const extraFieldLength = readUInt16LE(bytes, offset + 30);
    const fileCommentLength = readUInt16LE(bytes, offset + 32);
    const localHeaderOffset = readUInt32LE(bytes, offset + 42);
    const fileNameStart = offset + ZIP_CENTRAL_DIRECTORY_HEADER_BYTES;
    const fileNameEnd = fileNameStart + fileNameLength;
    const fileName = decodeZipFileName(bytes.slice(fileNameStart, fileNameEnd));

    if (localHeaderOffset + ZIP_LOCAL_FILE_HEADER_BYTES > bytes.length) {
      throw new Error('Local file header is out of bounds.');
    }
    if (readUInt32LE(bytes, localHeaderOffset) !== 0x04034b50) {
      throw new Error('Invalid local file header.');
    }

    const localFileNameLength = readUInt16LE(bytes, localHeaderOffset + 26);
    const localExtraFieldLength = readUInt16LE(bytes, localHeaderOffset + 28);
    const dataOffset =
      localHeaderOffset + ZIP_LOCAL_FILE_HEADER_BYTES + localFileNameLength + localExtraFieldLength;
    const dataEnd = dataOffset + compressedSize;
    if (dataEnd > bytes.length) {
      throw new Error('Compressed file data is out of bounds.');
    }

    entries.push({
      compressedData: bytes.slice(dataOffset, dataEnd),
      compressedSize,
      compressionMethod,
      fileName,
      isEncrypted: (generalPurposeBitFlag & 0x1) !== 0,
      uncompressedSize,
    });

    offset = fileNameEnd + extraFieldLength + fileCommentLength;
  }

  return entries;
}

function hasDisallowedArchivePath(fileName: string) {
  const trimmedFileName = fileName.endsWith('/') ? fileName.slice(0, -1) : fileName;
  if (trimmedFileName.length === 0) {
    return true;
  }

  for (const character of trimmedFileName) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      return true;
    }

    if (character === '\\' || codePoint <= 0x1f) {
      return true;
    }
  }

  const segments = trimmedFileName.split('/');
  return segments.some((segment) => segment === '' || segment === '.' || segment === '..');
}

function isNestedArchiveEntry(fileName: string) {
  const normalizedFileName = fileName.toLowerCase();
  return NESTED_ARCHIVE_EXTENSIONS.some((extension) => normalizedFileName.endsWith(extension));
}

function hasSuspiciousCompressionRatio(entry: OoxmlArchiveEntry) {
  if (entry.compressedSize <= 0) {
    return entry.uncompressedSize > 0;
  }

  return entry.uncompressedSize / entry.compressedSize > ARCHIVE_MAX_COMPRESSION_RATIO;
}

function decodeZipEntryBytes(entry: OoxmlArchiveEntry, maxBytes: number) {
  if (entry.uncompressedSize > maxBytes) {
    throw new Error(`Archive entry exceeded the ${maxBytes} byte inspection limit.`);
  }

  if (entry.compressionMethod === 0) {
    return entry.compressedData;
  }

  if (entry.compressionMethod === 8) {
    const inflated = inflateSync(entry.compressedData);
    if (inflated.byteLength !== entry.uncompressedSize) {
      throw new Error('Archive entry size did not match the central directory.');
    }
    if (inflated.byteLength > maxBytes) {
      throw new Error(`Archive entry exceeded the ${maxBytes} byte inspection limit.`);
    }
    return inflated;
  }

  throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod}.`);
}

function parseXmlDocument(xmlBytes: Uint8Array) {
  try {
    return xmlParser.parse(new TextDecoder('utf-8').decode(xmlBytes));
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'XML parsing failed.');
  }
}

function collectTaggedObjects(node: unknown, tagName: string): Array<Record<string, unknown>> {
  const matches: Array<Record<string, unknown>> = [];

  function visit(candidate: unknown) {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }

    if (!candidate || typeof candidate !== 'object') {
      return;
    }

    const record = candidate as Record<string, unknown>;
    const tagged = record[tagName];
    if (Array.isArray(tagged)) {
      tagged.forEach((value) => {
        if (value && typeof value === 'object') {
          matches.push(value as Record<string, unknown>);
        }
      });
    } else if (tagged && typeof tagged === 'object') {
      matches.push(tagged as Record<string, unknown>);
    }

    Object.values(record).forEach(visit);
  }

  visit(node);
  return matches;
}

function collectContentTypes(node: unknown) {
  const contentTypes = new Set<string>();
  for (const tagged of [
    ...collectTaggedObjects(node, 'Default'),
    ...collectTaggedObjects(node, 'Override'),
  ]) {
    const value = tagged.ContentType;
    if (typeof value === 'string' && value.length > 0) {
      contentTypes.add(value.toLowerCase());
    }
  }
  return contentTypes;
}

function hasMacroEnabledContentType(contentTypes: Set<string>) {
  for (const contentType of contentTypes) {
    if (contentType.includes('macroenabled.12')) {
      return true;
    }
  }
  return false;
}

function findExternalRelationshipReason(node: unknown) {
  for (const relationship of collectTaggedObjects(node, 'Relationship')) {
    const targetMode = relationship.TargetMode;
    const target = relationship.Target;
    if (
      (typeof targetMode === 'string' && targetMode.toLowerCase() === 'external') ||
      (typeof target === 'string' && /^(https?:|file:|ftp:|mhtml:|mailto:)/iu.test(target))
    ) {
      return 'OOXML package contains an external relationship target.';
    }
  }

  return null;
}

function findEmbeddedRelationshipReason(node: unknown) {
  for (const relationship of collectTaggedObjects(node, 'Relationship')) {
    const type = relationship.Type;
    const target = relationship.Target;
    if (
      (typeof type === 'string' &&
        /activeX|attachedTemplate|control|oleObject|package/iu.test(type)) ||
      (typeof target === 'string' &&
        (target.includes('../embeddings/') ||
          target.includes('/embeddings/') ||
          target.includes('activeX') ||
          target.includes('oleObject')))
    ) {
      return 'OOXML package contains embedded or ActiveX content.';
    }
  }

  return null;
}

function isMacroEnabledByMetadata(mimeType: string, fileName: string, contentTypes: Set<string>) {
  return (
    OOXML_MACRO_EXTENSIONS.has(getFileExtension(fileName)) ||
    normalizeMimeType(mimeType).includes('macroenabled.12') ||
    hasMacroEnabledContentType(contentTypes)
  );
}

async function inspectOoxmlDocument(
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
  inspectedAt: number,
): Promise<StorageInspectionResult | null> {
  try {
    const entries = parseZipEntries(bytes);
    const entryNames = new Set<string>();
    const selectedEntries = new Map<string, OoxmlArchiveEntry>();
    let entryCount = 0;
    let totalUncompressedBytes = 0;
    let hasContentTypes = false;
    let hasRootRelationships = false;
    let hasDocumentRoot = false;
    let hasMacroBinary = false;

    for (const archiveEntry of entries) {
      entryCount += 1;
      if (entryCount > ARCHIVE_MAX_ENTRY_COUNT) {
        return rejectInspection(
          'Archive contains too many entries for safe inspection.',
          inspectedAt,
          'archive_suspicious_structure',
        );
      }

      if (archiveEntry.isEncrypted) {
        return rejectInspection(
          'Encrypted archive entries are not allowed.',
          inspectedAt,
          'archive_encrypted',
        );
      }

      if (hasDisallowedArchivePath(archiveEntry.fileName)) {
        return rejectInspection(
          'Archive contains a disallowed or unsafe entry path.',
          inspectedAt,
          'archive_suspicious_structure',
        );
      }

      const normalizedFileName = archiveEntry.fileName.toLowerCase();
      if (entryNames.has(normalizedFileName)) {
        return rejectInspection(
          'Archive contains duplicate entry names.',
          inspectedAt,
          'archive_suspicious_structure',
        );
      }
      entryNames.add(normalizedFileName);

      if (isNestedArchiveEntry(normalizedFileName)) {
        return rejectInspection(
          'Archive contains nested archives, which are not allowed.',
          inspectedAt,
          'archive_suspicious_structure',
        );
      }

      totalUncompressedBytes += archiveEntry.uncompressedSize;
      if (totalUncompressedBytes > ARCHIVE_MAX_TOTAL_UNCOMPRESSED_BYTES) {
        return rejectInspection(
          'Archive expands beyond the safe inspection limit.',
          inspectedAt,
          'archive_suspicious_structure',
        );
      }

      if (archiveEntry.uncompressedSize > ARCHIVE_MAX_ENTRY_BYTES) {
        return rejectInspection(
          'Archive contains an entry that is too large to inspect safely.',
          inspectedAt,
          'archive_suspicious_structure',
        );
      }

      if (hasSuspiciousCompressionRatio(archiveEntry)) {
        return rejectInspection(
          'Archive compression ratio is suspiciously high.',
          inspectedAt,
          'archive_suspicious_structure',
        );
      }

      if (OOXML_EMBEDDED_PATH_PATTERNS.some((pattern) => normalizedFileName.includes(pattern))) {
        return rejectInspection(
          'OOXML embedded or ActiveX content is not allowed.',
          inspectedAt,
          'ooxml_embedded_content',
        );
      }

      if (normalizedFileName.endsWith('vbaproject.bin')) {
        hasMacroBinary = true;
      }

      if (normalizedFileName === '[content_types].xml') {
        hasContentTypes = true;
        selectedEntries.set(normalizedFileName, archiveEntry);
      }

      if (normalizedFileName === '_rels/.rels') {
        hasRootRelationships = true;
        selectedEntries.set(normalizedFileName, archiveEntry);
      }

      if (
        normalizedFileName.startsWith('word/') ||
        normalizedFileName.startsWith('xl/') ||
        normalizedFileName.startsWith('ppt/')
      ) {
        hasDocumentRoot = true;
      }

      if (normalizedFileName.endsWith('.rels')) {
        selectedEntries.set(normalizedFileName, archiveEntry);
      }

      if (normalizedFileName === 'encryptioninfo' || normalizedFileName === 'encryptedpackage') {
        return rejectInspection(
          'Encrypted Office packages are not allowed.',
          inspectedAt,
          'archive_encrypted',
        );
      }
    }

    if (!hasContentTypes || !hasRootRelationships || !hasDocumentRoot) {
      return rejectInspection(
        'OOXML package is missing required package parts.',
        inspectedAt,
        'ooxml_malformed',
      );
    }

    const selectedEntryBytes = new Map<string, Uint8Array>();
    for (const [normalizedFileName, selected] of selectedEntries) {
      selectedEntryBytes.set(
        normalizedFileName,
        decodeZipEntryBytes(
          selected,
          Math.min(selected.uncompressedSize, OOXML_XML_ENTRY_MAX_BYTES),
        ),
      );
    }

    const contentTypesBytes = selectedEntryBytes.get('[content_types].xml');
    if (!contentTypesBytes) {
      return rejectInspection(
        'OOXML content types manifest could not be read.',
        inspectedAt,
        'ooxml_malformed',
      );
    }

    const contentTypes = collectContentTypes(parseXmlDocument(contentTypesBytes));
    if (hasMacroBinary || isMacroEnabledByMetadata(mimeType, fileName, contentTypes)) {
      return rejectInspection(
        'Macro-enabled Office documents are not allowed.',
        inspectedAt,
        'office_macro_enabled',
      );
    }

    for (const [entryName, entryBytes] of selectedEntryBytes) {
      if (!entryName.endsWith('.rels')) {
        continue;
      }

      const relationships = parseXmlDocument(entryBytes);
      const externalReason = findExternalRelationshipReason(relationships);
      if (externalReason) {
        return rejectInspection(externalReason, inspectedAt, 'ooxml_external_relationship');
      }

      const embeddedReason = findEmbeddedRelationshipReason(relationships);
      if (embeddedReason) {
        return rejectInspection(embeddedReason, inspectedAt, 'ooxml_embedded_content');
      }
    }

    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OOXML inspection failed.';
    return rejectInspection(
      `OOXML package is malformed or unsafe: ${message}`,
      inspectedAt,
      message.toLowerCase().includes('encrypt') ? 'archive_encrypted' : 'ooxml_malformed',
    );
  }
}

function inspectOleDocument(bytes: Uint8Array, inspectedAt: number): StorageInspectionResult {
  const binaryText = decodeBinaryText(bytes);

  if (
    containsToken(binaryText, 'EncryptedPackage') ||
    containsToken(binaryText, 'EncryptionInfo')
  ) {
    return rejectInspection(
      'Password-protected Office documents are not allowed.',
      inspectedAt,
      'office_password_protected',
    );
  }

  if (
    containsToken(binaryText, 'Macros') ||
    containsToken(binaryText, 'VBA') ||
    containsToken(binaryText, '_VBA_PROJECT') ||
    containsToken(binaryText, 'PROJECTwm')
  ) {
    return rejectInspection(
      'Macro-enabled Office documents are not allowed.',
      inspectedAt,
      'office_macro_enabled',
    );
  }

  return rejectInspection(
    'Legacy OLE compound Office documents are not supported.',
    inspectedAt,
    'unsupported_type',
  );
}

async function inspectDocumentStructure(
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
  inspectedAt: number,
): Promise<StorageInspectionResult | null> {
  const documentFormat = resolveDocumentFormat(mimeType, fileName);

  if (documentFormat === 'ooxml') {
    return await inspectOoxmlDocument(bytes, fileName, mimeType, inspectedAt);
  }

  if (documentFormat === 'ole') {
    return inspectOleDocument(bytes, inspectedAt);
  }

  return null;
}

function inspectPdfStructure(
  bytes: Uint8Array,
  inspectedAt: number,
): StorageInspectionResult | null {
  const { head, tail, text } = decodePdfWindow(bytes);

  if (!head.startsWith('%PDF-')) {
    return rejectInspection('PDF header is missing or malformed.', inspectedAt, 'pdf_malformed');
  }

  if (!tail.includes('%%EOF')) {
    return rejectInspection('PDF EOF marker is missing.', inspectedAt, 'pdf_malformed');
  }

  if (/\/Encrypt\b/u.test(text)) {
    return rejectInspection('Encrypted PDFs are not allowed.', inspectedAt, 'pdf_encrypted');
  }

  if (/\/EmbeddedFile\b|\/Filespec\b/u.test(text)) {
    return rejectInspection(
      'PDF embedded files are not allowed.',
      inspectedAt,
      'pdf_embedded_files',
    );
  }

  if (/\/JS\b|\/JavaScript\b/u.test(text)) {
    return rejectInspection('PDF JavaScript is not allowed.', inspectedAt, 'pdf_javascript');
  }

  if (/\/Launch\b/u.test(text)) {
    return rejectInspection(
      'PDF launch actions are not allowed.',
      inspectedAt,
      'pdf_launch_action',
    );
  }

  if (/\/OpenAction\b/u.test(text)) {
    return rejectInspection('PDF open actions are not allowed.', inspectedAt, 'pdf_open_action');
  }

  if (/\/XFA\b/u.test(text)) {
    return rejectInspection('PDF XFA forms are not allowed.', inspectedAt, 'pdf_xfa');
  }

  if (/\/RichMedia\b/u.test(text)) {
    return rejectInspection('PDF rich media is not allowed.', inspectedAt, 'pdf_rich_media');
  }

  if (/\/SubmitForm\b|\/ImportData\b|\/Sound\b|\/Movie\b/u.test(text)) {
    return rejectInspection(
      'PDF active content is not allowed.',
      inspectedAt,
      'pdf_active_content',
    );
  }

  return null;
}

async function computeSha256Hex(bytes: Uint8Array) {
  const digestInput = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest('SHA-256', digestInput);
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, '0')).join('');
}

export function resolveStorageInspectionPolicy(args: {
  defaultMaxBytes: number;
  sourceType: string;
}): StorageInspectionPolicy {
  if (args.sourceType === 'regulated_document_intake') {
    return {
      allowedDocumentFormats: ['csv', 'ooxml', 'plain_text'],
      allowedKinds: ['document', 'image', 'pdf'],
      intakeProfile: 'regulated_document',
      maxBytes: args.defaultMaxBytes,
    };
  }

  if (args.sourceType === 'security_control_evidence') {
    return {
      allowedDocumentFormats: ['csv', 'plain_text'],
      allowedKinds: ['document', 'image', 'pdf'],
      intakeProfile: 'standard',
      maxBytes: MAX_SECURITY_EVIDENCE_FILE_SIZE_BYTES,
    };
  }

  return {
    allowedDocumentFormats: ['csv', 'plain_text'],
    allowedKinds: ['document', 'image', 'pdf'],
    intakeProfile: 'standard',
    maxBytes: args.defaultMaxBytes,
  };
}

export async function inspectStorageUploadBytes(args: {
  allowedDocumentFormats?: AllowedDocumentFormat[];
  allowedKinds: AllowedFileKind[];
  bytes: Uint8Array;
  fileName: string;
  maxBytes: number;
  mimeType: string;
  sha256Hex?: string;
}): Promise<StorageInspectionResult> {
  const inspectedAt = Date.now();

  try {
    if (args.bytes.byteLength > args.maxBytes) {
      const sizeMB = (args.bytes.byteLength / (1024 * 1024)).toFixed(2);
      return rejectInspection(
        `File size (${sizeMB}MB) exceeds the maximum allowed size of ${(
          args.maxBytes /
          (1024 * 1024)
        ).toFixed(0)}MB.`,
        inspectedAt,
        'size_limit_exceeded',
      );
    }

    const knownKind = resolveKnownKind(args.mimeType, args.fileName);
    if (!knownKind || !args.allowedKinds.includes(knownKind)) {
      return {
        details: 'File type is not allowed for this workflow.',
        engine: 's3-intake-policy',
        inspectedAt,
        reason: 'unsupported_type',
        status: 'REJECTED',
      };
    }

    if (!signatureMatches(args.bytes.slice(0, 16), args.mimeType, args.fileName)) {
      return {
        details: 'File signature does not match the declared type.',
        engine: 's3-intake-policy',
        inspectedAt,
        reason: 'file_signature_mismatch',
        status: 'REJECTED',
      };
    }

    if (knownKind === 'document' && args.allowedDocumentFormats) {
      const documentFormat = resolveDocumentFormat(args.mimeType, args.fileName);
      if (!args.allowedDocumentFormats.includes(documentFormat as AllowedDocumentFormat)) {
        return {
          details: 'Document format is not allowed for this workflow.',
          engine: 's3-intake-policy',
          inspectedAt,
          reason: 'unsupported_type',
          status: 'REJECTED',
        };
      }
    }

    if (args.sha256Hex) {
      const uploadedSha256Hex = await computeSha256Hex(args.bytes);
      if (uploadedSha256Hex !== args.sha256Hex.trim().toLowerCase()) {
        return {
          details: 'Uploaded file checksum does not match the authorized upload.',
          engine: 's3-intake-policy',
          inspectedAt,
          reason: 'checksum_mismatch',
          status: 'REJECTED',
        };
      }
    }

    if (knownKind === 'pdf') {
      const pdfResult = inspectPdfStructure(args.bytes, inspectedAt);
      if (pdfResult) {
        return pdfResult;
      }
    }

    if (knownKind === 'document') {
      const documentResult = await inspectDocumentStructure(
        args.bytes,
        args.fileName,
        args.mimeType,
        inspectedAt,
      );
      if (documentResult) {
        return documentResult;
      }
    }

    return {
      engine: 's3-intake-policy',
      inspectedAt,
      status: 'PASSED',
    };
  } catch (error) {
    return {
      details: error instanceof Error ? error.message : 'Storage inspection failed.',
      engine: 's3-intake-policy',
      inspectedAt,
      reason: 'inspection_error',
      status: 'FAILED',
    };
  }
}
