import { describe, expect, it } from 'vitest';
import { seo } from '~/lib/seo';

describe('seo', () => {
  it('returns the base metadata tags', () => {
    expect(
      seo({
        title: 'Dashboard',
        description: 'Admin overview',
        keywords: 'admin,dashboard',
      }),
    ).toEqual([
      { title: 'Dashboard' },
      { name: 'description', content: 'Admin overview' },
      { name: 'keywords', content: 'admin,dashboard' },
      { name: 'og:type', content: 'website' },
      { name: 'og:title', content: 'Dashboard' },
      { name: 'og:description', content: 'Admin overview' },
    ]);
  });

  it('adds social image tags when an image is provided', () => {
    expect(
      seo({
        title: 'Dashboard',
        image: 'https://example.com/preview.png',
      }),
    ).toContainEqual({
      name: 'og:image',
      content: 'https://example.com/preview.png',
    });
  });
});
