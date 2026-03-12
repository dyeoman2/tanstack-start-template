import type { ChatMessagePart } from '~/features/chat/types';
import type { ParsedFile } from '~/features/chat/lib/file-parser';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif'];
const SUPPORTED_DOCUMENT_MIME_TYPES = [
  'text/plain',
  'text/csv',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];
const DOCUMENT_EXTENSIONS = ['.txt', '.csv', '.pdf', '.xlsx', '.xls'];

export type UploadedImage = { image: string; mimeType: string; name?: string };
export type UploadedDocument = ParsedFile;

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target?.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function isImageFile(file: File) {
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

export function buildComposerParts(
  text: string,
  uploadedImages: UploadedImage[],
  uploadedDocuments: UploadedDocument[],
) {
  const parts: ChatMessagePart[] = [];

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
