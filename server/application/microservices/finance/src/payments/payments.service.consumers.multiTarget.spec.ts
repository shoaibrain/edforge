/**
 * FB-4.5 consumer sweep — every reader of payment.invoiceId /
 * studentAccountId / studentId tolerates the multi-target null shape.
 *
 * Covers: getReceipt JSON (per-invoice breakdown), listBySchool
 * enrichment, listByInvoice contains() matching, CSV export row,
 * gateway-path guards (completePayment / resolveSessionContext), and
 * RefundsService.create's invoice-based student resolution.
 */

import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { RefundsService } from '../refunds/refunds.service';
import type { PaymentEntity } from '../common/entities/payment.entity';
import type { InvoiceEntity } from '../common/entities/invoice.entity';

const TENANT_ID = 'tenant-uuid';
const SCHOOL_ID = '44444444-4444-4444-8444-444444444444';
const INVOICE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INVOICE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PAYMENT_ID = 'multi-pay-uuid';

const ctx = { tenantId: TENANT_ID, userId: 'user-1', jwtToken: 'jwt', role: 'TenantAdmin', schoolId: SCHOOL_ID } as any;

function multiPaymentEntity(overrides: Partial<PaymentEntity> = {}): PaymentEntity {
  return {
    tenantId: TENANT_ID,
    entityKey: `PAYMENT#${SCHOOL_ID}#${PAYMENT_ID}`,
    entityType: 'PAYMENT',
    paymentId: PAYMENT_ID,
    invoiceId: null,
    studentAccountId: null,
    studentId: null,
    familyId: '55555555-dddd-4ddd-8ddd-555555555555',
    schoolId: SCHOOL_ID,
    amount: 2500,
    currency: 'NPR',
    gateway: 'cash',
    status: 'completed',
    paidAt: '2026-07-15T00:00:00Z',
    paidBy: 'operator-name',
    receiptNumber: 'RCP-2026-0900',
    metadata: {},
    refunds: [],
    applications: [
      { targetType: 'invoice', invoiceId: INVOICE_A, amount: 1000 },
      { targetType: 'invoice', invoiceId: INVOICE_B, amount: 1500 },
    ],
    applicationInvoiceIds: [INVOICE_A, INVOICE_B],
    gsi1pk: '', gsi1sk: '',
    createdAt: '2026-07-15T00:00:00Z',
    createdBy: 'user-1',
    updatedAt: '2026-07-15T00:00:00Z',
    updatedBy: 'user-1',
    version: 1,
    ...overrides,
  } as PaymentEntity;
}

function singlePaymentEntity(): PaymentEntity {
  return multiPaymentEntity({
    paymentId: 'single-pay-uuid',
    entityKey: `PAYMENT#${SCHOOL_ID}#single-pay-uuid`,
    invoiceId: INVOICE_A,
    studentAccountId: 'acct-1',
    studentId: 'student-1-uuid',
    familyId: undefined,
    amount: 1000,
    applications: [{ targetType: 'invoice', invoiceId: INVOICE_A, amount: 1000 }],
    applicationInvoiceIds: undefined,
    gsi2pk: `TENANT#${TENANT_ID}#STUDENT#student-1-uuid`,
    gsi2sk: 'PAYMENT#2026-07-15T00:00:00Z',
  } as Partial<PaymentEntity>);
}

function invoiceEntity(invoiceId: string, studentId: string, studentName: string, invoiceNumber: string): InvoiceEntity {
  return {
    tenantId: TENANT_ID,
    entityKey: `INVOICE#${SCHOOL_ID}#${invoiceId}`,
    entityType: 'INVOICE',
    invoiceId,
    invoiceNumber,
    studentAccountId: `acct-${studentId}`,
    studentId,
    studentName,
    schoolId: SCHOOL_ID,
    schoolName: 'Test School',
    academicYear: '2025-2026',
    lineItems: [],
    subtotal: 1000, taxTotal: 0, discountTotal: 0, grandTotal: 1000,
    amountPaid: 1000, amountDue: 0,
    currency: 'NPR',
    dueDate: '2026-08-15', issuedDate: '2026-07-15',
    status: 'paid',
    gsi1pk: '', gsi1sk: '', gsi2pk: '', gsi2sk: '', gsi3pk: '', gsi3sk: '',
    createdAt: '', createdBy: '', updatedAt: '', updatedBy: '', version: 2,
  } as InvoiceEntity;
}

