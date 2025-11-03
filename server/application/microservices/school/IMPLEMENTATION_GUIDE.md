# School Service MVP Implementation Guide

## 🎯 Overview

This guide walks you through implementing the enhanced School Service for EdForge - a production-ready, enterprise-grade multi-tenant education management system.

**Architecture:** DynamoDB single-table design + EventBridge + ECS (your existing SBT stack)

**No Redis needed for MVP** - We'll use application-level caching with short TTLs

---

## 📋 What We've Built So Far

### ✅ Completed

1. **Enhanced Entity Definitions** (`entities/school.entity.enhanced.ts`)
   - School, AcademicYear, GradingPeriod, Holiday, Department entities
   - DynamoDB single-table design with GSI keys
   - Optimistic locking via version field
   - Complete TypeScript interfaces with documentation

2. **Validation Service** (`services/validation.service.ts`)
   - Input validation (formats, ranges, business rules)
   - Uniqueness checks (school codes, department codes)
   - Referential integrity (school exists, etc.)
   - Global support (timezones, phone formats, country codes)

3. **Academic Year Service** (`services/academic-year.service.ts`)
   - Temporal boundary enforcement
   - "One current year" rule with DynamoDB transactions
   - Status transition validation
   - Grading periods and holidays management

4. **Event Service** (`services/event.service.ts`)
   - EventBridge integration
   - Domain events for cross-service communication
   - Batch publishing support
   - Error handling with DLQ pattern

---

## 🚀 Next Steps to Complete MVP

### Step 1: Update CDK Stack for GSIs (30 minutes)

Your DynamoDB table needs Global Secondary Indexes for efficient queries.

**File:** `server/lib/tenant-template/ecs-dynamodb.ts`

Add GSIs to your table definition:

```typescript
// In your EcsDynamoDB construct
const table = new dynamodb.Table(this, `${props.tableName}`, {
  tableName: `${props.tableName}`,
  billingMode: dynamodb.BillingMode.PROVISIONED,
  partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'entityKey', type: dynamodb.AttributeType.STRING },
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  pointInTimeRecoverySpecification: { 
    pointInTimeRecoveryEnabled: true 
  }
});

// GSI1 - School Index (query all entities for a school)
table.addGlobalSecondaryIndex({
  indexName: 'GSI1',
  partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL
});

// GSI2 - Academic Year Index (query entities within a year)
table.addGlobalSecondaryIndex({
  indexName: 'GSI2',
  partitionKey: { name: 'gsi2pk', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'gsi2sk', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL
});

// GSI3 - Status Index (filter by status, pagination)
table.addGlobalSecondaryIndex({
  indexName: 'GSI3',
  partitionKey: { name: 'gsi3pk', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'gsi3sk', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL
});

// GSI4 - Activity Log Index (time-series queries for audit)
table.addGlobalSecondaryIndex({
  indexName: 'GSI4',
  partitionKey: { name: 'gsi4pk', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'gsi4sk', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL,
  timeToLiveAttribute: 'ttl' // 2-year retention for FERPA
});
```

**Deploy:**
```bash
cd server
npx cdk deploy --all
```

### Step 2: Enhance Schools Service (1 hour)

Update `schools/schools.service.ts` to use new patterns:

