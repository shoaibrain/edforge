import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { FinanceModule } from './finance.module';
import { FinanceJobsService } from './bulk-ops/finance-jobs.service';
import { DdbSchoolLock } from './bulk-ops/util/ddb-school-lock';
import { SchoolLockBusyError } from './bulk-ops/util/school-lock';
import { BulkInvoiceGenerateWorker } from './bulk-ops/workers/bulk-invoice-generate.worker';
import { BulkInvoicePdfExportWorker } from './bulk-ops/workers/bulk-invoice-pdf-export.worker';
import { BulkReceiptPdfExportWorker } from './bulk-ops/workers/bulk-receipt-pdf-export.worker';
import type { FinanceJobMessage } from './bulk-ops/jobs-dispatcher.service';
import type { RequestContext } from './common/entities/base.entity';

/**
 * Cost-redesign C3.7 — the SQS worker entry for the finance bulk jobs.
 *
 * One message = one job. The handler boots the finance module once per
 * execution environment (application context, no HTTP) and hands the job
 * to the same worker class the in-process path uses; the worker claims the
 * job (markRunning requires `queued`), takes the DynamoDB school lock and
 * carries its fence on every transition (C3.6).
 *
 * Redelivery is at-most-once for side-effecting jobs:
 *   - `queued`  → run it.
 *   - `running` and the school lock is held by this job and alive → a
 *     duplicate delivery while the first worker is still working: ack.
 *   - `running` and the lock is gone or expired → the worker died:
 *     markFailed('worker lost') and ack — it is not re-run, because the
 *     generate worker reserved a sequence range and cannot resume; the
 *     operator re-submits.
 *   - `succeeded` / `failed` / unknown job → ack.
 *   - the school is busy with another job → the message is reported as a
 *     batch item failure and comes back after the visibility timeout.
 */
type JobWorker = { run(jobId: string, input: never, context: RequestContext): Promise<unknown> };

export interface WorkerDeps {
  getApp: () => Promise<INestApplicationContext>;
  logger?: Logger;
  now?: () => number;
}

export const WORKERS: Record<string, abstract new (...args: never[]) => JobWorker> = {
  bulk_invoice_generate: BulkInvoiceGenerateWorker,
  bulk_invoice_pdf_export: BulkInvoicePdfExportWorker,
  bulk_receipt_pdf_export: BulkReceiptPdfExportWorker,
};

export type RecordOutcome = 'ran' | 'dropped-duplicate' | 'dropped-finished' | 'dropped-unknown' | 'worker-lost' | 'retry-busy';

export function createWorkerHandler(deps: WorkerDeps) {
  const logger = deps.logger ?? new Logger('worker');
  const now = deps.now ?? Date.now;

  async function processRecord(record: SQSRecord): Promise<RecordOutcome> {
    const msg = JSON.parse(record.body) as FinanceJobMessage;
    if (msg.version !== 1 || !msg.jobId || !msg.jobType) throw new Error(`malformed job message ${record.messageId}`);
    const worker = WORKERS[msg.jobType];
    if (!worker) {
      logger.error({ action: 'worker.unknown_job_type', jobType: msg.jobType, jobId: msg.jobId });
      return 'dropped-unknown';
    }
    const context: RequestContext = { ...msg.context, tenantId: msg.tenantId } as RequestContext;
    const app = await deps.getApp();
    const jobs = app.get(FinanceJobsService, { strict: false });
    const job = await jobs.get(msg.jobId, context);
    if (!job) {
      logger.warn({ action: 'worker.job_missing', jobId: msg.jobId });
      return 'dropped-unknown';
    }
    if (job.status === 'running') {
      const lock = app.get(DdbSchoolLock, { strict: false });
      const held = await lock.peek(msg.schoolId, context);
      if (held && held.owner === msg.jobId && held.expiresAt * 1000 > now()) {
        logger.log({ action: 'worker.duplicate_delivery', jobId: msg.jobId });
        return 'dropped-duplicate';
      }
      logger.warn({ action: 'worker.lost', jobId: msg.jobId, lockOwner: held?.owner ?? null });
      await jobs.markFailed(msg.jobId, 'worker lost: job was running but its school lock expired', context);
      return 'worker-lost';
    }
    if (job.status !== 'queued') {
      logger.log({ action: 'worker.already_finished', jobId: msg.jobId, status: job.status });
      return 'dropped-finished';
    }
    const started = now();
    try {
      await app.get(worker as never, { strict: false }).run(msg.jobId, msg.input as never, context);
    } catch (err) {
      if (err instanceof SchoolLockBusyError) {
        logger.warn({ action: 'worker.school_busy', jobId: msg.jobId, schoolId: msg.schoolId });
        return 'retry-busy';
      }
      throw err;
    }
    logger.log({ action: 'worker.ran', jobId: msg.jobId, jobType: msg.jobType, durationMs: now() - started });
    return 'ran';
  }

  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const batchItemFailures: SQSBatchItemFailure[] = [];
    for (const record of event.Records) {
      try {
        const outcome = await processRecord(record);
        if (outcome === 'retry-busy') batchItemFailures.push({ itemIdentifier: record.messageId });
      } catch (err) {
        // Anything thrown outside the worker class (a throttled or expired TVM
        // call, a malformed message, a bug) is reported as a failure: SQS
        // redelivers, and after maxReceiveCount the message reaches the DLQ,
        // whose alarm is the operator's signal. Acking here would lose the job
        // silently. A redelivery of a job that did start is dropped above.
        logger.error({ action: 'worker.record_error', messageId: record.messageId, error: err instanceof Error ? err.message : String(err) });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}

let cachedApp: Promise<INestApplicationContext> | undefined;
export async function getApplicationContext(): Promise<INestApplicationContext> {
  cachedApp ??= NestFactory.createApplicationContext(FinanceModule, { logger: ['error', 'warn', 'log'] });
  return cachedApp;
}

export const workerHandler = createWorkerHandler({ getApp: getApplicationContext });
