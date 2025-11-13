/**
 * EdForge EMIS - Enrollment Data Schema
 * 
 * Enrollment rates, access rates, and drop-out rates
 * Part of Administrative Data category per SABER framework
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, percentageSchema, nonNegativeNumberSchema } from "../base"

/**
 * Enrollment Rate Schema
 * Tracks enrollment rates over time
 */
export const enrollmentRateSchema = z.object({
  period: z.string().min(1, "Period is required"), // e.g., "2024-Q1", "2024-09"
  enrollmentRate: percentageSchema,
  accessRate: percentageSchema, // Percentage of eligible population enrolled
  dropOutRate: percentageSchema,
  newEnrollments: nonNegativeNumberSchema,
  totalEnrollments: nonNegativeNumberSchema,
  dropouts: nonNegativeNumberSchema,
  eligiblePopulation: nonNegativeNumberSchema.optional(),
})

/**
 * Enrollment Trend Schema
 * Historical enrollment data
 */
export const enrollmentTrendSchema = z.object({
  date: isoDateSchema,
  enrollmentRate: percentageSchema,
  accessRate: percentageSchema,
  dropOutRate: percentageSchema,
  totalStudents: nonNegativeNumberSchema,
  newEnrollments: nonNegativeNumberSchema,
  dropouts: nonNegativeNumberSchema,
})

/**
 * Enrollment Analytics Schema
 * Comprehensive enrollment analytics
 */
export const enrollmentAnalyticsSchema = z.object({
  schoolId: uuidSchema.optional(),
  academicYearId: uuidSchema.optional(),
  currentEnrollmentRate: percentageSchema,
  averageEnrollmentRate: percentageSchema,
  accessRate: percentageSchema,
  dropOutRate: percentageSchema,
  retentionRate: percentageSchema,
  trends: z.array(enrollmentTrendSchema),
  gradeLevelBreakdown: z.record(z.string(), z.object({
    enrollmentRate: percentageSchema,
    totalStudents: nonNegativeNumberSchema,
  })),
})

/**
 * TypeScript types inferred from schemas
 */
export type EnrollmentRate = z.infer<typeof enrollmentRateSchema>
export type EnrollmentTrend = z.infer<typeof enrollmentTrendSchema>
export type EnrollmentAnalytics = z.infer<typeof enrollmentAnalyticsSchema>

