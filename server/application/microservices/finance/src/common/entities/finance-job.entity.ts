/**
 * FinanceJob Entity — Sprint D.1
 *
 * Tracks one async invocation of the bulk-ops pipeline. Three job types
 * ship in the bulk-ops EPIC:
 *   - `bulk_invoice_generate`     (Sprint E worker, async branch of
 *                                   POST /invoices/bulk-generate)
 *   - `bulk_invoice_pdf_export`   (Sprint F worker)
 *   - `bulk_receipt_pdf_export`   (Sprint G worker)
 *
 * Lifecycle: `queued → running → succeeded | failed`. The state machine is
 * enforced by `FinanceJobsService` via DDB `ConditionExpression` checks
 * tied to the row's `version` so concurrent worker+janitor writers
 * (Sprint I) cannot trample each other.
 *
 * Key structure:
 *   - PK: tenantId          (bare UUID — `edforge_identity_ddb_bare_uuid_partition_key` memory)
 *   - SK: FINANCE_JOB#{jobId}
 *
 * No GSIs in V1. Direct `GetItem` by jobId is the primary access pattern.
 * `list(schoolId, ...)` queries the tenant partition with
 * `begins_with(entityKey, 'FINANCE_JOB#')` + a `schoolId` FilterExpression
 * — same shape as `IemisImportJobsService.list`.
 *
 * Audit pairing: every state transition emits a `FinanceAuditEvent`
 * (Sprint 0.3) via `FinanceAuditService.emit()`. Audit is forensic, not
 * blocking — a failed audit write does NOT fail the job.
 *
 * Caps to stay under DDB's 400 KB row limit at full saturation:
 *   - `errors[]`            capped at 200 entries (last-wins)
 *   - `failedStudentIds[]`  capped at 500 entries (last-wins, deduped)
 *
 * The 500 cap aligns with the Sprint E "Retry failed only" UX — operators
 * see the most recent 500 failures and can re-submit a smaller targeted
 * job for that subset.
 */

import { BaseEntity, EntityKeyBuilder } from './base.entity';

export type FinanceJobType =
  | 'bulk_invoice_generate'
  | 'bulk_invoice_pdf_export'
  | 'bulk_receipt_pdf_export';

export type FinanceJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export type FinanceJobOutputFormat = 'zip' | 'merged_pdf';

export interface FinanceJobCounters {
  /** Total work units the job set out to process (set at create). */
  requested: number;
  /** Units the worker completed successfully. */
  succeeded: number;
  /** Units that errored despite retries. */
  failed: number;
  /** Units the worker chose to skip (duplicates, already-completed, etc). */
  skipped: number;
  // NOTE: a `processed` counter (success + fail + skip) was dropped in
  // PR #341 review fix-ups (F2). It was incremented only on the failure
  // path (via `appendFailedStudent`), never on the success/skip paths,
  // so a fully successful job ended with `processed=0`. The frontend
  // already computes `done = succeeded + failed + skipped`, so the field
  // had no consumer. Compute it at the boundary if you need it.
}

export interface FinanceJobOutput {
  /** S3 key of the assembled ZIP (Sprint F). */
  zipKey?: string;
  /** S3 key of the assembled merged PDF (Sprint H). */
  mergedPdfKey?: string;
  /** Presigned GET URL for the ZIP — re-minted on poll if within 60s of expiry. */
  zipUrl?: string;
  /** Presigned GET URL for the merged PDF — same re-mint policy. */
  mergedPdfUrl?: string;
  /** ISO-8601 expiry for the currently-minted URL(s). */
  urlExpiresAt?: string;
}

export interface FinanceJobError {
  /** ISO-8601 timestamp the error was recorded. */
  at: string;
  /** Truncated error message (caps total `errors[]` array at 200). */
  message: string;
}

export interface FinanceJobEntity extends BaseEntity {
  entityType: 'FINANCE_JOB';

  jobId: string;
  schoolId: string;
  /** JWT `sub` of the operator who submitted the job. */
  operatorId: string;
  jobType: FinanceJobType;
  status: FinanceJobStatus;

  /** GSI15 (sparse running-jobs index): present only while `status === 'running'`. */
  gsi15pk?: string;
  /** GSI15 sort key: `startedAt`, so the janitor can range on it. */
  gsi15sk?: string;

  counters: FinanceJobCounters;

  /** Operator-chosen output format for PDF-export jobs. `null` for generate jobs. */
  outputFormat?: FinanceJobOutputFormat | null;

  /** Populated by the worker on `succeeded` — keys + presigned URLs. */
  output?: FinanceJobOutput;

  /**
   * Last 500 student IDs whose per-student work failed. Powers the
   * Sprint E "Retry failed only" UX. Deduped on append.
   */
  failedStudentIds: string[];

  /**
   * Sprint F.3 — last 500 invoice IDs whose per-invoice work failed
   * during bulk PDF export. Parallel to `failedStudentIds` but
   * semantically distinct (invoice IDs, not student IDs) to keep the
   * F/G "Retry failed only" UX unambiguous. Deduped on append.
   * Optional because pre-F.3 jobs (bulk_invoice_generate) never had
   * this field.
   */
  failedInvoiceIds?: string[];

