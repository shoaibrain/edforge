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
  let logSpy: jest.SpyInstance;

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
      getUserDisplayName: jest.fn().mockResolvedValue('Ramesh Adhikari'),
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

      { optimize: jest.fn(async (u) => u) } as any, // pdfLogoOptimizer (Plan §5d)
    );

    // Stub PaymentsService.get (the DTO-level fetch) — JSON path uses
    // the DTO rather than entity.
    getSpy = jest
      .spyOn(service, 'get' as any)
      .mockResolvedValue(fixturePaymentDto());
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    getSpy.mockRestore();
    logSpy.mockRestore();
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
    // NOTE: we intentionally do not assert on `receipt.studentId` here.
    // The field remains on the JSON shape because payments.controller
    // uses it as the ABAC ownership-check anchor (controller line ~192),
    // not because it should be customer-facing. The customer-facing
    // identifiers are `studentNumber` + `emisStudentId`; the renderer
    // and the frontend never display `studentId`.
  });

  it('paidBy = UUID → resolves to displayName via getUserDisplayName', async () => {
    const recorderUuid = 'a1b2c3d4-1234-5678-9abc-def012345678';
    getSpy.mockResolvedValue(fixturePaymentDto({ paidBy: recorderUuid }));

    const receipt = await service.getReceipt(SCHOOL_ID, PAYMENT_ID, ctx);

    expect(identityClient.getUserDisplayName).toHaveBeenCalledWith(recorderUuid, ctx);
    expect(receipt.paidBy).toBe('Ramesh Adhikari');
    expect(receipt.paidBy).not.toBe(recorderUuid);
  });

  it('paidBy = UUID + lookup returns null → falls back to studentName', async () => {
    const recorderUuid = 'a1b2c3d4-1234-5678-9abc-def012345678';
    getSpy.mockResolvedValue(fixturePaymentDto({ paidBy: recorderUuid }));
    identityClient.getUserDisplayName.mockResolvedValue(null);

    const receipt = await service.getReceipt(SCHOOL_ID, PAYMENT_ID, ctx);

    expect(receipt.paidBy).toBe('Saraswati Sharma'); // = invoice.studentName fixture
  });

  it('paidBy = non-UUID string → passes through unchanged, no lookup', async () => {
    getSpy.mockResolvedValue(fixturePaymentDto({ paidBy: 'Mrs. Sharma' }));

    const receipt = await service.getReceipt(SCHOOL_ID, PAYMENT_ID, ctx);

    expect(identityClient.getUserDisplayName).not.toHaveBeenCalled();
    expect(receipt.paidBy).toBe('Mrs. Sharma');
  });

  it('throws BadRequestException when payment is not completed', async () => {
    getSpy.mockResolvedValue(fixturePaymentDto({ status: 'pending' }));

    await expect(
      service.getReceipt(SCHOOL_ID, PAYMENT_ID, ctx),
    ).rejects.toThrow(BadRequestException);

    expect(identityClient.getStudentInfo).not.toHaveBeenCalled();
  });
});
