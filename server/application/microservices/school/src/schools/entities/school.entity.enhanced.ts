/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * School Service Entities for DynamoDB Single-Table Design
 * 
 * ARCHITECTURE NOTES:
 * - All entities stored in ONE DynamoDB table: school-table-{tier}
 * - Partition Key (PK): tenantId - ensures tenant isolation at infrastructure level
 * - Sort Key (SK): entityKey - hierarchical structure for entity relationships
 * - GSIs enable efficient queries across entity types
 * - Optimistic locking via version field prevents concurrent modification issues
 * - All timestamps in ISO 8601 format for global compatibility
 * - Timezone stored with each school for accurate date/time operations
 */

/**
 * Base interface for all entities in school service
 * Ensures consistent audit fields and DynamoDB keys
 */
export interface BaseEntity {
  // DynamoDB Primary Keys
  tenantId: string;        // PK - ensures data isolation per tenant
  entityKey: string;       // SK - composite key like SCHOOL#schoolId or SCHOOL#schoolId#YEAR#yearId
  
  // Entity metadata
  entityType: string;      // Discriminator for entity type (SCHOOL, ACADEMIC_YEAR, etc.)
  
  // Audit fields (required for FERPA compliance)
  createdAt: string;       // ISO 8601 timestamp
  createdBy: string;       // userId from JWT
  updatedAt: string;       // ISO 8601 timestamp
  updatedBy: string;       // userId from JWT
  version: number;         // For optimistic locking - prevents concurrent update conflicts
}

/**
 * School - Core entity representing an educational institution
 * 
 * BUSINESS RULES:
 * - schoolCode must be unique within tenant
 * - status transitions must be validated
 * - timezone required for all date/time operations (global customers)
 * - currentEnrollment updated via events from Student Service
 * 
 * ACCESS PATTERN: Get school by ID
 * - Query: PK=tenantId, SK=SCHOOL#schoolId
 */
export interface School extends BaseEntity {
  // Core Identity
  schoolId: string;                // UUID - globally unique school identifier
  schoolName: string;              // Display name (3-255 chars)
  schoolCode: string;              // Tenant-unique code (e.g., "MAIN-HS-001")
  schoolType: 'elementary' | 'middle' | 'high' | 'k12' | 'alternative' | 'special';
  
  // Contact Information (structured for international support)
  contactInfo: {
    primaryEmail: string;          // Validated email format
    primaryPhone: string;          // E.164 format (+1-555-0123)
    secondaryPhone?: string;       // Optional backup number
    website?: string;              // Validated URL format
    fax?: string;                  // Legacy systems support
  };
  
  // Address (supports global deployments)
  address: {
    street: string;
    city: string;
    state: string;                 // Province/State/Region
    country: string;               // ISO 3166-1 alpha-2 code (US, CA, GB, etc.)
    postalCode: string;
    latitude?: number;             // For mapping/routing
    longitude?: number;            // For mapping/routing
    timezone: string;              // IANA timezone (America/New_York, Europe/London, Asia/Tokyo)
                                   // CRITICAL: Required for accurate date/time operations across timezones
  };
  
  // Administrative
  principalUserId?: string;        // References User from Control Plane (Cognito)
  vicePrincipalUserIds?: string[]; // Multiple VPs supported
  administrativeStaffCount?: number;
  
  // Capacity & Scale
  maxStudentCapacity: number;      // Hard limit for school enrollment
  currentEnrollment?: number;      // Denormalized from Student Service events (real-time)
  gradeRange: {
    lowestGrade: string;           // "K", "1", "2", etc.
    highestGrade: string;          // "5", "8", "12", etc.
  };
  
  // Operational Status
  status: 'active' | 'inactive' | 'suspended' | 'closed' | 'planned';
  statusReason?: string;           // Human-readable explanation for status
  accreditationInfo?: {
    accreditedBy: string[];        // List of accrediting bodies
    accreditationExpiry?: string;  // ISO date
  };
  
  // Metadata
  foundedDate?: string;            // ISO date
  description?: string;            // Free text description
  motto?: string;                  // School motto/mission
  logoUrl?: string;                // S3 or CDN URL
  
  // DynamoDB entity metadata
  entityType: 'SCHOOL';
  entityKey: string;               // Format: SCHOOL#schoolId
  
