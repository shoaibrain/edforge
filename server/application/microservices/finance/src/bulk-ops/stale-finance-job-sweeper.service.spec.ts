/**
 * StaleFinanceJobSweeper unit tests — Sprint §5d MVP.3.
 *
 * Mocks DynamoDBClientService (system client) + FinanceMetricsService.
 * Pattern follows the OverdueDetectionService precedent (same module,
 * same getSystemClient + ScanCommand shape) + the F.2 S3Service mock-
 * class-as-constructor approach.
 *
 * Critical contracts being guarded:
 *   1. Scan FilterExpression matches ONLY rows where
 *      begins_with(entityKey, 'FINANCE_JOB#') AND status='running' AND
 *      startedAt < now-120min. (FinanceJobEntity, S6.)
 *   2. Per-row UpdateItem carries ConditionExpression status='running'
 *      so a live worker that completes BETWEEN scan and update wins
 *      the race (sweeper update fails → no-op).
 *   3. errors field is OVERWRITTEN with a single sentinel entry (NOT
 *      list_append) — keeps the sweep reason unambiguous on operator
 *      inspection.
 *   4. DISABLE_STALE_JOB_SWEEPER=true skips both scan + update.
 *   5. Bootstrap MUST complete even if Scan or UpdateItem throws —
 *      bootstrap throwing prevents Nest from starting → finance dies.
 *   6. Metric `Edforge/Finance/Sweeper/StaleJobsSwept` emits the count
 *      of jobs ACTUALLY swept (race-lost rows excluded). Failure path
 *      emits `SweeperFailures: 1`.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { StaleFinanceJobSweeper } from './stale-finance-job-sweeper.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { FinanceMetricsService } from '../common/services/finance-metrics.service';

/**
 * The global jest.setup.js mocks '@aws-sdk/lib-dynamodb': command
 * constructors become factories returning `{ type: '<Name>Command',
 * params }` literals — `instanceof` can never hold and the payload lives
 * at `.params`, not `.input`. These helpers assert command NAME + payload
 * in a shape that works under the global mock AND against the real SDK
 * (if the mock is ever removed).
 */
const commandName = (cmd: any): string | undefined =>
  cmd?.type ?? cmd?.constructor?.name;
const commandInput = (cmd: any): any => cmd?.input ?? cmd?.params;

