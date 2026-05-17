/**
 * Bell Schedule Schemas - Identity Service
 * 
 * Zod schemas for bell schedule management with Ed-Fi alignment.
 * Ed-Fi: BellSchedule defines class periods and timing for a school day.
 */

import { z } from 'zod';
import { 
  timeSchema, 
  dateSchema, 
  isoDateSchema,
  createPaginatedResponseSchema 
} from '../common';

// ============================================
// Enums
// ============================================

/**
 * Day type for schedule application
 */
export const scheduleDayTypeSchema = z.enum([
  'regular',
  'early_release',
  'late_start',
  'assembly',
  'testing',
  'half_day',
  'special',
]);
export type ScheduleDayType = z.infer<typeof scheduleDayTypeSchema>;

/**
 * Period type
 */
export const periodTypeSchema = z.enum([
  'instructional',   // Regular class period
  'homeroom',
  'lunch',
  'recess',
  'passing',         // Passing time between classes
  'assembly',
  'advisory',
  'study_hall',
  'extracurricular',
]);
export type PeriodType = z.infer<typeof periodTypeSchema>;

// ============================================
// Class Period Schema (Ed-Fi aligned)
// ============================================

export const classPeriodSchema = z.object({
  // Ed-Fi Core
  classPeriodName: z.string().min(1).max(60),          // Ed-Fi: classPeriodName

  // EdForge Extensions
  periodNumber: z.number().int().min(0).max(20),
  periodType: periodTypeSchema.default('instructional'),
  startTime: timeSchema,                                // HH:MM format
  endTime: timeSchema,                                  // HH:MM format
  durationMinutes: z.number().int().min(1).max(480),
  isAcademic: z.boolean().default(true),                // Whether this counts as instructional time

  // For rotating schedules
  dayOfWeek: z.array(z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])).optional(),

  // Notes
  description: z.string().max(255).optional(),
}).refine(
  data => {
    const [startH, startM] = data.startTime.split(':').map(Number);
    const [endH, endM] = data.endTime.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    return endMinutes > startMinutes;
  },
  { message: 'End time must be after start time' }
);

export type ClassPeriodDto = z.infer<typeof classPeriodSchema>;

// ============================================
// Create Bell Schedule Schema
// ============================================

export const createBellScheduleSchema = z.object({
  // Ed-Fi Core
  bellScheduleName: z.string().min(1).max(60),         // Ed-Fi: bellScheduleName
  alternateDayName: z.string().max(60).optional(),     // Ed-Fi: alternateDayName (e.g., "A Day", "B Day")
  
  // EdForge Extensions
  dayType: scheduleDayTypeSchema.default('regular'),
  classPeriods: z.array(classPeriodSchema).min(1).max(20),
  
  // Calculated from periods (can be overridden)
  totalInstructionalTime: z.number().int().min(0).optional(), // Ed-Fi: totalInstructionalTime (minutes)
  startTime: timeSchema.optional(),                    // Overall day start
  endTime: timeSchema.optional(),                      // Overall day end
  
  // Validity
  effectiveDate: dateSchema,
  endDate: dateSchema.optional(),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  
  // Notes
  description: z.string().max(500).optional(),
});

export type CreateBellScheduleDto = z.infer<typeof createBellScheduleSchema>;

// ============================================
// Update Bell Schedule Schema
// ============================================

export const updateBellScheduleSchema = createBellScheduleSchema.partial();

export type UpdateBellScheduleDto = z.infer<typeof updateBellScheduleSchema>;

// ============================================
// Bell Schedule Response Schema
// ============================================

export const bellScheduleResponseSchema = z.object({
  // Identifiers
  bellScheduleId: z.string().uuid(),
  schoolId: z.string().uuid(),
  tenantId: z.string().uuid(),
  
  // Ed-Fi Core
  bellScheduleName: z.string(),
  alternateDayName: z.string().optional(),
  totalInstructionalTime: z.number(),
  
  // EdForge Extensions
  dayType: scheduleDayTypeSchema,
  classPeriods: z.array(classPeriodSchema),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  
  // Validity
  effectiveDate: z.string(),
  endDate: z.string().optional(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  
  // Computed
  periodCount: z.number(),
  instructionalPeriodCount: z.number(),
  
  // Notes
  description: z.string().optional(),
  
  // Metadata
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type BellScheduleResponseDto = z.infer<typeof bellScheduleResponseSchema>;

// ============================================
// Bell Schedule List Response
// ============================================

export const bellScheduleListResponseSchema = createPaginatedResponseSchema(bellScheduleResponseSchema);
export type BellScheduleListResponseDto = z.infer<typeof bellScheduleListResponseSchema>;

// ============================================
// Bell Schedule Filter Schema
// ============================================

export const bellScheduleFilterSchema = z.object({
  schoolId: z.string().uuid().optional(),
  dayType: scheduleDayTypeSchema.optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  effectiveOn: dateSchema.optional(),  // Find schedule effective on this date
  limit: z.coerce.number().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type BellScheduleFilterDto = z.infer<typeof bellScheduleFilterSchema>;

// ============================================
// Set Default Schedule Schema
// ============================================

export const setDefaultScheduleSchema = z.object({
  bellScheduleId: z.string().uuid(),
});

export type SetDefaultScheduleDto = z.infer<typeof setDefaultScheduleSchema>;

// ============================================
// Apply Bell-Schedule Preset Schema (C3.4 + C3.5)
// ============================================

/**
 * Apply an archetype-supplied bell-schedule preset to a school. Server
 * resolves the school's archetype, looks up `ARCHETYPE_BELL_PRESETS`,
 * and builds a new BellSchedule via the existing `createBellSchedule`
 * path. Operators can rename + edit periods afterward; the preset is a
 * defaults snapshot, not a contract.
 */
export const applyBellSchedulePresetSchema = z.object({
  /** Which preset to apply. `academic` is C3.4, `exam_day` is C3.5. */
  type: z.enum(['academic', 'exam_day']),

  /** Calendar date the preset takes effect from. Same shape as
   *  `createBellScheduleSchema.effectiveDate`. */
  effectiveDate: dateSchema,

  /** Optional cosmetic override of the preset's default name. */
  bellScheduleName: z.string().min(1).max(60).optional(),

  /** Optional end-date for the schedule's validity window. */
  endDate: dateSchema.optional(),

  /** If true, the created schedule is promoted to school default. */
  isDefault: z.boolean().default(false),
});

export type ApplyBellSchedulePresetDto = z.infer<typeof applyBellSchedulePresetSchema>;