  // GSI Keys for efficient queries
  gsi1pk: string;                  // schoolId (query all entities for this school)
  gsi1sk: string;                  // METADATA#schoolId
  gsi3pk: string;                  // tenantId#SCHOOL (list all schools for tenant)
  gsi3sk: string;                  // status#createdAt (filter by status, sort by creation)
}

/**
 * Academic Year - Temporal boundary entity
 * 
 * BUSINESS RULES:
 * - Only ONE academic year can have isCurrent=true per school
 * - Start date must be before end date
 * - Status transitions: planned → active → completed → archived
 * - Cannot delete if enrollments exist
 * - Dates immutable once status is 'completed'
 * 
 * TEMPORAL BOUNDARIES:
 * - All academic operations scoped to an academic year
 * - Enrollment, grading, attendance all reference academicYearId
 * - Historical data preserved with year context
 * 
 * ACCESS PATTERNS:
 * 1. Get all years for school: GSI1-PK=schoolId, SK begins_with YEAR#
 * 2. Get current year: GSI1-PK=schoolId, FilterExpression: isCurrent=true
 * 3. Get year by ID: PK=tenantId, SK=SCHOOL#schoolId#YEAR#yearId
 */
export interface AcademicYear extends BaseEntity {
  // Relationships
  schoolId: string;                // Parent school
  academicYearId: string;          // UUID
  
  // Identity
  yearName: string;                // Display name: "2024-2025", "Academic Year 2024"
  yearCode: string;                // Short code: "AY24", "2024-25"
  
  // Temporal Boundaries (ISO 8601 dates)
  startDate: string;               // First day of academic year
  endDate: string;                 // Last day of academic year
  
  // Status Management
  status: 'planned' | 'active' | 'completed' | 'archived';
  isCurrent: boolean;              // CRITICAL: Only ONE can be true per school
                                   // Enforced via transaction in setCurrentAcademicYear()
  
  // Academic Structure (flexible per school)
  structure: {
    semesterCount: number;         // 2, 3, or 4
    gradingPeriodCount: number;    // Total grading periods (quarters, trimesters)
    instructionalDays: number;     // Actual teaching days (excluding holidays)
    schoolDays: number;            // Total school days (including prof dev, etc.)
  };
  
  // Financial Context (for budget/tuition planning)
  tuitionRates?: {
    [gradeLevel: string]: {        // Key: "K", "1", "9", "12"
      amount: number;
      currency: string;            // ISO 4217 code (USD, EUR, GBP, etc.)
      frequency: 'annual' | 'semester' | 'monthly';
    };
  };
  
  // Enrollment Planning
  enrollmentTargets?: {
    total: number;                 // School-wide target
    byGrade: { [grade: string]: number };
  };
  
  // DynamoDB keys
  entityType: 'ACADEMIC_YEAR';
  entityKey: string;               // Format: SCHOOL#schoolId#YEAR#yearId
  
  // GSI keys
  gsi1pk: string;                  // schoolId
  gsi1sk: string;                  // YEAR#yearId
  gsi2pk: string;                  // schoolId#academicYearId (for year-scoped queries)
}

/**
 * Grading Period - Sub-divisions of academic year
 * 
 * BUSINESS RULES:
 * - Must be within academic year date boundaries
 * - Cannot overlap with other periods in same year
 * - Ordered by periodNumber
 * - Dates immutable once status is 'completed'
 * 
 * ACCESS PATTERN: Get periods for year
 * - Query: GSI2-PK=schoolId#academicYearId, SK begins_with PERIOD#
 */
export interface GradingPeriod extends BaseEntity {
  // Relationships
  schoolId: string;
  academicYearId: string;          // Parent academic year
  gradingPeriodId: string;         // UUID
  
  // Identity
  periodName: string;              // "Fall Semester", "Q1", "Trimester 1"
  periodType: 'semester' | 'quarter' | 'trimester' | 'custom';
  periodNumber: number;            // Sequence: 1, 2, 3, 4
  
  // Temporal
  startDate: string;               // ISO date
  endDate: string;                 // ISO date
  
  // Status
  status: 'planned' | 'active' | 'completed';
  isCurrent: boolean;              // Currently active period
  
