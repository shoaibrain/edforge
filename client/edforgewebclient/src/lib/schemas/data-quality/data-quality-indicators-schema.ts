/**
 * EdForge EMIS - Data Quality Indicators Schema
 * 
 * Quality metrics and validation
 * Critical for SABER framework data trust and accountability
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, percentageSchema } from "../base"

/**
 * Data Quality Indicator Schema
 * Individual data quality indicator
 */
export const dataQualityIndicatorSchema = z.object({
  indicatorId: uuidSchema,
  indicatorName: z.string().min(1, "Indicator name is required").max(255),
  indicatorType: z.enum([
    "completeness",
    "accuracy",
    "consistency",
    "timeliness",
    "validity",
    "reliability",
    "other",
  ]),
  value: percentageSchema,
  target: percentageSchema.optional(),
  status: z.enum(["excellent", "good", "acceptable", "needs_improvement", "critical"]),
  period: z.string().min(1, "Period is required"),
  measurementDate: isoDateSchema,
})

/**
 * Data Quality Summary Schema
 * Comprehensive data quality summary
 */
export const dataQualitySummarySchema = z.object({
  schoolId: uuidSchema.optional(),
  period: z.string().min(1, "Period is required"),
  overallQualityScore: percentageSchema,
  indicators: z.array(dataQualityIndicatorSchema),
  dataSources: z.array(z.object({
    source: z.string().max(255),
    qualityScore: percentageSchema,
    issues: z.array(z.string()).optional(),
  })).optional(),
  trends: z.array(z.object({
    period: z.string(),
    qualityScore: percentageSchema,
  })),
})

/**
 * TypeScript types inferred from schemas
 */
export type DataQualityIndicator = z.infer<typeof dataQualityIndicatorSchema>
export type DataQualitySummary = z.infer<typeof dataQualitySummarySchema>

