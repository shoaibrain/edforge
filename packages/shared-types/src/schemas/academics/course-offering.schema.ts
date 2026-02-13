/**
 * Course Offering Schemas - Academics Service
 *
 * Zod schemas for CourseOffering entity management.
 * Ed-Fi: CourseOffering represents a Course offered in a specific
 * Session (academic term) at a school. This is the bridge between
 * Course (catalog) and Section (scheduled class instance).
 *
 * Chain: Course → CourseOffering → Section
 *
 * @see https://api.ed-fi.org/v7.1/docs/swagger/index.html - CourseOffering
 */

import { z } from 'zod';
import {
  isoDateSchema,
  createPaginatedResponseSchema,
} from '../common';

// ============================================
// Create Course Offering Schema
// ============================================

export const createCourseOfferingSchema = z.object({
  // Ed-Fi Core References
  courseId: z.string().uuid(),
  academicSessionId: z.string().uuid(),
  schoolId: z.string().uuid(),

  // Ed-Fi: localCourseCode — school-specific override of courseCode
  localCourseCode: z.string().max(50).optional(),

  // Ed-Fi: localCourseTitle — school-specific override of courseName
  localCourseTitle: z.string().max(200).optional(),
});

export type CreateCourseOfferingDto = z.infer<typeof createCourseOfferingSchema>;

// ============================================
// Update Course Offering Schema
// ============================================

export const updateCourseOfferingSchema = z.object({
  localCourseCode: z.string().max(50).optional(),
  localCourseTitle: z.string().max(200).optional(),
});

export type UpdateCourseOfferingDto = z.infer<typeof updateCourseOfferingSchema>;

// ============================================
// Course Offering Response Schema
// ============================================

export const courseOfferingResponseSchema = z.object({
  // Identifiers
  courseOfferingId: z.string().uuid(),
  tenantId: z.string(),

  // Ed-Fi Core References
  courseId: z.string().uuid(),
  academicSessionId: z.string().uuid(),
  schoolId: z.string().uuid(),

  // Local overrides
  localCourseCode: z.string().optional(),
  localCourseTitle: z.string().optional(),

  // Denormalized for read efficiency
  courseName: z.string().optional(),
  courseCode: z.string().optional(),
  sessionName: z.string().optional(),

  // Metadata
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export type CourseOfferingResponseDto = z.infer<typeof courseOfferingResponseSchema>;

// ============================================
// Course Offering List Response
// ============================================

export const courseOfferingListResponseSchema = createPaginatedResponseSchema(courseOfferingResponseSchema);
export type CourseOfferingListResponseDto = z.infer<typeof courseOfferingListResponseSchema>;

// ============================================
// Course Offering Filter Schema
// ============================================

export const courseOfferingFilterSchema = z.object({
  schoolId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  academicSessionId: z.string().uuid().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type CourseOfferingFilterDto = z.infer<typeof courseOfferingFilterSchema>;
