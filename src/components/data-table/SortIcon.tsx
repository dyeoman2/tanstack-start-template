import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

interface SortIconProps {
  columnId: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

export function SortIcon({ columnId, sortBy, sortOrder }: SortIconProps) {
  if (sortBy !== columnId) {
    return <ArrowUpDown className="ml-1 h-3 w-3 text-muted-foreground opacity-60" />;
  }
  return sortOrder === 'asc' ? (
    <ArrowUp className="ml-1 h-3 w-3 text-muted-foreground" />
  ) : (
    <ArrowDown className="ml-1 h-3 w-3 text-muted-foreground" />
  );
}
