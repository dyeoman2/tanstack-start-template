import { useSmoothText } from '@convex-dev/agent/react';

export function useSmoothStreamText(text: string, streaming: boolean) {
  const [visibleText] = useSmoothText(text, {
    startStreaming: streaming,
  });

  return streaming ? visibleText : text;
}
