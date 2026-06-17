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
import { courseSubjectAreaSchema } from './course.schema';

// ============================================
// Section Type Discriminator (Attendance Domain epic / S3.T2)
// ============================================

/**
 * Distinguishes a subject `instructional` section from a `homeroom` section.
 * A homeroom is a Section with no subject course (Ed-Fi course synthesized at
 * export); instructional sections require a `courseId`.
 */
export const sectionTypeSchema = z.enum(['instructional', 'homeroom']);
export type SectionType = z.infer<typeof sectionTypeSchema>;

// ============================================
// Create Section Schema
// ============================================

const createSectionObject = z.object({
  // Course reference (Ed-Fi: CourseOfferingReference) — optional for homeroom
  courseId: z.string().uuid().optional(),

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

  // Section type discriminator (default instructional; homeroom = no course)
  sectionType: sectionTypeSchema.default('instructional'),
});

// Instructional sections require a courseId; homerooms do not. Kept as a
// superRefine on the base object so updateSectionSchema can still derive via
// .partial().omit() (a refined ZodEffects cannot).
export const createSectionSchema = createSectionObject.superRefine((val, ctx) => {
  if (val.sectionType !== 'homeroom' && !val.courseId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['courseId'],
      message: 'courseId is required for instructional sections',
    });
  }
});

export type CreateSectionDto = z.infer<typeof createSectionSchema>;

// ============================================
// Update Section Schema
// ============================================

// sectionType is write-once at create (a homeroom must not silently become an
// instructional section), so it is omitted from the update schema.
export const updateSectionSchema = createSectionObject.partial().omit({
  courseId: true,
  schoolId: true,
  academicYearId: true,
  sectionType: true,
});

export type UpdateSectionDto = z.infer<typeof updateSectionSchema>;

// ============================================
// Section Response Schema
// ============================================

export const sectionResponseSchema = z.object({
  sectionId: z.string().uuid(),
  tenantId: z.string(),

  // Course reference (absent for homeroom sections)
  courseId: z.string().uuid().optional(),
  courseCode: z.string().optional(),
  courseName: z.string().optional(),
  subjectArea: courseSubjectAreaSchema.optional(),

  // School reference
  schoolId: z.string().uuid(),

  // Academic session
  academicYearId: z.string().uuid(),
  termId: z.string().uuid().optional(),

  // Section identity
  sectionNumber: z.string(),
  sectionName: z.string().optional(),
  sectionType: sectionTypeSchema,

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
  sectionType: sectionTypeSchema.optional(),
  academicYearId: z.string().uuid().optional(),
  termId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
  searchTerm: z.string().max(100).optional(),
});

export type SectionFilterDto = z.infer<typeof sectionFilterSchema>;

// ============================================
// Designate Homeroom Schema (S3.T4)
// ============================================

/**
 * Designate a homeroom Section (sectionType:'homeroom', no subject course).
 * A homeroom is where a school's daily attendance roll-call is taken under the
 * `daily` policy; it reuses the Section + SectionEnrollment + section-attendance
 * machinery, just without a courseId (Ed-Fi course synthesized at export).
 */
export const designateHomeroomSchema = z.object({
  schoolId: z.string().uuid(),
  academicYearId: z.string().uuid(),
  sectionNumber: z.string()
    .min(1, 'Section number is required')
    .max(20, 'Section number must not exceed 20 characters'),
  sectionName: z.string().max(100).optional(),
  primaryTeacherId: z.string().uuid(),
  coTeacherIds: z.array(z.string().uuid()).max(5).optional(),
  roomId: z.string().uuid().optional(),
  maxEnrollment: z.number().int().min(1).max(500).default(60),
});

export type DesignateHomeroomDto = z.infer<typeof designateHomeroomSchema>;

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
  // Enriched section details (resolved from CourseSection entity)
  courseId: z.string().uuid().optional(),
  courseCode: z.string().optional(),
  courseName: z.string().optional(),
  sectionName: z.string().optional(),
  teacherName: z.string().optional(),
  roomNumber: z.string().optional(),
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
