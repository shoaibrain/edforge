/**
 * EdForge EMIS - Internal Efficiency Schema
 * 
 * Internal EMIS efficiency metrics
 * Part of SABER framework efficiency measurement
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, percentageSchema, nonNegativeNumberSchema } from "../base"

/**
 * Internal Efficiency Metric Schema
 * Individual internal efficiency metric
 */
export const internalEfficiencyMetricSchema = z.object({
  metricId: uuidSchema,
  metricName: z.string().min(1, "Metric name is required").max(255),
  metricType: z.enum([
    "data_collection_time",
    "data_processing_time",
    "report_generation_time",
    "system_uptime",
    "error_rate",
    "data_accuracy",
    "user_satisfaction",
    "other",
  ]),
  value: z.number(),
  unit: z.string().max(50).optional(),
  target: z.number().optional(),
  status: z.enum(["optimal", "acceptable", "concerning", "critical"]),
  period: z.string().min(1, "Period is required"),
  measurementDate: isoDateSchema,
})

/**
 * Internal Efficiency Analytics Schema
 * Comprehensive internal efficiency analytics
 */
export const internalEfficiencyAnalyticsSchema = z.object({
  schoolId: uuidSchema.optional(),
  period: z.string().min(1, "Period is required"),
  overallEfficiencyScore: percentageSchema,
  metrics: z.array(internalEfficiencyMetricSchema),
  trends: z.array(z.object({
    period: z.string(),
    efficiencyScore: percentageSchema,
  })),
  improvementAreas: z.array(z.string()),
  strengths: z.array(z.string()),
})

/**
 * TypeScript types inferred from schemas
 */
export type InternalEfficiencyMetric = z.infer<typeof internalEfficiencyMetricSchema>
export type InternalEfficiencyAnalytics = z.infer<typeof internalEfficiencyAnalyticsSchema>

