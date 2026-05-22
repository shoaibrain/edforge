/**
 * D.1.1-followup (R38, 2026-05-22) — grading-policy mapper regression specs.
 *
 * Confirms that the mapper:
 *   - Surfaces `gpaScale` in the response (was dropped pre-fix).
 *   - Surfaces entry-level `isPassing` / `isTerminalFail?` / `displayName?`
 *     (were dropped pre-fix; AdminWeb couldn't render the NG sentinel).
 *   - Handles legacy pre-D.1.1 rows gracefully: missing `gpaScale` →
 *     defaults to `'4.0'`; missing `letterGrades` → empty array; missing
 *     `isPassing` on a legacy entry → defaults to `true`.
 *
 * Why backward-compat matters: the dev-pabson Saraswati school carries a
 * pre-D.1 policy (created 2026-05-12) with the OLD shape. The D.1.5
 * backfill is IAM-blocked from migrating it. Until V1.5 operator UI lands,
 * the mapper must round-trip both shapes without 5xx.
 */

import {
  gradingPolicyEntityToDto,
  GradingPolicyResponseDto,
} from './grading-policy.mapper';
import {
  GradingPolicyEntity,
} from '../entities/grading-policy.entity';

function pabsonEntity(): GradingPolicyEntity {
  return {
    tenantId: 'tenant-A',
    entityKey: 'GRADEPOLICY#school-1#policy-1',
    entityType: 'GRADEPOLICY',
    policyId: 'policy-1',
    schoolId: 'school-1',
    policyName: 'PABSON Default',
    gpaScale: '4.0',
    letterGrades: [
      { letter: 'A+', minPercentage: 90, maxPercentage: 100, gpaPoints: 4.0, isPassing: true },
      { letter: 'A',  minPercentage: 80, maxPercentage: 89.99, gpaPoints: 3.6, isPassing: true },
      { letter: 'E',  minPercentage: 0,  maxPercentage: 19.99, gpaPoints: 0.8, isPassing: false },
      {
        letter: 'NG',
        minPercentage: 0,
        maxPercentage: 0,
        gpaPoints: 0,
        isPassing: false,
        isTerminalFail: true,
        displayName: 'Not Graded',
      },
    ],
    categoryWeights: [{ categoryId: 'tests', categoryName: 'Tests', weight: 100 }],
    roundingRule: 'nearest',
    minimumPassingGrade: 35,
    isDefault: true,
    isActive: true,
    createdAt: '2026-05-22T00:00:00.000Z',
    createdBy: 'system',
    updatedAt: '2026-05-22T00:00:00.000Z',
    updatedBy: 'system',
    version: 1,
    gsi1pk: 'TENANT#tenant-A#SCHOOL#school-1',
    gsi1sk: 'GRADEPOLICY#PABSON DEFAULT',
  };
}

/**
 * Legacy 2026-05-12 shape: `gpaScale` missing, entry-level `isPassing`
 * missing. Older entry shape that pre-dated D.1.1's required `isPassing`
 * field. Matches the dev-pabson Saraswati row observed during D.1 smoke.
 */
function legacyEntity(): GradingPolicyEntity {
  return {
    tenantId: 'tenant-A',
    entityKey: 'GRADEPOLICY#school-1#legacy-1',
    entityType: 'GRADEPOLICY',
    policyId: 'legacy-1',
    schoolId: 'school-1',
    policyName: 'default grade',
    // gpaScale intentionally absent
    letterGrades: [
      // isPassing intentionally absent
      { letter: 'A', minPercentage: 90, maxPercentage: 100, gpaPoints: 4.0 } as unknown as GradingPolicyEntity['letterGrades'][number],
      { letter: 'F', minPercentage: 0, maxPercentage: 59.99, gpaPoints: 0 } as unknown as GradingPolicyEntity['letterGrades'][number],
    ],
    categoryWeights: [{ categoryId: 'tests', categoryName: 'Tests', weight: 100 }],
    roundingRule: 'nearest',
    minimumPassingGrade: 60,
    isDefault: true,
    isActive: true,
    createdAt: '2026-05-12T19:58:11.181Z',
    createdBy: 'system',
    updatedAt: '2026-05-12T19:58:11.181Z',
    updatedBy: 'system',
    version: 1,
    gsi1pk: 'TENANT#tenant-A#SCHOOL#school-1',
    gsi1sk: 'GRADEPOLICY#DEFAULT GRADE',
  } as unknown as GradingPolicyEntity;
}

describe('grading-policy.mapper — D.1.1 followup (R38)', () => {
  it('PABSON policy round-trips gpaScale + entry-level isPassing/isTerminalFail/displayName', () => {
    const dto = gradingPolicyEntityToDto(pabsonEntity());

    expect(dto.gpaScale).toBe('4.0');
    expect(dto.letterGrades).toHaveLength(4);

    const a = dto.letterGrades.find((l) => l.letter === 'A+')!;
    expect(a.isPassing).toBe(true);
    expect(a.isTerminalFail).toBeUndefined();
    expect(a.displayName).toBeUndefined();

    const e = dto.letterGrades.find((l) => l.letter === 'E')!;
    expect(e.isPassing).toBe(false);

    const ng = dto.letterGrades.find((l) => l.letter === 'NG')!;
    expect(ng.isPassing).toBe(false);
    expect(ng.isTerminalFail).toBe(true);
    expect(ng.displayName).toBe('Not Graded');
    expect(ng.gpaPoints).toBe(0);
  });

  it('legacy pre-D.1.1 policy: missing gpaScale → defaults to 4.0', () => {
    const dto = gradingPolicyEntityToDto(legacyEntity());
    expect(dto.gpaScale).toBe('4.0');
  });

  it('legacy pre-D.1.1 entries: missing isPassing → defaults to true (backward-compat)', () => {
    const dto = gradingPolicyEntityToDto(legacyEntity());
    expect(dto.letterGrades).toHaveLength(2);
    expect(dto.letterGrades.every((l) => l.isPassing === true)).toBe(true);
  });

  it('legacy: missing letterGrades array → empty array (does NOT crash)', () => {
    const entity = legacyEntity();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (entity as any).letterGrades = undefined;
    const dto = gradingPolicyEntityToDto(entity);
    expect(dto.letterGrades).toEqual([]);
  });

  it('non-mutating: mapping does not modify the input entity', () => {
    const entity = pabsonEntity();
    const snapshot = JSON.stringify(entity);
    gradingPolicyEntityToDto(entity);
    expect(JSON.stringify(entity)).toBe(snapshot);
  });
});
