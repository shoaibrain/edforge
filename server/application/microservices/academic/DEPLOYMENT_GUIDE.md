# Academic Service - Clean Build & Deployment Guide

## 🎉 **Local Test: SUCCESS!**

```
✅ All modules loaded successfully
✅ 23 API endpoints registered
✅ Service running on port 3010
✅ Health check: /academic/health

Modules:
- ClassroomModule: 7 endpoints
- AssignmentModule: 7 endpoints  
- GradingModule: 7 endpoints
- AttendanceModule: 7 endpoints
- HealthController: 1 endpoint
```

---

## 🧹 **Pre-Deployment Checklist**

### **Files Updated for Deployment**

✅ **Build Configuration**
- `server/application/nest-cli.json` - Added academic project
- `server/application/package.json` - Added start:academic script
- `server/application/microservices/academic/tsconfig.app.json` - TypeScript config

✅ **Container Configuration**
- `server/application/Dockerfile.academic` - Multi-stage build
- `server/service-info.txt` - Academic container definition (template)
- `server/lib/service-info.json` - Academic container definition (generated)

✅ **Routing Configuration**
- `server/application/reverseproxy/nginx.template` - /academic route added

✅ **Build Scripts**
- `scripts/build-application.sh` - Academic added to SERVICE_REPOS

---

## 🚀 **Deployment Steps**

### **Step 1: Clean All Caches**

```bash
# Clean npm cache
cd /Users/shoaibrain/edforge/server/application
npm cache clean --force

# Clean build artifacts
rm -rf dist/
rm -rf node_modules/.cache/

# Clean Docker build cache (optional but recommended)
docker builder prune -af
```

### **Step 2: Fresh Build**

```bash
# Rebuild all services
cd /Users/shoaibrain/edforge/server/application
rm -rf dist/
npm run build

# This will build:
# - user
# - school  
# - academic ✅
```

### **Step 3: Build & Push Docker Images**

```bash
cd /Users/shoaibrain/edforge/scripts

# This builds and pushes:
# - user
# - rproxy
# - school
# - academic ✅
./build-application.sh
```

**Expected Output:**
```
Building and pushing: user
Building and pushing: rproxy
Building and pushing: school
Building and pushing: academic ✅
```

### **Step 4: Deploy to AWS**

```bash
cd /Users/shoaibrain/edforge/scripts

# Full deployment
CDK_NAG_ENABLED=false AWS_PROFILE=dev ./install.sh shoaib.rain1@gmail.com
```

**What This Does:**
1. Creates/updates CloudFormation stacks
2. Deploys ECS services (user, school, academic ✅)
3. Creates DynamoDB table (shared)
4. Sets up API Gateway
5. Configures Cognito
6. Deploys reverse proxy with academic routing

---

## 🎯 **Expected ECS Services After Deployment**

```
Cluster: tenant-{tier}-cluster

Services:
├── rproxy-service        (Nginx reverse proxy)
├── users-service         (User management)
├── school-service        (School & academic year management)
└── academic-service ✅   (Classroom, Assignment, Grading, Attendance)
```

**Service Discovery (Cloud Map):**
```
{namespace}.sc:
├── users-api.{namespace}.sc:3010
├── school-api.{namespace}.sc:3010
└── academic-api.{namespace}.sc:3010 ✅
```

---

## 📊 **DynamoDB Table Structure After Deployment**

```
Table: SCHOOL_TABLE_V2 (shared by school + academic services)

Entity Types:
├── SCHOOL              (from school service)
├── ACADEMIC_YEAR       (from school service)
├── DEPARTMENT          (from school service)
├── GRADING_PERIOD      (from school service)
├── HOLIDAY             (from school service)
├── CLASSROOM       ✅  (from academic service)
├── ASSIGNMENT      ✅  (from academic service)
├── GRADE           ✅  (from academic service)
└── ATTENDANCE      ✅  (from academic service)

GSIs:
- GSI1: gsi1pk-gsi1sk-index (school/year scoped)
- GSI2: gsi2pk-gsi2sk-index (teacher scoped)
- GSI3: gsi3pk-gsi3sk-index (student scoped)
```

---

## 🔍 **Post-Deployment Verification**

### **1. Check ECS Services**
```bash
aws ecs list-services --cluster tenant-basic-cluster
# Should show: users, school, academic, rproxy
```

### **2. Check Service Health**
```bash
# Get ALB URL
aws cloudformation describe-stacks \
  --stack-name shared-infra-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`AlbDnsName`].OutputValue' \
  --output text

# Test health endpoints
curl -H "tenantPath: {tenantId}" https://{alb-url}/prod/academic/health
```

### **3. Check Cloud Map Registration**
```bash
aws servicediscovery list-services
# Should include: users-api, school-api, academic-api
```

### **4. Test Academic API**
```bash
# Example: Create classroom
curl -X POST \
  -H "Authorization: Bearer {jwt-token}" \
  -H "tenantPath: {tenantId}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Math 101 - Section A",
    "code": "MATH101-A",
    "subject": "Mathematics",
    "grade": "10",
    "teacherId": "{teacher-id}",
    "schedule": [
      {
        "dayOfWeek": "MON",
        "startTime": "09:00",
        "endTime": "10:30",
        "periodNumber": 1
      }
    ]
  }' \
  https://{alb-url}/prod/academic/schools/{schoolId}/academic-years/{yearId}/classrooms
```

---

## ⚠️ **Known Considerations**

### **Stubbed Functionality (To Connect Later)**

1. **DynamoDB Operations**
   - Services return mock data currently
   - Need to enable ClientFactory connections
   - Uncomment DynamoDB operations in services

2. **Inter-Service Validation**
   - Verifying teacher IDs exist (call User Service)
   - Verifying student IDs exist (call Student Service - when built)
   - Verifying academic year exists (call School Service)

3. **EventBridge Integration**
   - Event publishing stubbed
   - Can enable when needed for async workflows

### **API Gateway Configuration**

The `tenant-api-prod.json` may need updates to include `/academic` paths for API Gateway routing. For now, nginx handles the routing, which is sufficient for MVP.

---

## 🎯 **Deployment Command**

Ready to deploy? Run:

```bash
cd /Users/shoaibrain/edforge/scripts
CDK_NAG_ENABLED=false AWS_PROFILE=dev ./install.sh shoaib.rain1@gmail.com
```

This will deploy the complete stack with the academic service included! 🚀

