# Email Setup with Resend

This document describes how to set up password reset emails using Resend in the TanStack Start application.

## Overview

The application uses Resend for sending password reset emails with beautiful, branded templates. The email system runs entirely in Convex using the official `@convex-dev/resend` component, which provides queueing, batching, durable execution, and rate limiting.

## Setup Instructions

### 1. Get a Resend API Key

1. Sign up at [resend.com](https://resend.com)
2. Create a new API key in your dashboard
3. Copy the API key (starts with `re_`)

### 2. Configure Environment Variables

Email functionality runs entirely in Convex, so you need to set environment variables in Convex, not in your local `.env` file or Netlify.

#### Development Environment

Set the Resend API key in Convex for development:

```bash
npx convex env set RESEND_API_KEY your-resend-api-key-here
```

Optionally set a custom sender email (defaults to `onboarding@resend.dev`):

```bash
npx convex env set RESEND_EMAIL_SENDER your-custom-email@yourdomain.com
```

#### Production Environment

Set the Resend API key in Convex for production:

```bash
npx convex env set RESEND_API_KEY your-resend-api-key-here --prod
```

Optionally set a custom sender email (defaults to `onboarding@resend.dev`):

```bash
npx convex env set RESEND_EMAIL_SENDER your-custom-email@yourdomain.com --prod
```

#### Using the Convex Dashboard

1. Go to your [Convex Dashboard](https://dashboard.convex.dev)
2. Select your project
3. Go to **Settings** → **Environment Variables**
4. Select the appropriate environment (Development or Production)
5. Add the following variables:
   - `RESEND_API_KEY`: Your Resend API key (required)
   - `RESEND_EMAIL_SENDER`: Your verified sender email (optional)

**Note:** These variables must be set in Convex, not in your local `.env` file or Netlify. This ensures reliable email delivery and avoids Netlify function timeout limitations.

### 4. Domain Verification (Production)

For production deployments, you'll need to verify your domain with Resend:

1. Go to Domains in your Resend dashboard
2. Add your domain (e.g., `my-app.com`)
3. Follow the DNS verification steps
4. Set the `RESEND_EMAIL_SENDER` environment variable to use your verified domain

## Email Templates

The password reset emails use professional HTML templates with:

- **Branded Design**: Matches the branding
- **Responsive Layout**: Works on all devices
- **Security Features**: Links expire in 1 hour
- **Plain Text Fallback**: For email clients that don't support HTML

## Technical Implementation

### Better Auth Integration

- **Custom `sendResetPassword`**: Better Auth configuration sends emails via Convex Resend component
- **Client Methods**: `authClient.forgetPassword()` and `authClient.resetPassword()`
- `testEmailServerFn`: Tests email configuration (admin only)

### Key Features

- **Better Auth Integration**: Leverages Better Auth's secure token management and password hashing
- **Convex Resend Component**: Uses `@convex-dev/resend` for reliable email delivery with queueing and rate limiting
- **Custom Email Templates**: Professional HTML templates sent via Resend
- **Type Safety**: Full TypeScript validation with Zod schemas
- **Error Handling**: Comprehensive error handling and logging
- **Admin Testing**: Built-in email testing functionality

### Email Flow

1. User requests password reset via `authClient.forgetPassword()`
2. Better Auth generates secure token and calls our custom `sendResetPassword` function
3. Email sent via Convex Resend component with reset link using our custom template
4. User clicks link and resets password via `authClient.resetPassword()`
5. Better Auth handles token validation and password update securely

### How It Works

The integration runs entirely in Convex:
- The `@convex-dev/resend` component handles all email operations
- Environment variables (`RESEND_API_KEY`, `RESEND_EMAIL_SENDER`) are read from Convex
- Email sending is queued and batched for reliability
- Rate limiting prevents abuse
- Durable execution ensures emails are delivered even if there are temporary failures

## Testing Email Functionality

As an admin, you can test the email system:

1. Go to the Admin panel
2. Use the email testing feature (`testEmailServerFn`) to send a test email
3. Check your inbox for the test message

You can also test the full password reset flow:

1. Go to the forgot password page
2. Enter a valid email address
3. Check your inbox for the password reset email
4. Click the reset link to test the complete flow

## Troubleshooting

### Common Issues

#### "RESEND_API_KEY environment variable is required"

- **Development**: Ensure the API key is set in Convex with `npx convex env set RESEND_API_KEY your-key`
- **Production**: Ensure the API key is set in Convex with `npx convex env set RESEND_API_KEY your-key --prod`
- **Verification**: Check your Convex environment variables with `npx convex env ls` (or `npx convex env ls --prod` for production)

#### "Failed to send password reset email"

- Check your Resend API key is valid
- Verify your domain is verified (production)
- Check Resend dashboard for delivery status

#### Emails not being delivered

- Check spam/junk folders
- Verify domain verification status
- Check Resend dashboard for bounce/complaint reports

### Logs

Email operations are logged with the following information:

- Success/failure status
- Email addresses (obfuscated for privacy)
- Resend message IDs
- Token generation/validation

## Security Considerations

- Password reset tokens expire in 1 hour
- Tokens are cryptographically secure (UUID v4)
- Email addresses are not revealed in error messages
- All email operations require proper authentication
- Failed attempts are logged for monitoring

## Customization

### Changing Email Templates

Edit the `createPasswordResetEmailTemplate` function in `src/features/auth/email.server.ts`:

```typescript
const createPasswordResetEmailTemplate = (resetLink: string, userName?: string) => {
  // Customize HTML and text templates here
  return {
    subject: 'Your custom subject',
    html: `Your custom HTML template`,
    text: `Your custom text template`,
  };
};
```

### Changing Sender Address

Set the `RESEND_EMAIL_SENDER` environment variable in Convex:

**Development:**
```bash
npx convex env set RESEND_EMAIL_SENDER your-custom-email@yourdomain.com
```

**Production:**
```bash
npx convex env set RESEND_EMAIL_SENDER your-custom-email@yourdomain.com --prod
```

The application will automatically use this email address for all outgoing emails. If not set, it defaults to `onboarding@resend.dev`.

## Support

For issues with email delivery, check:

- Resend dashboard for delivery metrics
- Application logs for error details
- Network connectivity to Resend API
