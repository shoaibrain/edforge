/**
 * EdForge EMIS - External Efficiency Schema
 * 
 * EMIS efficiency relative to education system
 * Part of SABER framework efficiency measurement
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, percentageSchema } from "../base"

/**
 * External Efficiency Metric Schema
 * Individual external efficiency metric
 */
export const externalEfficiencyMetricSchema = z.object({
  metricId: uuidSchema,
  metricName: z.string().min(1, "Metric name is required").max(255),
  metricType: z.enum([
    "resource_utilization",
    "cost_per_student",
    "cost_per_outcome",
    "system_impact",
    "decision_support",
    "stakeholder_satisfaction",
    "other",
  ]),
  value: z.number(),
  unit: z.string().max(50).optional(),
  benchmark: z.number().optional(),
  status: z.enum(["above_benchmark", "at_benchmark", "below_benchmark"]),
  period: z.string().min(1, "Period is required"),
  measurementDate: isoDateSchema,
})

/**
 * External Efficiency Analytics Schema
 * Comprehensive external efficiency analytics
 */
export const externalEfficiencyAnalyticsSchema = z.object({
  schoolId: uuidSchema.optional(),
  period: z.string().min(1, "Period is required"),
  overallEfficiencyScore: percentageSchema,
  metrics: z.array(externalEfficiencyMetricSchema),
  trends: z.array(z.object({
    period: z.string(),
    efficiencyScore: percentageSchema,
  })),
  benchmarkComparison: z.record(z.string(), z.object({
    current: z.number(),
    benchmark: z.number(),
    variance: z.number(),
  })).optional(),
})

/**
 * TypeScript types inferred from schemas
 */
export type ExternalEfficiencyMetric = z.infer<typeof externalEfficiencyMetricSchema>
export type ExternalEfficiencyAnalytics = z.infer<typeof externalEfficiencyAnalyticsSchema>

