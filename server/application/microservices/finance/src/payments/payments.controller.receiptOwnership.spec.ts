/**
 * Review F3 (owner decision 2026-07-05) — receipt endpoints enforce
 * ownership of ALL target students on multi-target family payments.
 *
 * The controller loops `enforceStudentOwnership` over the service's
 * `ownershipStudentIds` (every DISTINCT target student) for BOTH the JSON
 * receipt and the PDF endpoint. A guardian who owns only one sibling must
 * not see the other siblings' billing via the shared family receipt.
 * Staff have no ownership scoping (identity-client bypass) — unchanged.
 */

import { ForbiddenException } from '@nestjs/common';
import { JobsDispatcherService } from '../bulk-ops/jobs-dispatcher.service';
import { PaymentsController } from './payments.controller';

const SCHOOL_ID = '44444444-4444-4444-8444-444444444444';
const PAYMENT_ID = 'multi-pay-uuid';
const STUDENT_1 = 'student-1-uuid';
const STUDENT_2 = 'student-2-uuid';

const RECEIPT = {
  receiptNumber: 'RCP-2026-0900',
  paymentId: PAYMENT_ID,
  invoiceNumber: '2 invoices',
  studentId: STUDENT_1,
  studentName: 'Sunita Rai, Bikash Rai',
  amount: 2500,
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
} = {}) {
  const ownershipStudentIds = overrides.ownershipStudentIds ?? [STUDENT_1, STUDENT_2];
  const owned = new Set(overrides.ownedStudentIds ?? [STUDENT_1, STUDENT_2]);

  const paymentsService: any = {
    getReceiptWithOwnershipTargets: jest
      .fn()
      .mockResolvedValue({ receipt: RECEIPT, ownershipStudentIds }),
    getReceiptPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake')),
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
  };
  const controller = new PaymentsController(
    paymentsService,
    identityClient,
    {} as any,
    {} as any,
    new JobsDispatcherService({}), // C3.7 — inline transport, as before
  );
  return { controller, paymentsService, identityClient };
}

describe('PaymentsController receipt ownership — review F3', () => {
  describe('GET payments/:paymentId/receipt (JSON)', () => {
    it('review F3 — guardian owning ALL targets receives the multi-target receipt', async () => {
      const { controller, identityClient } = buildController();

      const receipt = await controller.getReceipt(PAYMENT_ID, SCHOOL_ID, tenant('Parent'), req);

      expect(receipt).toBe(RECEIPT);
      expect(identityClient.enforceStudentOwnership).toHaveBeenCalledTimes(2);
      expect(identityClient.enforceStudentOwnership).toHaveBeenCalledWith(
        STUDENT_1, SCHOOL_ID, expect.anything(),
      );
      expect(identityClient.enforceStudentOwnership).toHaveBeenCalledWith(
        STUDENT_2, SCHOOL_ID, expect.anything(),
      );
    });

    it('review F3 — guardian owning only ONE target is denied (403)', async () => {
      const { controller } = buildController({ ownedStudentIds: [STUDENT_1] });

      await expect(
        controller.getReceipt(PAYMENT_ID, SCHOOL_ID, tenant('Parent'), req),
      ).rejects.toThrow(ForbiddenException);
    });

    it('review F3 — staff (identity-side ownership bypass) still receives the receipt', async () => {
      const { controller, identityClient } = buildController({ staffBypass: true, ownedStudentIds: [] });

      const receipt = await controller.getReceipt(PAYMENT_ID, SCHOOL_ID, tenant('SchoolAdmin'), req);

      expect(receipt).toBe(RECEIPT);
      // The loop still runs — the bypass lives in the identity client.
      expect(identityClient.enforceStudentOwnership).toHaveBeenCalledTimes(2);
    });

    it('review F3 — single-target payment enforces exactly ONE ownership check (legacy behavior byte-identical)', async () => {
      const { controller, identityClient } = buildController({
        ownershipStudentIds: [STUDENT_1],
        ownedStudentIds: [STUDENT_1],
      });

      await controller.getReceipt(PAYMENT_ID, SCHOOL_ID, tenant('Parent'), req);

      expect(identityClient.enforceStudentOwnership).toHaveBeenCalledTimes(1);
      expect(identityClient.enforceStudentOwnership).toHaveBeenCalledWith(
        STUDENT_1, SCHOOL_ID, expect.anything(),
      );
    });
  });

  describe('GET payments/:paymentId/receipt/pdf', () => {
    function makeRes() {
      return { set: jest.fn(), send: jest.fn(), status: jest.fn() } as any;
    }

    it('review F3 — guardian owning ALL targets gets the PDF', async () => {
      const { controller, paymentsService, identityClient } = buildController();
      const res = makeRes();

      await controller.getReceiptPdf(PAYMENT_ID, SCHOOL_ID, tenant('Parent'), req, res);

      expect(identityClient.enforceStudentOwnership).toHaveBeenCalledTimes(2);
      expect(paymentsService.getReceiptPdf).toHaveBeenCalledWith(
        SCHOOL_ID, PAYMENT_ID, expect.anything(),
      );
      expect(res.send).toHaveBeenCalledWith(expect.any(Buffer));
    });

    it('review F3 — guardian owning only ONE target is denied BEFORE any render', async () => {
      const { controller, paymentsService } = buildController({ ownedStudentIds: [STUDENT_2] });
      const res = makeRes();

      await expect(
        controller.getReceiptPdf(PAYMENT_ID, SCHOOL_ID, tenant('Parent'), req, res),
      ).rejects.toThrow(ForbiddenException);

      expect(paymentsService.getReceiptPdf).not.toHaveBeenCalled();
      expect(res.send).not.toHaveBeenCalled();
    });
  });
});
