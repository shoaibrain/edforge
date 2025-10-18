# Deployment Impact Analysis - Will Your Services Go Down?

## ⚠️ **SHORT ANSWER: YES - Temporary Disruption Expected**

Running `install.sh` on an existing stack will cause **2-5 minutes of service disruption** during the deployment.

---

## 📊 **What Will Happen to Each Service**

### **1. User Service**
**Status**: ⚠️ **BRIEF DISRUPTION**

**What Happens:**
- Docker image: No change (same digest)
- Task definition: No change
- ECS service: **Service Connect reset** (lines 72-81 of install.sh)
- Result: Tasks restart, 30-60 seconds downtime

**Impact:**
- ⚠️ Active user sessions may be interrupted
- ⚠️ Login requests fail during restart
- ✅ Recovers automatically after health checks pass

### **2. School Service**
**Status**: ⚠️ **BRIEF DISRUPTION**

**What Happens:**
- Docker image: No change (same digest)
- Task definition: No change
- ECS service: **Service Connect reset**
- Result: Tasks restart, 30-60 seconds downtime

**Impact:**
- ⚠️ School API requests fail during restart
- ⚠️ Academic year APIs unavailable briefly
- ✅ Recovers automatically

### **3. Rproxy Service**
**Status**: ⚠️ **DEFINITE UPDATE - Longer Disruption**

**What Happens:**
- nginx.template: **CHANGED** (added /academic route)
- Docker image: **NEW** (built with new config)
- Task definition: **NEW VERSION**
- ECS service: **Rolling deployment**
- Result: **2-3 minutes downtime**

**Impact:**
- ⚠️ All API requests fail (rproxy is the entry point)
- ⚠️ User, School, Academic all unreachable
- ⚠️ Potential "host not found" issue during startup
- ⚠️ May need manual intervention if startup fails

### **4. Academic Service**
**Status**: ✅ **NEW SERVICE - No Impact (Doesn't Exist Yet)**

**What Happens:**
- ECS service: **CREATED**
- Cloud Map: Registered as `academic-api.{namespace}.sc`
- Result: New service starts

**Impact:**
- ✅ No disruption (service didn't exist)
- ✅ Becomes available after ~2 minutes

---

## ⏱️ **Expected Downtime Timeline**

```
T+0:00  - Start deployment
T+0:30  - Service Connect reset begins
T+0:45  - User & School services restart (30s downtime)
T+1:00  - Rproxy begins rolling update
T+1:30  - Old rproxy tasks draining
T+2:00  - New rproxy tasks starting (CRITICAL: DNS resolution)
T+2:30  - Health checks for new rproxy tasks
T+3:00  - Academic service starts
T+3:30  - All services healthy ✅
```

**Total Expected Downtime**: **2-4 minutes**

---

## 🚨 **Specific Risks**

### **Risk 1: Rproxy DNS Resolution Failure**
**Problem**: The issue you experienced before where rproxy fails with "host not found in upstream"

**Why It Happens:**
```nginx
# nginx.template tries to resolve at startup:
proxy_pass http://academic-api.${NAMESPACE}.sc:3010;

# But academic-api DNS may not exist yet!
```

**What You'll See:**
```
nginx: [emerg] host not found in upstream "academic-api.basic.sc"
Task failed to start
```

**Workaround:**
```bash
# If it fails, manually force new deployment
aws ecs update-service \
  --cluster prod-basic \
  --service rproxy-service \
  --force-new-deployment \
  --profile dev
```

### **Risk 2: Service Connect Reset**
**Problem**: Lines 72-81 of install.sh disable Service Connect on all services

```bash
for SERVICE in $SERVICES; do
    aws ecs update-service \
        --service-connect-configuration 'enabled=false'
done
```

**Impact**: All services restart simultaneously = complete outage

---

## ✅ **SAFER ALTERNATIVE: Incremental Deployment**

### **Option A: Skip Service Connect Reset** (RECOMMENDED)

Create a modified deployment script:

```bash
#!/bin/bash
# deploy-academic-only.sh

export CDK_NAG_ENABLED=false
export AWS_PROFILE=dev

# Set required environment variables
export CDK_PARAM_SYSTEM_ADMIN_EMAIL=shoaib.rain1@gmail.com
export CDK_PARAM_COMMIT_ID=$(date +%s | base64 | head -c 32)
export CDK_PARAM_API_KEY_PREMIUM_TIER_PARAMETER=$(uuidgen | tr '[:upper:]' '[:lower:]')-sbt
export CDK_PARAM_API_KEY_ADVANCED_TIER_PARAMETER=$(uuidgen | tr '[:upper:]' '[:lower:]')-sbt
export CDK_PARAM_API_KEY_BASIC_TIER_PARAMETER=$(uuidgen | tr '[:upper:]' '[:lower:]')-sbt
export CDK_PARAM_ONBOARDING_DETAIL_TYPE=Onboarding
export CDK_PARAM_PROVISIONING_DETAIL_TYPE=Onboarding
export CDK_PARAM_OFFBOARDING_DETAIL_TYPE=Offboarding
export CDK_PARAM_DEPROVISIONING_DETAIL_TYPE=Offboarding
export CDK_PARAM_TIER=basic
export CDK_PARAM_STAGE=prod
export CDK_ADV_CLUSTER=INACTIV
export CDK_BASIC_CLUSTER=prod-basic

cd ../server

# Generate service-info.json
REGION=$(aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]')
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
sed "s/<REGION>/$REGION/g; s/<ACCOUNT_ID>/$ACCOUNT_ID/g" ./service-info.txt > ./lib/service-info.json

# Deploy ONLY the tenant stack (skip Service Connect reset)
npx cdk deploy tenant-template-stack-basic --require-approval=never
```

**This Approach:**
- ✅ Skips Service Connect reset (no unnecessary restarts)
- ✅ Only updates what changed
- ✅ Less downtime (~1-2 minutes for rproxy only)
- ✅ Lower risk

### **Option B: Use Force New Deployment** (SAFEST)

**Step 1**: Deploy to create the academic service definition
```bash
# Run the safe deployment script above
```

**Step 2**: If rproxy fails, force redeploy it
```bash
aws ecs update-service \
  --cluster prod-basic \
  --service rproxy-service \
  --force-new-deployment \
  --profile dev
```

**Step 3**: Start academic service
```bash
aws ecs update-service \
  --cluster prod-basic \
  --service academic-service \
  --desired-count 1 \
  --profile dev
```

---

## 🎯 **My Recommendation**

### **For Production/Live System**: Use Option A (incremental)
- Less disruptive
- More controlled
- Can rollback easily

### **For Development/Testing**: Use `install.sh` 
- Full reset
- Ensures everything is clean
- Acceptable downtime

---

## 📝 **What Would YOU Like to Do?**

**Option 1**: Create and run the safe deployment script (Option A above)
- Minimal disruption
- Skip Service Connect reset
- I can create this script for you

**Option 2**: Run `install.sh` and accept the 2-4 minute downtime
- Full deployment
- Complete reset
- Standard approach

**Option 3**: Manual step-by-step deployment
- Maximum control
- You approve each step
- Longest process but safest

Which approach would you prefer?

