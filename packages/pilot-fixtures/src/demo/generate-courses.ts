/**
 * Course + course-section generator — Sprint S1.7.
 *
 * For each grade, the band catalogue's subjects become courses (each owned
 * by a teacher, round-robin from the teacher pool). For each homeroom cohort
 * of a grade, a course-section is created per course — the API "section"
 * students enrol into. `subjectArea` is mapped from the subject name.
 */

import type { DemoRosterConfig } from './roster-config';
import type {
  DemoCourse,
  DemoCourseSection,
  DemoSection,
  DemoStaff,
  DemoSubjectArea,
} from './generated-types';

const MAX_ENROLLMENT = 30;

/** Heuristic subject name → Ed-Fi rollup subject area. */
export function subjectAreaFor(courseName: string): DemoSubjectArea {
  const n = courseName.toLowerCase();
  if (n.includes('math') || n.includes('algebra')) return 'mathematics';
  if (n.includes('english') || n.includes('language arts')) return 'english_language_arts';
  // Technology before science so "Computer Science" → technology, not science.
  if (n.includes('computer') || n.includes('technology')) return 'technology';
  if (n.includes('science') || n.includes('biology') || n.includes('physics') || n.includes('chemistry'))
    return 'science';
  if (n.includes('social') || n.includes('history') || n.includes('environment') || n.includes('population'))
    return 'social_studies';
  if (n.includes('nepali') || n.includes('world language')) return 'world_languages';
  if (n.includes('art') || n.includes('drawing') || n.includes('rhymes')) return 'arts';
  if (n.includes('physical') || n.includes('health')) return 'physical_education';
  return 'other';
}

/** Uppercased initials of the subject name, alnum only (course-code stem). */
function abbrev(courseName: string): string {
  const initials = courseName
    .split(/[\s,&]+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ''))
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .join('');
  return initials.slice(0, 8) || 'C';
}

export interface CoursesAndSections {
  courses: DemoCourse[];
  courseSections: DemoCourseSection[];
}

export function generateCoursesAndSections(
  config: DemoRosterConfig,
  sections: DemoSection[],
  teachers: DemoStaff[],
): CoursesAndSections {
  if (teachers.length === 0) throw new Error('generateCoursesAndSections: no teachers');

  // grade code → its band's subject list.
  const coursesByGrade = new Map<string, string[]>();
  for (const band of config.courseCatalog) {
    for (const gc of band.gradeCodes) coursesByGrade.set(gc, band.courses);
  }

  const courses: DemoCourse[] = [];
  const courseByGradeAndName = new Map<string, DemoCourse>();
  let teacherCursor = 0;

  for (const grade of config.gradeLevels) {
    const subjects = coursesByGrade.get(grade.code) ?? [];
    for (const subject of subjects) {
      const teacher = teachers[teacherCursor % teachers.length];
      teacherCursor += 1;
      const course: DemoCourse = {
        ref: `course:${grade.code}-${abbrev(subject)}`,
        courseCode: `${abbrev(subject)}-${grade.code}`,
        courseName: subject,
        gradeCode: grade.code,
        subjectArea: subjectAreaFor(subject),
        credits: 1,
        courseType: 'required',
        typicalDuration: 'year',
        teacherRef: teacher.ref,
      };
      courses.push(course);
      courseByGradeAndName.set(`${grade.code}|${subject}`, course);
    }
  }

  const courseSections: DemoCourseSection[] = [];
  for (const homeroom of sections) {
    const subjects = coursesByGrade.get(homeroom.gradeCode) ?? [];
    for (const subject of subjects) {
      const course = courseByGradeAndName.get(`${homeroom.gradeCode}|${subject}`);
      if (!course) continue;
      courseSections.push({
        ref: `coursesection:${homeroom.gradeCode}-${homeroom.label}-${abbrev(subject)}`,
        courseRef: course.ref,
        homeroomRef: homeroom.ref,
        gradeCode: homeroom.gradeCode,
        sectionNumber: homeroom.label,
        primaryTeacherRef: course.teacherRef,
        maxEnrollment: MAX_ENROLLMENT,
      });
    }
  }

  return { courses, courseSections };
}

/** Course-sections belonging to a homeroom cohort (for student enrolment). */
export function courseSectionsForHomeroom(
  courseSections: DemoCourseSection[],
  homeroomRef: string,
): DemoCourseSection[] {
  return courseSections.filter((cs) => cs.homeroomRef === homeroomRef);
}
