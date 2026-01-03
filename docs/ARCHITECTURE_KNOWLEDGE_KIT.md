# EdForge MFE Architecture Knowledge Kit v2.0

> A comprehensive technical guide for backend engineers to understand the frontend architecture and design corresponding microservices for AWS deployment.

---

## 1. Architecture Overview

EdForge is a **multi-tenant Education Management Information System (EMIS)** built as a **Micro-Frontend (MFE)** application using **Module Federation**.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SHELL APPLICATION                               │
│    (Authentication, Routing, Layout, Theme, ABAC, Multi-tenant Context)     │
│                              Port: 3000                                      │
├────────────┬────────────┬────────────┬────────────┬────────────┬────────────┤
│ Academics  │  Finance   │   People   │  Messages  │ Analytics  │  Special   │
│   Remote   │   Remote   │   Remote   │   Remote   │   Remote   │  Programs  │
│   :3002    │   :3003    │   :3006    │   :3007    │   :3008    │   :3005    │
├────────────┴────────────┴────────────┴────────────┴────────────┴────────────┤
│                            Ed-Fi Remote (:3001)                              │
│                    (State Education Data Exchange)                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Technologies

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Build | Rsbuild + Rspack | Fast bundling with Module Federation |
| Routing | TanStack Router | Type-safe file-based routing |
| State | Zustand | Lightweight global state management |
| Auth | AWS Cognito (planned) | Identity and access management |
| Styling | Tailwind CSS + CSS Variables | Theming with dark/light modes |
| Animation | Framer Motion + React Spring | Micro-interactions |

---

## 2. Frontend Domain Modules → Backend Services Mapping

The frontend is organized into **11 distinct modules**, each representing a bounded context. The navigation follows a **workflow-oriented** pattern rather than database-first design.

### 2.1 Revised Core Modules (v2.0)

| Frontend Module | Suggested Backend Service(s) | Primary Entities | UI Pattern |
|-----------------|------------------------------|------------------|------------|
| **Shell** | `identity-service` | User, Tenant, School, Session | Role-based dashboards |
| **Academics** | `academics-service` | Student, Enrollment, Attendance, Grade, Assessment, Course, Schedule | Consolidated views with tabs |
| **Finance** | `finance-service` | Invoice, Payment, Fee, Expense, Budget, Transaction, Ledger | Ledger/Billing/Expenses split |
| **People** | `hr-service` | Employee, Teacher, Staff, Department, Contract, Payroll | Staff Directory + HR Admin |
| **Messages** | `communications-service` | Message, Announcement, Notification | Inbox + Announcements |
| **Analytics** | `analytics-service` | Report, Dashboard, Metric, DataExport | Domain-specific insights |
| **Special Programs** | `special-programs-service` | IEP, 504Plan, Accommodation, Intervention, Counseling | Compliance-focused |
| **Ed-Fi** | `edfi-integration-service` | EdFiConnection, DescriptorMapping, SyncJob, SyncError | Configuration + Monitoring |
| **Student Portal** | *Uses academics-service APIs* | (Read-only student view) | Self-service portal |
| **Parent Portal** | *Uses academics + finance APIs* | (Read-only parent view) | Family-focused portal |
| **Settings** | `tenant-service`, `user-service` | Preferences, SchoolConfig, Integration | Account + Workspace sections |

