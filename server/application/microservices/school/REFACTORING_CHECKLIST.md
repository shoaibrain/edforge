# School Service Refactoring Checklist

## 🎯 Objective
Replace old implementation with enhanced enterprise-grade architecture while maintaining backward compatibility during transition.

---

## 📋 Step-by-Step Refactoring

### ✅ Step 1: Delete Redundant Files (2 min)

```bash
cd /Users/shoaibrain/edforge/server/application/microservices/school/src/schools

# Already deleted:
# ✅ entities/school.entity.ts (replaced by school.entity.enhanced.ts)
```

### ✅ Step 2: Backup Old Implementation (1 min)

```bash
# Just in case we need to reference
cp schools.service.ts schools.service.old.ts
cp schools.controller.ts schools.controller.old.ts
cp dto/create-school.dto.ts dto/create-school.dto.old.ts
```

### 📝 Step 3: Replace Service File (2 min)

```bash
# Replace schools.service.ts with refactored version
mv schools.service.refactored.ts schools.service.ts
```

Or manually replace the content of `schools.service.ts` with `schools.service.refactored.ts`.

### 📝 Step 4: Replace Controller File (2 min)

```bash
# Replace schools.controller.ts with refactored version
mv schools.controller.refactored.ts schools.controller.ts
```

### 📝 Step 5: Replace DTO File (2 min)

```bash
# Replace old create-school.dto.ts with new school.dto.ts
mv dto/school.dto.ts dto/create-school.dto.ts

# Or keep both and update imports
```

### 📝 Step 6: Update Module (3 min)

**File:** `schools.module.ts`

```typescript
/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 */

import { Module } from '@nestjs/common';
import { SchoolsService } from './schools.service';
import { SchoolsController } from './schools.controller';
import { ValidationService } from './services/validation.service';
import { AcademicYearService } from './services/academic-year.service';
import { EventService } from './services/event.service';
import { AuthModule } from '@app/auth';
import { ConfigModule } from '@nestjs/config';
import { ClientFactoryModule } from '@app/client-factory';

@Module({
  imports: [
    AuthModule,
    ConfigModule.forRoot({ isGlobal: true }),
    ClientFactoryModule
  ],
  controllers: [SchoolsController],
  providers: [
    SchoolsService,
    ValidationService,
    AcademicYearService,
    EventService
  ]
})
export class SchoolsModule {}
```

### 📝 Step 7: Update CDK Stack for GSIs (15 min)

**File:** `/Users/shoaibrain/edforge/server/lib/tenant-template/ecs-dynamodb.ts`

Find the table creation code and add GSIs:

```typescript
this.table = new dynamodb.Table(this, `${props.tableName}`, {
  tableName: `${props.tableName}`,
  billingMode: dynamodb.BillingMode.PROVISIONED,
  partitionKey: { name: props.partitionKey, type: dynamodb.AttributeType.STRING },
  sortKey: { name: props.sortKey, type: dynamodb.AttributeType.STRING },
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  pointInTimeRecoverySpecification: { 
    pointInTimeRecoveryEnabled: true 
  },
  // ADD TIME TO LIVE ATTRIBUTE for audit logs
  timeToLiveAttribute: 'ttl'
});

// ADD GSI1 - School Index (query all entities for a school)
this.table.addGlobalSecondaryIndex({
  indexName: 'GSI1',
  partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL,
  readCapacity: 5,
  writeCapacity: 5
});

// ADD GSI2 - Academic Year Index (query entities within a year)
this.table.addGlobalSecondaryIndex({
  indexName: 'GSI2',
  partitionKey: { name: 'gsi2pk', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'gsi2sk', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL,
  readCapacity: 5,
  writeCapacity: 5
});

// ADD GSI3 - Status Index (filter schools by status)
this.table.addGlobalSecondaryIndex({
  indexName: 'GSI3',
  partitionKey: { name: 'gsi3pk', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'gsi3sk', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL,
  readCapacity: 5,
  writeCapacity: 5
});

// ADD GSI4 - Activity Log Index (time-series audit logs)
this.table.addGlobalSecondaryIndex({
  indexName: 'GSI4',
  partitionKey: { name: 'gsi4pk', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'gsi4sk', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL,
  readCapacity: 5,
  writeCapacity: 5
});
```

