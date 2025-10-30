import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { format } from 'date-fns';
import { Button } from '~/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import { PaginationControls } from './PaginationControls';
import { SortIcon } from './SortIcon';

interface DataTableProps<
  TData,
  TColumnDef extends ColumnDef<TData, unknown> = ColumnDef<TData, unknown>,
> {
  data: TData[];
  columns: TColumnDef[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  searchParams: {
    page: number;
    pageSize: number;
    sortBy: string;
    sortOrder: 'asc' | 'desc';
  };
  isLoading: boolean;
  isFetching?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  emptyMessage?: string;
  loadingSkeleton?: React.ReactNode;
}

export function DataTable<
  TData,
  TColumnDef extends ColumnDef<TData, unknown> = ColumnDef<TData, unknown>,
>({
  data,
  columns,
  pagination,
  searchParams,
  isLoading,
  isFetching = false,
  onPageChange,
  onPageSizeChange,
  emptyMessage = 'No data found.',
  loadingSkeleton,
}: DataTableProps<TData, TColumnDef>) {
  const sortingState: SortingState = [
    { id: searchParams.sortBy, desc: searchParams.sortOrder === 'desc' },
  ];

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    pageCount: pagination?.totalPages || 0,
    state: {
      sorting: sortingState,
    },
  });

  if (isLoading && data.length === 0) {
    return (
      <div className="rounded-md border bg-card">
        {loadingSkeleton || (
          <div className="animate-pulse p-4">
            <div className="h-8 bg-muted rounded mb-4"></div>
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((num) => (
                <div key={`skeleton-${num}`} className="h-16 bg-muted rounded"></div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="relative rounded-md border bg-card overflow-hidden">
        <Table aria-busy={isFetching || undefined}>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="bg-muted/50">
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="font-semibold">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination Controls */}
      {pagination && data.length > 0 && (
        <PaginationControls
          pagination={pagination}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      )}
    </div>
  );
}

// Utility function to create sortable column headers
export function createSortableHeader<TColumnId extends string>(
  title: string,
  columnId: TColumnId,
  searchParams: { sortBy: string; sortOrder: 'asc' | 'desc' },
  onSortingChange: (columnId: TColumnId) => void,
) {
  return () => (
    <div className="w-full">
      <Button
        variant="ghost"
        onClick={() => onSortingChange(columnId)}
        className="h-auto p-0 font-medium justify-start w-full hover:bg-transparent"
      >
        <span className="flex items-center">
          {title}
          <SortIcon
            columnId={columnId}
            sortBy={searchParams.sortBy}
            sortOrder={searchParams.sortOrder}
          />
        </span>
      </Button>
    </div>
  );
}

// Utility function to format dates consistently
export function formatTableDate(date: Date | string | number) {
  return format(new Date(date), 'MMM d, yyyy');
}
