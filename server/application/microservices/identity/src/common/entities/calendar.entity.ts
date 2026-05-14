/**
 * Calendar Entity - Identity Service
 *
 * Ed-Fi: Calendar is an intermediary between School and CalendarDate.
 * A school can have multiple calendars (Student, Teacher, IEP).
 * CalendarDate references Calendar, not School directly.
 *
 * Key Patterns:
 * - PK: TENANT#{tenantId}
 * - SK: SCHOOL#{schoolId}#CALENDAR#{calendarId}
 *
 * GSI1 (Calendars by School):
 * - gsi1pk: TENANT#{tenantId}#SCHOOL#{schoolId}
 * - gsi1sk: CALENDAR#{calendarCode}
 *
 * Sprint S3.2 — GSI1 attribute names lowercased to match the DDB index
 * definition (server/lib/tenant-template/ecs-dynamodb.ts:53-54). The
 * uppercase variant silently failed to populate the GSI since this entity
 * was first written. Companion fix to S3.1 (calendar-date).
 */

import { BaseEntity } from './base.entity';

// ============================================
// Calendar Type Descriptor (Ed-Fi aligned)
// ============================================

export type CalendarTypeDescriptor = 'student' | 'teacher' | 'IEP' | 'other';

// ============================================
// Calendar Entity Interface
// ============================================

export interface Calendar extends BaseEntity {
  entityType: 'CALENDAR';

  // Identifiers
  calendarId: string;
  schoolId: string;
  academicYearId: string;

  // Ed-Fi Core
  calendarCode: string;                          // e.g., "STUDENT-2026"
  calendarTypeDescriptor: CalendarTypeDescriptor;
  gradeLevels?: string[];                        // Ed-Fi: GradeLevel[]

  // EdForge Extensions
  isDefault: boolean;

  // GSI Keys — see entity-header comment for the S3.2 casing rename rationale.
  gsi1pk?: string;  // TENANT#{tenantId}#SCHOOL#{schoolId}
  gsi1sk?: string;  // CALENDAR#{calendarCode}
}

// ============================================
// Entity Key Builders
// ============================================

export const CalendarKeyBuilder = {
  /**
   * Calendar: SCHOOL#{schoolId}#CALENDAR#{calendarId}
   */
  calendar: (schoolId: string, calendarId: string): string =>
    `SCHOOL#${schoolId}#CALENDAR#${calendarId}`,

  /**
   * Calendars for school (prefix): SCHOOL#{schoolId}#CALENDAR#
   */
  calendarsPrefix: (schoolId: string): string =>
    `SCHOOL#${schoolId}#CALENDAR#`,

  /**
   * gsi1pk (School calendars lookup): TENANT#{tenantId}#SCHOOL#{schoolId}
   */
  schoolCalendarsLookup: (tenantId: string, schoolId: string): string =>
    `TENANT#${tenantId}#SCHOOL#${schoolId}`,

  /**
   * gsi1sk (Calendar code sort): CALENDAR#{calendarCode}
   */
  calendarCodeSort: (calendarCode: string): string =>
    `CALENDAR#${calendarCode}`,
};

// ============================================
// Factory Function
// ============================================

export function createCalendarEntity(
  tenantId: string,
  schoolId: string,
  calendarId: string,
  data: Omit<Calendar, 'tenantId' | 'entityKey' | 'entityType' | 'calendarId' | 'schoolId' | 'gsi1pk' | 'gsi1sk'>
): Calendar {
  return {
    tenantId,
    entityKey: CalendarKeyBuilder.calendar(schoolId, calendarId),
    entityType: 'CALENDAR',
    calendarId,
    schoolId,
    ...data,
    // GSI Keys
    gsi1pk: CalendarKeyBuilder.schoolCalendarsLookup(tenantId, schoolId),
    gsi1sk: CalendarKeyBuilder.calendarCodeSort(data.calendarCode),
  };
}