**Note:** Check if your current table uses `tenantId` and `entityId` as keys. You need to change:
- `partitionKey: 'tenantId'` ✅ Keep this
- `sortKey: 'entityId'` ❌ Change to `sortKey: 'entityKey'`

### 📝 Step 8: Add EventBridge Permissions (10 min)

**File:** Check your ECS task role definition in CDK

The school service task role needs permission to publish to EventBridge:

```typescript
// In your services.ts or tenant-template-stack.ts
const taskRole = new iam.Role(this, 'SchoolServiceTaskRole', {
  assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
  description: 'School Service ECS Task Role'
});

// Add EventBridge permissions
taskRole.addToPolicy(new iam.PolicyStatement({
  actions: ['events:PutEvents'],
  resources: [
    `arn:aws:events:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:event-bus/default`,
    // Or your custom event bus ARN
  ]
}));
```

### 📝 Step 9: Set Environment Variables (3 min)

**File:** Check where ECS task environment variables are defined

Add:
```typescript
environment: {
  AWS_REGION: 'us-east-1',
  TABLE_NAME: tableName, // Already exists
  USER_POOL_ID: userPoolId, // Already exists
  STS_ROLE_ARN: stsRoleArn, // Already exists
  // ADD THIS:
  EVENT_BUS_NAME: 'default' // or your SBT event bus name
}
```

---

## 🧪 Testing Checklist

### Test 1: Build Application (5 min)

```bash
cd /Users/shoaibrain/edforge/server/application
npm install
npm run build
```

**Expected:** No TypeScript errors

### Test 2: Run Locally (Optional - 10 min)

```bash
# Set environment variables
export AWS_REGION=us-east-1
export TABLE_NAME=school-table-basic
export USER_POOL_ID=us-east-1_XXXXXXXXX
export STS_ROLE_ARN=arn:aws:iam::123456789012:role/...
export EVENT_BUS_NAME=default

# Run
npm run start:dev microservices/school
```

### Test 3: Deploy to AWS (20 min)

```bash
cd /Users/shoaibrain/edforge/server

# Deploy CDK stack (will create GSIs)
npx cdk deploy --all

# Check deployment
# - DynamoDB console: Verify GSIs created
# - ECS console: Check service is running
# - CloudWatch: Check logs for errors
```

### Test 4: API Testing (15 min)

**Test 4.1: Create School**

```bash
curl -X POST https://your-alb-url/schools \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "schoolName": "Test High School",
    "schoolCode": "TEST-HS-001",
    "schoolType": "high",
    "contactInfo": {
      "primaryEmail": "info@testschool.edu",
      "primaryPhone": "+1-555-0100"
    },
    "address": {
      "street": "100 School Lane",
      "city": "San Francisco",
      "state": "CA",
      "country": "US",
      "postalCode": "94102",
      "timezone": "America/Los_Angeles"
    },
    "maxStudentCapacity": 1500,
    "gradeRange": {
      "lowestGrade": "9",
      "highestGrade": "12"
    }
  }'
```

**Expected Response:**
```json
{
  "schoolId": "uuid-here",
  "schoolName": "Test High School",
  "schoolCode": "TEST-HS-001",
  "status": "active",
  "version": 1,
  "createdAt": "2025-10-10T..."
}
```

**Test 4.2: List Schools**

```bash
curl -X GET https://your-alb-url/schools \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Test 4.3: Create Academic Year**

```bash
curl -X POST https://your-alb-url/schools/SCHOOL_ID/academic-years \
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

**Test 4.4: Create Grading Period**

```bash
curl -X POST https://your-alb-url/schools/SCHOOL_ID/academic-years/YEAR_ID/grading-periods \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "periodName": "Fall Semester",
    "periodType": "semester",
    "periodNumber": 1,
    "startDate": "2024-09-01",
    "endDate": "2024-12-20",
    "isCurrent": true
  }'
```

**Test 4.5: Get Current Academic Year**

