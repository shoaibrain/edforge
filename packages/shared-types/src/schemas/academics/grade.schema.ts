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
