import { Globe } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';

export function FirecrawlSetupCard() {
  return (
    <Card className="mb-6 border-amber-200 bg-amber-50">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2 text-amber-800">
          <Globe className="w-5 h-5" />
          <span>Firecrawl Setup Required</span>
        </CardTitle>
        <CardDescription className="text-amber-700">
          To use Firecrawl, you need to set up environment variables in Convex.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-amber-800 space-y-3">
          <div className="space-y-2">
            <p className="font-semibold">Setup Steps:</p>
            <ol className="list-decimal list-inside space-y-3 ml-4">
              <li>
                Create a Firecrawl account at{' '}
                <button
                  type="button"
                  onClick={() => window.open('https://firecrawl.dev', '_blank')}
                  className="text-amber-600 hover:text-amber-800 underline font-medium"
                >
                  firecrawl.dev
                </button>
              </li>
              <li>Get your API key from the Firecrawl dashboard</li>
              <li>
                Set the environment variable in Convex:
                <div className="bg-white p-2 rounded border font-mono text-xs space-y-1 mt-2 ml-4">
                  <div className="mb-1">Development:</div>
                  <div>npx convex env set FIRECRAWL_API_KEY your_api_key_here</div>
                  <div className="mt-2 mb-1">Production:</div>
                  <div>npx convex env set FIRECRAWL_API_KEY your_api_key_here --prod</div>
                </div>
              </li>
              <li>Or use the Convex Dashboard: Settings → Environment Variables</li>
            </ol>
            <p className="text-xs text-amber-700 mt-2">
              <strong>Note:</strong> This variable must be set in Convex, not in your local `.env`
              file or Netlify.
            </p>
          </div>
        </div>
        <div className="flex space-x-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open('/docs/FIRECRAWL_SETUP.md', '_blank')}
            className="text-amber-700 border-amber-300 hover:bg-amber-100"
          >
            📖 Setup Guide
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open('https://firecrawl.dev', '_blank')}
            className="text-amber-700 border-amber-300 hover:bg-amber-100"
          >
            🔗 Firecrawl Dashboard
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
