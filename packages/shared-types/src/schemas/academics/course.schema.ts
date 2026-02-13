/**
 * Course Schemas - Academics Service
 *
 * Zod schemas for course catalog management DTOs.
 * Aligned with Ed-Fi CourseOffering and Course data models.
 *
 * Ed-Fi References:
 * - Course: Represents a course catalog entry
 * - CourseOffering: A specific offering of a course during an academic session
 * - CourseCode: Unique identifier for the course
 */

import { z } from 'zod';
import {
  isoDateSchema,
  createPaginatedResponseSchema,
} from '../common';

// ============================================
// Enums (aligned with Ed-Fi AcademicSubjectDescriptor)
// ============================================

/**
 * Course subject area - aligned with Ed-Fi AcademicSubjectDescriptor.
 * Named `courseSubjectAreaSchema` to avoid collision with
 * `courseSubjectAreaSchema` in classroom.schema.ts (which uses different values).
 * This is the Ed-Fi canonical set.
 * @see https://api.ed-fi.org/v7.1/docs/swagger/index.html
 */
export const courseSubjectAreaSchema = z.enum([
  'mathematics',
  'english_language_arts',
  'science',
  'social_studies',
  'world_languages',
  'arts',
  'physical_education',
  'technology',
  'business',
  'vocational',
  'other',
]);
export type CourseSubjectArea = z.infer<typeof courseSubjectAreaSchema>;

/**
 * Course type classification - aligned with Ed-Fi CourseLevelCharacteristicDescriptor
 */
export const courseTypeSchema = z.enum([
  'required',
  'elective',
  'enrichment',
  'remedial',
  'honors',
  'ap',
  'ib',
  'dual_enrollment',
  'vocational',
]);
export type CourseType = z.infer<typeof courseTypeSchema>;

/**
 * Credit type - aligned with Ed-Fi CourseLevelCharacteristicDescriptor
 */
export const creditTypeSchema = z.enum([
  'academic',
  'elective',
  'honors',
  'ap',
  'ib',
  'dual_enrollment',
]);
export type CreditType = z.infer<typeof creditTypeSchema>;

/**
 * Course duration type - aligned with Ed-Fi AcademicTermDescriptor
 */
export const courseDurationSchema = z.enum([
  'semester',
  'year',
  'quarter',
  'trimester',
]);
export type CourseDuration = z.infer<typeof courseDurationSchema>;

// ============================================
// Course Standard Schema (Ed-Fi LearningStandard alignment)
// ============================================

export const courseStandardSchema = z.object({
  standardId: z.string().min(1).max(50),
  standardCode: z.string().min(1).max(60),
  standardName: z.string().min(1).max(255),
  framework: z.string().min(1).max(100), // e.g., 'Common Core', 'NGSS', 'State Standard'
});
export type CourseStandardDto = z.infer<typeof courseStandardSchema>;

// ============================================
// Course Material Schema
// ============================================

export const courseMaterialSchema = z.object({
  materialId: z.string().uuid().optional(),
  type: z.enum(['textbook', 'workbook', 'digital', 'other']),
  title: z.string().min(1).max(255),
  author: z.string().max(255).optional(),
  publisher: z.string().max(255).optional(),
  isbn: z.string().max(17).optional(), // ISBN-13 max length
  edition: z.string().max(50).optional(),
  isRequired: z.boolean().default(true),
});
export type CourseMaterialDto = z.infer<typeof courseMaterialSchema>;

// ============================================
// Create Course Schema
// ============================================

