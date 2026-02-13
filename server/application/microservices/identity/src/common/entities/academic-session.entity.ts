/**
 * Academic Session Entity - Identity Service
 *
 * Ed-Fi: Session models a term/semester within an academic year.
 * Named AcademicSession to avoid collision with auth Session entity.
 *
 * Key Patterns:
 * - PK: TENANT#{tenantId}
 * - SK: SCHOOL#{schoolId}#ACADSESSION#{sessionId}
 */

import { BaseEntity, EntityKeyBuilder } from './base.entity';

// ============================================
// Term Descriptor (Ed-Fi aligned)
// ============================================

export type TermDescriptor =
  | 'fall_semester'
  | 'spring_semester'
  | 'year_round'
  | 'summer'
  | 'first_quarter'
  | 'second_quarter'
  | 'third_quarter'
  | 'fourth_quarter';

// ============================================
// Academic Session Entity Interface
// ============================================

export interface AcademicSession extends BaseEntity {
  entityType: 'ACADEMIC_SESSION';

  // Identifiers
  academicSessionId: string;
  schoolId: string;
  academicYearId: string;

  // Ed-Fi Core
  sessionName: string;         // e.g., "Fall 2026"
  beginDate: string;           // YYYY-MM-DD
  endDate: string;             // YYYY-MM-DD
  totalInstructionalDays: number;  // Computed from CalendarDates in range
  termDescriptor: TermDescriptor;

  // Grading Period Links
  gradingPeriodIds?: string[];
}

// ============================================
// Entity Key Builders
// ============================================

export const AcademicSessionKeyBuilder = {
  /**
   * Academic Session: SCHOOL#{schoolId}#ACADSESSION#{sessionId}
   */
  academicSession: (schoolId: string, sessionId: string): string =>
    EntityKeyBuilder.academicSession(schoolId, sessionId),

  /**
   * Academic Sessions for school (prefix): SCHOOL#{schoolId}#ACADSESSION#
   */
  academicSessionsPrefix: (schoolId: string): string =>
    `SCHOOL#${schoolId}#ACADSESSION#`,
};

// ============================================
// Factory Function
// ============================================

export function createAcademicSessionEntity(
  tenantId: string,
  schoolId: string,
  sessionId: string,
  data: Omit<AcademicSession, 'tenantId' | 'entityKey' | 'entityType' | 'academicSessionId' | 'schoolId'>
): AcademicSession {
  return {
    tenantId,
    entityKey: AcademicSessionKeyBuilder.academicSession(schoolId, sessionId),
    entityType: 'ACADEMIC_SESSION',
    academicSessionId: sessionId,
    schoolId,
    ...data,
  };
}
