# TanStack Start Template

A TanStack Start Template built with TanStack Start, featuring modern full-stack TypeScript architecture with end-to-end type safety, authentication, real-time database, and production-ready components.

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

### ⚡ Quick Start (Local Development)

1. **[Create your repository](https://github.com/new?template_name=tanstack-start-template&template_owner=dyeoman2)** from this template

2. **Clone your new repository**:

   ```bash
   git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   cd YOUR_REPO_NAME
   ```

3. **Run the automated setup**:

   ```bash
   pnpm run setup:all
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

### 🔑 Environment Variables

- The setup scripts scaffold a local `.env.local` with reasonable defaults, but you still need to provide real credentials (e.g. Convex deployment URLs, Resend keys, S3 settings) and configure the same variables in production (Netlify, Convex env vars, etc.).

## 📄 Documentation

- [Email Setup Guide](docs/EMAIL_SETUP.md) - Password reset and transactional email configuration

## 📄 License

MIT License - See `LICENSE` file for details.
