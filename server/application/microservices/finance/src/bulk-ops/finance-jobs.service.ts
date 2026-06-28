/**
 * FinanceJobsService — Sprint D.2
 *
 * Owns the lifecycle of FinanceJob rows. Mirrors the SHAPE of
 * `IemisImportJobsService` but adds the concurrency-control envelope the
 * finance plan calls out: every state-transition UpdateItem carries a
 * `ConditionExpression` that pins both the expected current status AND
 * the expected current version. This is what keeps a future worker
 * (Sprint E) + the future janitor (Sprint I) from trampling each other
 * on the same job row.
 *
 * Lifecycle invariants:
 *   - `create()`            writes a fresh row with `status='queued'`,
 *                           `version=1`. Idempotent at the controller
 *                           layer via the existing IdempotencyKey
 *                           interceptor (Sprint 0.2).
 *   - `markRunning()`       requires `status='queued'`. Sets startedAt.
 *   - `markCompleted()`     requires `status='running'`. Sets completedAt,
 *                           output, and any final counter snapshot.
 *   - `markFailed()`        accepts `status IN ('queued','running')` —
 *                           a job can fail before the worker ever picked
 *                           it up (e.g. queue-time validation).
 *   - `appendFailedStudent` is the per-iteration call from the worker
 *                           that records a single failed student and
 *                           increments counters atomically.
 *   - `incrementCounter`    same shape for `processed`/`succeeded`/
 *                           `skipped` (the worker will batch these every
 *                           ~25 iterations to keep DDB write costs sane).
 *
 * Cross-school read enforcement:
 *   `get(jobId, context)` returns `null` (not throw) when the row is
 *   missing OR when `context.schoolId` is set and doesn't match the
 *   row's `schoolId`. The controller layer (Sprint D.3) translates that
 *   `null` to a 404 — same body for missing-vs-cross-school so jobIds
 *   are not enumerable across schools (the 404-not-403 contract).
 *
 *   Note: when `context.schoolId` is undefined (e.g. a TenantAdmin
 *   polling without scope), the get returns the row unfiltered — the
 *   controller's scope check (`operatorHasScope`) is the authoritative
 *   gate. The service-side check is defense-in-depth for callers that
 *   DID pass a schoolId scope (e.g. school-scoped operators).
 *
 * Audit emission:
 *   `markRunning`, `markCompleted`, `markFailed` each emit a sibling
 *   `FinanceAuditEvent` via `FinanceAuditService.emit()`. Best-effort —
 *   the audit service itself swallows + warning-logs failures so an
 *   audit-table outage cannot brick the job pipeline.
 */

