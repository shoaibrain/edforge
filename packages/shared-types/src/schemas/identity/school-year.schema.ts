/**
 * School Year Schemas - Identity Service
 * 
 * Zod schemas for tenant-wide school year aggregation.
 * Extends AcademicYearResponseDto with school context for cross-school views.
 * 
 * Used by: Frontend Shell context for initial data loading
 */

import { z } from 'zod';
import { academicYearResponseSchema } from './academic-year.schema';

// ============================================
// School Year Response Schema (Aggregation View)
// ============================================

/**
 * School Year Response - Extends AcademicYear with school name
 * 
 * This schema represents a school year in the context of tenant-wide aggregation,
 * including the school name for display purposes.
 */
export const schoolYearResponseSchema = academicYearResponseSchema.extend({
  /** School name for display in aggregated views */
  schoolName: z.string(),
});

export type SchoolYearResponseDto = z.infer<typeof schoolYearResponseSchema>;

// ============================================
// School Year List Response Schema
// ============================================

/**
 * School Years List Response - Tenant-wide aggregation
 * 
 * Returns all school years across all schools for a tenant,
 * used by the frontend Shell context for initial data loading.
 */
export const schoolYearListResponseSchema = z.object({
  items: z.array(schoolYearResponseSchema),
  total: z.number().int().min(0),
});

export type SchoolYearListResponseDto = z.infer<typeof schoolYearListResponseSchema>;

// ============================================
// Current School Year Response Schema
// ============================================

/**
 * Current School Year Response - Wrapper for single school year
 * 
 * Used when returning the current school year for a tenant/school.
 */
export const currentSchoolYearResponseSchema = z.object({
  data: schoolYearResponseSchema.nullable(),
});

export type CurrentSchoolYearResponseDto = z.infer<typeof currentSchoolYearResponseSchema>;

/**
 * Current School Years Response - Multiple current years
 * 
 * Returns current school years for all schools in a tenant.
 */
export const currentSchoolYearsResponseSchema = z.object({
  data: z.array(schoolYearResponseSchema),
});

export type CurrentSchoolYearsResponseDto = z.infer<typeof currentSchoolYearsResponseSchema>;