```bash
curl -X GET https://your-alb-url/schools/SCHOOL_ID/academic-years/current \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Test 5: Verify Events in CloudWatch (5 min)

```bash
# Check CloudWatch Logs for school service
# Look for:
# "Event published: SchoolCreated { schoolId: '...', tenantId: '...' }"
```

**Check EventBridge Console:**
- Go to AWS Console → EventBridge → Event buses → default (or your bus)
- Click "Events" tab
- Look for events with source: `edforge.school-service`

---

## 🔍 Verification Checklist

After deployment, verify:

### DynamoDB
- [ ] Table exists: `school-table-basic` (or advanced/premium)
- [ ] Primary keys: `tenantId` (PK), `entityKey` (SK)
- [ ] GSI1 created: `gsi1pk`, `gsi1sk`
- [ ] GSI2 created: `gsi2pk`, `gsi2sk`
- [ ] GSI3 created: `gsi3pk`, `gsi3sk`
- [ ] GSI4 created: `gsi4pk`, `gsi4sk`
- [ ] TTL enabled on `ttl` attribute

### ECS Service
- [ ] Service running (1 or more tasks)
- [ ] No errors in CloudWatch Logs
- [ ] Health check passing: `/schools/health`

### EventBridge
- [ ] Event bus exists (default or custom)
- [ ] Events appearing in CloudWatch Events
- [ ] No failed event entries

### API Functionality
- [ ] Can create school
- [ ] Can list schools
- [ ] Can get school by ID
- [ ] Can create academic year
- [ ] Can set current academic year
- [ ] Can create grading period
- [ ] Can create holiday
- [ ] Can create department

### Business Rules
- [ ] School code uniqueness enforced
- [ ] Only one current academic year per school
- [ ] Grading periods within year boundaries
- [ ] No overlapping grading periods
- [ ] Optimistic locking prevents concurrent updates

### Events Published
- [ ] SchoolCreated appears in CloudWatch
- [ ] AcademicYearCreated appears in CloudWatch
- [ ] DepartmentCreated appears in CloudWatch

---

## 🚨 Potential Issues & Solutions

### Issue 1: "Cannot find module './entities/school.entity'"
**Solution:** Update all imports to use `./entities/school.entity.enhanced`

```bash
# Find all references
grep -r "entities/school.entity'" src/schools/

# Update to:
# import { ... } from './entities/school.entity.enhanced';
```

### Issue 2: "Property 'entityId' does not exist"
**Solution:** Old code used `entityId`, new code uses `entityKey`

Replace all:
```typescript
// OLD
entityId: schoolId

// NEW
entityKey: EntityKeyBuilder.school(schoolId)
```

### Issue 3: "ValidationService not found"
**Solution:** Ensure module.ts includes ValidationService in providers

### Issue 4: "GSI1 not found in DynamoDB"
**Solution:** Deploy CDK stack to create GSIs

```bash
cd /Users/shoaibrain/edforge/server
npx cdk deploy --all
```

### Issue 5: Events not appearing
**Solution:** Check IAM permissions and EVENT_BUS_NAME

```typescript
// Verify IAM policy on ECS task role
{
  "Effect": "Allow",
  "Action": ["events:PutEvents"],
  "Resource": ["arn:aws:events:*:*:event-bus/*"]
}
```

---

## 📊 Data Migration (If You Have Existing Data)

**IMPORTANT:** You said you're building from scratch, so skip this!

But if you DO have existing school data:

```typescript
// Migration script: old format → new format
async function migrateSchoolData() {
  const oldSchools = await scanTable('school-table-basic');
  
  for (const old of oldSchools) {
    if (old.entityType !== 'SCHOOL') continue;
    
    const newSchool: School = {
      tenantId: old.tenantId,
      entityKey: `SCHOOL#${old.schoolId}`, // NEW key format
      
      schoolId: old.schoolId,
      schoolName: old.schoolName,
      schoolCode: old.schoolCode,
      schoolType: old.schoolType || 'k12',
      
      // RESTRUCTURE: Flat → Nested
      contactInfo: {
        primaryEmail: old.email,
        primaryPhone: old.phone,
        website: old.website
      },
      address: {
        street: old.address,
        city: old.city,
        state: old.state,
        country: old.country || 'US',
        postalCode: old.postalCode,
        timezone: 'America/New_York' // DEFAULT - should be updated
      },
      
      maxStudentCapacity: old.maxStudents || 1000,
      gradeRange: {
        lowestGrade: 'K',
        highestGrade: '12'
      },
      
      status: (old.status || 'ACTIVE').toLowerCase(),
      
      createdAt: old.createdAt,
      createdBy: old.createdBy || 'migration',
      updatedAt: new Date().toISOString(),
      updatedBy: 'migration',
      version: 1,
      
      entityType: 'SCHOOL',
      gsi1pk: old.schoolId,
      gsi1sk: `METADATA#${old.schoolId}`,
      gsi3pk: `${old.tenantId}#SCHOOL`,
      gsi3sk: `active#${old.createdAt}`
    };
    
    // Write with new structure
    await ddb.put({
      TableName: 'school-table-basic',
      Item: newSchool
    });
    
    // Delete old record (has wrong SK)
    await ddb.delete({
      TableName: 'school-table-basic',
      Key: {
        tenantId: old.tenantId,
        entityId: old.schoolId  // OLD key
      }
    });
  }
}
```

---

## 🏗️ Build & Deploy Commands

### Local Build

```bash
cd /Users/shoaibrain/edforge/server/application

