/**
 * Student generator — Sprint S1.6.
 *
 * Distributes `targetStudents` (200) evenly across the homeroom cohorts,
 * each a synthetic child whose age matches its grade, with an embedded
 * guardian and (for PABSON) a reserved-band 16-digit emisStudentId. The
 * grade-enrolment is 1:1 with the student (enrollmentDate = AY start).
 */

import type { DemoArchetype, DemoRosterConfig } from './roster-config';
import type { DemoGuardian, DemoSection, DemoStudent } from './generated-types';
import { PersonFactory, type Rng } from './synthetic-identity';
import { DEMO_EMAIL_DOMAIN } from './synthetic-identity';

/** Typical age of the lowest grade, by archetype (NUR≈3 / K≈5). */
const START_AGE: Record<DemoArchetype, number> = { PABSON: 3, GENERIC: 5 };

/** Reserved 16-digit emisStudentId band: 9999 + 12-digit sequence. */
export function demoEmisStudentId(seq: number): string {
  return `9999${String(seq).padStart(12, '0')}`;
}

function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
}

function guardianFor(
  studentLastName: string,
  rng: Rng,
  config: DemoRosterConfig,
  seq: number,
): DemoGuardian {
  const relationship = rng.pick(['mother', 'father', 'guardian'] as const);
  // A guardian factory gives a plausible given name in the right locale.
  const gf = new PersonFactory(rng, config.namePool);
  const gender = relationship === 'mother' ? 'female' : 'male';
  const person = gf.person({ gender, ageYears: rng.int(30, 50), asOf: config.academicYear.startDate });
  const firstName = person.firstName;
  return {
    firstName,
    lastName: studentLastName,
    email: `${slug(firstName)}.${slug(studentLastName)}.parent${seq}@${DEMO_EMAIL_DOMAIN}`,
    phone: person.phone,
    relationship,
  };
}

export function generateStudents(
  config: DemoRosterConfig,
  rng: Rng,
  sections: DemoSection[],
): DemoStudent[] {
  if (sections.length === 0) throw new Error('generateStudents: no sections');
  const factory = new PersonFactory(rng, config.namePool);
  const startAge = START_AGE[config.archetype as DemoArchetype];
  const gradeIndex = new Map(config.gradeLevels.map((g, i) => [g.code, i]));
  const asOf = config.academicYear.startDate;

  const students: DemoStudent[] = [];
  for (let i = 0; i < config.targetStudents; i++) {
    const section = sections[i % sections.length];
    const idx = gradeIndex.get(section.gradeCode) ?? 0;
    const age = startAge + idx;
    const person = factory.person({ ageYears: age, asOf, emailTag: 'student' });
    const seq = i + 1;
    const student: DemoStudent = {
      ref: `student:${seq}`,
      firstName: person.firstName,
      lastName: person.lastName,
      email: person.email,
      phone: person.phone,
      gender: person.gender,
      dateOfBirth: person.dateOfBirth,
      gradeCode: section.gradeCode,
      sectionRef: section.ref,
      studentNumber: `S${String(seq).padStart(5, '0')}`,
      enrollmentDate: asOf,
      guardians: [guardianFor(person.lastName, rng, config, seq)],
    };
    if (config.archetype === 'PABSON') {
      student.emisStudentId = demoEmisStudentId(seq);
    }
    students.push(student);
  }
  return students;
}
