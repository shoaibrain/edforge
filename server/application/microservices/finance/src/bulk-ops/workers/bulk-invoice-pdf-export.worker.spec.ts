/**
 * BulkInvoicePdfExportWorker unit tests — Sprint F.3.
 *
 * Mocks the 8 ctor deps + archiver + renderInvoiceToPdfBuffer.
 * Pattern: class-based archiver mock (so `archiver('zip', opts)` returns
 * an instance whose `.append` / `.finalize` / `.on` are inspectable),
 * jest.fn for the rest.
 *
 * Contracts pinned:
 *   - Lock acquired before markRunning; released in finally.
 *   - One-time getCurrentTemplate + getBranding (NOT per-invoice).
 *   - Per-invoice render → archiver.append called with correct name.
 *   - Per-invoice failure → appendFailedInvoice + continue; bad PDF not in archive.
 *   - All-fail (succeeded === 0, failed > 0) → markFailed (not markCompleted).
 *   - markCompleted carries output.zipKey + zipUrl + urlExpiresAt + counters.
 *   - url_minted audit emit with SHA256(zipKey) as presignedKeyHash.
 *   - Catastrophe (markRunning fails, template fetch fails, S3 upload fails)
 *     → markFailed, NEVER throw out of run().
 *   - Counter batching: succeeded counter flushed every 25 invoices + at end.
 */

import { Logger } from '@nestjs/common';
import { BulkInvoicePdfExportWorker } from './bulk-invoice-pdf-export.worker';
import { renderInvoiceToPdfBuffer } from '../../invoices/invoice-pdf.renderer';

jest.mock('../../invoices/invoice-pdf.renderer');

// archiver is a callable default export; jest auto-mock doesn't preserve
// callable shape, so provide an explicit factory. jest.mock() is hoisted,
// so the factory can't reference outer variables — instead, instantiate
// the jest.fn() INSIDE the factory and retrieve the reference below via
// jest.requireMock for use in tests.
jest.mock('archiver', () => ({
  __esModule: true,
  default: jest.fn(),
}));
const mockArchiverFn = jest.requireMock('archiver').default as jest.Mock;

const TENANT = 'tenant-A';
const SCHOOL = 'school-A';
const JOB = 'job-1';
const OPERATOR = 'op-A';
const JWT = 'jwt-A';

function ctx(): any {
  return {
    tenantId: TENANT,
    userId: OPERATOR,
    email: 'op@example.com',
    role: 'TenantAdmin',
    jwtToken: JWT,
    schoolId: SCHOOL,
  };
}

function makeInvoice(id: string, overrides: any = {}) {
  return {
    invoiceId: id,
    invoiceNumber: `INV-${id}`,
    schoolId: SCHOOL,
    schoolName: 'Test School',
    studentId: `stu-${id}`,
    studentName: `Student ${id}`,
    issuedDate: '2026-06-30',
    dueDate: '2026-07-30',
    academicYear: '2026-2027',
    billingPeriod: 'Term 1',
    status: 'issued',
    totalAmount: 1000,
    amountPaid: 0,
    amountDue: 1000,
    lineItems: [],
    ...overrides,
  };
}

