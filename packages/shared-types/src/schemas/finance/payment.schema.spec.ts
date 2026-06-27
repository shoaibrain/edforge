/**
 * paymentResponseSchema — gradeLevel + gradeLevelResolutionStatus
 *
 * Sprint A.2 Codex round-2: closes the contract-completeness gap.
 * Pre-fix the Payment DTO had NO grade-snapshot fields at all,
 * despite A.2 plan-acceptance saying "Mapper passes through."
 */

import { paymentResponseSchema, Payment } from './payment.schema';

const VALID_BASE: Record<string, unknown> = {
  id: '11111111-1111-4111-8111-111111111111',
  invoiceId: '22222222-2222-4222-8222-222222222222',
  studentAccountId: '33333333-3333-4333-8333-333333333333',
  schoolId: '44444444-4444-4444-8444-444444444444',
  amount: 1000,
  currency: 'NPR',
  gateway: 'cash',
  status: 'completed',
  paidAt: '2026-07-15T10:00:00Z',
  paidBy: 'operator-1',
  receiptNumber: 'RCP-2026-0001',
  metadata: {},
  refunds: [],
  createdAt: '2026-07-15T10:00:00Z',
  updatedAt: '2026-07-15T10:00:00Z',
};

describe('paymentResponseSchema — Sprint A.2 grade snapshot fields', () => {
  it('accepts gradeLevel + gradeLevelResolutionStatus when both are set (post-A.2 resolved row)', () => {
    const parsed: Payment = paymentResponseSchema.parse({
      ...VALID_BASE,
      gradeLevel: '4',
      gradeLevelResolutionStatus: 'resolved',
    });
    expect(parsed.gradeLevel).toBe('4');
    expect(parsed.gradeLevelResolutionStatus).toBe('resolved');
  });

  it('accepts gradeLevelResolutionStatus=unresolved with gradeLevel undefined (parent invoice was unresolved)', () => {
    const parsed = paymentResponseSchema.parse({
      ...VALID_BASE,
      gradeLevelResolutionStatus: 'unresolved',
    });
    expect(parsed.gradeLevel).toBeUndefined();
    expect(parsed.gradeLevelResolutionStatus).toBe('unresolved');
  });

  it('accepts both fields absent (back-compat with pre-A.2 rows before backfill)', () => {
    const parsed = paymentResponseSchema.parse(VALID_BASE);
    expect(parsed.gradeLevel).toBeUndefined();
    expect(parsed.gradeLevelResolutionStatus).toBeUndefined();
  });

  it('rejects an unknown gradeLevelResolutionStatus value (closed enum)', () => {
    expect(() =>
      paymentResponseSchema.parse({
        ...VALID_BASE,
        gradeLevelResolutionStatus: 'maybe',
      }),
    ).toThrow();
  });
});
