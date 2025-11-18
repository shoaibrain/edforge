# EdForge MVP Implementation Plan

**Version:** 1.0  
**Last Updated:** 2025-01-21  
**Status:** Active Implementation

---

## Executive Summary

This document outlines the complete MVP implementation plan for all 9 EdForge microservices, organized into 8 phases over 20 weeks. The plan follows a logical and technical order, ensuring foundational infrastructure is built first, followed by core service completion, inter-service integration, event consumption, analytics implementation, advanced features, testing, and production readiness.

### Implementation Timeline

- **Total Duration:** 20 weeks (5 months)
- **Team Size:** 4-6 engineers
- **Total Story Points:** ~400 points
- **Critical Path:** Phases 0-4 (Weeks 1-12)

---

## Current State Assessment

### Service Readiness Matrix

| Service | Core CRUD | Events | HTTP Clients | Event Consumption | Testing | Status |
|---------|-----------|--------|--------------|-------------------|---------|--------|
| School | ✅ | ✅ | N/A | N/A | ⏳ | Production-Ready |
| Enrollment | ✅ | ✅ | ⏳ (Finance stub) | ❌ | ⏳ | 85% Complete |
| Curriculum | ✅ | ✅ | ❌ | ❌ | ⏳ | 80% Complete |
| Assessment | ✅ | ✅ | N/A | ❌ | ⏳ | 80% Complete |
| Attendance | ✅ | ✅ | N/A | ❌ | ⏳ | 80% Complete |
| Finance | ✅ | ✅ | N/A | ❌ | ⏳ | 75% Complete |
| Staff | ⏳ (PUT/DELETE) | ✅ | ❌ | ❌ | ⏳ | 70% Complete |
| Parent Portal | ⏳ (PUT/DELETE) | ✅ | N/A | ❌ | ⏳ | 60% Complete |
| Analytics | ❌ | ⏳ | N/A | ❌ | ❌ | 10% Complete |

### Key Gaps Identified

1. **Event Consumption:** No services consume events (Parent Portal, Analytics pending)
2. **HTTP Client Infrastructure:** Missing circuit breakers, retries, timeouts
3. **Inter-Service Validation:** Missing cross-service validation calls
4. **Testing:** No unit/integration/E2E tests
5. **Analytics Pipeline:** Complete implementation pending
6. **Notification System:** SES/SNS integration pending

---

## Phase 0: Foundation & Infrastructure

**Duration:** 2 weeks (Week 1-2)  
**Story Points:** 34 points  
**Priority:** Critical (Blocks all other phases)

### Objectives

- Set up EventBridge infrastructure (rules, DLQ, archiving)
- Create HTTP client infrastructure with resilience patterns
- Consolidate shared utilities
- Set up testing framework across all services

### Tasks

#### Task 0.1: EventBridge Infrastructure Setup

**Task ID:** `MVP-0.1`  
**Description:** Configure EventBridge rules, DLQ, and event archiving for all services

**Dependencies:** None

**Files to Create/Modify:**
- `server/lib/shared-infra/Resources/eventbridge-rules.ts` (CDK)
- `server/lib/shared-infra/Resources/eventbridge-dlq.ts` (CDK)
- `server/lib/shared-infra/Resources/eventbridge-archive.ts` (CDK)

**Implementation Details:**
1. Create EventBridge rules for Parent Portal Service:
   - Rule: `parent-portal-grade-published`
     - Source: `edforge.assessment-service`
     - DetailType: `GradePublished`
     - Target: Lambda function `parent-portal-notification-handler`
   - Rule: `parent-portal-invoice-generated`
     - Source: `edforge.finance-service`
     - DetailType: `InvoiceGenerated`
     - Target: Lambda function `parent-portal-notification-handler`
   - Rule: `parent-portal-attendance-recorded`
     - Source: `edforge.attendance-service`
     - DetailType: `AttendanceRecorded`
     - Target: Lambda function `parent-portal-notification-handler`

2. Create EventBridge rules for Analytics Service:
   - Rule: `analytics-all-events`
     - Source: All `edforge.*` sources
     - Target: Kinesis Firehose `edforge-events-stream`

3. Configure Dead Letter Queues:
   - DLQ for Parent Portal Lambda: `parent-portal-dlq`
   - DLQ for Analytics Firehose: `analytics-firehose-dlq`

4. Configure event archiving:
   - Archive all events to S3: `s3://edforge-event-archive/`
   - Retention: 730 days
   - Format: JSON (one event per file)

**Acceptance Criteria:**
- ✅ All EventBridge rules created and tested
- ✅ DLQ configured for all targets
- ✅ Event archiving working
- ✅ CloudWatch alarms for failed events
- ✅ Documentation updated

**Estimated Effort:** 8 story points (3 days)

**Testing Requirements:**
- Test event routing to Lambda
- Test event routing to Firehose
- Test DLQ on Lambda failure
- Test event archiving

---

#### Task 0.2: HTTP Client Infrastructure

**Task ID:** `MVP-0.2`  
**Description:** Create reusable HTTP client service with circuit breakers, retries, and timeouts

**Dependencies:** None

**Files to Create:**
- `server/application/libs/http-client/src/http-client.service.ts`
- `server/application/libs/http-client/src/circuit-breaker.service.ts`
- `server/application/libs/http-client/src/retry-strategy.service.ts`
- `server/application/libs/http-client/src/http-client.module.ts`

**Implementation Details:**
1. Create `HttpClientService` with:
   - Axios-based HTTP client
   - Request/response interceptors
   - JWT token injection
   - Tenant context headers
   - Request timeout (5 seconds default)
   - Retry logic (exponential backoff, max 3 retries)

2. Create `CircuitBreakerService`:
   - Circuit breaker pattern (open/closed/half-open states)
   - Failure threshold: 5 failures in 60 seconds
   - Recovery timeout: 30 seconds
   - Per-service circuit breakers

3. Create `RetryStrategyService`:
   - Exponential backoff: 1s, 2s, 4s
   - Max retries: 3
   - Retryable status codes: 500, 502, 503, 504
   - Non-retryable: 400, 401, 403, 404

4. Integration:
   - Export from `@app/http-client` package
   - Use in Enrollment Service for Finance calls
   - Use in Enrollment Service for Curriculum calls

**Acceptance Criteria:**
- ✅ HTTP client service created and tested
- ✅ Circuit breaker working (test with service down)
- ✅ Retry logic working (test with transient failures)
- ✅ JWT token injection working
- ✅ Tenant context headers working
- ✅ Unit tests with 90%+ coverage

**Estimated Effort:** 13 story points (5 days)

**Testing Requirements:**
- Unit tests for HTTP client
- Unit tests for circuit breaker
- Unit tests for retry strategy
- Integration tests with mock services

---

#### Task 0.3: Shared Utilities Consolidation

**Task ID:** `MVP-0.3`  
**Description:** Create shared utilities package for common code across services

**Dependencies:** None

**Files to Create:**
- `server/application/libs/common-utils/src/retry.util.ts`
- `server/application/libs/common-utils/src/error-codes.enum.ts`
- `server/application/libs/common-utils/src/exception.base.ts`
- `server/application/libs/common-utils/src/common-utils.module.ts`

**Implementation Details:**
1. Consolidate `retry.util.ts`:
   - Extract from all services
   - Standardize retry logic
   - Add configurable backoff strategies

2. Standardize error codes:
   - Create base error codes enum
   - Service-specific error codes extend base
   - Consistent error code format: `{SERVICE}_{ENTITY}_{ERROR}`