import {
  Injectable,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { FinanceAuditService } from '../common/services/finance-audit.service';
import {
  EntityKeyBuilder,
  RequestContext,
} from '../common/entities/base.entity';
import {
  FinanceJobEntity,
  FinanceJobType,
  FinanceJobOutput,
  FinanceJobOutputFormat,
  createFinanceJobEntity,
  capErrors,
  capFailedStudents,
} from '../common/entities/finance-job.entity';

type CounterField = 'processed' | 'succeeded' | 'skipped';

@Injectable()
export class FinanceJobsService {
  private readonly logger = new Logger(FinanceJobsService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly financeAuditService: FinanceAuditService,
  ) {}

  /**
   * Create a new job row in the `queued` state. Returns the row as
   * stored.
   *
   * Caller (controller in Sprint E/F/G) is expected to:
   *   (a) resolve the work-unit count BEFORE calling create() (so
   *       `requested` reflects the real workload),
   *   (b) generate the jobId (so it can return 202 + jobId synchronously
   *       and hand off to setImmediate for the worker).
   *
   * `idempotencyKey` is optional and stored on the row purely for
   * forensic correlation — the actual idempotent-replay gate is the
   * IdempotencyKey table managed by the global interceptor.
   */
  async create(
    input: {
      schoolId: string;
      operatorId: string;
      jobType: FinanceJobType;
      requested: number;
      outputFormat?: FinanceJobOutputFormat | null;
      idempotencyKey?: string;
    },
    context: RequestContext,
  ): Promise<FinanceJobEntity> {
    const jobId = uuid();
    const job = createFinanceJobEntity(context.tenantId, jobId, input);
    const client = await this.dynamoDBClient.getClient(
      context.tenantId,
      context.jwtToken,
    );
    // `attribute_not_exists(entityKey)` defends against the (astronomically
    // unlikely) UUID collision; cheap insurance on a one-time-per-job
    // putItem.
    await this.dynamoDBClient.putItem(
      client,
      job,
      'attribute_not_exists(entityKey)',
    );
    this.logger.log(
      `FinanceJob created jobId=${jobId} jobType=${input.jobType} schoolId=${input.schoolId} requested=${input.requested}`,
    );
    return job;
  }

  /**
   * Fetch a job by id. Returns `null` for missing OR cross-school
   * (when `context.schoolId` is set and does not match the row).
   *
   * The 404-not-403 contract lives in the controller; this service
   * just returns `null` and lets the controller translate.
   */
  async get(
    jobId: string,
    context: RequestContext,
  ): Promise<FinanceJobEntity | null> {
    const client = await this.dynamoDBClient.getClient(
      context.tenantId,
      context.jwtToken,
    );
    const row = await this.dynamoDBClient.getItem<FinanceJobEntity>(
      client,
      context.tenantId,
      EntityKeyBuilder.financeJob(jobId),
    );
    if (!row) return null;
    if (context.schoolId && row.schoolId !== context.schoolId) {
      // Defense-in-depth — the controller is the authoritative
      // cross-school gate; this catches the case where a school-scoped
      // operator's context carries schoolId AND the loaded row belongs
      // to a different school.
      return null;
    }
    return row;
  }

  /**
   * Transition `queued → running`. Conditional on the current state +
   * version so the future janitor (Sprint I) cannot mark-running a job
   * the worker has already finalized.
   */
  async markRunning(
    jobId: string,
    context: RequestContext,
  ): Promise<void> {
    const now = new Date().toISOString();
    const client = await this.dynamoDBClient.getClient(
      context.tenantId,
      context.jwtToken,
    );
    try {
      const updated = await this.dynamoDBClient.updateItem<FinanceJobEntity>(
        client,
        context.tenantId,
        EntityKeyBuilder.financeJob(jobId),
        'SET #status = :running, startedAt = :now, updatedAt = :now, updatedBy = :by ADD version :one',
        {
          ':running': 'running',
          ':queued': 'queued',
          ':now': now,
          ':by': context.userId,
          ':one': 1,
        },
        '#status = :queued',
        { '#status': 'status' },
      );
      await this.emitAudit('finance.bulk_export.started', updated, context);
      this.logger.log(`FinanceJob markRunning jobId=${jobId} v=${updated.version}`);
    } catch (err) {
      // `DynamoDBClientService.updateItem` translates
      // `ConditionalCheckFailedException` to `ConflictException` — that's
      // the right signal up the stack (worker should re-fetch and decide).
      if (err instanceof ConflictException) {
        this.logger.warn(
          `FinanceJob markRunning race jobId=${jobId} — row no longer in 'queued' state`,
        );
      }
      throw err;
    }
  }

  /**
   * Transition `running → succeeded`. Sets completedAt + output (zipKey /
   * mergedPdfKey + presigned URLs) and an optional final counter
   * snapshot.
   *
   * Conditional on `status='running'` — protects against the worker
   * double-completing if invoked twice (e.g. an in-process retry that
   * survived a transient error).
   */
  async markCompleted(
    jobId: string,
    completion: {
      output?: FinanceJobOutput;
      counters?: {
        processed?: number;
        succeeded?: number;
        failed?: number;
        skipped?: number;
      };
    },
    context: RequestContext,
  ): Promise<void> {
    const now = new Date().toISOString();
    const client = await this.dynamoDBClient.getClient(
      context.tenantId,
      context.jwtToken,
    );
    // Build a dynamic UpdateExpression so we only touch the counter
    // sub-fields that were actually supplied. DDB doesn't merge nested
    // maps for us — we have to address each path explicitly.
    const setParts: string[] = [
      '#status = :succeeded',
      'completedAt = :now',
      'updatedAt = :now',
      'updatedBy = :by',
    ];
    const attrValues: Record<string, unknown> = {
      ':succeeded': 'succeeded',
      ':running': 'running',
      ':now': now,
      ':by': context.userId,
      ':one': 1,
    };
    const attrNames: Record<string, string> = { '#status': 'status' };

    if (completion.output) {
      setParts.push('#output = :output');
      attrValues[':output'] = completion.output;
      attrNames['#output'] = 'output';
    }
    if (completion.counters) {
      if (completion.counters.processed !== undefined) {
        setParts.push('counters.processed = :cProcessed');
        attrValues[':cProcessed'] = completion.counters.processed;
      }
      if (completion.counters.succeeded !== undefined) {
        setParts.push('counters.succeeded = :cSucceeded');
        attrValues[':cSucceeded'] = completion.counters.succeeded;
      }
      if (completion.counters.failed !== undefined) {
        setParts.push('counters.failed = :cFailed');
        attrValues[':cFailed'] = completion.counters.failed;
      }
      if (completion.counters.skipped !== undefined) {
        setParts.push('counters.skipped = :cSkipped');
        attrValues[':cSkipped'] = completion.counters.skipped;
      }
    }

    const updated = await this.dynamoDBClient.updateItem<FinanceJobEntity>(
      client,
      context.tenantId,
      EntityKeyBuilder.financeJob(jobId),
      `SET ${setParts.join(', ')} ADD version :one`,
      attrValues,
      '#status = :running',
      attrNames,
    );
    await this.emitAudit('finance.bulk_export.succeeded', updated, context);
    this.logger.log(
      `FinanceJob markCompleted jobId=${jobId} v=${updated.version} ` +
        `succeeded=${updated.counters.succeeded} failed=${updated.counters.failed} skipped=${updated.counters.skipped}`,
    );
  }

  /**
   * Transition (`queued` | `running`) → `failed`. Appends `reason` to
   * the capped `errors[]` array. The two acceptable predecessor states
   * cover both queue-time validation failures (job never ran) and
   * mid-run worker failures.
   *
   * Conditional on the predecessor — protects against finalize-twice.
   * If the row has already terminalized (status='succeeded'/'failed'),
   * the conditional check fails and we surface the ConflictException
   * up to the caller for diagnostic purposes.
   */
  async markFailed(
    jobId: string,
    reason: string,
    context: RequestContext,
  ): Promise<void> {
    const now = new Date().toISOString();
    const client = await this.dynamoDBClient.getClient(
      context.tenantId,
      context.jwtToken,
    );
    // Append-to-cap is read-modify-write — fetch first, append, then
    // UpdateItem with the new array + version guard. This trades one
    // extra GetItem for atomic append semantics on a capped array,
    // which a pure DDB `list_append` cannot bound.
    const current = await this.dynamoDBClient.getItem<FinanceJobEntity>(
      client,
      context.tenantId,
      EntityKeyBuilder.financeJob(jobId),
    );
    if (!current) {
      this.logger.warn(`FinanceJob markFailed jobId=${jobId} — row not found`);
      throw new ConflictException(`FinanceJob ${jobId} not found`);
    }
    const newErrors = capErrors(current.errors, { at: now, message: reason });

    const updated = await this.dynamoDBClient.updateItem<FinanceJobEntity>(
      client,
      context.tenantId,
      EntityKeyBuilder.financeJob(jobId),
      'SET #status = :failed, completedAt = :now, errors = :errors, updatedAt = :now, updatedBy = :by ADD version :one',
      {
        ':failed': 'failed',
        ':queued': 'queued',
        ':running': 'running',
        ':now': now,
        ':by': context.userId,
        ':errors': newErrors,
        ':expectedVersion': current.version,
        ':one': 1,
      },
      '(#status = :queued OR #status = :running) AND version = :expectedVersion',
      { '#status': 'status' },
    );
    await this.emitAudit('finance.bulk_export.failed', updated, context);
    this.logger.error(
      `FinanceJob markFailed jobId=${jobId} v=${updated.version} reason="${reason.slice(0, 200)}"`,
    );
  }

  /**
   * Per-iteration helper for the worker: record one failed student and
   * bump the `failed` counter atomically. Cap behavior delegated to
   * `capFailedStudents` so we keep the most-recent 500 deduped IDs.
   *
   * Uses read-modify-write (same rationale as `markFailed`) so the
   * cap + dedupe semantics hold across concurrent worker iterations.
   * Version-guarded so two concurrent workers hitting the same row
   * (cross-task replay scenario, defense-in-depth) cannot both succeed
   * — the loser sees ConflictException and the caller retries.
   */
  async appendFailedStudent(
    jobId: string,
    studentId: string,
    errorMessage: string,
    context: RequestContext,
  ): Promise<void> {
    const now = new Date().toISOString();
    const client = await this.dynamoDBClient.getClient(
      context.tenantId,
      context.jwtToken,
    );
    const current = await this.dynamoDBClient.getItem<FinanceJobEntity>(
      client,
      context.tenantId,
      EntityKeyBuilder.financeJob(jobId),
    );
    if (!current) {
      throw new ConflictException(`FinanceJob ${jobId} not found`);
    }
    const newFailedIds = capFailedStudents(current.failedStudentIds, [studentId]);
    const newErrors = capErrors(current.errors, {
      at: now,
      message: `studentId=${studentId}: ${errorMessage}`,
    });

    await this.dynamoDBClient.updateItem<FinanceJobEntity>(
      client,
      context.tenantId,
      EntityKeyBuilder.financeJob(jobId),
      'SET failedStudentIds = :ids, errors = :errors, counters.failed = counters.failed + :one, counters.processed = counters.processed + :one, updatedAt = :now, updatedBy = :by ADD version :one',
      {
        ':ids': newFailedIds,
        ':errors': newErrors,
        ':one': 1,
        ':now': now,
        ':by': context.userId,
        ':expectedVersion': current.version,
      },
      'version = :expectedVersion',
    );
  }

  /**
   * Atomic counter increment for `processed` / `succeeded` / `skipped`
   * (not `failed` — that goes via `appendFailedStudent` which also tracks
   * the studentId + error message). `delta` may be > 1 so the worker
   * can batch updates every ~25 iterations.
   *
   * Uses DDB's `ADD` on a nested path — no read-modify-write needed
   * because the operation is commutative.
   */
  async incrementCounter(
    jobId: string,
    counterName: CounterField,
    delta: number,
    context: RequestContext,
  ): Promise<void> {
    if (delta <= 0) return;
    const now = new Date().toISOString();
    const client = await this.dynamoDBClient.getClient(
      context.tenantId,
      context.jwtToken,
    );
    // ADD on a nested map path increments in place; no version guard
    // because counter increments are commutative (a + b = b + a). The
    // worker SHOULD only bump the counter for work it actually did, so
    // double-incrementing is the worker's own bug to avoid, not a
    // concurrency primitive concern.
    await this.dynamoDBClient.updateItem<FinanceJobEntity>(
      client,
      context.tenantId,
      EntityKeyBuilder.financeJob(jobId),
      `SET updatedAt = :now, updatedBy = :by ADD counters.#c :delta, version :one`,
      {
        ':delta': delta,
        ':now': now,
        ':by': context.userId,
        ':one': 1,
      },
      undefined,
      { '#c': counterName },
    );
  }

  /**
   * List FinanceJob rows for a school, sorted by createdAt descending.
   *
   * No GSI in V1 — same shape as `IemisImportJobsService.list`. The
   * tenant partition is queried with
   * `begins_with(entityKey, 'FINANCE_JOB#')` + a schoolId
   * FilterExpression; sort + cursor pagination happens in memory because
   * UUID-keyed jobIds yield random SK order from DDB.
   *
   * Pilot scale (a few hundred jobs per tenant) keeps this cheap; a GSI
   * keyed by (schoolId, createdAt) is the next-scale upgrade.
   *
   * `since` is an ISO-8601 lower bound on `createdAt` — useful for
   * "show me jobs since I last looked" polling without re-scanning the
   * entire history each time.
   */
  async list(
    schoolId: string,
    context: RequestContext,
    opts: { limit?: number; cursor?: string; since?: string } = {},
  ): Promise<{ items: FinanceJobEntity[]; nextCursor?: string }> {
    const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = opts.cursor ? decodeOffsetCursor(opts.cursor) : 0;

    const filterParts = ['schoolId = :schoolId'];
    const attrValues: Record<string, unknown> = { ':schoolId': schoolId };
    if (opts.since) {
      filterParts.push('createdAt >= :since');
      attrValues[':since'] = opts.since;
    }

    const client = await this.dynamoDBClient.getClient(
      context.tenantId,
      context.jwtToken,
    );
    const result = await this.dynamoDBClient.query<FinanceJobEntity>(
      client,
      context.tenantId,
      'FINANCE_JOB#',
      filterParts.join(' AND '),
      attrValues,
    );

    const sorted = [...result.items].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    const page = sorted.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    const nextCursor =
      nextOffset < sorted.length ? encodeOffsetCursor(nextOffset) : undefined;

    this.logger.log(
      `FinanceJobs.list schoolId=${schoolId} since=${opts.since ?? 'none'} ` +
        `totalMatching=${sorted.length} offset=${offset} returned=${page.length}`,
    );

    return { items: page, nextCursor };
  }

  /**
   * Map a lifecycle-transition `markX` call to the corresponding
   * `FinanceAuditService` emit. Swallows audit-write errors at this
   * layer too (defense-in-depth on top of the service's own swallow)
   * so an audit-table outage cannot brick a job transition.
   *
   * Event types reuse the existing `finance.bulk_export.*` namespace
   * from Sprint 0.3 — see the file-level comment on
   * `finance-audit-event.entity.ts` for the rationale on the
   * `AUDIT#FINANCE_BULK#` SK prefix being a legacy name that covers
   * all finance audit events.
   */
  private async emitAudit(
    eventType:
      | 'finance.bulk_export.started'
      | 'finance.bulk_export.succeeded'
      | 'finance.bulk_export.failed',
    job: FinanceJobEntity,
    context: RequestContext,
  ): Promise<void> {
    try {
      await this.financeAuditService.emit(
        eventType,
        {
          schoolId: job.schoolId,
          jobId: job.jobId,
          documentCount: job.counters.requested,
          format: job.outputFormat ?? undefined,
          metadata: { jobType: job.jobType },
        },
        context,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `FinanceJobsService.emitAudit failed for ${eventType} jobId=${job.jobId}: ${message.slice(0, 200)}`,
      );
    }
  }
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function encodeOffsetCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64');
}

function decodeOffsetCursor(cursor: string): number {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
    const n = parseInt(decoded, 10);
    if (Number.isNaN(n) || n < 0) return 0;
    return n;
  } catch {
    return 0;
  }
}
