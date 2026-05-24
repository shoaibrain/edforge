/**
 * Enrollment Entity for Academics Service
 * 
 * Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: ENROLLMENT#{schoolId}#{yearId}#{studentId}
 * 
 * GSI1 (School scope):
 * - GSI1PK: TENANT#{tid}#SCHOOL#{schoolId}
 * - GSI1SK: ENROLLMENT#{yearId}#{gradeLevel}
 * 
 * GSI2 (Student-centric):
 * - GSI2PK: {studentId}
 * - GSI2SK: ENROLLMENT#{yearId}
 */

import {
  BaseEntity,
  EntityKeyBuilder,
  GSIKeyBuilder,
  EnrollmentStatus,
} from './base.entity';
import type { PromotionDecision } from '@aibrains/shared-types';

/**
 * Enrollment entity - represents student enrollment in a school for a specific academic year
 */
export interface Enrollment extends BaseEntity {
  entityType: 'ENROLLMENT';
  
  // References
  studentId: string;
  studentName?: string;  // Denormalized for list display
  schoolId: string;
  academicYearId: string;
  
  // Enrollment details
  enrollmentId: string;
  gradeLevel: string;  // e.g., 'K', '1', '2', ... '12'
  status: EnrollmentStatus;
  
  // Dates — Ed-Fi aligned (entryDate/exitWithdrawDate are canonical)
  entryDate: string;            // Ed-Fi: StudentSchoolAssociation.entryDate (ISO date)
  exitWithdrawDate?: string;    // Ed-Fi: StudentSchoolAssociation.exitWithdrawDate (ISO date)
  // Legacy fields kept for backward compatibility with existing records
  enrollmentDate: string;       // Legacy alias for entryDate
  startDate: string;            // Legacy alias for entryDate
  endDate?: string;             // Legacy alias for exitWithdrawDate
  withdrawalDate?: string;      // Legacy alias for exitWithdrawDate
  
  // Class/Section assignment
  sectionId?: string;
  homeroomTeacherId?: string;
  
  // Previous school info (for transfers)
  previousSchoolId?: string;
  previousSchoolName?: string;
  transferReason?: string;
  
  // Additional info
  enrollmentType: 'new' | 'returning' | 'transfer' | 're_enrollment';
  specialEducation?: boolean;
  eslStatus?: 'none' | 'active' | 'exited' | 'monitoring';
  lunchStatus?: 'regular' | 'free' | 'reduced';
  transportation?: 'bus' | 'car' | 'walk' | 'other';
  
  // Ed-Fi StudentSchoolAssociation descriptors
  entryGradeLevelDescriptor?: string;
  entryTypeDescriptor?: string;
  enrollmentTypeDescriptor?: string;
  residencyStatusDescriptor?: string;
  primarySchool?: boolean;
  fullTimeEquivalency?: number;
  repeatGradeIndicator?: boolean;
  calendarCode?: string;
  exitWithdrawTypeDescriptor?: string;

  // Documents
  documentsReceived?: string[];
  documentsRequired?: string[];
  
  // Notes
  notes?: string;

  // Audit trail (Sprint 5)
  auditTrail?: Array<{
    action: string;
    timestamp: string;
    userId: string;
    [key: string]: unknown;
  }>;

  // ============================================
  // Sprint D.2.7 — cross-year handoff fields
  // ============================================
  //
  // `priorEnrollmentId` is set on AY2 provisional enrolments created by
  // D.2.6 commit; absent on AY1 originals + on the seed/import path. The
  // value points back to the AY1 enrollmentId that authorized this
  // forward-roll. Used by D.2.10 flip lookups via GSI4 and by D.2.11
  // timeline reconstruction.
  //
  // `promotionDecision` is set on AY1 enrolments after D.2.6 commit. The
  // service layer enforces write-once at the DDB layer via condition
  // expression `attribute_not_exists(promotionDecision)` (D.2.7 AC).
  // Second PATCH → 409 PROMOTION_DECISION_LOCKED.
  priorEnrollmentId?: string;
  promotionDecision?: PromotionDecision;

  // GSI Keys
  gsi1pk: string;  // TENANT#{tid}#SCHOOL#{schoolId}
  gsi1sk: string;  // ENROLLMENT#{yearId}#{gradeLevel}
  gsi2pk: string;  // studentId
  gsi2sk: string;  // ENROLLMENT#{yearId}
}

/**
 * Create a new Enrollment entity with proper keys
 */
export function createEnrollmentEntity(
  tenantId: string,
  enrollmentId: string,
  studentId: string,
  schoolId: string,
  academicYearId: string,
  data: Omit<Enrollment, 'tenantId' | 'entityKey' | 'entityType' | 'enrollmentId' | 'studentId' | 'schoolId' | 'academicYearId' | 'gsi1pk' | 'gsi1sk' | 'gsi2pk' | 'gsi2sk'>
): Enrollment {
  return {
    tenantId,
    entityKey: EntityKeyBuilder.enrollment(schoolId, academicYearId, studentId),
    entityType: 'ENROLLMENT',
    enrollmentId,
    studentId,
    schoolId,
    academicYearId,
    gsi1pk: GSIKeyBuilder.schoolScope(tenantId, schoolId),
    gsi1sk: `ENROLLMENT#${academicYearId}#${data.gradeLevel}`,
    gsi2pk: studentId,
    gsi2sk: `ENROLLMENT#${academicYearId}`,
    ...data,
  };
}