3. Create base exception class:
   - `BaseDomainException` abstract class
   - Standard error response format
   - Stack trace handling

4. Update all services to use shared package:
   - Remove duplicate `retry.util.ts` files
   - Update imports to `@app/common-utils`
   - Update error handling

**Acceptance Criteria:**
- ✅ Shared utilities package created
- ✅ All services updated to use shared package
- ✅ No duplicate utility files
- ✅ Backward compatibility maintained
- ✅ Unit tests for all utilities

**Estimated Effort:** 8 story points (3 days)

**Testing Requirements:**
- Unit tests for retry utility
- Unit tests for error codes
- Unit tests for base exception
- Integration test with one service

---

#### Task 0.4: Testing Framework Setup

**Task ID:** `MVP-0.4`  
**Description:** Set up testing infrastructure for all services

**Dependencies:** None

**Files to Create/Modify:**
- `server/application/microservices/{service}/jest.config.js` (for each service)
- `server/application/microservices/{service}/test/setup.ts` (for each service)
- `server/application/microservices/{service}/test/helpers/` (test helpers)

**Implementation Details:**
1. Configure Jest for each service:
   - TypeScript support
   - Coverage thresholds (80% minimum)
   - Test environment setup
   - Mock DynamoDB client
   - Mock EventBridge client

2. Create test helpers:
   - `createMockRequestContext()` - Mock request context
   - `createMockTenant()` - Mock tenant credentials
   - `createMockDynamoDBClient()` - Mock DynamoDB client
   - `createMockEventService()` - Mock event service

3. Set up integration test infrastructure:
   - Docker Compose for local DynamoDB
   - LocalStack for AWS services (EventBridge, S3)
   - Test database seeding utilities

4. Set up E2E test infrastructure:
   - Test API client
   - Test data factories
   - Test cleanup utilities

**Acceptance Criteria:**
- ✅ Jest configured for all 9 services
- ✅ Test helpers created
- ✅ Integration test infrastructure working
- ✅ E2E test infrastructure working
- ✅ Sample tests written for one service

**Estimated Effort:** 5 story points (2 days)

**Testing Requirements:**
- Run test suite for one service
- Verify coverage reporting
- Verify integration test setup

---

### Phase 0 Deliverables

- ✅ EventBridge rules configured and tested
- ✅ HTTP client infrastructure ready
- ✅ Shared utilities package created
- ✅ Testing framework operational

### Phase 0 Dependencies for Next Phase

- EventBridge infrastructure must be ready for Phase 3
- HTTP client must be ready for Phase 2
- Testing framework must be ready for Phase 6

---

## Phase 1: Core Service Completion

**Duration:** 3 weeks (Week 3-5)  
**Story Points:** 52 points  
**Priority:** High (Enables Phase 2)

### Objectives

- Complete Finance HTTP client implementation
- Complete Staff Service (PUT/DELETE endpoints)
- Complete Parent Portal Service (PUT/DELETE, basic structure)
- Complete missing CRUD operations across services

### Tasks

#### Task 1.1: Complete Finance HTTP Client

**Task ID:** `MVP-1.1`  
**Description:** Replace Finance HTTP client stub with full implementation

**Dependencies:** MVP-0.2 (HTTP Client Infrastructure)

**Files to Modify:**
- `server/application/microservices/enrollment/src/common/services/finance-http-client.service.ts`

**Implementation Details:**
1. Implement `getTuitionConfiguration()`:
   ```typescript
   async getTuitionConfiguration(
     tenantId: string,
     schoolId: string,
     academicYearId: string
   ): Promise<TuitionConfiguration> {
     const response = await this.httpClient.get(
       `${this.financeServiceUrl}/invoices/tuition-config`,
       {
         params: { schoolId, academicYearId },
         headers: { 'X-Tenant-Id': tenantId }
       }
     );
     return response.data;
   }
   ```

2. Implement `calculateInvoice()`:
   - Call Finance Service: `POST /finance/invoices/calculate`
   - Pass enrollment and tuition config
   - Return invoice calculation result

3. Implement `prepareInvoiceEntity()`:
   - Call Finance Service: `POST /finance/invoices`
   - Pass enrollment, tuition config, calculation result
   - Return created invoice entity

4. Implement `selectPaymentPlan()`:
   - Call Finance Service: `POST /finance/payment-plans/select`
   - Pass tuition config and total amount
   - Return payment plan info

5. Add error handling:
   - Handle 404 (tuition config not found)
   - Handle 400 (invalid calculation)
   - Handle 503 (service unavailable) - use circuit breaker
   - Retry on 500 errors

**Acceptance Criteria:**
- ✅ All Finance HTTP client methods implemented
- ✅ Error handling with proper exceptions
- ✅ Circuit breaker integrated
- ✅ Retry logic working
- ✅ Unit tests with 90%+ coverage
- ✅ Integration tests with Finance Service

**Estimated Effort:** 8 story points (3 days)

**Testing Requirements:**
- Unit tests with mocked Finance Service
- Integration tests with Finance Service running
- Test circuit breaker behavior
- Test retry logic

---

#### Task 1.2: Complete Staff Service CRUD

**Task ID:** `MVP-1.2`  
**Description:** Add PUT and DELETE endpoints to Staff Service

**Dependencies:** None

**Files to Modify:**
- `server/application/microservices/staff/src/staff/staff.controller.ts`
- `server/application/microservices/staff/src/staff/staff.service.ts`
- `server/application/microservices/staff/src/staff/dto/staff.dto.ts`

**Implementation Details:**
1. Add PUT endpoint:
   - `PUT /staff/members/:staffId`
   - Update staff member details
   - Validate input
   - Publish `StaffUpdated` event

2. Add DELETE endpoint:
   - `DELETE /staff/members/:staffId`
   - Soft delete (set status to 'inactive')
   - Validate no active roles
   - Publish `StaffDeleted` event (future)

3. Add validation:
   - Validate staff exists
   - Validate no active classroom assignments (future)
   - Validate department exists (HTTP call to School Service)

4. Add UpdateStaffDto:
   - Partial update support
   - Validation rules

**Acceptance Criteria:**
- ✅ PUT endpoint working
- ✅ DELETE endpoint working
- ✅ Validation implemented
- ✅ Events published
- ✅ Unit tests
- ✅ Integration tests

**Estimated Effort:** 5 story points (2 days)

**Testing Requirements:**
- Unit tests for update/delete
- Integration tests
- Test validation rules
- Test event publishing

---

#### Task 1.3: Complete Parent Portal Service CRUD

**Task ID:** `MVP-1.3`  
**Description:** Add PUT and DELETE endpoints to Parent Portal Service

**Dependencies:** None

**Files to Modify:**
- `server/application/microservices/parent-portal/src/parent/parent.controller.ts`
- `server/application/microservices/parent-portal/src/parent/parent.service.ts`
- `server/application/microservices/parent-portal/src/parent/dto/parent.dto.ts`

**Implementation Details:**
1. Add PUT endpoint:
   - `PUT /parents/guardians/:parentId`
   - Update parent details
   - Update notification preferences
   - Publish `ParentUpdated` event

2. Add DELETE endpoint:
   - `DELETE /parents/guardians/:parentId`
   - Soft delete (set status to 'inactive')
   - Validate no active student relationships
   - Publish `ParentDeleted` event (future)

3. Add UpdateParentDto:
   - Partial update support
   - Notification preferences update

**Acceptance Criteria:**
- ✅ PUT endpoint working
- ✅ DELETE endpoint working
- ✅ Validation implemented
- ✅ Events published
- ✅ Unit tests
- ✅ Integration tests

