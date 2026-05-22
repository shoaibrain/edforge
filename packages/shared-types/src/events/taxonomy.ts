/**
 * Event taxonomy registry — Sprint C0.c.2.
 *
 * The single source of truth for which domain event types are valid in
 * V1 and what shape their payload must take. Per invariant 6, every
 * domain action emits an event with a registry schema; this file IS the
 * registry.
 *
 * Adding a new event type requires:
 *   1. Define the Zod schema in the appropriate per-domain file
 *      (school.ts, enrollment.ts, etc.) — extending `baseEventSchema`
 *      with `eventType: z.literal('<name>')` as the discriminator.
 *   2. Add the entry to `EVENT_REGISTRY` below.
 *   3. Add the inferred type to the `DomainEvent` discriminated union.
 *
 * C0.c.3 (next ticket) wires `EventServiceBase.publishEvent` to call
 * `validateEvent()` before posting to EventBridge, so a schema-less or
 * malformed payload is caught at the emit site rather than silently
 * landing on the bus.
 *
 * Pilot-agnostic per invariant 13.
 */

import { z } from 'zod';

import {
  schoolCreatedSchema,
  schoolActivatedSchema,
  schoolUpdatedSchema,
  schoolDeactivatedSchema,
} from './school';
import {
  academicYearCreatedSchema,
  academicYearActivatedSchema,
  academicYearCompletedSchema,
} from './academic-year';
import {
  termCreatedSchema,
  termUpdatedSchema,
  termExamScheduledSchema,
} from './term';
import {
  enrollmentCreatedSchema,
  enrollmentPromotedSchema,
  enrollmentRetainedSchema,
  enrollmentWithdrawnSchema,
} from './enrollment';
import {
  attendanceRecordedSchema,
  attendanceUpdatedSchema,
} from './attendance';
import {
  examCreatedSchema,
  examClosedSchema,
  examPublishedSchema,
} from './exam';
import { resultPublishedSchema } from './result';
import {
  reportingSubmittedSchema,
  reportingSubmissionDueSchema,
  reportingSnapshotInitiatedSchema,
  reportingSnapshotGeneratedSchema,
  reportingSnapshotFailedSchema,
} from './reporting';
import {
  calendarBlockCreatedSchema,
  calendarBlockUpdatedSchema,
  calendarBlockDeletedSchema,
} from './calendar';

/**
 * The registry. Keys are the event type discriminator strings; values
 * are the Zod schemas that validate the full event payload (envelope +
 * domain fields).
 *
 * `as const` so TypeScript narrows `keyof EVENT_REGISTRY` to the exact
 * 22-element literal union rather than `string`.
 */
export const EVENT_REGISTRY = {
  // School (4)
  'school.created': schoolCreatedSchema,
  'school.activated': schoolActivatedSchema,
  'school.updated': schoolUpdatedSchema,
  'school.deactivated': schoolDeactivatedSchema,
  // Academic Year (3)
  'academic_year.created': academicYearCreatedSchema,
  'academic_year.activated': academicYearActivatedSchema,
  'academic_year.completed': academicYearCompletedSchema,
  // Term (3)
  'term.created': termCreatedSchema,
  'term.updated': termUpdatedSchema,
  'term.exam_scheduled': termExamScheduledSchema,
  // Enrollment (4)
  'enrollment.created': enrollmentCreatedSchema,
  'enrollment.promoted': enrollmentPromotedSchema,
  'enrollment.retained': enrollmentRetainedSchema,
  'enrollment.withdrawn': enrollmentWithdrawnSchema,
  // Attendance (2)
  'attendance.recorded': attendanceRecordedSchema,
  'attendance.updated': attendanceUpdatedSchema,
  // Exam (3)
  'exam.created': examCreatedSchema,
  'exam.closed': examClosedSchema,
  'exam.published': examPublishedSchema,
  // Result (1)
  'result.published': resultPublishedSchema,
  // Reporting (5) — Sprint E.1.0 added the 3 snapshot lifecycle events
  'reporting.submitted': reportingSubmittedSchema,
  'reporting.submission_due': reportingSubmissionDueSchema,
  'reporting.snapshot_initiated': reportingSnapshotInitiatedSchema,
  'reporting.snapshot_generated': reportingSnapshotGeneratedSchema,
  'reporting.snapshot_failed': reportingSnapshotFailedSchema,
  // Calendar — multi-day block (3)
  'calendar.block_created': calendarBlockCreatedSchema,
  'calendar.block_updated': calendarBlockUpdatedSchema,
  'calendar.block_deleted': calendarBlockDeletedSchema,
} as const;

