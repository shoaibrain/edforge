/**
 * Spec for ARCHETYPE_ACTIVATION_REQUIREMENTS.
 *
 * Sprint 4 / Ticket 4.2a (academic-year-current-flag-bug) added the
 * `current_academic_year` requirement to both PABSON and GENERIC. This
 * spec pins the contract so a drive-by edit to the config table can't
 * silently weaken the activation gate.
 *
 * Verifies:
 *   - every active archetype has the new requirement with minCount=1
 *   - `academic_year_active` and `current_academic_year` are both present
 *     and orthogonal (the activation gate enforces BOTH — a school can't
 *     reach `status='active'` without exactly one designated current AY)
 *   - getActivationRequirements falls back to GENERIC for unknown archetypes
 *     (fail-soft per the design comment in the source file)
 */

import {
  ARCHETYPE_ACTIVATION_REQUIREMENTS,
  getActivationRequirements,
  type ActivationRequirementKey,
} from './activation-requirements';

const ACTIVE_ARCHETYPES = ['PABSON', 'GENERIC'] as const;

describe('ARCHETYPE_ACTIVATION_REQUIREMENTS — registry completeness', () => {
  it.each(ACTIVE_ARCHETYPES)(
    '%s registers a config entry',
    (arch) => {
      expect(ARCHETYPE_ACTIVATION_REQUIREMENTS[arch]).toBeDefined();
      expect(ARCHETYPE_ACTIVATION_REQUIREMENTS[arch].archetype).toBe(arch);
    },
  );
});

describe('current_academic_year requirement (Sprint 4 / Ticket 4.2a)', () => {
  it.each(ACTIVE_ARCHETYPES)(
    '%s includes current_academic_year with minCount=1',
    (arch) => {
      const cfg = ARCHETYPE_ACTIVATION_REQUIREMENTS[arch];
      const req = cfg.requirements.find(
        (r) => r.key === 'current_academic_year',
      );
      expect(req).toBeDefined();
      expect(req!.minCount).toBe(1);
      expect(req!.label.length).toBeGreaterThan(0);
    },
  );

  it.each(ACTIVE_ARCHETYPES)(
    '%s keeps academic_year_active and current_academic_year as separate, both-required checks',
    (arch) => {
      const cfg = ARCHETYPE_ACTIVATION_REQUIREMENTS[arch];
      const keys = cfg.requirements.map((r) => r.key);
      expect(keys).toContain('academic_year_active');
      expect(keys).toContain('current_academic_year');
      // The two checks must be orthogonal — neither subsumes the other.
      // `academic_year_active` counts AYs with status='active'.
      // `current_academic_year` counts AYs with isCurrent=true.
      // A school in the drifted state (active+!isCurrent) fails the second
      // but passes the first; activation is correctly blocked.
      const acadActive = cfg.requirements.find(
        (r) => r.key === 'academic_year_active',
      )!;
      const acadCurrent = cfg.requirements.find(
        (r) => r.key === 'current_academic_year',
      )!;
      expect(acadActive.minCount).toBeGreaterThanOrEqual(1);
      expect(acadCurrent.minCount).toBeGreaterThanOrEqual(1);
    },
  );
});

describe('PABSON activation config (Sprint 4 unchanged invariants)', () => {
  const pabson = ARCHETYPE_ACTIVATION_REQUIREMENTS.PABSON;

  it('still requires 4 grading periods (PABSON 4-term invariant)', () => {
    const gp = pabson.requirements.find((r) => r.key === 'grading_periods');
    expect(gp?.minCount).toBe(4);
  });

  it('still requires bell_schedule and calendar_generated', () => {
    const keys = pabson.requirements.map((r) => r.key);
    expect(keys).toContain('bell_schedule');
    expect(keys).toContain('calendar_generated');
  });
});

describe('getActivationRequirements — fail-soft fallback', () => {
  it('returns GENERIC config for an unknown archetype', () => {
    const cfg = getActivationRequirements('NOT_A_REAL_ARCHETYPE');
    expect(cfg.archetype).toBe('GENERIC');
  });

  it('returns GENERIC config for null/undefined archetype', () => {
    expect(getActivationRequirements(undefined).archetype).toBe('GENERIC');
    expect(getActivationRequirements(null).archetype).toBe('GENERIC');
  });

  it('returns PABSON config for "pabson" (case-insensitive)', () => {
    expect(getActivationRequirements('pabson').archetype).toBe('PABSON');
    expect(getActivationRequirements('PABSON').archetype).toBe('PABSON');
  });
});

describe('ActivationRequirementKey type membership (compile-time guard)', () => {
  // Compile-time assertion via assignability — if `current_academic_year`
  // is ever removed from the union, this fails tsc before jest runs.
  it('includes current_academic_year as a member', () => {
    const k: ActivationRequirementKey = 'current_academic_year';
    expect(k).toBe('current_academic_year');
  });
});
