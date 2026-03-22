import { AlertTriangle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getLoopbackAuthOriginMismatch } from '~/features/auth/lib/auth-origin-warning';
import { getBetterAuthRuntimeConfigServerFn } from '~/features/auth/server/runtime-config';

type MismatchState = ReturnType<typeof getLoopbackAuthOriginMismatch>;

export function DevAuthOriginWarning() {
  const [mismatch, setMismatch] = useState<MismatchState>(null);
  const hasLoggedRef = useRef(false);

  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') {
      return;
    }

    void getBetterAuthRuntimeConfigServerFn()
      .then(({ canonicalOrigin }) => {
        const nextMismatch = getLoopbackAuthOriginMismatch(window.location.origin, canonicalOrigin);
        setMismatch(nextMismatch);

        if (!nextMismatch || hasLoggedRef.current) {
          return;
        }

        hasLoggedRef.current = true;
        console.warn(
          `[auth] Better Auth origin mismatch: browser is on ${nextMismatch.browserOrigin}, but BETTER_AUTH_URL resolves to ${nextMismatch.canonicalOrigin}. Use the canonical origin in the browser and update \`npx convex env set BETTER_AUTH_URL ${nextMismatch.canonicalOrigin}\` if needed.`,
        );
      })
      .catch((error) => {
        if (!hasLoggedRef.current) {
          hasLoggedRef.current = true;
          console.warn('[auth] Unable to load Better Auth runtime config for origin check', error);
        }
      });
  }, []);

  if (!import.meta.env.DEV || !mismatch) {
    return null;
  }

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-950">
      <div className="mx-auto flex max-w-5xl items-center gap-2">
        <AlertTriangle className="size-4 shrink-0" />
        <p>
          Better Auth is configured for <code>{mismatch.canonicalOrigin}</code>, but this tab is
          using <code>{mismatch.browserOrigin}</code>. Use the configured origin for manual auth
          flows, and update{' '}
          <code>npx convex env set BETTER_AUTH_URL {mismatch.canonicalOrigin}</code> if the runtime
          env is wrong.
        </p>
      </div>
    </div>
  );
}