**Estimated Effort:** 5 story points (2 days)

**Testing Requirements:**
- Unit tests for update/delete
- Integration tests
- Test validation rules

---

#### Task 1.4: Complete Missing CRUD Operations

**Task ID:** `MVP-1.4`  
**Description:** Complete any missing CRUD operations across services

**Dependencies:** None

**Files to Review/Modify:**
- All service controllers and services

**Implementation Details:**
1. Review each service for missing operations:
   - School Service: ✅ Complete
   - Enrollment Service: ✅ Complete
   - Curriculum Service: ⏳ Add DELETE for classrooms
   - Assessment Service: ✅ Complete
   - Attendance Service: ⏳ Add DELETE for records
   - Finance Service: ⏳ Add PUT for invoices
   - Staff Service: ✅ (covered in MVP-1.2)
   - Parent Portal: ✅ (covered in MVP-1.3)
   - Analytics: N/A (read-only)

2. Add missing DELETE endpoints:
   - Curriculum: `DELETE /curriculum/classrooms/:classroomId`
   - Attendance: `DELETE /attendance/records/:recordId`

3. Add missing PUT endpoints:
   - Finance: `PUT /finance/invoices/:invoiceId` (update invoice)

**Acceptance Criteria:**
- ✅ All missing CRUD operations added
- ✅ Validation implemented
- ✅ Events published
- ✅ Unit tests
- ✅ Integration tests

**Estimated Effort:** 8 story points (3 days)

**Testing Requirements:**
- Unit tests for new endpoints
- Integration tests
- Test validation rules

---

#### Task 1.5: Department Validation in Staff Service

**Task ID:** `MVP-1.5`  
**Description:** Add HTTP call to School Service to validate department exists

**Dependencies:** MVP-0.2 (HTTP Client Infrastructure)

**Files to Create/Modify:**
- `server/application/microservices/staff/src/common/services/school-http-client.service.ts`
- `server/application/microservices/staff/src/staff/staff.service.ts`

**Implementation Details:**
1. Create `SchoolHttpClientService`:
   - `getDepartment(tenantId, schoolId, departmentId)` - Validate department exists
   - Use HTTP client from `@app/http-client`
   - Circuit breaker for School Service

2. Integrate in Staff Service:
   - Validate department on staff creation
   - Validate department on staff update
   - Handle 404 (department not found)

**Acceptance Criteria:**
- ✅ School HTTP client created
- ✅ Department validation working
- ✅ Error handling implemented
- ✅ Unit tests
- ✅ Integration tests

**Estimated Effort:** 5 story points (2 days)

**Testing Requirements:**
- Unit tests with mocked School Service
- Integration tests with School Service running
- Test validation errors

---

### Phase 1 Deliverables

- ✅ Finance HTTP client fully implemented
- ✅ Staff Service CRUD complete
- ✅ Parent Portal Service CRUD complete
- ✅ All missing CRUD operations added
- ✅ Cross-service validation working

---

## Phase 2: Inter-Service Integration

**Duration:** 2 weeks (Week 6-7)  
**Story Points:** 34 points  
**Priority:** High (Enables core workflows)

### Objectives

- Complete Enrollment → Finance HTTP integration
- Complete Enrollment → Curriculum capacity validation
- Implement Parent Portal notification delivery
- Add cross-service validation across all services

### Tasks

#### Task 2.1: Enrollment → Finance Integration

**Task ID:** `MVP-2.1`  
**Description:** Complete enrollment service integration with Finance Service

**Dependencies:** MVP-1.1 (Finance HTTP Client)

**Files to Modify:**
- `server/application/microservices/enrollment/src/enrollment/enrollment.service.ts`

**Implementation Details:**
1. Update `enrollStudent()` method:
   - Replace stub calls with actual HTTP calls
   - Handle Finance Service errors gracefully
   - Add transaction rollback on Finance failure
   - Publish `StudentEnrolled` event after invoice creation

2. Add error handling:
   - If Finance Service unavailable: log error, continue enrollment (invoice created later)
   - If invoice calculation fails: return error, don't create enrollment
   - Circuit breaker: if Finance Service down, skip invoice creation, log for retry

3. Add retry logic:
   - Retry invoice creation on transient failures
   - Max 3 retries with exponential backoff

**Acceptance Criteria:**
- ✅ Enrollment creates invoice via Finance Service
- ✅ Error handling working
- ✅ Circuit breaker working
- ✅ Retry logic working
- ✅ Integration tests passing
- ✅ E2E test: enroll student → invoice created

**Estimated Effort:** 8 story points (3 days)

**Testing Requirements:**
- Integration tests with Finance Service
- Test error scenarios
- Test circuit breaker
- E2E test for enrollment flow

---

#### Task 2.2: Enrollment → Curriculum Capacity Validation

**Task ID:** `MVP-2.2`  
**Description:** Add classroom capacity validation when enrolling students

**Dependencies:** MVP-0.2 (HTTP Client Infrastructure)

**Files to Create/Modify:**
- `server/application/microservices/enrollment/src/common/services/curriculum-http-client.service.ts`
- `server/application/microservices/enrollment/src/enrollment/enrollment.service.ts`

**Implementation Details:**
1. Create `CurriculumHttpClientService`:
   - `getClassroom(tenantId, schoolId, academicYearId, classroomId)` - Get classroom details
   - Use HTTP client from `@app/http-client`
   - Circuit breaker for Curriculum Service

2. Integrate in Enrollment Service:
   - Before enrollment, validate classroom capacity
   - Check: `currentEnrollment < maxCapacity`
   - Throw `CapacityExceededException` if full
   - Update classroom enrollment count (future: via event)

**Acceptance Criteria:**
- ✅ Curriculum HTTP client created
- ✅ Capacity validation working
- ✅ Error handling implemented
- ✅ Unit tests
- ✅ Integration tests

**Estimated Effort:** 8 story points (3 days)

**Testing Requirements:**
- Unit tests with mocked Curriculum Service
- Integration tests with Curriculum Service running
- Test capacity exceeded scenario

---

#### Task 2.3: Parent Portal Notification Delivery

**Task ID:** `MVP-2.3`  
**Description:** Implement SES/SNS integration for sending notifications

**Dependencies:** None

**Files to Create/Modify:**
- `server/application/microservices/parent-portal/src/common/services/notification.service.ts`
- `server/application/microservices/parent-portal/src/parent/parent.module.ts`

**Implementation Details:**
1. Create `NotificationService`:
   - `sendEmailNotification(parentId, subject, body)` - Send email via SES
   - `sendSMSNotification(parentId, message)` - Send SMS via SNS
   - `sendPushNotification(parentId, title, body)` - Send push via SNS (future)
   - Respect notification preferences

2. Integrate AWS SES:
   - Configure SES in CDK
   - Create email templates
   - Handle bounces and complaints

3. Integrate AWS SNS:
   - Configure SNS topics
   - SMS delivery
   - Push notification topics (future)

4. Add notification preferences:
   - Email enabled/disabled
   - SMS enabled/disabled
   - Notification types (grades, attendance, invoices)

**Acceptance Criteria:**
- ✅ Notification service created
- ✅ SES integration working
- ✅ SNS integration working
- ✅ Notification preferences respected
- ✅ Unit tests
- ✅ Integration tests

**Estimated Effort:** 13 story points (5 days)

**Testing Requirements:**
- Unit tests with mocked SES/SNS
- Integration tests with SES/SNS
- Test notification preferences
- Test email delivery

---