export type EventType = keyof typeof EVENT_REGISTRY;

/**
 * Discriminated union of every V1 domain event payload. Use this as the
 * parameter type for typed publish methods (C0.c.3 introduces
 * `EventServiceBase.publishValidatedEvent(event: DomainEvent)`).
 *
 * TypeScript narrows via `event.eventType` thanks to the
 * `z.literal('...')` discriminator on each concrete schema.
 */
export type DomainEvent =
  | z.infer<typeof schoolCreatedSchema>
  | z.infer<typeof schoolActivatedSchema>
  | z.infer<typeof schoolUpdatedSchema>
  | z.infer<typeof schoolDeactivatedSchema>
  | z.infer<typeof academicYearCreatedSchema>
  | z.infer<typeof academicYearActivatedSchema>
  | z.infer<typeof academicYearCompletedSchema>
  | z.infer<typeof termCreatedSchema>
  | z.infer<typeof termUpdatedSchema>
  | z.infer<typeof termExamScheduledSchema>
  | z.infer<typeof enrollmentCreatedSchema>
  | z.infer<typeof enrollmentPromotedSchema>
  | z.infer<typeof enrollmentRetainedSchema>
  | z.infer<typeof enrollmentWithdrawnSchema>
  | z.infer<typeof attendanceRecordedSchema>
  | z.infer<typeof attendanceUpdatedSchema>
  | z.infer<typeof examCreatedSchema>
  | z.infer<typeof examClosedSchema>
  | z.infer<typeof examPublishedSchema>
  | z.infer<typeof resultPublishedSchema>
  | z.infer<typeof reportingSubmittedSchema>
  | z.infer<typeof reportingSubmissionDueSchema>
  | z.infer<typeof reportingSnapshotInitiatedSchema>
  | z.infer<typeof reportingSnapshotGeneratedSchema>
  | z.infer<typeof reportingSnapshotFailedSchema>
  | z.infer<typeof calendarBlockCreatedSchema>
  | z.infer<typeof calendarBlockUpdatedSchema>
  | z.infer<typeof calendarBlockDeletedSchema>;

export type ValidateEventResult =
  | { success: true; data: DomainEvent }
  | { success: false; error: 'UNKNOWN_EVENT_TYPE'; eventType: string }
  | { success: false; error: 'INVALID_PAYLOAD'; eventType: EventType; details: z.ZodError };

/**
 * Validate an event payload against the registry.
 *
 * Returns a discriminated result rather than throwing so callers can
 * decide whether to log + drop, send to DLQ, or fail the operation.
 * `EventServiceBase` (C0.c.3) will log + DLQ on `success: false`.
 *
 * @param payload — the JSON-serializable event object. Must include
 *                  `eventType`; other required fields are schema-checked.
 */
export function validateEvent(payload: {
  eventType: string;
  [key: string]: unknown;
}): ValidateEventResult {
  const schema = (EVENT_REGISTRY as Record<string, z.ZodTypeAny>)[payload.eventType];
  if (!schema) {
    return {
      success: false,
      error: 'UNKNOWN_EVENT_TYPE',
      eventType: payload.eventType,
    };
  }
  const result = schema.safeParse(payload);
  if (!result.success) {
    return {
      success: false,
      error: 'INVALID_PAYLOAD',
      eventType: payload.eventType as EventType,
      details: result.error,
    };
  }
  return { success: true, data: result.data as DomainEvent };
}

/**
 * Returns the full list of registered event types. Useful for tests
 * (asserting registry completeness) and for the C0.c.3 lint rule.
 */
export function listEventTypes(): EventType[] {
  return Object.keys(EVENT_REGISTRY) as EventType[];
}
