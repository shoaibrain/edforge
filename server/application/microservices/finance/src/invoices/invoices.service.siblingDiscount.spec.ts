/**
 * `InvoicesService` — EPIC-FB FB-5.2 sibling discount evaluator (live
 * finding L5: the `sibling` rule condition existed with no evaluator).
 *
 * Pins:
 *   - rule matrix: percentage/fixed math, per-line maxDiscountAmount cap,
 *     clamp-to-line-subtotal, minSiblings gate, applicableFeeTypes gate
 *   - precedence: agreement > rule (agreement lines exempt; suppressed
 *     covered feeTypes never re-discounted) and rule > manual (rule
 *     REPLACES the operator discount — authority order, NOT max())
 *   - determinism: highest priority wins, ties → lowest ruleId
 *   - tax math: discount participates in per-line after-discount tax
 *   - graceful degrade: count-resolver hard failure / rule-fetch failure →
 *     WARN + untouched lines + generation succeeds
 *   - zero rules → zero mutations and zero family lookups
 *   - the worker path (`generateForBulkWorker`) applies identically
 *   - the per-run memo: one rule fetch per run
 */

import { Logger } from '@nestjs/common';
import { InvoicesService, createSiblingDiscountMemo } from './invoices.service';
import type { InvoiceEntity } from '../common/entities/invoice.entity';

const TENANT_ID = 'tenant-uuid';
const SCHOOL_ID = 'school-uuid';
const STUDENT_ID = 'student-uuid';

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
  taxRate: 13,
  taxType: 'vat',
  version: 3,
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
const ALL_FS: Record<string, any> = { 'fs-1': FS_TUITION, 'fs-2': FS_TRANSPORT };

