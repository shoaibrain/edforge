# Incremental Deployment Guide

This guide walks you through deploying the email template migration and Application client removal changes incrementally.

## Quick Start

Use the deployment script for step-by-step execution:

```bash
cd /Users/shoaibrain/edforge/scripts
AWS_PROFILE=dev ./deploy-incremental.sh [step]
```

## Deployment Steps

### Step 0: Preparation ✅ (Already Complete)

Environment variables are set and code validated.

### Step 1: Preview Changes

**Review what will change before deploying:**

```bash
cd /Users/shoaibrain/edforge/scripts
AWS_PROFILE=dev ./deploy-incremental.sh diff
```

This shows the CloudFormation diff for each stack. Review carefully.

**Expected Changes:**
- `shared-infra-stack`: Add `NextJsAppUrl` output
- `controlplane-stack`: No changes expected
- `core-appplane-stack`: Remove Application StaticSite resources
- `tenant-template-stack-basic`: Update email templates

### Step 2: Deploy shared-infra-stack

**This adds the NextJS URL configuration:**

```bash
cd /Users/shoaibrain/edforge/scripts
AWS_PROFILE=dev ./deploy-incremental.sh deploy-shared-infra
```

**Or manually:**
```bash
cd /Users/shoaibrain/edforge/server
export CDK_PARAM_NEXTJS_APP_URL="https://edforge.vercel.app"
export CDK_PARAM_SYSTEM_ADMIN_EMAIL="shoaib.rain1@gmail.com"
export CDK_PARAM_TIER="basic"
export CDK_PARAM_STAGE="prod"
export CDK_ADV_CLUSTER="INACTIVE"
export CDK_NAG_ENABLED="false"
export AWS_PROFILE="dev"

npx cdk deploy shared-infra-stack \
  --require-approval never \
  --concurrency 10 \
  --asset-parallelism true
```

**Validate:**
```bash
aws cloudformation describe-stacks \
  --stack-name shared-infra-stack \
  --query "Stacks[0].Outputs[?OutputKey=='NextJsAppUrl'].OutputValue" \
  --output text
```

Should output: `https://edforge.vercel.app`

### Step 3: Verify controlplane-stack

**Check if updates needed (likely no changes):**

```bash
cd /Users/shoaibrain/edforge/server
npx cdk diff controlplane-stack
```

If no changes, skip deployment. If changes detected, deploy:
```bash
npx cdk deploy controlplane-stack \
  --require-approval never \
  --concurrency 10 \
  --asset-parallelism true
```

### Step 4: Deploy core-appplane-stack

**This removes Application StaticSite resources:**

```bash
cd /Users/shoaibrain/edforge/scripts
AWS_PROFILE=dev ./deploy-incremental.sh deploy-core-appplane
```

**Or manually:**
```bash
cd /Users/shoaibrain/edforge/server
# Ensure environment variables are set (from Step 2)

npx cdk deploy core-appplane-stack \
  --require-approval never \
  --concurrency 10 \
  --asset-parallelism true
```

**Validate:**
```bash
# Check NextJsAppUrl output
aws cloudformation describe-stacks \
  --stack-name core-appplane-stack \
  --query "Stacks[0].Outputs[?OutputKey=='NextJsAppUrl'].OutputValue" \
  --output text

# Verify Application StaticSite removed (should return empty)
aws cloudformation describe-stack-resources \
  --stack-name core-appplane-stack \
  --query "StackResources[?contains(LogicalResourceId, 'TenantWebUI')]" \
  --output table
```

### Step 5: Deploy tenant-template-stack-basic

**This updates email templates to use NextJS URL:**

```bash
cd /Users/shoaibrain/edforge/scripts
AWS_PROFILE=dev ./deploy-incremental.sh deploy-tenant-basic
```

**Or manually:**
```bash
cd /Users/shoaibrain/edforge/server
# Ensure environment variables are set
# Get commit ID from S3
export REGION=$(aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]')
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export CDK_PARAM_S3_BUCKET_NAME="saas-reference-architecture-ecs-$ACCOUNT_ID-$REGION"
CDK_SOURCE_NAME="source.tar.gz"
VERSIONS=$(aws s3api list-object-versions --bucket "$CDK_PARAM_S3_BUCKET_NAME" --prefix "$CDK_SOURCE_NAME" --query 'Versions[?IsLatest==`true`].{VersionId:VersionId}' --output text 2>&1)
export CDK_PARAM_COMMIT_ID=$(echo "$VERSIONS" | awk 'NR==1{print $1}')

npx cdk deploy tenant-template-stack-basic \
  --require-approval never \
  --concurrency 10 \
  --asset-parallelism true
```

