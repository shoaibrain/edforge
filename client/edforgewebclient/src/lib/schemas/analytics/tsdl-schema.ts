/**
 * EdForge EMIS - TSDL (Teacher-Student-Data-Link) Schema
 * 
 * Teacher-Student-Data-Link analytics
 * Critical for SABER framework and EMIS effectiveness
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, percentageSchema, nonNegativeNumberSchema } from "../base"

/**
 * Student Performance Trend Schema
 * Individual student performance trend linked to teacher
 */
export const tsdlStudentPerformanceTrendSchema = z.object({
  studentId: uuidSchema,
  studentName: z.string(),
  period: z.string().min(1, "Period is required"),
  averageGrade: z.number().min(0).max(100),
  gradeTrend: z.enum(["improving", "declining", "stable"]),
  improvementRate: z.number().optional(),
})

/**
 * TSDL Analytics Schema
 * Comprehensive TSDL analytics for a teacher
 */
export const tsdlAnalyticsSchema = z.object({
  staffId: uuidSchema,
  academicYearId: uuidSchema,
  schoolId: uuidSchema,
  totalStudents: nonNegativeNumberSchema,
  averageStudentGrade: z.number().min(0).max(100),
  improvementRate: z.number().optional(),
  passRate: percentageSchema,
  studentPerformanceTrends: z.array(tsdlStudentPerformanceTrendSchema),
  gradeDistribution: z.array(z.object({
    range: z.string(), // e.g., "90-100", "80-89"
    count: nonNegativeNumberSchema,
    percentage: percentageSchema,
  })),
  strugglingStudents: z.array(z.object({
    studentId: uuidSchema,
    studentName: z.string(),
    currentGrade: z.number().min(0).max(100),
    riskLevel: z.enum(["low", "medium", "high"]),
  })),
  excellingStudents: z.array(z.object({
    studentId: uuidSchema,
    studentName: z.string(),
    currentGrade: z.number().min(0).max(100),
  })),
  lastUpdated: isoDateSchema,
})

/**
 * TypeScript types inferred from schemas
 */
export type TSDLStudentPerformanceTrend = z.infer<typeof tsdlStudentPerformanceTrendSchema>
export type TSDLAnalytics = z.infer<typeof tsdlAnalyticsSchema>

