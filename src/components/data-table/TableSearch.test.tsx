import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TableSearch } from '~/components/data-table/TableSearch';

describe('TableSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces trimmed search input', () => {
    const onSearch = vi.fn();
    render(<TableSearch onSearch={onSearch} />);

    fireEvent.change(screen.getByRole('textbox', { name: /search table/i }), {
      target: { value: '  ada  ' },
    });

    vi.advanceTimersByTime(299);
    expect(onSearch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onSearch).toHaveBeenCalledWith('ada');
  });

  it('submits immediately when the user presses enter', () => {
    const onSearch = vi.fn();
    render(<TableSearch initialValue="initial" onSearch={onSearch} />);

    fireEvent.change(screen.getByRole('textbox', { name: /search table/i }), {
      target: { value: '  grace  ' },
    });
    fireEvent.submit(screen.getByRole('textbox', { name: /search table/i }).closest('form')!);

    expect(onSearch).toHaveBeenCalledWith('grace');
    vi.runAllTimers();
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it('clears the current search value and notifies consumers', () => {
    const onSearch = vi.fn();
    render(<TableSearch initialValue="search term" onSearch={onSearch} />);

    fireEvent.click(screen.getByRole('button', { name: /clear search/i }));

    expect(screen.getByRole('textbox', { name: /search table/i })).toHaveValue('');
    expect(onSearch).toHaveBeenCalledWith('');
  });
});