### Phase 2 Deliverables

- ✅ Enrollment → Finance integration complete
- ✅ Enrollment → Curriculum validation working
- ✅ Parent Portal notifications working
- ✅ Cross-service validation implemented

---

## Phase 3: Event Consumption Implementation

**Duration:** 2 weeks (Week 8-9)  
**Story Points:** 34 points  
**Priority:** High (Enables event-driven features)

### Objectives

- Implement Parent Portal event handlers
- Set up Analytics Service event ingestion
- Configure EventBridge rules (from Phase 0)
- Implement DLQ and retry mechanisms

### Tasks

#### Task 3.1: Parent Portal Event Handlers

**Task ID:** `MVP-3.1`  
**Description:** Create Lambda functions to consume events for Parent Portal

**Dependencies:** MVP-0.1 (EventBridge Infrastructure), MVP-2.3 (Notification Service)

**Files to Create:**
- `server/application/microservices/parent-portal/src/common/handlers/grade-published.handler.ts`
- `server/application/microservices/parent-portal/src/common/handlers/invoice-generated.handler.ts`
- `server/application/microservices/parent-portal/src/common/handlers/attendance-recorded.handler.ts`
- `server/lib/shared-infra/Resources/parent-portal-lambda.ts` (CDK)

**Implementation Details:**
1. Create `GradePublishedHandler`:
   ```typescript
   export async function handler(event: EventBridgeEvent) {
     const detail = event.detail as GradePublishedEvent;
     const parents = await getParentsByStudent(detail.studentId);
     for (const parent of parents) {
       if (parent.notificationPreferences.grades) {
         await sendEmailNotification(
           parent.parentId,
           `Grade Published for ${detail.studentId}`,
           `Grade: ${detail.score}/${detail.maxScore} (${detail.letterGrade})`
         );
       }
     }
   }
   ```

2. Create `InvoiceGeneratedHandler`:
   - Get parents by student
   - Send invoice notification email
   - Include invoice details and payment link

3. Create `AttendanceRecordedHandler`:
   - Get parents by student
   - Send attendance notification (if configured)
   - Include attendance status and date

4. Deploy Lambda functions:
   - Create Lambda functions in CDK
   - Configure EventBridge rules to trigger Lambdas
   - Set up DLQ for each Lambda
   - Configure retry policy (max 3 retries)

**Acceptance Criteria:**
- ✅ All event handlers created
- ✅ Lambda functions deployed
- ✅ EventBridge rules configured
- ✅ DLQ configured
- ✅ Notifications sent on events
- ✅ Unit tests
- ✅ Integration tests

**Estimated Effort:** 13 story points (5 days)

**Testing Requirements:**
- Unit tests for handlers
- Integration tests with EventBridge
- Test notification delivery
- Test DLQ on failure

---

#### Task 3.2: Analytics Event Ingestion Pipeline

**Task ID:** `MVP-3.2`  
**Description:** Set up Kinesis Firehose to ingest all events for Analytics

**Dependencies:** MVP-0.1 (EventBridge Infrastructure)

**Files to Create:**
- `server/lib/shared-infra/Resources/kinesis-firehose.ts` (CDK)
- `server/lib/shared-infra/Resources/s3-data-lake.ts` (CDK)

**Implementation Details:**
1. Create Kinesis Firehose stream:
   - Stream name: `edforge-events-stream`
   - Destination: S3 data lake
   - Buffer size: 5 MB or 60 seconds
   - Compression: GZIP
   - Format: Parquet

2. Configure EventBridge rule:
   - Rule: `analytics-all-events`
   - Source: All `edforge.*` sources
   - Target: Kinesis Firehose stream

3. Create S3 data lake:
   - Bucket: `edforge-data-lake-{tier}`
   - Partitioning: `year=YYYY/month=MM/day=DD/service={service}/`
   - Lifecycle policy: Move to Glacier after 90 days
   - Encryption: SSE-S3

4. Configure DLQ:
   - DLQ for Firehose: SQS queue `analytics-firehose-dlq`
   - Retry policy: 3 retries

**Acceptance Criteria:**
- ✅ Kinesis Firehose created
- ✅ EventBridge rule configured
- ✅ S3 data lake created
- ✅ Events flowing to S3
- ✅ DLQ configured
- ✅ Parquet format verified

**Estimated Effort:** 8 story points (3 days)

**Testing Requirements:**
- Test event ingestion
- Verify Parquet format
- Test DLQ on failure
- Verify partitioning

---

#### Task 3.3: Event Consumption Testing

**Task ID:** `MVP-3.3`  
**Description:** Create comprehensive tests for event consumption

**Dependencies:** MVP-3.1, MVP-3.2

**Files to Create:**
- `server/application/microservices/parent-portal/test/handlers/grade-published.handler.spec.ts`
- `server/application/microservices/parent-portal/test/handlers/invoice-generated.handler.spec.ts`
- `server/application/microservices/analytics/test/event-ingestion.spec.ts`

**Implementation Details:**
1. Test Parent Portal handlers:
   - Test GradePublished handler
   - Test InvoiceGenerated handler
   - Test AttendanceRecorded handler
   - Test error handling
   - Test DLQ behavior

2. Test Analytics ingestion:
   - Test event flow to Firehose
   - Test S3 data lake population
   - Test Parquet format
   - Test partitioning

3. E2E event flow tests:
   - Publish event → Verify handler execution
   - Publish event → Verify S3 storage
   - Test event replay

**Acceptance Criteria:**
- ✅ All handler tests passing
- ✅ Ingestion tests passing
- ✅ E2E tests passing
- ✅ 90%+ test coverage

**Estimated Effort:** 5 story points (2 days)

**Testing Requirements:**
- Unit tests
- Integration tests
- E2E tests

---

#### Task 3.4: Event Monitoring and Alerting

**Task ID:** `MVP-3.4`  
**Description:** Set up CloudWatch metrics and alarms for event processing

**Dependencies:** MVP-3.1, MVP-3.2

**Files to Create:**
- `server/lib/shared-infra/Resources/event-monitoring.ts` (CDK)

**Implementation Details:**
1. Create CloudWatch metrics:
   - Events published per service
   - Events consumed per handler
   - Event processing latency
   - Failed event count
   - DLQ message count

2. Create CloudWatch alarms:
   - Alarm: High failed event rate (> 5% failures)
   - Alarm: DLQ messages > 10
   - Alarm: Event processing latency > 5 seconds
   - Alarm: Events not being consumed

3. Create CloudWatch dashboards:
   - Event volume dashboard
   - Event processing dashboard
   - Error rate dashboard

**Acceptance Criteria:**
- ✅ CloudWatch metrics created
- ✅ CloudWatch alarms configured
- ✅ CloudWatch dashboards created
- ✅ SNS notifications for alarms

**Estimated Effort:** 5 story points (2 days)

**Testing Requirements:**
- Test alarm triggers
- Test dashboard display
- Test SNS notifications

---

### Phase 3 Deliverables

- ✅ Parent Portal event handlers working
- ✅ Analytics event ingestion pipeline operational
- ✅ EventBridge rules configured and tested
- ✅ DLQ and retry mechanisms working
- ✅ Event monitoring and alerting set up

---

## Phase 4: Analytics Service Implementation

**Duration:** 3 weeks (Week 10-12)  
**Story Points:** 55 points  
**Priority:** Medium (Enables reporting features)

### Objectives

- Complete Analytics Service implementation
- Set up Glue table definitions
- Implement Athena queries
- Create dashboard aggregation logic

### Tasks

