/**
 * EdForge EMIS - Capacity Building Schema
 * 
 * Staff capacity development and retention tracking
 * Addresses high staff turnover challenge identified in SABER framework
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, percentageSchema, nonNegativeNumberSchema } from "../base"
import { professionalDevelopmentRecordSchema } from "./professional-development-schema"

/**
 * Capacity Building Program Schema
 * Capacity building program definition
 */
export const capacityBuildingProgramSchema = z.object({
  programId: uuidSchema,
  schoolId: uuidSchema.optional(),
  programName: z.string().min(1, "Program name is required").max(255),
  programType: z.enum([
    "technical_skills",
    "pedagogical_skills",
    "leadership",
    "data_management",
    "emis_training",
    "technology",
    "other",
  ]),
  targetAudience: z.enum([
    "all_staff",
    "teachers",
    "administrators",
    "support_staff",
    "data_staff",
    "specific_department",
  ]),
  startDate: isoDateSchema,
  endDate: isoDateSchema.optional(),
  participants: z.array(uuidSchema),
  objectives: z.array(z.string()),
  status: z.enum(["planned", "active", "completed", "cancelled"]),
  effectiveness: z.enum(["highly_effective", "effective", "moderately_effective", "ineffective", "unknown"]).optional(),
})

/**
 * Retention Strategy Schema
 * Staff retention strategy tracking
 */
export const retentionStrategySchema = z.object({
  strategyId: uuidSchema,
  schoolId: uuidSchema,
  strategyName: z.string().min(1, "Strategy name is required").max(255),
  strategyType: z.enum([
    "compensation",
    "professional_development",
    "work_environment",
    "recognition",
    "career_advancement",
    "work_life_balance",
    "other",
  ]),
  startDate: isoDateSchema,
  endDate: isoDateSchema.optional(),
  targetStaff: z.array(uuidSchema).optional(),
  status: z.enum(["planned", "active", "completed", "cancelled"]),
  effectiveness: z.enum(["highly_effective", "effective", "moderately_effective", "ineffective", "unknown"]).optional(),
})

/**
 * Turnover Record Schema
 * Staff turnover tracking
 */
export const turnoverRecordSchema = z.object({
  recordId: uuidSchema,
  staffId: uuidSchema,
  schoolId: uuidSchema,
  departureDate: isoDateSchema,
  departureReason: z.enum([
    "resignation",
    "retirement",
    "termination",
    "transfer",
    "end_of_contract",
    "other",
  ]),
  yearsOfService: z.number().min(0).max(50),
  replacementHired: z.boolean().default(false),
  replacementDate: isoDateSchema.optional(),
  replacementStaffId: uuidSchema.optional(),
  exitInterviewConducted: z.boolean().default(false),
  feedback: z.string().max(2000).optional(),
})

/**
 * Capacity Building Analytics Schema
 * Comprehensive capacity building analytics
 */
export const capacityBuildingAnalyticsSchema = z.object({
  schoolId: uuidSchema.optional(),
  academicYearId: uuidSchema.optional(),
  totalPrograms: nonNegativeNumberSchema,
  activePrograms: nonNegativeNumberSchema,
  totalParticipants: nonNegativeNumberSchema,
  averageParticipationRate: percentageSchema,
  programEffectiveness: z.record(z.string(), z.object({
    count: nonNegativeNumberSchema,
    effectivenessDistribution: z.record(z.string(), nonNegativeNumberSchema),
  })),
  staffCapacityLevels: z.array(z.object({
    staffId: uuidSchema,
    capacityScore: z.number().min(0).max(100),
    skillsGained: z.array(z.string()),
    certificationsEarned: nonNegativeNumberSchema,
  })),
  trends: z.array(z.object({
    period: z.string(),
    totalPrograms: nonNegativeNumberSchema,
    totalParticipants: nonNegativeNumberSchema,
    averageEffectiveness: z.number().min(0).max(100).optional(),
  })),
})

/**
 * Retention Analytics Schema
 * Comprehensive retention analytics
 */
export const retentionAnalyticsSchema = z.object({
  schoolId: uuidSchema.optional(),
  academicYearId: uuidSchema.optional(),
  currentRetentionRate: percentageSchema,
  averageRetentionRate: percentageSchema,
  turnoverRate: percentageSchema,
  averageTenure: z.number().min(0), // in years
  turnoverByRole: z.record(z.string(), z.object({
    count: nonNegativeNumberSchema,
    turnoverRate: percentageSchema,
    averageTenure: z.number().min(0),
  })),
  turnoverByReason: z.record(z.string(), z.object({
    count: nonNegativeNumberSchema,
    percentage: percentageSchema,
  })),
  retentionStrategies: z.array(z.object({
    strategyId: uuidSchema,
    effectiveness: z.enum(["highly_effective", "effective", "moderately_effective", "ineffective", "unknown"]).optional(),
  })),
  trends: z.array(z.object({
    period: z.string(),
    retentionRate: percentageSchema,
    turnoverRate: percentageSchema,
    averageTenure: z.number().min(0),
  })),
})

/**
 * TypeScript types inferred from schemas
 */
export type CapacityBuildingProgram = z.infer<typeof capacityBuildingProgramSchema>
export type RetentionStrategy = z.infer<typeof retentionStrategySchema>
export type TurnoverRecord = z.infer<typeof turnoverRecordSchema>
export type CapacityBuildingAnalytics = z.infer<typeof capacityBuildingAnalyticsSchema>
export type RetentionAnalytics = z.infer<typeof retentionAnalyticsSchema>

