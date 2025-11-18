# Analytics Service

**Version:** 1.0.0  
**Status:** ⏳ In Development  
**Bounded Context:** Analytics & Reporting (CQRS Read Model)

---

## Service Overview

The Analytics Service is a read-only service that provides analytics and reporting capabilities. It consumes events from all other services via EventBridge, materializes views in a data lake (S3), and serves queries via Athena. It follows the CQRS (Command Query Responsibility Segregation) pattern.

### Domain & Bounded Context

**Primary Responsibility:** Read Model for Analytics

**Business Capabilities:**
- Principal dashboards (school-wide analytics)
- Teacher dashboards (classroom-specific analytics)
- Student performance analytics
- At-risk student identification
- Achievement gap analysis
- Custom reports generation

---

## Architecture

### Technology Stack
- **Framework:** NestJS
- **Data Lake:** S3 + Athena (read-only queries)
- **Event Ingestion:** EventBridge → Kinesis Firehose → S3
- **Query Engine:** Amazon Athena
- **Authentication:** JWT (Cognito)
- **Caching:** (Future) ElastiCache Redis

### Module Structure
```
analytics-service/
├── src/
│   ├── analytics/
│   │   ├── analytics.controller.ts
│   │   ├── analytics.service.ts
│   │   ├── analytics.module.ts
│   │   └── dto/
│   ├── common/
│   │   └── (minimal - read-only service)
│   └── app.module.ts
```

### Data Pipeline Architecture

```
EventBridge (All Services)
    ↓
Kinesis Firehose
    ↓
S3 Data Lake (Parquet format)
    ↓
Glue Catalog (Table definitions)
    ↓
Amazon Athena (SQL queries)
    ↓
Analytics Service (API responses)
```

---

## API Endpoints

### Base Path: `/analytics`

### Dashboard Endpoints

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| GET | `/analytics/dashboards/principals/:schoolId` | Get principal dashboard | ⏳ Pending |
| GET | `/analytics/dashboards/teachers/:teacherId` | Get teacher dashboard | ⏳ Pending |

### Student Analytics

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| GET | `/analytics/students/:studentId/performance` | Get student performance analytics | ⏳ Pending |

### At-Risk Analysis

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| GET | `/analytics/schools/:schoolId/at-risk-students` | Get at-risk students | ⏳ Pending |

### Achievement Gap Analysis

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| GET | `/analytics/schools/:schoolId/achievement-gaps` | Get achievement gap analysis | ⏳ Pending |

### Health Check

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| GET | `/analytics/health` | Service health check | ✅ Implemented |

---

## Data Model

### Read Model (Materialized Views in S3)

#### StudentDashboardView
```typescript
{
  studentId: string;
  schoolId: string;
  academicYearId: string;
  grades: GradeSummary[];
  attendance: AttendanceSummary;
  invoices: InvoiceSummary[];
  // Aggregated from multiple services
}
```

#### PrincipalDashboardView
```typescript
{
  schoolId: string;
  academicYearId: string;
  totalStudents: number;
  totalStaff: number;
  averageAttendanceRate: number;
  averageGPA: number;
  atRiskStudents: number;
  // Aggregated from multiple services
}
```

### Data Lake Structure (S3)

```
s3://edforge-data-lake/
├── events/
│   ├── year=2025/
│   │   ├── month=01/
│   │   │   ├── day=21/
│   │   │   │   └── events.parquet
│   ├── school-service/
│   ├── enrollment-service/
│   ├── assessment-service/
│   └── ...
└── materialized-views/
    ├── student-dashboards/
    ├── principal-dashboards/
    └── teacher-dashboards/
```

---

## Events Consumed

The Analytics Service consumes **ALL events** from all other services:

### From School Service
- `SchoolCreated`, `AcademicYearStarted`, `DepartmentCreated`

### From Enrollment Service
- `StudentCreated`, `StudentEnrolled`, `StudentWithdrawn`

### From Curriculum Service
- `ClassroomCreated`, `StreamPostCreated`

### From Assessment Service
- `AssignmentPublished`, `GradePublished`, `CourseGradeCalculated`

### From Attendance Service
- `AttendanceRecorded`, `AttendanceSummaryCalculated`

### From Finance Service
- `InvoiceGenerated`, `PaymentReceived`, `InvoiceOverdue`

### From Staff Service
- `StaffCreated`, `StaffRoleAssigned`

### From Parent Portal Service
- `ParentCreated`, `NotificationSent`

---

## Events Published