# Install dependencies (if not already)
npm install

# Build TypeScript
npm run build

# Check for errors
npm run lint
```

### Docker Build (What gets deployed to ECS)

```bash
cd /Users/shoaibrain/edforge/server/application

# Build Docker image
docker build -f Dockerfile.school -t school-service:latest .

# Test locally
docker run -p 3010:3010 \
  -e AWS_REGION=us-east-1 \
  -e TABLE_NAME=school-table-basic \
  -e EVENT_BUS_NAME=default \
  school-service:latest
```

### CDK Deploy

```bash
cd /Users/shoaibrain/edforge/server

# Synthesize to check for errors
npx cdk synth

# Deploy (creates GSIs, updates ECS)
npx cdk deploy --all

# Or deploy specific stack
npx cdk deploy TenantTemplateStack-basic
```

---

## 📝 Post-Deployment Checklist

### Immediate (Within 1 hour)
- [ ] Health check returns 200: `GET /schools/health`
- [ ] Can create a school
- [ ] School appears in DynamoDB with proper entityKey
- [ ] Event appears in CloudWatch Logs
- [ ] No errors in ECS task logs

### Within 24 Hours
- [ ] Create 10+ schools to test performance
- [ ] Test concurrent updates (optimistic locking)
- [ ] Test academic year "one current" rule
- [ ] Test grading period validation
- [ ] Monitor DynamoDB read/write capacity

### Within 1 Week
- [ ] Integrate with Student Service (subscribe to SchoolCreated event)
- [ ] Test cross-service coordination
- [ ] Load test (100 schools, 10 years each)
- [ ] Monitor costs in AWS Cost Explorer

---

## 🎯 Success Criteria

### Technical
- ✅ All APIs return < 200ms (p99)
- ✅ No DynamoDB throttling
- ✅ Events published successfully (100%)
- ✅ Zero data integrity issues
- ✅ Optimistic locking prevents conflicts

### Business
- ✅ Can create schools with international addresses
- ✅ Academic years enforce temporal boundaries
- ✅ Only one current year per school
- ✅ Grading periods cannot overlap
- ✅ Department codes unique within school

---

## 🔄 Rollback Plan

If something goes wrong:

```bash
# 1. Restore old service files
cp schools.service.old.ts schools.service.ts
cp schools.controller.old.ts schools.controller.ts

# 2. Rebuild
npm run build

# 3. Redeploy
npx cdk deploy --all

# 4. Verify health check
curl https://your-alb/schools/health
```

---

## 📚 Reference

- **Entities:** `entities/school.entity.enhanced.ts`
- **Validation:** `services/validation.service.ts`
- **Academic Year:** `services/academic-year.service.ts`
- **Events:** `services/event.service.ts`
- **Service:** `schools.service.ts` (refactored)
- **Controller:** `schools.controller.ts` (refactored)
- **Module:** `schools.module.ts` (updated)

---

## ✅ Final Checklist

Before marking complete:

- [ ] All old files backed up
- [ ] All new files in place
- [ ] Module updated with new providers
- [ ] CDK stack updated with GSIs
- [ ] EventBridge permissions added
- [ ] Environment variables set
- [ ] Build successful (no errors)
- [ ] Deployed to AWS
- [ ] Health check passing
- [ ] Can create school
- [ ] Can create academic year
- [ ] Events appearing in CloudWatch

---

**Estimated Time:** 2-3 hours total

**You're building an enterprise-grade system! 🚀**