### 2.2 Domain Boundaries Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DOMAIN BOUNDED CONTEXTS                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │   IDENTITY &    │  │    ACADEMIC     │  │    FINANCIAL    │              │
│  │  MULTI-TENANT   │  │    DOMAIN       │  │     DOMAIN      │              │
│  │                 │  │                 │  │                 │              │
│  │ • Tenants       │  │ • Students      │  │ • Ledger (GL/   │              │
│  │ • Schools       │  │ • Enrollment    │  │   AP/AR)        │              │
│  │ • Users         │  │ • Attendance    │  │ • Billing       │              │
│  │ • Roles         │  │ • Grades        │  │ • Expenses      │              │
│  │ • Sessions      │  │ • Scheduling    │  │ • Budgets       │              │
│  │ • Permissions   │  │ • Curriculum    │  │ • Transactions  │              │
│  │                 │  │                 │  │                 │              │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘              │
│           │                    │                    │                        │
│           └────────────────────┼────────────────────┘                        │
│                                │                                             │
│  ┌─────────────────┐  ┌───────┴───────┐  ┌─────────────────┐                │
│  │  HR & PEOPLE    │  │  SHARED CORE  │  │ COMMUNICATIONS  │                │
│  │    DOMAIN       │  │   (PERSON)    │  │     DOMAIN      │                │
│  │                 │  │               │  │                 │                │
│  │ • Staff Dir.    │  │ • BasePerson  │  │ • Inbox         │                │
│  │ • HR Admin:     │  │ • Address     │  │ • Announcements │                │
│  │   - Payroll     │  │ • Contact     │  │ • Meetings      │                │
│  │   - Contracts   │  │ • Emergency   │  │ • Notifications │                │
│  │   - Prof. Dev   │  │               │  │                 │                │
│  │   - Reviews     │  │               │  │                 │                │
│  └─────────────────┘  └───────────────┘  └─────────────────┘                │
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │ SPECIAL PROGS   │  │   ANALYTICS     │  │  INTEGRATIONS   │              │
│  │    DOMAIN       │  │    DOMAIN       │  │    DOMAIN       │              │
│  │                 │  │                 │  │                 │              │
│  │ • IEPs          │  │ • Academic      │  │ • Ed-Fi ODS     │              │
│  │ • 504 Plans     │  │ • Attendance    │  │ • Google Suite  │              │
│  │ • Accommodations│  │ • Financial     │  │ • Microsoft 365 │              │
│  │ • Counseling    │  │ • Enrollment    │  │ • Sync Jobs     │              │
│  │ • Interventions │  │ • Comparisons   │  │ • Error Logs    │              │
│  │                 │  │ • Custom Rpts   │  │                 │              │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. AWS Backend Architecture Recommendations

### 3.1 Service Deployment Strategy

Based on traffic patterns and operational requirements, services are categorized into **ECS Cluster** (always-on) and **Lambda** (event-driven):

#### ECS Cluster (Always-On Services)

| Service | Entities | Justification | Estimated RPS |
|---------|----------|---------------|---------------|
| `identity-service` | User, Session, Token | Sub-second auth response required, stateful session management | High (100+) |
| `academics-service` | Student, Enrollment, Attendance, Grade | High-frequency CRUD operations, real-time attendance | High (50-100) |

#### Lambda (Event-Driven Services)

| Service | Entities | Trigger Pattern | Cold Start Tolerance |
|---------|----------|-----------------|---------------------|
| `tenant-service` | Tenant, School, SchoolYear, Term | API Gateway + CloudFront caching | Yes (infrequent) |
| `finance-service` | Invoice, Payment, Fee, Expense | API Gateway + SQS for batch processing | Yes |
| `hr-service` | Employee, Contract, Payroll, ProfDev | Scheduled (payroll) + API Gateway | Yes |
| `communications-service` | Message, Announcement, Notification | SNS/SES triggers + API Gateway | Yes |
| `analytics-service` | Report, Dashboard, DataExport | S3 trigger + Step Functions for ETL | Yes |
| `special-programs-service` | IEP, 504Plan, Accommodation | API Gateway | Yes |
| `edfi-integration-service` | EdFiConnection, SyncJob, SyncError | Step Functions + EventBridge scheduler | Yes |

### 3.2 Cost-Optimized Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AWS INFRASTRUCTURE                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        API GATEWAY + CloudFront                      │    │
│  │                    (CDN for static assets, API routing)              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                         │
│         ┌──────────────────────────┼──────────────────────────┐             │
│         │                          │                          │             │
│         ▼                          ▼                          ▼             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │   ECS CLUSTER   │    │  LAMBDA LAYER   │    │  ASYNC LAYER    │         │
│  │   (Always-On)   │    │ (High Frequency)│    │ (Batch/Async)   │         │
│  │                 │    │                 │    │                 │         │
│  │ • identity-svc  │    │ • tenant-svc    │    │ • analytics-svc │         │
│  │ • academics-svc │    │ • finance-svc   │    │ • edfi-svc      │         │
│  │                 │    │ • hr-svc        │    │ • comms-svc     │         │
│  │                 │    │ • special-progs │    │                 │         │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘         │
│           │                      │                      │                   │
│           └──────────────────────┼──────────────────────┘                   │
│                                  │                                          │
│                                  ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     DATA LAYER (DynamoDB-First)                      │    │
│  │                                                                      │    │
│  │  ┌──────────────────────────────────────────────────────────────┐   │    │
│  │  │                       DYNAMODB TABLES                         │   │    │
│  │  │  • edforge-main (Single-table design for core entities)       │   │    │
│  │  │  • edforge-analytics (Time-series data, TTL enabled)          │   │    │
│  │  │  • edforge-sessions (User sessions, TTL enabled)              │   │    │
│  │  └──────────────────────────────────────────────────────────────┘   │    │
│  │                                                                      │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │    │
│  │  │     S3       │  │     SQS      │  │     SNS      │               │    │
│  │  │ (Documents/  │  │  (Queues)    │  │  (Events)    │               │    │
│  │  │  Reports)    │  │              │  │              │               │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘               │    │
│  │                                                                      │    │
│  │  ┌──────────────┐  ┌──────────────┐                                 │    │
│  │  │  DAX Cache   │  │  DynamoDB    │                                 │    │
│  │  │ (Read cache) │  │   Streams    │                                 │    │
│  │  └──────────────┘  └──────────────┘                                 │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Service Communication Patterns

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SERVICE COMMUNICATION                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Synchronous (REST/GraphQL via API Gateway):                                │
│  ─────────────────────────────────────────────                              │
│  Frontend → API Gateway → identity-service (JWT validation)                  │
│  Frontend → API Gateway → academics-service (CRUD operations)                │
│  Frontend → API Gateway → finance-service (billing queries)                  │
│                                                                              │
│  Asynchronous (Event-Driven):                                                │
│  ───────────────────────────                                                │
│  academics-service → SNS → communications-service (attendance alerts)        │
│  finance-service → SQS → analytics-service (transaction processing)          │
│  edfi-service → EventBridge → Step Functions (sync orchestration)           │
│                                                                              │
│  Batch Processing:                                                           │
│  ────────────────                                                           │
│  EventBridge Schedule → hr-service (payroll processing)                      │
│  S3 Upload → Lambda → analytics-service (report generation)                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Multi-Tenancy Model

