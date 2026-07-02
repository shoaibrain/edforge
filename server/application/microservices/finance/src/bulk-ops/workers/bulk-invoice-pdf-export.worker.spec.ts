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
import {
  prewarmInvoiceRenderer,
  renderInvoiceToPdfBuffer,
} from '../../invoices/invoice-pdf.renderer';

// Mock both the prewarm + render. The auto-mock factory below provides
// `__esModule:true` for the TypeScript-emitted barrel; explicit jest.fn()
// for each exported callable. F.7 added prewarmInvoiceRenderer; without
// the explicit factory entry, the import resolves to undefined → worker
// crashes calling undefined() at run() entry.
jest.mock('../../invoices/invoice-pdf.renderer', () => ({
  __esModule: true,
  prewarmInvoiceRenderer: jest.fn().mockResolvedValue(undefined),
  renderInvoiceToPdfBuffer: jest.fn(),
  __resetPrewarmForTest: jest.fn(),
}));

// archiver@7 is a CJS module whose `module.exports = archiver` IS a
// callable function — there is NO `.default` property at runtime. The
// worker imports it with TypeScript's CJS-interop syntax `import archiver
// = require('archiver')`, which lowers to a bare `require()`. The mock
// must therefore expose the callable AT THE MODULE ROOT (not under
// `.default`), or the worker calls `archiver_1.default(...)` against
// undefined and crashes — exactly the production failure surfaced in
// the dev-pabson-primary E2E on 2026-06-30.
//
// PR #359's original mock used `{__esModule:true, default: jest.fn()}`
// which matched the broken `import archiver from 'archiver'` emit but
// NOT the actual runtime — the unit suite passed against fiction,
// hiding the bug until live traffic exposed it. The runtime-contract
// spec (archiver-runtime.spec.ts) uses the REAL archiver and is the
// regression guard against future spec drift.
//
// jest.mock() is hoisted, so the factory can't reference outer
// variables — instantiate the jest.fn() INSIDE the factory and
// retrieve the reference below via jest.requireMock for use in tests.
jest.mock('archiver', () => jest.fn());
const mockArchiverFn = jest.requireMock('archiver') as jest.Mock;

// Sprint H.3 — mergePdfBuffers is called on the merged-PDF path with the
// per-invoice PDF buffers. The real helper parses each source buffer as a
// PDF via pdf-lib; our mocks return `Buffer.from('fake-pdf')` which would
// fail parse. Mock it to a jest.fn returning a fixed sentinel — spec
// coverage focuses on the WORKER's shape (buffers-in-order, upload key,
// audit format field), not on pdf-lib's internal behavior (which is
// covered by pdf-renderer's own merge-pdfs.spec.ts).
jest.mock('@aibrains/pdf-renderer', () => {
  const actual = jest.requireActual('@aibrains/pdf-renderer');
  return {
    ...actual,
    mergePdfBuffers: jest.fn(async () => Buffer.from('MERGED_FAKE_PDF')),
  };
});
const mockMergePdfBuffers = jest.requireMock('@aibrains/pdf-renderer')
  .mergePdfBuffers as jest.Mock;

// Plan §5d — the worker used to call sharp + fetch directly via a
// private `optimizeLogoForPdf` method. That logic moved into
// PdfLogoOptimizerService (see common/services/pdf-logo-optimizer.service.ts).
// This spec now mocks the SERVICE, not sharp/fetch — the service's own
// pixel-level correctness (transparent-PNG flatten, resize dims, JPEG
// encode) is covered by pdf-logo-optimizer.service.runtime.spec.ts.
//
// The mock returns a fixed data URI so per-invoice assertions can
// check "did the renderer receive the optimized URI vs the original
// S3 URL?" — same test intent as before, just at the shared-service
// boundary instead of the sharp boundary.
const MOCK_OPTIMIZED_DATA_URI =
  'data:image/jpeg;base64,MOCK_OPTIMIZED_LOGO_BYTES';
