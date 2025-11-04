# Usage-Based Billing with Autumn

This guide walks through configuring the Autumn billing platform for the AI messaging experience in this TanStack Start project. Autumn enforces the 10-message free tier, tracks paid usage, and powers the upgrade flow surfaced in the `/app/ai-demo` route.

## Overview

- **Free tier enforcement**: Every authenticated user receives 10 complimentary AI messages.
- **Autumn metering**: Additional usage is tracked against the `ai_messages` feature through Autumn's API.
- **Upgrade workflow**: The AI demo route surfaces a call-to-action that launches the Autumn checkout dialog when a customer runs out of free credits.
- **Real-time status**: The UI shows current usage, remaining credits, and billing status directly from Convex actions.

## 1. Create an Autumn Account and Product

1. Sign up at [useautumn.com](https://useautumn.com) and open the dashboard.
2. Create a product (for example `AI Unlimited`) that unlocks the `ai_messages` feature. You can model this as a subscription or usage plan depending on how you want to bill.
3. Make note of the product's **Product ID** (e.g. `prod_ai_unlimited`)—you will use it on the client to launch checkout.
4. Locate your **Secret Key** (`am_sk_...`) from the dashboard. This key is required on the server for metering and access checks.

> The feature ID `ai_messages` is already referenced throughout the Convex actions. Align the feature or usage identifier in Autumn with this name for consistency.

## 2. Configure Environment Variables (Local)

### Convex (server)

```bash
# Set the Autumn secret key for local Convex usage
npx convex env set AUTUMN_SECRET_KEY am_sk_your_secret_key_here
```

### Client (`.env.local`)

```bash
# Used by the upgrade CTA in /app/ai-demo
VITE_AUTUMN_AI_PRODUCT_ID=prod_ai_unlimited
```

Restart the dev server after updating environment variables so that both Convex and Vite pick up the changes.

## 3. Configure Environment Variables (Production)

### Convex Production Environment

```bash
npx convex env set AUTUMN_SECRET_KEY am_sk_your_secret_key_here --prod
```

### Netlify (or your hosting platform)

Set `VITE_AUTUMN_AI_PRODUCT_ID` in the deployment environment. For Netlify you can use either the UI or CLI:

```bash
npx netlify env:set VITE_AUTUMN_AI_PRODUCT_ID prod_ai_unlimited
```

Redeploy after the variables are in place.

## 4. Verify the Integration

1. Start the dev servers: `pnpm dev`.
2. Sign in and open `/app/ai-demo`.
3. Send a few prompts—usage should decrement from 10 towards 0.
4. After the free tier is exhausted, click **Upgrade with Autumn** to open the checkout dialog.
5. Complete a checkout (or close the dialog) and confirm the usage status indicator reflects the Autumn subscription.

## 5. Optional: Regenerate Convex Types

If you make adjustments to the Convex functions or upgrade to a new version of the template, regenerate Convex helper types:

```bash
npx convex codegen
```

> The template ships with generated stubs so it compiles offline, but running codegen ensures type information stays synchronized with the Autumn actions after you have network access.

## Troubleshooting

- **"Autumn billing is not configured" message**: Verify that `AUTUMN_SECRET_KEY` is set in Convex for the current environment.
- **Checkout dialog does not open**: Ensure `VITE_AUTUMN_AI_PRODUCT_ID` matches a product that is publishable in your Autumn dashboard.
- **Usage never resets from 0**: Confirm the `ai_messages` feature exists on the plan the customer purchased.
- **Convex build failures**: Run `npx convex codegen` after restoring network access so that generated API bindings include the new Autumn module.

With these steps in place, customers automatically receive 10 free AI messages, and Autumn handles upgrades, metering, and billing for additional usage.