### 4.1 Tenant Hierarchy

```
Tenant (District/Organization)
 └── Schools[]
      └── SchoolYears[]
           └── Terms[]
      └── Users[] (with school-specific roles)
```

### 4.2 Key Tenant Types (from `@edforge/types`)

```typescript
interface Tenant {
  id: string
  name: string
  subdomain: string           // e.g., "springfield" → springfield.edforge.io
  schools: string[]           // School IDs
  activeSchoolYear: string
  features?: TenantFeatures   // Feature flags
  branding?: TenantBranding   // Custom theming
  integrations?: TenantIntegrations // Ed-Fi, Google, MS365
}

interface School {
  id: string
  tenantId: string
  name: string
  code: string
  type?: 'elementary' | 'middle' | 'high' | 'k12' | 'other'
  isActive: boolean
}
```

### 4.3 Tenant Resolution Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        TENANT RESOLUTION FLOW                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. URL Parsing:                                                             │
│     https://springfield.edforge.io/academics/students                       │
│              └─────────┬──────────┘                                         │
│                        │                                                     │
│                        ▼                                                     │
│  2. Subdomain Extraction:                                                    │
│     subdomain = "springfield"                                                │
│                        │                                                     │
│                        ▼                                                     │
│  3. Tenant Lookup (cached in Redis):                                         │
│     tenant = getTenantBySubdomain("springfield")                            │
│                        │                                                     │
│                        ▼                                                     │
│  4. Context Injection (HTTP Headers):                                        │
│     X-Tenant-ID: tenant-uuid-123                                            │
│     X-School-ID: school-uuid-456 (if school selected)                       │
│                        │                                                     │
│                        ▼                                                     │
│  5. Database Query Scoping:                                                  │
│     SELECT * FROM students WHERE tenant_id = :tenantId                      │
│                                 AND school_id = :schoolId                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.4 DynamoDB Database Architecture

EdForge uses **Amazon DynamoDB** as the primary database for its scalability, cost-effectiveness, and serverless nature. The architecture follows a **single-table design** pattern optimized for multi-tenant access patterns.

#### 4.4.1 Table Structure Overview

| Table | Purpose | Capacity Mode | Features |
|-------|---------|---------------|----------|
| `edforge-main` | Core entities (Students, Staff, Grades, etc.) | On-Demand | Single-table design, GSIs |
| `edforge-sessions` | User sessions and tokens | On-Demand | TTL enabled (24h) |
| `edforge-analytics` | Time-series metrics and audit logs | On-Demand | TTL enabled (90 days) |

#### 4.4.2 Single-Table Design Pattern

The `edforge-main` table uses a composite key strategy for multi-tenant isolation:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        edforge-main TABLE SCHEMA                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Primary Key:                                                                │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  PK (Partition Key)         │  SK (Sort Key)                           │ │
│  │  TENANT#<tenantId>          │  <EntityType>#<EntityId>                 │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  Global Secondary Indexes (GSIs):                                            │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  GSI1: School-scoped queries                                           │ │
│  │    GSI1PK: TENANT#<tenantId>#SCHOOL#<schoolId>                         │ │
│  │    GSI1SK: <EntityType>#<sortValue>                                    │ │
│  ├────────────────────────────────────────────────────────────────────────┤ │
│  │  GSI2: Entity-type queries (cross-school)                              │ │
│  │    GSI2PK: TENANT#<tenantId>#TYPE#<entityType>                         │ │
│  │    GSI2SK: <createdAt> or <name>                                       │ │
│  ├────────────────────────────────────────────────────────────────────────┤ │
│  │  GSI3: User lookups (email-based)                                      │ │
│  │    GSI3PK: EMAIL#<email>                                               │ │
│  │    GSI3SK: TENANT#<tenantId>                                           │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 4.4.3 Entity Key Patterns

