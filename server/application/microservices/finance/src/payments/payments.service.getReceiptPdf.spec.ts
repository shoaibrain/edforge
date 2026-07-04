/**
 * `PaymentsService.getReceiptPdf` orchestration spec — Sprint C.1.6.
 *
 * The renderer projection logic is covered by `receipt-pdf.renderer.spec.ts`
 * (real `renderToBuffer` invocation). This file mocks the renderer module
 * and verifies the **orchestration**:
 *   - Payment entity loaded directly via DynamoDBClient.getItem
 *   - 404 when payment doesn't exist
 *   - BadRequestException when payment status is not 'completed'
 *   - Parallel fetch: invoice entity + branding + template config
 *   - Branding fetch failure is caught + logged (does NOT throw)
 *   - templateConfig + fallbackArchetype:'PABSON' reaches getCurrentTemplate
 *   - Structured pdf_generated log emitted with docType:'RECEIPT'
 */

import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import type { PaymentEntity } from '../common/entities/payment.entity';
import type { InvoiceEntity } from '../common/entities/invoice.entity';

jest.mock('./receipt-pdf.renderer', () => ({
  renderReceiptToPdfBuffer: jest.fn(),
}));

const { renderReceiptToPdfBuffer } = require('./receipt-pdf.renderer') as {
  renderReceiptToPdfBuffer: jest.Mock;
};

const TENANT_ID = 'tenant-uuid';
const SCHOOL_ID = 'school-uuid';
const INVOICE_ID = 'invoice-uuid';
const PAYMENT_ID = 'payment-uuid';

const ctx = {
  tenantId: TENANT_ID,
  userId: 'user-1',
  jwtToken: 'jwt',
  role: 'TenantAdmin',
  schoolId: SCHOOL_ID,
} as any;

function fixturePayment(overrides: Partial<PaymentEntity> = {}): PaymentEntity {
  return {
    tenantId: TENANT_ID,
    entityKey: `PAYMENT#${SCHOOL_ID}#${PAYMENT_ID}`,
    entityType: 'PAYMENT',
    paymentId: PAYMENT_ID,
    invoiceId: INVOICE_ID,
    studentAccountId: 'sa-uuid',
    schoolId: SCHOOL_ID,
    studentId: 'student-uuid',
    amount: 11235,
    currency: 'NPR',
    gateway: 'esewa',
    gatewayTransactionId: 'TXN-987654321',
    status: 'completed',
    paidAt: '2026-03-20T10:00:00Z',
    paidBy: 'Saraswati Sharma',
    receiptNumber: 'RCT-2026-001234',
    metadata: {},
    refunds: [],
    gsi1pk: '',
    gsi1sk: '',
    gsi2pk: '',
    gsi2sk: '',
    createdAt: '2026-03-20T10:00:00Z',
    createdBy: 'admin',
    updatedAt: '2026-03-20T10:00:00Z',
    updatedBy: 'admin',
    version: 1,
    ...overrides,
  } as PaymentEntity;
}

function fixtureInvoice(): InvoiceEntity {
  return {
    tenantId: TENANT_ID,
    entityKey: `INVOICE#${SCHOOL_ID}#${INVOICE_ID}`,
    entityType: 'INVOICE',
    invoiceId: INVOICE_ID,
    invoiceNumber: 'INV-2026-001234',
    studentAccountId: 'sa-uuid',
    studentId: 'student-uuid',
    studentName: 'Saraswati Sharma',
    schoolId: SCHOOL_ID,
    schoolName: 'Saraswati School',
    academicYear: '2025-2026',
    lineItems: [],
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
    gsi1pk: '',
    gsi1sk: '',
    gsi2pk: '',
    gsi2sk: '',
    gsi3pk: '',
    gsi3sk: '',
    createdAt: '2026-03-15T00:00:00Z',
    createdBy: 'admin',
    updatedAt: '2026-03-20T10:00:00Z',
    updatedBy: 'admin',
    version: 2,
  };
}

