/**
 * Attendance Schemas - Academics Service
 * 
 * Zod schemas for attendance management DTOs.
 */

import { z } from 'zod';
import { 
  isoDateSchema,
  dateSchema,
  timeSchema,
  createPaginatedResponseSchema,
} from '../common';

// ============================================
// Enums
// ============================================

export const attendanceStatusSchema = z.enum([
  'present',
  'absent',
  'tardy',
  'excused',
  'late',
  'early_departure',
  'half_day',
  'remote',
]);
export type AttendanceStatus = z.infer<typeof attendanceStatusSchema>;

export const attendanceTypeSchema = z.enum([
  'daily',
  'period',
  'event',
]);
export type AttendanceType = z.infer<typeof attendanceTypeSchema>;

export const excuseTypeSchema = z.enum([
  'medical',
  'family_emergency',
  'religious',
  'school_activity',
  'weather',
  'transportation',
  'other',
]);
export type ExcuseType = z.infer<typeof excuseTypeSchema>;

// ============================================
// Create Attendance Schema
// ============================================

export const createAttendanceSchema = z.object({
  // Required Fields
  studentId: z.string().uuid(),
  date: dateSchema,
  status: attendanceStatusSchema,
  
  // Time Tracking
  checkInTime: timeSchema.optional(),
  checkOutTime: timeSchema.optional(),
  minutesLate: z.number().int().min(0).max(480).optional(),
  minutesEarly: z.number().int().min(0).max(480).optional(),
  
  // Period/Class Info
  classroomId: z.string().uuid().optional(),
  periodId: z.string().uuid().optional(),
  periodNumber: z.number().int().positive().max(20).optional(),
  
  // Type
  attendanceType: attendanceTypeSchema.default('daily'),
  
  // Excuses
  excuseType: excuseTypeSchema.optional(),
  excuseReason: z.string().max(500).optional(),
  excuseDocumentUrl: z.string().url().optional(),
  
  // Communication
  notes: z.string().max(500).optional(),
  parentNotified: z.boolean().default(false),
  parentNotifiedAt: isoDateSchema.optional(),
  
  // Location
  locationVerified: z.boolean().default(false),
  
  // School Info
  schoolId: z.string().uuid(),
  academicYearId: z.string().uuid().optional(),
});

export type CreateAttendanceDto = z.infer<typeof createAttendanceSchema>;

// ============================================
// Update Attendance Schema
// ============================================

export const updateAttendanceSchema = createAttendanceSchema.partial().omit({
  studentId: true,
  date: true,
  schoolId: true,
});

export type UpdateAttendanceDto = z.infer<typeof updateAttendanceSchema>;

// ============================================
// Attendance Response Schema
// ============================================

export const attendanceResponseSchema = z.object({
  attendanceId: z.string().uuid(),
  studentId: z.string().uuid(),
  studentName: z.string().optional(),
  studentNumber: z.string().optional(),
  schoolId: z.string().uuid(),
  academicYearId: z.string().uuid().optional(),
  
  // Core
  date: dateSchema,
  dayOfWeek: z.number().int().min(0).max(6).optional(), // 0=Sunday, 6=Saturday
  status: attendanceStatusSchema,
  attendanceType: attendanceTypeSchema,
  
  // Time
  checkInTime: z.string().optional(),
  checkOutTime: z.string().optional(),
  minutesLate: z.number().int().optional(),
  minutesEarly: z.number().int().optional(),
  
  // Period/Class
  classroomId: z.string().uuid().optional(),
  classroomName: z.string().optional(),
  periodId: z.string().uuid().optional(),
  periodNumber: z.number().int().optional(),

  // Section/Course context (denormalized at write time)
  sectionId: z.string().uuid().optional(),
  courseName: z.string().optional(),
  
  // Excuses
  excuseType: excuseTypeSchema.optional(),
  excuseReason: z.string().optional(),
  excuseDocumentUrl: z.string().optional(),
  
  // Communication
  notes: z.string().optional(),
  parentNotified: z.boolean(),
  parentNotifiedAt: z.string().optional(),
  
  // Location
  locationVerified: z.boolean(),
  
  // Metadata
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
});

export type AttendanceResponseDto = z.infer<typeof attendanceResponseSchema>;

// ============================================
// Attendance List Response Schema
// ============================================

export const attendanceListResponseSchema = createPaginatedResponseSchema(attendanceResponseSchema);
export type AttendanceListResponseDto = z.infer<typeof attendanceListResponseSchema>;

// ============================================
// Bulk Attendance Record Schema
// ============================================

export const bulkAttendanceRecordSchema = z.object({
  studentId: z.string().uuid(),
  studentName: z.string().optional(),
  status: attendanceStatusSchema,
  checkInTime: timeSchema.optional(),
  minutesLate: z.number().int().min(0).max(480).optional(),
  notes: z.string().max(200).optional(),
});

export type BulkAttendanceRecordDto = z.infer<typeof bulkAttendanceRecordSchema>;

