/**
 * EPIC-FB FB-3.9 — flag-off rollback semantics (risk R6).
 *
 * With BILLING_AGREEMENTS_ENABLED='false':
 *   (i)   generate() never consults the resolver (spy) and produces the
 *         standard entity (byte-level identity is pinned separately by
 *         invoices.service.golden.spec.ts, which also runs a flag-off
 *         variant — FB-3.9 iii);
 *   (ii)  invoices ALREADY carrying agreement provenance (issued while
 *         the flag was on) remain valid + READABLE: the mapper and the
 *         GET path surface them unchanged. Payment-side needs nothing —
 *         payments operate on amountDue, not on line provenance.
 *
 * Env is saved/restored around every test.
 */

import { InvoicesService } from './invoices.service';
import { invoiceEntityToDto } from '../common/mappers/invoice.mapper';
import type { InvoiceEntity } from '../common/entities/invoice.entity';

const TENANT_ID = 'tenant-uuid';
const SCHOOL_ID = 'school-uuid';
const STUDENT_ID = 'student-uuid';

const ctx = {
  tenantId: TENANT_ID,
  userId: 'user-1',
  jwtToken: 'jwt',
  role: 'TenantAdmin',
  schoolId: SCHOOL_ID,
} as any;

/** An invoice persisted while the flag was ON — full agreement provenance. */
function agreementPricedEntity(): InvoiceEntity {
  return {
    tenantId: TENANT_ID,
    entityKey: `INVOICE#${SCHOOL_ID}#inv-agr`,
    entityType: 'INVOICE',
    invoiceId: 'inv-agr',
    invoiceNumber: 'INV-2026-0042',
    studentAccountId: 'account-uuid',
    studentId: STUDENT_ID,
    studentName: 'Aakriti Sharma',
    schoolId: SCHOOL_ID,
    schoolName: 'Test School',
    academicYear: '2082-83',
    billingPeriod: '2083-03',
    lineItems: [
      {
        id: 'li-1',
        feeStructureId: 'fs-2',
        feeStructureVersion: 1,
        feeType: 'transport',
        description: 'Transport Fee',
        amount: 500,
        quantity: 1,
        discount: 0,
        taxRate: 0,
        taxAmount: 0,
        total: 500,
      },
      {
        id: 'li-2',
        feeStructureId: 'synthetic-uuid',
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
      },
    ],
    subtotal: 12500,
    taxTotal: 0,
    discountTotal: 0,
    grandTotal: 12500,
    amountPaid: 0,
    amountDue: 12500,
    currency: 'NPR',
    dueDate: '2099-08-15',
    issuedDate: '2026-07-10',
    status: 'issued',
    feeOverrideMode: 'agreement',
    agreementId: 'agr-1',
    agreementVersion: 2,
    statusHistory: [],
    gsi1pk: '', gsi1sk: '', gsi2pk: '', gsi2sk: '', gsi3pk: '', gsi3sk: '',
    createdAt: '2026-07-10T00:00:00.000Z',
    createdBy: 'user-1',
    updatedAt: '2026-07-10T00:00:00.000Z',
    updatedBy: 'user-1',
    version: 1,
  };
}

describe('EPIC-FB FB-3.9 — flag-off suite', () => {
  const ORIGINAL_FLAG = process.env.BILLING_AGREEMENTS_ENABLED;
  let service: InvoicesService;
  let dynamoDBClient: any;
  let agreementResolver: { getActiveAgreementForStudent: jest.Mock };

  beforeEach(() => {
    process.env.BILLING_AGREEMENTS_ENABLED = 'false';

    dynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({}),
      getItem: jest.fn().mockResolvedValue(null),
      putItem: jest.fn().mockResolvedValue(undefined),
      queryGSI: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    };
    agreementResolver = {
      getActiveAgreementForStudent: jest.fn().mockResolvedValue({
        agreement: { agreementId: 'agr-1', coveredFeeTypes: ['tuition'] },
        allocationForStudent: 12000,
      }),
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
        getByIds: jest.fn().mockResolvedValue([
          {
            feeStructureId: 'fs-1',
            name: 'Monthly Tuition',
            amount: 1000,
            feeType: 'tuition',
            frequency: 'monthly',
            gradeLevels: [],
            taxRate: 0,
            version: 1,
          },
        ]),
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
    );
  });

  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env.BILLING_AGREEMENTS_ENABLED;
    else process.env.BILLING_AGREEMENTS_ENABLED = ORIGINAL_FLAG;
  });

  it('(i) generate() never consults the resolver; output is standard even though an agreement would cover the fee', async () => {
    await service.generate(
      SCHOOL_ID,
      {
        studentId: STUDENT_ID,
        feeStructureIds: ['fs-1'],
        academicYear: '2082-83',
        billingPeriod: '2083-03',
        dueDate: '2026-08-15',
      } as any,
      ctx,
    );

    expect(agreementResolver.getActiveAgreementForStudent).not.toHaveBeenCalled();

    const entity = dynamoDBClient.putItem.mock.calls[0][1] as InvoiceEntity;
    expect(entity.lineItems).toHaveLength(1);
    expect(entity.lineItems[0].feeStructureId).toBe('fs-1');
    expect(entity.feeOverrideMode).toBeUndefined();
    expect(entity.agreementId).toBeUndefined();
    expect(entity.agreementVersion).toBeUndefined();
    expect(entity.grandTotal).toBe(1000);
  });

  it('(ii) mapper — an already-issued agreement-priced entity maps with its provenance intact under flag-off', () => {
    const dto = invoiceEntityToDto(agreementPricedEntity());

    expect(dto.feeOverrideMode).toBe('agreement');
    expect(dto.agreementId).toBe('agr-1');
    expect(dto.agreementVersion).toBe(2);
    expect(dto.grandTotal).toBe(12500);
    expect(dto.amountDue).toBe(12500);
    expect(dto.status).toBe('issued');

    const agreementLine = dto.lineItems[1];
    expect(agreementLine.agreementId).toBe('agr-1');
    expect(agreementLine.agreementVersion).toBe(2);
    expect(agreementLine.suppressedFeeStructureIds).toEqual(['fs-1']);
    expect(agreementLine.description).toBe('Shrestha Family 2083 (family agreement)');
  });

  it('(ii) GET path — service.get() returns the agreement-priced invoice readable + payable (amountDue intact) under flag-off', async () => {
    dynamoDBClient.getItem.mockResolvedValue(agreementPricedEntity());

    const dto = await service.get(SCHOOL_ID, 'inv-agr', ctx);

    expect(dto.id).toBe('inv-agr');
    expect(dto.feeOverrideMode).toBe('agreement');
    expect(dto.agreementId).toBe('agr-1');
    expect(dto.lineItems).toHaveLength(2);
    // Payable: the payment path keys on amountDue/status, both intact.
    expect(dto.amountDue).toBe(12500);
    expect(dto.status).toBe('issued');
  });
});
