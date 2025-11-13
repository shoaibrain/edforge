/**
 * EdForge EMIS - Technological Efficiency Schema
 * 
 * Technology means and efficiency
 * Part of SABER framework efficiency measurement
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, percentageSchema } from "../base"

/**
 * Technological Efficiency Metric Schema
 * Individual technological efficiency metric
 */
export const technologicalEfficiencyMetricSchema = z.object({
  metricId: uuidSchema,
  metricName: z.string().min(1, "Metric name is required").max(255),
  metricType: z.enum([
    "system_performance",
    "data_processing_speed",
    "automation_rate",
    "integration_efficiency",
    "user_adoption",
    "technology_utilization",
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
 * Technological Efficiency Analytics Schema
 * Comprehensive technological efficiency analytics
 */
export const technologicalEfficiencyAnalyticsSchema = z.object({
  schoolId: uuidSchema.optional(),
  period: z.string().min(1, "Period is required"),
  overallEfficiencyScore: percentageSchema,
  metrics: z.array(technologicalEfficiencyMetricSchema),
  technologyStack: z.array(z.object({
    technology: z.string().max(255),
    utilizationRate: percentageSchema,
    efficiency: z.enum(["high", "medium", "low"]),
  })).optional(),
  trends: z.array(z.object({
    period: z.string(),
    efficiencyScore: percentageSchema,
  })),
})

/**
 * TypeScript types inferred from schemas
 */
export type TechnologicalEfficiencyMetric = z.infer<typeof technologicalEfficiencyMetricSchema>
export type TechnologicalEfficiencyAnalytics = z.infer<typeof technologicalEfficiencyAnalyticsSchema>

