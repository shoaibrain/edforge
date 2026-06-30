/**
 * InvoicesController.bulkPdfExport — Sprint F.4 unit tests.
 *
 * Tests the F.4 handler directly (manual `new InvoicesController(...)`),
 * bypassing Nest DI + guards + interceptors. The Zod schema + guards
 * are tested in their own specs; here we pin the handler's contract:
 *
 *   - Format gating: 'merged_pdf' → 501 NotImplementedException.
 *   - Workload cap: invoiceIds.length > 2000 → 413 PayloadTooLargeException.
 *   - MVP.5 atomic create with `singleActiveExportGuard` passed.
 *   - ActiveExportAlreadyRunningError → 409 ConflictException with runningJobId.
 *   - Worker dispatched via `setImmediate` AFTER create succeeds.
 *   - 202 response shape: `{jobId, message}` with the MVP.6 operator copy.
 *   - Worker .catch() is wired (doesn't propagate to the response).
 */

import { ConflictException, HttpStatus, NotImplementedException, PayloadTooLargeException, Logger } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { ActiveExportAlreadyRunningError } from '../bulk-ops/active-export-already-running.error';
import { BULK_EXPORT_CAPS } from '../bulk-ops/bulk-export-caps';

const SCHOOL = 'school-A';
const JOB_ID = 'job-fresh-1';
const TENANT = 'tenant-A';
const OPERATOR = 'op-A';

function buildTenant(overrides: any = {}) {
  return {
    tenantId: TENANT,
    userId: OPERATOR,
    email: 'op@example.com',
    role: 'TenantAdmin',
    globalRole: 'TenantAdmin',
    jwtToken: 'jwt',
    ...overrides,
  };
}

function buildReq(headers: Record<string, string> = {}): any {
  return { headers: { 'idempotency-key': 'idempotency-key-abc', ...headers } };
}

function buildRes(): any {
  const res: any = { status: jest.fn().mockReturnThis() };
  return res;
}