| Entity | PK | SK | GSI1PK | GSI1SK |
|--------|----|----|--------|--------|
| Tenant | `TENANT#<id>` | `METADATA` | - | - |
| School | `TENANT#<tid>` | `SCHOOL#<id>` | - | - |
| User | `TENANT#<tid>` | `USER#<id>` | `EMAIL#<email>` | `TENANT#<tid>` |
| Student | `TENANT#<tid>` | `STUDENT#<id>` | `TENANT#<tid>#SCHOOL#<sid>` | `STUDENT#<grade>#<name>` |
| Teacher | `TENANT#<tid>` | `TEACHER#<id>` | `TENANT#<tid>#SCHOOL#<sid>` | `TEACHER#<dept>#<name>` |
| Attendance | `TENANT#<tid>` | `ATTENDANCE#<date>#<studentId>` | `TENANT#<tid>#SCHOOL#<sid>` | `ATTENDANCE#<date>` |
| Grade | `TENANT#<tid>` | `GRADE#<studentId>#<courseId>#<term>` | `TENANT#<tid>#SCHOOL#<sid>` | `GRADE#<courseId>#<term>` |
| Invoice | `TENANT#<tid>` | `INVOICE#<id>` | `TENANT#<tid>#SCHOOL#<sid>` | `INVOICE#<status>#<date>` |
| IEP | `TENANT#<tid>` | `IEP#<studentId>#<id>` | `TENANT#<tid>#SCHOOL#<sid>` | `IEP#<status>#<date>` |

#### 4.4.4 Access Patterns & Query Examples

```typescript
// 1. Get all students in a school (paginated)
const params = {
  TableName: 'edforge-main',
  IndexName: 'GSI1',
  KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
  ExpressionAttributeValues: {
    ':pk': `TENANT#${tenantId}#SCHOOL#${schoolId}`,
    ':sk': 'STUDENT#'
  },
  Limit: 50
}

// 2. Get student by ID
const params = {
  TableName: 'edforge-main',
  Key: {
    PK: `TENANT#${tenantId}`,
    SK: `STUDENT#${studentId}`
  }
}

// 3. Get attendance for a date (all students)
const params = {
  TableName: 'edforge-main',
  IndexName: 'GSI1',
  KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
  ExpressionAttributeValues: {
    ':pk': `TENANT#${tenantId}#SCHOOL#${schoolId}`,
    ':sk': `ATTENDANCE#${date}`
  }
}

