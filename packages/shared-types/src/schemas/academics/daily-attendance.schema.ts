/**
 * Attendance Ed-Fi projection.
 *
 * Maps an attendance status to its Ed-Fi `AttendanceEventCategoryDescriptor` +
 * day-fraction present. Recording is per-section (see attendance.schema.ts); the
 * aggregation layer uses this projection when rolling section records up to the
 * school-day and monthly aggregates. (Daily homeroom roll-call DTOs were removed
 * in the attendance realignment — a "homeroom" is a derived role, not an entity.)
 */
import type { AttendanceStatus } from './attendance.schema';

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
