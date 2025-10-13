# School Service: Architecture Diagrams

## System Context Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          EdForge Platform                                │
│                                                                           │
│  ┌────────────────┐         ┌────────────────┐         ┌──────────────┐│
│  │  Admin Web     │         │  Application   │         │   Control    ││
│  │  (Provider)    │◄────────┤     Web        │◄────────┤    Plane     ││
│  │  Console       │         │   (Tenant)     │         │    (SBT)     ││
│  └────────────────┘         └────────────────┘         └──────────────┘│
│         │                           │                          │         │
│         │                           │                          │         │
│         └───────────────┬───────────┴──────────────────────────┘         │
│                         │                                                │
│                  ┌──────▼──────────┐                                     │
│                  │   API Gateway   │                                     │
│                  │   (ALB + APIG)  │                                     │
│                  └──────┬──────────┘                                     │
│                         │                                                │
│         ┌───────────────┼───────────────────────────────┐               │
│         │               │               │               │               │
│  ┌──────▼──────┐ ┌─────▼─────┐ ┌──────▼──────┐ ┌──────▼──────┐       │
│  │   School    │ │  Student  │ │    Staff    │ │   Academic  │       │
│  │   Service   │ │  Service  │ │   Service   │ │   Service   │       │
│  │   (This)    │ │ (Future)  │ │  (Future)   │ │  (Future)   │       │
│  └──────┬──────┘ └─────┬─────┘ └──────┬──────┘ └──────┬──────┘       │
│         │               │               │               │               │
│         └───────────────┼───────────────┴───────────────┘               │
│                         │                                                │
│                  ┌──────▼──────────┐                                     │
│                  │   EventBridge   │                                     │
│                  │  (Event Bus)    │                                     │
│                  └─────────────────┘                                     │
│                                                                           │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                    Data Layer                                       │ │
│  │                                                                     │ │
│  │  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌───────────┐  │ │
│  │  │ DynamoDB │    │  Redis   │    │ S3 Glacier│    │ CloudWatch│  │ │
│  │  │ (Primary)│    │ (Cache)  │    │ (Archive) │    │  (Logs)   │  │ │
│  │  └──────────┘    └──────────┘    └──────────┘    └───────────┘  │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## School Service Internal Architecture

