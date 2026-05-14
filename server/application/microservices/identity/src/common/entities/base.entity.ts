/**
 * Base Entity Types for Identity Service
 * 
 * DynamoDB Single-Table Design:
 * - Table: edforge-identity-{tier}
 * - PK: tenantId (TENANT#{tid})
 * - SK: entityKey (varies by entity type)
 * 
 * GSI1 (Email Lookup): GSI1PK=EMAIL#{email}, GSI1SK=TENANT#{tid}
 * GSI2 (Session Token): GSI2PK=TOKEN#{tokenHash}, GSI2SK={expiry}
 */

/**
 * Base entity interface for all identity entities
 */
export interface BaseEntity {
  tenantId: string;
  entityKey: string;
  entityType: EntityType;
  
  // Audit fields
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
}

/**
 * Entity types in the identity service
 */
export type EntityType = 
  | 'USER' 
  | 'SESSION' 
  | 'ROLE_ASSIGNMENT' 
  | 'USER_PREFERENCES' 
  | 'TENANT' 
  | 'SCHOOL' 
  | 'ACADEMIC_YEAR' 
  | 'TERM' 
  | 'CONFIG' 
  | 'DEPARTMENT' 
  | 'HOLIDAY'
  // Education Organizations (EdOrg hierarchy)
  | 'STATE_EDUCATION_AGENCY'
  | 'LOCAL_EDUCATION_AGENCY'
  | 'EDUCATION_SERVICE_CENTER'
  | 'EDUCATION_ORG_NETWORK'
  | 'NETWORK_ASSOCIATION'
  // Staff Management
  | 'STAFF'
  | 'STAFF_ASSIGNMENT'
  | 'STAFF_EMPLOYMENT_HISTORY'
  | 'STAFF_TRAINING'
  | 'CREDENTIAL'
  | 'LEAVE'
  | 'LEAVE_BALANCE'
  // Calendar Management
  | 'BELLSCHEDULE'
  | 'CALENDARDATE'
  | 'CALENDAR'
  | 'ACADEMIC_SESSION'
  // Master Schedule (Ed-Fi aligned)
  | 'CLASSPERIOD'
  | 'LOCATION'
  // Workspace Settings
  | 'WORKSPACE_SETTINGS'
  // Audit
  | 'AUDIT_LOG'
  // IEMIS (Sprint 1+)
  | 'IEMIS_AUDIT_EVENT'
  // Idempotency (Sprint S0.10 — foundation only, rollout deferred per endpoint)
  | 'IDEMPOTENCY_KEY';

/**
 * Tenant tier
 */
export type TenantTier = 'basic' | 'premium' | 'advanced';

/**
 * Tenant status
 */
export type TenantStatus = 'active' | 'inactive' | 'suspended' | 'trial';

/**
 * School status
 */
export type SchoolStatus = 'active' | 'inactive' | 'setup' | 'suspended' | 'closed';

/**
 * Academic year status
 */
export type AcademicYearStatus = 'planning' | 'active' | 'completed' | 'archived';

/**
 * Term type
 */
export type TermType = 'semester' | 'quarter' | 'trimester' | 'year';

/**
 * Global roles (tenant-level)
 */
export type GlobalRole = 'TenantAdmin' | 'TenantUser';

/**
 * School roles (per-school assignment)
 */
export type SchoolRole = 'Principal' | 'VicePrincipal' | 'Teacher' | 'Accountant' | 'Staff' | 'Counselor' | 'Nurse' | 'Student' | 'Parent';

/**
 * User status
 */
export type UserStatus = 'active' | 'inactive' | 'pending' | 'suspended' | 'locked';

/**
 * Session status
 */
export type SessionStatus = 'active' | 'expired' | 'revoked';

/**
 * Entity key builder for consistent key generation
 */
