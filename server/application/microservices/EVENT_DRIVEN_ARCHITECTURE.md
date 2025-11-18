# EdForge Event-Driven Architecture

**Version:** 1.0  
**Last Updated:** 2025-01-21  
**Status:** Production Design

---

## Executive Summary

This document provides a comprehensive technical guide to the event-driven architecture of the EdForge EMIS platform. It covers event generation, flow, consumption patterns, EventBridge configuration, monitoring, security, and troubleshooting. The architecture leverages AWS EventBridge as the central event bus, enabling scalable, decoupled, and resilient microservices communication.

### Key Benefits

- **Loose Coupling**: Services don't need to know about each other
- **Scalability**: EventBridge handles millions of events per second
- **Resilience**: Events are durable and retryable
- **Flexibility**: Easy to add new subscribers without changing publishers
- **Cost-Effective**: $1 per million events (extremely affordable)
- **Enterprise-Grade**: Built-in retry, DLQ, archiving, and monitoring

### Technology Stack

- **Event Bus**: AWS EventBridge (SBT event bus)
- **Event Publishers**: All 9 microservices (NestJS)
- **Event Consumers**: Lambda functions (Parent Portal), Kinesis Firehose (Analytics)
- **Event Storage**: S3 (archived events, data lake)
- **Monitoring**: CloudWatch Metrics, Alarms, Dashboards
- **Tracing**: AWS X-Ray (distributed tracing)

---

## 1. Event Generation Architecture

### 1.1 EventServiceBase Implementation

All services use a shared base class `EventServiceBase` from `@app/events` for consistent event publishing.

**Location:** `server/application/libs/events/src/event-service.base.ts`

**Key Features:**
- Abstract base class for all event services
- AWS EventBridge client integration
- Automatic retry logic (3 attempts with exponential backoff)
- Error handling with CloudWatch logging
- Batch event publishing (up to 10 events per batch)
- Non-blocking async publishing

**Implementation Pattern:**
```typescript
@Injectable()
export abstract class EventServiceBase {
  protected readonly logger: Logger;
  protected readonly eventBridge: EventBridgeClient;
  protected readonly eventBusName: string;
  protected abstract readonly eventSource: string;

  constructor() {
    this.eventBridge = new EventBridgeClient({
      region: process.env.AWS_REGION || 'us-east-1',
      maxAttempts: 3,
      retryMode: 'adaptive'
    });
    
    this.eventBusName = process.env.EVENT_BUS_NAME || 
      'controlplanestackcontrolplanesbtEventManagerSbtEventBus1E602009';
  }

  async publishEvent(event: BaseDomainEvent): Promise<void> {
    const entry: PutEventsRequestEntry = {
      Source: this.eventSource,
      DetailType: event.eventType,
      Detail: JSON.stringify(event),
      EventBusName: this.eventBusName,
      Time: new Date(event.timestamp)
    };

    const command = new PutEventsCommand({ Entries: [entry] });
    const result = await this.eventBridge.send(command);
    
    // Error handling...
  }
}
```

### 1.2 Event Publishing Flow

**Step-by-Step Flow:**

1. **Service Operation**: A domain operation occurs (e.g., student enrolled, grade published)
2. **Event Creation**: Service creates event object with required fields
3. **Event Publishing**: Service calls `eventService.publishEvent(event)`
4. **EventBridge Client**: `EventServiceBase` creates EventBridge entry
5. **EventBridge**: Event is published to the event bus
6. **Event Routing**: EventBridge rules route event to subscribers
7. **Event Processing**: Subscribers (Lambda, Firehose) process event
8. **Event Archiving**: Event is archived to S3 (optional)

**Timeline:**
- Event creation: ~1ms
- EventBridge publishing: ~10ms
- Event routing: ~5ms
- Total latency: ~16ms (non-blocking)

### 1.3 Event Schema and Format Standards

**Base Event Interface:**
```typescript
export interface BaseDomainEvent {
  eventType: string;        // PascalCase event name (e.g., "StudentEnrolled")
  timestamp: string;         // ISO 8601 format (e.g., "2025-01-21T10:00:00Z")
  tenantId: string;         // Tenant identifier for multi-tenancy
  [key: string]: any;       // Service-specific fields
}
```

**Event Naming Convention:**
- **Format**: `{Entity}{Action}` (past tense)
- **Examples**: 
  - `StudentEnrolled` (not `EnrollStudent`)
  - `GradePublished` (not `PublishGrade`)
  - `InvoiceGenerated` (not `GenerateInvoice`)

**Event Source Convention:**
- **Format**: `edforge.{service-name}`
- **Examples**:
  - `edforge.school-service`
  - `edforge.enrollment-service`
  - `edforge.assessment-service`

**Event Payload Structure:**
```json
{
  "Source": "edforge.enrollment-service",
  "DetailType": "StudentEnrolled",
  "Detail": {
    "eventType": "StudentEnrolled",
    "timestamp": "2025-01-21T10:00:00Z",
    "tenantId": "tenant-123",
    "studentId": "student-456",
    "schoolId": "school-789",
    "academicYearId": "year-2024",
    "enrollmentId": "enrollment-abc",
    "enrollmentDate": "2025-01-21",
    "gradeLevel": "9"
  },
  "EventBusName": "controlplanestackcontrolplanesbtEventManagerSbtEventBus1E602009"
}
```

### 1.4 Event Versioning Strategy

**Current Approach:** No versioning (MVP phase)

**Future Approach:**
- **Event Schema Registry**: Use EventBridge Schema Registry
- **Version in Event Type**: `StudentEnrolledV1`, `StudentEnrolledV2`
- **Backward Compatibility**: Support multiple versions during transition
- **Deprecation**: Mark old versions as deprecated, remove after migration

**Migration Strategy:**
1. Publish new version alongside old version
2. Update all consumers to handle new version
3. Stop publishing old version
4. Remove old version handlers

### 1.5 Error Handling and Retry Logic

**Event Publishing Errors:**

**Transient Errors (Retried):**
- `ThrottlingException` - Rate limit exceeded
- `ServiceUnavailableException` - Service temporarily unavailable
- Network timeouts

**Permanent Errors (Not Retried):**
- `InvalidParameterException` - Invalid event format
- `AccessDeniedException` - Permission denied

**Retry Strategy:**
- **Max Attempts**: 3
- **Backoff**: Exponential (1s, 2s, 4s)
- **Retry Mode**: Adaptive (AWS SDK)

**Error Handling:**
```typescript
async publishEvent(event: BaseDomainEvent): Promise<void> {
  try {
    // Publish event...
  } catch (error) {
    // Log error to CloudWatch
    this.logger.error('Error publishing event:', {
      eventType: event.eventType,
      tenantId: event.tenantId,
      error: error.message
    });
    
    // Don't throw - event publishing should not block main operation
    // Failed events logged for monitoring/alerting
  }
}
```

