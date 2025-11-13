/**
 * EdForge EMIS - Grades Schema
 * 
 * Grade tracking and validation
 * Supports learning outcomes measurement
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, percentageSchema, nonNegativeNumberSchema } from "../base"

/**
 * Grade Schema
 * Individual grade record
 */
export const gradeSchema = z.object({
  gradeId: uuidSchema,
  studentId: uuidSchema,
  assignmentId: uuidSchema.optional(),
  subjectId: uuidSchema,
  classroomId: uuidSchema,
  academicYearId: uuidSchema,
  termId: uuidSchema.optional(),
  gradeValue: z.union([
    z.number().min(0).max(100), // Percentage
    z.string().max(10), // Letter grade (A, B+, etc.)
  ]),
  gradeType: z.enum([
    "assignment",
    "quiz",
    "exam",
    "project",
    "participation",
    "final",
    "midterm",
    "other",
  ]),
  maxPoints: z.number().min(0).optional(),
  earnedPoints: z.number().min(0).optional(),
  weight: z.number().min(0).max(100).optional(), // Percentage weight
  recordedDate: isoDateSchema,
  recordedBy: uuidSchema,
  notes: z.string().max(1000).optional(),
})

/**
 * Grade Summary Schema
 * Grade summary for a student/subject/term
 */
export const gradeSummarySchema = z.object({
  studentId: uuidSchema,
  subjectId: uuidSchema,
  classroomId: uuidSchema,
  academicYearId: uuidSchema,
  termId: uuidSchema.optional(),
  finalGrade: z.union([
    z.number().min(0).max(100),
    z.string().max(10),
  ]),
  averageGrade: z.number().min(0).max(100),
  gradeCount: nonNegativeNumberSchema,
  gradeDistribution: z.record(z.string(), z.object({
    count: nonNegativeNumberSchema,
    average: z.number().min(0).max(100),
  })),
  trend: z.enum(["improving", "declining", "stable"]).optional(),
})

/**
 * Grade Analytics Schema
 * Comprehensive grade analytics
 */
export const gradeAnalyticsSchema = z.object({
  schoolId: uuidSchema.optional(),
  academicYearId: uuidSchema.optional(),
  averageGrade: z.number().min(0).max(100),
  gradeDistribution: z.array(z.object({
    range: z.string(), // e.g., "90-100", "80-89"
    count: nonNegativeNumberSchema,
    percentage: percentageSchema,
  })),
  subjectBreakdown: z.record(z.string(), z.object({
    averageGrade: z.number().min(0).max(100),
    studentCount: nonNegativeNumberSchema,
  })),
  trends: z.array(z.object({
    period: z.string(),
    averageGrade: z.number().min(0).max(100),
  })),
})

/**
 * TypeScript types inferred from schemas
 */
export type Grade = z.infer<typeof gradeSchema>
export type GradeSummary = z.infer<typeof gradeSummarySchema>
export type GradeAnalytics = z.infer<typeof gradeAnalyticsSchema>

