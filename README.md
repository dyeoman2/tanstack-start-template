# TanStack Start Template

A TanStack Start template built with TanStack Start, featuring modern full-stack TypeScript architecture with end-to-end type safety, authentication, real-time data, and a production-ready chat experience.

## 🎯 Demo Features

After registering and logging in, you can explore these demo features:

- **📊 Dashboard** - View real-time statistics and metrics with live data updates via Convex subscriptions
- **💬 Chat** - Multi-threaded AI chat with real-time persistence, personas, and OpenRouter responses via the Vercel AI SDK
- **👥 Admin Dashboard** - Full admin interface with:
  - User management (view, edit, delete users)
  - System statistics and analytics
  - Data management tools
- **👤 Profile** - User profile management and settings

## ✨ What's Included

### 🏗️ **Complete Full-Stack Architecture**

- **File-based routing** with TanStack Router for intuitive page organization
- **Server functions** for type-safe API endpoints and data fetching
- **Progressive enhancement** - works without JavaScript, enhances with it
- **Parallel data loading** with route loaders and Convex real-time queries

### 🔐 **Authentication & Authorization**

- **Better Auth integration** with secure session management
- **Role-based access control** (Admin/User permissions)
- **Route guards** for protected pages and server functions
- **Audit logging** for complete action tracking
- **Password reset** and email verification flows

### 🎨 **Modern UI & UX**

- **shadcn/ui components** - 20+ pre-built, accessible UI primitives
- **TailwindCSS** for responsive, utility-first styling
- **Dark/Light mode** support ready
- **Form handling** with TanStack React Form and Zod validation
- **Loading states** and error boundaries for smooth UX

### 🗄️ **Database & Data Management**

- **Convex** for real-time, serverless database operations
- **Type-safe queries and mutations** with automatic client generation
- **Real-time subscriptions** for live data updates
- **Automatic scaling** and global distribution
- **Integrated authentication** with Better Auth

### 🚀 **Developer Experience**

- **End-to-end type safety** from database to UI
- **Hot reloading** and fast development server
- **Oxc** for fast linting, formatting, and type-aware analysis
- **Performance monitoring** hooks for development insights
- **Automatic cache management** with Convex real-time subscriptions

### 📧 **Production Features**

- **Email integration** with Resend for transactional emails
- **Error monitoring** with Sentry integration (optional)
- **Performance monitoring** and session replay
- **SEO optimization** utilities
- **Export functionality** for data management
- **Virtualized components** for handling large datasets

### ☁️ **Deployment Ready**

- **One-click deployment** to Netlify with database provisioning
- **Environment management** with secure secret handling
- **Build optimization** for production performance
- **Automatic SSL** and CDN through Netlify

## 🚀 Setup Guide

### ⚡ Quick Start (Local Development)

