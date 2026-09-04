/**
 * Round-3 B1/B2/B3 — parent-scoped access hardening on the payments
 * controller.
 *
 *   B1  GET payments/:paymentId — ownership over ALL multi-target
 *       students; missing single-target studentId → '' sentinel → 403 for
 *       parent-scoped callers (falsy-skip closed).
 *   B2  GET schools/:schoolId/invoices/:invoiceId/payments — Parent/Student
 *       callers are flagged `parentScoped` so the service can redact
 *       unowned multi-target rows; the route itself still answers (the
 *       pre-existing no-invoice-ownership contract is unchanged).
 *   B3  School-wide list + CSV export + bulk receipt export are STAFF
 *       tooling: explicit Parent/Student rejection (mirror of
 *       recordManualPayment's role probe); staff + TenantAdmin unchanged.
 */

import { ForbiddenException } from '@nestjs/common';
import { JobsDispatcherService } from '../bulk-ops/jobs-dispatcher.service';
import { Writable } from 'stream';
import { PaymentsController } from './payments.controller';

const SCHOOL_ID = '44444444-4444-4444-8444-444444444444';
const PAYMENT_ID = 'multi-pay-uuid';
const STUDENT_1 = 'student-1-uuid';
const STUDENT_2 = 'student-2-uuid';

const PAYMENT_DTO = {
  id: PAYMENT_ID,
  invoiceId: null,
  studentAccountId: null,
  familyId: '55555555-dddd-4ddd-8ddd-555555555555',
  amount: 2500,
  receiptNumber: 'RCP-2026-0900',
  status: 'completed',
} as any;

const tenant = (globalRole: string) => ({
  userId: 'caller-uuid',
  tenantId: 'tenant-uuid',
  email: 'caller@example.com',
  globalRole,
});

const req = { headers: { authorization: 'Bearer jwt' } } as any;

function buildController(overrides: {
  ownershipStudentIds?: string[];
  ownedStudentIds?: string[];
  staffBypass?: boolean;
  schoolRole?: string | null;
} = {}) {
  const ownershipStudentIds = overrides.ownershipStudentIds ?? [STUDENT_1, STUDENT_2];
  const owned = new Set(overrides.ownedStudentIds ?? [STUDENT_1, STUDENT_2]);

  const paymentsService: any = {
    getWithOwnershipTargets: jest
      .fn()
      .mockResolvedValue({ payment: PAYMENT_DTO, ownershipStudentIds }),
    listByInvoice: jest.fn().mockResolvedValue([]),
    listBySchool: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    listBySchoolAndGrade: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    streamPaymentsCsvRows: jest.fn().mockReturnValue(
      (async function* () {
        yield 'receiptNumber,amount\n';
      })(),
    ),
  };
  const identityClient: any = {
    // Mirrors IdentityClientService.enforceStudentOwnership: staff roles
    // bypass; Parent throws unless the student is linked.
    enforceStudentOwnership: jest.fn().mockImplementation(async (studentId: string) => {
      if (overrides.staffBypass) return;
      if (!owned.has(studentId)) {
        throw new ForbiddenException('Access denied to this resource');
      }
    }),
    getUserRole: jest
      .fn()
      .mockResolvedValue(
        overrides.schoolRole === null ? null : { role: overrides.schoolRole ?? 'Parent' },
      ),
  };
  const financeJobsService: any = {
    create: jest.fn().mockResolvedValue({ jobId: 'job-1' }),
  };
  const bulkReceiptPdfExportWorker: any = { run: jest.fn().mockResolvedValue(undefined) };

  const controller = new PaymentsController(
    paymentsService,
    identityClient,
    financeJobsService,
    bulkReceiptPdfExportWorker,
    new JobsDispatcherService({}), // C3.7 — inline transport, as before
  );
  return { controller, paymentsService, identityClient, financeJobsService };
}

function makeCsvRes() {
  const res: any = new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  });
  res.setHeader = jest.fn();
  return res;
}

describe('round-3 B1 — GET payments/:paymentId ownership', () => {
  it('guardian owning ALL targets receives the multi-target payment (every id enforced)', async () => {
    const { controller, identityClient } = buildController();

    const payment = await controller.getPayment(PAYMENT_ID, SCHOOL_ID, tenant('Parent'), req);

    expect(payment).toBe(PAYMENT_DTO);
    expect(identityClient.enforceStudentOwnership).toHaveBeenCalledTimes(2);
    expect(identityClient.enforceStudentOwnership).toHaveBeenCalledWith(
      STUDENT_1, SCHOOL_ID, expect.anything(),
    );
    expect(identityClient.enforceStudentOwnership).toHaveBeenCalledWith(
      STUDENT_2, SCHOOL_ID, expect.anything(),
    );
  });

  it('guardian owning only ONE target is denied (403) — pre-fix falsy-skip closed', async () => {
    const { controller } = buildController({ ownedStudentIds: [STUDENT_1] });

    await expect(
      controller.getPayment(PAYMENT_ID, SCHOOL_ID, tenant('Parent'), req),
    ).rejects.toThrow(ForbiddenException);
  });

  it("single-target with missing studentId ('' sentinel) → 403 for a parent-scoped caller", async () => {
    const { controller, identityClient } = buildController({
      ownershipStudentIds: [''],
      ownedStudentIds: [STUDENT_1],
    });

    await expect(
      controller.getPayment(PAYMENT_ID, SCHOOL_ID, tenant('Parent'), req),
    ).rejects.toThrow(ForbiddenException);
    expect(identityClient.enforceStudentOwnership).toHaveBeenCalledWith(
      '', SCHOOL_ID, expect.anything(),
    );
  });

  it("staff (identity-side bypass) still receives the payment even on the '' sentinel", async () => {
    const { controller } = buildController({
      ownershipStudentIds: [''],
      staffBypass: true,
      ownedStudentIds: [],
    });

    const payment = await controller.getPayment(PAYMENT_ID, SCHOOL_ID, tenant('SchoolAdmin'), req);
    expect(payment).toBe(PAYMENT_DTO);
  });
});

