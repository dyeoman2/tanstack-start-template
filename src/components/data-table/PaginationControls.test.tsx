import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PaginationControls } from '~/components/data-table/PaginationControls';

const basePagination = {
  page: 2,
  pageSize: 10,
  total: 35,
  totalPages: 4,
};

describe('PaginationControls', () => {
  it('renders the current range and page summary', () => {
    render(
      <PaginationControls
        pagination={basePagination}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
      />,
    );

    expect(screen.getByText(/showing 11 to 20 of 35 results/i)).toBeInTheDocument();
    expect(screen.getByText(/page 2 of 4/i)).toBeInTheDocument();
  });

  it('invokes page changes for navigation buttons', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();

    render(
      <PaginationControls
        pagination={basePagination}
        onPageChange={onPageChange}
        onPageSizeChange={() => undefined}
      />,
    );

    const buttons = screen.getAllByRole('button');
    await user.click(buttons[0]);
    await user.click(buttons[1]);
    await user.click(buttons[2]);
    await user.click(buttons[3]);

    expect(onPageChange).toHaveBeenNthCalledWith(1, 1);
    expect(onPageChange).toHaveBeenNthCalledWith(2, 1);
    expect(onPageChange).toHaveBeenNthCalledWith(3, 3);
    expect(onPageChange).toHaveBeenNthCalledWith(4, 4);
  });

  it('disables previous buttons on the first page and next buttons on the last page', () => {
    const { rerender } = render(
      <PaginationControls
        pagination={{ ...basePagination, page: 1 }}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
      />,
    );

    let buttons = screen.getAllByRole('button');
    expect(buttons[0]).toBeDisabled();
    expect(buttons[1]).toBeDisabled();

    rerender(
      <PaginationControls
        pagination={{ ...basePagination, page: 4 }}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
      />,
    );

    buttons = screen.getAllByRole('button');
    expect(buttons[2]).toBeDisabled();
    expect(buttons[3]).toBeDisabled();
  });
});
