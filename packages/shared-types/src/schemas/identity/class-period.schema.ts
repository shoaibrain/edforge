/**
 * Class Period Schemas - Identity Service
 *
 * Zod schemas for standalone ClassPeriod entity management.
 * Ed-Fi: ClassPeriod is a top-level entity representing a time block
 * within a school day. Extracted from embedded BellSchedule periods
 * to allow direct referencing by Section, CourseOffering, etc.
 *
 * @see https://api.ed-fi.org/v7.1/docs/swagger/index.html - ClassPeriod
 */

import { z } from 'zod';
import {
  timeSchema,
  isoDateSchema,
  createPaginatedResponseSchema,
} from '../common';

// ============================================
// Enums
// ============================================

/**
 * Period type (aligned with bell-schedule.schema periodType)
 */
export const classPeriodTypeSchema = z.enum([
  'instructional',
  'homeroom',
  'lunch',
  'recess',
  'passing',
  'assembly',
  'advisory',
  'study_hall',
  'extracurricular',
]);
export type ClassPeriodType = z.infer<typeof classPeriodTypeSchema>;

// ============================================
// Create Class Period Schema
// ============================================

export const createClassPeriodSchema = z.object({
  // Ed-Fi Core
  classPeriodName: z.string()
    .min(1, 'Period name is required')
    .max(60, 'Period name must not exceed 60 characters'),

  // Timing
  startTime: timeSchema,
  endTime: timeSchema,

  // Ordering and classification
  sortOrder: z.number().int().min(0).max(20).default(0),
  periodType: classPeriodTypeSchema.default('instructional'),

  // Whether this period counts as academic/instructional time
  isAcademic: z.boolean().default(true),

  // Optional description
  description: z.string().max(255).optional(),
}).refine(
  data => {
    const [startH, startM] = data.startTime.split(':').map(Number);
    const [endH, endM] = data.endTime.split(':').map(Number);
    return (endH * 60 + endM) > (startH * 60 + startM);
  },
  { message: 'End time must be after start time' }
);

export type CreateClassPeriodDto = z.infer<typeof createClassPeriodSchema>;

// ============================================
// Update Class Period Schema
// ============================================

export const updateClassPeriodSchema = z.object({
  classPeriodName: z.string().min(1).max(60).optional(),
  startTime: timeSchema.optional(),
  endTime: timeSchema.optional(),
  sortOrder: z.number().int().min(0).max(20).optional(),
  periodType: classPeriodTypeSchema.optional(),
  isAcademic: z.boolean().optional(),
  description: z.string().max(255).optional(),
});

export type UpdateClassPeriodDto = z.infer<typeof updateClassPeriodSchema>;

// ============================================
// Class Period Response Schema
// ============================================

export const classPeriodResponseSchema = z.object({
  // Identifiers
  periodId: z.string().uuid(),
  schoolId: z.string().uuid(),
  tenantId: z.string().uuid(),

  // Ed-Fi Core
  classPeriodName: z.string(),

  // Timing
  startTime: z.string(),
  endTime: z.string(),
  durationMinutes: z.number().int(),

  // Classification
  sortOrder: z.number().int(),
  periodType: classPeriodTypeSchema,
  isAcademic: z.boolean(),

  // Description
  description: z.string().optional(),

  // Metadata
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ClassPeriodResponseDto = z.infer<typeof classPeriodResponseSchema>;

// ============================================
// Class Period List Response
// ============================================

export const classPeriodListResponseSchema = createPaginatedResponseSchema(classPeriodResponseSchema);
export type ClassPeriodListResponseDto = z.infer<typeof classPeriodListResponseSchema>;
