#!/bin/bash
# Complete Clean Build and Deploy Script for EdForge
# Usage: ./clean-build-deploy.sh <admin_email> [aws_profile]

set -e  # Exit on error

ADMIN_EMAIL="${1:-shoaib.rain1@gmail.com}"
AWS_PROFILE="${2:-dev}"
PROJECT_ROOT="/Users/shoaibrain/edforge"

echo "=========================================="
echo "EdForge Clean Build and Deploy"
echo "=========================================="
echo "Admin Email: $ADMIN_EMAIL"
echo "AWS Profile: $AWS_PROFILE"
echo "Project Root: $PROJECT_ROOT"
echo ""

# Step 1: Clean Build Artifacts
echo "Step 1: Cleaning all build artifacts and caches..."
cd "$PROJECT_ROOT"

# Clean CDK output and staging
echo "  - Cleaning CDK artifacts..."
find . -type d -name "cdk.out" -exec rm -rf {} + 2>/dev/null || true
find . -type d -name ".cdk.staging" -exec rm -rf {} + 2>/dev/null || true
find . -type f -name "cdk.context.json" -delete 2>/dev/null || true

# Clean TypeScript build artifacts
echo "  - Cleaning TypeScript build artifacts..."
find . -type d -name "dist" -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true
find . -type f -name "*.tsbuildinfo" -delete 2>/dev/null || true
find . -type f -name "next-env.d.ts" -delete 2>/dev/null || true

# Clean Next.js build artifacts
echo "  - Cleaning Next.js build artifacts..."
find . -type d -name ".next" -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true
find . -type d -name "out" -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true
find . -type d -name ".vercel" -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true

# Clean node_modules caches
echo "  - Cleaning node_modules caches..."
find . -type d -name ".cache" -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true
find . -type d -name ".cache" -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true

# Clean npm/yarn caches
echo "  - Cleaning package manager caches..."
rm -rf .npm 2>/dev/null || true
rm -rf .yarn/cache 2>/dev/null || true
rm -rf .pnp* 2>/dev/null || true

# Clean ESLint and other tool caches
echo "  - Cleaning tool caches..."
find . -type f -name ".eslintcache" -delete 2>/dev/null || true
find . -type d -name ".parcel-cache" -exec rm -rf {} + 2>/dev/null || true
find . -type d -name ".rpt2_cache" -exec rm -rf {} + 2>/dev/null || true
find . -type d -name ".rts2_cache" -exec rm -rf {} + 2>/dev/null || true

# Clean server-specific build artifacts
echo "  - Cleaning server build artifacts..."
rm -rf server/cdk.out 2>/dev/null || true
rm -rf server/dist 2>/dev/null || true
rm -rf server/application/dist 2>/dev/null || true
rm -rf server/application/node_modules/.cache 2>/dev/null || true
rm -rf server/node_modules/.cache 2>/dev/null || true

# Clean client-specific build artifacts
echo "  - Cleaning client build artifacts..."
rm -rf client/*/build 2>/dev/null || true
rm -rf client/*/.next 2>/dev/null || true
rm -rf client/*/out 2>/dev/null || true
rm -rf client/*/dist 2>/dev/null || true
rm -rf client/*/node_modules/.cache 2>/dev/null || true

# Clean root caches
echo "  - Cleaning root caches..."
rm -rf node_modules/.cache 2>/dev/null || true

echo "✅ Clean build complete!"
echo ""

# Step 2: Install Dependencies
echo "Step 2: Installing dependencies..."
echo "  - Installing root dependencies..."
npm install

echo "  - Installing server dependencies..."
cd "$PROJECT_ROOT/server"
npm install

cd "$PROJECT_ROOT"
echo "✅ Dependencies installed!"
echo ""

# Step 3: Verify AWS Credentials
echo "Step 3: Verifying AWS credentials..."
if ! aws sts get-caller-identity --profile "$AWS_PROFILE" > /dev/null 2>&1; then
    echo "❌ ERROR: AWS credentials not configured for profile '$AWS_PROFILE'"
    echo "   Run: aws configure --profile $AWS_PROFILE"
    exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query Account --output text)
echo "✅ AWS credentials verified (Account: $ACCOUNT_ID)"
echo ""

# Step 4: Set Environment Variables
echo "Step 4: Setting environment variables..."
export CDK_PARAM_NEXTJS_APP_URL="${CDK_PARAM_NEXTJS_APP_URL:-https://edforge.net}"
echo "  - CDK_PARAM_NEXTJS_APP_URL: $CDK_PARAM_NEXTJS_APP_URL"
echo ""

# Step 5: Deploy
echo "Step 5: Deploying infrastructure..."
echo "  This may take 15-30 minutes..."
echo ""

cd "$PROJECT_ROOT/scripts"
DEPLOY_LOG="deploy-$(date +%Y%m%d-%H%M%S).log"

CDK_NAG_ENABLED=false AWS_PROFILE="$AWS_PROFILE" ./install.sh "$ADMIN_EMAIL" 2>&1 | tee "$DEPLOY_LOG"

DEPLOY_EXIT_CODE=${PIPESTATUS[0]}

if [ $DEPLOY_EXIT_CODE -eq 0 ]; then
    echo ""
    echo "=========================================="
    echo "✅ Deployment completed successfully!"
    echo "=========================================="
    echo ""
    echo "Deployment log saved to: $DEPLOY_LOG"
    echo ""
    echo "Retrieving deployment outputs..."
    
    # Get Admin Site URL
    ADMIN_URL=$(aws cloudformation describe-stacks \
        --stack-name shared-infra-stack \
        --profile "$AWS_PROFILE" \
        --query "Stacks[0].Outputs[?OutputKey=='adminSiteUrl'].OutputValue" \
        --output text 2>/dev/null || echo "N/A")
    
    # Get Application Site URL
    APP_URL=$(aws cloudformation describe-stacks \
        --stack-name shared-infra-stack \
        --profile "$AWS_PROFILE" \
        --query "Stacks[0].Outputs[?OutputKey=='appSiteUrl'].OutputValue" \
        --output text 2>/dev/null || echo "N/A")
    
    echo ""
    echo "Deployment URLs:"
    echo "  Admin Site:    $ADMIN_URL"
    echo "  Application:   $APP_URL"
    echo ""
else
    echo ""
    echo "=========================================="
    echo "❌ Deployment failed with exit code: $DEPLOY_EXIT_CODE"
    echo "=========================================="
    echo ""
    echo "Deployment log saved to: $DEPLOY_LOG"
    echo "Review the log file for error details."
    echo ""
    exit $DEPLOY_EXIT_CODE
fi

