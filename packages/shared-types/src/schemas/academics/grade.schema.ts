/**
 * Grade Schemas - Academics Service
 * 
 * Zod schemas for grading and grade management DTOs.
 */

import { z } from 'zod';
import { 
  isoDateSchema,
  dateSchema,
  createPaginatedResponseSchema,
} from '../common';

// ============================================
// Enums
// ============================================

/**
 * Academic grading scale types for student assessments
 */
export const academicGradingScaleTypeSchema = z.enum([
  'percentage',
  'letter',
  'points',
  'standards_based',
  'pass_fail',
]);
export type AcademicGradingScaleType = z.infer<typeof academicGradingScaleTypeSchema>;

export const gradeCategoryTypeSchema = z.enum([
  'assignment',
  'quiz',
  'test',
  'exam',
  'project',
  'homework',
  'participation',
  'lab',
  'presentation',
  'other',
]);
export type GradeCategoryType = z.infer<typeof gradeCategoryTypeSchema>;

export const gradeStatusSchema = z.enum([
  'draft',
  'submitted',
  'published',
  'excused',
  'missing',
  'incomplete',
]);
export type GradeStatus = z.infer<typeof gradeStatusSchema>;

export const assessmentCategorySchema = z.enum(['formative', 'summative']);
export type AssessmentCategory = z.infer<typeof assessmentCategorySchema>;

// ============================================
// Letter Grade Range Schema
// ============================================

/**
 * Letter grade range for academic grading
 * (e.g., A = 90-100%, B = 80-89%, etc.)
 */
export const letterGradeRangeSchema = z.object({
  letter: z.string().max(5),
  minPercentage: z.number().min(0).max(100),
  maxPercentage: z.number().min(0).max(100),
  gpaValue: z.number().min(0).max(5).optional(),
  description: z.string().max(100).optional(),
}).refine(
  data => data.minPercentage <= data.maxPercentage,
  { message: 'Min percentage must be less than or equal to max percentage' }
);

export type LetterGradeRangeDto = z.infer<typeof letterGradeRangeSchema>;

// ============================================
// Academic Grading Scale Schema
// ============================================

/**
 * Academic grading scale for classroom/course grading
 */
export const academicGradingScaleSchema = z.object({
  name: z.string().min(1).max(100),
  scaleType: academicGradingScaleTypeSchema,
  ranges: z.array(letterGradeRangeSchema).min(1).max(20),
  passingGrade: z.number().min(0).max(100).default(60),
  isDefault: z.boolean().default(false),
});

export type AcademicGradingScaleDto = z.infer<typeof academicGradingScaleSchema>;

// ============================================
// Create Grading Scale Schema
// ============================================

export const createGradingScaleSchema = z.object({
  schoolId: z.string().uuid(),
  name: z.string().min(1).max(100),
  scaleType: academicGradingScaleTypeSchema,
  ranges: z.array(letterGradeRangeSchema).min(1).max(20),
  passingGrade: z.number().min(0).max(100).default(60),
  isDefault: z.boolean().default(false),
  description: z.string().max(500).optional(),
});

export type CreateGradingScaleDto = z.infer<typeof createGradingScaleSchema>;

// ============================================
// Grade Category Schema
// ============================================

export const gradeCategorySchema = z.object({
  name: z.string().min(1).max(100),
  categoryType: gradeCategoryTypeSchema,
  weight: z.number().min(0).max(100),
  dropLowest: z.number().int().min(0).max(10).default(0),
  isExtraCredit: z.boolean().default(false),
});

export type GradeCategoryDto = z.infer<typeof gradeCategorySchema>;

// ============================================
// Create Grade Category Schema
// ============================================

export const createGradeCategorySchema = z.object({
  classroomId: z.string().uuid(),
  name: z.string().min(1).max(100),
  categoryType: gradeCategoryTypeSchema,
  weight: z.number().min(0).max(100),
  dropLowest: z.number().int().min(0).max(10).default(0),
  isExtraCredit: z.boolean().default(false),
  color: z.string().max(20).optional(),
});

