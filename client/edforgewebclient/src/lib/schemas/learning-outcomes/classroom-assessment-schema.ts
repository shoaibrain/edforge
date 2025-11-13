/**
 * EdForge EMIS - Classroom Assessment Schema
 * 
 * Classroom-level assessments
 * Supports formative and summative assessment tracking
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, percentageSchema, nonNegativeNumberSchema } from "../base"

/**
 * Classroom Assessment Schema
 * Individual classroom assessment
 */
export const classroomAssessmentSchema = z.object({
  assessmentId: uuidSchema,
  classroomId: uuidSchema,
  subjectId: uuidSchema,
  academicYearId: uuidSchema,
  assessmentName: z.string().min(1, "Assessment name is required").max(255),
  assessmentType: z.enum([
    "formative",
    "summative",
    "diagnostic",
    "benchmark",
    "portfolio",
    "project",
    "other",
  ]),
  assessmentDate: isoDateSchema,
  maxScore: z.number().min(0),
  averageScore: z.number().min(0),
  studentCount: nonNegativeNumberSchema,
  passingScore: z.number().min(0).optional(),
  passRate: percentageSchema.optional(),
  createdBy: uuidSchema,
  rubric: z.string().max(2000).optional(),
})

/**
 * Classroom Assessment Student Result Schema
 * Individual student result in classroom assessment
 */
export const classroomAssessmentStudentResultSchema = z.object({
  resultId: uuidSchema,
  assessmentId: uuidSchema,
  studentId: uuidSchema,
  score: z.number().min(0),
  maxScore: z.number().min(0),
  percentage: percentageSchema,
  passed: z.boolean().optional(),
  feedback: z.string().max(1000).optional(),
  submittedDate: isoDateSchema.optional(),
})

/**
 * Classroom Assessment Analytics Schema
 * Comprehensive classroom assessment analytics
 */
export const classroomAssessmentAnalyticsSchema = z.object({
  classroomId: uuidSchema.optional(),
  academicYearId: uuidSchema.optional(),
  totalAssessments: nonNegativeNumberSchema,
  averageScore: z.number().min(0).max(100),
  averagePassRate: percentageSchema,
  typeBreakdown: z.record(z.string(), z.object({
    count: nonNegativeNumberSchema,
    averageScore: z.number().min(0).max(100),
    passRate: percentageSchema,
  })),
  trends: z.array(z.object({
    period: z.string(),
    averageScore: z.number().min(0).max(100),
    passRate: percentageSchema,
  })),
})

/**
 * TypeScript types inferred from schemas
 */
export type ClassroomAssessment = z.infer<typeof classroomAssessmentSchema>
export type ClassroomAssessmentStudentResult = z.infer<typeof classroomAssessmentStudentResultSchema>
export type ClassroomAssessmentAnalytics = z.infer<typeof classroomAssessmentAnalyticsSchema>

