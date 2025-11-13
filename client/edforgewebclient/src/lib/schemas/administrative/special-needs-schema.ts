/**
 * EdForge EMIS - Special Needs Population Data Schema
 * 
 * Tracks special needs students and required support services
 * Critical for ensuring equitable access to education
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, percentageSchema, nonNegativeNumberSchema } from "../base"

/**
 * Special Needs Classification Schema
 * Classification and support requirements
 */
export const specialNeedsClassificationSchema = z.object({
  category: z.enum([
    "learning_disability",
    "intellectual_disability",
    "autism_spectrum",
    "emotional_disturbance",
    "speech_language_impairment",
    "hearing_impairment",
    "visual_impairment",
    "orthopedic_impairment",
    "other_health_impairment",
    "multiple_disabilities",
    "gifted_talented",
    "other",
  ]),
  severity: z.enum(["mild", "moderate", "severe", "profound"]).optional(),
  requiresIEP: z.boolean().default(false), // Individualized Education Program
  requires504: z.boolean().default(false), // Section 504 Plan
  supportServices: z.array(z.enum([
    "speech_therapy",
    "occupational_therapy",
    "physical_therapy",
    "counseling",
    "assistive_technology",
    "paraprofessional_support",
    "modified_curriculum",
    "extended_time",
    "other",
  ])),
})

/**
 * Special Needs Student Record Schema
 * Individual student special needs record
 */
export const specialNeedsStudentRecordSchema = z.object({
  studentId: uuidSchema,
  schoolId: uuidSchema,
  academicYearId: uuidSchema,
  classifications: z.array(specialNeedsClassificationSchema),
  assessmentDate: isoDateSchema.optional(),
  nextReviewDate: isoDateSchema.optional(),
  accommodations: z.array(z.string()),
  modifications: z.array(z.string()),
  supportStaff: z.array(z.object({
    staffId: uuidSchema,
    role: z.string(),
    hoursPerWeek: z.number().min(0).max(40).optional(),
  })),
  progressNotes: z.array(z.object({
    date: isoDateSchema,
    note: z.string().max(2000),
    recordedBy: uuidSchema,
  })).optional(),
})

/**
 * Special Needs Population Summary Schema
 * School or system-level special needs summary
 */
export const specialNeedsPopulationSummarySchema = z.object({
  schoolId: uuidSchema.optional(),
  academicYearId: uuidSchema.optional(),
  totalSpecialNeedsStudents: nonNegativeNumberSchema,
  totalStudents: nonNegativeNumberSchema,
  specialNeedsPercentage: percentageSchema,
  categoryBreakdown: z.record(z.string(), z.object({
    count: nonNegativeNumberSchema,
    percentage: percentageSchema,
  })),
  supportServicesBreakdown: z.record(z.string(), z.object({
    count: nonNegativeNumberSchema,
    percentage: percentageSchema,
  })),
  iepStudents: nonNegativeNumberSchema,
  section504Students: nonNegativeNumberSchema,
  trends: z.array(z.object({
    period: z.string(),
    totalSpecialNeedsStudents: nonNegativeNumberSchema,
    specialNeedsPercentage: percentageSchema,
  })),
})

/**
 * TypeScript types inferred from schemas
 */
export type SpecialNeedsClassification = z.infer<typeof specialNeedsClassificationSchema>
export type SpecialNeedsStudentRecord = z.infer<typeof specialNeedsStudentRecordSchema>
export type SpecialNeedsPopulationSummary = z.infer<typeof specialNeedsPopulationSummarySchema>

