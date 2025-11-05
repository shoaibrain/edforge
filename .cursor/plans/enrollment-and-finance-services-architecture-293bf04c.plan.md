<!-- 293bf04c-6a29-4ab2-8ce1-db2bcb4dc546 f37ba49a-987a-4e65-8813-8e9598c375ad -->
# Enrollment and Finance Services - Shared Table Architecture

## Executive Summary

This plan designs Enrollment and Finance services to use the **SAME shared DynamoDB table** (`school-table-{tier}`) as School and Academic services, following the established single-table design pattern. This approach maximizes cost efficiency, enables atomic transactions, and maintains enterprise-grade security and compliance.

---

## Current Architecture (Corrected Understanding)

### Shared Table: `school-table-{tier}`

**Table Structure**:

- **PK**: `tenantId` (partition key - ensures tenant isolation)
- **SK**: `entityKey` (sort key - hierarchical entity identification)
- **Existing GSIs**: GSI1-GSI6 (used by School and Academic services)

**School Service Entities** (in shared table):

- `SCHOOL#schoolId` - School
- `SCHOOL#schoolId#CONFIG` - School Configuration
- `SCHOOL#schoolId#YEAR#yearId` - Academic Year
- `SCHOOL#schoolId#YEAR#yearId#PERIOD#periodId` - Grading Period
- `SCHOOL#schoolId#YEAR#yearId#HOLIDAY#holidayId` - Holiday
- `SCHOOL#schoolId#DEPT#deptId` - Department
- `SCHOOL#schoolId#DEPT#deptId#BUDGET#yearId` - Department Budget

**Academic Service Entities** (same shared table):

- `SCHOOL#schoolId#YEAR#yearId#CLASSROOM#classroomId` - Classroom
- `SCHOOL#schoolId#YEAR#yearId#CLASSROOM#classroomId#ASSIGNMENT#assignmentId` - Assignment
- `SCHOOL#schoolId#YEAR#yearId#STUDENT#studentId#ASSIGNMENT#assignmentId#GRADE` - Grade
- `SCHOOL#schoolId#YEAR#yearId#STUDENT#studentId#ATTENDANCE#date` - Attendance

**User Service**: Uses Cognito UserPool (no DynamoDB table)

**Existing GSIs**:

- GSI1: `gsi1pk` = schoolId, `gsi1sk` = entity pattern (school-centric queries)
- GSI2: `gsi2pk` = schoolId#academicYearId, `gsi2sk` = entity pattern (year-scoped queries)
- GSI3: `gsi3pk` = assignmentId/studentId#yearId, `gsi3sk` = entity pattern (academic queries)
- GSI4: `gsi4pk` = category/term, `gsi4sk` = entity pattern (academic analytics)
- GSI5: `gsi5pk` = term pattern, `gsi5sk` = entity pattern (academic analytics)
- GSI6: `gsi6pk` = schoolId#yearId, `gsi6sk` = entity pattern (academic by school)

---

## Architecture Decisions

### Decision 1: Shared Table Strategy (CRITICAL)

**Decision**: Enrollment and Finance services use the **SAME shared table** `school-table-{tier}`.

**Rationale**:

1. **Cost Optimization**: 

   - One table = one set of provisioned capacity (~$25-50/month vs $75-150/month for separate tables)
   - One backup policy, one monitoring setup
   - **60-70% cost reduction** vs separate tables

2. **Atomic Transactions**: Can update student enrollment + invoice + school capacity in single DynamoDB transaction
3. **Consistency**: Follows established pattern (School + Academic already share table)
4. **GSI Efficiency**: Reuse existing GSIs where possible, minimal new GSIs
5. **Tenant Isolation**: Same tenantId partition key ensures infrastructure-level isolation

**Cost Analysis**:

- Separate tables: 3 tables × $0.25/month base + capacity = ~$75-150/month
- Shared table: 1 table × $0.25/month + capacity = ~$25-50/month
- **Savings: $50-100/month for basic tier**

### Decision 2: Entity Key Design Strategy

**Decision**: Use hierarchical entity keys that fit existing patterns and enable efficient GSI queries.

**Key Patterns**:

