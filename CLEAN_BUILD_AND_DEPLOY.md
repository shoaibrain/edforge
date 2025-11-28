# Complete Clean Build and Deployment Guide

This guide provides step-by-step instructions for performing a complete clean build and deployment of EdForge to AWS.

## Prerequisites

1. **AWS CLI configured** with `dev` profile:
   ```bash
   aws configure --profile dev
   ```

2. **Node.js 20+** installed and available in PATH

3. **CDK CLI** installed globally (optional, but recommended):
   ```bash
   npm install -g aws-cdk
   ```

4. **Environment Variables** (optional - install.sh sets defaults):
   - `CDK_PARAM_NEXTJS_APP_URL` (defaults to `https://edforge.net` if not set)

## Step 1: Complete Clean Build

### 1.1 Navigate to Project Root
```bash
cd /Users/shoaibrain/edforge
```

### 1.2 Clean All Build Artifacts and Caches

Run the following commands to remove all build artifacts, caches, and temporary files:

```bash
# Clean CDK output and staging
echo "Cleaning CDK artifacts..."
find . -type d -name "cdk.out" -exec rm -rf {} + 2>/dev/null || true
find . -type d -name ".cdk.staging" -exec rm -rf {} + 2>/dev/null || true
find . -type f -name "cdk.context.json" -delete 2>/dev/null || true

# Clean TypeScript build artifacts
echo "Cleaning TypeScript build artifacts..."
find . -type d -name "dist" -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true
find . -type f -name "*.tsbuildinfo" -delete 2>/dev/null || true
find . -type f -name "next-env.d.ts" -delete 2>/dev/null || true

# Clean Next.js build artifacts
echo "Cleaning Next.js build artifacts..."
find . -type d -name ".next" -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true
find . -type d -name "out" -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true
find . -type d -name ".vercel" -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true

# Clean node_modules caches
echo "Cleaning node_modules caches..."
find . -type d -name ".cache" -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true
find . -type d -name ".cache" -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true

# Clean npm/yarn caches
echo "Cleaning package manager caches..."
rm -rf .npm 2>/dev/null || true
rm -rf .yarn/cache 2>/dev/null || true
rm -rf .pnp* 2>/dev/null || true

# Clean ESLint and other tool caches
echo "Cleaning tool caches..."
find . -type f -name ".eslintcache" -delete 2>/dev/null || true
find . -type d -name ".parcel-cache" -exec rm -rf {} + 2>/dev/null || true
find . -type d -name ".rpt2_cache" -exec rm -rf {} + 2>/dev/null || true
find . -type d -name ".rts2_cache" -exec rm -rf {} + 2>/dev/null || true

# Clean server-specific build artifacts
echo "Cleaning server build artifacts..."
rm -rf server/cdk.out 2>/dev/null || true
rm -rf server/dist 2>/dev/null || true
rm -rf server/application/dist 2>/dev/null || true
rm -rf server/application/node_modules/.cache 2>/dev/null || true
rm -rf server/node_modules/.cache 2>/dev/null || true

# Clean client-specific build artifacts
echo "Cleaning client build artifacts..."
rm -rf client/*/build 2>/dev/null || true
rm -rf client/*/.next 2>/dev/null || true
rm -rf client/*/out 2>/dev/null || true
rm -rf client/*/dist 2>/dev/null || true
rm -rf client/*/node_modules/.cache 2>/dev/null || true

# Clean root caches
echo "Cleaning root caches..."
rm -rf node_modules/.cache 2>/dev/null || true

echo "✅ Clean build complete!"
```

### 1.3 One-Line Clean Script (Alternative)

You can also use this single command to clean everything:

```bash
cd /Users/shoaibrain/edforge && \
find . -type d \( -name "cdk.out" -o -name ".cdk.staging" -o -name "dist" -o -name ".next" -o -name "out" -o -name ".cache" -o -name ".vercel" \) -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null; \
find . -type f \( -name "*.tsbuildinfo" -o -name "cdk.context.json" -o -name ".eslintcache" \) -not -path "*/node_modules/*" -delete 2>/dev/null; \
rm -rf server/cdk.out server/dist server/application/dist server/*/node_modules/.cache node_modules/.cache 2>/dev/null; \
echo "✅ Clean build complete!"
```

## Step 2: Install Dependencies

### 2.1 Install Root Dependencies
```bash
cd /Users/shoaibrain/edforge
npm install
```

### 2.2 Install Server Dependencies
```bash
cd /Users/shoaibrain/edforge/server
npm install
```

### 2.3 Verify Shared Types (Optional)
If you've made changes to shared types, rebuild them:

```bash
cd /Users/shoaibrain/edforge
npm run build:shared-types
```

## Step 3: Pre-Deployment Verification

### 3.1 Verify AWS Credentials
```bash
aws sts get-caller-identity --profile dev
```

Expected output should show your AWS account ID and user/role.

### 3.2 Verify Environment Variables
```bash
# Set NextJS URL if not already set
export CDK_PARAM_NEXTJS_APP_URL="${CDK_PARAM_NEXTJS_APP_URL:-https://edforge.net}"
echo "NextJS App URL: $CDK_PARAM_NEXTJS_APP_URL"
```

### 3.3 Verify CDK Bootstrap (Optional)
The install.sh script will bootstrap if needed, but you can verify:

```bash
cd /Users/shoaibrain/edforge/server
npx cdk bootstrap aws://ACCOUNT_ID/us-east-1 --profile dev
```

Replace `ACCOUNT_ID` with your AWS account ID.

## Step 4: Deploy Infrastructure

### 4.1 Run Deployment Script

