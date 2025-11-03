# EdForge Admin Web - NextJS Application

A modern, enterprise-grade admin dashboard for managing multi-tenant SaaS platform built with Next.js 15, TypeScript, and shadcn/ui.

## Architecture Overview

### Server & Client Components

This application follows NextJS 15 best practices with proper separation of Server and Client Components:

- **Server Components** (default):
  - All pages (`app/**/page.tsx`)
  - Layout components (`Header`, `PageLayout`)
  - Authentication checks using `getServerSession()`
  - Better performance, SEO, and security

- **Client Components** (`'use client'`):
  - Interactive components (forms, buttons with onClick)
  - Components using React hooks (useState, useEffect)
  - TanStack Query hooks for data fetching
  - Event handlers and browser APIs

### Key Features

- ✅ **Secure Authentication**: AWS Cognito OIDC with NextAuth.js
- ✅ **Server-Side Session Management**: Protected routes with middleware
- ✅ **Optimistic Data Fetching**: TanStack Query with infinite scroll
- ✅ **Modern UI**: shadcn/ui components with Tailwind CSS
- ✅ **Type Safety**: Full TypeScript support
- ✅ **Production Ready**: Optimized for Vercel deployment

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **UI Components**: shadcn/ui (Radix UI primitives)
- **State Management**: TanStack Query (React Query)
- **Authentication**: NextAuth.js v4 with Cognito
- **HTTP Client**: Axios with interceptors
- **Code Quality**: Biome (linting & formatting)

## Project Structure

```
edforgeadminweb/
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── api/auth/[...nextauth]/  # NextAuth.js API routes
│   │   ├── auth/                 # Auth pages (signin, error)
│   │   ├── tenants/              # Tenant management pages
│   │   ├── dashboard/            # Dashboard page
│   │   ├── layout.tsx            # Root layout (Server Component)
│   │   └── page.tsx              # Home page (redirects to /tenants)
│   ├── components/
│   │   ├── auth/                 # Auth components (Client)
│   │   ├── layout/               # Layout components (Server)
│   │   ├── tenants/              # Tenant components (Client)
│   │   └── ui/                   # shadcn/ui components
│   ├── contexts/                 # React contexts (Client)
│   │   ├── AuthContext.tsx       # SessionProvider wrapper
│   │   └── QueryProvider.tsx     # TanStack Query provider
│   ├── lib/
│   │   ├── api-client.ts         # Axios instance with auth
│   │   ├── auth.ts               # Server-side auth helpers
│   │   ├── query-client.ts       # TanStack Query config
│   │   └── utils.ts              # Utility functions
│   ├── services/                 # API service layer
│   │   └── tenant-service.ts     # Tenant CRUD operations
│   └── types/                    # TypeScript types
│       ├── next-auth.d.ts        # NextAuth type extensions
│       └── tenant.ts             # Tenant types
├── middleware.ts                 # Route protection
├── next.config.ts                # Next.js configuration
├── vercel.json                   # Vercel deployment config
└── package.json
```

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- AWS Cognito User Pool configured
- Backend API Gateway URL

### Local Development Setup

