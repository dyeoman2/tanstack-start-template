import { type ReactNode, useEffect, useState } from 'react';

/**
 * ClientOnly component prevents hydration mismatches by only rendering children on the client side.
 * Useful for components that might be affected by browser extensions or other client-side DOM manipulation.
 */
export function ClientOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  if (!hasMounted) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
