import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import type { ComponentProps } from 'react';
import type { IconType } from 'react-icons';
import {
  SiBiome,
  SiNetlify,
  SiReact,
  SiResend,
  SiShadcnui,
  SiTailwindcss,
  SiTypescript,
  SiVite,
  SiZod,
} from 'react-icons/si';
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
};

const coreTechnologies: TechItem[] = [
  {
    name: 'TanStack Start',
    description: 'File-based routing, SSR, and progressive enhancement.',
    Icon: TanStackIcon,
    iconColor: '#f97316',
  },
  {
    name: 'Convex',
    description: 'Realtime database operations with zero client boilerplate.',
    Icon: ConvexIcon,
    iconColor: '#0f172a',
  },
  {
    name: 'Netlify',
    description: 'Serverless hosting and edge delivery tuned for TanStack Start.',
    Icon: SiNetlify,
    iconClassName: 'text-emerald-500',
  },
  {
    name: 'BetterAuth',
    description: 'Email-first authentication with session management baked in.',
    Icon: BetterAuthIcon,
    iconColor: '#be123c',
  },
  {
    name: 'Resend',
    description: 'Transactional emails for auth flows and lifecycle messaging.',
    Icon: SiResend,
    iconClassName: 'text-violet-600',
  },
  {
    name: 'Biome',
    description: 'Fast linting and formatting to keep the codebase consistent.',
    Icon: SiBiome,
    iconClassName: 'text-lime-600',
  },

  {
    name: 'React 19',
    description: 'Modern UI library powering server and client rendering.',
    Icon: SiReact,
    iconClassName: 'text-sky-400',
  },
  {
    name: 'Shadcn/UI',
    description: 'Accessible component primitives ready for rapid iteration.',
    Icon: SiShadcnui,
    iconClassName: 'text-slate-900',
  },
  {
    name: 'Tailwind',
    description: 'Utility-first styling with design tokens configured for the template.',
    Icon: SiTailwindcss,
    iconClassName: 'text-sky-500',
  },
  {
    name: 'TypeScript',
    description: 'Type-safe foundations from server to client with strict typing.',
    Icon: SiTypescript,
    iconClassName: 'text-blue-600',
  },
  {
    name: 'Vite',
    description: 'Lightning-fast dev server and build pipeline optimized for React.',
    Icon: SiVite,
    iconClassName: 'text-purple-600',
  },
  {
    name: 'Zod',
    description: 'Type-safe validation for data schemas.',
    Icon: SiZod,
    iconClassName: 'text-blue-500',
  },
];

export function MarketingHome() {
  return (
    <div className="flex flex-col gap-16 py-16">
      <section className="text-center space-y-6">
        <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
          Built with TanStack Start
        </span>
        <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
          Ship full-stack apps faster with best-in-class developer experience.
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
          TanStack Start Template pairs modern tooling, auth, and real-time data so you can focus on
          your product instead of plumbing. Server-first by default, progressively enhanced for the
          richest user experiences.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button asChild size="lg">
            <Link to="/register">
              Get Started
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link to="/app">Explore the Demo</Link>
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
            Best-of-breed platforms wired together so teams can ship quickly without compromising on
            reliability or developer experience.
          </p>
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {coreTechnologies.map((tech) => {
            const Icon = tech.Icon;
            return (
              <div
                key={tech.name}
                className="flex items-center gap-4 rounded-2xl border border-border/60 bg-background px-4 py-4 shadow-sm"
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
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