```typescript
import { Injectable, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ClientFactoryService } from '@app/client-factory';
import { v4 as uuid } from 'uuid';
import {
  School,
  Department,
  SchoolConfiguration,
  EntityKeyBuilder,
  RequestContext
} from './entities/school.entity.enhanced';
import { ValidationService } from './services/validation.service';
import { EventService } from './services/event.service';

@Injectable()
export class SchoolsService {
  constructor(
    private readonly clientFac: ClientFactoryService,
    private readonly validationService: ValidationService,
    private readonly eventService: EventService
  ) {}
  
  private tableName: string = process.env.TABLE_NAME || 'SCHOOL_TABLE_NAME';

  /**
   * Create School with full validation and event publishing
   */
  async createSchool(
    tenantId: string,
    createDto: any,
    context: RequestContext
  ): Promise<School> {
    // 1. Validate input
    await this.validationService.validateSchoolCreation(tenantId, createDto, context.jwtToken);

    // 2. Create school entity
    const schoolId = uuid();
    const timestamp = new Date().toISOString();

    const school: School = {
      // Keys
      tenantId,
      entityKey: EntityKeyBuilder.school(schoolId),
      
      // Core fields
      schoolId,
      schoolName: createDto.schoolName,
      schoolCode: createDto.schoolCode.toUpperCase(),
      schoolType: createDto.schoolType,
      
      contactInfo: createDto.contactInfo,
      address: createDto.address,
      
      maxStudentCapacity: createDto.maxStudentCapacity,
      gradeRange: createDto.gradeRange || { lowestGrade: 'K', highestGrade: '12' },
      
      status: 'active',
      
      // Audit
      createdAt: timestamp,
      createdBy: context.userId,
      updatedAt: timestamp,
      updatedBy: context.userId,
      version: 1,
      
      // DynamoDB metadata
      entityType: 'SCHOOL',
      gsi1pk: schoolId,
      gsi1sk: `METADATA#${schoolId}`,
      gsi3pk: `${tenantId}#SCHOOL`,
      gsi3sk: `active#${timestamp}`
    };

    // 3. Save to DynamoDB
    const client = await this.clientFac.getClient(tenantId, context.jwtToken);
    
    await client.send(new PutCommand({
      TableName: this.tableName,
      Item: school
    }));

    // 4. Publish event
    await this.eventService.publishEvent({
      eventType: 'SchoolCreated',
      timestamp,
      tenantId,
      schoolId,
      schoolName: school.schoolName,
      schoolCode: school.schoolCode,
      schoolType: school.schoolType,
      timezone: school.address.timezone,
      maxCapacity: school.maxStudentCapacity
    });

    console.log(`School created: ${school.schoolName} (${schoolId})`);

    return school;
  }

  /**
   * Get all schools for tenant
   */
  async getSchools(tenantId: string, jwtToken: string): Promise<School[]> {
    const client = await this.clientFac.getClient(tenantId, jwtToken);

    const result = await client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'tenantId = :tenantId',
      FilterExpression: 'entityType = :type',
      ExpressionAttributeValues: {
        ':tenantId': tenantId,
        ':type': 'SCHOOL'
      }
    }));

    return (result.Items || []) as School[];
  }

  /**
   * Get school by ID
   */
  async getSchool(tenantId: string, schoolId: string, jwtToken: string): Promise<School> {
    const client = await this.clientFac.getClient(tenantId, jwtToken);

    const result = await client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'tenantId = :tenantId AND entityKey = :entityKey',
      ExpressionAttributeValues: {
        ':tenantId': tenantId,
        ':entityKey': EntityKeyBuilder.school(schoolId)
      }
    }));

    if (!result.Items || result.Items.length === 0) {
      throw new NotFoundException('School not found');
    }

    return result.Items[0] as School;
  }

  /**
   * Update school with optimistic locking
   */
  async updateSchool(
    tenantId: string,
    schoolId: string,
    updates: any,
    currentVersion: number,
    context: RequestContext
  ): Promise<School> {
    const client = await this.clientFac.getClient(tenantId, context.jwtToken);

    try {
      const result = await client.send(new UpdateCommand({
        TableName: this.tableName,
        Key: {
          tenantId,
          entityKey: EntityKeyBuilder.school(schoolId)
        },
        UpdateExpression: 'SET schoolName = :name, updatedAt = :now, updatedBy = :userId, #version = :newVersion',
        ConditionExpression: '#version = :currentVersion',
        ExpressionAttributeNames: {
          '#version': 'version'
        },
        ExpressionAttributeValues: {
          ':name': updates.schoolName,
          ':now': new Date().toISOString(),
          ':userId': context.userId,
          ':currentVersion': currentVersion,
          ':newVersion': currentVersion + 1
        },
        ReturnValues: 'ALL_NEW'
      }));

      return result.Attributes as School;
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        throw new HttpException(
          'School was modified by another user. Please refresh and try again.',
          HttpStatus.CONFLICT
        );
      }
      throw error;
    }
  }
}
```

### Step 3: Update Controller (30 minutes)

Update `schools/schools.controller.ts`:

```typescript
import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  Req
} from '@nestjs/common';
import { SchoolsService } from './schools.service';
import { AcademicYearService } from './services/academic-year.service';
import { TenantCredentials } from '@app/auth/auth.decorator';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { RequestContext } from './entities/school.entity.enhanced';