export type CreateGradeCategoryDto = z.infer<typeof createGradeCategorySchema>;

// ============================================
// Update Grade Category Schema
// ============================================

export const updateGradeCategorySchema = createGradeCategorySchema.partial().omit({
  classroomId: true,
});

export type UpdateGradeCategoryDto = z.infer<typeof updateGradeCategorySchema>;

// ============================================
// Create Grade Schema
// ============================================

export const createGradeSchema = z.object({
  studentId: z.string().uuid(),
  assignmentId: z.string().uuid(),
  classroomId: z.string().uuid(),
  
  // Score
  pointsEarned: z.number().min(0).optional(),
  pointsPossible: z.number().min(0).optional(),
  percentage: z.number().min(0).max(150).optional(), // Allow extra credit
  letterGrade: z.string().max(5).optional(),
  
  // Status
  status: gradeStatusSchema.default('draft'),
  isLate: z.boolean().default(false),
  isExtraCredit: z.boolean().default(false),
  
  // Feedback
  feedback: z.string().max(2000).optional(),
  privateNotes: z.string().max(1000).optional(),
  
  // Rubric
  rubricScores: z.array(z.object({
    criterionId: z.string().uuid(),
    score: z.number().min(0),
    feedback: z.string().max(500).optional(),
  })).optional(),
  
  // Dates
  submittedAt: isoDateSchema.optional(),
  gradedAt: isoDateSchema.optional(),
});

export type CreateGradeDto = z.infer<typeof createGradeSchema>;

// ============================================
// Update Grade Schema
// ============================================

export const updateGradeSchema = createGradeSchema.partial().omit({
  studentId: true,
  assignmentId: true,
  classroomId: true,
});

export type UpdateGradeDto = z.infer<typeof updateGradeSchema>;

// ============================================
// Grade Response Schema
// ============================================

export const gradeResponseSchema = z.object({
  gradeId: z.string().uuid(),
  studentId: z.string().uuid(),
  studentName: z.string().optional(),
  assignmentId: z.string().uuid(),
  assignmentName: z.string().optional(),
  classroomId: z.string().uuid(),
  classroomName: z.string().optional(),
  
  // Score
  pointsEarned: z.number().optional(),
  pointsPossible: z.number().optional(),
  percentage: z.number().optional(),
  letterGrade: z.string().optional(),
  
  // Status
  status: gradeStatusSchema,
  isLate: z.boolean(),
  isExtraCredit: z.boolean(),
  
  // Feedback
  feedback: z.string().optional(),
  privateNotes: z.string().optional(),
  
  // Rubric
  rubricScores: z.array(z.object({
    criterionId: z.string().uuid(),
    criterionName: z.string().optional(),
    score: z.number(),
    maxScore: z.number().optional(),
    feedback: z.string().optional(),
  })).optional(),
  
  // Dates
  submittedAt: z.string().optional(),
  gradedAt: z.string().optional(),
  
  // Metadata
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  gradedBy: z.string().optional(),
});

export type GradeResponseDto = z.infer<typeof gradeResponseSchema>;

// ============================================
// Grade List Response Schema
// ============================================

export const gradeListResponseSchema = createPaginatedResponseSchema(gradeResponseSchema);
export type GradeListResponseDto = z.infer<typeof gradeListResponseSchema>;

// ============================================
// Bulk Grade Schema
// ============================================

export const bulkGradeRecordSchema = z.object({
  studentId: z.string().uuid(),
  pointsEarned: z.number().min(0).optional(),
  percentage: z.number().min(0).max(150).optional(),
  status: gradeStatusSchema.optional(),
  feedback: z.string().max(500).optional(),
});

export const bulkGradeSchema = z.object({
  assignmentId: z.string().uuid(),
  classroomId: z.string().uuid(),
  grades: z.array(bulkGradeRecordSchema).min(1).max(500),
  publishImmediately: z.boolean().default(false),
});

export type BulkGradeDto = z.infer<typeof bulkGradeSchema>;

// ============================================
// Grade Filter Schema
// ============================================

