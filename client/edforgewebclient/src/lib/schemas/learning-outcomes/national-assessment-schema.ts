/**
 * EdForge EMIS - National Assessment Schema
 * 
 * National assessment data tracking
 * Supports standardized testing and benchmarking
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, percentageSchema, nonNegativeNumberSchema } from "../base"

/**
 * National Assessment Schema
 * Individual national assessment record
 */
export const nationalAssessmentSchema = z.object({
  assessmentId: uuidSchema,
  studentId: uuidSchema,
  schoolId: uuidSchema,
  academicYearId: uuidSchema,
  assessmentName: z.string().min(1, "Assessment name is required").max(255),
  assessmentType: z.enum([
    "standardized_test",
    "national_exam",
    "aptitude_test",
    "achievement_test",
    "other",
  ]),
  subject: z.string().max(255).optional(),
  testDate: isoDateSchema,
  score: z.number().min(0),
  maxScore: z.number().min(0).optional(),
  percentile: z.number().min(0).max(100).optional(),
  nationalAverage: z.number().min(0).optional(),
  stateAverage: z.number().min(0).optional(),
  districtAverage: z.number().min(0).optional(),
  performanceLevel: z.enum([
    "exemplary",
    "proficient",
    "developing",
    "beginning",
    "below_basic",
  ]).optional(),
  status: z.enum(["completed", "pending", "absent", "excused"]),
})

/**
 * National Assessment Analytics Schema
 * Comprehensive national assessment analytics
 */
export const nationalAssessmentAnalyticsSchema = z.object({
  schoolId: uuidSchema.optional(),
  academicYearId: uuidSchema.optional(),
  assessmentName: z.string(),
  totalStudents: nonNegativeNumberSchema,
  averageScore: z.number().min(0),
  nationalAverage: z.number().min(0).optional(),
  stateAverage: z.number().min(0).optional(),
  districtAverage: z.number().min(0).optional(),
  performanceLevelDistribution: z.record(z.string(), z.object({
    count: nonNegativeNumberSchema,
    percentage: percentageSchema,
  })),
  subjectBreakdown: z.record(z.string(), z.object({
    averageScore: z.number().min(0),
    studentCount: nonNegativeNumberSchema,
  })),
  trends: z.array(z.object({
    period: z.string(),
    averageScore: z.number().min(0),
    participationRate: percentageSchema,
  })),
})

/**
 * TypeScript types inferred from schemas
 */
export type NationalAssessment = z.infer<typeof nationalAssessmentSchema>
export type NationalAssessmentAnalytics = z.infer<typeof nationalAssessmentAnalyticsSchema>

