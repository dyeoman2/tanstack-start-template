# TanStack Start Template

A TanStack Start Template built with TanStack Start, featuring modern full-stack TypeScript architecture with end-to-end type safety, authentication, real-time database, and production-ready components.

## 🎯 Demo Features

After registering and logging in, you can explore these demo features:

- **📊 Dashboard** - View real-time statistics and metrics with live data updates via Convex subscriptions
- **🤖 AI Playground** - Interactive AI playground featuring:
  - Streaming text generation with Cloudflare Workers AI
  - Structured output generation (JSON, markdown, etc.)
  - Web scraping and content extraction with Firecrawl
  - Gateway diagnostics and request monitoring
  - Usage metering with Autumn billing integration (10 free messages, then upgrade prompts)
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
- **Biome** for lightning-fast linting and formatting
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

In order to send password reset and transactional emails, you need to set up Resend. In order to monitor errors and performance, you need to set up Sentry. For AI functionality, you need to set up Cloudflare Workers AI. To meter usage and offer paid upgrades after the 10 free messages, you need to set up Autumn. For web scraping and content extraction in the AI playground, you can set up Firecrawl. These are optional, but recommended for production.

- [Resend Setup Guide](docs/RESEND_SETUP.md) - Password reset and transactional email configuration
- [Sentry Setup](./docs/SENTRY_SETUP.md) - Error monitoring and performance tracking
- [Cloudflare AI Setup](docs/CLOUDFLARE_AI_SETUP.md) - AI inference and gateway configuration
- [Autumn Billing Setup](docs/AUTUMN_SETUP.md) - Usage metering and upgrade flow for AI messaging
- [Firecrawl Setup](docs/FIRECRAWL_SETUP.md) - Web scraping and content extraction for AI playground

- [CodeRabbit CLI Setup](docs/CODERABBIT_CLI_SETUP.md) - AI-powered code review assistance

### 🗂️ **Optional Infrastructure Setup**

The template includes pre-configured infrastructure for file storage using AWS S3, but this is **not currently implemented** in the application. If you need document or file upload functionality, the infrastructure is ready to leverage:

- [AWS S3 Storage Setup](infra/README.md) - Document and file storage infrastructure (ready but not implemented)

## 📄 License

MIT License - See `LICENSE` file for details.
