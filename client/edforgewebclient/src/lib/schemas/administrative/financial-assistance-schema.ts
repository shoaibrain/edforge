/**
 * EdForge EMIS - Financial Assistance Schema
 * 
 * School-feeding programs, Title I, and other financial assistance programs
 * Tracks support for economically disadvantaged students
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, percentageSchema, nonNegativeNumberSchema, currencySchema } from "../base"

/**
 * Financial Assistance Program Schema
 * Individual financial assistance program
 */
export const financialAssistanceProgramSchema = z.object({
  programId: uuidSchema,
  programName: z.string().min(1, "Program name is required").max(255),
  programType: z.enum([
    "school_feeding",
    "title_i",
    "free_reduced_lunch",
    "textbook_assistance",
    "uniform_assistance",
    "transportation_assistance",
    "scholarship",
    "grant",
    "other",
  ]),
  schoolId: uuidSchema.optional(),
  academicYearId: uuidSchema,
  startDate: isoDateSchema,
  endDate: isoDateSchema.optional(),
  totalBudget: currencySchema,
  studentsServed: nonNegativeNumberSchema,
  eligibilityCriteria: z.string().max(1000).optional(),
  status: z.enum(["active", "completed", "cancelled", "planned"]),
})

/**
 * School Feeding Program Schema
 * Specific schema for school feeding programs
 */
export const schoolFeedingProgramSchema = z.object({
  programId: uuidSchema,
  schoolId: uuidSchema,
  academicYearId: uuidSchema,
  programName: z.string().min(1, "Program name is required"),
  mealsPerDay: z.number().int().min(1).max(5),
  studentsServed: nonNegativeNumberSchema,
  dailyMealsServed: nonNegativeNumberSchema,
  costPerMeal: currencySchema.optional(),
  totalBudget: currencySchema,
  fundingSource: z.string().max(255).optional(),
  startDate: isoDateSchema,
  endDate: isoDateSchema.optional(),
  status: z.enum(["active", "completed", "cancelled"]),
})

/**
 * Title I Program Schema
 * Specific schema for Title I programs (US)
 */
export const titleIProgramSchema = z.object({
  programId: uuidSchema,
  schoolId: uuidSchema,
  academicYearId: uuidSchema,
  allocation: currencySchema,
  studentsServed: nonNegativeNumberSchema,
  targetPopulation: z.enum([
    "economically_disadvantaged",
    "low_achieving",
    "at_risk",
    "all_students",
  ]),
  services: z.array(z.string()),
  startDate: isoDateSchema,
  endDate: isoDateSchema.optional(),
  status: z.enum(["active", "completed", "cancelled"]),
})

/**
 * Financial Assistance Student Record Schema
 * Individual student financial assistance record
 */
export const financialAssistanceStudentRecordSchema = z.object({
  studentId: uuidSchema,
  programId: uuidSchema,
  eligibilityStatus: z.enum(["eligible", "approved", "denied", "pending"]),
  enrollmentDate: isoDateSchema,
  exitDate: isoDateSchema.optional(),
  benefitsReceived: z.array(z.object({
    date: isoDateSchema,
    benefitType: z.string(),
    value: currencySchema.optional(),
  })).optional(),
})

/**
 * Financial Assistance Summary Schema
 * School or system-level financial assistance summary
 */
export const financialAssistanceSummarySchema = z.object({
  schoolId: uuidSchema.optional(),
  academicYearId: uuidSchema.optional(),
  totalPrograms: nonNegativeNumberSchema,
  totalBudget: currencySchema,
  totalStudentsServed: nonNegativeNumberSchema,
  programBreakdown: z.array(z.object({
    programType: z.string(),
    count: nonNegativeNumberSchema,
    totalBudget: currencySchema,
    studentsServed: nonNegativeNumberSchema,
  })),
  trends: z.array(z.object({
    period: z.string(),
    totalBudget: currencySchema,
    studentsServed: nonNegativeNumberSchema,
  })),
})

/**
 * TypeScript types inferred from schemas
 */
export type FinancialAssistanceProgram = z.infer<typeof financialAssistanceProgramSchema>
export type SchoolFeedingProgram = z.infer<typeof schoolFeedingProgramSchema>
export type TitleIProgram = z.infer<typeof titleIProgramSchema>
export type FinancialAssistanceStudentRecord = z.infer<typeof financialAssistanceStudentRecordSchema>
export type FinancialAssistanceSummary = z.infer<typeof financialAssistanceSummarySchema>