**Validate Email Template:**
```bash
# Get User Pool ID
USER_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name tenant-template-stack-basic \
  --query "Stacks[0].Outputs[?OutputKey=='TenantUserpoolId'].OutputValue" \
  --output text)

# Check email subject
aws cognito-idp describe-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --query "UserPool.AdminCreateUserConfig.InviteMessageTemplate.EmailSubject" \
  --output text

# Should output: "Welcome to EdForge - Your Account is Ready"
```

**Test Email (Optional but Recommended):**
```bash
# Create a test user to verify email contains NextJS URL
aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username "test-user-$(date +%s)" \
  --user-attributes Name=email,Value="your-test-email@example.com" Name=email_verified,Value="True" \
  --desired-delivery-mediums EMAIL

# Check your email - should contain:
# - Subject: "Welcome to EdForge - Your Account is Ready"
# - Body: https://edforge.vercel.app
```

### Step 6: Final Validation

**Run comprehensive validation:**

```bash
cd /Users/shoaibrain/edforge/scripts
AWS_PROFILE=dev ./deploy-incremental.sh validate-all
```

**Or manually check:**
```bash
# 1. Verify all stacks healthy
aws cloudformation describe-stacks \
  --query "Stacks[?StackStatus!='CREATE_COMPLETE' && StackStatus!='UPDATE_COMPLETE'].{Name:StackName,Status:StackStatus}" \
  --output table

# 2. Verify NextJS URL outputs
aws cloudformation describe-stacks \
  --stack-name shared-infra-stack \
  --query "Stacks[0].Outputs[?OutputKey=='NextJsAppUrl']" \
  --output json

aws cloudformation describe-stacks \
  --stack-name core-appplane-stack \
  --query "Stacks[0].Outputs[?OutputKey=='NextJsAppUrl']" \
  --output json

# 3. Verify Application StaticSite removed
aws cloudformation describe-stack-resources \
  --stack-name core-appplane-stack \
  --query "StackResources[?contains(LogicalResourceId, 'TenantWebUI')]" \
  --output table
```

## Rollback Procedures

### If Any Stack Fails

CloudFormation will automatically rollback. Verify the stack returned to previous state:

```bash
aws cloudformation describe-stacks \
  --stack-name [stack-name] \
  --query "Stacks[0].StackStatus" \
  --output text
```

### Complete Rollback (If Needed)

```bash
# Revert code changes
cd /Users/shoaibrain/edforge
git checkout HEAD~1 server/

# Redeploy affected stacks
cd server
npx cdk deploy shared-infra-stack core-appplane-stack tenant-template-stack-basic
```

## Success Criteria

✅ All stacks in `UPDATE_COMPLETE` or `CREATE_COMPLETE` state  
✅ `NextJsAppUrl` output exists in `shared-infra-stack` and `core-appplane-stack`  
✅ Application StaticSite resources removed from `core-appplane-stack`  
✅ Email subject is "Welcome to EdForge - Your Account is Ready"  
✅ Email body contains `https://edforge.vercel.app`  
✅ Existing basic tenant continues to function normally  

## Important Notes

1. **Existing Tenant Impact:** The existing basic tenant's User Pool email templates will NOT change. Only NEW users created after Step 5 will use the new templates.

2. **Zero Downtime:** This deployment strategy ensures zero downtime. Each stack update is independent and non-breaking.

3. **Application Client:** The Application StaticSite removal is safe because:
   - NextJS app is already deployed to Vercel
   - CloudFront distribution remains (for backward compatibility)
   - No active users depend on the Application client

4. **Testing:** Strongly recommend creating a test user after Step 5 to verify email template works correctly.

## Timeline Estimate

- **Step 1 (Preview):** 2-3 minutes
- **Step 2 (shared-infra-stack):** 2-5 minutes
- **Step 3 (controlplane-stack):** 0-3 minutes (if needed)
- **Step 4 (core-appplane-stack):** 3-7 minutes
- **Step 5 (tenant-template-stack-basic):** 5-10 minutes
- **Step 6 (Validation):** 5-10 minutes

**Total Estimated Time:** 20-40 minutes

