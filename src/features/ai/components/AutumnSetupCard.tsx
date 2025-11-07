import { BarChart3 } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';

export function AutumnSetupCard() {
  return (
    <Card className="mb-6 border-blue-200 bg-blue-50">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2 text-blue-800">
          <BarChart3 className="w-5 h-5" />
          <span>Autumn Setup Required</span>
        </CardTitle>
        <CardDescription className="text-blue-700">
          To enable Autumn billing for usage-based pricing and premium AI features, you need to set
          up the following environment variables.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-blue-800 space-y-3">
          <div className="space-y-2">
            <p className="font-semibold">Setup Steps:</p>
            <ol className="list-decimal list-inside space-y-3 ml-4">
              <li>
                Create an Autumn account at{' '}
                <button
                  type="button"
                  onClick={() => window.open('https://useautumn.com', '_blank')}
                  className="text-blue-600 hover:text-blue-800 underline font-medium"
                >
                  useautumn.com
                </button>
              </li>
              <li>Create a credit package: $5.00 (50 credits)</li>
              <li>Get your secret key and product ID from the Autumn dashboard</li>
              <li>
                Set AUTUMN_SECRET_KEY in Convex:
                <div className="bg-white p-2 rounded border font-mono text-xs space-y-1 mt-2 ml-4">
                  <div className="mb-1">Development:</div>
                  <div>npx convex env set AUTUMN_SECRET_KEY am_sk_your_secret_key</div>
                  <div className="mt-2 mb-1">Production:</div>
                  <div>npx convex env set AUTUMN_SECRET_KEY am_sk_your_secret_key --prod</div>
                </div>
              </li>
            </ol>
            <p className="text-xs text-blue-700 mt-2">
              <strong>Note:</strong> AUTUMN_SECRET_KEY must be set in Convex.
            </p>
          </div>
        </div>
        <div className="flex space-x-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open('/docs/AUTUMN_SETUP.md', '_blank')}
            className="text-blue-700 border-blue-300 hover:bg-blue-100"
          >
            📖 Setup Guide
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open('https://useautumn.com', '_blank')}
            className="text-blue-700 border-blue-300 hover:bg-blue-100"
          >
            🔗 Autumn Dashboard
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
