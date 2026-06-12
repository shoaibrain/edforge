/**
 * Generated demo-entity types — Sprint S1.3+.
 *
 * Domain shapes the demo generators produce. They are NOT the service API
 * DTOs — the loader (S1.10) maps each to the real create payload. Entities
 * reference each other by local string `Ref`s (e.g. 'student:42'); the
 * loader resolves a Ref to the UUID the API returns at create time.
 *
 * Every generated entity carries the marker that lets the loader tag the
 * written row `demoSeed: true` and lets `--reset` (S1.12) find it.
 */

/** Local cross-entity reference, resolved to a real UUID by the loader. */
export type Ref = string;

export interface DemoGradeRange {
  start: string;
  end: string;
}

export interface DemoSchool {
  ref: Ref;
  name: string;
  /** 2–10 char school code, unique within tenant. */
  schoolCode: string;
  /** schoolTypeSchema value. */
  schoolType: 'k12' | 'private';
  /** Reserved synthetic 9999NNNN band. */
  emisSchoolCode: string;
  address: string;
  gradeRange: DemoGradeRange;
  /** Every grade code the school runs (school-first local codes). */
  enabledGradeLevels: string[];
  /** code → { locale: label }. */
  gradeLevelLabels: Record<string, Record<string, string>>;
}

export interface DemoTerm {
  ref: Ref;
  name: string;
  termType: 'semester' | 'quarter' | 'trimester' | 'year';
  sequence: number;
  /** AD YYYY-MM-DD. */
  startDate: string;
  endDate: string;
  examStartDate: string;
  examEndDate: string;
}

export interface DemoAcademicYear {
  ref: Ref;
  name: string;
  /** AD YYYY-MM-DD. */
  startDate: string;
  endDate: string;
  /** BS YYYY/MM/DD — present only for bikram_sambat calendars. */
  startDateBS?: string;
  endDateBS?: string;
  calendarType: 'semester' | 'quarter' | 'trimester' | 'annual';
  terms: DemoTerm[];
}

export interface DemoAcademicFoundation {
  school: DemoSchool;
  academicYear: DemoAcademicYear;
}

/**
 * A homeroom cohort — the (grade, label) group a student belongs to. The
 * API has no standalone "section" entity (sections are course-sections,
 * see DemoCourseSection); the loader realizes a homeroom as the set of
 * course-sections sharing this cohort, and students enrol into them.
 */
export interface DemoSection {
  ref: Ref;
  gradeCode: string;
  /** Section label within the grade, e.g. 'A'. */
  label: string;
  /** Display name, e.g. 'Class 1 A'. */
  name: string;
}