1. **[Create your repository](https://github.com/new?template_name=tanstack-start-template&template_owner=dyeoman2)** from this template

2. **Clone your new repository**:

   ```bash
   git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   cd YOUR_REPO_NAME
   ```

3. **Run the automated setup**:

   ```bash
   pnpm run setup:dev
   ```

This automated script will guide you through local development setup, including:

- Interactive Convex project creation
- Development environment configuration (URLs and environment variables)
- Optional authenticated Playwright E2E setup via `pnpm run setup:e2e`
- Automatic startup of both development servers simultaneously in the current terminal!

### 🚀 Quick Start (Production)

**Automated Production Setup** (Recommended):

```bash
# After completing local development setup
pnpm run setup:prod
```

**What happens automatically:**

- ✅ Checks for git remote repository
- ✅ Deploys Convex functions to production
- ✅ Provides step-by-step Netlify deployment instructions
- ✅ Pre-fills environment variables for easy copying
- ✅ Guides you through connecting your existing repository

**🎉 Result:** Your app will be live with authentication, database, and real-time features!

## 🧪 Testing

### Unit and component tests

```bash
pnpm test
```

### Browser E2E with Playwright

```bash
pnpm test:e2e
```

Playwright uses the real local app at `http://127.0.0.1:3000` and starts a frontend-only server with `pnpm test:e2e:server`. It reuses your configured Convex deployment from env instead of starting `convex dev`.

Authenticated E2E relies on a gated test-only auth helper. The easiest setup path is:

```bash
pnpm setup:e2e
```

That command updates `.env.local` with deterministic E2E principals and syncs the required gate vars to your current Convex deployment automatically. If you prefer to manage the values manually, add these values to `.env.local` before running authenticated suites:

```bash
ENABLE_E2E_TEST_AUTH=true
E2E_TEST_SECRET=replace-with-a-shared-secret
E2E_USER_EMAIL=e2e-user@local.test
E2E_USER_PASSWORD=replace-with-a-deterministic-password
E2E_ADMIN_EMAIL=e2e-admin@local.test
E2E_ADMIN_PASSWORD=replace-with-a-deterministic-password
```

The setup project will provision those principals, reconcile the Convex role profile, and save `playwright/.auth/user.json` and `playwright/.auth/admin.json` automatically.

Because the frontend test server reuses your configured Convex deployment, that deployment must also have:

```bash
ENABLE_E2E_TEST_AUTH=true
E2E_TEST_SECRET=the-same-shared-secret
```

`pnpm setup:e2e` handles that sync for the current deployment. You only need to set those deployment vars manually if you are not using the setup script.

### Agent Browser Authentication

For AI-driven browser automation, prefer the test-only agent auth endpoint instead of filling the login form:

```http
POST /api/test/agent-auth
x-e2e-test-secret: <E2E_TEST_SECRET>
Content-Type: application/json

{
  "principal": "user",
  "redirectTo": "/app"
}
```

Run that request from the same browser session your automation tool will continue using. On success, the endpoint forwards Better Auth `Set-Cookie` headers and redirects to the requested in-app path.

Use `POST /api/test/e2e-auth` only when your tool needs cookie JSON for manual injection, such as Playwright storage state bootstrapping.

If the agent can run repo scripts, the easiest path is:

```bash
pnpm run agent:auth -- --session-name codex-demo --principal user --redirect-to /app
```

That command loads `.env.local`, authenticates the named `agent-browser` session through `/api/test/agent-auth`, and opens the requested page in the same browser session.

For the common "authenticate, wait, and inspect" flow:

```bash
pnpm run agent:inspect -- --session-name codex-demo --principal user --redirect-to /app
```

You can override the target origin when needed:

```bash
pnpm run agent:inspect -- --session-name codex-demo --base-url http://127.0.0.1:3100 --principal user --redirect-to /app
```

Admin flow:

```bash
pnpm run agent:auth -- --session-name codex-admin --principal admin --redirect-to /app/admin
```

For repo-local Playwright automation, use:

```bash
pnpm run playwright:inspect -- --principal user --path /app
```

That command authenticates through `/api/test/e2e-auth`, opens the page with Playwright, and prints a compact JSON summary of the resulting UI. Add `--screenshot output/playwright/app.png` to save a screenshot artifact.

For reliable browser automation in local development:

- Use `http://127.0.0.1:3000` instead of `http://localhost:3000`.
- Always use a named `agent-browser` session so auth state is isolated per run.
- After opening a new page, wait for `networkidle` before the first snapshot.
- Re-snapshot after every navigation or DOM-changing interaction.
- Close the named session when done so stale browser state does not leak into later runs.

To close a named session explicitly:

```bash
pnpm run agent:close -- --session-name codex-demo
```

See [Agent Browser Workflows](docs/AGENT_BROWSER_WORKFLOWS.md) for copy-paste patterns covering authenticated snapshots, admin checks, screenshots, and cleanup.

### 🔗 Link Your Local Project to Netlify (Optional)

After deploying, link your local project to Netlify for easier management:

```bash
# Link your local project to the deployed Netlify site
npx netlify link

# This allows you to:
# - Deploy updates with `npx netlify deploy --prod`
# - View build logs locally
# - Manage environment variables from CLI
```

## 📄 Third Party Services Setup

In order to send password reset and transactional emails, you need to set up Resend. In order to monitor errors and performance, you need to set up Sentry. For chat functionality, you need to set up OpenRouter. These are optional, but recommended for production.

- Add `OPENROUTER_API_KEY` to your local `.env.local` and production environment.
- Optional: set `OPENROUTER_SITE_URL` and `OPENROUTER_SITE_NAME` if you want custom attribution headers sent to OpenRouter.
- Manage the allowed chat models from the admin dashboard instead of syncing a provider catalog.

- [Resend Setup Guide](docs/RESEND_SETUP.md) - Password reset and transactional email configuration
- [Sentry Setup](./docs/SENTRY_SETUP.md) - Error monitoring and performance tracking

- [CodeRabbit CLI Setup](docs/CODERABBIT_CLI_SETUP.md) - AI-powered code review assistance

### 🗂️ **Optional Infrastructure Setup**

The template now includes an AWS-backed storage path for file-backed features, with `convex` remaining the zero-config default and S3 available for malware-scanned storage deployments:

- [AWS S3 Storage Setup](infra/README.md) - CDK infrastructure and runtime environment contract for `s3-primary` and `s3-mirror`
- [Disaster Recovery Overview](docs/DISASTER_RECOVERY.md) - weekly Convex-to-S3 backups, self-hosted Convex failover, and file-storage DR limits
- [Disaster Recovery Runbook](docs/DISASTER_RECOVERY_RUNBOOK.md) - operator workflow for backup infra, DR infra, and failover execution
- [Disaster Recovery Configuration](docs/DISASTER_RECOVERY_CONFIG.md) - GitHub secrets, Secrets Manager inputs, and DR env vars

For guided DR setup across AWS, GitHub, Convex, and Netlify, run:

```bash
pnpm run setup:dr
```

For guided local setup, run:

```bash
pnpm run setup:storage
```

For guided production runtime env setup across Convex prod and Netlify, run:

```bash
pnpm run setup:storage:prod
```

For DR infrastructure previews and deploys, use:

```bash
pnpm run infra:dr:backup:preview
pnpm run infra:dr:backup:deploy
pnpm run infra:dr:ecs:preview
pnpm run infra:dr:ecs:deploy
```

## 📄 License

MIT License - See `LICENSE` file for details.
