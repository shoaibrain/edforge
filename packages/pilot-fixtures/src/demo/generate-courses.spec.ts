/**
 * S1.7 — course + course-section generator.
 */

import { loadRosterConfig } from './roster-config';
import { generateSections } from './generate-sections';
import { generateStaff, teachersOf } from './generate-staff';
import {
  courseSectionsForHomeroom,
  generateCoursesAndSections,
  subjectAreaFor,
} from './generate-courses';
import { createRng } from './synthetic-identity';

const VALID_SUBJECT_AREAS = new Set([
  'mathematics',
  'english_language_arts',
  'science',
  'social_studies',
  'world_languages',
  'arts',
  'physical_education',
  'technology',
  'other',
]);
const COURSE_CODE_RE = /^[A-Z0-9_-]+$/;

function build(archetype: 'PABSON' | 'GENERIC') {
  const config = loadRosterConfig(archetype);
  const sections = generateSections(config);
  const teachers = teachersOf(
    generateStaff(config, createRng(`${archetype}:staff`), config.academicYear.startDate),
  );
  const result = generateCoursesAndSections(config, sections, teachers);
  return { config, sections, teachers, ...result };
}

describe.each(['PABSON', 'GENERIC'] as const)('courses — %s', (archetype) => {
  const { config, sections, teachers, courses, courseSections } = build(archetype);
  const teacherRefs = new Set(teachers.map((t) => t.ref));
  const courseRefs = new Set(courses.map((c) => c.ref));

  it('is deterministic', () => {
    const again = generateCoursesAndSections(config, sections, teachers);
    expect(again).toEqual({ courses, courseSections });
  });

  it('every grade has its band catalogue of courses', () => {
    const bandByGrade = new Map<string, string[]>();
    for (const band of config.courseCatalog) {
      for (const gc of band.gradeCodes) bandByGrade.set(gc, band.courses);
    }
    for (const grade of config.gradeLevels) {
      const got = courses.filter((c) => c.gradeCode === grade.code).map((c) => c.courseName).sort();
      expect(got).toEqual([...(bandByGrade.get(grade.code) ?? [])].sort());
    }
  });

  it('every course has a valid code, subject area, and an assigned teacher', () => {
    for (const c of courses) {
      expect(c.courseCode).toMatch(COURSE_CODE_RE);
      expect(c.courseCode.length).toBeGreaterThanOrEqual(2);
      expect(c.courseCode.length).toBeLessThanOrEqual(20);
      expect(VALID_SUBJECT_AREAS.has(c.subjectArea)).toBe(true);
      expect(teacherRefs.has(c.teacherRef)).toBe(true);
    }
  });

  it('course codes are unique within the school', () => {
    const codes = courses.map((c) => c.courseCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('distributes teaching load across the whole teacher pool (round-robin)', () => {
    const used = new Set(courses.map((c) => c.teacherRef));
    expect(used.size).toBe(teachers.length);
  });

  it('creates a course-section per (homeroom × grade course), all references valid', () => {
    const homeroomRefs = new Set(sections.map((s) => s.ref));
    for (const cs of courseSections) {
      expect(courseRefs.has(cs.courseRef)).toBe(true);
      expect(homeroomRefs.has(cs.homeroomRef)).toBe(true);
      expect(teacherRefs.has(cs.primaryTeacherRef)).toBe(true);
    }
    // count == sum over homerooms of that grade's course count
    const coursesPerGrade = new Map<string, number>();
    for (const c of courses) coursesPerGrade.set(c.gradeCode, (coursesPerGrade.get(c.gradeCode) ?? 0) + 1);
    const expected = sections.reduce((sum, s) => sum + (coursesPerGrade.get(s.gradeCode) ?? 0), 0);
    expect(courseSections).toHaveLength(expected);
  });

  it('course-section refs are unique', () => {
    const refs = courseSections.map((cs) => cs.ref);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('courseSectionsForHomeroom returns a full course set for a homeroom', () => {
    const homeroom = sections[0];
    const forHr = courseSectionsForHomeroom(courseSections, homeroom.ref);
    const gradeCourses = courses.filter((c) => c.gradeCode === homeroom.gradeCode);
    expect(forHr).toHaveLength(gradeCourses.length);
    for (const cs of forHr) expect(cs.homeroomRef).toBe(homeroom.ref);
  });
});

describe('subjectAreaFor', () => {
  it.each([
    ['Mathematics', 'mathematics'],
    ['Optional Mathematics', 'mathematics'],
    ['English', 'english_language_arts'],
    ['Science', 'science'],
    ['Biology', 'science'],
    ['Social Studies', 'social_studies'],
    ['U.S. History', 'social_studies'],
    ['Nepali', 'world_languages'],
    ['Drawing', 'arts'],
    ['Health & Physical Education', 'physical_education'],
    ['Computer Science', 'technology'],
    ['Underwater Basket Weaving', 'other'],
  ])('%s → %s', (name, area) => {
    expect(subjectAreaFor(name)).toBe(area);
  });
});
