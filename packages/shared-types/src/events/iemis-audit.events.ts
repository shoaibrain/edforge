/**
 * IEMIS Audit Event Schema (Sprint 1, S1.8)
 *
 * Append-only log of every IEMIS-scoped operation. Every IEMIS controller,
 * worker, and admin tool emits one of these events via the
 * `IemisAuditLogger` helper (S1.9). Consumers: `/iemis/audit` endpoint
 * (S1.10), operator observability dashboards (Sprint 13), and DSAR
 * fulfillment queries (Sprint 13).
 *
 * Design notes:
 *
 * - **Append-only.** No UPDATE, no DELETE. DDB SK prefix chooses a
 *   chronological scan order so recent activity is cheap to read.
 * - **No PII in `metadata`.** `emisStudentId`, `emisStaffId`, contact
 *   phone / email are masked at read time (S1.10) by role; events must
 *   not store them raw. If an operation fundamentally needs a subject
 *   ID, put it in a typed field (not a free-form `metadata`) so the
 *   read-side redaction can find and mask it reliably.
 * - **Fail-open emit.** A failed audit write never blocks the triggering
 *   operation. Failures are counted by the `iemis.audit.emit_failures`
 *   CloudWatch metric (S1.12).
 */

import { z } from 'zod';

/**
 * Canonical event-type catalog. Kept explicit (not a loose `z.string()`)
 * so a typo at emit time fails at compile time and logs at run time.
 * Add to the enum when a new IEMIS action lands in a sprint.
 */
export const IEMIS_AUDIT_EVENT_TYPES = [
  // Sprint 1
  'code.verified',
  'code.verify.denied',
  'audit.viewed',
  // Sprint 3 (student demographics)
  'student.descriptor.edited',
  // Sprint 4 (staff lifecycle — S4.7)
  // Naming convention: `<entity>.<action>` — entity-CRUD audit events,
  // mirrors `student.descriptor.edited`. Metadata SHOULD include the
  // entity's primary key (staffId, credentialId, assignmentId, trainingId)
  // and the Ed-Fi-aligned typed fields that drive Flash-II export
  // (credentialTypeDescriptor, etc.). Metadata MUST NOT include
  // PII (per IEMIS_AUDIT_PII_METADATA_KEYS).
  // Training types are pre-registered now so S4.3 (StaffTraining entity)
  // does not need to bump shared-types again to wire its audit events.
  'staff.credential.created',
  'staff.credential.edited',
  'staff.credential.deleted',
  'staff.assignment.created',
  'staff.assignment.edited',
  'staff.assignment.deleted',
  'staff.training.created',
  'staff.training.edited',
  'staff.training.deleted',
  // Sprint 8 (import)
  'import.queued',
  'import.started',
  'import.completed',
  'import.failed',
  // Sprint 9 (template engine)
  'template.uploaded',
  'template.activated',
  'template.deactivated',
  // Sprint 10-11 (export)
  'export.requested',
  'export.generated',
  'export.downloaded',
  'export.failed',
  // Sprint 12 (compliance reminders)
  'compliance.reminder.sent',
  // Sprint 13 (DSAR + PII access)
  'dsar.requested',
  'dsar.fulfilled',
  'pii.viewed',
] as const;

export type IemisAuditEventType = (typeof IEMIS_AUDIT_EVENT_TYPES)[number];

/**
 * Zod schema for an audit event payload (what callers pass to the
 * logger's `emit` method). The stored entity (below) adds server-
 * assigned fields like `eventId` and `entityKey`.
 */
export const iemisAuditEventPayloadSchema = z.object({
  eventType: z.enum(IEMIS_AUDIT_EVENT_TYPES),
  tenantId: z.string().min(1),
  /** Optional — platform-operator events (`template.*`) are cross-tenant. */
  schoolId: z.string().optional(),
  /** Actor. `system` for background jobs; Cognito `sub` for user-initiated. */
  actorUserId: z.string().min(1),
  /** Human-readable name of the actor, for audit UI readability. Optional; IP/role context still suffices. */
  actorName: z.string().optional(),
  /** Source IP when the event originated from an HTTP controller. Optional. */
  ipAddress: z.string().optional(),
  /**
   * Free-form structured context. MUST NOT contain raw PII
   * (`emisStudentId`, `emisStaffId`, contact phone / email). Pass
   * IDs via typed helper methods instead.
   */
  metadata: z.record(z.any()).optional(),
});

export type IemisAuditEventPayload = z.infer<typeof iemisAuditEventPayloadSchema>;

/**
 * Full persisted event shape (what `/iemis/audit` returns). `eventId`
 * is a v4 UUID assigned by the emit helper; `timestamp` is ISO-8601
 * UTC captured at emit time.
 */
export const iemisAuditEventSchema = iemisAuditEventPayloadSchema.extend({
  eventId: z.string().uuid(),
  timestamp: z.string().datetime(),
});

export type IemisAuditEvent = z.infer<typeof iemisAuditEventSchema>;

/**
 * Compose the DDB `entityKey` (sort key) for an audit event. Format:
 *   `AUDIT#IEMIS#<iso-timestamp>#<eventId>`
 *
 * This gives us:
 *   - Chronological scan via `begins_with(entityKey, 'AUDIT#IEMIS#')`
 *     sorted DESC on timestamp.
 *   - Event-id uniqueness (two events in the same millisecond still
 *     disambiguate via the UUID suffix).
 */
export function buildIemisAuditEntityKey(timestamp: string, eventId: string): string {
  return `AUDIT#IEMIS#${timestamp}#${eventId}`;
}

/**
 * Extract `timestamp` and `eventId` from a composed entityKey. Used by
 * the `/iemis/audit` response shaper when the DDB row doesn't carry
 * the fields on top-level attributes.
 */
export function parseIemisAuditEntityKey(
  entityKey: string,
): { timestamp: string; eventId: string } | null {
  const m = entityKey.match(/^AUDIT#IEMIS#(.+?)#([0-9a-f-]{36})$/i);
  if (!m) return null;
  return { timestamp: m[1], eventId: m[2] };
}

/**
 * Permission-metadata field names that should be redacted in audit-log
 * responses when the viewer is not a TenantAdmin. Kept as a single
 * source of truth so S1.10 (`GET /iemis/audit`) and Sprint 13's DSAR
 * handler stay in sync.
 */
export const IEMIS_AUDIT_PII_METADATA_KEYS = [
  'emisStudentId',
  'emisStaffId',
  'contactEmail',
  'contactPhone',
  'subjectEmail',
  'subjectPhone',
] as const;

export type IemisAuditPiiMetadataKey = (typeof IEMIS_AUDIT_PII_METADATA_KEYS)[number];
