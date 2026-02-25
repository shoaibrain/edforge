/**
 * Role Assignment Entity for Identity Service (ABAC)
 * 
 * Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: USER#{userId}#ROLE#{schoolId}
 * 
 * This enables:
 * - Query all roles for a user: PK=TENANT#{tid}, SK begins_with USER#{uid}#ROLE#
 * - Query specific role: PK=TENANT#{tid}, SK=USER#{uid}#ROLE#{schoolId}
 */

import {
  BaseEntity,
  SchoolRole,
  EntityKeyBuilder,
  GSIKeyBuilder,
} from './base.entity';

/**
 * Role assignment entity - assigns a user to a role within a specific school
 */
export interface RoleAssignment extends BaseEntity {
  entityType: 'ROLE_ASSIGNMENT';
  
  // Assignment identity
  userId: string;
  schoolId: string;
  
  // Role information
  role: SchoolRole;
  
  // Optional: department-level assignment for teachers
  departmentId?: string;
  
  // Optional: specific permissions overrides
  permissionOverrides?: PermissionOverride[];
  
  // Assignment metadata
  assignedAt: string;
  assignedBy: string;
  expiresAt?: string;  // Optional: for temporary assignments
  
  // Status
  isActive: boolean;
  deactivatedAt?: string;
  deactivatedBy?: string;
  deactivationReason?: string;

  // Role change history
  previousRole?: string;
  previousRoleDeactivatedAt?: string;

  // Reactivation tracking
  reactivatedAt?: string;
  reactivatedFrom?: string;

  // GSI3 keys for school-user queries
  gsi3pk?: string;
  gsi3sk?: string;
}

/**
 * Permission override for fine-grained access control
 */
export interface PermissionOverride {
  resource: string;  // e.g., 'students', 'grades', 'attendance'
  action: PermissionAction;
  effect: 'allow' | 'deny';
  conditions?: Record<string, any>;
}

/**
 * Permission actions
 */
export type PermissionAction = 
  | 'view' 
  | 'create' 
  | 'edit' 
  | 'delete' 
  | 'manage' 
  | 'approve' 
  | 'send' 
  | 'export';

/**
 * Create a new RoleAssignment entity
 */
export function createRoleAssignment(
  tenantId: string,
  userId: string,
  schoolId: string,
  role: SchoolRole,
  assignedBy: string,
  options?: {
    departmentId?: string;
    permissionOverrides?: PermissionOverride[];
    expiresAt?: string;
  }
): RoleAssignment {
  const now = new Date().toISOString();
  
  return {
    tenantId,
    entityKey: EntityKeyBuilder.roleAssignment(userId, schoolId),
    entityType: 'ROLE_ASSIGNMENT',
    userId,
    schoolId,
    role,
    departmentId: options?.departmentId,
    permissionOverrides: options?.permissionOverrides,
    assignedAt: now,
    assignedBy,
    expiresAt: options?.expiresAt,
    isActive: true,
    gsi3pk: GSIKeyBuilder.schoolUsers(tenantId, schoolId),
    gsi3sk: GSIKeyBuilder.schoolUserRole(role, userId),
    createdAt: now,
    createdBy: assignedBy,
    updatedAt: now,
    updatedBy: assignedBy,
    version: 1,
  };
}

/**
 * Default permissions by role
 * Used when no overrides are specified
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<SchoolRole, string[]> = {
  Principal: [
    'students:*',
    'teachers:*',
    'staff:*',
    'grades:*',
    'attendance:*',
    'enrollment:*',
    'courses:*',
    'scheduling:*',
    'reports:*',
    'settings:school',
    'education-organizations:*',
    'staff-assignments:*',
    'employment-history:view',
  ],
  VicePrincipal: [
    'students:view,edit',
    'teachers:view,edit',
    'staff:view',
    'grades:view,edit',
    'attendance:*',
    'enrollment:view,edit',
    'courses:view',
    'scheduling:view,edit',
    'reports:view,export',
    'education-organizations:view',
    'staff-assignments:view,create,edit',
    'employment-history:view',
  ],
  Teacher: [
    'students:view',
    'grades:view,edit',
    'attendance:view,create,edit',
    'courses:view',
    'scheduling:view',
  ],
  Accountant: [
    'students:view',
    'billing:*',
    'payroll:view',
    'expenses:*',
    'reports:finance',
  ],
  Staff: [
    'students:view',
    'attendance:view',
    'scheduling:view',
  ],
  Counselor: [
    'students:view',
    'special-programs:*',
    'scheduling:view',
  ],
  Nurse: [
    'students:view',
    'health-records:*',
  ],
  Student: [
    'student-portal:grades',
    'student-portal:attendance',
    'student-portal:schedule',
    'student-portal:assignments',
  ],
  Parent: [
    'parent-portal:grades',
    'parent-portal:attendance',
    'parent-portal:schedule',
    'parent-portal:fees',
  ],
};

