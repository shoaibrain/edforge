# API Gateway Deployment Guide

**Last Updated**: 2025-11-04  
**Purpose**: Guide for deploying API Gateway configuration changes to AWS

## Overview

The EdForge EMIS application uses AWS API Gateway as the central entry point for all microservice API calls. The API Gateway configuration is defined in `tenant-api-prod.json` (Swagger/OpenAPI 2.0 specification) and deployed via AWS CDK as part of the `shared-infra-stack`.

### Architecture

- **API Gateway**: REST API that receives all client requests
- **Lambda Authorizer**: Validates JWT tokens and extracts tenant context
- **VPC Link**: Private connection from API Gateway to Network Load Balancer (NLB)
- **Network Load Balancer**: Routes requests to ECS microservices
- **http_proxy Integration**: API Gateway forwards requests transparently to backend services

### Key Components

1. **Swagger Definition** (`server/lib/tenant-api-prod.json`)
   - Defines all API endpoints, methods, and integrations
   - Read directly from filesystem during CDK synthesis
   - Placeholders (e.g., `{{connection_id}}`, `{{integration_uri}}`) replaced at deploy time

2. **CDK Stack** (`server/lib/shared-infra/shared-infra-stack.ts`)
   - Creates API Gateway using `SpecRestApi` construct
   - Reads and processes `tenant-api-prod.json`
   - Deploys to `prod` stage (configurable)

3. **Lambda Authorizer** (`server/lib/shared-infra/Resources/tenant_authorizer.py`)
   - Validates JWT tokens from Cognito
   - Extracts `tenantId` from JWT claims
   - Injects `tenantPath` header for tenant isolation

## When to Deploy API Gateway Only

Deploy only the `shared-infra-stack` when:

- ✅ Adding new API endpoints to `tenant-api-prod.json`
- ✅ Modifying existing endpoint configurations
- ✅ Updating CORS headers or OPTIONS methods
- ✅ Changing API Gateway integration settings
- ✅ Updating Lambda Authorizer configuration

**You do NOT need to:**
- ❌ Rebuild Docker images for microservices
- ❌ Push new images to ECR
- ❌ Restart ECS services
- ❌ Create new S3 tar.gz for provisioning

**Note**: Microservice code changes require separate build/deploy process via `build-application.sh`.

## Deployment Process

### Prerequisites

1. AWS CLI configured with appropriate profile (`AWS_PROFILE=dev`)
2. CDK CLI installed (`npm install -g aws-cdk`)
3. Node.js dependencies installed (`npm install` in `server/` directory)
4. Valid `tenant-api-prod.json` (JSON syntax validated)

### Step 1: Validate JSON Syntax

```bash
cd /Users/shoaibrain/edforge/server/lib

# Using jq (if installed)
jq . tenant-api-prod.json > /dev/null && echo "✓ JSON is valid" || echo "✗ JSON has errors"

# Using Node.js (alternative)
node -e "try { JSON.parse(require('fs').readFileSync('tenant-api-prod.json', 'utf8')); console.log('✓ JSON is valid'); } catch (e) { console.error('✗ JSON has errors:', e.message); process.exit(1); }"
```

### Step 2: Set Required Environment Variables

```bash
cd /Users/shoaibrain/edforge/server

# Required variables
export CDK_PARAM_SYSTEM_ADMIN_EMAIL="your-admin@email.com"
export CDK_PARAM_TIER='basic'
export CDK_PARAM_STAGE='prod'
export CDK_ADV_CLUSTER='INACTIV'
export CDK_BASIC_CLUSTER="$CDK_PARAM_STAGE-$CDK_PARAM_TIER"

# CDK_PARAM_COMMIT_ID is required but not used by SharedInfraStack
# Use a descriptive value for tracking
export CDK_PARAM_COMMIT_ID="api-gateway-update-$(date +%Y%m%d%H%M%S)"

# Optional but recommended
export CDK_NAG_ENABLED=false
export AWS_PROFILE=dev
```

### Step 3: Synthesize CloudFormation Template (Optional but Recommended)

```bash
# Generate CloudFormation template without deploying
npx cdk synth shared-infra-stack

# Check output in cdk.out/shared-infra-stack.template.json
# Verify new endpoints are present:
grep -A 5 "your-new-endpoint" cdk.out/shared-infra-stack.template.json
```

### Step 4: Preview Changes (Optional)

```bash
# See what will change in AWS
npx cdk diff shared-infra-stack
```

### Step 5: Deploy

```bash
# Deploy only the shared-infra-stack
npx cdk deploy shared-infra-stack --require-approval=never
```

**Deployment Time**: Typically 1-2 minutes for API Gateway configuration updates.

### Step 6: Verify Deployment

1. **Check API Gateway Console**:
   - Navigate to AWS Console → API Gateway → APIs → TenantAPI
   - Verify new endpoints appear in Resources
   - Check deployment status shows latest deployment ID

