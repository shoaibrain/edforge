# AWS CLI Operations Guide for EdForge

> **Purpose**: Practical AWS CLI workflows for daily development operations without needing full CDK redeployments.

**Last Updated**: December 30, 2025

---

## Table of Contents

1. [Quick Reference](#quick-reference)
2. [Daily Development Workflows](#daily-development-workflows)
3. [Service Management](#service-management)
4. [Debugging and Troubleshooting](#debugging-and-troubleshooting)
5. [Infrastructure Updates](#infrastructure-updates)
6. [Best Practices](#best-practices)

---

## Quick Reference

### When to Use What

| Task | Tool | Time | Command |
|------|------|------|---------|
| Update application code | AWS CLI | 5-10 min | `aws ecs update-service --force-new-deployment` |
| Scale service up/down | AWS CLI | 2 min | `aws ecs update-service --desired-count N` |
| View service logs | AWS CLI | Instant | `aws logs tail /ecs/{service} --follow` |
| Add new API route | CDK | 10-15 min | `npx cdk deploy shared-infra-stack` |
| Add new service | CDK | 15-20 min | `npx cdk deploy tenant-template-stack-basic` |
| Change IAM policies | CDK | 10-15 min | `npx cdk deploy tenant-template-stack-basic` |
| Rollback deployment | AWS CLI | 5 min | `aws ecs update-service --task-definition {old}` |
| Check service health | AWS CLI | Instant | `aws ecs describe-services` |

### Environment Setup

```bash
# Set AWS profile for all commands
export AWS_PROFILE=dev
export AWS_REGION=us-east-1

# Commonly used variables
export CLUSTER_NAME=prod-basic
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export REGION=$(aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]')
```

### Common Clusters and Services

```bash
# Clusters
prod-basic                    # Basic tier (shared)
prod-advanced-{accountId}     # Advanced tier (shared)
prod-{tenantId}              # Premium tier (dedicated per tenant)

# Services (Basic Tier)
identitybasic                 # Identity/auth service
academicsbasic               # Academics service
rproxybasic                  # Reverse proxy

# Services (Premium Tier - example)
identitypremium-tenant123
academicspremium-tenant123
rproxypremium-tenant123
```

---

## Daily Development Workflows

### Scenario 1: Update Application Code (Most Common)

**Use Case**: You changed TypeScript code in Identity or Academics service

**Time**: 5-10 minutes

**Steps**:

```bash
# Step 1: Navigate to scripts directory
cd /Users/shoaibrain/edforge/scripts

# Step 2: Build and push new Docker images
AWS_PROFILE=dev ./build-application.sh

# What this does:
# - Builds shared-types package
# - Builds Docker images for identity, academics, rproxy
# - Pushes images to ECR with 'latest' tag

# Step 3: Force ECS to deploy new images
AWS_PROFILE=dev aws ecs update-service \
  --cluster prod-basic \
  --service identitybasic \
  --force-new-deployment \
  --region us-east-1

AWS_PROFILE=dev aws ecs update-service \
  --cluster prod-basic \
  --service academicsbasic \
  --force-new-deployment \
  --region us-east-1

AWS_PROFILE=dev aws ecs update-service \
  --cluster prod-basic \
  --service rproxybasic \
  --force-new-deployment \
  --region us-east-1

# Step 4: Monitor deployment progress
AWS_PROFILE=dev aws ecs describe-services \
  --cluster prod-basic \
  --services identitybasic academicsbasic rproxybasic \
  --region us-east-1 \
  --query 'services[*].{name:serviceName,status:status,running:runningCount,desired:desiredCount,deployments:deployments[*].{status:status,desired:desiredCount,running:runningCount}}'

# Step 5: Watch logs for new tasks
AWS_PROFILE=dev aws logs tail /ecs/identitybasic --follow
```

**What Happens**:
- ✅ New Docker images are pulled from ECR
- ✅ New tasks are created with updated code
- ✅ Old tasks are drained gracefully (zero downtime)
- ❌ **NO CDK deployment required**
- ❌ **NO infrastructure changes**

**Troubleshooting**:
- If deployment stuck: Check service events (see [Debugging](#debugging-and-troubleshooting))
- If tasks crash: Check CloudWatch logs
- If image pull fails: Verify ECR repository exists

---

### Scenario 2: Add New API Route

**Use Case**: Add `/teachers` endpoint to Academics service

**Time**: 10-15 minutes

**Steps**:

```bash
# Step 1: Update OpenAPI specification
vim /Users/shoaibrain/edforge/server/lib/tenant-api-prod.json

# Add new route definition (example):
{
  "paths": {
    "/teachers": {
      "get": {
        "parameters": [{
          "name": "tenantPath",
          "in": "header",
          "required": true,
          "type": "string"
        }],
        "responses": {},
        "security": [{
          "sharedApigatewayTenantApiAuthorizer": []
        }],
        "x-amazon-apigateway-integration": {
          "type": "http_proxy",
          "connectionId": "{{connection_id}}",
          "httpMethod": "ANY",
          "uri": "{{integration_uri}}/teachers",
          "requestParameters": {
            "integration.request.header.tenantPath": "context.authorizer.tenantPath"
          },
          "connectionType": "VPC_LINK",
          "passthroughBehavior": "when_no_match"
        }
      }
    }
  }
}

# Step 2: Deploy SharedInfraStack (updates API Gateway)
cd /Users/shoaibrain/edforge/server
AWS_PROFILE=dev npx cdk deploy shared-infra-stack --require-approval=never

# Step 3: Implement controller in academics service
vim /Users/shoaibrain/edforge/server/application/microservices/academics/src/teachers/teachers.controller.ts

# Example implementation:
@Controller('teachers')
export class TeachersController {
  @Get()
  async findAll(@Request() req) {
    const tenantId = req.user.tenantId;
    return await this.teachersService.findAll(tenantId);
  }
}

# Step 4: Update NGINX proxy configuration (if needed)
vim /Users/shoaibrain/edforge/server/application/reverseproxy/nginx.template

# Add route:
location /teachers {
    proxy_pass http://academics-api.${NAMESPACE}.sc:3010;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
}

# Step 5: Build and deploy application code
cd /Users/shoaibrain/edforge/scripts
AWS_PROFILE=dev ./build-application.sh

AWS_PROFILE=dev aws ecs update-service \
  --cluster prod-basic \
  --service academicsbasic \
  --force-new-deployment \
  --region us-east-1

AWS_PROFILE=dev aws ecs update-service \
  --cluster prod-basic \
  --service rproxybasic \
  --force-new-deployment \
  --region us-east-1

# Step 6: Test new endpoint
API_URL=$(AWS_PROFILE=dev aws cloudformation describe-stacks \
  --stack-name shared-infra-stack \
  --query "Stacks[0].Outputs[?OutputKey=='ApiGatewayUrl'].OutputValue" \
  --output text)

curl -X GET "$API_URL/teachers" \
  -H "Authorization: Bearer {JWT_TOKEN}" \
  -H "x-api-key: {API_KEY}"
```

**Why Both Steps Are Needed**:
- API Gateway needs to know about the new route (infrastructure)
- Application code needs to implement the endpoint logic (application)

---

### Scenario 3: Change Environment Variable (Application-Level)

**Use Case**: Update a hardcoded URL or configuration in application code

**Time**: 5-10 minutes

**If Variable is Hardcoded in Application**:

```bash
# Step 1: Update the variable in your TypeScript code
vim /Users/shoaibrain/edforge/server/application/microservices/academics/src/config/config.ts

# Change:
export const config = {
  identityServiceUrl: 'http://identity-api.basic.sc:3010',  // Old
  tenantServiceUrl: 'http://tenant-api.basic.sc:3010'       // Old
}

# To:
export const config = {
  identityServiceUrl: process.env.IDENTITY_SERVICE_URL,
  tenantServiceUrl: process.env.TENANT_SERVICE_URL
}

# Step 2: Build and deploy
cd /Users/shoaibrain/edforge/scripts
AWS_PROFILE=dev ./build-application.sh

AWS_PROFILE=dev aws ecs update-service \
  --cluster prod-basic \
  --service academicsbasic \
  --force-new-deployment \
  --region us-east-1
```

**If Variable is in service-info.txt**:

```bash
# Step 1: Update service-info.txt
vim /Users/shoaibrain/edforge/server/service-info.txt

# Change environment section:
"environment": {
  "TABLE_NAME": "edforge-academics-<TIER>",
  "NEW_VARIABLE": "new-value"  # Add this
}

# Step 2: Deploy TenantTemplateStack (updates task definition)
cd /Users/shoaibrain/edforge/server
AWS_PROFILE=dev npx cdk deploy tenant-template-stack-basic --require-approval=never

# Note: CDK required because environment variables in task definition are infrastructure
```

**Decision Guide**:
- **Hardcoded in app** → Application update (no CDK)
- **In service-info.txt** → Infrastructure update (CDK required)

---

### Scenario 4: Fix a Bug and Deploy Quickly

**Use Case**: Critical production bug, need fast deployment

**Time**: 5 minutes

**Steps**:

```bash
# Step 1: Fix the bug in your code
vim /Users/shoaibrain/edforge/server/application/microservices/academics/src/students/students.service.ts

# Step 2: Build ONLY the affected service (faster)
cd /Users/shoaibrain/edforge/server/application

# Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  ${ACCOUNT_ID}.dkr.ecr.us-east-1.amazonaws.com

# Build only academics (from monorepo root)
cd /Users/shoaibrain/edforge
docker build -t ${ACCOUNT_ID}.dkr.ecr.us-east-1.amazonaws.com/academics:latest \
  -f server/application/Dockerfile.academics .

# Push
docker push ${ACCOUNT_ID}.dkr.ecr.us-east-1.amazonaws.com/academics:latest

# Step 3: Force immediate deployment
AWS_PROFILE=dev aws ecs update-service \
  --cluster prod-basic \
  --service academicsbasic \
  --force-new-deployment \
  --region us-east-1

# Step 4: Monitor deployment
AWS_PROFILE=dev aws ecs describe-services \
  --cluster prod-basic \
  --services academicsbasic \
  --region us-east-1 \
  --query 'services[0].deployments[*].{status:status,desired:desiredCount,running:runningCount,createdAt:createdAt}'

# Step 5: Watch for errors in real-time
AWS_PROFILE=dev aws logs tail /ecs/academicsbasic --follow --since 5m
```

**Pro Tip**: For even faster deployment, increase `maximumPercent` to 200 and `minimumHealthyPercent` to 0 in service-info.txt (for dev only!).

---

### Scenario 5: Test Changes Locally Before Deployment

**Use Case**: Want to verify changes work before pushing to AWS

**Steps**:

```bash
# Step 1: Build Docker image locally
cd /Users/shoaibrain/edforge
docker build -t academics-local:latest \
  -f server/application/Dockerfile.academics .

# Step 2: Run container locally
docker run -p 3010:3010 \
  -e TABLE_NAME=edforge-academics-basic \
  -e AWS_REGION=us-east-1 \
  -e PORT=3010 \
  -e AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID} \
  -e AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY} \
  -e AWS_SESSION_TOKEN=${AWS_SESSION_TOKEN} \
  academics-local:latest

# Step 3: Test locally
curl http://localhost:3010/health

curl -X POST http://localhost:3010/students \
  -H "Content-Type: application/json" \
  -d '{"firstName":"John","lastName":"Doe","grade":"10"}'

# Step 4: If tests pass, deploy to AWS
# (Use normal deployment workflow)
```

---

## Service Management

### List All Services

```bash
# List services in a cluster
AWS_PROFILE=dev aws ecs list-services \
  --cluster prod-basic \
  --region us-east-1

# List with more details
AWS_PROFILE=dev aws ecs list-services \
  --cluster prod-basic \
  --region us-east-1 \
  --output table
```

### Describe Service

```bash
# Get detailed service information
AWS_PROFILE=dev aws ecs describe-services \
  --cluster prod-basic \
  --services identitybasic \
  --region us-east-1

# Formatted output (most useful info)
AWS_PROFILE=dev aws ecs describe-services \
  --cluster prod-basic \
  --services identitybasic \
  --region us-east-1 \
  --query 'services[0].{name:serviceName,status:status,running:runningCount,desired:desiredCount,pendingCount:pendingCount,taskDefinition:taskDefinition,events:events[0:3]}'

# Check recent events (for debugging)
AWS_PROFILE=dev aws ecs describe-services \
  --cluster prod-basic \
  --services identitybasic \
  --region us-east-1 \
  --query 'services[0].events[0:10]' \
  --output table
```

### Scale Service

```bash
# Scale up to 3 tasks
AWS_PROFILE=dev aws ecs update-service \
  --cluster prod-basic \
  --service academicsbasic \
  --desired-count 3 \
  --region us-east-1

# Scale down to 1 task
AWS_PROFILE=dev aws ecs update-service \
  --cluster prod-basic \
  --service academicsbasic \
  --desired-count 1 \
  --region us-east-1

# Verify scaling
AWS_PROFILE=dev aws ecs describe-services \
  --cluster prod-basic \
  --services academicsbasic \
  --region us-east-1 \
  --query 'services[0].{desired:desiredCount,running:runningCount,pending:pendingCount}'
```

### Stop All Tasks (Force Restart)

```bash
# List running tasks
TASKS=$(AWS_PROFILE=dev aws ecs list-tasks \
  --cluster prod-basic \
  --service-name identitybasic \
  --region us-east-1 \
  --query 'taskArns[]' \
  --output text)

# Stop each task (ECS will automatically start new ones)
for TASK in $TASKS; do
  AWS_PROFILE=dev aws ecs stop-task \
    --cluster prod-basic \
    --task $TASK \
    --reason "Manual restart" \
    --region us-east-1
done

# Wait for new tasks to start
sleep 30

# Verify new tasks are running
AWS_PROFILE=dev aws ecs list-tasks \
  --cluster prod-basic \
  --service-name identitybasic \
  --region us-east-1 \
  --query 'taskArns[]'
```

### Update Service Configuration

```bash
# Update task definition (use specific revision)
AWS_PROFILE=dev aws ecs update-service \
  --cluster prod-basic \
  --service identitybasic \
  --task-definition identity:10 \
  --region us-east-1

# Update deployment configuration
AWS_PROFILE=dev aws ecs update-service \
  --cluster prod-basic \
  --service identitybasic \
  --deployment-configuration "maximumPercent=200,minimumHealthyPercent=100" \
  --region us-east-1

# Enable circuit breaker (prevents bad deployments)
AWS_PROFILE=dev aws ecs update-service \
  --cluster prod-basic \
  --service identitybasic \
  --deployment-configuration "deploymentCircuitBreaker={enable=true,rollback=true}" \
  --region us-east-1
```

---

## Debugging and Troubleshooting

### View Service Logs

```bash
# Tail logs in real-time
AWS_PROFILE=dev aws logs tail /ecs/identitybasic --follow

# View last 100 lines
AWS_PROFILE=dev aws logs tail /ecs/identitybasic --since 10m

# Filter logs by pattern
AWS_PROFILE=dev aws logs tail /ecs/identitybasic \
  --follow \
  --filter-pattern "ERROR"

# View logs for specific time range
AWS_PROFILE=dev aws logs tail /ecs/identitybasic \
  --since 2025-12-30T10:00:00 \
  --until 2025-12-30T11:00:00

# Save logs to file
AWS_PROFILE=dev aws logs tail /ecs/identitybasic \
  --since 1h > identity-logs.txt
```

### Inspect Task Failures

```bash
# Get failed task ARNs
FAILED_TASKS=$(AWS_PROFILE=dev aws ecs list-tasks \
  --cluster prod-basic \
  --desired-status STOPPED \
  --region us-east-1 \
  --query 'taskArns[0:5]' \
  --output text)

# Describe failed tasks
for TASK in $FAILED_TASKS; do
  echo "=== Task: $TASK ==="
  AWS_PROFILE=dev aws ecs describe-tasks \
    --cluster prod-basic \
    --tasks $TASK \
    --region us-east-1 \
    --query 'tasks[0].{status:lastStatus,stoppedReason:stoppedReason,containers:containers[*].{name:name,exitCode:exitCode,reason:reason}}'
  echo ""
done

# Common failure reasons:
# - "Essential container in task exited" → Application crash
# - "CannotPullContainerError" → ECR image not found
# - "ResourceInitializationError" → Cannot allocate resources
# - "OutOfMemoryError" → Task memory too low
```

### Check ECS Agent Status

```bash
# For EC2-based clusters only
AWS_PROFILE=dev aws ecs list-container-instances \
  --cluster prod-basic \
  --region us-east-1

INSTANCE_ARN=$(AWS_PROFILE=dev aws ecs list-container-instances \
  --cluster prod-basic \
  --region us-east-1 \
  --query 'containerInstanceArns[0]' \
  --output text)

AWS_PROFILE=dev aws ecs describe-container-instances \
  --cluster prod-basic \
  --container-instances $INSTANCE_ARN \
  --region us-east-1 \
  --query 'containerInstances[0].{status:status,agentConnected:agentConnected,runningTasks:runningTasksCount,cpu:remainingResources[?name==`CPU`].integerValue,memory:remainingResources[?name==`MEMORY`].integerValue}'
```

### Verify Load Balancer Health

```bash
# Get target group for a service
ALB_ARN=$(AWS_PROFILE=dev aws cloudformation describe-stacks \
  --stack-name shared-infra-stack \
  --query "Stacks[0].Outputs[?OutputKey=='ALBArn'].OutputValue" \
  --output text)

# List target groups
AWS_PROFILE=dev aws elbv2 describe-target-groups \
  --load-balancer-arn $ALB_ARN \
  --region us-east-1

# Check health of targets in a specific target group
TARGET_GROUP_ARN="arn:aws:elasticloadbalancing:us-east-1:123456789:targetgroup/..."

AWS_PROFILE=dev aws elbv2 describe-target-health \
  --target-group-arn $TARGET_GROUP_ARN \
  --region us-east-1

# Common health check failures:
# - "Target.Timeout" → Service not responding on health check path
# - "Target.FailedHealthChecks" → Health check returning non-200
# - "Target.InvalidInstance" → Task is not reachable
```

### Check API Gateway

```bash
# Get API Gateway ID
API_ID=$(AWS_PROFILE=dev aws cloudformation describe-stacks \
  --stack-name shared-infra-stack \
  --query "Stacks[0].Outputs[?OutputKey=='ApiGatewayUrl'].OutputValue" \
  --output text | cut -d'/' -f3 | cut -d'.' -f1)

# Describe API
AWS_PROFILE=dev aws apigateway get-rest-api \
  --rest-api-id $API_ID \
  --region us-east-1

# Get API resources (routes)
AWS_PROFILE=dev aws apigateway get-resources \
  --rest-api-id $API_ID \
  --region us-east-1

# Get API Gateway logs
AWS_PROFILE=dev aws logs tail /aws/apigateway/$API_ID --follow

# Test invoke (for debugging authorizer)
AWS_PROFILE=dev aws apigateway test-invoke-authorizer \
  --rest-api-id $API_ID \
  --authorizer-id {authorizerId} \
  --headers Authorization="Bearer {token}",x-api-key="{key}" \
  --region us-east-1
```

### Check DynamoDB Access

```bash
# List tables
AWS_PROFILE=dev aws dynamodb list-tables --region us-east-1

# Describe table
AWS_PROFILE=dev aws dynamodb describe-table \
  --table-name edforge-academics-basic \
  --region us-east-1

# Check recent activity (CloudWatch metrics)
AWS_PROFILE=dev aws cloudwatch get-metric-statistics \
  --namespace AWS/DynamoDB \
  --metric-name ConsumedReadCapacityUnits \
  --dimensions Name=TableName,Value=edforge-academics-basic \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum \
  --region us-east-1

# Scan table (check for data - use carefully!)
AWS_PROFILE=dev aws dynamodb scan \
  --table-name edforge-academics-basic \
  --limit 10 \
  --region us-east-1
```

### Rollback Deployment

```bash
# List task definition revisions
AWS_PROFILE=dev aws ecs list-task-definitions \
  --family-prefix identity \
  --region us-east-1 \
  --sort DESC \
  --max-items 10

# Current task definition
CURRENT_TD=$(AWS_PROFILE=dev aws ecs describe-services \
  --cluster prod-basic \
  --services identitybasic \
  --region us-east-1 \
  --query 'services[0].taskDefinition' \
  --output text)

echo "Current task definition: $CURRENT_TD"

# Rollback to previous revision
# Example: identity:10 → identity:9
PREVIOUS_TD="identity:9"

AWS_PROFILE=dev aws ecs update-service \
  --cluster prod-basic \
  --service identitybasic \
  --task-definition $PREVIOUS_TD \
  --force-new-deployment \
  --region us-east-1

# Monitor rollback
AWS_PROFILE=dev aws ecs describe-services \
  --cluster prod-basic \
  --services identitybasic \
  --region us-east-1 \
  --query 'services[0].deployments'

# Verify logs show old code is running
AWS_PROFILE=dev aws logs tail /ecs/identitybasic --follow
```

---

## Infrastructure Updates

### Add New Service to Architecture

**Use Case**: Add Finance service to handle billing/invoicing

**Time**: 15-20 minutes

**Steps**:

```bash
# Step 1: Update service-info.txt
vim /Users/shoaibrain/edforge/server/service-info.txt

# Add to "Containers" array:
{
  "name": "finance",
  "image": "<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/finance",
  "memoryLimitMiB": 512,
  "cpu": 256,
  "containerPort": 3010,
  "database": {
    "kind": "dynamodb",
    "sortKey": "entityKey"
  },
  "policy": {
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": ["dynamodb:*"],
      "Resource": "arn:aws:dynamodb:<REGION>:<ACCOUNT_ID>:table/edforge-finance-*"
    }]
  },
  "portMappings": [{
    "name": "finance",
    "containerPort": 3010,
    "appProtocol": "ecs.AppProtocol.http",
    "protocol": "ecs.Protocol.TCP"
  }],
  "environment": {
    "TABLE_NAME": "edforge-finance-<TIER>",
    "AWS_REGION": "<REGION>",
    "PORT": "3010"
  }
}

# Step 2: Create service code structure
mkdir -p /Users/shoaibrain/edforge/server/application/microservices/finance/src

# Step 3: Create Dockerfile
vim /Users/shoaibrain/edforge/server/application/Dockerfile.finance

# Step 4: Update build-application.sh
vim /Users/shoaibrain/edforge/scripts/build-application.sh

# Add "finance" to SERVICE_REPOS array:
SERVICE_REPOS=(
  "identity"
  "academics"
  "finance"      # Add this line
  "rproxy"
)

# Step 5: Update nginx.template
vim /Users/shoaibrain/edforge/server/application/reverseproxy/nginx.template

# Add routes:
location /invoices {
    proxy_pass http://finance-api.${NAMESPACE}.sc:3010;
}

# Step 6: Build Docker image
cd /Users/shoaibrain/edforge/scripts
AWS_PROFILE=dev ./build-application.sh

# Step 7: Deploy infrastructure (creates ECS service, DynamoDB table, IAM roles)
cd /Users/shoaibrain/edforge/server
AWS_PROFILE=dev npx cdk deploy tenant-template-stack-basic --require-approval=never

# Step 8: Verify service is running
AWS_PROFILE=dev aws ecs describe-services \
  --cluster prod-basic \
  --services financebasic \
  --region us-east-1 \
  --query 'services[0].{status:status,running:runningCount,desired:desiredCount}'

# Step 9: Check logs
AWS_PROFILE=dev aws logs tail /ecs/financebasic --follow
```

### Change IAM Policies

**Use Case**: Grant S3 access to academics service

**Time**: 10 minutes

**Steps**:

```bash
# Step 1: Update policy in service-info.txt
vim /Users/shoaibrain/edforge/server/service-info.txt

# Find "academics" service, update "policy":
"policy": {
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:*"
      ],
      "Resource": "arn:aws:dynamodb:<REGION>:<ACCOUNT_ID>:table/edforge-academics-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::edforge-uploads-*/*"
    }
  ]
}

# Step 2: Deploy TenantTemplateStack (updates IAM role)
cd /Users/shoaibrain/edforge/server
AWS_PROFILE=dev npx cdk deploy tenant-template-stack-basic --require-approval=never

# Step 3: Verify new permissions
TASK_ROLE_ARN=$(AWS_PROFILE=dev aws ecs describe-task-definition \
  --task-definition academics \
  --region us-east-1 \
  --query 'taskDefinition.taskRoleArn' \
  --output text)

AWS_PROFILE=dev aws iam get-role-policy \
  --role-name $(echo $TASK_ROLE_ARN | cut -d'/' -f2) \
  --policy-name EcsContainerInlinePolicy \
  --region us-east-1

# Step 4: Force service update to use new task definition
AWS_PROFILE=dev aws ecs update-service \
  --cluster prod-basic \
  --service academicsbasic \
  --force-new-deployment \
  --region us-east-1
```

### Add DynamoDB GSI

**Use Case**: Add secondary index for querying students by email

**Time**: 10 minutes

**Steps**:

```bash
# Step 1: Update DynamoDB table definition
vim /Users/shoaibrain/edforge/server/lib/tenant-template/ecs-dynamodb.ts

# Add GSI:
const table = new Table(this, 'Table', {
  partitionKey: { name: 'tenantId', type: AttributeType.STRING },
  sortKey: { name: 'entityKey', type: AttributeType.STRING },
  pointInTimeRecoverySpecification: {
    pointInTimeRecoveryEnabled: true
  }
});

// Add GSI
table.addGlobalSecondaryIndex({
  indexName: 'EmailIndex',
  partitionKey: { name: 'email', type: AttributeType.STRING },
  projectionType: ProjectionType.ALL
});

# Step 2: Deploy TenantTemplateStack
cd /Users/shoaibrain/edforge/server
AWS_PROFILE=dev npx cdk deploy tenant-template-stack-basic --require-approval=never

# Step 3: Verify GSI was created
AWS_PROFILE=dev aws dynamodb describe-table \
  --table-name edforge-academics-basic \
  --region us-east-1 \
  --query 'Table.GlobalSecondaryIndexes'

# Step 4: Update application code to use GSI
vim /Users/shoaibrain/edforge/server/application/microservices/academics/src/students/students.service.ts

# Add query method:
async findByEmail(tenantId: string, email: string) {
  return await this.dynamodb.query({
    TableName: 'edforge-academics-basic',
    IndexName: 'EmailIndex',
    KeyConditionExpression: 'email = :email',
    ExpressionAttributeValues: {
      ':email': email
    }
  });
}

# Step 5: Build and deploy application
cd /Users/shoaibrain/edforge/scripts
AWS_PROFILE=dev ./build-application.sh

AWS_PROFILE=dev aws ecs update-service \
  --cluster prod-basic \
  --service academicsbasic \
  --force-new-deployment \
  --region us-east-1
```

### Change VPC or Networking

**Use Case**: Modify VPC CIDR or add new subnets

**Time**: 15-20 minutes

**⚠️ WARNING**: This is a destructive operation. Requires careful planning.

**Steps**:

```bash
# Step 1: Update VPC configuration
vim /Users/shoaibrain/edforge/server/lib/shared-infra/shared-infra-stack.ts

# Modify VPC CIDR or subnet configuration

# Step 2: Deploy SharedInfraStack
cd /Users/shoaibrain/edforge/server
AWS_PROFILE=dev npx cdk deploy shared-infra-stack --require-approval=never

# Note: This may fail if there are active resources using the VPC
# You may need to delete tenant stacks first, then recreate them

# Step 3: If necessary, recreate tenant stacks
AWS_PROFILE=dev npx cdk deploy tenant-template-stack-basic --require-approval=never
```

---

## Best Practices

### Development Workflow

#### Daily Workflow (90% of Time)

```bash
# Morning routine - check service health
AWS_PROFILE=dev aws ecs describe-services \
  --cluster prod-basic \
  --services identitybasic academicsbasic rproxybasic \
  --region us-east-1 \
  --query 'services[*].{name:serviceName,status:status,running:runningCount,desired:desiredCount}' \
  --output table

# Make code changes
vim server/application/microservices/academics/src/students/students.controller.ts

# Build and deploy (copy-paste these commands)
cd /Users/shoaibrain/edforge/scripts && \
AWS_PROFILE=dev ./build-application.sh && \
AWS_PROFILE=dev aws ecs update-service --cluster prod-basic --service academicsbasic --force-new-deployment --region us-east-1 && \
AWS_PROFILE=dev aws logs tail /ecs/academicsbasic --follow

# That's it! No CDK deployment.
```

#### Infrastructure Changes (10% of Time)

```bash
# Only when:
# - Adding new service
# - Changing IAM policies
# - Adding API routes
# - Modifying DynamoDB schema

cd /Users/shoaibrain/edforge/server
AWS_PROFILE=dev npx cdk deploy {stack-name} --require-approval=never

# Then deploy application code
cd /Users/shoaibrain/edforge/scripts
AWS_PROFILE=dev ./build-application.sh
AWS_PROFILE=dev aws ecs update-service --cluster prod-basic --service {service-name} --force-new-deployment --region us-east-1
```

### Monitoring

#### Set Up CloudWatch Alarms

```bash
# CPU utilization alarm
AWS_PROFILE=dev aws cloudwatch put-metric-alarm \
  --alarm-name academicsbasic-cpu-high \
  --alarm-description "Alert when CPU exceeds 80%" \
  --metric-name CPUUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=ServiceName,Value=academicsbasic Name=ClusterName,Value=prod-basic \
  --region us-east-1

# Memory utilization alarm
AWS_PROFILE=dev aws cloudwatch put-metric-alarm \
  --alarm-name academicsbasic-memory-high \
  --alarm-description "Alert when memory exceeds 80%" \
  --metric-name MemoryUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=ServiceName,Value=academicsbasic Name=ClusterName,Value=prod-basic \
  --region us-east-1

# List alarms
AWS_PROFILE=dev aws cloudwatch describe-alarms \
  --alarm-name-prefix academicsbasic \
  --region us-east-1
```

#### Check CloudWatch Metrics

```bash
# Service CPU usage (last hour)
AWS_PROFILE=dev aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name CPUUtilization \
  --dimensions Name=ServiceName,Value=academicsbasic Name=ClusterName,Value=prod-basic \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average,Maximum \
  --region us-east-1

# Service memory usage
AWS_PROFILE=dev aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name MemoryUtilization \
  --dimensions Name=ServiceName,Value=academicsbasic Name=ClusterName,Value=prod-basic \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average,Maximum \
  --region us-east-1

# API Gateway requests
API_ID=$(AWS_PROFILE=dev aws cloudformation describe-stacks \
  --stack-name shared-infra-stack \
  --query "Stacks[0].Outputs[?OutputKey=='ApiGatewayUrl'].OutputValue" \
  --output text | cut -d'/' -f3 | cut -d'.' -f1)

AWS_PROFILE=dev aws cloudwatch get-metric-statistics \
  --namespace AWS/ApiGateway \
  --metric-name Count \
  --dimensions Name=ApiId,Value=$API_ID \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum \
  --region us-east-1
```

### Cost Optimization

#### Stop Services in Dev Environment

```bash
# Scale down to 0 (stop running tasks)
AWS_PROFILE=dev aws ecs update-service \
  --cluster prod-basic \
  --service identitybasic \
  --desired-count 0 \
  --region us-east-1

AWS_PROFILE=dev aws ecs update-service \
  --cluster prod-basic \
  --service academicsbasic \
  --desired-count 0 \
  --region us-east-1

AWS_PROFILE=dev aws ecs update-service \
  --cluster prod-basic \
  --service rproxybasic \
  --desired-count 0 \
  --region us-east-1

# Start services again
AWS_PROFILE=dev aws ecs update-service \
  --cluster prod-basic \
  --service identitybasic \
  --desired-count 1 \
  --region us-east-1

# (Repeat for other services)
```

#### Clean Up Unused ECR Images

```bash
# List ECR repositories
AWS_PROFILE=dev aws ecr describe-repositories --region us-east-1

# List images in a repository
AWS_PROFILE=dev aws ecr list-images \
  --repository-name academics \
  --region us-east-1

# Delete old images (keep only latest 5)
# Get all image digests except latest 5
IMAGES_TO_DELETE=$(AWS_PROFILE=dev aws ecr list-images \
  --repository-name academics \
  --region us-east-1 \
  --query 'sort_by(imageDetails,& imagePushedAt)[0:-5].[imageDigest]' \
  --output text)

# Delete images
for IMAGE_DIGEST in $IMAGES_TO_DELETE; do
  AWS_PROFILE=dev aws ecr batch-delete-image \
    --repository-name academics \
    --image-ids imageDigest=$IMAGE_DIGEST \
    --region us-east-1
done
```

#### Check CloudFormation Stack Costs

```bash
# List all stacks
AWS_PROFILE=dev aws cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --region us-east-1 \
  --query 'StackSummaries[*].{Name:StackName,Status:StackStatus,Created:CreationTime}' \
  --output table

# Get resources in a stack
AWS_PROFILE=dev aws cloudformation describe-stack-resources \
  --stack-name tenant-template-stack-basic \
  --region us-east-1 \
  --query 'StackResources[*].{Type:ResourceType,Status:ResourceStatus}' \
  --output table

# Use Cost Explorer (requires Cost Explorer to be enabled)
# This shows costs for the last 30 days
aws ce get-cost-and-usage \
  --time-period Start=$(date -u -d '30 days ago' +%Y-%m-%d),End=$(date -u +%Y-%m-%d) \
  --granularity DAILY \
  --metrics UnblendedCost \
  --group-by Type=SERVICE \
  --region us-east-1
```

### Security Best Practices

#### Rotate API Keys

```bash
# Step 1: Update API keys in service-info.txt or use AWS CLI
# Generate new key
NEW_KEY=$(uuidgen | tr '[:upper:]' '[:lower:]')-sbt

# Step 2: Update SSM Parameter
AWS_PROFILE=dev aws ssm put-parameter \
  --name apiKeyBasicTierValue \
  --value $NEW_KEY \
  --type String \
  --overwrite \
  --region us-east-1

# Step 3: Deploy SharedInfraStack
cd /Users/shoaibrain/edforge/server
AWS_PROFILE=dev npx cdk deploy shared-infra-stack --require-approval=never

# Step 4: Update clients with new API key
# (Notify tenants, update documentation)
```

#### Review IAM Roles

```bash
# List all roles created by CDK
AWS_PROFILE=dev aws iam list-roles \
  --query 'Roles[?contains(RoleName, `tenant-template-stack-basic`)].{Name:RoleName,Created:CreateDate}' \
  --output table

# Get role policy
AWS_PROFILE=dev aws iam list-attached-role-policies \
  --role-name tenant-template-stack-basic-academics-ecsTaskRole \
  --region us-east-1

# Review inline policies
AWS_PROFILE=dev aws iam list-role-policies \
  --role-name tenant-template-stack-basic-academics-ecsTaskRole \
  --region us-east-1

AWS_PROFILE=dev aws iam get-role-policy \
  --role-name tenant-template-stack-basic-academics-ecsTaskRole \
  --policy-name EcsContainerInlinePolicy \
  --region us-east-1
```

#### Enable CloudTrail Logging

```bash
# Check if CloudTrail is enabled
AWS_PROFILE=dev aws cloudtrail describe-trails --region us-east-1

# Create trail (if not exists)
AWS_PROFILE=dev aws cloudtrail create-trail \
  --name edforge-audit-trail \
  --s3-bucket-name edforge-cloudtrail-logs-${ACCOUNT_ID} \
  --region us-east-1

# Start logging
AWS_PROFILE=dev aws cloudtrail start-logging \
  --name edforge-audit-trail \
  --region us-east-1

# Query recent API calls (requires Athena setup)
# See AWS CloudTrail documentation for Athena integration
```

---

## Decision Tree

Use this decision tree to determine the right approach for your change:

```mermaid
graph TD
    Start[I Need to Make a Change] --> Q1{What Changed?}
    
    Q1 -->|Application Code| App[TypeScript/NestJS Files]
    Q1 -->|Configuration| Config[What Type?]
    Q1 -->|Infrastructure| Infra[What Resource?]
    
    App --> Build[./build-application.sh]
    Build --> ForceUpdate[aws ecs update-service<br/>--force-new-deployment]
    ForceUpdate --> Done1[✅ Done 5-10 min]
    
    Config --> ConfigType{Where Defined?}
    ConfigType -->|In Application Code| App
    ConfigType -->|In service-info.txt| CDKDeploy[npx cdk deploy<br/>tenant-template-stack-basic]
    
    Infra --> InfraType{Which Resource?}
    InfraType -->|API Gateway Routes| APIUpdate[Update tenant-api-prod.json]
    InfraType -->|ECS Service| ServiceUpdate[Update service-info.txt]
    InfraType -->|DynamoDB Schema| DBUpdate[Update ecs-dynamodb.ts]
    InfraType -->|IAM Policies| IAMUpdate[Update service-info.txt policy]
    InfraType -->|VPC/Networking| VPCUpdate[Update shared-infra-stack.ts]
    
    APIUpdate --> DeployShared[npx cdk deploy<br/>shared-infra-stack]
    ServiceUpdate --> CDKDeploy
    DBUpdate --> CDKDeploy
    IAMUpdate --> CDKDeploy
    VPCUpdate --> DeployShared
    
    DeployShared --> AppUpdate[Update application code?]
    CDKDeploy --> AppUpdate
    
    AppUpdate -->|Yes| Build
    AppUpdate -->|No| Done2[✅ Done]
    
    Done2 --> End[Complete]
    Done1 --> End
```

---

## Common Error Messages and Solutions

### Error: "CannotPullContainerError"

**Symptoms**:
```
Task stopped: CannotPullContainerError: 
Error response from daemon: pull access denied for 123456789.dkr.ecr.us-east-1.amazonaws.com/academics
```

**Cause**: ECR repository doesn't exist or image tag not found

**Solution**:
```bash
# Check if repository exists
AWS_PROFILE=dev aws ecr describe-repositories \
  --repository-names academics \
  --region us-east-1

# If not, create it
AWS_PROFILE=dev aws ecr create-repository \
  --repository-name academics \
  --region us-east-1

# Build and push image
cd /Users/shoaibrain/edforge/scripts
AWS_PROFILE=dev ./build-application.sh
```

---

### Error: "Essential container in task exited"

**Symptoms**:
```
Task stopped: Essential container in task exited
```

**Cause**: Application crashed on startup

**Solution**:
```bash
# Check logs for error
AWS_PROFILE=dev aws logs tail /ecs/academicsbasic --since 5m

# Common issues:
# - Missing environment variables
# - Cannot connect to DynamoDB
# - Port already in use
# - Application exception

# Fix code and redeploy
cd /Users/shoaibrain/edforge/scripts
AWS_PROFILE=dev ./build-application.sh
AWS_PROFILE=dev aws ecs update-service --cluster prod-basic --service academicsbasic --force-new-deployment --region us-east-1
```

---

### Error: "Service is unable to consistently start tasks successfully"

**Symptoms**:
```
Service is unable to consistently start tasks successfully
```

**Cause**: Health checks failing, tasks crashing repeatedly

**Solution**:
```bash
# Check service events
AWS_PROFILE=dev aws ecs describe-services \
  --cluster prod-basic \
  --services academicsbasic \
  --region us-east-1 \
  --query 'services[0].events[0:10]'

# Check task definition health check
AWS_PROFILE=dev aws ecs describe-task-definition \
  --task-definition academics \
  --region us-east-1 \
  --query 'taskDefinition.containerDefinitions[0].healthCheck'

# Common fixes:
# 1. Increase health check grace period
# 2. Fix health check endpoint (/health)
# 3. Increase task memory
# 4. Fix application startup errors
```

---

### Error: "Target group health check failed"

**Symptoms**:
```
Target health check failed: Target.Timeout
```

**Cause**: Service not responding on health check port

**Solution**:
```bash
# Verify health check endpoint exists
# Add to your NestJS application:
@Controller()
export class HealthController {
  @Get('/health')
  health() {
    return { status: 'ok' };
  }
}

# Rebuild and deploy
cd /Users/shoaibrain/edforge/scripts
AWS_PROFILE=dev ./build-application.sh
AWS_PROFILE=dev aws ecs update-service --cluster prod-basic --service academicsbasic --force-new-deployment --region us-east-1
```

---

### Error: "CloudFormation rollback"

**Symptoms**:
```
Stack tenant-template-stack-basic is in ROLLBACK_COMPLETE state
```

**Cause**: CDK deployment failed

**Solution**:
```bash
# Check stack events for error
AWS_PROFILE=dev aws cloudformation describe-stack-events \
  --stack-name tenant-template-stack-basic \
  --region us-east-1 \
  --query 'StackEvents[?ResourceStatus==`CREATE_FAILED`]'

# Delete failed stack
AWS_PROFILE=dev aws cloudformation delete-stack \
  --stack-name tenant-template-stack-basic \
  --region us-east-1

# Wait for deletion
AWS_PROFILE=dev aws cloudformation wait stack-delete-complete \
  --stack-name tenant-template-stack-basic \
  --region us-east-1

# Fix issue in CDK code and redeploy
cd /Users/shoaibrain/edforge/server
AWS_PROFILE=dev npx cdk deploy tenant-template-stack-basic --require-approval=never
```

---

## Conclusion

### Quick Reference Card

**Print this and keep it at your desk:**

```
┌─────────────────────────────────────────────────────────────┐
│ EdForge Daily Development Quick Reference                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ UPDATE APPLICATION CODE (95% of time):                       │
│   cd /Users/shoaibrain/edforge/scripts                      │
│   AWS_PROFILE=dev ./build-application.sh                    │
│   AWS_PROFILE=dev aws ecs update-service \                  │
│     --cluster prod-basic \                                   │
│     --service {service}basic \                               │
│     --force-new-deployment --region us-east-1               │
│                                                              │
│ VIEW LOGS:                                                   │
│   AWS_PROFILE=dev aws logs tail /ecs/{service}basic --follow│
│                                                              │
│ CHECK SERVICE HEALTH:                                        │
│   AWS_PROFILE=dev aws ecs describe-services \               │
│     --cluster prod-basic \                                   │
│     --services {service}basic --region us-east-1            │
│                                                              │
│ SCALE SERVICE:                                               │
│   AWS_PROFILE=dev aws ecs update-service \                  │
│     --cluster prod-basic --service {service}basic \          │
│     --desired-count N --region us-east-1                    │
│                                                              │
│ ROLLBACK:                                                    │
│   AWS_PROFILE=dev aws ecs update-service \                  │
│     --cluster prod-basic --service {service}basic \          │
│     --task-definition {service}:N --region us-east-1        │
│                                                              │
│ CDK DEPLOY (only when needed):                              │
│   cd /Users/shoaibrain/edforge/server                       │
│   AWS_PROFILE=dev npx cdk deploy {stack-name} \             │
│     --require-approval=never                                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Remember

1. **Application updates = AWS CLI** (5-10 minutes)
2. **Infrastructure updates = CDK** (10-20 minutes)
3. **Always check logs** when something goes wrong
4. **Use force-new-deployment** for same-tag image updates
5. **Monitor deployments** - don't assume success

### Next Steps

1. Practice the daily workflow multiple times
2. Set up CloudWatch alarms for production
3. Create shell aliases for common commands
4. Document your team-specific workflows
5. Set up CI/CD pipeline (GitHub Actions) for automated deployments

---

**Need Help?**

- Architecture Reference: [EDFORGE_ARCHITECTURE.md](EDFORGE_ARCHITECTURE.md)
- Developer Guide: [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)
- AWS CLI Documentation: https://docs.aws.amazon.com/cli/
- ECS CLI Reference: https://docs.aws.amazon.com/cli/latest/reference/ecs/

---

**Pro Tips**:

```bash
# Create aliases for common commands (add to ~/.bashrc or ~/.zshrc)
alias ecsupdate='aws ecs update-service --cluster prod-basic --force-new-deployment --region us-east-1'
alias ecslogs='aws logs tail --follow'
alias ecsdesc='aws ecs describe-services --cluster prod-basic --region us-east-1'

# Usage:
ecsupdate --service academicsbasic
ecslogs /ecs/academicsbasic
ecsdesc --services academicsbasic
```

