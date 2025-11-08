import { Cpu, Globe, Loader2, Network, Shield } from 'lucide-react';
import { Badge } from '~/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import type { AiResultEntry } from '~/features/ai/hooks/useAiResponseStream';
import type { AIResult } from '~/features/ai/types';

interface AIResultsDisplayProps {
  entries: AiResultEntry[];
  resultTabs: Record<string, string>;
  onTabChange: (key: string, value: string) => void;
}

export function AIResultsDisplay({ entries, resultTabs, onTabChange }: AIResultsDisplayProps) {
  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">
          No results yet. Try generating some responses above.
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {entries.map(({ key, result, isLoading }) => (
        <Card key={key}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                {result.provider === 'cloudflare-workers-ai' && (
                  <Cpu className="w-5 h-5 text-blue-500" />
                )}
                {result.provider === 'cloudflare-gateway' && (
                  <Network className="w-5 h-5 text-green-500" />
                )}
                {result.provider === 'cloudflare-workers-ai-structured' && (
                  <Shield className="w-5 h-5 text-purple-500" />
                )}
                {result.provider === 'firecrawl' && <Globe className="w-5 h-5 text-orange-500" />}
                {key === 'gateway-test' && <Network className="w-5 h-5 text-orange-500" />}
                <CardTitle className="text-lg">
                  {key === 'gateway-test'
                    ? 'Gateway Connectivity Test'
                    : result.provider === 'cloudflare-gateway'
                      ? 'AI Gateway'
                      : result.provider === 'cloudflare-workers-ai-structured'
                        ? 'Structured Output'
                        : result.provider === 'firecrawl'
                          ? 'Firecrawl Extraction'
                          : 'Direct Workers AI'}
                </CardTitle>
              </div>
              <Badge variant={result.error ? 'destructive' : 'default'}>
                {isLoading ? 'Loading...' : result.error ? 'Error' : 'Complete'}
              </Badge>
            </div>
            {result.model && <CardDescription>Model: {result.model}</CardDescription>}
            {result.firecrawlUrl && (
              <CardDescription>
                URL:{' '}
                <a
                  href={result.firecrawlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  {result.firecrawlUrl}
                </a>
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {isLoading && !result.response && !result.firecrawlMarkdown && (
              <div className="flex items-center space-x-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>
                  {result.provider === 'firecrawl'
                    ? 'Extracting content...'
                    : 'Generating response...'}
                </span>
              </div>
            )}

            {result.error && (
              <div className="text-red-500 p-3 bg-red-50 rounded border">
                <strong>Error:</strong> {result.error}
              </div>
            )}

            {/* Firecrawl Results */}
            {result.provider === 'firecrawl' &&
              !result.error &&
              (result.firecrawlMarkdown || result.firecrawlJson) && (
                <FirecrawlResultTabs
                  result={result}
                  activeTab={resultTabs[key] || (result.firecrawlMarkdown ? 'markdown' : 'json')}
                  onTabChange={(value) => onTabChange(key, value)}
                />
              )}

            {/* AI Result Content with Tabs */}
            {(result.response || result.structuredData || result.parseError) &&
              !result.error &&
              result.provider !== 'firecrawl' &&
              key !== 'gateway-test' && (
                <AIResultTabs
                  result={result}
                  activeTab={resultTabs[key] || 'response'}
                  onTabChange={(value) => onTabChange(key, value)}
                />
              )}

            {/* Gateway Test Results */}
            {key === 'gateway-test' && (
              <GatewayTestTabs
                result={result}
                activeTab={resultTabs[key] || 'response'}
                onTabChange={(value) => onTabChange(key, value)}
              />
            )}
          </CardContent>
        </Card>
      ))}
    </>
  );
}

function FirecrawlResultTabs({
  result,
  activeTab,
  onTabChange,
}: {
  result: AIResult;
  activeTab: string;
  onTabChange: (value: string) => void;
}) {
  const hasMarkdown = !!result.firecrawlMarkdown;
  const hasJson = !!result.firecrawlJson;
  const totalTabs = (hasMarkdown ? 1 : 0) + (hasJson ? 1 : 0);
  const gridCols =
    totalTabs === 2 ? 'grid-cols-2' : totalTabs === 1 ? 'grid-cols-1' : 'grid-cols-1';

  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="w-full">
      <TabsList className={`grid w-full ${gridCols}`}>
        {hasMarkdown && <TabsTrigger value="markdown">Markdown</TabsTrigger>}
        {hasJson && <TabsTrigger value="json">JSON</TabsTrigger>}
      </TabsList>

      {hasMarkdown && (
        <TabsContent value="markdown" className="mt-4">
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Extracted Markdown</h4>
            <pre className="p-3 bg-slate-50 rounded text-xs overflow-x-auto whitespace-pre-wrap border max-h-96 overflow-y-auto">
              {result.firecrawlMarkdown}
            </pre>
          </div>
        </TabsContent>
      )}

      {hasJson && (
        <TabsContent value="json" className="mt-4">
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Extracted JSON</h4>
            <pre className="p-3 bg-slate-50 rounded text-xs overflow-x-auto whitespace-pre-wrap border max-h-96 overflow-y-auto">
              {typeof result.firecrawlJson === 'string'
                ? result.firecrawlJson
                : JSON.stringify(result.firecrawlJson, null, 2)}
            </pre>
          </div>
        </TabsContent>
      )}
    </Tabs>
  );
}

function AIResultTabs({
  result,
  activeTab,
  onTabChange,
}: {
  result: AIResult;
  activeTab: string;
  onTabChange: (value: string) => void;
}) {
  const hasJsonTab =
    result.provider === 'cloudflare-workers-ai-structured' && (result.rawText || result.response);
  const hasUsageTab = !!result.usage;
  const totalTabs = 1 + (hasJsonTab ? 1 : 0) + (hasUsageTab ? 1 : 0);
  const gridCols =
    totalTabs === 3 ? 'grid-cols-3' : totalTabs === 2 ? 'grid-cols-2' : 'grid-cols-1';

  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="w-full">
      <TabsList className={`grid w-full ${gridCols}`}>
        <TabsTrigger value="response">Response</TabsTrigger>
        {hasJsonTab && <TabsTrigger value="json">JSON</TabsTrigger>}
        {hasUsageTab && <TabsTrigger value="usage">Usage</TabsTrigger>}
      </TabsList>

      <TabsContent value="response" className="mt-4">
        {result.structuredData ? (
          <div className="space-y-3">
            <div className="p-4 bg-muted rounded">
              <h4 className="font-semibold mb-2">{result.structuredData.title}</h4>
              <p className="text-sm mb-3">{result.structuredData.summary}</p>

              <div className="space-y-2">
                <div className="flex gap-2">
                  <Badge variant="outline">{result.structuredData.category}</Badge>
                  <Badge variant="outline">{result.structuredData.difficulty}</Badge>
                </div>

                <div>
                  <h5 className="font-medium mb-1">Key Points:</h5>
                  <ul className="list-disc list-inside text-sm space-y-1">
                    {result.structuredData.keyPoints.map((point: string) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        ) : result.parseError ? (
          <div className="space-y-3">
            <div className="p-3 bg-red-50 border border-red-200 rounded">
              <div className="flex items-center space-x-2 mb-2">
                <span className="text-red-600 font-medium">JSON Parse Error:</span>
                <span className="text-red-500 text-sm">{result.parseError}</span>
              </div>
              <p className="text-sm text-red-700">
                The AI generated a response that couldn't be parsed as valid JSON. Check the JSON
                tab to see the raw response.
              </p>
            </div>
          </div>
        ) : result.response && result.provider === 'cloudflare-workers-ai-structured' ? (
          <div className="p-3 bg-muted rounded whitespace-pre-wrap">
            <div className="text-sm text-muted-foreground mb-2">Generating structured JSON...</div>
            {result.response}
          </div>
        ) : result.response ? (
          <div className="p-3 bg-muted rounded whitespace-pre-wrap">{result.response}</div>
        ) : null}
      </TabsContent>

      {hasJsonTab && (
        <TabsContent value="json" className="mt-4">
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Raw JSON Response</h4>
            <pre className="p-3 bg-slate-50 rounded text-xs overflow-x-auto whitespace-pre-wrap border">
              {result.rawText || result.response || 'No JSON data available'}
            </pre>
          </div>
        </TabsContent>
      )}

      {hasUsageTab && (
        <TabsContent value="usage" className="mt-4">
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Usage Statistics</h4>
            {result.usage ? (
              <div className="grid grid-cols-3 gap-4 p-3 bg-slate-50 rounded">
                <div className="text-center">
                  <div className="text-lg font-semibold text-blue-600">
                    {result.usage.inputTokens?.toLocaleString() || '0'}
                  </div>
                  <div className="text-xs text-muted-foreground">Input Tokens</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-green-600">
                    {result.usage.outputTokens?.toLocaleString() || '0'}
                  </div>
                  <div className="text-xs text-muted-foreground">Output Tokens</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-purple-600">
                    {result.usage.totalTokens?.toLocaleString() || '0'}
                  </div>
                  <div className="text-xs text-muted-foreground">Total Tokens</div>
                </div>
              </div>
            ) : (
              <div className="p-3 bg-slate-50 rounded text-center text-muted-foreground">
                No usage data available
              </div>
            )}
            {result.finishReason && (
              <div className="mt-2 p-2 bg-blue-50 rounded text-xs">
                <strong>Finish Reason:</strong> {result.finishReason}
              </div>
            )}
          </div>
        </TabsContent>
      )}
    </Tabs>
  );
}

function GatewayTestTabs({
  result,
  activeTab,
  onTabChange,
}: {
  result: AIResult;
  activeTab: string;
  onTabChange: (value: string) => void;
}) {
  const hasResponseTab = !!(result.response || result.error);
  const hasUsageTab = !!result.usage;
  const totalTabs = 1 + (hasResponseTab ? 1 : 0) + (hasUsageTab ? 1 : 0);
  const gridCols =
    totalTabs === 3 ? 'grid-cols-3' : totalTabs === 2 ? 'grid-cols-2' : 'grid-cols-1';

  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="w-full">
      <TabsList className={`grid w-full ${gridCols}`}>
        <TabsTrigger value="response">Connection Test</TabsTrigger>
        {hasResponseTab && <TabsTrigger value="json">Response</TabsTrigger>}
        {hasUsageTab && <TabsTrigger value="usage">Usage</TabsTrigger>}
      </TabsList>

      <TabsContent value="response" className="mt-4">
        <div className="space-y-3">
          {result.success ? (
            <div className="p-4 bg-green-50 border border-green-200 rounded">
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                <span className="font-semibold text-green-800">Gateway Connected Successfully</span>
              </div>
              <div className="mt-2 text-sm text-green-700">
                <p>
                  <strong>Status:</strong> {result.status} {result.statusText}
                </p>
                <p>
                  <strong>Gateway URL:</strong> {result.gatewayUrl}
                </p>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-red-50 border border-red-200 rounded">
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                <span className="font-semibold text-red-800">Gateway Connection Failed</span>
              </div>
              <div className="mt-2 text-sm text-red-700">
                <p>
                  <strong>Error:</strong> {result.error}
                </p>
                {result.gatewayUrl && (
                  <p>
                    <strong>Gateway URL:</strong> {result.gatewayUrl}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </TabsContent>

      {hasResponseTab && (
        <TabsContent value="json" className="mt-4">
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Raw Response</h4>
            <pre className="p-3 bg-slate-50 rounded text-xs overflow-x-auto whitespace-pre-wrap border">
              {result.response || result.error || 'No response data available'}
            </pre>
          </div>
        </TabsContent>
      )}

      {hasUsageTab && (
        <TabsContent value="usage" className="mt-4">
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Usage Statistics</h4>
            {result.usage ? (
              <div className="grid grid-cols-3 gap-4 p-3 bg-slate-50 rounded">
                <div className="text-center">
                  <div className="text-lg font-semibold text-blue-600">
                    {result.usage.inputTokens?.toLocaleString() || '0'}
                  </div>
                  <div className="text-xs text-muted-foreground">Input Tokens</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-green-600">
                    {result.usage.outputTokens?.toLocaleString() || '0'}
                  </div>
                  <div className="text-xs text-muted-foreground">Output Tokens</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-purple-600">
                    {result.usage.totalTokens?.toLocaleString() || '0'}
                  </div>
                  <div className="text-xs text-muted-foreground">Total Tokens</div>
                </div>
              </div>
            ) : (
              <div className="p-3 bg-slate-50 rounded text-center text-muted-foreground">
                No usage data available
              </div>
            )}
          </div>
        </TabsContent>
      )}
    </Tabs>
  );
}
