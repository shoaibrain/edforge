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
export type EntityType = 'USER' | 'SESSION' | 'ROLE_ASSIGNMENT' | 'USER_PREFERENCES' | 'TENANT' | 'SCHOOL' | 'ACADEMIC_YEAR' | 'TERM' | 'CONFIG' | 'DEPARTMENT' | 'HOLIDAY';

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
export type SchoolStatus = 'active' | 'inactive' | 'setup';

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
export type GlobalRole = 'TenantAdmin' | 'StandardUser';

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

