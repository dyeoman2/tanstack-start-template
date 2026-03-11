import { render, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ClientOnly } from '~/components/ClientOnly';

describe('ClientOnly', () => {
  it('renders the fallback during server rendering', () => {
    const html = renderToString(<ClientOnly fallback={<span>Loading</span>}>Ready</ClientOnly>);

    expect(html).toContain('Loading');
    expect(html).not.toContain('Ready');
  });

  it('supports a null fallback', async () => {
    render(<ClientOnly>Mounted content</ClientOnly>);

    await waitFor(() => {
      expect(screen.getByText('Mounted content')).toBeInTheDocument();
    });
  });
});
