#!/bin/bash -e
# Incremental CDK Stack Deployment Script
# This script helps deploy the email template migration and Application client removal changes
# Usage: ./deploy-incremental.sh [step]
# Steps: prep, validate, check-rollback-state, deploy-core-appplane, deploy-shared-infra, deploy-tenant-basic, validate-all
# IMPORTANT: Deployment order matters due to CloudFormation export dependencies:
#   1. core-appplane-stack (removes resources that import exports)
#   2. shared-infra-stack (removes exports)
#   3. tenant-template-stack-basic (updates email templates)

set -e

export PAGER=""
export CDK_PARAM_SYSTEM_ADMIN_EMAIL="${CDK_PARAM_SYSTEM_ADMIN_EMAIL:-shoaib.rain1@gmail.com}"
export CDK_PARAM_NEXTJS_APP_URL="${CDK_PARAM_NEXTJS_APP_URL:-https://edforge.vercel.app}"
export CDK_PARAM_TIER="${CDK_PARAM_TIER:-basic}"
export CDK_PARAM_STAGE="${CDK_PARAM_STAGE:-prod}"
export CDK_ADV_CLUSTER="${CDK_ADV_CLUSTER:-INACTIVE}"
export CDK_BASIC_CLUSTER="${CDK_PARAM_STAGE}-${CDK_PARAM_TIER}"
export CDK_NAG_ENABLED="${CDK_NAG_ENABLED:-false}"
export AWS_PROFILE="${AWS_PROFILE:-dev}"

# Get commit ID from S3 (required for tenant stacks)
export REGION=$(aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]')
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export CDK_PARAM_S3_BUCKET_NAME="saas-reference-architecture-ecs-$ACCOUNT_ID-$REGION"
CDK_SOURCE_NAME="source.tar.gz"
VERSIONS=$(aws s3api list-object-versions --bucket "$CDK_PARAM_S3_BUCKET_NAME" --prefix "$CDK_SOURCE_NAME" --query 'Versions[?IsLatest==`true`].{VersionId:VersionId}' --output text 2>&1)
export CDK_PARAM_COMMIT_ID=$(echo "$VERSIONS" | awk 'NR==1{print $1}')

export CDK_DISABLE_NOTICES=true

# Change to server directory
cd "$(dirname "$0")/../server"

STEP="${1:-prep}"

