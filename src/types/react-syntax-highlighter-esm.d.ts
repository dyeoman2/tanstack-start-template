declare module 'react-syntax-highlighter/dist/esm/prism.js' {
  import type { ComponentType, CSSProperties, ReactNode } from 'react';

  const SyntaxHighlighter: ComponentType<{
    children?: ReactNode;
    customStyle?: CSSProperties;
    language?: string;
    PreTag?: keyof import('react').JSX.IntrinsicElements | ComponentType<{ children?: ReactNode }>;
    style?: Record<string, CSSProperties>;
  }>;
  export default SyntaxHighlighter;
}

declare module 'react-syntax-highlighter/dist/esm/styles/prism/one-dark.js' {
  import type { CSSProperties } from 'react';

  const styles: Record<string, CSSProperties>;
  export default styles;
}

declare module 'react-syntax-highlighter/dist/esm/styles/prism/one-light.js' {
  import type { CSSProperties } from 'react';

  const styles: Record<string, CSSProperties>;
  export default styles;
}
