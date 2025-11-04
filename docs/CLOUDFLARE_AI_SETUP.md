# Cloudflare AI Setup Guide

This guide will help you set up Cloudflare Workers AI for the TanStack Start template, including both direct AI inference and AI Gateway monitoring.

## Prerequisites

- A Cloudflare account
- Workers AI enabled on your account
- API token with appropriate permissions

## Step 1: Enable Workers AI

1. Log in to your [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **AI > Workers AI**
3. If prompted, agree to the terms and enable Workers AI for your account

## Step 2: Create an API Token

1. Go to **My Profile > API Tokens** in your Cloudflare dashboard
2. Click **Create Token**
3. Choose **Create Custom Token**
4. Give it a name like "TanStack AI Token"
5. Add the following permissions:
   - **Account > Workers AI > Read**
   - **Account > AI Gateway > Read** (if using gateway)
   - **Account > Account Settings > Read** (to get account ID)
6. Click **Continue to summary** and create the token
7. **Important**: Copy and save the token - you won't be able to see it again!

## Step 3: Get Your Account ID

1. In your Cloudflare dashboard, go to **Workers** (or any page that shows your account)
2. Your Account ID is displayed in the URL or in the right sidebar
3. Copy this ID for the environment variables

## Step 4: Create an AI Gateway (Optional but Recommended)

AI Gateway provides monitoring, rate limiting, and analytics for your AI requests.

1. In your Cloudflare dashboard, go to **AI > AI Gateway**
2. Click **Create Gateway**
3. Give it a name like "tanstack-ai-gateway"
4. Choose your account and region
5. Click **Create**
6. Copy the Gateway ID from the gateway details page

## Environment Variables Setup

### Local Development (.env file)

Create or update your `.env` file in the project root:

```env
# Cloudflare AI Configuration
CLOUDFLARE_API_TOKEN=your_api_token_here
CLOUDFLARE_ACCOUNT_ID=your_account_id_here
CLOUDFLARE_GATEWAY_ID=your_gateway_id_here  # Optional
```

### Convex Deployment

Use the Convex CLI to set environment variables:

```bash
# Set required environment variables
convex env set CLOUDFLARE_API_TOKEN your_api_token_here --prod
convex env set CLOUDFLARE_ACCOUNT_ID your_account_id_here --prod

# Set optional gateway variable (if using AI Gateway)
convex env set CLOUDFLARE_GATEWAY_ID your_gateway_id_here --prod
```

Alternatively, you can set them via the Convex dashboard:

1. Go to your Convex dashboard
2. Select your project
3. Go to **Settings > Environment Variables**
4. Add the following variables:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_GATEWAY_ID` (optional)

### Netlify Deployment

Use the Netlify CLI to set environment variables:

```bash
# Set required environment variables
netlify env:set CLOUDFLARE_API_TOKEN your_api_token_here
netlify env:set CLOUDFLARE_ACCOUNT_ID your_account_id_here

# Set optional gateway variable (if using AI Gateway)
netlify env:set CLOUDFLARE_GATEWAY_ID your_gateway_id_here
```

Alternatively, you can set them via the Netlify dashboard:

1. Go to your Netlify dashboard
2. Select your site
3. Go to **Site settings > Environment variables**
4. Add the following variables:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_GATEWAY_ID` (optional)

## Testing Your Setup

1. Start your development server: `pnpm dev`
2. Navigate to `/app/ai-demo`
3. Try the **"Direct Workers AI"** option first - this should work immediately
4. If you set up a gateway, try the **"AI Gateway"** option
5. Use the **"Gateway Diagnostics"** tab to test your gateway connectivity

## Troubleshooting

### "Missing required Cloudflare AI environment variables"

- Check that all required environment variables are set in your `.env` file
- Restart your development server after adding env vars
- Verify the variable names match exactly (case-sensitive)

### Gateway requests not logging

- Verify your `CLOUDFLARE_GATEWAY_ID` is correct
- Check that the gateway exists in your Cloudflare dashboard
- Ensure your API token has AI Gateway permissions
- Check the server logs for detailed error messages

### API Token Issues

- Verify your token hasn't expired
- Check that it has the correct permissions:
  - Workers AI: Read
  - AI Gateway: Read (if using gateway)
- Try regenerating the token if issues persist


### Account ID Issues

- Double-check your Account ID in the Cloudflare dashboard
- Make sure you're using the correct account (if you have multiple)

## Available AI Models

The demo supports two modes:

### Direct Workers AI (No Gateway)
- **@cf/meta/llama-3.1-8b-instruct** - Meta's Llama 3.1 model
- **@cf/tiiuae/falcon-7b-instruct** - TII UAE's Falcon model

### AI Gateway (Cloudflare Workers AI)
- **@cf/meta/llama-3.1-8b-instruct** - Meta's Llama 3.1 model (via Gateway)
- **@cf/tiiuae/falcon-7b-instruct** - TII UAE's Falcon model (via Gateway)

You can modify the code to use other [available models](https://developers.cloudflare.com/workers-ai/models/) from Cloudflare Workers AI.

## Monitoring and Analytics

Once your gateway is set up, you can monitor your AI usage in the Cloudflare dashboard:

1. Go to **AI > AI Gateway**
2. Select your gateway
3. View request logs, analytics, and performance metrics

This helps you track costs, monitor usage patterns, and optimize your AI implementation.

## Security Best Practices

- Never commit API tokens to version control
- Use environment variables for all sensitive configuration
- Rotate API tokens regularly
- Use AI Gateway for production deployments to enable monitoring
- Set up rate limiting in your gateway configuration

## Need Help?

- [Cloudflare Workers AI Documentation](https://developers.cloudflare.com/workers-ai/)
- [AI Gateway Documentation](https://developers.cloudflare.com/ai-gateway/)
- [API Token Management](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
