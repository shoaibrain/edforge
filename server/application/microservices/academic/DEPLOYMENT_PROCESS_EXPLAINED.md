# EdForge Deployment Process - Complete Analysis

## 🔍 **What `install.sh` Does**

### **Full Deployment Script (From Scratch)**

The `install.sh` script is a **complete deployment** that:

### **Phase 1: Pre-Provisioning (Lines 1-70)**
1. ✅ Validates admin email
2. ✅ Generates API keys for tiers (Basic, Advanced, Premium)
3. ✅ Detects AWS region and account ID
4. ✅ Creates S3 bucket for provisioning source
5. ✅ Creates ECS service-linked IAM role
6. ✅ Generates `service-info.json` from template
7. ✅ Runs `npm install`
8. ✅ Runs `cdk bootstrap` (creates CDK toolkit stack)

### **Phase 2: Service Reset (Lines 72-81)**
```bash
# Resets Service Connect on existing services
for SERVICE in $SERVICES; do
    aws ecs update-service \
        --cluster $CDK_BASIC_CLUSTER \
        --service $SERVICE_NAME \
        --service-connect-configuration 'enabled=false'
done
```
**Purpose**: Resets service discovery before redeployment

### **Phase 3: CDK Deployment (Line 102)**
```bash
npx cdk deploy --all --require-approval=never --concurrency 10 --asset-parallelism true
```

**This Deploys ALL CloudFormation Stacks:**
1. `shared-infra-stack` - VPC, ALB, Cognito, API Gateway, etc.
2. `tenant-template-stack-basic` - ECS services for basic tier
3. Other infrastructure stacks

**What Gets Created/Updated:**
- ✅ VPC, subnets, security groups
- ✅ ECS cluster
- ✅ DynamoDB tables
- ✅ ECS services (user, school, academic ✅, rproxy)
- ✅ Service Connect (Cloud Map)
- ✅ Application Load Balancer
- ✅ Cognito User Pool
- ✅ API Gateway
- ✅ IAM roles and policies

### **Phase 4: Post-Deployment (Lines 105-108)**
- Outputs admin site URL
- Outputs application site URL

---

## ⚠️ **Running `install.sh` on Existing Stack**

### **What Will Happen:**

**IF** you run `install.sh` on an existing stack:

1. ✅ **Service Reset**: Disables Service Connect on all running services
2. ✅ **CDK Deploy --all**: 
   - Updates existing CloudFormation stacks
   - Creates new resources (academic service ✅)
   - Updates changed resources (rproxy with new nginx config)
   - **DOES NOT** destroy existing resources
   - **MAY** cause temporary service disruption during updates

3. **ECS Service Updates**:
   - User service: **No change** (same image)
   - School service: **No change** (same image)
   - Academic service: **NEW** (will be created ✅)
   - Rproxy service: **UPDATED** (new nginx config with /academic route)

4. **DynamoDB**:
   - **No change** to existing data
   - Academic service will use the SAME table
   - Existing school/user data remains intact

### **Potential Issues:**

⚠️ **Service Disruption**: 
- ECS services will restart during deployment
- 2-5 minutes downtime during rollout
- Health checks may fail temporarily

⚠️ **Service Connect Reset**:
- DNS records recreated
- Potential for rproxy startup issues (the "host not found" problem you experienced before)

---

## 🎯 **Better Approach: Incremental Deployment**

Since your stack is already running, you have **better options**:

### **Option 1: Deploy Only Academic Service (RECOMMENDED)**

```bash
cd /Users/shoaibrain/edforge/server

# Deploy only the tenant template stack (which includes services)
npx cdk deploy tenant-template-stack-basic --require-approval=never
```

**This Will:**
- ✅ Create the academic ECS service
- ✅ Update rproxy with new nginx config
- ✅ Leave existing services running
- ✅ Minimal disruption

### **Option 2: Update Individual Service (Even More Targeted)**

```bash
# Force new deployment of academic service only
aws ecs update-service \
  --cluster prod-basic \
  --service academic-service \
  --force-new-deployment
```

**But FIRST**, the academic service must exist! So you need to run CDK deploy at least once.

### **Option 3: Hybrid Approach (SAFEST)**

```bash
cd /Users/shoaibrain/edforge/server

# 1. Synth to check what will change
npx cdk synth tenant-template-stack-basic > /tmp/template-diff.yaml

# 2. Review the changes
cat /tmp/template-diff.yaml | grep -A 20 "academic"

# 3. Deploy only if changes look good
npx cdk deploy tenant-template-stack-basic --require-approval=never
```