```
┌───────────────────────────────────────────────────────────────────────────┐
│                         School Service                                     │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                        Controllers (REST API)                        │  │
│  │                                                                       │  │
│  │  SchoolsController  │  DepartmentsController  │  AcademicController │  │
│  │  - CRUD operations  │  - Dept management     │  - Year management  │  │
│  │  - Authentication   │  - Budget tracking     │  - Calendar ops     │  │
│  │  - Authorization    │  - Staff assignments   │  - Period mgmt      │  │
│  └───────┬─────────────┴─────────────┬───────────┴──────────┬──────────┘  │
│          │                           │                      │              │
│  ┌───────▼───────────────────────────▼──────────────────────▼──────────┐  │
│  │                           Service Layer                             │  │
│  │                                                                      │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │  │
│  │  │   Schools    │  │  Academic    │  │  Departments │            │  │
│  │  │   Service    │  │    Year      │  │   Service    │            │  │
│  │  │              │  │   Service    │  │              │            │  │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘            │  │
│  │         │                  │                  │                     │  │
│  │         └──────────────────┼──────────────────┘                     │  │
│  │                            │                                        │  │
│  └────────────────────────────┼────────────────────────────────────────┘  │
│                               │                                            │
│  ┌────────────────────────────┼────────────────────────────────────────┐  │
│  │                      Support Services                              │  │
│  │                            │                                        │  │
│  │  ┌────────────┐  ┌─────────▼─────┐  ┌──────────────┐            │  │
│  │  │ Validation │  │  AuditLog     │  │    Event     │            │  │
│  │  │  Service   │  │   Service     │  │   Service    │            │  │
│  │  └────────────┘  └───────────────┘  └──────────────┘            │  │
│  │                                                                    │  │
│  │  ┌────────────┐  ┌───────────────┐  ┌──────────────┐            │  │
│  │  │   Cache    │  │   Repository  │  │  ClientFactory│            │  │
│  │  │  Service   │  │    Layer      │  │   (DynamoDB) │            │  │
│  │  └────────────┘  └───────────────┘  └──────────────┘            │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                               │                                            │
│  ┌────────────────────────────┼────────────────────────────────────────┐  │
│  │                      Data Access Layer                             │  │
│  │                            │                                        │  │
│  │         ┌──────────────────┼──────────────────┐                    │  │
│  │         │                  │                  │                    │  │
│  │  ┌──────▼──────┐  ┌────────▼────────┐  ┌─────▼──────┐           │  │
│  │  │  DynamoDB   │  │     Redis       │  │ EventBridge│           │  │
│  │  │  (Primary)  │  │    (Cache)      │  │  (Events)  │           │  │
│  │  └─────────────┘  └─────────────────┘  └────────────┘           │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Diagram

### Create School Flow

```
┌─────────┐         ┌────────────┐         ┌─────────────┐
│ Client  │────1───>│ Controller │────2───>│  Validation │
│         │         │   (REST)   │         │   Service   │
└─────────┘         └────────────┘         └─────┬───────┘
                          │                      │
                          │                  3.✓ Valid
                          │                      │
                          │         ┌────────────▼────────┐
                          │         │   Schools Service   │
                          │         │                     │
                          │         │ 4. Generate UUID    │
                          │         │ 5. Create Entity    │
                          │         └──────────┬──────────┘
                          │                    │
                ┌─────────┴────────────────────┴─────────────┐
                │                                             │
         ┌──────▼──────┐                              ┌──────▼──────┐
         │  DynamoDB   │                              │  AuditLog   │
         │             │                              │   Service   │
         │ 6. Write    │                              │             │
         │   School    │                              │ 7. Log      │
         │   Record    │                              │   CREATE    │
         └─────────────┘                              └──────┬──────┘
                                                             │
                                                      ┌──────▼──────┐
                                                      │  DynamoDB   │
                                                      │             │
                                                      │ 8. Write    │
                                                      │   Activity  │
                                                      └─────────────┘
                                                             │
                                                      ┌──────▼──────┐
                                                      │ EventBridge │
                                                      │             │
                                                      │ 9. Publish  │
                                                      │  SchoolCreated
                                                      └─────────────┘
                                                             │
                                        ┌────────────────────┼────────────────┐
                                        │                    │                │
                                  ┌─────▼─────┐      ┌──────▼─────┐   ┌─────▼─────┐
                                  │  Student  │      │   Staff    │   │  Finance  │
                                  │  Service  │      │  Service   │   │  Service  │
                                  │           │      │            │   │           │
                                  │ 10. React │      │ 10. React  │   │ 10. React │
                                  └───────────┘      └────────────┘   └───────────┘
```

### Update School with Optimistic Locking

```
┌─────────┐         ┌────────────┐
│ Client  │────1───>│ Controller │
│         │         │   (REST)   │
└─────────┘         └─────┬──────┘
                          │
                          │ 2. Pass currentVersion
                          │
                    ┌─────▼──────────┐
                    │ Schools Service│
                    │                │
                    │ 3. Update with │
                    │   version check│
                    └─────┬──────────┘
                          │
                    ┌─────▼──────────┐
                    │   DynamoDB     │
                    │                │
                    │ 4. Conditional │
                    │   Write        │
                    │   IF version   │
                    │   = expected   │
                    └─────┬──────────┘
                          │
                ┌─────────┴─────────┐
                │                   │
          ✓ Version Match     ✗ Version Mismatch
                │                   │
         ┌──────▼──────┐     ┌──────▼──────────────┐
         │  Success    │     │ ConflictException   │
         │             │     │ "Data was modified  │
         │ 5. Return   │     │  by another user"   │
         │   updated   │     │                     │
         │   entity    │     │ 5. Return 409       │
         │   (v+1)     │     │    Conflict         │
         └─────────────┘     └─────────────────────┘