function pabsonReceiptTemplateConfig(): Record<string, unknown> {
  return {
    pageSize: 'A4',
    orientation: 'portrait',
    margins: { top: 15, right: 15, bottom: 15, left: 15 },
    header: { showLogo: true, showSchoolName: true, showSchoolAddress: true, showContact: true },
    footer: { showPageNumbers: true, showSignatureLine: false, showThankYou: true },
    dateFormat: 'dual',
    numberFormat: 'south-asian',
    currencyDisplay: 'iso-code',
    labelLanguages: ['en', 'ne'],
    lineItemColumns: { description: true, amount: true, taxAmount: true, total: true },
    totalsSection: { showSubtotal: true, showTaxTotal: true, showDiscountTotal: true },
    paymentDetails: { showPaymentMethod: true, showTransactionId: true, showPaidBy: true },
    taxBreakdownSection: { showPanNumber: true, showVatNumber: true },
  };
}

describe('PaymentsService.getReceiptPdf (Sprint C.1.6)', () => {
  let service: PaymentsService;
  let dynamoDBClient: any;
  let invoicesService: any;
  let identityClient: any;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    dynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({}),
      getItem: jest.fn(),
    };
    invoicesService = {
      getEntity: jest.fn().mockResolvedValue(fixtureInvoice()),
    };
    identityClient = {
      getBranding: jest.fn().mockResolvedValue({ branding: null, urls: undefined }),
      getCurrentTemplate: jest.fn().mockResolvedValue({
        docType: 'RECEIPT',
        templateConfig: pabsonReceiptTemplateConfig(),
        source: 'persisted',
        templateId: 'tmpl-receipt-1',
        configVersion: 2,
      }),
      getStudentInfo: jest.fn().mockResolvedValue({
        studentId: 'student-uuid',
        firstName: 'Saraswati',
        lastName: 'Sharma',
        gradeLevel: '8',
        studentNumber: 'STU-2026-0042',
        emisStudentId: '1708400128200043',
      }),
      getUserDisplayName: jest.fn().mockResolvedValue('Ramesh Adhikari'),
    };

    service = new PaymentsService(
      dynamoDBClient,
      {} as any, // eventsService
      {} as any, // sequenceService
      invoicesService,
      {} as any, // studentAccountsService
      {} as any, // gatewayRegistry
      {} as any, // gatewayConfigService
      identityClient,

      { optimize: jest.fn(async (u) => u) } as any, // pdfLogoOptimizer (Plan §5d)
    );

    renderReceiptToPdfBuffer.mockReset();
    renderReceiptToPdfBuffer.mockResolvedValue(Buffer.from('%PDF-mock-receipt-bytes'));
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  // ============================================
  // Preconditions — payment must exist + be completed
  // ============================================
  describe('payment status preconditions', () => {
    it('404 when the payment does not exist', async () => {
      dynamoDBClient.getItem.mockResolvedValue(null);

      await expect(
        service.getReceiptPdf(SCHOOL_ID, PAYMENT_ID, ctx),
      ).rejects.toThrow(NotFoundException);

      // Bail out before any downstream fetch
      expect(invoicesService.getEntity).not.toHaveBeenCalled();
      expect(identityClient.getBranding).not.toHaveBeenCalled();
    });

    it('400 when payment status is not "completed" (e.g. "pending")', async () => {
      dynamoDBClient.getItem.mockResolvedValue(fixturePayment({ status: 'pending' }));

      await expect(
        service.getReceiptPdf(SCHOOL_ID, PAYMENT_ID, ctx),
      ).rejects.toThrow(BadRequestException);

      expect(renderReceiptToPdfBuffer).not.toHaveBeenCalled();
    });

    it('400 when payment status is "refunded" (receipts only for completed payments)', async () => {
      dynamoDBClient.getItem.mockResolvedValue(fixturePayment({ status: 'refunded' }));

      await expect(
        service.getReceiptPdf(SCHOOL_ID, PAYMENT_ID, ctx),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ============================================
  // Happy path — parallel fetch + render + audit log
  // ============================================
  describe('happy path orchestration', () => {
    it('fetches invoice + branding + template in parallel, renders, returns buffer', async () => {
      dynamoDBClient.getItem.mockResolvedValue(fixturePayment());

      const buffer = await service.getReceiptPdf(SCHOOL_ID, PAYMENT_ID, ctx);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.toString().startsWith('%PDF-')).toBe(true);

      // Three parallel fetches all called with the right args
      expect(invoicesService.getEntity).toHaveBeenCalledWith(SCHOOL_ID, INVOICE_ID, ctx);
      expect(identityClient.getBranding).toHaveBeenCalledWith(SCHOOL_ID, ctx);
      expect(identityClient.getCurrentTemplate).toHaveBeenCalledWith(
        SCHOOL_ID,
        'RECEIPT',
        ctx,
        { fallbackArchetype: 'PABSON' },
      );
      // Renderer received the full assembly
      expect(renderReceiptToPdfBuffer).toHaveBeenCalledTimes(1);
      const renderArg = renderReceiptToPdfBuffer.mock.calls[0][0];
      expect(renderArg.payment.paymentId).toBe(PAYMENT_ID);
      expect(renderArg.invoice.invoiceId).toBe(INVOICE_ID);
      expect(renderArg.locale).toBe('en-US'); // primary lang 'en'
    });

    it('branding fetch failure → renders with branding=null (does NOT throw)', async () => {
      dynamoDBClient.getItem.mockResolvedValue(fixturePayment());
      identityClient.getBranding.mockRejectedValue(new Error('identity 503'));

      const buffer = await service.getReceiptPdf(SCHOOL_ID, PAYMENT_ID, ctx);

      expect(buffer).toBeInstanceOf(Buffer);
      const renderArg = renderReceiptToPdfBuffer.mock.calls[0][0];
      expect(renderArg.branding).toBeNull();
      expect(renderArg.urls).toBeUndefined();
    });

    it('emits structured pdf_generated log with docType=RECEIPT + sizeBytes + paymentId', async () => {
      dynamoDBClient.getItem.mockResolvedValue(fixturePayment());

      await service.getReceiptPdf(SCHOOL_ID, PAYMENT_ID, ctx);

      const auditLogCall = logSpy.mock.calls.find(([msg]) =>
        typeof msg === 'string' && msg.includes('pdf_generated'),
      );
      expect(auditLogCall).toBeDefined();
      const parsed = JSON.parse(auditLogCall![0] as string);
      expect(parsed.event).toBe('pdf_generated');
      expect(parsed.docType).toBe('RECEIPT');
      expect(parsed.schoolId).toBe(SCHOOL_ID);
      expect(parsed.paymentId).toBe(PAYMENT_ID);
      expect(parsed.invoiceId).toBe(INVOICE_ID);
      expect(parsed.receiptNumber).toBe('RCT-2026-001234');
      expect(parsed.userId).toBe(ctx.userId);
      expect(parsed.tenantId).toBe(TENANT_ID);
      expect(parsed.templateSource).toBe('persisted');
      expect(parsed.sizeBytes).toBe(Buffer.from('%PDF-mock-receipt-bytes').length);
      expect(typeof parsed.durationMs).toBe('number');
      // Sprint 0.1: stage timings are GATED off by default — the audit log
      // shape stays identical to the pre-0.1 line. See the companion
      // "emits stage timings when PDF_TIMING_ENABLED=true" case below.
      expect(parsed.stagePaymentDdbMs).toBeUndefined();
      expect(parsed.stageInvoiceDdbMs).toBeUndefined();
      expect(parsed.stageBrandingMs).toBeUndefined();
      expect(parsed.stageTemplateMs).toBeUndefined();
      expect(parsed.stageFanout1WallMs).toBeUndefined();
      expect(parsed.stageStudentInfoMs).toBeUndefined();
      expect(parsed.stageRecordedByMs).toBeUndefined();
      expect(parsed.stageFanout2WallMs).toBeUndefined();
      expect(parsed.stageRenderMs).toBeUndefined();
    });

    it('emits per-call stage timings on pdf_generated when PDF_TIMING_ENABLED=true (Sprint 0.1)', async () => {
      // Both fan-outs are individually timed: fan-out 1 (invoice DDB +
      // branding + template) and fan-out 2 (studentInfo + recordedBy).
      // Spike needs per-call attribution within each Promise.all, not
      // just the combined wall-clock.
      const prev = process.env.PDF_TIMING_ENABLED;
      process.env.PDF_TIMING_ENABLED = 'true';
      try {
        dynamoDBClient.getItem.mockResolvedValue(fixturePayment());

        await service.getReceiptPdf(SCHOOL_ID, PAYMENT_ID, ctx);

        const auditLogCall = logSpy.mock.calls.find(([msg]) =>
          typeof msg === 'string' && msg.includes('pdf_generated'),
        );
        const parsed = JSON.parse(auditLogCall![0] as string);
        for (const field of [
          'stagePaymentDdbMs',
          'stageInvoiceDdbMs',
          'stageBrandingMs',
          'stageTemplateMs',
          'stageFanout1WallMs',
          'stageStudentInfoMs',
          'stageRecordedByMs',
          'stageFanout2WallMs',
          'stageRenderMs',
        ]) {
          expect(typeof parsed[field]).toBe('number');
          expect(parsed[field]).toBeGreaterThanOrEqual(0);
        }
      } finally {
        if (prev === undefined) delete process.env.PDF_TIMING_ENABLED;
        else process.env.PDF_TIMING_ENABLED = prev;
      }
    });

    it('passes studentNumber + emisStudentId from IdentityClient.getStudentInfo to the renderer; never the studentId UUID', async () => {
      // Governance correctness: the receipt PDF must surface the school
      // roll number (primary) + CEHRD/IEMIS id (secondary), not the
      // internal `studentId` UUID. Mirror of the pdf-renderer e713eda fix
      // at the orchestration boundary.
      dynamoDBClient.getItem.mockResolvedValue(fixturePayment());

      await service.getReceiptPdf(SCHOOL_ID, PAYMENT_ID, ctx);

      expect(identityClient.getStudentInfo).toHaveBeenCalledWith('student-uuid', ctx);
      const renderArg = renderReceiptToPdfBuffer.mock.calls[0][0];
      expect(renderArg.studentNumber).toBe('STU-2026-0042');
      expect(renderArg.emisStudentId).toBe('1708400128200043');
      // Internal UUID must NOT leak as a top-level renderer input — the
      // renderer derives it from `invoice.studentId` only when explicitly
      // needed, and the receipt template no longer renders it.
      expect(renderArg.studentId).toBeUndefined();
    });

    it('paidBy = UUID → resolves to displayName via getUserDisplayName before reaching renderer', async () => {
      // Recorder UUID leak fix: payment.paidBy stores the recording
      // staff user's userId, but the receipt must surface a human name.
      // When paidBy looks like a UUID, the service resolves it via the
      // permissive `/users/:id/display-name` endpoint.
      const recorderUuid = 'a1b2c3d4-1234-5678-9abc-def012345678';
      dynamoDBClient.getItem.mockResolvedValue(fixturePayment({ paidBy: recorderUuid }));

      await service.getReceiptPdf(SCHOOL_ID, PAYMENT_ID, ctx);

      expect(identityClient.getUserDisplayName).toHaveBeenCalledWith(recorderUuid, ctx);
      const renderArg = renderReceiptToPdfBuffer.mock.calls[0][0];
      expect(renderArg.payment.paidBy).toBe('Ramesh Adhikari');
      // The UUID must NOT reach the renderer untouched
      expect(renderArg.payment.paidBy).not.toBe(recorderUuid);
    });

    it('paidBy = UUID + getUserDisplayName returns null → renderer receives studentName fallback', async () => {
      // Deactivated / deleted recorder: lookup returns null, the
      // resolver falls back to studentName (mirrors the renderer's
      // existing null-paidBy fallback at receipt-pdf.renderer.ts:119).
      const recorderUuid = 'a1b2c3d4-1234-5678-9abc-def012345678';
      dynamoDBClient.getItem.mockResolvedValue(fixturePayment({ paidBy: recorderUuid }));
      identityClient.getUserDisplayName.mockResolvedValue(null);

      await service.getReceiptPdf(SCHOOL_ID, PAYMENT_ID, ctx);

      const renderArg = renderReceiptToPdfBuffer.mock.calls[0][0];
      expect(renderArg.payment.paidBy).toBe('Saraswati Sharma'); // = invoice.studentName fixture
    });

    it('paidBy = non-UUID string (legacy free-form) → passes through unchanged, no lookup', async () => {
      dynamoDBClient.getItem.mockResolvedValue(fixturePayment({ paidBy: 'Mr. Cash Receiver' }));

      await service.getReceiptPdf(SCHOOL_ID, PAYMENT_ID, ctx);

      expect(identityClient.getUserDisplayName).not.toHaveBeenCalled();
      const renderArg = renderReceiptToPdfBuffer.mock.calls[0][0];
      expect(renderArg.payment.paidBy).toBe('Mr. Cash Receiver');
    });

    it('identity lookup returning null → renderer receives undefined identifiers (graceful degrade)', async () => {
      // Best-effort lookup: when academics is unreachable the receipt
      // still renders without the student-identifier rows rather than
      // 5xx-ing.
      dynamoDBClient.getItem.mockResolvedValue(fixturePayment());
      identityClient.getStudentInfo.mockResolvedValue(null);

      const buffer = await service.getReceiptPdf(SCHOOL_ID, PAYMENT_ID, ctx);

      expect(buffer).toBeInstanceOf(Buffer);
      const renderArg = renderReceiptToPdfBuffer.mock.calls[0][0];
      expect(renderArg.studentNumber).toBeUndefined();
      expect(renderArg.emisStudentId).toBeUndefined();
    });

    it('caller-supplied fallbackArchetype overrides the PABSON default', async () => {
      dynamoDBClient.getItem.mockResolvedValue(fixturePayment());

      await service.getReceiptPdf(SCHOOL_ID, PAYMENT_ID, ctx, { fallbackArchetype: 'GENERIC' });

      expect(identityClient.getCurrentTemplate).toHaveBeenCalledWith(
        SCHOOL_ID,
        'RECEIPT',
        ctx,
        { fallbackArchetype: 'GENERIC' },
      );
    });

    it('synthesizes receiptNumber in audit log when payment.receiptNumber is null', async () => {
      // Older cash-recorded payments may have null receiptNumber. The audit
      // log should still include a stable identifier (RCP-<8-char-paymentId>).
      dynamoDBClient.getItem.mockResolvedValue(fixturePayment({ receiptNumber: null }));

      await service.getReceiptPdf(SCHOOL_ID, PAYMENT_ID, ctx);

      const auditLogCall = logSpy.mock.calls.find(([msg]) =>
        typeof msg === 'string' && msg.includes('pdf_generated'),
      );
      const parsed = JSON.parse(auditLogCall![0] as string);
      expect(parsed.receiptNumber).toBe(`RCP-${PAYMENT_ID.substring(0, 8)}`);
    });
  });

  // ============================================
  // Locale safety — mirror of C.1.5 invoice path
  // ============================================
  describe('locale derivation safety', () => {
    it('labelLanguages undefined → falls back to en-US', async () => {
      dynamoDBClient.getItem.mockResolvedValue(fixturePayment());
      identityClient.getCurrentTemplate.mockResolvedValue({
        docType: 'RECEIPT',
        templateConfig: { ...pabsonReceiptTemplateConfig(), labelLanguages: undefined },
        source: 'default',
      });

      const buffer = await service.getReceiptPdf(SCHOOL_ID, PAYMENT_ID, ctx);
      expect(buffer).toBeInstanceOf(Buffer);
      const renderArg = renderReceiptToPdfBuffer.mock.calls[0][0];
      expect(renderArg.locale).toBe('en-US');
    });

    it('labelLanguages = ["ne"] → ne-NP', async () => {
      dynamoDBClient.getItem.mockResolvedValue(fixturePayment());
      identityClient.getCurrentTemplate.mockResolvedValue({
        docType: 'RECEIPT',
        templateConfig: { ...pabsonReceiptTemplateConfig(), labelLanguages: ['ne'] },
        source: 'default',
      });

      await service.getReceiptPdf(SCHOOL_ID, PAYMENT_ID, ctx);
      const renderArg = renderReceiptToPdfBuffer.mock.calls[0][0];
      expect(renderArg.locale).toBe('ne-NP');
    });
  });

  // ============================================
  // EPIC-FB FB-0.2 — schoolName resolved at read time
  // ============================================
  describe('FB-0.2 schoolName resolution', () => {
    it('renamed school → renderer receives the CURRENT name, stored snapshot untouched', async () => {
      dynamoDBClient.getItem.mockResolvedValue(fixturePayment());
      identityClient.getSchoolName = jest.fn().mockResolvedValue('Renamed School');

      await service.getReceiptPdf(SCHOOL_ID, PAYMENT_ID, ctx);

      expect(identityClient.getSchoolName).toHaveBeenCalledWith(SCHOOL_ID, ctx);
      const renderArg = renderReceiptToPdfBuffer.mock.calls[0][0];
      expect(renderArg.invoice.schoolName).toBe('Renamed School');
    });

    it('lookup returns null → stored snapshot fallback', async () => {
      dynamoDBClient.getItem.mockResolvedValue(fixturePayment());
      identityClient.getSchoolName = jest.fn().mockResolvedValue(null);

      await service.getReceiptPdf(SCHOOL_ID, PAYMENT_ID, ctx);

      const renderArg = renderReceiptToPdfBuffer.mock.calls[0][0];
      expect(renderArg.invoice.schoolName).toBe('Saraswati School');
    });

    it('lookup throws → stored snapshot fallback (render still succeeds)', async () => {
      dynamoDBClient.getItem.mockResolvedValue(fixturePayment());
      identityClient.getSchoolName = jest.fn().mockRejectedValue(new Error('identity 503'));

      const buffer = await service.getReceiptPdf(SCHOOL_ID, PAYMENT_ID, ctx);

      expect(buffer).toBeInstanceOf(Buffer);
      const renderArg = renderReceiptToPdfBuffer.mock.calls[0][0];
      expect(renderArg.invoice.schoolName).toBe('Saraswati School');
    });
  });
});

// ============================================
// EPIC-FB FB-4.5 — multi-target family payment PDF orchestration
// ============================================
describe('PaymentsService.getReceiptPdf — multi-target (FB-4.5)', () => {
  const INVOICE_2 = 'invoice-2-uuid';

  function multiPayment(): PaymentEntity {
    return fixturePayment({
      invoiceId: null,
      studentAccountId: null,
      studentId: null,
      familyId: 'family-uuid',
      amount: 2500,
      applications: [
        { targetType: 'invoice', invoiceId: INVOICE_ID, amount: 1000 },
        { targetType: 'invoice', invoiceId: INVOICE_2, amount: 1500 },
      ],
      applicationInvoiceIds: [INVOICE_ID, INVOICE_2],
      gsi2pk: undefined,
      gsi2sk: undefined,
    } as Partial<PaymentEntity>);
  }

  function secondInvoice(): InvoiceEntity {
    return {
      ...fixtureInvoice(),
      entityKey: `INVOICE#${SCHOOL_ID}#${INVOICE_2}`,
      invoiceId: INVOICE_2,
      invoiceNumber: 'INV-2026-005678',
      studentId: 'student-2-uuid',
      studentName: 'Bikash Sharma',
    };
  }

  let service: PaymentsService;
  let dynamoDBClient: any;
  let invoicesService: any;
  let identityClient: any;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    dynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({}),
      getItem: jest.fn().mockResolvedValue(multiPayment()),
      batchGetItems: jest.fn().mockResolvedValue([fixtureInvoice(), secondInvoice()]),
    };
    invoicesService = { getEntity: jest.fn() };
    identityClient = {
      getBranding: jest.fn().mockResolvedValue({ branding: null, urls: undefined }),
      getCurrentTemplate: jest.fn().mockResolvedValue({
        docType: 'RECEIPT',
        templateConfig: pabsonReceiptTemplateConfig(),
        source: 'persisted',
        templateId: 'tmpl-receipt-1',
        configVersion: 2,
      }),
      getStudentInfo: jest.fn(),
      getUserDisplayName: jest.fn().mockResolvedValue('Ramesh Adhikari'),
      getSchoolName: jest.fn().mockResolvedValue(null),
    };
    service = new PaymentsService(
      dynamoDBClient,
      {} as any,
      {} as any,
      invoicesService,
      {} as any,
      {} as any,
      {} as any,
      identityClient,
      { optimize: jest.fn(async (u) => u) } as any,
    );
    renderReceiptToPdfBuffer.mockReset();
    renderReceiptToPdfBuffer.mockResolvedValue(Buffer.from('%PDF-mock-receipt-bytes'));
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('loads ALL target invoices via ONE BatchGetItems (no per-target getEntity), first target supplies context', async () => {
    await service.getReceiptPdf(SCHOOL_ID, PAYMENT_ID, ctx);

    expect(dynamoDBClient.batchGetItems).toHaveBeenCalledTimes(1);
    const keys = dynamoDBClient.batchGetItems.mock.calls[0][1];
    expect(keys.map((k: any) => k.entityKey)).toEqual([
      `INVOICE#${SCHOOL_ID}#${INVOICE_ID}`,
      `INVOICE#${SCHOOL_ID}#${INVOICE_2}`,
    ]);
    expect(invoicesService.getEntity).not.toHaveBeenCalled();

    const renderArg = renderReceiptToPdfBuffer.mock.calls[0][0];
    expect(renderArg.invoice.invoiceId).toBe(INVOICE_ID);
    expect(renderArg.multiTargetBreakdown).toEqual([
      { invoiceId: INVOICE_ID, invoiceNumber: 'INV-2026-001234', studentName: 'Saraswati Sharma', amount: 1000 },
      { invoiceId: INVOICE_2, invoiceNumber: 'INV-2026-005678', studentName: 'Bikash Sharma', amount: 1500 },
    ]);
  });

  it('skips the single-student roll-number lookup (no single student on a family payment)', async () => {
    await service.getReceiptPdf(SCHOOL_ID, PAYMENT_ID, ctx);
    expect(identityClient.getStudentInfo).not.toHaveBeenCalled();
    const renderArg = renderReceiptToPdfBuffer.mock.calls[0][0];
    expect(renderArg.studentNumber).toBeUndefined();
    expect(renderArg.emisStudentId).toBeUndefined();
  });

  it('404s when a target invoice row has vanished (integrity: payment references it)', async () => {
    dynamoDBClient.batchGetItems.mockResolvedValue([fixtureInvoice()]); // second target missing
    await expect(service.getReceiptPdf(SCHOOL_ID, PAYMENT_ID, ctx)).rejects.toThrow(NotFoundException);
    expect(renderReceiptToPdfBuffer).not.toHaveBeenCalled();
  });
});
