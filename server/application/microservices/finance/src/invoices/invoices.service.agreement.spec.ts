/**
 * `InvoicesService` — EPIC-FB settled semantics (FB-3.3 suppression +
 * replacement, FB-3.4 duplicate-billing guard + override) on the single
 * `generate()` path and the worker `generateForBulkWorker()` path.
 *
 * The no-agreement/flag-off byte-identical contract lives in
 * `invoices.service.golden.spec.ts`; the flag-off suite in
 * `invoices.service.flag-off.spec.ts`. This file covers the agreement
 * branch itself: partition, fixed_total/per_student replacement lines,
 * covered-set-empty passthrough, custom-line coexistence, totals math,
 * the 409 AGREEMENT_ACTIVE guard shape, and the overrideAgreement bypass
 * with its AGREEMENT_BYPASSED audit emission.
 */

import { ConflictException, Logger } from '@nestjs/common';
import { AuditLoggerService, AuditAction } from '@app/logger';
import { InvoicesService } from './invoices.service';
import type { InvoiceEntity } from '../common/entities/invoice.entity';

const TENANT_ID = 'tenant-uuid';
const SCHOOL_ID = 'school-uuid';
const STUDENT_ID = 'student-uuid';
const OTHER_STUDENT_ID = 'other-student-uuid';

const ctx = {
  tenantId: TENANT_ID,
  userId: 'user-1',
  email: 'op@test.com',
  jwtToken: 'jwt',
  role: 'TenantAdmin',
  schoolId: SCHOOL_ID,
} as any;

const FS_TUITION = {
  feeStructureId: 'fs-1',
  name: 'Monthly Tuition',
  amount: 1000,
  feeType: 'tuition',
  frequency: 'monthly',
  gradeLevels: [],
  taxRate: 0,
  taxType: undefined,
  version: 1,
};
const FS_TRANSPORT = {
  feeStructureId: 'fs-2',
  name: 'Transport Fee',
  amount: 500,
  feeType: 'transport',
  frequency: 'monthly',
  gradeLevels: [],
  taxRate: 0,
  taxType: undefined,
  version: 1,
};
const FS_EXAM = {
  feeStructureId: 'fs-3',
  name: 'Exam Fee',
  amount: 300,
  feeType: 'exam',
  frequency: 'monthly',
  gradeLevels: [],
  taxRate: 0,
  taxType: undefined,
  version: 1,
};
const ALL_FS: Record<string, any> = {
  'fs-1': FS_TUITION,
  'fs-2': FS_TRANSPORT,
  'fs-3': FS_EXAM,
};

function fixedTotalAgreement(overrides: Record<string, any> = {}) {
  return {
    agreementId: 'agr-1',
    schoolId: SCHOOL_ID,
    title: 'Shrestha Family 2083',
    studentIds: [STUDENT_ID, OTHER_STUDENT_ID],
    agreementType: 'fixed_total',
    coveredFeeTypes: ['tuition'],
    terms: {
      agreementType: 'fixed_total',
      totalAmount: 20000,
      allocation: [
        { studentId: STUDENT_ID, amount: 12000 },
        { studentId: OTHER_STUDENT_ID, amount: 8000 },
      ],
    },
    status: 'active',
    effectiveFrom: '2026-04-14',
    effectiveTo: '2027-04-13',
    isActive: true,
    version: 2,
    ...overrides,
  };
}

function perStudentAgreement(overrides: Record<string, any> = {}) {
  return fixedTotalAgreement({
    agreementType: 'per_student',
    coveredFeeTypes: ['tuition', 'exam'],
    terms: {
      agreementType: 'per_student',
      lines: [
        { studentId: STUDENT_ID, feeType: 'tuition', amount: 9000 },
        { studentId: STUDENT_ID, feeType: 'exam', amount: 500 },
        // Different student — never matches for STUDENT_ID.
        { studentId: OTHER_STUDENT_ID, feeType: 'tuition', amount: 1 },
        // Lump-sum line (no feeType) — never matches (settled semantics 5b).
        { studentId: STUDENT_ID, amount: 99 },
      ],
    },
    version: 3,
    ...overrides,
  });
}

function makeDto(overrides: Record<string, unknown> = {}) {
  return {
    studentId: STUDENT_ID,
    feeStructureIds: ['fs-1', 'fs-2'],
    academicYear: '2082-83',
    billingPeriod: '2083-03',
    dueDate: '2026-08-15',
    issuedDate: '2026-07-10',
    ...overrides,
  } as any;
}

