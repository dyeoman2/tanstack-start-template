import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { api } from '@convex/_generated/api';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';

const securityPolicyPdfRequestSchema = z.object({
  fileName: z.string().optional(),
  markdownContent: z.string().min(1, { message: 'Markdown content is required' }),
  sourcePath: z.string().min(1, { message: 'Source path is required' }),
  title: z.string().min(1, { message: 'Title is required' }),
});

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function sanitizeUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function renderInlineMarkdownToHtml(text: string): string {
  const parts: string[] = [];
  const inlineRegex =
    /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*([^*]+)\*|_([^_]+)_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = inlineRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(escapeHtml(text.slice(lastIndex, match.index)));
    }

    if (match[2]) {
      parts.push(`<strong>${escapeHtml(match[2])}</strong>`);
    } else if (match[3]) {
      parts.push(`<code>${escapeHtml(match[3])}</code>`);
    } else if (match[4] && match[5]) {
      const safeUrl = sanitizeUrl(match[5]);
      parts.push(
        safeUrl
          ? `<a href="${escapeHtml(safeUrl)}" rel="noopener noreferrer" target="_blank">${escapeHtml(match[4])}</a>`
          : escapeHtml(match[4]),
      );
    } else if (match[6]) {
      parts.push(`<em>${escapeHtml(match[6])}</em>`);
    } else if (match[7]) {
      parts.push(`<em>${escapeHtml(match[7])}</em>`);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(escapeHtml(text.slice(lastIndex)));
  }

  return parts.join('');
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let currentCell = '';

  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    const nextCharacter = trimmed[index + 1];

    if (character === '\\' && nextCharacter === '|') {
      currentCell += '|';
      index += 1;
      continue;
    }

    if (character === '|') {
      cells.push(currentCell.trim());
      currentCell = '';
      continue;
    }

    currentCell += character;
  }

  cells.push(currentCell.trim());
  return cells;
}

function isMarkdownTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) {
    return false;
  }

  const cells = splitMarkdownTableRow(trimmed);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')));
}

function parseMarkdownTableBlock(lines: string[], startIndex: number) {
  const headerLine = lines[startIndex]?.trim() ?? '';
  const separatorLine = lines[startIndex + 1]?.trim() ?? '';

  if (!headerLine.startsWith('|') || !isMarkdownTableSeparator(separatorLine)) {
    return null;
  }

  const headerRow = splitMarkdownTableRow(headerLine);
  if (headerRow.length === 0) {
    return null;
  }

  const bodyRows: string[][] = [];
  let nextIndex = startIndex + 2;

  while (nextIndex < lines.length) {
    const line = lines[nextIndex]?.trim() ?? '';
    if (!line.startsWith('|') || isMarkdownTableSeparator(line)) {
      break;
    }
    bodyRows.push(splitMarkdownTableRow(line));
    nextIndex += 1;
  }

  return { bodyRows, headerRow, nextIndex };
}

