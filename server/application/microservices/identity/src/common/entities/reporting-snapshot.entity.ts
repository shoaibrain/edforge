/**
 * ReportingSnapshot entity — Sprint E.1.1 (V1 Master EPIC Breakdown)
 *
 * Tracks the lifecycle of a CEHRD IEMIS Flash I/II (or future external
 * authority) report submission: from operator-initiated generation
 * through CSV emit, manual portal upload, and authority verification.
 *
 * DynamoDB key shape:
 *   PK: TENANT#{tenantId}
 *   SK: SCHOOL#{schoolId}#REPORTING_SNAPSHOT#{snapshotId}
 *
 * State machine (one-way transitions; `failed` is terminal):
 *
 *   generating ──► generated ──► submitted ──► verified
 *        │              │              │
 *        ▼              ▼              ▼
 *      failed         failed         failed
 *
 *   - `generating` — created by E.1.4 POST endpoint; Lambda triggered
 *   - `generated`  — Lambda finished; CSV at s3Key; signed URL retrievable
 *   - `submitted`  — operator clicked "Mark Submitted" after manual
 *                    upload to emis.cehrd.gov.np; submittedAt captured
 *   - `verified`   — operator confirms IEMIS portal returned acceptance;
 *                    verifiedAt captured (V2 may auto-fire via portal poll)
 *   - `failed`     — terminal: validation, S3 write, timeout, Lambda crash
 *
 * Per the v3.4 sprint plan, this entity is consumed by Sprint E.1.4
 * (POST endpoint), E.1.3 (Lambda writes status transitions), and
 * future E.1 follow-ups (verified confirmation flow).
 */

import { BaseEntity } from './base.entity';

/**
 * The status state-machine for a ReportingSnapshot.
 * Transitions are enforced at the service layer (E.1.4 / E.1.7).
 */
export type ReportingSnapshotStatus =
  | 'generating'
  | 'generated'
  | 'submitted'
  | 'verified'
  | 'failed';

/**
 * Template identifier — names the column-mapping config in S3.
 * Naming convention: `{REPORT_AUTHORITY}_{COUNTRY}_{TEMPLATE}` so future
 * pilots in other countries can register their own templates without
 * collision.
 */
export type ReportingTemplateId =
  | 'IEMIS_NPL_CEHRD_FLASH_I'
  | 'IEMIS_NPL_CEHRD_FLASH_II'
  // Reserved for future pilots; types-only, not actively loaded:
  | 'CBSE_IN'
  | 'STATE_DOE_TX';

/**
 * Pre-flight or generation-time error captured against a snapshot.
 * Used by E.1.5 pre-flight + E.1.3 Lambda failure paths.
 */
export interface ReportingSnapshotError {
  /** Row index in the source query result (0-based). */
  rowIndex: number;
  /** Stable Student.studentId reference (or empty for non-row-scoped errors). */
  studentId?: string;
  /** Column name in the target CSV that the error pertains to. */
  field: string;
  /** Operator-facing error message. */
  error: string;
}

/**
 * Pre-flight warning — distinct from `error` because warnings don't
 * block `canProceed`. Most common today (Sprint E.1.5):
 *   - §17.6 Sprint-0.1 historical-debt rows (motherTongue/disabilities/
 *     isTransferred null on the 206 pre-0.1.2a Saraswati rows)
 */
export interface ReportingSnapshotWarning {
  rowIndex: number;
  studentId?: string;
  field: string;
  message: string;
  suggestedRemedy?: string;
}

/**
 * The persisted entity. All fields mirror the Zod schema in
 * `packages/shared-types/src/schemas/identity/reporting-snapshot.schema.ts`;
 * the entity-vs-schema contract test asserts they stay in sync.
 */
export interface ReportingSnapshot extends BaseEntity {
  entityType: 'REPORTING_SNAPSHOT';

  // Identity
  snapshotId: string;
  schoolId: string;

  // Template + scope
  templateId: ReportingTemplateId;
  academicYearBs: string;

  // Lifecycle state
  status: ReportingSnapshotStatus;

  // Generation artifacts (populated when status='generated' or later)
  s3Key?: string;
  rowCount?: number;
  generatedAt?: string;

  // Submission lifecycle (populated on transition)
  submittedAt?: string;
  submittedBy?: string;
  verifiedAt?: string;
  verifiedBy?: string;

  // Failure detail (populated when status='failed')
  errorCode?: string;
  errorSummary?: string;

  // Schema version of the S3 template config used at generation time.
  // Per v3.4 E.1.0 §14 + R34: lets us reason about CSV format drift
  // when CEHRD renames headers.
  schemaVersion: string;

  // Dry-run flag — when true, the row is for preview only; no
  // submission can be triggered from it.
  dryRun?: boolean;
}

// ============================================
// State machine guard — used by E.1.4 service
// ============================================

/**
 * Legal state transitions. Any attempt outside this map yields a 409
 * `SNAPSHOT_INVALID_TRANSITION` from the service layer.
 *
 * Note: `failed` is reachable from every non-terminal state and is
 * itself terminal (no further transition). `verified` is also terminal
 * (the report has been acknowledged by the external authority).
 */
const LEGAL_TRANSITIONS: Record<ReportingSnapshotStatus, ReportingSnapshotStatus[]> = {
  generating: ['generated', 'failed'],
  generated: ['submitted', 'failed'],
  submitted: ['verified', 'failed'],
  verified: [],
  failed: [],
};

export function isLegalTransition(
  from: ReportingSnapshotStatus,
  to: ReportingSnapshotStatus,
): boolean {
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}

// ============================================
// Factory — used by E.1.4 POST endpoint
// ============================================

export interface CreateReportingSnapshotInput {
  tenantId: string;
  schoolId: string;
  snapshotId: string;
  templateId: ReportingTemplateId;
  academicYearBs: string;
  schemaVersion: string;
  createdBy: string;
  dryRun?: boolean;
}

export function createReportingSnapshotEntity(
  input: CreateReportingSnapshotInput,
): ReportingSnapshot {
  const now = new Date().toISOString();
  return {
    tenantId: input.tenantId,
    entityKey: `SCHOOL#${input.schoolId}#REPORTING_SNAPSHOT#${input.snapshotId}`,
    entityType: 'REPORTING_SNAPSHOT',
    snapshotId: input.snapshotId,
    schoolId: input.schoolId,
    templateId: input.templateId,
    academicYearBs: input.academicYearBs,
    status: 'generating',
    schemaVersion: input.schemaVersion,
    dryRun: input.dryRun,
    createdAt: now,
    createdBy: input.createdBy,
    updatedAt: now,
    updatedBy: input.createdBy,
    version: 1,
  };
}
