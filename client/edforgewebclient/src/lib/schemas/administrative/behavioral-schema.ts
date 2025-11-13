/**
 * EdForge EMIS - Behavioral Data Schema
 * 
 * Absenteeism and late arrivals for both teachers and students
 * Critical for identifying at-risk populations and intervention needs
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, percentageSchema, nonNegativeNumberSchema } from "../base"

/**
 * Absenteeism Record Schema
 * Individual absence record
 */
export const absenteeismRecordSchema = z.object({
  recordId: uuidSchema,
  studentId: uuidSchema.optional(),
  staffId: uuidSchema.optional(),
  date: isoDateSchema,
  status: z.enum(["present", "absent", "excused", "unexcused", "late", "early_departure"]),
  reason: z.string().max(500).optional(),
  isChronic: z.boolean().default(false),
  riskLevel: z.enum(["low", "medium", "high"]).optional(),
})

/**
 * Late Arrival Record Schema
 * Tracks late arrivals
 */
export const lateArrivalRecordSchema = z.object({
  recordId: uuidSchema,
  studentId: uuidSchema.optional(),
  staffId: uuidSchema.optional(),
  date: isoDateSchema,
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/, "Time must be in HH:MM format"),
  actualArrivalTime: z.string().regex(/^\d{2}:\d{2}$/, "Time must be in HH:MM format"),
  minutesLate: nonNegativeNumberSchema,
  reason: z.string().max(500).optional(),
})

/**
 * Behavioral Analytics Schema (Student)
 * Comprehensive student behavioral analytics
 */
export const studentBehavioralAnalyticsSchema = z.object({
  studentId: uuidSchema,
  academicYearId: uuidSchema,
  schoolId: uuidSchema,
  totalDays: nonNegativeNumberSchema,
  presentDays: nonNegativeNumberSchema,
  absentDays: nonNegativeNumberSchema,
  excusedAbsences: nonNegativeNumberSchema,
  unexcusedAbsences: nonNegativeNumberSchema,
  lateArrivals: nonNegativeNumberSchema,
  attendanceRate: percentageSchema,
  punctualityRate: percentageSchema,
  attendanceTrend: z.enum(["improving", "declining", "stable"]),
  chronicAbsenteeism: z.boolean(),
  riskLevel: z.enum(["low", "medium", "high"]),
  frequentAbsenceDays: z.array(z.string()), // Days of week
  frequentAbsenceReasons: z.array(z.string()),
  interventionNeeded: z.boolean(),
})

/**
 * Behavioral Analytics Schema (Staff/Teacher)
 * Comprehensive staff behavioral analytics
 */
export const staffBehavioralAnalyticsSchema = z.object({
  staffId: uuidSchema,
  academicYearId: uuidSchema,
  schoolId: uuidSchema,
  totalDays: nonNegativeNumberSchema,
  presentDays: nonNegativeNumberSchema,
  absentDays: nonNegativeNumberSchema,
  excusedAbsences: nonNegativeNumberSchema,
  unexcusedAbsences: nonNegativeNumberSchema,
  lateArrivals: nonNegativeNumberSchema,
  attendanceRate: percentageSchema,
  punctualityRate: percentageSchema,
  attendanceTrend: z.enum(["improving", "declining", "stable"]),
  impactOnStudents: z.object({
    averageStudentAttendance: percentageSchema,
    correlation: z.number().min(-1).max(1), // Correlation coefficient
  }).optional(),
  riskLevel: z.enum(["low", "medium", "high"]),
  interventionNeeded: z.boolean(),
})

/**
 * Behavioral Summary Schema
 * School or system-level behavioral summary
 */
export const behavioralSummarySchema = z.object({
  schoolId: uuidSchema.optional(),
  academicYearId: uuidSchema.optional(),
  period: z.string().min(1, "Period is required"),
  studentAttendanceRate: percentageSchema,
  staffAttendanceRate: percentageSchema,
  studentPunctualityRate: percentageSchema,
  staffPunctualityRate: percentageSchema,
  chronicAbsenteeismRate: percentageSchema, // Percentage of students with chronic absenteeism
  atRiskStudents: nonNegativeNumberSchema,
  atRiskStaff: nonNegativeNumberSchema,
  trends: z.array(z.object({
    date: isoDateSchema,
    studentAttendanceRate: percentageSchema,
    staffAttendanceRate: percentageSchema,
  })),
})

/**
 * TypeScript types inferred from schemas
 */
export type AbsenteeismRecord = z.infer<typeof absenteeismRecordSchema>
export type LateArrivalRecord = z.infer<typeof lateArrivalRecordSchema>
export type StudentBehavioralAnalytics = z.infer<typeof studentBehavioralAnalyticsSchema>
export type StaffBehavioralAnalytics = z.infer<typeof staffBehavioralAnalyticsSchema>
export type BehavioralSummary = z.infer<typeof behavioralSummarySchema>

