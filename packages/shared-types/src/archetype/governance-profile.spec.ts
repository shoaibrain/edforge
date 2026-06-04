/**
 * GB0.3 — `getGovernanceProfile` composes the profile from the existing tables.
 * Asserts real values flow through (regional, board exams, curriculum, grading,
 * compliance, bell presets, activation) for PABSON + GENERIC. The referential
 * "view ≡ source" drift guard is GB0.6.
 */

import { getGovernanceProfile } from './governance-profile';

describe('GB0.3 getGovernanceProfile', () => {
  it('PABSON: real values flow through from the source tables', () => {
    const p = getGovernanceProfile('PABSON');
    expect(p.archetype).toBe('PABSON');
    expect(p.regional.defaultCurrency).toBe('NPR');
    expect(p.regional.defaultCalendarSystem).toBe('bikram_sambat');
    expect(p.boardExams.some((e) => e.examType === 'SEE')).toBe(true);
    expect(p.primaryCurriculumRef).toBe('CDC_NCF_2076');
    expect(p.grading.some((g) => g.letter === 'NG')).toBe(true);
    expect(p.complianceForms).toContain('IEMIS_FLASH_I');
    expect(p.complianceRequiredDescriptors).toContain('GradeLevelDescriptor');
    expect(p.bellPresets.academic).toBeDefined();
    expect(p.activation.archetype).toBe('PABSON');
    expect(p.schoolConfigDefaults.schoolDays).toContain('sunday'); // Sun–Fri week
    expect(p.schoolConfigDefaults.schoolDays).toContain('friday');
  });

  it('GENERIC: US shape with empty compliance + Mon–Fri week', () => {
    const p = getGovernanceProfile('GENERIC');
    expect(p.regional.defaultCurrency).toBe('USD');
    expect(p.primaryCurriculumRef).toBe('CCSS');
    expect(p.complianceForms).toEqual([]);
    expect(p.complianceRequiredDescriptors).toEqual([]);
    expect(p.schoolConfigDefaults.schoolDays).not.toContain('sunday');
    expect(p.schoolConfigDefaults.schoolDays).toContain('monday');
  });
});
