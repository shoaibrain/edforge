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
import { TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { FinanceAuditService } from '../common/services/finance-audit.service';
import { retryWithJitter, isConflictException } from './util/retry-with-jitter';
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
import { ActiveExportAlreadyRunningError } from './active-export-already-running.error';

/**
 * Sprint §5d MVP.5 — active-export sentinel row schema.
 * One row per school (jobType-agnostic). PK=tenantId, SK=FINANCE_ACTIVE_EXPORT#{schoolId}.
 * Created atomically with the FinanceJob on bulk-export submission;
 * cleaned up best-effort on markCompleted/markFailed/sweep.
 *
 * CRITICAL — TTL attribute name: the DDB table TTL attribute is `ttl`
 * (server/lib/tenant-template/ecs-dynamodb.ts:40). DDB only auto-expires
 * items via the EXACT attribute name configured on the table; any other
 * field is just data and items live forever. So the field MUST be
 * `ttl` (NOT `expireAt`, `expiresAt`, etc.).
 *
 * PR #358 P1 fix-up (2026-06-30): the original draft used `expireAt`
 * which would have silently disabled the 4h backstop — orphaned
 * sentinels would block the school indefinitely until manual cleanup.
 * Renamed to `ttl` and pinned by spec assertion in
 * finance-jobs.service.spec.ts (look for "uses 'ttl' as the TTL field").
 */
interface FinanceActiveExportSentinel {
  tenantId: string;
  entityKey: string;
  entityType: 'FINANCE_ACTIVE_EXPORT';
  schoolId: string;
  jobId: string;
  jobType: FinanceJobType;
  startedAt: string;
  /** DDB TTL attribute (MUST be named `ttl` to match ecs-dynamodb.ts:40). Epoch SECONDS, not millis. DDB TTL fires within 48h. */
  ttl: number;
}

/** 4h sentinel TTL — backstop only; primary cleanup is the completion-path DELETE. */
const SENTINEL_TTL_HOURS = 4;

/**
 * Sprint §5d MVP.5 — which job types share the active-export sentinel.
 * Bulk-invoice-generate is NOT an export; it has its own E.4 PerSchoolLock.
 */
function isExportJobType(jobType: FinanceJobType): boolean {
  return jobType === 'bulk_invoice_pdf_export' || jobType === 'bulk_receipt_pdf_export';
}

type CounterField = 'succeeded' | 'skipped';
type LifecycleState = 'started' | 'succeeded' | 'failed';

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
    options?: {
      /**
       * Sprint §5d MVP.5 — when set, the create() PUT is wrapped in a
       * TransactWriteItems with a sentinel-row PUT. The sentinel carries
       * `ConditionExpression: attribute_not_exists(entityKey)` so a
       * second submission for the same school fails atomically: the
       * sentinel PUT's condition rolls back the entire transaction,
       * the FinanceJob row never gets written, and the caller sees
       * `ActiveExportAlreadyRunningError` with the existing jobId.
       *
       * Pass for bulk-export jobs (F.4 controller). Omit for
       * bulk-invoice-generate (E.4 worker uses its own in-memory
       * PerSchoolLock — different concurrency class).
       *
       * The sentinel is jobType-agnostic per D1+D8: one sentinel per
       * school blocks ANY export type (PDF + receipt share the sentinel).
       */
      singleActiveExportGuard?: { schoolId: string; jobType: FinanceJobType };
    },
  ): Promise<FinanceJobEntity> {
    const jobId = uuid();
    const job = createFinanceJobEntity(context.tenantId, jobId, input);
    const client = await this.dynamoDBClient.getClient(
      context.tenantId,
      context.jwtToken,
    );

    if (options?.singleActiveExportGuard) {
      // Atomic TransactWriteItems: FinanceJob PUT + sentinel PUT-with-condition.
      // If the sentinel PUT's `attribute_not_exists` condition fails, the
      // ENTIRE transaction rolls back — no orphan FinanceJob row.
      const sentinel = this.buildSentinelRow(
        context.tenantId,
        options.singleActiveExportGuard.schoolId,
        jobId,
        options.singleActiveExportGuard.jobType,
        job.createdAt,
      );
      const transactItems: TransactWriteCommandInput['TransactItems'] = [
        {
          Put: {
            TableName: this.dynamoDBClient.getTableName(),
            Item: job,
            ConditionExpression: 'attribute_not_exists(entityKey)',
          },
        },
        {
          Put: {
            TableName: this.dynamoDBClient.getTableName(),
            Item: sentinel,
            ConditionExpression: 'attribute_not_exists(entityKey)',
          },
        },
      ];
      try {
        await this.dynamoDBClient.transactWrite(client, transactItems);
      } catch (err) {
        // Reason-aware classification (per MVP.5 risk #2): only translate
        // to ActiveExportAlreadyRunningError when the CANCELED reason is
        // specifically the sentinel-row's ConditionalCheckFailed. DDB
        // throttling / item-too-large / etc. re-throw as-is so they
        // surface the real cause to the operator.
        const sentinelConflict = await this.classifyAndResolveSentinelConflict(
          err,
          client,
          context.tenantId,
          options.singleActiveExportGuard.schoolId,
          options.singleActiveExportGuard.jobType,
        );
        if (sentinelConflict) throw sentinelConflict;
        throw err;
      }
    } else {
      // Backward-compat path (bulk-invoice-generate flow): single PutCommand
      // with the UUID-collision defense. Behavior unchanged from D.2.
      await this.dynamoDBClient.putItem(
        client,
        job,
        'attribute_not_exists(entityKey)',
      );
    }

    this.logger.log(
      `FinanceJob created jobId=${jobId} jobType=${input.jobType} schoolId=${input.schoolId} requested=${input.requested}` +
        (options?.singleActiveExportGuard ? ' [active-export-guard]' : ''),
    );
    return job;
  }

  /**
   * Sprint §5d MVP.5 — build the active-export sentinel row.
   * Pure function; no I/O. TTL is `startedAt + 4h` in epoch SECONDS
   * (DDB TTL requires seconds, not milliseconds).
   */
  private buildSentinelRow(
    tenantId: string,
    schoolId: string,
    jobId: string,
    jobType: FinanceJobType,
    startedAt: string,
  ): FinanceActiveExportSentinel {
    const startedAtMs = Date.parse(startedAt);
    const ttlSec = Math.floor(startedAtMs / 1000) + SENTINEL_TTL_HOURS * 3600;
    return {
      tenantId,
      entityKey: EntityKeyBuilder.financeActiveExport(schoolId),
      entityType: 'FINANCE_ACTIVE_EXPORT',
      schoolId,
      jobId,
      jobType,
      startedAt,
      // MUST be `ttl` (matches table config in ecs-dynamodb.ts:40). PR #358 P1 fix.
      ttl: ttlSec,
    };
  }

  /**
   * Sprint §5d MVP.5 — best-effort sentinel DELETE. Used by
   * markCompleted, markFailed, and (via the spec invariant)
   * StaleFinanceJobSweeper. Never throws — failures here block FUTURE
   * submissions (until the TTL backstop clears the sentinel ~4h later),
   * which is preferable to throwing inside a completion path where the
   * job state has already transitioned correctly.
   */
  async deleteActiveExportSentinel(
    tenantId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<void> {
    try {
      const client = await this.dynamoDBClient.getClient(
        tenantId,
        context.jwtToken,
      );
      // dynamoDBClient.deleteItem is the canonical wrapper around DeleteCommand;
      // delete-on-non-existent is idempotent in DDB (returns 200), so this is
      // safe even for jobs that didn't create a sentinel (pre-MVP.5, or
      // bulk_invoice_generate which doesn't use the guard).
      await this.dynamoDBClient.deleteItem(
        client,
        tenantId,
        EntityKeyBuilder.financeActiveExport(schoolId),
      );
    } catch (err) {
      // Log but swallow — see method-doc rationale.
      this.logger.warn(
        `Active-export sentinel DELETE failed (best-effort) ` +
          `tenant=${tenantId} schoolId=${schoolId}: ${(err as Error).message}. ` +
          `Sentinel TTL (4h) will clear it.`,
      );
    }
  }

  /**
   * Sprint §5d MVP.5 risk #2 — classify a TransactWriteItems error.
   * Returns `ActiveExportAlreadyRunningError` when (and only when) the
   * second item (the sentinel) failed with `ConditionalCheckFailed`.
   * For any other CancellationReason (throttle, item-too-large,
   * sentinel-row-too-large, etc.), returns null and the caller re-throws.
   *
   * When it IS a sentinel conflict, ALSO does a best-effort GetItem on
   * the existing sentinel to populate the `runningJobId` in the thrown
   * error — gives F.4's 409 body a usable pointer for the operator.
   * If the GetItem fails, falls back to throwing without runningJobId.
   */
  private async classifyAndResolveSentinelConflict(
    err: unknown,
    client: any,
    tenantId: string,
    schoolId: string,
    jobType: FinanceJobType,
  ): Promise<ActiveExportAlreadyRunningError | null> {
    const e = err as {
      name?: string;
      CancellationReasons?: Array<{ Code?: string }>;
    };
    if (e.name !== 'TransactionCanceledException') return null;
    const reasons = e.CancellationReasons ?? [];
    // Item index 1 is the sentinel PUT (item 0 is the FinanceJob PUT).
    // Translate ONLY when the sentinel item specifically failed its
    // condition; any other reason re-throws so DDB-throttle etc. surface.
    if (reasons[1]?.Code !== 'ConditionalCheckFailed') return null;

    let runningJobId = 'unknown';
    try {
      const existing = await this.dynamoDBClient.getItem<FinanceActiveExportSentinel>(
        client,
        tenantId,
        EntityKeyBuilder.financeActiveExport(schoolId),
      );
      if (existing?.jobId) runningJobId = existing.jobId;
    } catch (lookupErr) {
      // GetItem for runningJobId is best-effort; failure here doesn't
      // change the OUTCOME (still throw ActiveExportAlreadyRunningError),
      // just degrades the 409 body's pointer.
      this.logger.warn(
        `Sentinel lookup failed during 409 classification: ${(lookupErr as Error).message}`,
      );
    }
    return new ActiveExportAlreadyRunningError(schoolId, jobType, runningJobId);
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
      await this.emitAudit('started', updated, context);
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
    await this.emitAudit('succeeded', updated, context);
    // Sprint §5d MVP.5 — best-effort sentinel cleanup. No-op for jobs
    // that didn't create a sentinel (bulk_invoice_generate, or pre-MVP.5
    // jobs); DDB DeleteCommand on a non-existent item is idempotent.
    if (isExportJobType(updated.jobType)) {
      await this.deleteActiveExportSentinel(
        context.tenantId,
        updated.schoolId,
        context,
      );
    }
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
    await this.emitAudit('failed', updated, context);
    // Sprint §5d MVP.5 — best-effort sentinel cleanup. No-op for jobs
    // that didn't create a sentinel; DDB DeleteCommand is idempotent.
    if (isExportJobType(updated.jobType)) {
      await this.deleteActiveExportSentinel(
        context.tenantId,
        updated.schoolId,
        context,
      );
    }
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
   * — the loser sees ConflictException, which this method internally
   * retries (PR #341 review F1).
   *
   * Internal retry (PR #341 review F1): on `ConflictException` (the
   * DDB client's translation of `ConditionalCheckFailedException`) we
   * refetch the row and try again — up to 3 attempts with jittered
   * backoff. Without this loop, two simultaneous per-student failures
   * under the worker's default concurrency of 8 would silently drop
   * the loser's `failedStudentIds`, `errors[]`, and `counters.failed`
   * increment. The retry preserves the documented "loser sees
   * ConflictException" contract internally rather than pushing it onto
   * every caller.
   *
   * Terminal-status guard (PR #339 review): pins the predecessor status to
   * `queued` OR `running`. A delayed/replayed worker call MUST NOT mutate
   * counters on a job that `markCompleted` or `markFailed` has already
   * terminalized — that would corrupt the final counter snapshot AND bump
   * `updatedAt`/`version` post-completion. After all retries, a sustained
   * 409 (job already terminalized) re-raises the ConflictException so the
   * worker can log + drop the per-student record on a finalized job.
   */
  async appendFailedStudent(
    jobId: string,
    studentId: string,
    errorMessage: string,
    context: RequestContext,
  ): Promise<void> {
    const client = await this.dynamoDBClient.getClient(
      context.tenantId,
      context.jwtToken,
    );

    await retryWithJitter(
      async () => {
        const now = new Date().toISOString();
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
          'SET failedStudentIds = :ids, errors = :errors, counters.failed = counters.failed + :one, updatedAt = :now, updatedBy = :by ADD version :one',
          {
            ':ids': newFailedIds,
            ':errors': newErrors,
            ':one': 1,
            ':now': now,
            ':by': context.userId,
            ':expectedVersion': current.version,
            ':queued': 'queued',
            ':running': 'running',
          },
          '(#status = :queued OR #status = :running) AND version = :expectedVersion',
          { '#status': 'status' },
        );
      },
      { attempts: 3, shouldRetry: isConflictException, baseMs: 25 },
    );
  }

  /**
   * Atomic counter increment for `succeeded` / `skipped`
   * (not `failed` — that goes via `appendFailedStudent` which also tracks
   * the studentId + error message). `delta` may be > 1 so the worker
   * can batch updates every ~25 iterations.
   *
   * Uses DDB's `ADD` on a nested path — no read-modify-write needed
   * because the operation is commutative.
   *
   * Internal retry on transient ConflictException (PR #341 review F1):
   * the version bump on EVERY counter write creates a race window when
   * two workers update the same job simultaneously. We retry the loser
   * up to 3 attempts. A sustained 409 (job already terminalized) is
   * re-raised so the worker can log + drop the increment.
   *
   * Terminal-status guard (PR #339 review): pins the predecessor status to
   * `queued` OR `running`. A delayed/replayed batch arriving AFTER
   * `markCompleted` or `markFailed` has terminalized the job MUST NOT
   * mutate the row — it would corrupt the final counter snapshot AND
   * bump `updatedAt`/`version` past completion.
   */
  async incrementCounter(
    jobId: string,
    counterName: CounterField,
    delta: number,
    context: RequestContext,
  ): Promise<void> {
    if (delta <= 0) return;
    const client = await this.dynamoDBClient.getClient(
      context.tenantId,
      context.jwtToken,
    );

    await retryWithJitter(
      async () => {
        const now = new Date().toISOString();
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
            ':queued': 'queued',
            ':running': 'running',
          },
          '#status = :queued OR #status = :running',
          { '#c': counterName, '#status': 'status' },
        );
      },
      { attempts: 3, shouldRetry: isConflictException, baseMs: 25 },
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
   * Event-type prefix branches by `job.jobType` (PR #341 review F5):
   *   - bulk_invoice_generate   → finance.bulk_generate.*
   *   - bulk_invoice_pdf_export → finance.bulk_export.*
   *   - bulk_receipt_pdf_export → finance.bulk_export.*
   *
   * Before this fix, all job types emitted `finance.bulk_export.*`,
   * polluting the export audit trail with generate jobs. The worker
   * (Sprint E.4) previously double-emitted its own `bulk_generate.*`
   * events to compensate — those direct emits were removed in the same
   * fix-up so this service is the sole audit gatekeeper for lifecycle
   * events. New workers (Sprint F/G) MUST NOT emit lifecycle events
   * directly; they get the right prefix automatically via this mapper.
   */
  private async emitAudit(
    lifecycleState: LifecycleState,
    job: FinanceJobEntity,
    context: RequestContext,
  ): Promise<void> {
    const eventType = `${getEventTypePrefix(job.jobType)}.${lifecycleState}`;
    try {
      // Cast is necessary because the FinanceAuditService event-type
      // string-literal union is closed; this util returns a value the
      // service accepts at runtime but TS can't prove statically.
      await this.financeAuditService.emit(
        eventType as Parameters<FinanceAuditService['emit']>[0],
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

/**
 * Map a `FinanceJobType` to its audit-event-type prefix. Exported so
 * the worker spec can assert on the same mapping without depending on
 * the service's internals.
 */
export function getEventTypePrefix(jobType: FinanceJobType): string {
  switch (jobType) {
    case 'bulk_invoice_generate':
      return 'finance.bulk_generate';
    case 'bulk_invoice_pdf_export':
    case 'bulk_receipt_pdf_export':
      return 'finance.bulk_export';
    default:
      return 'finance.bulk_export';
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
