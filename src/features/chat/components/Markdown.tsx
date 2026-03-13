import { memo, useCallback, type HTMLAttributes } from 'react';
import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema, type Options as SanitizeOptions } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { Check, Copy } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';
import { useCopyToClipboard } from '~/features/chat/hooks/useCopyToClipboard';

const sanitizeSchema: SanitizeOptions = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    'math',
    'semantics',
    'mrow',
    'mi',
    'mo',
    'mn',
    'msup',
    'msub',
    'mfrac',
    'munder',
    'mover',
    'msqrt',
    'mroot',
    'mtable',
    'mtr',
    'mtd',
    'mtext',
    'mspace',
    'annotation',
    'span',
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] || []), 'className', 'class', 'style'],
    span: ['className', 'class', 'style', 'aria-hidden'],
    math: ['xmlns', 'display'],
    annotation: ['encoding'],
  },
};

const CODE_BLOCK_STYLE: React.CSSProperties = {
  margin: 0,
  padding: '1rem',
  borderRadius: '0.75rem',
  background: 'transparent',
};

const MARKDOWN_BLOCK_PATTERN =
  /(^|\n)(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|~~~|\|.+\||\[[^\]]+\]:\s)/m;

function normalizeParagraphBreaks(text: string) {
  if (!text.includes('\n') || text.includes('\n\n') || MARKDOWN_BLOCK_PATTERN.test(text)) {
    return text;
  }

  return text.replace(/\n+/g, '\n\n');
}

function CodeBlock({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
  const match = /language-(\w+)/.exec(className || '');
  const { resolvedTheme } = useTheme();
  const code = String(children).replace(/\n$/, '');
  const { copy, copied } = useCopyToClipboard();

  const handleCopy = useCallback(() => {
    void copy(code);
  }, [code, copy]);

  if (!match) {
    return (
      <code
        className={cn(
          'bg-muted/70 text-foreground/90 border-border/40 rounded-md border px-1.5 py-0.5 font-mono text-[0.875em] break-words',
          className,
        )}
        {...props}
      >
        {children}
      </code>
    );
  }

  return (
    <div className="border-border relative overflow-hidden rounded-xl border">
      <Button
        variant="secondary"
        size="icon-sm"
        className="absolute top-2 right-2 z-10"
        aria-label={copied ? 'Copied' : 'Copy'}
        onClick={handleCopy}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </Button>
      <SyntaxHighlighter
        style={resolvedTheme === 'dark' ? oneDark : oneLight}
        language={match[1]}
        PreTag="div"
        customStyle={CODE_BLOCK_STYLE}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

export const Markdown = memo(function Markdown({ children }: { children: string }) {
  const content = normalizeParagraphBreaks(children);
  const components: Components = {
    code: CodeBlock,
    p: ({ className, ...props }) => <p className={cn('mt-0 mb-6 leading-relaxed last:mb-0', className)} {...props} />,
  };

  return (
    <div
      className={cn(
        'prose dark:prose-invert max-w-full break-words',
        'prose-li:leading-relaxed',
        'prose-headings:tracking-tight prose-headings:font-medium',
        'prose-code:before:content-none prose-code:after:content-none',
        '[&_.katex]:text-[1em]',
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema], rehypeKatex]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
