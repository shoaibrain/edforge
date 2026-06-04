/**
 * GB0.2 — type-level proof that `GovernanceProfile` composes cleanly from the
 * REAL tables. The value of this spec is the `: GovernanceProfile` annotation:
 * if any slot type drifts from its backing constant, this file fails to
 * compile under ts-jest. GB0.3 turns this hand-written composition into the
 * `getGovernanceProfile` function; GB0.6 adds the deep-equal drift guard.
 */

import type { GovernanceProfile } from './governance-profile';
import { ARCHETYPE_DEFAULTS } from '../locale/tenant-locale-defaults';
import { ARCHETYPE_DEFAULTS_TABLE } from './archetype-defaults';
import { ARCHETYPE_BELL_PRESETS } from './bell-schedule-presets';
import { ARCHETYPE_ACTIVATION_REQUIREMENTS } from './activation-requirements';

describe('GB0.2 GovernanceProfile — composes from the real tables (type-level)', () => {
  it('a hand-written PABSON literal built from the real tables satisfies GovernanceProfile', () => {
    const t = ARCHETYPE_DEFAULTS_TABLE.PABSON;
    const pabson: GovernanceProfile = {
      archetype: 'PABSON',
      regional: ARCHETYPE_DEFAULTS.PABSON,
      grading: t.letterGrades,
      promotionDefaults: t.promotionDefaults,
      examPattern: t.examPattern,
      boardExams: t.boardExams,
      primaryCurriculumRef: t.primaryCurriculumRef,
      complianceForms: t.complianceForms,
      bellPresets: ARCHETYPE_BELL_PRESETS.PABSON,
      activation: ARCHETYPE_ACTIVATION_REQUIREMENTS.PABSON,
      // GB1.2b finalizes this from getDefaultConfigForArchetype; hand-stubbed here.
      schoolConfigDefaults: {
        schoolDays: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      },
      complianceRequiredDescriptors: t.complianceRequiredDescriptors,
    };

    // Runtime sanity so jest has something to assert; the real test is that the
    // literal above type-checks against the real tables.
    expect(pabson.archetype).toBe('PABSON');
    expect(pabson.regional.defaultCurrency).toBe('NPR');
    expect(pabson.boardExams.length).toBeGreaterThan(0);
    expect(pabson.grading.some((g) => g.letter === 'NG')).toBe(true);
  });
});
