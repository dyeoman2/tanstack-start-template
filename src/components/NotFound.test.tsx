import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NotFound } from '~/components/NotFound';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

describe('NotFound', () => {
  it('renders the default message and start-over link', () => {
    render(<NotFound />);

    expect(screen.getByText(/the page you are looking for does not exist/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /start over/i })).toHaveAttribute('href', '/');
  });

  it('renders custom children instead of the default message', () => {
    render(<NotFound>Custom empty state</NotFound>);

    expect(screen.getByText('Custom empty state')).toBeInTheDocument();
    expect(
      screen.queryByText(/the page you are looking for does not exist/i),
    ).not.toBeInTheDocument();
  });

  it('goes back when the go-back button is clicked', async () => {
    const user = userEvent.setup();
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);

    render(<NotFound />);

    await user.click(screen.getByRole('button', { name: /go back/i }));

    expect(backSpy).toHaveBeenCalledOnce();
  });
});
