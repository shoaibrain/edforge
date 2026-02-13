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
 * - GSI1PK: TENANT#{tenantId}#SCHOOL#{schoolId}
 * - GSI1SK: CALENDAR#{calendarCode}
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

  // GSI Keys
  GSI1PK?: string;  // TENANT#{tenantId}#SCHOOL#{schoolId}
  GSI1SK?: string;  // CALENDAR#{calendarCode}
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
   * GSI1PK (School calendars lookup): TENANT#{tenantId}#SCHOOL#{schoolId}
   */
  schoolCalendarsLookup: (tenantId: string, schoolId: string): string =>
    `TENANT#${tenantId}#SCHOOL#${schoolId}`,

  /**
   * GSI1SK (Calendar code sort): CALENDAR#{calendarCode}
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
  data: Omit<Calendar, 'tenantId' | 'entityKey' | 'entityType' | 'calendarId' | 'schoolId' | 'GSI1PK' | 'GSI1SK'>
): Calendar {
  return {
    tenantId,
    entityKey: CalendarKeyBuilder.calendar(schoolId, calendarId),
    entityType: 'CALENDAR',
    calendarId,
    schoolId,
    ...data,
    // GSI Keys
    GSI1PK: CalendarKeyBuilder.schoolCalendarsLookup(tenantId, schoolId),
    GSI1SK: CalendarKeyBuilder.calendarCodeSort(data.calendarCode),
  };
}
