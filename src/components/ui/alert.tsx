import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '~/lib/utils';

const alertVariants = cva(
  'relative w-full rounded-lg border px-4 py-3 text-sm grid has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] grid-cols-[0_1fr] has-[>svg]:gap-x-3 gap-y-0.5 items-start [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        success:
          'border-emerald-200/70 bg-emerald-50 text-emerald-700 *:data-[slot=alert-description]:text-emerald-700/90 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-100 dark:*:data-[slot=alert-description]:text-emerald-100/80',
        destructive:
          'border-rose-200/70 bg-rose-50 text-rose-700 *:data-[slot=alert-description]:text-rose-700/90 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-100 dark:*:data-[slot=alert-description]:text-rose-100/80',
        warning:
          'border-amber-200/70 bg-amber-50 text-amber-700 *:data-[slot=alert-description]:text-amber-700/90 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-100 dark:*:data-[slot=alert-description]:text-amber-100/80',
        info: 'border-sky-200/70 bg-sky-50 text-sky-700 *:data-[slot=alert-description]:text-sky-700/90 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-100 dark:*:data-[slot=alert-description]:text-sky-100/80',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn('col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight', className)}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'text-muted-foreground col-start-2 grid justify-items-start gap-1 text-sm [&_p]:leading-relaxed',
        className,
      )}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription };
