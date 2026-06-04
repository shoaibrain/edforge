/**
 * `PaymentsService.getReceipt` (JSON path) — covers the API-side projection
 * that mirrors the PDF renderer's governance-correct identifier surfacing.
 *
 * The JSON receipt is what the AdminWeb + parent portal `PaymentReceipt`
 * component renders, so it must carry `studentNumber` + `emisStudentId`
 * sourced from the student record — never the internal `studentId` UUID
 * as a user-facing identifier.
 */

import { BadRequestException, Logger } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import type { Payment, Invoice } from '@aibrains/shared-types';

const TENANT_ID = 'tenant-uuid';
const SCHOOL_ID = 'school-uuid';
const INVOICE_ID = 'invoice-uuid';
const PAYMENT_ID = 'payment-uuid';
const STUDENT_ID = 'student-uuid';

const ctx = {
  tenantId: TENANT_ID,
  userId: 'user-1',
  jwtToken: 'jwt',
  role: 'TenantAdmin',
  schoolId: SCHOOL_ID,
} as any;

function fixturePaymentDto(overrides: Partial<Payment> = {}): Payment {
  return {
    id: PAYMENT_ID,
    invoiceId: INVOICE_ID,
    studentAccountId: 'sa-uuid',
    amount: 11235,
    currency: 'NPR',
    gateway: 'esewa',
    gatewayTransactionId: 'TXN-987654321',
    status: 'completed',
    paidAt: '2026-03-20T10:00:00Z',
    paidBy: 'Saraswati Sharma',
    receiptNumber: 'RCT-2026-001234',
    createdAt: '2026-03-20T10:00:00Z',
    updatedAt: '2026-03-20T10:00:00Z',
    ...overrides,
  } as Payment;
}

function fixtureInvoiceDto(): Invoice {
  return {
    id: INVOICE_ID,
    invoiceNumber: 'INV-2026-001234',
    studentAccountId: 'sa-uuid',
    studentId: STUDENT_ID,
    studentName: 'Saraswati Sharma',
    schoolName: 'Saraswati School',
    academicYear: '2025-2026',
    lineItems: [
      {
        description: 'Tuition fee',
        amount: 10000,
        quantity: 1,
        discount: 500,
        taxRate: 13,
        taxAmount: 1235,
        total: 10735,
      },
    ],
    subtotal: 10500,
    taxTotal: 1235,
    discountTotal: 500,
    grandTotal: 11235,
    amountPaid: 11235,
    amountDue: 0,
    currency: 'NPR',
    dueDate: '2026-04-28',
    issuedDate: '2026-03-15',
    status: 'paid',
    createdAt: '2026-03-15T00:00:00Z',
    updatedAt: '2026-03-20T10:00:00Z',
  } as Invoice;
}

describe('PaymentsService.getReceipt — governance-correct student identifiers', () => {
  let service: PaymentsService;
  let invoicesService: any;
  let identityClient: any;
  let getSpy: jest.SpyInstance;

  beforeEach(() => {
    invoicesService = {
      get: jest.fn().mockResolvedValue(fixtureInvoiceDto()),
    };
    identityClient = {
      getStudentInfo: jest.fn().mockResolvedValue({
        studentId: STUDENT_ID,
        firstName: 'Saraswati',
        lastName: 'Sharma',
        gradeLevel: '8',
        studentNumber: 'STU-2026-0042',
        emisStudentId: '1708400128200043',
      }),
    };

    service = new PaymentsService(
      {} as any, // dynamoDBClient
      {} as any, // eventsService
      {} as any, // sequenceService
      invoicesService,
      {} as any, // studentAccountsService
      {} as any, // gatewayRegistry
      {} as any, // gatewayConfigService
      identityClient,
    );

    // Stub PaymentsService.get (the DTO-level fetch) — JSON path uses
    // the DTO rather than entity.
    getSpy = jest
      .spyOn(service, 'get' as any)
      .mockResolvedValue(fixturePaymentDto());
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    getSpy.mockRestore();
  });

  it('populates studentNumber + emisStudentId from IdentityClient.getStudentInfo', async () => {
    const receipt = await service.getReceipt(SCHOOL_ID, PAYMENT_ID, ctx);

    expect(identityClient.getStudentInfo).toHaveBeenCalledWith(STUDENT_ID, ctx);
    expect(receipt.studentNumber).toBe('STU-2026-0042');
    expect(receipt.emisStudentId).toBe('1708400128200043');
  });

  it('identity lookup returns null → receipt still resolves with both identifiers undefined', async () => {
    identityClient.getStudentInfo.mockResolvedValue(null);

    const receipt = await service.getReceipt(SCHOOL_ID, PAYMENT_ID, ctx);

    expect(receipt.studentNumber).toBeUndefined();
    expect(receipt.emisStudentId).toBeUndefined();
    // studentId stays on the JSON contract for legacy callers but the
    // frontend renders studentNumber/emisStudentId, never the UUID.
    expect(receipt.studentId).toBe(STUDENT_ID);
  });

  it('throws BadRequestException when payment is not completed', async () => {
    getSpy.mockResolvedValue(fixturePaymentDto({ status: 'pending' }));

    await expect(
      service.getReceipt(SCHOOL_ID, PAYMENT_ID, ctx),
    ).rejects.toThrow(BadRequestException);

    expect(identityClient.getStudentInfo).not.toHaveBeenCalled();
  });
});