function renderMarkdownTableToHtml(table: { bodyRows: string[][]; headerRow: string[] }): string {
  const columnCount = Math.max(table.headerRow.length, ...table.bodyRows.map((row) => row.length));
  const headerHtml = Array.from(
    { length: columnCount },
    (_, index) => `<th>${renderInlineMarkdownToHtml(table.headerRow[index] ?? '')}</th>`,
  ).join('');
  const bodyHtml =
    table.bodyRows.length > 0
      ? table.bodyRows
          .map((row) => {
            const cells = Array.from(
              { length: columnCount },
              (_, index) => `<td>${renderInlineMarkdownToHtml(row[index] ?? '')}</td>`,
            ).join('');
            return `<tr>${cells}</tr>`;
          })
          .join('')
      : `<tr><td colspan="${columnCount}">No rows</td></tr>`;

  return `<div class="table-wrap"><table class="policy-table"><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
}

function renderMarkdownToHtml(markdownContent: string, title: string): string {
  const lines = markdownContent.split('\n');
  const htmlParts: string[] = [];
  let firstH1Handled = false;
  let inCodeBlock = false;
  let inOrderedList = false;
  let inUnorderedList = false;
  let listBuffer: string[] = [];

  function closeLists() {
    if (inUnorderedList) {
      htmlParts.push(`<ul>${listBuffer.join('')}</ul>`);
      inUnorderedList = false;
      listBuffer = [];
    }
    if (inOrderedList) {
      htmlParts.push(`<ol>${listBuffer.join('')}</ol>`);
      inOrderedList = false;
      listBuffer = [];
    }
  }

  let lineIndex = 0;
  while (lineIndex < lines.length) {
    const line = lines[lineIndex] ?? '';
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('```')) {
      closeLists();
      inCodeBlock = !inCodeBlock;
      htmlParts.push(inCodeBlock ? '<pre><code>' : '</code></pre>');
      lineIndex += 1;
      continue;
    }

    if (inCodeBlock) {
      htmlParts.push(`${escapeHtml(line)}\n`);
      lineIndex += 1;
      continue;
    }

    if (trimmedLine === '') {
      closeLists();
      lineIndex += 1;
      continue;
    }

    const table = parseMarkdownTableBlock(lines, lineIndex);
    if (table) {
      closeLists();
      htmlParts.push(renderMarkdownTableToHtml(table));
      lineIndex = table.nextIndex;
      continue;
    }

    if (trimmedLine.startsWith('# ')) {
      closeLists();
      const headingText = trimmedLine.slice(2).trim();
      if (!firstH1Handled) {
        firstH1Handled = true;
        if (headingText.toLowerCase() === title.trim().toLowerCase()) {
          lineIndex += 1;
          continue;
        }
      }
      htmlParts.push(`<h1>${renderInlineMarkdownToHtml(headingText)}</h1>`);
      lineIndex += 1;
      continue;
    }

    if (trimmedLine.startsWith('## ')) {
      closeLists();
      htmlParts.push(`<h2>${renderInlineMarkdownToHtml(trimmedLine.slice(3).trim())}</h2>`);
      lineIndex += 1;
      continue;
    }

    if (trimmedLine.startsWith('### ')) {
      closeLists();
      htmlParts.push(`<h3>${renderInlineMarkdownToHtml(trimmedLine.slice(4).trim())}</h3>`);
      lineIndex += 1;
      continue;
    }

    const unorderedMatch = trimmedLine.match(/^[-*]\s+(.+)$/);
    if (unorderedMatch?.[1]) {
      if (inOrderedList) {
        htmlParts.push(`<ol>${listBuffer.join('')}</ol>`);
        inOrderedList = false;
        listBuffer = [];
      }
      inUnorderedList = true;
      listBuffer.push(`<li>${renderInlineMarkdownToHtml(unorderedMatch[1])}</li>`);
      lineIndex += 1;
      continue;
    }

    const orderedMatch = trimmedLine.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch?.[1]) {
      if (inUnorderedList) {
        htmlParts.push(`<ul>${listBuffer.join('')}</ul>`);
        inUnorderedList = false;
        listBuffer = [];
      }
      inOrderedList = true;
      listBuffer.push(`<li>${renderInlineMarkdownToHtml(orderedMatch[1])}</li>`);
      lineIndex += 1;
      continue;
    }

    if (trimmedLine.startsWith('> ')) {
      closeLists();
      htmlParts.push(
        `<blockquote>${renderInlineMarkdownToHtml(trimmedLine.slice(2).trim())}</blockquote>`,
      );
      lineIndex += 1;
      continue;
    }

    if (/^-{3,}$/.test(trimmedLine)) {
      closeLists();
      htmlParts.push('<hr />');
      lineIndex += 1;
      continue;
    }

    closeLists();
    htmlParts.push(`<p>${renderInlineMarkdownToHtml(trimmedLine)}</p>`);
    lineIndex += 1;
  }

  closeLists();
  if (inCodeBlock) {
    htmlParts.push('</code></pre>');
  }

  return htmlParts.join('\n');
}