// 4. Get user by email (cross-tenant lookup for login)
const params = {
  TableName: 'edforge-main',
  IndexName: 'GSI3',
  KeyConditionExpression: 'GSI3PK = :email',
  ExpressionAttributeValues: {
    ':email': `EMAIL#${email}`
  }
}
```

#### 4.4.5 Multi-Tenancy Isolation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     MULTI-TENANT DATA ISOLATION                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Tenant A (Springfield School District)                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  PK: TENANT#tenant-a-uuid                                           │    │
│  │  ├── SK: SCHOOL#school-1 (Lincoln Elementary)                       │    │
│  │  │   └── Students, Teachers, Grades scoped via GSI1                 │    │
│  │  ├── SK: SCHOOL#school-2 (Lincoln High)                             │    │
│  │  │   └── Students, Teachers, Grades scoped via GSI1                 │    │
│  │  └── SK: USER#*, STUDENT#*, TEACHER#* (tenant-wide entities)        │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  Tenant B (Shelbyville Schools)                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  PK: TENANT#tenant-b-uuid                                           │    │
│  │  ├── SK: SCHOOL#school-3 (Shelbyville High)                         │    │
│  │  └── (Completely isolated from Tenant A)                            │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  Isolation Guarantees:                                                       │
│  • Every query MUST include TENANT# in PK or GSI1PK                         │
│  • No cross-tenant queries possible by design                               │
│  • IAM policies enforce tenant boundaries at API level                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 4.4.6 DynamoDB Cost Optimization

| Strategy | Implementation | Savings |
|----------|---------------|---------|
| **On-Demand Capacity** | Pay-per-request for unpredictable workloads | No over-provisioning |
| **TTL for Sessions** | Auto-delete expired sessions (24h) | Reduced storage |
| **TTL for Analytics** | Auto-delete old metrics (90 days) | Reduced storage |
| **DAX Caching** | Read-through cache for hot data | Reduced RCUs |
| **Sparse Indexes** | Only project needed attributes to GSIs | Reduced WCUs |
| **Batch Operations** | BatchWriteItem for bulk attendance | Reduced API calls |

#### 4.4.7 DynamoDB Streams for Event-Driven Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DYNAMODB STREAMS INTEGRATION                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  edforge-main table                                                          │
│        │                                                                     │
│        ▼ (DynamoDB Streams - NEW_AND_OLD_IMAGES)                            │
│  ┌─────────────────┐                                                        │
│  │  Stream Record  │                                                        │
│  └────────┬────────┘                                                        │
│           │                                                                  │
│           ▼                                                                  │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │ Lambda Trigger  │───▶│  EventBridge    │───▶│  Target Services │         │
│  │ (Stream Handler)│    │  (Event Router) │    │                  │         │
│  └─────────────────┘    └─────────────────┘    │  • Analytics     │         │
│                                                 │  • Notifications │         │
│  Event Types Emitted:                           │  • Ed-Fi Sync    │         │
│  • student.created                              │  • Audit Logs    │         │
│  • attendance.marked                            └─────────────────┘         │
│  • grade.updated                                                            │
│  • invoice.paid                                                             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 4.4.8 FERPA Compliance Considerations

| Requirement | DynamoDB Implementation |
|-------------|------------------------|
| **Data Encryption** | AWS-managed encryption at rest (AES-256) |
| **Access Logging** | CloudTrail + DynamoDB Streams for audit trail |
| **Data Isolation** | Tenant ID in every partition key |
| **Backup/Recovery** | Point-in-time recovery enabled |
| **Data Retention** | TTL for automatic purging, retention policies |
| **Access Control** | IAM policies with tenant-scoped conditions |

---

## 5. Authentication & Authorization (ABAC)

### 5.1 Role Hierarchy

```
GlobalRole (Tenant-level)
 ├── TenantAdmin     → Full access across all schools
 └── StandardUser    → School-specific access

SchoolRole (Per-school assignment)
 ├── Principal       → Full school access + approval rights
 ├── Teacher         → Class-level access + grading
 ├── Accountant      → Finance access
 ├── Staff           → Limited operational access
 ├── Student         → Student portal only
 └── Parent          → Parent portal only (read-only)
```

### 5.2 User Identity Structure

```typescript
interface UserIdentity {
  id: string
  email: string
  name: string
  globalRole: 'TenantAdmin' | 'StandardUser'
  tenantId: string
  // Map of SchoolID → Role within that school
  assignments: Record<string, SchoolRole>
  childrenIds?: string[]  // For Parent users
}
```

### 5.3 Permission Check Pattern

```typescript
// Frontend checks permissions like this:
const canEditStudents = usePermission('edit', 'students')

// Backend should implement equivalent:
function canPerform(
  userId: string,
  action: Action,
  resource: Resource,
  context: { tenantId: string; schoolId?: string; targetId?: string }
): boolean

// Actions: 'view' | 'create' | 'edit' | 'delete' | 'manage' | 'approve' | 'send' | 'export'
```

### 5.4 ABAC Resources by Domain

**Academics (15 resources):**
```
students, teachers, grades, gradelevels, curriculum, classes,
classrooms, calendar, attendance, enrollment, assessments,
gradebook, scheduling, courses, standards
```

**Finance (5 resources):**
```
billing, payroll, expenses, tuition, reports:finance
```

**HR (6 resources):**
```
staff, staff:assignments, hr, hr:payroll, hr:contracts,
hr:professional-dev, hr:performance-reviews
```

**Communications (4 resources):**
```
communications, announcements, messages, notifications
```

**Analytics (4 resources):**
```
analytics, analytics:academic, analytics:financial, analytics:attendance
```

**Special Programs (3 resources):**
```
special-programs, special-programs:ieps, special-programs:504
```

**Portals (10 resources):**
```
student-portal, student-portal:grades, student-portal:attendance,
student-portal:schedule, student-portal:assignments,
parent-portal, parent-portal:grades, parent-portal:attendance,
parent-portal:fees, parent-portal:schedule
```

**Settings (3 resources):**
```
settings, settings:school, settings:tenant
```

**Integrations (6 resources):**
```
edfi, edfi:connections, edfi:mapping, edfi:sync,
integrations:google, integrations:microsoft
```

---

## 6. Shared Entity Types

The `@edforge/types` package defines canonical entity structures:

### 6.1 Person Entity (Discriminated Union)

```typescript
type Person = Student | Teacher | Staff | Admin | Guardian

