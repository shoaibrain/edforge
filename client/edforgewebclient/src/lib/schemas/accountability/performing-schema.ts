/**
 * EdForge EMIS - Performing Schema
 * 
 * Performance accountability (Providers → Stakeholders)
 * Part of SABER framework accountability features
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, percentageSchema } from "../base"

/**
 * Performance Accountability Schema
 * Performance accountability record
 */
export const performanceAccountabilitySchema = z.object({
  accountabilityId: uuidSchema,
  providerId: uuidSchema,
  stakeholderId: uuidSchema,
  performanceMetric: z.string().min(1, "Performance metric is required").max(255),
  target: z.number().optional(),
  actual: z.number().optional(),
  achievementRate: percentageSchema.optional(),
  period: z.string().min(1, "Period is required"),
  status: z.enum(["met", "exceeded", "not_met", "pending"]),
  reportDate: isoDateSchema,
})

/**
 * TypeScript types inferred from schemas
 */
export type PerformanceAccountability = z.infer<typeof performanceAccountabilitySchema>