#### Task 4.1: Glue Table Definitions

**Task ID:** `MVP-4.1`  
**Description:** Create Glue catalog tables for event data in S3

**Dependencies:** MVP-3.2 (Analytics Event Ingestion)

**Files to Create:**
- `server/lib/shared-infra/Resources/glue-tables.ts` (CDK)

**Implementation Details:**
1. Create Glue database:
   - Database name: `edforge_analytics`
   - Location: S3 data lake bucket

2. Create Glue tables for each event type:
   - `school_events` - School service events
   - `enrollment_events` - Enrollment service events
   - `curriculum_events` - Curriculum service events
   - `assessment_events` - Assessment service events
   - `attendance_events` - Attendance service events
   - `finance_events` - Finance service events
   - `staff_events` - Staff service events
   - `parent_portal_events` - Parent portal service events

3. Table schema (example for `assessment_events`):
   ```sql
   CREATE EXTERNAL TABLE assessment_events (
     eventType string,
     timestamp string,
     tenantId string,
     studentId string,
     classroomId string,
     schoolId string,
     academicYearId string,
     score double,
     maxScore double,
     letterGrade string
   )
   PARTITIONED BY (year string, month string, day string)
   STORED AS PARQUET
   LOCATION 's3://edforge-data-lake/events/assessment-service/'
   ```

4. Set up partition projection:
   - Enable partition projection for better query performance
   - Partition format: `year=YYYY/month=MM/day=DD/`

**Acceptance Criteria:**
- ✅ Glue database created
- ✅ All event tables created
- ✅ Partition projection configured
- ✅ Table schemas validated
- ✅ Sample queries working

**Estimated Effort:** 8 story points (3 days)

**Testing Requirements:**
- Test table creation
- Test partition projection
- Test sample queries
- Verify data types

---

#### Task 4.2: Athena Query Implementation

**Task ID:** `MVP-4.2`  
**Description:** Implement Athena queries for Analytics Service

**Dependencies:** MVP-4.1 (Glue Table Definitions)

**Files to Create/Modify:**
- `server/application/microservices/analytics/src/common/services/athena-query.service.ts`
- `server/application/microservices/analytics/src/analytics/analytics.service.ts`

**Implementation Details:**
1. Create `AthenaQueryService`:
   - Execute SQL queries on Athena
   - Handle query results pagination
   - Cache query results (Redis - future)
   - Handle query errors

2. Implement principal dashboard query:
   ```sql
   SELECT 
     schoolId,
     academicYearId,
     COUNT(DISTINCT studentId) as totalStudents,
     AVG(attendanceRate) as avgAttendanceRate,
     AVG(courseGrade) as avgGPA
   FROM student_dashboard_view
   WHERE schoolId = ? AND academicYearId = ?
   GROUP BY schoolId, academicYearId
   ```

3. Implement teacher dashboard query:
   - Aggregate by teacher and classroom
   - Include assignment and grade statistics
   - Include attendance statistics

4. Implement student performance query:
   - Get all grades for student
   - Calculate GPA
   - Get attendance summary
   - Get assignment completion rate

5. Implement at-risk students query:
   - Students with GPA < threshold
   - Students with attendance < threshold
   - Combine multiple risk factors

**Acceptance Criteria:**
- ✅ Athena query service created
- ✅ All dashboard queries implemented
- ✅ Query results formatted correctly
- ✅ Error handling implemented
- ✅ Unit tests
- ✅ Integration tests

**Estimated Effort:** 13 story points (5 days)

**Testing Requirements:**
- Unit tests with mocked Athena
- Integration tests with Athena
- Test query performance
- Test error handling

---

#### Task 4.3: Dashboard Aggregation Logic

**Task ID:** `MVP-4.3`  
**Description:** Implement dashboard data aggregation in Analytics Service

**Dependencies:** MVP-4.2 (Athena Query Implementation)

**Files to Modify:**
- `server/application/microservices/analytics/src/analytics/analytics.service.ts`

**Implementation Details:**
1. Implement `getPrincipalDashboard()`:
   - Query enrollment statistics
   - Query attendance statistics
   - Query grade statistics
   - Query at-risk student count
   - Aggregate all data into dashboard response

2. Implement `getTeacherDashboard()`:
   - Query teacher's classrooms
   - Query assignment statistics
   - Query grade statistics
   - Query attendance statistics
   - Aggregate all data into dashboard response

3. Implement `getStudentPerformance()`:
   - Query student grades
   - Query student attendance
   - Query student assignments
   - Calculate performance metrics
   - Return aggregated performance data

4. Implement `getAtRiskStudents()`:
   - Query students with low GPA
   - Query students with low attendance
   - Combine risk factors
   - Return at-risk student list

5. Implement `getAchievementGaps()`:
   - Query performance by demographic
   - Calculate gaps
   - Return gap analysis

**Acceptance Criteria:**
- ✅ All dashboard methods implemented
- ✅ Data aggregation working
- ✅ Response format correct
- ✅ Performance acceptable (< 3 seconds)
- ✅ Unit tests
- ✅ Integration tests

**Estimated Effort:** 13 story points (5 days)

**Testing Requirements:**
- Unit tests for aggregation logic
- Integration tests with Athena
- Test dashboard response format
- Test performance

---

#### Task 4.4: Analytics Service API Endpoints

**Task ID:** `MVP-4.4`  
**Description:** Complete Analytics Service API endpoint implementation

**Dependencies:** MVP-4.3 (Dashboard Aggregation Logic)

**Files to Modify:**
- `server/application/microservices/analytics/src/analytics/analytics.controller.ts`

**Implementation Details:**
1. Implement `getPrincipalDashboard()` endpoint:
   - `GET /analytics/dashboards/principals/:schoolId`
   - Query parameters: `academicYearId`, `startDate`, `endDate`
   - Return dashboard data

2. Implement `getTeacherDashboard()` endpoint:
   - `GET /analytics/dashboards/teachers/:teacherId`
   - Query parameters: `academicYearId`, `classroomId`, `startDate`, `endDate`
   - Return dashboard data

3. Implement `getStudentPerformance()` endpoint:
   - `GET /analytics/students/:studentId/performance`
   - Query parameters: `academicYearId`
   - Return performance data

4. Implement `getAtRiskStudents()` endpoint:
   - `GET /analytics/schools/:schoolId/at-risk-students`
   - Query parameters: `academicYearId`, `threshold`
   - Return at-risk student list

5. Implement `getAchievementGaps()` endpoint:
   - `GET /analytics/schools/:schoolId/achievement-gaps`
   - Query parameters: `academicYearId`, `demographic`
   - Return gap analysis

**Acceptance Criteria:**
- ✅ All API endpoints implemented
- ✅ Query parameters validated
- ✅ Response format correct
- ✅ Error handling implemented
- ✅ Unit tests
- ✅ Integration tests

**Estimated Effort:** 8 story points (3 days)

**Testing Requirements:**
- Unit tests for endpoints
- Integration tests
- Test query parameters
- Test error handling

---

#### Task 4.5: Analytics Data Materialization

**Task ID:** `MVP-4.5`  
**Description:** Set up Glue ETL jobs to materialize views for faster queries

**Dependencies:** MVP-4.1 (Glue Table Definitions)

**Files to Create:**
- `server/lib/shared-infra/Resources/glue-etl-jobs.ts` (CDK)

**Implementation Details:**
1. Create Glue ETL job for student dashboard view:
   - Aggregate student data from multiple event tables
   - Materialize view in S3: `s3://edforge-data-lake/materialized-views/student-dashboards/`
   - Run daily (or on-demand)

