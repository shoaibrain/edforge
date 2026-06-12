/**
 * S1.3 — academic-foundation generator (school + academic year + terms).
 */

import { ORDERED_GRADES } from '@aibrains/shared-types';

import { DEMO_EMIS_CODE_RE, loadRosterConfig } from './roster-config';
import { generateAcademicFoundation } from './generate-academic-foundation';

const ORDERED = new Set<string>(ORDERED_GRADES as readonly string[]);

describe.each(['PABSON', 'GENERIC'] as const)('academic foundation — %s', (archetype) => {
  const config = loadRosterConfig(archetype);
  const { school, academicYear } = generateAcademicFoundation(config);

  it('is deterministic (pure function of config)', () => {
    expect(generateAcademicFoundation(config)).toEqual({ school, academicYear });
  });

  describe('school', () => {
    it('has a 2–10 char school code', () => {
      expect(school.schoolCode.length).toBeGreaterThanOrEqual(2);
      expect(school.schoolCode.length).toBeLessThanOrEqual(10);
    });

    it('carries the reserved synthetic emisSchoolCode', () => {
      expect(school.emisSchoolCode).toMatch(DEMO_EMIS_CODE_RE);
    });

    it('grade range spans the first → last configured grade', () => {
      expect(school.gradeRange.start).toBe(config.gradeLevels[0].code);
      expect(school.gradeRange.end).toBe(config.gradeLevels[config.gradeLevels.length - 1].code);
    });

    it('enabledGradeLevels are all valid ORDERED_GRADES codes', () => {
      expect(school.enabledGradeLevels).toEqual(config.gradeLevels.map((g) => g.code));
      for (const code of school.enabledGradeLevels) {
        expect(ORDERED.has(code)).toBe(true);
      }
    });

    it('has a label for every enabled grade', () => {
      for (const code of school.enabledGradeLevels) {
        expect(school.gradeLevelLabels[code]).toBeDefined();
      }
    });
  });

  describe('academic year + terms', () => {
    it('matches the config dates and name', () => {
      expect(academicYear.name).toBe(config.academicYear.name);
      expect(academicYear.startDate).toBe(config.academicYear.startDate);
      expect(academicYear.endDate).toBe(config.academicYear.endDate);
    });

    it('generates 3 sequential, non-overlapping terms spanning the AY', () => {
      expect(academicYear.terms).toHaveLength(3);
      const t = academicYear.terms;
      expect(t[0].startDate).toBe(academicYear.startDate);
      expect(t[t.length - 1].endDate).toBe(academicYear.endDate);
      for (let i = 0; i < t.length; i++) {
        expect(t[i].sequence).toBe(i + 1);
        expect(t[i].startDate <= t[i].endDate).toBe(true);
        if (i > 0) expect(t[i - 1].endDate < t[i].startDate).toBe(true);
      }
    });

    it('exam window sits inside each term', () => {
      for (const t of academicYear.terms) {
        expect(t.startDate <= t.examStartDate).toBe(true);
        expect(t.examStartDate <= t.examEndDate).toBe(true);
        expect(t.examEndDate <= t.endDate).toBe(true);
      }
    });

    it('carries BS dates iff the calendar is bikram_sambat', () => {
      if (config.calendarSystem === 'bikram_sambat') {
        expect(academicYear.startDateBS).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
        expect(academicYear.endDateBS).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
      } else {
        expect(academicYear.startDateBS).toBeUndefined();
        expect(academicYear.endDateBS).toBeUndefined();
      }
    });
  });
});
