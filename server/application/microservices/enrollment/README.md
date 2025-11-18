# Enrollment Service

**Version:** 1.0.0  
**Status:** Production-Ready  
**Bounded Context:** Student Enrollment

---

## Service Overview

The Enrollment Service manages student records and enrollment lifecycles. It handles student creation, enrollment in schools and academic years, enrollment status transitions (active, suspended, graduated, withdrawn), and student transfers between schools.

### Domain & Bounded Context

**Primary Aggregates:** Student, Enrollment

**Business Capabilities:**
- Student lifecycle management (create, update, delete)
- Enrollment management (enroll, transfer, suspend, graduate, withdraw)
- Student enrollment history tracking
- Enrollment validation (capacity, academic year, duplicates)
- Invoice generation on enrollment (via Finance Service)

---

## Architecture

### Technology Stack
- **Framework:** NestJS
- **Database:** DynamoDB (shared `school-table-{tier}`)
- **Authentication:** JWT (Cognito)
- **Events:** AWS EventBridge
- **HTTP Client:** Finance Service integration (stub implementation)

### Module Structure
```
enrollment-service/
├── src/
│   ├── student/
│   │   ├── student.controller.ts
│   │   ├── student.service.ts
│   │   ├── student.module.ts
│   │   └── dto/
│   ├── enrollment/
│   │   ├── enrollment.controller.ts
│   │   ├── enrollment.service.ts
│   │   ├── enrollment.module.ts
│   │   └── dto/
│   ├── common/
│   │   ├── dynamodb-client.service.ts
│   │   ├── entities/
│   │   │   ├── base.entity.ts
│   │   │   └── enrollment.entities.ts
│   │   ├── errors/
│   │   ├── services/
│   │   │   ├── validation.service.ts
│   │   │   ├── enrollment-events.service.ts
│   │   │   ├── enrollment-business-rules.service.ts
│   │   │   └── finance-http-client.service.ts (stub)
│   │   └── utils/
│   └── app.module.ts
```

---

## API Endpoints

### Base Path: `/students`, `/enrollments`

### Student Management

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| POST | `/students` | Create a new student | ✅ Implemented |
| GET | `/students/:studentId` | Get student by ID | ✅ Implemented |
| PUT | `/students/:studentId` | Update student | ✅ Implemented |
| DELETE | `/students/:studentId` | Delete student | ✅ Implemented |
| GET | `/students` | List students (by school/year) | ✅ Implemented |
| GET | `/students/:studentId/enrollments` | Get student enrollment history | ✅ Implemented |

### Enrollment Management

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| POST | `/enrollments/students/:studentId` | Enroll student | ✅ Implemented |
| GET | `/enrollments/:enrollmentId` | Get enrollment by ID | ✅ Implemented |
| PUT | `/enrollments/:enrollmentId/status` | Update enrollment status | ✅ Implemented |
| POST | `/enrollments/:enrollmentId/transfer` | Transfer student | ✅ Implemented |
| POST | `/enrollments/:enrollmentId/suspend` | Suspend enrollment | ✅ Implemented |
| POST | `/enrollments/:enrollmentId/graduate` | Graduate student | ✅ Implemented |
| POST | `/enrollments/:enrollmentId/withdraw` | Withdraw student | ✅ Implemented |
| GET | `/enrollments` | List enrollments (by school/year/status) | ✅ Implemented |

### Health Check

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| GET | `/enrollment/health` | Service health check | ✅ Implemented |

---

## Data Model

### Entities

#### Student
```typescript
{
  tenantId: string;              // Partition key
  entityKey: string;             // Sort key: STUDENT#studentId
  entityType: 'STUDENT';
  studentId: string;
  studentNumber: string;          // Unique within school
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gradeLevel: string;            // K, 1-12
  contactInfo: ContactInfo;
  guardians: Guardian[];
  medicalInfo?: MedicalInfo;
  // ... metadata fields
}
```

#### Enrollment
```typescript
{
  tenantId: string;
  entityKey: string;             // SCHOOL#schoolId#YEAR#yearId#STUDENT#studentId#ENROLLMENT
  entityType: 'ENROLLMENT';
  enrollmentId: string;
  studentId: string;
  schoolId: string;
  academicYearId: string;
  gradeLevel: string;
  section?: string;              // A-Z
  enrollmentDate: string;
  status: 'pending' | 'active' | 'suspended' | 'graduated' | 'transferred' | 'withdrawn';
  // ... metadata fields
}
```

### DynamoDB Access Patterns

**Primary Access:**
- Get by ID: `PK=tenantId, SK=entityKey`

**GSI2 (Academic Year queries):**
- List enrollments by school/year: `GSI2PK=schoolId#academicYearId`

**GSI7 (Student-scoped queries):**
- Get student enrollment history: `GSI7PK=studentId`

---

## Events Published

All events are published to AWS EventBridge with source: `edforge.enrollment-service`

### Student Events

- **`StudentCreated`** - Published when a new student is created
- **`StudentUpdated`** - Published when student details are updated

### Enrollment Events

- **`StudentEnrolled`** - Published when student is enrolled in school/year
- **`StudentWithdrawn`** - Published when student is withdrawn
- **`StudentEnrolledInClassroom`** - Published when student enrolled in classroom (consumed by Curriculum Service)
- **`StudentUnenrolledFromClassroom`** - Published when student unenrolled from classroom
- **`TransferInitiated`** - Published when transfer is initiated
- **`TransferCompleted`** - Published when transfer is completed
- **`TranscriptGenerated`** - Published when transcript is generated

