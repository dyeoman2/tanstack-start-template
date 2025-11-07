export type InferenceMethod = 'direct' | 'gateway' | 'structured' | 'comparison';

export interface AIResult {
  response?: string;
  structuredData?: {
    title: string;
    summary: string;
    keyPoints: string[];
    category: string;
    difficulty: string;
  };
  usage?: Record<string, unknown>;
  error?: string;
  model?: string;
  provider?: string;
  finishReason?: string;
  // Gateway test results
  success?: boolean;
  status?: number;
  statusText?: string;
  gatewayUrl?: string | null;
  headers?: Record<string, string>;
  // Structured output parsing
  parseError?: string;
  rawText?: string;
  // Firecrawl results
  firecrawlMarkdown?: string;
  firecrawlJson?: string | object;
  firecrawlUrl?: string;
}
