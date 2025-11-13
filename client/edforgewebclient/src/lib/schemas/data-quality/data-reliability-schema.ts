/**
 * EdForge EMIS - Data Reliability Schema
 * 
 * Reliability measures
 * Critical for data trust and decision-making
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, percentageSchema } from "../base"

/**
 * Data Reliability Metric Schema
 * Individual data reliability metric
 */
export const dataReliabilityMetricSchema = z.object({
  metricId: uuidSchema,
  metricName: z.string().min(1, "Metric name is required").max(255),
  reliabilityScore: percentageSchema,
  consistencyScore: percentageSchema.optional(),
  stabilityScore: percentageSchema.optional(),
  period: z.string().min(1, "Period is required"),
  measurementDate: isoDateSchema,
})

/**
 * Data Reliability Analytics Schema
 * Comprehensive data reliability analytics
 */
export const dataReliabilityAnalyticsSchema = z.object({
  schoolId: uuidSchema.optional(),
  period: z.string().min(1, "Period is required"),
  overallReliabilityScore: percentageSchema,
  metrics: z.array(dataReliabilityMetricSchema),
  dataSourceReliability: z.record(z.string(), percentageSchema).optional(),
  trends: z.array(z.object({
    period: z.string(),
    reliabilityScore: percentageSchema,
  })),
})

/**
 * TypeScript types inferred from schemas
 */
export type DataReliabilityMetric = z.infer<typeof dataReliabilityMetricSchema>
export type DataReliabilityAnalytics = z.infer<typeof dataReliabilityAnalyticsSchema>

