import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '~/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90 border-border',
        destructive:
          'border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
        outline: 'text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        info: 'border-transparent bg-[var(--info)] text-[var(--info-foreground)] [a&]:hover:bg-[var(--info)]/90',
        'light-purple':
          'border-transparent bg-[var(--highlight)] text-[var(--highlight-foreground)] [a&]:hover:bg-[var(--highlight)]/90',
        warning:
          'border-orange-200/70 bg-orange-50 text-orange-700 *:data-[slot=alert-description]:text-orange-700/90 dark:border-orange-500/40 dark:bg-orange-500/15 dark:text-orange-100 dark:*:data-[slot=alert-description]:text-orange-100/80',
        success:
          'border-emerald-200/70 bg-emerald-50 text-emerald-700 *:data-[slot=alert-description]:text-emerald-700/90 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-100 dark:*:data-[slot=alert-description]:text-emerald-100/80',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'span';

  return (
    <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