describe('InvoicesService — agreement pricing (FB-3.3/FB-3.4)', () => {
  const ORIGINAL_FLAG = process.env.BILLING_AGREEMENTS_ENABLED;
  let service: InvoicesService;
  let dynamoDBClient: any;
  let feeStructuresService: any;
  let agreementResolver: { getActiveAgreementForStudent: jest.Mock };
  let auditLogSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    delete process.env.BILLING_AGREEMENTS_ENABLED;

    dynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({}),
      getItem: jest.fn().mockResolvedValue(null),
      putItem: jest.fn().mockResolvedValue(undefined),
      queryGSI: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    };
    feeStructuresService = {
      getByIds: jest.fn(async (_school: string, ids: string[]) =>
        ids.map((id) => ALL_FS[id]).filter(Boolean),
      ),
    };
    agreementResolver = {
      getActiveAgreementForStudent: jest.fn().mockResolvedValue(null),
    };

    service = new InvoicesService(
      dynamoDBClient,
      { publishInvoiceGenerated: jest.fn().mockResolvedValue(undefined) } as any,
      {
        getStudentInfo: jest.fn().mockResolvedValue({
          studentId: STUDENT_ID,
          firstName: 'Aakriti',
          lastName: 'Sharma',
          gradeLevel: '4',
        }),
        getSchoolName: jest.fn().mockResolvedValue('Test School'),
      } as any,
      { getCurrency: jest.fn().mockResolvedValue('NPR') } as any,
      { nextInvoiceNumber: jest.fn().mockResolvedValue('INV-2026-0001') } as any,
      feeStructuresService,
      {
        getOrCreate: jest.fn().mockResolvedValue({
          accountId: 'account-uuid',
          studentId: STUDENT_ID,
        }),
        recordLedgerEntry: jest.fn().mockResolvedValue(undefined),
      } as any,
      { optimize: jest.fn(async (u: string) => u) } as any,
      agreementResolver as any,
    );

    auditLogSpy = jest
      .spyOn(AuditLoggerService.prototype, 'log')
      .mockImplementation(() => {});
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    auditLogSpy.mockRestore();
    warnSpy.mockRestore();
    if (ORIGINAL_FLAG === undefined) delete process.env.BILLING_AGREEMENTS_ENABLED;
    else process.env.BILLING_AGREEMENTS_ENABLED = ORIGINAL_FLAG;
  });

  function putEntity(): InvoiceEntity {
    const calls = dynamoDBClient.putItem.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls[calls.length - 1][1] as InvoiceEntity;
  }

  describe('FB-3.3 — suppression + replacement on generate()', () => {
    it('resolves on the billing date (dto.issuedDate) with the studentId + schoolId', async () => {
      await service.generate(SCHOOL_ID, makeDto(), ctx);

      expect(agreementResolver.getActiveAgreementForStudent).toHaveBeenCalledWith(
        STUDENT_ID,
        SCHOOL_ID,
        '2026-07-10',
        ctx,
        undefined,
      );
    });

    it('fixed_total, mixed covered/uncovered → tuition suppressed, ONE allocation line, transport standard', async () => {
      agreementResolver.getActiveAgreementForStudent.mockResolvedValue({
        agreement: fixedTotalAgreement(),
        allocationForStudent: 12000,
      });

      await service.generate(SCHOOL_ID, makeDto(), ctx);

      const entity = putEntity();
      expect(entity.lineItems).toHaveLength(2);

      const [transportLine, agreementLine] = entity.lineItems;
      expect(transportLine.feeStructureId).toBe('fs-2');
      expect(transportLine.description).toBe('Transport Fee');
      expect(transportLine.agreementId).toBeUndefined();
      expect(transportLine.suppressedFeeStructureIds).toBeUndefined();

      expect(agreementLine).toEqual(
        expect.objectContaining({
          description: 'Shrestha Family 2083 (family agreement)',
          amount: 12000,
          quantity: 1,
          discount: 0,
          taxRate: 0,
          taxAmount: 0,
          total: 12000,
          agreementId: 'agr-1',
          agreementVersion: 2,
          suppressedFeeStructureIds: ['fs-1'],
        }),
      );
      // Synthetic non-resolvable id (custom-line convention), NOT fs-1.
      expect(agreementLine.feeStructureId).not.toBe('fs-1');
      expect(agreementLine.isCustom).toBeUndefined();

      // Header provenance.
      expect(entity.feeOverrideMode).toBe('agreement');
      expect(entity.agreementId).toBe('agr-1');
      expect(entity.agreementVersion).toBe(2);

      // Totals flow through the existing aggregation untouched.
      expect(entity.subtotal).toBe(12500);
      expect(entity.discountTotal).toBe(0);
      expect(entity.taxTotal).toBe(0);
      expect(entity.grandTotal).toBe(12500);
      expect(entity.amountDue).toBe(12500);
      expect(entity.taxSummary).toEqual([
        { taxType: 'none', taxableAmount: 12500, taxRate: 0, taxAmount: 0 },
      ]);

      // gradeLevel snapshot ran identically on the agreement path (hook
      // executes BEFORE the snapshot block — PR-CA convention).
      expect(entity.gradeLevel).toBe('4');
      expect(entity.gradeLevelResolutionStatus).toBe('resolved');
    });

    it('fixed_total, fully covered request → agreement line only', async () => {
      agreementResolver.getActiveAgreementForStudent.mockResolvedValue({
        agreement: fixedTotalAgreement(),
        allocationForStudent: 12000,
      });

      await service.generate(SCHOOL_ID, makeDto({ feeStructureIds: ['fs-1'] }), ctx);

      const entity = putEntity();
      expect(entity.lineItems).toHaveLength(1);
      expect(entity.lineItems[0].agreementId).toBe('agr-1');
      expect(entity.grandTotal).toBe(12000);
      expect(entity.feeOverrideMode).toBe('agreement');
    });

    it('fixed_total with null allocation → suppression only, no replacement line', async () => {
      agreementResolver.getActiveAgreementForStudent.mockResolvedValue({
        agreement: fixedTotalAgreement(),
        allocationForStudent: null,
      });

      await service.generate(SCHOOL_ID, makeDto(), ctx);

      const entity = putEntity();
      expect(entity.lineItems).toHaveLength(1);
      expect(entity.lineItems[0].feeStructureId).toBe('fs-2');
      expect(entity.grandTotal).toBe(500);
      // Invoice still carries provenance — the covered set was non-empty.
      expect(entity.feeOverrideMode).toBe('agreement');
    });

    it('per_student → one line per matching lines[] entry (feeType ∈ covered); lump-sum + other-student lines skipped', async () => {
      agreementResolver.getActiveAgreementForStudent.mockResolvedValue({
        agreement: perStudentAgreement(),
        allocationForStudent: 9599,
      });

      await service.generate(
        SCHOOL_ID,
        makeDto({ feeStructureIds: ['fs-1', 'fs-2', 'fs-3'] }),
        ctx,
      );

      const entity = putEntity();
      expect(entity.lineItems).toHaveLength(3);

      const [transportLine, tuitionLine, examLine] = entity.lineItems;
      expect(transportLine.feeStructureId).toBe('fs-2');

      expect(tuitionLine).toEqual(
        expect.objectContaining({
          description: 'Shrestha Family 2083 — tuition (family agreement)',
          feeType: 'tuition',
          amount: 9000,
          total: 9000,
          agreementId: 'agr-1',
          agreementVersion: 3,
          suppressedFeeStructureIds: ['fs-1', 'fs-3'],
        }),
      );
      expect(examLine).toEqual(
        expect.objectContaining({
          description: 'Shrestha Family 2083 — exam (family agreement)',
          feeType: 'exam',
          amount: 500,
          total: 500,
          agreementId: 'agr-1',
          agreementVersion: 3,
          suppressedFeeStructureIds: ['fs-1', 'fs-3'],
        }),
      );

      expect(entity.grandTotal).toBe(10000); // 500 transport + 9000 + 500
      expect(entity.agreementVersion).toBe(3);
    });

    it("per_student line whose feeType is covered by the agreement but NOT in the request is not appended", async () => {
      agreementResolver.getActiveAgreementForStudent.mockResolvedValue({
        agreement: perStudentAgreement(),
        allocationForStudent: 9500,
      });

      // Request only tuition (+uncovered transport) — the exam agreement
      // line must not bill something the operator didn't request.
      await service.generate(SCHOOL_ID, makeDto({ feeStructureIds: ['fs-1', 'fs-2'] }), ctx);

      const entity = putEntity();
      expect(entity.lineItems).toHaveLength(2);
      expect(entity.lineItems[1].feeType).toBe('tuition');
      expect(entity.lineItems[1].suppressedFeeStructureIds).toEqual(['fs-1']);
      expect(entity.grandTotal).toBe(9500);
    });

    it('covered set empty (agreement covers hostel only) → standard lines, invoice carries NO agreement fields', async () => {
      agreementResolver.getActiveAgreementForStudent.mockResolvedValue({
        agreement: fixedTotalAgreement({ coveredFeeTypes: ['hostel'] }),
        allocationForStudent: 12000,
      });

      await service.generate(SCHOOL_ID, makeDto(), ctx);

      const entity = putEntity();
      expect(entity.lineItems).toHaveLength(2);
      expect(entity.lineItems.map((li) => li.feeStructureId)).toEqual(['fs-1', 'fs-2']);
      expect(entity.feeOverrideMode).toBeUndefined();
      expect(entity.agreementId).toBeUndefined();
      expect(entity.agreementVersion).toBeUndefined();
      expect(entity.grandTotal).toBe(1500);
    });

    it('custom lines coexist — appended AFTER agreement lines; discount on suppressed fee vanishes, on billable fee applies', async () => {
      agreementResolver.getActiveAgreementForStudent.mockResolvedValue({
        agreement: fixedTotalAgreement(),
        allocationForStudent: 12000,
      });

      await service.generate(
        SCHOOL_ID,
        makeDto({
          customLineItems: [{ name: 'Annual picnic', amount: 250 }],
          discounts: [
            { feeStructureId: 'fs-1', amount: 100, reason: 'suppressed — must vanish' },
            { feeStructureId: 'fs-2', amount: 50, reason: 'billable — applies' },
          ],
        }),
        ctx,
      );

      const entity = putEntity();
      expect(entity.lineItems).toHaveLength(3);
      const [transportLine, agreementLine, customLine] = entity.lineItems;

      expect(transportLine.discount).toBe(50);
      expect(agreementLine.agreementId).toBe('agr-1');
      expect(agreementLine.discount).toBe(0);
      expect(customLine.isCustom).toBe(true);
      expect(customLine.description).toBe('Annual picnic');

      // 500 - 50 + 12000 + 250
      expect(entity.subtotal).toBe(12750);
      expect(entity.discountTotal).toBe(50);
      expect(entity.grandTotal).toBe(12700);
    });
  });

  describe('FB-3.4 — duplicate-billing guard', () => {
    beforeEach(() => {
      agreementResolver.getActiveAgreementForStudent.mockResolvedValue({
        agreement: fixedTotalAgreement(),
        allocationForStudent: 12000,
      });
    });

    function existingInvoice(overrides: Record<string, any> = {}) {
      return {
        invoiceId: 'inv-9',
        invoiceNumber: 'INV-2026-0009',
        agreementId: 'agr-1',
        billingPeriod: '2083-03',
        status: 'issued',
        ...overrides,
      };
    }

    it('same agreementId, non-cancelled → 409 AGREEMENT_ACTIVE with the full payload; nothing written', async () => {
      dynamoDBClient.queryGSI.mockResolvedValue({ items: [existingInvoice()], hasMore: false });

      let thrown: any;
      try {
        await service.generate(SCHOOL_ID, makeDto(), ctx);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(ConflictException);
      expect(thrown.getResponse()).toEqual({
        code: 'AGREEMENT_ACTIVE',
        message:
          'This agreement already priced an invoice this term; agreements bill once per term. ' +
          'Pass overrideAgreement to bill standard fees anyway.',
        agreementId: 'agr-1',
        existingInvoiceId: 'inv-9',
        existingInvoiceNumber: 'INV-2026-0009',
        coveredFeeTypes: ['tuition'],
      });
      expect(dynamoDBClient.putItem).not.toHaveBeenCalled();
    });

    it('guard queries the student GSI2 invoice partition', async () => {
      dynamoDBClient.queryGSI.mockResolvedValue({ items: [existingInvoice()], hasMore: false });

      await expect(service.generate(SCHOOL_ID, makeDto(), ctx)).rejects.toThrow(ConflictException);

      expect(dynamoDBClient.queryGSI).toHaveBeenCalledWith(
        expect.anything(),
        'GSI2',
        `TENANT#${TENANT_ID}#STUDENT#${STUDENT_ID}`,
        'INVOICE',
        'begins_with',
        undefined,
        undefined,
        undefined,
        100,
        false,
        undefined,
      );
    });

    it('review F4 — same agreementId, DIFFERENT billingPeriod label → still 409 (agreements bill once per term)', async () => {
      // Owner decision 2026-07-05: agreement amounts are per-term totals;
      // the guard ignores the billingPeriod label entirely.
      dynamoDBClient.queryGSI.mockResolvedValue({
        items: [existingInvoice({ billingPeriod: '2083-02' })],
        hasMore: false,
      });

      await expect(service.generate(SCHOOL_ID, makeDto(), ctx)).rejects.toThrow(ConflictException);
      expect(dynamoDBClient.putItem).not.toHaveBeenCalled();
    });

    it('review F2 — guard paginates: the conflicting invoice on page 2 is found (409, nothing written)', async () => {
      const page2Cursor = Buffer.from(JSON.stringify({ entityKey: 'INVOICE#page-1-end' })).toString('base64');
      dynamoDBClient.queryGSI
        .mockResolvedValueOnce({ items: [], hasMore: true, lastEvaluatedKey: page2Cursor })
        .mockResolvedValueOnce({ items: [existingInvoice()], hasMore: false });

      await expect(service.generate(SCHOOL_ID, makeDto(), ctx)).rejects.toThrow(ConflictException);
      expect(dynamoDBClient.queryGSI).toHaveBeenCalledTimes(2);
      // Page 2 was requested with the decoded ExclusiveStartKey.
      expect(dynamoDBClient.queryGSI.mock.calls[1][10]).toEqual({ entityKey: 'INVOICE#page-1-end' });
      expect(dynamoDBClient.putItem).not.toHaveBeenCalled();
    });

    it('review F2 — guard scan hitting the 25-page cap throws INVOICE_SCAN_LIMIT_EXCEEDED (never silently passes)', async () => {
      const cursor = Buffer.from(JSON.stringify({ entityKey: 'k' })).toString('base64');
      dynamoDBClient.queryGSI.mockResolvedValue({ items: [], hasMore: true, lastEvaluatedKey: cursor });

      let thrown: any;
      try {
        await service.generate(SCHOOL_ID, makeDto(), ctx);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(ConflictException);
      expect(thrown.getResponse().code).toBe('INVOICE_SCAN_LIMIT_EXCEEDED');
      expect(dynamoDBClient.queryGSI).toHaveBeenCalledTimes(25);
      expect(dynamoDBClient.putItem).not.toHaveBeenCalled();
    });

    it('cancelled + written_off rows never conflict', async () => {
      dynamoDBClient.queryGSI.mockResolvedValue({
        items: [
          existingInvoice({ status: 'cancelled' }),
          existingInvoice({ invoiceId: 'inv-10', status: 'written_off' }),
        ],
        hasMore: false,
      });

      await service.generate(SCHOOL_ID, makeDto(), ctx);
      expect(putEntity().feeOverrideMode).toBe('agreement');
    });

    it('a different agreementId on the existing invoice never conflicts', async () => {
      dynamoDBClient.queryGSI.mockResolvedValue({
        items: [existingInvoice({ agreementId: 'agr-OTHER' })],
        hasMore: false,
      });

      await service.generate(SCHOOL_ID, makeDto(), ctx);
      expect(putEntity().feeOverrideMode).toBe('agreement');
    });

    it('request WITHOUT billingPeriod → 409 too (the label is irrelevant to the per-term guard, review F4)', async () => {
      dynamoDBClient.queryGSI.mockResolvedValue({
        items: [existingInvoice({ billingPeriod: '2083-01' })],
        hasMore: false,
      });

      await expect(
        service.generate(SCHOOL_ID, makeDto({ billingPeriod: undefined }), ctx),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('FB-3.4 — overrideAgreement bypass + AGREEMENT_BYPASSED audit', () => {
    it('override with an active agreement → standard fees exactly as requested, no agreement fields, audit emitted', async () => {
      agreementResolver.getActiveAgreementForStudent.mockResolvedValue({
        agreement: fixedTotalAgreement(),
        allocationForStudent: 12000,
      });

      await service.generate(SCHOOL_ID, makeDto({ overrideAgreement: true }), ctx);

      const entity = putEntity();
      expect(entity.lineItems.map((li) => li.feeStructureId)).toEqual(['fs-1', 'fs-2']);
      expect(entity.feeOverrideMode).toBeUndefined();
      expect(entity.agreementId).toBeUndefined();
      expect(entity.grandTotal).toBe(1500);

      expect(auditLogSpy).toHaveBeenCalledWith(
        AuditAction.AGREEMENT_BYPASSED,
        expect.objectContaining({ tenantId: TENANT_ID, userId: 'user-1' }),
        { type: 'AGREEMENT', id: 'agr-1', name: 'Shrestha Family 2083' },
        {
          schoolId: SCHOOL_ID,
          studentId: STUDENT_ID,
          requestedFeeStructureIds: ['fs-1', 'fs-2'],
        },
      );

      // Override precedes the partition + guard — no conflict query fired.
      expect(dynamoDBClient.queryGSI).not.toHaveBeenCalled();
    });

    it('override bypasses the duplicate guard even when a conflicting invoice exists', async () => {
      agreementResolver.getActiveAgreementForStudent.mockResolvedValue({
        agreement: fixedTotalAgreement(),
        allocationForStudent: 12000,
      });
      dynamoDBClient.queryGSI.mockResolvedValue({
        items: [
          {
            invoiceId: 'inv-9',
            invoiceNumber: 'INV-2026-0009',
            agreementId: 'agr-1',
            billingPeriod: '2083-03',
            status: 'issued',
          },
        ],
        hasMore: false,
      });

      await service.generate(SCHOOL_ID, makeDto({ overrideAgreement: true }), ctx);
      expect(putEntity().feeOverrideMode).toBeUndefined();
    });

    it('override with NO active agreement → standard path, no audit noise', async () => {
      await service.generate(SCHOOL_ID, makeDto({ overrideAgreement: true }), ctx);

      expect(putEntity().feeOverrideMode).toBeUndefined();
      expect(auditLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('FB-3.7 — generateForBulkWorker routes through the same hook (mixed-coverage run)', () => {
    function workerDto(studentId: string) {
      return {
        studentId,
        feeStructureIds: ['fs-1', 'fs-2'],
        academicYear: '2082-83',
        billingPeriod: '2083-03',
        dueDate: '2026-08-15',
        preAllocatedInvoiceNumber: 'INV-2026-0100',
        cachedSchoolName: 'Test School',
        cachedCurrency: 'NPR',
      } as any;
    }

    it('covered student gets suppression + agreement line; uncovered student stays standard; ONE memo instance reaches the resolver', async () => {
      agreementResolver.getActiveAgreementForStudent.mockImplementation(
        async (studentId: string) =>
          studentId === STUDENT_ID
            ? { agreement: fixedTotalAgreement(), allocationForStudent: 12000 }
            : null,
      );
      const memo = new Map();

      await service.generateForBulkWorker(SCHOOL_ID, workerDto(STUDENT_ID), ctx, memo);
      const coveredEntity = putEntity();

      await service.generateForBulkWorker(SCHOOL_ID, workerDto(OTHER_STUDENT_ID), ctx, memo);
      const standardEntity = putEntity();

      expect(coveredEntity.feeOverrideMode).toBe('agreement');
      expect(coveredEntity.agreementId).toBe('agr-1');
      expect(coveredEntity.lineItems).toHaveLength(2);
      expect(coveredEntity.lineItems[1].suppressedFeeStructureIds).toEqual(['fs-1']);
      expect(coveredEntity.status).toBe('draft');

      expect(standardEntity.feeOverrideMode).toBeUndefined();
      expect(standardEntity.lineItems.map((li) => li.feeStructureId)).toEqual(['fs-1', 'fs-2']);

      for (const call of agreementResolver.getActiveAgreementForStudent.mock.calls) {
        expect(call[4]).toBe(memo);
      }
    });

    it('duplicate guard fires on the worker path too (409 rejects, nothing written)', async () => {
      agreementResolver.getActiveAgreementForStudent.mockResolvedValue({
        agreement: fixedTotalAgreement(),
        allocationForStudent: 12000,
      });
      dynamoDBClient.queryGSI.mockResolvedValue({
        items: [
          {
            invoiceId: 'inv-9',
            invoiceNumber: 'INV-2026-0009',
            agreementId: 'agr-1',
            billingPeriod: '2083-03',
            status: 'issued',
          },
        ],
        hasMore: false,
      });

      await expect(
        service.generateForBulkWorker(SCHOOL_ID, workerDto(STUDENT_ID), ctx, new Map()),
      ).rejects.toThrow(ConflictException);
      expect(dynamoDBClient.putItem).not.toHaveBeenCalled();
    });
  });
});
