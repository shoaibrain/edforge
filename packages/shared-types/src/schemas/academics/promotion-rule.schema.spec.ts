/**
 * PromotionRule Schema Spec — Sprint D.2.1
 *
 * Coverage targets (per `d2-sprint-plan.md` §4 D.2.1):
 *   - promotionDecisionSchema: enum membership + tuple coverage
 *   - createPromotionRuleSchema: positive + boundary + negative
 *   - updatePromotionRuleSchema: partial semantics + bounds
 *   - promotionRuleResponseSchema: nullable optionals + flag round-trip
 *   - promotionRuleFilterSchema: optional-everything
 *
 * Total: ≥40 assertions per sprint-plan AC.
 */

import { describe, expect, it } from '@jest/globals';
import {
  promotionDecisionSchema,
  PROMOTION_DECISIONS,
  createPromotionRuleSchema,
  updatePromotionRuleSchema,
  promotionRuleResponseSchema,
  promotionRuleListResponseSchema,
  promotionRuleFilterSchema,
} from './promotion-rule.schema';

// ============================================
// promotionDecisionSchema
// ============================================

describe('promotionDecisionSchema', () => {
  it.each(['promoted', 'retained', 'conditional', 'graduated', 'withdrawn', 'transferred_out'] as const)(
    'accepts %s',
    (decision) => {
      expect(promotionDecisionSchema.parse(decision)).toBe(decision);
    },
  );

  it('rejects unknown decision token', () => {
    expect(() => promotionDecisionSchema.parse('held_back')).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => promotionDecisionSchema.parse('')).toThrow();
  });

  it('PROMOTION_DECISIONS tuple covers exactly 6 values', () => {
    expect(PROMOTION_DECISIONS).toHaveLength(6);
    expect(PROMOTION_DECISIONS).toEqual([
      'promoted',
      'retained',
      'conditional',
      'graduated',
      'withdrawn',
      'transferred_out',
    ]);
  });
});

// ============================================
// createPromotionRuleSchema
// ============================================

const validCreate = {
  schoolId: '11111111-1111-1111-1111-111111111111',
  gradeLevel: '7',
  archetypeId: 'PABSON',
  passingThresholdPct: 35,
  minAttendancePct: 80,
  subjectsRequired: [],
};

describe('createPromotionRuleSchema', () => {
  it('accepts the canonical PABSON shape (35/80, no required subjects)', () => {
    const parsed = createPromotionRuleSchema.parse(validCreate);
    expect(parsed.subjectsRequired).toEqual([]);
  });

  it('defaults subjectsRequired to empty array when omitted', () => {
    const noSubjects = {
      schoolId: '11111111-1111-1111-1111-111111111111',
      gradeLevel: '7',
      archetypeId: 'PABSON',
      passingThresholdPct: 35,
      minAttendancePct: 80,
    };
    const parsed = createPromotionRuleSchema.parse(noSubjects);
    expect(parsed.subjectsRequired).toEqual([]);
  });

  it('accepts subjectsRequired with valid AcademicSubjectDescriptor values', () => {
    const withRequired = {
      ...validCreate,
      subjectsRequired: ['mathematics', 'english'] as const,
    };
    expect(createPromotionRuleSchema.parse(withRequired).subjectsRequired).toHaveLength(2);
  });

  it('rejects subjectsRequired with raw string', () => {
    const badSubject = { ...validCreate, subjectsRequired: ['math'] };
    expect(() => createPromotionRuleSchema.parse(badSubject)).toThrow();
  });

  it('accepts boundary passingThresholdPct = 0', () => {
    expect(createPromotionRuleSchema.parse({ ...validCreate, passingThresholdPct: 0 })).toBeDefined();
  });

  it('accepts boundary passingThresholdPct = 100', () => {
    expect(createPromotionRuleSchema.parse({ ...validCreate, passingThresholdPct: 100 })).toBeDefined();
  });

  it('rejects passingThresholdPct = -1', () => {
    expect(() => createPromotionRuleSchema.parse({ ...validCreate, passingThresholdPct: -1 })).toThrow();
  });

  it('rejects passingThresholdPct = 101', () => {
    expect(() => createPromotionRuleSchema.parse({ ...validCreate, passingThresholdPct: 101 })).toThrow();
  });

  it('rejects minAttendancePct = 100.5', () => {
    expect(() => createPromotionRuleSchema.parse({ ...validCreate, minAttendancePct: 100.5 })).toThrow();
  });

  it('rejects empty gradeLevel', () => {
    expect(() => createPromotionRuleSchema.parse({ ...validCreate, gradeLevel: '' })).toThrow();
  });

  it('rejects missing schoolId', () => {
    const noSchool = { ...validCreate };
    delete (noSchool as Record<string, unknown>).schoolId;
    expect(() => createPromotionRuleSchema.parse(noSchool)).toThrow();
  });

  it('rejects non-UUID schoolId', () => {
    expect(() => createPromotionRuleSchema.parse({ ...validCreate, schoolId: 'not-a-uuid' })).toThrow();
  });

  it('rejects missing archetypeId', () => {
    const noArchetype = { ...validCreate };
    delete (noArchetype as Record<string, unknown>).archetypeId;
    expect(() => createPromotionRuleSchema.parse(noArchetype)).toThrow();
  });

  it('accepts arbitrary archetypeId string (Zod is shape-only; runtime archetype validation happens in service)', () => {
    expect(createPromotionRuleSchema.parse({ ...validCreate, archetypeId: 'CBSE_IN' })).toBeDefined();
  });

  it('accepts description up to 1000 chars', () => {
    const desc = 'a'.repeat(1000);
    expect(createPromotionRuleSchema.parse({ ...validCreate, description: desc })).toBeDefined();
  });

  it('rejects description >1000 chars', () => {
    const desc = 'a'.repeat(1001);
    expect(() => createPromotionRuleSchema.parse({ ...validCreate, description: desc })).toThrow();
  });
});

