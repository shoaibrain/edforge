/**
 * External Reporting domain event schemas.
 *
 * Sprint C0.c.2 introduced `reporting.submitted` + `reporting.submission_due`.
 * Sprint E.1.0 (V1 Master EPIC Breakdown) adds 3 lifecycle events to cover
 * the full ReportingSnapshot state machine:
 *
 *   - reporting.snapshot_initiated — operator clicked "Generate"; row
 *                                     created in status=generating
 *   - reporting.snapshot_generated — Lambda finished; CSV in S3; status
 *                                     transitions to generated
 *   - reporting.snapshot_failed    — terminal-fail (validation, S3 write,
 *                                     timeout, Lambda crash); DLQ alarm
 *
 *   - reporting.submitted          — operator clicked "Submit" (manual
 *                                     post-CSV-download upload to IEMIS portal)
 *   - reporting.submission_due     — scheduled trigger ~30 days before
 *                                     Flash I/II deadline (Jestha/Chaitra)
 *
 * (`reporting.snapshot_verified` from the original 5-event plan is deferred —
 * verification is operator-driven via PATCH, not auto-fired; no event needed
 * until we wire IEMIS portal confirmation polling, which is V2 scope.)
 *
 * Naming is generic (not "IEMIS_NPL_CEHRD") because future pilots in
 * other regions submit to other authorities. The `reportType` / `templateId`
 * field carries the template descriptor (e.g., `IEMIS_NPL_CEHRD_FLASH_I`,
 * `CBSE_IN`, `STATE_DOE_TX`).
 */

import { z } from 'zod';
import { baseEventSchema } from './base';

// ============================================
// Sprint E.1.0 — snapshot lifecycle events
// ============================================

export const reportingSnapshotInitiatedSchema = baseEventSchema.extend({
  eventType: z.literal('reporting.snapshot_initiated'),
  snapshotId: z.string().min(1),
  schoolId: z.string().min(1),
  templateId: z.string().min(1),
  academicYearBs: z.string().min(1),
  initiatedBy: z.string().min(1),
  initiatedAt: z.string().datetime({ offset: true }),
  dryRun: z.boolean().optional(),
});

export const reportingSnapshotGeneratedSchema = baseEventSchema.extend({
  eventType: z.literal('reporting.snapshot_generated'),
  snapshotId: z.string().min(1),
  schoolId: z.string().min(1),
  templateId: z.string().min(1),
  rowCount: z.number().int().min(0),
  s3Key: z.string().min(1),
  generatedAt: z.string().datetime({ offset: true }),
  schemaVersion: z.string().min(1),
});

export const reportingSnapshotFailedSchema = baseEventSchema.extend({
  eventType: z.literal('reporting.snapshot_failed'),
  snapshotId: z.string().min(1),
  schoolId: z.string().min(1),
  templateId: z.string().min(1),
  failedAt: z.string().datetime({ offset: true }),
  errorCode: z.string().min(1),
  errorMessage: z.string().min(1).max(2000),
});

// ============================================
// Existing (C0.c.2) — kept as-is
// ============================================

export const reportingSubmittedSchema = baseEventSchema.extend({
  eventType: z.literal('reporting.submitted'),
  reportId: z.string().min(1),
  schoolId: z.string().min(1),
  yearId: z.string().min(1),
  reportType: z.string().min(1),
  submittedAt: z.string().datetime({ offset: true }),
  csvS3Key: z.string().min(1).optional(),
});

export const reportingSubmissionDueSchema = baseEventSchema.extend({
  eventType: z.literal('reporting.submission_due'),
  schoolId: z.string().min(1),
  yearId: z.string().min(1),
  reportType: z.string().min(1),
  /** Calendar date the submission is due, in AD/ISO. */
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// Type exports
export type ReportingSnapshotInitiatedEvent = z.infer<typeof reportingSnapshotInitiatedSchema>;
export type ReportingSnapshotGeneratedEvent = z.infer<typeof reportingSnapshotGeneratedSchema>;
export type ReportingSnapshotFailedEvent = z.infer<typeof reportingSnapshotFailedSchema>;
export type ReportingSubmittedEvent = z.infer<typeof reportingSubmittedSchema>;
export type ReportingSubmissionDueEvent = z.infer<typeof reportingSubmissionDueSchema>;
