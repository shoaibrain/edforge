/**
 * Class Period Entity - Identity Service
 *
 * Standalone Ed-Fi ClassPeriod entity representing a time block within a school day.
 * Extracted from embedded BellSchedule periods to allow direct referencing
 * by Section, CourseOffering, and other scheduling entities.
 *
 * Key Patterns:
 * - PK: TENANT#{tenantId}
 * - SK: SCHOOL#{schoolId}#PERIOD#{periodId}
 */

import { BaseEntity } from './base.entity';

// ============================================
// Class Period Type
// ============================================

export type ClassPeriodType =
  | 'instructional'
  | 'homeroom'
  | 'lunch'
  | 'recess'
  | 'passing'
  | 'assembly'
  | 'advisory'
  | 'study_hall'
  | 'extracurricular';

// ============================================
// Class Period Entity Interface
// ============================================

export interface ClassPeriodEntity extends BaseEntity {
  entityType: 'CLASSPERIOD';

  // Identifiers
  periodId: string;
  schoolId: string;

  // Ed-Fi Core
  classPeriodName: string;

  // Timing
  startTime: string;  // HH:MM format
  endTime: string;    // HH:MM format
  durationMinutes: number;

  // Classification
  sortOrder: number;
  periodType: ClassPeriodType;
  isAcademic: boolean;

  // Description
  description?: string;
}

// ============================================
// Entity Key Builders
// ============================================

export const ClassPeriodKeyBuilder = {
  /**
   * Class Period: SCHOOL#{schoolId}#PERIOD#{periodId}
   */
  classPeriod: (schoolId: string, periodId: string): string =>
    `SCHOOL#${schoolId}#PERIOD#${periodId}`,

  /**
   * Class Periods for school (prefix): SCHOOL#{schoolId}#PERIOD#
   */
  classPeriodsPrefix: (schoolId: string): string =>
    `SCHOOL#${schoolId}#PERIOD#`,
};

// ============================================
// Factory Function
// ============================================

export function createClassPeriodEntity(
  tenantId: string,
  schoolId: string,
  periodId: string,
  data: Omit<ClassPeriodEntity, 'tenantId' | 'entityKey' | 'entityType' | 'periodId' | 'schoolId' | 'durationMinutes'>
): ClassPeriodEntity {
  // Calculate duration from start/end times
  const [startH, startM] = data.startTime.split(':').map(Number);
  const [endH, endM] = data.endTime.split(':').map(Number);
  const durationMinutes = (endH * 60 + endM) - (startH * 60 + startM);

  return {
    tenantId,
    entityKey: ClassPeriodKeyBuilder.classPeriod(schoolId, periodId),
    entityType: 'CLASSPERIOD',
    periodId,
    schoolId,
    durationMinutes,
    ...data,
  };
}
