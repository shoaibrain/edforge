/**
 * Section Attendance Schemas (Ed-Fi: StudentSectionAttendanceEvent)
 *
 * Zod schemas for section-level attendance DTOs.
 * sectionId is REQUIRED on all create/bulk operations.
 */

import { z } from 'zod';
import {
  isoDateSchema,
  dateSchema,
  timeSchema,
  createPaginatedResponseSchema,
} from '../common';
import { attendanceStatusSchema, excuseTypeSchema } from './attendance.schema';

// ============================================
// Create Section Attendance Schema
// ============================================

export const createSectionAttendanceSchema = z.object({
  // Required
  studentId: z.string().uuid(),
  sectionId: z.string().uuid(),
  date: dateSchema,
  schoolId: z.string().uuid(),
  status: attendanceStatusSchema,

  // Optional
  academicYearId: z.string().uuid().optional(),
  checkInTime: timeSchema.optional(),
  checkOutTime: timeSchema.optional(),
  durationMinutes: z.number().int().min(0).max(600).optional(),
  excuseType: excuseTypeSchema.optional(),
  excuseReason: z.string().max(500).optional(),
  notes: z.string().max(500).optional(),
  parentNotified: z.boolean().default(false),
  parentNotifiedAt: isoDateSchema.optional(),
});

export type CreateSectionAttendanceDto = z.infer<typeof createSectionAttendanceSchema>;

// ============================================
// Update Section Attendance Schema
// ============================================

export const updateSectionAttendanceSchema = z.object({
  status: attendanceStatusSchema.optional(),
  checkInTime: timeSchema.optional(),
  checkOutTime: timeSchema.optional(),
  durationMinutes: z.number().int().min(0).max(600).optional(),
  excuseType: excuseTypeSchema.optional(),
  excuseReason: z.string().max(500).optional(),
  notes: z.string().max(500).optional(),
  parentNotified: z.boolean().optional(),
  parentNotifiedAt: isoDateSchema.optional(),
  expectedVersion: z.number().int().min(0).optional(),
});

export type UpdateSectionAttendanceDto = z.infer<typeof updateSectionAttendanceSchema>;

// ============================================
// Section Attendance Response Schema
// ============================================

export const sectionAttendanceResponseSchema = z.object({
  sectionAttendanceId: z.string().uuid(),
  studentId: z.string().uuid(),
  studentName: z.string().optional(),
  schoolId: z.string().uuid(),
  sectionId: z.string().uuid(),
  courseName: z.string().optional(),
  courseCode: z.string().optional(),
  academicYearId: z.string().uuid().optional(),

  date: dateSchema,
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  status: attendanceStatusSchema,

  // Ed-Fi descriptors
  attendanceEventCategory: z.string().optional(),
  attendanceEventReason: z.string().optional(),
  educationalEnvironment: z.string().optional(),

  // Times
  checkInTime: z.string().optional(),
  checkOutTime: z.string().optional(),
  durationMinutes: z.number().int().optional(),

  // Excuse
  excuseType: excuseTypeSchema.optional(),
  excuseReason: z.string().optional(),
  notes: z.string().optional(),

  // Communication
  parentNotified: z.boolean(),
  parentNotifiedAt: z.string().optional(),

  // Metadata
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
  version: z.number().int().optional(),
});

export type SectionAttendanceResponseDto = z.infer<typeof sectionAttendanceResponseSchema>;

// ============================================
// Section Attendance List Response
// ============================================

export const sectionAttendanceListResponseSchema = createPaginatedResponseSchema(sectionAttendanceResponseSchema);
export type SectionAttendanceListResponseDto = z.infer<typeof sectionAttendanceListResponseSchema>;

// ============================================
// Bulk Section Attendance Record
// ============================================

export const bulkSectionAttendanceRecordSchema = z.object({
  studentId: z.string().uuid(),
  studentName: z.string().optional(),
  status: attendanceStatusSchema,
  checkInTime: timeSchema.optional(),
  // Sprint 1.1 — the bulk path must carry the attendance reason end-to-end.
  // Previously omitted here, so the UI-selected reason was silently dropped
  // before it reached the backend (the bulk create/update never wrote
  // `entity.reason`). Mirrors the single-record schema above.
  excuseType: excuseTypeSchema.optional(),
  excuseReason: z.string().max(500).optional(),
  notes: z.string().max(200).optional(),
});

export type BulkSectionAttendanceRecordDto = z.infer<typeof bulkSectionAttendanceRecordSchema>;

// ============================================
// Bulk Section Attendance Schema
// ============================================

export const bulkSectionAttendanceSchema = z.object({
  sectionId: z.string().uuid(),
  date: dateSchema,
  schoolId: z.string().uuid(),
  academicYearId: z.string().uuid().optional(),
  records: z.array(bulkSectionAttendanceRecordSchema).min(1).max(500),
});

export type BulkSectionAttendanceDto = z.infer<typeof bulkSectionAttendanceSchema>;

// ============================================
// Bulk Section Attendance Response
// ============================================

export const bulkSectionAttendanceResponseSchema = z.object({
  success: z.boolean(),
  date: dateSchema,
  schoolId: z.string().uuid(),
  sectionId: z.string().uuid(),
  totalProcessed: z.number().int().min(0),
  recordsCreated: z.number().int().min(0),
  recordsUpdated: z.number().int().min(0),
  errors: z.array(z.object({
    studentId: z.string(),
    error: z.string(),
  })).default([]),
});

export type BulkSectionAttendanceResponseDto = z.infer<typeof bulkSectionAttendanceResponseSchema>;
