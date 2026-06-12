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
import { createRng } from './synthetic-identity';
import type {
  DemoAcademicYear,
  DemoCourse,
  DemoCourseSection,
  DemoExam,
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
  const { exam, marks, resultCards } = generateExamCycle(config, sub('exam'), academicYear, students);
  const { feeStructures, invoices, payments } = generateFinance(
    config,
    sub('finance'),
    academicYear,
    students,
  );

  return {
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
    marks,
    resultCards,
    feeStructures,
    invoices,
    payments,
  };
}
