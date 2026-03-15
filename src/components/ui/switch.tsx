import type * as React from 'react';

import { cn } from '~/lib/utils';

type SwitchProps = Omit<React.ComponentProps<'button'>, 'onChange'> & {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
};

function Switch({
  checked,
  className,
  disabled,
  onCheckedChange,
  onClick,
  type = 'button',
  ...props
}: SwitchProps) {
  return (
    <button
      type={type}
      role="switch"
      aria-checked={checked}
      data-slot="switch"
      data-state={checked ? 'checked' : 'unchecked'}
      className={cn(
        'peer inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-input dark:bg-input/80',
        className,
      )}
      disabled={disabled}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || disabled) {
          return;
        }
        onCheckedChange?.(!checked);
      }}
      {...props}
    >
      <span
        data-slot="switch-thumb"
        data-state={checked ? 'checked' : 'unchecked'}
        className={cn(
          'pointer-events-none block size-4 rounded-full bg-background ring-0 transition-transform',
          checked
            ? 'translate-x-[calc(100%-2px)] dark:bg-primary-foreground'
            : 'translate-x-0 dark:bg-foreground',
        )}
      />
    </button>
  );
}

export { Switch };
