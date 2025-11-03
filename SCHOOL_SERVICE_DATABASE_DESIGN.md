# School Service: Enterprise-Grade Database Design & Implementation Plan

## Executive Summary

This document outlines a comprehensive database architecture for the School Service microservice in the EdForge multi-tenant SaaS platform. The design prioritizes **data accuracy, security, auditability, and decision-making enablement** while maintaining scalability and compliance with educational data regulations (FERPA, data governance).

## Table of Contents

1. [Core Design Principles](#core-design-principles)
2. [Data Model Architecture](#data-model-architecture)
3. [DynamoDB Single-Table Design](#dynamodb-single-table-design)
4. [Entity Definitions](#entity-definitions)
5. [Access Patterns & Query Design](#access-patterns--query-design)
6. [Data Integrity & Validation Rules](#data-integrity--validation-rules)
7. [Audit & Compliance Strategy](#audit--compliance-strategy)
8. [Event-Driven Architecture](#event-driven-architecture)
9. [Performance & Scalability](#performance--scalability)
10. [Migration & Implementation Plan](#migration--implementation-plan)

---

## Core Design Principles

### 1. **Tenant Isolation First**
- Every entity MUST include `tenantId` as partition key
- Fine-grained IAM policies enforce row-level security
- No cross-tenant data leakage possible at infrastructure level

### 2. **Temporal Boundaries**
- Academic years define hard boundaries for all academic operations
- Historical data preserved with immutable records
- Support for year-end rollover and archival

### 3. **Data Integrity & Referential Consistency**
- Application-level foreign key enforcement
- Conditional writes prevent race conditions
- Optimistic locking for concurrent updates

### 4. **Audit Everything**
- Complete audit trail for compliance (FERPA requires 2-year retention)
- Track WHO, WHAT, WHEN, WHERE for every data change
- Immutable audit logs stored separately

### 5. **Decision-Making Enablement**
- Data structured for analytical queries
- Denormalization for read optimization
- Real-time metrics and aggregations

### 6. **Security & Compliance**
- PII handling with encryption at rest
- Access logs for sensitive operations
- Data retention policies enforced automatically

---

## Data Model Architecture

### High-Level Entity Relationships

```
Tenant (Control Plane)
  └── School (1:N)
       ├── SchoolMetadata (1:1)
       ├── SchoolConfiguration (1:1)
       ├── AcademicYear (1:N)
       │    ├── GradingPeriod (1:N)
       │    └── Holiday (1:N)
       ├── Department (1:N)
       │    ├── DepartmentBudget (1:N) [per academic year]
       │    └── DepartmentStaff (N:M) [through assignments]
       ├── Grade Level (1:N)
       ├── Enrollment Capacity (1:N) [per grade, per year]
       ├── Campus/Building (1:N)
       │    └── Classroom (1:N)
       └── School Activity Log (1:N) [time-series]
```

### Domain Boundaries

The School Service owns:
- ✅ School organizational structure
- ✅ Academic calendars and periods
- ✅ Department structure and budgets
- ✅ Campus/building/classroom management
- ✅ Enrollment capacity planning
- ✅ School configurations and settings
- ✅ Audit logs for school operations

The School Service **does NOT** own (other services):
- ❌ Students (Student Service)
- ❌ Staff/Teachers (Staff Service)
- ❌ Courses/Curriculum (Academic Service)
- ❌ Attendance/Grades (Academic Service)
- ❌ Fees/Payments (Finance Service)
- ❌ Users/Authentication (Control Plane)

---

## DynamoDB Single-Table Design

### Table Structure

**Table Name:** `school-table-{tier}` (e.g., `school-table-basic`, `school-table-advanced-{tenantId}`)

**Partition Key (PK):** `tenantId` (STRING)
**Sort Key (SK):** `entityKey` (STRING)

**Global Secondary Indexes (GSI):**

1. **GSI1** - School Index
   - PK: `schoolId`
   - SK: `entityType#entityId`
   - Use case: Query all entities for a specific school

2. **GSI2** - Academic Year Index
   - PK: `schoolId#academicYearId`
   - SK: `entityType#entityId`
   - Use case: Query data within an academic year context

3. **GSI3** - Status Index
   - PK: `tenantId#entityType`
   - SK: `status#createdAt`
   - Use case: Filter by status, pagination

4. **GSI4** - Activity Log Index (Time-series)
   - PK: `schoolId#date` (YYYY-MM-DD)
   - SK: `timestamp#activityId`
   - Use case: Audit log queries, compliance reporting
   - TTL: 2 years for FERPA compliance

### Entity Key Patterns

| Entity Type | PK | SK | GSI1-PK | GSI1-SK |
|-------------|----|----|---------|---------|
| School | `tenantId` | `SCHOOL#schoolId` | `schoolId` | `METADATA#schoolId` |
| School Metadata | `tenantId` | `SCHOOL#schoolId#METADATA` | `schoolId` | `METADATA#current` |
| School Config | `tenantId` | `SCHOOL#schoolId#CONFIG` | `schoolId` | `CONFIG#current` |
| Academic Year | `tenantId` | `SCHOOL#schoolId#YEAR#yearId` | `schoolId` | `YEAR#yearId` |
| Grading Period | `tenantId` | `SCHOOL#schoolId#YEAR#yearId#PERIOD#periodId` | `schoolId#yearId` | `PERIOD#periodId` |
| Holiday | `tenantId` | `SCHOOL#schoolId#YEAR#yearId#HOLIDAY#holidayId` | `schoolId#yearId` | `HOLIDAY#holidayId` |
| Department | `tenantId` | `SCHOOL#schoolId#DEPT#deptId` | `schoolId` | `DEPT#deptId` |
| Department Budget | `tenantId` | `SCHOOL#schoolId#DEPT#deptId#BUDGET#yearId` | `schoolId` | `DEPT#deptId#BUDGET#yearId` |
| Grade Level | `tenantId` | `SCHOOL#schoolId#GRADE#gradeId` | `schoolId` | `GRADE#gradeId` |
| Enrollment Capacity | `tenantId` | `SCHOOL#schoolId#CAPACITY#yearId#gradeId` | `schoolId#yearId` | `CAPACITY#gradeId` |
| Campus | `tenantId` | `SCHOOL#schoolId#CAMPUS#campusId` | `schoolId` | `CAMPUS#campusId` |
| Building | `tenantId` | `SCHOOL#schoolId#CAMPUS#campusId#BLDG#buildingId` | `schoolId` | `BLDG#buildingId` |
| Classroom | `tenantId` | `SCHOOL#schoolId#BLDG#buildingId#ROOM#roomId` | `schoolId` | `ROOM#roomId` |
| Activity Log | `tenantId` | `LOG#schoolId#timestamp#activityId` | `schoolId#date` | `timestamp#activityId` |

---

## Entity Definitions

### 1. School (Core Entity)

**Purpose:** Foundation entity representing an educational institution

```typescript
interface School {
  // Keys
  tenantId: string;
  schoolId: string; // UUID
  
  // Core Identity
  schoolName: string;
  schoolCode: string; // Unique within tenant (e.g., "MAIN-001")
  schoolType: 'elementary' | 'middle' | 'high' | 'k12' | 'alternative' | 'special';
  
  // Contact Information (structured)
  contactInfo: {
    primaryEmail: string;
    primaryPhone: string;
    secondaryPhone?: string;
    website?: string;
    fax?: string;
  };
  
  // Address (structured)
  address: {
    street: string;
    city: string;
    state: string;
    country: string;
    postalCode: string;
    latitude?: number;
    longitude?: number;
    timezone: string; // IANA timezone (e.g., "America/New_York")
  };
  
  // Administrative
  principalUserId?: string; // References Control Plane User Service
  vicePrincipalUserIds?: string[]; // Multiple VPs
  administrativeStaffCount?: number;
  
  // Capacity & Scale
  maxStudentCapacity: number; // Overall school capacity
  currentEnrollment?: number; // Denormalized for quick access
  gradeRange: {
    lowestGrade: string; // "K", "1", "2", etc.
    highestGrade: string;
  };
  
  // Operational
  status: 'active' | 'inactive' | 'suspended' | 'closed' | 'planned';
  statusReason?: string;
  accreditationInfo?: {
    accreditedBy: string[];
    accreditationExpiry?: string;
  };
  
  // Metadata
  foundedDate?: string; // ISO date
  description?: string;
  motto?: string;
  logoUrl?: string;
  
  // Audit
  createdAt: string; // ISO timestamp
  createdBy: string; // UserId
  updatedAt: string;
  updatedBy: string;
  version: number; // Optimistic locking
  
  // GSI fields
  entityType: 'SCHOOL';
  gsi1pk: string; // schoolId
  gsi1sk: string; // METADATA#schoolId
  gsi3pk: string; // tenantId#SCHOOL
  gsi3sk: string; // status#createdAt
}
```

**Business Rules:**
- `schoolCode` must be unique within tenant
- `status` transitions must be validated (can't go from 'closed' to 'active')
- `principalUserId` must reference valid user from User Service
- `timezone` required for all date/time operations
- `currentEnrollment` updated via event when students enroll/withdraw

**Validation:**
- School name: 3-255 characters
- School code: alphanumeric, 3-50 characters
- Email: valid format
- Phone: valid international format
- Capacity: 1-50,000 students
- Timezone: valid IANA timezone

---

### 2. School Metadata (Extended Attributes)

**Purpose:** Flexible storage for custom fields, integration settings, and non-core attributes

```typescript
interface SchoolMetadata {
  tenantId: string;
  schoolId: string;
  
  // Custom Fields (tenant-defined)
  customFields: {
    [key: string]: {
      value: any;
      dataType: 'string' | 'number' | 'boolean' | 'date' | 'json';
      label: string;
      category: string; // Group related fields
    };
  };
  
  // Integration Settings
  integrations: {
    sisSystem?: {
      provider: string;
      apiEndpoint?: string;
      syncEnabled: boolean;
      lastSyncAt?: string;
    };
    lmsSystem?: {
      provider: string;
      apiEndpoint?: string;
      syncEnabled: boolean;
    };
    paymentGateway?: {
      provider: string;
      merchantId?: string;
    };
  };
  
  // Preferences
  preferences: {
    language: string; // Primary language
    locale: string; // Regional settings
    currency: string; // ISO currency code
    dateFormat: string;
    timeFormat: '12h' | '24h';
  };
  
  // Tags for categorization
  tags: string[];
  
  // Audit
  createdAt: string;
  updatedAt: string;
  version: number;
  
  entityType: 'SCHOOL_METADATA';
}
```

---

### 3. School Configuration

**Purpose:** Operational parameters and feature flags per school

```typescript
interface SchoolConfiguration {
  tenantId: string;
  schoolId: string;
  
  // Academic Settings
  academicSettings: {
    gradingSystem: 'letter' | 'numeric' | 'percentage' | 'pass_fail' | 'custom';
    gradingScale?: {
      [grade: string]: { min: number; max: number };
    };
    passingGrade: number | string;
    maxAbsencesAllowed: number;
    promotionCriteria: {
      minimumAttendance: number; // percentage
      minimumGPA?: number;
      requiredCredits?: number;
    };
    reportCardFrequency: 'quarterly' | 'semester' | 'trimester' | 'custom';
  };
  
  // Attendance Settings
  attendanceSettings: {
    requiredAttendancePercentage: number;
    lateArrivalGraceMinutes: number;
    trackingMethod: 'period' | 'daily' | 'both';
    absenceTypes: Array<{
      code: string;
      label: string;
      excused: boolean;
    }>;
  };
  
  // Calendar Settings
  calendarSettings: {
    weekStart: 'sunday' | 'monday';
    schoolDaysPerWeek: number;
    instructionalMinutesPerDay: number;
    instructionalDaysRequired: number; // per year
    bellSchedules: Array<{
      name: string;
      type: 'regular' | 'early_dismissal' | 'late_start';
      periods: Array<{
        name: string;
        startTime: string; // HH:mm
        endTime: string;
      }>;
    }>;
  };
  
  // Communication Settings
  communicationSettings: {
    emailNotifications: {
      enabled: boolean;
      fromAddress?: string;
      replyToAddress?: string;
    };
    smsNotifications: {
      enabled: boolean;
      provider?: string;
    };
    pushNotifications: {
      enabled: boolean;
    };
    parentPortalEnabled: boolean;
  };
  
  // Security & Privacy
  securitySettings: {
    dataRetentionYears: number;
    exportEnabled: boolean;
    apiAccessEnabled: boolean;
    requireMFA: boolean;
    sessionTimeoutMinutes: number;
  };
  
  // Feature Flags
  featureFlags: {
    [featureName: string]: boolean;
  };
  
  // Audit
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
  
  entityType: 'SCHOOL_CONFIG';
}
```

---

### 4. Academic Year (Temporal Boundary)

**Purpose:** Defines the temporal scope for all academic operations

```typescript
interface AcademicYear {
  tenantId: string;
  schoolId: string;
  academicYearId: string; // UUID
  
  // Identity
  yearName: string; // e.g., "2024-2025"
  yearCode: string; // e.g., "2024-25", "AY24"
  
  // Temporal Boundaries
  startDate: string; // ISO date
  endDate: string; // ISO date
  
  // Status
  status: 'planned' | 'active' | 'completed' | 'archived';
  isCurrent: boolean; // Only ONE can be current per school
  
  // Academic Structure
  structure: {
    semesterCount: number;
    gradingPeriodCount: number;
    instructionalDays: number;
    schoolDays: number;
  };
  
  // Financial (for budget context)
  tuitionRates?: {
    [gradeLevel: string]: {
      amount: number;
      currency: string;
      frequency: 'annual' | 'semester' | 'monthly';
    };
  };
  
  // Enrollment Targets
  enrollmentTargets?: {
    total: number;
    byGrade: { [grade: string]: number };
  };
  
  // Audit
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
  
  // GSI
  entityType: 'ACADEMIC_YEAR';
  gsi1pk: string; // schoolId
  gsi1sk: string; // YEAR#yearId
  gsi2pk: string; // schoolId#academicYearId
}
```

**Business Rules:**
- Only ONE `isCurrent` per school at a time
- Start date must be before end date
- Cannot delete if enrollments exist
- Status transitions: planned → active → completed → archived
- Cannot modify dates if status is 'active' or 'completed'

---

### 5. Grading Period (Quarters, Semesters, Trimesters)

**Purpose:** Sub-divisions of the academic year

```typescript
interface GradingPeriod {
  tenantId: string;
  schoolId: string;
  academicYearId: string;
  gradingPeriodId: string; // UUID
  
  // Identity
  periodName: string; // "Fall Semester", "Q1", "Trimester 1"
  periodType: 'semester' | 'quarter' | 'trimester' | 'custom';
  periodNumber: number; // Sequence within year
  
  // Temporal
  startDate: string;
  endDate: string;
  
  // Status
  status: 'planned' | 'active' | 'completed';
  isCurrent: boolean;
  
  // Academic
  instructionalDays: number;
  gradesDueDate?: string; // When teachers must submit grades
  reportCardDate?: string; // When report cards are issued
  
  // Audit
  createdAt: string;
  updatedAt: string;
  version: number;
  
  entityType: 'GRADING_PERIOD';
  gsi2pk: string; // schoolId#academicYearId
  gsi2sk: string; // PERIOD#periodNumber
}
```

**Business Rules:**
- Must be within academic year boundaries
- Cannot overlap with other periods in same year
- Ordered by `periodNumber`
- Dates immutable once status is 'completed'

---

### 6. Holiday / School Closure

**Purpose:** Track non-instructional days

```typescript
interface Holiday {
  tenantId: string;
  schoolId: string;
  academicYearId: string;
  holidayId: string;
  
  // Identity
  name: string; // "Thanksgiving Break", "Winter Holiday"
  type: 'holiday' | 'professional_day' | 'weather_closure' | 'emergency';
  
  // Temporal
  startDate: string;
  endDate: string;
  allDay: boolean;
  
  // Details
  description?: string;
  isRecurring: boolean;
  recurrencePattern?: string; // cron-like or RRULE
  
  // Impact
  affectsAttendance: boolean;
  affectsPayroll: boolean;
  
  // Audit
  createdAt: string;
  updatedAt: string;
  
  entityType: 'HOLIDAY';
  gsi2pk: string; // schoolId#academicYearId
  gsi2sk: string; // HOLIDAY#startDate
}
```

---

### 7. Department

**Purpose:** Organizational units within schools

```typescript
interface Department {
  tenantId: string;
  schoolId: string;
  departmentId: string;
  
  // Identity
  departmentName: string; // "Mathematics", "Science", "English"
  departmentCode: string; // "MATH", "SCI", "ENG"
  category: 'academic' | 'administrative' | 'support' | 'athletic';
  
  // Leadership
  headOfDepartmentUserId?: string;
  assistantHeadUserId?: string;
  
  // Academic Scope
  academicScope: {
    gradeLevels: string[]; // Which grades this dept serves
    subjects: string[]; // Subject areas covered
    curriculumStandards: string[]; // e.g., "Common Core", "State Standards"
  };
  
  // Staffing
  staffing: {
    allocatedPositions: number;
    filledPositions: number; // Denormalized
    vacantPositions: number; // Calculated
  };
  
  // Resources
  resources: {
    facilities: Array<{
      type: 'lab' | 'office' | 'classroom' | 'storage';
      roomId: string;
    }>;
    equipment: Array<{
      category: string;
      quantity: number;
      description: string;
    }>;
  };
  
  // Status
  status: 'active' | 'inactive' | 'dissolved';
  
  // Audit
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
  
  entityType: 'DEPARTMENT';
  gsi1pk: string; // schoolId
  gsi1sk: string; // DEPT#departmentId
}
```

---

### 8. Department Budget

**Purpose:** Annual budget allocation per department

```typescript
interface DepartmentBudget {
  tenantId: string;
  schoolId: string;
  departmentId: string;
  academicYearId: string;
  budgetId: string;
  
  // Financial
  annualBudget: {
    amount: number;
    currency: string;
  };
  
  // Budget Categories
  allocations: Array<{
    category: 'salaries' | 'supplies' | 'equipment' | 'training' | 'other';
    allocated: number;
    spent: number; // Denormalized from Finance Service
    committed: number; // Encumbered funds
    available: number; // Calculated
  }>;
  
  // Expenditure Log (summary)
  expenditures: Array<{
    date: string;
    amount: number;
    category: string;
    description: string;
    referenceId?: string; // Link to Finance Service
  }>;
  
  // Status
  status: 'draft' | 'approved' | 'active' | 'closed';
  approvedBy?: string;
  approvedAt?: string;
  
  // Audit
  createdAt: string;
  updatedAt: string;
  version: number;
  
  entityType: 'DEPT_BUDGET';
  gsi2pk: string; // schoolId#academicYearId
  gsi2sk: string; // DEPT#departmentId#BUDGET
}
```

---

### 9. Grade Level

**Purpose:** Define grade levels and progression rules

```typescript
interface GradeLevel {
  tenantId: string;
  schoolId: string;
  gradeLevelId: string;
  
  // Identity
  gradeName: string; // "Kindergarten", "1st Grade", "9th Grade"
  gradeCode: string; // "K", "01", "09"
  gradeNumber: number; // 0 for K, 1-12
  
  // Classification
  division: 'elementary' | 'middle' | 'high';
  ageRange: {
    min: number;
    max: number;
  };
  
  // Capacity Planning
  capacityPerSection: number; // Max students per class
  targetSections: number; // How many sections planned
  maxCapacity: number; // Total capacity for grade
  
  // Academic Requirements
  requirements: {
    minimumCredits?: number; // For high school
    requiredCourses?: string[];
    electiveCredits?: number;
  };
  
  // Promotion Criteria
  promotionRules: {
    minimumAttendance: number;
    minimumGPA?: number;
    requiredAssessments?: string[];
    retentionPolicy: string; // Description of retention rules
  };
  
  // Status
  status: 'active' | 'inactive';
  
  // Audit
  createdAt: string;
  updatedAt: string;
  version: number;
  
  entityType: 'GRADE_LEVEL';
  gsi1pk: string; // schoolId
  gsi1sk: string; // GRADE#gradeNumber
}
```

---

### 10. Enrollment Capacity

**Purpose:** Track enrollment capacity and utilization per grade, per year

```typescript
interface EnrollmentCapacity {
  tenantId: string;
  schoolId: string;
  academicYearId: string;
  gradeLevelId: string;
  capacityId: string;
  
  // Capacity
  maxCapacity: number;
  currentEnrollment: number; // Denormalized from Student Service
  availableSeats: number; // Calculated
  waitlistCount: number; // Denormalized
  
  // Sections
  plannedSections: number;
  activeSections: number;
  studentsPerSection: number; // Average
  
  // Status
  acceptingEnrollment: boolean;
  waitlistEnabled: boolean;
  
  // Metrics
  utilizationRate: number; // Percentage
  projectedEnrollment?: number; // For planning
  
  // Audit
  createdAt: string;
  updatedAt: string;
  lastEnrollmentUpdate: string;
  
  entityType: 'ENROLLMENT_CAPACITY';
  gsi2pk: string; // schoolId#academicYearId
  gsi2sk: string; // CAPACITY#gradeLevelId
}
```

**Business Rules:**
- Updated via events from Student Service
- Alerts triggered when utilization > 90% or < 50%
- Cannot exceed `maxCapacity` without override approval

---

### 11. Campus

**Purpose:** Physical locations for multi-campus schools

```typescript
interface Campus {
  tenantId: string;
  schoolId: string;
  campusId: string;
  
  // Identity
  campusName: string;
  campusCode: string;
  
  // Location
  address: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    latitude?: number;
    longitude?: number;
  };
  
  // Details
  isPrimary: boolean; // Main campus
  capacity: number;
  squareFeet?: number;
  
  // Contact
  phone?: string;
  email?: string;
  
  // Status
  status: 'active' | 'inactive' | 'under_construction';
  
  // Audit
  createdAt: string;
  updatedAt: string;
  
  entityType: 'CAMPUS';
  gsi1pk: string; // schoolId
  gsi1sk: string; // CAMPUS#campusId
}
```

---

### 12. Building

**Purpose:** Buildings within a campus

```typescript
interface Building {
  tenantId: string;
  schoolId: string;
  campusId: string;
  buildingId: string;
  
  // Identity
  buildingName: string;
  buildingCode: string;
  
  // Details
  floors: number;
  roomCount: number;
  capacity: number;
  
  // Metadata
  yearBuilt?: number;
  lastRenovated?: string;
  
  // Facilities
  amenities: string[]; // ['elevator', 'wheelchair_accessible', 'cafeteria']
  
  // Status
  status: 'active' | 'inactive' | 'maintenance';
  
  // Audit
  createdAt: string;
  updatedAt: string;
  
  entityType: 'BUILDING';
  gsi1pk: string; // schoolId
  gsi1sk: string; // BLDG#buildingId
}
```

---

### 13. Classroom

**Purpose:** Individual rooms and their properties

```typescript
interface Classroom {
  tenantId: string;
  schoolId: string;
  buildingId: string;
  classroomId: string;
  
  // Identity
  roomNumber: string;
  roomName?: string;
  
  // Type
  roomType: 'standard' | 'lab' | 'gym' | 'auditorium' | 'library' | 'office' | 'other';
  
  // Capacity
  capacity: number;
  currentOccupancy?: number; // For scheduling
  
  // Features
  features: string[]; // ['smartboard', 'projector', 'computers', 'ac']
  squareFeet?: number;
  
  // Scheduling
  isSchedulable: boolean;
  restrictedUse?: string; // Description of restrictions
  
  // Status
  status: 'active' | 'inactive' | 'maintenance' | 'reserved';
  
  // Audit
  createdAt: string;
  updatedAt: string;
  
  entityType: 'CLASSROOM';
  gsi1pk: string; // schoolId
  gsi1sk: string; // ROOM#classroomId
}
```

---

### 14. School Activity Log (Audit Trail)

**Purpose:** Immutable audit log for compliance and monitoring

```typescript
interface SchoolActivityLog {
  tenantId: string;
  schoolId: string;
  activityId: string; // UUID
  
  // Temporal
  timestamp: string; // ISO with milliseconds
  date: string; // YYYY-MM-DD for partitioning
  
  // Actor
  userId: string;
  userRole: string;
  userName?: string;
  
  // Action
  action: string; // 'CREATE_SCHOOL', 'UPDATE_CONFIG', 'DELETE_DEPARTMENT'
  entityType: string; // 'SCHOOL', 'DEPARTMENT', 'ACADEMIC_YEAR'
  entityId: string;
  
  // Details
  changes?: {
    before: any;
    after: any;
  };
  description: string;
  
  // Context
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  
  // Severity (for security monitoring)
  severity: 'info' | 'warning' | 'error' | 'critical';
  
  // Compliance
  complianceCategory?: 'FERPA' | 'data_access' | 'configuration' | 'security';
  
  // TTL for auto-deletion
  ttl: number; // Unix timestamp (2 years for FERPA)
  
  entityType: 'ACTIVITY_LOG';
  gsi4pk: string; // schoolId#date
  gsi4sk: string; // timestamp#activityId
}
```

**Business Rules:**
- Immutable - can never be updated or deleted before TTL
- TTL set to 2 years for FERPA compliance
- Partitioned by date for efficient querying
- Captures all sensitive operations

---

## Access Patterns & Query Design

### Primary Access Patterns

| Pattern | Description | Key | Filter | GSI |
|---------|-------------|-----|--------|-----|
| AP1 | Get school by ID | `tenantId`, `SCHOOL#schoolId` | - | - |
| AP2 | List all schools for tenant | `tenantId` | `entityType = SCHOOL` | GSI3 |
| AP3 | Get all entities for school | `schoolId` (GSI1-PK) | - | GSI1 |
| AP4 | Get departments for school | `schoolId` (GSI1-PK) | `begins_with(SK, "DEPT#")` | GSI1 |
| AP5 | Get academic years for school | `schoolId` (GSI1-PK) | `begins_with(SK, "YEAR#")` | GSI1 |
| AP6 | Get current academic year | `schoolId` (GSI1-PK) | `isCurrent = true` | GSI1 |
| AP7 | Get grading periods for year | `schoolId#yearId` (GSI2-PK) | `begins_with(SK, "PERIOD#")` | GSI2 |
| AP8 | Get dept budget for year | `schoolId#yearId` (GSI2-PK) | `begins_with(SK, "DEPT#")` | GSI2 |
| AP9 | Get activity logs by date | `schoolId#date` (GSI4-PK) | - | GSI4 |
| AP10 | List active schools | `tenantId#SCHOOL` (GSI3-PK) | `begins_with(SK, "active#")` | GSI3 |
| AP11 | Get school configuration | `tenantId`, `SCHOOL#schoolId#CONFIG` | - | - |
| AP12 | Get enrollment capacity for year | `schoolId#yearId` (GSI2-PK) | `begins_with(SK, "CAPACITY#")` | GSI2 |

### Query Examples

#### 1. Get All Schools for Tenant (with pagination)

```typescript
const params = {
  TableName: 'school-table-basic',
  KeyConditionExpression: 'tenantId = :tenantId',
  FilterExpression: 'entityType = :entityType AND #status = :status',
  ExpressionAttributeNames: {
    '#status': 'status'
  },
  ExpressionAttributeValues: {
    ':tenantId': 'tenant-123',
    ':entityType': 'SCHOOL',
    ':status': 'active'
  },
  Limit: 20,
  ExclusiveStartKey: lastEvaluatedKey // for pagination
};
```

#### 2. Get All Departments for a School

```typescript
const params = {
  TableName: 'school-table-basic',
  IndexName: 'GSI1',
  KeyConditionExpression: 'gsi1pk = :schoolId AND begins_with(gsi1sk, :prefix)',
  ExpressionAttributeValues: {
    ':schoolId': 'school-456',
    ':prefix': 'DEPT#'
  }
};
```

#### 3. Get Current Academic Year

```typescript
const params = {
  TableName: 'school-table-basic',
  IndexName: 'GSI1',
  KeyConditionExpression: 'gsi1pk = :schoolId AND begins_with(gsi1sk, :prefix)',
  FilterExpression: 'isCurrent = :current',
  ExpressionAttributeValues: {
    ':schoolId': 'school-456',
    ':prefix': 'YEAR#',
    ':current': true
  }
};
```

#### 4. Get Audit Logs for School on Specific Date

```typescript
const params = {
  TableName: 'school-table-basic',
  IndexName: 'GSI4',
  KeyConditionExpression: 'gsi4pk = :schoolDate AND begins_with(gsi4sk, :timestamp)',
  ExpressionAttributeValues: {
    ':schoolDate': 'school-456#2025-10-10',
    ':timestamp': '2025-10-10T'
  }
};
```

---

## Data Integrity & Validation Rules

### Application-Level Constraints

#### 1. Uniqueness Constraints

```typescript
// School Code: Must be unique within tenant
async function validateSchoolCodeUnique(tenantId: string, schoolCode: string): Promise<boolean> {
  const result = await ddb.query({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'tenantId = :tenantId',
    FilterExpression: 'entityType = :type AND schoolCode = :code',
    ExpressionAttributeValues: {
      ':tenantId': tenantId,
      ':type': 'SCHOOL',
      ':code': schoolCode
    }
  });
  return result.Items.length === 0;
}
```

#### 2. Referential Integrity

```typescript
// Before creating department, verify school exists
async function validateSchoolExists(tenantId: string, schoolId: string): Promise<boolean> {
  try {
    const result = await ddb.get({
      TableName: TABLE_NAME,
      Key: {
        tenantId,
        entityKey: `SCHOOL#${schoolId}`
      }
    });
    return !!result.Item && result.Item.status === 'active';
  } catch (error) {
    return false;
  }
}
```

#### 3. Business Rule Validations

```typescript
// Only ONE academic year can be current per school
async function enforceOneCurrentYear(
  tenantId: string,
  schoolId: string,
  newYearId: string
): Promise<void> {
  // Use transaction to ensure atomicity
  const transactItems = [];
  
  // First, get all academic years
  const years = await getAcademicYears(tenantId, schoolId);
  
  // Set all others to isCurrent = false
  years.forEach(year => {
    if (year.academicYearId !== newYearId && year.isCurrent) {
      transactItems.push({
        Update: {
          TableName: TABLE_NAME,
          Key: {
            tenantId,
            entityKey: `SCHOOL#${schoolId}#YEAR#${year.academicYearId}`
          },
          UpdateExpression: 'SET isCurrent = :false, updatedAt = :now',
          ExpressionAttributeValues: {
            ':false': false,
            ':now': new Date().toISOString()
          }
        }
      });
    }
  });
  
  // Set new year to current
  transactItems.push({
    Update: {
      TableName: TABLE_NAME,
      Key: {
        tenantId,
        entityKey: `SCHOOL#${schoolId}#YEAR#${newYearId}`
      },
      UpdateExpression: 'SET isCurrent = :true, updatedAt = :now',
      ExpressionAttributeValues: {
        ':true': true,
        ':now': new Date().toISOString()
      }
    }
  });
  
  await ddb.transactWrite({ TransactItems: transactItems });
}
```

#### 4. Optimistic Locking

```typescript
async function updateSchoolWithVersionControl(
  tenantId: string,
  schoolId: string,
  updates: Partial<School>,
  currentVersion: number
): Promise<School> {
  try {
    const result = await ddb.update({
      TableName: TABLE_NAME,
      Key: {
        tenantId,
        entityKey: `SCHOOL#${schoolId}`
      },
      UpdateExpression: 'SET #data = :data, #version = :newVersion, updatedAt = :now',
      ConditionExpression: '#version = :currentVersion',
      ExpressionAttributeNames: {
        '#data': 'data',
        '#version': 'version'
      },
      ExpressionAttributeValues: {
        ':data': updates,
        ':currentVersion': currentVersion,
        ':newVersion': currentVersion + 1,
        ':now': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    });
    return result.Attributes as School;
  } catch (error) {
    if (error.code === 'ConditionalCheckFailedException') {
      throw new Error('Concurrent modification detected. Please retry.');
    }
    throw error;
  }
}
```

### Input Validation Rules

```typescript
// School validation schema
const schoolValidationSchema = {
  schoolName: {
    type: 'string',
    minLength: 3,
    maxLength: 255,
    required: true,
    pattern: /^[a-zA-Z0-9\s\-']+$/
  },
  schoolCode: {
    type: 'string',
    minLength: 3,
    maxLength: 50,
    required: true,
    pattern: /^[A-Z0-9\-]+$/,
    transform: (value) => value.toUpperCase()
  },
  schoolType: {
    type: 'enum',
    values: ['elementary', 'middle', 'high', 'k12', 'alternative', 'special'],
    required: true
  },
  maxStudentCapacity: {
    type: 'number',
    min: 1,
    max: 50000,
    required: true
  },
  'contactInfo.primaryEmail': {
    type: 'email',
    required: true
  },
  'contactInfo.primaryPhone': {
    type: 'phone',
    required: true,
    format: 'E.164' // International format
  },
  'address.timezone': {
    type: 'timezone',
    required: true,
    validate: (value) => isValidTimezone(value)
  }
};
```

---

## Audit & Compliance Strategy

### 1. Automatic Audit Logging

**All mutations must create audit logs:**

```typescript
async function createSchoolWithAudit(
  tenantId: string,
  createDto: CreateSchoolDto,
  userId: string,
  context: RequestContext
): Promise<School> {
  const schoolId = uuid();
  const timestamp = new Date().toISOString();
  
  // Main school entity
  const school: School = {
    tenantId,
    schoolId,
    ...createDto,
    status: 'active',
    createdAt: timestamp,
    createdBy: userId,
    updatedAt: timestamp,
    updatedBy: userId,
    version: 1,
    entityType: 'SCHOOL',
    gsi1pk: schoolId,
    gsi1sk: `METADATA#${schoolId}`,
    gsi3pk: `${tenantId}#SCHOOL`,
    gsi3sk: `active#${timestamp}`
  };
  
  // Audit log entry
  const auditLog: SchoolActivityLog = {
    tenantId,
    schoolId,
    activityId: uuid(),
    timestamp,
    date: timestamp.split('T')[0],
    userId,
    userRole: context.userRole,
    userName: context.userName,
    action: 'CREATE_SCHOOL',
    entityType: 'SCHOOL',
    entityId: schoolId,
    changes: {
      before: null,
      after: school
    },
    description: `School created: ${school.schoolName}`,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    sessionId: context.sessionId,
    severity: 'info',
    complianceCategory: 'data_access',
    ttl: calculateTTL(2), // 2 years from now
    entityType: 'ACTIVITY_LOG',
    gsi4pk: `${schoolId}#${timestamp.split('T')[0]}`,
    gsi4sk: `${timestamp}#${uuid()}`
  };
  
  // Transaction to create both
  await ddb.transactWrite({
    TransactItems: [
      {
        Put: {
          TableName: TABLE_NAME,
          Item: school
        }
      },
      {
        Put: {
          TableName: TABLE_NAME,
          Item: auditLog
        }
      }
    ]
  });
  
  // Emit event for downstream services
  await eventBridge.putEvents({
    Entries: [{
      Source: 'edforge.school-service',
      DetailType: 'SchoolCreated',
      Detail: JSON.stringify({ schoolId, tenantId, school }),
      EventBusName: 'edforge-events'
    }]
  });
  
  return school;
}
```

### 2. FERPA Compliance

**Data Access Tracking:**

```typescript
// Track every read of sensitive data
async function getSchoolWithAccessLog(
  tenantId: string,
  schoolId: string,
  userId: string,
  context: RequestContext
): Promise<School> {
  const school = await getSchool(tenantId, schoolId);
  
  // Log sensitive data access
  await logDataAccess({
    tenantId,
    schoolId,
    userId,
    action: 'READ_SCHOOL',
    entityType: 'SCHOOL',
    entityId: schoolId,
    timestamp: new Date().toISOString(),
    ipAddress: context.ipAddress,
    complianceCategory: 'FERPA'
  });
  
  return school;
}
```

### 3. Data Retention & Archival

```typescript
// Archive completed academic year
async function archiveAcademicYear(
  tenantId: string,
  schoolId: string,
  academicYearId: string
): Promise<void> {
  // 1. Update status to archived
  await updateAcademicYearStatus(tenantId, schoolId, academicYearId, 'archived');
  
  // 2. Export to S3 for long-term storage
  const yearData = await exportAcademicYearData(tenantId, schoolId, academicYearId);
  await s3.putObject({
    Bucket: 'edforge-archives',
    Key: `${tenantId}/${schoolId}/academic-years/${academicYearId}.json`,
    Body: JSON.stringify(yearData),
    ServerSideEncryption: 'AES256',
    StorageClass: 'GLACIER' // Cost-effective long-term storage
  });
  
  // 3. Log archival action
  await logActivity({
    action: 'ARCHIVE_ACADEMIC_YEAR',
    entityType: 'ACADEMIC_YEAR',
    entityId: academicYearId,
    description: `Academic year archived to S3`,
    complianceCategory: 'data_access'
  });
}
```

---

## Event-Driven Architecture

### Domain Events Published by School Service

```typescript
// Event types
type SchoolDomainEvent =
  | SchoolCreatedEvent
  | SchoolUpdatedEvent
  | SchoolDeletedEvent
  | AcademicYearStartedEvent
  | AcademicYearEndedEvent
  | DepartmentCreatedEvent
  | DepartmentRestructuredEvent
  | EnrollmentCapacityChangedEvent;

// Event schemas
interface SchoolCreatedEvent {
  eventType: 'SchoolCreated';
  timestamp: string;
  tenantId: string;
  schoolId: string;
  schoolName: string;
  schoolCode: string;
  schoolType: string;
  principalUserId?: string;
  metadata: {
    timezone: string;
    address: Address;
  };
}

interface AcademicYearStartedEvent {
  eventType: 'AcademicYearStarted';
  timestamp: string;
  tenantId: string;
  schoolId: string;
  academicYearId: string;
  yearName: string;
  startDate: string;
  endDate: string;
}

interface DepartmentRestructuredEvent {
  eventType: 'DepartmentRestructured';
  timestamp: string;
  tenantId: string;
  schoolId: string;
  departments: Array<{
    departmentId: string;
    departmentName: string;
    headOfDepartmentUserId?: string;
  }>;
  changes: string; // Description of restructuring
}

interface EnrollmentCapacityChangedEvent {
  eventType: 'EnrollmentCapacityChanged';
  timestamp: string;
  tenantId: string;
  schoolId: string;
  academicYearId: string;
  gradeLevelId: string;
  previousCapacity: number;
  newCapacity: number;
  utilizationRate: number;
}
```

### Event Publishing

```typescript
// Event publishing utility
async function publishEvent(event: SchoolDomainEvent): Promise<void> {
  await eventBridge.putEvents({
    Entries: [{
      Source: 'edforge.school-service',
      DetailType: event.eventType,
      Detail: JSON.stringify(event),
      EventBusName: 'edforge-events',
      Time: new Date(event.timestamp)
    }]
  });
  
  console.log(`Event published: ${event.eventType}`, {
    schoolId: event.schoolId,
    tenantId: event.tenantId
  });
}
```

### Event Subscriptions (from other services)

```typescript
// School Service subscribes to these events from other services

// From Student Service
interface StudentEnrolledEvent {
  eventType: 'StudentEnrolled';
  tenantId: string;
  schoolId: string;
  academicYearId: string;
  gradeLevelId: string;
  studentId: string;
}

// Handler: Update enrollment capacity
async function handleStudentEnrolled(event: StudentEnrolledEvent): Promise<void> {
  // Update current enrollment count
  await incrementEnrollmentCount(
    event.tenantId,
    event.schoolId,
    event.academicYearId,
    event.gradeLevelId
  );
  
  // Check if at capacity and emit alert
  const capacity = await getEnrollmentCapacity(
    event.tenantId,
    event.schoolId,
    event.academicYearId,
    event.gradeLevelId
  );
  
  if (capacity.utilizationRate > 0.9) {
    await publishEvent({
      eventType: 'EnrollmentCapacityWarning',
      tenantId: event.tenantId,
      schoolId: event.schoolId,
      academicYearId: event.academicYearId,
      gradeLevelId: event.gradeLevelId,
      utilizationRate: capacity.utilizationRate,
      timestamp: new Date().toISOString()
    });
  }
}

// From Staff Service
interface StaffAssignedEvent {
  eventType: 'StaffAssigned';
  tenantId: string;
  schoolId: string;
  departmentId: string;
  staffId: string;
  role: string;
}

// Handler: Update department staffing
async function handleStaffAssigned(event: StaffAssignedEvent): Promise<void> {
  await incrementDepartmentStaffCount(
    event.tenantId,
    event.schoolId,
    event.departmentId
  );
}
```

---

## Performance & Scalability

### 1. Caching Strategy

```typescript
// Cache frequently accessed data
interface CacheStrategy {
  // Cache school configuration (rarely changes)
  schoolConfig: {
    ttl: 3600, // 1 hour
    invalidateOn: ['SchoolConfigUpdated']
  };
  
  // Cache current academic year (changes once per year)
  currentAcademicYear: {
    ttl: 86400, // 24 hours
    invalidateOn: ['AcademicYearStarted', 'CurrentAcademicYearChanged']
  };
  
  // Cache active departments (moderate change frequency)
  departments: {
    ttl: 1800, // 30 minutes
    invalidateOn: ['DepartmentCreated', 'DepartmentUpdated', 'DepartmentDeleted']
  };
}

// Redis caching implementation
class SchoolCache {
  private redis: RedisClient;
  
  async getSchoolConfig(tenantId: string, schoolId: string): Promise<SchoolConfiguration | null> {
    const cacheKey = `config:${tenantId}:${schoolId}`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }
    
    // Cache miss - fetch from DynamoDB
    const config = await this.fetchSchoolConfigFromDB(tenantId, schoolId);
    
    if (config) {
      await this.redis.setex(cacheKey, 3600, JSON.stringify(config));
    }
    
    return config;
  }
  
  async invalidateSchoolConfig(tenantId: string, schoolId: string): Promise<void> {
    const cacheKey = `config:${tenantId}:${schoolId}`;
    await this.redis.del(cacheKey);
  }
}
```

### 2. Read Replicas & Denormalization

```typescript
// Denormalize frequently accessed data
interface School {
  // ... other fields ...
  
  // Denormalized fields for quick access
  currentEnrollment: number; // Updated via events
  departmentCount: number; // Updated via events
  staffCount: number; // Updated via events
  currentAcademicYearName?: string; // Updated when current year changes
  
  // Cached aggregations
  aggregations: {
    lastCalculated: string;
    enrollmentByGrade: { [grade: string]: number };
    capacityUtilization: number;
  };
}
```

### 3. Batch Operations

```typescript
// Batch write for creating multiple entities
async function batchCreateDepartments(
  tenantId: string,
  schoolId: string,
  departments: CreateDepartmentDto[]
): Promise<Department[]> {
  const items: Department[] = departments.map(dto => ({
    tenantId,
    schoolId,
    departmentId: uuid(),
    ...dto,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
    entityType: 'DEPARTMENT',
    gsi1pk: schoolId,
    gsi1sk: `DEPT#${uuid()}`
  }));
  
  // DynamoDB BatchWrite (max 25 items per request)
  const chunks = chunkArray(items, 25);
  
  for (const chunk of chunks) {
    await ddb.batchWrite({
      RequestItems: {
        [TABLE_NAME]: chunk.map(item => ({
          PutRequest: { Item: item }
        }))
      }
    });
  }
  
  return items;
}
```

### 4. Query Optimization

```typescript
// Use projection expressions to reduce data transfer
async function listSchoolsSummary(tenantId: string): Promise<SchoolSummary[]> {
  const result = await ddb.query({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'tenantId = :tenantId',
    FilterExpression: 'entityType = :type',
    ProjectionExpression: 'schoolId, schoolName, schoolCode, #status, currentEnrollment, maxStudentCapacity',
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':tenantId': tenantId,
      ':type': 'SCHOOL'
    }
  });
  
  return result.Items as SchoolSummary[];
}
```

### 5. Pagination

```typescript
// Cursor-based pagination for large result sets
interface PaginatedResponse<T> {
  items: T[];
  nextToken?: string;
  hasMore: boolean;
  total?: number;
}

async function listSchoolsPaginated(
  tenantId: string,
  limit: number = 20,
  nextToken?: string
): Promise<PaginatedResponse<School>> {
  const params: any = {
    TableName: TABLE_NAME,
    KeyConditionExpression: 'tenantId = :tenantId',
    FilterExpression: 'entityType = :type',
    ExpressionAttributeValues: {
      ':tenantId': tenantId,
      ':type': 'SCHOOL'
    },
    Limit: limit
  };
  
  if (nextToken) {
    params.ExclusiveStartKey = JSON.parse(
      Buffer.from(nextToken, 'base64').toString()
    );
  }
  
  const result = await ddb.query(params);
  
  return {
    items: result.Items as School[],
    nextToken: result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : undefined,
    hasMore: !!result.LastEvaluatedKey
  };
}
```

---

## Migration & Implementation Plan

### Phase 1: Foundation (Week 1-2)

**Goal:** Establish core data structures and basic operations

#### Tasks:
1. ✅ Update entity interfaces and DTOs
2. ✅ Implement new single-table design with GSIs
3. ✅ Update CDK infrastructure for new GSIs
4. ✅ Implement validation layer
5. ✅ Add optimistic locking
6. ✅ Basic CRUD operations for School entity

#### Deliverables:
- Updated TypeScript interfaces
- Updated CDK stack with GSI definitions
- Service layer with full validation
- Unit tests for core operations

### Phase 2: Audit & Compliance (Week 3)

**Goal:** Add comprehensive audit logging and compliance features

#### Tasks:
1. ✅ Implement Activity Log entity
2. ✅ Add automatic audit logging to all mutations
3. ✅ Implement TTL for audit logs (2-year retention)
4. ✅ Add data access tracking for FERPA compliance
5. ✅ Implement archival strategy

#### Deliverables:
- Complete audit trail
- FERPA compliance features
- Archival automation

### Phase 3: Academic Structure (Week 4-5)

**Goal:** Implement temporal boundaries and academic year management

#### Tasks:
1. ✅ Implement Academic Year entity with business rules
2. ✅ Implement Grading Period entity
3. ✅ Implement Holiday/Closure entity
4. ✅ Add "current year" enforcement logic
5. ✅ Implement year rollover process
6. ✅ Add year-end archival

#### Deliverables:
- Academic calendar management
- Temporal boundary enforcement
- Year rollover automation

### Phase 4: Organizational Structure (Week 6-7)

**Goal:** Complete department and capacity management

#### Tasks:
1. ✅ Implement Department entity with full features
2. ✅ Implement Department Budget tracking
3. ✅ Implement Grade Level entity
4. ✅ Implement Enrollment Capacity tracking
5. ✅ Add capacity alerts and monitoring

#### Deliverables:
- Department management
- Budget tracking
- Capacity planning tools

### Phase 5: Facilities Management (Week 8)

**Goal:** Add campus, building, and classroom management

#### Tasks:
1. ✅ Implement Campus entity
2. ✅ Implement Building entity
3. ✅ Implement Classroom entity
4. ✅ Add facility search and filtering

#### Deliverables:
- Facility management features
- Room scheduling foundation

### Phase 6: Event-Driven Integration (Week 9-10)

**Goal:** Enable cross-service coordination

#### Tasks:
1. ✅ Define domain events
2. ✅ Implement event publishing to EventBridge
3. ✅ Implement event handlers for subscriptions
4. ✅ Add event replay capability
5. ✅ Integration testing with Student Service

#### Deliverables:
- Event-driven architecture
- Cross-service coordination
- Real-time data synchronization

### Phase 7: Performance Optimization (Week 11)

**Goal:** Optimize for production workloads

#### Tasks:
1. ✅ Implement caching layer (Redis)
2. ✅ Add denormalization for hot paths
3. ✅ Implement batch operations
4. ✅ Query optimization
5. ✅ Load testing and tuning

#### Deliverables:
- Production-ready performance
- Scalability testing results

### Phase 8: Reporting & Analytics (Week 12)

**Goal:** Enable decision-making with data insights

#### Tasks:
1. ✅ Implement school dashboard metrics
2. ✅ Add capacity utilization reports
3. ✅ Department performance reports
4. ✅ Budget utilization tracking
5. ✅ Compliance reporting

#### Deliverables:
- Management dashboards
- Analytics APIs
- Compliance reports

---

## Data Migration Strategy

### For Existing Data

```typescript
// Migration script to transform existing data to new schema
async function migrateSchoolData(): Promise<void> {
  // 1. Scan existing table
  const oldSchools = await scanOldSchoolTable();
  
  // 2. Transform to new schema
  for (const oldSchool of oldSchools) {
    const newSchool: School = {
      // Map old fields to new structure
      tenantId: oldSchool.tenantId,
      schoolId: oldSchool.schoolId,
      schoolName: oldSchool.schoolName,
      schoolCode: oldSchool.schoolCode,
      schoolType: oldSchool.schoolType || 'k12',
      
      // Structure contact info
      contactInfo: {
        primaryEmail: oldSchool.email,
        primaryPhone: oldSchool.phone,
        website: oldSchool.website
      },
      
      // Structure address
      address: {
        street: oldSchool.address,
        city: oldSchool.city,
        state: oldSchool.state,
        country: oldSchool.country,
        postalCode: oldSchool.postalCode,
        timezone: 'America/New_York' // Default, should be updated
      },
      
      // Set defaults for new fields
      maxStudentCapacity: oldSchool.maxStudents || 1000,
      status: oldSchool.status || 'active',
      
      // Preserve audit fields
      createdAt: oldSchool.createdAt,
      createdBy: oldSchool.createdBy || 'system',
      updatedAt: new Date().toISOString(),
      updatedBy: 'migration-script',
      version: 1,
      
      // Add GSI fields
      entityType: 'SCHOOL',
      gsi1pk: oldSchool.schoolId,
      gsi1sk: `METADATA#${oldSchool.schoolId}`,
      gsi3pk: `${oldSchool.tenantId}#SCHOOL`,
      gsi3sk: `active#${oldSchool.createdAt}`
    };
    
    // 3. Write to new table
    await ddb.put({
      TableName: NEW_TABLE_NAME,
      Item: newSchool
    });
    
    console.log(`Migrated school: ${newSchool.schoolId}`);
  }
}
```

---

## Security Considerations

### 1. Tenant Isolation

```typescript
// Always validate tenant ID from JWT matches data access
async function validateTenantAccess(
  userTenantId: string,
  dataTenantId: string
): Promise<void> {
  if (userTenantId !== dataTenantId) {
    throw new ForbiddenError('Access denied: Tenant mismatch');
  }
}
```

### 2. PII Encryption

```typescript
// Encrypt sensitive fields at rest
interface EncryptedSchool extends School {
  // Use AWS KMS for field-level encryption
  contactInfo: {
    primaryEmail: string; // Encrypted
    primaryPhone: string; // Encrypted
    // ...
  };
}

async function encryptPII(data: any, kmsKeyId: string): Promise<string> {
  const result = await kms.encrypt({
    KeyId: kmsKeyId,
    Plaintext: JSON.stringify(data)
  });
  return result.CiphertextBlob.toString('base64');
}
```

### 3. Rate Limiting

```typescript
// Implement rate limiting per tenant
const rateLimiter = new RateLimiter({
  tokensPerInterval: 100,
  interval: 'minute',
  fireImmediately: true
});

async function checkRateLimit(tenantId: string): Promise<void> {
  const allowed = await rateLimiter.tryRemoveTokens(tenantId, 1);
  if (!allowed) {
    throw new TooManyRequestsError('Rate limit exceeded');
  }
}
```

---

## Monitoring & Observability

### Key Metrics to Track

```typescript
interface SchoolServiceMetrics {
  // Performance metrics
  queryLatency: {
    p50: number;
    p95: number;
    p99: number;
  };
  
  // Business metrics
  totalSchools: number;
  activeSchools: number;
  averageEnrollmentUtilization: number;
  schoolsAtCapacity: number;
  
  // Operational metrics
  failedWrites: number;
  cacheHitRate: number;
  eventPublishFailures: number;
  
  // Compliance metrics
  auditLogCoverage: number; // Percentage of operations logged
  dataAccessAttempts: number;
  unauthorizedAccessAttempts: number;
}

// CloudWatch custom metrics
async function publishMetrics(metrics: SchoolServiceMetrics): Promise<void> {
  await cloudwatch.putMetricData({
    Namespace: 'EdForge/SchoolService',
    MetricData: [
      {
        MetricName: 'TotalSchools',
        Value: metrics.totalSchools,
        Unit: 'Count'
      },
      {
        MetricName: 'EnrollmentUtilization',
        Value: metrics.averageEnrollmentUtilization,
        Unit: 'Percent'
      }
      // ... more metrics
    ]
  });
}
```

### Alarms

```typescript
// CloudWatch alarms for critical conditions
const alarms = [
  {
    name: 'SchoolService-HighErrorRate',
    metric: 'ErrorRate',
    threshold: 5, // 5% error rate
    evaluationPeriods: 2,
    treatMissingData: 'notBreaching'
  },
  {
    name: 'SchoolService-HighLatency',
    metric: 'QueryLatencyP99',
    threshold: 1000, // 1 second
    evaluationPeriods: 3
  },
  {
    name: 'SchoolService-CapacityWarning',
    metric: 'SchoolsAtCapacity',
    threshold: 10, // 10 schools at capacity
    evaluationPeriods: 1
  }
];
```

---

## Testing Strategy

### 1. Unit Tests

```typescript
describe('School Service - Academic Year Management', () => {
  it('should enforce only one current academic year per school', async () => {
    // Setup
    const tenantId = 'test-tenant';
    const schoolId = 'test-school';
    
    // Create first academic year
    const year1 = await createAcademicYear(tenantId, schoolId, {
      yearName: '2024-2025',
      startDate: '2024-09-01',
      endDate: '2025-06-30',
      isCurrent: true
    });
    
    expect(year1.isCurrent).toBe(true);
    
    // Create second academic year and set as current
    const year2 = await createAcademicYear(tenantId, schoolId, {
      yearName: '2025-2026',
      startDate: '2025-09-01',
      endDate: '2026-06-30',
      isCurrent: false
    });
    
    await setCurrentAcademicYear(tenantId, schoolId, year2.academicYearId);
    
    // Verify: year1 should no longer be current
    const updatedYear1 = await getAcademicYear(tenantId, schoolId, year1.academicYearId);
    const updatedYear2 = await getAcademicYear(tenantId, schoolId, year2.academicYearId);
    
    expect(updatedYear1.isCurrent).toBe(false);
    expect(updatedYear2.isCurrent).toBe(true);
  });
  
  it('should validate academic year dates', async () => {
    const tenantId = 'test-tenant';
    const schoolId = 'test-school';
    
    // Should fail: end date before start date
    await expect(
      createAcademicYear(tenantId, schoolId, {
        yearName: '2024-2025',
        startDate: '2025-06-30',
        endDate: '2024-09-01',
        isCurrent: false
      })
    ).rejects.toThrow('End date must be after start date');
  });
});
```

### 2. Integration Tests

```typescript
describe('School Service - Event Publishing', () => {
  it('should publish SchoolCreated event when school is created', async () => {
    const eventSpy = jest.spyOn(eventBridge, 'putEvents');
    
    const school = await createSchool(tenantId, {
      schoolName: 'Test School',
      schoolCode: 'TEST-001',
      // ... other fields
    }, userId, context);
    
    expect(eventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        Entries: expect.arrayContaining([
          expect.objectContaining({
            DetailType: 'SchoolCreated',
            Detail: expect.stringContaining(school.schoolId)
          })
        ])
      })
    );
  });
});
```

### 3. Load Tests

```typescript
// Load test: Create 1000 schools concurrently
describe('School Service - Load Testing', () => {
  it('should handle concurrent school creation', async () => {
    const promises = [];
    const startTime = Date.now();
    
    for (let i = 0; i < 1000; i++) {
      promises.push(
        createSchool(tenantId, {
          schoolName: `School ${i}`,
          schoolCode: `SCH-${String(i).padStart(4, '0')}`,
          // ... other fields
        }, userId, context)
      );
    }
    
    const schools = await Promise.all(promises);
    const duration = Date.now() - startTime;
    
    expect(schools).toHaveLength(1000);
    expect(duration).toBeLessThan(30000); // Should complete in under 30 seconds
    
    console.log(`Created 1000 schools in ${duration}ms`);
    console.log(`Average: ${duration / 1000}ms per school`);
  });
});
```

---

## API Documentation

### REST Endpoints

```typescript
/**
 * School Management API
 * Base URL: /api/schools
 */

// Create School
POST /schools
Request:
{
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
    "country": "USA",
    "postalCode": "62701",
    "timezone": "America/Chicago"
  },
  "maxStudentCapacity": 2000
}
Response: 201 Created
{
  "schoolId": "uuid",
  "schoolName": "Lincoln High School",
  "status": "active",
  "createdAt": "2025-10-10T10:00:00Z"
}

// List Schools
GET /schools?limit=20&nextToken=abc123
Response: 200 OK
{
  "items": [...],
  "nextToken": "xyz789",
  "hasMore": true
}

// Get School by ID
GET /schools/:schoolId
Response: 200 OK

// Update School
PUT /schools/:schoolId
Request:
{
  "schoolName": "Updated Name",
  "version": 1
}
Response: 200 OK

// Delete School (soft delete)
DELETE /schools/:schoolId
Response: 204 No Content

// Get School Configuration
GET /schools/:schoolId/configuration
Response: 200 OK

// Update School Configuration
PUT /schools/:schoolId/configuration
Request: {...}
Response: 200 OK

// Academic Year Management
GET /schools/:schoolId/academic-years
POST /schools/:schoolId/academic-years
PUT /schools/:schoolId/academic-years/:yearId/set-current
GET /schools/:schoolId/academic-years/:yearId/grading-periods

// Department Management
GET /schools/:schoolId/departments
POST /schools/:schoolId/departments
PUT /schools/:schoolId/departments/:deptId
GET /schools/:schoolId/departments/:deptId/budget

// Enrollment Capacity
GET /schools/:schoolId/academic-years/:yearId/capacity
PUT /schools/:schoolId/academic-years/:yearId/capacity/:gradeId

// Audit Logs
GET /schools/:schoolId/activity-log?startDate=2025-01-01&endDate=2025-12-31
```

---

## Conclusion

This database design provides:

✅ **Scalability:** Single-table design with efficient access patterns
✅ **Security:** Tenant isolation, encryption, audit logging
✅ **Compliance:** FERPA-compliant audit trails and data retention
✅ **Flexibility:** JSONB fields for custom attributes and configurations
✅ **Performance:** Caching, denormalization, optimized queries
✅ **Maintainability:** Clear entity boundaries and business rules
✅ **Decision-Making:** Rich data model supporting analytics and reporting
✅ **Integration:** Event-driven architecture for cross-service coordination

This design is **production-ready for MVP** and can scale to thousands of schools and millions of students while maintaining data integrity, security, and performance.

---

## Next Steps

1. Review and approve design
2. Begin Phase 1 implementation
3. Set up monitoring and alerting
4. Create API documentation
5. Train team on new patterns
6. Migrate existing data
7. Load testing and optimization
8. Production deployment

**Estimated Timeline:** 12 weeks to full implementation
**Team Required:** 2-3 backend engineers, 1 DevOps engineer

---

*Document Version: 1.0*
*Last Updated: October 10, 2025*
*Author: AI Assistant for EdForge*

