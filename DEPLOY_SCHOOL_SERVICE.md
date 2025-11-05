# Deploy School Service to ECS - Step-by-Step Guide

This guide walks you through building, testing, and deploying the school microservice with the new shared-types dependency.

## Prerequisites

- ✅ Shared types validation passes (`npm run validate:sync`)
- ✅ Docker installed and running
- ✅ AWS CLI configured with appropriate credentials
- ✅ ECR repository exists: `346698404105.dkr.ecr.us-east-1.amazonaws.com/school`
- ✅ ECS cluster and service configured

## Phase 1: Fix Validation Errors ✅

**Status**: Completed
- ✅ Added missing `description` field to `UpdateSchoolRequest`
- ✅ Improved validator script to correctly parse DTO classes
- ✅ Validation now passes: `npm run validate:sync`

## Phase 2: Build & Test Locally ✅

### Step 2.1: Install Dependencies

```bash
# Install shared-types dependencies
cd packages/shared-types
npm install
npm run build
```

### Step 2.2: Build School Microservice

```bash
cd ../../server/application
npm run build school
# or
yarn build school
```

**Expected Output**: 
```
webpack 5.x.x compiled successfully in X ms
```

**Verify**:
- Check `dist/microservices/school/main.js` exists
- No TypeScript compilation errors
- No import errors for `@edforge/shared-types`

### Step 2.3: Test Locally (Optional)

```bash
# Start the service locally
npm run start:school

# In another terminal, test with curl
curl http://localhost:3010/schools \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Phase 3: Build Docker Image

### Step 3.1: Ensure Docker is Running

```bash
# Check Docker status
docker ps

# If not running, start Docker Desktop or Docker daemon
```

### Step 3.2: Pre-Build Shared Types

```bash
cd packages/shared-types
npm install
npm run build
```

### Step 3.3: Build Docker Image

```bash
# From monorepo root
cd /Users/shoaibrain/edforge
docker build -t school:latest -f server/application/Dockerfile.school .
```

**Build Process**:
1. Stage 1: Builds shared-types package
2. Stage 2: Builds school microservice
3. Stage 3: Creates runtime image

**Expected Output**: 
```
Successfully built <image-id>
Successfully tagged school:latest
```

### Step 3.4: Test Docker Image Locally (Optional)

```bash
# Run the container locally
docker run -p 3010:3010 \
  -e AWS_REGION=us-east-1 \
  -e TABLE_NAME=school-table-basic \
  -e COGNITO_USER_POOL_ID=your-pool-id \
  -e EVENT_BUS_NAME=default \
  school:latest

# Test it works
curl http://localhost:3010/health  # if you have a health endpoint
```

## Phase 4: Build & Push to ECR

### Option A: Use Build Script (Recommended)

```bash
cd scripts
./build-application.sh
```

This script will:
1. ✅ Build shared-types package
2. ✅ Build Docker image for school service
3. ✅ Tag and push to ECR: `346698404105.dkr.ecr.us-east-1.amazonaws.com/school:latest`

### Option B: Manual Build

```bash
# Set AWS credentials
export AWS_REGION=us-east-1
export ACCOUNT_ID=346698404105

# Login to ECR
aws ecr get-login-password --region $AWS_REGION | \
  docker login --username AWS --password-stdin \
  $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# Build and tag (from monorepo root)
cd /Users/shoaibrain/edforge
docker build -t school:latest -f server/application/Dockerfile.school .
docker tag school:latest $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/school:latest

# Push
docker push $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/school:latest
```

**Verify Push**:
```bash
aws ecr describe-images \
  --repository-name school \
  --region us-east-1 \
  --query 'imageDetails[0].imageTags[0]'
```

## Phase 5: Deploy to ECS

### Step 5.1: Get Cluster and Service Names

```bash
# List clusters
aws ecs list-clusters --region us-east-1

# List services in cluster
aws ecs list-services \
  --cluster YOUR_CLUSTER_NAME \
  --region us-east-1
