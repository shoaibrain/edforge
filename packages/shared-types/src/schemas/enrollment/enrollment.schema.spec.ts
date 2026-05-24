/**
 * Enrollment Schema Spec — Sprint D.2 additions
 *
 * Narrow coverage of D.2-introduced shape changes only (the bulk of the
 * enrollment schema predates this spec — adding wider coverage is out of
 * scope for D.2 and tracked separately).
 *
 * Coverage:
 *   - enrollmentStatusSchema: provisional status accepted, invalid still rejected
 *   - enrollmentResponseSchema: priorEnrollmentId + promotionDecision optional round-trip
 */

import { describe, expect, it } from '@jest/globals';
import {
  enrollmentStatusSchema,
  enrollmentResponseSchema,
} from './enrollment.schema';

const VALID_RESPONSE_BASE = {
  enrollmentId: '11111111-1111-1111-1111-111111111111',
  studentId: '22222222-2222-2222-2222-222222222222',
  schoolId: '33333333-3333-3333-3333-333333333333',
  tenantId: '44444444-4444-4444-4444-444444444444',
  academicYearId: '55555555-5555-5555-5555-555555555555',
  gradeLevel: '7',
  enrollmentType: 'new' as const,
  status: 'enrolled' as const,
  enrollmentDate: '2026-04-15',
  createdAt: '2026-04-15T10:00:00.000Z',
  updatedAt: '2026-04-15T10:00:00.000Z',
};

// ============================================
// enrollmentStatusSchema — D.2.8 extension
// ============================================

describe('enrollmentStatusSchema (D.2.8 provisional)', () => {
  it('accepts provisional status', () => {
    expect(enrollmentStatusSchema.parse('provisional')).toBe('provisional');
  });

  it.each(['enrolled', 'active', 'pending', 'withdrawn', 'graduated', 'transferred', 'suspended', 'expelled', 'completed'] as const)(
    'still accepts pre-D.2 status %s',
    (status) => {
      expect(enrollmentStatusSchema.parse(status)).toBe(status);
    },
  );

  it('rejects unknown status', () => {
    expect(() => enrollmentStatusSchema.parse('frozen')).toThrow();
  });
});

// ============================================
// enrollmentResponseSchema — D.2.7 fields
// ============================================

describe('enrollmentResponseSchema (D.2.7 priorEnrollmentId + promotionDecision)', () => {
  it('accepts response without D.2 fields (AY1 original enrollment)', () => {
    const parsed = enrollmentResponseSchema.parse(VALID_RESPONSE_BASE);
    expect(parsed.priorEnrollmentId).toBeUndefined();
    expect(parsed.promotionDecision).toBeUndefined();
  });

  it('accepts AY2 provisional enrollment shape (priorEnrollmentId set, no promotionDecision yet)', () => {
    const provisional = {
      ...VALID_RESPONSE_BASE,
      status: 'provisional' as const,
      priorEnrollmentId: '66666666-6666-6666-6666-666666666666',
    };
    const parsed = enrollmentResponseSchema.parse(provisional);
    expect(parsed.priorEnrollmentId).toBe('66666666-6666-6666-6666-666666666666');
    expect(parsed.status).toBe('provisional');
  });

  it('accepts AY1 post-commit enrollment shape (promotionDecision set)', () => {
    const committed = {
      ...VALID_RESPONSE_BASE,
      promotionDecision: 'promoted' as const,
    };
    const parsed = enrollmentResponseSchema.parse(committed);
    expect(parsed.promotionDecision).toBe('promoted');
  });

  it.each(['promoted', 'retained', 'conditional', 'graduated', 'withdrawn', 'transferred_out'] as const)(
    'accepts promotionDecision = %s',
    (decision) => {
      expect(enrollmentResponseSchema.parse({
        ...VALID_RESPONSE_BASE,
        promotionDecision: decision,
      }).promotionDecision).toBe(decision);
    },
  );

  it('rejects non-UUID priorEnrollmentId', () => {
    expect(() => enrollmentResponseSchema.parse({
      ...VALID_RESPONSE_BASE,
      priorEnrollmentId: 'not-a-uuid',
    })).toThrow();
  });

  it('rejects invalid promotionDecision token', () => {
    expect(() => enrollmentResponseSchema.parse({
      ...VALID_RESPONSE_BASE,
      promotionDecision: 'held_back',
    })).toThrow();
  });
});
