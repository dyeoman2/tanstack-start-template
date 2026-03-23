import type { ReactNode } from 'react';

function renderInlineMarkdown(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const inlineRegex = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = inlineRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[2]) {
      parts.push(<strong key={match.index}>{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(
        <code key={match.index} className="rounded bg-muted px-1 text-xs">
          {match[3]}
        </code>,
      );
    } else if (match[4] && match[5]) {
      const isExternal = /^https?:\/\//.test(match[5]);
      if (isExternal) {
        parts.push(
          <a
            key={match.index}
            href={match[5]}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-2 hover:opacity-90"
          >
            {match[4]}
          </a>,
        );
      } else {
        parts.push(
          <span key={match.index} className="text-primary font-medium">
            {match[4]}
          </span>,
        );
      }
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';

  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] === '\\' && trimmed[index + 1] === '|') {
      current += '|';
      index += 1;
      continue;
    }
    if (trimmed[index] === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += trimmed[index];
  }

  cells.push(current.trim());
  return cells;
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) {
    return false;
  }
  const cells = splitTableRow(trimmed);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, '')));
}

function parseTable(lines: string[], startIndex: number) {
  const headerLine = lines[startIndex]?.trim() ?? '';
  const separatorLine = lines[startIndex + 1]?.trim() ?? '';
  if (!headerLine.startsWith('|') || !isTableSeparator(separatorLine)) {
    return null;
  }

  const headerRow = splitTableRow(headerLine);
  if (headerRow.length === 0) {
    return null;
  }

  const bodyRows: string[][] = [];
  let nextIndex = startIndex + 2;
  while (nextIndex < lines.length) {
    const row = lines[nextIndex]?.trim() ?? '';
    if (!row.startsWith('|') || isTableSeparator(row)) {
      break;
    }
    bodyRows.push(splitTableRow(row));
    nextIndex += 1;
  }

  return { bodyRows, headerRow, nextIndex };
}

function MarkdownContent(props: { allLines: string[] }) {
  const elements: ReactNode[] = [];
  let index = 0;
  let listBuffer: ReactNode[] = [];
  let listType: 'ul' | 'ol' | null = null;

  function flushList() {
    if (!listType || listBuffer.length === 0) {
      return;
    }
    const key = `list-${index}`;
    if (listType === 'ul') {
      elements.push(
        <ul key={key} className="my-2 list-disc space-y-1 pl-6">
          {listBuffer}
        </ul>,
      );
    } else {
      elements.push(
        <ol key={key} className="my-2 list-decimal space-y-1 pl-6">
          {listBuffer}
        </ol>,
      );
    }
    listBuffer = [];
    listType = null;
  }

  while (index < props.allLines.length) {
    const line = props.allLines[index] ?? '';
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      flushList();
      const codeLines: string[] = [];
      index += 1;
      while (index < props.allLines.length) {
        const codeLine = props.allLines[index] ?? '';
        if (codeLine.trim().startsWith('```')) {
          index += 1;
          break;
        }
        codeLines.push(codeLine);
        index += 1;
      }
      elements.push(
        <pre
          key={`code-${index}`}
          className="my-3 overflow-x-auto rounded-md bg-muted p-4 text-xs leading-relaxed"
        >
          <code className="font-mono whitespace-pre">{codeLines.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    if (trimmed === '') {
      flushList();
      index += 1;
      continue;
    }

    if (/^-{3,}$/.test(trimmed)) {
      flushList();
      elements.push(<hr key={`hr-${index}`} className="my-4 border-border" />);
      index += 1;
      continue;
    }

    const table = parseTable(props.allLines, index);
    if (table) {
      flushList();
      const columnCount = Math.max(
        table.headerRow.length,
        ...table.bodyRows.map((row) => row.length),
      );
      elements.push(
        <div key={`table-${index}`} className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                {Array.from({ length: columnCount }, (_, columnIndex) => (
                  <th key={columnIndex} className="px-3 py-2 text-left font-medium">
                    {renderInlineMarkdown(table.headerRow[columnIndex] ?? '')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.bodyRows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b">
                  {Array.from({ length: columnCount }, (_, columnIndex) => (
                    <td key={columnIndex} className="px-3 py-2 align-top">
                      {renderInlineMarkdown(row[columnIndex] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      index = table.nextIndex;
      continue;
    }

    if (trimmed.startsWith('# ')) {
      flushList();
      elements.push(
        <h1 key={`h1-${index}`} className="mt-6 mb-3 text-2xl font-bold first:mt-0">
          {renderInlineMarkdown(trimmed.slice(2).trim())}
        </h1>,
      );
      index += 1;
      continue;
    }
    if (trimmed.startsWith('## ')) {
      flushList();
      elements.push(
        <h2 key={`h2-${index}`} className="mt-5 mb-2 text-xl font-semibold">
          {renderInlineMarkdown(trimmed.slice(3).trim())}
        </h2>,
      );
      index += 1;
      continue;
    }
    if (trimmed.startsWith('### ')) {
      flushList();
      elements.push(
        <h3 key={`h3-${index}`} className="mt-4 mb-2 text-lg font-semibold">
          {renderInlineMarkdown(trimmed.slice(4).trim())}
        </h3>,
      );
      index += 1;
      continue;
    }

    if (trimmed.startsWith('> ')) {
      flushList();
      elements.push(
        <blockquote
          key={`blockquote-${index}`}
          className="my-3 border-l-4 border-border py-1 pl-4 italic text-muted-foreground"
        >
          {renderInlineMarkdown(trimmed.slice(2).trim())}
        </blockquote>,
      );
      index += 1;
      continue;
    }

    const unorderedListMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (unorderedListMatch?.[1]) {
      if (listType === 'ol') {
        flushList();
      }
      listType = 'ul';
      listBuffer.push(<li key={`li-${index}`}>{renderInlineMarkdown(unorderedListMatch[1])}</li>);
      index += 1;
      continue;
    }

    const orderedListMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (orderedListMatch?.[1]) {
      if (listType === 'ul') {
        flushList();
      }
      listType = 'ol';
      listBuffer.push(<li key={`li-${index}`}>{renderInlineMarkdown(orderedListMatch[1])}</li>);
      index += 1;
      continue;
    }

    flushList();
    elements.push(
      <p key={`p-${index}`} className="my-2">
        {renderInlineMarkdown(trimmed)}
      </p>,
    );
    index += 1;
  }

  flushList();
  return <>{elements}</>;
}

export function SecurityPolicyMarkdownRenderer(props: { bare?: boolean; content: string }) {
  return (
    <div
      className={
        props.bare
          ? 'prose prose-sm max-w-none dark:prose-invert'
          : 'prose prose-sm max-w-none rounded-lg border bg-card p-6 dark:prose-invert'
      }
    >
      <MarkdownContent allLines={props.content.split('\n')} />
    </div>
  );
}
