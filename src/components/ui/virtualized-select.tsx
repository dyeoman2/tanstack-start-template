// import { useVirtualizer } from '@tanstack/react-virtual';
// import { Check, ChevronsUpDown, CircleSlash, Search } from 'lucide-react';
// import * as React from 'react';
// import { cn } from '~/lib/utils';
// import { Button } from './button';
// import { Kbd, KbdGroup } from './kbd';
// import { Popover, PopoverContent, PopoverTrigger } from './popover';
// import { SimpleTooltip } from './simple-tooltip';

// export interface Option {
//   value: string;
//   label: string;
//   disabled?: boolean;
//   disabledReason?: string;
// }

// interface VirtualizedSelectProps {
//   options: Option[];
//   value?: string;
//   onValueChange?: (value: string) => void;
//   placeholder?: string;
//   searchPlaceholder?: string;
//   emptyMessage?: string;
//   className?: string;
// }

// export function VirtualizedSelect({
//   options,
//   value,
//   onValueChange,
//   placeholder = 'Select an option...',
//   searchPlaceholder = 'Search...',
//   emptyMessage = 'No option found.',
//   className,
// }: VirtualizedSelectProps) {
//   const [open, setOpen] = React.useState(false);
//   const [searchValue, setSearchValue] = React.useState('');
//   const [forceRender, setForceRender] = React.useState(0);
//   const [highlightedIndex, setHighlightedIndex] = React.useState(-1);
//   const parentRef = React.useRef<HTMLDivElement>(null);

//   const filteredOptions = React.useMemo(() => {
//     if (!options || options.length === 0) {
//       return [];
//     }

//     const search = searchValue.toLowerCase().trim();

//     if (!search) {
//       // Show all options by default; virtualization handles performance
//       return options;
//     }

//     return options.filter(
//       (option) =>
//         option.value.toLowerCase().includes(search) || option.label.toLowerCase().includes(search),
//     );
//   }, [options, searchValue]);

//   const rowVirtualizer = useVirtualizer({
//     count: filteredOptions.length,
//     getScrollElement: () => parentRef.current,
//     estimateSize: () => 35,
//     overscan: 10,
//   });

//   // Force re-render when popover opens to ensure virtualizer measures correctly
//   React.useEffect(() => {
//     if (open) {
//       setTimeout(() => {
//         setForceRender((prev) => prev + 1);
//         rowVirtualizer.measure();
//       }, 10);
//     }
//   }, [open, rowVirtualizer]);

//   // Reset highlighted index when options change
//   React.useEffect(() => {
//     setHighlightedIndex(-1);
//   }, []);

//   // Scroll highlighted item into view
//   React.useEffect(() => {
//     if (highlightedIndex >= 0 && parentRef.current) {
//       rowVirtualizer.scrollToIndex(highlightedIndex, { align: 'center' });
//     }
//   }, [highlightedIndex, rowVirtualizer]);

//   const selectedOption = options.find((option) => option.value === value);

//   // Handle click on option
//   const handleSelect = (optionValue: string) => {
//     onValueChange?.(optionValue);
//     setOpen(false);
//     setSearchValue('');
//     setHighlightedIndex(-1);
//   };

//   // Handle keyboard navigation
//   const handleKeyDown = (e: React.KeyboardEvent) => {
//     if (!open || filteredOptions.length === 0) return;

//     switch (e.key) {
//       case 'ArrowDown':
//         e.preventDefault();
//         setHighlightedIndex((prev) => {
//           let nextIndex = prev < filteredOptions.length - 1 ? prev + 1 : 0;
//           // Skip disabled options
//           while (nextIndex !== prev && filteredOptions[nextIndex]?.disabled) {
//             nextIndex = nextIndex < filteredOptions.length - 1 ? nextIndex + 1 : 0;
//           }
//           return nextIndex;
//         });
//         break;
//       case 'ArrowUp':
//         e.preventDefault();
//         setHighlightedIndex((prev) => {
//           let nextIndex = prev > 0 ? prev - 1 : filteredOptions.length - 1;
//           // Skip disabled options
//           while (nextIndex !== prev && filteredOptions[nextIndex]?.disabled) {
//             nextIndex = nextIndex > 0 ? nextIndex - 1 : filteredOptions.length - 1;
//           }
//           return nextIndex;
//         });
//         break;
//       case 'Enter':
//         e.preventDefault();
//         if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
//           const selectedOption = filteredOptions[highlightedIndex];
//           if (!selectedOption.disabled) {
//             handleSelect(selectedOption.value);
//           }
//         }
//         break;
//       case 'Escape':
//         e.preventDefault();
//         setOpen(false);
//         setSearchValue('');
//         setHighlightedIndex(-1);
//         break;
//     }
//   };