1. **Clone and navigate to the project**:
   ```bash
   cd /Users/shoaibrain/edforge/client/edforgeadminweb
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Create environment file**:
   ```bash
   cp .env.local.example .env.local
   ```

4. **Configure environment variables** in `.env.local`:
   ```env
   # Cognito Configuration
   NEXT_PUBLIC_CLIENT_ID=your_actual_client_id
   NEXT_PUBLIC_ISSUER=https://cognito-idp.ap-northeast-2.amazonaws.com/ap-northeast-2_YourPoolId/oauth2/token
   NEXT_PUBLIC_API_URL=https://your-api-id.execute-api.ap-northeast-2.amazonaws.com/prod
   NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL=https://cognito-idp.ap-northeast-2.amazonaws.com/ap-northeast-2_YourPoolId/.well-known/openid-configuration

   # NextAuth
   NEXTAUTH_SECRET=$(openssl rand -base64 32)
   NEXTAUTH_URL=http://localhost:3000
   ```

5. **Run the development server**:
   ```bash
   npm run dev
   ```

6. **Open your browser**:
   Navigate to [http://localhost:3000](http://localhost:3000)

## Deployment to Vercel

### Option 1: GitHub Integration (Recommended)

1. **Push your code to GitHub**:
   ```bash
   git add .
   git commit -m "Add NextJS admin application"
   git push origin main
   ```

2. **Import project in Vercel**:
   - Go to [vercel.com](https://vercel.com)
   - Click "Add New" → "Project"
   - Import your GitHub repository
   - Select `client/edforgeadminweb` as the root directory

3. **Configure Environment Variables** in Vercel:
   - Go to Project Settings → Environment Variables
   - Add all variables from `.env.local`
   - Make sure to add them for Production, Preview, and Development

4. **Deploy**:
   - Click "Deploy"
   - Vercel will automatically deploy on every push to main

### Option 2: Vercel CLI

1. **Install Vercel CLI**:
   ```bash
   npm install -g vercel
   ```

2. **Login to Vercel**:
   ```bash
   vercel login
   ```

3. **Deploy**:
   ```bash
   cd /Users/shoaibrain/edforge/client/edforgeadminweb
   vercel
   ```

4. **Set environment variables**:
   ```bash
   vercel env add NEXT_PUBLIC_CLIENT_ID
   vercel env add NEXT_PUBLIC_ISSUER
   vercel env add NEXT_PUBLIC_API_URL
   vercel env add NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL
   vercel env add NEXTAUTH_SECRET
   vercel env add NEXTAUTH_URL
   ```

5. **Deploy to production**:
   ```bash
   vercel --prod
   ```

### Post-Deployment Configuration

After deploying to Vercel, you need to update your AWS Cognito settings:

1. **Update Cognito Callback URLs**:
   - Go to AWS Console → Cognito → Your User Pool → App Clients
   - Add your Vercel domain to **Allowed callback URLs**:
     ```
     https://your-app.vercel.app/api/auth/callback/cognito
     ```
   - Add to **Allowed sign-out URLs**:
     ```
     https://your-app.vercel.app
     ```

2. **Update NEXTAUTH_URL**:
   - In Vercel, update the `NEXTAUTH_URL` environment variable:
     ```
     NEXTAUTH_URL=https://your-app.vercel.app
     ```

3. **Redeploy** to apply changes

## Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_CLIENT_ID` | Cognito App Client ID | `abc123def456` |
| `NEXT_PUBLIC_ISSUER` | Cognito Token Endpoint | `https://cognito-idp.region.amazonaws.com/.../oauth2/token` |
| `NEXT_PUBLIC_API_URL` | Backend API Gateway URL | `https://api-id.execute-api.region.amazonaws.com/prod` |
| `NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL` | OIDC Discovery URL | `https://cognito-idp.region.amazonaws.com/.../.well-known/openid-configuration` |
| `NEXTAUTH_SECRET` | Session encryption secret | Generated with `openssl rand -base64 32` |
| `NEXTAUTH_URL` | Application base URL | `http://localhost:3000` or `https://your-app.vercel.app` |
| `COGNITO_CLIENT_SECRET` | (Optional) If using confidential client | `secret123` |

## Development Commands

```bash
# Start development server with Turbopack
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Run linter
npm run lint

# Format code
npm run format
```

## Key Implementation Details

### Authentication Flow

1. User visits protected route
2. Middleware checks for valid session
3. If no session, redirects to `/auth/signin`
4. SignIn page triggers Cognito OAuth flow
5. After successful auth, NextAuth creates session
6. User redirected to original destination

### API Integration

All API calls automatically include:
- Bearer token from NextAuth session
- Proper error handling (401 redirects to signin)
- Request/response interceptors for logging

### Data Fetching Strategy

- **Server Components**: Fetch data directly in component
- **Client Components**: Use TanStack Query hooks
- **Infinite Scroll**: `useInfiniteQuery` for tenant list
- **Mutations**: Optimistic updates with cache invalidation

## Troubleshooting

### "Unauthorized" errors

- Check if `NEXT_PUBLIC_API_URL` is correct
- Verify Cognito callback URLs include your domain
- Ensure JWT token is valid (check Network tab)

### Session not persisting

- Verify `NEXTAUTH_SECRET` is set
- Check `NEXTAUTH_URL` matches your domain
- Clear browser cookies and try again

### Build errors

- Run `npm install` to ensure all dependencies are installed
- Check TypeScript errors with `npm run build`
- Verify all environment variables are set

## Security Considerations

1. **Server-Side Auth Checks**: All sensitive operations use `getServerSession()`
2. **Protected Routes**: Middleware blocks unauthenticated access
3. **Token Injection**: Bearer tokens added automatically, never exposed to client
4. **Environment Variables**: Secrets only in server-side code
5. **HTTPS Only**: Production deployment requires HTTPS

## Contributing

When adding new features:

1. Keep pages as Server Components by default
2. Only use `'use client'` when absolutely necessary
3. Perform auth checks server-side
4. Use TanStack Query for client-side data fetching
5. Follow existing patterns for consistency

## License

Internal use only - EdForge SaaS Platform

## Support

For questions or issues, contact the EdForge development team.