export const gradeFilterSchema = z.object({
  studentId: z.string().uuid().optional(),
  classroomId: z.string().uuid().optional(),
  assignmentId: z.string().uuid().optional(),
  categoryType: gradeCategoryTypeSchema.optional(),
  status: gradeStatusSchema.optional(),
  dateFrom: dateSchema.optional(),
  dateTo: dateSchema.optional(),
  gradingPeriodId: z.string().uuid().optional(),
});

export type GradeFilterDto = z.infer<typeof gradeFilterSchema>;

// ============================================
// Student Grade Summary Schema
// ============================================

export const studentGradeSummarySchema = z.object({
  studentId: z.string().uuid(),
  studentName: z.string(),
  classroomId: z.string().uuid(),
  classroomName: z.string(),
  
  // Overall
  currentGrade: z.number().min(0).max(100).optional(),
  letterGrade: z.string().optional(),
  
  // By Category
  categoryGrades: z.array(z.object({
    categoryId: z.string().uuid(),
    categoryName: z.string(),
    categoryType: gradeCategoryTypeSchema,
    weight: z.number(),
    earnedPoints: z.number(),
    possiblePoints: z.number(),
    percentage: z.number().optional(),
    assignmentCount: z.number().int(),
  })).optional(),
  
  // Statistics
  assignmentsCompleted: z.number().int().min(0),
  assignmentsTotal: z.number().int().min(0),
  missingAssignments: z.number().int().min(0),
  lateAssignments: z.number().int().min(0),
  
  // Trend
  trend: z.enum(['improving', 'declining', 'stable']).optional(),
  previousGrade: z.number().optional(),
});

export type StudentGradeSummaryDto = z.infer<typeof studentGradeSummarySchema>;

// ============================================
// Grade Letter Type
// ============================================

/**
 * Standard letter grade values
 * (matches backend GradeLetter in base.entity.ts)
 */
export const gradeLetterSchema = z.enum([
  'A+', 'A', 'A-',
  'B+', 'B', 'B-',
  'C+', 'C', 'C-',
  'D+', 'D', 'D-',
  'F', 'I', 'W',
]);
export type GradeLetter = z.infer<typeof gradeLetterSchema>;

// ============================================
// Grading Scale Entry Schema
// ============================================

/**
 * A single entry in a grading scale mapping letter grades to numeric ranges and GPA points.
 */
export const gradingScaleEntrySchema = z.object({
  letter: gradeLetterSchema,
  minPercentage: z.number().min(0).max(100),
  maxPercentage: z.number().min(0).max(100),
  gpaPoints: z.number().min(0).max(5),
});
export type GradingScaleEntryDto = z.infer<typeof gradingScaleEntrySchema>;

// ============================================
// Category Weight Schema
// ============================================

/**
 * Weight configuration for a grade category in a grading policy.
 * Unified: includes backend's defaultAssessmentCategory and frontend's dropLowest.
 */
export const categoryWeightSchema = z.object({
  categoryId: z.string(),
  categoryName: z.string(),
  weight: z.number().min(0).max(100),
  defaultAssessmentCategory: assessmentCategorySchema.optional(),
  dropLowest: z.number().int().min(0).max(10).optional(),
});
export type CategoryWeightDto = z.infer<typeof categoryWeightSchema>;

// ============================================
// Assignment Grade Schema (embedded in grade response)
// ============================================

/**
 * Individual assignment/assessment grade within a student's grade document.
 */
export const assignmentGradeSchema = z.object({
  assignmentId: z.string(),
  assignmentName: z.string(),
  assignmentType: z.string(),
  categoryId: z.string().optional(),
  assessmentCategory: assessmentCategorySchema.optional(),
  dueDate: z.string().optional(),
  submittedDate: z.string().optional(),
  earnedPoints: z.number().optional(),
  possiblePoints: z.number(),
  percentage: z.number().optional(),
  letterGrade: z.string().optional(),
  weight: z.number().optional(),
  isExtraCredit: z.boolean().optional(),
  isDropped: z.boolean().optional(),
  isMissing: z.boolean().optional(),
  isExcused: z.boolean().optional(),
  comment: z.string().optional(),
  gradedBy: z.string().optional(),
  gradedAt: z.string().optional(),
});
export type AssignmentGradeDto = z.infer<typeof assignmentGradeSchema>;

