import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DataTable, createSortableHeader, formatTableDate } from '~/components/data-table/DataTable';

type Row = {
  id: string;
  name: string;
};

const columns = [
  {
    accessorKey: 'name',
    header: 'Name',
    cell: ({ row }: { row: { original: Row } }) => row.original.name,
  },
];

describe('DataTable', () => {
  it('renders the loading skeleton when there is no data yet', () => {
    const { container } = render(
      <DataTable
        data={[]}
        columns={columns}
        pagination={{ page: 1, pageSize: 10, total: 0, totalPages: 0 }}
        searchParams={{ page: 1, pageSize: 10, sortBy: 'name', sortOrder: 'asc' }}
        isLoading
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
      />,
    );

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders the empty message when there are no rows', () => {
    render(
      <DataTable
        data={[]}
        columns={columns}
        pagination={{ page: 1, pageSize: 10, total: 0, totalPages: 0 }}
        searchParams={{ page: 1, pageSize: 10, sortBy: 'name', sortOrder: 'asc' }}
        isLoading={false}
        emptyMessage="No matching users"
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
      />,
    );

    expect(screen.getByText('No matching users')).toBeInTheDocument();
  });

  it('renders rows and marks the table busy while fetching', () => {
    render(
      <DataTable
        data={[{ id: '1', name: 'Ada Lovelace' }]}
        columns={columns}
        pagination={{ page: 1, pageSize: 10, total: 1, totalPages: 1 }}
        searchParams={{ page: 1, pageSize: 10, sortBy: 'name', sortOrder: 'asc' }}
        isLoading={false}
        isFetching
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
      />,
    );

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
  });
});

describe('createSortableHeader', () => {
  it('renders the title and dispatches sorting changes', async () => {
    const user = userEvent.setup();
    const onSortingChange = vi.fn();
    const Header = createSortableHeader(
      'Email',
      'email',
      { sortBy: 'name', sortOrder: 'asc' },
      onSortingChange,
    );

    render(<Header />);

    await user.click(screen.getByRole('button', { name: /email/i }));

    expect(onSortingChange).toHaveBeenCalledWith('email');
  });
});

describe('formatTableDate', () => {
  it('formats dates consistently', () => {
    expect(formatTableDate(new Date(2026, 2, 11, 12, 0, 0))).toBe('Mar 11, 2026');
  });
});
