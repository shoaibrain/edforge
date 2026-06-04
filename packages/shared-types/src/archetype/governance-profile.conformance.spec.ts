/**
 * GB0.4 / GB0.5 / GB0.6 — the GovernanceProfile conformance harness.
 *
 * Iterates EVERY active archetype (`activeArchetypeSchema.options`) and asserts
 * the profile is complete, internally consistent, and a faithful view of its
 * source tables. This is the gate that makes "adding a governance body is
 * data-only" safe: a new archetype added to the enum without a complete,
 * consistent, non-drifting profile fails CI here.
 *
 *   GB0.4 completeness   — every slot present; always-required slots non-empty;
 *                          content-optional slots (boardExams / compliance*) are
 *                          present arrays (GENERIC legitimately carries `[]`).
 *   GB0.5 cross-checks   — calendarSystem known; every required compliance
 *                          descriptor has a registered catalog; board exams at
 *                          grades the body actually operates resolve via the
 *                          GradeLevel descriptor (national-exam grades above the
 *                          ladder, e.g. PABSON NEB_11/12, are out of scope).
 *   GB0.6 drift guard    — each slot deep-equals its backing constant ("view,
 *                          not rewrite").
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
    const broken: GovernanceProfile = { ...getGovernanceProfile('PABSON'), grading: [] };
    expect(alwaysRequiredSlotsPopulated(broken)).toBe(false);
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

    it('board exams at grades the body operates resolve via the GradeLevel descriptor', () => {
      const ladder = new Set(ARCHETYPE_DEFAULTS_TABLE[archetype].gradeLadder);
      for (const exam of p.boardExams) {
        const gradeCode = String(exam.grade);
        if (ladder.has(gradeCode)) {
          expect(resolveDescriptor('GradeLevelDescriptor', gradeCode)).not.toBeNull();
        }
      }
    });
  });
});

describe('GB0.6 drift guard — view never diverges from its sources', () => {
  describe.each(ARCHETYPES)('%s', (archetype) => {
    const p = getGovernanceProfile(archetype);
    const t = ARCHETYPE_DEFAULTS_TABLE[archetype];

    it('regional slot deep-equals ARCHETYPE_DEFAULTS', () => {
      expect(p.regional).toEqual(ARCHETYPE_DEFAULTS[archetype]);
    });

    it('ArchetypeDefaults-sourced slots deep-equal ARCHETYPE_DEFAULTS_TABLE', () => {
      expect(p.grading).toEqual(t.letterGrades);
      expect(p.promotionDefaults).toEqual(t.promotionDefaults);
      expect(p.examPattern).toEqual(t.examPattern);
      expect(p.boardExams).toEqual(t.boardExams);
      expect(p.primaryCurriculumRef).toEqual(t.primaryCurriculumRef);
      expect(p.complianceForms).toEqual(t.complianceForms);
      expect(p.complianceRequiredDescriptors).toEqual(t.complianceRequiredDescriptors);
    });

    it('bellPresets + activation deep-equal their source tables', () => {
      expect(p.bellPresets).toEqual(ARCHETYPE_BELL_PRESETS[archetype]);
      expect(p.activation).toEqual(ARCHETYPE_ACTIVATION_REQUIREMENTS[archetype]);
    });
  });
});