// ============================================
// Category Grade Schema (embedded in grade response)
// ============================================

/**
 * Aggregated grade for a category (homework, tests, etc.) within a student's grade.
 */
export const categoryGradeSchema = z.object({
  categoryId: z.string(),
  categoryName: z.string(),
  weight: z.number(),
  earnedPoints: z.number(),
  possiblePoints: z.number(),
  percentage: z.number(),
  letterGrade: z.string().optional(),
});
export type CategoryGradeDto = z.infer<typeof categoryGradeSchema>;

// ============================================
// Course Grade Response Schema (Academics MVP)
// ============================================

/**
 * Grade response DTO for course-based grading.
 * Matches GradeResponseDto from backend grade.mapper.ts.
 */
export const courseGradeResponseSchema = z.object({
  gradeId: z.string(),
  studentId: z.string(),
  studentName: z.string().optional(),
  schoolId: z.string(),
  courseId: z.string(),
  courseName: z.string().optional(),
  sectionId: z.string().optional(),
  teacherId: z.string(),
  academicYearId: z.string(),
  termId: z.string(),
  numericGrade: z.number().optional(),
  letterGrade: z.string().optional(),
  gpaPoints: z.number().optional(),
  credits: z.number().optional(),
  categoryGrades: z.array(categoryGradeSchema).optional(),
  assignments: z.array(assignmentGradeSchema).optional(),
  isFinal: z.boolean(),
  isPassFail: z.boolean().optional(),
  isPassing: z.boolean().optional(),
  teacherComment: z.string().optional(),
  lastCalculatedAt: z.string().optional(),
  publishedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CourseGradeResponseDto = z.infer<typeof courseGradeResponseSchema>;

// ============================================
// Record Assignment Grade Schema (Input DTO)
// ============================================

/**
 * Input for recording a single assignment grade.
 */
export const recordAssignmentGradeSchema = z.object({
  studentId: z.string(),
  studentName: z.string().optional(),
  schoolId: z.string(),
  courseId: z.string(),
  courseName: z.string().optional(),
  sectionId: z.string().optional(),
  termId: z.string(),
  academicYearId: z.string(),
  teacherId: z.string(),
  assignment: z.object({
    assignmentId: z.string().optional(),
    assignmentName: z.string(),
    assignmentType: z.string(),
    categoryId: z.string().optional(),
    assessmentCategory: assessmentCategorySchema.optional(),
    dueDate: z.string().optional(),
    earnedPoints: z.number().optional(),
    possiblePoints: z.number(),
    isExtraCredit: z.boolean().optional(),
    isMissing: z.boolean().optional(),
    isExcused: z.boolean().optional(),
    comment: z.string().optional(),
  }),
});
export type RecordAssignmentGradeDto = z.infer<typeof recordAssignmentGradeSchema>;

// ============================================
// Bulk Record Grade Schema (Input DTO)
// ============================================

/**
 * Input for recording grades for multiple students on one assignment.
 */
export const bulkRecordGradeSchema = z.object({
  schoolId: z.string(),
  sectionId: z.string(),
  courseId: z.string(),
  courseName: z.string().optional(),
  termId: z.string(),
  academicYearId: z.string(),
  teacherId: z.string(),
  assignment: z.object({
    assignmentId: z.string().optional(),
    assignmentName: z.string(),
    assignmentType: z.string(),
    categoryId: z.string().optional(),
    assessmentCategory: assessmentCategorySchema.optional(),
    dueDate: z.string().optional(),
    possiblePoints: z.number(),
    isExtraCredit: z.boolean().optional(),
  }),
  grades: z.array(z.object({
    studentId: z.string(),
    studentName: z.string().optional(),
    earnedPoints: z.number().optional(),
    isMissing: z.boolean().optional(),
    isExcused: z.boolean().optional(),
    comment: z.string().optional(),
  })).min(1),
});
export type BulkRecordGradeDto = z.infer<typeof bulkRecordGradeSchema>;

// ============================================
// Grade Overview Response Schema
// ============================================

/**
 * Aggregated school-wide grade overview.
 */
export const gradeOverviewResponseSchema = z.object({
  totalStudentsGraded: z.number(),
  averageGpa: z.number(),
  averageGrade: z.number(),
  passRate: z.number(),
  atRiskCount: z.number(),
  gradeDistribution: z.array(z.object({
    range: z.string(),
    count: z.number(),
  })),
  coursePerformance: z.array(z.object({
    courseId: z.string(),
    courseName: z.string(),
    sectionCount: z.number(),
    studentCount: z.number(),
    avgGrade: z.number(),
    avgGpa: z.number(),
    passRate: z.number(),
  })),
  atRiskStudents: z.array(z.object({
    studentId: z.string(),
    studentName: z.string(),
    courseId: z.string(),
    courseName: z.string(),
    numericGrade: z.number(),
    letterGrade: z.string().nullable(),
  })),
  totalSections: z.number(),
  sectionsWithGrades: z.number(),
  assessmentBreakdown: z.object({
    formative: z.object({ count: z.number(), avgScore: z.number() }),
    summative: z.object({ count: z.number(), avgScore: z.number() }),
    unclassified: z.object({ count: z.number(), avgScore: z.number() }),
  }).optional(),
  gradingProgress: z.object({
    totalAssignmentEntries: z.number(),
    gradedEntries: z.number(),
    ungradedStubs: z.number(),
    completionRate: z.number(),
  }).optional(),
  categoryPerformance: z.array(z.object({
    categoryId: z.string(),
    categoryName: z.string(),
    assignmentCount: z.number(),
    avgScore: z.number(),
  })).optional(),
});
export type GradeOverviewResponseDto = z.infer<typeof gradeOverviewResponseSchema>;

// ============================================
// Bulk Finalize Schemas
// ============================================

export const bulkFinalizeParamsSchema = z.object({
  sectionId: z.string(),
  termId: z.string(),
  schoolId: z.string(),
});
export type BulkFinalizeParamsDto = z.infer<typeof bulkFinalizeParamsSchema>;

export const bulkFinalizeResponseSchema = z.object({
  finalized: z.number(),
  alreadyFinalized: z.number(),
  errors: z.array(z.object({
    studentId: z.string(),
    courseId: z.string(),
    error: z.string(),
  })),
});
export type BulkFinalizeResponseDto = z.infer<typeof bulkFinalizeResponseSchema>;

// ============================================
// Section Gradebook Response Schema
// ============================================

export const sectionGradebookResponseSchema = z.object({
  sectionId: z.string(),
  termId: z.string(),
  grades: z.array(courseGradeResponseSchema),
});
export type SectionGradebookResponseDto = z.infer<typeof sectionGradebookResponseSchema>;

// ============================================
// GPA Result Schema
// ============================================

/**
 * Matches backend GpaResult from gpa-calculator.service.ts.
 */
export const termGpaSchema = z.object({
  termId: z.string(),
  gpa: z.number(),
  weightedGpa: z.number(),
  credits: z.number(),
});
export type TermGpaDto = z.infer<typeof termGpaSchema>;

export const gpaResultSchema = z.object({
  studentId: z.string(),
  academicYearId: z.string(),
  cumulativeGpa: z.number().nullable(),
  weightedGpa: z.number().nullable(),
  totalCredits: z.number(),
  termGpas: z.array(termGpaSchema),
});
export type GpaResultDto = z.infer<typeof gpaResultSchema>;

// ============================================
// Student Grades Response Schema
// ============================================

export const studentGradesResponseSchema = z.object({
  studentId: z.string(),
  academicYearId: z.string(),
  grades: z.array(courseGradeResponseSchema),
  gpa: gpaResultSchema.nullable(),
});
export type StudentGradesResponseDto = z.infer<typeof studentGradesResponseSchema>;