// ============================================
// Bulk Attendance Schema
// ============================================

export const bulkAttendanceSchema = z.object({
  date: dateSchema,
  schoolId: z.string().uuid(),
  classroomId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
  periodNumber: z.number().int().positive().optional(),
  attendanceType: attendanceTypeSchema.default('daily'),
  records: z.array(bulkAttendanceRecordSchema).min(1).max(500),
});

export type BulkAttendanceDto = z.infer<typeof bulkAttendanceSchema>;

// ============================================
// Attendance Filter Schema
// ============================================

export const attendanceFilterSchema = z.object({
  schoolId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  classroomId: z.string().uuid().optional(),
  gradeLevel: z.string().optional(),
  status: attendanceStatusSchema.optional(),
  attendanceType: attendanceTypeSchema.optional(),
  dateFrom: dateSchema.optional(),
  dateTo: dateSchema.optional(),
  academicYearId: z.string().uuid().optional(),
});

export type AttendanceFilterDto = z.infer<typeof attendanceFilterSchema>;

// ============================================
// Attendance Summary Schema
// ============================================

export const attendanceSummarySchema = z.object({
  studentId: z.string().uuid(),
  studentName: z.string(),
  totalDays: z.number().int().min(0),
  presentDays: z.number().int().min(0),
  absentDays: z.number().int().min(0),
  tardyDays: z.number().int().min(0),
  excusedDays: z.number().int().min(0),
  attendanceRate: z.number().min(0).max(100),
  dateRange: z.object({
    from: dateSchema,
    to: dateSchema,
  }),
});

export type AttendanceSummaryDto = z.infer<typeof attendanceSummarySchema>;

// ============================================
// Bulk Attendance Response Schema
// ============================================

export const bulkAttendanceResponseSchema = z.object({
  success: z.boolean().default(true),
  date: dateSchema,
  schoolId: z.string().uuid(),
  totalProcessed: z.number().int().min(0),
  recordsCreated: z.number().int().min(0),
  recordsUpdated: z.number().int().min(0),
  errors: z.array(z.object({
    studentId: z.string(),
    error: z.string(),
  })).default([]),
});

export type BulkAttendanceResponseDto = z.infer<typeof bulkAttendanceResponseSchema>;

// ============================================
// Daily Attendance Summary Schema (for getDailySummary)
// ============================================

export const dailyAttendanceSummarySchema = z.object({
  date: dateSchema,
  schoolId: z.string().uuid(),
  totalStudents: z.number().int().min(0),
  totalRecorded: z.number().int().min(0).optional(),
  present: z.number().int().min(0),
  absent: z.number().int().min(0),
  late: z.number().int().min(0),
  excused: z.number().int().min(0),
  halfDay: z.number().int().min(0),
  remote: z.number().int().min(0).optional(),
  attendanceRate: z.number().min(0).max(100),
  /**
   * Recording coverage = recorded ÷ enrolled (S4.T5). The share of the rate
   * denominator that actually has a record for the day; a low value explains a
   * low rate (sparse recording) vs. genuine absence. Surfaced so the UI can show
   * "X of Y recorded" alongside the rate.
   */
  coveragePct: z.number().min(0).max(100).optional(),
  byGradeLevel: z.record(z.string(), z.object({
    total: z.number().int().min(0),
    present: z.number().int().min(0),
    absent: z.number().int().min(0),
    rate: z.number().min(0).max(100),
  })).optional(),
});

export type DailyAttendanceSummaryDto = z.infer<typeof dailyAttendanceSummarySchema>;

// ============================================
// Student Attendance Summary Schema (for getStudentSummary)
// ============================================

export const studentAttendanceSummarySchema = z.object({
  studentId: z.string().uuid(),
  studentName: z.string(),
  schoolId: z.string().uuid(),
  academicYearId: z.string().uuid().optional(),
  totalDays: z.number().int().min(0),
  present: z.number().int().min(0),
  absent: z.number().int().min(0),
  late: z.number().int().min(0),
  excused: z.number().int().min(0),
  halfDay: z.number().int().min(0),
  attendanceRate: z.number().min(0).max(100),
  dateRange: z.object({
    start: dateSchema,
    end: dateSchema,
  }),
});

export type StudentAttendanceSummaryDto = z.infer<typeof studentAttendanceSummarySchema>;

// ============================================
// Daily Attendance Report Schema
// ============================================

export const dailyAttendanceReportSchema = z.object({
  date: dateSchema,
  schoolId: z.string().uuid(),
  totalStudents: z.number().int().min(0),
  presentCount: z.number().int().min(0),
  absentCount: z.number().int().min(0),
  tardyCount: z.number().int().min(0),
  excusedCount: z.number().int().min(0),
  attendanceRate: z.number().min(0).max(100),
  byGradeLevel: z.record(z.string(), z.object({
    total: z.number().int().min(0),
    present: z.number().int().min(0),
    absent: z.number().int().min(0),
    rate: z.number().min(0).max(100),
  })).optional(),
});