2. **Verify Stage**:
   - Go to Stages → `prod`
   - Confirm "Active deployment" shows new deployment ID
   - Note the "Invoke URL" (e.g., `https://oi090f8udg.execute-api.us-east-1.amazonaws.com/prod`)

3. **Test Endpoint** (using curl or Postman):
   ```bash
   # Test OPTIONS (CORS preflight)
   curl -X OPTIONS \
     -H "Origin: http://localhost:3000" \
     -H "Access-Control-Request-Method: GET" \
     https://oi090f8udg.execute-api.us-east-1.amazonaws.com/prod/schools/{schoolId}/academic-years/{yearId}/grading-periods
   
   # Test GET (with auth token)
   curl -X GET \
     -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     https://oi090f8udg.execute-api.us-east-1.amazonaws.com/prod/schools/{schoolId}/academic-years/{yearId}/grading-periods
   ```

## Troubleshooting

### Error: `CDK_PARAM_COMMIT_ID is empty`

**Solution**: Set `CDK_PARAM_COMMIT_ID` environment variable (can be any value for API Gateway-only deployments).

```bash
export CDK_PARAM_COMMIT_ID="api-update-$(date +%Y%m%d%H%M%S)"
```

### Error: `JSON has errors`

**Solution**: Validate JSON syntax using tools above. Common issues:
- Missing commas between object properties
- Trailing commas in arrays/objects
- Unmatched brackets/braces

### Error: `--app is required`

**Solution**: Ensure you're in the `server/` directory where `cdk.json` exists.

### API Gateway Changes Not Reflecting

**Possible Causes**:
1. **Deployment not propagated**: Wait 10-30 seconds after deployment completes
2. **Browser cache**: Hard refresh (Cmd+Shift+R) or clear cache
3. **Wrong stage**: Verify you're testing against the `prod` stage
4. **CloudFront cache** (if using): Clear CloudFront cache or wait for TTL

**Solution**: Check API Gateway console → Stages → `prod` → Deployment history to confirm latest deployment is active.

### 403 Forbidden After Deployment

**Possible Causes**:
1. Endpoint not in API Gateway (check Resources)
2. Lambda Authorizer rejecting request (check CloudWatch logs)
3. Missing `tenantPath` header (should be injected by authorizer)

**Solution**: 
1. Verify endpoint exists in `tenant-api-prod.json`
2. Check CloudWatch logs for authorizer: `/aws/lambda/shared-infra-stack-AuthorizerFunction*`
3. Verify JWT token is valid and contains `custom:tenantId` claim

## Continuous Deployment Workflow

### For API Gateway-Only Changes

```bash
# 1. Edit tenant-api-prod.json
vim server/lib/tenant-api-prod.json

# 2. Validate JSON
cd server/lib && jq . tenant-api-prod.json > /dev/null

# 3. Set environment variables
cd ../server
export CDK_PARAM_SYSTEM_ADMIN_EMAIL="your-email@example.com"
export CDK_PARAM_TIER='basic'
export CDK_PARAM_STAGE='prod'
export CDK_ADV_CLUSTER='INACTIV'
export CDK_BASIC_CLUSTER="$CDK_PARAM_STAGE-$CDK_PARAM_TIER"
export CDK_PARAM_COMMIT_ID="api-update-$(date +%Y%m%d%H%M%S)"
export CDK_NAG_ENABLED=false
export AWS_PROFILE=dev

# 4. Deploy
npx cdk deploy shared-infra-stack --require-approval=never

# 5. Verify
# Check API Gateway console and test endpoints
```

### For Microservice Code Changes

```bash
# 1. Build and push Docker images
cd /Users/shoaibrain/edforge/scripts
./build-application.sh

# 2. Deploy tenant stacks (ECS services will pull new images)
cd ../server
# (Set environment variables as above)
npx cdk deploy tenant-template-stack-basic --require-approval=never
```

### For Both API Gateway and Microservice Changes

```bash
# 1. Build microservices first
cd /Users/shoaibrain/edforge/scripts
./build-application.sh

# 2. Deploy infrastructure (includes API Gateway updates)
cd ../scripts
./install.sh your-admin@email.com
```

## Best Practices

1. **Always validate JSON** before deploying
2. **Use `cdk synth`** to preview changes
3. **Use `cdk diff`** to see what will change
4. **Test in staging** before production (if available)
5. **Monitor CloudWatch logs** after deployment
6. **Document endpoint changes** in `API_CONTRACT.md`

## Related Documentation

- `API_CONTRACT.md`: API endpoint compliance tracking
- `server/lib/shared-infra/api-gateway.ts`: CDK API Gateway construct
- `server/lib/tenant-api-prod.json`: Swagger/OpenAPI specification
- `server/lib/shared-infra/Resources/tenant_authorizer.py`: Lambda Authorizer

## Support

For issues or questions:
1. Check CloudWatch logs for API Gateway and Lambda Authorizer
2. Review API Gateway console for deployment status
3. Verify `tenant-api-prod.json` syntax and structure
4. Ensure environment variables are set correctly

