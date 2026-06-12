/**
 * S1.5 — staff generator.
 */

import { REQUIRED_SCHOOL_ROLES, loadRosterConfig } from './roster-config';
import { generateStaff, teachersOf } from './generate-staff';
import { DEMO_EMAIL_DOMAIN, assertNoBannedContent, createRng } from './synthetic-identity';

function buildStaff(archetype: 'PABSON' | 'GENERIC') {
  const config = loadRosterConfig(archetype);
  const staff = generateStaff(config, createRng(`${archetype}:staff`), config.academicYear.startDate);
  return { config, staff };
}

describe.each(['PABSON', 'GENERIC'] as const)('staff — %s', (archetype) => {
  const { config, staff } = buildStaff(archetype);

  it('is deterministic for a fixed seed', () => {
    const again = generateStaff(
      config,
      createRng(`${archetype}:staff`),
      config.academicYear.startDate,
    );
    expect(again).toEqual(staff);
  });

  it('headcount equals the sum of configured role counts', () => {
    const expected = Object.values(config.staff).reduce((a, b) => a + b, 0);
    expect(staff).toHaveLength(expected);
  });

  it('covers every required school role', () => {
    const roles = new Set(staff.map((s) => s.schoolRole));
    for (const r of REQUIRED_SCHOOL_ROLES) expect(roles.has(r)).toBe(true);
  });

  it('maps each ABAC role to the right HR staffRole', () => {
    const principal = staff.find((s) => s.schoolRole === 'Principal');
    const teacher = staff.find((s) => s.schoolRole === 'Teacher');
    const accountant = staff.find((s) => s.schoolRole === 'Accountant');
    expect(principal?.staffRole).toBe('principal');
    expect(teacher?.staffRole).toBe('teacher');
    expect(accountant?.staffRole).toBe('admin_staff');
  });

  it('every staff member is a plain TenantUser with a unique reserved-domain email', () => {
    const emails = staff.map((s) => s.email);
    expect(new Set(emails).size).toBe(emails.length);
    for (const s of staff) {
      expect(s.globalRole).toBe('TenantUser');
      expect(s.email.endsWith(`@${DEMO_EMAIL_DOMAIN}`)).toBe(true);
    }
  });

  it('produces no banned content', () => {
    const values = staff.flatMap((s) => [s.firstName, s.lastName, s.email, s.phone]);
    expect(() => assertNoBannedContent(values)).not.toThrow();
  });

  it('exposes a non-empty teacher sub-roster', () => {
    expect(teachersOf(staff).length).toBe(config.staff.Teacher);
    expect(teachersOf(staff).length).toBeGreaterThan(0);
  });
});

describe('staff role coverage across the demo fleet', () => {
  it('PABSON ∪ GENERIC staff cover all 7 required ABAC staff roles', () => {
    const all = [...buildStaff('PABSON').staff, ...buildStaff('GENERIC').staff];
    const roles = new Set(all.map((s) => s.schoolRole));
    for (const r of REQUIRED_SCHOOL_ROLES) expect(roles.has(r)).toBe(true);
  });
});
