import * as Sentry from '@sentry/tanstackstart-react';
import { Button } from './ui/button';

export function SentryTestButton() {
  return (
    <Button
      type="button"
      variant="destructive"
      onClick={async () => {
        await Sentry.startSpan(
          {
            name: 'Example Frontend Span',
            op: 'test',
          },
          async () => {
            const res = await fetch('/api/sentry-example');
            if (!res.ok) {
              throw new Error('Sentry Example Frontend Error');
            }
          },
        );
      }}
    >
      Break the world (Test Sentry)
    </Button>
  );
}
