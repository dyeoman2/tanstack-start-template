import { Loader2, Search, X } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Input } from '~/components/ui/input';
import { cn } from '~/lib/utils';

const DEBOUNCE_DELAY_MS = 300;

interface TableSearchProps {
  initialValue?: string;
  placeholder?: string;
  onSearch: (value: string) => void;
  isSearching?: boolean;
  className?: string;
  ariaLabel?: string;
}

export function TableSearch({
  initialValue = '',
  placeholder = 'Search…',
  onSearch,
  isSearching = false,
  className,
  ariaLabel = 'Search table',
}: TableSearchProps) {
  const [value, setValue] = useState(initialValue);
  const debounceTimeoutRef = useRef<number | null>(null);
  const lastSearchedValueRef = useRef(initialValue.trim());

  const clearDebouncedSearch = useCallback(() => {
    if (debounceTimeoutRef.current !== null) {
      window.clearTimeout(debounceTimeoutRef.current);
      debounceTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    setValue(initialValue);
    lastSearchedValueRef.current = initialValue.trim();
  }, [initialValue]);

  useEffect(() => {
    const trimmedValue = value.trim();

    if (trimmedValue === lastSearchedValueRef.current) {
      return;
    }

    debounceTimeoutRef.current = window.setTimeout(() => {
      lastSearchedValueRef.current = trimmedValue;
      onSearch(trimmedValue);
      debounceTimeoutRef.current = null;
    }, DEBOUNCE_DELAY_MS);

    return () => {
      clearDebouncedSearch();
    };
  }, [clearDebouncedSearch, onSearch, value]);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmedValue = value.trim();

      if (trimmedValue === lastSearchedValueRef.current) {
        clearDebouncedSearch();
        return;
      }

      clearDebouncedSearch();
      lastSearchedValueRef.current = trimmedValue;
      onSearch(trimmedValue);
    },
    [clearDebouncedSearch, onSearch, value],
  );

  const handleClear = useCallback(() => {
    if (value === '') {
      return;
    }
    clearDebouncedSearch();
    setValue('');
    lastSearchedValueRef.current = '';
    onSearch('');
  }, [clearDebouncedSearch, onSearch, value]);

  return (
    <form
      onSubmit={handleSubmit}
      className={cn('flex flex-col gap-2 sm:flex-row sm:items-center', className)}
    >
      <div className="relative flex-1">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
          <Search className="h-4 w-4" aria-hidden="true" />
        </span>
        <Input
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className={cn('pl-9', isSearching || value ? 'pr-12' : 'pr-4')}
          autoComplete="off"
          inputMode="search"
          aria-busy={isSearching || undefined}
        />
        {isSearching || value ? (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center gap-2 text-muted-foreground">
            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {value ? (
              <button
                type="button"
                onClick={handleClear}
                className="flex items-center hover:text-foreground focus-visible:outline-none pointer-events-auto"
              >
                <span className="sr-only">Clear search</span>
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
    </form>
  );
}
