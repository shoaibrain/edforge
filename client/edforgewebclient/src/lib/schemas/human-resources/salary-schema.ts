/**
 * EdForge EMIS - Salary Schema
 * 
 * Salaries for teaching and non-teaching staff
 * Supports financial planning and accountability
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, currencySchema, percentageSchema } from "../base"

/**
 * Salary Structure Schema
 * Salary structure definition
 */
export const salaryStructureSchema = z.object({
  structureId: uuidSchema,
  schoolId: uuidSchema.optional(),
  roleType: z.string().max(100),
  baseSalary: currencySchema,
  salaryScale: z.array(z.object({
    level: z.string(),
    minSalary: currencySchema,
    maxSalary: currencySchema,
    increment: currencySchema.optional(),
  })).optional(),
  effectiveDate: isoDateSchema,
  expiryDate: isoDateSchema.optional(),
  status: z.enum(["active", "inactive", "archived"]),
})

/**
 * Staff Salary Record Schema
 * Individual staff salary record
 */
export const staffSalaryRecordSchema = z.object({
  salaryId: uuidSchema,
  staffId: uuidSchema,
  schoolId: uuidSchema,
  academicYearId: uuidSchema,
  baseSalary: currencySchema,
  allowances: z.array(z.object({
    allowanceType: z.string().max(100),
    amount: currencySchema,
    frequency: z.enum(["monthly", "quarterly", "annual", "one_time"]),
  })),
  deductions: z.array(z.object({
    deductionType: z.string().max(100),
    amount: currencySchema,
    frequency: z.enum(["monthly", "quarterly", "annual", "one_time"]),
  })).optional(),
  grossSalary: currencySchema,
  netSalary: currencySchema,
  effectiveDate: isoDateSchema,
  endDate: isoDateSchema.optional(),
  paymentFrequency: z.enum(["monthly", "biweekly", "weekly", "annual"]),
  status: z.enum(["active", "suspended", "terminated"]),
})

/**
 * Salary Analytics Schema
 * Comprehensive salary analytics
 */
export const salaryAnalyticsSchema = z.object({
  schoolId: uuidSchema.optional(),
  academicYearId: uuidSchema.optional(),
  totalSalaryExpenditure: currencySchema,
  averageSalary: currencySchema,
  medianSalary: currencySchema.optional(),
  salaryByRole: z.record(z.string(), z.object({
    count: z.number().int().min(0),
    totalSalary: currencySchema,
    averageSalary: currencySchema,
    minSalary: currencySchema,
    maxSalary: currencySchema,
  })),
  salaryDistribution: z.array(z.object({
    range: z.string(), // e.g., "$30k-$40k"
    count: z.number().int().min(0),
    percentage: percentageSchema,
  })),
  trends: z.array(z.object({
    period: z.string(),
    totalExpenditure: currencySchema,
    averageSalary: currencySchema,
    staffCount: z.number().int().min(0),
  })),
})

/**
 * TypeScript types inferred from schemas
 */
export type SalaryStructure = z.infer<typeof salaryStructureSchema>
export type StaffSalaryRecord = z.infer<typeof staffSalaryRecordSchema>
export type SalaryAnalytics = z.infer<typeof salaryAnalyticsSchema>

