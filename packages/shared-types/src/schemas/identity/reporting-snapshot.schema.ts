/**
 * Reporting Snapshot — Identity Service
 *
 * Sprint E.1.1 (V1 Master EPIC Breakdown). Tracks lifecycle of a CEHRD
 * IEMIS Flash I/II (or future external authority) report submission.
 *
 * Mirrors `microservices/identity/src/common/entities/reporting-snapshot.entity.ts`;
 * the entity-vs-schema contract test asserts they stay in sync.
 */

import { z } from 'zod';
import { isoDateSchema } from '../common';

// ============================================
// Enums
// ============================================

/**
 * State-machine status. Transitions enforced at the identity service
 * layer via `isLegalTransition()`.
 */
export const reportingSnapshotStatusSchema = z.enum([
  'generating',
  'generated',
  'submitted',
  'verified',
  'failed',
]);
export type ReportingSnapshotStatus = z.infer<typeof reportingSnapshotStatusSchema>;

/**
 * Template identifier — names the column-mapping config in S3.
 * Naming convention: `{REPORT_AUTHORITY}_{COUNTRY}_{TEMPLATE}`.
 */
export const reportingTemplateIdSchema = z.enum([
  'IEMIS_NPL_CEHRD_FLASH_I',
  'IEMIS_NPL_CEHRD_FLASH_II',
  // Reserved (types-only; not yet wired):
  'CBSE_IN',
  'STATE_DOE_TX',
]);
export type ReportingTemplateId = z.infer<typeof reportingTemplateIdSchema>;

// ============================================
// Error / Warning sub-schemas (used by E.1.5 pre-flight + E.1.3 Lambda)
// ============================================

export const reportingSnapshotErrorSchema = z.object({
  rowIndex: z.number().int().min(0),
  studentId: z.string().min(1).optional(),
  field: z.string().min(1).max(80),
  error: z.string().min(1).max(500),
});

export const reportingSnapshotWarningSchema = z.object({
  rowIndex: z.number().int().min(0),
  studentId: z.string().min(1).optional(),
  field: z.string().min(1).max(80),
  message: z.string().min(1).max(500),
  suggestedRemedy: z.string().max(200).optional(),
});

export type ReportingSnapshotErrorDto = z.infer<typeof reportingSnapshotErrorSchema>;
export type ReportingSnapshotWarningDto = z.infer<typeof reportingSnapshotWarningSchema>;

// ============================================
// Create request (POST /reporting/snapshots)
// ============================================

export const createReportingSnapshotSchema = z.object({
  templateId: reportingTemplateIdSchema,
  academicYearBs: z.string().regex(/^\d{4}$/, 'academicYearBs must be a 4-digit BS year (e.g. "2083")'),
  schoolId: z.string().uuid(),
  dryRun: z.boolean().optional(),
});
export type CreateReportingSnapshotDto = z.infer<typeof createReportingSnapshotSchema>;

// ============================================
// Pre-flight request + response (POST /reporting/snapshots/preflight)
// ============================================

export const preflightReportingSnapshotSchema = z.object({
  templateId: reportingTemplateIdSchema,
  academicYearBs: z.string().regex(/^\d{4}$/),
  schoolId: z.string().uuid(),
});
export type PreflightReportingSnapshotDto = z.infer<typeof preflightReportingSnapshotSchema>;

export const preflightReportingSnapshotResponseSchema = z.object({
  rowCount: z.number().int().min(0),
  errors: z.array(reportingSnapshotErrorSchema),
  warnings: z.array(reportingSnapshotWarningSchema),
  canProceed: z.boolean(),
});
export type PreflightReportingSnapshotResponseDto = z.infer<
  typeof preflightReportingSnapshotResponseSchema
>;

// ============================================
// Snapshot response (GET / read after POST)
// ============================================

export const reportingSnapshotResponseSchema = z.object({
  snapshotId: z.string().uuid(),
  schoolId: z.string().uuid(),
  templateId: reportingTemplateIdSchema,
  academicYearBs: z.string(),
  status: reportingSnapshotStatusSchema,
  s3Key: z.string().optional(),
  rowCount: z.number().int().min(0).optional(),
  generatedAt: isoDateSchema.optional(),
  submittedAt: isoDateSchema.optional(),
  submittedBy: z.string().optional(),
  verifiedAt: isoDateSchema.optional(),
  verifiedBy: z.string().optional(),
  errorCode: z.string().optional(),
  errorSummary: z.string().optional(),
  schemaVersion: z.string(),
  dryRun: z.boolean().optional(),
  createdAt: isoDateSchema,
  createdBy: z.string(),
  updatedAt: isoDateSchema,
});
export type ReportingSnapshotResponseDto = z.infer<typeof reportingSnapshotResponseSchema>;

// ============================================
// Transition request (PATCH /reporting/snapshots/:id/transition)
// ============================================

export const transitionReportingSnapshotSchema = z.object({
  nextStatus: reportingSnapshotStatusSchema,
  errorCode: z.string().max(80).optional(),
  errorSummary: z.string().max(2000).optional(),
});
export type TransitionReportingSnapshotDto = z.infer<typeof transitionReportingSnapshotSchema>;