```

---

## DynamoDB Table Design

### Single Table Layout

```
┌────────────────────────────────────────────────────────────────────────┐
│                    school-table-{tier}                                  │
│                                                                          │
│  PK (Partition Key): tenantId                                          │
│  SK (Sort Key): entityKey                                              │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ PARTITION: tenant-123                                            │ │
│  │                                                                  │ │
│  │  SK: SCHOOL#school-456             entityType: SCHOOL           │ │
│  │  SK: SCHOOL#school-456#CONFIG      entityType: SCHOOL_CONFIG    │ │
│  │  SK: SCHOOL#school-456#METADATA    entityType: SCHOOL_METADATA  │ │
│  │                                                                  │ │
│  │  SK: SCHOOL#school-456#YEAR#year1  entityType: ACADEMIC_YEAR    │ │
│  │  SK: SCHOOL#school-456#YEAR#year2  entityType: ACADEMIC_YEAR    │ │
│  │                                                                  │ │
│  │  SK: SCHOOL#school-456#YEAR#year1#PERIOD#p1  entityType: PERIOD│ │
│  │  SK: SCHOOL#school-456#YEAR#year1#PERIOD#p2  entityType: PERIOD│ │
│  │                                                                  │ │
│  │  SK: SCHOOL#school-456#DEPT#dept1  entityType: DEPARTMENT       │ │
│  │  SK: SCHOOL#school-456#DEPT#dept2  entityType: DEPARTMENT       │ │
│  │                                                                  │ │
│  │  SK: LOG#school-456#2025-10-10T...  entityType: ACTIVITY_LOG   │ │
│  │  SK: LOG#school-456#2025-10-10T...  entityType: ACTIVITY_LOG   │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

### GSI1: School Index

```
┌────────────────────────────────────────────────────────────────────────┐
│                         GSI1: School Index                              │
│                                                                          │
│  PK: schoolId                                                           │
│  SK: entityType#entityId                                               │
│                                                                          │
│  Purpose: Query all entities for a specific school                     │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ PARTITION: school-456                                            │ │
│  │                                                                  │ │
│  │  SK: METADATA#school-456                                        │ │
│  │  SK: CONFIG#current                                             │ │
│  │  SK: YEAR#year1                                                 │ │
│  │  SK: YEAR#year2                                                 │ │
│  │  SK: DEPT#dept1                                                 │ │
│  │  SK: DEPT#dept2                                                 │ │
│  │  SK: GRADE#grade1                                               │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  Query Examples:                                                        │
│  - Get all departments: begins_with(SK, "DEPT#")                       │
│  - Get all years: begins_with(SK, "YEAR#")                             │
│  - Get config: SK = "CONFIG#current"                                   │
└────────────────────────────────────────────────────────────────────────┘
```

### GSI2: Academic Year Index

```
┌────────────────────────────────────────────────────────────────────────┐
│                    GSI2: Academic Year Index                            │
│                                                                          │
│  PK: schoolId#academicYearId                                           │
│  SK: entityType#entityId                                               │
│                                                                          │
│  Purpose: Query all entities scoped to an academic year                │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ PARTITION: school-456#year1                                      │ │
│  │                                                                  │ │
│  │  SK: PERIOD#period1                                             │ │
│  │  SK: PERIOD#period2                                             │ │
│  │  SK: HOLIDAY#holiday1                                           │ │
│  │  SK: CAPACITY#grade1                                            │ │
│  │  SK: CAPACITY#grade2                                            │ │
│  │  SK: DEPT#dept1#BUDGET                                          │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  Query Examples:                                                        │
│  - Get grading periods: begins_with(SK, "PERIOD#")                     │
│  - Get holidays: begins_with(SK, "HOLIDAY#")                           │
│  - Get enrollment capacity: begins_with(SK, "CAPACITY#")               │
│  - Get dept budgets: begins_with(SK, "DEPT#") + contains("BUDGET")     │
└────────────────────────────────────────────────────────────────────────┘
```