```bash
cd /Users/shoaibrain/edforge/scripts
CDK_NAG_ENABLED=false AWS_PROFILE=dev ./install.sh shoaib.rain1@gmail.com 2>&1 | tee deploy-$(date +%Y%m%d-%H%M%S).log
```

### 4.2 What the Script Does

The `install.sh` script performs the following:

1. **Generates API Keys** (if not provided):
   - Premium Tier API Key
   - Advanced Tier API Key
   - Basic Tier API Key

2. **Sets Up S3 Bucket** for provision source

3. **Creates ECS Service Linked Role** (if needed)

4. **Sets Environment Variables**:
   - `CDK_PARAM_SYSTEM_ADMIN_EMAIL` (from argument)
   - `CDK_PARAM_NEXTJS_APP_URL` (defaults to `https://edforge.net`)
   - `CDK_PARAM_TIER` (set to `basic`)
   - `CDK_PARAM_STAGE` (set to `prod`)
   - And other required CDK parameters

5. **Bootstraps CDK** (if needed)

6. **Deploys All Stacks**:
   - `shared-infra-stack` - Foundation infrastructure
   - `controlplane-stack` - Control plane with Cognito
   - `core-appplane-stack` - Tenant provisioning
   - `tenant-template-stack-basic` - Tenant infrastructure

7. **Outputs Deployment URLs**:
   - Admin site URL
   - Application site URL

### 4.3 Monitor Deployment

The deployment process typically takes **15-30 minutes**. Monitor the output for:

- ✅ Stack creation progress
- ⚠️ Warnings (usually safe to ignore)
- ❌ Errors (will stop deployment)

### 4.4 Check Deployment Status

In another terminal, you can check CloudFormation stack status:

```bash
aws cloudformation describe-stacks --stack-name shared-infra-stack --profile dev --query 'Stacks[0].StackStatus' --output text
```

## Step 5: Post-Deployment Verification

### 5.1 Verify Stack Outputs

```bash
# Get Admin Site URL
aws cloudformation describe-stacks \
  --stack-name shared-infra-stack \
  --profile dev \
  --query "Stacks[0].Outputs[?OutputKey=='adminSiteUrl'].OutputValue" \
  --output text

# Get Application Site URL
aws cloudformation describe-stacks \
  --stack-name shared-infra-stack \
  --profile dev \
  --query "Stacks[0].Outputs[?OutputKey=='appSiteUrl'].OutputValue" \
  --output text
```

### 5.2 Verify ECS Services

```bash
# List ECS clusters
aws ecs list-clusters --profile dev

# List services in basic cluster
aws ecs list-services --cluster prod-basic --profile dev
```

### 5.3 Check Deployment Logs

Review the deployment log file created in the `scripts` directory:

```bash
ls -lt /Users/shoaibrain/edforge/scripts/deploy-*.log | head -1
```

## Troubleshooting

### Issue: CDK Bootstrap Fails

**Solution**: Manually bootstrap CDK:
```bash
cd /Users/shoaibrain/edforge/server
npx cdk bootstrap aws://ACCOUNT_ID/us-east-1 --profile dev
```

### Issue: S3 Bucket Already Exists

**Solution**: This is normal. The script checks for existing buckets and reuses them.

### Issue: ECS Service Linked Role Missing

**Solution**: The script automatically creates this. If it fails, create manually:
```bash
aws iam create-service-linked-role --aws-service-name ecs.amazonaws.com --profile dev
```

### Issue: Deployment Fails on Specific Stack

**Solution**: 
1. Check CloudFormation events:
   ```bash
   aws cloudformation describe-stack-events --stack-name STACK_NAME --profile dev
   ```
2. Review the deployment log for specific errors
3. Fix the issue and redeploy:
   ```bash
   cd /Users/shoaibrain/edforge/server
   npx cdk deploy STACK_NAME --profile dev
   ```

### Issue: TypeScript Compilation Errors

**Solution**: These are usually non-blocking for CDK deployment. CDK uses `ts-node` which compiles on-the-fly. If you want to fix them:
```bash
cd /Users/shoaibrain/edforge/server
npm run build
```

## Quick Reference: Complete Clean Build and Deploy

For a complete clean build and deploy in one go:

```bash
# 1. Clean everything
cd /Users/shoaibrain/edforge && \
find . -type d \( -name "cdk.out" -o -name ".cdk.staging" -o -name "dist" -o -name ".next" -o -name "out" -o -name ".cache" \) -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null; \
find . -type f \( -name "*.tsbuildinfo" -o -name "cdk.context.json" -o -name ".eslintcache" \) -not -path "*/node_modules/*" -delete 2>/dev/null; \
rm -rf server/cdk.out server/dist server/application/dist server/*/node_modules/.cache node_modules/.cache 2>/dev/null; \
echo "✅ Clean complete!"

# 2. Install dependencies
npm install && cd server && npm install && cd ..

# 3. Deploy
cd scripts && CDK_NAG_ENABLED=false AWS_PROFILE=dev ./install.sh shoaib.rain1@gmail.com 2>&1 | tee deploy-$(date +%Y%m%d-%H%M%S).log
```

## Notes

- **Deployment Time**: Initial deployment takes 15-30 minutes
- **Stack Dependencies**: Stacks deploy in order due to dependencies
- **Rollback**: If deployment fails, CloudFormation automatically rolls back
- **Cost**: Be aware of AWS resource costs during deployment
- **Logs**: All deployment output is saved to timestamped log files

## Support

For issues or questions:
1. Check the deployment log file
2. Review CloudFormation stack events
3. Check AWS CloudWatch logs for service-specific errors
4. Review the project documentation in `README.md` and `DEPLOYMENT_GUIDE.md`

