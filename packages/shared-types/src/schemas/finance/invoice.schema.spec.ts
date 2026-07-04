/**
 * invoiceResponseSchema — gradeLevel + gradeLevelResolutionStatus
 *
 * Sprint A.1 Codex round-2: pins the shared contract that both
 * snapshot fields are valid optional fields on the Invoice DTO.
 * Other services that consume `Invoice` (AdminWeb, edforge-saas-
 * frontend's finance MFE) can deserialize new + old shapes
 * compatibly.
 */

import {
  invoiceResponseSchema,
  Invoice,
  bulkGenerateInvoiceSchema,
} from './invoice.schema';

const VALID_BASE: Record<string, unknown> = {
  id: '11111111-1111-4111-8111-111111111111',
  invoiceNumber: 'INV-2026-0001',
  studentAccountId: '22222222-2222-4222-8222-222222222222',
  schoolId: '33333333-3333-4333-8333-333333333333',
  schoolName: 'Test School',
  studentId: '44444444-4444-4444-8444-444444444444',
  studentName: 'Test Student',
  academicYear: '2025-2026',
  lineItems: [],
  subtotal: 1000,
  taxTotal: 0,
  discountTotal: 0,
  grandTotal: 1000,
  amountPaid: 0,
  amountDue: 1000,
  currency: 'NPR',
  dueDate: '2026-08-15',
  issuedDate: '2026-07-15',
  status: 'issued',
  createdAt: '2026-07-15T00:00:00Z',
  updatedAt: '2026-07-15T00:00:00Z',
};

describe('invoiceResponseSchema — Sprint A.1 grade snapshot fields', () => {
  it('accepts gradeLevel + gradeLevelResolutionStatus when both are set (post-A.1 resolved row)', () => {
    const parsed: Invoice = invoiceResponseSchema.parse({
      ...VALID_BASE,
      gradeLevel: '4',
      gradeLevelResolutionStatus: 'resolved',
    });
    expect(parsed.gradeLevel).toBe('4');
    expect(parsed.gradeLevelResolutionStatus).toBe('resolved');
  });

  it('accepts gradeLevelResolutionStatus=unresolved with gradeLevel undefined (sparse "Unknown" row)', () => {
    const parsed = invoiceResponseSchema.parse({
      ...VALID_BASE,
      gradeLevelResolutionStatus: 'unresolved',
    });
    expect(parsed.gradeLevel).toBeUndefined();
    expect(parsed.gradeLevelResolutionStatus).toBe('unresolved');
  });

  it('accepts both fields absent (back-compat with pre-A.1 rows before backfill)', () => {
    const parsed = invoiceResponseSchema.parse(VALID_BASE);
    expect(parsed.gradeLevel).toBeUndefined();
    expect(parsed.gradeLevelResolutionStatus).toBeUndefined();
  });

  it('rejects an unknown gradeLevelResolutionStatus value (closed enum)', () => {
    expect(() =>
      invoiceResponseSchema.parse({
        ...VALID_BASE,
        gradeLevelResolutionStatus: 'pending', // not in the enum
      }),
    ).toThrow();
  });

  it('Sprint C Phase 1 — invoiceLineItemSchema accepts isCustom flag', () => {
    const parsed = invoiceResponseSchema.parse({
      ...VALID_BASE,
      lineItems: [
        {
          id: '55555555-5555-4555-8555-555555555555',
          feeStructureId: '66666666-6666-4666-8666-666666666666',
          description: 'Annual picnic — voluntary',
          amount: 500,
          quantity: 1,
          discount: 0,
          taxRate: 0,
          taxAmount: 0,
          total: 500,
          isCustom: true,
        },
      ],
    });
    expect(parsed.lineItems[0].isCustom).toBe(true);
  });
});