- **`ReportGenerated`** - Published when a report is generated
- **`DashboardUpdated`** - Published when dashboard is updated
- **`ExportCompleted`** - Published when data export is completed
- **`StudentAtRiskDetected`** - Published when at-risk student is identified

---

## Dependencies

### External Services

**None** - Analytics Service is read-only and doesn't call other services

### AWS Services
- **EventBridge**: Event consumption
- **Kinesis Firehose**: Event streaming to S3
- **S3**: Data lake storage
- **Athena**: SQL queries on data lake
- **Glue**: Table definitions and ETL (future)

---

## Security Implementation

### Authentication
- **JWT Guard**: All endpoints require JWT authentication
- **Tenant Context**: Extracted from JWT `custom:tenantId` claim
- **User Context**: Extracted from JWT for audit logging

### Authorization
- **Tenant Isolation**: All queries filtered by `tenantId`
- **Role-Based**: Principals see school-wide, teachers see classroom-specific
- **Future**: AWS Verified Permissions for fine-grained authorization

### Data Access
- **S3 Bucket Policies**: Tenant-scoped access
- **Athena Workgroups**: Per-tenant workgroups (future)
- **Query Results**: Cached and tenant-scoped

---

## Implementation Status

### ✅ Implemented

- [x] Service structure and health endpoint
- [x] Basic controller endpoints (stubs)

### ⏳ Pending

- [ ] EventBridge event consumption setup
- [ ] Kinesis Firehose configuration
- [ ] S3 data lake setup
- [ ] Glue table definitions
- [ ] Athena query implementation
- [ ] Dashboard data aggregation
- [ ] Report generation
- [ ] Data export functionality
- [ ] Caching layer (Redis)

### ❌ Missing

- [ ] Real-time analytics (Kinesis Analytics)
- [ ] ML-based insights (SageMaker)
- [ ] Advanced visualizations
- [ ] Custom report builder
- [ ] Scheduled reports
- [ ] Data retention policies

---

## Testing Status

### Unit Tests
- ❌ **Not Started** - Unit tests for services

### Integration Tests
- ❌ **Not Started** - Integration tests for API endpoints

### E2E Tests
- ❌ **Not Started** - End-to-end analytics workflow tests

---

## Deployment Configuration

### Environment Variables

```bash
# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCOUNT_ID=123456789012

# Data Lake
S3_DATA_LAKE_BUCKET=edforge-data-lake-prod
ATHENA_WORKGROUP=edforge-analytics
ATHENA_DATABASE=edforge_analytics
GLUE_DATABASE=edforge_analytics

# EventBridge
EVENT_BUS_NAME=edforge-app-plane
EVENT_SOURCE=edforge.analytics-service

# Kinesis Firehose
FIREHOSE_STREAM_NAME=edforge-events-stream

# Caching (Future)
REDIS_ENDPOINT=edforge-redis.xxxxx.cache.amazonaws.com

# Cognito (for JWT validation)
COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxx
COGNITO_AUTHORITY=https://cognito-idp.us-east-1.amazonaws.com/us-east-1_XXXXXXXXX
```

### ECS Configuration
- **Service Name**: `analytics-service`
- **Task Definition**: `analytics-service:latest`
- **CPU**: 256 (0.25 vCPU)
- **Memory**: 512 MB
- **Desired Count**: 3-8 tasks
- **Auto Scaling**: CPU-based (target 70%)

### Health Check
- **Path**: `/analytics/health`
- **Interval**: 30 seconds
- **Timeout**: 5 seconds
- **Healthy Threshold**: 2
- **Unhealthy Threshold**: 3

---

## Troubleshooting

### Common Issues

**Issue: No data in dashboards**
- **Cause**: Events not being consumed or data lake not populated
- **Solution**: Check EventBridge rules, Firehose delivery, and S3 data lake

**Issue: Slow query performance**
- **Cause**: Large data volumes or inefficient Athena queries
- **Solution**: Optimize queries, use partitioning, consider caching

**Issue: Tenant data leakage**
- **Cause**: Query not filtering by `tenantId`
- **Solution**: Ensure all Athena queries include tenant filter

---

## Performance Characteristics

- **Average Latency**: ~2000ms (Athena queries)
- **Peak Throughput**: 200 req/sec (read-only)
- **Query Complexity**: Medium to High (joins across event types)
- **Caching**: Future enhancement to reduce latency

---

## Related Documentation

- [Architecture Overview](../ARCHITECTURE.md)

---

**Last Updated:** 2025-01-21  
**Maintained By:** Analytics Service Team

