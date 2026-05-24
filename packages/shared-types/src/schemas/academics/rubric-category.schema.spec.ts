/**
 * RubricCategory schema spec — Sprint D.3.0
 *
 * Per `d3-sprint-plan.md` §4 D.3.0 + §1.4 invariant gate (≥10 assertions).
 */

import { describe, expect, it } from '@jest/globals';
import {
  createRubricCategorySchema,
  updateRubricCategorySchema,
  rubricCategoryResponseSchema,
} from './rubric-category.schema';

const VALID_SCHOOL = '11111111-1111-1111-1111-111111111111';
const VALID_TENANT = '22222222-2222-2222-2222-222222222222';
const VALID_CATEGORY = '33333333-3333-3333-3333-333333333333';

describe('createRubricCategorySchema', () => {
  const valid = {
    schoolId: VALID_SCHOOL,
    examType: 'BLE' as const,
    academicSubject: 'mathematics' as const,
    categoryName: 'unitTests',
    weight: 30,
  };

  it('accepts a well-formed row', () => {
    expect(createRubricCategorySchema.parse(valid)).toMatchObject(valid);
  });

  it('accepts academicSubject undefined (applies to all subjects)', () => {
    const { academicSubject: _drop, ...withoutSubject } = valid;
    expect(createRubricCategorySchema.parse(withoutSubject)).toBeTruthy();
  });

  it('rejects academicSubject as raw string', () => {
    expect(() =>
      createRubricCategorySchema.parse({ ...valid, academicSubject: 'math' }),
    ).toThrow();
  });

  it('rejects examType not in enum', () => {
    expect(() =>
      createRubricCategorySchema.parse({ ...valid, examType: 'AP' }),
    ).toThrow();
  });

  it('accepts weight=0', () => {
    expect(createRubricCategorySchema.parse({ ...valid, weight: 0 })).toBeTruthy();
  });

  it('accepts weight=100', () => {
    expect(createRubricCategorySchema.parse({ ...valid, weight: 100 })).toBeTruthy();
  });

  it('rejects weight=-1', () => {
    expect(() => createRubricCategorySchema.parse({ ...valid, weight: -1 })).toThrow();
  });

  it('rejects weight=101', () => {
    expect(() => createRubricCategorySchema.parse({ ...valid, weight: 101 })).toThrow();
  });

  it("rejects categoryName=''", () => {
    expect(() => createRubricCategorySchema.parse({ ...valid, categoryName: '' })).toThrow();
  });

  it('rejects categoryName > 80 chars', () => {
    expect(() =>
      createRubricCategorySchema.parse({ ...valid, categoryName: 'a'.repeat(81) }),
    ).toThrow();
  });

  it('rejects schoolId not UUID', () => {
    expect(() =>
      createRubricCategorySchema.parse({ ...valid, schoolId: 'not-a-uuid' }),
    ).toThrow();
  });
});

describe('updateRubricCategorySchema', () => {
  it('accepts a weight-only update', () => {
    expect(updateRubricCategorySchema.parse({ weight: 40 })).toEqual({ weight: 40 });
  });

  it('accepts isActive=false (soft-delete from update path)', () => {
    expect(updateRubricCategorySchema.parse({ isActive: false })).toEqual({ isActive: false });
  });

  it('accepts an empty body (no-op update)', () => {
    expect(updateRubricCategorySchema.parse({})).toEqual({});
  });

  it('rejects weight=101 (identity-bounds preserved)', () => {
    expect(() => updateRubricCategorySchema.parse({ weight: 101 })).toThrow();
  });
});

describe('rubricCategoryResponseSchema', () => {
  const validResponse = {
    categoryId: VALID_CATEGORY,
    schoolId: VALID_SCHOOL,
    tenantId: VALID_TENANT,
    examType: 'BLE' as const,
    categoryName: 'unitTests',
    weight: 30,
    archetypeDefaulted: true,
    isActive: true,
    createdAt: '2026-05-24T00:00:00.000Z',
    createdBy: 'u1',
    updatedAt: '2026-05-24T00:00:00.000Z',
    updatedBy: 'u1',
  };

  it('accepts a complete response with optionals omitted', () => {
    expect(rubricCategoryResponseSchema.parse(validResponse)).toBeTruthy();
  });

  it('accepts academicSubject as null (cross-subject category serialized form)', () => {
    expect(
      rubricCategoryResponseSchema.parse({ ...validResponse, academicSubject: null }),
    ).toBeTruthy();
  });

  it('round-trips archetypeDefaulted true → false (operator-edited)', () => {
    const seeded = rubricCategoryResponseSchema.parse(validResponse);
    const edited = rubricCategoryResponseSchema.parse({ ...seeded, archetypeDefaulted: false });
    expect(edited.archetypeDefaulted).toBe(false);
    expect(edited.categoryId).toBe(seeded.categoryId);
  });
});
