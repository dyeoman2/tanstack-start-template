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
      storageKey="theme"
    >
      {children}
    </NextThemesProvider>
  );
}
