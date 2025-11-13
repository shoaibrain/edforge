/**
 * EdForge EMIS - Financial Analytics Schema
 * 
 * Comprehensive financial reporting and analytics
 * Supports accountability and data-driven financial decisions
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, currencySchema, percentageSchema } from "../base"
import { budgetAnalyticsSchema } from "./budget-schema"
import { feeCollectionAnalyticsSchema } from "./fees-schema"
import { supplyAnalyticsSchema } from "./supplies-schema"

/**
 * Financial Summary Schema
 * Overall financial summary
 */
export const financialSummarySchema = z.object({
  schoolId: uuidSchema.optional(),
  academicYearId: uuidSchema.optional(),
  period: z.string().min(1, "Period is required"),
  totalRevenue: currencySchema,
  totalExpenditure: currencySchema,
  netBalance: currencySchema,
  revenueSources: z.record(z.string(), z.object({
    amount: currencySchema,
    percentage: percentageSchema,
  })),
  expenditureCategories: z.record(z.string(), z.object({
    amount: currencySchema,
    percentage: percentageSchema,
  })),
  budgetVariance: currencySchema, // actual - budget
  budgetVariancePercentage: z.number(),
})

/**
 * Financial Trend Schema
 * Historical financial trends
 */
export const financialTrendSchema = z.object({
  period: z.string().min(1, "Period is required"),
  revenue: currencySchema,
  expenditure: currencySchema,
  netBalance: currencySchema,
  budgetAllocated: currencySchema.optional(),
  budgetSpent: currencySchema.optional(),
})

/**
 * Financial Health Indicator Schema
 * Financial health metrics
 */
export const financialHealthIndicatorSchema = z.object({
  indicator: z.enum([
    "solvency",
    "liquidity",
    "efficiency",
    "sustainability",
    "debt_ratio",
    "reserve_ratio",
  ]),
  value: z.number(),
  status: z.enum(["excellent", "good", "acceptable", "concerning", "critical"]),
  benchmark: z.number().optional(),
  trend: z.enum(["improving", "stable", "declining"]).optional(),
})

/**
 * Financial Analytics Schema
 * Comprehensive financial analytics
 */
export const financialAnalyticsSchema = z.object({
  schoolId: uuidSchema.optional(),
  academicYearId: uuidSchema.optional(),
  summary: financialSummarySchema,
  budgetAnalytics: budgetAnalyticsSchema,
  feeAnalytics: feeCollectionAnalyticsSchema,
  supplyAnalytics: supplyAnalyticsSchema,
  trends: z.array(financialTrendSchema),
  healthIndicators: z.array(financialHealthIndicatorSchema),
  forecasts: z.array(z.object({
    period: z.string(),
    projectedRevenue: currencySchema,
    projectedExpenditure: currencySchema,
    projectedBalance: currencySchema,
  })).optional(),
  lastUpdated: isoDateSchema,
})

/**
 * TypeScript types inferred from schemas
 */
export type FinancialSummary = z.infer<typeof financialSummarySchema>
export type FinancialTrend = z.infer<typeof financialTrendSchema>
export type FinancialHealthIndicator = z.infer<typeof financialHealthIndicatorSchema>
export type FinancialAnalytics = z.infer<typeof financialAnalyticsSchema>

