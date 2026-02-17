/**
 * Course Section Schemas - Academics Service
 *
 * Zod schemas for course section (class instance) management DTOs.
 * A course section is a specific offering of a course with a teacher,
 * schedule, and enrollment cap for a given academic term.
 *
 * Ed-Fi Alignment:
 * - Maps to Ed-Fi "Section" entity
 * - sectionNumber -> Ed-Fi sectionIdentifier
 * - primaryTeacherId -> Ed-Fi StaffSectionAssociation (primary)
 * - maxEnrollment -> Ed-Fi availableCredits context
 *
 * @see https://api.ed-fi.org/v7.1/docs/swagger/index.html - Section
 */

import { z } from 'zod';
import {
  isoDateSchema,
  createPaginatedResponseSchema,
} from '../common';

// ============================================
// Create Section Schema
// ============================================

export const createSectionSchema = z.object({
  // Course reference (Ed-Fi: CourseOfferingReference)
  courseId: z.string().uuid(),

  // School reference (Ed-Fi: SchoolReference / LocationSchoolReference)
  schoolId: z.string().uuid(),

  // Academic session (Ed-Fi: SessionReference)
  academicYearId: z.string().uuid(),
  termId: z.string().uuid().optional(),

  // Section identity (Ed-Fi: sectionIdentifier)
  sectionNumber: z.string()
    .min(1, 'Section number is required')
    .max(20, 'Section number must not exceed 20 characters'),
  sectionName: z.string().max(100).optional(),

  // Teacher assignment (Ed-Fi: StaffSectionAssociation)
  primaryTeacherId: z.string().uuid(),
  coTeacherIds: z.array(z.string().uuid()).max(5).optional(),

  // Physical location
  roomId: z.string().uuid().optional(),

  // Ed-Fi Master Schedule references (optional for backward compat)
  courseOfferingId: z.string().uuid().optional(),
  classPeriodId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),

  // Enrollment capacity
  maxEnrollment: z.number()
    .int()
    .min(1, 'Max enrollment must be at least 1')
    .max(500, 'Max enrollment must not exceed 500'),
});

export type CreateSectionDto = z.infer<typeof createSectionSchema>;

// ============================================
// Update Section Schema
// ============================================

export const updateSectionSchema = createSectionSchema.partial().omit({
  courseId: true,
  schoolId: true,
  academicYearId: true,
});

export type UpdateSectionDto = z.infer<typeof updateSectionSchema>;

// ============================================
// Section Response Schema
// ============================================

export const sectionResponseSchema = z.object({
  sectionId: z.string().uuid(),
  tenantId: z.string(),

  // Course reference
  courseId: z.string().uuid(),
  courseCode: z.string().optional(),
  courseName: z.string().optional(),

  // School reference
  schoolId: z.string().uuid(),

  // Academic session
  academicYearId: z.string().uuid(),
  termId: z.string().uuid().optional(),

  // Section identity
  sectionNumber: z.string(),
  sectionName: z.string().optional(),

  // Teacher assignment
  primaryTeacherId: z.string().uuid(),
  primaryTeacherName: z.string().optional(),
  coTeacherIds: z.array(z.string().uuid()).optional(),

  // Physical location
  roomId: z.string().uuid().optional(),
  roomNumber: z.string().optional(),

  // Ed-Fi Master Schedule references
  courseOfferingId: z.string().uuid().optional(),
  classPeriodId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  periodName: z.string().optional(),
  locationRoomNumber: z.string().optional(),

  // Enrollment
  maxEnrollment: z.number().int(),
  currentEnrollment: z.number().int().min(0),

  // Status
  isActive: z.boolean(),

  // Metadata
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
});

export type SectionResponseDto = z.infer<typeof sectionResponseSchema>;

// ============================================
// Section List Response Schema
// ============================================

export const sectionListResponseSchema = createPaginatedResponseSchema(sectionResponseSchema);
export type SectionListResponseDto = z.infer<typeof sectionListResponseSchema>;

// ============================================
// Section Filter Schema
// ============================================

export const sectionFilterSchema = z.object({
  schoolId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
  termId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
  searchTerm: z.string().max(100).optional(),
});

export type SectionFilterDto = z.infer<typeof sectionFilterSchema>;

// ============================================
// Student-Section Enrollment Schemas
// ============================================

export const enrollStudentInSectionSchema = z.object({
  studentId: z.string().uuid(),
});

export type EnrollStudentInSectionDto = z.infer<typeof enrollStudentInSectionSchema>;

export const studentSectionResponseSchema = z.object({
  studentId: z.string().uuid(),
  studentName: z.string().optional(),
  studentNumber: z.string().optional(),
  currentGradeLevel: z.string().optional(),
  sectionId: z.string().uuid(),
  enrolledAt: isoDateSchema,
  enrolledBy: z.string().optional(),
});

export type StudentSectionResponseDto = z.infer<typeof studentSectionResponseSchema>;

export const sectionRosterResponseSchema = z.object({
  sectionId: z.string().uuid(),
  courseName: z.string().optional(),
  sectionNumber: z.string().optional(),
  students: z.array(studentSectionResponseSchema),
  totalCount: z.number().int().min(0),
});

export type SectionRosterResponseDto = z.infer<typeof sectionRosterResponseSchema>;
