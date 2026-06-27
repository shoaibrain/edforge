/**
 * invoiceResponseSchema — gradeLevel + gradeLevelResolutionStatus
 *
 * Sprint A.1 Codex round-2: pins the shared contract that both
 * snapshot fields are valid optional fields on the Invoice DTO.
 * Other services that consume `Invoice` (AdminWeb, edforge-saas-
 * frontend's finance MFE) can deserialize new + old shapes
 * compatibly.
 */

import { invoiceResponseSchema, Invoice } from './invoice.schema';

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
});
