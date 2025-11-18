# School Service

**Version:** 2.0.0  
**Status:** Production-Ready  
**Bounded Context:** School Management

---

## Service Overview

The School Service manages core school infrastructure including schools, academic years, departments, grading periods, and holidays. It serves as the foundation for all other services, providing temporal boundaries (academic years) and organizational structure (departments).

### Domain & Bounded Context

**Primary Aggregate:** School  
**Sub-Aggregates:** AcademicYear, Department, GradingPeriod, Holiday

**Business Capabilities:**
- School lifecycle management (create, update, delete)
- Academic year management (temporal boundaries)
- Department structure management
- Grading period configuration
- Holiday calendar management
- School configuration management

---

## Architecture

### Technology Stack
- **Framework:** NestJS
- **Database:** DynamoDB (shared `school-table-{tier}`)
- **Authentication:** JWT (Cognito)
- **Events:** AWS EventBridge

### Module Structure
```
school-service/
├── src/
│   ├── schools/
│   │   ├── schools.controller.ts    # REST API endpoints
│   │   ├── schools.service.ts        # Business logic
│   │   ├── schools.module.ts         # Module definition
│   │   ├── dto/
│   │   │   └── school.dto.ts         # Data Transfer Objects
│   │   ├── entities/
│   │   │   └── school.entity.enhanced.ts  # Entity definitions
│   │   └── services/
│   │       ├── validation.service.ts      # Input validation
│   │       ├── academic-year.service.ts   # Academic year logic
│   │       └── event.service.ts           # EventBridge publisher
│   └── app.module.ts
```

---

## API Endpoints

### Base Path: `/schools`

### School Management

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| POST | `/schools` | Create a new school | ✅ Implemented |
| GET | `/schools` | List all schools for tenant | ✅ Implemented |
| GET | `/schools/:schoolId` | Get school by ID | ✅ Implemented |
| PUT | `/schools/:schoolId` | Update school | ✅ Implemented |
| DELETE | `/schools/:schoolId` | Delete school | ✅ Implemented |

### School Configuration

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| GET | `/schools/:schoolId/configuration` | Get school configuration | ✅ Implemented |
| PUT | `/schools/:schoolId/configuration` | Update school configuration | ✅ Implemented |

### Department Management

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| POST | `/schools/:schoolId/departments` | Create department | ✅ Implemented |
| GET | `/schools/:schoolId/departments` | List departments | ✅ Implemented |

### Academic Year Management

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| POST | `/schools/:schoolId/academic-years` | Create academic year | ✅ Implemented |
| GET | `/schools/:schoolId/academic-years` | List academic years | ✅ Implemented |
| GET | `/schools/:schoolId/academic-years/current` | Get current academic year | ✅ Implemented |
| GET | `/schools/:schoolId/academic-years/:yearId` | Get academic year by ID | ✅ Implemented |
| PUT | `/schools/:schoolId/academic-years/:yearId` | Update academic year | ✅ Implemented |
| PUT | `/schools/:schoolId/academic-years/:yearId/set-current` | Set as current year | ✅ Implemented |
| PUT | `/schools/:schoolId/academic-years/:yearId/status` | Update academic year status | ✅ Implemented |

### Grading Period Management

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| POST | `/schools/:schoolId/academic-years/:yearId/grading-periods` | Create grading period | ✅ Implemented |
| GET | `/schools/:schoolId/academic-years/:yearId/grading-periods` | List grading periods | ✅ Implemented |

### Holiday Management

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| POST | `/schools/:schoolId/academic-years/:yearId/holidays` | Create holiday | ✅ Implemented |
| GET | `/schools/:schoolId/academic-years/:yearId/holidays` | List holidays | ✅ Implemented |

### Health Check

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| GET | `/schools/health` | Service health check | ✅ Implemented |

---

## Data Model

### Entities

#### School
```typescript
{
  tenantId: string;              // Partition key
  entityKey: string;             // Sort key: SCHOOL#schoolId
  entityType: 'SCHOOL';
  schoolId: string;
  name: string;
  address: Address;
  contactInfo: ContactInfo;
  status: 'active' | 'inactive' | 'archived';
  timezone: string;
  configuration: Record<string, any>;
  // ... metadata fields
}
```

#### AcademicYear
```typescript
{
  tenantId: string;
  entityKey: string;             // SCHOOL#schoolId#YEAR#yearId
  entityType: 'ACADEMIC_YEAR';
  schoolId: string;
  academicYearId: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'planned' | 'active' | 'completed' | 'cancelled';
  isCurrent: boolean;
  // ... metadata fields
}
```

#### Department
```typescript
{
  tenantId: string;
  entityKey: string;             // SCHOOL#schoolId#DEPT#deptId
  entityType: 'DEPARTMENT';
  schoolId: string;
  departmentId: string;
  name: string;
  code: string;
  headId?: string;               // Staff ID
  // ... metadata fields
}
```

### DynamoDB Access Patterns

**Primary Access:**
- Get by ID: `PK=tenantId, SK=entityKey`

**GSI1 (School-scoped queries):**
- List all entities for school: `GSI1PK=schoolId`

**GSI2 (Academic Year queries):**
- List entities by academic year: `GSI2PK=schoolId#academicYearId`

---

## Events Published

All events are published to AWS EventBridge with source: `edforge.school-service`

### School Events

