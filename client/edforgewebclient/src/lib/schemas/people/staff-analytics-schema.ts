/**
 * EdForge EMIS - Staff Analytics Schema
 * 
 * Comprehensive staff analytics for dashboard and reporting
 */

import { z } from "zod"
import { uuidSchema, percentageSchema, nonNegativeNumberSchema } from "../base"
import { ratioTrendSchema } from "../administrative/ratio-schema"

/**
 * Role Outcome Metrics Schema
 * Student outcomes correlated with staff roles
 * Business-critical for understanding role impact on educational outcomes
 */
export const roleOutcomeMetricsSchema = z.object({
  averageStudentGrade: percentageSchema.optional(), // Average grade across all students taught by this role
  passRate: percentageSchema.optional(), // Percentage of students passing
  improvementRate: z.number().optional(), // Average improvement rate of students (can be negative)
  studentEngagementScore: percentageSchema.optional(), // Average engagement score
  interventionSuccessRate: percentageSchema.optional(), // Success rate of interventions
  totalStudentsImpacted: nonNegativeNumberSchema.optional(), // Total number of students impacted by this role
})

/**
 * Comprehensive Ratio Trend Schema
 * Enhanced ratio trends with correlation metrics and status indicators
 * Aligns with SABER framework for resource allocation decision-making
 */
export const comprehensiveRatioTrendSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "Month must be in YYYY-MM format"),
  studentToTeacherRatio: z.number().positive(),
  teacherToStudentRatio: z.number().positive(), // Inverse ratio (1 / studentToTeacherRatio)
  studentCount: nonNegativeNumberSchema,
  teacherCount: nonNegativeNumberSchema,
  averageStudentGrade: percentageSchema.optional(), // Correlation metric
  passRate: percentageSchema.optional(), // Correlation metric
  status: z.enum(["optimal", "acceptable", "concerning", "critical"]).optional(),
  trend: z.enum(["improving", "declining", "stable"]).optional(),
})

/**
 * People Dashboard Stats Schema
 * Stats for people dashboard
 */
export const peopleStatsSchema = z.object({
  totalStaff: nonNegativeNumberSchema,
  activeTeachers: nonNegativeNumberSchema,
  studentToTeacherRatio: z.number().positive(),
  averageEffectiveness: percentageSchema,
  recentHires: nonNegativeNumberSchema,
  retentionRate: percentageSchema,
  professionalDevelopmentCompletion: percentageSchema,
})

/**
 * Staff Profile Summary Schema
 * Summary staff profile for table/list views
 */
export const staffProfileSummarySchema = z.object({
  staffId: uuidSchema,
  employeeNumber: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  middleName: z.string().optional(),
  email: z.string().email(),
  phone: z.string(),
  department: z.string(),
  primaryRole: z.string(),
  roles: z.array(z.string()),
  status: z.enum(["active", "on_leave", "terminated", "retired"]),
  hireDate: z.string(),
  classesAssigned: nonNegativeNumberSchema,
  studentCount: nonNegativeNumberSchema,
  effectivenessScore: percentageSchema,
  yearsOfService: z.number().min(0),
  attendanceRate: percentageSchema,
})

/**
 * People Dashboard Data Schema
 * Complete people dashboard data structure
 */
export const peopleDashboardDataSchema = z.object({
  stats: peopleStatsSchema,
  staff: z.array(staffProfileSummarySchema),
  departmentDistribution: z.array(z.object({
    department: z.string(),
    count: nonNegativeNumberSchema,
    percentage: percentageSchema,
  })),
  roleDistribution: z.array(z.object({
    role: z.string(),
    count: nonNegativeNumberSchema,
    percentage: percentageSchema,
  })),
  roleDistributionWithOutcomes: z.array(z.object({
    role: z.string(),
    count: nonNegativeNumberSchema,
    percentage: percentageSchema,
    outcomeMetrics: roleOutcomeMetricsSchema.optional(),
  })).optional(),
  ratioTrends: z.array(ratioTrendSchema),
  comprehensiveRatioTrends: z.array(comprehensiveRatioTrendSchema).optional(),
  effectivenessDistribution: z.array(z.object({
    range: z.string(),
    count: nonNegativeNumberSchema,
    percentage: percentageSchema,
  })),
  roleEffectivenessCorrelation: z.array(z.object({
    role: z.string(),
    averageEffectiveness: percentageSchema,
    averageStudentOutcome: percentageSchema,
    correlationStrength: z.enum(["strong", "moderate", "weak", "none"]),
  })).optional(),
})

/**
 * TypeScript types inferred from schemas
 */
export type RoleOutcomeMetrics = z.infer<typeof roleOutcomeMetricsSchema>
export type ComprehensiveRatioTrend = z.infer<typeof comprehensiveRatioTrendSchema>
export type PeopleStats = z.infer<typeof peopleStatsSchema>
export type StaffProfileSummary = z.infer<typeof staffProfileSummarySchema>
export type PeopleDashboardData = z.infer<typeof peopleDashboardDataSchema>