### GSI4: Activity Log Index (Time-Series)

```
┌────────────────────────────────────────────────────────────────────────┐
│                    GSI4: Activity Log Index                             │
│                                                                          │
│  PK: schoolId#date (YYYY-MM-DD)                                        │
│  SK: timestamp#activityId                                              │
│                                                                          │
│  Purpose: Query audit logs by date for compliance reporting            │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ PARTITION: school-456#2025-10-10                                 │ │
│  │                                                                  │ │
│  │  SK: 2025-10-10T08:30:15.123Z#log1                              │ │
│  │  SK: 2025-10-10T09:45:22.456Z#log2                              │ │
│  │  SK: 2025-10-10T14:20:33.789Z#log3                              │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  Features:                                                              │
│  - Time-series optimized (partitioned by date)                         │
│  - TTL enabled (2 years for FERPA)                                     │
│  - Efficient date range queries                                        │
│  - Automatic archival to S3 Glacier                                    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Event Flow Diagram

### Event-Driven Cross-Service Coordination

```
┌──────────────────────────────────────────────────────────────────────┐
│                      EventBridge Event Bus                            │
│                        (edforge-events)                               │
└────────┬──────────────────────────────────────────────────┬──────────┘
         │                                                   │
         │ Subscribe                                  Publish│
         │                                                   │
┌────────▼─────────────────────┐               ┌────────────▼─────────┐
│    School Service            │               │   Other Services     │
│                              │               │                      │
│  Events Published:           │               │  Student Service     │
│  - SchoolCreated             │               │  - StudentEnrolled   │
│  - SchoolUpdated             │               │  - StudentWithdrew   │
│  - AcademicYearStarted       │               │                      │
│  - AcademicYearEnded         │               │  Staff Service       │
│  - DepartmentRestructured    │               │  - StaffAssigned     │
│  - EnrollmentCapacityChanged │               │  - StaffTerminated   │
│                              │               │                      │
│  Events Subscribed:          │               │  Finance Service     │
│  - StudentEnrolled           │               │  - PaymentReceived   │
│  - StudentWithdrew           │               │  - BudgetUpdated     │
│  - StaffAssigned             │               │                      │
│  - StaffTerminated           │               │  Academic Service    │
│  - PaymentReceived           │               │  - GradeSubmitted    │
│                              │               │  - AttendanceRecorded│
└──────────────────────────────┘               └──────────────────────┘

Event Flow Example: Student Enrollment

1. Student Service: Student enrolled
   └─> Publish: StudentEnrolledEvent
       {
         schoolId: "school-456",
         academicYearId: "year1",
         gradeLevelId: "grade9",
         studentId: "student-789"
       }

2. School Service: Receives event
   └─> Update enrollment capacity
   └─> If capacity > 90%, publish: EnrollmentCapacityWarningEvent

3. Academic Service: Receives SchoolCreated
   └─> Initialize grading books
   └─> Set up attendance tracking