function buildService(rows: Map<string, any>, queryItems: PaymentEntity[] = []) {
  const dynamoDBClient: any = {
    getClient: jest.fn().mockResolvedValue({}),
    getItem: jest.fn().mockImplementation(async (_c: any, _t: string, k: string) => rows.get(k) ?? null),
    batchGetItems: jest.fn().mockImplementation(async (_c: any, keys: Array<{ entityKey: string }>) =>
      keys.map(k => rows.get(k.entityKey)).filter(Boolean),
    ),
    queryGSI: jest.fn().mockResolvedValue({ items: queryItems, hasMore: false }),
    getTableName: jest.fn().mockReturnValue('edforge-finance-test'),
  };
  const identityClient: any = {
    getStudentInfo: jest.fn().mockResolvedValue(null),
    getUserDisplayName: jest.fn().mockResolvedValue(null),
  };
  const service = new PaymentsService(
    dynamoDBClient,
    {} as any,
    {} as any,
    { getEntity: jest.fn(), get: jest.fn() } as any,
    {} as any,
    {} as any,
    {} as any,
    identityClient,
    { optimize: jest.fn(async (u: any) => u) } as any,
  );
  return { service, dynamoDBClient, identityClient };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('getReceipt — multi-target JSON breakdown (FB-4.5)', () => {
  const rows = () => new Map<string, any>([
    [`PAYMENT#${SCHOOL_ID}#${PAYMENT_ID}`, multiPaymentEntity()],
    [`INVOICE#${SCHOOL_ID}#${INVOICE_A}`, invoiceEntity(INVOICE_A, 'student-1-uuid', 'Sunita Rai', 'INV-2083-0041')],
    [`INVOICE#${SCHOOL_ID}#${INVOICE_B}`, invoiceEntity(INVOICE_B, 'student-2-uuid', 'Bikash Rai', 'INV-2083-0042')],
  ]);

  it('renders one line per target invoice with invoiceNumber + student + allocated amount; totals collapse to payment amount', async () => {
    const { service, dynamoDBClient } = buildService(rows());
    const receipt = await service.getReceipt(SCHOOL_ID, PAYMENT_ID, ctx);

    // ONE batch fetch for invoice numbers — not N GetItems.
    expect(dynamoDBClient.batchGetItems).toHaveBeenCalledTimes(1);

    expect(receipt.receiptNumber).toBe('RCP-2026-0900');
    expect(receipt.invoiceNumber).toBe('2 invoices');
    expect(receipt.studentName).toBe('Sunita Rai, Bikash Rai');
    // Receipt contract requires a single studentId — FIRST target's (canonical order).
    expect(receipt.studentId).toBe('student-1-uuid');
    expect(receipt.lineItems).toEqual([
      { description: 'Invoice INV-2083-0041 — Sunita Rai', amount: 1000, taxAmount: 0, total: 1000 },
      { description: 'Invoice INV-2083-0042 — Bikash Rai', amount: 1500, taxAmount: 0, total: 1500 },
    ]);
    expect(receipt.subtotal).toBe(2500);
    expect(receipt.taxTotal).toBe(0);
    expect(receipt.discountTotal).toBe(0);
    expect(receipt.grandTotal).toBe(2500);
    expect(receipt.taxBreakdown).toEqual({ taxableAmount: 2500, taxAmount: 0 });
    expect(receipt.paidBy).toBe('operator-name');
  });

  it('404s when a target invoice row is missing (payment must never reference a missing invoice)', async () => {
    const r = rows();
    r.delete(`INVOICE#${SCHOOL_ID}#${INVOICE_B}`);
    const { service } = buildService(r);
    await expect(service.getReceipt(SCHOOL_ID, PAYMENT_ID, ctx)).rejects.toThrow(NotFoundException);
  });

  it('still 400s for non-completed multi payments (shared guard)', async () => {
    const r = rows();
    r.set(`PAYMENT#${SCHOOL_ID}#${PAYMENT_ID}`, multiPaymentEntity({ status: 'cancelled' }));
    const { service } = buildService(r);
    await expect(service.getReceipt(SCHOOL_ID, PAYMENT_ID, ctx)).rejects.toThrow(BadRequestException);
  });

  it('review F3 — multi-target ownership targets: EVERY DISTINCT target studentId, in application order', async () => {
    const { service } = buildService(rows());
    const { receipt, ownershipStudentIds } = await service.getReceiptWithOwnershipTargets(
      SCHOOL_ID,
      PAYMENT_ID,
      ctx,
    );
    expect(ownershipStudentIds).toEqual(['student-1-uuid', 'student-2-uuid']);
    // Receipt payload unchanged — first target stays display plumbing only.
    expect(receipt.studentId).toBe('student-1-uuid');
  });

  it('review F3 — duplicate target students collapse to one ownership id (two invoices, same sibling)', async () => {
    const r = new Map<string, any>([
      [`PAYMENT#${SCHOOL_ID}#${PAYMENT_ID}`, multiPaymentEntity()],
      [`INVOICE#${SCHOOL_ID}#${INVOICE_A}`, invoiceEntity(INVOICE_A, 'student-1-uuid', 'Sunita Rai', 'INV-2083-0041')],
      [`INVOICE#${SCHOOL_ID}#${INVOICE_B}`, invoiceEntity(INVOICE_B, 'student-1-uuid', 'Sunita Rai', 'INV-2083-0042')],
    ]);
    const { service } = buildService(r);
    const { ownershipStudentIds } = await service.getReceiptWithOwnershipTargets(
      SCHOOL_ID,
      PAYMENT_ID,
      ctx,
    );
    expect(ownershipStudentIds).toEqual(['student-1-uuid']);
  });

  it('review F3 — single-target payment returns exactly the invoice studentId (legacy check byte-identical)', async () => {
    const single = singlePaymentEntity();
    const { service } = buildService(new Map<string, any>([[single.entityKey, single]]));
    // Single-target path projects line items from the parent invoice DTO.
    (service as any).invoicesService.get = jest.fn().mockResolvedValue({
      invoiceNumber: 'INV-2083-0041',
      studentId: 'student-1-uuid',
      studentName: 'Sunita Rai',
      schoolName: 'Test School',
      lineItems: [],
      subtotal: 1000,
      taxTotal: 0,
      discountTotal: 0,
      grandTotal: 1000,
    });

    const { receipt, ownershipStudentIds } = await service.getReceiptWithOwnershipTargets(
      SCHOOL_ID,
      'single-pay-uuid',
      ctx,
    );
    expect(ownershipStudentIds).toEqual(['student-1-uuid']);
    expect(receipt.studentId).toBe('student-1-uuid');
  });
});

describe('list consumers — null-invoiceId tolerance (FB-4.5)', () => {
  it('listBySchool: multi rows list without single-invoice enrichment; batch keys exclude nulls', async () => {
    const single = singlePaymentEntity();
    const multi = multiPaymentEntity();
    const rows = new Map<string, any>([
      [`INVOICE#${SCHOOL_ID}#${INVOICE_A}`, invoiceEntity(INVOICE_A, 'student-1-uuid', 'Sunita Rai', 'INV-2083-0041')],
    ]);
    const { service, dynamoDBClient } = buildService(rows, [single, multi]);

    const result = await service.listBySchool(SCHOOL_ID, ctx);

    const keys = dynamoDBClient.batchGetItems.mock.calls[0][1];
    expect(keys).toHaveLength(1);
    expect(keys[0].entityKey).toBe(`INVOICE#${SCHOOL_ID}#${INVOICE_A}`);

    const singleDto = result.items.find(i => i.id === 'single-pay-uuid')!;
    expect(singleDto.invoiceNumber).toBe('INV-2083-0041');
    expect(singleDto.studentName).toBe('Sunita Rai');

    const multiDto = result.items.find(i => i.id === PAYMENT_ID)!;
    expect(multiDto.invoiceId).toBeNull();
    expect(multiDto.studentAccountId).toBeNull();
    expect(multiDto.familyId).toBe('55555555-dddd-4ddd-8ddd-555555555555');
    expect(multiDto.invoiceNumber).toBeUndefined();
    expect(multiDto.studentName).toBeUndefined();
    expect(multiDto.applications).toHaveLength(2);
  });

  it('listByInvoice: filter matches the scalar OR the denormalized applicationInvoiceIds list', async () => {
    const { service, dynamoDBClient } = buildService(new Map(), [multiPaymentEntity()]);
    await service.listByInvoice(SCHOOL_ID, INVOICE_A, ctx);

    const call = dynamoDBClient.queryGSI.mock.calls[0];
    expect(call[5]).toBe('invoiceId = :invoiceId OR contains(applicationInvoiceIds, :invoiceId)');
    expect(call[6]).toEqual({ ':invoiceId': INVOICE_A });
  });

  it('CSV export: multi row renders a "multiple (2)" invoice cell instead of crashing on null.slice', async () => {
    const rows = new Map<string, any>([
      [`INVOICE#${SCHOOL_ID}#${INVOICE_A}`, invoiceEntity(INVOICE_A, 'student-1-uuid', 'Sunita Rai', 'INV-2083-0041')],
    ]);
    const { service } = buildService(rows, [singlePaymentEntity(), multiPaymentEntity()]);

    const csvRows: string[] = [];
    for await (const row of service.streamPaymentsCsvRows(SCHOOL_ID, ctx)) {
      csvRows.push(row);
    }
    expect(csvRows.join('')).toContain('"multiple (2)"');
    expect(csvRows.join('')).toContain('"INV-2083-0041"');
  });
});

describe('gateway paths — nullable-field guards (FB-4.4 assertion)', () => {
  it('resolveSessionContext fails closed for a session pointing at a null-studentId payment', async () => {
    const rows = new Map<string, any>([
      ['PAYMENT_SESSION#sess-1', { paymentId: PAYMENT_ID, schoolId: SCHOOL_ID, invoiceId: INVOICE_A }],
      [`PAYMENT#${SCHOOL_ID}#${PAYMENT_ID}`, multiPaymentEntity()],
    ]);
    const { service, dynamoDBClient } = buildService(rows);
    // Session key shape comes from EntityKeyBuilder — mirror it via the mock:
    dynamoDBClient.getItem.mockImplementation(async (_c: any, _t: string, k: string) =>
      k.includes('SESSION') ? rows.get('PAYMENT_SESSION#sess-1') && { ...rows.get('PAYMENT_SESSION#sess-1'), studentId: undefined } : rows.get(k) ?? null,
    );
    // Force the fallback path (no studentId on session) → payment lookup → null studentId → 404.
    await expect(service.resolveSessionContext('sess-1', ctx)).rejects.toThrow(NotFoundException);
  });
});

describe('RefundsService.create — multi-target payment fallback (FB-4.5)', () => {
  it('resolves studentId from the named invoice when payment.studentId is null', async () => {
    const rows = new Map<string, any>([
      [`PAYMENT#${SCHOOL_ID}#${PAYMENT_ID}`, multiPaymentEntity()],
      [`INVOICE#${SCHOOL_ID}#${INVOICE_B}`, invoiceEntity(INVOICE_B, 'student-2-uuid', 'Bikash Rai', 'INV-2083-0042')],
    ]);
    const dynamoDBClient: any = {
      getClient: jest.fn().mockResolvedValue({}),
      getItem: jest.fn().mockImplementation(async (_c: any, _t: string, k: string) => rows.get(k) ?? null),
      putItem: jest.fn().mockResolvedValue(undefined),
      getTableName: jest.fn().mockReturnValue('edforge-finance-test'),
    };
    const refunds = new RefundsService(dynamoDBClient, {} as any);
    jest.spyOn((refunds as any).auditLogger, 'log').mockImplementation(() => {});

    const dto = await refunds.create(
      SCHOOL_ID,
      { paymentId: PAYMENT_ID, invoiceId: INVOICE_B, amount: 1500, reason: 'sibling overbilled' } as any,
      ctx,
    );

    expect(dto.studentId).toBe('student-2-uuid');
    const putArg = dynamoDBClient.putItem.mock.calls[0][1];
    expect(putArg.studentId).toBe('student-2-uuid');
  });

  it('404s when the named invoice does not exist (no silent null studentId)', async () => {
    const rows = new Map<string, any>([
      [`PAYMENT#${SCHOOL_ID}#${PAYMENT_ID}`, multiPaymentEntity()],
    ]);
    const dynamoDBClient: any = {
      getClient: jest.fn().mockResolvedValue({}),
      getItem: jest.fn().mockImplementation(async (_c: any, _t: string, k: string) => rows.get(k) ?? null),
      putItem: jest.fn(),
      getTableName: jest.fn().mockReturnValue('edforge-finance-test'),
    };
    const refunds = new RefundsService(dynamoDBClient, {} as any);
    await expect(
      refunds.create(SCHOOL_ID, { paymentId: PAYMENT_ID, invoiceId: INVOICE_B, amount: 100, reason: 'x' } as any, ctx),
    ).rejects.toThrow(NotFoundException);
    expect(dynamoDBClient.putItem).not.toHaveBeenCalled();
  });

  it('review NOTE-B — 400 INVALID_REFUND_TARGET when dto.invoiceId is not one of the payment targets', async () => {
    const rows = new Map<string, any>([
      [`PAYMENT#${SCHOOL_ID}#${PAYMENT_ID}`, multiPaymentEntity()],
      // The stray invoice EXISTS — existence is not the failure mode;
      // it simply was never settled by this payment.
      [`INVOICE#${SCHOOL_ID}#stray-invoice-uuid`, invoiceEntity('stray-invoice-uuid', 'student-9-uuid', 'Unrelated Kid', 'INV-2083-0999')],
    ]);
    const dynamoDBClient: any = {
      getClient: jest.fn().mockResolvedValue({}),
      getItem: jest.fn().mockImplementation(async (_c: any, _t: string, k: string) => rows.get(k) ?? null),
      putItem: jest.fn(),
      getTableName: jest.fn().mockReturnValue('edforge-finance-test'),
    };
    const refunds = new RefundsService(dynamoDBClient, {} as any);

    let thrown: any;
    try {
      await refunds.create(
        SCHOOL_ID,
        { paymentId: PAYMENT_ID, invoiceId: 'stray-invoice-uuid', amount: 100, reason: 'x' } as any,
        ctx,
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(BadRequestException);
    expect(thrown.getResponse().code).toBe('INVALID_REFUND_TARGET');
    expect(dynamoDBClient.putItem).not.toHaveBeenCalled();
  });

  it('review NOTE-B — falls back to applications[].invoiceId when applicationInvoiceIds is absent (target accepted)', async () => {
    const rows = new Map<string, any>([
      [`PAYMENT#${SCHOOL_ID}#${PAYMENT_ID}`, multiPaymentEntity({ applicationInvoiceIds: undefined } as any)],
      [`INVOICE#${SCHOOL_ID}#${INVOICE_B}`, invoiceEntity(INVOICE_B, 'student-2-uuid', 'Bikash Rai', 'INV-2083-0042')],
    ]);
    const dynamoDBClient: any = {
      getClient: jest.fn().mockResolvedValue({}),
      getItem: jest.fn().mockImplementation(async (_c: any, _t: string, k: string) => rows.get(k) ?? null),
      putItem: jest.fn().mockResolvedValue(undefined),
      getTableName: jest.fn().mockReturnValue('edforge-finance-test'),
    };
    const refunds = new RefundsService(dynamoDBClient, {} as any);
    jest.spyOn((refunds as any).auditLogger, 'log').mockImplementation(() => {});

    const dto = await refunds.create(
      SCHOOL_ID,
      { paymentId: PAYMENT_ID, invoiceId: INVOICE_B, amount: 100, reason: 'x' } as any,
      ctx,
    );
    expect(dto.studentId).toBe('student-2-uuid');
  });

  it('single-target payment keeps the direct payment.studentId path (no invoice fetch)', async () => {
    const single = singlePaymentEntity();
    const rows = new Map<string, any>([[single.entityKey, single]]);
    const dynamoDBClient: any = {
      getClient: jest.fn().mockResolvedValue({}),
      getItem: jest.fn().mockImplementation(async (_c: any, _t: string, k: string) => rows.get(k) ?? null),
      putItem: jest.fn().mockResolvedValue(undefined),
      getTableName: jest.fn().mockReturnValue('edforge-finance-test'),
    };
    const refunds = new RefundsService(dynamoDBClient, {} as any);
    jest.spyOn((refunds as any).auditLogger, 'log').mockImplementation(() => {});

    const dto = await refunds.create(
      SCHOOL_ID,
      { paymentId: 'single-pay-uuid', invoiceId: INVOICE_A, amount: 100, reason: 'x' } as any,
      ctx,
    );
    expect(dto.studentId).toBe('student-1-uuid');
    // Only the payment row was fetched — no invoice lookup needed.
    expect(dynamoDBClient.getItem).toHaveBeenCalledTimes(1);
  });
});