function getDocumentHtml({
  contentHash,
  markdownHtml,
  sourcePath,
  title,
}: {
  contentHash: string;
  markdownHtml: string;
  sourcePath: string;
  title: string;
}) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; }
      body {
        color: #111827;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 12px;
        line-height: 1.5;
        margin: 0;
        padding: 40px 44px 56px;
      }
      .document-title {
        font-size: 30px;
        font-weight: 800;
        line-height: 1.1;
        margin: 0 0 16px;
      }
      .meta {
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        color: #374151;
        display: grid;
        gap: 6px;
        margin: 0 0 24px;
        padding: 12px 14px;
      }
      .meta-label {
        color: #6b7280;
        font-weight: 600;
        margin-right: 6px;
      }
      .meta-value {
        font-family: "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace;
        font-size: 10px;
        word-break: break-all;
      }
      h1 { font-size: 26px; font-weight: 700; line-height: 1.2; margin: 24px 0 12px; }
      h2 { font-size: 20px; font-weight: 700; line-height: 1.3; margin: 22px 0 10px; padding-bottom: 4px; border-bottom: 1px solid #e5e7eb; }
      h3 { font-size: 16px; font-weight: 600; line-height: 1.4; margin: 18px 0 8px; }
      p { margin: 0 0 10px; }
      ul, ol { margin: 0 0 12px 22px; padding: 0; }
      li { margin: 2px 0; }
      blockquote { border-left: 3px solid #d1d5db; color: #374151; margin: 10px 0; padding: 4px 0 4px 10px; }
      pre {
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        margin: 10px 0 14px;
        overflow-x: auto;
        padding: 10px;
        white-space: pre-wrap;
        word-break: break-word;
      }
      code {
        background: #f3f4f6;
        border-radius: 4px;
        font-family: "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace;
        font-size: 11px;
        padding: 1px 4px;
      }
      pre code { background: transparent; padding: 0; }
      a { color: #2563eb; text-decoration: underline; word-break: break-all; }
      hr { border: none; border-top: 1px solid #d1d5db; margin: 14px 0; }
      .table-wrap { margin: 10px 0 14px; overflow: hidden; }
      .policy-table { border-collapse: collapse; font-size: 11px; table-layout: fixed; width: 100%; }
      .policy-table th, .policy-table td {
        border: 1px solid #d1d5db;
        padding: 6px;
        text-align: left;
        vertical-align: top;
        word-break: break-word;
      }
      .policy-table th { background: #f3f4f6; font-weight: 600; }
    </style>
  </head>
  <body>
    <h1 class="document-title">${escapeHtml(title)}</h1>
    <section class="meta">
      <div><span class="meta-label">Source:</span><span class="meta-value">${escapeHtml(sourcePath)}</span></div>
      <div><span class="meta-label">Content SHA-256:</span><span class="meta-value">${escapeHtml(contentHash)}</span></div>
      <div><span class="meta-label">Generated:</span><span class="meta-value">${escapeHtml(new Date().toISOString())}</span></div>
    </section>
    ${markdownHtml}
  </body>
</html>`;
}

function getDefaultPdfFileName(title: string): string {
  const sanitizedTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const date = new Date().toISOString().split('T')[0];
  return `${sanitizedTitle || 'policy-document'}-${date}.pdf`;
}

function sanitizePdfFileName(fileName: string): string {
  const cleanedName = fileName
    .replaceAll(/[/\\?%*:|"<>]/g, '-')
    .replaceAll(/\s+/g, '_')
    .trim();

  return cleanedName.toLowerCase().endsWith('.pdf') ? cleanedName : `${cleanedName}.pdf`;
}

export const Route = createFileRoute('/api/security-policy-pdf')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const currentProfile = await convexAuthReactStart.fetchAuthQuery(
          api.users.getCurrentUserProfile,
          {},
        );
        if (!currentProfile) {
          return new Response('Authentication required', { status: 401 });
        }
        if (currentProfile.isSiteAdmin !== true) {
          return new Response('Site admin access required', { status: 403 });
        }

        const parsed = securityPolicyPdfRequestSchema.safeParse(await request.json());
        if (!parsed.success) {
          return new Response(parsed.error.message, { status: 400 });
        }

        const { fileName, markdownContent, sourcePath, title } = parsed.data;
        const markdownHtml = renderMarkdownToHtml(markdownContent, title);
        const contentHash = createHash('sha256').update(markdownContent).digest('hex');
        const html = getDocumentHtml({
          contentHash,
          markdownHtml,
          sourcePath,
          title,
        });

        const browser = await chromium.launch({ headless: true });
        try {
          const page = await browser.newPage();
          await page.setContent(html, { waitUntil: 'load' });
          const pdf = await page.pdf({
            displayHeaderFooter: false,
            format: 'Letter',
            margin: {
              bottom: '0.6in',
              left: '0.5in',
              right: '0.5in',
              top: '0.6in',
            },
            printBackground: true,
          });

          return new Response(new Uint8Array(pdf), {
            headers: {
              'Content-Disposition': `attachment; filename="${sanitizePdfFileName(fileName ?? getDefaultPdfFileName(title))}"`,
              'Content-Type': 'application/pdf',
            },
          });
        } finally {
          await browser.close();
        }
      },
    },
  },
});
