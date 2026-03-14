export const brandTheme = {
  appName: 'Hackathon',
  email: {
    // Email-safe values manually aligned to the current light theme in src/styles/app.css.
    colors: {
      background: '#ffffff',
      surface: '#ffffff',
      surfaceMuted: '#f5f5f5',
      surfaceStrong: '#18181b',
      border: '#e4e4e7',
      text: '#18181b',
      textMuted: '#71717a',
      textSubtle: '#71717a',
      textQuiet: '#a1a1aa',
      primary: '#2563eb',
      primaryForeground: '#ffffff',
      primaryMuted: '#dbeafe',
      primarySubtle: '#bfdbfe',
      danger: '#dc2626',
    },
    radius: {
      md: '10px',
      lg: '20px',
    },
    shadow: {
      card: '0 1px 2px rgba(24, 24, 27, 0.06)',
    },
  },
} as const;

export type BrandTheme = typeof brandTheme;