2. Create Glue ETL job for principal dashboard view:
   - Aggregate school-wide data
   - Materialize view in S3
   - Run daily

3. Create Glue ETL job for teacher dashboard view:
   - Aggregate teacher-specific data
   - Materialize view in S3
   - Run daily

4. Schedule ETL jobs:
   - Use EventBridge scheduler
   - Run at 2 AM daily
   - Handle failures with DLQ

**Acceptance Criteria:**
- ✅ Glue ETL jobs created
   - ✅ Materialized views created
   - ✅ ETL jobs scheduled
   - ✅ Views updated daily
   - ✅ Query performance improved

**Estimated Effort:** 13 story points (5 days)

**Testing Requirements:**
- Test ETL job execution
- Verify materialized views
- Test query performance improvement

---

### Phase 4 Deliverables

- ✅ Analytics Service fully implemented
- ✅ Glue tables and ETL jobs operational
- ✅ Athena queries working
- ✅ Dashboard endpoints functional
- ✅ Materialized views created

---

## Phase 5: Advanced Features

**Duration:** 4 weeks (Week 13-16)  
**Story Points:** 68 points  
**Priority:** Medium (Enhances user experience)

### Objectives

- Implement bulk operations
- Add import/export functionality
- Implement advanced reporting
- Add caching layer
- Performance optimizations

### Tasks

#### Task 5.1: Bulk Enrollment Operations

**Task ID:** `MVP-5.1`  
**Description:** Add bulk enrollment creation endpoint

**Dependencies:** MVP-2.1 (Enrollment → Finance Integration)

**Files to Modify:**
- `server/application/microservices/enrollment/src/enrollment/enrollment.controller.ts`
- `server/application/microservices/enrollment/src/enrollment/enrollment.service.ts`
- `server/application/microservices/enrollment/src/enrollment/dto/enrollment.dto.ts`

**Implementation Details:**
1. Add bulk enrollment endpoint:
   - `POST /enrollments/bulk`
   - Accept array of enrollment DTOs
   - Process enrollments in parallel (max 10 concurrent)
   - Return results with success/failure status

2. Add bulk validation:
   - Validate all enrollments before processing
   - Check for duplicates
   - Validate academic year
   - Validate school capacity

3. Add bulk invoice creation:
   - Create invoices for all enrollments
   - Handle partial failures
   - Return invoice IDs

4. Add progress tracking:
   - Return progress for long-running operations
   - Use SQS for async processing (future)

**Acceptance Criteria:**
- ✅ Bulk enrollment endpoint working
- ✅ Validation implemented
- ✅ Partial failure handling
- ✅ Unit tests
- ✅ Integration tests

**Estimated Effort:** 8 story points (3 days)

**Testing Requirements:**
- Unit tests for bulk operations
- Integration tests
- Test partial failures
- Test performance with large batches

---

#### Task 5.2: Bulk Attendance Operations

**Task ID:** `MVP-5.2`  
**Description:** Enhance bulk attendance endpoint (already exists, improve it)

**Dependencies:** None

**Files to Modify:**
- `server/application/microservices/attendance/src/attendance/attendance.service.ts`

**Implementation Details:**
1. Improve bulk attendance endpoint:
   - Add validation for all records
   - Add batch processing (process in chunks)
   - Add progress tracking
   - Add error handling for individual records

2. Add bulk attendance import:
   - `POST /attendance/records/import`
   - Accept CSV file
   - Parse and validate CSV
   - Create attendance records in bulk

**Acceptance Criteria:**
- ✅ Bulk attendance improved
- ✅ CSV import working
- ✅ Validation implemented
- ✅ Unit tests
- ✅ Integration tests

**Estimated Effort:** 5 story points (2 days)

**Testing Requirements:**
- Unit tests for bulk operations
- Integration tests
- Test CSV import
- Test error handling

---

#### Task 5.3: Bulk Grade Entry

**Task ID:** `MVP-5.3`  
**Description:** Add bulk grade entry endpoint

**Dependencies:** None

**Files to Modify:**
- `server/application/microservices/assessment/src/grading/grading.controller.ts`
- `server/application/microservices/assessment/src/grading/grading.service.ts`

**Implementation Details:**
1. Add bulk grade entry endpoint:
   - `POST /assessment/grades/bulk`
   - Accept array of grade DTOs
   - Process grades in parallel
   - Return results with success/failure status

2. Add bulk grade import:
   - `POST /assessment/grades/import`
   - Accept CSV file
   - Parse and validate CSV
   - Create grades in bulk

3. Add validation:
   - Validate all grades before processing
   - Check assignment exists
   - Check student exists
   - Validate score ranges

**Acceptance Criteria:**
- ✅ Bulk grade entry working
- ✅ CSV import working
- ✅ Validation implemented
- ✅ Unit tests
- ✅ Integration tests

**Estimated Effort:** 8 story points (3 days)

**Testing Requirements:**
- Unit tests for bulk operations
- Integration tests
- Test CSV import
- Test validation

---

#### Task 5.4: Import/Export Functionality

**Task ID:** `MVP-5.4`  
**Description:** Add import/export endpoints for key entities

**Dependencies:** None

**Files to Create/Modify:**
- `server/application/microservices/enrollment/src/student/student.controller.ts` (export)
- `server/application/microservices/enrollment/src/student/student.service.ts` (export)
- `server/application/microservices/school/src/schools/schools.controller.ts` (export)

**Implementation Details:**
1. Add student export:
   - `GET /students/export`
   - Export to CSV format
   - Include all student fields
   - Filter by school/year

2. Add enrollment export:
   - `GET /enrollments/export`
   - Export to CSV format
   - Include enrollment details

3. Add student import:
   - `POST /students/import`
   - Accept CSV file
   - Parse and validate
   - Create students in bulk

4. Add school configuration export:
   - `GET /schools/:schoolId/export`
   - Export school configuration to JSON

**Acceptance Criteria:**
- ✅ Export endpoints working
- ✅ Import endpoints working
- ✅ CSV parsing working
- ✅ Validation implemented
- ✅ Unit tests
- ✅ Integration tests

**Estimated Effort:** 13 story points (5 days)

**Testing Requirements:**
- Unit tests for import/export
- Integration tests
- Test CSV parsing
- Test validation

---

#### Task 5.5: Caching Layer Implementation

**Task ID:** `MVP-5.5`  
**Description:** Add ElastiCache Redis for caching

**Dependencies:** None

**Files to Create:**
- `server/lib/shared-infra/Resources/elasticache-redis.ts` (CDK)
- `server/application/libs/cache/src/cache.service.ts`
- `server/application/libs/cache/src/cache.module.ts`

**Implementation Details:**
1. Create ElastiCache Redis cluster:
   - Cluster mode: disabled (single node for MVP)
   - Node type: cache.t3.micro
   - Multi-AZ: false (for MVP)
   - Encryption: at rest and in transit

2. Create `CacheService`:
   - `get(key)` - Get from cache
   - `set(key, value, ttl)` - Set in cache
   - `delete(key)` - Delete from cache
   - `clear(pattern)` - Clear by pattern
   - Tenant-scoped keys: `{tenantId}:{entityType}:{entityId}`

3. Integrate caching in services:
   - School Service: Cache school and academic year lookups
   - Enrollment Service: Cache student lookups
   - Curriculum Service: Cache classroom lookups
   - Assessment Service: Cache assignment lookups
   - Attendance Service: Cache attendance summaries