**Dead Letter Queue (DLQ):**
- Failed events after max retries sent to DLQ
- DLQ: SQS queue per service
- Manual review and replay of failed events

---

## 2. Event Flow Through System

### 2.1 Complete Event Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Microservice (Publisher)                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Domain Operation (e.g., enrollStudent)                   │  │
│  └────────────────────┬─────────────────────────────────────┘  │
│                       │                                         │
│  ┌────────────────────▼─────────────────────────────────────┐  │
│  │  EventService.publishEvent(event)                         │  │
│  └────────────────────┬─────────────────────────────────────┘  │
│                       │                                         │
└───────────────────────┼─────────────────────────────────────────┘
                        │
                        │ HTTP POST (EventBridge API)
                        │
┌───────────────────────▼─────────────────────────────────────────┐
│                    AWS EventBridge                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Event Bus: SBT Event Bus                                │  │
│  │  - Receives event                                        │  │
│  │  - Validates event format                                │  │
│  │  - Routes to subscribers via rules                       │  │
│  └────────────────────┬─────────────────────────────────────┘  │
└───────────────────────┼─────────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
┌───────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
│   Lambda     │ │   Firehose   │ │     S3      │
│  (Parent     │ │  (Analytics) │ │  (Archive)  │
│   Portal)    │ │              │ │             │
└──────┬───────┘ └──────┬───────┘ └─────────────┘
       │                 │
       │                 │
┌──────▼──────┐ ┌────────▼────────┐
│   SES/SNS   │ │   S3 Data Lake  │
│ (Email/SMS) │ │  (Parquet)      │
└─────────────┘ └────────┬─────────┘
                         │
                  ┌──────▼──────┐
                  │   Athena    │
                  │  (Queries)  │
                  └─────────────┘
```

### 2.2 Event Routing via EventBridge Rules

**EventBridge Rules Configuration:**

**Rule 1: Parent Portal - Grade Published**
```json
{
  "Name": "parent-portal-grade-published",
  "EventPattern": {
    "source": ["edforge.assessment-service"],
    "detail-type": ["GradePublished"]
  },
  "Targets": [
    {
      "Arn": "arn:aws:lambda:us-east-1:123456789012:function:parent-portal-notification-handler",
      "Id": "grade-published-target"
    }
  ],
  "State": "ENABLED"
}
```

**Rule 2: Parent Portal - Invoice Generated**
```json
{
  "Name": "parent-portal-invoice-generated",
  "EventPattern": {
    "source": ["edforge.finance-service"],
    "detail-type": ["InvoiceGenerated"]
  },
  "Targets": [
    {
      "Arn": "arn:aws:lambda:us-east-1:123456789012:function:parent-portal-notification-handler",
      "Id": "invoice-generated-target"
    }
  ],
  "State": "ENABLED"
}
```

**Rule 3: Analytics - All Events**
```json
{
  "Name": "analytics-all-events",
  "EventPattern": {
    "source": [
      "edforge.school-service",
      "edforge.enrollment-service",
      "edforge.curriculum-service",
      "edforge.assessment-service",
      "edforge.attendance-service",
      "edforge.finance-service",
      "edforge.staff-service",
      "edforge.parent-portal-service"
    ]
  },
  "Targets": [
    {
      "Arn": "arn:aws:firehose:us-east-1:123456789012:deliverystream/edforge-events-stream",
      "Id": "analytics-firehose-target"
    }
  ],
  "State": "ENABLED"
}
```

### 2.3 Event Transformation Patterns

**No Transformation (Current):**
- Events published as-is
- Consumers receive full event payload

**Future Transformation Patterns:**

**1. Event Enrichment:**
- Add additional context to events
- Example: Add student name to `GradePublished` event

**2. Event Filtering:**
- Filter events based on criteria
- Example: Only route high-priority events to certain handlers

**3. Event Aggregation:**
- Combine multiple events into one
- Example: Aggregate daily attendance events into summary

**4. Event Deduplication:**
- Remove duplicate events
- Use event ID or correlation ID

### 2.4 Event Fan-Out Scenarios

**Scenario 1: Student Enrolled Event**

```
StudentEnrolled Event
    │
    ├──→ Analytics Service (Firehose) - Update dashboards
    ├──→ Parent Portal Service (Lambda) - Send welcome email
    └──→ Finance Service (Future) - Auto-generate invoice
```

**Scenario 2: Grade Published Event**

```
GradePublished Event
    │
    ├──→ Analytics Service (Firehose) - Update performance metrics
    ├──→ Parent Portal Service (Lambda) - Send grade notification
    └──→ Enrollment Service (Future) - Update transcript
```

**Scenario 3: Invoice Generated Event**

```
InvoiceGenerated Event
    │
    ├──→ Analytics Service (Firehose) - Update financial reports
    ├──→ Parent Portal Service (Lambda) - Send invoice notification
    └──→ Finance Service (Future) - Schedule payment reminders
```

---

## 3. Event Consumption Patterns

### 3.1 Lambda-Based Consumption (Parent Portal)

**Architecture:**
- EventBridge rule triggers Lambda function
- Lambda processes event and sends notification
- DLQ captures failed events

**Lambda Handler Example:**
```typescript
// parent-portal-notification-handler.ts
import { EventBridgeEvent } from 'aws-lambda';
import { GradePublishedEvent } from '@edforge/shared-types';