  /** Operator-supplied `Idempotency-Key` (Sprint 0.2) — present when the submit was idempotent. */
  idempotencyKey?: string;

  /** Last 200 error messages (truncated each). */
  errors: FinanceJobError[];

  // Lifecycle timestamps
  /** Set by `markRunning` — when the worker first picked up the job. */
  startedAt?: string;
  /** Set by `markCompleted` or `markFailed`. */
  completedAt?: string;
}

const ERRORS_CAP = 200;
const FAILED_STUDENTS_CAP = 500;
const FAILED_INVOICES_CAP = 500;
const ERROR_MESSAGE_TRUNCATE = 500;

/**
 * Append a single error to a capped `errors[]` array — keeps the last
 * `ERRORS_CAP` entries so the most-recent failures are preserved when
 * the worker hits a sustained failure mode.
 *
 * Exported as a pure helper so the worker (Sprint E) + the service
 * lifecycle methods (D.2) share one implementation.
 */
export function capErrors(
  existing: FinanceJobError[] | undefined,
  newError: { at: string; message: string },
): FinanceJobError[] {
  const truncated: FinanceJobError = {
    at: newError.at,
    message: newError.message.slice(0, ERROR_MESSAGE_TRUNCATE),
  };
  const combined = [...(existing ?? []), truncated];
  if (combined.length <= ERRORS_CAP) return combined;
  return combined.slice(combined.length - ERRORS_CAP);
}

/**
 * Append new failed student IDs to `failedStudentIds[]`, deduplicating
 * against the existing list and keeping only the most recent
 * `FAILED_STUDENTS_CAP` entries.
 *
 * Last-wins on collision (a student that fails twice keeps the latest
 * position in the array — which is what the "Retry failed only" UX
 * wants: the most recently observed failures bubble up).
 */
export function capFailedStudents(
  existing: string[] | undefined,
  newIds: string[],
): string[] {
  // Build the combined list with last-wins dedupe by walking from the
  // back: track which IDs we've already seen in a Set, push to the
  // result only if not yet seen. Then reverse to restore "oldest-first
  // within the kept window" ordering.
  const all = [...(existing ?? []), ...newIds];
  const seen = new Set<string>();
  const reverseDeduped: string[] = [];
  for (let i = all.length - 1; i >= 0; i--) {
    const id = all[i];
    if (!seen.has(id)) {
      seen.add(id);
      reverseDeduped.push(id);
    }
  }
  // reverseDeduped is now last-occurrence-first; flip back to chronological
  const chronological = reverseDeduped.reverse();
  if (chronological.length <= FAILED_STUDENTS_CAP) return chronological;
  return chronological.slice(chronological.length - FAILED_STUDENTS_CAP);
}

/**
 * Sprint F.3 — same shape as `capFailedStudents` but for invoice IDs
 * during bulk PDF export. Last-wins dedupe; caps to FAILED_INVOICES_CAP
 * (500). Kept as a separate helper from capFailedStudents to make the
 * call-site semantically explicit — invoice IDs and student IDs are
 * different identifier spaces and the "Retry failed only" UX powers
 * different APIs depending on which it's looking at.
 */
export function capFailedInvoices(
  existing: string[] | undefined,
  newIds: string[],
): string[] {
  const all = [...(existing ?? []), ...newIds];
  const seen = new Set<string>();
  const reverseDeduped: string[] = [];
  for (let i = all.length - 1; i >= 0; i--) {
    const id = all[i];
    if (!seen.has(id)) {
      seen.add(id);
      reverseDeduped.push(id);
    }
  }
  const chronological = reverseDeduped.reverse();
  if (chronological.length <= FAILED_INVOICES_CAP) return chronological;
  return chronological.slice(chronological.length - FAILED_INVOICES_CAP);
}

/**
 * Construct a freshly-`queued` FinanceJob entity. Counters start at
 * `{succeeded:0, failed:0, skipped:0}`; `requested` is
 * caller-supplied (the number of students/invoices/receipts the job
 * will iterate). Timestamps + version pinned for putItem.
 */
export function createFinanceJobEntity(
  tenantId: string,
  jobId: string,
  init: {
    schoolId: string;
    operatorId: string;
    jobType: FinanceJobType;
    requested: number;
    outputFormat?: FinanceJobOutputFormat | null;
    idempotencyKey?: string;
  },
): FinanceJobEntity {
  const now = new Date().toISOString();
  return {
    tenantId,
    entityKey: EntityKeyBuilder.financeJob(jobId),
    entityType: 'FINANCE_JOB',
    jobId,
    schoolId: init.schoolId,
    operatorId: init.operatorId,
    jobType: init.jobType,
    status: 'queued',
    counters: {
      requested: init.requested,
      succeeded: 0,
      failed: 0,
      skipped: 0,
    },
    outputFormat: init.outputFormat ?? null,
    failedStudentIds: [],
    idempotencyKey: init.idempotencyKey,
    errors: [],
    createdAt: now,
    createdBy: init.operatorId,
    updatedAt: now,
    updatedBy: init.operatorId,
    version: 1,
  };
}
