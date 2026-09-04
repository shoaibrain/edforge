import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { AcademicsModule } from './academics.module';
import { StudentsService } from './students/students.service';
import { IemisImportJobsService } from './students/iemis-import-jobs.service';
import { IemisImportStagingService } from './students/iemis-import-staging.service';
import type { IemisImportJobMessage } from './students/academics-jobs-dispatcher.service';
import type { RequestContext } from './common/entities/base.entity';

/**
 * Cost-redesign C3.11 — the SQS worker entry for the IEMIS import.
 * `queued` → load the staged rows, run executeIemisImportAsync (which
 * claims the job with a `queued`-only markRunning), delete the staged
 * rows. `running` → a duplicate delivery; drop it (the IEMIS janitor marks
 * stale runs failed after 30 min). Finished or unknown → drop.
 *
 * After the import returns the job is read back; a job still `queued` or
 * `running` means its final write failed, and the invocation ends with
 * `JobOutcomeError` so the functions-errors alarm fires (not a batch item
 * failure: the redelivery is dropped above, and the alarm budget has no slot
 * for a job-failure metric).
 */
export interface WorkerDeps { getApp: () => Promise<INestApplicationContext>; logger?: Logger }
export type RecordOutcome = 'ran' | 'dropped-duplicate' | 'dropped-finished' | 'dropped-unknown';

export class JobOutcomeError extends Error {}

export function createWorkerHandler(deps: WorkerDeps) {
  const logger = deps.logger ?? new Logger('worker');

  async function processRecord(record: SQSRecord): Promise<RecordOutcome> {
    const msg = JSON.parse(record.body) as IemisImportJobMessage;
    if (msg.version !== 1 || msg.jobType !== 'iemis_import' || !msg.jobId || !msg.stagingKey) throw new Error(`malformed job message ${record.messageId}`);
    const context: RequestContext = { ...msg.context, tenantId: msg.tenantId } as RequestContext;
    const app = await deps.getApp();
    const jobs = app.get(IemisImportJobsService, { strict: false });
    const job = await jobs.get(msg.jobId, context);
    if (!job) { logger.warn({ action: 'worker.job_missing', jobId: msg.jobId }); return 'dropped-unknown'; }
    if (job.status === 'running') { logger.log({ action: 'worker.duplicate_delivery', jobId: msg.jobId }); return 'dropped-duplicate'; }
    if (job.status !== 'queued') { logger.log({ action: 'worker.already_finished', jobId: msg.jobId, status: job.status }); return 'dropped-finished'; }
    const staging = app.get(IemisImportStagingService, { strict: false });
    const rows = await staging.get(msg.stagingKey, context);
    const started = Date.now();
    await app.get(StudentsService, { strict: false }).executeIemisImportAsync(msg.jobId, rows, msg.schoolId, context, msg.enrollInAcademicYearId);
    await staging.delete(msg.stagingKey, context);
    logger.log({ action: 'worker.ran', jobId: msg.jobId, rows: rows.length, durationMs: Date.now() - started });
    const after = await jobs.get(msg.jobId, context);
    if (after && (after.status === 'queued' || after.status === 'running')) {
      throw new JobOutcomeError(`job ${msg.jobId} (iemis_import) is still '${after.status}' after the import returned`);
    }
    return 'ran';
  }

  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const batchItemFailures: SQSBatchItemFailure[] = [];
    for (const record of event.Records) {
      try {
        await processRecord(record);
      } catch (err) {
        if (err instanceof JobOutcomeError) {
          logger.error({ action: 'worker.job_outcome', messageId: record.messageId, error: err.message });
          throw err;
        }
        // Reported as a failure so SQS redelivers and, after maxReceiveCount,
        // the DLQ alarm fires; acking would lose the job silently. A
        // redelivery of a job that did start is dropped above.
        logger.error({ action: 'worker.record_error', messageId: record.messageId, error: err instanceof Error ? err.message : String(err) });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}

let cachedApp: Promise<INestApplicationContext> | undefined;
export async function getApplicationContext(): Promise<INestApplicationContext> {
  cachedApp ??= NestFactory.createApplicationContext(AcademicsModule, { logger: ['error', 'warn', 'log'] });
  return cachedApp;
}

export const workerHandler = createWorkerHandler({ getApp: getApplicationContext });
