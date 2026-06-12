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

/** School-scoped ABAC role (role.schema). */
export type DemoSchoolRole =
  | 'Principal'
  | 'VicePrincipal'
  | 'Teacher'
  | 'Accountant'
  | 'Counselor'
  | 'Nurse'
  | 'Staff';

/** HR staff role (staff.schema staffRoleSchema). */
export type DemoStaffRole =
  | 'principal'
  | 'vice_principal'
  | 'teacher'
  | 'admin_staff'
  | 'counselor'
  | 'nurse'
  | 'support_staff';

export interface DemoStaff {
  ref: Ref;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  gender: 'male' | 'female';
  dateOfBirth: string;
  /** ABAC role assigned via POST /users/:id/roles. */
  schoolRole: DemoSchoolRole;
  /** HR role passed to the POST /users staff bridge. */
  staffRole: DemoStaffRole;
  /** Tenant-wide role; demo staff are plain TenantUsers. */
  globalRole: 'TenantUser';
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

/** A guardian embedded on a student (per the student-create contract). */
export interface DemoGuardian {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  relationship: 'mother' | 'father' | 'guardian';
}

/** Ed-Fi rollup subject area (course.schema subjectArea). */
export type DemoSubjectArea =
  | 'mathematics'
  | 'english_language_arts'
  | 'science'
  | 'social_studies'
  | 'world_languages'
  | 'arts'
  | 'physical_education'
  | 'technology'
  | 'other';

export interface DemoCourse {
  ref: Ref;
  /** Matches ^[A-Z0-9_-]+$, unique within school. */
  courseCode: string;
  courseName: string;
  gradeCode: string;
  subjectArea: DemoSubjectArea;
  credits: number;
  courseType: 'required';
  typicalDuration: 'year';
  /** Teacher (DemoStaff.ref) who owns the course. */
  teacherRef: Ref;
}

/** An API course-section: one per (homeroom cohort × the grade's courses). */
export interface DemoCourseSection {
  ref: Ref;
  courseRef: Ref;
  /** Homeroom (DemoSection.ref) this section serves. */
  homeroomRef: Ref;
  gradeCode: string;
  /** API sectionNumber (the homeroom label, e.g. 'A'). */
  sectionNumber: string;
  primaryTeacherRef: Ref;
  maxEnrollment: number;
}

export interface DemoStudent {
  ref: Ref;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  gender: 'male' | 'female';
  dateOfBirth: string;
  gradeCode: string;
  /** Homeroom cohort the student belongs to (DemoSection.ref). */
  sectionRef: Ref;
  studentNumber: string;
  /** 16-digit reserved-band id; present only for PABSON (required there). */
  emisStudentId?: string;
  /** AD YYYY-MM-DD — also the grade-enrolment date. */
  enrollmentDate: string;
  guardians: DemoGuardian[];
}