describe('StaleFinanceJobSweeper (MVP.3)', () => {
  let service: StaleFinanceJobSweeper;
  let mockSend: jest.Mock;
  let mockMetricsPut: jest.Mock;
  // MVP.5 — sentinel cleanup invokes DynamoDBClientService.deleteItem.
  // Captured separately so tests can assert delete-vs-no-delete behavior.
  let mockDeleteItem: jest.Mock;
  const ORIGINAL_ENV = process.env;

  function buildStaleJobRow(overrides: Record<string, unknown> = {}) {
    return {
      tenantId: 'tenant-A',
      entityKey: 'FINANCE_JOB#job-stale-1',
      entityType: 'FINANCE_JOB',
      jobId: 'job-stale-1',
      schoolId: 'school-A',
      jobType: 'bulk_invoice_generate',
      status: 'running',
      counters: { requested: 50, succeeded: 0, failed: 0, skipped: 0 },
      failedStudentIds: [],
      errors: [],
      // 3 hours ago — well past the 120-min threshold
      startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      version: 2,
      ...overrides,
    };
  }

  beforeEach(async () => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.DISABLE_STALE_JOB_SWEEPER;

    mockSend = jest.fn();
    mockMetricsPut = jest.fn();
    mockDeleteItem = jest.fn().mockResolvedValue(undefined);

    const mockDynamoClient = {
      send: mockSend,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaleFinanceJobSweeper,
        {
          provide: DynamoDBClientService,
          useValue: {
            getSystemClient: jest.fn().mockReturnValue(mockDynamoClient),
            getTableName: jest.fn().mockReturnValue('edforge-finance-basic'),
            // MVP.5 — sentinel cleanup helper on successful sweep
            deleteItem: mockDeleteItem,
          },
        },
        {
          provide: FinanceMetricsService,
          useValue: { put: mockMetricsPut },
        },
      ],
    }).compile();

    service = module.get<StaleFinanceJobSweeper>(StaleFinanceJobSweeper);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  // ============================================================
  // Happy path — stale row swept
  // ============================================================
  describe('stale running job (>120 min old)', () => {
    it('issues a conditional UpdateItem with status=failed + sentinel error', async () => {
      const stale = buildStaleJobRow();
      mockSend
        .mockResolvedValueOnce({ Items: [stale] })  // ScanCommand
        .mockResolvedValueOnce({});                  // UpdateCommand

      await service.onApplicationBootstrap();

      // PR #358 P2 fix-up: 2 sends for running-sweep (scan + update) + 1
      // additional scan for the queued-orphan sweep (which finds nothing
      // because no mock was supplied — Items defaults to undefined → 0 cands).
      expect(mockSend).toHaveBeenCalledTimes(3);

      const updateCall = mockSend.mock.calls[1][0];
      expect(commandName(updateCall)).toBe('UpdateCommand');
      const updateInput = commandInput(updateCall);
      expect(updateInput).toMatchObject({
        TableName: 'edforge-finance-basic',
        Key: { tenantId: 'tenant-A', entityKey: 'FINANCE_JOB#job-stale-1' },
        ConditionExpression: '#status = :running',
      });
      // The errors array is overwritten with a single sentinel entry
      // (NOT list_append) — guarding the unambiguous-reason invariant.
      expect(updateInput.ExpressionAttributeValues[':errors']).toHaveLength(1);
      expect(updateInput.ExpressionAttributeValues[':errors'][0].message).toContain(
        'task_replaced_before_completion',
      );
      expect(updateInput.ExpressionAttributeValues[':failed']).toBe('failed');
      expect(updateInput.ExpressionAttributeValues[':running']).toBe('running');
    });

    it('emits StaleJobsSwept metric with count = 1', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: [buildStaleJobRow()] })
        .mockResolvedValueOnce({});

      await service.onApplicationBootstrap();

      expect(mockMetricsPut).toHaveBeenCalledWith({
        namespace: 'Edforge/Finance/Sweeper',
        metricName: 'StaleJobsSwept',
        value: 1,
      });
    });

    it('emits the metric with count = N when N rows swept', async () => {
      const rows = [
        buildStaleJobRow({ jobId: 'job-1', entityKey: 'FINANCE_JOB#job-1' }),
        buildStaleJobRow({ jobId: 'job-2', entityKey: 'FINANCE_JOB#job-2' }),
        buildStaleJobRow({ jobId: 'job-3', entityKey: 'FINANCE_JOB#job-3' }),
      ];
      mockSend.mockResolvedValueOnce({ Items: rows });
      // 3 UpdateCommands all succeed
      for (let i = 0; i < 3; i++) {
        mockSend.mockResolvedValueOnce({});
      }

      await service.onApplicationBootstrap();

      expect(mockSend).toHaveBeenCalledTimes(5); // 1 running-scan + 3 updates + 1 queued-scan (PR #358 P2)
      expect(mockMetricsPut).toHaveBeenCalledWith({
        namespace: 'Edforge/Finance/Sweeper',
        metricName: 'StaleJobsSwept',
        value: 3,
      });
    });
  });

  // ============================================================
  // Sprint §5d MVP.5 — sentinel cleanup
  //
  // The sweeper must clean up the active-export sentinel when it
  // successfully transitions a stuck `running` EXPORT job to `failed`.
  // It must NOT clean up when:
  //   - the job is a bulk_invoice_generate (no sentinel exists)
  //   - the UpdateCommand race-lost (live worker owns the sentinel)
  // It must NOT block the sweep when the sentinel delete itself fails.
  // ============================================================
  describe('MVP.5 — active-export sentinel cleanup', () => {
    it('deletes the sentinel for a swept EXPORT job (jobType=bulk_invoice_pdf_export)', async () => {
      const stale = buildStaleJobRow({
        jobType: 'bulk_invoice_pdf_export',
        schoolId: 'school-export-A',
      });
      mockSend
        .mockResolvedValueOnce({ Items: [stale] })
        .mockResolvedValueOnce({}); // UpdateCommand

      await service.onApplicationBootstrap();

      // 1 running-Scan + 1 UpdateCommand + 1 queued-Scan (PR #358 P2) via send;
      // 1 deleteItem for the sentinel.
      expect(mockSend).toHaveBeenCalledTimes(3);
      expect(mockDeleteItem).toHaveBeenCalledTimes(1);
      const [, tenantArg, sentinelKey] = mockDeleteItem.mock.calls[0];
      expect(tenantArg).toBe('tenant-A');
      expect(sentinelKey).toBe('FINANCE_ACTIVE_EXPORT#school-export-A');
    });

    it('deletes the sentinel for bulk_receipt_pdf_export too (jobType-agnostic per D1+D8)', async () => {
      const stale = buildStaleJobRow({ jobType: 'bulk_receipt_pdf_export' });
      mockSend
        .mockResolvedValueOnce({ Items: [stale] })
        .mockResolvedValueOnce({});

      await service.onApplicationBootstrap();

      expect(mockDeleteItem).toHaveBeenCalledTimes(1);
      const [, , sentinelKey] = mockDeleteItem.mock.calls[0];
      expect(sentinelKey).toBe(`FINANCE_ACTIVE_EXPORT#${stale.schoolId}`);
    });

    it('does NOT delete sentinel for bulk_invoice_generate jobs (no sentinel was ever created)', async () => {
      const stale = buildStaleJobRow({ jobType: 'bulk_invoice_generate' });
      mockSend
        .mockResolvedValueOnce({ Items: [stale] })
        .mockResolvedValueOnce({});

      await service.onApplicationBootstrap();

      expect(mockDeleteItem).not.toHaveBeenCalled();
      // Sweep still counted (the job itself was failed-transitioned).
      expect(mockMetricsPut).toHaveBeenCalledWith({
        namespace: 'Edforge/Finance/Sweeper',
        metricName: 'StaleJobsSwept',
        value: 1,
      });
    });

    it('does NOT delete sentinel on race-lost (live worker owns the cleanup)', async () => {
      const stale = buildStaleJobRow({ jobType: 'bulk_invoice_pdf_export' });
      mockSend.mockResolvedValueOnce({ Items: [stale] });
      const conditionalErr = new Error('The conditional request failed');
      conditionalErr.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(conditionalErr);

      await service.onApplicationBootstrap();

      // CRITICAL: live worker owns the sentinel; sweeper must NOT delete
      // (would race with the worker's own markCompleted-path delete).
      expect(mockDeleteItem).not.toHaveBeenCalled();
    });

    it('sentinel DELETE failure does NOT block sweep or change sweep count', async () => {
      const stale = buildStaleJobRow({ jobType: 'bulk_invoice_pdf_export' });
      mockSend
        .mockResolvedValueOnce({ Items: [stale] })
        .mockResolvedValueOnce({}); // UpdateCommand succeeds
      mockDeleteItem.mockRejectedValueOnce(new Error('DDB throttle'));

      // Sweep must complete normally; the failed sentinel delete is best-effort.
      await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();

      // Still counted as swept (the JOB transition succeeded).
      expect(mockMetricsPut).toHaveBeenCalledWith({
        namespace: 'Edforge/Finance/Sweeper',
        metricName: 'StaleJobsSwept',
        value: 1,
      });
    });
  });

  // ============================================================
  // PR #358 P2 fix-up — queued-export orphan recovery
  //
  // The MVP.5 sentinel is created atomically with the FinanceJob in
  // `create()` (status='queued'). The worker then calls markRunning
  // via setImmediate — sub-second handoff in the healthy case. If the
  // process dies in that window, the job stays `queued` and the
  // sentinel exists, but the original sweeper only recovered `running`
  // rows — school stays blocked until the 4h TTL clears the sentinel.
  // This block tests the recovery path.
  // ============================================================
  describe('PR #358 P2 — queued-export orphan recovery', () => {
    function buildOrphanedQueuedRow(overrides: Record<string, unknown> = {}) {
      return {
        tenantId: 'tenant-A',
        entityKey: 'FINANCE_JOB#job-queued-orphan-1',
        entityType: 'FINANCE_JOB',
        jobId: 'job-queued-orphan-1',
        schoolId: 'school-Q',
        jobType: 'bulk_invoice_pdf_export',
        status: 'queued',
        counters: { requested: 50, succeeded: 0, failed: 0, skipped: 0 },
        failedStudentIds: [],
        errors: [],
        // 20 min ago — past the 10-min queued threshold.
        createdAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        version: 1,
        ...overrides,
      };
    }

    it('sweeps an orphaned queued export (createdAt > 10 min ago) + cleans up sentinel', async () => {
      const orphan = buildOrphanedQueuedRow();
      // Mock sequence: running-scan empty, queued-scan returns orphan,
      // UpdateCommand for the orphan succeeds.
      mockSend
        .mockResolvedValueOnce({ Items: [] })         // running-scan (empty)
        .mockResolvedValueOnce({ Items: [orphan] })   // queued-scan
        .mockResolvedValueOnce({});                   // UpdateCommand

      await service.onApplicationBootstrap();

      // 1 running-scan + 1 queued-scan + 1 update.
      expect(mockSend).toHaveBeenCalledTimes(3);
      // Sentinel cleanup happened via deleteItem.
      expect(mockDeleteItem).toHaveBeenCalledTimes(1);
      const [, , sentinelKey] = mockDeleteItem.mock.calls[0];
      expect(sentinelKey).toBe('FINANCE_ACTIVE_EXPORT#school-Q');
      // Metric reflects 1 sweep.
      expect(mockMetricsPut).toHaveBeenCalledWith({
        namespace: 'Edforge/Finance/Sweeper',
        metricName: 'StaleJobsSwept',
        value: 1,
      });
    });

    it('UpdateCommand is conditional on status=queued (race-safe vs concurrent markRunning)', async () => {
      const orphan = buildOrphanedQueuedRow();
      mockSend
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce({ Items: [orphan] })
        .mockResolvedValueOnce({});

      await service.onApplicationBootstrap();

      const updateCmd = commandInput(mockSend.mock.calls[2][0]);
      expect(updateCmd.ConditionExpression).toBe('#status = :queued');
      expect(updateCmd.ExpressionAttributeValues[':failed']).toBe('failed');
      expect(updateCmd.ExpressionAttributeValues[':errors'][0].message).toContain(
        'queued_handoff_lost_before_markRunning',
      );
    });

    it('race-lost (worker won markRunning between scan and update) → no-op + no sentinel delete', async () => {
      const orphan = buildOrphanedQueuedRow();
      const condErr = new Error('The conditional request failed');
      condErr.name = 'ConditionalCheckFailedException';

      mockSend
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce({ Items: [orphan] })
        .mockRejectedValueOnce(condErr);

      await service.onApplicationBootstrap();

      expect(mockDeleteItem).not.toHaveBeenCalled();
      // Not counted in metric — UpdateCommand failed, sweep didn't take effect.
      expect(mockMetricsPut).toHaveBeenCalledWith({
        namespace: 'Edforge/Finance/Sweeper',
        metricName: 'StaleJobsSwept',
        value: 0,
      });
    });

    it('non-export queued job (bulk_invoice_generate) is still recovered but sentinel cleanup skipped', async () => {
      // bulk_invoice_generate doesn't use the active-export sentinel, but
      // it CAN still be stuck queued (its own race window). Sweep it for
      // job-level UX recovery; skip sentinel-cleanup since none exists.
      const orphan = buildOrphanedQueuedRow({ jobType: 'bulk_invoice_generate' });
      mockSend
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce({ Items: [orphan] })
        .mockResolvedValueOnce({});

      await service.onApplicationBootstrap();

      expect(mockSend).toHaveBeenCalledTimes(3);
      // No sentinel delete for non-export job.
      expect(mockDeleteItem).not.toHaveBeenCalled();
    });

    it('running + queued sweeps in one pass — total counted in metric', async () => {
      const staleRunning = {
        tenantId: 'tenant-A',
        entityKey: 'FINANCE_JOB#job-running-stale',
        entityType: 'FINANCE_JOB',
        jobId: 'job-running-stale',
        schoolId: 'school-R',
        jobType: 'bulk_invoice_pdf_export',
        status: 'running',
        counters: { requested: 50, succeeded: 0, failed: 0, skipped: 0 },
        failedStudentIds: [],
        errors: [],
        startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        version: 2,
      };
      const orphan = buildOrphanedQueuedRow();

      mockSend
        .mockResolvedValueOnce({ Items: [staleRunning] }) // running-scan
        .mockResolvedValueOnce({})                        // running update
        .mockResolvedValueOnce({ Items: [orphan] })       // queued-scan
        .mockResolvedValueOnce({});                       // queued update

      await service.onApplicationBootstrap();

      expect(mockSend).toHaveBeenCalledTimes(4);
      // Both swept; both sentinels deleted.
      expect(mockDeleteItem).toHaveBeenCalledTimes(2);
      // Metric sum = 1 (running) + 1 (queued) = 2.
      expect(mockMetricsPut).toHaveBeenCalledWith({
        namespace: 'Edforge/Finance/Sweeper',
        metricName: 'StaleJobsSwept',
        value: 2,
      });
    });
  });

  // ============================================================
  // Empty result — nothing stale
  // ============================================================
  describe('no stale rows', () => {
    it('issues a Scan but NO UpdateItem; metric emits 0', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      await service.onApplicationBootstrap();

      // 1 running-scan + 1 queued-scan (PR #358 P2); both ScanCommand.
      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(commandName(mockSend.mock.calls[0][0])).toBe('ScanCommand');
      expect(commandName(mockSend.mock.calls[1][0])).toBe('ScanCommand');
      expect(mockMetricsPut).toHaveBeenCalledWith({
        namespace: 'Edforge/Finance/Sweeper',
        metricName: 'StaleJobsSwept',
        value: 0,
      });
    });

    it('handles missing Items field (DDB returns no key) without crashing', async () => {
      mockSend.mockResolvedValueOnce({}); // no Items key

      await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
      expect(mockMetricsPut).toHaveBeenCalledWith({
        namespace: 'Edforge/Finance/Sweeper',
        metricName: 'StaleJobsSwept',
        value: 0,
      });
    });
  });

  // ============================================================
  // Race-lost (worker completed between scan and update)
  // ============================================================
  describe('race-lost — worker completed between Scan and UpdateItem', () => {
    it('treats ConditionalCheckFailedException as a no-op (not counted as swept)', async () => {
      const stale = buildStaleJobRow();
      mockSend.mockResolvedValueOnce({ Items: [stale] });

      const conditionalErr = new Error('The conditional request failed');
      conditionalErr.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(conditionalErr);

      await service.onApplicationBootstrap();

      expect(mockMetricsPut).toHaveBeenCalledWith({
        namespace: 'Edforge/Finance/Sweeper',
        metricName: 'StaleJobsSwept',
        value: 0, // not 1 — the UpdateItem race-lost is not counted
      });
    });

    it('mixed batch — some swept, some race-lost; metric reflects ACTUAL count', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          buildStaleJobRow({ jobId: 'job-1', entityKey: 'FINANCE_JOB#job-1' }),
          buildStaleJobRow({ jobId: 'job-2', entityKey: 'FINANCE_JOB#job-2' }),
          buildStaleJobRow({ jobId: 'job-3', entityKey: 'FINANCE_JOB#job-3' }),
        ],
      });
      const conditionalErr = new Error('The conditional request failed');
      conditionalErr.name = 'ConditionalCheckFailedException';

      mockSend
        .mockResolvedValueOnce({})           // job-1 swept
        .mockRejectedValueOnce(conditionalErr) // job-2 race-lost
        .mockResolvedValueOnce({});           // job-3 swept

      await service.onApplicationBootstrap();

      expect(mockMetricsPut).toHaveBeenCalledWith({
        namespace: 'Edforge/Finance/Sweeper',
        metricName: 'StaleJobsSwept',
        value: 2, // job-1 + job-3
      });
    });
  });

  // ============================================================
  // Per-row non-conditional failure — log + continue
  // ============================================================
  describe('per-row throw (non-ConditionalCheckFailedException)', () => {
    it('logs error, continues with remaining rows, does NOT throw out of bootstrap', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          buildStaleJobRow({ jobId: 'job-1', entityKey: 'FINANCE_JOB#job-1' }),
          buildStaleJobRow({ jobId: 'job-2', entityKey: 'FINANCE_JOB#job-2' }),
        ],
      });
      mockSend
        .mockRejectedValueOnce(new Error('ProvisionedThroughputExceededException'))
        .mockResolvedValueOnce({});

      // Must NOT throw — bootstrap must complete
      await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();

      // Only job-2 was swept
      expect(mockMetricsPut).toHaveBeenCalledWith({
        namespace: 'Edforge/Finance/Sweeper',
        metricName: 'StaleJobsSwept',
        value: 1,
      });
    });
  });

  // ============================================================
  // Catch-all — Scan itself fails
  // ============================================================
  describe('Scan failure (DDB unavailable)', () => {
    it('emits SweeperFailures metric + returns normally (no throw out of bootstrap)', async () => {
      mockSend.mockRejectedValueOnce(new Error('AWS service unavailable'));

      await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();

      expect(mockMetricsPut).toHaveBeenCalledWith({
        namespace: 'Edforge/Finance/Sweeper',
        metricName: 'SweeperFailures',
        value: 1,
      });
      // The success-path StaleJobsSwept metric is NOT emitted on failure
      expect(mockMetricsPut).not.toHaveBeenCalledWith(
        expect.objectContaining({ metricName: 'StaleJobsSwept' }),
      );
    });
  });

  // ============================================================
  // Disable flag
  // ============================================================
  describe('DISABLE_STALE_JOB_SWEEPER env var', () => {
    it('is fully a no-op when set to "true" — no Scan, no UpdateItem, no metric', async () => {
      process.env.DISABLE_STALE_JOB_SWEEPER = 'true';

      await service.onApplicationBootstrap();

      expect(mockSend).not.toHaveBeenCalled();
      expect(mockMetricsPut).not.toHaveBeenCalled();
    });

    it('runs normally when set to anything other than "true" (e.g. "false", "0", empty)', async () => {
      process.env.DISABLE_STALE_JOB_SWEEPER = 'false';
      mockSend.mockResolvedValueOnce({ Items: [] });

      await service.onApplicationBootstrap();

      // 1 running-scan + 1 queued-scan (PR #358 P2) both fire when not disabled.
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================
  // Optional metrics dep (FinanceMetricsService can be absent)
  //
  // Pattern note: Nest DI treats a `metrics?:` param as REQUIRED unless
  // @Optional()-decorated; the E.4 worker (this codebase's precedent for
  // `private readonly metrics?: FinanceMetricsService`) handles the
  // optional case via MANUAL CONSTRUCTION rather than Test.createTestingModule
  // (see bulk-invoice-generate.worker.ts:117-120 comment). Mirror that
  // pattern here — instantiate with `new` and omit the metrics arg.
  // ============================================================
  describe('FinanceMetricsService optional', () => {
    it('functions without the metrics dep (no crash; just no CW emission)', async () => {
      const mockDynamoClientService = {
        getSystemClient: jest.fn().mockReturnValue({ send: mockSend }),
        getTableName: jest.fn().mockReturnValue('edforge-finance-basic'),
        // MVP.5 — deleteItem is invoked when an export job is swept;
        // include it here so the manual-construction path doesn't crash
        // if/when this test grows to cover export-job sweeping.
        deleteItem: jest.fn().mockResolvedValue(undefined),
      };
      // Manual construction — omitting the metrics arg lets us exercise
      // the `metrics?.put(...)` optional-chain branch.
      const svcNoMetrics = new StaleFinanceJobSweeper(
        mockDynamoClientService as unknown as DynamoDBClientService,
        // metrics intentionally undefined
      );

      mockSend.mockResolvedValueOnce({ Items: [] });

      await expect(svcNoMetrics.onApplicationBootstrap()).resolves.toBeUndefined();
    });
  });
});