interface BasePerson {
  id: string
  firstName: string
  lastName: string
  email: string
  phone?: string
  dateOfBirth?: string
  address?: Address
  status: 'active' | 'inactive' | 'pending' | 'on_leave' | 'graduated' | 'suspended' | 'terminated'
  createdAt: string
  updatedAt: string
}

// Student extends BasePerson with:
interface StudentData {
  type: 'student'
  studentId: string
  grade: string
  enrollmentDate: string
  guardianIds: string[]
}

// Teacher extends BasePerson with:
interface TeacherData extends EmployeeBase {
  type: 'teacher'
  subjects: string[]
  grades: string[]
}
```

### 6.2 Backend Type Guards

Implement server-side type guards mirroring frontend:

```typescript
function isStudent(person: Person): person is Student {
  return person.type === 'student'
}

function isEmployee(person: Person): person is Teacher | Staff | Admin {
  return ['teacher', 'staff', 'admin'].includes(person.type)
}
```

---

## 7. API Design Recommendations

### 7.1 RESTful Endpoints by Module

```bash
# ============================================================================
# IDENTITY SERVICE (ECS)
# ============================================================================
POST   /auth/login
POST   /auth/logout
POST   /auth/refresh
GET    /auth/me
GET    /users/:id
PATCH  /users/:id

# ============================================================================
# TENANT SERVICE (Lambda)
# ============================================================================
GET    /tenants/:tenantId
GET    /tenants/:tenantId/schools
POST   /tenants/:tenantId/schools
GET    /tenants/:tenantId/schools/:schoolId
PATCH  /tenants/:tenantId/schools/:schoolId
GET    /tenants/:tenantId/school-years
POST   /tenants/:tenantId/school-years

# ============================================================================
# ACADEMICS SERVICE (ECS) - Consolidated Routes
# ============================================================================
# Students (consolidated view)
GET    /academics/students                    # List with filters
POST   /academics/students                    # Create
GET    /academics/students/:id                # Get by ID
PATCH  /academics/students/:id                # Update
DELETE /academics/students/:id                # Delete
GET    /academics/students/:id/enrollment     # Enrollment history
GET    /academics/students/:id/grades         # Grade summary

# Attendance (elevated for daily use)
GET    /academics/attendance                  # List by date/class
POST   /academics/attendance/bulk             # Bulk create
PATCH  /academics/attendance/:id              # Update single
GET    /academics/attendance/summary          # Daily summary

# Grades & Assessments (consolidated)
GET    /academics/grades                      # Gradebook view
POST   /academics/grades                      # Enter grades
GET    /academics/assessments                 # List assessments
POST   /academics/assessments                 # Create assessment
GET    /academics/gradebook/:classId          # Class gradebook

# Scheduling (consolidated)
GET    /academics/scheduling/classrooms       # Room list
GET    /academics/scheduling/schedules        # Class schedules
GET    /academics/scheduling/timetables       # Visual timetables
POST   /academics/scheduling/schedules        # Create schedule

# Curriculum (consolidated)
GET    /academics/curriculum/courses          # Course catalog
GET    /academics/curriculum/grade-levels     # Grade level config
GET    /academics/curriculum/standards        # Learning standards
POST   /academics/curriculum/courses          # Create course

# ============================================================================
# FINANCE SERVICE (Lambda) - Consolidated Routes
# ============================================================================
# Ledger (specialist view)
GET    /finance/ledger                        # ?type=gl|ap|ar
GET    /finance/ledger/transactions           # Transaction list
POST   /finance/ledger/transactions           # Create transaction

# Billing (consolidated)
GET    /finance/billing/invoices              # List invoices
POST   /finance/billing/invoices              # Create invoice
GET    /finance/billing/fee-structures        # Fee config
POST   /finance/billing/payments              # Record payment

# Expenses (consolidated)
GET    /finance/expenses                      # ?status=pending|approved
POST   /finance/expenses                      # Submit expense
PATCH  /finance/expenses/:id/approve          # Approve expense
GET    /finance/expenses/budgets              # Budget overview

# ============================================================================
# HR SERVICE (Lambda) - Consolidated Routes
# ============================================================================
# Staff Directory
GET    /hr/staff                              # ?department=&status=
POST   /hr/staff                              # Create staff
GET    /hr/staff/:id                          # Get by ID
PATCH  /hr/staff/:id                          # Update