```

**Common cluster names**:
- `prod-basic` (for basic tier)
- `prod-premium` (for premium tier)
- `prod-advanced` (for advanced tier)

### Step 5.2: Update ECS Service

```bash
# Force new deployment (uses latest image)
aws ecs update-service \
  --cluster YOUR_CLUSTER_NAME \
  --service school-service \
  --force-new-deployment \
  --region us-east-1
```

**Alternative**: If service name is different:
```bash
# Find service name
aws ecs list-services --cluster YOUR_CLUSTER_NAME --region us-east-1

# Update with correct service name
aws ecs update-service \
  --cluster YOUR_CLUSTER_NAME \
  --service YOUR_SERVICE_NAME \
  --force-new-deployment \
  --region us-east-1
```

### Step 5.3: Monitor Deployment

```bash
# Watch service events (refresh manually or use watch)
aws ecs describe-services \
  --cluster YOUR_CLUSTER_NAME \
  --services school-service \
  --region us-east-1 \
  --query 'services[0].events[0:5]'

# Check task status
aws ecs list-tasks \
  --cluster YOUR_CLUSTER_NAME \
  --service-name school-service \
  --region us-east-1

# Describe running tasks
aws ecs describe-tasks \
  --cluster YOUR_CLUSTER_NAME \
  --tasks $(aws ecs list-tasks --cluster YOUR_CLUSTER_NAME --service-name school-service --region us-east-1 --query 'taskArns[0]' --output text) \
  --region us-east-1 \
  --query 'tasks[0].lastStatus'
```

**Expected Status**: `RUNNING`

### Step 5.4: Check Logs

```bash
# Stream CloudWatch logs
aws logs tail /ecs/school --follow --region us-east-1

# Or check specific log group (check your CDK outputs for actual log group name)
aws logs tail /aws/ecs/school-service --follow --region us-east-1

# List available log groups
aws logs describe-log-groups --region us-east-1 --query 'logGroups[?contains(logGroupName, `school`)].logGroupName'
```

**Look for**:
- ✅ Service started successfully
- ✅ No import errors for `@edforge/shared-types`
- ✅ Database connection successful
- ✅ EventBridge connection successful

## Phase 6: Verify Deployment

### Step 6.1: Get ALB Endpoint

```bash
# Get from CDK outputs
aws cloudformation describe-stacks \
  --stack-name YOUR_STACK_NAME \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`albUrl`].OutputValue' \
  --output text

# Or check AWS Console → EC2 → Load Balancers
```

### Step 6.2: Health Check

```bash
# Test basic connectivity
curl https://YOUR_ALB_URL/schools \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected**: JSON response or 401 if token is invalid

### Step 6.3: Test Create School

```bash
curl -X POST https://YOUR_ALB_URL/schools \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "schoolName": "Test School",
    "schoolCode": "TEST-001",
    "schoolType": "elementary",
    "contactInfo": {
      "primaryEmail": "test@example.com",
      "primaryPhone": "+1-555-0123"
    },
    "address": {
      "street": "123 Test St",
      "city": "Test City",
      "state": "TS",
      "country": "US",
      "postalCode": "12345",
      "timezone": "America/New_York"
    },
    "maxStudentCapacity": 500,
    "gradeRange": {
      "lowestGrade": "K",
      "highestGrade": "5"
    }
  }'
```

**Expected**: 201 Created with school object

### Step 6.4: Test Academic Year Creation

```bash
curl -X POST https://YOUR_ALB_URL/schools/SCHOOL_ID/academic-years \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "yearName": "2024-2025",
    "yearCode": "AY24",
    "startDate": "2024-09-01",
    "endDate": "2025-06-30",
    "isCurrent": true,
    "structure": {
      "semesterCount": 2,
      "gradingPeriodCount": 4,
      "instructionalDays": 180,
      "schoolDays": 185
    }
  }'
```

### Step 6.5: Verify EventBridge Events

```bash
# Check CloudWatch Logs for EventBridge events
aws logs filter-log-events \
  --log-group-name /aws/events/school-service \
  --filter-pattern "SchoolCreated" \
  --region us-east-1 \
  --max-items 5

# Or check EventBridge console
# AWS Console → EventBridge → Event buses → default → Events
```

