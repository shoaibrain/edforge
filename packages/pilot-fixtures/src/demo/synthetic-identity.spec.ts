/**
 * S1.2 — synthetic identity generator.
 *
 * Determinism (same seed → identical roster), locale-correct name pools,
 * intra-allocator uniqueness, reserved email domain + fictional phones, the
 * banned-content guard, and DOB↔age plausibility.
 */

import {
  BANNED_SUBSTRINGS,
  DEMO_EMAIL_DOMAIN,
  PersonFactory,
  assertNoBannedContent,
  createRng,
  dateOfBirthForAge,
  findBannedContent,
  type SyntheticPerson,
} from './synthetic-identity';

function roster(seed: string, namePool: 'nepali' | 'us', n: number): SyntheticPerson[] {
  const f = new PersonFactory(createRng(seed), namePool);
  return Array.from({ length: n }, () => f.person({ ageYears: 10, asOf: '2026-04-14' }));
}

describe('createRng — determinism', () => {
  it('same seed → identical sequence', () => {
    const a = createRng('seed-x');
    const b = createRng('seed-x');
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('different seeds → different sequence', () => {
    const a = Array.from({ length: 20 }, createRng('seed-a').next);
    const b = Array.from({ length: 20 }, createRng('seed-b').next);
    expect(a).not.toEqual(b);
  });

  it('int/pick/bool stay in range', () => {
    const rng = createRng('range');
    for (let i = 0; i < 500; i++) {
      const n = rng.int(3, 7);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(7);
    }
    expect(['x', 'y', 'z']).toContain(rng.pick(['x', 'y', 'z']));
    expect(typeof rng.bool()).toBe('boolean');
  });

  it('weighted respects weights (heavily-weighted value dominates)', () => {
    const rng = createRng('weighted');
    let heavy = 0;
    for (let i = 0; i < 1000; i++) {
      if (rng.weighted([['H', 9], ['L', 1]] as const) === 'H') heavy++;
    }
    expect(heavy).toBeGreaterThan(800);
  });
});

describe('PersonFactory', () => {
  it('same seed → byte-identical roster', () => {
    expect(roster('demo-pabson', 'nepali', 100)).toEqual(roster('demo-pabson', 'nepali', 100));
  });

  it('draws from the correct locale pool', () => {
    const nepali = roster('np', 'nepali', 40);
    const us = roster('us', 'us', 40);
    // A known Nepali family name appears in the nepali roster but not the US one.
    expect(nepali.some((p) => p.lastName === 'Shrestha' || p.lastName === 'Sharma')).toBe(true);
    expect(us.some((p) => ['Shrestha', 'Sharma', 'Adhikari'].includes(p.lastName))).toBe(false);
    expect(us.some((p) => ['Smith', 'Johnson', 'Garcia'].includes(p.lastName))).toBe(true);
  });

  it('produces no duplicate full names within one allocator', () => {
    const r = roster('dup', 'us', 200);
    const names = r.map((p) => `${p.firstName}|${p.lastName}`);
    expect(new Set(names).size).toBe(names.length);
  });

  it('produces no duplicate emails within one allocator', () => {
    const r = roster('dup-email', 'nepali', 200);
    const emails = r.map((p) => p.email);
    expect(new Set(emails).size).toBe(emails.length);
  });

  it('every email uses the reserved non-deliverable .test domain', () => {
    for (const p of roster('mail', 'us', 60)) {
      expect(p.email.endsWith(`@${DEMO_EMAIL_DOMAIN}`)).toBe(true);
      expect(DEMO_EMAIL_DOMAIN.endsWith('.test')).toBe(true);
    }
  });

  it('phones use fictional ranges (US 555-01 block)', () => {
    for (const p of roster('phone', 'us', 40)) {
      expect(p.phone).toMatch(/^\+1\d{3}555\d{4}$/);
    }
    for (const p of roster('phone-np', 'nepali', 40)) {
      expect(p.phone).toMatch(/^\+97798000\d{5}$/);
    }
  });

  it('generated content passes the banned-substring scan', () => {
    const values: string[] = [];
    for (const p of [...roster('scan', 'nepali', 150), ...roster('scan-us', 'us', 150)]) {
      values.push(p.firstName, p.lastName, p.email, p.phone);
    }
    expect(findBannedContent(values)).toEqual([]);
    expect(() => assertNoBannedContent(values)).not.toThrow();
  });
});

describe('banned-content guard', () => {
  it('catches a real-data marker', () => {
    expect(findBannedContent(['Saraswati School'])).toContain('saraswati');
    expect(() => assertNoBannedContent(['alice@gmail.com'])).toThrow(/banned substring/);
  });

  it('has the known markers seeded', () => {
    expect(BANNED_SUBSTRINGS).toContain('saraswati');
  });
});

describe('dateOfBirthForAge', () => {
  it('computes a plausible birth year for the age as-of a date', () => {
    const dob = dateOfBirthForAge(createRng('dob'), 10, '2026-04-14');
    expect(dob).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dob.startsWith('2016-')).toBe(true);
  });

  it('is deterministic for a fixed seed', () => {
    expect(dateOfBirthForAge(createRng('d'), 7, '2026-08-19')).toBe(
      dateOfBirthForAge(createRng('d'), 7, '2026-08-19'),
    );
  });

  it('keeps day within 1..28 (valid in every month)', () => {
    for (let i = 0; i < 50; i++) {
      const dob = dateOfBirthForAge(createRng(`d${i}`), 12, '2026-01-01');
      const day = Number(dob.slice(-2));
      expect(day).toBeGreaterThanOrEqual(1);
      expect(day).toBeLessThanOrEqual(28);
    }
  });
});