4. Cache TTL strategy:
   - School data: 15 minutes
   - Student data: 10 minutes
   - Classroom data: 10 minutes
   - Assignment data: 5 minutes
   - Attendance summaries: 5 minutes

**Acceptance Criteria:**
- ✅ ElastiCache Redis created
- ✅ Cache service created
- ✅ Caching integrated in services
- ✅ Cache invalidation working
- ✅ Unit tests
- ✅ Integration tests

**Estimated Effort:** 13 story points (5 days)

**Testing Requirements:**
- Unit tests for cache service
- Integration tests with Redis
- Test cache hit/miss
- Test cache invalidation

---

#### Task 5.6: Performance Optimizations

**Task ID:** `MVP-5.6`  
**Description:** Optimize performance across all services

**Dependencies:** MVP-5.5 (Caching Layer)

**Files to Modify:**
- All service files (optimize queries, add indexes)

**Implementation Details:**
1. Optimize DynamoDB queries:
   - Review all queries for efficiency
   - Add missing GSIs if needed
   - Optimize query filters
   - Add query result pagination

2. Optimize API responses:
   - Add response compression
   - Remove unnecessary fields
   - Add pagination for list endpoints
   - Add field selection (future: GraphQL)

3. Optimize event publishing:
   - Batch events where possible
   - Reduce event payload size
   - Use event compression (future)

4. Database connection pooling:
   - Optimize DynamoDB client configuration
   - Add connection pooling (if using RDS in future)

5. Add performance monitoring:
   - Add CloudWatch custom metrics
   - Track query latency
   - Track API response times

**Acceptance Criteria:**
- ✅ Query performance improved
- ✅ API response times improved
- ✅ Event publishing optimized
- ✅ Performance metrics tracked
- ✅ Load testing passed

**Estimated Effort:** 13 story points (5 days)

**Testing Requirements:**
- Load testing
- Performance benchmarking
- Query performance analysis

---

### Phase 5 Deliverables

- ✅ Bulk operations implemented
- ✅ Import/export functionality working
- ✅ Caching layer operational
- ✅ Performance optimizations completed

---

## Phase 6: Testing & Quality

**Duration:** 2 weeks (Week 17-18)  
**Story Points:** 42 points  
**Priority:** High (Required for production)

### Objectives

- Write comprehensive unit tests
- Write integration tests
- Write E2E workflow tests
- Perform load testing
- Perform security testing

### Tasks

#### Task 6.1: Unit Tests for All Services

**Task ID:** `MVP-6.1`  
**Description:** Write unit tests for all service methods

**Dependencies:** MVP-0.4 (Testing Framework Setup)

**Files to Create:**
- Unit test files for all services (`.spec.ts` files)

**Implementation Details:**
1. School Service unit tests:
   - Test all CRUD operations
   - Test validation logic
   - Test event publishing
   - Test error handling
   - Target: 90%+ coverage

2. Enrollment Service unit tests:
   - Test student CRUD
   - Test enrollment CRUD
   - Test enrollment status transitions
   - Test Finance HTTP client integration
   - Test Curriculum HTTP client integration
   - Target: 90%+ coverage

3. Curriculum Service unit tests:
   - Test classroom CRUD
   - Test stream post CRUD
   - Test event publishing
   - Target: 90%+ coverage

4. Assessment Service unit tests:
   - Test assignment CRUD
   - Test grade CRUD
   - Test grade calculations
   - Test event publishing
   - Target: 90%+ coverage

5. Attendance Service unit tests:
   - Test attendance CRUD
   - Test bulk operations
   - Test summary calculations
   - Test event publishing
   - Target: 90%+ coverage

6. Finance Service unit tests:
   - Test invoice CRUD
   - Test payment CRUD
   - Test tuition configuration
   - Test invoice calculations
   - Test event publishing
   - Target: 90%+ coverage

7. Staff Service unit tests:
   - Test staff CRUD
   - Test event publishing
   - Target: 90%+ coverage

8. Parent Portal Service unit tests:
   - Test parent CRUD
   - Test event handlers
   - Test notification service
   - Test event publishing
   - Target: 90%+ coverage

9. Analytics Service unit tests:
   - Test Athena queries
   - Test aggregation logic
   - Test dashboard methods
   - Target: 80%+ coverage (read-only service)

**Acceptance Criteria:**
- ✅ All services have 90%+ unit test coverage
- ✅ All critical paths tested
- ✅ All error scenarios tested
- ✅ Tests run in CI/CD pipeline

**Estimated Effort:**
- School: 3 points (1 day)
- Enrollment: 5 points (2 days)
- Curriculum: 3 points (1 day)
- Assessment: 5 points (2 days)
- Attendance: 3 points (1 day)
- Finance: 5 points (2 days)
- Staff: 2 points (1 day)
- Parent Portal: 5 points (2 days)
- Analytics: 3 points (1 day)
- **Total: 34 story points (13 days)**

**Testing Requirements:**
- Run test suite
- Verify coverage thresholds
- Fix failing tests

---

#### Task 6.2: Integration Tests

**Task ID:** `MVP-6.2`  
**Description:** Write integration tests for API endpoints

**Dependencies:** MVP-0.4 (Testing Framework Setup)

**Files to Create:**
- Integration test files for all services

**Implementation Details:**
1. Test API endpoints:
   - Test all CRUD endpoints
   - Test query parameters
   - Test request validation
   - Test response formats
   - Test error responses

2. Test inter-service integration:
   - Test Enrollment → Finance integration
   - Test Enrollment → Curriculum integration
   - Test Staff → School integration

3. Test event publishing:
   - Verify events published to EventBridge
   - Verify event payloads correct

4. Test authentication/authorization:
   - Test JWT validation
   - Test tenant isolation
   - Test role-based access

**Acceptance Criteria:**
- ✅ All API endpoints tested
- ✅ Inter-service integration tested
- ✅ Event publishing tested
- ✅ Authentication/authorization tested
- ✅ Tests run in CI/CD pipeline

**Estimated Effort:** 5 story points (2 days)

**Testing Requirements:**
- Run integration test suite
- Verify all tests passing
- Test with real AWS services (LocalStack)

---

#### Task 6.3: E2E Workflow Tests

**Task ID:** `MVP-6.3`  
**Description:** Write end-to-end workflow tests

**Dependencies:** MVP-6.1, MVP-6.2

**Files to Create:**
- E2E test files for key workflows

**Implementation Details:**
1. Test student enrollment workflow:
   - Create school → Create academic year → Create student → Enroll student → Verify invoice created → Verify events published

2. Test grade publishing workflow:
   - Create assignment → Create grade → Publish grade → Verify parent notification sent → Verify analytics updated

3. Test attendance workflow:
   - Record attendance → Calculate summary → Verify events published → Verify analytics updated

4. Test invoice payment workflow:
   - Generate invoice → Record payment → Verify invoice updated → Verify events published

**Acceptance Criteria:**
- ✅ Key workflows tested end-to-end
- ✅ All workflows passing
- ✅ Tests run in CI/CD pipeline

**Estimated Effort:** 3 story points (1 day)

**Testing Requirements:**
- Run E2E test suite
- Verify all workflows passing

---

### Phase 6 Deliverables

- ✅ Comprehensive unit test coverage (90%+)
- ✅ Integration tests for all endpoints
- ✅ E2E workflow tests
- ✅ All tests passing in CI/CD

---

## Phase 7: Production Readiness

**Duration:** 2 weeks (Week 19-20)  
**Story Points:** 34 points  
**Priority:** Critical (Required for production)

### Objectives

