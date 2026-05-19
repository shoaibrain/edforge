/**
 * IEMIS Import Jobs Service
 *
 * Owns the lifecycle of `IemisImportJob` rows. The pattern:
 *   1. Controller calls `create()` → row written in `queued` state, jobId
 *      returned to the client (HTTP 202).
 *   2. `setImmediate(() => executeAsync(...))` in StudentsService picks up
 *      the work; before the first row it calls `markRunning()`.
 *   3. On completion (success OR uncaught error), exactly one of
 *      `markCompleted()` / `markFailed()` finalizes the row.
 *   4. Frontend polls `get()` until `status` is `succeeded` or `failed`.
 *
 * In-process async caveat: the worker runs in the same ECS task that handled
 * the POST. If that task is killed mid-import (deploy roll, OOM), the job
 * row stays `running` forever. A janitor cron is a post-pilot follow-up; at
 * pilot scale (≤1000 rows, ~30–60s) the overlap window is small enough.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { EntityKeyBuilder } from '../common/entities/base.entity';
import {
  IemisImportJob,
  IemisImportJobFinding,
  IemisImportJobDuplicate,
  createIemisImportJobEntity,
  capFindings,
  capDuplicates,
} from '../common/entities/iemis-import-job.entity';

@Injectable()
export class IemisImportJobsService {
  private readonly logger = new Logger(IemisImportJobsService.name);

  constructor(private readonly dynamoDBClient: DynamoDBClientService) {}

  /**
   * Create a new job row in the `queued` state and return the row.
   */
  async create(
    schoolId: string,
    totalRows: number,
    context: { tenantId: string; userId: string; jwtToken: string },
    enrollInAcademicYearId?: string,
  ): Promise<IemisImportJob> {
    const jobId = uuid();
    const job = createIemisImportJobEntity(
      context.tenantId,
      jobId,
      schoolId,
      totalRows,
      { userId: context.userId },
      enrollInAcademicYearId,
    );
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    await this.dynamoDBClient.putItem(client, job);
    this.logger.log(
      `IemisImportJob created jobId=${jobId} schoolId=${schoolId} totalRows=${totalRows} ` +
        `enrollInAcademicYearId=${enrollInAcademicYearId ?? 'none'}`,
    );
    return job;
  }

  async get(
    jobId: string,
    context: { tenantId: string; jwtToken: string },
  ): Promise<IemisImportJob> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const job = await this.dynamoDBClient.getItem<IemisImportJob>(
      client,
      context.tenantId,
      EntityKeyBuilder.iemisImportJob(jobId),
    );
    if (!job) {
      throw new NotFoundException(`IEMIS import job ${jobId} not found`);
    }
    return job;
  }

  async markRunning(
    jobId: string,
    context: { tenantId: string; userId: string; jwtToken: string },
  ): Promise<void> {
    const now = new Date().toISOString();
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    await this.dynamoDBClient.updateItem(
      client,
      context.tenantId,
      EntityKeyBuilder.iemisImportJob(jobId),
      'SET #status = :running, startedAt = :now, updatedAt = :now, updatedBy = :by ADD version :one',
      {
        ':running': 'running',
        ':now': now,
        ':by': context.userId,
        ':one': 1,
      },
      undefined,
      { '#status': 'status' },
    );
  }

  async markCompleted(
    jobId: string,
    result: {
      studentsCreated: number;
      studentsEnrolled: number;
      failed: number;
      skipped: number;
      findings: IemisImportJobFinding[];
      duplicates: IemisImportJobDuplicate[];
      durationMs: number;
    },
    context: { tenantId: string; userId: string; jwtToken: string },
  ): Promise<void> {
    const now = new Date().toISOString();
    const { findings, truncated: findingsTruncated } = capFindings(result.findings);
    const { duplicates, truncated: duplicatesTruncated } = capDuplicates(result.duplicates);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    await this.dynamoDBClient.updateItem(
      client,
      context.tenantId,
      EntityKeyBuilder.iemisImportJob(jobId),
      'SET #status = :status, studentsCreated = :sc, studentsEnrolled = :se, failed = :f, skipped = :sk, ' +
        'findings = :fnd, findingsTruncated = :ft, duplicates = :dup, duplicatesTruncated = :dt, ' +
        'completedAt = :now, durationMs = :dur, updatedAt = :now, updatedBy = :by ADD version :one',
      {
        ':status': 'succeeded',
        ':sc': result.studentsCreated,
        ':se': result.studentsEnrolled,
        ':f': result.failed,
        ':sk': result.skipped,
        ':fnd': findings,
        ':ft': findingsTruncated,
        ':dup': duplicates,
        ':dt': duplicatesTruncated,
        ':now': now,
        ':dur': result.durationMs,
        ':by': context.userId,
        ':one': 1,
      },
      undefined,
      { '#status': 'status' },
    );
    this.logger.log(
      `IemisImportJob succeeded jobId=${jobId} created=${result.studentsCreated} ` +
        `enrolled=${result.studentsEnrolled} failed=${result.failed} skipped=${result.skipped} ` +
        `durationMs=${result.durationMs} findingsTruncated=${findingsTruncated}`,
    );
  }

  async markFailed(
    jobId: string,
    error: string,
    partial: {
      studentsCreated: number;
      studentsEnrolled: number;
      failed: number;
      skipped: number;
      findings: IemisImportJobFinding[];
      duplicates: IemisImportJobDuplicate[];
      durationMs: number;
    },
    context: { tenantId: string; userId: string; jwtToken: string },
  ): Promise<void> {
    const now = new Date().toISOString();
    const { findings, truncated: findingsTruncated } = capFindings(partial.findings);
    const { duplicates, truncated: duplicatesTruncated } = capDuplicates(partial.duplicates);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    await this.dynamoDBClient.updateItem(
      client,
      context.tenantId,
      EntityKeyBuilder.iemisImportJob(jobId),
      'SET #status = :status, studentsCreated = :sc, studentsEnrolled = :se, failed = :f, skipped = :sk, ' +
        'findings = :fnd, findingsTruncated = :ft, duplicates = :dup, duplicatesTruncated = :dt, ' +
        'completedAt = :now, durationMs = :dur, #err = :err, updatedAt = :now, updatedBy = :by ADD version :one',
      {
        ':status': 'failed',
        ':sc': partial.studentsCreated,
        ':se': partial.studentsEnrolled,
        ':f': partial.failed,
        ':sk': partial.skipped,
        ':fnd': findings,
        ':ft': findingsTruncated,
        ':dup': duplicates,
        ':dt': duplicatesTruncated,
        ':now': now,
        ':dur': partial.durationMs,
        ':err': error.slice(0, 500),
        ':by': context.userId,
        ':one': 1,
      },
      undefined,
      { '#status': 'status', '#err': 'error' },
    );
    this.logger.error(
      `IemisImportJob failed jobId=${jobId} error="${error.slice(0, 200)}" ` +
        `partial=created:${partial.studentsCreated},enrolled:${partial.studentsEnrolled},failed:${partial.failed},skipped:${partial.skipped}`,
    );
  }

  /**
   * List IEMIS import jobs for a school, sorted by createdAt descending
   * (most recent first). Sprint D0a.1 — operator visibility into historical
   * uploads.
   *
   * Access pattern: the entity has no GSI; we query the tenant partition with
   * `begins_with(entityKey, 'IEMIS_JOB#')` and filter by schoolId server-side.
   * Sort + cursor pagination happen in memory because UUID-keyed jobIds yield
   * a random SK order from DDB. At pilot scale (≤ a few hundred jobs per
   * tenant) this is fine; a GSI keyed by (schoolId, createdAt) is the
   * next-scale upgrade and is deliberately deferred.
   *
   * Cursor = base64(offset). Default limit 50, hard cap 200.
   */
  async list(
    schoolId: string,
    opts: { since?: string; limit?: number; cursor?: string },
    context: { tenantId: string; jwtToken: string },
  ): Promise<{ items: IemisImportJob[]; nextCursor?: string }> {
    const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = opts.cursor ? decodeCursor(opts.cursor) : 0;

    const filterParts = ['schoolId = :schoolId'];
    const attrValues: Record<string, any> = { ':schoolId': schoolId };
    if (opts.since) {
      filterParts.push('createdAt >= :since');
      attrValues[':since'] = opts.since;
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const result = await this.dynamoDBClient.query<IemisImportJob>(
      client,
      context.tenantId,
      'IEMIS_JOB#',
      filterParts.join(' AND '),
      attrValues,
      undefined,
      undefined,
    );

    const sorted = [...result.items].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    const page = sorted.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    const nextCursor =
      nextOffset < sorted.length ? encodeCursor(nextOffset) : undefined;

    this.logger.log(
      `IemisImportJobs.list schoolId=${schoolId} since=${opts.since ?? 'none'} ` +
        `totalMatching=${sorted.length} offset=${offset} returned=${page.length} ` +
        `nextCursor=${nextCursor ?? 'none'}`,
    );

    return { items: page, nextCursor };
  }
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64');
}

function decodeCursor(cursor: string): number {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
    const n = parseInt(decoded, 10);
    if (Number.isNaN(n) || n < 0) return 0;
    return n;
  } catch {
    return 0;
  }
}
