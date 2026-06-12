/**
 * S1.6 — student generator.
 */

import { loadRosterConfig } from './roster-config';
import { generateSections } from './generate-sections';
import { demoEmisStudentId, generateStudents } from './generate-students';
import { DEMO_EMAIL_DOMAIN, assertNoBannedContent, createRng } from './synthetic-identity';

function build(archetype: 'PABSON' | 'GENERIC') {
  const config = loadRosterConfig(archetype);
  const sections = generateSections(config);
  const students = generateStudents(config, createRng(`${archetype}:students`), sections);
  return { config, sections, students };
}

describe.each(['PABSON', 'GENERIC'] as const)('students — %s', (archetype) => {
  const { config, sections, students } = build(archetype);
  const startYear = Number(config.academicYear.startDate.slice(0, 4));
  const startAge = archetype === 'PABSON' ? 3 : 5;

  it('is deterministic for a fixed seed', () => {
    const again = generateStudents(config, createRng(`${archetype}:students`), sections);
    expect(again).toEqual(students);
  });

  it('generates exactly the target count (200)', () => {
    expect(students).toHaveLength(config.targetStudents);
  });

  it('assigns each student to exactly one existing homeroom + its grade', () => {
    const byRef = new Map(sections.map((s) => [s.ref, s]));
    for (const st of students) {
      const sec = byRef.get(st.sectionRef);
      expect(sec).toBeDefined();
      expect(sec?.gradeCode).toBe(st.gradeCode);
    }
  });

  it('distributes students evenly across homerooms (±1)', () => {
    const counts = new Map<string, number>();
    for (const st of students) counts.set(st.sectionRef, (counts.get(st.sectionRef) ?? 0) + 1);
    const values = [...counts.values()];
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
    // every section got at least one student
    expect(counts.size).toBe(sections.length);
  });

  it('age matches grade (age as-of AY start == startAge + grade index)', () => {
    const gradeIndex = new Map(config.gradeLevels.map((g, i) => [g.code, i]));
    for (const st of students) {
      const birthYear = Number(st.dateOfBirth.slice(0, 4));
      const age = startYear - birthYear;
      expect(age).toBe(startAge + (gradeIndex.get(st.gradeCode) ?? -1));
    }
  });

  it('has unique student numbers and emails', () => {
    expect(new Set(students.map((s) => s.studentNumber)).size).toBe(students.length);
    expect(new Set(students.map((s) => s.email)).size).toBe(students.length);
    for (const s of students) expect(s.email.endsWith(`@${DEMO_EMAIL_DOMAIN}`)).toBe(true);
  });

  it('each student has a guardian (Parent relationship)', () => {
    for (const s of students) {
      expect(s.guardians.length).toBeGreaterThanOrEqual(1);
      expect(['mother', 'father', 'guardian']).toContain(s.guardians[0].relationship);
      expect(s.guardians[0].lastName).toBe(s.lastName);
    }
  });

  it('produces no banned content', () => {
    const values = students.flatMap((s) => [
      s.firstName,
      s.lastName,
      s.email,
      ...s.guardians.flatMap((g) => [g.firstName, g.email]),
    ]);
    expect(() => assertNoBannedContent(values)).not.toThrow();
  });

  if (archetype === 'PABSON') {
    it('PABSON: every student has a unique 16-digit reserved emisStudentId', () => {
      const ids = students.map((s) => s.emisStudentId);
      for (const id of ids) expect(id).toMatch(/^9999\d{12}$/);
      expect(new Set(ids).size).toBe(ids.length);
    });
  } else {
    it('GENERIC: students carry no emisStudentId', () => {
      for (const s of students) expect(s.emisStudentId).toBeUndefined();
    });
  }
});

describe('demoEmisStudentId', () => {
  it('is always 16 digits in the reserved band', () => {
    expect(demoEmisStudentId(1)).toBe('9999000000000001');
    expect(demoEmisStudentId(200)).toMatch(/^9999\d{12}$/);
    expect(demoEmisStudentId(200)).toHaveLength(16);
  });
});
