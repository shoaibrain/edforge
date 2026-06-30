/**
 * ActiveExportAlreadyRunningError — Sprint §5d MVP.5
 *
 * Domain error thrown by `FinanceJobsService.create()` when the
 * `singleActiveExportGuard` option is set and a sentinel row for the
 * same `schoolId` already exists (i.e., a bulk-export job is already
 * `running` for that school). The active-export sentinel is
 * jobType-agnostic per §5d MVP.5 D1+D8 — both `bulk_invoice_pdf_export`
 * and `bulk_receipt_pdf_export` share one sentinel per school, so EITHER
 * type blocks EITHER type ("one export of any flavor per school" — the
 * MVP per-school concurrency budget).
 *
 * F.4's controller (future ticket) catches this and maps to HTTP 409
 * with body `{ code: 'ACTIVE_EXPORT_ALREADY_RUNNING', runningJobId,
 * schoolId, jobType }`. Until F.4 ships, the error is defined +
 * thrown by service-layer tests; no controller catcher yet.
 *
 * `runningJobId` lets the operator's UI link to the existing job
 * (operator clicks → polls the in-flight job's status) rather than
 * just showing a generic "already running" error.
 */

import type { FinanceJobType } from '../common/entities/finance-job.entity';

export class ActiveExportAlreadyRunningError extends Error {
  constructor(
    public readonly schoolId: string,
    public readonly jobType: FinanceJobType,
    public readonly runningJobId: string,
  ) {
    super(
      `Active export (${jobType}) already running for school ${schoolId} (jobId=${runningJobId})`,
    );
    this.name = 'ActiveExportAlreadyRunningError';
    // Preserve prototype chain for `instanceof` checks across the TS-to-JS
    // boundary (matches the codebase's exception convention).
    Object.setPrototypeOf(this, ActiveExportAlreadyRunningError.prototype);
  }
}