---

## 📊 **Current Stack Analysis**

Let me check what's currently deployed:

**Your Current ECS Services** (from previous runs):
```
Cluster: prod-basic

Services:
├── users-service     (running)
├── school-service    (running)
└── rproxy-service    (running)
```

**After Academic Deployment:**
```
Cluster: prod-basic

Services:
├── users-service      (unchanged)
├── school-service     (unchanged)  
├── academic-service   (NEW ✅)
└── rproxy-service     (UPDATED - new nginx config)
```

---

## 🚀 **Recommended Deployment Steps**

### **Step 1: Verify Current Stack**

```bash
# Check current services
aws ecs list-services --cluster prod-basic

# Check current stack status
aws cloudformation describe-stacks \
  --stack-name tenant-template-stack-basic \
  --query 'Stacks[0].StackStatus'
```

### **Step 2: Deploy Academic Service**

```bash
cd /Users/shoaibrain/edforge/server

# Set environment
export CDK_NAG_ENABLED=false
export CDK_PARAM_TIER=basic
export CDK_PARAM_STAGE=prod

# Deploy only the tenant stack (incremental)
npx cdk deploy tenant-template-stack-basic --require-approval=never
```

**Expected Changes:**
- ✅ Creates `academic-EcsServices` construct
- ✅ Creates ECS service for academic
- ✅ Registers `academic-api.{namespace}.sc` in Cloud Map
- ✅ Updates rproxy task definition (new nginx config)
- ✅ Triggers rolling deployment of rproxy

### **Step 3: Verify Deployment**

```bash
# Check academic service is running
aws ecs describe-services \
  --cluster prod-basic \
  --services academic-service

# Check Service Connect registration
aws servicediscovery list-services \
  --filters Name=NAMESPACE_ID,Values={namespace-id}

# Test health endpoint
curl https://{alb-url}/prod/academic/health \
  -H "tenantPath: {tenant-id}"
```

---

## ⚙️ **How the Deployment Process Works**

### **1. CDK Synthesize**
```
CDK App → CloudFormation Templates
```
- Reads `service-info.json`
- For each container, creates ECS service
- Generates CloudFormation JSON

### **2. CloudFormation Change Set**
```
Current State → Desired State → Change Set
```
- Compares existing resources with new template
- Identifies what to: CREATE, UPDATE, DELETE
- Executes changes

### **3. ECS Service Deployment**
For each service in `service-info.json`:

```typescript
// In tenant-template-stack.ts
containerInfo.forEach((info) => {
  const ecsService = new EcsService(this, `${info.name}-EcsServices`, {
    // Creates:
    // - ECS Task Definition
    // - ECS Service
    // - Service Connect configuration
    // - Target Group
    // - ALB Listener Rule
  });
});
```

**For academic service:**
1. Creates task definition with academic Docker image
2. Creates ECS service with 1 task
3. Registers in Service Connect as `academic-api.{namespace}.sc`
4. Creates target group and ALB rule for `/academic/*`
5. Grants DynamoDB permissions

### **4. Rproxy Update**
```
New nginx.template → New task definition → Rolling deployment
```
- Creates new task definition version
- Stops old tasks
- Starts new tasks with updated config
- Health checks ensure availability

---

## 🎯 **What You Should Do**

**Since your stack is running**, here's the safest approach:

### **Recommended: Targeted Deployment**

```bash
cd /Users/shoaibrain/edforge/server

# Deploy only the academic service (incremental update)
npx cdk deploy tenant-template-stack-basic
```

**This is SAFE because:**
- ✅ Only updates what changed (academic + rproxy)
- ✅ Does NOT recreate shared-infra-stack
- ✅ Does NOT recreate VPC, ALB, Cognito
- ✅ Uses existing DynamoDB table
- ✅ CDK uses change sets - only applies differences

**Expected Duration:** 5-10 minutes

**Services Affected:**
- `academic-service`: Created (new)
- `rproxy-service`: Updated (rolling deployment)
- `user-service`: No change
- `school-service`: No change

Would you like me to:
1. **Proceed with incremental deployment** (`cdk deploy tenant-template-stack-basic`)
2. **First do a dry-run** (`cdk synth` to see what will change)
3. **Something else?**

