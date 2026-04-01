/**
 * Calendar Date Entity - Identity Service
 * 
 * DynamoDB Entity for school calendar date management with Ed-Fi alignment.
 * 
 * Key Patterns:
 * - PK: TENANT#{tenantId}
 * - SK: SCHOOL#{schoolId}#DATE#{date}
 * 
 * GSI1 (Academic Year Date Lookup):
 * - GSI1PK: ACADYEAR#{academicYearId}
 * - GSI1SK: CALDATE#{date}
 */

import { BaseEntity } from './base.entity';
import { DayOfWeek } from './bell-schedule.entity';

// ============================================
// Calendar Event Types (Ed-Fi aligned)
// ============================================

export type CalendarEventDescriptor = 
  | 'instructional_day'
  | 'non_instructional_day'
  | 'holiday'
  | 'teacher_only'
  | 'student_holiday'
  | 'weather_day'
  | 'testing_day'
  | 'early_release'
  | 'late_start'
  | 'conference_day'
  | 'graduation'
  | 'break'
  | 'in_service'
  | 'make_up_day'
  | 'other';

// ============================================
// Calendar Event Interface
// ============================================

export interface CalendarEvent {
  eventType: CalendarEventDescriptor;
  description?: string;
  isAllDay: boolean;
  startTime?: string;  // For partial day events
  endTime?: string;
}

// ============================================
// Calendar Date Entity Interface
// ============================================

export interface CalendarDate extends BaseEntity {
  entityType: 'CALENDARDATE';

  // Identifiers
  schoolId: string;
  academicYearId: string;
  date: string;  // YYYY-MM-DD

  // Calendar reference (Ed-Fi: CalendarDate → Calendar)
  calendarId?: string;

  // Ed-Fi Core
  calendarEvents: CalendarEvent[];
  
  // EdForge Extensions
  isInstructionalDay: boolean;
  isHoliday: boolean;
  isWeekend: boolean;
  dayOfWeek: DayOfWeek;
  
  // Schedule Association
  bellScheduleId?: string;
  bellScheduleName?: string;
  
  // Grading Period Association
  gradingPeriodId?: string;
  gradingPeriodName?: string;
  
  // Computed
  dayNumber?: number;               // Day number in academic year (1, 2, 3...)
  instructionalDayNumber?: number;  // Instructional day number
  
  // Notes
  notes?: string;
  
  // GSI Keys
  GSI1PK?: string;  // ACADYEAR#{academicYearId}
  GSI1SK?: string;  // CALDATE#{date}
}

// ============================================
// Entity Key Builders
// ============================================

export const CalendarDateKeyBuilder = {
  /**
   * Calendar Date: SCHOOL#{schoolId}#DATE#{date}
   */
  calendarDate: (schoolId: string, date: string): string => 
    `SCHOOL#${schoolId}#DATE#${date}`,
  
  /**
   * Calendar Dates for school (prefix): SCHOOL#{schoolId}#DATE#
   */
  calendarDatesPrefix: (schoolId: string): string => 
    `SCHOOL#${schoolId}#DATE#`,
  
  /**
   * GSI1PK (Academic Year lookup): ACADYEAR#{academicYearId}
   */
  academicYearLookup: (academicYearId: string): string => 
    `ACADYEAR#${academicYearId}`,
  
  /**
   * GSI1SK (Date sort): CALDATE#{date}
   */
  dateSort: (date: string): string => 
    `CALDATE#${date}`,
};

// ============================================
// Factory Function
// ============================================

export function createCalendarDateEntity(
  tenantId: string,
  schoolId: string,
  data: Omit<CalendarDate, 'tenantId' | 'entityKey' | 'entityType' | 'schoolId' | 'GSI1PK' | 'GSI1SK'>
): CalendarDate {
  return {
    tenantId,
    entityKey: CalendarDateKeyBuilder.calendarDate(schoolId, data.date),
    entityType: 'CALENDARDATE',
    schoolId,
    ...data,
    // GSI Keys
    GSI1PK: CalendarDateKeyBuilder.academicYearLookup(data.academicYearId),
    GSI1SK: CalendarDateKeyBuilder.dateSort(data.date),
  };
}

// ============================================
// Utility Functions
// ============================================

/**
 * Get day of week from date string
 */
export function getDayOfWeek(dateString: string): DayOfWeek {
  const days: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const date = new Date(dateString + 'T12:00:00Z');
  return days[date.getUTCDay()];
}

/**
 * Check if date is a weekend
 */
