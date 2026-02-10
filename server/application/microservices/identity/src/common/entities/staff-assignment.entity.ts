/**
 * Staff Assignment Entity - Identity Service
 *
 * DynamoDB Entity for Ed-Fi StaffEducationOrganizationAssignmentAssociation.
 * First-class entity enabling independent querying of staff-to-school assignments.
 *
 * Key Patterns:
 * - PK: TENANT#{tenantId}
 * - SK: STAFF#{staffId}#ASSIGN#{assignmentId}
 * - GSI1PK: TENANT#{tenantId}#SCHOOL#{schoolId}  (query assignments by school)
 * - GSI1SK: ASSIGN#{assignmentId}
 */

import { BaseEntity, EntityKeyBuilder, GSIKeyBuilder } from './base.entity';

// ============================================
// Staff Assignment Types
// ============================================

export type AssignmentStatus = 'active' | 'ended' | 'pending';

// ============================================
// Staff Assignment Entity Interface
// ============================================

export interface StaffAssignment extends BaseEntity {
  entityType: 'STAFF_ASSIGNMENT';

  // Identifiers
  id: string;                   // Assignment UUID
  staffId: string;              // FK to Staff entity
  schoolId: string;             // FK to School entity

  // Ed-Fi StaffEducationOrganizationAssignmentAssociation fields
  staffClassificationDescriptor?: string; // Ed-Fi descriptor
  positionTitle?: string;
  beginDate: string;            // ISO date
  endDate?: string;             // ISO date (null = current)
  orderOfAssignment?: number;   // Ed-Fi: orderOfAssignment

  // EdForge extensions
  role: string;                 // Internal role (teacher, principal, etc.)
  department?: string;
  isPrimary: boolean;
  fullTimeEquivalency?: number; // Ed-Fi: FTE (0-1)

  // Denormalized for query convenience
  staffName?: string;           // "FirstName LastName"
  schoolName?: string;

  // Status
  assignmentStatus: AssignmentStatus;

  // GSI Keys
  gsi1pk?: string;  // TENANT#{tenantId}#SCHOOL#{schoolId}
  gsi1sk?: string;  // ASSIGN#{assignmentId}
}

// ============================================
// Key Builders
// ============================================

export const StaffAssignmentKeyBuilder = {
  /**
   * SK: ASSIGN#{assignmentId}
   */
  assignSortKey: (assignmentId: string): string => `ASSIGN#${assignmentId}`,

  /**
   * GSI1PK: TENANT#{tenantId}#SCHOOL#{schoolId}
   */
  schoolLookup: (tenantId: string, schoolId: string): string =>
    GSIKeyBuilder.schoolStaffAssignments(tenantId, schoolId),
};

// ============================================
// Factory Function
// ============================================

export function createStaffAssignmentEntity(
  tenantId: string,
  assignmentId: string,
  data: Omit<StaffAssignment, 'tenantId' | 'entityKey' | 'entityType' | 'id' | 'gsi1pk' | 'gsi1sk'>
): StaffAssignment {
  return {
    tenantId,
    entityKey: EntityKeyBuilder.staffAssignment(data.staffId, assignmentId),
    entityType: 'STAFF_ASSIGNMENT',
    id: assignmentId,
    ...data,
    // GSI1: query assignments by school
    gsi1pk: StaffAssignmentKeyBuilder.schoolLookup(tenantId, data.schoolId),
    gsi1sk: StaffAssignmentKeyBuilder.assignSortKey(assignmentId),
  };
}
