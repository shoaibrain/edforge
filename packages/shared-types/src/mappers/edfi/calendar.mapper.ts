/**
 * Calendar Ed-Fi Mapper
 * 
 * Converts EdForge Calendar data to Ed-Fi Data Standard format for compliance export.
 * Ed-Fi Data Standard v6.0: https://docs.ed-fi.org/reference/data-exchange/data-standard/
 * 
 * Ed-Fi Calendar Domain:
 * - Calendar - School calendar for an academic year
 * - CalendarDate - Individual calendar dates with events
 * - AcademicWeek - Academic weeks within a calendar
 */

import type { AcademicYearResponseDto, GradingPeriodResponseDto } from '../../schemas/identity/academic-year.schema';
import type { CalendarDateResponseDto, CalendarEventDto } from '../../schemas/identity/calendar-date.schema';
import type { BellScheduleResponseDto, ClassPeriodDto } from '../../schemas/identity/bell-schedule.schema';

// ============================================
// Ed-Fi Calendar Resource
// ============================================

/**
 * Ed-Fi Calendar Resource
 * Based on Ed-Fi Data Standard v6.0 Calendar resource
 */
export interface EdFiCalendar {
  calendarCode: string;
  schoolReference: {
    schoolId: number;
  };
  schoolYearTypeReference: {
    schoolYear: number;
  };
  calendarTypeDescriptor: string;
  gradeLevels?: EdFiCalendarGradeLevel[];
  _ext?: EdForgeCalendarExtension;
}

export interface EdFiCalendarGradeLevel {
  gradeLevelDescriptor: string;
}

export interface EdForgeCalendarExtension {
  edforge_yearId: string;
  edforge_tenantId?: string;
  edforge_schoolId: string;
  edforge_name: string;
  edforge_status: string;
  edforge_isCurrent: boolean;
}

// ============================================
// Ed-Fi CalendarDate Resource
// ============================================

/**
 * Ed-Fi CalendarDate Resource
 * Based on Ed-Fi Data Standard v6.0 CalendarDate resource
 */
export interface EdFiCalendarDate {
  calendarReference: {
    calendarCode: string;
    schoolId: number;
    schoolYear: number;
  };
  date: string;
  calendarEvents?: EdFiCalendarDateCalendarEvent[];
  _ext?: EdForgeCalendarDateExtension;
}

export interface EdFiCalendarDateCalendarEvent {
  calendarEventDescriptor: string;
}

export interface EdForgeCalendarDateExtension {
  edforge_calendarDateId: string;
  edforge_tenantId?: string;
  edforge_isInstructionalDay: boolean;
  edforge_isHoliday: boolean;
  edforge_isWeekend: boolean;
  edforge_dayOfWeek: string;
  edforge_bellScheduleId?: string;
}

// ============================================
// Ed-Fi GradingPeriod Resource
// ============================================

/**
 * Ed-Fi GradingPeriod Resource
 * Based on Ed-Fi Data Standard v6.0 GradingPeriod resource
 */
export interface EdFiGradingPeriod {
  gradingPeriodDescriptor: string;
  periodSequence: number;
  schoolReference: {
    schoolId: number;
  };
  schoolYearTypeReference: {
    schoolYear: number;
  };
  beginDate: string;
  endDate: string;
  totalInstructionalDays?: number;
  _ext?: EdForgeGradingPeriodExtension;
}

export interface EdForgeGradingPeriodExtension {
  edforge_termId: string;
  edforge_yearId: string;
  edforge_schoolId: string;
  edforge_name: string;
  edforge_gradesDueDate?: string;
  edforge_reportCardDate?: string;
}

// ============================================
// Ed-Fi BellSchedule Resource
// ============================================

/**
 * Ed-Fi BellSchedule Resource
 * Based on Ed-Fi Data Standard v6.0 BellSchedule resource
 */
export interface EdFiBellSchedule {
  bellScheduleName: string;
  schoolReference: {
    schoolId: number;
  };
  classPeriods?: EdFiClassPeriod[];
  dates?: EdFiBellScheduleDate[];
  gradeLevels?: EdFiBellScheduleGradeLevel[];
  totalInstructionalTime?: number;
  startTime?: string;
  endTime?: string;
  _ext?: EdForgeBellScheduleExtension;
}

export interface EdFiClassPeriod {
  classPeriodReference: {
    classPeriodName: string;
    schoolId: number;
  };
}

export interface EdFiBellScheduleDate {
  date: string;
}

export interface EdFiBellScheduleGradeLevel {
  gradeLevelDescriptor: string;
}

export interface EdForgeBellScheduleExtension {
  edforge_bellScheduleId: string;
  edforge_tenantId?: string;
  edforge_schoolId: string;
  edforge_type: string;
  edforge_isDefault: boolean;
}

// ============================================
// Mapping Functions
// ============================================

/**
 * Map EdForge calendar type to Ed-Fi calendarTypeDescriptor
 */
