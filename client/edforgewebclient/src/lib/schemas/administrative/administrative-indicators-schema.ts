/**
 * EdForge EMIS - Administrative Indicators Schema
 * 
 * Efficiency metrics, school development plans, teacher qualifications
 * Critical for SABER framework accountability and efficiency measurement
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, percentageSchema, nonNegativeNumberSchema, yearSchema } from "../base"

/**
 * Efficiency Metric Schema
 * Internal and external efficiency indicators
 */
export const efficiencyMetricSchema = z.object({
  schoolId: uuidSchema.optional(),
  academicYearId: uuidSchema.optional(),
  metricType: z.enum([
    "internal_efficiency",
    "external_efficiency",
    "cost_efficiency",
    "technological_efficiency",
  ]),
  value: z.number(),
  unit: z.string().optional(),
  target: z.number().optional(),
  status: z.enum(["optimal", "acceptable", "concerning", "critical"]),
  period: z.string().min(1, "Period is required"),
})

/**
 * School Development Plan Schema
 * Tracks school improvement and development plans
 */
export const schoolDevelopmentPlanSchema = z.object({
  planId: uuidSchema,
  schoolId: uuidSchema,
  academicYearId: uuidSchema,
  planName: z.string().min(1, "Plan name is required").max(255),
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  objectives: z.array(z.object({
    objectiveId: uuidSchema,
    description: z.string().min(1, "Objective description is required"),
    target: z.string().optional(),
    status: z.enum(["not_started", "in_progress", "completed", "cancelled"]),
    completionDate: isoDateSchema.optional(),
  })),
  budget: z.number().min(0).optional(),
  responsibleParty: z.string().optional(),
  status: z.enum(["draft", "active", "completed", "cancelled"]),
})

/**
 * Teacher Qualification Indicator Schema
 * Tracks teacher qualifications and quality indicators
 */
export const teacherQualificationIndicatorSchema = z.object({
  schoolId: uuidSchema.optional(),
  departmentId: uuidSchema.optional(),
  totalTeachers: nonNegativeNumberSchema,
  qualifiedTeachers: nonNegativeNumberSchema, // Teachers with required qualifications
  qualificationRate: percentageSchema,
  averageYearsExperience: z.number().min(0),
  teachersWithAdvancedDegrees: nonNegativeNumberSchema,
  teachersWithCertifications: nonNegativeNumberSchema,
  certificationRate: percentageSchema,
  ageDistribution: z.object({
    under30: nonNegativeNumberSchema,
    "30-40": nonNegativeNumberSchema,
    "40-50": nonNegativeNumberSchema,
    "50-60": nonNegativeNumberSchema,
    over60: nonNegativeNumberSchema,
  }).optional(),
  qualificationTrends: z.array(z.object({
    period: z.string(),
    qualificationRate: percentageSchema,
    averageExperience: z.number().min(0),
  })),
})

/**
 * Administrative Indicator Summary Schema
 * Comprehensive administrative indicators
 */
export const administrativeIndicatorSummarySchema = z.object({
  schoolId: uuidSchema.optional(),
  academicYearId: uuidSchema.optional(),
  efficiencyMetrics: z.array(efficiencyMetricSchema),
  developmentPlans: z.array(schoolDevelopmentPlanSchema),
  teacherQualifications: teacherQualificationIndicatorSchema,
  overallEfficiencyScore: percentageSchema.optional(),
  lastUpdated: isoDateSchema,
})

/**
 * TypeScript types inferred from schemas
 */
export type EfficiencyMetric = z.infer<typeof efficiencyMetricSchema>
export type SchoolDevelopmentPlan = z.infer<typeof schoolDevelopmentPlanSchema>
export type TeacherQualificationIndicator = z.infer<typeof teacherQualificationIndicatorSchema>
export type AdministrativeIndicatorSummary = z.infer<typeof administrativeIndicatorSummarySchema>

