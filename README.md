# TanStack Start Template

A comprehensive, production-ready starter template for building modern full-stack TypeScript applications with TanStack Start. This template provides everything you need to build scalable web applications with end-to-end type safety, server-first architecture, and enterprise-grade features.

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
- **Error handling** with comprehensive error boundaries
- **SEO optimization** utilities
- **Export functionality** for data management
- **Virtualized components** for handling large datasets

### ☁️ **Deployment Ready**

- **One-click deployment** to Netlify with database provisioning
- **Environment management** with secure secret handling
- **Build optimization** for production performance
- **Automatic SSL** and CDN through Netlify

## 🚀 Setup Guide

[![Use this template](https://img.shields.io/badge/Use%20this%20template-2ea44f?style=for-the-badge&logo=github)](https://github.com/dyeoman2/tanstack-start-template/generate)

This creates a fresh copy of the codebase in your GitHub account.

### 🚀 Quick Start (Production)

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start)

**What happens automatically:**

- Connects to your GitHub repository
- Builds and deploys your application
- Sets up automatic deployments on every push

**Required Manual Setup (5 minutes):**

#### 1. Set Up Convex Database

```bash
# Create your Convex project
npx convex dev
# Follow prompts to create project and get your deployment URL
```

#### 2. Configure Convex Environment Variables

Go to [Convex Dashboard](https://dashboard.convex.dev) → Your Project → Settings → Environment Variables or via the CLI:
```bash
npx convex env set BETTER_AUTH_SECRET=<generate-with-openssl-rand-base64-32>
npx convex env set SITE_URL=<your-netlify-url>
npx convex env set RESEND_API_KEY=<your-resend-key>
npx convex env set RESEND_EMAIL_SENDER=<verified-email>
npx convex env set APP_NAME="TanStack Start Template"
```

#### 3. Configure Netlify Environment Variables

In Netlify Dashboard → Site Settings → Environment Variables:

```
CONVEX_DEPLOY_KEY=<get-from-convex-dashboard-deploy-keys>
```

**✅ FREE TIER** - No credit card required!

**🎉 Result:** Your app will be live with authentication, database, and real-time features!

---

### 🛠️ Local Development Setup

#### Prerequisites

- Node.js 24+
- pnpm
- [Convex CLI](https://docs.convex.dev/quickstart) (`npx convex`)

#### Setup Steps

```bash
# 1. Clone and install
git clone <your-repo-url>
cd tanstack-start-template
pnpm install

# 2. Set up local environment (generates .env.local)
pnpm run setup

# 3. Configure Convex Dashboard (same variables as production)
# Copy BETTER_AUTH_SECRET from .env.local to Convex Dashboard
# Add SITE_URL=http://localhost:3000 to Convex Dashboard

# 4. Initialize Convex project
npx convex dev

# 5. Start development server
pnpm dev
```

**Your app will be available at `http://localhost:3000`**

## Contributing

This is a TanStack Start template with authentication, admin dashboard, and modern React patterns. Perfect for building full-stack TypeScript applications.

## 📄 License

MIT License - See `LICENSE` file for details.
