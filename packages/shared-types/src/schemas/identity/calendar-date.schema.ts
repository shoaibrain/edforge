/**
 * Calendar Date Schemas - Identity Service
 * 
 * Zod schemas for school calendar date management with Ed-Fi alignment.
 * Ed-Fi: CalendarDate defines day-by-day events and characteristics.
 */

import { z } from 'zod';
import { 
  dateSchema, 
  isoDateSchema,
  createPaginatedResponseSchema 
} from '../common';

// ============================================
// Enums (Ed-Fi aligned)
// ============================================

/**
 * Calendar event type (Ed-Fi: calendarEventDescriptor)
 */
export const calendarEventDescriptorSchema = z.enum([
  'instructional_day',       // Regular school day
  'non_instructional_day',   // No classes
  'holiday',                 // Official holiday
  'teacher_only',            // Professional development
  'student_holiday',         // Students off, teachers work
  'weather_day',             // Emergency closure
  'testing_day',             // Standardized testing
  'early_release',           // Shortened day
  'late_start',              // Delayed start
  'conference_day',          // Parent-teacher conferences
  'graduation',              // Graduation ceremony
  'break',                   // Spring/Winter break
  'in_service',              // Teacher in-service
  'make_up_day',             // Make-up for missed day
  'other',
]);
export type CalendarEventDescriptor = z.infer<typeof calendarEventDescriptorSchema>;

/**
 * Day of week (calendar context - lowercase full names)
 */
