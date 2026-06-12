/**
 * S1.1 — demo roster config conformance.
 *
 * Asserts both shipped archetype configs (PABSON, GENERIC) parse, satisfy
 * the cross-field invariants, and meet the D4 launch spec (two K-12 schools,
 * 200 students each, every ABAC role covered). Also exercises the invariant
 * checker's negative path so a future malformed config fails loudly.
 */

import {
  DEMO_ARCHETYPES,
  DEMO_EMIS_CODE_RE,
  REQUIRED_SCHOOL_ROLES,
  demoRosterConfigSchema,
  loadRosterConfig,
  rosterInvariantViolations,
  type DemoRosterConfig,
} from './roster-config';

describe('demo roster config — S1.1', () => {
  it('ships exactly the PABSON and GENERIC archetypes', () => {
    expect([...DEMO_ARCHETYPES].sort()).toEqual(['GENERIC', 'PABSON']);
  });

  describe.each(DEMO_ARCHETYPES)('%s config', (archetype) => {
    let config: DemoRosterConfig;

    beforeAll(() => {
      // Throws on schema failure OR any invariant violation.
      config = loadRosterConfig(archetype);
    });

    it('loads + validates against the schema', () => {
      expect(config.archetype).toBe(archetype);
      expect(demoRosterConfigSchema.safeParse(config).success).toBe(true);
    });

    it('has zero cross-field invariant violations', () => {
      expect(rosterInvariantViolations(config)).toEqual([]);
    });

    it('is a K-12 school (>= 12 grade levels, all sectioned)', () => {
      expect(config.gradeLevels.length).toBeGreaterThanOrEqual(12);
      for (const g of config.gradeLevels) {
        expect(g.sections.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('targets 200 students (D4)', () => {
      expect(config.targetStudents).toBe(200);
    });

    it('uses a reserved synthetic emisSchoolCode (never collides with a real IEMIS code)', () => {
      expect(config.school.emisSchoolCode).toMatch(DEMO_EMIS_CODE_RE);
    });

    it('staff covers every required school role', () => {
      for (const role of REQUIRED_SCHOOL_ROLES) {
        expect(config.staff[role]).toBeGreaterThanOrEqual(1);
      }
    });

    it('exam components sum to exactly 100%', () => {
      const sum = config.examCycle.components.reduce((s, c) => s + c.weightPct, 0);
      expect(sum).toBe(100);
    });

    it('payment mix sums to exactly 100%', () => {
      const { paidPct, partialPct, unpaidPct } = config.fees.paymentMix;
      expect(paidPct + partialPct + unpaidPct).toBe(100);
    });

    it('course catalogue partitions every grade exactly once', () => {
      const counts = new Map<string, number>();
      for (const band of config.courseCatalog) {
        for (const gc of band.gradeCodes) counts.set(gc, (counts.get(gc) ?? 0) + 1);
      }
      for (const g of config.gradeLevels) {
        expect(counts.get(g.code)).toBe(1);
      }
    });

    it('has enough section capacity for the target students', () => {
      const sections = config.gradeLevels.reduce((s, g) => s + g.sections.length, 0);
      expect(config.targetStudents).toBeGreaterThanOrEqual(sections);
    });
  });

  describe('invariant checker negative paths', () => {
    let base: DemoRosterConfig;
    beforeAll(() => {
      base = loadRosterConfig('PABSON');
    });

    it('flags exam weights that do not sum to 100', () => {
      const bad: DemoRosterConfig = {
        ...base,
        examCycle: {
          ...base.examCycle,
          components: [
            { name: 'A', weightPct: 50 },
            { name: 'B', weightPct: 40 },
          ],
        },
      };
      expect(rosterInvariantViolations(bad)).toContain(
        'examCycle component weights sum to 90, expected 100',
      );
    });

    it('flags a payment mix that does not sum to 100', () => {
      const bad: DemoRosterConfig = {
        ...base,
        fees: { ...base.fees, paymentMix: { paidPct: 50, partialPct: 20, unpaidPct: 10 } },
      };
      expect(rosterInvariantViolations(bad)).toContain('fees.paymentMix sums to 80, expected 100');
    });

    it('flags a grade not covered by any course band', () => {
      const bad: DemoRosterConfig = {
        ...base,
        gradeLevels: [...base.gradeLevels, { code: 'ZZZ', label: 'Ghost', sections: ['A'] }],
      };
      expect(rosterInvariantViolations(bad)).toContain(
        "grade 'ZZZ' is not covered by any course band",
      );
    });

    it('flags a missing required staff role', () => {
      const bad: DemoRosterConfig = {
        ...base,
        staff: { ...base.staff, Nurse: 0 },
      };
      expect(rosterInvariantViolations(bad)).toContain("staff role 'Nurse' has count < 1");
    });
  });
});
