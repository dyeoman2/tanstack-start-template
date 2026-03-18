import * as React from 'react';

// Minimal Slot shim to avoid requiring @radix-ui/react-slot
// Merges props onto a single React child element
type SlotProps = React.HTMLAttributes<HTMLElement> & { children: React.ReactElement };

export const Slot = React.forwardRef<HTMLElement, SlotProps>((props, _ref) => {
  const { children, ...rest } = props;
  const child = React.Children.only(children) as React.ReactElement;
  // Slot cloning needs loose prop merging because the child prop type is unknown here.
  const merged = { ...(rest as any), children: (child as any).props.children };
  // Clone the unknown child element with the merged props.
  return React.cloneElement(child as any, merged as any);
});

Slot.displayName = 'Slot';
