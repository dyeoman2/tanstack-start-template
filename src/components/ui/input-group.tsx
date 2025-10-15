import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '~/lib/utils';
import { Input } from './input';

const inputGroupVariants = cva('', {
  variants: {
    variant: {
      default: '',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

interface InputGroupProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof inputGroupVariants> {}

const InputGroup = React.forwardRef<HTMLDivElement, InputGroupProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex w-full items-center overflow-hidden rounded-md border border-input bg-background text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
        className,
      )}
      {...props}
    />
  ),
);
InputGroup.displayName = 'InputGroup';

const InputGroupInput = React.forwardRef<
  React.ElementRef<typeof Input>,
  React.ComponentPropsWithoutRef<typeof Input>
>(({ className, ...props }, ref) => (
  <Input
    ref={ref}
    className={cn(
      'flex-1 rounded-none border-0 bg-card shadow-none focus-visible:ring-0 focus-visible:ring-offset-0',
      className,
    )}
    {...props}
  />
));
InputGroupInput.displayName = 'InputGroupInput';

const inputGroupAddonVariants = cva(
  'flex h-full items-center px-3 text-muted-foreground [&_svg]:size-4',
  {
    variants: {
      align: {
        default: '',
        'inline-end': 'ml-auto',
      },
    },
    defaultVariants: {
      align: 'default',
    },
  },
);

interface InputGroupAddonProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof inputGroupAddonVariants> {}

const InputGroupAddon = React.forwardRef<HTMLDivElement, InputGroupAddonProps>(
  ({ className, align, ...props }, ref) => (
    <div ref={ref} className={cn(inputGroupAddonVariants({ align, className }))} {...props} />
  ),
);
InputGroupAddon.displayName = 'InputGroupAddon';

const InputGroupIcon = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex h-full w-10 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  ),
);
InputGroupIcon.displayName = 'InputGroupIcon';

const InputGroupText = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex h-full select-none items-center px-3 text-sm text-muted-foreground',
        className,
      )}
      {...props}
    />
  ),
);
InputGroupText.displayName = 'InputGroupText';

export { InputGroup, InputGroupInput, InputGroupIcon, InputGroupText, InputGroupAddon };