- Student: `STUDENT#studentId` (standalone, queried by studentId)
- Enrollment: `SCHOOL#schoolId#YEAR#yearId#STUDENT#studentId#ENROLLMENT` (fits school/year hierarchy)
- Tuition Config: `SCHOOL#schoolId#YEAR#yearId#TUITION_CONFIG` (follows existing pattern)
- Invoice: `SCHOOL#schoolId#YEAR#yearId#STUDENT#studentId#INVOICE#invoiceId` (hierarchical, queryable)
- Payment: `INVOICE#invoiceId#PAYMENT#paymentId` (invoice-centric, efficient lookups)
- Receipt: `PAYMENT#paymentId#RECEIPT#receiptId` (payment-centric)

**Rationale**:

- Hierarchical keys enable efficient queries on GSI2 (schoolId#yearId)
- Consistent with existing entity key patterns
- Supports parent-child relationships naturally
- Enables atomic transactions (all related entities in same partition)

### Decision 3: GSI Strategy - Cost Optimization

**Decision**: Reuse existing GSIs where possible, add 2 new GSIs only for critical access patterns.

**GSI Reuse Analysis**:

- **GSI1** (schoolId): Can be reused for student/enrollment queries by school
- **GSI2** (schoolId#academicYearId): Perfect for enrollment/invoice queries by school/year
- **GSI3-GSI6**: Used by Academic service, may conflict if reused

**New GSIs Needed**:

1. **GSI7**: Student-centric queries

   - PK: `gsi7pk` = studentId
   - SK: `gsi7sk` = entityType#yearId#entityId
   - Use case: Get all enrollments/invoices for a student across years
   - Cost: ~$0.25/month base + ~$2-5/month capacity = ~$2.25-5.25/month

2. **GSI8**: Invoice status/date queries (for overdue detection)

   - PK: `gsi8pk` = schoolId#yearId#status (e.g., "schoolId#yearId#overdue")
   - SK: `gsi8sk` = dueDate#invoiceId
   - Use case: Find all overdue invoices efficiently
   - Cost: ~$0.25/month base + ~$2-5/month capacity = ~$2.25-5.25/month

**Total GSI Cost Addition**: ~$4.50-10.50/month (vs $50-100/month for separate tables)

**Alternative (no new GSIs)**: Would require table scans or multiple queries = expensive and slow

### Decision 4: Data Normalization vs Denormalization

**Decision**: Strategic denormalization for read optimization, minimize duplication.

**Normalized (Single Source of Truth)**:

- Student profile: One record per student (`STUDENT#studentId`)
- Tuition configuration: One record per school/year (`SCHOOL#schoolId#YEAR#yearId#TUITION_CONFIG`)
- Invoice: One record per invoice (line items stored in invoice, not duplicated)

**Denormalized (for Performance)**:

- Enrollment record includes: studentId, schoolId, yearId, grade, status, enrollmentDate (readily available)
- Invoice includes: studentId, schoolId, yearId, tuitionRate snapshot (for audit trail), fees snapshot
- Student billing account includes: currentBalance (calculated, updated on payment)

**Rationale**:

- Read performance: Most queries need school/year context, so denormalize key fields
- Write performance: Update balance on payment, but don't duplicate invoice line items
- Storage cost: Minimal duplication (key fields only), saves query costs
- Audit trail: Snapshots preserve historical state (important for compliance)

### Decision 5: Student Entity Location

**Decision**: Student entity managed by **Enrollment Service** (same microservice).

**Rationale**:

- Enrollment and student profile are tightly coupled (enroll → create/update student)
- Atomic transactions needed (student + enrollment in same transaction)
- Single service simplifies MVP implementation

### Decision 6: Medical Records Strategy

**Decision**: Medical records stored as part of Student entity (encrypted), not separate entity.

**Rationale**:

- Medical info is PII, tightly coupled with student
- Single record = single encryption key, simpler security
- Rarely queried independently (only when needed for emergency/health)
- Reduces GSI complexity

**Security**: Encrypt medical fields at application level before storing in DynamoDB (AWS KMS).

### Decision 7: Tuition Configuration Design

**Decision**: Comprehensive tuition configuration supporting per-school, per-year, per-grade customization.

**Rationale**:

- Schools have different tuition structures (e.g., elementary vs high school)
- Tuition may change year-over-year (inflation, policy changes)
- Grade-level variations (e.g., K-5 different from 6-8)
- Supports complex fee structures (registration, technology, activity fees)
- Supports discount policies (sibling discounts, early payment, scholarships)

---

## Enrollment Service Design

### Entities in Shared Table

#### 1. Student (Core Entity)

```typescript
interface Student extends BaseEntity {
  // DynamoDB Keys
  tenantId: string; // PK
  entityKey: string; // SK: STUDENT#studentId
  entityType: 'STUDENT';
  
  // Identity
  studentId: string; // UUID
  studentNumber: string; // Unique within tenant (e.g., "STU-2024-001")
  firstName: string;
  lastName: string;
  middleName?: string;
  dateOfBirth: string; // ISO date
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  
  // Contact Information
  contactInfo: {
    email?: string;
    phone?: string;
    address: {
      street: string;
      city: string;
      state: string;
      country: string; // ISO 3166-1 alpha-2
      postalCode: string;
    };
  };
  
  // Parent/Guardian Information
  guardians: Array<{
    guardianId: string; // UUID
    relationship: 'parent' | 'guardian' | 'emergency_contact';
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    isPrimary: boolean;
  }>;
  
  // Medical/Emergency (ENCRYPTED at rest)
  medicalInfo?: {
    allergies?: string[]; // Encrypted
    medications?: string[]; // Encrypted
    emergencyContact: {
      name: string; // Encrypted
      phone: string; // Encrypted
      relationship: string;
    };
  };
  
  // Current Enrollment Status (denormalized for quick access)
  currentEnrollment?: {
    schoolId: string;
    academicYearId: string;
    gradeLevel: string;
    status: 'active' | 'suspended' | 'graduated' | 'transferred' | 'withdrawn';
  };
  
  // Audit
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
  
  // GSI Keys
  gsi1pk: string; // schoolId (if enrolled) or "UNENROLLED" (reuse GSI1)
  gsi1sk: string; // STUDENT#studentId
  gsi7pk: string; // studentId (new GSI7 for student-centric queries)
  gsi7sk: string; // STUDENT#current
}
```

#### 2. Enrollment (Temporal Entity)

```typescript
interface Enrollment extends BaseEntity {
  // DynamoDB Keys
  tenantId: string; // PK
  entityKey: string; // SK: SCHOOL#schoolId#YEAR#yearId#STUDENT#studentId#ENROLLMENT
  entityType: 'ENROLLMENT';
  
  // Relationships
  studentId: string;
  schoolId: string;
  academicYearId: string;
  enrollmentId: string; // UUID
  
  // Enrollment Details
  enrollmentDate: string; // ISO date
  gradeLevel: string; // "K", "1", "2", ..., "12"
  section?: string; // "A", "B", "C" (if multiple sections per grade)
  
  // Status
  status: 'pending' | 'active' | 'suspended' | 'graduated' | 'transferred' | 'withdrawn';
  statusReason?: string;
  statusDate: string; // When status changed
  
  // Transfer Information
  transferredFrom?: {
    schoolId: string;
    schoolName: string;
    transferDate: string;
  };
  transferredTo?: {
    schoolId: string;
    schoolName: string;
    transferDate: string;
  };
  
  // Academic Progress (denormalized from Academic Service)
  academicStatus: 'on_track' | 'at_risk' | 'probation' | 'honor_roll';
  promotionEligible: boolean;
  graduationDate?: string; // ISO date
  
  // Audit
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
  
  // GSI Keys
  gsi1pk: string; // schoolId
  gsi1sk: string; // ENROLLMENT#yearId#studentId
  gsi2pk: string; // schoolId#academicYearId (reuse GSI2 - perfect fit!)
  gsi2sk: string; // ENROLLMENT#status#studentId
  gsi7pk: string; // studentId (new GSI7)
  gsi7sk: string; // ENROLLMENT#yearId#status
}
```

#### 3. Enrollment History (Audit Trail)

```typescript
interface EnrollmentHistory extends BaseEntity {
  // DynamoDB Keys
  tenantId: string; // PK
  entityKey: string; // SK: STUDENT#studentId#HISTORY#timestamp#changeId
  entityType: 'ENROLLMENT_HISTORY';
  
  // Relationships
  studentId: string;
  schoolId: string;
  academicYearId: string;
  
  // Change Details
  changeType: 'enrolled' | 'status_changed' | 'grade_changed' | 'transferred' | 'graduated' | 'withdrawn';
  previousStatus?: string;
  newStatus?: string;
  changes: {
    before: any;
    after: any;
  };
  
  // Context
  reason: string;
  authorizedBy: string; // userId
  
  // TTL for auto-deletion (FERPA compliance - 2 years)
  ttl: number; // Unix timestamp
  
  // GSI Keys
  gsi2pk: string; // schoolId#academicYearId (reuse GSI2)
  gsi2sk: string; // HISTORY#date#changeId
  gsi7pk: string; // studentId (new GSI7)
  gsi7sk: string; // HISTORY#timestamp#changeId
}
```

### Access Patterns

| Pattern | Description | Query Method | GSI |

|---------|-------------|--------------|-----|

| AP1 | Get student by ID | PK=tenantId, SK=STUDENT#studentId | - |

| AP2 | List students in school/year | GSI2: gsi2pk=schoolId#yearId, gsi2sk begins_with ENROLLMENT#active | GSI2 |

| AP3 | Get student enrollment history | GSI7: gsi7pk=studentId, gsi7sk begins_with ENROLLMENT# | GSI7 |

| AP4 | List active enrollments by grade | GSI2: gsi2pk=schoolId#yearId, FilterExpression: gradeLevel=X AND status=active | GSI2 |

| AP5 | Get enrollment by student/year | GSI7: gsi7pk=studentId, gsi7sk=ENROLLMENT#yearId# | GSI7 |

| AP6 | Enrollment changes by date | GSI2: gsi2pk=schoolId#yearId, gsi2sk begins_with HISTORY#date | GSI2 |

### Business Rules

1. **Enrollment Validation**:

   - Check school capacity (query School entity)
   - Verify academic year is active (query AcademicYear entity)
   - Validate grade level matches school's grade range
   - Check for duplicate enrollment (query GSI2)

2. **Status Transitions**:

   - `prospective` → `pending` → `active` → `graduated`/`transferred`/`withdrawn`
   - `active` → `suspended` → `active` or `withdrawn`
   - Cannot go from `graduated`/`transferred`/`withdrawn` back to `active`

3. **Transfer Process** (Atomic Transaction):

   - Create withdrawal enrollment at source school
   - Create new enrollment at destination school
   - Update student currentEnrollment
   - All in single DynamoDB transaction

4. **Graduation Process**:

   - Verify graduation requirements (query Academic Service for GPA/credits)
   - Update enrollment status to `graduated`
   - Set graduation date
   - Create enrollment history record

---

## Finance/Billing Service Design

### Entities in Shared Table

#### 1. Tuition Configuration

```typescript
interface TuitionConfiguration extends BaseEntity {
  // DynamoDB Keys
  tenantId: string; // PK
  entityKey: string; // SK: SCHOOL#schoolId#YEAR#yearId#TUITION_CONFIG
  entityType: 'TUITION_CONFIG';
  
  // Relationships
  schoolId: string;
  academicYearId: string;
  
  // Tuition Rates by Grade
  tuitionRates: {
    [gradeLevel: string]: { // "K", "1", "2", ..., "12"
      amount: number;
      currency: string; // ISO 4217 (USD, EUR, etc.)
      frequency: 'annual' | 'semester' | 'monthly' | 'quarterly';
      dueDates?: string[]; // ISO dates for payment due dates
      description?: string; // Optional description
    };
  };
  
  // Fees (One-time and recurring)
  fees: Array<{
    feeId: string; // UUID
    feeName: string;
    feeType: 'registration' | 'technology' | 'activity' | 'lab' | 'sports' | 'field_trip' | 'uniform' | 'other';
    amount: number;
    frequency: 'one_time' | 'annual' | 'semester' | 'monthly' | 'per_course';
    isMandatory: boolean;
    applicableGrades?: string[]; // If null/empty, applies to all grades
    description?: string;
  }>;
  
  // Discounts/Scholarships
  discountPolicies: Array<{
    policyId: string; // UUID
    name: string;
    type: 'sibling' | 'early_payment' | 'scholarship' | 'financial_aid' | 'staff_discount' | 'custom';
    discountPercentage?: number; // e.g., 10 for 10%
    discountAmount?: number; // Fixed discount amount
    conditions: string; // Human-readable conditions
    applicableTo: 'tuition' | 'fees' | 'both';
    maxDiscount?: number; // Maximum discount cap
  }>;
  
  // Payment Plans
  paymentPlans: Array<{
    planId: string; // UUID
    planName: string; // "Full Payment", "Monthly Installments", "Semester Plan"
    installmentCount: number; // 1 = full payment, 12 = monthly, 2 = semester
    installmentAmount: number; // Calculated or fixed
    dueDates: string[]; // ISO dates for each installment
  }>;
  
  // Tax Configuration
  taxSettings?: {
    taxEnabled: boolean;
    taxRate: number; // Percentage (e.g., 8.5 for 8.5%)
    taxExemptItems?: string[]; // Fee types exempt from tax
  };
  
  // Audit
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
  
  // GSI Keys
  gsi1pk: string; // schoolId
  gsi1sk: string; // TUITION_CONFIG#yearId
  gsi2pk: string; // schoolId#academicYearId (reuse GSI2)
  gsi2sk: string; // TUITION_CONFIG#current
}
```

#### 2. Student Billing Account

```typescript
interface StudentBillingAccount extends BaseEntity {
  // DynamoDB Keys
  tenantId: string; // PK
  entityKey: string; // SK: SCHOOL#schoolId#YEAR#yearId#STUDENT#studentId#ACCOUNT
  entityType: 'BILLING_ACCOUNT';
  
  // Relationships
  studentId: string;
  schoolId: string;
  academicYearId: string;
  accountId: string; // UUID
  
  // Account Balance (denormalized for quick access)
  balance: {
    totalDue: number; // Sum of all invoices
    totalPaid: number; // Sum of all payments
    totalOutstanding: number; // Calculated: totalDue - totalPaid
    currency: string;
    lastUpdated: string; // ISO timestamp
  };
  
  // Payment Terms
  paymentPlan: 'full' | 'installment' | 'custom';
  installmentCount?: number;
  installmentAmount?: number;
  nextDueDate?: string; // ISO date
  
  // Status
  status: 'active' | 'paid_in_full' | 'overdue' | 'on_hold' | 'cancelled';
  
  // Audit
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
  
  // GSI Keys
  gsi2pk: string; // schoolId#academicYearId (reuse GSI2)
  gsi2sk: string; // ACCOUNT#status#studentId
  gsi7pk: string; // studentId (new GSI7)
  gsi7sk: string; // ACCOUNT#yearId
}
```

#### 3. Invoice

```typescript
interface Invoice extends BaseEntity {
  // DynamoDB Keys
  tenantId: string; // PK
  entityKey: string; // SK: SCHOOL#schoolId#YEAR#yearId#STUDENT#studentId#INVOICE#invoiceId
  entityType: 'INVOICE';
  
  // Relationships
  studentId: string;
  schoolId: string;
  academicYearId: string;
  accountId: string; // Links to StudentBillingAccount
  invoiceId: string; // UUID
  invoiceNumber: string; // Human-readable: "INV-2024-001"
  
  // Invoice Details
  issueDate: string; // ISO date
  dueDate: string; // ISO date
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled' | 'partially_paid';
  
  // Line Items (tuition, fees, discounts)
  lineItems: Array<{
    itemId: string; // UUID
    description: string;
    category: 'tuition' | 'fee' | 'discount' | 'adjustment' | 'refund' | 'other';
    quantity: number;
    unitPrice: number;
    amount: number; // quantity × unitPrice
    tax?: number;
    // Snapshot of tuition config at time of invoice (for audit)
    sourceConfig?: {
      tuitionConfigId?: string;
      feeId?: string;
      discountPolicyId?: string;
    };
  }>;
  
  // Totals
  subtotal: number;
  tax: number;
  discounts: number;
  total: number;
  currency: string;
  
  // Payment Tracking (denormalized for quick access)
  payments: Array<{
    paymentId: string;
    amount: number;
    paymentDate: string; // ISO date
    paymentMethod: 'cash' | 'check' | 'bank_transfer' | 'credit_card' | 'debit_card' | 'other';
    referenceNumber?: string;
    notes?: string;
  }>;
  
  amountPaid: number; // Sum of payments (calculated)
  amountDue: number; // total - amountPaid (calculated)
  
  // Audit
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
  
  // GSI Keys
  gsi2pk: string; // schoolId#academicYearId (reuse GSI2)
  gsi2sk: string; // INVOICE#status#dueDate#invoiceNumber
  gsi7pk: string; // studentId (new GSI7)
  gsi7sk: string; // INVOICE#dueDate#invoiceId
  gsi8pk: string; // schoolId#yearId#status (new GSI8 for overdue queries)
  gsi8sk: string; // dueDate#invoiceId
}
```

#### 4. Payment

```typescript
interface Payment extends BaseEntity {
  // DynamoDB Keys
  tenantId: string; // PK
  entityKey: string; // SK: INVOICE#invoiceId#PAYMENT#paymentId
  entityType: 'PAYMENT';
  
  // Relationships
  invoiceId: string;
  studentId: string;
  schoolId: string;
  academicYearId: string;
  accountId: string;
  paymentId: string; // UUID
  
  // Payment Details
  amount: number;
  currency: string;
  paymentDate: string; // ISO date
  paymentMethod: 'cash' | 'check' | 'bank_transfer' | 'credit_card' | 'debit_card' | 'other';
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'refunded';
  
  // Reference Information
  referenceNumber?: string; // Check number, transaction ID, etc.
  notes?: string;
  receivedBy?: string; // userId of person who received payment
  
  // Future: Payment Gateway Integration
  gatewayTransactionId?: string;
  gatewayResponse?: any;
  
  // Audit
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
  
  // GSI Keys
  gsi7pk: string; // studentId (new GSI7)
  gsi7sk: string; // PAYMENT#paymentDate#paymentId
  // Note: Invoice lookup via entityKey (INVOICE#invoiceId#PAYMENT#paymentId)
}
```

#### 5. Receipt (Optional - can be generated on-demand)

```typescript
interface Receipt extends BaseEntity {
  // DynamoDB Keys
  tenantId: string; // PK
  entityKey: string; // SK: PAYMENT#paymentId#RECEIPT#receiptId
  entityType: 'RECEIPT';
  
  // Relationships
  paymentId: string;
  invoiceId: string;
  studentId: string;
  receiptId: string; // UUID
  receiptNumber: string; // Human-readable: "RCP-2024-001"
  
  // Receipt Details
  issueDate: string; // ISO date
  amount: number;
  currency: string;
  paymentMethod: string;
  
  // Line Items (snapshot from invoice)
  lineItems: Array<{
    description: string;
    amount: number;
  }>;
  
  // Audit
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
}
```

### Access Patterns

| Pattern | Description | Query Method | GSI |

|---------|-------------|--------------|-----|

| AP1 | Get tuition config for school/year | PK=tenantId, SK=SCHOOL#schoolId#YEAR#yearId#TUITION_CONFIG | - |

| AP2 | List billing accounts by school/year | GSI2: gsi2pk=schoolId#yearId, gsi2sk begins_with ACCOUNT# | GSI2 |

| AP3 | Get student invoices | GSI7: gsi7pk=studentId, gsi7sk begins_with INVOICE# | GSI7 |

| AP4 | Get invoices for account | Query by invoice entityKey (accountId in invoice record) | - |

| AP5 | List overdue invoices | GSI8: gsi8pk=schoolId#yearId#overdue, gsi8sk < today | GSI8 |

| AP6 | Get payments for student | GSI7: gsi7pk=studentId, gsi7sk begins_with PAYMENT# | GSI7 |

| AP7 | Get payments for invoice | PK=tenantId, SK begins_with INVOICE#invoiceId#PAYMENT# | - |

### Business Rules

1. **Invoice Generation** (on enrollment):

   - Query tuition config for school/year
   - Apply tuition rate for student's grade level
   - Apply applicable fees (check mandatory flags, grade applicability)
   - Apply discounts (sibling, early payment, scholarships)
   - Calculate tax (if enabled)
   - Create invoice record
   - Update billing account balance

2. **Payment Recording**:

   - Create payment record
   - Update invoice: add payment to payments array, update amountPaid, update status
   - Update billing account: update totalPaid, totalOutstanding, status
   - All in single transaction

3. **Overdue Detection** (scheduled job):

   - Query GSI8: gsi8pk=schoolId#yearId#overdue, gsi8sk < today
   - Update invoice status to 'overdue'
   - Update account status to 'overdue'
   - Generate notifications

4. **Financial Reporting**:

   - Total revenue: Sum all paid invoices by school/year
   - Outstanding balances: Sum all outstanding invoices by school
   - Payment trends: Query payments by date range

---

## Cost Analysis

### DynamoDB Costs (per month)

**Shared Table** (`school-table-{tier}`):

- Base cost: $0.25/month (one table)
- Provisioned capacity: ~$25-50/month (read/write units)
- **Total: ~$25-50/month**

**New GSIs** (GSI7, GSI8):

- Base cost: $0.25/month × 2 = $0.50/month
- Provisioned capacity: ~$4-10/month (read/write units)
- **Total: ~$4.50-10.50/month**

**Total Additional Cost**:

- Basic tier: ~$29.50-60.50/month (vs $75-150/month for separate tables)
- **Savings: $45.50-89.50/month (60-70% reduction)**

### Storage Costs

**Estimated Data Sizes**:

- Student: ~2-5 KB per student
- Enrollment: ~1-2 KB per enrollment
- Invoice: ~3-5 KB per invoice (with line items)
- Payment: ~1 KB per payment

**1000 students, 1 year**:

- Students: 1000 × 3 KB = 3 MB
- Enrollments: 1000 × 1.5 KB = 1.5 MB
- Invoices: 1000 × 4 KB = 4 MB
- Payments: 2000 × 1 KB = 2 MB
- **Total: ~10.5 MB**

**Storage Cost**: $0.25/GB/month × 0.01 GB = **$0.0025/month** (negligible)

---

## Security & Compliance

### 1. Tenant Isolation

- **Partition Key = tenantId**: Infrastructure-level isolation
- **IAM Policies**: Enforce tenant-scoped access (LeadingKeys condition)
- **Application-Level**: Always validate tenantId from JWT matches data tenantId

### 2. PII Protection

- **Student Data**: Contains PII (DOB, address, medical info)
- **Encryption**: Encrypt medical fields at application level (AWS KMS) before storing
- **Access Logging**: Audit all PII access (FERPA compliance)
- **Data Retention**: TTL set to 2 years for audit logs (FERPA minimum)

### 3. Financial Data Security

- **IAM Policies**: Separate policies for finance operations (principle of least privilege)
- **Audit Trail**: All financial transactions logged (immutable)
- **Role-Based Access**: Only finance admins can modify invoices/payments
- **Encryption**: Financial data encrypted at rest (DynamoDB encryption)

### 4. Data Access Patterns

- **Read Operations**: Always include tenantId in query (enforced by IAM)
- **Write Operations**: Validate tenantId matches JWT
- **GSI Queries**: Application-level tenant filtering (GSIs don't support LeadingKeys)

---

## AI Readiness & Data Enablement

### 1. Structured Data Design

- **Consistent Entity Types**: All entities have explicit `entityType` discriminator
- **Structured Fields**: JSON fields are well-defined (not free-form)
- **Hierarchical Keys**: Enable efficient parent-child queries
- **Timestamps**: All dates in ISO 8601 format (machine-readable)

### 2. Query Optimization for Analytics

- **GSI Design**: Enables efficient aggregation queries (by school, year, status)
- **Denormalized Fields**: Balance, status fields for quick analytics
- **Historical Data**: Enrollment history, invoice snapshots for trend analysis

### 3. Future AI/ML Integration Points

- **Predictive Analytics**: Student at-risk detection (academic status, payment patterns)
- **Recommendation Engine**: Optimal payment plans, fee structures
- **Anomaly Detection**: Unusual enrollment patterns, payment fraud
- **Natural Language**: Query student records, generate reports

### 4. Data Export for Analytics

- **DynamoDB Streams**: Real-time data changes for analytics pipeline
- **S3 Export**: Periodic exports for data warehouse (Redshift, Athena)
- **API Endpoints**: Structured data access for BI tools

---

## Implementation Roadmap

### Phase 1: Enrollment Service Foundation (Week 1-2)

**Tasks**:

1. Create `enrollment` microservice directory structure
2. Define entities (Student, Enrollment, EnrollmentHistory) following shared table pattern
3. Implement DynamoDB client service (reuse existing pattern from Academic Service)
4. Create validation service
5. Implement Student CRUD operations
6. Add GSI7 to CDK infrastructure

**Deliverables**:

- Student entity with full CRUD
- GSI7 added to shared table
- Basic validation

### Phase 2: Enrollment Lifecycle (Week 3-4)

**Tasks**:

1. Implement enrollment operations:

   - `enrollStudent()` - Create enrollment with validation
   - `unenrollStudent()` - Withdraw from school
   - `transferStudent()` - Transfer between schools (atomic transaction)
   - `suspendStudent()` - Temporary suspension
   - `graduateStudent()` - Graduation with validation

2. Implement enrollment history tracking
3. Add status transition validation
4. Implement capacity checking (query School entity in same table)

**Deliverables**:

- Complete enrollment lifecycle
- Status transition management
- Atomic transactions

### Phase 3: Finance Service Foundation (Week 5-6)

**Tasks**:

1. Create `finance` microservice directory structure
2. Define entities (TuitionConfiguration, StudentBillingAccount, Invoice, Payment)
3. Implement DynamoDB client service
4. Create validation service
5. Implement tuition configuration CRUD
6. Add GSI8 to CDK infrastructure

**Deliverables**:

- Tuition configuration management
- GSI8 added to shared table

### Phase 4: Billing Operations (Week 7-8)

**Tasks**:

1. Implement invoice generation:

   - Auto-generate on enrollment (query tuition config)
   - Apply tuition rates by grade
   - Apply fees and discounts
   - Calculate tax

2. Implement payment recording (manual entry)
3. Implement invoice status management
4. Implement account balance updates (atomic transactions)
5. Add overdue detection (scheduled Lambda/ECS task)

**Deliverables**:

- Complete billing workflow
- Invoice management
- Payment tracking

### Phase 5: Integration & Testing (Week 9-10)

**Tasks**:

1. Integration testing:

   - Enrollment → Finance (invoice generation)
   - School Service → Enrollment (capacity updates)
   - Academic Service → Enrollment (graduation requirements)

2. End-to-end workflow testing
3. Performance testing (target: <100ms enrollment, <200ms invoice generation)
4. Documentation

**Deliverables**:

- Integration tests
- API documentation
- Deployment guide

### Phase 6: UI Integration (Week 11-12)

**Tasks**:

1. Create enrollment management UI
2. Create billing/invoice management UI
3. Create student profile pages
4. Add reporting dashboards

**Deliverables**:

- Complete UI for enrollment and billing
- User documentation

---

## Key Files to Create/Modify

### New Files

**Enrollment Service**:

- `server/application/microservices/enrollment/src/`
  - `students/` (entities, DTOs, service, controller)
  - `enrollments/` (entities, DTOs, service, controller)
  - `common/` (dynamodb-client, validation, errors)

**Finance Service**:

- `server/application/microservices/finance/src/`
  - `tuition/` (entities, DTOs, service, controller)
  - `billing/` (entities, DTOs, service, controller)
  - `invoices/` (entities, DTOs, service, controller)
  - `payments/` (entities, DTOs, service, controller)
  - `common/` (dynamodb-client, validation, errors)

**Documentation**:

- `server/application/microservices/enrollment/ARCHITECTURE_DECISIONS.md`
- `server/application/microservices/finance/ARCHITECTURE_DECISIONS.md`
- `server/application/microservices/enrollment/IMPLEMENTATION_GUIDE.md`
- `server/application/microservices/finance/IMPLEMENTATION_GUIDE.md`

### Modified Files

- `server/lib/tenant-template/ecs-dynamodb.ts` - Add GSI7 and GSI8 to table
- `server/lib/tenant-template/tenant-template-stack.ts` - Add enrollment and finance service deployments
- `server/lib/service-info.json` - Add service configurations (set TABLE_NAME to shared table)

---

## Success Criteria

1. ✅ Student can be enrolled in school for academic year
2. ✅ Enrollment status changes (suspend, transfer, graduate) work correctly
3. ✅ Tuition configuration can be set per school/year with grade-level variations
4. ✅ Invoice auto-generated on enrollment with proper fees and discounts
5. ✅ Payments can be recorded manually and update balances atomically
6. ✅ Account balances update correctly
7. ✅ All operations are tenant-isolated
8. ✅ Performance: <100ms for enrollment operations, <200ms for invoice generation
9. ✅ FERPA compliance: All operations audited
10. ✅ Cost: <$60/month additional for basic tier (vs $150/month for separate tables)

---

**Estimated Timeline**: 12 weeks for complete MVP implementation

**Team Required**: 2-3 backend engineers, 1 frontend engineer, 1 DevOps engineer

**Cost Savings**: 60-70% reduction vs separate tables approach

### To-dos

- [ ] Create Enrollment Service microservice with Student and Enrollment entities, DynamoDB table with GSIs, and basic CRUD operations
- [ ] Implement enrollment lifecycle operations (enroll, unenroll, transfer, suspend, graduate) with status transitions and event publishing
- [ ] Create Finance Service microservice with TuitionConfiguration, StudentBillingAccount, and Invoice entities, DynamoDB table with GSIs
- [ ] Implement invoice generation, payment recording, account balance updates, and overdue detection with event publishing
- [ ] Integration testing between Enrollment, Finance, School, and Academic services with end-to-end workflows
- [ ] Create UI for enrollment management, billing/invoice management, and student profiles with reporting dashboards