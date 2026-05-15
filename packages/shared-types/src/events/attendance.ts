/**
 * Attendance domain event schemas — Sprint C0.c.2.
 *
 * Two events, deliberately collapsed from the four existing
 * AttendanceRecorded / BulkAttendanceRecorded / SectionAttendanceRecorded /
 * BulkSectionAttendanceRecorded variants in academics-events.service.ts:
 *
 *   - attendance.recorded — first time an attendance row lands for the
 *                           (enrollment, date[, periodId]) tuple
 *   - attendance.updated  — subsequent change to an existing row
 *
 * Bulk operations emit N attendance.recorded events (one per row), not
 * a single batch event. This keeps the schema simple and lets consumers
 * apply per-row business logic uniformly. The publisher batches at the
 * EventBridge level (publishEvents chunks at 10 per command).
 *
 * Per-period attendance is supported via the optional `periodId` field.
 * When `periodId` is absent the event represents a day-level attendance
 * record; when present it represents a per-period record that rolls up
 * into the day record (Sprint C6).
 */

import { z } from 'zod';
import { baseEventSchema } from './base';

export const ATTENDANCE_STATUSES = [
  'present',
  'absent',
  'late',
  'excused',
  'partial_absent',
  'holiday',
  'vacation',
  'weekend',
] as const;

const attendanceCommonShape = {
  attendanceId: z.string().min(1),
  enrollmentId: z.string().min(1),
  schoolId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodId: z.string().min(1).optional(),
};

export const attendanceRecordedSchema = baseEventSchema.extend({
  eventType: z.literal('attendance.recorded'),
  ...attendanceCommonShape,
  status: z.enum(ATTENDANCE_STATUSES),
});

export const attendanceUpdatedSchema = baseEventSchema.extend({
  eventType: z.literal('attendance.updated'),
  ...attendanceCommonShape,
  previousStatus: z.enum(ATTENDANCE_STATUSES),
  newStatus: z.enum(ATTENDANCE_STATUSES),
});

export type AttendanceRecordedEvent = z.infer<typeof attendanceRecordedSchema>;
export type AttendanceUpdatedEvent = z.infer<typeof attendanceUpdatedSchema>;