describe('bulkGenerateInvoiceSchema — Sprint C Phase 1 refactor + new optional fields', () => {
  const BULK_BASE = {
    academicYear: '2025-2026',
    feeStructureIds: ['77777777-7777-4777-8777-777777777777'],
    dueDate: '2026-08-15',
  };
  const STUDENT_ID = '88888888-8888-4888-8888-888888888888';

  it("accepts selectionMode='students' with studentIds[]", () => {
    const parsed = bulkGenerateInvoiceSchema.parse({
      ...BULK_BASE,
      selectionMode: 'students',
      studentIds: [STUDENT_ID],
    });
    expect(parsed.selectionMode).toBe('students');
  });

  it("accepts selectionMode='grades' with gradeLevels[]", () => {
    const parsed = bulkGenerateInvoiceSchema.parse({
      ...BULK_BASE,
      selectionMode: 'grades',
      gradeLevels: ['4', '5'],
    });
    expect(parsed.selectionMode).toBe('grades');
  });

  it('accepts legacy flat shape (no selectionMode, studentIds[] required)', () => {
    const parsed = bulkGenerateInvoiceSchema.parse({
      ...BULK_BASE,
      studentIds: [STUDENT_ID],
    });
    expect(parsed.studentIds).toEqual([STUDENT_ID]);
    expect(parsed.selectionMode).toBeUndefined();
  });

  it("rejects selectionMode='grades' with empty/missing gradeLevels (refine)", () => {
    expect(() =>
      bulkGenerateInvoiceSchema.parse({
        ...BULK_BASE,
        selectionMode: 'grades',
        gradeLevels: [],
      }),
    ).toThrow();
    expect(() =>
      bulkGenerateInvoiceSchema.parse({
        ...BULK_BASE,
        selectionMode: 'grades',
      }),
    ).toThrow();
  });

  it("rejects selectionMode='students' with empty studentIds (refine)", () => {
    expect(() =>
      bulkGenerateInvoiceSchema.parse({
        ...BULK_BASE,
        selectionMode: 'students',
        studentIds: [],
      }),
    ).toThrow();
  });

  it('accepts customLineItems[] (≤10), each with name+amount≥0', () => {
    const parsed = bulkGenerateInvoiceSchema.parse({
      ...BULK_BASE,
      studentIds: [STUDENT_ID],
      customLineItems: [
        { name: 'Annual picnic', amount: 500 },
        { name: 'Lab refurb', amount: 0 }, // amount 0 valid (operator surfaces it; service may filter via skipZeroTotal)
      ],
    });
    expect(parsed.customLineItems).toHaveLength(2);
  });

  it('rejects customLineItems with >10 entries (cap)', () => {
    expect(() =>
      bulkGenerateInvoiceSchema.parse({
        ...BULK_BASE,
        studentIds: [STUDENT_ID],
        customLineItems: Array.from({ length: 11 }, (_, i) => ({
          name: `item-${i}`,
          amount: 1,
        })),
      }),
    ).toThrow();
  });

  it('rejects customLineItems with negative amount', () => {
    expect(() =>
      bulkGenerateInvoiceSchema.parse({
        ...BULK_BASE,
        studentIds: [STUDENT_ID],
        customLineItems: [{ name: 'oops', amount: -50 }],
      }),
    ).toThrow();
  });

  it('accepts skipZeroTotal flag', () => {
    const parsed = bulkGenerateInvoiceSchema.parse({
      ...BULK_BASE,
      studentIds: [STUDENT_ID],
      skipZeroTotal: true,
    });
    expect(parsed.skipZeroTotal).toBe(true);
  });
});