function mapCalendarTypeToEdFi(calendarType: string): string {
  const typeMap: Record<string, string> = {
    'semester': 'uri://ed-fi.org/CalendarTypeDescriptor#Student Specific',
    'quarter': 'uri://ed-fi.org/CalendarTypeDescriptor#Student Specific',
    'trimester': 'uri://ed-fi.org/CalendarTypeDescriptor#Student Specific',
  };
  return typeMap[calendarType] || 'uri://ed-fi.org/CalendarTypeDescriptor#Student Specific';
}

/**
 * Map EdForge term type to Ed-Fi gradingPeriodDescriptor
 */
function mapTermTypeToEdFi(termType: string): string {
  const termMap: Record<string, string> = {
    'semester': 'uri://ed-fi.org/GradingPeriodDescriptor#Semester',
    'quarter': 'uri://ed-fi.org/GradingPeriodDescriptor#Quarter',
    'trimester': 'uri://ed-fi.org/GradingPeriodDescriptor#Trimester',
    'year': 'uri://ed-fi.org/GradingPeriodDescriptor#End of Year',
  };
  return termMap[termType] || 'uri://ed-fi.org/GradingPeriodDescriptor#Grading Period';
}

/**
 * Map EdForge calendar event type to Ed-Fi calendarEventDescriptor
 */
function mapCalendarEventToEdFi(eventType: string): string {
  const eventMap: Record<string, string> = {
    'instructional': 'uri://ed-fi.org/CalendarEventDescriptor#Instructional day',
    'holiday': 'uri://ed-fi.org/CalendarEventDescriptor#Holiday',
    'teacher_workday': 'uri://ed-fi.org/CalendarEventDescriptor#Teacher only day',
    'professional_development': 'uri://ed-fi.org/CalendarEventDescriptor#Teacher only day',
    'early_dismissal': 'uri://ed-fi.org/CalendarEventDescriptor#Make-up day',
    'late_start': 'uri://ed-fi.org/CalendarEventDescriptor#Make-up day',
    'weather_closure': 'uri://ed-fi.org/CalendarEventDescriptor#Weather day',
    'emergency_closure': 'uri://ed-fi.org/CalendarEventDescriptor#Emergency day',
    'parent_conference': 'uri://ed-fi.org/CalendarEventDescriptor#Student late arrival/early dismissal',
    'testing': 'uri://ed-fi.org/CalendarEventDescriptor#Instructional day',
    'assembly': 'uri://ed-fi.org/CalendarEventDescriptor#Instructional day',
    'field_trip': 'uri://ed-fi.org/CalendarEventDescriptor#Instructional day',
    'other': 'uri://ed-fi.org/CalendarEventDescriptor#Other',
  };
  return eventMap[eventType] || 'uri://ed-fi.org/CalendarEventDescriptor#Other';
}

/**
 * Extract school year from date range (e.g., 2024-2025 from Aug 2024 - May 2025)
 */
function extractSchoolYear(startDate: string): number {
  const start = new Date(startDate);
  const month = start.getMonth();
  // If school starts in fall (July-Dec), use that year; otherwise use previous year
  return month >= 6 ? start.getFullYear() : start.getFullYear() - 1;
}

/**
 * Convert EdForge AcademicYear to Ed-Fi Calendar format
 */
export function toEdFiCalendar(
  academicYear: AcademicYearResponseDto,
  schoolEdFiId: number,
  gradeLevels?: string[]
): EdFiCalendar {
  const schoolYear = extractSchoolYear(academicYear.startDate);
  
  const edfiCalendar: EdFiCalendar = {
    calendarCode: `${academicYear.schoolId}-${academicYear.yearId}`,
    schoolReference: {
      schoolId: schoolEdFiId,
    },
    schoolYearTypeReference: {
      schoolYear,
    },
    calendarTypeDescriptor: mapCalendarTypeToEdFi(academicYear.calendarType),
  };

  // Add grade levels if provided
  if (gradeLevels && gradeLevels.length > 0) {
    edfiCalendar.gradeLevels = gradeLevels.map(gl => ({
      gradeLevelDescriptor: `uri://ed-fi.org/GradeLevelDescriptor#${gl}`,
    }));
  }

  // EdForge extension data for round-trip preservation
  edfiCalendar._ext = {
    edforge_yearId: academicYear.yearId,
    edforge_schoolId: academicYear.schoolId,
    edforge_name: academicYear.name,
    edforge_status: academicYear.status,
    edforge_isCurrent: academicYear.isCurrent,
  };

  return edfiCalendar;
}

/**
 * Convert EdForge CalendarDate to Ed-Fi CalendarDate format
 */
