/**
 * `InvoicesService.bulkPreview` — FB-3.7 per-student `billingSource`.
 *
 * Classification of the settled-semantics partition, projected read-only
 * on today's date:
 *   'agreement' — EVERY requested feeType ∈ the student's active
 *                 agreement coveredFeeTypes
 *   'mixed'     — some requested feeTypes covered
 *   'standard'  — none covered / no active agreement
 *
 * Contract: the field is ADDITIVE and best-effort — flag-off or a
 * resolution failure omits it entirely (pre-FB preview response shape);
 * the pre-existing counters are never disturbed.
 */

import { Logger } from '@nestjs/common';
import { InvoicesService } from './invoices.service';

const TENANT_ID = 'tenant-uuid';
const SCHOOL_ID = 'school-uuid';
const STUDENT_A = 'student-a';
const STUDENT_B = 'student-b';
const STUDENT_C = 'student-c';

const ctx = {
  tenantId: TENANT_ID,
  userId: 'user-1',
  jwtToken: 'jwt',
  role: 'TenantAdmin',
  schoolId: SCHOOL_ID,
} as any;

function agreementCovering(feeTypes: string[]) {
  return {
    agreement: {
      agreementId: `agr-${feeTypes.join('-') || 'none'}`,
      title: 'Family Agreement',
      coveredFeeTypes: feeTypes,
      version: 1,
      terms: { agreementType: 'fixed_total', totalAmount: 1, allocation: [] },
    },
    allocationForStudent: 1000,
  };
}

