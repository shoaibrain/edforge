/**
 * Academic Session Schemas - Identity Service
 *
 * Zod schemas for Ed-Fi Session entity (named AcademicSession to avoid
 * collision with auth Session entity).
 * Ed-Fi: Session models terms/semesters within an academic year.
 */

import { z } from 'zod';
import { isoDateSchema, createPaginatedResponseSchema } from '../common';

// ============================================
// Enums (Ed-Fi aligned)
// ============================================

/**
 * Term descriptor (Ed-Fi: termDescriptor)
 */
export const termDescriptorSchema = z.enum([
  'fall_semester',
  'spring_semester',
  'year_round',
  'summer',
  'first_quarter',
  'second_quarter',
  'third_quarter',
  'fourth_quarter',
]);
export type TermDescriptor = z.infer<typeof termDescriptorSchema>;

// ============================================
// Create Academic Session Schema
// ============================================

export const createAcademicSessionSchema = z.object({
  academicYearId: z.string().uuid(),
  sessionName: z.string().min(2).max(100),             // e.g., "Fall 2026"
  beginDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format'),
  termDescriptor: termDescriptorSchema,
  gradingPeriodIds: z.array(z.string().uuid()).optional(),
}).refine(
  data => new Date(data.endDate) > new Date(data.beginDate),
  { message: 'End date must be after begin date', path: ['endDate'] }
);

export type CreateAcademicSessionDto = z.infer<typeof createAcademicSessionSchema>;

// ============================================
// Update Academic Session Schema
// ============================================

export const updateAcademicSessionSchema = z.object({
  sessionName: z.string().min(2).max(100).optional(),
  beginDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  termDescriptor: termDescriptorSchema.optional(),
  gradingPeriodIds: z.array(z.string().uuid()).optional(),
});

export type UpdateAcademicSessionDto = z.infer<typeof updateAcademicSessionSchema>;

// ============================================
// Academic Session Response Schema
// ============================================

export const academicSessionResponseSchema = z.object({
  academicSessionId: z.string().uuid(),
  schoolId: z.string().uuid(),
  academicYearId: z.string().uuid(),
  sessionName: z.string(),
  beginDate: z.string(),
  endDate: z.string(),
  totalInstructionalDays: z.number().int(),
  termDescriptor: termDescriptorSchema,
  gradingPeriodIds: z.array(z.string().uuid()).optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export type AcademicSessionResponseDto = z.infer<typeof academicSessionResponseSchema>;

// ============================================
// Academic Session List Response
// ============================================

export const academicSessionListResponseSchema = createPaginatedResponseSchema(academicSessionResponseSchema);
export type AcademicSessionListResponseDto = z.infer<typeof academicSessionListResponseSchema>;
