import type { ParsedFile } from '~/features/chat/lib/file-parser';
import type { ChatAttachmentKind, ChatComposerPart } from '~/features/chat/types';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif'];
const SUPPORTED_DOCUMENT_MIME_TYPES = [
  'text/plain',
  'text/csv',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
const DOCUMENT_EXTENSIONS = ['.txt', '.csv', '.pdf', '.xlsx'];
const EXTENSION_TO_MIME_TYPE = new Map<string, string>([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.heic', 'image/heic'],
  ['.heif', 'image/heif'],
  ['.txt', 'text/plain'],
  ['.csv', 'text/csv'],
  ['.pdf', 'application/pdf'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
]);

export type UploadedImage = { image: string; mimeType: string; name?: string };
export type UploadedDocument = ParsedFile;

function isImageFile(file: File) {
  const fileName = file.name.toLowerCase();
  return file.type.startsWith('image/') || IMAGE_EXTENSIONS.some((ext) => fileName.endsWith(ext));
}

export function isDocumentFile(file: File) {
  const fileName = file.name.toLowerCase();
  const fileType = file.type.toLowerCase();

  return (
    SUPPORTED_DOCUMENT_MIME_TYPES.includes(fileType) ||
    DOCUMENT_EXTENSIONS.some((ext) => fileName.endsWith(ext))
  );
}

export function getChatAttachmentKind(file: File): ChatAttachmentKind | null {
  if (isImageFile(file)) {
    return 'image';
  }

  if (isDocumentFile(file)) {
    return 'document';
  }

  return null;
}

export function inferChatAttachmentMimeType(file: File) {
  const normalizedType = file.type.trim().toLowerCase();
  if (normalizedType) {
    return normalizedType;
  }

  const fileName = file.name.toLowerCase();
  const matchedEntry = [...EXTENSION_TO_MIME_TYPE.entries()].find(([extension]) =>
    fileName.endsWith(extension),
  );

  if (matchedEntry) {
    return matchedEntry[1];
  }

  return isImageFile(file) ? 'image/png' : 'application/octet-stream';
}

export function buildComposerParts(
  text: string,
  uploadedImages: UploadedImage[],
  uploadedDocuments: UploadedDocument[],
) {
  const parts: ChatComposerPart[] = [];

  if (text.trim()) {
    parts.push({ type: 'text', text });
  }

  uploadedImages.forEach((image) => {
    parts.push({
      type: 'image',
      image: image.image,
      mimeType: image.mimeType,
      name: image.name,
    });
  });

  uploadedDocuments.forEach((document) => {
    parts.push({
      type: 'document',
      name: document.name,
      content: document.content,
      mimeType: document.mimeType,
      images: document.images,
    });
  });

  return parts;
}