describe('InvoicesService.bulkPreview — billingSource (FB-3.7)', () => {
  const ORIGINAL_FLAG = process.env.BILLING_AGREEMENTS_ENABLED;
  let service: InvoicesService;
  let agreementResolver: { getActiveAgreementForStudent: jest.Mock };
  let feeStructuresService: any;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    delete process.env.BILLING_AGREEMENTS_ENABLED;

    feeStructuresService = {
      getByIds: jest.fn().mockResolvedValue([
        { feeStructureId: 'fs-1', feeType: 'tuition', amount: 1000, taxRate: 0, gradeLevels: [], frequency: 'monthly', version: 1, name: 'Tuition' },
        { feeStructureId: 'fs-3', feeType: 'exam', amount: 300, taxRate: 0, gradeLevels: [], frequency: 'monthly', version: 1, name: 'Exam' },
      ]),
    };
    agreementResolver = {
      getActiveAgreementForStudent: jest.fn().mockResolvedValue(null),
    };

    service = new InvoicesService(
      {
        getClient: jest.fn().mockResolvedValue({}),
        getItem: jest.fn().mockResolvedValue(null),
        putItem: jest.fn().mockResolvedValue(undefined),
        queryGSI: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
      } as any,
      { publishInvoiceGenerated: jest.fn().mockResolvedValue(undefined) } as any,
      {
        getStudentInfo: jest.fn(),
        getSchoolName: jest.fn().mockResolvedValue('Test School'),
        getStudentIdsByGrade: jest.fn(),
      } as any,
      { getCurrency: jest.fn().mockResolvedValue('NPR') } as any,
      { nextInvoiceNumber: jest.fn() } as any,
      feeStructuresService,
      { getOrCreate: jest.fn(), list: jest.fn().mockResolvedValue({ items: [] }) } as any,
      { optimize: jest.fn(async (u: string) => u) } as any,
      agreementResolver as any,
    );

    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    if (ORIGINAL_FLAG === undefined) delete process.env.BILLING_AGREEMENTS_ENABLED;
    else process.env.BILLING_AGREEMENTS_ENABLED = ORIGINAL_FLAG;
  });

  const previewDto = {
    studentIds: [STUDENT_A, STUDENT_B, STUDENT_C],
    feeStructureIds: ['fs-1', 'fs-3'],
    billingPeriod: '2083-03',
  };

  it("classifies per student: all covered → 'agreement', some → 'mixed', none/no agreement → 'standard'", async () => {
    agreementResolver.getActiveAgreementForStudent.mockImplementation(
      async (studentId: string) => {
        if (studentId === STUDENT_A) return agreementCovering(['tuition', 'exam']);
        if (studentId === STUDENT_B) return agreementCovering(['tuition']);
        return null;
      },
    );

    const result = await service.bulkPreview(SCHOOL_ID, previewDto, ctx);

    // Classification is the contract here; #465 widened each row with what
    // the agreement replaces and for how much, asserted separately below.
    expect(result.students).toEqual([
      expect.objectContaining({ studentId: STUDENT_A, billingSource: 'agreement' }),
      expect.objectContaining({ studentId: STUDENT_B, billingSource: 'mixed' }),
      expect.objectContaining({ studentId: STUDENT_C, billingSource: 'standard' }),
    ]);
    // A student with no agreement carries no agreement fields at all — the
    // pre-FB row shape.
    expect(result.students?.[2]).toEqual({ studentId: STUDENT_C, billingSource: 'standard' });
    // Pre-existing counters untouched by the addition.
    expect(result.studentCount).toBe(3);
    expect(result.eligibleCount).toBe(3);
    expect(result.duplicateCount).toBe(0);
  });

  it('agreement covering none of the requested feeTypes → standard', async () => {
    agreementResolver.getActiveAgreementForStudent.mockResolvedValue(
      agreementCovering(['hostel']),
    );

    const result = await service.bulkPreview(SCHOOL_ID, previewDto, ctx);

    expect(result.students).toEqual([
      { studentId: STUDENT_A, billingSource: 'standard' },
      { studentId: STUDENT_B, billingSource: 'standard' },
      { studentId: STUDENT_C, billingSource: 'standard' },
    ]);
  });

  it('resolves on TODAY (bulk paths have no issuedDate input) and shares ONE memo across the preview', async () => {
    const today = new Date().toISOString().split('T')[0];

    await service.bulkPreview(SCHOOL_ID, previewDto, ctx);

    const calls = agreementResolver.getActiveAgreementForStudent.mock.calls;
    expect(calls).toHaveLength(3);
    const memo = calls[0][4];
    expect(memo).toBeInstanceOf(Map);
    for (const call of calls) {
      expect(call[1]).toBe(SCHOOL_ID);
      expect(call[2]).toBe(today);
      expect(call[4]).toBe(memo);
    }
  });

  it("flag off → 'students' key absent entirely; resolver never consulted", async () => {
    process.env.BILLING_AGREEMENTS_ENABLED = 'false';

    const result = await service.bulkPreview(SCHOOL_ID, previewDto, ctx);

    expect('students' in result).toBe(false);
    expect(agreementResolver.getActiveAgreementForStudent).not.toHaveBeenCalled();
  });

  it('resolution failure → field omitted, preview still succeeds (best-effort)', async () => {
    agreementResolver.getActiveAgreementForStudent.mockRejectedValue(
      new Error('resolver down'),
    );

    const result = await service.bulkPreview(SCHOOL_ID, previewDto, ctx);

    expect('students' in result).toBe(false);
    expect(result.studentCount).toBe(3);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/billingSource resolution failed/));
  });

  it('empty feeStructureIds → everyone standard (no requested feeTypes to cover)', async () => {
    agreementResolver.getActiveAgreementForStudent.mockResolvedValue(
      agreementCovering(['tuition']),
    );

    const result = await service.bulkPreview(
      SCHOOL_ID,
      { studentIds: [STUDENT_A], feeStructureIds: [], billingPeriod: undefined },
      ctx,
    );

    expect(result.students).toEqual([{ studentId: STUDENT_A, billingSource: 'standard' }]);
    expect(feeStructuresService.getByIds).not.toHaveBeenCalled();
  });
});
