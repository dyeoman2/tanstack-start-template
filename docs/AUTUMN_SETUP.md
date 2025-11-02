# Autumn Pricing & Billing Setup

This document describes how to set up Autumn for pricing, subscriptions, and customer management in the TanStack Start application.

## Overview

The application integrates Autumn, a pricing and customer database abstraction over Stripe, enabling:

- **Flexible pricing models**: Subscriptions, usage-based billing, seats, trials, and credits
- **Customer management**: Automatic customer data synchronization with Better Auth
- **Feature gating**: Access control based on subscription status
- **Real-time billing**: Webhook handling and live billing events
- **Type-safe integration**: Full TypeScript support with Convex and React hooks

## Setup Instructions

### 1. Get an Autumn Account & Secret Key

1. Sign up at [useautumn.com](https://useautumn.com)
2. Create a new project in your Autumn dashboard
3. Navigate to Settings → API Keys
4. Copy your secret key (starts with `am_sk_`)

### 2. Configure Environment Variables

Add your Autumn secret key to Convex environment variables:

```bash
# Set in Convex Dashboard or via CLI
npx convex env set AUTUMN_SECRET_KEY=am_sk_your_secret_key_here
```

### 3. Verify Integration

The Autumn integration is already configured in your codebase:

- ✅ **Packages installed**: `@useautumn/convex` and `autumn-js`
- ✅ **Convex component**: Added to `convex/convex.config.ts`
- ✅ **Client setup**: `convex/autumn.ts` with Better Auth integration
- ✅ **Frontend provider**: `AutumnWrapper` component integrated
- ✅ **Type generation**: Convex types include Autumn APIs

## Using Autumn in Your Application

### Backend Functions (Convex)

Import and use Autumn functions in your Convex mutations and queries:

```typescript
import { autumn } from '../autumn';

// Check feature access
const { data, error } = await autumn.check(ctx, {
  featureId: 'premium-feature',
});

if (data.allowed) {
  // Grant access to premium feature
}

// Track usage (for metered billing)
const { data, error } = await autumn.track(ctx, {
  featureId: 'api-calls',
  value: 100, // Number of calls made
});

// Create checkout session
const { data, error } = await autumn.checkout(ctx, {
  productId: 'pro-plan',
  successUrl: 'https://yourapp.com/success',
  cancelUrl: 'https://yourapp.com/cancel',
});
```

### Frontend Hooks (React)

Use Autumn hooks in your React components:

```typescript
import { useCustomer, PricingTable } from 'autumn-js/react';

function PricingPage() {
  const { customer, check, checkout } = useCustomer();

  const handleUpgrade = async () => {
    await checkout({
      productId: 'pro-plan',
      dialog: true, // Show checkout dialog
    });
  };

  return (
    <div>
      <PricingTable />
      <button onClick={handleUpgrade}>
        Upgrade to Pro
      </button>
    </div>
  );
}
```

### Available Autumn Functions

#### Customer Management
- `createCustomer()` - Create a new customer
- `getCustomer()` - Retrieve customer details
- `updateCustomer()` - Update customer information

#### Billing & Subscriptions
- `checkout()` - Create Stripe checkout sessions
- `createSubscription()` - Create subscriptions
- `cancelSubscription()` - Cancel subscriptions
- `billingPortal()` - Generate billing portal links

#### Feature Access & Usage
- `check()` - Check if customer has access to a feature
- `track()` - Track usage for metered billing
- `usage()` - Get usage statistics

#### Products & Pricing
- `listProducts()` - Get available products
- `getProduct()` - Get product details
- `createProduct()` - Create new products

## Configuration

### Customer Identification

The `identify` function in `convex/autumn.ts` maps Better Auth users to Autumn customers:

```typescript
identify: async (ctx: GenericCtx) => {
  const user = await ctx.auth.getUserIdentity();
  if (!user) return null;

  return {
    customerId: user.id, // Better Auth user ID
    customerData: {
      name: user.name as string,
      email: user.email as string,
    },
  };
},
```

This automatically syncs user data from Better Auth to Autumn.

## Testing Autumn Integration

### 1. Test Customer Creation

```typescript
// In Convex
const { data, error } = await autumn.createCustomer(ctx, {
  email: 'test@example.com',
  name: 'Test User',
});
```

### 2. Test Feature Access

```typescript
// Check if user has access to a feature
const { data, error } = await autumn.check(ctx, {
  featureId: 'premium-reports',
});

console.log('Access allowed:', data.allowed);
```

### 3. Test Usage Tracking

```typescript
// Track usage for metered billing
const { data, error } = await autumn.track(ctx, {
  featureId: 'api-calls',
  value: 50,
});
```

## Production Deployment

### Environment Variables

Ensure `AUTUMN_SECRET_KEY` is set in production:

```bash
# In Convex production dashboard
npx convex env set AUTUMN_SECRET_KEY=am_sk_your_production_key
```

### Stripe Webhooks

Autumn handles Stripe webhooks automatically. No additional configuration needed.

### Database Migration

Autumn customer data is stored in Convex. No separate database migration required.

## Troubleshooting

### Common Issues

**"AUTUMN_SECRET_KEY environment variable is required"**
- Ensure the environment variable is set in Convex Dashboard
- Restart your development server after setting the variable

**"Autumn component not found"**
- Verify `convex/convex.config.ts` includes the autumn import and usage
- Run `npx convex dev` to regenerate types

**"Customer not found"**
- Check that the user is authenticated with Better Auth
- Verify the `identify` function returns correct customer data

**"Feature access denied"**
- Check product configuration in Autumn dashboard
- Verify customer has active subscription for the feature

### Logs

Autumn operations are logged automatically. Check:
- Convex function logs for backend operations
- Browser console for frontend hook usage
- Autumn dashboard for billing events

## Security Considerations

- **Secret key protection**: Never expose `AUTUMN_SECRET_KEY` in client code
- **Authentication required**: All Autumn functions require authenticated context
- **Rate limiting**: Consider implementing rate limits for billing operations
- **Audit logging**: Critical billing operations are logged via existing audit system

## Support

For Autumn-specific issues:
- Check Autumn dashboard for billing and product configuration
- Review Convex function logs for backend errors
- Test with Autumn's development tools

For integration issues:
- Verify Better Auth user authentication
- Check Convex type generation: `npx convex codegen`
- Ensure all dependencies are installed: `pnpm install`