export function isWeekend(dateString: string): boolean {
  const day = getDayOfWeek(dateString);
  return day === 'saturday' || day === 'sunday';
}

/**
 * Generate calendar dates for a date range
 */
export function generateCalendarDatesForRange(
  tenantId: string,
  schoolId: string,
  academicYearId: string,
  startDate: string,
  endDate: string,
  options: {
    defaultBellScheduleId?: string;
    schoolDays?: DayOfWeek[];
    holidays?: { date: string; name: string; eventType: CalendarEventDescriptor }[];
    breaks?: { startDate: string; endDate: string; name: string; eventType: CalendarEventDescriptor }[];
  } = {}
): CalendarDate[] {
  const calendarDates: CalendarDate[] = [];
  const schoolDays = options.schoolDays || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  
  // Create a set of holiday dates for quick lookup
  const holidayMap = new Map<string, { name: string; eventType: CalendarEventDescriptor }>();
  options.holidays?.forEach(h => holidayMap.set(h.date, { name: h.name, eventType: h.eventType }));
  
  // Create break date ranges
  const breakDates = new Set<string>();
  const breakInfo = new Map<string, { name: string; eventType: CalendarEventDescriptor }>();
  options.breaks?.forEach(b => {
    let current = new Date(b.startDate + 'T12:00:00Z');
    const end = new Date(b.endDate + 'T12:00:00Z');
    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      breakDates.add(dateStr);
      breakInfo.set(dateStr, { name: b.name, eventType: b.eventType });
      current.setDate(current.getDate() + 1);
    }
  });

  let currentDate = new Date(startDate + 'T12:00:00Z');
  const endDateObj = new Date(endDate + 'T12:00:00Z');
  let dayNumber = 0;
  let instructionalDayNumber = 0;
  
  while (currentDate <= endDateObj) {
    dayNumber++;
    const dateStr = currentDate.toISOString().split('T')[0];
    const dayOfWeek = getDayOfWeek(dateStr);
    const weekend = !schoolDays.includes(dayOfWeek);
    
    // Determine events and instructional status
    const events: CalendarEvent[] = [];
    let isInstructionalDay = false;
    let isHoliday = false;
    
    if (weekend) {
      events.push({ eventType: 'non_instructional_day', description: 'Weekend', isAllDay: true });
    } else if (holidayMap.has(dateStr)) {
      const holiday = holidayMap.get(dateStr)!;
      events.push({ eventType: holiday.eventType, description: holiday.name, isAllDay: true });
      isHoliday = true;
    } else if (breakDates.has(dateStr)) {
      const breakData = breakInfo.get(dateStr)!;
      events.push({ eventType: breakData.eventType, description: breakData.name, isAllDay: true });
    } else {
      events.push({ eventType: 'instructional_day', isAllDay: true });
      isInstructionalDay = true;
      instructionalDayNumber++;
    }
    
    const now = new Date().toISOString();
    
    calendarDates.push(createCalendarDateEntity(tenantId, schoolId, {
      date: dateStr,
      academicYearId,
      calendarEvents: events,
      isInstructionalDay,
      isHoliday,
      isWeekend: weekend,
      dayOfWeek,
      bellScheduleId: isInstructionalDay ? options.defaultBellScheduleId : undefined,
      dayNumber,
      instructionalDayNumber: isInstructionalDay ? instructionalDayNumber : undefined,
      createdAt: now,
      createdBy: 'SYSTEM',
      updatedAt: now,
      updatedBy: 'SYSTEM',
      version: 1,
    }));
    
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  return calendarDates;
}

/**
 * Calculate calendar summary statistics
 */
export function calculateCalendarSummary(calendarDates: CalendarDate[]): {
  totalDays: number;
  instructionalDays: number;
  nonInstructionalDays: number;
  holidays: number;
  teacherOnlyDays: number;
} {
  let totalDays = calendarDates.length;
  let instructionalDays = 0;
  let nonInstructionalDays = 0;
  let holidays = 0;
  let teacherOnlyDays = 0;
  
  calendarDates.forEach(cd => {
    if (cd.isInstructionalDay) {
      instructionalDays++;
    } else {
      nonInstructionalDays++;
    }
    
    if (cd.isHoliday) {
      holidays++;
    }
    
    if (cd.calendarEvents.some(e => e.eventType === 'teacher_only')) {
      teacherOnlyDays++;
    }
  });
  
  return {
    totalDays,
    instructionalDays,
    nonInstructionalDays,
    holidays,
    teacherOnlyDays,
  };
}