describe('InvoicesController.bulkPdfExport (F.4)', () => {
  let controller: InvoicesController;
  let invoicesService: any;
  let identityClient: any;
  let financeJobsService: any;
  let bulkInvoiceGenerateWorker: any;
  let bulkInvoicePdfExportWorker: any;
  let workerRun: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    invoicesService = {};
    identityClient = {};
    financeJobsService = {
      create: jest.fn().mockResolvedValue({ jobId: JOB_ID }),
    };
    bulkInvoiceGenerateWorker = {};
    workerRun = jest.fn().mockResolvedValue(undefined);
    bulkInvoicePdfExportWorker = { run: workerRun };

    controller = new InvoicesController(
      invoicesService,
      identityClient,
      financeJobsService,
      bulkInvoiceGenerateWorker,
      bulkInvoicePdfExportWorker,
    );
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────
  // Happy path
  // ─────────────────────────────────────────────────────────────────
  describe('happy path', () => {
    it('creates a FinanceJob with the singleActiveExportGuard set + returns 202 + jobId', async () => {
      const dto: any = { format: 'zip', invoiceIds: ['inv-1', 'inv-2', 'inv-3'] };
      const tenant = buildTenant();
      const req = buildReq();
      const res = buildRes();

      const result = await controller.bulkPdfExport(SCHOOL, dto, tenant, req, res);

      expect(financeJobsService.create).toHaveBeenCalledTimes(1);
      const [createInput, , createOptions] = financeJobsService.create.mock.calls[0];
      expect(createInput).toMatchObject({
        schoolId: SCHOOL,
        operatorId: OPERATOR,
        jobType: 'bulk_invoice_pdf_export',
        requested: 3,
        outputFormat: 'zip',
        idempotencyKey: 'idempotency-key-abc',
      });
      expect(createOptions).toEqual({
        singleActiveExportGuard: {
          schoolId: SCHOOL,
          jobType: 'bulk_invoice_pdf_export',
        },
      });
      expect(res.status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
      expect(result).toEqual({
        jobId: JOB_ID,
        message: 'Large exports run in the background and may take a few minutes.',
      });
    });

    it('dispatches the F.3 worker via setImmediate AFTER create resolves', async () => {
      const dto: any = { format: 'zip', invoiceIds: ['inv-1'] };
      await controller.bulkPdfExport(SCHOOL, dto, buildTenant(), buildReq(), buildRes());

      // setImmediate has not yet fired
      expect(workerRun).not.toHaveBeenCalled();

      // Flush the immediate queue
      jest.runOnlyPendingTimers();
      await Promise.resolve();
      await Promise.resolve();

      expect(workerRun).toHaveBeenCalledTimes(1);
      const [jobIdArg, inputArg] = workerRun.mock.calls[0];
      expect(jobIdArg).toBe(JOB_ID);
      expect(inputArg).toEqual({ schoolId: SCHOOL, invoiceIds: ['inv-1'] });
    });

    it('worker .catch() prevents an unhandled rejection from propagating to the response', async () => {
      workerRun.mockRejectedValueOnce(new Error('worker exploded mid-run'));
      const dto: any = { format: 'zip', invoiceIds: ['inv-1'] };

      const result = await controller.bulkPdfExport(SCHOOL, dto, buildTenant(), buildReq(), buildRes());

      // Response shape is unchanged — the worker error is the worker's
      // problem, surfaced via its own markFailed + job-row polling.
      expect(result).toEqual({
        jobId: JOB_ID,
        message: expect.any(String),
      });
      // Flush the immediate queue; .catch handler should run
      jest.runOnlyPendingTimers();
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Format gating — H.3 deferral
  // ─────────────────────────────────────────────────────────────────
  describe("format gating — 'merged_pdf' deferred to H.3", () => {
    it('throws 501 NotImplementedException when format=merged_pdf', async () => {
      const dto: any = { format: 'merged_pdf', invoiceIds: ['inv-1'] };

      await expect(
        controller.bulkPdfExport(SCHOOL, dto, buildTenant(), buildReq(), buildRes()),
      ).rejects.toThrow(NotImplementedException);

      // No FinanceJob is created when the format gate trips.
      expect(financeJobsService.create).not.toHaveBeenCalled();
      expect(workerRun).not.toHaveBeenCalled();
    });

    it('501 body carries code: FORMAT_NOT_SUPPORTED', async () => {
      const dto: any = { format: 'merged_pdf', invoiceIds: ['inv-1'] };
      try {
        await controller.bulkPdfExport(SCHOOL, dto, buildTenant(), buildReq(), buildRes());
        fail('expected NotImplementedException');
      } catch (e) {
        expect((e as NotImplementedException).getResponse()).toMatchObject({
          code: 'FORMAT_NOT_SUPPORTED',
        });
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // MVP.4 workload cap
  // ─────────────────────────────────────────────────────────────────
  describe('MVP.4 workload cap (BULK_EXPORT_CAPS.zip)', () => {
    it('throws 413 PayloadTooLargeException when invoiceIds.length > cap', async () => {
      const oversized = Array.from({ length: BULK_EXPORT_CAPS.zip + 1 }, (_, i) => `inv-${i}`);
      const dto: any = { format: 'zip', invoiceIds: oversized };

      await expect(
        controller.bulkPdfExport(SCHOOL, dto, buildTenant(), buildReq(), buildRes()),
      ).rejects.toThrow(PayloadTooLargeException);
    });

    it('413 body carries code + limit + requested for operator UX', async () => {
      const oversized = Array.from({ length: BULK_EXPORT_CAPS.zip + 5 }, (_, i) => `inv-${i}`);
      const dto: any = { format: 'zip', invoiceIds: oversized };
      try {
        await controller.bulkPdfExport(SCHOOL, dto, buildTenant(), buildReq(), buildRes());
        fail('expected PayloadTooLargeException');
      } catch (e) {
        const body = (e as PayloadTooLargeException).getResponse() as any;
        expect(body.code).toBe('PAYLOAD_TOO_LARGE');
        expect(body.limit).toBe(BULK_EXPORT_CAPS.zip);
        expect(body.requested).toBe(BULK_EXPORT_CAPS.zip + 5);
      }
    });

    it('exactly at the cap (2000) is accepted', async () => {
      const atCap = Array.from({ length: BULK_EXPORT_CAPS.zip }, (_, i) => `inv-${i}`);
      const dto: any = { format: 'zip', invoiceIds: atCap };

      await controller.bulkPdfExport(SCHOOL, dto, buildTenant(), buildReq(), buildRes());

      expect(financeJobsService.create).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // MVP.5 active-export conflict
  // ─────────────────────────────────────────────────────────────────
  describe('MVP.5 ActiveExportAlreadyRunningError → 409', () => {
    it('translates the domain error to ConflictException with the existing runningJobId', async () => {
      financeJobsService.create.mockRejectedValueOnce(
        new ActiveExportAlreadyRunningError(SCHOOL, 'bulk_invoice_pdf_export', 'existing-job-xyz'),
      );
      const dto: any = { format: 'zip', invoiceIds: ['inv-1'] };

      await expect(
        controller.bulkPdfExport(SCHOOL, dto, buildTenant(), buildReq(), buildRes()),
      ).rejects.toThrow(ConflictException);
    });

    it('409 body carries code, runningJobId, schoolId, jobType for the frontend to deep-link', async () => {
      financeJobsService.create.mockRejectedValueOnce(
        new ActiveExportAlreadyRunningError(SCHOOL, 'bulk_invoice_pdf_export', 'existing-job-xyz'),
      );
      const dto: any = { format: 'zip', invoiceIds: ['inv-1'] };
      try {
        await controller.bulkPdfExport(SCHOOL, dto, buildTenant(), buildReq(), buildRes());
        fail('expected ConflictException');
      } catch (e) {
        const body = (e as ConflictException).getResponse() as any;
        expect(body.code).toBe('ACTIVE_EXPORT_ALREADY_RUNNING');
        expect(body.runningJobId).toBe('existing-job-xyz');
        expect(body.schoolId).toBe(SCHOOL);
        expect(body.jobType).toBe('bulk_invoice_pdf_export');
      }
    });

    it('worker is NOT dispatched when create() throws ActiveExport conflict', async () => {
      financeJobsService.create.mockRejectedValueOnce(
        new ActiveExportAlreadyRunningError(SCHOOL, 'bulk_invoice_pdf_export', 'existing-job-xyz'),
      );
      const dto: any = { format: 'zip', invoiceIds: ['inv-1'] };

      try {
        await controller.bulkPdfExport(SCHOOL, dto, buildTenant(), buildReq(), buildRes());
      } catch {
        // expected throw
      }
      jest.runOnlyPendingTimers();
      await Promise.resolve();
      expect(workerRun).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Non-ActiveExport create() errors propagate raw
  // ─────────────────────────────────────────────────────────────────
  describe('non-ActiveExport create() errors propagate as-is', () => {
    it('DDB throttle on create propagates raw (NOT translated to 409)', async () => {
      const throttleErr = new Error('Throttle');
      (throttleErr as any).name = 'ProvisionedThroughputExceededException';
      financeJobsService.create.mockRejectedValueOnce(throttleErr);
      const dto: any = { format: 'zip', invoiceIds: ['inv-1'] };

      await expect(
        controller.bulkPdfExport(SCHOOL, dto, buildTenant(), buildReq(), buildRes()),
      ).rejects.toThrow('Throttle');
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Idempotency-Key threading
  // ─────────────────────────────────────────────────────────────────
  describe('Idempotency-Key threading', () => {
    it('forwards the Idempotency-Key header through to FinanceJob.create()', async () => {
      const dto: any = { format: 'zip', invoiceIds: ['inv-1'] };
      const req = buildReq({ 'idempotency-key': 'fresh-key-xyz' });

      await controller.bulkPdfExport(SCHOOL, dto, buildTenant(), req, buildRes());

      expect(financeJobsService.create.mock.calls[0][0].idempotencyKey).toBe('fresh-key-xyz');
    });

    it('passes undefined idempotencyKey when header is absent (interceptor will reject upstream)', async () => {
      const dto: any = { format: 'zip', invoiceIds: ['inv-1'] };
      const req: any = { headers: {} };

      await controller.bulkPdfExport(SCHOOL, dto, buildTenant(), req, buildRes());

      expect(financeJobsService.create.mock.calls[0][0].idempotencyKey).toBeUndefined();
    });
  });
});
