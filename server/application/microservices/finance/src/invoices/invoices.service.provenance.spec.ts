/**
 * `InvoicesService.getProvenance` — EPIC-FB FB-5.4 invoice "why" trace.
 *
 * Pins:
 *   - all four line origins compose correctly: fee_structure (with
 *     version + resolved name), agreement (version/title + suppressed
 *     fee structures), custom, and a sibling-rule-discounted line whose
 *     discount block carries discountRuleId + resolved ruleName
 *   - missing-referent degradation: unresolvable fee structures /
 *     agreements / rules degrade to id-only with WARN, never 5xx
 *   - the response NEVER carries `overrides` (AGREEMENT_BYPASSED audit is
 *     CloudWatch-only — see the service JSDoc limitation write-up)
 *   - 404 on a missing invoice
 */

import { Logger, NotFoundException } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import type { InvoiceEntity, InvoiceLineItemData } from '../common/entities/invoice.entity';

const TENANT_ID = 'tenant-uuid';
const SCHOOL_ID = 'school-uuid';
const INVOICE_ID = 'invoice-uuid';

const ctx = {
  tenantId: TENANT_ID,
  userId: 'user-1',
  jwtToken: 'jwt',
  role: 'TenantAdmin',
  schoolId: SCHOOL_ID,
} as any;

const LINE_STANDARD: InvoiceLineItemData = {
  id: 'line-1',
  feeStructureId: 'fs-2',
  feeStructureVersion: 1,
  feeType: 'transport',
  description: 'Transport Fee',
  amount: 500,
  quantity: 1,
  discount: 0,
  discountReason: undefined,
  taxRate: 0,
  taxType: undefined,
  taxAmount: 0,
  total: 500,
};

const LINE_DISCOUNTED: InvoiceLineItemData = {
  id: 'line-2',
  feeStructureId: 'fs-3',
  feeStructureVersion: 2,
  feeType: 'exam',
  description: 'Exam Fee',
  amount: 300,
  quantity: 1,
  discount: 30,
  discountReason: 'sibling_discount:Sibling 10%',
  discountRuleId: 'rule-1',
  taxRate: 0,
  taxType: undefined,
  taxAmount: 0,
  total: 270,
};

const LINE_AGREEMENT: InvoiceLineItemData = {
  id: 'line-3',
  feeStructureId: 'synthetic-uuid',
  description: 'Sharma Family 2083 (family agreement)',
  amount: 12000,
  quantity: 1,
  discount: 0,
  discountReason: undefined,
  taxRate: 0,
  taxType: undefined,
  taxAmount: 0,
  total: 12000,
  agreementId: 'agr-1',
  agreementVersion: 2,
  suppressedFeeStructureIds: ['fs-1', 'fs-gone'],
};

const LINE_CUSTOM: InvoiceLineItemData = {
  id: 'line-4',
  feeStructureId: 'custom-synthetic-uuid',
  feeStructureVersion: 1,
  feeType: 'custom',
  description: 'Annual picnic',
  amount: 250,
  quantity: 1,
  discount: 0,
  discountReason: undefined,
  taxRate: 0,
  taxType: undefined,
  taxAmount: 0,
  total: 250,
  isCustom: true,
};

function makeInvoice(overrides: Partial<InvoiceEntity> = {}): InvoiceEntity {
  return {
    tenantId: TENANT_ID,
    entityKey: `INVOICE#${SCHOOL_ID}#${INVOICE_ID}`,
    entityType: 'INVOICE',
    invoiceId: INVOICE_ID,
    invoiceNumber: 'INV-2026-0042',
    studentAccountId: 'account-uuid',
    studentId: 'student-uuid',
    studentName: 'Aakriti Sharma',
    schoolId: SCHOOL_ID,
    schoolName: 'Test School',
    academicYear: '2082-83',
    lineItems: [LINE_STANDARD, LINE_DISCOUNTED, LINE_AGREEMENT, LINE_CUSTOM],
    subtotal: 13050,
    taxTotal: 0,
    discountTotal: 30,
    grandTotal: 13020,
    amountPaid: 0,
    amountDue: 13020,
    currency: 'NPR',
    dueDate: '2026-08-15',
    issuedDate: '2026-07-10',
    status: 'issued',
    feeOverrideMode: 'agreement',
    agreementId: 'agr-1',
    agreementVersion: 2,
    gsi1pk: '',
    gsi1sk: '',
    gsi2pk: '',
    gsi2sk: '',
    gsi3pk: '',
    gsi3sk: '',
    createdAt: '2026-07-10T00:00:00.000Z',
    createdBy: 'user-1',
    updatedAt: '2026-07-10T00:00:00.000Z',
    updatedBy: 'user-1',
    version: 1,
    ...overrides,
  } as InvoiceEntity;
}

