'use node';

import Firecrawl from '@mendable/firecrawl-js';
import { v } from 'convex/values';
import type { ActionCtx } from './_generated/server';
import { action } from './_generated/server';
import { authComponent } from './auth';

// Helper function to get the Firecrawl API key from environment
function getFirecrawlApiKey(): string {
  return process.env.FIRECRAWL_API_KEY ?? '';
}

// Helper to return graceful error response when Firecrawl is not configured
function getNotConfiguredError(url: string) {
  return {
    success: false as const,
    url,
    error:
      'Firecrawl API key is not configured. Please set FIRECRAWL_API_KEY in your Convex environment variables to use this feature. See docs/FIRECRAWL_SETUP.md for setup instructions.',
    markdown: null,
    json: null,
  };
}

export const isFirecrawlConfigured = action({
  args: {},
  handler: async (_ctx: ActionCtx) => {
    const apiKey = getFirecrawlApiKey();
    return {
      configured: apiKey.length > 0,
    };
  },
});

export const extractWithFirecrawl = action({
  args: {
    url: v.string(),
  },
  handler: async (ctx: ActionCtx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Authentication required');
    }

    const apiKey = getFirecrawlApiKey();

    if (!apiKey || apiKey.length === 0) {
      console.warn(
        '[Firecrawl] API key is not configured. Set FIRECRAWL_API_KEY in Convex environment variables to enable Firecrawl web scraping. See docs/FIRECRAWL_SETUP.md for setup instructions.',
      );
      return getNotConfiguredError(args.url);
    }

    try {
      // Initialize Firecrawl client
      const firecrawl = new Firecrawl({ apiKey });

      // Use the scrape method from the SDK
      // JSON format must be specified as an object with type, schema, etc.
      const result = await firecrawl.scrape(args.url, {
        formats: [
          'markdown',
          {
            type: 'json',
            schema: {},
          },
        ],
      });

      // The SDK's scrape method returns a Document directly
      if (!result) {
        throw new Error('No data returned from Firecrawl');
      }

      return {
        success: true as const,
        url: args.url,
        markdown: result.markdown || '',
        json: result.json || null,
      };
    } catch (error) {
      // Handle SDK errors gracefully
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to extract content from Firecrawl';

      // Check if it's a configuration error
      if (
        errorMessage.includes('API key') ||
        errorMessage.includes('authentication') ||
        errorMessage.includes('401')
      ) {
        console.warn(
          '[Firecrawl] API key may be invalid. Check FIRECRAWL_API_KEY in Convex environment variables.',
        );
        return getNotConfiguredError(args.url);
      }

      throw new Error(errorMessage);
    }
  },
});
