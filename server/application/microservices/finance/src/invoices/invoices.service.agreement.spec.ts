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
  let financeAuditService: { emit: jest.Mock };
  let auditLogSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    delete process.env.BILLING_AGREEMENTS_ENABLED;

    dynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({}),
      getItem: jest.fn().mockResolvedValue(null),
      putItem: jest.fn().mockResolvedValue(undefined),
      // BH-1.1 — agreement-priced invoices persist via a lock+invoice
      // transactWrite; standard invoices still use the bare putItem.
      transactWrite: jest.fn().mockResolvedValue(undefined),
      getTableName: jest.fn().mockReturnValue('edforge-finance-test'),
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
    financeAuditService = { emit: jest.fn().mockResolvedValue(undefined) };

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
        // No sibling rules reach the AY resolver in this suite (queryGSI
        // returns [] for DISCOUNT_RULE), so getAcademicYears is unused.
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
      // siblingCountResolver — unused here (no sibling rules).
      { getActiveSiblingCount: jest.fn().mockResolvedValue(0) } as any,
      // BH-1.2/1.3 — queryable AGREEMENT_BYPASSED audit emit.
      financeAuditService as any,
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

  // BH-1.1 — agreement-priced invoices are the 2nd Put in the lock+invoice
  // transactWrite; standard/bypass invoices are the bare-putItem Item.
  function putEntity(): InvoiceEntity {
    const putCalls = dynamoDBClient.putItem.mock.calls;
    if (putCalls.length > 0) return putCalls[putCalls.length - 1][1] as InvoiceEntity;
    const transactCalls = dynamoDBClient.transactWrite.mock.calls;
    expect(transactCalls.length).toBeGreaterThan(0);
    const items = transactCalls[transactCalls.length - 1][1] as any[];
    return items.find((it) => it.Put?.Item?.entityType === 'INVOICE').Put.Item as InvoiceEntity;
  }

  /** BH-1.1 — the term-lock Put in the most recent agreement transactWrite. */
  function lockPut(): any {
    const transactCalls = dynamoDBClient.transactWrite.mock.calls;
    expect(transactCalls.length).toBeGreaterThan(0);
    const items = transactCalls[transactCalls.length - 1][1] as any[];
    return items.find((it) => it.Put?.Item?.entityType === 'AGREEMENT_TERM_LOCK');
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

      // BH-1.2/1.3 — the QUERYABLE audit row is also emitted, AFTER the
      // invoice is persisted, carrying the real invoiceId + studentId.
      expect(financeAuditService.emit).toHaveBeenCalledWith(
        'finance.agreement.bypassed',
        expect.objectContaining({
          schoolId: SCHOOL_ID,
          studentId: STUDENT_ID,
          invoiceId: putEntity().invoiceId,
          metadata: expect.objectContaining({
            agreementId: 'agr-1',
            agreementTitle: 'Shrestha Family 2083',
            requestedFeeStructureIds: ['fs-1', 'fs-2'],
          }),
        }),
        ctx,
      );

      // Override precedes the partition + guard — no duplicate-billing GUARD
      // query fired (the GSI2 INVOICE scan). (An orthogonal sibling-rule GSI1
      // DISCOUNT_RULE query may fire now that siblingCountResolver is wired;
      // it's a no-op here — no rules — so scope the assertion to the guard.)
      const guardScans = dynamoDBClient.queryGSI.mock.calls.filter(
        (c: unknown[]) => c[1] === 'GSI2' && c[3] === 'INVOICE',
      );
      expect(guardScans).toHaveLength(0);
      // Bypass is standard-priced → bare putItem, no transactWrite.
      expect(dynamoDBClient.transactWrite).not.toHaveBeenCalled();
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
      // No active agreement → no bypass marker → no queryable row either.
      expect(financeAuditService.emit).not.toHaveBeenCalled();
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

  describe('round-3 fix A — version-chain per-term guard (F4 residual)', () => {
    // FB-3.6 versioning mints a NEW agreementId per version; the chain
    // root travels in versionParentId. "Once per term" must hold per
    // CHAIN, or a v1-priced live invoice coexists with a v2 invoice.
    const v2Agreement = () =>
      fixedTotalAgreement({ agreementId: 'agr-2', versionParentId: 'agr-1', version: 3 });

    it('fix A — invoice priced by an UNVERSIONED agreement stamps agreementChainId = its own id', async () => {
      agreementResolver.getActiveAgreementForStudent.mockResolvedValue({
        agreement: fixedTotalAgreement(),
        allocationForStudent: 12000,
      });

      await service.generate(SCHOOL_ID, makeDto(), ctx);

      const entity = putEntity();
      expect(entity.agreementId).toBe('agr-1');
      expect(entity.agreementChainId).toBe('agr-1');
    });

    it('fix A — invoice priced by a VERSIONED agreement stamps the chain ROOT, not the version id', async () => {
      agreementResolver.getActiveAgreementForStudent.mockResolvedValue({
        agreement: v2Agreement(),
        allocationForStudent: 12000,
      });

      await service.generate(SCHOOL_ID, makeDto(), ctx);

      const entity = putEntity();
      expect(entity.agreementId).toBe('agr-2');
      expect(entity.agreementVersion).toBe(3);
      expect(entity.agreementChainId).toBe('agr-1');
    });

    it('fix A — live invoice priced by v1 blocks generation under v2 (new id, same root) → 409, nothing written', async () => {
      agreementResolver.getActiveAgreementForStudent.mockResolvedValue({
        agreement: v2Agreement(),
        allocationForStudent: 12000,
      });
      dynamoDBClient.queryGSI.mockResolvedValue({
        items: [
          {
            invoiceId: 'inv-9',
            invoiceNumber: 'INV-2026-0009',
            agreementId: 'agr-1',
            agreementChainId: 'agr-1',
            billingPeriod: '2083-03',
            status: 'issued',
          },
        ],
        hasMore: false,
      });

      let thrown: any;
      try {
        await service.generate(SCHOOL_ID, makeDto(), ctx);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(ConflictException);
      expect(thrown.getResponse().code).toBe('AGREEMENT_ACTIVE');
      expect(thrown.getResponse().existingInvoiceId).toBe('inv-9');
      expect(dynamoDBClient.putItem).not.toHaveBeenCalled();
    });

    it('fix A — belt-and-braces: an existing row LACKING agreementChainId still blocks on agreementId equality', async () => {
      agreementResolver.getActiveAgreementForStudent.mockResolvedValue({
        agreement: v2Agreement(),
        allocationForStudent: 12000,
      });
      // Hand-written / hypothetical row carrying only the v2 agreementId.
      dynamoDBClient.queryGSI.mockResolvedValue({
        items: [
          {
            invoiceId: 'inv-10',
            invoiceNumber: 'INV-2026-0010',
            agreementId: 'agr-2',
            status: 'issued',
          },
        ],
        hasMore: false,
      });

      await expect(service.generate(SCHOOL_ID, makeDto(), ctx)).rejects.toThrow(ConflictException);
      expect(dynamoDBClient.putItem).not.toHaveBeenCalled();
    });

    it('fix A — CANCELLED v1 invoice does not block v2 generation; the new invoice carries the chain id', async () => {
      agreementResolver.getActiveAgreementForStudent.mockResolvedValue({
        agreement: v2Agreement(),
        allocationForStudent: 12000,
      });
      dynamoDBClient.queryGSI.mockResolvedValue({
        items: [
          {
            invoiceId: 'inv-9',
            invoiceNumber: 'INV-2026-0009',
            agreementId: 'agr-1',
            agreementChainId: 'agr-1',
            billingPeriod: '2083-03',
            status: 'cancelled',
          },
        ],
        hasMore: false,
      });

      await service.generate(SCHOOL_ID, makeDto(), ctx);

      const entity = putEntity();
      expect(entity.feeOverrideMode).toBe('agreement');
      expect(entity.agreementId).toBe('agr-2');
      expect(entity.agreementChainId).toBe('agr-1');
    });
  });

  // ==========================================================================
  // BH-1.1 (epic §3.6 R11) — atomic per-term lock closes the read-then-put
  // TOCTOU: agreement-priced invoices write in a lock+invoice transactWrite;
  // a concurrent generation whose lock put is rejected → 409 AGREEMENT_ACTIVE,
  // no invoice written. Standard invoices keep the bare putItem.
  // ==========================================================================
  describe('BH-1.1 — R11 per-term lock (atomic duplicate-billing backstop)', () => {
    beforeEach(() => {
      agreementResolver.getActiveAgreementForStudent.mockResolvedValue({
        agreement: fixedTotalAgreement(),
        allocationForStudent: 12000,
      });
    });

    it('agreement-priced generate() issues a transactWrite: [lock Put (attribute_not_exists), invoice Put] — NOT a bare putItem', async () => {
      await service.generate(SCHOOL_ID, makeDto(), ctx);

      expect(dynamoDBClient.putItem).not.toHaveBeenCalled();
      expect(dynamoDBClient.transactWrite).toHaveBeenCalledTimes(1);

      const items = dynamoDBClient.transactWrite.mock.calls[0][1] as any[];
      expect(items).toHaveLength(2);
      // Lock is first so its CancellationReasons index (0) maps deterministically.
      expect(items[0].Put.ConditionExpression).toBe('attribute_not_exists(entityKey)');
      expect(items[0].Put.Item.entityType).toBe('AGREEMENT_TERM_LOCK');
      expect(items[1].Put.Item.entityType).toBe('INVOICE');
      expect(items[1].Put.Item).toBe(putEntity());
    });

    it('lock key + fields derive from (schoolId, studentId, agreementChainId); TTL is a positive epoch second', async () => {
      await service.generate(SCHOOL_ID, makeDto(), ctx);

      const lock = lockPut().Put.Item;
      expect(lock.entityKey).toBe(`AGREEMENT_TERM_LOCK#${SCHOOL_ID}#${STUDENT_ID}#agr-1`);
      expect(lock.agreementChainId).toBe('agr-1');
      expect(lock.agreementId).toBe('agr-1');
      expect(lock.schoolId).toBe(SCHOOL_ID);
      expect(lock.studentId).toBe(STUDENT_ID);
      // effectiveTo 2027-04-13 + 30-day grace → a real future epoch second.
      expect(typeof lock.ttl).toBe('number');
      expect(lock.ttl).toBeGreaterThan(0);
    });

    it('versioned agreement → lock keyed on the chain ROOT (agr-1), not the version id (agr-2)', async () => {
      agreementResolver.getActiveAgreementForStudent.mockResolvedValue({
        agreement: fixedTotalAgreement({ agreementId: 'agr-2', versionParentId: 'agr-1', version: 3 }),
        allocationForStudent: 12000,
      });

      await service.generate(SCHOOL_ID, makeDto(), ctx);

      const lock = lockPut().Put.Item;
      expect(lock.entityKey).toBe(`AGREEMENT_TERM_LOCK#${SCHOOL_ID}#${STUDENT_ID}#agr-1`);
      expect(lock.agreementChainId).toBe('agr-1');
      expect(lock.agreementId).toBe('agr-2');
    });

    it('concurrent generation: lock Put rejected (TransactionCanceledException, reason[0]=ConditionalCheckFailed) → 409 AGREEMENT_ACTIVE, invoice NOT written', async () => {
      const cancelErr: any = new Error('transaction cancelled');
      cancelErr.name = 'TransactionCanceledException';
      cancelErr.CancellationReasons = [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }];
      dynamoDBClient.transactWrite.mockRejectedValue(cancelErr);

      let thrown: any;
      try {
        await service.generate(SCHOOL_ID, makeDto(), ctx);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(ConflictException);
      expect(thrown.getResponse().code).toBe('AGREEMENT_ACTIVE');
      expect(thrown.getResponse().agreementId).toBe('agr-1');
      // No invoice landed (the whole transact rolled back).
      expect(dynamoDBClient.putItem).not.toHaveBeenCalled();
    });

    it('a NON-lock cancellation (e.g. throughput) re-throws the original TransactionCanceledException so the worker retry envelope still applies', async () => {
      const cancelErr: any = new Error('transaction cancelled');
      cancelErr.name = 'TransactionCanceledException';
      // index 0 (lock) is fine; the invoice put failed for another reason.
      cancelErr.CancellationReasons = [{ Code: 'None' }, { Code: 'ThrottlingError' }];
      dynamoDBClient.transactWrite.mockRejectedValue(cancelErr);

      let thrown: any;
      try {
        await service.generate(SCHOOL_ID, makeDto(), ctx);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBe(cancelErr);
      expect(thrown.name).toBe('TransactionCanceledException');
    });

    it('STANDARD (no-agreement) generate() still uses the bare putItem — transactWrite NOT called', async () => {
      agreementResolver.getActiveAgreementForStudent.mockResolvedValue(null);

      await service.generate(SCHOOL_ID, makeDto(), ctx);

      expect(dynamoDBClient.putItem).toHaveBeenCalledTimes(1);
      expect(dynamoDBClient.transactWrite).not.toHaveBeenCalled();
    });

    it('generateForBulkWorker on the agreement path also writes via the lock transactWrite', async () => {
      await service.generateForBulkWorker(
        SCHOOL_ID,
        makeDto({
          preAllocatedInvoiceNumber: 'INV-2026-0100',
          cachedSchoolName: 'Test School',
          cachedCurrency: 'NPR',
        }),
        ctx,
        new Map(),
      );

      expect(dynamoDBClient.putItem).not.toHaveBeenCalled();
      expect(dynamoDBClient.transactWrite).toHaveBeenCalledTimes(1);
      expect(lockPut().Put.Item.entityType).toBe('AGREEMENT_TERM_LOCK');
    });

    it('bulk-worker lock 409 rejects as a ConflictException (recorded as a per-student failure, not a retryable transaction error)', async () => {
      const cancelErr: any = new Error('transaction cancelled');
      cancelErr.name = 'TransactionCanceledException';
      cancelErr.CancellationReasons = [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }];
      dynamoDBClient.transactWrite.mockRejectedValue(cancelErr);

      let thrown: any;
      try {
        await service.generateForBulkWorker(
          SCHOOL_ID,
          makeDto({
            preAllocatedInvoiceNumber: 'INV-2026-0100',
            cachedSchoolName: 'Test School',
            cachedCurrency: 'NPR',
          }),
          ctx,
          new Map(),
        );
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(ConflictException);
      expect(thrown.getResponse().code).toBe('AGREEMENT_ACTIVE');
      // The re-shaped ConflictException is NOT a TransactionCanceledException,
      // so the worker's retryWithJitter predicate skips it → the student lands
      // in failedStudentIds rather than looping the retry budget.
      expect(thrown.name).not.toBe('TransactionCanceledException');
    });
  });

  // ==========================================================================
  // BH-1.1 lock LIFECYCLE (regression) — the residual-lock bug: the per-term
  // lock was written but NEVER deleted on cancel/write-off, so a legitimate
  // re-bill after cancel passed the read-guard (dead statuses = re-billable)
  // then failed the lock's attribute_not_exists Put → spurious 409 until TTL.
  // These model a REAL residual lock across two generate() calls with a
  // stateful lock+invoice store, proving cancel/write-off now releases it.
  // ==========================================================================
  describe('BH-1.1 — per-term lock lifecycle (cancel/write-off release)', () => {
    // Stateful store: the lock Put enforces attribute_not_exists (a residual
    // lock rejects a re-bill), the lock Delete releases it, and the read-guard
    // (queryGSI GSI2 INVOICE) reflects live invoices so dead statuses stop
    // conflicting — the exact interaction the per-call mocks miss.
    let lockStore: Set<string>;
    let invoiceStore: Map<string, InvoiceEntity>;

    beforeEach(() => {
      lockStore = new Set();
      invoiceStore = new Map();

      // The top-level harness's eventsService only stubs publishInvoiceGenerated;
      // the cancel/update paths also publish status changes. updateItem isn't
      // stubbed there either (this suite writes via transactWrite). Fill both.
      (service as any).eventsService.publishInvoiceStatusChanged = jest
        .fn()
        .mockResolvedValue(undefined);
      dynamoDBClient.updateItem = jest.fn().mockResolvedValue(undefined);

      agreementResolver.getActiveAgreementForStudent.mockResolvedValue({
        agreement: fixedTotalAgreement(),
        allocationForStudent: 12000,
      });

      dynamoDBClient.transactWrite.mockImplementation(async (_client: unknown, items: any[]) => {
        // Validate lock-Put conditions first (DDB cancels the whole transact
        // if any condition fails); then apply mutations.
        for (const it of items) {
          if (it.Put?.Item?.entityType === 'AGREEMENT_TERM_LOCK') {
            if (lockStore.has(it.Put.Item.entityKey)) {
              const err: any = new Error('transaction cancelled');
              err.name = 'TransactionCanceledException';
              err.CancellationReasons = [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }];
              throw err;
            }
          }
        }
        for (const it of items) {
          if (it.Put?.Item?.entityType === 'AGREEMENT_TERM_LOCK') {
            lockStore.add(it.Put.Item.entityKey);
          } else if (it.Put?.Item?.entityType === 'INVOICE') {
            invoiceStore.set(it.Put.Item.entityKey, it.Put.Item);
          } else if (it.Delete?.Key?.entityKey?.startsWith?.('AGREEMENT_TERM_LOCK#')) {
            lockStore.delete(it.Delete.Key.entityKey);
          } else if (it.Update?.Key?.entityKey) {
            const stored = invoiceStore.get(it.Update.Key.entityKey);
            if (stored) {
              // update() sets :newStatus; cancelDraftInvoice() sets :cancelled.
              const vals = it.Update.ExpressionAttributeValues;
              stored.status = vals[':newStatus'] ?? vals[':cancelled'] ?? stored.status;
            }
          }
        }
      });

      dynamoDBClient.getItem.mockImplementation(async (_c: unknown, _t: string, key: string) =>
        invoiceStore.get(key) ?? null,
      );

      // Read-guard scan: return every stored invoice for the student (the
      // guard filters dead statuses itself).
      dynamoDBClient.queryGSI.mockImplementation(async (...args: unknown[]) =>
        args[3] === 'INVOICE'
          ? { items: [...invoiceStore.values()], hasMore: false }
          : { items: [], hasMore: false },
      );
    });

    it('generate → cancel (lock released) → regenerate SUCCEEDS (no spurious 409)', async () => {
      const first = await service.generate(SCHOOL_ID, makeDto(), ctx);
      expect(lockStore.size).toBe(1);
      const lockKey = `AGREEMENT_TERM_LOCK#${SCHOOL_ID}#${STUDENT_ID}#agr-1`;
      expect(lockStore.has(lockKey)).toBe(true);

      // Cancel the agreement invoice (issued→cancelled) — must release the lock.
      await service.update(SCHOOL_ID, first.id, { status: 'cancelled' } as any, ctx);
      expect(lockStore.has(lockKey)).toBe(false);

      // Re-bill the same term: passes the read-guard (cancelled = dead) AND the
      // lock Put (released) → succeeds. Pre-fix this threw 409 AGREEMENT_ACTIVE.
      const second = await service.generate(SCHOOL_ID, makeDto(), ctx);
      expect(second.status).not.toBe('cancelled');
      expect(lockStore.has(lockKey)).toBe(true);
    });

    it('write-off (overdue→written_off) also releases the lock so a re-bill succeeds', async () => {
      const first = await service.generate(SCHOOL_ID, makeDto(), ctx);
      const lockKey = `AGREEMENT_TERM_LOCK#${SCHOOL_ID}#${STUDENT_ID}#agr-1`;
      // Walk the invoice into overdue so written_off is a legal transition.
      [...invoiceStore.values()].find((inv) => inv.invoiceId === first.id)!.status = 'overdue';

      await service.update(SCHOOL_ID, first.id, { status: 'written_off' } as any, ctx);
      expect(lockStore.has(lockKey)).toBe(false);

      await expect(service.generate(SCHOOL_ID, makeDto(), ctx)).resolves.toBeDefined();
    });

    it('cancel of a STANDARD invoice issues NO lock Delete (bare updateItem, no transact)', async () => {
      agreementResolver.getActiveAgreementForStudent.mockResolvedValue(null);
      const first = await service.generate(SCHOOL_ID, makeDto(), ctx);
      expect(dynamoDBClient.transactWrite).not.toHaveBeenCalled();
      // Standard invoice was stored via the bare putItem, not the transact store.
      const standard = dynamoDBClient.putItem.mock.calls.at(-1)![1] as InvoiceEntity;
      invoiceStore.set(standard.entityKey, standard);
      dynamoDBClient.updateItem.mockResolvedValue({ ...standard, status: 'cancelled' });

      await service.update(SCHOOL_ID, first.id, { status: 'cancelled' } as any, ctx);

      // A standard cancel takes the bare updateItem branch — no transactWrite,
      // hence no lock Delete for a non-agreement invoice.
      expect(dynamoDBClient.updateItem).toHaveBeenCalled();
      expect(dynamoDBClient.transactWrite).not.toHaveBeenCalled();
    });

    it('the draft cancel path (cancelDraftInvoice) releases the lock via transactWrite Delete', async () => {
      // Generate a draft agreement invoice (autoIssue omitted → draft).
      const draft = await service.generate(SCHOOL_ID, makeDto({ autoIssue: false }), ctx);
      const lockKey = `AGREEMENT_TERM_LOCK#${SCHOOL_ID}#${STUDENT_ID}#agr-1`;
      expect(lockStore.has(lockKey)).toBe(true);

      const stored = [...invoiceStore.values()].find((inv) => inv.invoiceId === draft.id);
      expect(stored?.status).toBe('draft');

      // cancelDraftInvoice (used by bulkCancelDrafts) issues an Update+Delete
      // transact for agreement invoices — assert the lock released.
      await service['cancelDraftInvoice'](await dynamoDBClient.getClient(), stored, ctx);

      expect(stored!.status).toBe('cancelled');
      expect(lockStore.has(lockKey)).toBe(false);
    });
  });
});