export function toEdFiCalendarDate(
  calendarDate: CalendarDateResponseDto,
  schoolEdFiId: number,
  calendarCode: string,
  schoolYear: number
): EdFiCalendarDate {
  const edfiCalendarDate: EdFiCalendarDate = {
    calendarReference: {
      calendarCode,
      schoolId: schoolEdFiId,
      schoolYear,
    },
    date: calendarDate.date,
  };

  // Map calendar events
  if (calendarDate.calendarEvents && calendarDate.calendarEvents.length > 0) {
    edfiCalendarDate.calendarEvents = calendarDate.calendarEvents.map(event => ({
      calendarEventDescriptor: mapCalendarEventToEdFi(event.eventType),
    }));
  } else if (calendarDate.isInstructionalDay) {
    edfiCalendarDate.calendarEvents = [{
      calendarEventDescriptor: 'uri://ed-fi.org/CalendarEventDescriptor#Instructional day',
    }];
  } else if (calendarDate.isHoliday) {
    edfiCalendarDate.calendarEvents = [{
      calendarEventDescriptor: 'uri://ed-fi.org/CalendarEventDescriptor#Holiday',
    }];
  }

  // EdForge extension data
  edfiCalendarDate._ext = {
    edforge_calendarDateId: calendarDate.calendarDateId,
    edforge_isInstructionalDay: calendarDate.isInstructionalDay,
    edforge_isHoliday: calendarDate.isHoliday,
    edforge_isWeekend: calendarDate.isWeekend,
    edforge_dayOfWeek: calendarDate.dayOfWeek,
    edforge_bellScheduleId: calendarDate.bellScheduleId,
  };

  return edfiCalendarDate;
}

/**
 * Convert EdForge GradingPeriod to Ed-Fi GradingPeriod format
 */
export function toEdFiGradingPeriod(
  gradingPeriod: GradingPeriodResponseDto,
  schoolEdFiId: number,
  schoolYear: number
): EdFiGradingPeriod {
  return {
    gradingPeriodDescriptor: mapTermTypeToEdFi(gradingPeriod.termType),
    periodSequence: gradingPeriod.sequence,
    schoolReference: {
      schoolId: schoolEdFiId,
    },
    schoolYearTypeReference: {
      schoolYear,
    },
    beginDate: gradingPeriod.startDate,
    endDate: gradingPeriod.endDate,
    _ext: {
      edforge_termId: gradingPeriod.termId,
      edforge_yearId: gradingPeriod.yearId,
      edforge_schoolId: gradingPeriod.schoolId,
      edforge_name: gradingPeriod.name,
      edforge_gradesDueDate: gradingPeriod.gradesDueDate,
      edforge_reportCardDate: gradingPeriod.reportCardDate,
    },
  };
}

/**
 * Convert EdForge BellSchedule to Ed-Fi BellSchedule format
 */
export function toEdFiBellSchedule(
  bellSchedule: BellScheduleResponseDto,
  schoolEdFiId: number
): EdFiBellSchedule {
  // Calculate total instructional time from class periods
  const instructionalPeriods = bellSchedule.classPeriods.filter(p => p.periodType === 'instructional');
  let totalInstructionalTime = 0;
  
  for (const period of instructionalPeriods) {
    const [startHour, startMin] = period.startTime.split(':').map(Number);
    const [endHour, endMin] = period.endTime.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    totalInstructionalTime += endMinutes - startMinutes;
  }

  // Find earliest start and latest end times
  const startTimes = bellSchedule.classPeriods.map(p => p.startTime).sort();
  const endTimes = bellSchedule.classPeriods.map(p => p.endTime).sort().reverse();

  return {
    bellScheduleName: bellSchedule.bellScheduleName,
    schoolReference: {
      schoolId: schoolEdFiId,
    },
    classPeriods: bellSchedule.classPeriods.map(p => ({
      classPeriodReference: {
        classPeriodName: p.classPeriodName,
        schoolId: schoolEdFiId,
      },
    })),
    totalInstructionalTime,
    startTime: startTimes[0],
    endTime: endTimes[0],
    _ext: {
      edforge_bellScheduleId: bellSchedule.bellScheduleId,
      edforge_tenantId: bellSchedule.tenantId,
      edforge_schoolId: bellSchedule.schoolId,
      edforge_type: bellSchedule.dayType,
      edforge_isDefault: bellSchedule.isDefault,
    },
  };
}

// ============================================
// Batch Conversion Functions
// ============================================

/**
 * Batch convert EdForge AcademicYears to Ed-Fi Calendar format
 */
export function toEdFiCalendarBatch(
  academicYears: AcademicYearResponseDto[],
  schoolEdFiIdMap: Map<string, number>
): EdFiCalendar[] {
  return academicYears
    .filter(ay => schoolEdFiIdMap.has(ay.schoolId))
    .map(ay => toEdFiCalendar(ay, schoolEdFiIdMap.get(ay.schoolId)!));
}

/**
 * Batch convert EdForge CalendarDates to Ed-Fi CalendarDate format
 */
export function toEdFiCalendarDateBatch(
  calendarDates: CalendarDateResponseDto[],
  schoolEdFiId: number,
  calendarCode: string,
  schoolYear: number
): EdFiCalendarDate[] {
  return calendarDates.map(cd => toEdFiCalendarDate(cd, schoolEdFiId, calendarCode, schoolYear));
}

/**
 * Batch convert EdForge GradingPeriods to Ed-Fi GradingPeriod format
 */
export function toEdFiGradingPeriodBatch(
  gradingPeriods: GradingPeriodResponseDto[],
  schoolEdFiId: number,
  schoolYear: number
): EdFiGradingPeriod[] {
  return gradingPeriods.map(gp => toEdFiGradingPeriod(gp, schoolEdFiId, schoolYear));
}
