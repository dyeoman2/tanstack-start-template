import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const WORKER_PATH = join(
  process.cwd(),
  'node_modules',
  'pdf-parse',
  'dist',
  'worker',
  'pdf.worker.mjs',
);
const WORKER_URL = pathToFileURL(WORKER_PATH).href;
const CANVAS_MODULE_NAME = '@napi-rs/canvas';
const PDF_PARSE_MODULE_NAME = 'pdf-parse';

let isWorkerConfigured = false;

export type ParsedPdfImage = {
  dataUrl: string;
  height: number;
  name: string;
  pageNumber: number;
  width: number;
};

export type ParsedPdfResult = {
  content: string;
  images: ParsedPdfImage[];
  pages: number;
};

export async function parsePdfBlob(blob: Blob): Promise<ParsedPdfResult> {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    const { DOMMatrix, DOMPoint, DOMRect } = await import(/* @vite-ignore */ CANVAS_MODULE_NAME);
    const globalWithDom = globalThis as Record<string, unknown>;

    globalWithDom.DOMMatrix = DOMMatrix;
    globalWithDom.DOMPoint = DOMPoint;
    globalWithDom.DOMRect = DOMRect;
  }

  const { PDFParse } = await import(/* @vite-ignore */ PDF_PARSE_MODULE_NAME);
  if (!isWorkerConfigured) {
    PDFParse.setWorker(WORKER_URL);
    isWorkerConfigured = true;
  }

  const parser = new PDFParse({
    data: Buffer.from(await blob.arrayBuffer()),
  });

  try {
    const textResult = await parser.getText();
    const imageResult = await parser.getImage({ imageThreshold: 50 });

    return {
      content: textResult.text,
      images: imageResult.pages.flatMap(
        (page: {
          images: Array<{
            dataUrl: string;
            height: number;
            name: string;
            width: number;
          }>;
          pageNumber: number;
        }) =>
          page.images.map((image) => ({
            dataUrl: image.dataUrl,
            height: image.height,
            name: image.name,
            pageNumber: page.pageNumber,
            width: image.width,
          })),
      ),
      pages: textResult.total,
    };
  } finally {
    await parser.destroy();
  }
}