describe('InvoicesService.getProvenance (FB-5.4)', () => {
  let service: InvoicesService;
  let dynamoDBClient: any;
  let feeStructuresService: any;
  let referents: {
    invoice: InvoiceEntity | null;
    agreements: Record<string, { title?: string } | null>;
    rules: Record<string, { name?: string } | null>;
    feeStructures: any[];
  };
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    referents = {
      invoice: makeInvoice(),
      agreements: { 'agr-1': { title: 'Sharma Family 2083' } },
      rules: { 'rule-1': { name: 'Sibling 10%' } },
      feeStructures: [
        { feeStructureId: 'fs-1', name: 'Monthly Tuition', feeType: 'tuition', version: 3 },
        { feeStructureId: 'fs-2', name: 'Transport Fee', feeType: 'transport', version: 1 },
        { feeStructureId: 'fs-3', name: 'Exam Fee', feeType: 'exam', version: 2 },
        // 'fs-gone' deliberately unresolvable.
      ],
    };

    dynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({}),
      putItem: jest.fn(),
      queryGSI: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
      getItem: jest.fn().mockImplementation(
        async (_client: unknown, _tenant: string, entityKey: string) => {
          if (entityKey === `INVOICE#${SCHOOL_ID}#${INVOICE_ID}`) return referents.invoice;
          const agr = entityKey.match(/^AGREEMENT#([^#]+)#(.+)$/);
          if (agr) return referents.agreements[agr[2]] ?? null;
          const rule = entityKey.match(/^DISCOUNT_RULE#([^#]+)#(.+)$/);
          if (rule) return referents.rules[rule[2]] ?? null;
          return null;
        },
      ),
    };
    feeStructuresService = {
      getByIds: jest.fn(async (_school: string, ids: string[]) =>
        referents.feeStructures.filter((fs) => ids.includes(fs.feeStructureId)),
      ),
    };

    service = new InvoicesService(
      dynamoDBClient,
      { publishInvoiceGenerated: jest.fn() } as any,
      { getSchoolName: jest.fn().mockResolvedValue('Test School') } as any,
      { getCurrency: jest.fn() } as any,
      { nextInvoiceNumber: jest.fn() } as any,
      feeStructuresService,
      {} as any,
      { optimize: jest.fn() } as any,
    );

    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => warnSpy.mockRestore());

  it('composes all four line origins with resolved referent names', async () => {
    const trace = await service.getProvenance(SCHOOL_ID, INVOICE_ID, ctx);

    expect(trace.invoiceId).toBe(INVOICE_ID);
    expect(trace.invoiceNumber).toBe('INV-2026-0042');
    expect(trace.feeOverrideMode).toBe('agreement');
    expect(trace.agreementId).toBe('agr-1');
    expect(trace.agreementVersion).toBe(2);

    expect(trace.lines).toEqual([
      {
        lineId: 'line-1',
        description: 'Transport Fee',
        source: 'fee_structure',
        feeStructureId: 'fs-2',
        feeStructureVersion: 1,
        feeStructureName: 'Transport Fee',
      },
      {
        lineId: 'line-2',
        description: 'Exam Fee',
        source: 'fee_structure',
        feeStructureId: 'fs-3',
        feeStructureVersion: 2,
        feeStructureName: 'Exam Fee',
        discount: {
          amount: 30,
          reason: 'sibling_discount:Sibling 10%',
          discountRuleId: 'rule-1',
          ruleName: 'Sibling 10%',
        },
      },
      {
        lineId: 'line-3',
        description: 'Sharma Family 2083 (family agreement)',
        source: 'agreement',
        agreementId: 'agr-1',
        agreementVersion: 2,
        agreementTitle: 'Sharma Family 2083',
        suppressedFeeStructures: [
          { id: 'fs-1', name: 'Monthly Tuition', feeType: 'tuition' },
          // fs-gone: deleted referent → id-only degrade.
          { id: 'fs-gone' },
        ],
      },
      {
        lineId: 'line-4',
        description: 'Annual picnic',
        source: 'custom',
      },
    ]);
  });

  it('never carries an overrides[] array — AGREEMENT_BYPASSED audit is CloudWatch-only (documented limitation)', async () => {
    const trace = await service.getProvenance(SCHOOL_ID, INVOICE_ID, ctx);
    expect(trace).not.toHaveProperty('overrides');
  });

  it('all referents missing → id-only degradation on every line, WARNs, no 5xx', async () => {
    referents.agreements = {};
    referents.rules = {};
    referents.feeStructures = [];

    const trace = await service.getProvenance(SCHOOL_ID, INVOICE_ID, ctx);

    const std = trace.lines.find((l) => l.lineId === 'line-1')!;
    expect(std.feeStructureId).toBe('fs-2');
    expect(std.feeStructureName).toBeUndefined();

    const discounted = trace.lines.find((l) => l.lineId === 'line-2')!;
    expect(discounted.discount).toEqual({
      amount: 30,
      reason: 'sibling_discount:Sibling 10%',
      discountRuleId: 'rule-1',
      // ruleName absent — rule row gone.
    });
    expect(discounted.discount!.ruleName).toBeUndefined();

    const agreementLine = trace.lines.find((l) => l.lineId === 'line-3')!;
    expect(agreementLine.agreementId).toBe('agr-1');
    expect(agreementLine.agreementTitle).toBeUndefined();
    expect(agreementLine.suppressedFeeStructures).toEqual([{ id: 'fs-1' }, { id: 'fs-gone' }]);

    expect(warnSpy).toHaveBeenCalled();
  });

  it('fee-structure resolution THROWING degrades to id-only (WARN), never 5xx', async () => {
    feeStructuresService.getByIds.mockRejectedValue(new Error('batch get exploded'));

    const trace = await service.getProvenance(SCHOOL_ID, INVOICE_ID, ctx);

    expect(trace.lines.find((l) => l.lineId === 'line-1')!.feeStructureName).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('batch get exploded'));
  });

  it('standard catalog invoice (no agreement, no discounts) → plain fee_structure lines, no header agreement fields', async () => {
    referents.invoice = makeInvoice({
      lineItems: [LINE_STANDARD],
      feeOverrideMode: undefined,
      agreementId: undefined,
      agreementVersion: undefined,
    });

    const trace = await service.getProvenance(SCHOOL_ID, INVOICE_ID, ctx);

    expect(trace).not.toHaveProperty('feeOverrideMode');
    expect(trace).not.toHaveProperty('agreementId');
    expect(trace.lines).toHaveLength(1);
    expect(trace.lines[0].source).toBe('fee_structure');
    expect(trace.lines[0].discount).toBeUndefined();
  });

  it('404 when the invoice does not exist', async () => {
    referents.invoice = null;
    await expect(service.getProvenance(SCHOOL_ID, 'missing-id', ctx)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('manual (non-rule) discount surfaces amount + reason without discountRuleId/ruleName', async () => {
    referents.invoice = makeInvoice({
      lineItems: [
        {
          ...LINE_STANDARD,
          discount: 50,
          discountReason: 'Principal waiver',
          total: 450,
        },
      ],
      feeOverrideMode: undefined,
      agreementId: undefined,
      agreementVersion: undefined,
    });

    const trace = await service.getProvenance(SCHOOL_ID, INVOICE_ID, ctx);

    expect(trace.lines[0].discount).toEqual({ amount: 50, reason: 'Principal waiver' });
  });
});
