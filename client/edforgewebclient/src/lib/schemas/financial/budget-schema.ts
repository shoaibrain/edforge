/**
 * EdForge EMIS - Budget Schema
 * 
 * Budget expenditure tracking and financial planning
 * Supports accountability and resource management
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, currencySchema, percentageSchema } from "../base"

/**
 * Budget Category Schema
 * Budget line item category
 */
export const budgetCategorySchema = z.enum([
  "personnel",
  "instructional_materials",
  "facilities",
  "technology",
  "transportation",
  "utilities",
  "maintenance",
  "professional_development",
  "student_services",
  "administrative",
  "other",
])

/**
 * Budget Line Item Schema
 * Individual budget line item
 */
export const budgetLineItemSchema = z.object({
  lineItemId: uuidSchema,
  budgetId: uuidSchema,
  category: budgetCategorySchema,
  description: z.string().min(1, "Description is required").max(500),
  allocatedAmount: currencySchema,
  spentAmount: currencySchema.default(0),
  remainingAmount: currencySchema,
  vendor: z.string().max(255).optional(),
  status: z.enum(["planned", "approved", "in_progress", "completed", "cancelled"]),
})

/**
 * Budget Schema
 * Complete budget for a period
 */
export const budgetSchema = z.object({
  budgetId: uuidSchema,
  schoolId: uuidSchema,
  academicYearId: uuidSchema,
  budgetName: z.string().min(1, "Budget name is required").max(255),
  budgetType: z.enum([
    "operational",
    "capital",
    "program_specific",
    "emergency",
    "other",
  ]),
  fiscalYear: z.string().regex(/^\d{4}$/, "Fiscal year must be 4 digits"),
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  totalAllocated: currencySchema,
  totalSpent: currencySchema.default(0),
  totalRemaining: currencySchema,
  lineItems: z.array(budgetLineItemSchema),
  status: z.enum(["draft", "approved", "active", "closed", "cancelled"]),
  approvedBy: uuidSchema.optional(),
  approvedDate: isoDateSchema.optional(),
})

/**
 * Budget Variance Schema
 * Tracks variance between planned and actual spending
 */
export const budgetVarianceSchema = z.object({
  budgetId: uuidSchema,
  category: budgetCategorySchema,
  allocatedAmount: currencySchema,
  spentAmount: currencySchema,
  variance: currencySchema, // spent - allocated (negative = under budget, positive = over budget)
  variancePercentage: z.number(),
  status: z.enum(["under_budget", "on_budget", "over_budget"]),
})

/**
 * Budget Analytics Schema
 * Comprehensive budget analytics
 */
export const budgetAnalyticsSchema = z.object({
  schoolId: uuidSchema.optional(),
  academicYearId: uuidSchema.optional(),
  totalAllocated: currencySchema,
  totalSpent: currencySchema,
  totalRemaining: currencySchema,
  spendingRate: percentageSchema, // Percentage of budget spent
  categoryBreakdown: z.record(z.string(), z.object({
    allocated: currencySchema,
    spent: currencySchema,
    remaining: currencySchema,
    spendingRate: percentageSchema,
  })),
  trends: z.array(z.object({
    period: z.string(),
    allocated: currencySchema,
    spent: currencySchema,
    spendingRate: percentageSchema,
  })),
  variances: z.array(budgetVarianceSchema),
})

/**
 * TypeScript types inferred from schemas
 */
export type BudgetCategory = z.infer<typeof budgetCategorySchema>
export type BudgetLineItem = z.infer<typeof budgetLineItemSchema>
export type Budget = z.infer<typeof budgetSchema>
export type BudgetVariance = z.infer<typeof budgetVarianceSchema>
export type BudgetAnalytics = z.infer<typeof budgetAnalyticsSchema>

