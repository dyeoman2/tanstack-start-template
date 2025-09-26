# TanStack Start Starter Template

A starter template for TanStack Start.

## Security

- **Single-User Mode**: Secure personal deployments
- **Role-Based Access**: Admin and user permissions
- **Audit Logging**: Complete action tracking

## Tech Stack

- **Frontend**: TanStack Start + React + TailwindCSS + shadcn/ui
- **Backend**: TypeScript/Node.js with server functions
- **Database**: Neon PostgreSQL (serverless) + Drizzle ORM
- **Auth**: Better Auth with session management
- **Deployment**: Netlify (free tier) + automatic builds

## 🚀 Setup Guide

[![Use this template](https://img.shields.io/badge/Use%20this%20template-2ea44f?style=for-the-badge&logo=github)](https://github.com/sudowealth/TBD/generate)

This creates a fresh copy of the codebase in your GitHub account.

### One-Click Deploy to Netlify (Production)

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start)

**What happens automatically:**

- Connect your GitHub account
- Select your new repository
- Netlify creates a Neon PostgreSQL database
- Generates required secrets (BETTER_AUTH_SECRET, DB_ENCRYPTION_KEY)
- Builds and deploys your app
- Sets up automatic deployments on every push

**✅ FREE TIER** - No credit card required. Uses Netlify's free tier + Neon PostgreSQL.

That's it! Your app will be live at `https://your-app-name.netlify.app`

### Local Setup (Development)

#### Prerequisites

- Node.js 22+
- pnpm
- [Neon CLI](https://neon.tech/docs/reference/neon-cli) (`neonctl`)

**Install neonctl:**

```bash
# Using npm
npm install -g neonctl

# Or using Homebrew (macOS/Linux)
brew install neonctl

# Or download directly from GitHub releases
# https://github.com/neondatabase/neonctl/releases
```

**Verify installation:**

```bash
neonctl --version
```

##### Installation & Setup

```bash
# Clone your repository
git clone <your-repo-url>
cd tbd

# Install dependencies
pnpm install

# Set up development environment
pnpm run setup

# Start development server
pnpm dev
```

#### Database Setup

Choose one of the following database setup options:

##### Option 1: Local PostgreSQL with Homebrew (Recommended for Local Development)

For local development with a traditional PostgreSQL database using Homebrew:

###### 1. Install PostgreSQL

```bash
# Install PostgreSQL using Homebrew
brew install postgresql

# Start PostgreSQL service
brew services start postgresql

# Create a database for the project
createdb tanstack_start_starter_dev
```

###### 2. Configure Database Connection

Add the local PostgreSQL connection string to your `.env.local`:

```bash
# Add to .env.local (created by pnpm run setup)
# For local PostgreSQL development:
DATABASE_URL=postgresql://localhost:5432/tanstack_start_starter_dev
```

###### 3. Push Schema and Seed Data

```bash
# Push database schema to your local PostgreSQL database
pnpm run db:push

# Seed with sample data
pnpm run seed
```

###### 4. Database Management (Optional)

```bash
# Stop PostgreSQL service
brew services stop postgresql

# Start PostgreSQL service manually
brew services start postgresql

# Access PostgreSQL shell
psql tanstack_start_starter_dev

# View running services
brew services list
```

##### Option 2: Neon PostgreSQL with Database Branching

This project supports **Neon PostgreSQL** with database branching for cloud-based development.

###### 1. Authenticate with Neon

```bash
# Login to your Neon account
neonctl auth

# List your projects
neonctl projects list
```

###### 2. Create a Local Development Branch

```bash
# Get your project ID from the list above, then create a branch
neonctl branches create --project-id YOUR_PROJECT_ID --name local
```

This creates an isolated database branch for development that won't affect your production data.

###### 3. Configure Database Connection

After creating the branch, you'll get a connection string. Add it to your `.env.local`:

```bash
# Add to .env.local (created by pnpm run setup)
# For local development with your Neon branch:
NETLIFY_DATABASE_URL=postgresql://neondb_owner:your_password@ep-your-endpoint.neon.tech/neondb?sslmode=require
```

###### 4. Push Schema and Seed Data

```bash
# Push database schema to your local branch
pnpm run db:push

# Seed with sample data
pnpm run seed
```

## Contributing

This is a TanStack Start starter template with authentication, admin dashboard, and modern React patterns. Perfect for building full-stack TypeScript applications.

## 📄 License

MIT License - See `LICENSE` file for details.
