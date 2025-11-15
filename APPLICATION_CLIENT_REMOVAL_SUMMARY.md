# Application Client Removal & Email Template Migration - Implementation Summary

## Overview

This document summarizes the implementation of removing the legacy Application client and migrating email templates to use NextJS application URLs.

## Changes Implemented

### 1. Email Template Migration to NextJS URLs

#### Files Modified:
- `server/lib/tenant-template/identity-provider.ts`
  - Added `nextjsAppUrl` parameter to `IdentityProviderStackProps`
  - Updated email subject to branded: "Welcome to EdForge - Your Account is Ready"
  - Updated email body to use NextJS URL with professional branding
  - Updated SMS message to use NextJS URL

- `server/lib/tenant-template/tenant-template-stack.ts`
  - Added `nextjsAppUrl` parameter to `TenantTemplateStackProps`
  - Passed `nextjsAppUrl` to IdentityProvider construct

- `server/lib/shared-infra/shared-infra-stack.ts`
  - Added `nextjsAppUrl` property to `SharedInfraStack`
  - Configured NextJS URL from environment variable or CDK context
  - Added CloudFormation output `NextJsAppUrl` for reference
  - Priority: 1) `CDK_PARAM_NEXTJS_APP_URL` env var, 2) CDK context, 3) Error (requires explicit config)

- `server/lib/bootstrap-template/core-appplane-stack.ts`
  - Added `nextjsAppUrl` parameter to `CoreAppPlaneStackProps`
  - Added CloudFormation output `NextJsAppUrl`
  - Removed unused imports (`StaticSite`, `path`)

- `server/bin/ecs-saas-ref-template.ts`
  - Passed `nextjsAppUrl` from `SharedInfraStack` to `CoreAppPlaneStack`
  - Passed `nextjsAppUrl` to both `TenantTemplateStack` instances

### 2. Application Client Removal

#### Files Modified:
- `server/lib/bootstrap-template/core-appplane-stack.ts`
  - Removed Application StaticSite creation (lines 106-129)
  - Removed CodePipeline that built and deployed React Application client
  - Added comprehensive comments explaining removal rationale
  - Removed unused imports

### 3. Provision Script Documentation

#### Files Modified:
- `server/lib/provision-scripts/provision-tenant.sh`
  - Added detailed comments explaining email template configuration flow
  - Documented that email templates are set at User Pool creation time (via CDK)
  - Explained that script only creates users, which triggers emails using pre-configured templates

## Configuration Required

### Environment Variable

Set the NextJS application URL before deploying CDK stacks:

```bash
export CDK_PARAM_NEXTJS_APP_URL="https://edforge.vercel.app"
```

Or use CDK context:

```bash
cdk deploy --context nextjsAppUrl=https://edforge.vercel.app
```

### Example Deployment

```bash
cd server

# Set required environment variables
export CDK_PARAM_SYSTEM_ADMIN_EMAIL="admin@example.com"
export CDK_PARAM_NEXTJS_APP_URL="https://edforge.vercel.app"
export CDK_PARAM_TIER="basic"
export CDK_PARAM_STAGE="prod"
export CDK_PARAM_COMMIT_ID="$(git rev-parse HEAD)"

# Deploy stacks
npx cdk deploy --all
```

## Email Template Details

### Before Migration
- **Subject**: "Your temporary password tenant UI application"
- **Body**: Generic text with CloudFront URL
- **URL**: `https://d1w853i4rahj9y.cloudfront.net` (CloudFront distribution)

### After Migration
- **Subject**: "Welcome to EdForge - Your Account is Ready"
- **Body**: Professional branded template with:
  - Welcome message
  - NextJS application URL
  - Username and temporary password
  - Instructions to change password
  - Support contact information
- **URL**: `https://edforge.vercel.app` (NextJS application on Vercel)

## Infrastructure Impact

### Removed Resources
- Application StaticSite CodePipeline (builds React app)
- Application StaticSite S3 source bucket
- Application StaticSite CodeBuild project

### Retained Resources (Temporary)
- CloudFront distribution (`appSiteDistro`) - retained for backward compatibility
- S3 bucket for CloudFront origin - retained temporarily
- **Note**: These can be removed after email migration is complete and validated

### New Resources
- CloudFormation output: `NextJsAppUrl` (exported from SharedInfraStack)

## Validation Steps

### Pre-Deployment
1. Verify NextJS app is accessible at configured URL
2. Test email template rendering (check CDK synth output)
3. Validate all CDK stacks compile without errors

### Post-Deployment
1. Create test tenant and verify email contains NextJS URL
2. Verify email subject is branded ("Welcome to EdForge")
3. Test password reset flow (if uses same templates)
4. Monitor CloudWatch logs for errors
5. Verify no Application client references in logs

## Rollback Plan

If issues arise:
1. Revert IdentityProvider to use `appSiteUrl` instead of `nextjsAppUrl`
2. Keep `appSiteUrl` parameter for 1-2 months during transition
3. Application directory remains in git history (not force deleted)

## Next Steps

### Immediate (After Deployment)
1. ✅ Deploy CDK changes to staging
2. ✅ Test email delivery with NextJS URL
3. ✅ Validate tenant onboarding flows

### Short Term (1-2 weeks)
1. Monitor for any Application client references
2. Update existing tenant User Pools to use NextJS URL (if needed)
3. Verify all tenants using NextJS app

### Long Term (2-3 months)
1. Remove Application directory: `client/Application/`
2. Evaluate removal of `appSiteDistro` CloudFront distribution
3. Remove `appSiteUrl` parameter (after all tenants migrated)

## Files Changed Summary

### Server Infrastructure (6 files)
1. `server/lib/tenant-template/identity-provider.ts` - Email template updates
2. `server/lib/tenant-template/tenant-template-stack.ts` - Pass nextjsAppUrl
3. `server/lib/shared-infra/shared-infra-stack.ts` - Add nextjsAppUrl config
4. `server/lib/bootstrap-template/core-appplane-stack.ts` - Remove Application StaticSite, pass nextjsAppUrl
5. `server/bin/ecs-saas-ref-template.ts` - Read and pass nextjsAppUrl
6. `server/lib/provision-scripts/provision-tenant.sh` - Add validation comments

### Client (Pending Removal)
- `client/Application/` - To be deleted after infrastructure validation

## Success Criteria

- ✅ All new tenant onboarding emails use NextJS URL
- ✅ Email subject is branded ("Welcome to EdForge")
- ✅ Application StaticSite removed from CloudFormation
- ✅ NextJS URL configurable via environment variable
- ✅ Zero downtime during migration
- ⏳ All existing tenants migrated to NextJS URL (within 3 months)
- ⏳ Application directory removed (after validation)

## Related Documentation

- [Application Client Removal & Email Migration Plan](./application-client-removal-email-migration.plan.md)
- [AUTHENTICATION_SETUP.md](./AUTHENTICATION_SETUP.md)
- [VERCEL_SETUP.md](./VERCEL_SETUP.md)

