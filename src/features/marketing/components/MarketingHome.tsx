import { Link } from '@tanstack/react-router';
import { ArrowRight, Monitor, Shield, Zap } from 'lucide-react';
import type { ComponentProps } from 'react';
import React from 'react';
import type { IconType } from 'react-icons';
import { SiGithub } from 'react-icons/si';
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';

type GenericIconProps = ComponentProps<'img'> & ComponentProps<'svg'>;

const TanStackIcon: React.FC<GenericIconProps> = ({ className }) => (
  <img src="/android-chrome-192x192.png" alt="TanStack" className={className} />
);

const ConvexIcon: React.FC<GenericIconProps> = ({ className }) => (
  <img src="/convex.png" alt="Convex" className={className} />
);

const BetterAuthIcon: React.FC<GenericIconProps> = ({ className }) => (
  <img src="/better-auth.png" alt="BetterAuth" className={className} />
);

type MarketingIcon = IconType | React.FC<{ className?: string; color?: string }>;

type TechItem = {
  name: string;
  description: string;
  Icon: MarketingIcon;
  iconColor?: string;
  iconClassName?: string;
  url: string;
};

// Create lazy-loaded icon components to avoid bundling issues
const createLazyIcon = (iconName: string) => {
  const LazyIcon = React.lazy(() =>
    import('react-icons/si').then((module) => ({
      default: module[iconName as keyof typeof module] as React.ComponentType<
        React.SVGProps<SVGSVGElement>
      >,
    })),
  );
  return LazyIcon;
};

const coreTechnologies: TechItem[] = [
  {
    name: 'TanStack Start',
    description: 'File-based routing, SSR, and progressive enhancement.',
    Icon: TanStackIcon,
    iconColor: '#f97316',
    url: 'https://tanstack.com/start',
  },
  {
    name: 'Convex',
    description: 'Realtime database operations with zero client boilerplate.',
    Icon: ConvexIcon,
    iconColor: '#0f172a',
    url: 'https://www.convex.dev/',
  },
  {
    name: 'Netlify',
    description: 'Serverless hosting and edge delivery tuned for TanStack Start.',
    Icon: createLazyIcon('SiNetlify'),
    iconClassName: 'text-emerald-500',
    url: 'https://www.netlify.com/',
  },
  {
    name: 'BetterAuth',
    description: 'Email-first authentication with session management baked in.',
    Icon: BetterAuthIcon,
    iconColor: '#be123c',
    url: 'https://www.better-auth.com/',
  },
  {
    name: 'Resend',
    description: 'Transactional emails for auth flows and lifecycle messaging.',
    Icon: createLazyIcon('SiResend'),
    iconClassName: 'text-slate-900',
    url: 'https://resend.com/',
  },
  {
    name: 'Biome',
    description: 'Fast linting and formatting to keep the codebase consistent.',
    Icon: createLazyIcon('SiBiome'),
    iconClassName: 'text-blue-600',
    url: 'https://biomejs.dev/',
  },
  {
    name: 'React 19',
    description: 'Modern UI library powering server and client rendering.',
    Icon: createLazyIcon('SiReact'),
    iconClassName: 'text-sky-400',
    url: 'https://react.dev/',
  },
  {
    name: 'Shadcn/UI',
    description: 'Accessible component primitives ready for rapid iteration.',
    Icon: createLazyIcon('SiShadcnui'),
    iconClassName: 'text-slate-900',
    url: 'https://ui.shadcn.com/',
  },
  {
    name: 'Tailwind',
    description: 'Utility-first styling with design tokens configured for the template.',
    Icon: createLazyIcon('SiTailwindcss'),
    iconClassName: 'text-sky-500',
    url: 'https://tailwindcss.com/',
  },
  {
    name: 'TypeScript',
    description: 'Type-safe foundations from server to client with strict typing.',
    Icon: createLazyIcon('SiTypescript'),
    iconClassName: 'text-blue-600',
    url: 'https://www.typescriptlang.org/',
  },
  {
    name: 'Vite',
    description: 'Lightning-fast dev server and build pipeline optimized for React.',
    Icon: createLazyIcon('SiVite'),
    iconClassName: 'text-purple-600',
    url: 'https://vitejs.dev/',
  },
  {
    name: 'Zod',
    description: 'Type-safe validation for data schemas.',
    Icon: createLazyIcon('SiZod'),
    iconClassName: 'text-blue-500',
    url: 'https://zod.dev/',
  },
];

