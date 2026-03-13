export const brandTheme = {
  appName: 'Hackathon',
  email: {
    // Email-safe values manually aligned to the current light theme in src/styles/app.css.
    colors: {
      background: '#ffffff', // --background
      surface: '#ffffff', // --card
      surfaceMuted: '#f5f5f5', // --muted / --secondary / --accent
      surfaceStrong: '#18181b', // --foreground
      border: '#e4e4e7', // --border
      text: '#18181b', // --foreground
      textMuted: '#71717a', // --muted-foreground
      textSubtle: '#71717a', // --muted-foreground
      textQuiet: '#a1a1aa', // quieter footer tone from the same neutral family
      primary: '#2563eb', // --primary
      primaryForeground: '#ffffff', // --primary-foreground
      primaryMuted: '#dbeafe', // softer primary tint for supporting copy
      primarySubtle: '#bfdbfe', // stronger primary tint for accents
      danger: '#dc2626', // --destructive
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
