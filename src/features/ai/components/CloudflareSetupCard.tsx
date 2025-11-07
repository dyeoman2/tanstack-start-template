import { Cloud } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';

export function CloudflareSetupCard() {
  return (
    <Card className="mb-6 border-amber-200 bg-amber-50">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2 text-amber-800">
          <Cloud className="w-5 h-5" />
          <span>Cloudflare AI Setup Required</span>
        </CardTitle>
        <CardDescription className="text-amber-700">
          To use Cloudflare AI features, you need to set up environment variables in Convex.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-amber-800 space-y-3">
          <div className="space-y-2">
            <p className="font-semibold">Setup Steps:</p>
            <ol className="list-decimal list-inside space-y-3 ml-4">
              <li>
                Create a Cloudflare account and enable Workers AI at{' '}
                <button
                  type="button"
                  onClick={() => window.open('https://dash.cloudflare.com', '_blank')}
                  className="text-amber-600 hover:text-amber-800 underline font-medium"
                >
                  dash.cloudflare.com
                </button>
              </li>
              <li>Generate an API token with Workers AI permissions</li>
              <li>Create an AI Gateway for monitoring (optional)</li>
              <li>
                Set environment variables in Convex:
                <div className="bg-white p-2 rounded border font-mono text-xs space-y-1 mt-2 ml-4">
                  <div className="font-semibold mb-1">Development:</div>
                  <div>npx convex env set CLOUDFLARE_API_TOKEN your_api_token</div>
                  <div>npx convex env set CLOUDFLARE_ACCOUNT_ID your_account_id</div>
                  <div>npx convex env set CLOUDFLARE_GATEWAY_ID your_gateway_id</div>
                  <div className="font-semibold mt-2 mb-1">Production:</div>
                  <div>npx convex env set CLOUDFLARE_API_TOKEN your_api_token --prod</div>
                  <div>npx convex env set CLOUDFLARE_ACCOUNT_ID your_account_id --prod</div>
                  <div>npx convex env set CLOUDFLARE_GATEWAY_ID your_gateway_id --prod</div>
                </div>
              </li>
              <li>Or use the Convex Dashboard: Settings → Environment Variables</li>
            </ol>
            <p className="text-xs text-amber-700 mt-2">
              <strong>Note:</strong> These variables must be set in Convex, not in your local `.env`
              file or Netlify.
            </p>
          </div>
        </div>
        <div className="flex space-x-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open('/docs/CLOUDFLARE_AI_SETUP.md', '_blank')}
            className="text-amber-700 border-amber-300 hover:bg-amber-100"
          >
            📖 Setup Guide
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open('https://dash.cloudflare.com', '_blank')}
            className="text-amber-700 border-amber-300 hover:bg-amber-100"
          >
            🔗 Cloudflare Dashboard
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
