/**
 * EdForge EMIS - Dashboard Data Schema
 * 
 * Comprehensive dashboard data structures
 */

import { z } from "zod"
import { uuidSchema } from "../base"
import { peopleDashboardDataSchema } from "../people/staff-analytics-schema"
import { enrollmentAnalyticsSchema } from "../administrative/enrollment-schema"
import { ratioAnalyticsSchema } from "../administrative/ratio-schema"
import { financialAnalyticsSchema } from "../financial/financial-analytics-schema"

/**
 * Dashboard Data Schema
 * Generic dashboard data structure
 */
export const dashboardDataSchema = z.object({
  schoolId: uuidSchema.optional(),
  academicYearId: uuidSchema.optional(),
  period: z.string().min(1, "Period is required"),
  lastUpdated: z.string(),
})

/**
 * TypeScript types inferred from schemas
 */
export type DashboardData = z.infer<typeof dashboardDataSchema>

