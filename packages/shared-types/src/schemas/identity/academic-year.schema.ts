/**
 * Academic Year Schemas - Identity Service
 * 
 * Zod schemas for academic year, grading periods, and holiday management DTOs.
 */

import { z } from 'zod';
import { isoDateSchema, createPaginatedResponseSchema } from '../common';
import { academicCalendarTypeSchema } from './school.schema';

// ============================================
// Enums
// ============================================

export const academicYearStatusSchema = z.enum(['planning', 'active', 'completed', 'archived']);
export type AcademicYearStatus = z.infer<typeof academicYearStatusSchema>;

export const termTypeSchema = z.enum(['semester', 'quarter', 'trimester', 'year']);
export type TermType = z.infer<typeof termTypeSchema>;

export const holidayTypeSchema = z.enum([
  'federal',
  'state',
  'school',
  'break',
  'professional_development',
]);
export type HolidayType = z.infer<typeof holidayTypeSchema>;

// ============================================
// Create Academic Year Schema
// ============================================

export const createAcademicYearSchema = z.object({
  name: z.string().min(4).max(20),
  shortName: z.string().max(10).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format'),
  /** BS start date in YYYY/MM/DD format (stored alongside Gregorian for display) */
  startDateBS: z.string().regex(/^\d{4}\/\d{2}\/\d{2}$/, 'Must be YYYY/MM/DD format').optional(),
  /** BS end date in YYYY/MM/DD format */
  endDateBS: z.string().regex(/^\d{4}\/\d{2}\/\d{2}$/, 'Must be YYYY/MM/DD format').optional(),
  calendarType: academicCalendarTypeSchema.default('semester').optional(),
  setAsCurrent: z.boolean().default(false).optional(),
});

export type CreateAcademicYearDto = z.infer<typeof createAcademicYearSchema>;

// ============================================
// Update Academic Year Schema
// ============================================

export const updateAcademicYearSchema = z.object({
  name: z.string().min(4).max(20).optional(),
  shortName: z.string().max(10).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  calendarType: academicCalendarTypeSchema.optional(),
});

export type UpdateAcademicYearDto = z.infer<typeof updateAcademicYearSchema>;

// ============================================
// Update Academic Year Status Schema
// ============================================

export const updateAcademicYearStatusSchema = z.object({
  status: academicYearStatusSchema,
});

export type UpdateAcademicYearStatusDto = z.infer<typeof updateAcademicYearStatusSchema>;

// ============================================
// Academic Year Response Schema
// ============================================

export const academicYearResponseSchema = z.object({
  yearId: z.string(),
  schoolId: z.string(),
  name: z.string(),
  shortName: z.string().optional(),
  startDate: z.string(),
  endDate: z.string(),
  startDateBS: z.string().optional(),
  endDateBS: z.string().optional(),
  status: academicYearStatusSchema,
  isCurrent: z.boolean(),
  calendarType: academicCalendarTypeSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export type AcademicYearResponseDto = z.infer<typeof academicYearResponseSchema>;

// ============================================
// Academic Year List Response Schema
// ============================================

export const academicYearListResponseSchema = createPaginatedResponseSchema(academicYearResponseSchema);
export type AcademicYearListResponseDto = z.infer<typeof academicYearListResponseSchema>;

// ============================================
// Grading Period Schemas
// ============================================

export const createGradingPeriodSchema = z.object({
  name: z.string().min(2).max(50),
  shortName: z.string().max(10).optional(),
  termType: termTypeSchema,
  sequence: z.number().int().min(1).max(12),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gradesDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reportCardDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  academicSessionId: z.string().uuid().optional(),  // Link to AcademicSession (Ed-Fi)
});

export type CreateGradingPeriodDto = z.infer<typeof createGradingPeriodSchema>;

export const updateGradingPeriodSchema = z.object({
  name: z.string().min(2).max(50).optional(),
  shortName: z.string().max(10).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  gradesDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reportCardDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  isActive: z.boolean().optional(),
  academicSessionId: z.string().uuid().optional(),  // Link to AcademicSession (Ed-Fi)
});

export type UpdateGradingPeriodDto = z.infer<typeof updateGradingPeriodSchema>;

export const gradingPeriodResponseSchema = z.object({
  termId: z.string(),
  yearId: z.string(),
  schoolId: z.string(),
  name: z.string(),
  shortName: z.string().optional(),
  termType: termTypeSchema,
  sequence: z.number().int(),
  startDate: z.string(),
  endDate: z.string(),
  gradesDueDate: z.string().optional(),
  reportCardDate: z.string().optional(),
  isActive: z.boolean(),
  academicSessionId: z.string().uuid().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export type GradingPeriodResponseDto = z.infer<typeof gradingPeriodResponseSchema>;

export const gradingPeriodListResponseSchema = createPaginatedResponseSchema(gradingPeriodResponseSchema);
export type GradingPeriodListResponseDto = z.infer<typeof gradingPeriodListResponseSchema>;

// ============================================
// Holiday Schemas
// ============================================

export const createHolidaySchema = z.object({
  name: z.string().min(2).max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  holidayType: holidayTypeSchema,
  affectsStudents: z.boolean().default(true).optional(),
  affectsStaff: z.boolean().default(true).optional(),
});

export type CreateHolidayDto = z.infer<typeof createHolidaySchema>;

export const bulkCreateHolidaysSchema = z.object({
  holidays: z.array(createHolidaySchema),
});

export type BulkCreateHolidaysDto = z.infer<typeof bulkCreateHolidaysSchema>;

export const holidayResponseSchema = z.object({
  holidayId: z.string(),
  yearId: z.string(),
  schoolId: z.string(),
  name: z.string(),
  date: z.string(),
  endDate: z.string().optional(),
  holidayType: holidayTypeSchema,
  affectsStudents: z.boolean(),
  affectsStaff: z.boolean(),
  createdAt: isoDateSchema,
});

export type HolidayResponseDto = z.infer<typeof holidayResponseSchema>;

export const holidayListResponseSchema = createPaginatedResponseSchema(holidayResponseSchema);
export type HolidayListResponseDto = z.infer<typeof holidayListResponseSchema>;

