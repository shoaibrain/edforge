/**
 * EdForge EMIS - Data Trust Schema
 * 
 * Trust indicators for data usage
 * Critical for SABER framework accountability
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, percentageSchema, nonNegativeNumberSchema } from "../base"

/**
 * Data Trust Indicator Schema
 * Individual data trust indicator
 */
export const dataTrustIndicatorSchema = z.object({
  indicatorId: uuidSchema,
  indicatorName: z.string().min(1, "Indicator name is required").max(255),
  trustScore: percentageSchema,
  usageCount: nonNegativeNumberSchema,
  userSatisfaction: percentageSchema.optional(),
  period: z.string().min(1, "Period is required"),
  measurementDate: isoDateSchema,
})

/**
 * Data Trust Analytics Schema
 * Comprehensive data trust analytics
 */
export const dataTrustAnalyticsSchema = z.object({
  schoolId: uuidSchema.optional(),
  period: z.string().min(1, "Period is required"),
  overallTrustScore: percentageSchema,
  indicators: z.array(dataTrustIndicatorSchema),
  userTrust: z.array(z.object({
    userId: uuidSchema,
    trustScore: percentageSchema,
    usageFrequency: z.number().int().min(0),
  })).optional(),
  trends: z.array(z.object({
    period: z.string(),
    trustScore: percentageSchema,
    usageCount: nonNegativeNumberSchema,
  })),
})

/**
 * TypeScript types inferred from schemas
 */
export type DataTrustIndicator = z.infer<typeof dataTrustIndicatorSchema>
export type DataTrustAnalytics = z.infer<typeof dataTrustAnalyticsSchema>

