import * as Sentry from '@sentry/tanstackstart-react';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { ErrorComponent, Link, rootRouteId, useMatch, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';

export function DefaultCatchBoundary({ error }: ErrorComponentProps) {
  const router = useRouter();
  const isRoot = useMatch({
    strict: false,
    select: (state) => state.id === rootRouteId,
  });

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  console.error('DefaultCatchBoundary Error:', error);

  return (
    <div className="min-w-0 flex-1 p-4 flex flex-col items-center justify-center gap-6">
      <ErrorComponent error={error} />
      <div className="flex gap-2 items-center flex-wrap">
        <button
          type="button"
          onClick={() => {
            router.invalidate();
          }}
          className={
            'px-2 py-1 bg-destructive text-destructive-foreground rounded uppercase font-extrabold'
          }
        >
          Try Again
        </button>
        {isRoot ? (
          <Link
            to="/"
            className={
              'px-2 py-1 bg-destructive text-destructive-foreground rounded uppercase font-extrabold'
            }
          >
            Home
          </Link>
        ) : (
          <Link
            to="/"
            className={
              'px-2 py-1 bg-destructive text-destructive-foreground rounded uppercase font-extrabold'
            }
            onClick={(e) => {
              e.preventDefault();
              window.history.back();
            }}
          >
            Go Back
          </Link>
        )}
      </div>
    </div>
  );
}