# HR Admin (tabbed view)
GET    /hr/admin/payroll                      # ?period=
POST   /hr/admin/payroll/run                  # Run payroll
GET    /hr/admin/contracts                    # ?employeeId=
POST   /hr/admin/contracts                    # Create contract
GET    /hr/admin/professional-dev             # PD records
GET    /hr/admin/performance-reviews          # Reviews

# ============================================================================
# COMMUNICATIONS SERVICE (Lambda)
# ============================================================================
GET    /communications/messages               # Inbox
POST   /communications/messages               # Send message
GET    /communications/announcements          # List
POST   /communications/announcements          # Create
POST   /communications/announcements/:id/send # Publish

# ============================================================================
# ANALYTICS SERVICE (Lambda)
# ============================================================================
GET    /analytics/academic                    # Academic performance
GET    /analytics/attendance                  # Attendance trends
GET    /analytics/financial                   # Financial reports
GET    /analytics/enrollment                  # Enrollment trends
GET    /analytics/comparisons                 # Cross-school comparison
POST   /analytics/reports/custom              # Custom report builder
GET    /analytics/exports/:id                 # Download export

# ============================================================================
# SPECIAL PROGRAMS SERVICE (Lambda)
# ============================================================================
GET    /special-programs/ieps                 # IEP list
POST   /special-programs/ieps                 # Create IEP
GET    /special-programs/ieps/:id             # IEP detail
GET    /special-programs/ieps/:id/meetings    # IEP meetings
GET    /special-programs/ieps/:id/goals       # Goals & objectives
GET    /special-programs/504-plans            # 504 Plans
POST   /special-programs/504-plans            # Create 504
GET    /special-programs/accommodations       # Accommodations list
GET    /special-programs/interventions        # Interventions
GET    /special-programs/counseling           # Counseling records

# ============================================================================
# ED-FI INTEGRATION SERVICE (Lambda + Step Functions)
# ============================================================================
# Configuration
GET    /edfi/connections                      # List connections
POST   /edfi/connections                      # Create connection
DELETE /edfi/connections/:id                  # Remove connection
GET    /edfi/mapping                          # Descriptor mappings
PUT    /edfi/mapping                          # Update mappings

# Sync Operations
POST   /edfi/sync/start                       # Trigger sync
GET    /edfi/sync/:jobId/status               # Job status
GET    /edfi/sync/history                     # Sync history

# Monitoring
GET    /edfi/errors                           # ?severity=critical|warning
GET    /edfi/errors/:id                       # Error detail
POST   /edfi/errors/:id/resolve               # Mark resolved
```

### 7.2 Request Context (Required Headers)

Every API request from the frontend includes:

```
Authorization: Bearer <jwt>
X-Tenant-ID: <tenantId>
X-School-ID: <activeSchoolId>   // When school context is active
X-Request-ID: <uuid>            // For distributed tracing
X-User-Role: <schoolRole>       // Current role in active school
```

### 7.3 Standard Response Shape

```typescript
// Success
{
  data: T | T[],
  meta?: {
    total: number,
    page: number,
    pageSize: number,
    hasMore: boolean
  }
}

// Error
{
  error: {
    code: string,
    message: string,
    details?: Record<string, string[]>,
    traceId?: string
  }
}
```

---

## 8. Frontend → Backend Communication

### 8.1 Data Flow Architecture

```
┌──────────────┐     TanStack Query     ┌──────────────┐
│   UI Layer   │  ←─────────────────→   │  API Client  │
│  (Components)│                        │  (fetch/axios)│
└──────────────┘                        └──────────────┘
                                               │
                                               ▼
                                        ┌──────────────┐
                                        │  API Gateway │
                                        │  (Kong/AWS)  │
                                        └──────────────┘
                                               │
              ┌────────────────────────────────┼────────────────────────────────┐
              ▼                                ▼                                ▼
       ┌──────────────┐               ┌──────────────┐               ┌──────────────┐
       │identity-svc  │               │academics-svc │               │ finance-svc  │
       │    (ECS)     │               │    (ECS)     │               │  (Lambda)    │
       └──────────────┘               └──────────────┘               └──────────────┘
