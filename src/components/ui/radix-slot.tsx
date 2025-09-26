import * as React from 'react';

// Minimal Slot shim to avoid requiring @radix-ui/react-slot
// Merges props onto a single React child element
type SlotProps = React.HTMLAttributes<HTMLElement> & { children: React.ReactElement };

export const Slot = React.forwardRef<HTMLElement, SlotProps>((props, _ref) => {
  const { children, ...rest } = props;
  const child = React.Children.only(children) as React.ReactElement;
  // biome-ignore lint/suspicious/noExplicitAny: Slot shim requires cloning unknown props
  const merged = { ...(rest as any), children: (child as any).props.children };
  // biome-ignore lint/suspicious/noExplicitAny: Clone with unknown child prop types
  return React.cloneElement(child as any, merged as any);
});

Slot.displayName = 'Slot';
