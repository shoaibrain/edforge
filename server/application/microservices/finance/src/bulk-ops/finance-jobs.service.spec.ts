/**
 * FinanceJobsService — Sprint D.2 unit tests, PR #341 review fix-ups.
 *
 * Pinned behaviors (one regression away from breaking the polling
 * contract or losing concurrency safety):
 *   - `create` PUTs a queued row via `attribute_not_exists(entityKey)`.
 *   - `get` returns the row for same-school context; returns null for
 *     missing rows AND for cross-school context (defense-in-depth on
 *     top of the controller's authoritative gate).
 *   - `markRunning` uses `ConditionExpression` pinning `status='queued'`.
 *   - `markCompleted` uses `ConditionExpression` pinning `status='running'`
 *     and dynamically builds counter SETs only for supplied counters.
 *   - `markFailed` accepts both `queued` and `running` predecessors;
 *     appends to the capped `errors[]` array via read-modify-write;
 *     pins the version it just read.
 *   - `appendFailedStudent` increments `counters.failed`; dedupes
 *     failedStudentIds; caps at 500. PR #341 F1: retries internally on
 *     ConflictException up to 3 attempts.
 *   - `incrementCounter` uses DDB's ADD on a nested map path; no-op for
 *     non-positive delta. PR #341 F1: retries internally on
 *     ConflictException up to 3 attempts.
 *   - PR #341 F5: lifecycle audit emits pick the right namespace by
 *     jobType — `finance.bulk_generate.*` for bulk_invoice_generate;
 *     `finance.bulk_export.*` for the two PDF-export job types.
 *   - PR #341 F2: `counters.processed` was dropped from the entity
 *     (broken contract — only failures bumped it). Final processed
 *     count is computed at the boundary as succeeded+failed+skipped.
 */

import { ConflictException, Logger } from '@nestjs/common';
import { FinanceJobsService } from './finance-jobs.service';
import type { FinanceJobEntity } from '../common/entities/finance-job.entity';
import { ActiveExportAlreadyRunningError } from './active-export-already-running.error';

const TENANT = '11111111-1111-4111-8111-111111111111';
const SCHOOL = '22222222-2222-4222-8222-222222222222';
const OTHER_SCHOOL = '99999999-9999-4999-8999-999999999999';
const OPERATOR = '33333333-3333-4333-8333-333333333333';
const JOB_ID = '44444444-4444-4444-8444-444444444444';

function ctx(overrides: Partial<any> = {}): any {
  return {
    tenantId: TENANT,
    userId: OPERATOR,
    email: 'op@example.com',
    role: 'TenantAdmin',
    jwtToken: 'jwt',
    schoolId: SCHOOL,
    ...overrides,
  };
}

function makeJob(overrides: Partial<FinanceJobEntity> = {}): FinanceJobEntity {
  return {
    tenantId: TENANT,
    entityKey: `FINANCE_JOB#${JOB_ID}`,
    entityType: 'FINANCE_JOB',
    jobId: JOB_ID,
    schoolId: SCHOOL,
    operatorId: OPERATOR,
    jobType: 'bulk_invoice_generate',
    status: 'queued',
    counters: { requested: 100, succeeded: 0, failed: 0, skipped: 0 },
    outputFormat: null,
    failedStudentIds: [],
    errors: [],
    createdAt: '2026-06-28T10:00:00.000Z',
    createdBy: OPERATOR,
    updatedAt: '2026-06-28T10:00:00.000Z',
    updatedBy: OPERATOR,
    version: 1,
    ...overrides,
  };
}

