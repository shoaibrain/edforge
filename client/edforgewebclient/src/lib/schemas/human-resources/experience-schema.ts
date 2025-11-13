/**
 * EdForge EMIS - Experience Schema
 * 
 * Years of experience tracking for teachers and staff
 * Supports SABER framework teacher qualification indicators
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, nonNegativeNumberSchema } from "../base"

/**
 * Experience Record Schema
 * Individual experience record
 */
export const experienceRecordSchema = z.object({
  recordId: uuidSchema,
  staffId: uuidSchema,
  organization: z.string().min(1, "Organization is required").max(255),
  role: z.string().max(255),
  startDate: isoDateSchema,
  endDate: isoDateSchema.optional(),
  isCurrent: z.boolean().default(false),
  yearsOfExperience: z.number().min(0).max(50),
  description: z.string().max(1000).optional(),
})

/**
 * Teaching Experience Schema
 * Specific teaching experience tracking
 */
export const teachingExperienceSchema = z.object({
  staffId: uuidSchema,
  totalYearsTeaching: z.number().min(0).max(50),
  yearsAtCurrentSchool: z.number().min(0).max(50),
  yearsInCurrentRole: z.number().min(0).max(50),
  gradeLevelsTaught: z.array(z.string()),
  subjectsTaught: z.array(z.string()),
  experienceBySubject: z.record(z.string(), z.number().min(0).max(50)).optional(),
  experienceByGrade: z.record(z.string(), z.number().min(0).max(50)).optional(),
})

/**
 * Experience Summary Schema
 * Comprehensive experience summary
 */
export const experienceSummarySchema = z.object({
  schoolId: uuidSchema.optional(),
  academicYearId: uuidSchema.optional(),
  averageYearsExperience: z.number().min(0),
  medianYearsExperience: z.number().min(0).optional(),
  experienceDistribution: z.array(z.object({
    range: z.string(), // e.g., "0-5 years", "5-10 years"
    count: nonNegativeNumberSchema,
    percentage: z.number().min(0).max(100),
  })),
  newStaff: z.object({
    count: nonNegativeNumberSchema,
    percentage: z.number().min(0).max(100),
    averageExperience: z.number().min(0),
  }), // Staff with < 2 years
  experiencedStaff: z.object({
    count: nonNegativeNumberSchema,
    percentage: z.number().min(0).max(100),
    averageExperience: z.number().min(0),
  }), // Staff with 5+ years
  retentionByExperience: z.array(z.object({
    experienceRange: z.string(),
    retentionRate: z.number().min(0).max(100),
  })).optional(),
})

/**
 * TypeScript types inferred from schemas
 */
export type ExperienceRecord = z.infer<typeof experienceRecordSchema>
export type TeachingExperience = z.infer<typeof teachingExperienceSchema>
export type ExperienceSummary = z.infer<typeof experienceSummarySchema>