export type DailyAttendanceReportDto = z.infer<typeof dailyAttendanceReportSchema>;

// ============================================
// Attendance Overview Response Schema (Task 1.9)
// ============================================

export const attendanceOverviewResponseSchema = z.object({
  todaySummary: dailyAttendanceSummarySchema.extend({
    totalRecorded: z.number().int().min(0),
    remote: z.number().int().min(0).optional(),
  }),
  sectionCompletion: z.object({
    totalSections: z.number().int().min(0),
    sectionsWithAttendance: z.number().int().min(0),
    sections: z.array(z.object({
      sectionId: z.string(),
      sectionNumber: z.string(),
      courseName: z.string(),
      studentCount: z.number().int().min(0),
      recordedCount: z.number().int().min(0),
      isComplete: z.boolean(),
    })),
  }),
  trend: z.array(dailyAttendanceSummarySchema),
  periodAverages: z.object({
    last7Days: z.number().min(0).max(100),
    last30Days: z.number().min(0).max(100),
    academicYear: z.number().min(0).max(100),
  }),
  atRiskStudents: z.array(z.object({
    studentId: z.string(),
    studentName: z.string(),
    gradeLevel: z.string().optional(),
    attendanceRate: z.number().min(0).max(100),
    totalDays: z.number().int().min(0),
    absentDays: z.number().int().min(0),
    trend: z.enum(['improving', 'declining', 'stable']),
  })),
  totalAtRiskCount: z.number().int().min(0),
  absenceBreakdown: z.object({
    unexcused: z.number().int().min(0),
    excused: z.number().int().min(0),
    late: z.number().int().min(0),
    halfDay: z.number().int().min(0),
    remote: z.number().int().min(0),
  }),
  dayOfWeekPattern: z.record(z.string(), z.object({
    avgRate: z.number().min(0).max(100),
    avgAbsent: z.number().min(0),
  })),
});

export type AttendanceOverviewResponseDto = z.infer<typeof attendanceOverviewResponseSchema>;

// ============================================
// Cross-section presence locks (D4)
// ============================================

/**
 * One student already marked present (physically attended) in some section on a
 * date. Under `daily_presence`, subsequent sections lock the student's row as
 * already-present. This is a READ the frontend consults to render locks; the
 * recording POST stays policy-agnostic and never branches on it.
 */
export const studentPresenceLockSchema = z.object({
  studentId: z.string().uuid(),
  /** The section that already recorded this student as attending that day. */
  lockedBySectionId: z.string().uuid(),
  /** Human label for that section (denormalized course name; may be absent). */
  lockedBySectionName: z.string().optional(),
  /** The attending status recorded (present/late/tardy/remote/half_day/early_departure). */
  status: attendanceStatusSchema,
});
export type StudentPresenceLockDto = z.infer<typeof studentPresenceLockSchema>;

export const presenceLockResponseSchema = z.object({
  schoolId: z.string().uuid(),
  date: dateSchema,
  locks: z.array(studentPresenceLockSchema),
});
export type PresenceLockResponseDto = z.infer<typeof presenceLockResponseSchema>;

// ============================================
// Monthly aggregate + IEMiS export (Layer 4)
// ============================================

/** YYYY-MM. */
export const yearMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'yearMonth must be YYYY-MM');

/**
 * Per-student, per-month attendance rollup of the daily aggregate — the shape
 * IEMiS Flash II consumes. `totalSchoolDays` is the recorded-days proxy
 * (present+absent+excused) in V1.
 */
export const studentMonthlyAttendanceAggregateSchema = z.object({
  studentId: z.string().uuid(),
  studentName: z.string().optional(),
  schoolId: z.string().uuid(),
  academicYearId: z.string().uuid().optional(),
  yearMonth: yearMonthSchema,
  presentDays: z.number().int().min(0),
  absentDays: z.number().int().min(0),
  excusedDays: z.number().int().min(0),
  totalSchoolDays: z.number().int().min(0),
  computedAt: z.string().optional(),
});
export type StudentMonthlyAttendanceAggregateDto = z.infer<typeof studentMonthlyAttendanceAggregateSchema>;

/** One IEMiS export row (per student per month). */
export const iemisAttendanceExportRowSchema = z.object({
  studentId: z.string().uuid(),
  studentName: z.string().optional(),
  gradeLevel: z.string().optional(),
  presentDays: z.number().int().min(0),
  absentDays: z.number().int().min(0),
  excusedDays: z.number().int().min(0),
  totalSchoolDays: z.number().int().min(0),
});
export type IemisAttendanceExportRowDto = z.infer<typeof iemisAttendanceExportRowSchema>;

export const iemisAttendanceExportResponseSchema = z.object({
  schoolId: z.string().uuid(),
  yearMonth: yearMonthSchema,
  generatedAt: z.string(),
  rowCount: z.number().int().min(0),
  rows: z.array(iemisAttendanceExportRowSchema),
});
export type IemisAttendanceExportResponseDto = z.infer<typeof iemisAttendanceExportResponseSchema>;
