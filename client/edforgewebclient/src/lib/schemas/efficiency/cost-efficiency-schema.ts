/**
 * EdForge EMIS - Cost Efficiency Schema
 * 
 * Cost-related efficiency metrics
 * Part of SABER framework efficiency measurement
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, currencySchema, percentageSchema } from "../base"

/**
 * Cost Efficiency Metric Schema
 * Individual cost efficiency metric
 */
export const costEfficiencyMetricSchema = z.object({
  metricId: uuidSchema,
  metricName: z.string().min(1, "Metric name is required").max(255),
  cost: currencySchema,
  output: z.number().min(0), // e.g., number of students, reports generated
  efficiencyRatio: z.number().min(0), // cost per output unit
  benchmark: z.number().min(0).optional(),
  status: z.enum(["highly_efficient", "efficient", "moderately_efficient", "inefficient"]),
  period: z.string().min(1, "Period is required"),
  measurementDate: isoDateSchema,
})

/**
 * Cost Efficiency Analytics Schema
 * Comprehensive cost efficiency analytics
 */
export const costEfficiencyAnalyticsSchema = z.object({
  schoolId: uuidSchema.optional(),
  period: z.string().min(1, "Period is required"),
  totalCost: currencySchema,
  totalOutput: z.number().min(0),
  overallEfficiencyRatio: z.number().min(0),
  metrics: z.array(costEfficiencyMetricSchema),
  trends: z.array(z.object({
    period: z.string(),
    totalCost: currencySchema,
    efficiencyRatio: z.number().min(0),
  })),
  costBreakdown: z.record(z.string(), z.object({
    cost: currencySchema,
    percentage: percentageSchema,
  })),
})

/**
 * TypeScript types inferred from schemas
 */
export type CostEfficiencyMetric = z.infer<typeof costEfficiencyMetricSchema>
export type CostEfficiencyAnalytics = z.infer<typeof costEfficiencyAnalyticsSchema>

