/**
 * Demo tenant composition — Sprint S1.10.
 *
 * Chains the S1.3–S1.9 generators into one deterministic DemoTenantData
 * bundle. Each generator gets its own derived sub-seed so changing one
 * generator's logic doesn't shift another's output.
 */

import { loadRosterConfig, type DemoArchetype, type DemoRosterConfig } from './roster-config';
import { generateAcademicFoundation } from './generate-academic-foundation';
import { generateSections } from './generate-sections';
import { generateStaff, teachersOf } from './generate-staff';
import { generateStudents } from './generate-students';
import { generateCoursesAndSections } from './generate-courses';
import { generateExamCycle } from './generate-exams';
import { generateFinance } from './generate-finance';
import { assertNoBannedContent, createRng } from './synthetic-identity';
import type {
  DemoAcademicYear,
  DemoCourse,
  DemoCourseSection,
  DemoExam,
  DemoExamCourse,
  DemoFeeStructure,
  DemoInvoice,
  DemoMark,
  DemoPayment,
  DemoResultCard,
  DemoSchool,
  DemoSection,
  DemoStaff,
  DemoStudent,
} from './generated-types';

/** The complete demo tenant entity set the loader seeds. */
export interface DemoTenantData {
  archetype: DemoArchetype;
  config: DemoRosterConfig;
  school: DemoSchool;
  academicYear: DemoAcademicYear;
  sections: DemoSection[];
  staff: DemoStaff[];
  students: DemoStudent[];
  courses: DemoCourse[];
  courseSections: DemoCourseSection[];
  exam: DemoExam;
  examCourses: DemoExamCourse[];
  marks: DemoMark[];
  resultCards: DemoResultCard[];
  feeStructures: DemoFeeStructure[];
  invoices: DemoInvoice[];
  payments: DemoPayment[];
}

/**
 * Build the full demo tenant bundle for an archetype. Deterministic: the
 * same `(archetype, seed)` always produces an identical bundle.
 */
export function buildDemoTenant(archetype: DemoArchetype, seed = 'demo'): DemoTenantData {
  const config = loadRosterConfig(archetype);
  const sub = (name: string) => createRng(`${seed}:${archetype}:${name}`);

  const { school, academicYear } = generateAcademicFoundation(config);
  const sections = generateSections(config);
  const staff = generateStaff(config, sub('staff'), academicYear.startDate);
  const students = generateStudents(config, sub('students'), sections);
  const { courses, courseSections } = generateCoursesAndSections(
    config,
    sections,
    teachersOf(staff),
  );
  const { exam, examCourses, marks, resultCards } = generateExamCycle(
    config,
    sub('exam'),
    academicYear,
    students,
    courses,
  );
  const { feeStructures, invoices, payments } = generateFinance(
    config,
    sub('finance'),
    academicYear,
    students,
  );

  const bundle: DemoTenantData = {
    archetype,
    config,
    school,
    academicYear,
    sections,
    staff,
    students,
    courses,
    courseSections,
    exam,
    examCourses,
    marks,
    resultCards,
    feeStructures,
    invoices,
    payments,
  };

  // Safety net: no real name/email/phone (or other banned marker) may reach a
  // demo tenant — scan the whole assembled bundle, including config-sourced
  // strings (school name/address) the generators didn't synthesize (S1.2/C3).
  assertNoBannedContent(collectScannableStrings(bundle));

  return bundle;
}

/** Every human-facing string in the bundle, for the banned-content scan. */
function collectScannableStrings(b: DemoTenantData): string[] {
  const out: string[] = [b.school.name, b.school.address];
  for (const s of b.staff) out.push(s.firstName, s.lastName, s.email, s.phone);
  for (const st of b.students) {
    out.push(st.firstName, st.lastName, st.email, st.phone);
    for (const g of st.guardians) out.push(g.firstName, g.lastName, g.email, g.phone);
  }
  return out;
}