const mockPdfLogoOptimizerOptimize = jest.fn(
  async (logoUrl: string | undefined) =>
    logoUrl ? MOCK_OPTIMIZED_DATA_URI : undefined,
);

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
  const mockPrewarm = prewarmInvoiceRenderer as jest.Mock;
  // Use the module-scoped mockArchiverFn directly — `archiver` import resolves to it.
  const mockArchiver = mockArchiverFn;

  beforeEach(() => {
    // CRITICAL: module-scoped jest mocks accumulate calls across tests.
    // Clear renderer + archiver mocks at the top of every test to keep
    // toHaveBeenCalledTimes assertions deterministic.
    mockRender.mockReset();
    mockArchiver.mockReset();
    mockPrewarm.mockReset();
    mockPrewarm.mockResolvedValue(undefined);
    // Plan §5d — reset the injected optimizer between tests. Default
    // behavior is preserved (defined logoUrl → mock data URI; undefined
    // → undefined), individual tests can `mockRejectedValueOnce` etc.
    mockPdfLogoOptimizerOptimize.mockClear();
    mockPdfLogoOptimizerOptimize.mockImplementation(async (logoUrl) =>
      logoUrl ? MOCK_OPTIMIZED_DATA_URI : undefined,
    );

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
      // Sprint F.7 — archive.pipe(passthrough). The worker wraps the
      // archive in a Node-native PassThrough before passing to
      // s3Service.putZip so AWS SDK v3 lib-storage's instanceof check
      // succeeds. The mock just records the call; real piping is
      // covered by archiver-runtime.spec.ts (real archiver, real ZIP).
      pipe: jest.fn(),
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
      putPdf: jest.fn().mockResolvedValue(undefined),
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
      jobs, audit, invoices, identity, s3, lock, bucket,
      // Plan §5d — the shared optimizer service, injected between
      // `bucket` and the optional `metrics` param.
      { optimize: mockPdfLogoOptimizerOptimize } as any,
      metrics,
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

      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids, format: 'zip' }, ctx());

      expect(callOrder[0]).toBe('lock.acquire');
      expect(callOrder[1]).toBe('markRunning');
      expect(callOrder[callOrder.length - 1]).toBe('lock.release');
    });

    it('fetches template + branding ONCE (not per-invoice)', async () => {
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids, format: 'zip' }, ctx());

      expect(identity.getCurrentTemplate).toHaveBeenCalledTimes(1);
      expect(identity.getBranding).toHaveBeenCalledTimes(1);
      expect(mockRender).toHaveBeenCalledTimes(3);
    });

    it('calls archive.append(buffer, {name: `${invoiceNumber}.pdf`}) per success', async () => {
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids, format: 'zip' }, ctx());

      expect(archiveAppend).toHaveBeenCalledTimes(3);
      const names = archiveAppend.mock.calls.map((c) => c[1].name);
      expect(names).toEqual(expect.arrayContaining(['INV-inv-1.pdf', 'INV-inv-2.pdf', 'INV-inv-3.pdf']));
    });

    it('starts S3 upload BEFORE the loop (concurrent with appends)', async () => {
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids, format: 'zip' }, ctx());

      // putZip received the archive stream as Body — implicit via params
      // shape; assert the call happened with the right key + tenant.
      const [tenantArg, jwtArg, keyArg] = s3.putZip.mock.calls[0];
      expect(tenantArg).toBe(TENANT);
      expect(jwtArg).toBe(JWT);
      expect(keyArg).toBe(`tenants/${TENANT}/schools/${SCHOOL}/pdf-jobs/${JOB}/invoices.zip`);
    });

    it('finalizes archive + awaits S3 upload + mints presigned URL', async () => {
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids, format: 'zip' }, ctx());

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
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids, format: 'zip' }, ctx());

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
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids, format: 'zip' }, ctx());

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
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids, format: 'zip' }, ctx());
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

      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids, format: 'zip' }, ctx());

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

      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids, format: 'zip' }, ctx());

      expect(jobs.appendFailedInvoice).toHaveBeenCalledTimes(1);
      expect(archiveAppend).toHaveBeenCalledTimes(1);
      expect(jobs.markCompleted).toHaveBeenCalledTimes(1);
    });

    it('appendFailedInvoice itself throwing does NOT propagate (worker swallows + logs)', async () => {
      const ids = ['inv-1'];
      mockRender.mockRejectedValueOnce(new Error('render fail'));
      jobs.appendFailedInvoice.mockRejectedValueOnce(new Error('DDB conflict'));

      await expect(
        worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids, format: 'zip' }, ctx()),
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
        { schoolId: SCHOOL, invoiceIds: ['inv-1', 'inv-2'], format: 'zip' },
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
        worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ['inv-1'], format: 'zip' }, ctx()),
      ).resolves.toBeUndefined();

      expect(jobs.markFailed).toHaveBeenCalledTimes(1);
      expect(jobs.markFailed.mock.calls[0][1]).toMatch(/DDB conflict/);
    });

    it('template fetch fails → markFailed + no throw', async () => {
      identity.getCurrentTemplate.mockRejectedValueOnce(new Error('Identity 503'));

      await expect(
        worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ['inv-1'], format: 'zip' }, ctx()),
      ).resolves.toBeUndefined();

      expect(jobs.markFailed).toHaveBeenCalledTimes(1);
      expect(jobs.markCompleted).not.toHaveBeenCalled();
    });

    it('S3 upload fails → markFailed + no throw + no url_minted emit', async () => {
      s3.putZip.mockRejectedValueOnce(new Error('S3 access denied'));

      await expect(
        worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ['inv-1'], format: 'zip' }, ctx()),
      ).resolves.toBeUndefined();

      expect(jobs.markFailed).toHaveBeenCalledTimes(1);
      expect(audit.emit).not.toHaveBeenCalledWith(
        'finance.bulk_export.url_minted',
        expect.anything(),
        expect.anything(),
      );
    });

    // PR #359 P1 fix-up — the worker starts s3UploadPromise BEFORE the
    // render loop. If every invoice fails the worker aborts the archive
    // and returns from the all-failed branch — but the underlying
    // lib-storage Upload would reject AFTER the worker returned, with
    // no handler attached → "Possible unhandled rejection" process
    // noise. These tests pin the fix: the worker attaches an immediate
    // .catch() handler and awaits the safe-wrapped promise on every
    // early-return path (all-failed, catastrophe, finally).
    describe('PR #359 P1 — S3 upload promise leak', () => {
      it('all-failed path awaits the S3 upload (no orphan rejection after worker returns)', async () => {
        let s3PutZipResolve: (() => void) | null = null;
        let s3PutZipReject: ((err: Error) => void) | null = null;
        s3.putZip.mockReturnValue(
          new Promise<void>((resolve, reject) => {
            s3PutZipResolve = resolve;
            s3PutZipReject = reject;
          }),
        );
        mockRender.mockRejectedValue(new Error('total render meltdown'));

        const runPromise = worker.run(
          JOB,
          { schoolId: SCHOOL, invoiceIds: ['inv-1', 'inv-2'], format: 'zip' },
          ctx(),
        );

        // Settle the S3 upload AFTER the worker has reached its
        // all-failed branch but BEFORE we await runPromise. The safe
        // wrapper must absorb the rejection silently.
        await new Promise((r) => setImmediate(r));
        if (s3PutZipReject) {
          s3PutZipReject(new Error('Upload aborted by archive.abort()'));
        }

        // The worker MUST resolve normally — no unhandled rejection.
        await expect(runPromise).resolves.toBeUndefined();
        // And the all-failed path took the expected exit.
        expect(jobs.markFailed).toHaveBeenCalledTimes(1);
        expect(jobs.markFailed.mock.calls[0][1]).toMatch(/All 2 invoices failed render/);
      });

      it('catastrophe path drains the S3 upload in finally (no orphan rejection)', async () => {
        // Branding fetch succeeds, template fetch succeeds, S3 upload
        // starts, then archive throws an error event AFTER markRunning
        // succeeds but during the render loop. Outer catch enters →
        // markFailed. The s3UploadPromise is still pending. finally
        // must await safeS3UploadPromise so any later rejection is
        // absorbed by the handler.
        let s3PutZipReject: ((err: Error) => void) | null = null;
        s3.putZip.mockReturnValue(
          new Promise<void>((_resolve, reject) => {
            s3PutZipReject = reject;
          }),
        );
        // Cause a throw inside the render loop AFTER the upload started.
        mockRender.mockImplementation(async () => {
          throw new Error('renderer exploded');
        });

        const runPromise = worker.run(
          JOB,
          { schoolId: SCHOOL, invoiceIds: ['inv-1'], format: 'zip' },
          ctx(),
        );

        // Settle S3 with a rejection while the worker is in finally.
        await new Promise((r) => setImmediate(r));
        if (s3PutZipReject) {
          s3PutZipReject(new Error('S3 upload aborted post-catastrophe'));
        }

        await expect(runPromise).resolves.toBeUndefined();
        expect(jobs.markFailed).toHaveBeenCalledTimes(1);
      });

      it('catastrophe BEFORE upload started (markRunning fails) is still safe (no upload, no leak)', async () => {
        jobs.markRunning.mockRejectedValueOnce(new Error('DDB conflict'));
        // s3.putZip MUST NOT have been called yet.
        await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ['inv-1'], format: 'zip' }, ctx());

        expect(s3.putZip).not.toHaveBeenCalled();
        expect(jobs.markFailed).toHaveBeenCalledTimes(1);
        // safeS3UploadPromise stays null → finally's `if (...)` skips.
      });

      it('S3 upload rejection on happy path → markFailed (rethrown via s3UploadError, caught by outer catch)', async () => {
        // Rejection scenario: upload starts, renders succeed, but when
        // we await safeS3UploadPromise the captured s3UploadError is
        // promoted to a throw → outer catch → markFailed.
        s3.putZip.mockRejectedValueOnce(new Error('S3 mid-upload failure'));

        await expect(
          worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ['inv-1'], format: 'zip' }, ctx()),
        ).resolves.toBeUndefined();
        expect(jobs.markFailed).toHaveBeenCalledTimes(1);
        expect(jobs.markCompleted).not.toHaveBeenCalled();
      });
    });

    it('branding fetch fails → DEGRADED (null branding), worker still succeeds', async () => {
      identity.getBranding.mockRejectedValueOnce(new Error('Identity down'));

      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ['inv-1'], format: 'zip' }, ctx());

      expect(jobs.markCompleted).toHaveBeenCalledTimes(1);
      // Renderer received branding=null per the degraded fallback.
      expect(mockRender.mock.calls[0][0].branding).toBeNull();
    });

    it('lock released in finally even when markRunning throws', async () => {
      jobs.markRunning.mockRejectedValueOnce(new Error('boom'));
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ['inv-1'], format: 'zip' }, ctx());
      expect(lockRelease).toHaveBeenCalledTimes(1);
    });

    /**
     * Hotfix — catastrophe path archive.abort() (independent of the
     * dropped deadline feature). The pre-existing catastrophe path
     * called markFailed but never aborted the archive stream → the
     * `await safeS3UploadPromise` in the outer finally would wait
     * indefinitely for lib-storage's Upload to settle, but the Upload
     * was still waiting for an 'end' event on the never-finalized
     * archive stream → worker hangs forever after a real catastrophe.
     *
     * Adding archive.abort() on the catastrophe path makes the Upload
     * settle with an error, the safe-wrapper catches it, and the
     * worker returns cleanly.
     */
    it('hotfix — catastrophe after archive instantiation calls archive.abort() so the S3 upload settles', async () => {
      // Force a catastrophe AFTER the archiver pipeline is set up:
      // make getEntity throw on first call so the per-invoice catch
      // records the failure, then make a later step throw to trigger
      // the outer catastrophe handler. Simplest: make markCompleted
      // throw (happens after the loop succeeds).
      mockRender.mockResolvedValue(Buffer.from('fake-pdf'));
      jobs.markCompleted.mockRejectedValueOnce(new Error('markCompleted-boom'));
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ['inv-1'], format: 'zip' }, ctx());
      expect(jobs.markFailed).toHaveBeenCalledTimes(1);
      // archive.abort() called by the catastrophe path so lib-storage
      // settles its multipart upload instead of waiting for 'end'.
      expect(archiveAbort).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Sprint F.7 — yoga pre-warm + S3 PassThrough wrap
  // ─────────────────────────────────────────────────────────────────
  describe('Sprint F.7 — yoga pre-warm', () => {
    it('calls prewarmInvoiceRenderer BEFORE the parallel render loop kicks off', async () => {
      // Order check: track invocation order across mockPrewarm + mockRender.
      // The pre-warm must complete before any per-invoice render starts so
      // the @react-pdf/layout yoga loadYoga race is closed by the time
      // the parallel loop contends on Config.create().
      const order: string[] = [];
      mockPrewarm.mockImplementation(async () => {
        order.push('prewarm');
      });
      mockRender.mockImplementation(async () => {
        order.push('render');
        return Buffer.from('fake-pdf');
      });
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ['inv-1', 'inv-2'], format: 'zip' }, ctx());
      expect(mockPrewarm).toHaveBeenCalledTimes(1);
      expect(order[0]).toBe('prewarm');
      // Every render fires AFTER prewarm.
      const firstRenderIdx = order.indexOf('render');
      expect(firstRenderIdx).toBeGreaterThan(0);
    });

    it('pre-warm failure surfaces as a catastrophe (markFailed + lock released + no render attempted)', async () => {
      mockPrewarm.mockRejectedValueOnce(new Error('yoga-prewarm-failed'));
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ['inv-1'], format: 'zip' }, ctx());
      expect(jobs.markFailed).toHaveBeenCalledTimes(1);
      expect(mockRender).not.toHaveBeenCalled();
      expect(lockRelease).toHaveBeenCalledTimes(1);
    });
  });

  describe('Sprint F.7 — S3 PassThrough wrap', () => {
    it('archive.pipe(PassThrough) — PassThrough (not the raw archive) is what s3Service.putZip receives', async () => {
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ['inv-1'], format: 'zip' }, ctx());

      // The worker MUST call archive.pipe(...) exactly once with a Node
      // built-in PassThrough as the sink. That PassThrough is then handed
      // to s3Service.putZip — NOT the raw archive (which is a
      // readable-stream@4 instance and fails AWS SDK v3 lib-storage's
      // `instanceof stream.Readable` check). See PR #362 follow-up.
      expect(mockArchive.pipe).toHaveBeenCalledTimes(1);
      const passthroughPassedToPipe = mockArchive.pipe.mock.calls[0][0];

      expect(s3.putZip).toHaveBeenCalledTimes(1);
      const [, , , bodyArg] = s3.putZip.mock.calls[0];

      // Same instance: the one passed to archive.pipe(...) is the SAME
      // one handed to s3Service.putZip — proves the wrap is in place.
      expect(bodyArg).toBe(passthroughPassedToPipe);

      // And it IS a Node-native stream.Readable (the whole point).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Readable } = require('stream');
      expect(bodyArg).toBeInstanceOf(Readable);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // P1 (issue #365) — logo optimization + P2 (issue #364) event-loop yield
  // ─────────────────────────────────────────────────────────────────
  describe('Plan §5d — logo optimizer delegated to PdfLogoOptimizerService (once per job)', () => {
    it('calls PdfLogoOptimizerService.optimize exactly ONCE for a multi-invoice job', async () => {
      identity.getBranding.mockResolvedValueOnce({
        branding: null,
        urls: { logo: 'https://s3.example/tenant/school/logo.png' },
      });
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ['a', 'b', 'c'], format: 'zip' }, ctx());
      // The service is invoked ONCE across a 3-invoice run — the whole
      // point of caching branding + logo outside the parallel loop.
      expect(mockPdfLogoOptimizerOptimize).toHaveBeenCalledTimes(1);
      // Bulk workers pass their 10 s timeout explicitly (Plan §5d).
      expect(mockPdfLogoOptimizerOptimize).toHaveBeenCalledWith(
        'https://s3.example/tenant/school/logo.png',
        { fetchTimeoutMs: 10_000 },
      );
      // The renderer receives the optimized data URI (not the S3 URL).
      const rendererCalls = mockRender.mock.calls;
      expect(rendererCalls.length).toBe(3);
      for (const [args] of rendererCalls) {
        expect(args.urls.logo).toBe(MOCK_OPTIMIZED_DATA_URI);
      }
    });

    it('fails open when optimizer returns the original URL (its internal fail-open)', async () => {
      identity.getBranding.mockResolvedValueOnce({
        branding: null,
        urls: { logo: 'https://s3.example/tenant/school/logo.png' },
      });
      // Simulate the service's fail-open: return the original URL.
      mockPdfLogoOptimizerOptimize.mockResolvedValueOnce(
        'https://s3.example/tenant/school/logo.png',
      );
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ['a'], format: 'zip' }, ctx());
      // Job still completes; renderer sees the original S3 URL.
      expect(jobs.markCompleted).toHaveBeenCalledTimes(1);
      expect(mockRender.mock.calls[0][0].urls.logo).toBe(
        'https://s3.example/tenant/school/logo.png',
      );
    });

    it('skips optimization entirely when the school has no logo URL', async () => {
      identity.getBranding.mockResolvedValueOnce({
        branding: null,
        urls: undefined,
      });
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ['a', 'b'], format: 'zip' }, ctx());
      // The worker's `urls?.logo` guard short-circuits before calling
      // the service.
      expect(mockPdfLogoOptimizerOptimize).not.toHaveBeenCalled();
      expect(jobs.markCompleted).toHaveBeenCalledTimes(1);
    });
  });

  describe('P2 issue #364 — event-loop yield after each archive.append', () => {
    it('yields to setImmediate after every invoice archive.append (queue is 1-yield-per-invoice)', async () => {
      // Spy on setImmediate; count invocations from the worker's yieldToEventLoop.
      const setImmediateSpy = jest.spyOn(global, 'setImmediate');
      try {
        await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ['a', 'b', 'c'], format: 'zip' }, ctx());
        // At least 3 setImmediate calls (one per invoice; may be more from
        // Node internals). The yield is inside the timeStage per-invoice fn.
        const yieldCallCount = setImmediateSpy.mock.calls.length;
        expect(yieldCallCount).toBeGreaterThanOrEqual(3);
      } finally {
        setImmediateSpy.mockRestore();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Bucket integration
  // ─────────────────────────────────────────────────────────────────
  describe('PdfRenderConcurrencyBucket integration', () => {
    it('acquires + releases bucket slot per invoice', async () => {
      const ids = ['inv-1', 'inv-2'];
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids, format: 'zip' }, ctx());

      expect(bucket.acquire).toHaveBeenCalledTimes(2);
      expect(bucketRelease).toHaveBeenCalledTimes(2);
    });

    it('releases bucket slot even when render throws (try/finally)', async () => {
      const ids = ['inv-1'];
      mockRender.mockRejectedValueOnce(new Error('render fail'));
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids, format: 'zip' }, ctx());
      expect(bucketRelease).toHaveBeenCalledTimes(1);
    });

    it('reads concurrency from bucket.getLimit (not env directly)', async () => {
      bucket.getLimit.mockReturnValueOnce(40);
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ['inv-1'], format: 'zip' }, ctx());
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
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids, format: 'zip' }, ctx());

      expect(jobs.incrementCounter).toHaveBeenCalledTimes(2);
      // First call: 25 from the mid-loop flush
      expect(jobs.incrementCounter.mock.calls[0]).toEqual([JOB, 'succeeded', 25, expect.any(Object)]);
      // Second call: 2 from the final flush
      expect(jobs.incrementCounter.mock.calls[1]).toEqual([JOB, 'succeeded', 2, expect.any(Object)]);
    });

    it('no final flush when N % 25 === 0', async () => {
      const ids = Array.from({ length: 25 }, (_, i) => `inv-${i}`);
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids, format: 'zip' }, ctx());

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
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids, format: 'zip' }, ctx());

      const totalFlushed = jobs.incrementCounter.mock.calls
        .filter((c: any[]) => c[1] === 'succeeded')
        .reduce((sum: number, c: any[]) => sum + (c[2] as number), 0);
      expect(totalFlushed).toBe(50);
    });

    it('incrementCounter failure does NOT abort the worker (best-effort)', async () => {
      const ids = Array.from({ length: 25 }, (_, i) => `inv-${i}`);
      jobs.incrementCounter.mockRejectedValueOnce(new Error('DDB conflict'));

      await expect(
        worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids, format: 'zip' }, ctx()),
      ).resolves.toBeUndefined();
      expect(jobs.markCompleted).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Metrics emission
  // ─────────────────────────────────────────────────────────────────
  describe('metrics emission (FinanceMetricsService optional)', () => {
    it('emits per-stage timings + JobTotalLatencyMs on success', async () => {
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ['inv-1'], format: 'zip' }, ctx());

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
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ['inv-1'], format: 'zip' }, ctx());

      const names = metrics.put.mock.calls.map((c: any) => c[0].metricName);
      expect(names).toContain('JobTotalLatencyMs');
    });

    it('works without metrics dep (no crash; manual construction)', async () => {
      const noMetricsWorker = new BulkInvoicePdfExportWorker(
        jobs, audit, invoices, identity, s3, lock, bucket,
        { optimize: mockPdfLogoOptimizerOptimize } as any,
        /* metrics */ undefined,
      );
      await expect(
        noMetricsWorker.run(JOB, { schoolId: SCHOOL, invoiceIds: ['inv-1'], format: 'zip' }, ctx()),
      ).resolves.toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Sprint H.3 — merged_pdf format branch
  //
  // The worker branches internally on `format`. Coverage here focuses on
  // WHAT DIFFERS from the zip path:
  //   - Never touches archive.append / archive.finalize / archive.abort.
  //   - Calls s3Service.putPdf (single-shot Buffer upload) instead of
  //     putZip (streaming Upload).
  //   - Uses the invoices-merged.pdf key (not invoices.zip).
  //   - Passes buffers to mergePdfBuffers in operator-requested order
  //     (not render-completion order).
  //   - markCompleted output carries mergedPdfKey / mergedPdfUrl
  //     (NOT zipKey / zipUrl).
  //   - url_minted audit emits format: 'merged_pdf'.
  //   - All-fail path skips the archive.abort dance and just markFailed's.
  // ─────────────────────────────────────────────────────────────────
  describe('Sprint H.3 — merged_pdf format branch', () => {
    const ids = ['inv-1', 'inv-2', 'inv-3'];

    it('never calls archive.append / .finalize / .abort in merged_pdf mode', async () => {
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids, format: 'merged_pdf' }, ctx());

      expect(archiveAppend).not.toHaveBeenCalled();
      expect(archiveFinalize).not.toHaveBeenCalled();
      expect(archiveAbort).not.toHaveBeenCalled();
      // archiver() constructor also not invoked — the entire zip-only setup
      // block is guarded behind `if (!isMerged)`.
      expect(mockArchiverFn).not.toHaveBeenCalled();
    });

    it('uploads via s3Service.putPdf at invoices-merged.pdf (not putZip)', async () => {
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids, format: 'merged_pdf' }, ctx());

      expect(s3.putZip).not.toHaveBeenCalled();
      expect(s3.putPdf).toHaveBeenCalledTimes(1);
      const [tenantArg, jwtArg, keyArg, bufferArg] = s3.putPdf.mock.calls[0];
      expect(tenantArg).toBe(TENANT);
      expect(jwtArg).toBe(JWT);
      expect(keyArg).toBe(
        `tenants/${TENANT}/schools/${SCHOOL}/pdf-jobs/${JOB}/invoices-merged.pdf`,
      );
      expect(bufferArg).toEqual(Buffer.from('MERGED_FAKE_PDF'));
    });

    it('passes per-invoice buffers to mergePdfBuffers in input.invoiceIds order (NOT render-completion order)', async () => {
      // Force inv-1 to render slower than inv-2/inv-3 by resolving on
      // different microtask ticks. mergePdfBuffers should still receive
      // buffers in [inv-1, inv-2, inv-3] order.
      let tickCount = 0;
      mockRender.mockImplementation(async ({ invoice }) => {
        // inv-1 renders LAST despite being first in input.
        if (invoice.invoiceId === 'inv-1') {
          await new Promise((r) => setImmediate(r));
          await new Promise((r) => setImmediate(r));
        }
        const marker = `pdf-for-${invoice.invoiceId}-tick-${tickCount++}`;
        return Buffer.from(marker);
      });

      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids, format: 'merged_pdf' }, ctx());

      expect(mockMergePdfBuffers).toHaveBeenCalledTimes(1);
      const [buffersArg] = mockMergePdfBuffers.mock.calls[0];
      const orderedMarkers = (buffersArg as Buffer[]).map((b: Buffer) => b.toString());
      // Ordering asserts the operator-requested order, not first-completed.
      expect(orderedMarkers).toEqual([
        'pdf-for-inv-1-tick-2',
        'pdf-for-inv-2-tick-0',
        'pdf-for-inv-3-tick-1',
      ]);
    });

    it('markCompleted carries mergedPdfKey + mergedPdfUrl (NOT zipKey / zipUrl)', async () => {
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids, format: 'merged_pdf' }, ctx());

      const [, completion] = jobs.markCompleted.mock.calls[0];
      expect(completion.output.mergedPdfKey).toBe(
        `tenants/${TENANT}/schools/${SCHOOL}/pdf-jobs/${JOB}/invoices-merged.pdf`,
      );
      expect(completion.output.mergedPdfUrl).toBe('https://signed-url');
      expect(completion.output.zipKey).toBeUndefined();
      expect(completion.output.zipUrl).toBeUndefined();
      expect(completion.counters).toEqual({ succeeded: 3, failed: 0, skipped: 0 });
    });

    it('url_minted audit emits format=merged_pdf with SHA256(mergedPdfKey) as presignedKeyHash', async () => {
      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids, format: 'merged_pdf' }, ctx());

      expect(audit.emit).toHaveBeenCalledWith(
        'finance.bulk_export.url_minted',
        expect.objectContaining({
          format: 'merged_pdf',
          invoiceCount: 3,
          presignedKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        expect.any(Object),
      );
    });

    it('failed renders are excluded from the merged PDF (buffers filtered by success)', async () => {
      mockRender.mockImplementation(async ({ invoice }) => {
        if (invoice.invoiceId === 'inv-2') throw new Error('PDF render failure');
        return Buffer.from(`pdf-for-${invoice.invoiceId}`);
      });

      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids, format: 'merged_pdf' }, ctx());

      const [buffersArg] = mockMergePdfBuffers.mock.calls[0];
      // Only 2 succeeded, in original order — inv-2 (failed) is not present.
      expect((buffersArg as Buffer[]).map((b: Buffer) => b.toString())).toEqual([
        'pdf-for-inv-1',
        'pdf-for-inv-3',
      ]);
      expect(jobs.appendFailedInvoice).toHaveBeenCalledWith(
        JOB, 'inv-2', expect.stringContaining('PDF render failure'), expect.any(Object),
      );
    });

    it('all-fail path skips archive.abort dance + just calls markFailed', async () => {
      mockRender.mockRejectedValue(new Error('PDF render always fails'));

      await worker.run(JOB, { schoolId: SCHOOL, invoiceIds: ids, format: 'merged_pdf' }, ctx());

      // No archive touched at any point (all-fail path AND merged mode).
      expect(archiveAbort).not.toHaveBeenCalled();
      expect(mockArchiverFn).not.toHaveBeenCalled();
      // Not merged — mergePdfBuffers wasn't called because there's nothing
      // to merge (early return before finalize section).
      expect(mockMergePdfBuffers).not.toHaveBeenCalled();
      expect(s3.putPdf).not.toHaveBeenCalled();
      expect(jobs.markFailed).toHaveBeenCalledWith(
        JOB,
        expect.stringContaining('All 3 invoices failed render'),
        expect.any(Object),
      );
    });
  });
});