- Set up monitoring and alerting
- Complete documentation
- Automate deployment
- Plan disaster recovery
- Tune performance

### Tasks

#### Task 7.1: Monitoring and Alerting

**Task ID:** `MVP-7.1`  
**Description:** Set up comprehensive monitoring and alerting

**Dependencies:** None

**Files to Create:**
- `server/lib/shared-infra/Resources/monitoring.ts` (CDK)

**Implementation Details:**
1. CloudWatch dashboards:
   - Service health dashboard
   - API performance dashboard
   - Event processing dashboard
   - Error rate dashboard
   - Tenant usage dashboard

2. CloudWatch alarms:
   - High error rate (> 5%)
   - High latency (> 1 second p95)
   - Service down
   - Event processing failures
   - DLQ messages

3. SNS notifications:
   - Email alerts for critical alarms
   - Slack integration (future)
   - PagerDuty integration (future)

4. X-Ray tracing:
   - Enable X-Ray for all services
   - Trace API requests
   - Trace inter-service calls
   - Trace event processing

**Acceptance Criteria:**
- ✅ CloudWatch dashboards created
- ✅ CloudWatch alarms configured
- ✅ SNS notifications working
- ✅ X-Ray tracing enabled

**Estimated Effort:** 8 story points (3 days)

**Testing Requirements:**
- Test alarm triggers
- Test dashboard display
- Test X-Ray traces

---

#### Task 7.2: Documentation Completion

**Task ID:** `MVP-7.2`  
**Description:** Complete all documentation

**Dependencies:** None

**Files to Review/Update:**
- All README.md files
- ARCHITECTURE.md
- API documentation

**Implementation Details:**
1. Update service READMEs:
   - Add API examples
   - Add troubleshooting guides
   - Add deployment instructions
   - Add configuration details

2. Create API documentation:
   - OpenAPI/Swagger specs for all services
   - API examples
   - Error response documentation

3. Create deployment guide:
   - Step-by-step deployment instructions
   - Environment variable documentation
   - Infrastructure setup guide

4. Create runbook:
   - Common operations
   - Troubleshooting procedures
   - Disaster recovery procedures

**Acceptance Criteria:**
- ✅ All READMEs updated
- ✅ API documentation complete
- ✅ Deployment guide created
- ✅ Runbook created

**Estimated Effort:** 5 story points (2 days)

**Testing Requirements:**
- Review all documentation
- Verify accuracy
- Test deployment guide

---

#### Task 7.3: Deployment Automation

**Task ID:** `MVP-7.3`  
**Description:** Automate deployment pipeline

**Dependencies:** None

**Files to Create:**
- `.github/workflows/deploy.yml` (or GitLab CI, etc.)
- `server/scripts/deploy.sh`

**Implementation Details:**
1. CI/CD pipeline:
   - Build Docker images
   - Run tests
   - Push to ECR
   - Deploy to ECS
   - Run smoke tests
   - Rollback on failure

2. Deployment strategy:
   - Blue/green deployment
   - Health check validation
   - Gradual rollout (future)

3. Environment management:
   - Dev environment
   - Staging environment
   - Production environment

**Acceptance Criteria:**
- ✅ CI/CD pipeline working
- ✅ Automated deployments
- ✅ Rollback mechanism
- ✅ Smoke tests passing

**Estimated Effort:** 8 story points (3 days)

**Testing Requirements:**
- Test deployment pipeline
- Test rollback mechanism
- Test smoke tests

---

#### Task 7.4: Disaster Recovery Planning

**Task ID:** `MVP-7.4`  
**Description:** Create disaster recovery plan and procedures

**Dependencies:** None

**Files to Create:**
- `server/application/microservices/DISASTER_RECOVERY.md`

**Implementation Details:**
1. Backup strategy:
   - DynamoDB point-in-time recovery
   - S3 data lake backups
   - Event archive backups
   - Database snapshots

2. Recovery procedures:
   - Service recovery procedures
   - Data recovery procedures
   - Event replay procedures

3. RTO/RPO targets:
   - RTO: 4 hours
   - RPO: 1 hour

4. Failover procedures:
   - Multi-region failover (future)
   - Service-level failover

**Acceptance Criteria:**
- ✅ Disaster recovery plan created
- ✅ Backup strategy implemented
- ✅ Recovery procedures documented
- ✅ Recovery tested

**Estimated Effort:** 5 story points (2 days)

**Testing Requirements:**
- Test backup procedures
- Test recovery procedures
- Document test results

---

#### Task 7.5: Performance Tuning

**Task ID:** `MVP-7.5`  
**Description:** Final performance tuning and optimization

**Dependencies:** MVP-5.6 (Performance Optimizations)

**Files to Modify:**
- All service files (optimize based on load testing results)

**Implementation Details:**
1. Load testing:
   - Test with expected load
   - Identify bottlenecks
   - Optimize slow queries
   - Optimize API responses

2. Database optimization:
   - Review DynamoDB capacity
   - Optimize GSI usage
   - Add missing indexes

3. Caching optimization:
   - Review cache hit rates
   - Adjust TTL values
   - Add missing cache entries

4. Service scaling:
   - Review auto-scaling configuration
   - Adjust scaling thresholds
   - Optimize resource allocation

**Acceptance Criteria:**
- ✅ Load testing completed
- ✅ Performance targets met
- ✅ Optimizations implemented
- ✅ Performance documented

**Estimated Effort:** 8 story points (3 days)

**Testing Requirements:**
- Load testing
- Performance benchmarking
- Verify performance targets

---

### Phase 7 Deliverables

- ✅ Monitoring and alerting operational
- ✅ Documentation complete
- ✅ Deployment automated
- ✅ Disaster recovery plan ready
- ✅ Performance tuned

---

## Summary

### Total Effort

- **Total Story Points:** 319 points
- **Total Duration:** 20 weeks (5 months)
- **Team Size:** 4-6 engineers
- **Velocity:** ~16 story points per week per engineer

### Critical Path

1. Phase 0: Foundation (Week 1-2) - Blocks Phase 1, 2, 3
2. Phase 1: Core Completion (Week 3-5) - Blocks Phase 2
3. Phase 2: Integration (Week 6-7) - Blocks Phase 3
4. Phase 3: Event Consumption (Week 8-9) - Blocks Phase 4
5. Phase 4: Analytics (Week 10-12) - Can run in parallel with Phase 5
6. Phase 5: Advanced Features (Week 13-16) - Can run in parallel with Phase 4
7. Phase 6: Testing (Week 17-18) - Blocks Phase 7
8. Phase 7: Production Readiness (Week 19-20)

### Risk Mitigation

**High-Risk Items:**
- EventBridge infrastructure setup (Phase 0) - Mitigate: Start early, test thoroughly
- Analytics Service implementation (Phase 4) - Mitigate: Prototype early, validate approach
- Performance tuning (Phase 7) - Mitigate: Continuous performance monitoring

**Dependencies:**
- Phase 2 depends on Phase 0 and Phase 1
- Phase 3 depends on Phase 0 and Phase 2
- Phase 4 depends on Phase 3
- Phase 6 depends on Phases 1-5
- Phase 7 depends on Phase 6

### Success Metrics

- ✅ All 9 services fully functional
- ✅ 90%+ unit test coverage
- ✅ All integration tests passing
- ✅ E2E workflows working
- ✅ Performance targets met (< 200ms p95 for CRUD, < 3s for analytics)
- ✅ Event-driven architecture operational
- ✅ Production-ready deployment

---

**Last Updated:** 2025-01-21  
**Maintained By:** Architecture Team

