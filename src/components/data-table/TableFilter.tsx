import { Filter } from 'lucide-react';
import { useMemo } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { cn } from '~/lib/utils';

export interface TableFilterOption<TValue extends string> {
  label: string;
  value: TValue;
  description?: string;
}

export interface TableFilterProps<TValue extends string> {
  label?: string;
  placeholder?: string;
  value: TValue;
  options: TableFilterOption<TValue>[];
  onValueChange: (value: TValue) => void;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

export function TableFilter<TValue extends string>({
  label,
  placeholder = 'Filter',
  value,
  options,
  onValueChange,
  className,
  ariaLabel,
  disabled = false,
}: TableFilterProps<TValue>) {
  const activeOptionLabel = useMemo(() => {
    return options.find((option) => option.value === value)?.label ?? placeholder;
  }, [options, placeholder, value]);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="relative">
        <Filter
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Select
          value={value}
          onValueChange={(nextValue) => onValueChange(nextValue as TValue)}
          disabled={disabled}
        >
          <SelectTrigger className="pl-9" aria-label={ariaLabel ?? label ?? activeOptionLabel}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
