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

### One-Click Deploy to Netlify (Production)

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start)

**What happens automatically:**

- Connect your GitHub account
- Select your new repository
- Netlify builds and deploys your app
- Sets up automatic deployments on every push

**Required Setup Steps:**

1. **Convex Deployment:**
   - Create a Convex project: `npx convex dev` (follow prompts)
   - Get your Production Deploy Key from Convex Dashboard → Settings → Deploy Keys
   - Add `CONVEX_DEPLOY_KEY` to Netlify environment variables

2. **Convex Environment Variables:**
   - In your Convex Dashboard → Project Settings → Environment Variables, add:
     - `BETTER_AUTH_SECRET` (generate with `openssl rand -base64 32`)
     - `SITE_URL` (your Netlify site URL: `https://your-app-name.netlify.app`)
     - `RESEND_API_KEY` (your Resend API key)
     - `RESEND_EMAIL_SENDER` (your verified sender email)
     - `APP_NAME` (your application name)

3. **Netlify Environment Variables:**
   - Add `CONVEX_DEPLOY_KEY` (from Convex Dashboard → Settings → Deploy Keys → Production)

**✅ FREE TIER** - No credit card required. Uses Netlify's free tier + Convex free tier.

**Note:** Authentication and email configuration is handled entirely in Convex. You do NOT need to set these in Netlify environment variables.

That's it! Your app will be live at `https://your-app-name.netlify.app`

### Local Setup (Development)

#### Prerequisites

- Node.js 22+
- pnpm
- [Convex CLI](https://docs.convex.dev/quickstart) (`npx convex`)

##### Installation & Setup

```bash
# Clone your repository
git clone <your-repo-url>
cd tanstack-start-template

# Install dependencies
pnpm install

# Set up development environment (creates .env.local with required secrets)
pnpm run setup

# Initialize Convex (follow prompts to create your project)
npx convex dev

# Start development server
pnpm dev
```

#### Convex Setup

The setup script will guide you through:

1. **Convex Project Creation**: Creates your Convex project
2. **Environment Variables**: Sets up `VITE_CONVEX_URL` and `BETTER_AUTH_SECRET`
3. **Database Schema**: Automatically deploys your Convex schema

Your app will be available at `http://localhost:3000` and Convex dashboard at the URL provided during setup.

## Contributing

This is a TanStack Start template with authentication, admin dashboard, and modern React patterns. Perfect for building full-stack TypeScript applications.

## 📄 License

MIT License - See `LICENSE` file for details.
