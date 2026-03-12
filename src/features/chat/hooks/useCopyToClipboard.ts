import { useCallback, useEffect, useState } from 'react';

export function useCopyToClipboard(resetDelay = 1500) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = window.setTimeout(() => setCopied(false), resetDelay);
    return () => window.clearTimeout(timer);
  }, [copied, resetDelay]);

  const copy = useCallback(async (value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
  }, []);

  return { copy, copied };
}
