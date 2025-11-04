# Sentry Setup Guide

This guide will help you set up Sentry error monitoring, performance tracing, session replay, and logging for your TanStack Start application.

## What's Included

Your TanStack Start template comes with a complete Sentry integration that includes:

- **Error Monitoring**: Automatic capture of unhandled errors and exceptions
- **Performance Tracing**: TanStack Router navigation tracing and custom spans
- **Session Replay**: Video-like reproduction of user sessions (10% sample rate, 100% for errors)
- **User Feedback**: User feedback collection integration
- **Logging**: Centralized log collection and correlation with errors
- **Server-side Monitoring**: Error tracking for server functions and API routes

## Prerequisites

1. **Sentry Account**: Sign up at [sentry.io](https://sentry.io/signup/) (free tier available)
2. **Sentry Project**: Create a new project in Sentry for your application

## Step 1: Get Your Sentry DSN

1. Go to your [Sentry dashboard](https://sentry.io)
2. Select your project (or create a new one)
3. Go to **Settings** → **Client Keys (DSN)**
4. Copy the **DSN** value (it should look like: `https://your-key.ingest.your-region.sentry.io/project-id`)

## Step 2: Development Setup

### Add Environment Variable

Create or update your `.env.local` file in the project root:

```bash
# Add this line to your .env.local file
VITE_SENTRY_DSN=https://your-project-dsn.ingest.sentry.io/project-id
```

### Test the Setup

1. Start your development server:

   ```bash
   pnpm dev
   ```

2. Visit the test page: `http://localhost:3000/test-sentry`

3. Click the "Test All Sentry Features" button

4. Check your Sentry dashboard - you should see all configured services working

## Sentry Services Overview

Your TanStack Start template includes a comprehensive Sentry integration with the following services:

### 🔍 Error Monitoring

**What it tracks**: Unhandled errors, exceptions, and manually captured errors from both client and server
**Client-side**: Captures React component errors, promise rejections, and manual error captures
**Server-side**: Captures errors in server functions, API routes, and Convex operations

### 📊 Performance Tracing

**What it tracks**: Application performance, route navigation timing, and custom performance spans
**Client-side**: TanStack Router navigation tracing, component render timing, API calls
**Server-side**: Server function execution time, database queries, API route performance

### 🎥 Session Replay

**What it tracks**: Video-like reproduction of user sessions for debugging
**Sample rate**: 10% of all sessions, 100% for sessions with errors
**Features**: User interactions, console logs, network requests, DOM changes

### 📝 Centralized Logging

**What it tracks**: Console messages forwarded to Sentry for correlation with errors
**Levels**: `console.log`, `console.warn`, `console.error`
**Integration**: Logs appear alongside errors and performance data

### ⚡ Profiling (Browser & Server)

**What it tracks**: CPU and memory usage, function execution time, performance bottlenecks
**Client-side**: Browser profiling integration with automatic span profiling
**Server-side**: Node.js profiling (requires `@sentry/profiling-node` for full functionality, disabled on Node 24 until Sentry adds support)

### 💬 User Feedback

**What it collects**: User feedback on errors and crashes
**Integration**: Widget appears when errors occur, collects user reports

## Local Testing Guide

### How to Test Each Service

1. **Visit the test page**: `http://localhost:3000/test-sentry`
2. **Click "Test All Sentry Features"** - this triggers all services simultaneously
3. **Check your Sentry dashboard** for the following:

#### Error Monitoring Test Results

- **Frontend Error**: "Sentry Example Frontend Error" in the Issues section
- **Server Error**: "Sentry Example Route Error" from the `/api/sentry-example` route
- Both errors will include stack traces, user context, and environment information

#### Performance Tracing Test Results

- **Client-side spans**: "Example Frontend Span" showing browser execution time
- **Server-side spans**: "Example Server Span" showing server execution time
- **Route navigation**: Automatic tracing of the `/test-sentry` route load
- All traces include timing data and can be viewed in the Performance section

#### Session Replay Test Results

- If your session is sampled (10% chance), a replay will be available
- The replay captures the button click, console messages, and error occurrence
- Viewable in the Replays section of your Sentry dashboard

#### Logging Test Results

- **Client logs**: 3 console messages (log, warn, error) from the browser
- **Server logs**: 3 console messages (log, warn, error) from the API route
- Logs are correlated with the errors and appear in the issue details

#### Profiling Test Results

- **Client profiling**: CPU profile data for the frontend span execution
- **Server profiling**: CPU profile data for the server span.
- Profiles show function execution time and can identify performance bottlenecks

### Manual Testing Options

#### Test Frontend Errors Only

```typescript
// In any React component
throw new Error('Manual frontend test error');
```

#### Test Server Errors Only

```typescript
// In any server function (*.server.ts)
export async function testServerFunction() {
  throw new Error('Manual server test error');
}
```

#### Test Performance Spans Manually

```typescript
import * as Sentry from '@sentry/tanstackstart-react';

// Client-side span
await Sentry.startSpan({ name: 'Custom Operation', op: 'test' }, async () => {
  // Your code here
  await someAsyncOperation();
});

// Server-side span (in server functions)
return Sentry.startSpan({ name: 'Server Operation', op: 'db' }, async () => {
  // Your server code here
  return await databaseQuery();
});
```

### What to Expect in Development vs Production

#### Development Mode (`pnpm dev`)

- Sentry only activates when you visit `/test-sentry`
- Full functionality available for testing
- Errors and performance data sent to your Sentry project
- Session replays may be captured based on sample rate
- Server profiling is disabled on Node 24 (shows warning until Sentry adds Node 24 support)

#### Production Mode

- All services active for all users
- Sample rates apply (adjustable in `src/lib/sentry.ts`)
- User feedback widget available on errors
- All errors, performance issues, and replays collected

## Step 3: Production Setup

### Convex Environment Setup

Your application uses Convex for data management. Set the Sentry DSN in Convex:

```bash
# Set environment variable in Convex
npx convex env set VITE_SENTRY_DSN https://your-project-dsn.ingest.sentry.io/project-id --prod

```

### Netlify Deployment

#### Option 1: Netlify CLI

If you're deploying via Netlify CLI:

```bash
# Set the environment variable
npx netlify env:set VITE_SENTRY_DSN https://your-project-dsn.ingest.sentry.io/project-id

# Deploy
npx netlify deploy --prod
```

#### Option 2: Netlify Dashboard

1. Go to your [Netlify dashboard](https://app.netlify.com)
2. Select your site
3. Go to **Site settings** → **Environment variables**
4. Add a new variable:
   - **Key**: `VITE_SENTRY_DSN`
   - **Value**: `https://your-project-dsn.ingest.sentry.io/project-id`
   - **Scopes**: Check both "Builds" and "Functions" (if using Netlify Functions)

## Step 4: Verify Production Setup

After deploying to production:

1. Visit your live application
2. Go to `/test-sentry` (or create a test error in your app)
3. Trigger an error
4. Check your Sentry dashboard for the production errors

## Configuration Options

### Development Behavior

Sentry stays dormant in development until you visit the test page (`/test-sentry`). Hitting that page—either directly or via client navigation—boots the SDK for the remainder of the session so you can verify errors, tracing, logging, and profiling locally without collecting data during normal development.

- **Development**: Open `/test-sentry` to enable monitoring for the current session
- **Production**: Full Sentry monitoring (errors, performance, replays, logs)

### Logging Behavior

Console logging is forwarded to Sentry in production and while the development session is in test mode, helping you confirm log collection before deploying.

### Server Profiling in Development

The template attempts to load Sentry's native Node profiling module during local runs. If the prebuilt binary for your platform is unavailable, you'll see a warning (`Node profiling native module not available`). The rest of the integration—including server errors, logs, and tracing—continues to work; only server CPU profiling is skipped locally.

### Adjust Sample Rates (Optional)

You can modify the sample rates in `src/lib/sentry.ts`:

```typescript
// For production, consider lower sample rates
tracesSampleRate: 0.1, // 10% instead of 100%
replaysSessionSampleRate: 0.01, // 1% instead of 10%
```

### Environment-Specific Configuration

Sentry automatically detects environments, but you can customize per environment:

```typescript
Sentry.init({
  dsn: sentryDsn,
  environment: import.meta.env.PROD ? 'production' : 'development',
  // ... other options
});
```

## Testing Different Error Types

### Frontend Errors

```typescript
// In any component
throw new Error('Frontend test error');
```

### Server Function Errors

```typescript
// In a server function (*.server.ts)
export async function someServerFunction() {
  throw new Error('Server function error');
}
```

### API Route Errors

```typescript
// In an API route
export const Route = createFileRoute('/api/test')({
  server: {
    handlers: {
      GET: () => {
        throw new Error('API route error');
      },
    },
  },
});
```

## Troubleshooting

### Errors Not Appearing in Sentry

1. **Check your DSN**: Make sure `VITE_SENTRY_DSN` is set correctly
2. **Environment**: Ensure the environment variable is available (check browser dev tools → Console → `import.meta.env`)
3. **Network**: Make sure Sentry's endpoints aren't blocked by ad blockers or firewalls
4. **Timing**: Errors might take a few minutes to appear in the dashboard

### Common Issues

### "Sentry not initialized" warnings

- Check that `initializeSentry(router)` is called in `src/router.tsx`
- Verify the DSN is not undefined

### Missing server-side errors

- Ensure `instrument.server.mjs` is being loaded (check dev/build scripts)
- Verify server environment has the DSN

### Performance traces not showing

- Check that `Sentry.tanstackRouterBrowserTracingIntegration(router)` is included
- Verify `tracesSampleRate` is set

### Debug Mode

Enable debug logging temporarily:

```typescript
Sentry.init({
  dsn: sentryDsn,
  debug: true, // Remove in production
  // ... other options
});
```

## Additional Resources

- [Sentry TanStack Start Documentation](https://docs.sentry.io/platforms/javascript/guides/tanstackstart-react/)
- [Sentry Dashboard](https://sentry.io)
- [TanStack Start Documentation](https://tanstack.com/start)

## Support

If you encounter issues:

1. Check the [Sentry Troubleshooting Guide](https://docs.sentry.io/platforms/javascript/guides/tanstackstart-react/troubleshooting/)
2. Search existing issues on [GitHub](https://github.com/getsentry/sentry-javascript/issues)
3. Create a new issue if needed

---

**Note**: This setup provides comprehensive monitoring out of the box. Review Sentry's [configuration options](https://docs.sentry.io/platforms/javascript/guides/tanstackstart-react/configuration/) to customize for your specific needs.