- **`SchoolCreated`** - Published when a new school is created
- **`SchoolUpdated`** - Published when school details are updated
- **`SchoolDeleted`** - Published when a school is deleted
- **`SchoolStatusChanged`** - Published when school status changes

### Academic Year Events

- **`AcademicYearCreated`** - Published when a new academic year is created
- **`AcademicYearUpdated`** - Published when academic year details are updated
- **`AcademicYearStarted`** - Published when academic year status changes to 'active'
- **`AcademicYearEnded`** - Published when academic year status changes to 'completed'
- **`CurrentAcademicYearChanged`** - Published when current academic year is changed

### Department Events

- **`DepartmentCreated`** - Published when a new department is created
- **`DepartmentUpdated`** - Published when department details are updated
- **`DepartmentRestructured`** - Published when department structure changes

### Other Events

- **`GradingPeriodCreated`** - Published when a grading period is created
- **`HolidayCreated`** - Published when a holiday is added

---

## Events Consumed

**None** - School Service is a foundational service that doesn't consume events from other services.

---

## Dependencies

### External Services
- **None** - School Service is independent and doesn't call other services

### Shared Infrastructure
- **DynamoDB**: Shared `school-table-{tier}` table
- **EventBridge**: Custom event bus for publishing events
- **Cognito**: JWT token validation (via API Gateway)

---

## Security Implementation

### Authentication
- **JWT Guard**: All endpoints (except `/health`) require JWT authentication
- **Tenant Context**: Extracted from JWT `custom:tenantId` claim
- **User Context**: Extracted from JWT for audit logging

### Authorization
- **Tenant Isolation**: All queries filtered by `tenantId` (partition key)
- **Role-Based**: Basic role checks (TenantAdmin vs TenantUser)
- **Future**: AWS Verified Permissions for fine-grained authorization

### Data Access
- **Infrastructure-Level**: DynamoDB LeadingKeys condition ensures tenant isolation
- **Application-Level**: All service methods require `tenantId` parameter
- **Audit Logging**: All operations logged with `userId`, `userRole`, `ipAddress`

---

## Implementation Status

### ✅ Implemented

- [x] School CRUD operations
- [x] Academic year management
- [x] Department management
- [x] Grading period management
- [x] Holiday management
- [x] School configuration management
- [x] Event publishing to EventBridge
- [x] Input validation
- [x] Optimistic locking (version field)
- [x] Audit logging
- [x] Error handling
- [x] Health check endpoint

### ⏳ Pending

- [ ] Department head assignment validation (verify staff exists)
- [ ] Academic year overlap validation
- [ ] Holiday conflict detection
- [ ] Bulk operations (bulk create holidays, etc.)
- [ ] School configuration schema validation
- [ ] Enhanced error messages

### ❌ Missing

- [ ] School hierarchy (districts, networks)
- [ ] Multi-campus support
- [ ] School templates/cloning
- [ ] Import/export functionality
- [ ] Advanced reporting

---

## Testing Status

### Unit Tests
- ⏳ **Pending** - Unit tests for services and validation

### Integration Tests
- ⏳ **Pending** - Integration tests for API endpoints

### E2E Tests
- ⏳ **Pending** - End-to-end workflow tests

---

## Deployment Configuration

### Environment Variables

```bash
# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCOUNT_ID=123456789012

# DynamoDB
DYNAMODB_TABLE_NAME=school-table-prod

# EventBridge
EVENT_BUS_NAME=edforge-app-plane
EVENT_SOURCE=edforge.school-service

# Cognito (for JWT validation)
COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxx
COGNITO_AUTHORITY=https://cognito-idp.us-east-1.amazonaws.com/us-east-1_XXXXXXXXX
```

### ECS Configuration
- **Service Name**: `school-service`
- **Task Definition**: `school-service:latest`
- **CPU**: 256 (0.25 vCPU)
- **Memory**: 512 MB
- **Desired Count**: 2-5 tasks
- **Auto Scaling**: CPU-based (target 70%)

### Health Check
- **Path**: `/schools/health`
- **Interval**: 30 seconds
- **Timeout**: 5 seconds
- **Healthy Threshold**: 2
- **Unhealthy Threshold**: 3

---

## Troubleshooting

### Common Issues

**Issue: Academic year not found**
- **Cause**: Academic year doesn't exist or wrong `academicYearId`
- **Solution**: Verify academic year exists using `GET /schools/:schoolId/academic-years`

**Issue: Cannot set current academic year**
- **Cause**: Another academic year is already marked as current
- **Solution**: Service automatically unmarks previous current year

**Issue: Event publishing fails**
- **Cause**: EventBridge permissions or event bus name incorrect
- **Solution**: Check IAM permissions and `EVENT_BUS_NAME` environment variable

**Issue: Tenant isolation violation**
- **Cause**: Query not filtering by `tenantId`
- **Solution**: Ensure all queries include `tenantId` as partition key

---

## Performance Characteristics

- **Average Latency**: ~150ms (simple queries)
- **Peak Throughput**: 10 req/sec
- **Database Reads**: ~80% of operations
- **Database Writes**: ~20% of operations

---

## Related Documentation

- [Architecture Overview](../ARCHITECTURE.md)
- [EventBridge Integration](./EVENTBRIDGE_INTEGRATION.md)
- [Architecture Decisions](./ARCHITECTURE_DECISIONS.md)
- [Implementation Guide](./IMPLEMENTATION_GUIDE.md)

---

**Last Updated:** 2025-01-21  
**Maintained By:** School Service Team

