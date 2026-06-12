/**
 * Staff generator — Sprint S1.5.
 *
 * Expands the roster config's per-role staff counts into ~16 staff per
 * school, each a synthetic adult with a school ABAC role + the HR staffRole
 * the POST /users staff bridge expects. The union of school roles across
 * both demo schools covers every required ABAC role (Student + Parent are
 * added by S1.6).
 */

import type { DemoRosterConfig } from './roster-config';
import type { DemoSchoolRole, DemoStaff, DemoStaffRole } from './generated-types';
import { PersonFactory, type Rng } from './synthetic-identity';

/** Fixed iteration order keeps generation deterministic. */
const ROLE_ORDER: DemoSchoolRole[] = [
  'Principal',
  'VicePrincipal',
  'Accountant',
  'Counselor',
  'Nurse',
  'Staff',
  'Teacher',
];

/** ABAC school role → HR staffRole for the POST /users bridge. */
const SCHOOL_ROLE_TO_STAFF_ROLE: Record<DemoSchoolRole, DemoStaffRole> = {
  Principal: 'principal',
  VicePrincipal: 'vice_principal',
  Teacher: 'teacher',
  Accountant: 'admin_staff',
  Counselor: 'counselor',
  Nurse: 'nurse',
  Staff: 'support_staff',
};

/**
 * Generate the staff roster. `asOf` (AD YYYY-MM-DD) is the date staff ages
 * are computed against (the academic-year start).
 */
export function generateStaff(config: DemoRosterConfig, rng: Rng, asOf: string): DemoStaff[] {
  const factory = new PersonFactory(rng, config.namePool);
  const staff: DemoStaff[] = [];
  for (const schoolRole of ROLE_ORDER) {
    const count = config.staff[schoolRole] ?? 0;
    for (let i = 0; i < count; i++) {
      const person = factory.person({
        ageYears: rng.int(28, 58),
        asOf,
        emailTag: schoolRole.toLowerCase(),
      });
      staff.push({
        ref: `staff:${schoolRole}:${i}`,
        firstName: person.firstName,
        lastName: person.lastName,
        email: person.email,
        phone: person.phone,
        gender: person.gender,
        dateOfBirth: person.dateOfBirth,
        schoolRole,
        staffRole: SCHOOL_ROLE_TO_STAFF_ROLE[schoolRole],
        globalRole: 'TenantUser',
      });
    }
  }
  return staff;
}

/** The teacher sub-roster, used by S1.7 to staff courses + course-sections. */
export function teachersOf(staff: DemoStaff[]): DemoStaff[] {
  return staff.filter((s) => s.schoolRole === 'Teacher');
}