case "$STEP" in
  prep)
    echo "=========================================="
    echo "Step 0: Preparation & Environment Setup"
    echo "=========================================="
    echo ""
    echo "Environment Variables:"
    echo "  CDK_PARAM_SYSTEM_ADMIN_EMAIL: $CDK_PARAM_SYSTEM_ADMIN_EMAIL"
    echo "  CDK_PARAM_NEXTJS_APP_URL: $CDK_PARAM_NEXTJS_APP_URL"
    echo "  CDK_PARAM_TIER: $CDK_PARAM_TIER"
    echo "  CDK_PARAM_STAGE: $CDK_PARAM_STAGE"
    echo "  CDK_PARAM_COMMIT_ID: $CDK_PARAM_COMMIT_ID"
    echo "  AWS_PROFILE: $AWS_PROFILE"
    echo "  REGION: $REGION"
    echo ""
    echo "Installing dependencies..."
    npm install
    echo ""
    echo "✅ Preparation complete!"
    echo ""
    echo "Next steps:"
    echo "  1. Run: ./deploy-incremental.sh validate"
    echo "  2. Review the changes with: ./deploy-incremental.sh diff"
    echo "  3. Check rollback state: ./deploy-incremental.sh check-rollback-state"
    echo "  4. Deploy core-appplane-stack FIRST: ./deploy-incremental.sh deploy-core-appplane"
    echo "  5. Deploy shared-infra-stack: ./deploy-incremental.sh deploy-shared-infra"
    ;;
    
  validate)
    echo "=========================================="
    echo "Step 0.2: Validate Code Changes"
    echo "=========================================="
    echo ""
    echo "Synthesizing stacks to validate code compiles..."
    echo ""
    echo "⚠️  Note: Docker must be running for Python Lambda layer build"
    echo ""
    
    echo "📦 Synthesizing shared-infra-stack..."
    if npx cdk synth shared-infra-stack > /dev/null 2>&1; then
      echo "  ✅ shared-infra-stack"
    else
      echo "  ⚠️  shared-infra-stack synthesis failed (may need Docker running)"
      echo "     This is often due to Python Lambda layer build requiring Docker."
      echo "     If the layer already exists in AWS, deployment may still work."
      echo "     Continue? (y/N)"
      read -p "     " -n 1 -r
      echo
      if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "     Validation cancelled. Please start Docker and try again."
        exit 1
      fi
      echo "     Continuing with other stacks..."
    fi
    
    echo "📦 Synthesizing controlplane-stack..."
    npx cdk synth controlplane-stack > /dev/null && echo "  ✅ controlplane-stack" || (echo "  ❌ controlplane-stack failed" && exit 1)
    
    echo "📦 Synthesizing core-appplane-stack..."
    npx cdk synth core-appplane-stack > /dev/null && echo "  ✅ core-appplane-stack" || (echo "  ❌ core-appplane-stack failed" && exit 1)
    
    echo "📦 Synthesizing tenant-template-stack-basic..."
    npx cdk synth tenant-template-stack-basic > /dev/null && echo "  ✅ tenant-template-stack-basic" || (echo "  ❌ tenant-template-stack-basic failed" && exit 1)
    
    echo ""
    echo "✅ All stacks validated successfully!"
    ;;
    
  diff)
    echo "=========================================="
    echo "Step 0.3: Preview Changes (cdk diff)"
    echo "=========================================="
    echo ""
    echo "⚠️  Review these changes carefully before deploying!"
    echo ""
    
    echo "📊 Diff for shared-infra-stack:"
    echo "----------------------------------------"
    npx cdk diff shared-infra-stack || true
    echo ""
    
    echo "📊 Diff for controlplane-stack:"
    echo "----------------------------------------"
    npx cdk diff controlplane-stack || true
    echo ""
    
    echo "📊 Diff for core-appplane-stack:"
    echo "----------------------------------------"
    npx cdk diff core-appplane-stack || true
    echo ""
    
    echo "📊 Diff for tenant-template-stack-basic:"
    echo "----------------------------------------"
    npx cdk diff tenant-template-stack-basic || true
    echo ""
    echo "✅ Diff complete. Review changes above."
    ;;
    
  check-rollback-state)
    echo "=========================================="
    echo "Checking Stack Rollback State"
    echo "=========================================="
    echo ""
    
    STACK_STATUS=$(aws cloudformation describe-stacks \
      --stack-name shared-infra-stack \
      --query "Stacks[0].StackStatus" \
      --output text 2>/dev/null || echo "NOT_FOUND")
    
    echo "Current shared-infra-stack status: $STACK_STATUS"
    echo ""
    
    if [[ "$STACK_STATUS" == "UPDATE_ROLLBACK_COMPLETE" ]]; then
      echo "⚠️  Stack is in UPDATE_ROLLBACK_COMPLETE state."
      echo "This is safe - the rollback has completed."
      echo "We can proceed with deployment in the correct order."
      echo ""
      echo "✅ Stack is ready for deployment."
      return 0
    elif [[ "$STACK_STATUS" == "UPDATE_ROLLBACK_IN_PROGRESS" ]]; then
      echo "⚠️  Stack is still rolling back. Please wait for rollback to complete."
      echo "Check CloudFormation console for progress."
      return 1
    elif [[ "$STACK_STATUS" == "UPDATE_IN_PROGRESS" ]]; then
      echo "⚠️  Stack update is in progress. Please wait for it to complete."
      return 1
    else
      echo "✅ Stack status is normal: $STACK_STATUS"
      return 0
    fi
    ;;
    
  deploy-shared-infra)
    echo "=========================================="
    echo "Phase 2: Deploy shared-infra-stack"
    echo "=========================================="
    echo ""
    echo "⚠️  IMPORTANT: This must be deployed AFTER core-appplane-stack"
    echo "    to avoid export dependency conflicts."
    echo ""
    echo "This adds the nextjsAppUrl configuration and removes old exports."
    echo ""
    
    # Check if core-appplane-stack still has resources using the exports
    echo "Checking if core-appplane-stack still imports the bucket exports..."
    STATIC_SITE_RESOURCES=$(aws cloudformation describe-stack-resources \
      --stack-name core-appplane-stack \
      --query "StackResources[?contains(LogicalResourceId, 'TenantWebUI') || contains(LogicalResourceId, 'AppSite')]" \
      --output json 2>/dev/null || echo "[]")
    
    RESOURCE_COUNT=$(echo "$STATIC_SITE_RESOURCES" | jq '. | length' 2>/dev/null || echo "0")
    
    if [ "$RESOURCE_COUNT" -gt "0" ]; then
      echo ""
      echo "❌ ERROR: core-appplane-stack still has $RESOURCE_COUNT resources that use the bucket exports."
      echo "   You must deploy core-appplane-stack FIRST to remove these resources."
      echo "   Run: ./deploy-incremental.sh deploy-core-appplane"
      exit 1
    fi
    
    echo "  ✅ No conflicting resources found. Safe to proceed."
    echo ""
    read -p "Continue with deployment? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Deployment cancelled."
      exit 1
    fi
    
    npx cdk deploy shared-infra-stack \
      --require-approval never \
      --concurrency 10 \
      --asset-parallelism true
    
    echo ""
    echo "✅ Deployment complete!"
    echo ""
    echo "Validating NextJsAppUrl output..."
    NEXTJS_URL=$(aws cloudformation describe-stacks \
      --stack-name shared-infra-stack \
      --query "Stacks[0].Outputs[?OutputKey=='NextJsAppUrl'].OutputValue" \
      --output text 2>/dev/null || echo "")
    
    if [ -n "$NEXTJS_URL" ]; then
      echo "  ✅ NextJsAppUrl: $NEXTJS_URL"
    else
      echo "  ⚠️  NextJsAppUrl output not found. Check stack outputs manually."
    fi
    ;;
    
  deploy-core-appplane)
    echo "=========================================="
    echo "Phase 1: Deploy core-appplane-stack"
    echo "=========================================="
    echo ""
    echo "⚠️  IMPORTANT: This must be deployed FIRST"
    echo "    to remove resources that import bucket exports from shared-infra-stack."
    echo ""
    echo "This removes Application StaticSite resources (CodePipeline, CodeBuild, S3)."
    echo ""
    read -p "Continue with deployment? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Deployment cancelled."
      exit 1
    fi
    
    npx cdk deploy core-appplane-stack \
      --require-approval never \
      --concurrency 10 \
      --asset-parallelism true
    
    echo ""
    echo "✅ Deployment complete!"
    echo ""
    echo "Validating changes..."
    NEXTJS_URL=$(aws cloudformation describe-stacks \
      --stack-name core-appplane-stack \
      --query "Stacks[0].Outputs[?OutputKey=='NextJsAppUrl'].OutputValue" \
      --output text 2>/dev/null || echo "")
    
    if [ -n "$NEXTJS_URL" ]; then
      echo "  ✅ NextJsAppUrl: $NEXTJS_URL"
    fi
    
    echo ""
    echo "Checking for Application StaticSite resources..."
    STATIC_SITE_RESOURCES=$(aws cloudformation describe-stack-resources \
      --stack-name core-appplane-stack \
      --query "StackResources[?contains(LogicalResourceId, 'TenantWebUI') || contains(LogicalResourceId, 'AppSite')]" \
      --output json 2>/dev/null || echo "[]")
    
    RESOURCE_COUNT=$(echo "$STATIC_SITE_RESOURCES" | jq '. | length' 2>/dev/null || echo "0")
    if [ "$RESOURCE_COUNT" -eq "0" ]; then
      echo "  ✅ Application StaticSite resources removed"
    else
      echo "  ⚠️  Found $RESOURCE_COUNT Application StaticSite resources. Check manually."
    fi
    ;;
    
  deploy-tenant-basic)
    echo "=========================================="
    echo "Phase 4: Deploy tenant-template-stack-basic"
    echo "=========================================="
    echo ""
    echo "This updates email templates to use NextJS URL."
    echo "⚠️  This will update the User Pool email templates."
    echo ""
    read -p "Continue with deployment? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Deployment cancelled."
      exit 1
    fi
    
    npx cdk deploy tenant-template-stack-basic \
      --require-approval never \
      --concurrency 10 \
      --asset-parallelism true
    
    echo ""
    echo "✅ Deployment complete!"
    echo ""
    echo "Validating email template..."
    USER_POOL_ID=$(aws cloudformation describe-stacks \
      --stack-name tenant-template-stack-basic \
      --query "Stacks[0].Outputs[?OutputKey=='TenantUserpoolId'].OutputValue" \
      --output text 2>/dev/null || echo "")
    
    if [ -n "$USER_POOL_ID" ]; then
      EMAIL_SUBJECT=$(aws cognito-idp describe-user-pool \
        --user-pool-id "$USER_POOL_ID" \
        --query "UserPool.AdminCreateUserConfig.InviteMessageTemplate.EmailSubject" \
        --output text 2>/dev/null || echo "")
      
      if [ -n "$EMAIL_SUBJECT" ]; then
        echo "  ✅ Email Subject: $EMAIL_SUBJECT"
        if [[ "$EMAIL_SUBJECT" == *"Welcome to EdForge"* ]]; then
          echo "  ✅ Email template updated correctly!"
        else
          echo "  ⚠️  Email subject doesn't match expected value"
        fi
      else
        echo "  ⚠️  Could not retrieve email subject"
      fi
    else
      echo "  ⚠️  Could not retrieve User Pool ID"
    fi
    ;;
    
  validate-all)
    echo "=========================================="
    echo "Step 6: Comprehensive Post-Deployment Validation"
    echo "=========================================="
    echo ""
    
    echo "6.1 Checking stack health..."
    UNHEALTHY_STACKS=$(aws cloudformation describe-stacks \
      --query "Stacks[?StackStatus!='CREATE_COMPLETE' && StackStatus!='UPDATE_COMPLETE'].{Name:StackName,Status:StackStatus}" \
      --output json 2>/dev/null || echo "[]")
    
    UNHEALTHY_COUNT=$(echo "$UNHEALTHY_STACKS" | jq '. | length' 2>/dev/null || echo "0")
    if [ "$UNHEALTHY_COUNT" -eq "0" ]; then
      echo "  ✅ All stacks are healthy"
    else
      echo "  ⚠️  Found $UNHEALTHY_COUNT unhealthy stack(s):"
      echo "$UNHEALTHY_STACKS" | jq -r '.[] | "    - \(.Name): \(.Status)"' 2>/dev/null || echo "$UNHEALTHY_STACKS"
    fi
    
    echo ""
    echo "6.2 Verifying NextJS URL configuration..."
    SHARED_NEXTJS=$(aws cloudformation describe-stacks \
      --stack-name shared-infra-stack \
      --query "Stacks[0].Outputs[?OutputKey=='NextJsAppUrl'].OutputValue" \
      --output text 2>/dev/null || echo "")
    
    if [ -n "$SHARED_NEXTJS" ]; then
      echo "  ✅ shared-infra-stack NextJsAppUrl: $SHARED_NEXTJS"
    else
      echo "  ❌ shared-infra-stack NextJsAppUrl not found"
    fi
    
    CORE_NEXTJS=$(aws cloudformation describe-stacks \
      --stack-name core-appplane-stack \
      --query "Stacks[0].Outputs[?OutputKey=='NextJsAppUrl'].OutputValue" \
      --output text 2>/dev/null || echo "")
    
    if [ -n "$CORE_NEXTJS" ]; then
      echo "  ✅ core-appplane-stack NextJsAppUrl: $CORE_NEXTJS"
    else
      echo "  ❌ core-appplane-stack NextJsAppUrl not found"
    fi
    
    echo ""
    echo "6.3 Verifying Application StaticSite removal..."
    STATIC_SITE_RESOURCES=$(aws cloudformation describe-stack-resources \
      --stack-name core-appplane-stack \
      --query "StackResources[?contains(LogicalResourceId, 'TenantWebUI')]" \
      --output json 2>/dev/null || echo "[]")
    
    RESOURCE_COUNT=$(echo "$STATIC_SITE_RESOURCES" | jq '. | length' 2>/dev/null || echo "0")
    if [ "$RESOURCE_COUNT" -eq "0" ]; then
      echo "  ✅ Application StaticSite resources removed"
    else
      echo "  ⚠️  Found $RESOURCE_COUNT Application StaticSite resource(s)"
    fi
    
    echo ""
    echo "✅ Validation complete!"
    echo ""
    echo "Next: Test email template by creating a test user (see plan Step 6.4)"
    ;;
    
  *)
    echo "Usage: $0 [step]"
    echo ""
    echo "Steps:"
    echo "  prep                  - Set up environment variables and install dependencies"
    echo "  validate              - Validate code compiles (cdk synth)"
    echo "  diff                  - Preview changes (cdk diff)"
    echo "  check-rollback-state  - Check if stacks are in rollback state"
    echo "  deploy-core-appplane  - Deploy core-appplane-stack (MUST BE FIRST)"
    echo "  deploy-shared-infra   - Deploy shared-infra-stack (MUST BE AFTER core-appplane)"
    echo "  deploy-tenant-basic   - Deploy tenant-template-stack-basic"
    echo "  validate-all          - Run comprehensive post-deployment validation"
    echo ""
    echo "Example:"
    echo "  $0 prep"
    echo "  $0 validate"
    echo "  $0 diff"
    echo "  $0 check-rollback-state"
    echo "  $0 deploy-core-appplane  # Deploy this FIRST"
    echo "  $0 deploy-shared-infra    # Deploy this AFTER core-appplane"
    exit 1
    ;;
esac

