import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '~/lib/utils';

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
        outline:
          'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-primary/10 hover:text-primary dark:hover:bg-primary/20',
        'ghost-destructive':
          'hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20 disabled:hover:bg-transparent disabled:hover:text-muted-foreground',
        'ghost-warning':
          'text-orange-400 hover:bg-orange-100 hover:text-orange-400 dark:hover:bg-orange-900/20 dark:hover:text-orange-400 disabled:hover:bg-transparent disabled:hover:text-muted-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        info: 'bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-500/20',
        highlight:
          'bg-yellow-500 text-yellow-900 hover:bg-yellow-600 focus-visible:ring-yellow-500/20',
        warning: 'bg-orange-500 text-white hover:bg-orange-600 focus-visible:ring-orange-500/20',
        dangerOutline:
          'border border-red-500 text-red-500 hover:bg-red-500 hover:text-white focus-visible:ring-red-500/20',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