export const EntityKeyBuilder = {
  /**
   * User: USER#{userId}
   */
  user: (userId: string): string => `USER#${userId}`,

  /**
   * Session: SESSION#{sessionId}
   */
  session: (sessionId: string): string => `SESSION#${sessionId}`,

  /**
   * Role Assignment: USER#{userId}#ROLE#{schoolId}
   */
  roleAssignment: (userId: string, schoolId: string): string => 
    `USER#${userId}#ROLE#${schoolId}`,

  /**
   * User Preferences: USER#{userId}#PREFS
   */
  userPreferences: (userId: string): string => `USER#${userId}#PREFS`,

  /**
   * Tenant Metadata: METADATA
   */
  tenantMetadata: (): string => 'METADATA',

  /**
   * School: SCHOOL#{schoolId}
   */
  school: (schoolId: string): string => `SCHOOL#${schoolId}`,

  /**
   * Academic Year: SCHOOL#{schoolId}#YEAR#{yearId}
   */
  academicYear: (schoolId: string, yearId: string): string => 
    `SCHOOL#${schoolId}#YEAR#${yearId}`,

  /**
   * Term: SCHOOL#{schoolId}#YEAR#{yearId}#TERM#{termId}
   */
  term: (schoolId: string, yearId: string, termId: string): string => 
    `SCHOOL#${schoolId}#YEAR#${yearId}#TERM#${termId}`,

  /**
   * School Config: SCHOOL#{schoolId}#CONFIG
   */
  schoolConfig: (schoolId: string): string => `SCHOOL#${schoolId}#CONFIG`,

  /**
   * State Education Agency: SEA#{seaId}
   */
  sea: (seaId: string): string => `SEA#${seaId}`,

  /**
   * Local Education Agency: LEA#{leaId}
   */
  lea: (leaId: string): string => `LEA#${leaId}`,

  /**
   * Education Service Center: ESC#{escId}
   */
  esc: (escId: string): string => `ESC#${escId}`,

  /**
   * Education Organization Network: NETWORK#{networkId}
   */
  network: (networkId: string): string => `NETWORK#${networkId}`,

  /**
   * Network Association: NETWORK#{networkId}#MEMBER#{orgId}
   */
  networkMember: (networkId: string, orgId: string): string =>
    `NETWORK#${networkId}#MEMBER#${orgId}`,

  /**
   * Staff Assignment: STAFF#{staffId}#ASSIGN#{assignmentId}
   */
  staffAssignment: (staffId: string, assignmentId: string): string =>
    `STAFF#${staffId}#ASSIGN#${assignmentId}`,

  /**
   * Staff Employment History: STAFF#{staffId}#EMPHIST#{timestamp}
   */
  staffEmploymentHistory: (staffId: string, timestamp: string): string =>
    `STAFF#${staffId}#EMPHIST#${timestamp}`,

  /**
   * Calendar: SCHOOL#{schoolId}#CALENDAR#{calendarId}
   */
  calendar: (schoolId: string, calendarId: string): string =>
    `SCHOOL#${schoolId}#CALENDAR#${calendarId}`,

  /**
   * Academic Session: SCHOOL#{schoolId}#ACADSESSION#{sessionId}
   */
  academicSession: (schoolId: string, sessionId: string): string =>
    `SCHOOL#${schoolId}#ACADSESSION#${sessionId}`,

  /**
   * Class Period: SCHOOL#{schoolId}#PERIOD#{periodId}
   */
  classPeriod: (schoolId: string, periodId: string): string =>
    `SCHOOL#${schoolId}#PERIOD#${periodId}`,

  /**
   * Location: SCHOOL#{schoolId}#LOCATION#{locationId}
   */
  location: (schoolId: string, locationId: string): string =>
    `SCHOOL#${schoolId}#LOCATION#${locationId}`,

  /**
   * Workspace Settings: SETTINGS#WORKSPACE
   */
  workspaceSettings: (): string => 'SETTINGS#WORKSPACE',
};

/**
 * GSI key builders
 */
export const GSIKeyBuilder = {
  /**
   * GSI1 (Email lookup): EMAIL#{email}
   */
  emailLookup: (email: string): string => `EMAIL#${email.toLowerCase()}`,

  /**
   * GSI2 (Token lookup): TOKEN#{tokenHash}
   */
  tokenLookup: (tokenHash: string): string => `TOKEN#${tokenHash}`,

  /**
   * GSI1PK (Subdomain lookup): SUBDOMAIN#{subdomain}
   */
  subdomain: (subdomain: string): string => `SUBDOMAIN#${subdomain.toLowerCase()}`,

  /**
   * GSI3PK (School-Users lookup): TENANT#{tenantId}#SCHOOL#{schoolId}
   */
  schoolUsers: (tenantId: string, schoolId: string): string =>
    `TENANT#${tenantId}#SCHOOL#${schoolId}`,

  /**
   * GSI3SK (School-Users sort): ROLE#{role}#USER#{userId}
   */
  schoolUserRole: (role: string, userId: string): string =>
    `ROLE#${role}#USER#${userId}`,

  /**
   * GSI1PK (EdOrg: LEA/ESC by SEA): TENANT#{tenantId}#SEA#{seaId}
   */
  seaChildren: (tenantId: string, seaId: string): string =>
    `TENANT#${tenantId}#SEA#${seaId}`,

  /**
   * GSI1PK (Staff Assignments by School): TENANT#{tenantId}#SCHOOL#{schoolId}
   */
  schoolStaffAssignments: (tenantId: string, schoolId: string): string =>
    `TENANT#${tenantId}#SCHOOL#${schoolId}`,

  /**
   * GSI1PK (Networks by Member Org): TENANT#{tenantId}#ORG#{orgId}
   */
  orgNetworks: (tenantId: string, orgId: string): string =>
    `TENANT#${tenantId}#ORG#${orgId}`,
};

/**
 * Request context extracted from JWT
 */
export interface RequestContext {
  userId: string;
  tenantId: string;
  email: string;
  globalRole: GlobalRole;
  jwtToken: string;
  username?: string; // Cognito username from JWT (cognito:username claim)
  userPoolId?: string;
  appClientId?: string;
}

/**
 * Pagination result
 */
export interface PaginatedResult<T> {
  items: T[];
  lastEvaluatedKey?: string;
  hasMore: boolean;
  total?: number;
}

