import { api } from '@convex/_generated/api';
import { AutumnProvider } from 'autumn-js/react';
import { useConvex } from 'convex/react';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';

interface AutumnClientProviderProps {
  children: ReactNode;
}

interface AutumnBillingContextValue {
  ready: boolean;
}

const AutumnBillingContext = createContext<AutumnBillingContextValue>({ ready: false });

export function useAutumnBilling() {
  return useContext(AutumnBillingContext);
}

export function AutumnClientProvider({ children }: AutumnClientProviderProps) {
  const convex = useConvex();
  const [ready, setReady] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;

    async function checkAutumn() {
      try {
        const result = await convex.action(api.autumn.isAutumnReady, {});
        if (!cancelled) {
          setReady(Boolean(result?.configured));
        }
      } catch {
        if (!cancelled) {
          setReady(false);
        }
      }
    }

    void checkAutumn();

    return () => {
      cancelled = true;
    };
  }, [convex]);

  const contextValue = useMemo<AutumnBillingContextValue>(() => ({ ready }), [ready]);

  return (
    <AutumnProvider convex={convex} convexApi={(api as { autumn: typeof api.autumn }).autumn}>
      <AutumnBillingContext.Provider value={contextValue}>{children}</AutumnBillingContext.Provider>
    </AutumnProvider>
  );
}