export const createCourseSchema = z.object({
  // Identity (Ed-Fi: CourseCode, CourseTitle)
  courseCode: z.string()
    .min(2, 'Course code must be at least 2 characters')
    .max(20, 'Course code must not exceed 20 characters')
    .regex(/^[A-Z0-9_-]+$/i, 'Course code must contain only letters, numbers, hyphens, and underscores'),
  courseName: z.string()
    .min(2, 'Course name must be at least 2 characters')
    .max(200, 'Course name must not exceed 200 characters'),

  // School reference (Ed-Fi: EducationOrganizationReference)
  schoolId: z.string().uuid(),

  // Department (Ed-Fi: not directly mapped, extension)
  departmentId: z.string().uuid().optional(),
  departmentName: z.string().max(100).optional(),

  // Description (Ed-Fi: CourseDescription)
  description: z.string().max(2000).optional(),
  objectives: z.array(z.string().max(500)).max(20).optional(),

  // Grade levels (Ed-Fi: GradeLevelDescriptor)
  gradeLevels: z.array(z.string().min(1).max(10)).min(1).max(15),

  // Credits (Ed-Fi: MaximumAvailableCredits, CourseDefinedByDescriptor)
  credits: z.number().min(0).max(12),
  creditType: creditTypeSchema.optional(),

  // Subject area (Ed-Fi: AcademicSubjectDescriptor)
  subjectArea: courseSubjectAreaSchema,

  // Course type
  courseType: courseTypeSchema,

  // Prerequisites (Ed-Fi: not directly mapped, common extension)
  prerequisites: z.array(z.string().uuid()).max(10).optional(),
  corequisites: z.array(z.string().uuid()).max(5).optional(),

  // Scheduling
  typicalDuration: courseDurationSchema,
  periodsPerWeek: z.number().int().min(1).max(20).optional(),

  // Year-specific
  academicYearId: z.string().uuid().optional(),

  // Standards alignment (Ed-Fi: LearningStandard)
  standards: z.array(courseStandardSchema).max(50).optional(),

  // Materials
  textbooks: z.array(courseMaterialSchema).max(20).optional(),
});

export type CreateCourseDto = z.infer<typeof createCourseSchema>;

// ============================================
// Update Course Schema
// ============================================

export const updateCourseSchema = createCourseSchema.partial().omit({
  schoolId: true,
  courseCode: true, // courseCode is immutable after creation
});

export type UpdateCourseDto = z.infer<typeof updateCourseSchema>;

// ============================================
// Course Response Schema
// ============================================

export const courseResponseSchema = z.object({
  courseId: z.string().uuid(),
  schoolId: z.string().uuid(),
  tenantId: z.string(),

  // Identity
  courseCode: z.string(),
  courseName: z.string(),

  // Department
  departmentId: z.string().uuid().optional(),
  departmentName: z.string().optional(),

  // Description
  description: z.string().optional(),
  objectives: z.array(z.string()).optional(),

  // Grade levels
  gradeLevels: z.array(z.string()),

  // Credits
  credits: z.number(),
  creditType: creditTypeSchema.optional(),

  // Subject area
  subjectArea: courseSubjectAreaSchema,

  // Course type
  courseType: courseTypeSchema,

  // Prerequisites
  prerequisites: z.array(z.string().uuid()).optional(),
  corequisites: z.array(z.string().uuid()).optional(),

  // Scheduling
  typicalDuration: courseDurationSchema,
  periodsPerWeek: z.number().int().optional(),

  // Status
  isActive: z.boolean(),
  academicYearId: z.string().uuid().optional(),

  // Standards
  standards: z.array(courseStandardSchema).optional(),

  // Materials
  textbooks: z.array(courseMaterialSchema).optional(),

  // Metadata
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
});

export type CourseResponseDto = z.infer<typeof courseResponseSchema>;

// ============================================
// Course List Response Schema
// ============================================

export const courseListResponseSchema = createPaginatedResponseSchema(courseResponseSchema);
export type CourseListResponseDto = z.infer<typeof courseListResponseSchema>;

// ============================================
// Course Filter Schema
// ============================================

export const courseFilterSchema = z.object({
  schoolId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  subjectArea: courseSubjectAreaSchema.optional(),
  courseType: courseTypeSchema.optional(),
  creditType: creditTypeSchema.optional(),
  gradeLevel: z.string().max(10).optional(),
  isActive: z.boolean().optional(),
  academicYearId: z.string().uuid().optional(),
  searchTerm: z.string().max(100).optional(),
});

export type CourseFilterDto = z.infer<typeof courseFilterSchema>;
