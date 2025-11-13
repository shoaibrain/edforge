/**
 * EdForge EMIS - Rate Schema
 * 
 * Completion, progression, and survival rates
 * Critical metrics for measuring educational system effectiveness
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, percentageSchema, nonNegativeNumberSchema } from "../base"

/**
 * Completion Rate Schema
 * Tracks completion rates by grade level, program, etc.
 */
export const completionRateSchema = z.object({
  schoolId: uuidSchema.optional(),
  academicYearId: uuidSchema.optional(),
  gradeLevel: z.string().optional(),
  program: z.string().optional(),
  completionRate: percentageSchema,
  totalEligible: nonNegativeNumberSchema,
  totalCompleted: nonNegativeNumberSchema,
  period: z.string().min(1, "Period is required"),
})

/**
 * Progression Rate Schema
 * Tracks student progression through grade levels
 */
export const progressionRateSchema = z.object({
  schoolId: uuidSchema.optional(),
  academicYearId: uuidSchema.optional(),
  fromGrade: z.string().min(1, "From grade is required"),
  toGrade: z.string().min(1, "To grade is required"),
  progressionRate: percentageSchema,
  totalStudents: nonNegativeNumberSchema,
  progressed: nonNegativeNumberSchema,
  retained: nonNegativeNumberSchema,
  period: z.string().min(1, "Period is required"),
})

/**
 * Survival Rate Schema
 * Tracks student survival through educational levels
 */
export const survivalRateSchema = z.object({
  schoolId: uuidSchema.optional(),
  cohort: z.string().min(1, "Cohort identifier is required"), // e.g., "2020-2024"
  startingGrade: z.string().min(1, "Starting grade is required"),
  targetGrade: z.string().min(1, "Target grade is required"),
  survivalRate: percentageSchema,
  initialCohortSize: nonNegativeNumberSchema,
  currentEnrollment: nonNegativeNumberSchema,
  dropouts: nonNegativeNumberSchema,
  transfers: nonNegativeNumberSchema.optional(),
})

/**
 * Rate Trend Schema
 * Historical rate data
 */
export const rateTrendSchema = z.object({
  date: isoDateSchema,
  completionRate: percentageSchema.optional(),
  progressionRate: percentageSchema.optional(),
  survivalRate: percentageSchema.optional(),
  period: z.string().min(1, "Period is required"),
})

/**
 * Rate Analytics Schema
 * Comprehensive rate analytics
 */
export const rateAnalyticsSchema = z.object({
  currentCompletionRate: percentageSchema,
  averageCompletionRate: percentageSchema,
  currentProgressionRate: percentageSchema,
  averageProgressionRate: percentageSchema,
  currentSurvivalRate: percentageSchema,
  averageSurvivalRate: percentageSchema,
  trends: z.array(rateTrendSchema),
  gradeLevelBreakdown: z.record(z.string(), z.object({
    completionRate: percentageSchema,
    progressionRate: percentageSchema,
    survivalRate: percentageSchema,
  })),
})

/**
 * TypeScript types inferred from schemas
 */
export type CompletionRate = z.infer<typeof completionRateSchema>
export type ProgressionRate = z.infer<typeof progressionRateSchema>
export type SurvivalRate = z.infer<typeof survivalRateSchema>
export type RateTrend = z.infer<typeof rateTrendSchema>
export type RateAnalytics = z.infer<typeof rateAnalyticsSchema>

