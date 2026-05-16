/**
 * External Reporting domain event schemas — Sprint C0.c.2.
 *
 * Two events covering the annual external reporting submission flow
 * (Sprint C10):
 *
 *   - reporting.submitted     — emitted on ReportingSnapshot submission
 *                                (CSV generated + validated)
 *   - reporting.submission_due — emitted by scheduled trigger when an AY
 *                                approaches the submission deadline for
 *                                a given report type (delivery deferred
 *                                per scope; the event fires for downstream
 *                                consumers to render reminders)
 *
 * Naming is generic (not "IEMIS_NPL_CEHRD") because future pilots in
 * other regions submit to other authorities. The `reportType` field
 * carries the template descriptor (e.g., `IEMIS_NPL_CEHRD`, `CBSE_IN`,
 * `STATE_DOE_TX`).
 */

import { z } from 'zod';
import { baseEventSchema } from './base';

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

export type ReportingSubmittedEvent = z.infer<typeof reportingSubmittedSchema>;
export type ReportingSubmissionDueEvent = z.infer<typeof reportingSubmissionDueSchema>;
