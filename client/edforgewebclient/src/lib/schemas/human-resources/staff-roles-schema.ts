/**
 * EdForge EMIS - Staff Roles Schema
 * 
 * Administrative, management, security, janitorial, transportation staff
 * Comprehensive role tracking and assignment
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, nonNegativeNumberSchema } from "../base"
import { staffRoleTypeSchema } from "./staff-schema"

/**
 * Role Assignment Schema
 * Staff role assignment with details
 */
export const roleAssignmentSchema = z.object({
  assignmentId: uuidSchema,
  staffId: uuidSchema,
  roleType: staffRoleTypeSchema,
  schoolId: uuidSchema,
  departmentId: uuidSchema.optional(),
  startDate: isoDateSchema,
  endDate: isoDateSchema.optional(),
  isPrimary: z.boolean().default(false),
  responsibilities: z.array(z.string()).optional(),
  reportingTo: uuidSchema.optional(), // Staff ID of supervisor
  directReports: z.array(uuidSchema).optional(), // Staff IDs reporting to this person
})

/**
 * Role Distribution Schema
 * Role distribution analytics
 */
export const roleDistributionSchema = z.object({
  roleType: staffRoleTypeSchema,
  count: nonNegativeNumberSchema,
  percentage: z.number().min(0).max(100),
  averageExperience: z.number().min(0).optional(),
  averageSalary: z.number().min(0).optional(),
})

/**
 * Role Analytics Schema
 * Comprehensive role analytics
 */
export const roleAnalyticsSchema = z.object({
  schoolId: uuidSchema.optional(),
  academicYearId: uuidSchema.optional(),
  totalStaff: nonNegativeNumberSchema,
  roleDistribution: z.array(roleDistributionSchema),
  departmentBreakdown: z.record(z.string(), z.array(roleDistributionSchema)),
  trends: z.array(z.object({
    period: z.string(),
    roleType: staffRoleTypeSchema,
    count: nonNegativeNumberSchema,
  })),
  vacancies: z.array(z.object({
    roleType: staffRoleTypeSchema,
    departmentId: uuidSchema.optional(),
    count: nonNegativeNumberSchema,
    priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  })).optional(),
})

/**
 * TypeScript types inferred from schemas
 */
export type RoleAssignment = z.infer<typeof roleAssignmentSchema>
export type RoleDistribution = z.infer<typeof roleDistributionSchema>
export type RoleAnalytics = z.infer<typeof roleAnalyticsSchema>

