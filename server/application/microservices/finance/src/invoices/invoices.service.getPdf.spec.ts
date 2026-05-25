/**
 * `InvoicesService.getPdf` orchestration spec — Sprint C.1.5.
 *
 * The renderer projection logic itself is tested in `invoice-pdf.renderer.spec.ts`
 * (real `renderToBuffer` invocation). This file mocks `renderInvoiceToPdfBuffer`
 * and verifies the **orchestration**:
 *   - Invoice fetched via `getEntity`
 *   - Branding + template fetched in parallel from `IdentityClient`
 *   - Branding fetch failure is caught + logged (does NOT throw)
 *   - Template config + `fallbackArchetype: 'PABSON'` reach the
 *     IdentityClient.getCurrentTemplate call
 *   - Structured `pdf_generated` log emitted
 *
 * Renderer mock is set up via `jest.mock('./invoice-pdf.renderer')` so
 * we don't pay the ~500ms-per-call cost of real `renderToBuffer` here.
 */

import { Logger } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import type { InvoiceEntity } from '../common/entities/invoice.entity';

// Module-level mock — the renderer projection is covered by its own spec.
jest.mock('./invoice-pdf.renderer', () => ({
  renderInvoiceToPdfBuffer: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { renderInvoiceToPdfBuffer } = require('./invoice-pdf.renderer') as {
  renderInvoiceToPdfBuffer: jest.Mock;
};

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

function fixtureInvoice(): InvoiceEntity {
  return {
    tenantId: TENANT_ID,
    entityKey: `INVOICE#${SCHOOL_ID}#${INVOICE_ID}`,
    entityType: 'INVOICE',
    invoiceId: INVOICE_ID,
    invoiceNumber: 'INV-2026-0001',
    studentAccountId: 'sa',
    studentId: 'student-uuid',
    studentName: 'Test Student',
    schoolId: SCHOOL_ID,
    schoolName: 'Test School',
    academicYear: '2025-2026',
    lineItems: [],
    subtotal: 1000,
    taxTotal: 0,
    discountTotal: 0,
    grandTotal: 1000,
    amountPaid: 0,
    amountDue: 1000,
    currency: 'NPR',
    dueDate: '2026-04-28',
    issuedDate: '2026-03-15',
    status: 'issued',
    gsi1pk: '',
    gsi1sk: '',
    gsi2pk: '',
    gsi2sk: '',
    gsi3pk: '',
    gsi3sk: '',
    createdAt: '2026-03-15T00:00:00Z',
    createdBy: 'admin',
    updatedAt: '2026-03-15T00:00:00Z',
    updatedBy: 'admin',
    version: 1,
  };
}

function pabsonTemplateConfig(): Record<string, unknown> {
  return {
    pageSize: 'A4',
    orientation: 'portrait',
    margins: { top: 15, right: 15, bottom: 15, left: 15 },
    header: { showLogo: true, showSchoolName: true, showSchoolAddress: true, showContact: true },
    footer: { showPageNumbers: true, showSignatureLine: true },
    dateFormat: 'dual',
    numberFormat: 'south-asian',
    currencyDisplay: 'iso-code',
    labelLanguages: ['en', 'ne'],
    lineItemColumns: {
      description: true, quantity: true, amount: true, discount: true,
      taxRate: true, taxAmount: true, total: true,
    },
    totalsSection: {
      showSubtotal: true, showTaxTotal: true, showDiscountTotal: true,
      showAmountPaid: true, showAmountDue: true,
    },
  };
}

describe('InvoicesService.getPdf (Sprint C.1.5)', () => {
  let service: InvoicesService;
  let dynamoDBClient: any;
  let identityClient: any;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    dynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({}),
      getItem: jest.fn(),
    };
    identityClient = {
      getBranding: jest.fn(),
      getCurrentTemplate: jest.fn(),
    };

    service = new InvoicesService(
      dynamoDBClient,
      {} as any, // eventsService
      identityClient,
      {} as any, // tenantSettings
      {} as any, // sequenceService
      {} as any, // feeStructuresService
      {} as any, // studentAccountsService
    );

    renderInvoiceToPdfBuffer.mockReset();
    renderInvoiceToPdfBuffer.mockResolvedValue(Buffer.from('%PDF-mock-bytes'));

    // Spy on the service's Logger so we can assert the structured log
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('happy path — fetches invoice + branding + template in parallel, renders, returns buffer', async () => {
    dynamoDBClient.getItem.mockResolvedValue(fixtureInvoice());
    identityClient.getBranding.mockResolvedValue({
      branding: { panNumber: '301234567', vatNumber: '700123456' },
      urls: { logo: 'https://s3/signed/logo.png' },
    });
    identityClient.getCurrentTemplate.mockResolvedValue({
      docType: 'INVOICE',
      templateConfig: pabsonTemplateConfig(),
      source: 'persisted',
      templateId: 'tmpl-xyz',
      configVersion: 3,
    });

    const buffer = await service.getPdf(SCHOOL_ID, INVOICE_ID, ctx);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.toString().startsWith('%PDF-')).toBe(true);

    expect(identityClient.getBranding).toHaveBeenCalledWith(SCHOOL_ID, ctx);
    expect(identityClient.getCurrentTemplate).toHaveBeenCalledWith(
      SCHOOL_ID,
      'INVOICE',
      ctx,
      { fallbackArchetype: 'PABSON' },
    );
    expect(renderInvoiceToPdfBuffer).toHaveBeenCalledTimes(1);
    const renderArg = renderInvoiceToPdfBuffer.mock.calls[0][0];
    expect(renderArg.invoice.invoiceId).toBe(INVOICE_ID);
    expect(renderArg.branding).toEqual({ panNumber: '301234567', vatNumber: '700123456' });
    expect(renderArg.urls).toEqual({ logo: 'https://s3/signed/logo.png' });
    expect(renderArg.locale).toBe('en-US'); // primary lang 'en' → en-US
  });

  it('branding fetch failure → renders with branding=null (does NOT throw)', async () => {
    dynamoDBClient.getItem.mockResolvedValue(fixtureInvoice());
    identityClient.getBranding.mockRejectedValue(new Error('identity 503'));
    identityClient.getCurrentTemplate.mockResolvedValue({
      docType: 'INVOICE',
      templateConfig: pabsonTemplateConfig(),
      source: 'default',
    });

    const buffer = await service.getPdf(SCHOOL_ID, INVOICE_ID, ctx);

    expect(buffer).toBeInstanceOf(Buffer);
    const renderArg = renderInvoiceToPdfBuffer.mock.calls[0][0];
    expect(renderArg.branding).toBeNull();
    expect(renderArg.urls).toBeUndefined();
  });

  it('emits structured pdf_generated log with sizeBytes + templateSource', async () => {
    dynamoDBClient.getItem.mockResolvedValue(fixtureInvoice());
    identityClient.getBranding.mockResolvedValue({ branding: null, urls: undefined });
    identityClient.getCurrentTemplate.mockResolvedValue({
      docType: 'INVOICE',
      templateConfig: pabsonTemplateConfig(),
      source: 'default',
    });

    await service.getPdf(SCHOOL_ID, INVOICE_ID, ctx);

    // The audit log line is JSON-stringified; find the one that contains
    // 'pdf_generated' and parse it.
    const auditLogCall = logSpy.mock.calls.find(([msg]) =>
      typeof msg === 'string' && msg.includes('pdf_generated'),
    );
    expect(auditLogCall).toBeDefined();
    const parsed = JSON.parse(auditLogCall![0] as string);
    expect(parsed.event).toBe('pdf_generated');
    expect(parsed.docType).toBe('INVOICE');
    expect(parsed.schoolId).toBe(SCHOOL_ID);
    expect(parsed.invoiceId).toBe(INVOICE_ID);
    expect(parsed.invoiceNumber).toBe('INV-2026-0001');
    expect(parsed.userId).toBe(ctx.userId);
    expect(parsed.tenantId).toBe(TENANT_ID);
    expect(parsed.templateSource).toBe('default');
    expect(parsed.sizeBytes).toBe(Buffer.from('%PDF-mock-bytes').length);
    expect(typeof parsed.durationMs).toBe('number');
  });

  it('caller-supplied fallbackArchetype overrides the PABSON default', async () => {
    dynamoDBClient.getItem.mockResolvedValue(fixtureInvoice());
    identityClient.getBranding.mockResolvedValue({ branding: null, urls: undefined });
    identityClient.getCurrentTemplate.mockResolvedValue({
      docType: 'INVOICE',
      templateConfig: pabsonTemplateConfig(),
      source: 'default',
    });

    await service.getPdf(SCHOOL_ID, INVOICE_ID, ctx, { fallbackArchetype: 'GENERIC' });

    expect(identityClient.getCurrentTemplate).toHaveBeenCalledWith(
      SCHOOL_ID,
      'INVOICE',
      ctx,
      { fallbackArchetype: 'GENERIC' },
    );
  });

  it('locale derives from template.labelLanguages[0] — Nepali-only → ne-NP', async () => {
    dynamoDBClient.getItem.mockResolvedValue(fixtureInvoice());
    identityClient.getBranding.mockResolvedValue({ branding: null, urls: undefined });
    identityClient.getCurrentTemplate.mockResolvedValue({
      docType: 'INVOICE',
      templateConfig: { ...pabsonTemplateConfig(), labelLanguages: ['ne'] },
      source: 'default',
    });

    await service.getPdf(SCHOOL_ID, INVOICE_ID, ctx);

    const renderArg = renderInvoiceToPdfBuffer.mock.calls[0][0];
    expect(renderArg.locale).toBe('ne-NP');
  });
});
