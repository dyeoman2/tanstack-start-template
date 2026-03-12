import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createFileRoute } from '@tanstack/react-router';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
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

export const Route = createFileRoute('/api/parse-pdf')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const formData = await request.formData();
          const fileValue = formData.get('file');

          if (!fileValue || typeof fileValue === 'string') {
            return Response.json({ error: 'No file provided' }, { status: 400 });
          }

          const file = fileValue;

          if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
            return Response.json({ error: 'File must be a PDF' }, { status: 400 });
          }

          if (file.size > MAX_FILE_SIZE) {
            const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
            return Response.json(
              { error: `File size (${sizeMB}MB) exceeds the maximum allowed size of 10MB` },
              { status: 413 },
            );
          }

          if (typeof globalThis.DOMMatrix === 'undefined') {
            const { DOMMatrix, DOMPoint, DOMRect } = await import(
              /* @vite-ignore */ CANVAS_MODULE_NAME
            );
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

          const buffer = Buffer.from(await file.arrayBuffer());
          const parser = new PDFParse({ data: buffer });
          const textResult = await parser.getText();
          const imageResult = await parser.getImage({ imageThreshold: 50 });

          await parser.destroy();

          const images = imageResult.pages.flatMap(
            (page: {
              pageNumber: number;
              images: Array<{
                name: string;
                width: number;
                height: number;
                dataUrl: string;
              }>;
            }) =>
              page.images.map((image) => ({
              pageNumber: page.pageNumber,
              name: image.name,
              width: image.width,
              height: image.height,
              dataUrl: image.dataUrl,
            })),
          );

          return Response.json({
            success: true,
            name: file.name,
            content: textResult.text,
            pages: textResult.total,
            images,
          });
        } catch (error) {
          return Response.json(
            {
              success: false,
              error: error instanceof Error ? error.message : 'Failed to parse PDF',
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