//   return (
//     <Popover open={open} onOpenChange={setOpen}>
//       <PopoverTrigger asChild>
//         <Button
//           variant="outline"
//           role="combobox"
//           aria-expanded={open}
//           className={cn('w-full justify-between font-normal', className)}
//         >
//           {selectedOption ? (
//             <span className="truncate">{selectedOption.label}</span>
//           ) : (
//             <span className="text-muted-foreground">{placeholder}</span>
//           )}
//           <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
//         </Button>
//       </PopoverTrigger>
//       <PopoverContent
//         className="w-(--radix-popover-trigger-width) p-0"
//         align="start"
//         onKeyDown={handleKeyDown}
//       >
//         <div className="flex items-center border-b px-3">
//           <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
//           <input
//             type="text"
//             placeholder={searchPlaceholder}
//             value={searchValue}
//             onChange={(e) => setSearchValue(e.target.value)}
//             className="flex h-10 w-full bg-card py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
//           />
//         </div>

//         {options.length === 0 ? (
//           <div className="py-6 text-center text-sm text-muted-foreground">Loading options...</div>
//         ) : filteredOptions.length === 0 ? (
//           <div className="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</div>
//         ) : (
//           <div
//             ref={parentRef}
//             className="h-[300px] overflow-y-auto overflow-x-hidden"
//             key={forceRender}
//             style={{
//               scrollBehavior: 'auto',
//               overscrollBehavior: 'contain',
//             }}
//             onWheel={(e) => {
//               // Ensure wheel events are handled properly
//               e.stopPropagation();
//             }}
//           >
//             <div
//               style={{
//                 height: rowVirtualizer.getTotalSize(),
//                 width: '100%',
//                 position: 'relative',
//               }}
//             >
//               {rowVirtualizer.getVirtualItems().map((virtualRow) => {
//                 const option = filteredOptions[virtualRow.index];
//                 const isSelected = value === option.value;

//                 const isHighlighted = highlightedIndex === virtualRow.index;

//                 return (
//                   <div
//                     key={virtualRow.key}
//                     style={{
//                       position: 'absolute',
//                       top: 0,
//                       left: 0,
//                       width: '100%',
//                       height: `${virtualRow.size}px`,
//                       transform: `translateY(${virtualRow.start}px)`,
//                     }}
//                   >
//                     <button
//                       className={cn(
//                         'relative flex w-full cursor-default select-none items-center px-2 py-1.5 text-sm outline-none transition-colors',
//                         option.disabled
//                           ? 'opacity-50 cursor-not-allowed'
//                           : 'hover:bg-accent hover:text-accent-foreground',
//                         !option.disabled && 'focus:bg-accent focus:text-accent-foreground',
//                         isSelected && 'bg-accent text-accent-foreground',
//                         isHighlighted && !option.disabled && 'bg-accent text-accent-foreground',
//                       )}
//                       onClick={() => !option.disabled && handleSelect(option.value)}
//                       type="button"
//                       disabled={option.disabled}
//                     >
//                       <div className="flex items-center justify-between w-full">
//                         <div className="flex items-center flex-1">
//                           <Check
//                             className={cn(
//                               'mr-2 h-4 w-4 shrink-0',
//                               isSelected && !option.disabled ? 'opacity-100' : 'opacity-0',
//                             )}
//                           />
//                           <span className="block truncate">{option.label}</span>
//                         </div>
//                         {option.disabled && (
//                           <SimpleTooltip
//                             content={option.disabledReason || 'This option is unavailable'}
//                           >
//                             <CircleSlash className="h-4 w-4 text-destructive shrink-0 ml-2" />
//                           </SimpleTooltip>
//                         )}
//                       </div>
//                     </button>
//                   </div>
//                 );
//               })}
//             </div>
//           </div>
//         )}

//         <div className="flex items-center justify-center border-t px-3 py-2 text-xs text-muted-foreground">
//           <KbdGroup>
//             <Kbd>↑</Kbd>
//             <Kbd>↓</Kbd>
//             <Kbd>Enter</Kbd>
//             <Kbd>Esc</Kbd>
//           </KbdGroup>
//         </div>
//       </PopoverContent>
//     </Popover>
//   );
// }