  // Academic Milestones
  instructionalDays: number;       // Teaching days in this period
  gradesDueDate?: string;          // When teachers must submit grades (ISO date)
  reportCardDate?: string;         // When report cards issued (ISO date)
  
  // DynamoDB keys
  entityType: 'GRADING_PERIOD';
  entityKey: string;               // Format: SCHOOL#schoolId#YEAR#yearId#PERIOD#periodId
  
  // GSI keys
  gsi2pk: string;                  // schoolId#academicYearId
  gsi2sk: string;                  // PERIOD#periodNumber (for sorting)
}

/**
 * Holiday - Non-instructional days
 * 
 * BUSINESS RULES:
 * - Must be within academic year boundaries
 * - Can be recurring (e.g., weekly holidays)
 * - Affects attendance and payroll calculations
 * 
 * ACCESS PATTERN: Get holidays for year
 * - Query: GSI2-PK=schoolId#academicYearId, SK begins_with HOLIDAY#
 */
export interface Holiday extends BaseEntity {
  // Relationships
  schoolId: string;
  academicYearId: string;
  holidayId: string;               // UUID
  
  // Identity
  name: string;                    // "Thanksgiving Break", "Winter Holiday", "Eid al-Fitr"
  type: 'holiday' | 'professional_day' | 'weather_closure' | 'emergency';
  
  // Temporal
  startDate: string;               // ISO date
  endDate: string;                 // ISO date (can be same as startDate)
  allDay: boolean;                 // True for full day, false for partial
  
  // Details
  description?: string;            // Additional context
  isRecurring: boolean;            // Weekly holidays (e.g., Friday for some schools)
  recurrencePattern?: string;      // RRULE format or cron-like pattern
  
  // Impact Assessment
  affectsAttendance: boolean;      // Should this count toward attendance metrics?
  affectsPayroll: boolean;         // Do staff get paid for this day?
  
  // DynamoDB keys
  entityType: 'HOLIDAY';
  entityKey: string;               // Format: SCHOOL#schoolId#YEAR#yearId#HOLIDAY#holidayId
  
  // GSI keys
  gsi2pk: string;                  // schoolId#academicYearId
  gsi2sk: string;                  // HOLIDAY#startDate (for date sorting)
}

/**
 * Department - Organizational unit within school
 * 
 * BUSINESS RULES:
 * - departmentCode must be unique within school
 * - staffing counts denormalized from Staff Service events
 * - Budget tracked per academic year
 * 
 * ACCESS PATTERN: Get departments for school
 * - Query: GSI1-PK=schoolId, SK begins_with DEPT#
 */
export interface Department extends BaseEntity {
  // Relationships
  schoolId: string;
  departmentId: string;            // UUID
  
  // Identity
  departmentName: string;          // "Mathematics", "Science", "Physical Education"
  departmentCode: string;          // Short code: "MATH", "SCI", "PE"
  category: 'academic' | 'administrative' | 'support' | 'athletic';
  
  // Leadership
  headOfDepartmentUserId?: string; // References User Service
  assistantHeadUserId?: string;    // Optional assistant
  
  // Academic Scope
  academicScope: {
    gradeLevels: string[];         // Which grades this dept serves: ["9", "10", "11", "12"]
    subjects: string[];            // Subject areas: ["Algebra", "Geometry", "Calculus"]
    curriculumStandards: string[]; // "Common Core", "State Standards", "IB", "AP"
  };
  
  // Staffing (denormalized from Staff Service for quick access)
  staffing: {
    allocatedPositions: number;    // Planned positions
    filledPositions: number;       // Currently filled (updated via events)
    vacantPositions: number;       // Calculated: allocated - filled
  };
  
  // Resources
  resources: {
    facilities: Array<{
      type: 'lab' | 'office' | 'classroom' | 'storage';
      roomId: string;              // References Classroom entity
    }>;
    equipment: Array<{
      category: string;            // "Lab Equipment", "Sports Equipment"
      quantity: number;
      description: string;
    }>;
  };
  
  // Status
  status: 'active' | 'inactive' | 'dissolved';
  
  // DynamoDB keys
  entityType: 'DEPARTMENT';
  entityKey: string;               // Format: SCHOOL#schoolId#DEPT#deptId
  
  // GSI keys
  gsi1pk: string;                  // schoolId
  gsi1sk: string;                  // DEPT#deptId
}