**Look for**:
- ✅ `SchoolCreated` events
- ✅ `AcademicYearCreated` events
- ✅ Event details include correct data

## Troubleshooting

### Build Fails

**Issue**: TypeScript compilation errors
```bash
# Check for import errors
cd server/application
npm run build school

# Verify shared-types is built
ls -la ../../packages/shared-types/dist/
```

**Issue**: Docker build fails
```bash
# Verify build context
docker build -t school:test -f server/application/Dockerfile.school .
# Should be run from monorepo root

# Check Dockerfile paths
cat server/application/Dockerfile.school
```

### Docker Build Fails

**Issue**: Cannot find shared-types
```
Solution: Ensure packages/shared-types/dist exists before building
```

**Issue**: COPY failed
```
Solution: Verify Docker build context is monorepo root, not server/application
```

### ECS Deployment Fails

**Issue**: Task fails to start
```bash
# Check task logs
aws logs tail /ecs/school --follow --region us-east-1

# Check task definition
aws ecs describe-task-definition \
  --task-definition school-service \
  --region us-east-1 \
  --query 'taskDefinition.containerDefinitions[0]'
```

**Issue**: Image pull fails
```bash
# Verify image exists in ECR
aws ecr describe-images \
  --repository-name school \
  --region us-east-1

# Check task definition image URI
aws ecs describe-task-definition \
  --task-definition school-service \
  --region us-east-1 \
  --query 'taskDefinition.containerDefinitions[0].image'
```

**Issue**: Environment variables missing
```bash
# Check task definition environment
aws ecs describe-task-definition \
  --task-definition school-service \
  --region us-east-1 \
  --query 'taskDefinition.containerDefinitions[0].environment'
```

### Service Not Responding

**Issue**: Health check failing
```bash
# Check ALB target group health
aws elbv2 describe-target-health \
  --target-group-arn YOUR_TARGET_GROUP_ARN \
  --region us-east-1

# Check security group rules
aws ec2 describe-security-groups \
  --group-ids YOUR_SECURITY_GROUP_ID \
  --region us-east-1
```

**Issue**: 502 Bad Gateway
- Check ECS task is running
- Check security group allows traffic from ALB
- Check CloudWatch logs for errors

## Rollback Plan

If deployment fails:

```bash
# Option 1: Rollback to previous task definition
aws ecs update-service \
  --cluster YOUR_CLUSTER_NAME \
  --service school-service \
  --task-definition school-service:PREVIOUS_REVISION \
  --force-new-deployment \
  --region us-east-1

# Option 2: Use previous ECR image
aws ecr describe-images \
  --repository-name school \
  --region us-east-1 \
  --query 'imageDetails[?imageTags[0]==`previous-tag`]'

# Update task definition to use previous image
# Then force new deployment
```

## Success Criteria Checklist

- [x] Shared types validation passes
- [x] School microservice builds locally
- [ ] Docker image builds successfully
- [ ] Image pushed to ECR
- [ ] ECS service updated and running
- [ ] Health checks passing
- [ ] API endpoints responding
- [ ] EventBridge events publishing
- [ ] Create school endpoint works
- [ ] Create academic year endpoint works

## Quick Reference Commands

```bash
# Build and deploy
cd scripts && ./build-application.sh

# Deploy to ECS
aws ecs update-service --cluster YOUR_CLUSTER --service school-service --force-new-deployment --region us-east-1

# Check logs
aws logs tail /ecs/school --follow --region us-east-1

# Check service status
aws ecs describe-services --cluster YOUR_CLUSTER --services school-service --region us-east-1
```

## Next Steps After Deployment

1. **Monitor**: Watch CloudWatch logs for 5-10 minutes
2. **Test**: Run full test suite against deployed service
3. **Verify**: Check EventBridge for events
4. **Document**: Update deployment notes with any issues found
5. **Scale**: Adjust service if needed based on load