export const calendarDayOfWeekSchema = z.enum([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);
export type CalendarDayOfWeek = z.infer<typeof calendarDayOfWeekSchema>;

// ============================================
// Calendar Event Schema
// ============================================

export const calendarEventSchema = z.object({
  eventType: calendarEventDescriptorSchema,
  description: z.string().max(255).optional(),
  isAllDay: z.boolean().default(true),
  startTime: z.string().optional(),  // For partial day events
  endTime: z.string().optional(),
});

export type CalendarEventDto = z.infer<typeof calendarEventSchema>;

// ============================================
// Create/Update Calendar Date Schema
// ============================================

export const calendarDateSchema = z.object({
  // Ed-Fi Core
  date: dateSchema,                                         // Ed-Fi: date (YYYY-MM-DD)
  calendarEvents: z.array(calendarEventSchema).min(1),      // Ed-Fi: calendarEvents
  
  // EdForge Extensions
  isInstructionalDay: z.boolean(),
  isHoliday: z.boolean().default(false),
  isWeekend: z.boolean().optional(),
  
  // Schedule association
  bellScheduleId: z.string().uuid().optional(),
  bellScheduleName: z.string().optional(),
  
  // Grading period association
  gradingPeriodId: z.string().uuid().optional(),
  gradingPeriodName: z.string().optional(),
  
  // Notes
  notes: z.string().max(500).optional(),
});

export type CalendarDateDto = z.infer<typeof calendarDateSchema>;

// ============================================
// Create Calendar Date Schema
// ============================================

export const createCalendarDateSchema = calendarDateSchema;

export type CreateCalendarDateDto = z.infer<typeof createCalendarDateSchema>;

// ============================================
// Update Calendar Date Schema
// ============================================

export const updateCalendarDateSchema = calendarDateSchema.partial().omit({
  date: true,  // Cannot change date
});

export type UpdateCalendarDateDto = z.infer<typeof updateCalendarDateSchema>;

// ============================================
// Calendar Date Response Schema
// ============================================

export const calendarDateResponseSchema = z.object({
  // Identifiers
  calendarDateId: z.string().uuid(),
  schoolId: z.string().uuid(),
  academicYearId: z.string().uuid(),
  tenantId: z.string().uuid(),
  
  // Ed-Fi Core
  date: z.string(),
  calendarEvents: z.array(calendarEventSchema),
  
  // EdForge Extensions
  isInstructionalDay: z.boolean(),
  isHoliday: z.boolean(),
  isWeekend: z.boolean(),
  dayOfWeek: calendarDayOfWeekSchema,
  
  // Schedule
  bellScheduleId: z.string().optional(),
  bellScheduleName: z.string().optional(),
  
  // Grading period
  gradingPeriodId: z.string().optional(),
  gradingPeriodName: z.string().optional(),
  
  // Computed
  dayNumber: z.number().optional(),  // Day number in academic year (1, 2, 3...)
  instructionalDayNumber: z.number().optional(),  // Instructional day number
  
  // Notes
  notes: z.string().optional(),
  
  // Metadata
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CalendarDateResponseDto = z.infer<typeof calendarDateResponseSchema>;

// ============================================
// Calendar Date List Response
// ============================================

export const calendarDateListResponseSchema = createPaginatedResponseSchema(calendarDateResponseSchema);
export type CalendarDateListResponseDto = z.infer<typeof calendarDateListResponseSchema>;

// ============================================
// Calendar Date Filter Schema
// ============================================

export const calendarDateFilterSchema = z.object({
  schoolId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
  gradingPeriodId: z.string().uuid().optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  month: z.number().int().min(1).max(12).optional(),  // Filter by month
  year: z.number().int().min(2020).max(2100).optional(),
  eventType: calendarEventDescriptorSchema.optional(),
  isInstructionalDay: z.boolean().optional(),
  isHoliday: z.boolean().optional(),
  limit: z.coerce.number().min(1).max(400).default(100),  // Higher limit for calendar views
  cursor: z.string().optional(),
});

export type CalendarDateFilterDto = z.infer<typeof calendarDateFilterSchema>;

// ============================================
// Generate Calendar Schema
// ============================================

/**
 * Auto-generate calendar dates from academic year
 */
export const generateCalendarSchema = z.object({
  academicYearId: z.string().uuid(),
  startDate: dateSchema,
  endDate: dateSchema,
  
  // Default settings
  defaultBellScheduleId: z.string().uuid().optional(),
  includeWeekends: z.boolean().default(false),
  
  // Auto-detect weekends
  schoolDays: z.array(calendarDayOfWeekSchema).default(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']),
  
  // Known holidays (dates to mark as holidays)
  holidays: z.array(z.object({
    date: dateSchema,
    name: z.string().max(100),
    eventType: calendarEventDescriptorSchema.default('holiday'),
  })).optional(),
  
  // Breaks
  breaks: z.array(z.object({
    startDate: dateSchema,
    endDate: dateSchema,
    name: z.string().max(100),
    eventType: calendarEventDescriptorSchema.default('break'),
  })).optional(),
}).refine(
  data => new Date(data.endDate) >= new Date(data.startDate),
  { message: 'End date must be on or after start date' }
);

export type GenerateCalendarDto = z.infer<typeof generateCalendarSchema>;

// ============================================
// Bulk Update Calendar Dates Schema
// ============================================

export const bulkUpdateCalendarDatesSchema = z.object({
  dates: z.array(dateSchema).min(1).max(100),
  updates: updateCalendarDateSchema,
});

export type BulkUpdateCalendarDatesDto = z.infer<typeof bulkUpdateCalendarDatesSchema>;

// ============================================
// Calendar Summary Schema
// ============================================

export const calendarSummarySchema = z.object({
  schoolId: z.string().uuid(),
  academicYearId: z.string().uuid(),
  academicYearName: z.string(),
  
  // Totals
  totalDays: z.number(),
  instructionalDays: z.number(),
  nonInstructionalDays: z.number(),
  holidays: z.number(),
  teacherOnlyDays: z.number(),
  
  // Progress (if current year)
  daysPassed: z.number().optional(),
  daysRemaining: z.number().optional(),
  instructionalDaysPassed: z.number().optional(),
  instructionalDaysRemaining: z.number().optional(),
  progressPercentage: z.number().optional(),
  
  // Current period info
  currentGradingPeriod: z.object({
    gradingPeriodId: z.string(),
    name: z.string(),
    daysRemaining: z.number(),
  }).optional(),
  
  // Upcoming events
  upcomingEvents: z.array(z.object({
    date: z.string(),
    eventType: calendarEventDescriptorSchema,
    description: z.string().optional(),
  })).optional(),
});

export type CalendarSummaryDto = z.infer<typeof calendarSummarySchema>;
