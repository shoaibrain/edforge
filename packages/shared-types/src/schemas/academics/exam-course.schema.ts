/**
 * ExamCourse Schemas — Sprint A.3.3 + A.3.6
 *
 * Zod schemas for the per-exam per-course join entity (an Exam may cover
 * many Courses; each Course gets its own maxMarks / passingMarks / weight).
 *
 * **Architecture: Core Ed-Fi V6 (per `a3-sprint-plan.md` §1.5).**
 *   - `ExamCourse` is the Ed-Fi `AssessmentSection` analogue.
 *   - `courseId` is an FK to A.2's Course entity. Course carries the
 *     `academicSubject` descriptor; ExamCourse denormalizes it at write
 *     time so A.4 term-aggregation doesn't need extra GetItems per row.
 *   - `passingMarks` defaults to 32 (PABSON CDC standard per master plan
 *     A.3.3). Operator-overridable per ExamCourse on POST. Reading from
 *     `SchoolConfiguration.gradingScale` is a V1.5 enhancement.
 *
 * **Per the v3.4 A.2.0 rename:** this entity replaces the older
 * `ExamSubject` concept. Course is the per-instance unit; no separate
 * Subject entity exists in EdForge's Core data model.
 *
 * @see docs/pilot-greenlight/a3-sprint-plan.md §4 A.3.3 + A.3.6
 */

import { z } from 'zod';
import { isoDateSchema, createPaginatedResponseSchema } from '../common';
import { academicSubjectSchema } from '../../descriptors/academic-subject';
import { courseSubjectAreaSchema } from './course.schema';

// ============================================
// Constants
// ============================================

/**
 * PABSON CDC standard passing threshold (32 / 100 = D grade, per CEHRD
 * 10-letter scale). V1 default for new ExamCourse rows when operator
 * doesn't override. GENERIC archetype operators override per write.
 *
 * Widening to read from `SchoolConfiguration.gradingScale` is tracked
 * as V1.5 (open decision §8.2 in sprint plan).
 */
export const PABSON_DEFAULT_PASSING_MARKS = 32;

// ============================================
// Create ExamCourse
// ============================================

/**
 * Create-exam-course DTO. Service-layer validates:
 *   - examId exists + Exam.status ∈ {draft, scheduled} (cannot add courses
 *     after exam goes in_progress)
 *   - courseId exists for the school (via coursesService.getCourse)
 *   - passingMarks ≤ maxMarks
 *
 * Denormalized `courseName`, `courseCode`, `academicSubject` are populated
 * server-side at write time (NOT operator-supplied) by reading the Course
 * row referenced by `courseId`.
 */
export const createExamCourseSchema = z.object({
  schoolId: z.string().uuid(),
  courseId: z.string().uuid(),

  maxMarks: z.number().int().min(1).max(1000),
  passingMarks: z.number()
    .int()
    .min(0)
    .max(1000)
    .default(PABSON_DEFAULT_PASSING_MARKS),

  // Optional weighting; defaults to 1.0 (each course equal weight in term
  // aggregation unless operator specifies). A.4 term-aggregation reads.
  creditHours: z.number().min(0).max(10).optional(),
}).refine(
  (e) => e.passingMarks <= e.maxMarks,
  {
    message: 'passingMarks must not exceed maxMarks',
    path: ['passingMarks'],
  },
);

export type CreateExamCourseDto = z.infer<typeof createExamCourseSchema>;

// ============================================
// Update ExamCourse (partial; immutable fields omitted)
// ============================================

/**
 * Update-exam-course DTO. Immutable after creation: `examId`, `schoolId`,
 * `courseId` (operator must DELETE + recreate to switch courses).
 *
 * Allowed while parent Exam.status ∈ {draft, scheduled}. Service returns
 * 409 EXAM_LOCKED for closed/published.
 */
export const updateExamCourseSchema = z.object({
  maxMarks: z.number().int().min(1).max(1000).optional(),
  passingMarks: z.number().int().min(0).max(1000).optional(),
  creditHours: z.number().min(0).max(10).optional(),
});

export type UpdateExamCourseDto = z.infer<typeof updateExamCourseSchema>;

// ============================================
// ExamCourse response
// ============================================

export const examCourseResponseSchema = z.object({
  examCourseId: z.string().uuid(),
  examId: z.string().uuid(),
  schoolId: z.string().uuid(),
  tenantId: z.string(),

  courseId: z.string().uuid(),

  // Denormalized at write (read-time refresh on demand via PATCH).
  courseName: z.string().optional(),
  courseCode: z.string().optional(),
  // A.2.1 Course descriptor — surfaces here for A.4 aggregation by subject.
  academicSubject: academicSubjectSchema.optional(),
  // Ed-Fi AcademicSubjectDescriptor rollup (always present on Course). Denormalized
  // so the result card always has a subject label even when the finer, optional
  // `academicSubject` is absent (P1a — kills the "unknown" subject on cards).
  subjectArea: courseSubjectAreaSchema.optional(),

  maxMarks: z.number().int(),
  passingMarks: z.number().int(),
  creditHours: z.number().optional(),

  version: z.number().int().min(1),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
});

export type ExamCourseResponseDto = z.infer<typeof examCourseResponseSchema>;

// ============================================
// List response
// ============================================

export const examCourseListResponseSchema = createPaginatedResponseSchema(
  examCourseResponseSchema,
);
export type ExamCourseListResponseDto = z.infer<typeof examCourseListResponseSchema>;

// ============================================
// Filter
// ============================================

export const examCourseFilterSchema = z.object({
  examId: z.string().uuid().optional(),
  schoolId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  academicSubject: academicSubjectSchema.optional(),
});

export type ExamCourseFilterDto = z.infer<typeof examCourseFilterSchema>;
