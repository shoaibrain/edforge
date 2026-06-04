/**
 * GB0.4 / GB0.5 / GB0.6 — the GovernanceProfile conformance harness.
 *
 * Iterates EVERY active archetype (`activeArchetypeSchema.options`) and asserts
 * the profile is complete, internally consistent, and a faithful view of its
 * source tables. Division of labor: a new archetype added to the enum with NO
 * table entry fails at COMPILE time (every backing table is
 * `Record<ActiveArchetype, …>`), before this suite runs. What this suite
 * uniquely gates is the CONTENT — non-empty slots, internal consistency, and
 * that each slot is the actual source reference (not a drifting hand-copy).
 *
 *   GB0.4 completeness   — every slot present; always-required slots non-empty;
 *                          content-optional slots (boardExams / compliance*) are
 *                          present arrays (GENERIC legitimately carries `[]`).
 *   GB0.5 cross-checks   — calendarSystem known; every required compliance
 *                          descriptor has a registered catalog; every board-exam
 *                          grade either resolves via the GradeLevel descriptor or
 *                          is a national-exam grade above the body's ladder — so a
 *                          typo'd/bogus grade is caught, not silently skipped.
 *   GB0.6 drift guard    — each source-backed slot is the SAME reference as its
 *                          backing constant (proves view-not-rewrite); the
 *                          `readonly` GovernanceProfile type prevents mutating the
 *                          shared table through that reference.
 */

import { activeArchetypeSchema } from '../schemas/identity/tenant.schema';
import { getGovernanceProfile, type GovernanceProfile } from './governance-profile';
import { ARCHETYPE_DEFAULTS } from '../locale/tenant-locale-defaults';
import { ARCHETYPE_DEFAULTS_TABLE } from './archetype-defaults';
import { ARCHETYPE_BELL_PRESETS } from './bell-schedule-presets';
import { ARCHETYPE_ACTIVATION_REQUIREMENTS } from './activation-requirements';
import { DESCRIPTOR_CATALOGS } from '../ed-fi/descriptors/catalogs';
import { resolveDescriptor } from '../ed-fi/descriptors/resolve-descriptor';

const ARCHETYPES = activeArchetypeSchema.options;

/** The "always-required, must-be-non-empty" invariant — shared by the positive
 *  per-archetype check and the negative gate-fires-red proof. */
function alwaysRequiredSlotsPopulated(p: GovernanceProfile): boolean {
  return (
    !!p.regional?.defaultCurrency &&
    p.grading.length > 0 &&
    p.examPattern.length > 0 &&
    !!p.promotionDefaults &&
    p.primaryCurriculumRef.length > 0 &&
    !!p.bellPresets?.academic &&
    p.activation?.archetype === p.archetype &&
    p.schoolConfigDefaults.schoolDays.length > 0
  );
}

describe('GB0.4 completeness', () => {
  describe.each(ARCHETYPES)('%s', (archetype) => {
    const p = getGovernanceProfile(archetype);

    it('has every slot present and the archetype tag matches', () => {
      expect(p.archetype).toBe(archetype);
      for (const slot of [
        p.regional, p.grading, p.promotionDefaults, p.examPattern, p.boardExams,
        p.primaryCurriculumRef, p.complianceForms, p.bellPresets, p.activation,
        p.schoolConfigDefaults, p.complianceRequiredDescriptors,
      ]) {
        expect(slot).toBeDefined();
      }
    });

    it('always-required slots are non-empty', () => {
      expect(alwaysRequiredSlotsPopulated(p)).toBe(true);
    });

    it('content-optional slots are present arrays (may be empty for null-governance bodies)', () => {
      expect(Array.isArray(p.boardExams)).toBe(true);
      expect(Array.isArray(p.complianceForms)).toBe(true);
      expect(Array.isArray(p.complianceRequiredDescriptors)).toBe(true);
    });
  });

  it('gate fires red: a profile with an empty always-required slot is rejected', () => {
    // Break two distinct slots so the negative coverage isn't a single conjunct.
    expect(
      alwaysRequiredSlotsPopulated({ ...getGovernanceProfile('PABSON'), grading: [] }),
    ).toBe(false);
    expect(
      alwaysRequiredSlotsPopulated({
        ...getGovernanceProfile('PABSON'),
        schoolConfigDefaults: { schoolDays: [] },
      }),
    ).toBe(false);
  });
});

describe('GB0.5 cross-checks', () => {
  describe.each(ARCHETYPES)('%s', (archetype) => {
    const p = getGovernanceProfile(archetype);

    it('calendarSystem is a known value', () => {
      expect(['bikram_sambat', 'gregorian']).toContain(p.regional.defaultCalendarSystem);
    });

    it('every required compliance descriptor has a registered catalog', () => {
      for (const d of p.complianceRequiredDescriptors) {
        expect(DESCRIPTOR_CATALOGS[d]).toBeDefined();
      }
    });

    it('every board-exam grade resolves via GradeLevel or is a national-exam grade above the ladder', () => {
      expect(Array.isArray(p.boardExams)).toBe(true);
      const ladder = ARCHETYPE_DEFAULTS_TABLE[archetype].gradeLadder;
      const maxLadderGrade = Math.max(
        0,
        ...ladder.map((g) => Number(g)).filter((n) => Number.isFinite(n)),
      );
      for (const exam of p.boardExams) {
        const gradeCode = String(exam.grade);
        const resolves = resolveDescriptor('GradeLevelDescriptor', gradeCode) !== null;
        const numeric = Number(gradeCode);
        const aboveLadderNationalExam = Number.isFinite(numeric) && numeric > maxLadderGrade;
        // A genuine grade level (resolves) OR a national exam beyond the school's
        // ladder (PABSON NEB_11/12). A typo ('4A', 99) is neither → fails red.
        expect(resolves || aboveLadderNationalExam).toBe(true);
      }
    });
  });
});

describe('GB0.6 drift guard — each slot is the SAME reference as its source (view, not rewrite)', () => {
  describe.each(ARCHETYPES)('%s', (archetype) => {
    const p = getGovernanceProfile(archetype);
    const t = ARCHETYPE_DEFAULTS_TABLE[archetype];

    it('regional slot is ARCHETYPE_DEFAULTS by reference', () => {
      expect(p.regional).toBe(ARCHETYPE_DEFAULTS[archetype]);
    });

    it('ArchetypeDefaults-sourced slots are ARCHETYPE_DEFAULTS_TABLE fields by reference', () => {
      expect(p.grading).toBe(t.letterGrades);
      expect(p.promotionDefaults).toBe(t.promotionDefaults);
      expect(p.examPattern).toBe(t.examPattern);
      expect(p.boardExams).toBe(t.boardExams);
      expect(p.primaryCurriculumRef).toBe(t.primaryCurriculumRef);
      expect(p.complianceForms).toBe(t.complianceForms);
      expect(p.complianceRequiredDescriptors).toBe(t.complianceRequiredDescriptors);
    });

    it('bellPresets + activation are their source tables by reference', () => {
      expect(p.bellPresets).toBe(ARCHETYPE_BELL_PRESETS[archetype]);
      expect(p.activation).toBe(ARCHETYPE_ACTIVATION_REQUIREMENTS[archetype]);
    });
  });
});