describe('round-3 B2 — listInvoicePayments parent-scope flag', () => {
  it('Parent school role → service called with parentScoped: true (route still answers — no rejection)', async () => {
    const { controller, paymentsService } = buildController({ schoolRole: 'Parent' });

    await controller.listInvoicePayments(SCHOOL_ID, 'inv-1', tenant('User'), req);

    expect(paymentsService.listByInvoice).toHaveBeenCalledWith(
      SCHOOL_ID, 'inv-1', expect.anything(), { parentScoped: true },
    );
  });

  it('staff school role (Accountant) → parentScoped: false', async () => {
    const { controller, paymentsService } = buildController({ schoolRole: 'Accountant' });

    await controller.listInvoicePayments(SCHOOL_ID, 'inv-1', tenant('User'), req);

    expect(paymentsService.listByInvoice).toHaveBeenCalledWith(
      SCHOOL_ID, 'inv-1', expect.anything(), { parentScoped: false },
    );
  });

  it('TenantAdmin globalRole skips the role probe entirely', async () => {
    const { controller, paymentsService, identityClient } = buildController();

    await controller.listInvoicePayments(SCHOOL_ID, 'inv-1', tenant('TenantAdmin'), req);

    expect(identityClient.getUserRole).not.toHaveBeenCalled();
    expect(paymentsService.listByInvoice).toHaveBeenCalledWith(
      SCHOOL_ID, 'inv-1', expect.anything(), { parentScoped: false },
    );
  });
});

describe('round-3 B3 — school-wide payment surfaces are staff tooling', () => {
  describe('GET schools/:schoolId/payments (list)', () => {
    it.each(['Parent', 'Student'])('%s school role → 403; service never called', async (role) => {
      const { controller, paymentsService } = buildController({ schoolRole: role });

      await expect(
        controller.listSchoolPayments(
          SCHOOL_ID, '', '', '', '', '', tenant('User'), req,
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(paymentsService.listBySchool).not.toHaveBeenCalled();
      expect(paymentsService.listBySchoolAndGrade).not.toHaveBeenCalled();
    });

    it('staff school role (Accountant) lists as before', async () => {
      const { controller, paymentsService } = buildController({ schoolRole: 'Accountant' });

      await controller.listSchoolPayments(SCHOOL_ID, '', '', '', '', '', tenant('User'), req);

      expect(paymentsService.listBySchool).toHaveBeenCalledTimes(1);
    });

    it('TenantAdmin globalRole skips the probe and lists', async () => {
      const { controller, paymentsService, identityClient } = buildController();

      await controller.listSchoolPayments(
        SCHOOL_ID, '', '', '', '', '', tenant('TenantAdmin'), req,
      );

      expect(identityClient.getUserRole).not.toHaveBeenCalled();
      expect(paymentsService.listBySchool).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET schools/:schoolId/payments/export (CSV)', () => {
    it('Parent school role → 403 before any header/stream work', async () => {
      const { controller, paymentsService } = buildController({ schoolRole: 'Parent' });
      const res = makeCsvRes();

      await expect(
        controller.exportPaymentsCsv(SCHOOL_ID, tenant('User'), req, res),
      ).rejects.toThrow(ForbiddenException);

      expect(res.setHeader).not.toHaveBeenCalled();
      expect(paymentsService.streamPaymentsCsvRows).not.toHaveBeenCalled();
    });

    it('staff school role streams the CSV as before', async () => {
      const { controller, paymentsService } = buildController({ schoolRole: 'Accountant' });
      const res = makeCsvRes();

      await controller.exportPaymentsCsv(SCHOOL_ID, tenant('User'), req, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(paymentsService.streamPaymentsCsvRows).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST schools/:schoolId/payments/bulk-pdf-export', () => {
    const dto = { format: 'zip', paymentIds: ['pay-1'] } as any;
    const exportRes = () => ({ status: jest.fn() }) as any;
    const exportReq = { headers: { 'idempotency-key': 'k-1' } } as any;

    it.each(['Parent', 'Student'])('%s school role → 403 before any job is created', async (role) => {
      const { controller, financeJobsService } = buildController({ schoolRole: role });

      await expect(
        controller.bulkReceiptPdfExport(SCHOOL_ID, dto, tenant('User'), exportReq, exportRes()),
      ).rejects.toThrow(ForbiddenException);

      expect(financeJobsService.create).not.toHaveBeenCalled();
    });

    it('staff school role (Accountant) creates the job as before', async () => {
      const { controller, financeJobsService } = buildController({ schoolRole: 'Accountant' });

      const result = await controller.bulkReceiptPdfExport(
        SCHOOL_ID, dto, tenant('User'), exportReq, exportRes(),
      );

      expect(result.jobId).toBe('job-1');
      expect(financeJobsService.create).toHaveBeenCalledTimes(1);
    });
  });

  it('regression — student-/invoice-scoped reads stay reachable for parents (B2 route answered above; detail route enforced per-target, not blanket-blocked)', async () => {
    // The blanket Parent/Student rejection applies ONLY to the school-wide
    // surfaces. getPayment for an owned payment still succeeds:
    const { controller } = buildController({
      ownershipStudentIds: [STUDENT_1],
      ownedStudentIds: [STUDENT_1],
      schoolRole: 'Parent',
    });

    const payment = await controller.getPayment(PAYMENT_ID, SCHOOL_ID, tenant('Parent'), req);
    expect(payment).toBe(PAYMENT_DTO);
  });
});
