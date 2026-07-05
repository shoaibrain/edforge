/**
 * Review F2 — `listOpenInvoiceEntitiesForStudent` pagination. The method
 * carries a FilterExpression, and DynamoDB applies Limit BEFORE the filter
 * (dynamodb-client.service.ts docstring), so a single limit-100 page can
 * starve: an open invoice past page 1 would silently vanish from family
 * open-invoice views. The fix paginates on lastEvaluatedKey to exhaustion
 * (hard cap 25 pages → INVOICE_SCAN_LIMIT_EXCEEDED, never a silent pass).
 */

import { ConflictException } from '@nestjs/common';
import { InvoicesService } from './invoices.service';

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

function openInvoice(invoiceId: string) {
  return {
    invoiceId,
    invoiceNumber: `INV-${invoiceId}`,
    schoolId: SCHOOL_ID,
    studentId: STUDENT_ID,
    status: 'issued',
    amountDue: 1000,
  };
}

function buildService(dynamoDBClient: any) {
  return new InvoicesService(
    dynamoDBClient,
    { publishInvoiceGenerated: jest.fn() } as any,
    { getStudentInfo: jest.fn(), getSchoolName: jest.fn() } as any,
    { getCurrency: jest.fn() } as any,
    { nextInvoiceNumber: jest.fn() } as any,
    { getByIds: jest.fn() } as any,
    { getOrCreate: jest.fn(), recordLedgerEntry: jest.fn() } as any,
    { optimize: jest.fn(async (u: string) => u) } as any,
    { getActiveAgreementForStudent: jest.fn() } as any,
  );
}

describe('InvoicesService.listOpenInvoiceEntitiesForStudent — review F2 pagination', () => {
  it('review F2 — concatenates pages: an open invoice appearing only on page 2 is returned', async () => {
    const page2Cursor = Buffer.from(JSON.stringify({ entityKey: 'INVOICE#end-of-page-1' })).toString('base64');
    const queryGSI = jest
      .fn()
      .mockResolvedValueOnce({ items: [openInvoice('inv-1')], hasMore: true, lastEvaluatedKey: page2Cursor })
      .mockResolvedValueOnce({ items: [openInvoice('inv-2')], hasMore: false });
    const dynamoDBClient = { getClient: jest.fn().mockResolvedValue({}), queryGSI };
    const service = buildService(dynamoDBClient);

    const items = await service.listOpenInvoiceEntitiesForStudent(SCHOOL_ID, STUDENT_ID, ctx);

    expect(items.map((i) => i.invoiceId)).toEqual(['inv-1', 'inv-2']);
    expect(queryGSI).toHaveBeenCalledTimes(2);
    expect(queryGSI.mock.calls[0][10]).toBeUndefined();
    expect(queryGSI.mock.calls[1][10]).toEqual({ entityKey: 'INVOICE#end-of-page-1' });
    // Query shape unchanged: GSI2 student scope + open-status filter.
    expect(queryGSI.mock.calls[0][1]).toBe('GSI2');
    expect(queryGSI.mock.calls[0][2]).toBe(`TENANT#${TENANT_ID}#STUDENT#${STUDENT_ID}`);
    expect(queryGSI.mock.calls[0][5]).toContain('amountDue > :zero');
  });

  it('review F2 — single exhausted page returns exactly its items (baseline unchanged)', async () => {
    const queryGSI = jest.fn().mockResolvedValue({ items: [openInvoice('inv-1')], hasMore: false });
    const dynamoDBClient = { getClient: jest.fn().mockResolvedValue({}), queryGSI };
    const service = buildService(dynamoDBClient);

    const items = await service.listOpenInvoiceEntitiesForStudent(SCHOOL_ID, STUDENT_ID, ctx);
    expect(items.map((i) => i.invoiceId)).toEqual(['inv-1']);
    expect(queryGSI).toHaveBeenCalledTimes(1);
  });

  it('review F2 — 25-page cap throws INVOICE_SCAN_LIMIT_EXCEEDED instead of silently truncating', async () => {
    const cursor = Buffer.from(JSON.stringify({ entityKey: 'k' })).toString('base64');
    const queryGSI = jest.fn().mockResolvedValue({ items: [], hasMore: true, lastEvaluatedKey: cursor });
    const dynamoDBClient = { getClient: jest.fn().mockResolvedValue({}), queryGSI };
    const service = buildService(dynamoDBClient);

    let thrown: any;
    try {
      await service.listOpenInvoiceEntitiesForStudent(SCHOOL_ID, STUDENT_ID, ctx);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ConflictException);
    expect(thrown.getResponse().code).toBe('INVOICE_SCAN_LIMIT_EXCEEDED');
    expect(queryGSI).toHaveBeenCalledTimes(25);
  });
});

describe('InvoicesService.checkDuplicateInvoice — round-3 C3 exhaustive scan', () => {
  // hasDuplicateInvoice previously read ONE limit-100 page: a duplicate
  // sitting deeper in the student's GSI2 partition silently passed and
  // double-generated. It now rides the review-F2 exhaustive helper (same
  // 25-page cap → loud 409).
  const dupRow = {
    invoiceId: 'inv-dup',
    invoiceNumber: 'INV-dup',
    status: 'issued',
    billingPeriod: '2083-03',
    lineItems: [{ feeStructureId: 'fs-1' }],
  };

  it('round-3 C3 — a duplicate sitting on page 2 is found', async () => {
    const page2Cursor = Buffer.from(JSON.stringify({ entityKey: 'INVOICE#end-of-page-1' })).toString('base64');
    const queryGSI = jest
      .fn()
      .mockResolvedValueOnce({ items: [], hasMore: true, lastEvaluatedKey: page2Cursor })
      .mockResolvedValueOnce({ items: [dupRow], hasMore: false });
    const service = buildService({ getClient: jest.fn().mockResolvedValue({}), queryGSI });

    const isDuplicate = await service.checkDuplicateInvoice(
      SCHOOL_ID, STUDENT_ID, ['fs-1'], '2083-03', ctx,
    );

    expect(isDuplicate).toBe(true);
    expect(queryGSI).toHaveBeenCalledTimes(2);
    expect(queryGSI.mock.calls[1][10]).toEqual({ entityKey: 'INVOICE#end-of-page-1' });
  });

  it('round-3 C3 — 25-page cap throws INVOICE_SCAN_LIMIT_EXCEEDED (never a silent pass)', async () => {
    const cursor = Buffer.from(JSON.stringify({ entityKey: 'k' })).toString('base64');
    const queryGSI = jest.fn().mockResolvedValue({ items: [], hasMore: true, lastEvaluatedKey: cursor });
    const service = buildService({ getClient: jest.fn().mockResolvedValue({}), queryGSI });

    let thrown: any;
    try {
      await service.checkDuplicateInvoice(SCHOOL_ID, STUDENT_ID, ['fs-1'], '2083-03', ctx);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ConflictException);
    expect(thrown.getResponse().code).toBe('INVOICE_SCAN_LIMIT_EXCEEDED');
    expect(queryGSI).toHaveBeenCalledTimes(25);
  });

  it('no billingPeriod → no scan at all (fast-path unchanged)', async () => {
    const queryGSI = jest.fn();
    const service = buildService({ getClient: jest.fn().mockResolvedValue({}), queryGSI });

    const isDuplicate = await service.checkDuplicateInvoice(
      SCHOOL_ID, STUDENT_ID, ['fs-1'], undefined, ctx,
    );

    expect(isDuplicate).toBe(false);
    expect(queryGSI).not.toHaveBeenCalled();
  });
});
