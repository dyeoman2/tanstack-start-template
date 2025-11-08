# Credit-Based Billing with Autumn

This guide walks through configuring the Autumn billing platform for credit-based AI messaging in this TanStack Start project. Users purchase credits upfront ($0.10 per credit, minimum $5) and consume them as they use AI features after the free tier.

## Overview

- **Free tier**: First 10 messages are completely free
- **Credit pricing**: $0.10 per credit (1 credit = 1 message)
- **Minimum purchase**: $5.00 (50 credits) when free tier is exhausted
- **Autumn metering**: Paid usage is tracked against the `messages` feature through Autumn's API
- **Credit packages**: Multiple purchase options available

## 1. Create an Autumn Account and Credit Products

1. Sign up at [useautumn.com](https://useautumn.com) and open the dashboard.
2. Follow the steps below to create your first credit package ($5 for 50 credits)
3. Repeat the configuration for additional packages as needed
4. Locate your **Secret Key** (`am_sk_...`) from the dashboard

> The feature ID `messages` is referenced in the Convex actions for tracking usage.

## 2. Configure the $5 Credit Package in Autumn

Follow these steps to create the base credit package ($5 for 50 messages). You can repeat this process for larger packages.

## Step 1: Create a Plan

1. In Autumn dashboard, click "Add Plan" or navigate to the Plans section
2. Configure the plan details:

**Plan Details:**

- Name: `50 messages`
- ID: `prod_50_credits` (must match your environment variable)

**Base Price:**

- Enable "Base Price" (checkbox checked)
- Price: `5`
- Billing Interval: `one off`

## Step 2: Create a Feature

1. In the same plan creation flow, add a feature
2. Configure the feature details:

**Feature Details:**

- Name: `Messages`
- ID: `messages` (must match your code)

**Feature Type:**

- Select: **Metered** (usage-based tracking)

**Feature Behavior:**

- Select: **Consumable** (credits are used up as messages are sent)

## Step 3: Define Feature Limits

Configure how credits are allocated:

**Configuration:**

- Select: **Included** (credits are part of the plan purchase)

**Allowance:**

- Quantity: `50` (number of messages this customer gets)
- Interval: `no reset` (credits don't expire or refresh)

## Step 4: Finish Setup

**Additional Options:**

- Enable by Default: **Unchecked** (this is a paid plan, not free)
- Add On: **Unchecked** (standalone purchase)
- Group: **Unchecked** (not part of a plan group)
- Free Trial: **Unchecked** (no trial for credits)

Click "Save" or "Add Plan" to create the plan.

## Additional Credit Packages (Optional)

To offer more purchase options, repeat the above steps with these configurations:

- **$10 Package**: Name "100 messages", ID `prod_100_credits`, Price $10, Allowance 100
- **$25 Package**: Name "250 messages", ID `prod_250_credits`, Price $25, Allowance 250
- **$50 Package**: Name "500 messages", ID `prod_500_credits`, Price $50, Allowance 500

All packages should use:

- Feature ID: `messages` (same feature across all packages)
- Billing Interval: `one off`
- Allowance Interval: `no reset`
- Configuration: `Included`

## 3. Configure Environment Variables

### Development Environment

#### Convex (Server-Side)

Set the Autumn secret key for your development Convex deployment:

```bash
# Set the Autumn secret key (development)
npx convex env set AUTUMN_SECRET_KEY am_sk_your_secret_key_here
```

**Important**: This variable must be set in Convex, not in your local `.env` file.

#### Client-Side (`.env.local`)

Set the credit package product ID for local development:

```bash
# Credit package product ID (development)
VITE_AUTUMN_50_CREDITS_ID=prod_50_credits
```

Restart the dev server after updating environment variables so that both Convex and Vite pick up the changes.

### Production Environment

#### Convex (Server-Side)

Set the Autumn secret key for your production Convex deployment:

```bash
# Set the Autumn secret key (production)
npx convex env set AUTUMN_SECRET_KEY am_sk_your_secret_key_here --prod
```

**Important**: This variable must be set in Convex, not in Netlify.

#### Netlify (Client-Side)

Set the credit package product ID in your Netlify deployment environment:

```bash
# Credit package product ID (production)
npx netlify env:set VITE_AUTUMN_50_CREDITS_ID prod_50_credits
```

**Note**: `VITE_AUTUMN_50_CREDITS_ID` is a client-side variable (prefixed with `VITE_`), so it needs to be set in Netlify for production builds. The `AUTUMN_SECRET_KEY` is server-side and only needs to be in Convex.

### Using the Convex Dashboard

You can also set the Convex environment variable via the dashboard:

1. Go to your [Convex Dashboard](https://dashboard.convex.dev)
2. Select your project
3. Go to **Settings > Environment Variables**
4. Select the environment (Development or Production) from the dropdown
5. Add the variable:
   - `AUTUMN_SECRET_KEY`: Your Autumn secret key (`am_sk_...`)
6. Click **Save** - Convex will automatically redeploy your functions

## 5. Verify the Integration

1. Start the dev servers: `pnpm dev`
2. Sign in and open `/app/ai-playground`
3. Send up to 10 messages (free tier)
4. After free tier is exhausted, credit purchase options should appear
5. Complete a credit purchase and confirm usage continues

## 6. Optional: Regenerate Convex Types

If you make adjustments to the Convex functions or upgrade to a new version of the template, regenerate Convex helper types:

```bash
npx convex codegen
```

> The template ships with generated stubs so it compiles offline, but running codegen ensures type information stays synchronized with the Autumn actions after you have network access.

## Troubleshooting

- **"Autumn billing is not configured" message**: 
  - Verify that `AUTUMN_SECRET_KEY` is set in Convex (check both Development and Production environments if needed)
  - **For development**: Use `npx convex env set AUTUMN_SECRET_KEY am_sk_your_secret_key_here`
  - **For production**: Use `npx convex env set AUTUMN_SECRET_KEY am_sk_your_secret_key_here --prod`
  - Use `npx convex env ls` to list all environment variables and verify `AUTUMN_SECRET_KEY` is present
- **Checkout dialog does not open**: Ensure product IDs match your Autumn dashboard
- **Credits not added after purchase**: Check that the `messages` feature is properly configured

With these steps in place, customers get 10 free messages, then must purchase credits at $0.10 each (minimum $5) for continued usage.