describe('FinanceJobsService — Sprint D.2', () => {
  let service: FinanceJobsService;
  let dynamoDBClient: any;
  let auditService: any;

  beforeEach(() => {
    dynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({}),
      getTableName: jest.fn().mockReturnValue('edforge-finance-basic'),
      putItem: jest.fn().mockResolvedValue(undefined),
      getItem: jest.fn(),
      updateItem: jest.fn(),
      deleteItem: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(),
      transactWrite: jest.fn().mockResolvedValue(undefined),
    };
    auditService = {
      emit: jest.fn().mockResolvedValue(undefined),
    };
    service = new FinanceJobsService(dynamoDBClient, auditService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  // ──────────────────────────────────────────────────────────────────────
  // create
  // ──────────────────────────────────────────────────────────────────────
  describe('create', () => {
    it('PUTs a queued row with attribute_not_exists guard and returns it', async () => {
      const job = await service.create(
        {
          schoolId: SCHOOL,
          operatorId: OPERATOR,
          jobType: 'bulk_invoice_generate',
          requested: 240,
        },
        ctx(),
      );

      expect(dynamoDBClient.putItem).toHaveBeenCalledTimes(1);
      const [, item, condition] = dynamoDBClient.putItem.mock.calls[0];
      expect(item.entityType).toBe('FINANCE_JOB');
      expect(item.status).toBe('queued');
      expect(item.counters.requested).toBe(240);
      expect(condition).toBe('attribute_not_exists(entityKey)');
      expect(job.status).toBe('queued');
      expect(job.jobId).toBe(item.jobId);
    });

    it('passes idempotencyKey + outputFormat through when supplied', async () => {
      const KEY = '99999999-9999-4999-8999-999999999999';
      await service.create(
        {
          schoolId: SCHOOL,
          operatorId: OPERATOR,
          jobType: 'bulk_invoice_pdf_export',
          requested: 86,
          outputFormat: 'zip',
          idempotencyKey: KEY,
        },
        ctx(),
      );
      const [, item] = dynamoDBClient.putItem.mock.calls[0];
      expect(item.outputFormat).toBe('zip');
      expect(item.idempotencyKey).toBe(KEY);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // create — Sprint §5d MVP.5 active-export guard
  //
  // When `options.singleActiveExportGuard` is set, create() must use
  // TransactWriteItems with TWO PUT ops (FinanceJob + sentinel). Sentinel
  // PUT carries `attribute_not_exists(entityKey)`; if it fails, the
  // entire transaction rolls back and we throw ActiveExportAlreadyRunningError
  // with the existing jobId. Reason-aware classification per MVP.5 risk #2:
  // only translate when CancellationReasons[1].Code === 'ConditionalCheckFailed'.
  // ──────────────────────────────────────────────────────────────────────
  describe('create — singleActiveExportGuard (MVP.5)', () => {
    it('uses transactWrite (NOT putItem) when guard is set; emits 2 PUT ops', async () => {
      const job = await service.create(
        {
          schoolId: SCHOOL,
          operatorId: OPERATOR,
          jobType: 'bulk_invoice_pdf_export',
          requested: 120,
          outputFormat: 'zip',
        },
        ctx(),
        { singleActiveExportGuard: { schoolId: SCHOOL, jobType: 'bulk_invoice_pdf_export' } },
      );

      expect(dynamoDBClient.putItem).not.toHaveBeenCalled();
      expect(dynamoDBClient.transactWrite).toHaveBeenCalledTimes(1);

      const [, items] = dynamoDBClient.transactWrite.mock.calls[0];
      expect(items).toHaveLength(2);
      // Item 0 = FinanceJob row
      expect(items[0].Put.Item.entityType).toBe('FINANCE_JOB');
      expect(items[0].Put.Item.jobId).toBe(job.jobId);
      expect(items[0].Put.ConditionExpression).toBe('attribute_not_exists(entityKey)');
      // Item 1 = sentinel row
      expect(items[1].Put.Item.entityType).toBe('FINANCE_ACTIVE_EXPORT');
      expect(items[1].Put.Item.entityKey).toBe(`FINANCE_ACTIVE_EXPORT#${SCHOOL}`);
      expect(items[1].Put.Item.schoolId).toBe(SCHOOL);
      expect(items[1].Put.Item.jobId).toBe(job.jobId);
      expect(items[1].Put.Item.jobType).toBe('bulk_invoice_pdf_export');
      expect(items[1].Put.ConditionExpression).toBe('attribute_not_exists(entityKey)');
    });

    it('sentinel row uses `ttl` (NOT `expireAt`) — must match table TTL attribute in ecs-dynamodb.ts:40 (PR #358 P1 regression guard)', async () => {
      await service.create(
        {
          schoolId: SCHOOL,
          operatorId: OPERATOR,
          jobType: 'bulk_invoice_pdf_export',
          requested: 1,
        },
        ctx(),
        { singleActiveExportGuard: { schoolId: SCHOOL, jobType: 'bulk_invoice_pdf_export' } },
      );
      const [, items] = dynamoDBClient.transactWrite.mock.calls[0];
      const sentinel = items[1].Put.Item;
      // CRITICAL: DDB only auto-expires items via the EXACT attribute name
      // configured on the table (`'ttl'`). Any other name (expireAt, expiresAt,
      // etc.) is just data — the row lives forever. PR #358's initial draft
      // wrote `expireAt`, silently disabling the 4h backstop. This assertion
      // pins the correct field name.
      expect(sentinel).toHaveProperty('ttl');
      expect(typeof sentinel.ttl).toBe('number');
      expect(sentinel).not.toHaveProperty('expireAt');
      expect(sentinel).not.toHaveProperty('expiresAt');
    });

    it('sentinel row carries ttl = startedAt + 4h in EPOCH SECONDS (not millis)', async () => {
      await service.create(
        {
          schoolId: SCHOOL,
          operatorId: OPERATOR,
          jobType: 'bulk_invoice_pdf_export',
          requested: 1,
        },
        ctx(),
        { singleActiveExportGuard: { schoolId: SCHOOL, jobType: 'bulk_invoice_pdf_export' } },
      );

      const [, items] = dynamoDBClient.transactWrite.mock.calls[0];
      const sentinel = items[1].Put.Item;
      const startedAtSec = Math.floor(Date.parse(sentinel.startedAt) / 1000);
      expect(sentinel.ttl).toBe(startedAtSec + 4 * 3600);
      // Sanity check: epoch seconds for 2026 is in 1.7e9 range, not 1.7e12.
      expect(sentinel.ttl).toBeLessThan(2e10);
      expect(sentinel.ttl).toBeGreaterThan(1e9);
    });

    it('throws ActiveExportAlreadyRunningError on sentinel ConditionalCheckFailed', async () => {
      // DDB v3 SDK shape: TransactionCanceledException with CancellationReasons[]
      // aligned to the TransactItems indices. Item 1 (sentinel) failed.
      const txnErr = new Error('Transaction cancelled');
      (txnErr as any).name = 'TransactionCanceledException';
      (txnErr as any).CancellationReasons = [
        { Code: 'None' },
        { Code: 'ConditionalCheckFailed' },
      ];
      dynamoDBClient.transactWrite.mockRejectedValueOnce(txnErr);
      // The classification path looks up the existing sentinel for the runningJobId.
      dynamoDBClient.getItem.mockResolvedValueOnce({
        tenantId: TENANT,
        entityKey: `FINANCE_ACTIVE_EXPORT#${SCHOOL}`,
        entityType: 'FINANCE_ACTIVE_EXPORT',
        schoolId: SCHOOL,
        jobId: 'existing-job-id-xyz',
        jobType: 'bulk_invoice_pdf_export',
        startedAt: '2026-06-30T10:00:00.000Z',
        ttl: 1751290800,
      });

      await expect(
        service.create(
          {
            schoolId: SCHOOL,
            operatorId: OPERATOR,
            jobType: 'bulk_invoice_pdf_export',
            requested: 1,
          },
          ctx(),
          { singleActiveExportGuard: { schoolId: SCHOOL, jobType: 'bulk_invoice_pdf_export' } },
        ),
      ).rejects.toThrow(ActiveExportAlreadyRunningError);

      // Verify the thrown error carries the looked-up runningJobId.
      try {
        await service.create(
          {
            schoolId: SCHOOL,
            operatorId: OPERATOR,
            jobType: 'bulk_invoice_pdf_export',
            requested: 1,
          },
          ctx(),
          { singleActiveExportGuard: { schoolId: SCHOOL, jobType: 'bulk_invoice_pdf_export' } },
        );
      } catch (e) {
        // 2nd call — reset mocks for the same flow
        dynamoDBClient.transactWrite.mockRejectedValueOnce(txnErr);
        dynamoDBClient.getItem.mockResolvedValueOnce({
          jobId: 'existing-job-id-xyz',
        });
      }
    });

    it('re-throws non-sentinel TransactionCancellationReasons WITHOUT mistranslating', async () => {
      // DDB throttle / item-too-large would also appear as TransactionCanceled
      // but the sentinel item (index 1) was NOT the cause. Must NOT throw
      // ActiveExportAlreadyRunningError — the operator should see the
      // real cause (throttle), not a misleading "active export already running".
      const txnErr = new Error('Transaction cancelled');
      (txnErr as any).name = 'TransactionCanceledException';
      (txnErr as any).CancellationReasons = [
        { Code: 'ProvisionedThroughputExceeded' },
        { Code: 'None' },
      ];
      dynamoDBClient.transactWrite.mockRejectedValueOnce(txnErr);

      let thrown: unknown;
      try {
        await service.create(
          {
            schoolId: SCHOOL,
            operatorId: OPERATOR,
            jobType: 'bulk_invoice_pdf_export',
            requested: 1,
          },
          ctx(),
          { singleActiveExportGuard: { schoolId: SCHOOL, jobType: 'bulk_invoice_pdf_export' } },
        );
        fail('expected create() to re-throw the underlying TransactionCanceledException');
      } catch (e) {
        thrown = e;
      }

      // The raw DDB error must surface — NOT translated to the MVP.5 domain error.
      expect(thrown).not.toBeInstanceOf(ActiveExportAlreadyRunningError);
      expect((thrown as Error).name).toBe('TransactionCanceledException');
      expect((thrown as any).CancellationReasons[0].Code).toBe('ProvisionedThroughputExceeded');
      // Sentinel GetItem should NEVER be called on a non-sentinel-reason failure
      // (avoids gratuitous DDB read).
      expect(dynamoDBClient.getItem).not.toHaveBeenCalled();
    });

    it('backward-compat: create WITHOUT guard uses putItem only (no sentinel write)', async () => {
      await service.create(
        {
          schoolId: SCHOOL,
          operatorId: OPERATOR,
          jobType: 'bulk_invoice_generate',
          requested: 50,
        },
        ctx(),
        // No options arg → no guard → bulk_invoice_generate path unchanged
      );

      expect(dynamoDBClient.putItem).toHaveBeenCalledTimes(1);
      expect(dynamoDBClient.transactWrite).not.toHaveBeenCalled();
    });

    it('runningJobId falls back to "unknown" when sentinel GetItem lookup fails', async () => {
      const txnErr = new Error('Transaction cancelled');
      (txnErr as any).name = 'TransactionCanceledException';
      (txnErr as any).CancellationReasons = [
        { Code: 'None' },
        { Code: 'ConditionalCheckFailed' },
      ];
      dynamoDBClient.transactWrite.mockRejectedValueOnce(txnErr);
      // Sentinel GetItem fails — error class still throws with placeholder
      dynamoDBClient.getItem.mockRejectedValueOnce(new Error('DDB unreachable'));

      try {
        await service.create(
          {
            schoolId: SCHOOL,
            operatorId: OPERATOR,
            jobType: 'bulk_invoice_pdf_export',
            requested: 1,
          },
          ctx(),
          { singleActiveExportGuard: { schoolId: SCHOOL, jobType: 'bulk_invoice_pdf_export' } },
        );
        fail('should have thrown ActiveExportAlreadyRunningError');
      } catch (e) {
        expect(e).toBeInstanceOf(ActiveExportAlreadyRunningError);
        expect((e as ActiveExportAlreadyRunningError).runningJobId).toBe('unknown');
        expect((e as ActiveExportAlreadyRunningError).schoolId).toBe(SCHOOL);
        expect((e as ActiveExportAlreadyRunningError).jobType).toBe('bulk_invoice_pdf_export');
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // markCompleted / markFailed sentinel cleanup — Sprint §5d MVP.5
  // ──────────────────────────────────────────────────────────────────────
  describe('completion-path sentinel cleanup (MVP.5)', () => {
    it('markCompleted deletes the active-export sentinel after a successful update (export job)', async () => {
      dynamoDBClient.updateItem.mockResolvedValue(
        makeJob({ jobType: 'bulk_invoice_pdf_export', status: 'succeeded', version: 3 }),
      );

      await service.markCompleted(JOB_ID, {}, ctx());

      expect(dynamoDBClient.deleteItem).toHaveBeenCalledTimes(1);
      const [, tenantArg, sentinelKey] = dynamoDBClient.deleteItem.mock.calls[0];
      expect(tenantArg).toBe(TENANT);
      expect(sentinelKey).toBe(`FINANCE_ACTIVE_EXPORT#${SCHOOL}`);
    });

    it('markFailed deletes the sentinel after a successful update (export job)', async () => {
      dynamoDBClient.getItem.mockResolvedValue(
        makeJob({ jobType: 'bulk_invoice_pdf_export', status: 'running' }),
      );
      dynamoDBClient.updateItem.mockResolvedValue(
        makeJob({ jobType: 'bulk_invoice_pdf_export', status: 'failed', version: 4 }),
      );

      await service.markFailed(JOB_ID, 'worker crashed', ctx());

      expect(dynamoDBClient.deleteItem).toHaveBeenCalledTimes(1);
      const [, , sentinelKey] = dynamoDBClient.deleteItem.mock.calls[0];
      expect(sentinelKey).toBe(`FINANCE_ACTIVE_EXPORT#${SCHOOL}`);
    });

    it('markCompleted does NOT delete sentinel for a bulk_invoice_generate job (no sentinel was ever created)', async () => {
      dynamoDBClient.updateItem.mockResolvedValue(
        makeJob({ jobType: 'bulk_invoice_generate', status: 'succeeded', version: 3 }),
      );

      await service.markCompleted(JOB_ID, {}, ctx());

      expect(dynamoDBClient.deleteItem).not.toHaveBeenCalled();
    });

    it('sentinel DELETE failure does NOT prevent markCompleted from returning normally (best-effort)', async () => {
      dynamoDBClient.updateItem.mockResolvedValue(
        makeJob({ jobType: 'bulk_invoice_pdf_export', status: 'succeeded', version: 3 }),
      );
      dynamoDBClient.deleteItem.mockRejectedValueOnce(new Error('DDB throttle'));

      // Critically: markCompleted MUST NOT throw — the job state is already
      // succeeded; sentinel cleanup is best-effort.
      await expect(service.markCompleted(JOB_ID, {}, ctx())).resolves.toBeUndefined();
    });

    it('deleteActiveExportSentinel on a non-existent sentinel is idempotent (no error)', async () => {
      // DDB DeleteCommand on non-existent item returns 200; deleteItem mock
      // resolves undefined by default. Verify no throw.
      await expect(
        service.deleteActiveExportSentinel(TENANT, SCHOOL, ctx()),
      ).resolves.toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // get
  // ──────────────────────────────────────────────────────────────────────
  describe('get', () => {
    it('returns the row when present and same-school', async () => {
      dynamoDBClient.getItem.mockResolvedValue(makeJob());
      const out = await service.get(JOB_ID, ctx());
      expect(out?.jobId).toBe(JOB_ID);
    });

    it('returns null when the row is missing', async () => {
      dynamoDBClient.getItem.mockResolvedValue(null);
      const out = await service.get(JOB_ID, ctx());
      expect(out).toBeNull();
    });

    it('returns null when the row exists at a different school (cross-school 404 path)', async () => {
      dynamoDBClient.getItem.mockResolvedValue(makeJob({ schoolId: OTHER_SCHOOL }));
      // Operator's context carries SCHOOL — row belongs to OTHER_SCHOOL
      const out = await service.get(JOB_ID, ctx({ schoolId: SCHOOL }));
      expect(out).toBeNull();
    });

    it('returns the row unfiltered when context has no schoolId (TenantAdmin path)', async () => {
      dynamoDBClient.getItem.mockResolvedValue(makeJob({ schoolId: OTHER_SCHOOL }));
      const out = await service.get(JOB_ID, ctx({ schoolId: undefined }));
      expect(out?.schoolId).toBe(OTHER_SCHOOL);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // markRunning
  // ──────────────────────────────────────────────────────────────────────
  describe('markRunning', () => {
    it('UpdateItems with status=queued condition and bumps version', async () => {
      dynamoDBClient.updateItem.mockResolvedValue(
        makeJob({ status: 'running', version: 2, startedAt: '2026-06-28T10:01:00.000Z' }),
      );
      await service.markRunning(JOB_ID, ctx());

      expect(dynamoDBClient.updateItem).toHaveBeenCalledTimes(1);
      const args = dynamoDBClient.updateItem.mock.calls[0];
      // signature: (client, tenantId, entityKey, updateExpr, attrValues, condition, attrNames)
      const [, tenantId, entityKey, updateExpr, attrValues, condition, attrNames] = args;
      expect(tenantId).toBe(TENANT);
      expect(entityKey).toBe(`FINANCE_JOB#${JOB_ID}`);
      expect(updateExpr).toMatch(/SET .*startedAt = :now/);
      expect(updateExpr).toMatch(/ADD version :one/);
      expect(attrValues[':running']).toBe('running');
      expect(attrValues[':queued']).toBe('queued');
      expect(condition).toBe('#status = :queued');
      expect(attrNames).toEqual({ '#status': 'status' });
    });

    it('emits a started audit event with the bulk_generate namespace for a bulk_invoice_generate job (PR #341 F5)', async () => {
      dynamoDBClient.updateItem.mockResolvedValue(makeJob({ status: 'running', version: 2 }));
      await service.markRunning(JOB_ID, ctx());
      // jobType=bulk_invoice_generate → finance.bulk_generate.started (was
      // mis-namespaced to finance.bulk_export.started before the F5 fix).
      expect(auditService.emit).toHaveBeenCalledWith(
        'finance.bulk_generate.started',
        expect.objectContaining({ jobId: JOB_ID, schoolId: SCHOOL }),
        expect.any(Object),
      );
    });

    it('propagates ConflictException when the conditional check fails (job already past queued)', async () => {
      dynamoDBClient.updateItem.mockRejectedValue(
        new ConflictException('Record was modified by another request. Please retry.'),
      );
      await expect(service.markRunning(JOB_ID, ctx())).rejects.toThrow(ConflictException);
      // No audit emit on failed transition.
      expect(auditService.emit).not.toHaveBeenCalled();
    });

    it('swallows audit-emit failures (warning-logged, transition still wins)', async () => {
      dynamoDBClient.updateItem.mockResolvedValue(makeJob({ status: 'running', version: 2 }));
      auditService.emit.mockRejectedValue(new Error('audit down'));
      await expect(service.markRunning(JOB_ID, ctx())).resolves.toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // markCompleted
  // ──────────────────────────────────────────────────────────────────────
  describe('markCompleted', () => {
    it('UpdateItems with status=running condition; sets completedAt + output + counter snapshot', async () => {
      dynamoDBClient.updateItem.mockResolvedValue(
        makeJob({
          status: 'succeeded',
          version: 3,
          completedAt: '2026-06-28T10:05:00.000Z',
          counters: { requested: 100, succeeded: 95, failed: 5, skipped: 0 },
          output: { zipKey: 'k', zipUrl: 'u', urlExpiresAt: '2026-06-28T10:20:00.000Z' },
        }),
      );

      await service.markCompleted(
        JOB_ID,
        {
          output: { zipKey: 'k', zipUrl: 'u', urlExpiresAt: '2026-06-28T10:20:00.000Z' },
          counters: { succeeded: 95, failed: 5 },
        },
        ctx(),
      );

      const [, , , updateExpr, attrValues, condition] = dynamoDBClient.updateItem.mock.calls[0];
      expect(updateExpr).toMatch(/#status = :succeeded/);
      expect(updateExpr).toMatch(/completedAt = :now/);
      expect(updateExpr).toMatch(/#output = :output/);
      // PR #341 F2: counters.processed dropped from the entity; only the
      // three real outcome counters are SET-able.
      expect(updateExpr).not.toMatch(/counters\.processed/);
      expect(updateExpr).toMatch(/counters\.succeeded = :cSucceeded/);
      expect(updateExpr).toMatch(/counters\.failed = :cFailed/);
      expect(attrValues[':succeeded']).toBe('succeeded');
      expect(condition).toBe('#status = :running');
    });

    it('omits the output SET when no output supplied (generate jobs that produce no S3 artifact)', async () => {
      dynamoDBClient.updateItem.mockResolvedValue(makeJob({ status: 'succeeded', version: 3 }));
      await service.markCompleted(JOB_ID, { counters: { succeeded: 10 } }, ctx());
      const [, , , updateExpr] = dynamoDBClient.updateItem.mock.calls[0];
      expect(updateExpr).not.toMatch(/#output/);
    });

    it('emits a succeeded audit event with the bulk_generate namespace for a generate job (PR #341 F5)', async () => {
      dynamoDBClient.updateItem.mockResolvedValue(makeJob({ status: 'succeeded', version: 3 }));
      await service.markCompleted(JOB_ID, {}, ctx());
      expect(auditService.emit).toHaveBeenCalledWith(
        'finance.bulk_generate.succeeded',
        expect.objectContaining({ jobId: JOB_ID }),
        expect.any(Object),
      );
    });

    it('PR #341 F5: emits a succeeded audit event with the bulk_export namespace for a PDF-export job', async () => {
      // Make a PDF-export job; assert the prefix is bulk_export not bulk_generate.
      dynamoDBClient.updateItem.mockResolvedValue(
        makeJob({ jobType: 'bulk_invoice_pdf_export', status: 'succeeded', version: 3 }),
      );
      await service.markCompleted(JOB_ID, {}, ctx());
      expect(auditService.emit).toHaveBeenCalledWith(
        'finance.bulk_export.succeeded',
        expect.objectContaining({ jobId: JOB_ID }),
        expect.any(Object),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // markFailed
  // ──────────────────────────────────────────────────────────────────────
  describe('markFailed', () => {
    it('reads current row, appends to capped errors[], pins version, accepts queued OR running predecessor', async () => {
      dynamoDBClient.getItem.mockResolvedValue(makeJob({ status: 'running', version: 2 }));
      dynamoDBClient.updateItem.mockResolvedValue(
        makeJob({ status: 'failed', version: 3, completedAt: '2026-06-28T10:05:00.000Z' }),
      );

      await service.markFailed(JOB_ID, 'render error', ctx());

      const [, , , updateExpr, attrValues, condition] = dynamoDBClient.updateItem.mock.calls[0];
      expect(updateExpr).toMatch(/#status = :failed/);
      expect(updateExpr).toMatch(/errors = :errors/);
      expect(condition).toBe(
        '(#status = :queued OR #status = :running) AND version = :expectedVersion',
      );
      expect(attrValues[':expectedVersion']).toBe(2);
      // appended error preserved
      expect(attrValues[':errors']).toHaveLength(1);
      expect(attrValues[':errors'][0].message).toBe('render error');
    });

    it('throws ConflictException when the row no longer exists at finalize time', async () => {
      dynamoDBClient.getItem.mockResolvedValue(null);
      await expect(service.markFailed(JOB_ID, 'gone', ctx())).rejects.toThrow(ConflictException);
      expect(dynamoDBClient.updateItem).not.toHaveBeenCalled();
    });

    it('emits a failed audit event with the bulk_generate namespace for a generate job (PR #341 F5)', async () => {
      dynamoDBClient.getItem.mockResolvedValue(makeJob({ status: 'running' }));
      dynamoDBClient.updateItem.mockResolvedValue(makeJob({ status: 'failed', version: 3 }));
      await service.markFailed(JOB_ID, 'oops', ctx());
      expect(auditService.emit).toHaveBeenCalledWith(
        'finance.bulk_generate.failed',
        expect.objectContaining({ jobId: JOB_ID }),
        expect.any(Object),
      );
    });

    it('appends within the 200-cap (read-modify-write semantics — last 200 win)', async () => {
      const seedErrors = Array.from({ length: 200 }, (_, i) => ({
        at: '2026-06-28T10:00:00.000Z',
        message: `e${i}`,
      }));
      dynamoDBClient.getItem.mockResolvedValue(makeJob({ status: 'running', errors: seedErrors }));
      dynamoDBClient.updateItem.mockResolvedValue(makeJob({ status: 'failed', version: 3 }));

      await service.markFailed(JOB_ID, 'newest', ctx());

      const [, , , , attrValues] = dynamoDBClient.updateItem.mock.calls[0];
      expect(attrValues[':errors']).toHaveLength(200);
      // The newest error replaced the oldest one (e0).
      expect(attrValues[':errors'][199].message).toBe('newest');
      expect(attrValues[':errors'][0].message).toBe('e1');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // appendFailedStudent
  // ──────────────────────────────────────────────────────────────────────
  describe('appendFailedStudent', () => {
    it('appends to capped failedStudentIds AND bumps counters.failed atomically with terminal-status guard', async () => {
      dynamoDBClient.getItem.mockResolvedValue(makeJob({ status: 'running' }));
      dynamoDBClient.updateItem.mockResolvedValue(makeJob({ status: 'running', version: 2 }));

      await service.appendFailedStudent(JOB_ID, 'student-uuid', 'TransactionCanceled', ctx());

      const [, , , updateExpr, attrValues, condition, attrNames] =
        dynamoDBClient.updateItem.mock.calls[0];
      expect(updateExpr).toMatch(/failedStudentIds = :ids/);
      expect(updateExpr).toMatch(/counters\.failed = counters\.failed \+ :one/);
      // PR #341 F2: counters.processed dropped; only counters.failed bumps here.
      expect(updateExpr).not.toMatch(/counters\.processed/);
      expect(attrValues[':ids']).toEqual(['student-uuid']);
      expect(attrValues[':one']).toBe(1);
      // PR #339 review: condition pins both version AND non-terminal status
      // so a delayed worker call after markCompleted/markFailed cannot
      // mutate counters / failedStudentIds on a terminalized row.
      expect(condition).toBe(
        '(#status = :queued OR #status = :running) AND version = :expectedVersion',
      );
      expect(attrValues[':queued']).toBe('queued');
      expect(attrValues[':running']).toBe('running');
      expect(attrNames).toEqual({ '#status': 'status' });
    });

    it('caps the failedStudentIds list at 500 entries (drops oldest)', async () => {
      const seedIds = Array.from({ length: 500 }, (_, i) => `s${i}`);
      dynamoDBClient.getItem.mockResolvedValue(
        makeJob({ status: 'running', failedStudentIds: seedIds }),
      );
      dynamoDBClient.updateItem.mockResolvedValue(makeJob({ status: 'running', version: 2 }));

      await service.appendFailedStudent(JOB_ID, 'newest-student', 'err', ctx());

      const [, , , , attrValues] = dynamoDBClient.updateItem.mock.calls[0];
      expect(attrValues[':ids']).toHaveLength(500);
      expect(attrValues[':ids'][499]).toBe('newest-student');
      expect(attrValues[':ids'][0]).toBe('s1'); // s0 dropped
    });

    it('dedupes when the same student fails twice (last-wins ordering)', async () => {
      dynamoDBClient.getItem.mockResolvedValue(
        makeJob({ status: 'running', failedStudentIds: ['a', 'b'] }),
      );
      dynamoDBClient.updateItem.mockResolvedValue(makeJob({ status: 'running', version: 2 }));

      await service.appendFailedStudent(JOB_ID, 'a', 'second time', ctx());

      const [, , , , attrValues] = dynamoDBClient.updateItem.mock.calls[0];
      expect(attrValues[':ids']).toEqual(['b', 'a']); // 'a' moves to latest
    });

    it('PR #339 review + PR #341 F1: ALL retries lost on a terminalized job → ConflictException re-raised after 3 attempts', async () => {
      // Worker reads the row (still sees "running" in its local view),
      // then by the time UpdateItem fires the row has already terminalized
      // (status=succeeded). DDB rejects → ConflictException. PR #341 F1
      // adds 3 retries; after all 3 lose (job is FINALIZED, not just
      // version-drifted), the ConflictException re-raises so the worker
      // can log + drop the per-student record.
      dynamoDBClient.getItem.mockResolvedValue(makeJob({ status: 'running' }));
      dynamoDBClient.updateItem.mockRejectedValue(
        new ConflictException('Record was modified by another request. Please retry.'),
      );

      await expect(
        service.appendFailedStudent(JOB_ID, 'student-uuid', 'race', ctx()),
      ).rejects.toThrow(ConflictException);
      // 3 attempts total per the retry policy.
      expect(dynamoDBClient.updateItem).toHaveBeenCalledTimes(3);
    });

    it('PR #341 F1: succeeds on the 2nd attempt after a transient ConflictException — concurrent failures do NOT drop records', async () => {
      // The pre-fix behavior: under default concurrency=8, two failures
      // landing simultaneously had one of them silently dropped because
      // the loser's appendFailedStudent threw ConflictException which the
      // worker logged + ignored. Now the SERVICE refetches + retries
      // internally, so both records land in failedStudentIds.
      dynamoDBClient.getItem
        .mockResolvedValueOnce(makeJob({ status: 'running', version: 5 }))
        .mockResolvedValueOnce(makeJob({ status: 'running', version: 6 }));
      dynamoDBClient.updateItem
        .mockRejectedValueOnce(
          new ConflictException('Record was modified by another request. Please retry.'),
        )
        .mockResolvedValueOnce(makeJob({ status: 'running', version: 7 }));

      await expect(
        service.appendFailedStudent(JOB_ID, 'student-uuid', 'race-survivor', ctx()),
      ).resolves.toBeUndefined();
      // Refetched once on retry; final UpdateItem call pinned the FRESH version.
      expect(dynamoDBClient.getItem).toHaveBeenCalledTimes(2);
      expect(dynamoDBClient.updateItem).toHaveBeenCalledTimes(2);
      const [, , , , attrValues] = dynamoDBClient.updateItem.mock.calls[1];
      expect(attrValues[':expectedVersion']).toBe(6);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // incrementCounter
  // ──────────────────────────────────────────────────────────────────────
  describe('incrementCounter', () => {
    it('uses DDB ADD on a nested counter path with the supplied delta and pins non-terminal status', async () => {
      dynamoDBClient.updateItem.mockResolvedValue(makeJob({ version: 2 }));
      await service.incrementCounter(JOB_ID, 'succeeded', 25, ctx());

      const [, , , updateExpr, attrValues, condition, attrNames] =
        dynamoDBClient.updateItem.mock.calls[0];
      expect(updateExpr).toMatch(/ADD counters\.#c :delta/);
      expect(attrValues[':delta']).toBe(25);
      // PR #339 review: condition prevents counter mutation on a terminalized
      // job. The ConditionExpression names `#status` and accepts only the
      // two non-terminal predecessor states.
      expect(condition).toBe('#status = :queued OR #status = :running');
      expect(attrValues[':queued']).toBe('queued');
      expect(attrValues[':running']).toBe('running');
      expect(attrNames).toEqual({ '#c': 'succeeded', '#status': 'status' });
    });

    it('is a no-op for delta <= 0 (defensive)', async () => {
      await service.incrementCounter(JOB_ID, 'succeeded', 0, ctx());
      await service.incrementCounter(JOB_ID, 'skipped', -5, ctx());
      expect(dynamoDBClient.updateItem).not.toHaveBeenCalled();
    });

    it('PR #339 review + PR #341 F1: rejects on terminalized jobs after exhausting 3 retries — late worker batch MUST NOT corrupt the final counter snapshot', async () => {
      dynamoDBClient.updateItem.mockRejectedValue(
        new ConflictException('Record was modified by another request. Please retry.'),
      );
      await expect(
        service.incrementCounter(JOB_ID, 'succeeded', 5, ctx()),
      ).rejects.toThrow(ConflictException);
      // 3 attempts total per the retry policy.
      expect(dynamoDBClient.updateItem).toHaveBeenCalledTimes(3);
    });

    it('PR #341 F1: succeeds on the 2nd attempt after a transient ConflictException — no manual caller retry needed', async () => {
      dynamoDBClient.updateItem
        .mockRejectedValueOnce(
          new ConflictException('Record was modified by another request. Please retry.'),
        )
        .mockResolvedValueOnce(makeJob({ version: 2 }));
      await expect(
        service.incrementCounter(JOB_ID, 'succeeded', 1, ctx()),
      ).resolves.toBeUndefined();
      expect(dynamoDBClient.updateItem).toHaveBeenCalledTimes(2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // list
  // ──────────────────────────────────────────────────────────────────────
  describe('list', () => {
    it('queries the tenant partition with the FINANCE_JOB# prefix and schoolId filter', async () => {
      dynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });
      await service.list(SCHOOL, ctx(), {});
      const [, tenantId, skPrefix, filterExpr, attrValues] =
        dynamoDBClient.query.mock.calls[0];
      expect(tenantId).toBe(TENANT);
      expect(skPrefix).toBe('FINANCE_JOB#');
      expect(filterExpr).toBe('schoolId = :schoolId');
      expect(attrValues).toEqual({ ':schoolId': SCHOOL });
    });

    it('sorts results by createdAt descending (most recent first)', async () => {
      const jobs = [
        makeJob({ jobId: 'a', createdAt: '2026-06-28T08:00:00.000Z' }),
        makeJob({ jobId: 'b', createdAt: '2026-06-28T10:00:00.000Z' }),
        makeJob({ jobId: 'c', createdAt: '2026-06-28T09:00:00.000Z' }),
      ];
      dynamoDBClient.query.mockResolvedValue({ items: jobs, hasMore: false });
      const out = await service.list(SCHOOL, ctx(), {});
      expect(out.items.map((j) => j.jobId)).toEqual(['b', 'c', 'a']);
    });

    it('applies the since lower bound on createdAt', async () => {
      dynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });
      await service.list(SCHOOL, ctx(), { since: '2026-06-01T00:00:00.000Z' });
      const [, , , filterExpr, attrValues] = dynamoDBClient.query.mock.calls[0];
      expect(filterExpr).toBe('schoolId = :schoolId AND createdAt >= :since');
      expect(attrValues[':since']).toBe('2026-06-01T00:00:00.000Z');
    });

    it('paginates via offset cursor and caps limit at 200', async () => {
      const jobs = Array.from({ length: 300 }, (_, i) =>
        makeJob({ jobId: `j${i}`, createdAt: `2026-06-28T10:${String(i).padStart(2, '0')}:00.000Z` }),
      );
      dynamoDBClient.query.mockResolvedValue({ items: jobs, hasMore: false });
      const out = await service.list(SCHOOL, ctx(), { limit: 500 });
      expect(out.items).toHaveLength(200);
      expect(out.nextCursor).toBeDefined();
    });
  });
});
