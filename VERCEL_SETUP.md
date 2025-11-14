# Vercel Deployment Setup Guide

This guide explains how to configure Vercel for automatic deployment of the `edforgewebclient` Next.js application from the monorepo.

## Prerequisites

1. Vercel account (sign up at [vercel.com](https://vercel.com))
2. GitHub repository connected to Vercel
3. Vercel CLI installed (optional, for local testing)
4. **Pre-built shared-types**: The `packages/shared-types/dist/` folder must be committed to git (see "Pre-built Shared Types Architecture" section below)

## Step 1: Create Vercel Project

### Via Vercel Dashboard (Recommended)

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click **Add New** → **Project**
3. Import your GitHub repository: `shoaibrain/edforge`
4. Configure project settings:
   - **Framework Preset**: Next.js
   - **Root Directory**: `client/edforgewebclient` (IMPORTANT!)
   - **Build Command**: `cd ../.. && npm run build:client` (runs from monorepo root)
   - **Output Directory**: `.next` (default)
   - **Install Command**: `cd ../.. && npm install` (installs all workspace dependencies)
   - **Node.js Version**: 20.x

**Note**: The `vercel.json` file in `client/edforgewebclient/` already contains these settings, so Vercel will automatically detect them. You can verify or override them in the dashboard if needed.

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

Since this is a monorepo, Vercel needs special configuration. The project includes a `vercel.json` file in `client/edforgewebclient/` with the correct settings:

```json
{
  "buildCommand": "cd ../.. && npm run build:client",
  "outputDirectory": ".next",
  "installCommand": "cd ../.. && npm install",
  "framework": "nextjs"
}
```

**Important**: Do NOT include `rootDirectory` in `vercel.json`. It must be configured in the Vercel Dashboard only. If you set it in both places, Vercel will show an error: "Invalid request: should NOT have additional property 'rootDirectory'."

### Next.js Configuration (Turbopack)

The `next.config.ts` file includes Turbopack root configuration to handle the monorepo structure:

```typescript
import path from "path";
import { fileURLToPath } from "url";

// Get absolute path to monorepo root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const monorepoRoot = path.resolve(__dirname, "../..");

const nextConfig: NextConfig = {
  turbopack: {
    root: monorepoRoot,
  },
};
```

This configuration:
- Uses an absolute path (required by Turbopack) to the monorepo root
- Fixes the warning about multiple lockfiles in monorepo
- Ensures Turbopack correctly detects the workspace root
- Works in both local development and Vercel deployment environments

### Pre-built Shared Types Architecture

This project uses a **pre-built architecture** for the `@edforge/shared-types` package. This is an industry-standard approach that ensures reliable builds in all environments, including Vercel.

**How it works:**
- The `packages/shared-types/dist/` folder is **committed to git** (pre-built)
- TypeScript configuration points to `dist/` instead of `src/`
- No build-time dependencies required in Vercel
- Faster, more reliable builds

**Developer workflow:**
1. Make changes to `packages/shared-types/src/`
2. Run `npm run build:shared-types` from monorepo root
3. Commit both `src/` changes and updated `dist/` folder
4. Push to trigger Vercel deployment

### Build Process Flow

The build process follows this sequence:

1. **Install Dependencies**: `cd ../.. && npm install` (from monorepo root)
   - Installs all workspace dependencies
   - The `packages/shared-types/dist/` folder is already available (committed to git)
   
2. **Build Command**: `cd ../.. && npm run build:client`
   - Runs `cd client/edforgewebclient && npm run build`
   - **No prebuild hook** - shared-types is already built
   - Next.js resolves types from `packages/shared-types/dist/` (via tsconfig paths)
   - Runs `next build --turbopack`

3. **Output**: `.next` directory is generated in `client/edforgewebclient/`

**Key Benefits:**
- ✅ No TypeScript compiler needed in Vercel
- ✅ No `tsc: command not found` errors
- ✅ Faster builds (no compilation step)
- ✅ Works identically in all environments

### Vercel Dashboard Configuration

**CRITICAL**: Configure the Root Directory in the Vercel Dashboard, NOT in `vercel.json`.

In the Vercel Dashboard project settings, configure:
- **Root Directory**: `client/edforgewebclient` (set this in Dashboard → Settings → General)
- **Build Command**: `cd ../.. && npm run build:client` (or leave default if using vercel.json)
- **Install Command**: `cd ../.. && npm install` (or leave default if using vercel.json)
- **Output Directory**: `.next` (default for Next.js)
- **Framework Preset**: Next.js

The `vercel.json` file will automatically be detected and used for build/install commands, but `rootDirectory` must be set in the Dashboard only.

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

### Error: "Invalid request: should NOT have additional property 'rootDirectory'"

**Symptom**: Vercel shows an error when creating/updating the project: "Invalid request: should NOT have additional property 'rootDirectory'."

**Root Cause**: The `rootDirectory` property is set in both `vercel.json` AND the Vercel Dashboard, which causes a conflict.

**Solution**:
1. Remove `rootDirectory` from `client/edforgewebclient/vercel.json` (it should only contain `buildCommand`, `outputDirectory`, `installCommand`, and `framework`)
2. Set the Root Directory ONLY in the Vercel Dashboard:
   - Go to your project → Settings → General
   - Set "Root Directory" to `client/edforgewebclient`
3. Save and redeploy

**Important**: `rootDirectory` must be configured in the Dashboard only, never in `vercel.json`.

### Turbopack Warning: "turbopack.root should be absolute"

**Symptom**: Warning that `turbopack.root` should be an absolute path, not relative.

**Solution**: The `next.config.ts` file uses `path.resolve()` to calculate an absolute path to the monorepo root. If you still see this warning:
- Verify `next.config.ts` uses `path.resolve(__dirname, "../..")` to get the absolute path
- Ensure `import.meta.url` is available (ESM context)
- Check that the configuration is properly exported
- The path should resolve to the monorepo root (where root `package.json` with workspaces exists)

### Build Fails: "Cannot find module @edforge/shared-types"

**Symptom**: TypeScript or build errors about missing shared-types module.

**Root Cause**: The `tsconfig.json` paths may be incorrect, or the `dist/` folder is missing.

**Solution**:
- Verify `tsconfig.json` paths point to `dist/` (not `src/`):
  - `"@edforge/shared-types": ["../../packages/shared-types/dist"]`
  - `"@edforge/shared-types/*": ["../../packages/shared-types/dist/*"]`
- Ensure `packages/shared-types/dist/` folder exists and is committed to git
- If `dist/` is missing, run `npm run build:shared-types` from monorepo root and commit the dist/ folder
- Verify the dist/ folder contains `.d.ts` files (type declarations)
- Check that `packages/shared-types/dist/` is NOT in `.gitignore`

**Note**: This project uses a pre-built architecture. The `dist/` folder should be committed to git and not built during Vercel deployment.

### Build Fails: "Working directory not found"

**Symptom**: Build command fails with directory not found errors.

**Solution**:
- Verify root directory is set to `client/edforgewebclient` in Vercel Dashboard (Settings → General)
- Check that build commands use correct relative paths (`../..` from edforgewebclient)
- **Do NOT** set `rootDirectory` in `vercel.json` (it causes conflicts)
- Verify the repository structure matches expected monorepo layout
- Ensure build commands in `vercel.json` use `cd ../..` to navigate to monorepo root

### Build Fails: "npm install" errors in monorepo

**Symptom**: Dependency installation fails or workspace resolution errors.

**Solution**:
- Ensure `installCommand` runs from monorepo root: `cd ../.. && npm install`
- Verify root `package.json` has correct `workspaces` configuration
- Check that all workspace packages have valid `package.json` files
- Ensure Node.js version is 20.x (specified in `packageManager` field)
- Try using `npm ci` instead of `npm install` for more reliable builds

### Environment Variables Not Loading

**Symptom**: Environment variables are undefined in the application.

**Solution**:
- Verify environment variables are set in Vercel dashboard
- Check that variable names match exactly (case-sensitive)
- Ensure `NEXT_PUBLIC_*` prefix is used for client-side variables
- For server-side variables, ensure they're not prefixed with `NEXT_PUBLIC_`
- Restart deployment after adding new environment variables

### Deployment Not Triggering

**Symptom**: GitHub Actions workflow doesn't trigger or deploy to Vercel.

**Solution**:
- Check GitHub Actions secrets are configured correctly:
  - `VERCEL_TOKEN`
  - `VERCEL_ORG_ID`
  - `VERCEL_PROJECT_ID`
- Verify workflow file paths match changed files in the trigger
- Check Vercel project ID matches the repository
- Ensure workflow has `if` condition for push events to main/master
- Check GitHub Actions logs for specific error messages

### Build Succeeds Locally but Fails on Vercel

**Symptom**: Build works locally but fails in Vercel environment.

**Solution**:
- Compare Node.js versions (should be 20.x)
- Verify all dependencies are in `package.json` (not just `package-lock.json`)
- Check that `prebuild` hook works correctly in CI environment
- Ensure shared-types builds successfully in Vercel build logs
- Verify file paths are correct for Vercel's build environment
- Check for platform-specific dependencies or build tools

## Next Steps

1. Configure domain in Vercel (optional)
2. Set up preview deployments for PRs
3. Configure analytics and monitoring
4. Set up custom build optimizations if needed

## References

- [Vercel Monorepo Guide](https://vercel.com/docs/monorepos)
- [Next.js Deployment on Vercel](https://nextjs.org/docs/deployment)
- [GitHub Actions Integration](https://vercel.com/docs/integrations/github)