function siblingRule(overrides: Record<string, any> = {}) {
  return {
    discountRuleId: 'rule-1',
    schoolId: SCHOOL_ID,
    academicYearId: 'ay-uuid',
    name: 'Sibling 10%',
    type: 'percentage',
    value: 10,
    applicableFeeTypes: ['tuition'],
    condition: { type: 'sibling', minSiblings: 2 },
    priority: 0,
    isActive: true,
    ...overrides,
  };
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

describe('InvoicesService — sibling discount evaluator (FB-5.2)', () => {
  let service: InvoicesService;
  let dynamoDBClient: any;
  let agreementResolver: { getActiveAgreementForStudent: jest.Mock };
  let siblingCountResolver: { getActiveSiblingCount: jest.Mock };
  let siblingRules: any[];
  let savedAgreementsFlag: string | undefined;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    siblingRules = [];
    dynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({}),
      getItem: jest.fn().mockResolvedValue(null),
      putItem: jest.fn().mockResolvedValue(undefined),
      queryGSI: jest.fn().mockImplementation(async (...args: unknown[]) =>
        args[3] === 'DISCOUNT_RULE'
          ? { items: siblingRules, hasMore: false }
          : { items: [], hasMore: false },
      ),
    };
    agreementResolver = {
      getActiveAgreementForStudent: jest.fn().mockResolvedValue(null),
    };
    siblingCountResolver = {
      getActiveSiblingCount: jest.fn().mockResolvedValue(2),
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
      {
        getByIds: jest.fn(async (_school: string, ids: string[]) =>
          ids.map((id) => ALL_FS[id]).filter(Boolean),
        ),
      } as any,
      {
        getOrCreate: jest.fn().mockResolvedValue({
          accountId: 'account-uuid',
          studentId: STUDENT_ID,
        }),
        recordLedgerEntry: jest.fn().mockResolvedValue(undefined),
      } as any,
      { optimize: jest.fn(async (u: string) => u) } as any,
      agreementResolver as any,
      siblingCountResolver as any,
    );

    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    savedAgreementsFlag = process.env.BILLING_AGREEMENTS_ENABLED;
  });

  afterEach(() => {
    warnSpy.mockRestore();
    if (savedAgreementsFlag === undefined) {
      delete process.env.BILLING_AGREEMENTS_ENABLED;
    } else {
      process.env.BILLING_AGREEMENTS_ENABLED = savedAgreementsFlag;
    }
  });

  function putEntity(): InvoiceEntity {
    const calls = dynamoDBClient.putItem.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls[calls.length - 1][1] as InvoiceEntity;
  }

  function lineByFs(entity: InvoiceEntity, feeStructureId: string) {
    const line = entity.lineItems.find((li) => li.feeStructureId === feeStructureId);
    expect(line).toBeDefined();
    return line!;
  }

  // ────────────────────────────────────────────────────────────────────
  // Rule matrix
  // ────────────────────────────────────────────────────────────────────

  it('percentage rule on an applicable line: discount, reason sibling_discount:{ruleName}, discountRuleId, tax recomputed AFTER discount', async () => {
    siblingRules = [siblingRule()];

    await service.generate(SCHOOL_ID, makeDto(), ctx);

    const entity = putEntity();
    const tuition = lineByFs(entity, 'fs-1');
    // 1000 × 10% = 100 off; tax = round(900 × 13)/100 = 117 (discount-before-tax).
    expect(tuition.discount).toBe(100);
    expect(tuition.discountReason).toBe('sibling_discount:Sibling 10%');
    expect(tuition.discountRuleId).toBe('rule-1');
    expect(tuition.taxAmount).toBe(117);
    expect(tuition.total).toBe(1017);

    // Non-applicable feeType untouched.
    const transport = lineByFs(entity, 'fs-2');
    expect(transport.discount).toBe(0);
    expect(transport.discountRuleId).toBeUndefined();

    // Invoice totals reflect the rule discount.
    expect(entity.discountTotal).toBe(100);
    expect(entity.taxTotal).toBe(117);
    expect(entity.grandTotal).toBe(1017 + 500);
  });

  it('fixed rule applies its value PER LINE across every applicable feeType', async () => {
    siblingRules = [
      siblingRule({ type: 'fixed', value: 150, applicableFeeTypes: ['tuition', 'transport'] }),
    ];

    await service.generate(SCHOOL_ID, makeDto(), ctx);

    const entity = putEntity();
    expect(lineByFs(entity, 'fs-1').discount).toBe(150);
    expect(lineByFs(entity, 'fs-2').discount).toBe(150);
    expect(entity.discountTotal).toBe(300);
  });

  it('maxDiscountAmount caps PER LINE (each line capped independently, not a shared invoice budget)', async () => {
    siblingRules = [
      siblingRule({
        value: 50,
        applicableFeeTypes: ['tuition', 'transport'],
        maxDiscountAmount: 200,
      }),
    ];

    await service.generate(SCHOOL_ID, makeDto(), ctx);

    const entity = putEntity();
    // 50% of 1000 = 500 → capped 200; 50% of 500 = 250 → capped 200.
    expect(lineByFs(entity, 'fs-1').discount).toBe(200);
    expect(lineByFs(entity, 'fs-2').discount).toBe(200);
  });

  it('fixed rule larger than the line clamps to the line subtotal — total floors at 0, never negative', async () => {
    siblingRules = [siblingRule({ type: 'fixed', value: 800, applicableFeeTypes: ['transport'] })];

    await service.generate(SCHOOL_ID, makeDto(), ctx);

    const transport = lineByFs(putEntity(), 'fs-2');
    expect(transport.discount).toBe(500);
    expect(transport.total).toBe(0);
  });

  it('count below minSiblings → no rule applies (lines byte-identical to the no-rule shape)', async () => {
    siblingRules = [siblingRule({ condition: { type: 'sibling', minSiblings: 3 } })];
    siblingCountResolver.getActiveSiblingCount.mockResolvedValue(2);

    await service.generate(SCHOOL_ID, makeDto(), ctx);

    const tuition = lineByFs(putEntity(), 'fs-1');
    expect(tuition.discount).toBe(0);
    expect(tuition.discountRuleId).toBeUndefined();
    expect(tuition.discountReason).toBeUndefined();
  });

  // ────────────────────────────────────────────────────────────────────
  // Precedence
  // ────────────────────────────────────────────────────────────────────

  it('rule REPLACES a larger operator manual discount — precedence is authority order, not max()', async () => {
    siblingRules = [siblingRule()];

    await service.generate(
      SCHOOL_ID,
      makeDto({ discounts: [{ feeStructureId: 'fs-1', amount: 300, reason: 'Principal waiver' }] }),
      ctx,
    );

    const tuition = lineByFs(putEntity(), 'fs-1');
    // Rule 10% (100) WINS over the larger manual 300.
    expect(tuition.discount).toBe(100);
    expect(tuition.discountReason).toBe('sibling_discount:Sibling 10%');
    expect(tuition.discountRuleId).toBe('rule-1');
  });

  it('a manual discount on a NON-matching line survives untouched', async () => {
    siblingRules = [siblingRule()]; // tuition only

    await service.generate(
      SCHOOL_ID,
      makeDto({ discounts: [{ feeStructureId: 'fs-2', amount: 50, reason: 'Bus pass' }] }),
      ctx,
    );

    const transport = lineByFs(putEntity(), 'fs-2');
    expect(transport.discount).toBe(50);
    expect(transport.discountReason).toBe('Bus pass');
    expect(transport.discountRuleId).toBeUndefined();
  });

  it('agreement precedence: covered feeType is suppressed BEFORE rules run; agreement line stays undiscounted; uncovered line still gets the rule', async () => {
    siblingRules = [siblingRule({ applicableFeeTypes: ['tuition', 'transport'] })];
    agreementResolver.getActiveAgreementForStudent.mockResolvedValue({
      agreement: {
        agreementId: 'agr-1',
        schoolId: SCHOOL_ID,
        title: 'Sharma Family 2083',
        studentIds: [STUDENT_ID],
        agreementType: 'fixed_total',
        coveredFeeTypes: ['tuition'],
        terms: {
          agreementType: 'fixed_total',
          totalAmount: 12000,
          allocation: [{ studentId: STUDENT_ID, amount: 12000 }],
        },
        status: 'active',
        effectiveFrom: '2026-04-14',
        effectiveTo: '2027-04-13',
        isActive: true,
        version: 2,
      },
      allocationForStudent: 12000,
    });

    await service.generate(SCHOOL_ID, makeDto(), ctx);

    const entity = putEntity();
    // No standard tuition line exists (suppressed).
    expect(entity.lineItems.some((li) => li.feeStructureId === 'fs-1')).toBe(false);
    // Agreement replacement line: never touched by the rule.
    const agreementLine = entity.lineItems.find((li) => li.agreementId === 'agr-1')!;
    expect(agreementLine.discount).toBe(0);
    expect(agreementLine.discountRuleId).toBeUndefined();
    // Uncovered transport still receives the rule discount (10% of 500).
    const transport = lineByFs(entity, 'fs-2');
    expect(transport.discount).toBe(50);
    expect(transport.discountRuleId).toBe('rule-1');
  });

  it("custom lines never match — even a rule targeting feeType 'custom'", async () => {
    siblingRules = [siblingRule({ applicableFeeTypes: ['custom'] })];

    await service.generate(
      SCHOOL_ID,
      makeDto({ customLineItems: [{ name: 'Annual picnic', amount: 250 }] }),
      ctx,
    );

    const entity = putEntity();
    const custom = entity.lineItems.find((li) => li.isCustom)!;
    expect(custom.discount).toBe(0);
    expect(custom.discountRuleId).toBeUndefined();
  });

  // ────────────────────────────────────────────────────────────────────
  // Determinism across multiple matching rules
  // ────────────────────────────────────────────────────────────────────

  it('two matching rules: HIGHEST priority value wins', async () => {
    siblingRules = [
      siblingRule({ discountRuleId: 'rule-low', name: 'Low', value: 5, priority: 1 }),
      siblingRule({ discountRuleId: 'rule-high', name: 'High', value: 20, priority: 9 }),
    ];

    await service.generate(SCHOOL_ID, makeDto(), ctx);

    const tuition = lineByFs(putEntity(), 'fs-1');
    expect(tuition.discountRuleId).toBe('rule-high');
    expect(tuition.discount).toBe(200);
  });

  it('priority tie → lowest ruleId wins (pinned determinism)', async () => {
    siblingRules = [
      siblingRule({ discountRuleId: 'rule-bbb', name: 'B', value: 20, priority: 5 }),
      siblingRule({ discountRuleId: 'rule-aaa', name: 'A', value: 5, priority: 5 }),
    ];

    await service.generate(SCHOOL_ID, makeDto(), ctx);

    const tuition = lineByFs(putEntity(), 'fs-1');
    expect(tuition.discountRuleId).toBe('rule-aaa');
    expect(tuition.discount).toBe(50);
  });

  // ────────────────────────────────────────────────────────────────────
  // Zero-rules + degrade paths
  // ────────────────────────────────────────────────────────────────────

  it('zero sibling rules → zero family lookups and untouched lines (golden contract)', async () => {
    siblingRules = [];

    await service.generate(
      SCHOOL_ID,
      makeDto({ discounts: [{ feeStructureId: 'fs-1', amount: 100, reason: 'Sibling discount' }] }),
      ctx,
    );

    expect(siblingCountResolver.getActiveSiblingCount).not.toHaveBeenCalled();
    const tuition = lineByFs(putEntity(), 'fs-1');
    expect(tuition.discount).toBe(100);
    expect(tuition.discountReason).toBe('Sibling discount');
    expect(tuition.discountRuleId).toBeUndefined();
  });

  it('non-sibling active rules are ignored by the evaluator', async () => {
    siblingRules = []; // sibling filter runs inside the fetch; simulate at query level:
    dynamoDBClient.queryGSI.mockImplementation(async (...args: unknown[]) =>
      args[3] === 'DISCOUNT_RULE'
        ? {
            items: [
              siblingRule({ condition: { type: 'early_payment', daysBefore: 10 } }),
              siblingRule({ condition: { type: 'staff_child' }, discountRuleId: 'rule-2' }),
            ],
            hasMore: false,
          }
        : { items: [], hasMore: false },
    );

    await service.generate(SCHOOL_ID, makeDto(), ctx);

    expect(siblingCountResolver.getActiveSiblingCount).not.toHaveBeenCalled();
    expect(lineByFs(putEntity(), 'fs-1').discount).toBe(0);
  });

  it('count resolver HARD-THROWS → WARN, no discount, generation succeeds (family outage never 5xxes)', async () => {
    siblingRules = [siblingRule()];
    siblingCountResolver.getActiveSiblingCount.mockRejectedValue(new Error('academics exploded'));

    const dto = await service.generate(SCHOOL_ID, makeDto(), ctx);

    expect(dto.invoiceNumber).toBe('INV-2026-0001');
    const tuition = lineByFs(putEntity(), 'fs-1');
    expect(tuition.discount).toBe(0);
    expect(tuition.discountRuleId).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('academics exploded'));
  });

  it('rule-list fetch failure → WARN, no discount, generation succeeds', async () => {
    dynamoDBClient.queryGSI.mockImplementation(async (...args: unknown[]) => {
      if (args[3] === 'DISCOUNT_RULE') throw new Error('DDB throttled');
      return { items: [], hasMore: false };
    });

    const dto = await service.generate(SCHOOL_ID, makeDto(), ctx);

    expect(dto.invoiceNumber).toBe('INV-2026-0001');
    expect(lineByFs(putEntity(), 'fs-1').discount).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('DDB throttled'));
  });

  it('count of 0 (no family / flag off in academics) → no discount', async () => {
    siblingRules = [siblingRule()];
    siblingCountResolver.getActiveSiblingCount.mockResolvedValue(0);

    await service.generate(SCHOOL_ID, makeDto(), ctx);

    expect(lineByFs(putEntity(), 'fs-1').discount).toBe(0);
  });

  // ────────────────────────────────────────────────────────────────────
  // Memo + worker path
  // ────────────────────────────────────────────────────────────────────

  it('one memo across a run → rule list fetched ONCE (per-job economy)', async () => {
    siblingRules = [siblingRule()];
    const memo = createSiblingDiscountMemo();

    await service.generate(SCHOOL_ID, makeDto(), ctx, undefined, memo);
    await service.generate(SCHOOL_ID, makeDto({ studentId: 'student-2-uuid' }), ctx, undefined, memo);

    const ruleFetches = dynamoDBClient.queryGSI.mock.calls.filter(
      (c: unknown[]) => c[3] === 'DISCOUNT_RULE',
    );
    expect(ruleFetches).toHaveLength(1);
  });

  it('generateForBulkWorker applies the same evaluator (worker/bulk path parity)', async () => {
    siblingRules = [siblingRule()];

    await service.generateForBulkWorker(
      SCHOOL_ID,
      makeDto({
        preAllocatedInvoiceNumber: 'INV-2026-0042',
        cachedSchoolName: 'Test School',
        cachedCurrency: 'NPR',
      }),
      ctx,
      undefined,
      createSiblingDiscountMemo(),
    );

    const entity = putEntity();
    const tuition = lineByFs(entity, 'fs-1');
    expect(tuition.discount).toBe(100);
    expect(tuition.discountReason).toBe('sibling_discount:Sibling 10%');
    expect(tuition.discountRuleId).toBe('rule-1');
    expect(entity.status).toBe('draft');
  });
});