export async function handler(
  event: EventBridgeEvent<'GradePublished', GradePublishedEvent>
): Promise<void> {
  const detail = event.detail;
  
  // Get parents for student
  const parents = await getParentsByStudent(detail.studentId);
  
  // Send notifications
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

**Lambda Configuration:**
- **Runtime**: Node.js 18.x
- **Memory**: 256 MB
- **Timeout**: 30 seconds
- **Concurrency**: 10 (reserved)
- **DLQ**: SQS queue `parent-portal-dlq`

**Error Handling:**
- Retry on transient errors (3 attempts)
- Send to DLQ on permanent errors
- Log all errors to CloudWatch

### 3.2 Kinesis Firehose Consumption (Analytics)

**Architecture:**
- EventBridge rule routes all events to Kinesis Firehose
- Firehose buffers and delivers to S3
- S3 data lake stores events in Parquet format
- Athena queries data lake

**Firehose Configuration:**
- **Stream Name**: `edforge-events-stream`
- **Destination**: S3 bucket `edforge-data-lake-{tier}`
- **Buffer Size**: 5 MB or 60 seconds
- **Compression**: GZIP
- **Format**: Parquet
- **Partitioning**: `year=YYYY/month=MM/day=DD/service={service}/`

**Data Lake Structure:**
```
s3://edforge-data-lake/
├── events/
│   ├── year=2025/
│   │   ├── month=01/
│   │   │   ├── day=21/
│   │   │   │   ├── school-service/
│   │   │   │   │   └── events-2025-01-21-00-00-00.parquet
│   │   │   │   ├── enrollment-service/
│   │   │   │   │   └── events-2025-01-21-00-00-00.parquet
│   │   │   │   └── ...
```

**Athena Query Example:**
```sql
SELECT 
  eventType,
  COUNT(*) as eventCount,
  tenantId,
  schoolId
FROM assessment_events
WHERE year = '2025' 
  AND month = '01' 
  AND day = '21'
  AND eventType = 'GradePublished'
GROUP BY eventType, tenantId, schoolId
```

### 3.3 Direct Service Consumption (Future)

**Pattern:**
- Service subscribes to EventBridge events
- Service processes events synchronously or asynchronously
- Use SQS queue for async processing

**Example:**
```typescript
// Future: Curriculum Service consumes StudentEnrolled
@Injectable()
export class CurriculumEventConsumer {
  async handleStudentEnrolled(event: StudentEnrolledEvent) {
    // Update classroom roster
    await this.updateClassroomRoster(event.studentId, event.classroomId);
  }
}
```

### 3.4 Event Filtering and Routing

**EventBridge Rule Filters:**

**Filter by Event Type:**
```json
{
  "detail-type": ["GradePublished", "GradeUpdated"]
}
```

**Filter by Event Source:**
```json
{
  "source": ["edforge.assessment-service"]
}
```

**Filter by Event Detail:**
```json
{
  "detail": {
    "studentId": ["student-123", "student-456"]
  }
}
```

**Filter by Tenant:**
```json
{
  "detail": {
    "tenantId": ["tenant-123"]
  }
}
```

---

## 4. Event Catalog

### 4.1 Complete Event List by Service

#### School Service (14 events)

1. **SchoolCreated**
   - **Trigger**: New school created
   - **Payload**: `{ schoolId, schoolName, address, timezone }`
   - **Consumers**: Analytics

2. **SchoolUpdated**
   - **Trigger**: School details updated
   - **Payload**: `{ schoolId, changes }`
   - **Consumers**: Analytics

3. **SchoolDeleted**
   - **Trigger**: School deleted
   - **Payload**: `{ schoolId }`
   - **Consumers**: Analytics

4. **SchoolStatusChanged**
   - **Trigger**: School status changed (active/inactive)
   - **Payload**: `{ schoolId, previousStatus, newStatus }`
   - **Consumers**: Analytics

5. **AcademicYearCreated**
   - **Trigger**: New academic year created
   - **Payload**: `{ schoolId, academicYearId, name, startDate, endDate }`
   - **Consumers**: Analytics, Curriculum, Assessment

6. **AcademicYearUpdated**
   - **Trigger**: Academic year updated
   - **Payload**: `{ schoolId, academicYearId, changes }`
   - **Consumers**: Analytics

7. **AcademicYearStarted**
   - **Trigger**: Academic year status changed to 'active'
   - **Payload**: `{ schoolId, academicYearId, startDate }`
   - **Consumers**: Analytics, Curriculum, Assessment

8. **AcademicYearEnded**
   - **Trigger**: Academic year status changed to 'completed'
   - **Payload**: `{ schoolId, academicYearId, endDate }`
   - **Consumers**: Analytics

9. **CurrentAcademicYearChanged**
   - **Trigger**: Current academic year changed
   - **Payload**: `{ schoolId, previousYearId, newYearId }`
   - **Consumers**: Analytics

10. **DepartmentCreated**
    - **Trigger**: New department created
    - **Payload**: `{ schoolId, departmentId, name, code }`
    - **Consumers**: Analytics, Staff

11. **DepartmentUpdated**
    - **Trigger**: Department updated
    - **Payload**: `{ schoolId, departmentId, changes }`
    - **Consumers**: Analytics

12. **DepartmentRestructured**
    - **Trigger**: Department structure changed
    - **Payload**: `{ schoolId, departmentId, restructuringDetails }`
    - **Consumers**: Analytics, Staff

13. **GradingPeriodCreated**
    - **Trigger**: New grading period created
    - **Payload**: `{ schoolId, academicYearId, gradingPeriodId, name, startDate, endDate }`
    - **Consumers**: Analytics, Assessment

14. **HolidayCreated**
    - **Trigger**: New holiday added
    - **Payload**: `{ schoolId, academicYearId, holidayId, name, startDate, endDate }`
    - **Consumers**: Analytics, Attendance

#### Enrollment Service (9 events)

1. **StudentCreated**
   - **Trigger**: New student created
   - **Payload**: `{ studentId, schoolId, studentNumber, firstName, lastName, gradeLevel }`
   - **Consumers**: Analytics, Parent Portal

2. **StudentUpdated**
   - **Trigger**: Student details updated
   - **Payload**: `{ studentId, schoolId, changes }`
   - **Consumers**: Analytics

3. **StudentEnrolled**
   - **Trigger**: Student enrolled in academic year
   - **Payload**: `{ studentId, schoolId, academicYearId, enrollmentId, enrollmentDate, gradeLevel }`
   - **Consumers**: Analytics, Parent Portal, Finance (future), Curriculum (future), Attendance (future)

4. **StudentWithdrawn**
   - **Trigger**: Student withdrawn from school
   - **Payload**: `{ studentId, schoolId, academicYearId, withdrawalDate, withdrawalReason }`
   - **Consumers**: Analytics, Finance

5. **StudentEnrolledInClassroom**
   - **Trigger**: Student enrolled in classroom
   - **Payload**: `{ studentId, classroomId, schoolId, academicYearId, enrollmentId, enrollmentDate }`
   - **Consumers**: Analytics, Curriculum, Assessment, Attendance

6. **StudentUnenrolledFromClassroom**
   - **Trigger**: Student unenrolled from classroom
   - **Payload**: `{ studentId, classroomId, schoolId, academicYearId, unenrollmentDate, reason }`
   - **Consumers**: Analytics, Curriculum, Assessment, Attendance

7. **TranscriptGenerated**
   - **Trigger**: Student transcript generated
   - **Payload**: `{ studentId, schoolId, transcriptId, academicYearId, cumulativeGpa }`
   - **Consumers**: Analytics

8. **TransferInitiated**
   - **Trigger**: Student transfer initiated
   - **Payload**: `{ studentId, fromSchoolId, toSchoolId, transferId, transferDate }`
   - **Consumers**: Analytics

9. **TransferCompleted**
   - **Trigger**: Student transfer completed
   - **Payload**: `{ studentId, fromSchoolId, toSchoolId, transferId, completionDate }`
   - **Consumers**: Analytics

#### Curriculum Service (5 events)

1. **ClassroomCreated**
   - **Trigger**: New classroom created
   - **Payload**: `{ classroomId, schoolId, academicYearId, courseId, teacherId, maxCapacity }`
   - **Consumers**: Analytics, Enrollment, Assessment, Attendance

2. **ClassroomUpdated**
   - **Trigger**: Classroom details updated
   - **Payload**: `{ classroomId, schoolId, academicYearId, changes }`
   - **Consumers**: Analytics

3. **ClassroomDeleted**
   - **Trigger**: Classroom deleted
   - **Payload**: `{ classroomId, schoolId, academicYearId }`
   - **Consumers**: Analytics, Enrollment, Assessment, Attendance

4. **LessonPlanPublished**
   - **Trigger**: Lesson plan published (future)
   - **Payload**: `{ lessonPlanId, classroomId, schoolId, academicYearId, teacherId, lessonDate }`
   - **Consumers**: Analytics

5. **StreamPostCreated**
   - **Trigger**: Stream post created
   - **Payload**: `{ postId, classroomId, schoolId, academicYearId, authorId, postType }`
   - **Consumers**: Analytics

#### Assessment Service (7 events)

1. **AssignmentCreated**
   - **Trigger**: New assignment created
   - **Payload**: `{ assignmentId, classroomId, schoolId, academicYearId, teacherId, title, dueDate, maxScore }`
   - **Consumers**: Analytics

2. **AssignmentPublished**
   - **Trigger**: Assignment published (visible to students)
   - **Payload**: `{ assignmentId, classroomId, schoolId, academicYearId, title, dueDate, maxScore, studentIds }`
   - **Consumers**: Analytics, Parent Portal (future)

3. **AssignmentArchived**
   - **Trigger**: Assignment archived
   - **Payload**: `{ assignmentId, classroomId, schoolId, academicYearId }`
   - **Consumers**: Analytics

4. **GradeCreated**
   - **Trigger**: New grade created
   - **Payload**: `{ gradeId, assignmentId, studentId, classroomId, schoolId, academicYearId, score, maxScore }`
   - **Consumers**: Analytics

5. **GradeUpdated**
   - **Trigger**: Grade updated
   - **Payload**: `{ gradeId, assignmentId, studentId, previousScore, newScore }`
   - **Consumers**: Analytics

6. **GradePublished**
   - **Trigger**: Grade published (visible to student/parent)
   - **Payload**: `{ gradeId, assignmentId, studentId, classroomId, schoolId, academicYearId, score, maxScore, letterGrade }`
   - **Consumers**: Analytics, Parent Portal

7. **CourseGradeCalculated**
   - **Trigger**: Course grade calculated
   - **Payload**: `{ studentId, classroomId, schoolId, academicYearId, courseGrade, letterGrade, gpaPoints }`
   - **Consumers**: Analytics, Enrollment (for transcript)

#### Attendance Service (5 events)

1. **AttendanceRecorded**
   - **Trigger**: Attendance recorded for student
   - **Payload**: `{ recordId, studentId, classroomId, schoolId, academicYearId, date, status, recordedBy }`
   - **Consumers**: Analytics, Parent Portal

2. **AttendanceUpdated**
   - **Trigger**: Attendance record updated
   - **Payload**: `{ recordId, studentId, previousStatus, newStatus, reason }`
   - **Consumers**: Analytics

3. **AbsenceExcused**
   - **Trigger**: Absence excused
   - **Payload**: `{ recordId, studentId, classroomId, schoolId, date, excuseNote, excusedBy }`
   - **Consumers**: Analytics

4. **ChronicAbsenteeismDetected**
   - **Trigger**: Chronic absenteeism detected (future)
   - **Payload**: `{ studentId, schoolId, academicYearId, absenceRate, totalAbsences, threshold }`
   - **Consumers**: Analytics, Parent Portal

5. **TruancyAlertGenerated**
   - **Trigger**: Truancy alert generated (future)
   - **Payload**: `{ studentId, schoolId, academicYearId, unexcusedAbsences, threshold }`
   - **Consumers**: Analytics, Parent Portal

#### Finance Service (8 events)

1. **InvoiceGenerated**
   - **Trigger**: Invoice generated
   - **Payload**: `{ invoiceId, studentId, schoolId, academicYearId, invoiceNumber, totalAmount, dueDate, lineItems }`
   - **Consumers**: Analytics, Parent Portal

2. **InvoiceUpdated**
   - **Trigger**: Invoice updated
   - **Payload**: `{ invoiceId, studentId, changes }`
   - **Consumers**: Analytics

3. **PaymentReceived**
   - **Trigger**: Payment received
   - **Payload**: `{ paymentId, invoiceId, studentId, schoolId, amount, paymentMethod, transactionId }`
   - **Consumers**: Analytics

4. **PaymentRefunded**
   - **Trigger**: Payment refunded
   - **Payload**: `{ paymentId, invoiceId, studentId, refundAmount, reason }`
   - **Consumers**: Analytics

5. **InvoiceOverdue**
   - **Trigger**: Invoice becomes overdue
   - **Payload**: `{ invoiceId, studentId, schoolId, dueDate, daysOverdue, balanceDue }`
   - **Consumers**: Analytics, Parent Portal

6. **LateFeeApplied**
   - **Trigger**: Late fee applied to invoice
   - **Payload**: `{ invoiceId, studentId, schoolId, lateFeeAmount, daysOverdue }`
   - **Consumers**: Analytics

7. **DiscountApplied**
   - **Trigger**: Discount applied to invoice
   - **Payload**: `{ invoiceId, studentId, discountId, discountAmount, discountType }`
   - **Consumers**: Analytics

8. **ScholarshipAwarded**
   - **Trigger**: Scholarship awarded
   - **Payload**: `{ scholarshipId, studentId, schoolId, academicYearId, amount, scholarshipType }`
   - **Consumers**: Analytics

#### Staff Service (6 events)

1. **StaffHired**
   - **Trigger**: Staff member hired
   - **Payload**: `{ staffId, schoolId, staffType, departmentId, hireDate, firstName, lastName }`
   - **Consumers**: Analytics, Curriculum

2. **StaffTerminated**
   - **Trigger**: Staff member terminated
   - **Payload**: `{ staffId, schoolId, terminationDate, reason }`
   - **Consumers**: Analytics

3. **StaffAssignedToClassroom**
   - **Trigger**: Staff assigned to classroom
   - **Payload**: `{ staffId, classroomId, schoolId, academicYearId, role }`
   - **Consumers**: Analytics, Curriculum

4. **CertificationRenewed**
   - **Trigger**: Staff certification renewed (future)
   - **Payload**: `{ staffId, certificationId, schoolId, renewalDate, expirationDate }`
   - **Consumers**: Analytics

5. **CertificationExpiringSoon**
   - **Trigger**: Staff certification expiring soon (future)
   - **Payload**: `{ staffId, certificationId, schoolId, expirationDate, daysUntilExpiration }`
   - **Consumers**: Analytics

6. **ProfessionalDevelopmentCompleted**
   - **Trigger**: Professional development completed (future)
   - **Payload**: `{ staffId, schoolId, pdId, pdTitle, hoursCompleted, completionDate }`
   - **Consumers**: Analytics

#### Parent Portal Service (4 events)

1. **GuardianRegistered**
   - **Trigger**: Guardian registered
   - **Payload**: `{ guardianId, schoolId, email, firstName, lastName }`
   - **Consumers**: Analytics

2. **GuardianLinkedToStudent**
   - **Trigger**: Guardian linked to student
   - **Payload**: `{ guardianId, studentId, schoolId, relationshipType, isPrimary }`
   - **Consumers**: Analytics

3. **NotificationSent**
   - **Trigger**: Notification sent to guardian
   - **Payload**: `{ notificationId, guardianId, studentId, notificationType, channel, subject, message }`
   - **Consumers**: Analytics

4. **PortalAccessGranted**
   - **Trigger**: Portal access granted (future)
   - **Payload**: `{ guardianId, schoolId, accessLevel }`
   - **Consumers**: Analytics

#### Analytics Service (4 events)

1. **ReportGenerated**
   - **Trigger**: Report generated
   - **Payload**: `{ reportId, reportType, schoolId, academicYearId, generatedBy }`
   - **Consumers**: None (for audit)

2. **DashboardUpdated**
   - **Trigger**: Dashboard updated
   - **Payload**: `{ dashboardId, dashboardType, schoolId, academicYearId }`
   - **Consumers**: None (for audit)

3. **ExportCompleted**
   - **Trigger**: Data export completed
   - **Payload**: `{ exportId, exportType, schoolId, fileUrl }`
   - **Consumers**: None (for audit)

4. **StudentAtRiskDetected**
   - **Trigger**: At-risk student detected
   - **Payload**: `{ studentId, schoolId, academicYearId, riskFactors, riskScore }`
   - **Consumers**: Parent Portal (future), Enrollment (future)

**Total: 62 unique events**

### 4.2 Event Dependencies and Relationships

**Event Chains:**

**Chain 1: Student Enrollment Flow**
```
StudentCreated
  ↓
StudentEnrolled
  ↓
StudentEnrolledInClassroom
  ↓
InvoiceGenerated (via HTTP call, not event)
```

**Chain 2: Grade Publishing Flow**
```
AssignmentCreated
  ↓
AssignmentPublished
  ↓
GradeCreated
  ↓
GradePublished → Parent Portal Notification
  ↓
CourseGradeCalculated
```

**Chain 3: Invoice Payment Flow**
```
InvoiceGenerated → Parent Portal Notification
  ↓
PaymentReceived
  ↓
InvoiceUpdated (status: paid)
```

**Event Relationships:**

**Parent-Child Relationships:**
- `StudentEnrolled` → `StudentEnrolledInClassroom` (one-to-many)
- `AssignmentCreated` → `GradeCreated` (one-to-many)
- `InvoiceGenerated` → `PaymentReceived` (one-to-many)

**Causal Relationships:**
- `StudentEnrolled` causes `InvoiceGenerated` (via HTTP)
- `GradePublished` causes `NotificationSent` (via event)
- `AttendanceRecorded` causes `ChronicAbsenteeismDetected` (future, via analytics)

---

## 5. EventBridge Configuration

### 5.1 Event Bus Setup

**SBT Event Bus:**
- **Name**: `controlplanestackcontrolplanesbtEventManagerSbtEventBus1E602009`
- **ARN**: `arn:aws:events:us-east-1:346698404105:event-bus/controlplanestackcontrolplanesbtEventManagerSbtEventBus1E602009`
- **Region**: `us-east-1`
- **Purpose**: Shared event bus for all EdForge events

**Configuration:**
- **Retention**: 730 days (configurable)
- **Archiving**: Enabled (S3)
- **Encryption**: KMS (optional, future)

### 5.2 Event Rules Configuration

**CDK Configuration Example:**
```typescript
// eventbridge-rules.ts
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';

// Rule 1: Parent Portal - Grade Published
const gradePublishedRule = new events.Rule(this, 'GradePublishedRule', {
  eventBus: eventBus,
  eventPattern: {
    source: ['edforge.assessment-service'],
    detailType: ['GradePublished']
  },
  targets: [
    new targets.LambdaFunction(parentPortalHandler, {
      deadLetterQueue: dlqQueue
    })
  ]
});

// Rule 2: Analytics - All Events
const analyticsRule = new events.Rule(this, 'AnalyticsAllEventsRule', {
  eventBus: eventBus,
  eventPattern: {
    source: [
      'edforge.school-service',
      'edforge.enrollment-service',
      'edforge.curriculum-service',
      'edforge.assessment-service',
      'edforge.attendance-service',
      'edforge.finance-service',
      'edforge.staff-service',
      'edforge.parent-portal-service'
    ]
  },
  targets: [
    new targets.KinesisFirehoseStream(firehoseStream, {
      deadLetterQueue: analyticsDlq
    })
  ]
});
```

### 5.3 Target Configuration

**Lambda Targets:**
- **Function**: `parent-portal-notification-handler`
- **Timeout**: 30 seconds
- **Memory**: 256 MB
- **DLQ**: SQS queue
- **Retry Policy**: 3 attempts

**Kinesis Firehose Targets:**
- **Stream**: `edforge-events-stream`
- **Buffer Size**: 5 MB or 60 seconds
- **Compression**: GZIP
- **Format**: Parquet
- **DLQ**: SQS queue

**S3 Archive Targets:**
- **Bucket**: `edforge-event-archive`
- **Prefix**: `events/year=YYYY/month=MM/day=DD/`
- **Format**: JSON (one event per file)
- **Lifecycle**: Move to Glacier after 90 days

### 5.4 DLQ Setup and Retry Policies

**DLQ Configuration:**

**Parent Portal DLQ:**
```typescript
const parentPortalDlq = new sqs.Queue(this, 'ParentPortalDlq', {
  queueName: 'parent-portal-dlq',
  retentionPeriod: Duration.days(14),
  visibilityTimeout: Duration.seconds(30)
});
```

**Analytics Firehose DLQ:**
```typescript
const analyticsDlq = new sqs.Queue(this, 'AnalyticsDlq', {
  queueName: 'analytics-firehose-dlq',
  retentionPeriod: Duration.days(14)
});
```

**Retry Policies:**

**Lambda Retry:**
- **Max Attempts**: 3
- **Backoff**: Exponential (1s, 2s, 4s)
- **After Max Attempts**: Send to DLQ

**Firehose Retry:**
- **Max Attempts**: 3
- **Backoff**: Exponential
- **After Max Attempts**: Send to DLQ

### 5.5 Event Archiving (S3)

**Archive Configuration:**
- **Bucket**: `edforge-event-archive-{tier}`
- **Prefix**: `events/year=YYYY/month=MM/day=DD/`
- **Format**: JSON (one event per file)
- **Naming**: `{eventId}.json`

**Lifecycle Policy:**
- **Standard**: 90 days
- **Glacier**: 90-365 days
- **Deep Archive**: 365+ days

**Archive Structure:**
```
s3://edforge-event-archive/
├── events/
│   ├── year=2025/
│   │   ├── month=01/
│   │   │   ├── day=21/
│   │   │   │   ├── abc-123-def-456.json
│   │   │   │   ├── ghi-789-jkl-012.json
│   │   │   │   └── ...
```

---

## 6. Event Processing Patterns

### 6.1 Synchronous vs Asynchronous Processing

**Synchronous Processing (Current):**
- Event publishing is async (non-blocking)
- Event consumption is async (Lambda, Firehose)
- No synchronous event processing

**Asynchronous Processing (Standard):**
- All event processing is async
- Services don't wait for event processing
- Eventual consistency model

**Future: Synchronous Processing (If Needed):**
- Use SQS for synchronous processing
- Service waits for event processing confirmation
- Use for critical workflows

### 6.2 Event Ordering Guarantees

**Current: No Ordering Guarantees**
- Events processed in order received (best effort)
- No strict ordering across events
- No ordering across tenants

**Future: Ordered Processing (If Needed):**
- Use EventBridge custom event bus with ordering
- Partition events by tenant or entity
- Process events in order within partition

### 6.3 Idempotency Handling

**Idempotency Strategy:**

**Event ID:**
- Each event has unique ID from EventBridge
- Use event ID for idempotency checks

**Idempotency Key:**
- Add `idempotencyKey` to event payload
- Store processed event IDs in DynamoDB
- Check before processing event

**Implementation:**
```typescript
async function handler(event: EventBridgeEvent) {
  const eventId = event.id;
  
  // Check if event already processed
  const processed = await dynamoDB.get({
    Key: { eventId }
  });
  
  if (processed) {
    return; // Already processed, skip
  }
  
  // Process event
  await processEvent(event.detail);
  
  // Mark as processed
  await dynamoDB.put({
    Key: { eventId },
    TTL: Date.now() + 86400000 // 24 hours
  });
}
```

### 6.4 Event Deduplication

**Deduplication Strategy:**

**EventBridge Deduplication:**
- EventBridge automatically deduplicates events within 5 minutes
- Based on event content hash

**Application-Level Deduplication:**
- Store processed event IDs
- Check before processing
- TTL: 24 hours

### 6.5 Event Replay Capabilities

**Event Replay Process:**

1. **Identify Events to Replay:**
   - Query S3 archive for events
   - Filter by date range, event type, tenant

2. **Replay Events:**
   - Publish events back to EventBridge
   - Use original event payload
   - Update timestamp to current time

3. **Replay Tools:**
   - AWS CLI script
   - Lambda function for replay
   - Manual replay via console

**Replay Example:**
```bash
# Query archived events
aws s3 ls s3://edforge-event-archive/events/year=2025/month=01/day=21/

# Replay event
aws events put-events \
  --entries file://event.json \
  --event-bus-name controlplanestackcontrolplanesbtEventManagerSbtEventBus1E602009
```

---

## 7. Monitoring and Observability

### 7.1 CloudWatch Metrics

**Custom Metrics:**

**Events Published:**
- Metric: `EventsPublished`
- Dimensions: `Service`, `EventType`, `TenantId`
- Unit: Count
- Period: 1 minute

**Events Consumed:**
- Metric: `EventsConsumed`
- Dimensions: `Consumer`, `EventType`, `TenantId`
- Unit: Count
- Period: 1 minute

**Event Processing Latency:**
- Metric: `EventProcessingLatency`
- Dimensions: `Consumer`, `EventType`
- Unit: Milliseconds
- Period: 1 minute
- Statistic: Average, p95, p99

**Failed Events:**
- Metric: `FailedEvents`
- Dimensions: `Service`, `EventType`, `ErrorType`
- Unit: Count
- Period: 1 minute

**DLQ Messages:**
- Metric: `DLQMessageCount`
- Dimensions: `DLQName`
- Unit: Count
- Period: 1 minute

### 7.2 CloudWatch Alarms

**Critical Alarms:**

**High Failed Event Rate:**
```typescript
new cloudwatch.Alarm(this, 'HighFailedEventRate', {
  metric: failedEventsMetric,
  threshold: 10,
  evaluationPeriods: 2,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
  alarmDescription: 'High failed event rate detected'
});
```

**DLQ Messages:**
```typescript
new cloudwatch.Alarm(this, 'DLQMessages', {
  metric: dlqMessageCountMetric,
  threshold: 10,
  evaluationPeriods: 1,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
  alarmDescription: 'DLQ messages detected'
});
```

**Event Processing Latency:**
```typescript
new cloudwatch.Alarm(this, 'HighEventProcessingLatency', {
  metric: eventProcessingLatencyMetric,
  threshold: 5000, // 5 seconds
  evaluationPeriods: 2,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
  alarmDescription: 'High event processing latency'
});
```

### 7.3 CloudWatch Dashboards

**Event Volume Dashboard:**
- Events published per service (line chart)
- Events consumed per consumer (line chart)
- Event type distribution (pie chart)
- Failed events (bar chart)

**Event Processing Dashboard:**
- Processing latency (line chart)
- Processing success rate (gauge)
- DLQ message count (line chart)
- Consumer health (status widget)

**Error Rate Dashboard:**
- Failed events by service (bar chart)
- Failed events by event type (bar chart)
- Error types (pie chart)
- Error trends (line chart)

### 7.4 Event Tracing (X-Ray)

**X-Ray Integration:**
- Enable X-Ray for Lambda functions
- Trace event processing
- Trace inter-service calls triggered by events

**X-Ray Segments:**
- Event publishing segment
- Event routing segment
- Event processing segment
- Notification delivery segment

### 7.5 Event Delivery Monitoring

**Delivery Metrics:**
- Events delivered to Lambda
- Events delivered to Firehose
- Events archived to S3
- Events failed to deliver

**Delivery Status:**
- Success rate per target
- Failure rate per target
- Retry count per event
- DLQ message count

---

## 8. Security and Compliance

### 8.1 Event Encryption

**Encryption at Rest:**
- S3 data lake: SSE-S3 (default)
- S3 archive: SSE-S3 (default)
- DynamoDB: AWS managed keys (default)
- Future: KMS encryption for sensitive events

**Encryption in Transit:**
- EventBridge: TLS 1.2+ (automatic)
- Lambda: TLS 1.2+ (automatic)
- Firehose: TLS 1.2+ (automatic)

### 8.2 Tenant Isolation in Events

**Tenant Isolation Strategy:**
- All events include `tenantId` field
- EventBridge rules filter by `tenantId` (future)
- Consumers validate `tenantId` before processing
- S3 data lake partitioned by `tenantId` (future)

**Event Filtering by Tenant:**
```json
{
  "detail": {
    "tenantId": ["tenant-123"]
  }
}
```

### 8.3 Event Access Control

**IAM Policies:**

**Event Publishing:**
```json
{
  "Effect": "Allow",
  "Action": [
    "events:PutEvents"
  ],
  "Resource": "arn:aws:events:us-east-1:123456789012:event-bus/controlplanestackcontrolplanesbtEventManagerSbtEventBus1E602009"
}
```

**Event Consumption:**
```json
{
  "Effect": "Allow",
  "Action": [
    "events:DescribeRule",
    "events:ListTargetsByRule"
  ],
  "Resource": "arn:aws:events:us-east-1:123456789012:rule/*"
}
```

### 8.4 Audit Logging for Events

**Audit Log Requirements:**
- Log all events published
- Log all events consumed
- Log all event processing failures
- Log all DLQ messages
- Retain logs for 2 years (FERPA compliance)

**CloudWatch Logs:**
- All event publishing logged
- All event consumption logged
- All errors logged
- Structured JSON format

### 8.5 FERPA Compliance Considerations

**FERPA Requirements:**
- Student data encryption
- Access controls
- Audit trails
- Data retention policies

**Event Compliance:**
- Events containing student data encrypted
- Events access controlled
- Event processing audited
- Event archives retained per policy

---

## 9. Performance and Scalability

### 9.1 Event Throughput Capacity

**EventBridge Limits:**
- **Default**: 10,000 events/second per account
- **Request Increase**: Up to 1,000,000 events/second
- **Per Event Size**: 256 KB max

**Current Usage (Estimated):**
- **Peak**: ~1,000 events/second
- **Average**: ~500 events/second
- **Well Within Limits**: Yes

### 9.2 Latency Characteristics

**Event Publishing Latency:**
- **P50**: ~10ms
- **P95**: ~20ms
- **P99**: ~50ms

**Event Processing Latency:**
- **Lambda**: ~100-500ms (depends on processing)
- **Firehose**: ~60 seconds (buffer time)
- **S3 Archive**: ~100ms

**Total End-to-End Latency:**
- **Event Published → Lambda Processed**: ~110-510ms
- **Event Published → S3 Data Lake**: ~60 seconds (buffered)

### 9.3 Scaling Strategies

**Horizontal Scaling:**
- EventBridge auto-scales (no configuration needed)
- Lambda auto-scales (concurrency limits)
- Firehose auto-scales (no configuration needed)

**Vertical Scaling:**
- Increase Lambda memory (if needed)
- Increase Firehose buffer size (if needed)

**Cost Optimization:**
- Batch events where possible
- Use Firehose buffering to reduce S3 PUT requests
- Archive old events to Glacier

### 9.4 Cost Optimization

**EventBridge Costs:**
- **First 1M events/month**: Free
- **Additional events**: $1.00 per million events
- **Current Monthly Cost**: ~$0.50 (estimated 1.5M events/month)

**Lambda Costs:**
- **Requests**: $0.20 per million requests
- **Compute**: $0.0000166667 per GB-second
- **Current Monthly Cost**: ~$5 (estimated)

**Firehose Costs:**
- **Data Ingestion**: $0.029 per GB
- **Data Delivery**: $0.029 per GB
- **Current Monthly Cost**: ~$10 (estimated 100 GB/month)

**Total Monthly Cost**: ~$15.50 (estimated)

### 9.5 Event Batching Strategies

**Current: No Batching**
- Events published individually
- One event per PutEvents call

**Future: Batching (If Needed):**
- Batch up to 10 events per PutEvents call
- Reduce API calls by 90%
- Reduce costs

**Batching Implementation:**
```typescript
// Batch events
const events = [event1, event2, ..., event10];
await eventService.publishEvents(events); // Batch publish
```

---

## 10. Event Examples and Use Cases

### 10.1 Student Enrollment Flow

**Flow:**
1. User creates student → `StudentCreated` event published
2. User enrolls student → `StudentEnrolled` event published
3. Enrollment Service calls Finance Service (HTTP) → Invoice created
4. Finance Service publishes `InvoiceGenerated` event
5. User enrolls student in classroom → `StudentEnrolledInClassroom` event published

**Events Published:**
- `StudentCreated`
- `StudentEnrolled`
- `InvoiceGenerated` (from Finance Service)
- `StudentEnrolledInClassroom`

**Event Consumers:**
- Analytics Service (all events)
- Parent Portal Service (`StudentEnrolled`, `InvoiceGenerated`)
- Curriculum Service (`StudentEnrolledInClassroom` - future)
- Attendance Service (`StudentEnrolledInClassroom` - future)

### 10.2 Grade Publishing Flow

**Flow:**
1. Teacher creates assignment → `AssignmentCreated` event published
2. Teacher publishes assignment → `AssignmentPublished` event published
3. Teacher grades assignment → `GradeCreated` event published
4. Teacher publishes grade → `GradePublished` event published
5. Parent Portal Lambda processes `GradePublished` → Sends email notification
6. Analytics Service processes `GradePublished` → Updates dashboard

**Events Published:**
- `AssignmentCreated`
- `AssignmentPublished`
- `GradeCreated`
- `GradePublished`

**Event Consumers:**
- Analytics Service (all events)
- Parent Portal Service (`GradePublished`)

### 10.3 Invoice Generation Flow

**Flow:**
1. Student enrolled → Enrollment Service calls Finance Service (HTTP)
2. Finance Service generates invoice → `InvoiceGenerated` event published
3. Parent Portal Lambda processes `InvoiceGenerated` → Sends email notification
4. Analytics Service processes `InvoiceGenerated` → Updates financial reports

**Events Published:**
- `InvoiceGenerated`

**Event Consumers:**
- Analytics Service
- Parent Portal Service

### 10.4 Analytics Data Pipeline

**Flow:**
1. Any service publishes event → EventBridge receives event
2. EventBridge rule routes to Firehose → Firehose buffers event
3. Firehose delivers to S3 → Event stored in Parquet format
4. Glue ETL job processes events → Materializes views
5. Athena queries materialized views → Returns dashboard data

**Events Processed:**
- All 62 events from all 8 services

**Data Flow:**
```
EventBridge → Firehose → S3 Data Lake → Glue ETL → Materialized Views → Athena → Analytics API
```

### 10.5 Notification Delivery Flow

**Flow:**
1. Event published (e.g., `GradePublished`)
2. EventBridge rule triggers Lambda
3. Lambda gets parent preferences
4. Lambda sends email via SES
5. Lambda publishes `NotificationSent` event

**Events:**
- `GradePublished` (trigger)
- `NotificationSent` (result)

---

## 11. Troubleshooting Guide

### 11.1 Common Event Publishing Failures

**Issue: Event Not Published**

**Symptoms:**
- No event in EventBridge
- Error in service logs

**Causes:**
- Invalid event format
- Missing required fields
- EventBridge permissions
- Event size exceeds 256 KB

**Solutions:**
1. Check event format (validate against schema)
2. Check required fields (`eventType`, `timestamp`, `tenantId`)
3. Check IAM permissions for `events:PutEvents`
4. Reduce event payload size

**Issue: Event Published But Not Routed**

**Symptoms:**
- Event in EventBridge but not consumed
- No Lambda/Firehose processing

**Causes:**
- EventBridge rule not configured
- Rule pattern doesn't match event
- Target (Lambda/Firehose) not configured
- Target disabled

**Solutions:**
1. Check EventBridge rules configuration
2. Verify rule pattern matches event
3. Check target configuration
4. Verify target is enabled

### 11.2 Event Delivery Issues

**Issue: Lambda Not Processing Events**

**Symptoms:**
- Events in EventBridge but Lambda not invoked
- No Lambda logs

**Causes:**
- Lambda function not configured as target
- Lambda function error
- Lambda concurrency limit reached
- Lambda timeout

**Solutions:**
1. Check Lambda function configuration
2. Check Lambda logs for errors
3. Check Lambda concurrency limits
4. Increase Lambda timeout if needed

**Issue: Firehose Not Delivering to S3**

**Symptoms:**
- Events in Firehose but not in S3
- No S3 objects created

**Causes:**
- Firehose delivery stream error
- S3 permissions
- Firehose buffer not full (waiting for buffer)

**Solutions:**
1. Check Firehose delivery stream status
2. Check S3 bucket permissions
3. Wait for buffer to fill (60 seconds or 5 MB)
4. Check Firehose logs

### 11.3 Event Consumption Errors

**Issue: Lambda Processing Errors**

**Symptoms:**
- Lambda errors in logs
- Events in DLQ

**Causes:**
- Lambda code errors
- External service unavailable (SES, DynamoDB)
- Invalid event payload
- Timeout

**Solutions:**
1. Check Lambda logs for errors
2. Check external service availability
3. Validate event payload
4. Increase Lambda timeout
5. Review DLQ messages

**Issue: Duplicate Event Processing**

**Symptoms:**
- Same event processed multiple times
- Duplicate notifications sent

**Causes:**
- No idempotency handling
- Event replay
- EventBridge retry

**Solutions:**
1. Implement idempotency checks
2. Store processed event IDs
3. Check event IDs before processing

### 11.4 Debugging Event Flows

**Step 1: Verify Event Published**
```bash
# Check CloudWatch logs for event publishing
aws logs tail /aws/lambda/school-service --follow

# Check EventBridge for event
aws events list-rules --event-bus-name controlplanestackcontrolplanesbtEventManagerSbtEventBus1E602009
```

**Step 2: Verify Event Routed**
```bash
# Check EventBridge rule targets
aws events list-targets-by-rule --rule parent-portal-grade-published

# Check rule pattern
aws events describe-rule --name parent-portal-grade-published
```

**Step 3: Verify Event Processed**
```bash
# Check Lambda logs
aws logs tail /aws/lambda/parent-portal-notification-handler --follow

# Check Lambda metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=parent-portal-notification-handler
```

**Step 4: Verify Event Delivered**
```bash
# Check S3 data lake
aws s3 ls s3://edforge-data-lake/events/assessment-service/year=2025/month=01/day=21/

# Check Firehose delivery
aws firehose describe-delivery-stream --delivery-stream-name edforge-events-stream
```

### 11.5 Event Replay Procedures

**Replay Single Event:**
```bash
# Get event from S3 archive
aws s3 cp s3://edforge-event-archive/events/year=2025/month=01/day=21/abc-123.json event.json

# Replay event
aws events put-events \
  --entries file://event.json \
  --event-bus-name controlplanestackcontrolplanesbtEventManagerSbtEventBus1E602009
```

**Replay Multiple Events:**
```bash
# List events to replay
aws s3 ls s3://edforge-event-archive/events/year=2025/month=01/day=21/ --recursive

# Replay all events (script)
for event in $(aws s3 ls s3://edforge-event-archive/events/year=2025/month=01/day=21/ --recursive | awk '{print $4}'); do
  aws s3 cp s3://edforge-event-archive/$event event.json
  aws events put-events --entries file://event.json --event-bus-name controlplanestackcontrolplanesbtEventManagerSbtEventBus1E602009
done
```

**Replay Events by Type:**
```bash
# Query S3 for specific event type
aws s3api list-objects-v2 \
  --bucket edforge-event-archive \
  --prefix events/year=2025/month=01/day=21/ \
  --query "Contents[?contains(Key, 'GradePublished')]"

# Replay filtered events
# (Use script above with filtering)
```

---

## 12. Best Practices and Anti-Patterns

### 12.1 Best Practices

**Event Design:**
- ✅ Use past tense for event names (`StudentEnrolled`, not `EnrollStudent`)
- ✅ Include all necessary context in event payload
- ✅ Keep event payloads small (< 10 KB when possible)
- ✅ Use consistent field names across events
- ✅ Include `tenantId` in all events

**Event Publishing:**
- ✅ Publish events after successful database operations
- ✅ Don't block main operation on event publishing
- ✅ Handle event publishing errors gracefully
- ✅ Log all event publishing attempts
- ✅ Use batch publishing when possible

**Event Consumption:**
- ✅ Implement idempotency checks
- ✅ Handle errors gracefully
- ✅ Use DLQ for failed events
- ✅ Log all event processing
- ✅ Validate event payloads

**Event Monitoring:**
- ✅ Monitor event publishing rates
- ✅ Monitor event processing latency
- ✅ Monitor failed events
- ✅ Set up alarms for critical failures
- ✅ Review DLQ regularly

### 12.2 Anti-Patterns

**Event Design:**
- ❌ Don't use present tense for event names (`EnrollStudent`)
- ❌ Don't include sensitive data in events (PII, passwords)
- ❌ Don't make events too large (> 100 KB)
- ❌ Don't use inconsistent field names
- ❌ Don't forget `tenantId` in events

**Event Publishing:**
- ❌ Don't publish events before database operations
- ❌ Don't block main operation on event publishing
- ❌ Don't ignore event publishing errors
- ❌ Don't publish events without logging
- ❌ Don't publish duplicate events

**Event Consumption:**
- ❌ Don't process events without idempotency checks
- ❌ Don't ignore errors
- ❌ Don't skip DLQ configuration
- ❌ Don't process events without validation
- ❌ Don't process events synchronously (unless required)

**Event Monitoring:**
- ❌ Don't ignore event publishing failures
- ❌ Don't ignore DLQ messages
- ❌ Don't skip monitoring setup
- ❌ Don't ignore performance issues

---

## Conclusion

The EdForge event-driven architecture provides a scalable, resilient, and cost-effective foundation for microservices communication. By leveraging AWS EventBridge, Lambda, and Kinesis Firehose, we achieve loose coupling, high availability, and enterprise-grade reliability.

**Key Achievements:**
- ✅ 62 unique events across 9 services
- ✅ Event-driven notifications (Parent Portal)
- ✅ Event-driven analytics (Analytics Service)
- ✅ Comprehensive monitoring and alerting
- ✅ Security and compliance ready

**Future Enhancements:**
- Event schema registry
- Event versioning
- Ordered event processing
- Multi-region event replication
- Real-time event streaming

---

**Last Updated:** 2025-01-21  
**Maintained By:** Architecture Team  
**Review Cycle:** Quarterly

