/**
 * EdForge EMIS - Ratio Schema
 * 
 * Student-to-teacher and school-to-student ratios
 * Critical SABER framework metric for resource allocation
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, nonNegativeNumberSchema } from "../base"

/**
 * Student-to-Teacher Ratio Schema
 * Tracks student-to-teacher ratios at various levels
 */
export const studentToTeacherRatioSchema = z.object({
  schoolId: uuidSchema.optional(),
  departmentId: uuidSchema.optional(),
  gradeLevel: z.string().optional(),
  ratio: z
    .number()
    .positive("Ratio must be positive")
    .max(100, "Ratio exceeds reasonable maximum"),
  studentCount: nonNegativeNumberSchema,
  teacherCount: nonNegativeNumberSchema,
  date: isoDateSchema,
  targetRatio: z
    .number()
    .positive("Target ratio must be positive")
    .optional(),
  status: z.enum(["optimal", "acceptable", "concerning", "critical"]).optional(),
})

/**
 * School-to-Student Ratio Schema
 * Tracks school capacity and enrollment ratios
 */
export const schoolToStudentRatioSchema = z.object({
  schoolId: uuidSchema,
  totalSchools: nonNegativeNumberSchema,
  totalStudents: nonNegativeNumberSchema,
  ratio: z
    .number()
    .positive("Ratio must be positive"),
  averageSchoolSize: nonNegativeNumberSchema,
  date: isoDateSchema,
})

/**
 * Ratio Trend Schema
 * Historical ratio data for trend analysis
 */
export const ratioTrendSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "Month must be in YYYY-MM format"),
  ratio: z.number().positive("Ratio must be positive"),
  studentCount: nonNegativeNumberSchema,
  teacherCount: nonNegativeNumberSchema,
  schoolCount: nonNegativeNumberSchema.optional(),
})

/**
 * Ratio Analytics Schema
 * Comprehensive ratio analytics
 */
export const ratioAnalyticsSchema = z.object({
  currentRatio: z.number().positive("Ratio must be positive"),
  averageRatio: z.number().positive("Average ratio must be positive"),
  targetRatio: z.number().positive("Target ratio must be positive").optional(),
  trends: z.array(ratioTrendSchema),
  distribution: z.array(z.object({
    range: z.string(), // e.g., "15-20:1", "20-25:1"
    count: nonNegativeNumberSchema,
    percentage: z.number().min(0).max(100),
  })),
  alerts: z.array(z.object({
    level: z.enum(["warning", "critical"]),
    message: z.string(),
    schoolId: uuidSchema.optional(),
    departmentId: uuidSchema.optional(),
  })).optional(),
})

/**
 * TypeScript types inferred from schemas
 */
export type StudentToTeacherRatio = z.infer<typeof studentToTeacherRatioSchema>
export type SchoolToStudentRatio = z.infer<typeof schoolToStudentRatioSchema>
export type RatioTrend = z.infer<typeof ratioTrendSchema>
export type RatioAnalytics = z.infer<typeof ratioAnalyticsSchema>