@Controller('schools')
@UseGuards(JwtAuthGuard)
export class SchoolsController {
  constructor(
    private readonly schoolsService: SchoolsService,
    private readonly academicYearService: AcademicYearService
  ) {}

  @Post()
  async createSchool(
    @Body() createDto: any,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context: RequestContext = {
      userId: req.user?.sub || 'unknown',
      userRole: req.user?.['custom:userRole'] || 'user',
      tenantId: tenant.tenantId,
      jwtToken: req.headers.authorization?.replace('Bearer ', '') || '',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    };

    return await this.schoolsService.createSchool(tenant.tenantId, createDto, context);
  }

  @Get()
  async getSchools(@TenantCredentials() tenant, @Req() req) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.schoolsService.getSchools(tenant.tenantId, jwtToken);
  }

  @Get(':schoolId')
  async getSchool(@Param('schoolId') schoolId: string, @TenantCredentials() tenant, @Req() req) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.schoolsService.getSchool(tenant.tenantId, schoolId, jwtToken);
  }

  // Academic Year endpoints
  @Post(':schoolId/academic-years')
  async createAcademicYear(
    @Param('schoolId') schoolId: string,
    @Body() createDto: any,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context: RequestContext = {
      userId: req.user?.sub || 'unknown',
      userRole: req.user?.['custom:userRole'] || 'user',
      tenantId: tenant.tenantId,
      jwtToken: req.headers.authorization?.replace('Bearer ', '') || '',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    };

    return await this.academicYearService.createAcademicYear(
      tenant.tenantId,
      schoolId,
      createDto,
      context
    );
  }

  @Get(':schoolId/academic-years')
  async getAcademicYears(
    @Param('schoolId') schoolId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.academicYearService.getAcademicYears(tenant.tenantId, schoolId, jwtToken);
  }

  @Get(':schoolId/academic-years/current')
  async getCurrentAcademicYear(
    @Param('schoolId') schoolId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.academicYearService.getCurrentAcademicYear(tenant.tenantId, schoolId, jwtToken);
  }

  @Put(':schoolId/academic-years/:yearId/set-current')
  async setCurrentAcademicYear(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context: RequestContext = {
      userId: req.user?.sub || 'unknown',
      userRole: req.user?.['custom:userRole'] || 'user',
      tenantId: tenant.tenantId,
      jwtToken: req.headers.authorization?.replace('Bearer ', '') || '',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    };

    await this.academicYearService.setAsCurrentYear(tenant.tenantId, schoolId, yearId, context);
    return { message: 'Current academic year updated successfully' };
  }
}
```

### Step 4: Update Module (10 minutes)

Update `schools/schools.module.ts`:

```typescript
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

### Step 5: Environment Variables (5 minutes)

Update your `.env` or ECS task definition:

```bash
# Existing
AWS_REGION=us-east-1
TABLE_NAME=school-table-basic  # or school-table-advanced-{tenantId} for advanced tier
COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
STS_ROLE_ARN=arn:aws:iam::123456789012:role/EdForgeTenantRole

# New for EventBridge
EVENT_BUS_NAME=default  # or your SBT event bus name
```

---

## 🧪 Testing Your Implementation

### Test 1: Create a School

```bash
curl -X POST https://your-alb-url.com/schools \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "schoolName": "Lincoln High School",
    "schoolCode": "LHS-001",
    "schoolType": "high",
    "contactInfo": {
      "primaryEmail": "info@lincolnhs.edu",
      "primaryPhone": "+1-555-0123"
    },
    "address": {
      "street": "123 Main St",
      "city": "Springfield",
      "state": "IL",
      "country": "US",
      "postalCode": "62701",
      "timezone": "America/Chicago"
    },
    "maxStudentCapacity": 2000,
    "gradeRange": {
      "lowestGrade": "9",
      "highestGrade": "12"
    }
  }'
```

