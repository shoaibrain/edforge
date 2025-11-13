/**
 * EdForge EMIS - Service Delivery Indicators Schema
 * 
 * Tracks service delivery quality and effectiveness
 * Critical for SABER framework accountability
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, percentageSchema, nonNegativeNumberSchema } from "../base"

/**
 * Service Delivery Indicator Schema
 * Individual service delivery metric
 */
export const serviceDeliveryIndicatorSchema = z.object({
  indicatorId: uuidSchema,
  schoolId: uuidSchema.optional(),
  indicatorName: z.string().min(1, "Indicator name is required").max(255),
  indicatorType: z.enum([
    "instructional_quality",
    "student_support",
    "parent_engagement",
    "community_outreach",
    "resource_utilization",
    "safety_security",
    "technology_access",
    "extracurricular_activities",
    "other",
  ]),
  value: z.number(),
  unit: z.string().optional(),
  target: z.number().optional(),
  status: z.enum(["excellent", "good", "acceptable", "needs_improvement", "critical"]),
  period: z.string().min(1, "Period is required"),
  measurementDate: isoDateSchema,
})

/**
 * Service Delivery Category Schema
 * Groups related service delivery indicators
 */
export const serviceDeliveryCategorySchema = z.object({
  categoryName: z.string().min(1, "Category name is required"),
  indicators: z.array(serviceDeliveryIndicatorSchema),
  overallScore: percentageSchema.optional(),
  targetScore: percentageSchema.optional(),
})

/**
 * Service Delivery Summary Schema
 * Comprehensive service delivery summary
 */
export const serviceDeliverySummarySchema = z.object({
  schoolId: uuidSchema.optional(),
  academicYearId: uuidSchema.optional(),
  categories: z.array(serviceDeliveryCategorySchema),
  overallScore: percentageSchema,
  targetScore: percentageSchema.optional(),
  strengths: z.array(z.string()),
  areasForImprovement: z.array(z.string()),
  trends: z.array(z.object({
    period: z.string(),
    overallScore: percentageSchema,
  })),
  lastUpdated: isoDateSchema,
})

/**
 * Service Delivery Benchmark Schema
 * Benchmarking against standards or peer schools
 */
export const serviceDeliveryBenchmarkSchema = z.object({
  indicatorId: uuidSchema,
  currentValue: z.number(),
  benchmarkValue: z.number(),
  benchmarkType: z.enum(["national_average", "state_average", "district_average", "peer_schools", "target"]),
  variance: z.number(), // Difference from benchmark
  variancePercentage: z.number(),
  status: z.enum(["above_benchmark", "at_benchmark", "below_benchmark"]),
})

/**
 * TypeScript types inferred from schemas
 */
export type ServiceDeliveryIndicator = z.infer<typeof serviceDeliveryIndicatorSchema>
export type ServiceDeliveryCategory = z.infer<typeof serviceDeliveryCategorySchema>
export type ServiceDeliverySummary = z.infer<typeof serviceDeliverySummarySchema>
export type ServiceDeliveryBenchmark = z.infer<typeof serviceDeliveryBenchmarkSchema>

