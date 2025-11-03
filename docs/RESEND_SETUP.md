# Email Setup with Resend

This document describes how to set up password reset emails using Resend in the TanStack Start application.

## Overview

The application uses Resend for sending password reset emails with beautiful, branded templates. The email system is fully integrated with TanStack Start server functions and follows the project's architectural patterns.

## Setup Instructions

### 1. Get a Resend API Key

1. Sign up at [resend.com](https://resend.com)
2. Create a new API key in your dashboard
3. Copy the API key (starts with `re_`)

### 2. Configure Environment Variables

#### Local Development

Add your Resend API key and optional email sender configuration to your `.env.local` file:

```bash
# Email notifications
RESEND_API_KEY=your-resend-api-key-here

# Optional: Custom sender email address (defaults to onboarding@resend.dev)
RESEND_EMAIL_SENDER=onboarding@resend.dev
```

#### Production Setup

##### Netlify Production Setup

For Netlify deployments, set these environment variables via CLI or dashboard:

**Netlify CLI:**

```bash
# Set environment variables
npx netlify env:set RESEND_API_KEY your-resend-api-key-here
npx netlify env:set RESEND_EMAIL_SENDER your-custom-email@yourdomain.com

# Deploy
npx netlify deploy --prod
```

**Netlify Dashboard:**

1. Go to your [Netlify dashboard](https://app.netlify.com)
2. Select your site → **Site settings** → **Environment variables**
3. Add the following variables:
   - `RESEND_API_KEY`: Your Resend API key
   - `RESEND_EMAIL_SENDER`: Your verified sender email (optional)

##### Convex Environment Setup

Since email functionality runs in Convex functions, you need to set the environment variables in Convex:

```bash
# Set the Resend API key in Convex (required for email functionality)
npx convex env set RESEND_API_KEY your-resend-api-key-here --prod

# Set custom sender email (optional, defaults to onboarding@resend.dev)
npx convex env set RESEND_EMAIL_SENDER your-custom-email@yourdomain.com --prod
```

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

- **Custom `sendResetPassword`**: Better Auth configuration sends emails via Resend
- **Client Methods**: `authClient.forgetPassword()` and `authClient.resetPassword()`
- `testEmailServerFn`: Tests email configuration (admin only)

### Key Features

- **Better Auth Integration**: Leverages Better Auth's secure token management and password hashing
- **Custom Email Templates**: Professional HTML templates sent via Resend
- **Type Safety**: Full TypeScript validation with Zod schemas
- **Error Handling**: Comprehensive error handling and logging
- **Admin Testing**: Built-in email testing functionality

### Email Flow

1. User requests password reset via `authClient.forgetPassword()`
2. Better Auth generates secure token and calls our custom `sendResetPassword` function
3. Email sent via Resend with reset link using our custom template
4. User clicks link and resets password via `authClient.resetPassword()`
5. Better Auth handles token validation and password update securely

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

- **Local development**: Make sure you've added the API key to your `.env.local` file and restarted the dev server
- **Convex**: Ensure the API key is set in Convex with `npx convex env set RESEND_API_KEY your-key`
- **Production**: Verify the environment variable is set in your hosting platform (Netlify)

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

Set the `RESEND_EMAIL_SENDER` environment variable in your `.env.local` file:

```bash
# Custom sender email address
RESEND_EMAIL_SENDER=
```

The application will automatically use this email address for all outgoing emails. If not set, it defaults to `onboarding@resend.dev`.

## Support

For issues with email delivery, check:

- Resend dashboard for delivery metrics
- Application logs for error details
- Network connectivity to Resend API
