/**
 * Daily Attendance Schemas (Attendance Domain epic, Sprint 4 / S4.T1).
 *
 * Daily homeroom roll-call: roster-scoped to a homeroom Section, "absentees-only"
 * fast path (unmarked rostered students default to present, A1), written as
 * authoritative SCH_ATTEND rows (derivedFrom:'direct') with Ed-Fi descriptors +
 * eventDuration. Distinct from the per-section / per-period attendance schemas.
 */
import { z } from 'zod';
import { dateSchema, timeSchema } from '../common';
import { attendanceStatusSchema, type AttendanceStatus } from './attendance.schema';

// ============================================
// Ed-Fi projection: status -> category descriptor + eventDuration
// ============================================

export interface EdfiAttendanceEvent {
  /** Ed-Fi AttendanceEventCategoryDescriptor. */
  attendanceEventCategory: string;
  /** Fraction of the instructional day the student was present (0..1). */
  eventDuration: number;
}

const ATTENDANCE_EDFI_MAP: Record<AttendanceStatus, EdfiAttendanceEvent> = {
  present:         { attendanceEventCategory: 'In Attendance',     eventDuration: 1 },
  remote:          { attendanceEventCategory: 'In Attendance',     eventDuration: 1 },
  late:            { attendanceEventCategory: 'Tardy',             eventDuration: 1 },
  tardy:           { attendanceEventCategory: 'Tardy',             eventDuration: 1 },
  half_day:        { attendanceEventCategory: 'In Attendance',     eventDuration: 0.5 },
  early_departure: { attendanceEventCategory: 'Early Departure',   eventDuration: 0.5 },
  excused:         { attendanceEventCategory: 'Excused Absence',   eventDuration: 0 },
  absent:          { attendanceEventCategory: 'Unexcused Absence', eventDuration: 0 },
};

/**
 * Map an attendance status to its Ed-Fi event category + day-fraction present.
 * The objective present-fraction lives on the row; the archetype/tenant
 * AttendanceCountingPolicy decides how to weight categories at read time.
 */
export function toEdfiAttendanceEvent(status: AttendanceStatus): EdfiAttendanceEvent {
  return ATTENDANCE_EDFI_MAP[status];
}

// ============================================
// Daily roll-call DTO (homeroom-scoped)
// ============================================

export const dailyAttendanceMarkSchema = z.object({
  studentId: z.string().uuid(),
  status: attendanceStatusSchema,
  notes: z.string().max(200).optional(),
  checkInTime: timeSchema.optional(),
});
export type DailyAttendanceMarkDto = z.infer<typeof dailyAttendanceMarkSchema>;

export const recordDailyAttendanceSchema = z.object({
  schoolId: z.string().uuid(),
  homeroomSectionId: z.string().uuid(),
  academicYearId: z.string().uuid(),
  date: dateSchema,
  // Exceptions only — every unmarked rostered student defaults to present (A1).
  marks: z.array(dailyAttendanceMarkSchema).max(500).default([]),
});
export type RecordDailyAttendanceDto = z.infer<typeof recordDailyAttendanceSchema>;

export const recordDailyAttendanceResponseSchema = z.object({
  success: z.boolean(),
  schoolId: z.string().uuid(),
  homeroomSectionId: z.string().uuid(),
  date: dateSchema,
  rosterSize: z.number().int().min(0),
  marked: z.number().int().min(0),
  defaultedPresent: z.number().int().min(0),
  recordsWritten: z.number().int().min(0),
});
export type RecordDailyAttendanceResponseDto = z.infer<typeof recordDailyAttendanceResponseSchema>;