```

### 8.2 Frontend Query Keys (for backend cache coordination)

```typescript
// Query key patterns used by frontend (TanStack Query):
['tenant', tenantId]
['schools', tenantId]
['students', { tenantId, schoolId, page, filters }]
['student', studentId]
['attendance', { schoolId, date, classId }]
['grades', { studentId, termId }]
['gradebook', { classId, termId }]
['invoices', { tenantId, status, page }]
['employees', { schoolId, department }]
['ieps', { schoolId, status }]
['edfi-sync', { jobId }]
```

---

## 9. Module Federation Configuration

### 9.1 Environment & Ports

| App | Dev Port | Module Federation Name | Exposed Modules |
|-----|----------|------------------------|-----------------|
| Shell | 3000 | shell | - (Host only) |
| Ed-Fi | 3001 | edfi | EdFiModule |
| Academics | 3002 | academics | AcademicsModule |
| Finance | 3003 | finance | FinanceModule |
| Special Programs | 3005 | special_programs | SpecialProgramsModule |
| People | 3006 | people | PeopleModule |
| Messages | 3007 | messages | MessagesModule |
| Analytics | 3008 | analytics | AnalyticsModule |

### 9.2 Shared Dependencies

```typescript
// All remotes share these singleton dependencies:
shared: {
  react: { singleton: true, requiredVersion: '^19.0.0', eager: true },
  'react-dom': { singleton: true, requiredVersion: '^19.0.0', eager: true },
  '@tanstack/react-query': { singleton: true },
  '@tanstack/react-router': { singleton: true },
  zustand: { singleton: true },
  '@edforge/ui': { singleton: true },
  '@edforge/abac': { singleton: true },
  '@edforge/types': { singleton: true },
  '@edforge/theme': { singleton: true },
  'framer-motion': { singleton: true },
}
```

### 9.3 Remote Module Exposure

Each remote exposes its main module:

```typescript
// Example: academics/rsbuild.config.ts
exposes: {
  './AcademicsModule': './src/bootstrap.tsx',
}
```

---

## 10. Monorepo Package Structure

```
edforge-mfe/
├── apps/
│   ├── shell/              # Main orchestrator (port 3000)
│   ├── academics/          # Academic management (port 3002)
│   ├── finance/            # Financial management (port 3003)
│   ├── edfi/               # Ed-Fi integration (port 3001)
│   ├── special-programs/   # Special education (port 3005)
│   ├── people/             # HR and staff (port 3006)
│   ├── messages/           # Communications (port 3007)
│   └── analytics/          # Reporting (port 3008)
├── packages/
│   ├── types/              # Shared TypeScript types
│   ├── abac/               # Permission engine + hooks
│   ├── ui/                 # Shared UI components
│   ├── theme/              # Tailwind theme + CSS
│   ├── forms/              # Form components + schemas
│   ├── wizard/             # Multi-step wizard
│   ├── config/             # Shared build/lint configs
│   └── shell-components/   # ModuleOverviewPage
└── docs/
    ├── ARCHITECTURE_KNOWLEDGE_KIT.md (this file)
    └── TECHNICAL_STATUS_REPORT.md
```

---

## 11. Key Takeaways for Backend Engineers

1. **Follow Frontend Module Boundaries**: Each frontend module maps to a backend service with clear API boundaries.

2. **DynamoDB Single-Table Design**: Use composite keys with `TENANT#<id>` as partition key prefix for all entities. Every query must be tenant-scoped.

3. **Multi-Tenant Isolation**: 
   - Partition key always includes tenant ID
   - GSI1 scopes queries to school level
   - No cross-tenant queries possible by design

4. **Implement ABAC**: Use the same `Action × Resource` matrix defined in `@edforge/abac`. TenantAdmin bypasses school-level checks.

5. **Person is Polymorphic**: Use discriminated unions with `type` field for type-safe handling. Store type in SK prefix (e.g., `STUDENT#`, `TEACHER#`).

6. **Consolidated Routes**: Frontend uses workflow-oriented navigation. APIs should reflect this grouping (e.g., `/academics/grades` handles gradebook, assessments, and exams).

7. **Portals are Views**: Student/Parent portals use existing service APIs with restricted permissions—no separate backend needed.

8. **Ed-Fi is Integration**: Separate service for state data exchange with Step Functions for orchestration.

9. **ECS vs Lambda Decision**:
   - **ECS**: identity-service (session state), academics-service (high frequency)
   - **Lambda**: Everything else (cost optimization)

10. **DynamoDB Best Practices**:
    - Use On-Demand capacity for unpredictable workloads
    - Enable TTL for sessions (24h) and analytics (90 days)
    - Use DAX for read-heavy hot data
    - Leverage DynamoDB Streams for event-driven architecture
    - Batch operations for bulk writes (attendance, grades)

11. **Async Processing**: Use SQS/SNS for cross-service events, DynamoDB Streams + EventBridge for data change events, Step Functions for complex workflows.

12. **Cost Optimization**:
    - On-Demand capacity (no over-provisioning)
    - Sparse GSIs (project only needed attributes)
    - TTL for automatic data cleanup
    - CloudFront for static assets

---

*Last Updated: December 2024*
*Version: 2.1.0*
