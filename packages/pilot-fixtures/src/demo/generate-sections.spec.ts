/**
 * S1.4 — section (homeroom) generator.
 */

import { loadRosterConfig } from './roster-config';
import { generateSections } from './generate-sections';

describe.each(['PABSON', 'GENERIC'] as const)('sections — %s', (archetype) => {
  const config = loadRosterConfig(archetype);
  const sections = generateSections(config);

  it('is deterministic', () => {
    expect(generateSections(config)).toEqual(sections);
  });

  it('creates one section per (grade, label)', () => {
    const expected = config.gradeLevels.reduce((s, g) => s + g.sections.length, 0);
    expect(sections).toHaveLength(expected);
  });

  it('every section maps to a configured grade + label', () => {
    const byGrade = new Map(config.gradeLevels.map((g) => [g.code, new Set(g.sections)]));
    for (const s of sections) {
      expect(byGrade.get(s.gradeCode)?.has(s.label)).toBe(true);
    }
  });

  it('refs and (grade,label) pairs are unique', () => {
    const refs = sections.map((s) => s.ref);
    const pairs = sections.map((s) => `${s.gradeCode}|${s.label}`);
    expect(new Set(refs).size).toBe(refs.length);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('covers every grade (no grade left without a section)', () => {
    const gradesWithSections = new Set(sections.map((s) => s.gradeCode));
    for (const g of config.gradeLevels) {
      expect(gradesWithSections.has(g.code)).toBe(true);
    }
  });
});
