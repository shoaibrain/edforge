/**
 * EdForge EMIS - Data Accuracy Schema
 * 
 * Accuracy tracking
 * Critical for data trust and decision-making
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, percentageSchema, nonNegativeNumberSchema } from "../base"

/**
 * Data Accuracy Record Schema
 * Individual data accuracy record
 */
export const dataAccuracyRecordSchema = z.object({
  recordId: uuidSchema,
  dataSource: z.string().max(255),
  dataType: z.string().max(255),
  totalRecords: nonNegativeNumberSchema,
  accurateRecords: nonNegativeNumberSchema,
  inaccurateRecords: nonNegativeNumberSchema,
  accuracyRate: percentageSchema,
  validationDate: isoDateSchema,
  validatedBy: uuidSchema.optional(),
  issues: z.array(z.string()).optional(),
})

/**
 * Data Accuracy Analytics Schema
 * Comprehensive data accuracy analytics
 */
export const dataAccuracyAnalyticsSchema = z.object({
  schoolId: uuidSchema.optional(),
  period: z.string().min(1, "Period is required"),
  overallAccuracyRate: percentageSchema,
  records: z.array(dataAccuracyRecordSchema),
  sourceBreakdown: z.record(z.string(), z.object({
    accuracyRate: percentageSchema,
    totalRecords: nonNegativeNumberSchema,
  })),
  trends: z.array(z.object({
    period: z.string(),
    accuracyRate: percentageSchema,
  })),
})

/**
 * TypeScript types inferred from schemas
 */
export type DataAccuracyRecord = z.infer<typeof dataAccuracyRecordSchema>
export type DataAccuracyAnalytics = z.infer<typeof dataAccuracyAnalyticsSchema>

