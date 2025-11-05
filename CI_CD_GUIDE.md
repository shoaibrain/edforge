# CI/CD Workflow Guide

This document explains the Continuous Integration and Continuous Deployment (CI/CD) workflows for the EdForge monorepo.

## Overview

The EdForge monorepo uses **GitHub Actions** for automated CI/CD workflows. Workflows are triggered based on path changes, allowing independent deployment of frontend and backend components.

## Workflow Structure

All workflows are located in `.github/workflows/`:

1. **Frontend Deploy** (`frontend-deploy.yml`) - Deploys Next.js app to Vercel
2. **Backend Validate** (`backend-validate.yml`) - Validates backend code
3. **Shared Types** (`shared-types.yml`) - Validates shared TypeScript types

## Path-Based Triggers

Workflows use path filters to run only when relevant files change:

### Frontend Workflow
- Triggers on changes to:
  - `client/edforgewebclient/**`
  - `packages/shared-types/**`
- Actions:
  - Builds shared-types
  - Type checks frontend
  - Lints code (Biome)
  - Builds Next.js application
  - Deploys to Vercel (production only)

### Backend Workflow
- Triggers on changes to:
  - `server/**`
  - `packages/shared-types/**`
- Actions:
  - Builds shared-types
  - Type checks backend
  - Validates Docker builds
  - Runs linting (if configured)

### Shared Types Workflow
- Triggers on changes to:
  - `packages/shared-types/**`
- Actions:
  - Type checks shared types
  - Builds shared types package
  - Notifies about potential breaking changes

## Deployment Strategy

### Frontend (Automatic)

**Platform**: Vercel

**Process**:
1. Push to `main`/`master` branch
2. GitHub Actions workflow triggers
3. Workflow validates and builds
4. Deployment to Vercel production

**Manual Override**:
- Use Vercel Dashboard
- Or use Vercel CLI: `vercel --prod`

**Configuration**:
- See [VERCEL_SETUP.md](VERCEL_SETUP.md) for setup instructions
- Requires GitHub Secrets:
  - `VERCEL_TOKEN`
  - `VERCEL_ORG_ID`
  - `VERCEL_PROJECT_ID`

### Backend (Manual)

**Platform**: AWS ECS (via CDK)

**Process**:
1. Push to repository triggers validation workflow
2. Validation ensures code quality
3. Manual deployment via CDK:
   ```bash
   cd server
   npm run cdk deploy --all
   ```

**Build Process**:
```bash
# From scripts directory
./build-application.sh
```

**Deployment**:
```bash
# From scripts directory
./install.sh <admin_email>
```

## Workflow Details

### Frontend Deployment Workflow

```yaml
name: Frontend Deploy to Vercel
on:
  push:
    branches: [main, master]
    paths:
      - 'client/edforgewebclient/**'
      - 'packages/shared-types/**'
```

**Steps**:
1. Checkout code
2. Setup Node.js 20
3. Install dependencies (npm workspaces)
4. Build shared-types
5. Type check frontend
6. Lint frontend
7. Build Next.js app
8. Deploy to Vercel

### Backend Validation Workflow

```yaml
name: Backend Validation
on:
  push:
    branches: [main, master, develop]
    paths:
      - 'server/**'
      - 'packages/shared-types/**'
```

**Steps**:
1. Checkout code
2. Setup Node.js 20
3. Install dependencies
4. Build shared-types
5. Type check backend
6. Validate Docker builds (dry run)
7. Check for linting issues

## Branch Strategy

### Main/Master Branch
- **Frontend**: Automatic deployment to Vercel production
- **Backend**: Validation only, manual deployment required

### Feature Branches
- **Frontend**: Can create preview deployments via Vercel
- **Backend**: Validation runs on push

### Pull Requests
- All workflows run on PRs for validation
- No production deployments from PRs

## Caching Strategy

Workflows use npm caching to speed up builds:
- Node modules are cached
- Cache key includes `package-lock.json` hash
- Cache invalidates on dependency changes

## Environment Variables

### GitHub Secrets (Required)

For frontend deployment:
- `VERCEL_TOKEN` - Vercel API token
- `VERCEL_ORG_ID` - Vercel organization ID
- `VERCEL_PROJECT_ID` - Vercel project ID

### Vercel Environment Variables

Configure in Vercel Dashboard:
- `NEXT_PUBLIC_*` - Client-side variables
- `NEXTAUTH_*` - Authentication variables
- API URLs, Cognito settings, etc.

See [VERCEL_SETUP.md](VERCEL_SETUP.md) for complete list.

## Troubleshooting

### Workflow Not Triggering

**Check**:
1. File paths match workflow path filters
2. Branch matches workflow branch filters
3. Workflow file syntax is correct

**Solution**:
- Verify path filters in workflow YAML
- Check GitHub Actions logs for errors

### Frontend Build Fails

**Common Issues**:
- Shared-types not built
- Missing dependencies
- Type errors

**Solution**:
- Ensure `npm run build:shared-types` succeeds
- Check for TypeScript errors
- Verify workspace configuration

### Vercel Deployment Fails

**Common Issues**:
- Missing environment variables
- Incorrect root directory
- Build command errors

**Solution**:
- Verify Vercel project settings
- Check environment variables in Vercel dashboard
- Review build logs in Vercel

### Backend Validation Fails

**Common Issues**:
- Type errors
- Docker build failures
- Missing dependencies

**Solution**:
- Fix TypeScript errors
- Check Dockerfile syntax
- Verify all dependencies installed

## Best Practices

1. **Commit Messages**: Use clear, descriptive messages
2. **Branch Naming**: Use `feature/`, `fix/`, `hotfix/` prefixes
3. **Testing**: Run tests locally before pushing
4. **Shared Types**: Update shared types carefully to avoid breaking changes
5. **Deployment**: Always validate locally before pushing to main

## Monitoring

### GitHub Actions
- View workflow runs in GitHub repository → Actions tab
- Check logs for detailed error messages
- Set up notifications for failed workflows

### Vercel
- Monitor deployments in Vercel Dashboard
- Check build logs for errors
- Review deployment analytics

## Future Enhancements

Potential improvements:
- [ ] Automated testing in CI/CD
- [ ] E2E testing workflow
- [ ] Backend deployment automation
- [ ] Staging environment workflows
- [ ] Performance testing
- [ ] Security scanning
- [ ] Dependency updates automation
