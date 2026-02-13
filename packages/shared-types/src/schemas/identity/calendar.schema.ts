/**
 * Calendar Schemas - Identity Service
 *
 * Zod schemas for Ed-Fi Calendar entity.
 * Ed-Fi: Calendar is an intermediary between School and CalendarDate.
 * A school can have multiple calendars (Student, Teacher, IEP, etc.)
 */

import { z } from 'zod';
import { isoDateSchema, createPaginatedResponseSchema } from '../common';

// ============================================
// Enums (Ed-Fi aligned)
// ============================================

/**
 * Calendar type descriptor (Ed-Fi: calendarTypeDescriptor)
 */
export const calendarTypeDescriptorSchema = z.enum([
  'student',     // Standard student calendar
  'teacher',     // Teacher/staff calendar
  'IEP',         // Individualized Education Program
  'other',
]);
export type CalendarTypeDescriptor = z.infer<typeof calendarTypeDescriptorSchema>;

/**
 * Grade level descriptor for calendar association
 */
export const calendarGradeLevelSchema = z.enum([
  'PK', 'KG', '01', '02', '03', '04', '05', '06',
  '07', '08', '09', '10', '11', '12',
]);
export type CalendarGradeLevel = z.infer<typeof calendarGradeLevelSchema>;

// ============================================
// Create Calendar Schema
// ============================================

export const createCalendarSchema = z.object({
  academicYearId: z.string().uuid(),
  calendarCode: z.string().min(1).max(50),                   // e.g., "STUDENT-2026"
  calendarTypeDescriptor: calendarTypeDescriptorSchema,
  gradeLevels: z.array(calendarGradeLevelSchema).optional(),  // Ed-Fi: GradeLevel[]
  isDefault: z.boolean().default(false),
});

export type CreateCalendarDto = z.infer<typeof createCalendarSchema>;

// ============================================
// Update Calendar Schema
// ============================================

export const updateCalendarSchema = z.object({
  calendarCode: z.string().min(1).max(50).optional(),
  calendarTypeDescriptor: calendarTypeDescriptorSchema.optional(),
  gradeLevels: z.array(calendarGradeLevelSchema).optional(),
  isDefault: z.boolean().optional(),
});

export type UpdateCalendarDto = z.infer<typeof updateCalendarSchema>;

// ============================================
// Calendar Response Schema
// ============================================

export const calendarResponseSchema = z.object({
  calendarId: z.string().uuid(),
  schoolId: z.string().uuid(),
  academicYearId: z.string().uuid(),
  calendarCode: z.string(),
  calendarTypeDescriptor: calendarTypeDescriptorSchema,
  gradeLevels: z.array(calendarGradeLevelSchema).optional(),
  isDefault: z.boolean(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export type CalendarResponseDto = z.infer<typeof calendarResponseSchema>;

// ============================================
// Calendar List Response
// ============================================

export const calendarListResponseSchema = createPaginatedResponseSchema(calendarResponseSchema);
export type CalendarListResponseDto = z.infer<typeof calendarListResponseSchema>;