describe('BulkInvoicePdfExportWorker (F.3)', () => {
  let worker: BulkInvoicePdfExportWorker;
  let jobs: any;
  let audit: any;
  let invoices: any;
  let identity: any;
  let s3: any;
  let lock: any;
  let bucket: any;
  let metrics: any;
  let lockRelease: jest.Mock;
  let bucketRelease: jest.Mock;
  let mockArchive: any;
  let archiveAppend: jest.Mock;
  let archiveFinalize: jest.Mock;
  let archiveOn: jest.Mock;
  let archiveAbort: jest.Mock;
  const mockRender = renderInvoiceToPdfBuffer as jest.Mock;
  // Use the module-scoped mockArchiverFn directly — `archiver` import resolves to it.
  const mockArchiver = mockArchiverFn;

  beforeEach(() => {
    // CRITICAL: module-scoped jest mocks accumulate calls across tests.
    // Clear renderer + archiver mocks at the top of every test to keep
    // toHaveBeenCalledTimes assertions deterministic.
    mockRender.mockReset();
    mockArchiver.mockReset();

    lockRelease = jest.fn();
    bucketRelease = jest.fn();
    archiveAppend = jest.fn();
    archiveFinalize = jest.fn().mockResolvedValue(undefined);
    archiveOn = jest.fn();
    archiveAbort = jest.fn();
    mockArchive = {
      append: archiveAppend,
      finalize: archiveFinalize,
      on: archiveOn,
      abort: archiveAbort,
    };
    mockArchiver.mockReturnValue(mockArchive);
    mockRender.mockResolvedValue(Buffer.from('fake-pdf'));

    jobs = {
      markRunning: jest.fn().mockResolvedValue(undefined),
      markCompleted: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
      appendFailedInvoice: jest.fn().mockResolvedValue(undefined),
      incrementCounter: jest.fn().mockResolvedValue(undefined),
    };
    audit = { emit: jest.fn().mockResolvedValue(undefined) };
    invoices = {
      getEntity: jest.fn().mockImplementation((sid, id) => Promise.resolve(makeInvoice(id))),
    };
    identity = {
      getCurrentTemplate: jest.fn().mockResolvedValue({
        docType: 'INVOICE',
        templateConfig: { labelLanguages: ['en'], lineItemColumns: [] },
        source: 'persisted',
      }),
      getBranding: jest.fn().mockResolvedValue({ branding: null, urls: undefined }),
    };
    s3 = {
      putZip: jest.fn().mockResolvedValue(undefined),
      presignGet: jest.fn().mockResolvedValue('https://signed-url'),
    };
    lock = {
      acquire: jest.fn().mockResolvedValue({ release: lockRelease }),
    };
    bucket = {
      getLimit: jest.fn().mockReturnValue(4),
      acquire: jest.fn().mockResolvedValue({ release: bucketRelease }),
    };
    metrics = { put: jest.fn() };

    worker = new BulkInvoicePdfExportWorker(
      jobs, audit, invoices, identity, s3, lock, bucket, metrics,
    );
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  // ─────────────────────────────────────────────────────────────────
  // Happy path — small fixture (3 invoices, all succeed)
  // ─────────────────────────────────────────────────────────────────
  describe('happy path (3 invoices, all succeed)', () => {
    const ids = ['inv-1', 'inv-2', 'inv-3'];

    it('acquires lock BEFORE markRunning and releases in finally', async () => {
      const callOrder: string[] = [];
      lock.acquire.mockImplementation(async () => {
        callOrder.push('lock.acquire');
        return { release: () => callOrder.push('lock.release') };
      });
      jobs.markRunning.mockImplementation(async () => {
        callOrder.push('markRunning');
      });

      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids }, ctx());

      expect(callOrder[0]).toBe('lock.acquire');
      expect(callOrder[1]).toBe('markRunning');
      expect(callOrder[callOrder.length - 1]).toBe('lock.release');
    });

    it('fetches template + branding ONCE (not per-invoice)', async () => {
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids }, ctx());

      expect(identity.getCurrentTemplate).toHaveBeenCalledTimes(1);
      expect(identity.getBranding).toHaveBeenCalledTimes(1);
      expect(mockRender).toHaveBeenCalledTimes(3);
    });

    it('calls archive.append(buffer, {name: `${invoiceNumber}.pdf`}) per success', async () => {
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids }, ctx());

      expect(archiveAppend).toHaveBeenCalledTimes(3);
      const names = archiveAppend.mock.calls.map((c) => c[1].name);
      expect(names).toEqual(expect.arrayContaining(['INV-inv-1.pdf', 'INV-inv-2.pdf', 'INV-inv-3.pdf']));
    });

    it('starts S3 upload BEFORE the loop (concurrent with appends)', async () => {
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids }, ctx());

      // putZip received the archive stream as Body — implicit via params
      // shape; assert the call happened with the right key + tenant.
      const [tenantArg, jwtArg, keyArg] = s3.putZip.mock.calls[0];
      expect(tenantArg).toBe(TENANT);
      expect(jwtArg).toBe(JWT);
      expect(keyArg).toBe(`tenants/${TENANT}/schools/${SCHOOL}/pdf-jobs/${JOB}/invoices.zip`);
    });

    it('finalizes archive + awaits S3 upload + mints presigned URL', async () => {
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids }, ctx());

      expect(archiveFinalize).toHaveBeenCalledTimes(1);
      expect(s3.putZip).toHaveBeenCalledTimes(1);
      expect(s3.presignGet).toHaveBeenCalledWith(
        TENANT,
        JWT,
        `tenants/${TENANT}/schools/${SCHOOL}/pdf-jobs/${JOB}/invoices.zip`,
        900,
      );
    });

    it('markCompleted with output.zipKey + zipUrl + urlExpiresAt + counter snapshot', async () => {
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids }, ctx());

      expect(jobs.markCompleted).toHaveBeenCalledTimes(1);
      const [jobIdArg, completion] = jobs.markCompleted.mock.calls[0];
      expect(jobIdArg).toBe(JOB);
      expect(completion.output.zipKey).toBe(
        `tenants/${TENANT}/schools/${SCHOOL}/pdf-jobs/${JOB}/invoices.zip`,
      );
      expect(completion.output.zipUrl).toBe('https://signed-url');
      expect(completion.output.urlExpiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(completion.counters).toEqual({ succeeded: 3, failed: 0, skipped: 0 });
    });

    it('emits finance.bulk_export.url_minted with SHA256(zipKey) as presignedKeyHash', async () => {
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids }, ctx());

      expect(audit.emit).toHaveBeenCalledWith(
        'finance.bulk_export.url_minted',
        expect.objectContaining({
          jobId: JOB,
          schoolId: SCHOOL,
          invoiceCount: 3,
          format: 'zip',
          presignedKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        expect.any(Object),
      );
      // CRITICAL: URL is never in the audit payload (§0.3 — hash, not URL).
      const payload = audit.emit.mock.calls[0][1];
      expect(JSON.stringify(payload)).not.toContain('signed-url');
    });

    it('does NOT call markFailed when all invoices succeed', async () => {
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids }, ctx());
      expect(jobs.markFailed).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Per-invoice failure isolation
  // ─────────────────────────────────────────────────────────────────
  describe('per-invoice failure isolation', () => {
    it('one render fails → appendFailedInvoice called; other 2 still in archive', async () => {
      const ids = ['inv-1', 'inv-2', 'inv-3'];
      mockRender.mockImplementation(async ({ invoice }) => {
        if (invoice.invoiceId === 'inv-2') throw new Error('PDF render failure');
        return Buffer.from('fake-pdf');
      });

      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids }, ctx());

      expect(jobs.appendFailedInvoice).toHaveBeenCalledTimes(1);
      const [appendJob, appendId, appendMsg] = jobs.appendFailedInvoice.mock.calls[0];
      expect(appendJob).toBe(JOB);
      expect(appendId).toBe('inv-2');
      expect(appendMsg).toContain('PDF render failure');
      // The failed invoice is NOT in the archive — only 2 appends happened.
      expect(archiveAppend).toHaveBeenCalledTimes(2);
      // Job still ends as `succeeded` (partial success path).
      expect(jobs.markCompleted).toHaveBeenCalledTimes(1);
      expect(jobs.markFailed).not.toHaveBeenCalled();
      const completion = jobs.markCompleted.mock.calls[0][1];
      expect(completion.counters).toEqual({ succeeded: 2, failed: 1, skipped: 0 });
    });

    it('getEntity failure for one invoice → appendFailedInvoice + others succeed', async () => {
      const ids = ['inv-1', 'inv-2'];
      invoices.getEntity.mockImplementation(async (sid: string, id: string) => {
        if (id === 'inv-1') throw new Error('Invoice not found');
        return makeInvoice(id);
      });

      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids }, ctx());

      expect(jobs.appendFailedInvoice).toHaveBeenCalledTimes(1);
      expect(archiveAppend).toHaveBeenCalledTimes(1);
      expect(jobs.markCompleted).toHaveBeenCalledTimes(1);
    });

    it('appendFailedInvoice itself throwing does NOT propagate (worker swallows + logs)', async () => {
      const ids = ['inv-1'];
      mockRender.mockRejectedValueOnce(new Error('render fail'));
      jobs.appendFailedInvoice.mockRejectedValueOnce(new Error('DDB conflict'));

      await expect(
        worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids }, ctx()),
      ).resolves.toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // All-fail path
  // ─────────────────────────────────────────────────────────────────
  describe('all-fail (succeeded === 0)', () => {
    it('calls markFailed (not markCompleted) and does NOT mint a URL', async () => {
      mockRender.mockRejectedValue(new Error('total render meltdown'));

      await worker.run(
        JOB,
        { schoolId: SCHOOL, invoiceIds: ['inv-1', 'inv-2'] },
        ctx(),
      );

      expect(jobs.markCompleted).not.toHaveBeenCalled();
      expect(jobs.markFailed).toHaveBeenCalledTimes(1);
      const reason = jobs.markFailed.mock.calls[0][1];
      expect(reason).toMatch(/All 2 invoices failed render/);
      expect(s3.presignGet).not.toHaveBeenCalled();
      expect(audit.emit).not.toHaveBeenCalledWith(
        'finance.bulk_export.url_minted',
        expect.anything(),
        expect.anything(),
      );
      // Best-effort archive cleanup.
      expect(archiveAbort).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Catastrophe paths — markFailed + no throw out of run()
  // ─────────────────────────────────────────────────────────────────
  describe('catastrophe handling', () => {
    it('markRunning fails → markFailed + no throw', async () => {
      jobs.markRunning.mockRejectedValueOnce(new Error('DDB conflict'));

      await expect(
        worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ['inv-1'] }, ctx()),
      ).resolves.toBeUndefined();

      expect(jobs.markFailed).toHaveBeenCalledTimes(1);
      expect(jobs.markFailed.mock.calls[0][1]).toMatch(/DDB conflict/);
    });

    it('template fetch fails → markFailed + no throw', async () => {
      identity.getCurrentTemplate.mockRejectedValueOnce(new Error('Identity 503'));

      await expect(
        worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ['inv-1'] }, ctx()),
      ).resolves.toBeUndefined();

      expect(jobs.markFailed).toHaveBeenCalledTimes(1);
      expect(jobs.markCompleted).not.toHaveBeenCalled();
    });

    it('S3 upload fails → markFailed + no throw + no url_minted emit', async () => {
      s3.putZip.mockRejectedValueOnce(new Error('S3 access denied'));

      await expect(
        worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ['inv-1'] }, ctx()),
      ).resolves.toBeUndefined();

      expect(jobs.markFailed).toHaveBeenCalledTimes(1);
      expect(audit.emit).not.toHaveBeenCalledWith(
        'finance.bulk_export.url_minted',
        expect.anything(),
        expect.anything(),
      );
    });

    it('branding fetch fails → DEGRADED (null branding), worker still succeeds', async () => {
      identity.getBranding.mockRejectedValueOnce(new Error('Identity down'));

      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ['inv-1'] }, ctx());

      expect(jobs.markCompleted).toHaveBeenCalledTimes(1);
      // Renderer received branding=null per the degraded fallback.
      expect(mockRender.mock.calls[0][0].branding).toBeNull();
    });

    it('lock released in finally even when markRunning throws', async () => {
      jobs.markRunning.mockRejectedValueOnce(new Error('boom'));
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ['inv-1'] }, ctx());
      expect(lockRelease).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Bucket integration
  // ─────────────────────────────────────────────────────────────────
  describe('PdfRenderConcurrencyBucket integration', () => {
    it('acquires + releases bucket slot per invoice', async () => {
      const ids = ['inv-1', 'inv-2'];
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids }, ctx());

      expect(bucket.acquire).toHaveBeenCalledTimes(2);
      expect(bucketRelease).toHaveBeenCalledTimes(2);
    });

    it('releases bucket slot even when render throws (try/finally)', async () => {
      const ids = ['inv-1'];
      mockRender.mockRejectedValueOnce(new Error('render fail'));
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids }, ctx());
      expect(bucketRelease).toHaveBeenCalledTimes(1);
    });

    it('reads concurrency from bucket.getLimit (not env directly)', async () => {
      bucket.getLimit.mockReturnValueOnce(40);
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ['inv-1'] }, ctx());
      expect(bucket.getLimit).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Counter batching (mirror of E.4 pattern)
  // ─────────────────────────────────────────────────────────────────
  describe('counter batching', () => {
    // Force serial processing for these tests — with the default mock-mode
    // (instant-resolve promises) and N>1 workers, the worker race can
    // cause the mid-flush to capture more invoices than the batch size
    // (workers race ahead of the check). In prod the per-invoice work
    // takes ms-to-seconds and the race doesn't manifest. Serial mode
    // (concurrency=1) makes the test deterministic without changing the
    // production behavior the test is meant to pin (flush-every-25 +
    // trailing partial).
    beforeEach(() => {
      bucket.getLimit.mockReturnValue(1);
    });

    it('flushes succeeded counter every 25 invoices + at end for trailing partial', async () => {
      // 27 invoices: should flush 25 mid-loop + 2 at end = 2 calls.
      const ids = Array.from({ length: 27 }, (_, i) => `inv-${i}`);
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids }, ctx());

      expect(jobs.incrementCounter).toHaveBeenCalledTimes(2);
      // First call: 25 from the mid-loop flush
      expect(jobs.incrementCounter.mock.calls[0]).toEqual([JOB, 'succeeded', 25, expect.any(Object)]);
      // Second call: 2 from the final flush
      expect(jobs.incrementCounter.mock.calls[1]).toEqual([JOB, 'succeeded', 2, expect.any(Object)]);
    });

    it('no final flush when N % 25 === 0', async () => {
      const ids = Array.from({ length: 25 }, (_, i) => `inv-${i}`);
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids }, ctx());

      // Only the mid-loop flush of 25; no trailing partial.
      expect(jobs.incrementCounter).toHaveBeenCalledTimes(1);
      expect(jobs.incrementCounter.mock.calls[0]).toEqual([JOB, 'succeeded', 25, expect.any(Object)]);
    });

    it('total succeeded flushed === total succeeded (race-tolerant — N=50 default concurrency)', async () => {
      // Belt + suspenders: assert TOTAL flushed equals N regardless of
      // how the mid-loop / final flushes split it. Pins the correctness
      // invariant (no double-counting, no lost increments) without
      // pinning the exact call count which depends on the race.
      bucket.getLimit.mockReturnValue(4);
      const ids = Array.from({ length: 50 }, (_, i) => `inv-${i}`);
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids }, ctx());

      const totalFlushed = jobs.incrementCounter.mock.calls
        .filter((c: any[]) => c[1] === 'succeeded')
        .reduce((sum: number, c: any[]) => sum + (c[2] as number), 0);
      expect(totalFlushed).toBe(50);
    });

    it('incrementCounter failure does NOT abort the worker (best-effort)', async () => {
      const ids = Array.from({ length: 25 }, (_, i) => `inv-${i}`);
      jobs.incrementCounter.mockRejectedValueOnce(new Error('DDB conflict'));

      await expect(
        worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids }, ctx()),
      ).resolves.toBeUndefined();
      expect(jobs.markCompleted).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Metrics emission
  // ─────────────────────────────────────────────────────────────────
  describe('metrics emission (FinanceMetricsService optional)', () => {
    it('emits per-stage timings + JobTotalLatencyMs on success', async () => {
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ['inv-1'] }, ctx());

      const names = metrics.put.mock.calls.map((c: any) => c[0].metricName);
      expect(names).toEqual(
        expect.arrayContaining([
          'TemplateFetchLatencyMs',
          'BrandingFetchLatencyMs',
          'PerInvoiceLatencyMs',
          'ArchiveFinalizeLatencyMs',
          'S3UploadLatencyMs',
          'JobTotalLatencyMs',
        ]),
      );
    });

    it('emits JobTotalLatencyMs even on catastrophe', async () => {
      jobs.markRunning.mockRejectedValueOnce(new Error('boom'));
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ['inv-1'] }, ctx());

      const names = metrics.put.mock.calls.map((c: any) => c[0].metricName);
      expect(names).toContain('JobTotalLatencyMs');
    });

    it('works without metrics dep (no crash; manual construction)', async () => {
      const noMetricsWorker = new BulkInvoicePdfExportWorker(
        jobs, audit, invoices, identity, s3, lock, bucket, /* metrics */ undefined,
      );
      await expect(
        noMetricsWorker.run(JOB, { schoolId: SCHOOL, invoiceIds: ['inv-1'] }, ctx()),
      ).resolves.toBeUndefined();
    });
  });
});
