import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarketingHome } from '~/features/marketing/components/MarketingHome';
import { renderWithRouter } from '~/test/render-with-router';

describe('app router', () => {
  it('renders the marketing home route', async () => {
    renderWithRouter(<MarketingHome />, {
      additionalRoutes: [{ path: '/register' }],
    });

    expect(
      await screen.findByRole('heading', {
        name: /a production-ready ai chat starter for tanstack start/i,
      }),
    ).toBeInTheDocument();

    expect(screen.getByRole('link', { name: /explore the demo/i })).toHaveAttribute(
      'href',
      '/register',
    );
  });
});
