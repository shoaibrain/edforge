/**
 * EdForge EMIS - Onboarding Schema
 * 
 * Comprehensive onboarding data structures aligned with SABER framework
 * Supports staff onboarding tracking, analytics, and decision-making
 */

import { z } from "zod"
import { uuidSchema, percentageSchema, nonNegativeNumberSchema } from "../base"

/**
 * Onboarding Stats Schema
 * Key performance indicators for onboarding process
 */
export const onboardingStatsSchema = z.object({
  totalOnboarded: nonNegativeNumberSchema,
  monthlyIncrease: z.number(), // Can be negative
  completionRate: percentageSchema,
  averageTime: z.number().min(0), // in days
  inProgress: nonNegativeNumberSchema,
})

/**
 * Onboarding Activity Schema
 * Individual onboarding activity tracking
 */
export const onboardingActivitySchema = z.object({
  id: z.number().int().min(0),
  type: z.enum(["completed", "in_progress", "started"]),
  title: z.string().min(1, "Title is required").max(255),
  description: z.string().max(500),
  time: z.string(),
})

/**
 * Onboarding Trend Schema
 * Monthly trends for onboarding metrics
 */
export const onboardingTrendSchema = z.object({
  month: z.string(),
  onboarded: nonNegativeNumberSchema,
  completed: nonNegativeNumberSchema,
})

/**
 * Department Role Breakdown Schema
 * Shows roles within each department - business-critical for resource allocation
 * Aligns with SABER framework: well-selected and assigned staff
 */
export const departmentRoleBreakdownItemSchema = z.object({
  role: z.string(),
  count: nonNegativeNumberSchema,
  percentage: percentageSchema, // Percentage within the department
})

export const departmentRoleBreakdownSchema = z.object({
  department: z.string(),
  totalCount: nonNegativeNumberSchema,
  roles: z.array(departmentRoleBreakdownItemSchema),
})

/**
 * Department Distribution Schema
 * Onboarding distribution across departments (kept for backward compatibility if needed)
 */
export const onboardingDepartmentDistributionSchema = z.object({
  department: z.string(),
  count: nonNegativeNumberSchema,
  percentage: percentageSchema,
})

/**
 * Role Distribution Schema
 * Onboarding distribution across roles (kept for backward compatibility if needed)
 */
export const onboardingRoleDistributionSchema = z.object({
  role: z.string(),
  count: nonNegativeNumberSchema,
  percentage: percentageSchema,
})

/**
 * Status Breakdown Schema
 * Onboarding status distribution
 */
export const onboardingStatusBreakdownSchema = z.object({
  status: z.string(),
  count: nonNegativeNumberSchema,
  percentage: percentageSchema,
})

/**
 * Onboarding Dashboard Data Schema
 * Complete onboarding dashboard data structure
 */
export const onboardingDashboardDataSchema = z.object({
  stats: onboardingStatsSchema,
  departmentRoleBreakdown: z.array(departmentRoleBreakdownSchema), // Business-critical: roles within departments
  departmentDistribution: z.array(onboardingDepartmentDistributionSchema).optional(), // Kept for backward compatibility
  roleDistribution: z.array(onboardingRoleDistributionSchema).optional(), // Kept for backward compatibility
  statusBreakdown: z.array(onboardingStatusBreakdownSchema).optional(), // Optional - removed from UI
  trends: z.array(onboardingTrendSchema).optional(), // Optional - removed from UI
  recentActivities: z.array(onboardingActivitySchema),
})

/**
 * TypeScript types inferred from schemas
 */
export type OnboardingStats = z.infer<typeof onboardingStatsSchema>
export type OnboardingActivity = z.infer<typeof onboardingActivitySchema>
export type OnboardingTrend = z.infer<typeof onboardingTrendSchema>
export type DepartmentRoleBreakdownItem = z.infer<typeof departmentRoleBreakdownItemSchema>
export type DepartmentRoleBreakdown = z.infer<typeof departmentRoleBreakdownSchema>
export type OnboardingDepartmentDistribution = z.infer<typeof onboardingDepartmentDistributionSchema>
export type OnboardingRoleDistribution = z.infer<typeof onboardingRoleDistributionSchema>
export type OnboardingStatusBreakdown = z.infer<typeof onboardingStatusBreakdownSchema>
export type OnboardingDashboardData = z.infer<typeof onboardingDashboardDataSchema>

