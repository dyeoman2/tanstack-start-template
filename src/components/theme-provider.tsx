import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from 'next-themes';

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      {...props}
      // Enable system theme detection
      enableSystem
      // Disable theme application during SSR to prevent hydration mismatches
      defaultTheme="system"
      // Use class attribute for better compatibility
      attribute="class"
      // Avoid documentElement.style mutations that violate our strict CSP.
      enableColorScheme={false}
      storageKey="theme"
    >
      {children}
    </NextThemesProvider>
  );
}
