import { Check, ChevronsUpDown, Filter } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '~/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '~/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover';
import { cn } from '~/lib/utils';
import type { TableFilterOption } from '~/components/data-table/TableFilter';

export interface TableFilterComboboxProps<TValue extends string> {
  label?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  value: TValue;
  options: TableFilterOption<TValue>[];
  onValueChange: (value: TValue) => void;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

export function TableFilterCombobox<TValue extends string>({
  label,
  placeholder = 'Filter',
  searchPlaceholder = 'Search…',
  emptyMessage = 'No matches found.',
  value,
  options,
  onValueChange,
  className,
  ariaLabel,
  disabled = false,
}: TableFilterComboboxProps<TValue>) {
  const [open, setOpen] = useState(false);
  const activeOptionLabel = useMemo(() => {
    return options.find((option) => option.value === value)?.label ?? placeholder;
  }, [options, placeholder, value]);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-controls="table-filter-combobox-list"
            aria-expanded={open}
            aria-label={ariaLabel ?? label ?? activeOptionLabel}
            disabled={disabled}
            className="justify-between"
          >
            <div className="flex items-center gap-2 truncate">
              <Filter className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">{activeOptionLabel}</span>
            </div>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command>
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList>
              <CommandEmpty>{emptyMessage}</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.label}
                    onSelect={() => {
                      onValueChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        'size-4 shrink-0',
                        value === option.value ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    {option.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
