/**
 * EdForge EMIS - Professional Development Schema
 * 
 * Training, certifications, courses, and allowances
 * Addresses staff capacity building and turnover challenges
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, currencySchema, nonNegativeNumberSchema, percentageSchema } from "../base"

/**
 * Professional Development Type Schema
 */
export const professionalDevelopmentTypeSchema = z.enum([
  "training",
  "workshop",
  "conference",
  "certification",
  "course",
  "seminar",
  "webinar",
  "mentoring",
  "coaching",
  "other",
])

/**
 * Professional Development Record Schema
 * Individual professional development activity
 */
export const professionalDevelopmentRecordSchema = z.object({
  recordId: uuidSchema,
  staffId: uuidSchema,
  title: z.string().min(1, "Title is required").max(255),
  type: professionalDevelopmentTypeSchema,
  provider: z.string().max(255).optional(),
  startDate: isoDateSchema,
  endDate: isoDateSchema.optional(),
  hours: z.number().min(0).max(1000),
  cost: currencySchema.optional(),
  fundingSource: z.string().max(255).optional(),
  status: z.enum(["planned", "in_progress", "completed", "cancelled"]),
  completionDate: isoDateSchema.optional(),
  certificateIssued: z.boolean().default(false),
  certificateNumber: z.string().max(100).optional(),
  skillsGained: z.array(z.string()).optional(),
  impact: z.enum(["high", "medium", "low", "unknown"]).optional(),
  notes: z.string().max(2000).optional(),
})

/**
 * Certification Schema
 * Professional certification record
 */
export const certificationSchema = z.object({
  certificationId: uuidSchema,
  staffId: uuidSchema,
  certificationName: z.string().min(1, "Certification name is required").max(255),
  issuingOrganization: z.string().max(255),
  issueDate: isoDateSchema,
  expiryDate: isoDateSchema.optional(),
  certificateNumber: z.string().max(100).optional(),
  status: z.enum(["active", "expired", "pending_renewal", "revoked"]),
  renewalRequired: z.boolean().default(false),
  renewalDate: isoDateSchema.optional(),
})

/**
 * Professional Development Allowance Schema
 * Allowances for professional development
 */
export const professionalDevelopmentAllowanceSchema = z.object({
  allowanceId: uuidSchema,
  staffId: uuidSchema,
  academicYearId: uuidSchema,
  totalAllocated: currencySchema,
  totalSpent: currencySchema.default(0),
  remaining: currencySchema,
  activities: z.array(uuidSchema).optional(), // References to professional development records
})

/**
 * Professional Development Analytics Schema
 * Comprehensive professional development analytics
 */
export const professionalDevelopmentAnalyticsSchema = z.object({
  schoolId: uuidSchema.optional(),
  academicYearId: uuidSchema.optional(),
  totalActivities: nonNegativeNumberSchema,
  totalHours: z.number().min(0),
  totalCost: currencySchema,
  averageHoursPerStaff: z.number().min(0),
  completionRate: percentageSchema,
  typeBreakdown: z.record(z.string(), z.object({
    count: nonNegativeNumberSchema,
    totalHours: z.number().min(0),
    totalCost: currencySchema,
  })),
  staffParticipation: z.array(z.object({
    staffId: uuidSchema,
    totalHours: z.number().min(0),
    activitiesCompleted: nonNegativeNumberSchema,
    certificationsEarned: nonNegativeNumberSchema,
  })),
  trends: z.array(z.object({
    period: z.string(),
    totalActivities: nonNegativeNumberSchema,
    totalHours: z.number().min(0),
    totalCost: currencySchema,
    participationRate: percentageSchema,
  })),
})

/**
 * TypeScript types inferred from schemas
 */
export type ProfessionalDevelopmentType = z.infer<typeof professionalDevelopmentTypeSchema>
export type ProfessionalDevelopmentRecord = z.infer<typeof professionalDevelopmentRecordSchema>
export type Certification = z.infer<typeof certificationSchema>
export type ProfessionalDevelopmentAllowance = z.infer<typeof professionalDevelopmentAllowanceSchema>
export type ProfessionalDevelopmentAnalytics = z.infer<typeof professionalDevelopmentAnalyticsSchema>

