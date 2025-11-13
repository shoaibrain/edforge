/**
 * EdForge EMIS - Performance Analytics Schema
 * 
 * Performance analytics and trends
 * Comprehensive learning outcomes measurement
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, percentageSchema, nonNegativeNumberSchema } from "../base"
import { gradeAnalyticsSchema } from "./grades-schema"
import { nationalAssessmentAnalyticsSchema } from "./national-assessment-schema"
import { classroomAssessmentAnalyticsSchema } from "./classroom-assessment-schema"

/**
 * Student Performance Trend Schema
 * Individual student performance trend
 */
export const studentPerformanceTrendSchema = z.object({
  studentId: uuidSchema,
  period: z.string().min(1, "Period is required"),
  averageGrade: z.number().min(0).max(100),
  gradeTrend: z.enum(["improving", "declining", "stable"]),
  assessmentScores: z.record(z.string(), z.number().min(0)),
  improvementRate: z.number().optional(), // Percentage improvement
})

/**
 * Performance Analytics Schema
 * Comprehensive performance analytics
 */
export const performanceAnalyticsSchema = z.object({
  schoolId: uuidSchema.optional(),
  academicYearId: uuidSchema.optional(),
  gradeAnalytics: gradeAnalyticsSchema,
  nationalAssessmentAnalytics: z.array(nationalAssessmentAnalyticsSchema).optional(),
  classroomAssessmentAnalytics: z.array(classroomAssessmentAnalyticsSchema).optional(),
  overallPerformance: z.object({
    averageGrade: z.number().min(0).max(100),
    improvementRate: z.number().optional(),
    studentCount: nonNegativeNumberSchema,
  }),
  studentTrends: z.array(studentPerformanceTrendSchema).optional(),
  subjectPerformance: z.record(z.string(), z.object({
    averageGrade: z.number().min(0).max(100),
    studentCount: nonNegativeNumberSchema,
    improvementRate: z.number().optional(),
  })),
  lastUpdated: isoDateSchema,
})

/**
 * TypeScript types inferred from schemas
 */
export type StudentPerformanceTrend = z.infer<typeof studentPerformanceTrendSchema>
export type PerformanceAnalytics = z.infer<typeof performanceAnalyticsSchema>

