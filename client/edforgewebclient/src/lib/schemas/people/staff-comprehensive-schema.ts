/**
 * EdForge EMIS - Comprehensive Staff Schema
 * 
 * Comprehensive staff schema that composes all relevant sub-schemas
 * Aligns with SABER framework and EMIS requirements
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema } from "../base"
import { staffSchema, Staff } from "../human-resources/staff-schema"
import { staffSalaryRecordSchema } from "../human-resources/salary-schema"
import { roleAssignmentSchema } from "../human-resources/staff-roles-schema"
import { professionalDevelopmentRecordSchema, certificationSchema } from "../human-resources/professional-development-schema"
import { teachingExperienceSchema } from "../human-resources/experience-schema"
import { staffBehavioralAnalyticsSchema } from "../administrative/behavioral-schema"
import { conditionalCashTransferSchema } from "../human-resources/conditional-cash-transfer-schema"

/**
 * Comprehensive Staff Profile Schema
 * Complete staff profile with all related data
 */
export const comprehensiveStaffProfileSchema = staffSchema.extend({
  // Salary information
  salary: staffSalaryRecordSchema.optional(),
  
  // Role assignments
  roleAssignments: z.array(roleAssignmentSchema).optional(),
  
  // Professional development
  professionalDevelopment: z.array(professionalDevelopmentRecordSchema).optional(),
  certifications: z.array(certificationSchema).optional(),
  
  // Experience
  teachingExperience: teachingExperienceSchema.optional(),
  
  // Behavioral analytics
  behavioralAnalytics: staffBehavioralAnalyticsSchema.optional(),
  
  // Conditional cash transfers
  conditionalCashTransfers: z.array(conditionalCashTransferSchema).optional(),
  
  // Performance metrics (TSDL)
  performanceMetrics: z.object({
    teachingEffectiveness: z.number().min(0).max(100).optional(),
    averageStudentGrade: z.number().min(0).max(100).optional(),
    improvementRate: z.number().optional(),
    passRate: z.number().min(0).max(100).optional(),
    engagementScore: z.number().min(0).max(100).optional(),
  }).optional(),
  
  // Assignments
  assignments: z.array(z.object({
    classroomId: uuidSchema,
    subjectId: uuidSchema,
    gradeLevel: z.string(),
    studentCount: z.number().int().min(0),
  })).optional(),
  
  // Retention data
  retentionData: z.object({
    yearsOfService: z.number().min(0),
    retentionRisk: z.enum(["low", "medium", "high"]).optional(),
    lastPromotionDate: isoDateSchema.optional(),
  }).optional(),
})

/**
 * TypeScript type inferred from schema
 */
export type ComprehensiveStaffProfile = z.infer<typeof comprehensiveStaffProfileSchema>