export function MarketingHome() {
  return (
    <div className="flex flex-col gap-16 py-16">
      <section className="text-center space-y-6">
        <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
          Free Open Source Template
        </span>
        <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
          A production-ready starter template for TanStack Start
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
          TanStack Start Template is a free, open-source starter that pairs modern tooling, auth,
          and real-time data so you can focus on your product instead of plumbing. Server-first by
          default, progressively enhanced for the richest user experiences.
        </p>
        <p className="mx-auto max-w-2xl text-sm text-muted-foreground">
          Explore a fully functional demo with dashboard analytics, AI playground (streaming text
          generation, structured output, web scraping), admin user management, and profile
          settings—all showcasing real-time data updates and production-ready patterns.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button asChild size="lg">
            <Link to="/register" preload="intent" className="inline-flex items-center gap-2">
              Explore the Demo
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <a
              href="https://github.com/dyeoman2/tanstack-start-template"
              className="inline-flex items-center gap-2"
              target="_blank"
              rel="noopener noreferrer"
            >
              <SiGithub className="h-4 w-4" />
              View on GitHub
            </a>
          </Button>
        </div>
      </section>

      <section className="rounded-3xl border border-border bg-muted/40 p-10 shadow-sm">
        <div className="text-center space-y-3">
          <span className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Core Technology Stack
          </span>
          <h2 className="text-3xl font-semibold text-foreground sm:text-4xl">
            Pre-configured with a production-ready toolchain
          </h2>
          <p className="text-base text-muted-foreground">
            Best-of-breed platforms wired together in this free, open-source template so teams can
            ship quickly without compromising on reliability or developer experience.
          </p>
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {coreTechnologies.map((tech) => {
            const Icon = tech.Icon;
            return (
              <a
                key={tech.name}
                href={tech.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 rounded-2xl border border-border/60 bg-background px-4 py-4 shadow-sm transition-colors hover:bg-muted/50"
              >
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-full"
                  aria-hidden
                >
                  <Icon className={cn('h-6 w-6', tech.iconClassName)} color={tech.iconColor} />
                </div>
                <div className="space-y-1">
                  <p className="text-base font-semibold text-foreground">{tech.name}</p>
                  <p className="text-sm text-muted-foreground">{tech.description}</p>
                </div>
              </a>
            );
          })}
        </div>
      </section>

      <section className="rounded-3xl border border-border bg-linear-to-br from-primary/5 to-secondary/5 p-10 shadow-sm">
        <div className="text-center space-y-3 mb-10">
          <span className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Performance-First Architecture
          </span>
          <h2 className="text-3xl font-semibold text-foreground sm:text-4xl">
            Optimized for speed, security, and real-time experiences
          </h2>
          <p className="text-base text-muted-foreground">
            Built with modern web patterns that deliver exceptional performance while maintaining
            strict security boundaries.
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          <div className="space-y-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Zap className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-xl font-semibold text-foreground">SSG for Public Pages</h3>
            <p className="text-muted-foreground">
              Marketing and authentication routes render as static HTML for instant first paint and
              optimal SEO. No JavaScript required for initial page loads, with progressive
              enhancement for rich interactions.
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Monitor className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-xl font-semibold text-foreground">
              SPA Mode for Authenticated Pages
            </h3>
            <p className="text-muted-foreground">
              Application routes run as a single-page app with Convex real-time queries. Zero
              waterfalls, instant updates, and seamless navigation between protected areas of your
              application.
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Shield className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-xl font-semibold text-foreground">Universal RBAC Infrastructure</h3>
            <p className="text-muted-foreground">
              Role-based access control enforced on both client and server with minimal database
              hits. Single capability map drives all authorization, with automatic cache
              invalidation for real-time role updates.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