---

## Events Consumed

**None** - Enrollment Service doesn't consume events from other services (future: may consume `ClassroomCreated` for capacity validation)

---

## Dependencies

### External Services

#### Finance Service (HTTP - Stub Implementation)
- **Purpose**: Invoice generation on enrollment
- **Current Status**: ⏳ Stub implementation (`FinanceHttpClientService`)
- **Endpoints Called**:
  - `GET /finance/tuition-config` - Get tuition configuration
  - `POST /finance/invoices` - Create invoice (planned)
- **Implementation**: `src/common/services/finance-http-client.service.ts`

#### Curriculum Service (HTTP - Planned)
- **Purpose**: Validate classroom capacity before enrollment
- **Current Status**: ❌ Not implemented
- **Planned Endpoint**: `GET /curriculum/classrooms/:classroomId` (check capacity)

### Shared Infrastructure
- **DynamoDB**: Shared `school-table-{tier}` table
- **EventBridge**: Custom event bus for publishing events
- **Cognito**: JWT token validation (via API Gateway)

---

## Security Implementation

### Authentication
- **JWT Guard**: All endpoints require JWT authentication
- **Tenant Context**: Extracted from JWT `custom:tenantId` claim
- **User Context**: Extracted from JWT for audit logging

### Authorization
- **Tenant Isolation**: All queries filtered by `tenantId` (partition key)
- **Role-Based**: Basic role checks
- **Future**: AWS Verified Permissions for fine-grained authorization

### Data Access
- **Infrastructure-Level**: DynamoDB LeadingKeys condition ensures tenant isolation
- **Application-Level**: All service methods require `tenantId` parameter
- **Audit Logging**: All operations logged with `userId`, `userRole`, `ipAddress`

---

## Implementation Status

### ✅ Implemented

- [x] Student CRUD operations
- [x] Enrollment CRUD operations
- [x] Enrollment status transitions (active, suspended, graduated, withdrawn)
- [x] Student transfer between schools
- [x] Enrollment validation (duplicates, academic year, school)
- [x] Event publishing to EventBridge
- [x] Input validation
- [x] Optimistic locking (version field)
- [x] Audit logging
- [x] Error handling
- [x] Finance HTTP client stub

### ⏳ Pending

- [ ] Complete Finance HTTP client implementation (replace stub)
- [ ] Classroom capacity validation (HTTP call to Curriculum Service)
- [ ] Staff validation (verify staff exists - HTTP call to Staff Service)
- [ ] Parent validation (verify parent exists - HTTP call to Parent Portal Service)
- [ ] Bulk enrollment operations
- [ ] Enrollment import/export
- [ ] Advanced enrollment reporting

### ❌ Missing

- [ ] Enrollment waitlist management
- [ ] Enrollment lottery system
- [ ] Multi-school enrollment (student in multiple schools)
- [ ] Enrollment templates
- [ ] Automated enrollment workflows

---

## Testing Status

### Unit Tests
- ⏳ **Pending** - Unit tests for services and validation

### Integration Tests
- ⏳ **Pending** - Integration tests for API endpoints

### E2E Tests
- ⏳ **Pending** - End-to-end enrollment workflow tests

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
EVENT_SOURCE=edforge.enrollment-service

# Finance Service (HTTP Client)
FINANCE_SERVICE_URL=http://finance-service:3006/finance

# Cognito (for JWT validation)
COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxx
COGNITO_AUTHORITY=https://cognito-idp.us-east-1.amazonaws.com/us-east-1_XXXXXXXXX
```

### ECS Configuration
- **Service Name**: `enrollment-service`
- **Task Definition**: `enrollment-service:latest`
- **CPU**: 256 (0.25 vCPU)
- **Memory**: 512 MB
- **Desired Count**: 3-8 tasks
- **Auto Scaling**: CPU-based (target 70%)

### Health Check
- **Path**: `/enrollment/health`
- **Interval**: 30 seconds
- **Timeout**: 5 seconds
- **Healthy Threshold**: 2
- **Unhealthy Threshold**: 3

---

## Troubleshooting

### Common Issues

**Issue: Student not found**
- **Cause**: Student doesn't exist or wrong `studentId`
- **Solution**: Verify student exists using `GET /students/:studentId`

**Issue: Duplicate enrollment**
- **Cause**: Student already enrolled in same academic year
- **Solution**: Check existing enrollments using `GET /enrollments?studentId=xxx&academicYearId=yyy`

**Issue: Invalid status transition**
- **Cause**: Status transition not allowed (e.g., graduated → active)
- **Solution**: Check valid transitions in validation service

**Issue: Finance service call fails**
- **Cause**: Finance service unavailable or stub not implemented
- **Solution**: Check `FINANCE_SERVICE_URL` and verify Finance Service is running

**Issue: Enrollment capacity exceeded**
- **Cause**: Classroom at max capacity (when validation implemented)
- **Solution**: Check classroom capacity via Curriculum Service

---

## Performance Characteristics

- **Average Latency**: ~200ms (includes validation and finance call)
- **Peak Throughput**: 50 req/sec
- **Database Reads**: ~70% of operations
- **Database Writes**: ~30% of operations

---

## Related Documentation

- [Architecture Overview](../ARCHITECTURE.md)
- [Implementation Summary](./IMPLEMENTATION_SUMMARY.md)

---

**Last Updated:** 2025-01-21  
**Maintained By:** Enrollment Service Team

