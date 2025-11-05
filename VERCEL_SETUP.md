# Vercel Deployment Setup Guide

This guide explains how to configure Vercel for automatic deployment of the `edforgewebclient` Next.js application from the monorepo.

## Prerequisites

1. Vercel account (sign up at [vercel.com](https://vercel.com))
2. GitHub repository connected to Vercel
3. Vercel CLI installed (optional, for local testing)

## Step 1: Create Vercel Project

### Via Vercel Dashboard (Recommended)

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click **Add New** → **Project**
3. Import your GitHub repository: `shoaibrain/edforge`
4. Configure project settings:
   - **Framework Preset**: Next.js
   - **Root Directory**: `client/edforgewebclient` (IMPORTANT!)
   - **Build Command**: `npm run build` (runs from root, uses workspace)
   - **Output Directory**: `.next` (default)
   - **Install Command**: `npm install` (default)
   - **Node.js Version**: 20.x

### Via Vercel CLI

```bash
cd client/edforgewebclient
vercel
# Follow prompts to link project
```

## Step 2: Configure Environment Variables

Add these environment variables in Vercel Project Settings → Environment Variables:

### Production Environment

```
NEXT_PUBLIC_CLIENT_ID=your_cognito_client_id
NEXT_PUBLIC_ISSUER=https://cognito-idp.ap-northeast-2.amazonaws.com/ap-northeast-2_YourPool/oauth2/token
NEXT_PUBLIC_API_URL=https://your-api.execute-api.ap-northeast-2.amazonaws.com/prod
NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL=https://cognito-idp.ap-northeast-2.amazonaws.com/ap-northeast-2_YourPool/.well-known/openid-configuration
NEXTAUTH_SECRET=generate_with_openssl_rand_base64_32
NEXTAUTH_URL=https://your-project.vercel.app
```

### Preview Environment (Optional)

For preview deployments, use the same variables but update:
- `NEXTAUTH_URL`: Use preview deployment URL (or wildcard `https://*.vercel.app`)

### Development Environment (Optional)

For local development, create `.env.local` in `client/edforgewebclient/`:

```env
NEXT_PUBLIC_CLIENT_ID=your_dev_client_id
NEXT_PUBLIC_ISSUER=your_dev_issuer
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL=your_dev_well_known_url
NEXTAUTH_SECRET=your_dev_secret
NEXTAUTH_URL=http://localhost:3000
```

## Step 3: Configure GitHub Actions Secrets

For GitHub Actions to deploy to Vercel, add these secrets to your GitHub repository:

1. Go to GitHub repository → **Settings** → **Secrets and variables** → **Actions**
2. Add the following secrets:

- `VERCEL_TOKEN`: Get from [Vercel Account Settings](https://vercel.com/account/tokens)
- `VERCEL_ORG_ID`: Get from [Vercel Team Settings](https://vercel.com/teams/YOUR_TEAM/settings/general)
- `VERCEL_PROJECT_ID`: Get from Vercel project settings → General → Project ID

### How to Get Vercel Tokens:

1. **VERCEL_TOKEN**:
   - Go to [Vercel Account Settings](https://vercel.com/account/tokens)
   - Click "Create Token"
   - Name it "GitHub Actions"
   - Copy the token

2. **VERCEL_ORG_ID**:
   - Go to your Vercel team settings
   - URL will be: `https://vercel.com/teams/[YOUR_ORG_ID]/settings`
   - Copy the org ID from the URL

3. **VERCEL_PROJECT_ID**:
   - Go to your Vercel project settings
   - Navigate to General tab
   - Copy the Project ID

## Step 4: Monorepo Configuration

Since this is a monorepo, Vercel needs special configuration. Create or update `vercel.json` in `client/edforgewebclient/`:

```json
{
  "buildCommand": "cd ../.. && npm run build:client",
  "outputDirectory": ".next",
  "installCommand": "cd ../.. && npm install",
  "framework": "nextjs",
  "rootDirectory": "client/edforgewebclient"
}
```

Alternatively, configure this in Vercel Dashboard:
- **Root Directory**: `client/edforgewebclient`
- **Build Command**: `cd ../.. && npm run build:client`
- **Install Command**: `cd ../.. && npm install`

## Step 5: Test Deployment

### Manual Deployment

```bash
cd client/edforgewebclient
vercel --prod
```

### Automatic Deployment

1. Push to `main` or `master` branch
2. GitHub Actions will automatically:
   - Build shared-types
   - Type check frontend
   - Lint code
   - Build Next.js app
   - Deploy to Vercel

## Deployment Workflow

### Automatic (Recommended)

1. **Push to main branch** → GitHub Actions workflow triggers
2. **Workflow builds and validates** → Type checks, linting, build
3. **Deploys to Vercel** → Production deployment

### Manual (Fallback)

1. Use Vercel Dashboard to trigger deployment
2. Or use Vercel CLI: `vercel --prod`

## Branch Strategy

- **main/master**: Production deployments (automatic via GitHub Actions)
- **Preview branches**: Automatic preview deployments for PRs
- **Feature branches**: Can be manually deployed for testing

## Troubleshooting

### Build Fails: "Cannot find module"

- Ensure `shared-types` is built before frontend build
- Check that `npm run build:shared-types` runs successfully
- Verify workspace configuration in root `package.json`

### Build Fails: "Working directory not found"

- Verify root directory is set to `client/edforgewebclient` in Vercel
- Check that build commands use correct paths

### Environment Variables Not Loading

- Verify environment variables are set in Vercel dashboard
- Check that variable names match exactly (case-sensitive)
- Ensure `NEXT_PUBLIC_*` prefix is used for client-side variables

### Deployment Not Triggering

- Check GitHub Actions secrets are configured
- Verify workflow file paths match changed files
- Check Vercel project ID matches the repository

## Next Steps

1. Configure domain in Vercel (optional)
2. Set up preview deployments for PRs
3. Configure analytics and monitoring
4. Set up custom build optimizations if needed

## References

- [Vercel Monorepo Guide](https://vercel.com/docs/monorepos)
- [Next.js Deployment on Vercel](https://nextjs.org/docs/deployment)
- [GitHub Actions Integration](https://vercel.com/docs/integrations/github)