### Test 2: Create Academic Year

```bash
curl -X POST https://your-alb-url.com/schools/SCHOOL_ID/academic-years \
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
      "instructionalDays": 180
    }
  }'
```

### Test 3: Verify EventBridge

Check CloudWatch Logs for your school service:

```
Event published: SchoolCreated { schoolId: 'xxx', tenantId: 'yyy' }
```

---

## 📊 Caching Strategy (Without Redis for MVP)

Since we're deferring Redis to save costs, use application-level caching:

```typescript
// Simple in-memory cache with TTL
class SimpleCache {
  private cache = new Map<string, { data: any; expiry: number }>();

  set(key: string, data: any, ttlSeconds: number): void {
    const expiry = Date.now() + (ttlSeconds * 1000);
    this.cache.set(key, { data, expiry });
  }

  get(key: string): any | null {
    const cached = this.cache.get(key);
    if (!cached) return null;
    
    if (Date.now() > cached.expiry) {
      this.cache.delete(key);
      return null;
    }
    
    return cached.data;
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }
}

// Usage in service
private cache = new SimpleCache();

async getCurrentAcademicYear(tenantId: string, schoolId: string, jwtToken: string) {
  const cacheKey = `current-year:${tenantId}:${schoolId}`;
  
  // Check cache
  const cached = this.cache.get(cacheKey);
  if (cached) {
    console.log(`Cache HIT: ${cacheKey}`);
    return cached;
  }
  
  // Cache miss - query DynamoDB
  const year = await this.queryDynamoDB(...);
  
  // Cache for 1 hour (current year rarely changes)
  this.cache.set(cacheKey, year, 3600);
  
  return year;
}
```

**When to add Redis:**
- When you have > 100 schools
- When cache hit rate < 70%
- When response times > 200ms

---

## 🚀 Deployment

```bash
# 1. Build Docker image
cd server/application
docker build -f Dockerfile.school -t school-service:latest .

# 2. Push to ECR (your existing pipeline handles this)
# 3. Deploy CDK stack
cd ../..
npx cdk deploy --all

# 4. Verify deployment
curl https://your-alb-url.com/schools/health
```

---

## 📈 Monitoring

### CloudWatch Metrics to Track

1. **API Latency**
   - p50, p95, p99 response times
   - Target: < 100ms p99

2. **DynamoDB**
   - Read/Write capacity utilization
   - Throttled requests (should be 0)

3. **EventBridge**
   - Failed event count
   - Event age

4. **Business Metrics**
   - Schools created per day
   - Academic years active
   - API error rate

---

## 🎯 What's Next (Post-MVP)

1. **Phase 3: Department Management** (Week 6-7)
   - Budget tracking
   - Staff assignments
   - Resource allocation

2. **Phase 4: Audit Logging** (Week 3)
   - Activity logs with 2-year TTL
   - Compliance reporting
   - Data access tracking

3. **Phase 5: Redis Caching** (When needed)
   - ElastiCache cluster
   - Cache invalidation via events
   - Distributed caching for multi-instance

4. **Phase 6: Advanced Features**
   - Facilities management
   - Enrollment capacity tracking
   - Real-time dashboards

---

## 💡 Pro Tips

1. **Always validate timezone** - Critical for global deployments
2. **Use transactions for critical operations** - Like setting current year
3. **Don't throw on event publishing failures** - Log and continue
4. **Monitor DynamoDB capacity** - Add alarms for throttling
5. **Test with real school data** - Edge cases matter

---

## 🆘 Troubleshooting

### Issue: "School code already exists"
**Solution:** School codes must be unique within tenant. Use validation service.

### Issue: "ConditionalCheckFailedException"
**Solution:** Version conflict - someone else updated the record. Implement retry with fetch.

### Issue: Events not appearing in CloudWatch
**Solution:** Check EVENT_BUS_NAME environment variable. Verify IAM permissions.

### Issue: GSI not found
**Solution:** Deploy CDK stack to create GSIs. Check table in DynamoDB console.

---

**You're ready to build an amazing school management system! 🚀**

Need help? Check the code comments or reach out.