/**
 * Department Budget - Annual budget per department
 * 
 * BUSINESS RULES:
 * - One budget per department per academic year
 * - Status: draft → approved → active → closed
 * - Expenditures denormalized from Finance Service
 * 
 * ACCESS PATTERN: Get budgets for year
 * - Query: GSI2-PK=schoolId#academicYearId, SK begins_with DEPT# and contains BUDGET
 */
export interface DepartmentBudget extends BaseEntity {
  // Relationships
  schoolId: string;
  departmentId: string;
  academicYearId: string;          // Budget scoped to academic year
  budgetId: string;                // UUID
  
  // Financial
  annualBudget: {
    amount: number;
    currency: string;              // ISO 4217 code
  };
  
  // Budget Allocations by Category
  allocations: Array<{
    category: 'salaries' | 'supplies' | 'equipment' | 'training' | 'other';
    allocated: number;             // Budget allocated
    spent: number;                 // Actually spent (from Finance Service)
    committed: number;             // Encumbered/committed funds
    available: number;             // Calculated: allocated - spent - committed
  }>;
  
  // Expenditure Summary (detailed tracking in Finance Service)
  expenditures: Array<{
    date: string;                  // ISO date
    amount: number;
    category: string;
    description: string;
    referenceId?: string;          // Link to Finance Service transaction
  }>;
  
  // Status & Approval
  status: 'draft' | 'approved' | 'active' | 'closed';
  approvedBy?: string;             // userId
  approvedAt?: string;             // ISO timestamp
  
  // DynamoDB keys
  entityType: 'DEPT_BUDGET';
  entityKey: string;               // Format: SCHOOL#schoolId#DEPT#deptId#BUDGET#yearId
  
  // GSI keys
  gsi2pk: string;                  // schoolId#academicYearId
  gsi2sk: string;                  // DEPT#deptId#BUDGET
}

/**
 * School Configuration - Operational parameters and settings
 * 
 * RATIONALE: Separated from School entity for:
 * 1. Independent caching (configs change rarely)
 * 2. Version control (track config changes separately)
 * 3. Easier updates (don't need full school object)
 * 
 * CACHING: Cache for 1 hour (configs rarely change)
 * Invalidate on update event
 */
export interface SchoolConfiguration extends BaseEntity {
  // Relationship
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
      minimumAttendance: number;   // Percentage
      minimumGPA?: number;
      requiredCredits?: number;    // For high school
    };
    reportCardFrequency: 'quarterly' | 'semester' | 'trimester' | 'custom';
  };
  
  // Attendance Settings
  attendanceSettings: {
    requiredAttendancePercentage: number;
    lateArrivalGraceMinutes: number;
    trackingMethod: 'period' | 'daily' | 'both';
    absenceTypes: Array<{
      code: string;                // "EXC", "UNX", "TAR" (tardy)
      label: string;
      excused: boolean;
    }>;
  };
  
  // Calendar Settings
  calendarSettings: {
    weekStart: 'sunday' | 'monday';
    schoolDaysPerWeek: number;     // Usually 5, some schools 6
    instructionalMinutesPerDay: number;
    instructionalDaysRequired: number; // State requirement (e.g., 180 days)
    bellSchedules: Array<{
      name: string;                // "Regular", "Early Dismissal", "Late Start"
      type: 'regular' | 'early_dismissal' | 'late_start';
      periods: Array<{
        name: string;              // "Period 1", "Lunch", "Assembly"
        startTime: string;         // HH:mm format (24-hour)
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
      provider?: string;           // "Twilio", "SNS", etc.
    };
    pushNotifications: {
      enabled: boolean;
    };
    parentPortalEnabled: boolean;
  };
  
  // Security & Privacy
  securitySettings: {
    dataRetentionYears: number;    // FERPA minimum: 2 years
    exportEnabled: boolean;        // Can users export data?
    apiAccessEnabled: boolean;     // REST API access
    requireMFA: boolean;           // Multi-factor authentication
    sessionTimeoutMinutes: number;
  };
  
  // Feature Flags (for gradual rollout)
  featureFlags: {
    [featureName: string]: boolean;
  };
  
  // DynamoDB keys
  entityType: 'SCHOOL_CONFIG';
  entityKey: string;               // Format: SCHOOL#schoolId#CONFIG
  
  // GSI keys
  gsi1pk: string;                  // schoolId
  gsi1sk: string;                  // CONFIG#current
}

