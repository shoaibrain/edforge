/**
 * EdForge EMIS - School Improvement Program Schema
 * 
 * Tracks school improvement programs and interventions
 * Supports accountability and continuous improvement
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, percentageSchema, nonNegativeNumberSchema, currencySchema } from "../base"

/**
 * Improvement Program Schema
 * Individual school improvement program
 */
export const improvementProgramSchema = z.object({
  programId: uuidSchema,
  schoolId: uuidSchema,
  academicYearId: uuidSchema,
  programName: z.string().min(1, "Program name is required").max(255),
  programType: z.enum([
    "academic_intervention",
    "behavioral_intervention",
    "infrastructure_improvement",
    "teacher_development",
    "curriculum_enhancement",
    "technology_upgrade",
    "community_engagement",
    "other",
  ]),
  focusArea: z.string().max(500).optional(),
  objectives: z.array(z.string()),
  startDate: isoDateSchema,
  endDate: isoDateSchema.optional(),
  budget: currencySchema.optional(),
  fundingSource: z.string().max(255).optional(),
  status: z.enum(["planned", "active", "completed", "cancelled", "on_hold"]),
  progress: percentageSchema.optional(),
  outcomes: z.array(z.object({
    outcomeId: uuidSchema,
    description: z.string().min(1, "Outcome description is required"),
    target: z.string().optional(),
    actual: z.string().optional(),
    status: z.enum(["not_met", "partially_met", "met", "exceeded"]).optional(),
  })).optional(),
})

/**
 * Improvement Intervention Schema
 * Specific intervention within improvement program
 */
export const improvementInterventionSchema = z.object({
  interventionId: uuidSchema,
  programId: uuidSchema,
  interventionName: z.string().min(1, "Intervention name is required"),
  targetPopulation: z.enum([
    "all_students",
    "at_risk_students",
    "specific_grade",
    "specific_subject",
    "teachers",
    "staff",
    "parents",
    "community",
  ]),
  interventionType: z.string().max(255),
  startDate: isoDateSchema,
  endDate: isoDateSchema.optional(),
  participants: nonNegativeNumberSchema.optional(),
  effectiveness: z.enum(["highly_effective", "effective", "moderately_effective", "ineffective", "unknown"]).optional(),
  notes: z.string().max(2000).optional(),
})

/**
 * Improvement Program Analytics Schema
 * Analytics for improvement programs
 */
export const improvementProgramAnalyticsSchema = z.object({
  schoolId: uuidSchema.optional(),
  academicYearId: uuidSchema.optional(),
  totalPrograms: nonNegativeNumberSchema,
  activePrograms: nonNegativeNumberSchema,
  completedPrograms: nonNegativeNumberSchema,
  totalBudget: currencySchema,
  averageProgramDuration: z.number().min(0).optional(), // in days
  successRate: percentageSchema.optional(), // Percentage of programs meeting objectives
  programTypeBreakdown: z.record(z.string(), z.object({
    count: nonNegativeNumberSchema,
    successRate: percentageSchema.optional(),
  })),
  trends: z.array(z.object({
    period: z.string(),
    totalPrograms: nonNegativeNumberSchema,
    activePrograms: nonNegativeNumberSchema,
    totalBudget: currencySchema,
  })),
})

/**
 * TypeScript types inferred from schemas
 */
export type ImprovementProgram = z.infer<typeof improvementProgramSchema>
export type ImprovementIntervention = z.infer<typeof improvementInterventionSchema>
export type ImprovementProgramAnalytics = z.infer<typeof improvementProgramAnalyticsSchema>