```

---

## Caching Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                        Client Request                               │
└────────────────────────────┬───────────────────────────────────────┘
                             │
                     ┌───────▼────────┐
                     │   Controller   │
                     └───────┬────────┘
                             │
                     ┌───────▼────────┐
                     │   Service      │
                     └───────┬────────┘
                             │
                             │ 1. Check cache first
                             │
                     ┌───────▼────────┐
                     │  Cache Service │
                     │    (Redis)     │
                     └───────┬────────┘
                             │
                   ┌─────────┴─────────┐
                   │                   │
              Cache HIT           Cache MISS
                   │                   │
            ┌──────▼──────┐     ┌──────▼──────┐
            │  Return     │     │  Query      │
            │  Cached     │     │  DynamoDB   │
            │  Data       │     │             │
            └─────────────┘     └──────┬──────┘
                                       │
                                       │ 2. Fetch from DB
                                       │
                                ┌──────▼──────┐
                                │  Set Cache  │
                                │  with TTL   │
                                └──────┬──────┘
                                       │
                                ┌──────▼──────┐
                                │  Return     │
                                │  Data       │
                                └─────────────┘

Cache Invalidation on Events:

┌──────────────┐         ┌───────────────┐
│   Update     │────────>│  DynamoDB     │
│   Operation  │         │               │
└──────┬───────┘         └───────────────┘
       │
       │ 3. After successful write
       │
┌──────▼───────┐         ┌───────────────┐
│ Invalidate   │────────>│  Redis        │
│ Cache        │         │  (Delete Key) │
└──────────────┘         └───────────────┘

Cache Strategies:

┌────────────────────────────┬─────────┬─────────────────────┐
│ Data Type                  │   TTL   │ Invalidation        │
├────────────────────────────┼─────────┼─────────────────────┤
│ School Configuration       │ 1 hour  │ On config update    │
│ Current Academic Year      │ 24 hours│ On year change      │
│ Departments                │ 30 min  │ On dept CRUD        │
│ School Metadata            │ 1 hour  │ On metadata update  │
│ Enrollment Capacity        │ 5 min   │ On enrollment event │
└────────────────────────────┴─────────┴─────────────────────┘
```

---

## Audit Logging Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                  Every Mutation Operation                         │
│            (Create, Update, Delete, Status Change)               │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         │ Automatic Audit
                         │
                ┌────────▼────────┐
                │  AuditLog       │
                │  Service        │
                │                 │
                │ Capture:        │
                │ - Who (userId)  │
                │ - What (action) │
                │ - When (timestamp)
                │ - Where (IP)    │
                │ - Changes       │
                └────────┬────────┘
                         │
         ┌───────────────┴───────────────┐
         │                               │
┌────────▼────────┐             ┌────────▼────────┐
│   DynamoDB      │             │  CloudWatch     │
│   (Activity     │             │  Logs           │
│    Log Table)   │             │                 │
│                 │             │  Real-time      │
│ - 2 year TTL    │             │  Monitoring     │
│ - Immutable     │             └─────────────────┘
│ - Partitioned   │
│   by date       │
└────────┬────────┘
         │
         │ TTL Expires (2 years)
         │
┌────────▼────────┐
│  S3 Glacier     │
│                 │
│  Long-term      │
│  Archival       │
│  (7+ years)     │
└─────────────────┘

Compliance Report Generation:

1. Query Activity Logs (date range)
   └─> GSI4: schoolId#date partition
   
2. Aggregate by:
   - Action type
   - User activity
   - Severity level
   - Compliance category
   
3. Generate Report:
   - Total activities
   - Action breakdown
   - User activity summary
   - FERPA compliance checklist
```

---

## Deployment Architecture (Multi-Tier)

### Basic Tier (Pooled Model)

```
┌───────────────────────────────────────────────────────────────┐
│                        Basic Tier                              │
│                   (Shared Resources)                           │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              ECS Cluster (Shared)                       │  │
│  │                                                          │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐            │  │
│  │  │  School  │  │ Student  │  │  Staff   │            │  │
│  │  │ Service  │  │ Service  │  │ Service  │            │  │
│  │  │ (x2)     │  │ (x2)     │  │ (x2)     │            │  │
│  │  └─────┬────┘  └─────┬────┘  └─────┬────┘            │  │
│  └────────┼─────────────┼─────────────┼──────────────────┘  │
│           │             │             │                      │
│  ┌────────▼─────────────▼─────────────▼──────────────────┐  │
│  │           DynamoDB (Pooled)                           │  │
│  │                                                        │  │
│  │  Table: school-table-basic                           │  │
│  │  - Tenant isolation via IAM LeadingKeys              │  │
│  │  - Shared across all Basic tenants                   │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌────────────────────────────────────────────────────────┐  │
│  │        ElastiCache Redis (Shared)                     │  │
│  └────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘

