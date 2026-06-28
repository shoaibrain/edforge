/**
 * FinanceJobsService — Sprint D.2 unit tests.
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
 *   - `appendFailedStudent` increments both `counters.failed` and
 *     `counters.processed`; dedupes failedStudentIds; caps at 500.
 *   - `incrementCounter` uses DDB's ADD on a nested map path; no-op for
 *     non-positive delta.
 *   - Every lifecycle transition emits a sibling audit event; audit
 *     errors are swallowed.
 */

import { ConflictException, Logger } from '@nestjs/common';
import { FinanceJobsService } from './finance-jobs.service';
import type { FinanceJobEntity } from '../common/entities/finance-job.entity';

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
    counters: { requested: 100, processed: 0, succeeded: 0, failed: 0, skipped: 0 },
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
      putItem: jest.fn().mockResolvedValue(undefined),
      getItem: jest.fn(),
      updateItem: jest.fn(),
      query: jest.fn(),
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

    it('emits a started audit event after successful transition', async () => {
      dynamoDBClient.updateItem.mockResolvedValue(makeJob({ status: 'running', version: 2 }));
      await service.markRunning(JOB_ID, ctx());
      expect(auditService.emit).toHaveBeenCalledWith(
        'finance.bulk_export.started',
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
          counters: { requested: 100, processed: 100, succeeded: 95, failed: 5, skipped: 0 },
          output: { zipKey: 'k', zipUrl: 'u', urlExpiresAt: '2026-06-28T10:20:00.000Z' },
        }),
      );

      await service.markCompleted(
        JOB_ID,
        {
          output: { zipKey: 'k', zipUrl: 'u', urlExpiresAt: '2026-06-28T10:20:00.000Z' },
          counters: { processed: 100, succeeded: 95, failed: 5 },
        },
        ctx(),
      );

      const [, , , updateExpr, attrValues, condition] = dynamoDBClient.updateItem.mock.calls[0];
      expect(updateExpr).toMatch(/#status = :succeeded/);
      expect(updateExpr).toMatch(/completedAt = :now/);
      expect(updateExpr).toMatch(/#output = :output/);
      expect(updateExpr).toMatch(/counters\.processed = :cProcessed/);
      expect(updateExpr).toMatch(/counters\.succeeded = :cSucceeded/);
      expect(updateExpr).toMatch(/counters\.failed = :cFailed/);
      expect(attrValues[':succeeded']).toBe('succeeded');
      expect(condition).toBe('#status = :running');
    });

    it('omits the output SET when no output supplied (generate jobs that produce no S3 artifact)', async () => {
      dynamoDBClient.updateItem.mockResolvedValue(makeJob({ status: 'succeeded', version: 3 }));
      await service.markCompleted(JOB_ID, { counters: { processed: 10 } }, ctx());
      const [, , , updateExpr] = dynamoDBClient.updateItem.mock.calls[0];
      expect(updateExpr).not.toMatch(/#output/);
    });

    it('emits a succeeded audit event', async () => {
      dynamoDBClient.updateItem.mockResolvedValue(makeJob({ status: 'succeeded', version: 3 }));
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

    it('emits a failed audit event after successful transition', async () => {
      dynamoDBClient.getItem.mockResolvedValue(makeJob({ status: 'running' }));
      dynamoDBClient.updateItem.mockResolvedValue(makeJob({ status: 'failed', version: 3 }));
      await service.markFailed(JOB_ID, 'oops', ctx());
      expect(auditService.emit).toHaveBeenCalledWith(
        'finance.bulk_export.failed',
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
    it('appends to capped failedStudentIds AND bumps counters.failed + counters.processed atomically with terminal-status guard', async () => {
      dynamoDBClient.getItem.mockResolvedValue(makeJob({ status: 'running' }));
      dynamoDBClient.updateItem.mockResolvedValue(makeJob({ status: 'running', version: 2 }));

      await service.appendFailedStudent(JOB_ID, 'student-uuid', 'TransactionCanceled', ctx());

      const [, , , updateExpr, attrValues, condition, attrNames] =
        dynamoDBClient.updateItem.mock.calls[0];
      expect(updateExpr).toMatch(/failedStudentIds = :ids/);
      expect(updateExpr).toMatch(/counters\.failed = counters\.failed \+ :one/);
      expect(updateExpr).toMatch(/counters\.processed = counters\.processed \+ :one/);
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

    it('PR #339 review: rejects on terminal jobs (ConditionalCheckFailed → ConflictException) — a delayed worker call after markCompleted MUST NOT mutate counters', async () => {
      // Worker reads the row (still sees "running" in its local view),
      // then by the time UpdateItem fires the row has already
      // terminalized (status=succeeded). The ConditionExpression rejects
      // the write, DynamoDBClientService translates
      // ConditionalCheckFailedException → ConflictException, the worker
      // sees the race and drops the batch.
      dynamoDBClient.getItem.mockResolvedValue(makeJob({ status: 'running' }));
      dynamoDBClient.updateItem.mockRejectedValue(
        new ConflictException('Record was modified by another request. Please retry.'),
      );

      await expect(
        service.appendFailedStudent(JOB_ID, 'student-uuid', 'race', ctx()),
      ).rejects.toThrow(ConflictException);
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
      await service.incrementCounter(JOB_ID, 'processed', 0, ctx());
      await service.incrementCounter(JOB_ID, 'processed', -5, ctx());
      expect(dynamoDBClient.updateItem).not.toHaveBeenCalled();
    });

    it('PR #339 review: rejects on terminal jobs status=succeeded (ConditionalCheckFailed → ConflictException) — late worker batch MUST NOT corrupt the final counter snapshot', async () => {
      dynamoDBClient.updateItem.mockRejectedValue(
        new ConflictException('Record was modified by another request. Please retry.'),
      );
      await expect(
        service.incrementCounter(JOB_ID, 'processed', 5, ctx()),
      ).rejects.toThrow(ConflictException);
    });

    it('PR #339 review: rejects on terminal jobs status=failed — same race shape as succeeded', async () => {
      // Simulates the case where markFailed terminalized the job between
      // the worker reading the row and the increment landing.
      dynamoDBClient.updateItem.mockRejectedValue(
        new ConflictException('Record was modified by another request. Please retry.'),
      );
      await expect(
        service.incrementCounter(JOB_ID, 'succeeded', 10, ctx()),
      ).rejects.toThrow(ConflictException);
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
