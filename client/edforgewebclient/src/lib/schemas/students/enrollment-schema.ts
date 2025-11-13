/**
 * EdForge EMIS - Enrollment Dashboard Schema
 * 
 * Schema for enrollment dashboard data
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, percentageSchema, nonNegativeNumberSchema } from "../base"
import { enrollmentAnalyticsSchema } from "../administrative/enrollment-schema"

/**
 * Enrollment Stats Schema
 */
export const enrollmentStatsSchema = z.object({
  totalEnrolled: nonNegativeNumberSchema,
  monthlyIncrease: z.number(), // Can be negative
  completionRate: percentageSchema,
  pendingReviews: nonNegativeNumberSchema,
})

/**
 * Recent Activity Schema
 */
export const recentActivitySchema = z.object({
  id: z.number().int().min(0),
  type: z.enum(["enrollment", "review", "completed"]),
  title: z.string().min(1, "Title is required").max(255),
  description: z.string().max(1000).optional(),
  time: z.string(),
})

/**
 * Enrollment Alert Schema
 */
export const enrollmentAlertSchema = z.object({
  id: z.number().int().min(0),
  type: z.enum(["warning", "info"]),
  message: z.string().min(1, "Message is required").max(500),
})

/**
 * Enrollment Trend Data Schema
 */
export const enrollmentTrendDataSchema = z.object({
  date: z.string(),
  enrollments: nonNegativeNumberSchema,
  completed: nonNegativeNumberSchema,
  pending: nonNegativeNumberSchema,
})

/**
 * Grade Distribution Data Schema
 */
export const gradeDistributionDataSchema = z.object({
  grade: z.string(),
  count: nonNegativeNumberSchema,
  percentage: percentageSchema,
})

/**
 * Completion Funnel Data Schema
 */
export const completionFunnelDataSchema = z.object({
  step: z.string(),
  count: nonNegativeNumberSchema,
  percentage: percentageSchema,
})

/**
 * Status Breakdown Data Schema
 */
export const statusBreakdownDataSchema = z.object({
  status: z.string(),
  count: nonNegativeNumberSchema,
  percentage: percentageSchema,
  color: z.string(),
})

/**
 * Enrollment Analytics Schema
 */
export const enrollmentDashboardAnalyticsSchema = z.object({
  trends: z.array(enrollmentTrendDataSchema),
  gradeDistribution: z.array(gradeDistributionDataSchema),
  completionFunnel: z.array(completionFunnelDataSchema),
  statusBreakdown: z.array(statusBreakdownDataSchema),
  averageCompletionTime: z.number().min(0), // in hours
  peakEnrollmentPeriod: z.string(),
  enrollmentSources: z.array(z.object({
    source: z.string(),
    count: nonNegativeNumberSchema,
    percentage: percentageSchema,
  })),
})

/**
 * Enrollment Dashboard Data Schema
 */
export const enrollmentDashboardDataSchema = z.object({
  stats: enrollmentStatsSchema,
  recentActivities: z.array(recentActivitySchema),
  alerts: z.array(enrollmentAlertSchema).optional(),
  analytics: enrollmentDashboardAnalyticsSchema,
})

/**
 * TypeScript types inferred from schemas
 */
export type EnrollmentStats = z.infer<typeof enrollmentStatsSchema>
export type RecentActivity = z.infer<typeof recentActivitySchema>
export type EnrollmentAlert = z.infer<typeof enrollmentAlertSchema>
export type EnrollmentTrendData = z.infer<typeof enrollmentTrendDataSchema>
export type GradeDistributionData = z.infer<typeof gradeDistributionDataSchema>
export type CompletionFunnelData = z.infer<typeof completionFunnelDataSchema>
export type StatusBreakdownData = z.infer<typeof statusBreakdownDataSchema>
export type EnrollmentDashboardAnalytics = z.infer<typeof enrollmentDashboardAnalyticsSchema>
export type EnrollmentDashboardData = z.infer<typeof enrollmentDashboardDataSchema>

