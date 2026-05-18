/**
 * Calendar Date Schemas - Identity Service
 * 
 * Zod schemas for school calendar date management with Ed-Fi alignment.
 * Ed-Fi: CalendarDate defines day-by-day events and characteristics.
 */

import { z } from 'zod';
import {
  dateSchema,
  bsDateSchema,
  isoDateSchema,
  createPaginatedResponseSchema
} from '../common';
import { bsToGregorian } from '../../utils/bikram-sambat';

// ============================================
// Enums (Ed-Fi aligned)
// ============================================

/**
 * Calendar event type (Ed-Fi: calendarEventDescriptor)
 *
 * Sprint S1 cutover (2026-05-14):
 * - REMOVED `testing_day` — replaced by `exam_window` (term-scoped) and `monthly_test` (program-scoped).
 *   Hard cutover; zero rows in pilot DDB (Saraswati had no calendar data).
 * - ADDED `exam_window` — auto-created CalendarDate rows tied to GradingPeriod.examStartDate/examEndDate.
 * - ADDED `school_program` — operator-curated events (Saraswati Puja, Maha Shivaratri, sports day).
 * - ADDED `monthly_test` — periodic assessment day distinct from term-level exam windows
 *   (Shankar Sishu Sadan PABSON pattern).
 */
export const calendarEventDescriptorSchema = z.enum([
  'instructional_day',       // Regular school day
  'non_instructional_day',   // No classes
  'holiday',                 // Official holiday
  'teacher_only',            // Professional development
  'student_holiday',         // Students off, teachers work
  'weather_day',             // Emergency closure
  'exam_window',             // Term exam day (auto-synced from GradingPeriod.exam*Date)
  'school_program',          // Curated school event (cultural, religious, community)
  'monthly_test',            // Periodic assessment day (PABSON monthly cadence)
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
 * Event category — operator-classification for filtering/reporting.
 * Orthogonal to descriptor: a `school_program` event with `category: 'cultural'`
 * vs `category: 'professional_development'` filter differently in agenda views.
 */
export const calendarEventCategorySchema = z.enum([
  'cultural',
  'religious',
  'academic',
  'assessment',
  'administrative',
  'community',
  'professional_development',
  'other',
]);
export type CalendarEventCategory = z.infer<typeof calendarEventCategorySchema>;

/**
 * Event audience — who the event targets. Default `all` means whole-school visibility.
 */
export const calendarEventAudienceSchema = z.enum([
  'students',
  'faculty',
  'parents',
  'community',
  'all',
]);
export type CalendarEventAudience = z.infer<typeof calendarEventAudienceSchema>;

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

/**
 * Calendar block descriptor — category-level grouping for multi-day
 * CalendarBlock entities (Sprint C4) AND for the denormalized
 * `blockDescriptor` field on child CalendarDate rows.
 *
 * Lives in calendar-date.schema.ts (NOT calendar-block.schema.ts) because
 * the dependency direction is: CalendarBlock is built on top of
 * CalendarDate concepts, so calendar-block.schema imports from
 * calendar-date.schema (not the other way around). Putting this enum here
 * lets both schemas use it without a circular import.
 *
 * Operators typically filter the calendar by descriptor — "all religious
 * festivals" vs "all school vacations" vs "all exam blocks".
 */
export const calendarBlockDescriptorSchema = z.enum([
  'religious_festival',  // Dashain, Tihar, Holi, etc.
  'school_vacation',     // Summer, Winter, etc. (school_decision)
  'exam_block',          // Multi-day exam window (paired with grading period)
  'national_observance', // Multi-day national event (rare)
  'other',
]);
export type CalendarBlockDescriptor = z.infer<typeof calendarBlockDescriptorSchema>;

// ============================================
// Calendar Event Schema
// ============================================

export const calendarEventSchema = z.object({
  eventType: calendarEventDescriptorSchema,
  description: z.string().max(255).optional(),
  isAllDay: z.boolean().default(true),
  startTime: z.string().optional(),  // For partial day events
  endTime: z.string().optional(),

  // Sprint S1 — operator-targeting metadata (all optional; absent = whole-school visibility)
  gradeLevelScope: z.array(z.string()).optional(),  // e.g. ['Class 9','Class 10']; absent = all grades
  category: calendarEventCategorySchema.optional(),
  audience: calendarEventAudienceSchema.optional(),

  // Sprint S1 — auto-sync provenance. When set, this event was generated by
  // a grading-period exam-date update (S1.3). Operators MUST NOT set this directly;
  // server populates on auto-create. Used so the auto-sync helper can find
  // and remove its own events without touching operator-added events on the same date.
  sourceTermId: z.string().uuid().optional(),
});

export type CalendarEventDto = z.infer<typeof calendarEventSchema>;

// ============================================
// Create/Update Calendar Date Schema
// ============================================

export const calendarDateSchema = z.object({
  // Ed-Fi Core
  date: dateSchema,                                         // Ed-Fi: date (YYYY-MM-DD)
  calendarEvents: z.array(calendarEventSchema).min(1),      // Ed-Fi: calendarEvents

  // Calendar reference (Ed-Fi: CalendarDate → Calendar)
  calendarId: z.string().uuid().optional(),

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
  calendarDateId: z.string(), // Composite key: {schoolId}::{date} — not a UUID
  schoolId: z.string().uuid(),
  academicYearId: z.string().uuid(),
  tenantId: z.string().uuid(),
  
  // Ed-Fi Core
  date: z.string(),
  calendarEvents: z.array(calendarEventSchema),

  // Calendar reference
  calendarId: z.string().uuid().optional(),

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

  // Multi-day block association (Sprint C4 — Multi-Day Event Blocks).
  // Populated on rows that belong to a parent CalendarBlock (Dashain,
  // Summer Vacation, exam window, etc.). Denormalized from the parent
  // block for read-side convenience so the calendar-grid UI can render
  // block context without a second lookup. Mirrors the entity at
  // server/application/microservices/identity/src/common/entities/calendar-date.entity.ts
  // lines 120-133. Per-day overrides (operator PATCH on a single date)
  // survive a block update; see C4.4.
  blockId: z.string().uuid().optional(),
  blockName: z.string().optional(),
  blockDescriptor: calendarBlockDescriptorSchema.optional(),
  subEventName: z.string().optional(),  // e.g., "Dashain Day 3 — Mahaastami"

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
 * Calendar regeneration mode.
 *
 * - `merge` (default): preserve CalendarDate rows where `createdBy` or
 *   `updatedBy` differs from `'SYSTEM'` (operator overrides), delete the
 *   rest, generate new rows for dates with no preserved row. Safe to run
 *   repeatedly; operator edits survive.
 * - `replace`: delete every CalendarDate for the year regardless of source,
 *   then generate fresh. Operator overrides are wiped. Requires the
 *   "Danger Zone" UI confirmation flow.
 */
export const calendarRegenerationModeSchema = z.enum(['merge', 'replace']);
export type CalendarRegenerationMode = z.infer<typeof calendarRegenerationModeSchema>;

/**
 * Date-input pair: AD (`YYYY-MM-DD`) or BS (`YYYY/MM/DD`).
 * The schema accepts either format; the BS variant is normalized to AD
 * via `bsToGregorian` (TZ-safe as of shared-types 0.45.0). Exactly one
 * format is required per field. Both is allowed, but the AD value wins
 * if present (BS becomes documentation only).
 */
const dateAdOrBsSchema = <K extends string, B extends string>(adField: K, bsField: B) =>
  z.object({
    [adField]: dateSchema.optional(),
    [bsField]: bsDateSchema.optional(),
  } as { [P in K]: z.ZodOptional<typeof dateSchema> } & { [P in B]: z.ZodOptional<typeof bsDateSchema> })
    .refine(
      (data: any) => !!data[adField] || !!data[bsField],
      { message: `Either ${adField} (AD, YYYY-MM-DD) or ${bsField} (BS, YYYY/MM/DD) is required` },
    );

/**
 * Auto-generate calendar dates from academic year.
 *
 * BS input support (C3.6): every date field accepts either an AD
 * (`YYYY-MM-DD`) or BS (`YYYY/MM/DD`) variant. Internally the service
 * normalizes to AD before generation. Mixed AD/BS within a single
 * request is allowed (e.g., AD startDate + BS holidays).
 *
 * Merge mode (C3.8): `mode` defaults to `'merge'` — operator overrides
 * are preserved across regenerations. Use `'replace'` for the
 * destructive path (Danger Zone).
 */
export const generateCalendarSchema = z.object({
  academicYearId: z.string().uuid(),

  // C3.6 — accept either AD or BS for the window endpoints
  startDate: dateSchema.optional(),
  startDateBs: bsDateSchema.optional(),
  endDate: dateSchema.optional(),
  endDateBs: bsDateSchema.optional(),

  // C3.8 — destructive `replace` vs operator-preserving `merge` (default)
  mode: calendarRegenerationModeSchema.default('merge'),

  // Default settings
  defaultBellScheduleId: z.string().uuid().optional(),
  includeWeekends: z.boolean().default(false),

  // Auto-detect weekends
  schoolDays: z.array(calendarDayOfWeekSchema).default(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']),

  // Known holidays (dates to mark as holidays) — AD or BS per entry
  holidays: z.array(z.object({
    date: dateSchema.optional(),
    dateBs: bsDateSchema.optional(),
    name: z.string().max(100),
    eventType: calendarEventDescriptorSchema.default('holiday'),
  }).refine(
    (h) => !!h.date || !!h.dateBs,
    { message: 'Each holiday requires either `date` (AD) or `dateBs` (BS)' },
  )).optional(),

  // Breaks — AD or BS per endpoint per entry
  breaks: z.array(z.object({
    startDate: dateSchema.optional(),
    startDateBs: bsDateSchema.optional(),
    endDate: dateSchema.optional(),
    endDateBs: bsDateSchema.optional(),
    name: z.string().max(100),
    eventType: calendarEventDescriptorSchema.default('break'),
  }).refine(
    (b) => (!!b.startDate || !!b.startDateBs) && (!!b.endDate || !!b.endDateBs),
    { message: 'Each break requires (startDate|startDateBs) AND (endDate|endDateBs)' },
  )).optional(),
}).refine(
  data => !!data.startDate || !!data.startDateBs,
  { message: 'Either startDate (AD) or startDateBs (BS) is required', path: ['startDate'] },
).refine(
  data => !!data.endDate || !!data.endDateBs,
  { message: 'Either endDate (AD) or endDateBs (BS) is required', path: ['endDate'] },
);

export type GenerateCalendarDto = z.infer<typeof generateCalendarSchema>;

/**
 * Normalize an AD-or-BS date pair to a single AD `YYYY-MM-DD` string.
 * AD wins if both are present; otherwise BS is converted via
 * `bsToGregorian`. Throws on out-of-range BS input.
 *
 * Exported so the service layer can normalize at the boundary without
 * duplicating the rule across BS-accepting endpoints.
 */
export function resolveAdDate(adDate?: string, bsDate?: string): string {
  if (adDate) return adDate;
  if (bsDate) {
    const [y, m, d] = bsDate.split('/').map(Number);
    return bsToGregorian(y, m, d);
  }
  throw new Error('Either AD or BS date is required');
}

/**
 * Normalize a `GenerateCalendarDto` into an AD-only shape suitable for
 * the existing `generateCalendarDatesForRange` utility. Pure — no I/O.
 */
export function normalizeGenerateCalendarDtoToAd(dto: GenerateCalendarDto): {
  academicYearId: string;
  startDate: string;
  endDate: string;
  mode: CalendarRegenerationMode;
  defaultBellScheduleId?: string;
  includeWeekends: boolean;
  schoolDays: GenerateCalendarDto['schoolDays'];
  holidays?: Array<{ date: string; name: string; eventType: GenerateCalendarDto['holidays'] extends Array<infer H> ? (H extends { eventType: infer E } ? E : never) : never }>;
  breaks?: Array<{ startDate: string; endDate: string; name: string; eventType: GenerateCalendarDto['breaks'] extends Array<infer B> ? (B extends { eventType: infer E } ? E : never) : never }>;
} {
  return {
    academicYearId: dto.academicYearId,
    startDate: resolveAdDate(dto.startDate, dto.startDateBs),
    endDate: resolveAdDate(dto.endDate, dto.endDateBs),
    mode: dto.mode,
    defaultBellScheduleId: dto.defaultBellScheduleId,
    includeWeekends: dto.includeWeekends,
    schoolDays: dto.schoolDays,
    holidays: dto.holidays?.map((h) => ({
      date: resolveAdDate(h.date, h.dateBs),
      name: h.name,
      eventType: h.eventType,
    })) as any,
    breaks: dto.breaks?.map((b) => ({
      startDate: resolveAdDate(b.startDate, b.startDateBs),
      endDate: resolveAdDate(b.endDate, b.endDateBs),
      name: b.name,
      eventType: b.eventType,
    })) as any,
  };
}

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