Cost: ~$150/month for 100 tenants
```

### Advanced Tier (Dedicated Services, Shared Cluster)

```
┌───────────────────────────────────────────────────────────────┐
│                      Advanced Tier                             │
│              (Dedicated Services per Tenant)                   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │          ECS Cluster (Shared Compute)                   │  │
│  │                                                          │  │
│  │  Tenant A:                                              │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐            │  │
│  │  │  School  │  │ Student  │  │  Staff   │            │  │
│  │  │ Service  │  │ Service  │  │ Service  │            │  │
│  │  └─────┬────┘  └─────┬────┘  └─────┬────┘            │  │
│  │        │             │             │                   │  │
│  │  ┌─────▼─────────────▼─────────────▼──────┐          │  │
│  │  │  DynamoDB: school-table-tenant-A        │          │  │
│  │  │  (Dedicated table)                      │          │  │
│  │  └─────────────────────────────────────────┘          │  │
│  │                                                         │  │
│  │  Tenant B:                                             │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐            │  │
│  │  │  School  │  │ Student  │  │  Staff   │            │  │
│  │  │ Service  │  │ Service  │  │ Service  │            │  │
│  │  └─────┬────┘  └─────┬────┘  └─────┬────┘            │  │
│  │        │             │             │                   │  │
│  │  ┌─────▼─────────────▼─────────────▼──────┐          │  │
│  │  │  DynamoDB: school-table-tenant-B        │          │  │
│  │  └─────────────────────────────────────────┘          │  │
│  └─────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌────────────────────────────────────────────────────────┐  │
│  │        ElastiCache Redis (Shared)                     │  │
│  └────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘

Cost: ~$500-1000/month per tenant
```

### Premium Tier (Fully Isolated)

```
┌───────────────────────────────────────────────────────────────┐
│                       Premium Tier                             │
│            (Dedicated Cluster per Tenant)                      │
│                                                                 │
│  Tenant Premium-1:                                             │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │          ECS Cluster (Dedicated)                        │  │
│  │                                                          │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐            │  │
│  │  │  School  │  │ Student  │  │  Staff   │            │  │
│  │  │ Service  │  │ Service  │  │ Service  │            │  │
│  │  └─────┬────┘  └─────┬────┘  └─────┬────┘            │  │
│  │        │             │             │                   │  │
│  │  ┌─────▼─────────────▼─────────────▼──────┐          │  │
│  │  │  DynamoDB: school-table-premium-1       │          │  │
│  │  │  (Dedicated table)                      │          │  │
│  │  └─────────────────────────────────────────┘          │  │
│  │                                                         │  │
│  │  ┌────────────────────────────────────────────────┐   │  │
│  │  │  ElastiCache Redis (Dedicated)                │   │  │
│  │  └────────────────────────────────────────────────┘   │  │
│  └─────────────────────────────────────────────────────────┘│
│                                                                 │
│  Tenant Premium-2:                                             │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │          ECS Cluster (Dedicated)                        │  │
│  │          ... (same as Premium-1)                        │  │
│  └─────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘

Cost: ~$1000-2000/month per tenant
```

---

## Summary

These diagrams illustrate:

1. ✅ **System Context** - How School Service fits in EdForge platform
2. ✅ **Internal Architecture** - Layered service design
3. ✅ **Data Flow** - Request processing with optimistic locking
4. ✅ **DynamoDB Design** - Single-table with GSIs
5. ✅ **Event Flow** - Cross-service coordination
6. ✅ **Caching** - Performance optimization strategy
7. ✅ **Audit Logging** - FERPA compliance flow
8. ✅ **Multi-Tier Deployment** - Pooled, Bridge, Silo models

**Use these diagrams in:**
- Architecture reviews
- Team onboarding
- Documentation
- Presentations to stakeholders

---

*Document Version: 1.0*
*Created: October 10, 2025*
*Author: AI Assistant*