/**
 * School Activity Log - Audit trail for compliance
 * 
 * COMPLIANCE: FERPA requires 2-year audit trail
 * - TTL set to 2 years from creation
 * - Immutable - never updated or deleted
 * - Captures WHO, WHAT, WHEN, WHERE for every operation
 * 
 * PARTITIONING: By schoolId#date for efficient date-range queries
 * 
 * ACCESS PATTERN: Get logs for date range
 * - Query: GSI4-PK=schoolId#date, SK begins_with timestamp
 */
export interface SchoolActivityLog {
  // DynamoDB keys
  tenantId: string;                // PK
  entityKey: string;               // SK: Format: LOG#schoolId#timestamp#activityId
  
  // Relationships
  schoolId: string;
  activityId: string;              // UUID
  
  // Temporal (for efficient querying)
  timestamp: string;               // ISO 8601 with milliseconds
  date: string;                    // YYYY-MM-DD (for partitioning)
  
  // Actor (WHO)
  userId: string;                  // Who performed the action
  userRole: string;                // Their role at time of action
  userName?: string;               // Display name for reporting
  
  // Action (WHAT)
  action: string;                  // CREATE_SCHOOL, UPDATE_CONFIG, DELETE_DEPARTMENT
  targetEntityType: string;        // SCHOOL, DEPARTMENT, ACADEMIC_YEAR (what was affected)
  targetEntityId: string;          // Affected entity ID
  
  // Details
  changes?: {
    before: any;                   // State before change
    after: any;                    // State after change
  };
  description: string;             // Human-readable description
  
  // Context (WHERE/HOW)
  ipAddress?: string;              // Client IP (for security monitoring)
  userAgent?: string;              // Browser/client info
  sessionId?: string;              // Session identifier
  
  // Severity (for monitoring/alerting)
  severity: 'info' | 'warning' | 'error' | 'critical';
  
  // Compliance
  complianceCategory?: 'FERPA' | 'data_access' | 'configuration' | 'security';
  
  // TTL (DynamoDB auto-deletion)
  ttl: number;                     // Unix timestamp (2 years from creation)
  
  // DynamoDB metadata (this entity IS an activity log)
  entityType: 'ACTIVITY_LOG';
  
  // GSI4 keys (time-series index)
  gsi4pk: string;                  // schoolId#date (for daily partitioning)
  gsi4sk: string;                  // timestamp#activityId (for sorting)
}

/**
 * Request Context - Metadata passed with every request
 * Used for audit logging and security tracking
 */
export interface RequestContext {
  userId: string;                  // From JWT
  userRole: string;                // From JWT custom claims
  userName?: string;               // Display name
  tenantId: string;                // From JWT custom claims
  ipAddress?: string;              // From request headers
  userAgent?: string;              // From request headers
  sessionId?: string;              // From custom header
  jwtToken: string;                // Full JWT for service calls
}

/**
 * Entity Key Builder Utilities
 * Ensures consistent key formats across the service
 */
export class EntityKeyBuilder {
  static school(schoolId: string): string {
    return `SCHOOL#${schoolId}`;
  }
  
  static schoolConfig(schoolId: string): string {
    return `SCHOOL#${schoolId}#CONFIG`;
  }
  
  static academicYear(schoolId: string, yearId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${yearId}`;
  }
  
  static gradingPeriod(schoolId: string, yearId: string, periodId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${yearId}#PERIOD#${periodId}`;
  }
  
  static holiday(schoolId: string, yearId: string, holidayId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${yearId}#HOLIDAY#${holidayId}`;
  }
  
  static department(schoolId: string, deptId: string): string {
    return `SCHOOL#${schoolId}#DEPT#${deptId}`;
  }
  
  static departmentBudget(schoolId: string, deptId: string, yearId: string): string {
    return `SCHOOL#${schoolId}#DEPT#${deptId}#BUDGET#${yearId}`;
  }
  
  static activityLog(schoolId: string, timestamp: string, activityId: string): string {
    return `LOG#${schoolId}#${timestamp}#${activityId}`;
  }
}