describe('invoiceResponseSchema — EPIC-FB agreement provenance + derived isOverdue (FB-0.1/FB-3.2/FB-5.2)', () => {
  /**
   * Back-compat contract: a REAL pre-EPIC-FB invoice captured live from the
   * dev tenant (2026-07-04, GET …/invoices/{id}) must parse byte-identically
   * after the additive schema change. Do not "clean up" this fixture — its
   * exact shape is the regression.
   */
  const LIVE_PRE_FB_INVOICE = {
    id: 'c3fbc27c-5289-4efe-a6d2-061d02c5ec09',
    invoiceNumber: 'INV-420-2605-0585',
    studentAccountId: '919ebb1d-5b1e-426b-8baf-e397105e2da1',
    studentId: '80095d95-3ecf-44c7-bddb-2d9f1876357a',
    studentName: 'Aastha Uraw',
    schoolId: '4209e3d8-d2e2-4e0e-9961-790341c264f4',
    schoolName: 'Espresso English Academy',
    academicYear: 'S1Test-2026-05-',
    lineItems: [
      {
        id: '077bed01-5631-4360-a5c8-814e703c926a',
        feeStructureId: 'eec6260c-613a-4be4-9d4d-a637af50a267',
        feeStructureVersion: 1,
        description: 'Grade 1 Annual School Fee',
        amount: 3000,
        quantity: 1,
        discount: 0,
        taxRate: 0,
        taxType: 'none',
        taxAmount: 0,
        total: 3000,
      },
    ],
    subtotal: 8900,
    taxTotal: 0,
    discountTotal: 0,
    grandTotal: 8900,
    amountPaid: 8900,
    amountDue: 0,
    currency: 'NPR',
    dueDate: '2026-05-24',
    issuedDate: '2026-05-24',
    status: 'paid',
    taxSummary: [{ taxableAmount: 8900, taxRate: 0, taxAmount: 0, taxType: 'none' }],
    gradeLevel: '2',
    gradeLevelResolutionStatus: 'resolved',
    createdAt: '2026-05-24T09:22:34.556Z',
    updatedAt: '2026-06-11T16:04:48.056Z',
  };

  const AGREEMENT_ID = '99999999-9999-4999-8999-999999999999';

  it('back-compat: the live pre-change invoice parses UNCHANGED (no new field required, no value mutated)', () => {
    const parsed = invoiceResponseSchema.parse(LIVE_PRE_FB_INVOICE);
    expect(parsed).toEqual(LIVE_PRE_FB_INVOICE);
    expect(parsed.feeOverrideMode).toBeUndefined();
    expect(parsed.agreementId).toBeUndefined();
    expect(parsed.agreementVersion).toBeUndefined();
    expect(parsed.isOverdue).toBeUndefined();
  });

  it('accepts header-level agreement provenance (feeOverrideMode + agreementId + agreementVersion)', () => {
    const parsed = invoiceResponseSchema.parse({
      ...VALID_BASE,
      feeOverrideMode: 'agreement',
      agreementId: AGREEMENT_ID,
      agreementVersion: 2,
    });
    expect(parsed.feeOverrideMode).toBe('agreement');
    expect(parsed.agreementId).toBe(AGREEMENT_ID);
    expect(parsed.agreementVersion).toBe(2);
  });

  it("accepts feeOverrideMode 'catalog' and rejects unknown modes (closed enum)", () => {
    expect(
      invoiceResponseSchema.safeParse({ ...VALID_BASE, feeOverrideMode: 'catalog' }).success,
    ).toBe(true);
    expect(
      invoiceResponseSchema.safeParse({ ...VALID_BASE, feeOverrideMode: 'override' }).success,
    ).toBe(false);
  });

  it('accepts line-level provenance: agreementId/agreementVersion + suppressedFeeStructureIds + discountRuleId', () => {
    const parsed = invoiceResponseSchema.parse({
      ...VALID_BASE,
      lineItems: [
        {
          id: '55555555-5555-4555-8555-555555555555',
          feeStructureId: '66666666-6666-4666-8666-666666666666',
          description: 'Adhikari family deal (family agreement)',
          amount: 25000,
          quantity: 1,
          discount: 0,
          taxRate: 0,
          taxAmount: 0,
          total: 25000,
          agreementId: AGREEMENT_ID,
          agreementVersion: 1,
          suppressedFeeStructureIds: [
            '77777777-7777-4777-8777-777777777777',
            '88888888-8888-4888-8888-888888888888',
          ],
        },
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          feeStructureId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          description: 'Sibling discount (2+ siblings)',
          amount: 0,
          quantity: 1,
          discount: 500,
          taxRate: 0,
          taxAmount: 0,
          total: -500,
          discountRuleId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        },
      ],
    });
    expect(parsed.lineItems[0].agreementId).toBe(AGREEMENT_ID);
    expect(parsed.lineItems[0].suppressedFeeStructureIds).toHaveLength(2);
    expect(parsed.lineItems[1].discountRuleId).toBe('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  });

  it('rejects malformed provenance values (non-uuid agreementId, non-int agreementVersion)', () => {
    expect(
      invoiceResponseSchema.safeParse({ ...VALID_BASE, agreementId: 'not-a-uuid' }).success,
    ).toBe(false);
    expect(
      invoiceResponseSchema.safeParse({ ...VALID_BASE, agreementVersion: 1.5 }).success,
    ).toBe(false);
  });

  it('accepts the derived isOverdue flag both ways (FB-0.1 read-side, never stored)', () => {
    expect(
      invoiceResponseSchema.parse({ ...VALID_BASE, status: 'partially_paid', isOverdue: true })
        .isOverdue,
    ).toBe(true);
    expect(invoiceResponseSchema.parse({ ...VALID_BASE, isOverdue: false }).isOverdue).toBe(false);
    expect(
      invoiceResponseSchema.safeParse({ ...VALID_BASE, isOverdue: 'yes' }).success,
    ).toBe(false);
  });
});
