# Firecrawl Setup Guide

This guide will help you set up Firecrawl for web scraping and content extraction in the TanStack Start template.

## Overview

Firecrawl is a web scraping API that converts websites into clean markdown and structured JSON. The AI playground page includes a Firecrawl integration that allows users to extract content from any URL and view it in both markdown and JSON formats.

## Prerequisites

- A Firecrawl account
- An API key from Firecrawl

## Step 1: Create a Firecrawl Account

1. Go to [firecrawl.dev](https://firecrawl.dev)
2. Sign up for a free account
3. Navigate to your dashboard

## Step 2: Get Your API Key

1. In your Firecrawl dashboard, go to **API Keys** or **Settings**
2. Copy your API key (starts with `fc-` or similar)
3. **Important**: Keep this key secure - you'll need it for environment variables

## Step 3: Environment Variables Setup

Firecrawl runs in Convex, so the API key only needs to be set in your Convex environment variables.

**Important**: This variable must be set in Convex, not in your local `.env` file or Netlify. The Convex environment is separate and shared across all deployments.

### Development Environment

Set the environment variable for your development Convex deployment:

```bash
# Set the environment variable (development)
npx convex env set FIRECRAWL_API_KEY your_api_key_here
```

### Production Environment

Set the environment variable for your production Convex deployment:

```bash
# Set the environment variable (production)
npx convex env set FIRECRAWL_API_KEY your_api_key_here --prod
```

### Using the Convex Dashboard

Alternatively, you can set it via the Convex dashboard:

1. Go to your [Convex Dashboard](https://dashboard.convex.dev)
2. Select your project
3. Go to **Settings > Environment Variables**
4. Select the environment (Development or Production) from the dropdown
5. Add the following variable:
   - `FIRECRAWL_API_KEY`: Your Firecrawl API key
6. Click **Save** - Convex will automatically redeploy your functions

**Note**: Since Firecrawl runs in Convex, you don't need to set this variable in your local `.env` file or Netlify.

## Testing Your Setup

1. Start your development server: `pnpm dev`
2. Navigate to `/app/ai-playground`
3. Click on the **Firecrawl** tab
4. Enter a URL (defaults to `https://useautumn.com/`)
5. Click **Extract Content**
6. View the extracted markdown and JSON in the results section

## How It Works

The Firecrawl integration uses the `/v1/extract` endpoint to:

1. **Accept a URL** from the user input
2. **Call Firecrawl API** with the URL and request both markdown and JSON formats
3. **Display results** in separate tabs:
   - **Markdown tab**: Shows the extracted content as markdown
   - **JSON tab**: Shows the structured JSON data

## API Usage

The integration makes a POST request to `https://api.firecrawl.dev/v1/extract` with:

```json
{
  "urls": ["https://example.com"],
  "scrapeOptions": {
    "formats": ["markdown", "json"]
  }
}
```

## Troubleshooting

### "Firecrawl API key is not configured"

- Make sure you've set `FIRECRAWL_API_KEY` in your Convex environment variables
- **For development**: Use `npx convex env set FIRECRAWL_API_KEY your_api_key_here`
- **For production**: Use `npx convex env set FIRECRAWL_API_KEY your_api_key_here --prod`
- Or set it via the Convex Dashboard: **Settings > Environment Variables** (select the correct environment)
- Use `npx convex env ls` to list all environment variables and verify `FIRECRAWL_API_KEY` is present
- After setting, Convex will automatically redeploy - wait a few seconds and try again

### "Firecrawl API error: 401 Unauthorized"

- Verify your API key is correct
- Check that your Firecrawl account is active
- Ensure you haven't exceeded your API rate limits

### "Firecrawl API error: 429 Too Many Requests"

- You've exceeded your rate limit
- Check your Firecrawl dashboard for usage limits
- Consider upgrading your plan if needed

### "No data returned from Firecrawl"

- The URL might be inaccessible or blocked
- Check that the URL is publicly accessible
- Some websites may block scraping attempts
- Try a different URL to verify the integration is working

### Extraction fails for specific URLs

- Some websites have anti-scraping measures
- The website might require JavaScript rendering (Firecrawl handles this automatically)
- Check Firecrawl dashboard for any error logs
- Verify the URL is accessible from a browser

## Rate Limits

Firecrawl has rate limits based on your plan:

- **Free tier**: Limited requests per month
- **Paid plans**: Higher limits and additional features

Check your Firecrawl dashboard for current usage and limits.

## Security Best Practices

- Never commit API keys to version control
- Use environment variables for all sensitive configuration
- Rotate API keys regularly
- Monitor API usage in the Firecrawl dashboard
- Set up rate limiting if needed for production use

## Features

The Firecrawl integration provides:

- **Markdown extraction**: Clean, readable markdown from any webpage
- **JSON extraction**: Structured data extraction
- **Real-time results**: Results displayed immediately after extraction
- **Error handling**: Comprehensive error messages for troubleshooting
- **URL validation**: Client-side URL validation before API calls

## Customization

### Changing the Default URL

Edit the default URL in `src/routes/app/ai-playground.tsx`:

```typescript
const firecrawlForm = useForm({
  defaultValues: {
    url: 'https://your-default-url.com/',
  },
  // ...
});
```

### Modifying Extraction Options

Edit the Convex action in `convex/ai.ts`:

```typescript
body: JSON.stringify({
  urls: [args.url],
  scrapeOptions: {
    formats: ['markdown', 'json'],
    // Add additional options here
  },
}),
```

## Support

For issues with Firecrawl:

- Check the [Firecrawl Documentation](https://docs.firecrawl.dev)
- Review your Firecrawl dashboard for API status
- Check application logs for detailed error messages
- Verify network connectivity to Firecrawl API

## Need Help?

- [Firecrawl Documentation](https://docs.firecrawl.dev)
- [Firecrawl API Reference](https://docs.firecrawl.dev/api-reference)
- [Firecrawl Dashboard](https://firecrawl.dev)
