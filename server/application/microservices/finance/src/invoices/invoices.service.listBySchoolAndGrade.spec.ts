/**
 * InvoicesService.listBySchoolAndGrade + PaymentsService.listBySchoolAndGrade
 *
 * Sprint A.4 — read methods consuming GSI14 (school + gradeLevel scope).
 *
 * Pins:
 *   - Calls queryGSI with indexName='GSI14' + correct gsi14pk shape
 *   - sk filter `begins_with 'INVOICE#'` vs `'PAYMENT#'` (shared GSI)
 *   - Empty/whitespace gradeLevel → BadRequestException (defensive)
 *   - status / academicYear / gateway as FilterExpression (not in KeyCondition)
 *   - Logs the result count
 *
 * Both methods mirror each other; one spec file covers both for brevity.
 */

import { BadRequestException, Logger } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { PaymentsService } from '../payments/payments.service';

const TENANT_ID = 'tenant-uuid';
const SCHOOL_ID = 'school-uuid';

const ctx = {
  tenantId: TENANT_ID,
  userId: 'user-1',
  jwtToken: 'jwt',
  role: 'TenantAdmin',
  schoolId: SCHOOL_ID,
} as any;

describe('InvoicesService.listBySchoolAndGrade (Sprint A.4)', () => {
  let service: InvoicesService;
  let dynamoDBClient: any;

  beforeEach(() => {
    dynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({}),
      queryGSI: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    };
    service = new InvoicesService(
      dynamoDBClient,
      { publishInvoiceGenerated: jest.fn(), publishInvoiceIssued: jest.fn() } as any,
      { getStudentInfo: jest.fn() } as any,
      { getCurrency: jest.fn() } as any,
      {} as any,
      { getByIds: jest.fn() } as any,
      { getOrCreate: jest.fn() } as any,
    );
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('queries GSI14 with the school+grade PK and INVOICE# sort prefix', async () => {
    await service.listBySchoolAndGrade(SCHOOL_ID, '4', ctx);

    expect(dynamoDBClient.queryGSI).toHaveBeenCalledTimes(1);
    const [, indexName, pkValue, skValue, skOperator] =
      dynamoDBClient.queryGSI.mock.calls[0];
    expect(indexName).toBe('GSI14');
    expect(pkValue).toBe(`TENANT#${TENANT_ID}#SCHOOL#${SCHOOL_ID}#GRADE#4`);
    expect(skValue).toBe('INVOICE');
    expect(skOperator).toBe('begins_with');
  });

  it('passes status + academicYear as FilterExpression (not in KeyCondition)', async () => {
    await service.listBySchoolAndGrade(SCHOOL_ID, '4', ctx, {
      status: 'issued',
      academicYear: '2025-2026',
    });

    const [, , , , , filterExpression, attrValues, attrNames] =
      dynamoDBClient.queryGSI.mock.calls[0];
    expect(filterExpression).toMatch(/#status = :status/);
    expect(filterExpression).toMatch(/academicYear = :academicYear/);
    expect(attrValues).toMatchObject({
      ':status': 'issued',
      ':academicYear': '2025-2026',
    });
    expect(attrNames).toMatchObject({ '#status': 'status' });
  });

  it('rejects empty gradeLevel with BadRequestException (defensive)', async () => {
    await expect(
      service.listBySchoolAndGrade(SCHOOL_ID, '', ctx),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.listBySchoolAndGrade(SCHOOL_ID, '   ', ctx),
    ).rejects.toThrow(/non-empty gradeLevel/);
    expect(dynamoDBClient.queryGSI).not.toHaveBeenCalled();
  });

  it('logs the per-call result count for ops visibility', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    dynamoDBClient.queryGSI.mockResolvedValueOnce({
      items: [
        { invoiceId: '1', studentName: 'A', schoolId: SCHOOL_ID } as any,
        { invoiceId: '2', studentName: 'B', schoolId: SCHOOL_ID } as any,
      ],
      hasMore: false,
    });

    await service.listBySchoolAndGrade(SCHOOL_ID, '4', ctx);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/listBySchoolAndGrade entity=INVOICE.*returned=2/),
    );
  });

  it('caps default limit at 50 when not specified; honors caller limit otherwise', async () => {
    await service.listBySchoolAndGrade(SCHOOL_ID, '4', ctx);
    expect(dynamoDBClient.queryGSI.mock.calls[0][8]).toBe(50);

    dynamoDBClient.queryGSI.mockClear();
    await service.listBySchoolAndGrade(SCHOOL_ID, '4', ctx, { limit: 100 });
    expect(dynamoDBClient.queryGSI.mock.calls[0][8]).toBe(100);
  });
});

describe('PaymentsService.listBySchoolAndGrade (Sprint A.4)', () => {
  let service: PaymentsService;
  let dynamoDBClient: any;

  beforeEach(() => {
    dynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({}),
      queryGSI: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
      batchGetItems: jest.fn().mockResolvedValue([]),
    };
    service = new PaymentsService(
      dynamoDBClient,
      { publishPaymentRecorded: jest.fn() } as any,
      { nextReceiptNumber: jest.fn() } as any,
      { getEntity: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('queries GSI14 with PAYMENT# sort prefix (shares GSI14 with invoice-by-grade)', async () => {
    await service.listBySchoolAndGrade(SCHOOL_ID, '4', ctx);

    const [, indexName, pkValue, skValue, skOperator] =
      dynamoDBClient.queryGSI.mock.calls[0];
    expect(indexName).toBe('GSI14');
    expect(pkValue).toBe(`TENANT#${TENANT_ID}#SCHOOL#${SCHOOL_ID}#GRADE#4`);
    expect(skValue).toBe('PAYMENT');
    expect(skOperator).toBe('begins_with');
  });

  it('passes status + gateway as FilterExpression', async () => {
    await service.listBySchoolAndGrade(SCHOOL_ID, '4', ctx, {
      status: 'completed',
      gateway: 'cash',
    });

    const [, , , , , filterExpression, attrValues, attrNames] =
      dynamoDBClient.queryGSI.mock.calls[0];
    expect(filterExpression).toMatch(/#status = :status/);
    expect(filterExpression).toMatch(/gateway = :gateway/);
    expect(attrValues).toMatchObject({
      ':status': 'completed',
      ':gateway': 'cash',
    });
    expect(attrNames).toMatchObject({ '#status': 'status' });
  });

  it('rejects empty gradeLevel with BadRequestException', async () => {
    await expect(
      service.listBySchoolAndGrade(SCHOOL_ID, '', ctx),
    ).rejects.toThrow(BadRequestException);
    expect(dynamoDBClient.queryGSI).not.toHaveBeenCalled();
  });

  it('enriches the page with studentName + invoiceNumber from related invoices', async () => {
    dynamoDBClient.queryGSI.mockResolvedValueOnce({
      items: [
        { paymentId: 'p1', invoiceId: 'i1', refunds: [], metadata: {} } as any,
      ],
      hasMore: false,
    });
    dynamoDBClient.batchGetItems.mockResolvedValueOnce([
      { invoiceId: 'i1', studentName: 'Aakriti Sharma', invoiceNumber: 'INV-2026-0001' } as any,
    ]);

    const result = await service.listBySchoolAndGrade(SCHOOL_ID, '4', ctx);

    expect(result.items).toHaveLength(1);
    expect((result.items[0] as any).studentName).toBe('Aakriti Sharma');
    expect((result.items[0] as any).invoiceNumber).toBe('INV-2026-0001');
  });
});