// ============================================
// updatePromotionRuleSchema
// ============================================

describe('updatePromotionRuleSchema', () => {
  it('accepts empty object (full-partial)', () => {
    expect(updatePromotionRuleSchema.parse({})).toEqual({});
  });

  it('accepts single-field PATCH (passingThresholdPct only)', () => {
    expect(updatePromotionRuleSchema.parse({ passingThresholdPct: 40 })).toEqual({
      passingThresholdPct: 40,
    });
  });

  it('accepts subjectsRequired update', () => {
    expect(
      updatePromotionRuleSchema.parse({ subjectsRequired: ['mathematics'] }),
    ).toEqual({ subjectsRequired: ['mathematics'] });
  });

  it('accepts isActive: false (soft-delete pattern)', () => {
    expect(updatePromotionRuleSchema.parse({ isActive: false })).toEqual({ isActive: false });
  });

  it('rejects passingThresholdPct = -1 on update', () => {
    expect(() => updatePromotionRuleSchema.parse({ passingThresholdPct: -1 })).toThrow();
  });

  it('rejects minAttendancePct = 101 on update', () => {
    expect(() => updatePromotionRuleSchema.parse({ minAttendancePct: 101 })).toThrow();
  });

  it('does NOT include schoolId/gradeLevel/archetypeId in shape (those are identity-immutable)', () => {
    const withIdentityField = updatePromotionRuleSchema.parse({
      passingThresholdPct: 40,
      schoolId: '11111111-1111-1111-1111-111111111111', // stripped by Zod (not in schema)
    } as never);
    expect((withIdentityField as Record<string, unknown>).schoolId).toBeUndefined();
  });
});

// ============================================
// promotionRuleResponseSchema
// ============================================

const validResponse = {
  ruleId: '33333333-3333-3333-3333-333333333333',
  schoolId: '11111111-1111-1111-1111-111111111111',
  tenantId: '44444444-4444-4444-4444-444444444444',
  gradeLevel: '7',
  archetypeId: 'PABSON',
  passingThresholdPct: 35,
  minAttendancePct: 80,
  subjectsRequired: [],
  archetypeDefaulted: true,
  isActive: true,
  createdAt: '2026-05-23T10:00:00.000Z',
  updatedAt: '2026-05-23T10:00:00.000Z',
};

describe('promotionRuleResponseSchema', () => {
  it('accepts the canonical seeded shape', () => {
    expect(promotionRuleResponseSchema.parse(validResponse)).toBeDefined();
  });

  it('round-trips archetypeDefaulted=true (seed path)', () => {
    expect(promotionRuleResponseSchema.parse(validResponse).archetypeDefaulted).toBe(true);
  });

  it('round-trips archetypeDefaulted=false (operator-edited path)', () => {
    const edited = { ...validResponse, archetypeDefaulted: false };
    expect(promotionRuleResponseSchema.parse(edited).archetypeDefaulted).toBe(false);
  });

  it('accepts isActive=false (soft-deleted row)', () => {
    expect(promotionRuleResponseSchema.parse({ ...validResponse, isActive: false })).toBeDefined();
  });

  it('rejects missing archetypeDefaulted', () => {
    const missing = { ...validResponse };
    delete (missing as Record<string, unknown>).archetypeDefaulted;
    expect(() => promotionRuleResponseSchema.parse(missing)).toThrow();
  });

  it('accepts optional description + createdBy', () => {
    const withMeta = { ...validResponse, description: 'PABSON default', createdBy: 'user-1' };
    expect(promotionRuleResponseSchema.parse(withMeta).description).toBe('PABSON default');
  });
});

// ============================================
// promotionRuleListResponseSchema
// ============================================

describe('promotionRuleListResponseSchema', () => {
  it('wraps response array with cursor-pagination envelope', () => {
    const parsed = promotionRuleListResponseSchema.parse({
      items: [validResponse],
      hasMore: false,
      total: 1,
    });
    expect(parsed.items).toHaveLength(1);
    expect(parsed.hasMore).toBe(false);
  });

  it('accepts empty items array', () => {
    expect(
      promotionRuleListResponseSchema.parse({
        items: [],
        hasMore: false,
      }).items,
    ).toEqual([]);
  });

  it('accepts lastEvaluatedKey on partial page', () => {
    const parsed = promotionRuleListResponseSchema.parse({
      items: [validResponse],
      hasMore: true,
      lastEvaluatedKey: 'opaque-cursor',
    });
    expect(parsed.lastEvaluatedKey).toBe('opaque-cursor');
  });
});

// ============================================
// promotionRuleFilterSchema
// ============================================

describe('promotionRuleFilterSchema', () => {
  it('accepts empty filter', () => {
    expect(promotionRuleFilterSchema.parse({})).toEqual({});
  });

  it('accepts schoolId + gradeLevel filter', () => {
    const parsed = promotionRuleFilterSchema.parse({
      schoolId: '11111111-1111-1111-1111-111111111111',
      gradeLevel: '7',
    });
    expect(parsed.gradeLevel).toBe('7');
  });

  it('accepts isActive: true', () => {
    expect(promotionRuleFilterSchema.parse({ isActive: true })).toEqual({ isActive: true });
  });

  it('rejects non-UUID schoolId', () => {
    expect(() => promotionRuleFilterSchema.parse({ schoolId: 'not-uuid' })).toThrow();
  });
});
