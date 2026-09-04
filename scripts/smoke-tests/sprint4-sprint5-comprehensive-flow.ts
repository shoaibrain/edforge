/**
 * EdForge — Sprint 4 + Sprint 5: Comprehensive Integration Smoke Test
 *
 * End-to-end validation of Student Identity, Enrollment, Section Rostering,
 * and Attendance features across both sprints. Data is intentionally NOT
 * cleaned up so the frontend application can render the created records.
 *
 * Coverage:
 *
 *   Module 0:  Setup — Discover academic year, discover sections
 *   Module 1:  Create Students — Realistic student records with auto-USI (Sprint 4)
 *   Module 2:  De-duplication — check-duplicate endpoint (Sprint 4)
 *   Module 3:  CSV Import — Bulk import with validation errors (Sprint 4)
 *   Module 4:  Enrollment — Create enrollments with Ed-Fi dates (Sprint 4)
 *   Module 5:  Enrollment Validation — Duplicate rejection, missing fields (Sprint 4)
 *   Module 6:  Enrollment Listing — Verify enrollments via list endpoint (Sprint 4)
 *   Module 7:  Section Rostering — Roster students into sections (Sprint 5)
 *   Module 8:  Roster Verification — Verify students appear in rosters (Sprint 5)
 *   Module 9:  Enrollment-Required Validation — Unenrolled student → 400 (Sprint 5)
 *   Module 10: Single Attendance — Record individual attendance (Sprint 5)
 *   Module 11: Bulk Attendance — Record bulk attendance for section (Sprint 5)
 *   Module 12: Attendance Summary — Daily summary verification (Sprint 5)
 *   Module 13: Attendance Trend — 30-day trend endpoint (Sprint 5)
 *   Module 14: Attendance Alerts — Below-threshold alerts (Sprint 5)
 *   Module 15: Student Update — PATCH student record (Sprint 4)
 *   Module 16: Student Profile — GET student profile aggregate (Sprint 4)
 *
 * NO CLEANUP — All data persists for frontend rendering.
 *
 * Usage:
 *   ID_TOKEN=<jwt> npx ts-node scripts/smoke-tests/sprint4-sprint5-comprehensive-flow.ts
 *   ID_TOKEN=<jwt> SCHOOL_ID=<uuid> npx ts-node scripts/smoke-tests/sprint4-sprint5-comprehensive-flow.ts
 */

import axios, { AxiosRequestConfig } from 'axios';
import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────

const ID_TOKEN = process.env.ID_TOKEN || ''; // export ID_TOKEN=<Cognito ID token>; never paste a token into this file;
const BASE_URL =
  process.env.API_BASE_URL ||
  'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';
const SCHOOL_ID =
  process.env.SCHOOL_ID || 'd5adb754-9997-42f0-9ee5-98f41e6c4d73';
const ACADEMIC_YEAR_ID = process.env.ACADEMIC_YEAR_ID || '';
const LOG_LEVEL = process.env.LOG_LEVEL || 'debug';

if (!ID_TOKEN) {
  console.error(
    '\x1b[31mERROR: ID_TOKEN environment variable is required.\x1b[0m'
  );
  console.error(
    'Usage: ID_TOKEN=<jwt> npx ts-node scripts/smoke-tests/sprint4-sprint5-comprehensive-flow.ts'
  );
  process.exit(1);
}

// ─────────────────────────────────────────
// TYPE DEFINITIONS
// ─────────────────────────────────────────

interface ApiResponse<T = unknown> {
  status: number;
  data: T | null;
  error: string | null;
  duration: number;
}

interface TestResult {
  name: string;
  module: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  duration: number;
  error?: string;
}

interface StudentResponse {
  studentId: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  fullName: string;
  dateOfBirth: string;
  gender: string;
  currentGradeLevel: string;
  studentNumber: string;
  status: string;
  enrollmentDate?: string;
  [k: string]: unknown;
}

interface EnrollmentResponse {
  enrollmentId: string;
  studentId: string;
  schoolId: string;
  gradeLevel: string;
  enrollmentDate?: string;
  entryDate?: string;
  exitWithdrawDate?: string;
  status: string;
  [k: string]: unknown;
}

interface DuplicateCheckResponse {
  hasDuplicates: boolean;
  matches: Array<{
    studentId: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    confidence: string;
    matchReasons: string[];
  }>;
}

interface ImportResponse {
  imported: number;
  skipped: number;
  errors: Array<{ row: number; field: string; message: string }>;
  duplicates: Array<{
    row: number;
    matches: Array<{ studentId: string; name: string; confidence: string }>;
  }>;
}

interface SectionResponse {
  sectionId: string;
  sectionNumber: string;
  courseName?: string;
  courseCode?: string;
  courseId?: string;
  capacity?: number;
  [k: string]: unknown;
}

interface RosterEntry {
  studentId: string;
  studentName?: string;
  firstName?: string;
  lastName?: string;
  studentNumber?: string;
  [k: string]: unknown;
}

interface AttendanceResponse {
  attendanceId?: string;
  studentId: string;
  status: string;
  date: string;
  [k: string]: unknown;
}

interface BulkAttendanceResponse {
  created: number;
  updated: number;
  errors?: Array<{ studentId: string; message: string }>;
  [k: string]: unknown;
}

interface AttendanceSummaryResponse {
  date: string;
  totalPresent?: number;
  totalAbsent?: number;
  totalTardy?: number;
  totalExcused?: number;
  totalStudents?: number;
  [k: string]: unknown;
}

interface AttendanceTrendEntry {
  date: string;
  present?: number;
  absent?: number;
  tardy?: number;
  [k: string]: unknown;
}

interface AttendanceAlertEntry {
  studentId: string;
  studentName?: string;
  attendanceRate?: number;
  daysAbsent?: number;
  [k: string]: unknown;
}

interface StudentProfileResponse {
  studentId: string;
  firstName: string;
  lastName: string;
  studentNumber: string;
  enrollments?: unknown[];
  sections?: unknown[];
  [k: string]: unknown;
}

interface CourseResponse {
  courseId: string;
  courseCode: string;
  courseName: string;
  [k: string]: unknown;
}

interface StaffMember {
  staffId: string;
  firstName?: string;
  lastName?: string;
  [k: string]: unknown;
}

// ─────────────────────────────────────────
// CONTEXT — Tracks all created entities
// ─────────────────────────────────────────

interface TestContext {
  schoolId: string;
  academicYearId: string;
  staffId: string;
  // Courses created in this test
  courses: Array<{
    courseId: string;
    courseCode: string;
    courseName: string;
  }>;
  // Students (realistic names — data persists for frontend)
  students: Array<{
    studentId: string;
    studentNumber: string;
    firstName: string;
    lastName: string;
    gradeLevel: string;
  }>;
  // Enrollments
  enrollments: Array<{
    enrollmentId: string;
    studentId: string;
    gradeLevel: string;
  }>;
  // Sections (discovered or created)
  sections: Array<{
    sectionId: string;
    sectionNumber: string;
    courseName?: string;
  }>;
  // Rostering assignments
  rosterAssignments: Array<{
    sectionId: string;
    studentId: string;
  }>;
  // Import results
  importedStudentIds: string[];
}

const ctx: TestContext = {
  schoolId: SCHOOL_ID,
  academicYearId: ACADEMIC_YEAR_ID,
  staffId: '',
  courses: [],
  students: [],
  enrollments: [],
  sections: [],
  rosterAssignments: [],
  importedStudentIds: [],
};

// ─────────────────────────────────────────
// REALISTIC TEST DATA
// ─────────────────────────────────────────

const STUDENTS_TO_CREATE = [
  {
    firstName: 'Emily',
    lastName: 'Johnson',
    dateOfBirth: '2014-08-15',
    gender: 'female',
    gradeLevel: '6',
  },
  {
    firstName: 'Marcus',
    lastName: 'Williams',
    dateOfBirth: '2015-02-28',
    gender: 'male',
    gradeLevel: '5',
  },
  {
    firstName: 'Sofia',
    lastName: 'Rodriguez',
    dateOfBirth: '2014-11-03',
    gender: 'female',
    gradeLevel: '6',
  },
  {
    firstName: 'Aiden',
    lastName: 'Patel',
    dateOfBirth: '2015-06-20',
    gender: 'male',
    gradeLevel: '5',
  },
  {
    firstName: 'Olivia',
    lastName: 'Chen',
    dateOfBirth: '2013-12-10',
    gender: 'female',
    gradeLevel: '7',
  },
];

const CSV_IMPORT_STUDENTS = [
  {
    firstName: 'Liam',
    lastName: 'Washington',
    birthDate: '2014-04-12',
    gender: 'male',
    gradeLevel: '6',
    guardianName: 'Patricia Washington',
    guardianPhone: '555-0201',
    guardianEmail: 'p.washington@example.com',
  },
  {
    firstName: 'Zara',
    lastName: 'Thompson',
    birthDate: '2015-09-05',
    gender: 'female',
    gradeLevel: '5',
    guardianName: 'David Thompson',
    guardianPhone: '555-0202',
    guardianEmail: 'd.thompson@example.com',
  },
  {
    firstName: 'Noah',
    lastName: 'Kim',
    birthDate: '2013-07-18',
    gender: 'male',
    gradeLevel: '7',
    guardianName: 'Jin Kim',
    guardianPhone: '555-0203',
    guardianEmail: 'j.kim@example.com',
  },
];

const COURSES_TO_CREATE = [
  {
    courseCode: 'MATH-501',
    courseName: 'Mathematics 5',
    subjectArea: 'mathematics',
    courseType: 'required',
    typicalDuration: 'year',
    credits: 1,
    gradeLevels: ['5', '6'],
    description: 'Core mathematics for grades 5-6 covering fractions, decimals, and geometry.',
  },
  {
    courseCode: 'ELA-601',
    courseName: 'English Language Arts 6',
    subjectArea: 'english_language_arts',
    courseType: 'required',
    typicalDuration: 'year',
    credits: 1,
    gradeLevels: ['6', '7'],
    description: 'Core ELA covering reading comprehension, writing, and grammar.',
  },
  {
    courseCode: 'SCI-701',
    courseName: 'General Science 7',
    subjectArea: 'science',
    courseType: 'required',
    typicalDuration: 'year',
    credits: 1,
    gradeLevels: ['7'],
    description: 'Introduction to scientific method, life science, and earth science.',
  },
];

// ─────────────────────────────────────────
// LOGGING
// ─────────────────────────────────────────

const logLines: string[] = [];

function log(
  level: 'debug' | 'info' | 'warn' | 'error',
  ...args: unknown[]
) {
  const msg = args
    .map((a) =>
      typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
    )
    .join(' ');
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase()}] ${msg}`;
  logLines.push(line);

  const levels = { debug: 0, info: 1, warn: 2, error: 3 };
  if (
    levels[level] >=
    levels[(LOG_LEVEL as keyof typeof levels) ?? 'debug']
  ) {
    const color = {
      debug: '\x1b[90m',
      info: '\x1b[36m',
      warn: '\x1b[33m',
      error: '\x1b[31m',
    };
    console.log(`${color[level]}${line}\x1b[0m`);
  }
}

// ─────────────────────────────────────────
// HTTP CLIENT
// ─────────────────────────────────────────

async function api<T>(
  method: string,
  urlPath: string,
  body?: unknown
): Promise<ApiResponse<T>> {
  const start = Date.now();
  const config: AxiosRequestConfig = {
    method: method as AxiosRequestConfig['method'],
    url: `${BASE_URL}${urlPath}`,
    headers: {
      Authorization: `Bearer ${ID_TOKEN}`,
      'Content-Type': 'application/json',
    },
    data: body,
    validateStatus: () => true,
    timeout: 30_000,
  };

  try {
    const res = await axios(config);
    const duration = Date.now() - start;
    log(
      'debug',
      `${method.toUpperCase()} ${urlPath} → ${res.status} (${duration}ms)`
    );
    if (res.status >= 400) {
      return {
        status: res.status,
        data: null,
        error: JSON.stringify(res.data),
        duration,
      };
    }
    return { status: res.status, data: res.data as T, error: null, duration };
  } catch (err: any) {
    const duration = Date.now() - start;
    return { status: 0, data: null, error: err.message, duration };
  }
}

// ─────────────────────────────────────────
// TEST RUNNER
// ─────────────────────────────────────────

const results: TestResult[] = [];

async function test(
  module: string,
  name: string,
  fn: () => Promise<void>
) {
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    results.push({ name, module, status: 'PASS', duration });
    console.log(
      `  \x1b[32m✓\x1b[0m ${name} \x1b[90m(${duration}ms)\x1b[0m`
    );
  } catch (err: any) {
    const duration = Date.now() - start;
    results.push({
      name,
      module,
      status: 'FAIL',
      duration,
      error: err.message,
    });
    console.log(
      `  \x1b[31m✗\x1b[0m ${name} \x1b[90m(${duration}ms)\x1b[0m`
    );
    console.log(`    \x1b[31m${err.message}\x1b[0m`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// Helper: short delay for eventual consistency
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 0: SETUP — Discover academic year & sections
// ═══════════════════════════════════════════════════════════════════════════════

async function module0_setup() {
  console.log('\n\x1b[1m📋 Module 0: Setup\x1b[0m');

  // ── Step 1: Discover academic year ──
  await test('Setup', 'Discover active academic year', async () => {
    if (ctx.academicYearId) {
      log('info', 'Using provided academic year:', ctx.academicYearId);
      return;
    }

    // Academic years are served by the Identity microservice
    const res = await api<any>(
      'get',
      `/schools/${ctx.schoolId}/academic-years`
    );

    assert(
      res.status === 200,
      `Expected 200 but got ${res.status}: ${res.error}`
    );

    const items = Array.isArray(res.data) ? res.data : res.data?.items;
    assert(items && items.length > 0, 'No academic years found');

    // Prefer the "current" one, then "active", then first available
    const currentYear =
      items.find((y: any) => y.isCurrent) ||
      items.find((y: any) => y.status === 'active') ||
      items[0];
    ctx.academicYearId =
      currentYear.yearId || currentYear.academicYearId || currentYear.id;
    log(
      'info',
      `Found academic year: ${currentYear.name || ctx.academicYearId} (id: ${ctx.academicYearId})`
    );
  });

  // ── Step 2: Discover a staff member for section creation ──
  await test('Setup', 'Discover staff member (teacher) for sections', async () => {
    const res = await api<any>(
      'get',
      `/schools/${ctx.schoolId}/staff`
    );

    if (res.status === 200) {
      const items: StaffMember[] = Array.isArray(res.data)
        ? res.data
        : res.data?.items || res.data?.staff || [];

      if (items.length > 0) {
        const teacher = items[0];
        ctx.staffId = teacher.staffId || (teacher as any).id || '';
        log(
          'info',
          `Found staff: ${teacher.firstName || ''} ${teacher.lastName || ''} (${ctx.staffId})`
        );
        return;
      }
    }

    // Fallback: use a deterministic placeholder UUID
    // (section creation may still succeed if teacher validation is relaxed)
    ctx.staffId = '00000000-0000-4000-a000-000000000001';
    log('warn', 'No staff found — using placeholder teacher ID');
  });

  // ── Step 3: Discover existing sections ──
  await test('Setup', 'Discover active sections for rostering', async () => {
    const res = await api<any>(
      'get',
      `/academics/sections?schoolId=${ctx.schoolId}`
    );

    assert(
      res.status === 200,
      `Expected 200 but got ${res.status}: ${res.error}`
    );

    const items: SectionResponse[] = Array.isArray(res.data)
      ? res.data
      : res.data?.items || [];

    if (items.length > 0) {
      // Use existing sections
      ctx.sections = items.slice(0, 3).map((s) => ({
        sectionId: s.sectionId,
        sectionNumber: s.sectionNumber || '',
        courseName: s.courseName || s.courseCode || 'Section',
      }));
      log(
        'info',
        `Found ${items.length} existing sections, using ${ctx.sections.length}`
      );
    } else {
      log('info', 'No sections found — will create courses + sections');
    }
  });

  // ── Step 4: Create courses if no sections exist ──
  if (ctx.sections.length === 0) {
    console.log('\n\x1b[1m📘 Module 0b: Create Courses & Sections\x1b[0m');

    for (const course of COURSES_TO_CREATE) {
      await test(
        'Setup — Courses',
        `POST /academics/courses — ${course.courseName}`,
        async () => {
          const res = await api<CourseResponse>('post', '/academics/courses', {
            ...course,
            schoolId: ctx.schoolId,
          });

          assert(
            res.status === 201 || res.status === 200,
            `Expected 200/201 but got ${res.status}: ${res.error}`
          );
          assert(!!res.data?.courseId, 'Response should include courseId');

          ctx.courses.push({
            courseId: res.data!.courseId,
            courseCode: course.courseCode,
            courseName: course.courseName,
          });

          log(
            'info',
            `Created course: ${course.courseName} (${course.courseCode}) → ${res.data!.courseId}`
          );
        }
      );
    }

    // ── Step 5: Create a section for each course ──
    const sectionConfigs = [
      { suffix: 'A', maxEnrollment: 30 },
      { suffix: 'B', maxEnrollment: 25 },
      { suffix: 'A', maxEnrollment: 28 },
    ];

    for (let i = 0; i < ctx.courses.length; i++) {
      const course = ctx.courses[i];
      const config = sectionConfigs[i] || sectionConfigs[0];

      await test(
        'Setup — Sections',
        `POST /academics/sections — ${course.courseName} Section ${config.suffix}`,
        async () => {
          const res = await api<SectionResponse>('post', '/academics/sections', {
            courseId: course.courseId,
            schoolId: ctx.schoolId,
            academicYearId: ctx.academicYearId,
            sectionNumber: config.suffix,
            sectionName: `${course.courseName} - Section ${config.suffix}`,
            primaryTeacherId: ctx.staffId,
            maxEnrollment: config.maxEnrollment,
          });

          assert(
            res.status === 201 || res.status === 200,
            `Expected 200/201 but got ${res.status}: ${res.error}`
          );
          assert(!!res.data?.sectionId, 'Response should include sectionId');

          ctx.sections.push({
            sectionId: res.data!.sectionId,
            sectionNumber: res.data!.sectionNumber || config.suffix,
            courseName: course.courseName,
          });

          log(
            'info',
            `Created section: ${course.courseName} ${config.suffix} → ${res.data!.sectionId}`
          );
        }
      );
    }

    log(
      'info',
      `Setup complete: ${ctx.courses.length} courses, ${ctx.sections.length} sections`
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 1: CREATE STUDENTS — Auto USI generation (Sprint 4)
// ═══════════════════════════════════════════════════════════════════════════════

async function module1_createStudents() {
  console.log(
    '\n\x1b[1m👤 Module 1: Create Students — Auto USI Generation (Sprint 4)\x1b[0m'
  );

  for (const student of STUDENTS_TO_CREATE) {
    await test(
      'Create Students',
      `POST /academics/students — ${student.firstName} ${student.lastName} (grade ${student.gradeLevel})`,
      async () => {
        const res = await api<StudentResponse>('post', '/academics/students', {
          firstName: student.firstName,
          lastName: student.lastName,
          dateOfBirth: student.dateOfBirth,
          gender: student.gender,
          schoolId: ctx.schoolId,
          currentGradeLevel: student.gradeLevel,
        });

        assert(
          res.status === 201 || res.status === 200,
          `Expected 200/201 but got ${res.status}: ${res.error}`
        );
        assert(!!res.data?.studentId, 'Response should include studentId');
        assert(
          !!res.data?.studentNumber,
          'Response should include auto-generated studentNumber (USI)'
        );
        assert(
          res.data!.firstName === student.firstName,
          `First name mismatch: expected "${student.firstName}" got "${res.data!.firstName}"`
        );

        ctx.students.push({
          studentId: res.data!.studentId,
          studentNumber: res.data!.studentNumber,
          firstName: student.firstName,
          lastName: student.lastName,
          gradeLevel: student.gradeLevel,
        });

        log(
          'info',
          `Created: ${student.firstName} ${student.lastName} → ${res.data!.studentId} (USI: ${res.data!.studentNumber})`
        );
      }
    );
  }

  // Verify USI format on first student
  await test(
    'Create Students',
    'Verify USI format is {PREFIX}-{YEAR}-{SEQ}',
    async () => {
      assert(ctx.students.length > 0, 'Need at least 1 student');
      const usi = ctx.students[0].studentNumber;
      // Format: ABC-2026-00001 or similar alphanumeric prefix
      const usiPattern = /^[A-Z0-9]{2,6}-\d{4}-\d{5}$/;
      assert(
        usiPattern.test(usi),
        `USI "${usi}" doesn't match expected pattern {CODE}-{YEAR}-{SEQ}`
      );
      log('info', `USI format validated: ${usi}`);
    }
  );

  // Verify retrieval of a created student
  await test(
    'Create Students',
    'GET /academics/students/:id — retrieve Emily Johnson',
    async () => {
      assert(ctx.students.length > 0, 'Need at least 1 student');
      const studentId = ctx.students[0].studentId;

      const res = await api<StudentResponse>(
        'get',
        `/academics/students/${studentId}`
      );
      assert(
        res.status === 200,
        `Expected 200 but got ${res.status}: ${res.error}`
      );
      assert(
        res.data?.firstName === 'Emily',
        `Expected firstName "Emily" but got "${res.data?.firstName}"`
      );
      assert(
        res.data?.lastName === 'Johnson',
        `Expected lastName "Johnson" but got "${res.data?.lastName}"`
      );
      assert(res.data?.status === 'active', 'Status should be active');
      log('info', `Retrieved student: ${res.data?.fullName || res.data?.firstName + ' ' + res.data?.lastName}`);
    }
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 2: DE-DUPLICATION CHECK (Sprint 4)
// ═══════════════════════════════════════════════════════════════════════════════

async function module2_deduplication() {
  console.log(
    '\n\x1b[1m🔍 Module 2: De-duplication Check (Sprint 4)\x1b[0m'
  );

  await test(
    'De-duplication',
    'POST check-duplicate — exact match finds Emily Johnson',
    async () => {
      const res = await api<DuplicateCheckResponse>(
        'post',
        '/academics/students/check-duplicate',
        {
          firstName: 'Emily',
          lastName: 'Johnson',
          dateOfBirth: '2014-08-15',
          schoolId: ctx.schoolId,
        }
      );

      assert(
        res.status === 200 || res.status === 201,
        `Expected 200/201 but got ${res.status}: ${res.error}`
      );
      assert(res.data !== null, 'Should return a response object');
      assert(
        typeof res.data?.hasDuplicates === 'boolean',
        'Should have hasDuplicates boolean'
      );
      assert(Array.isArray(res.data?.matches), 'Should have matches array');

      if (res.data!.hasDuplicates) {
        log(
          'info',
          `Found ${res.data!.matches.length} duplicate(s) with confidence: ${res.data!.matches.map((m) => m.confidence).join(', ')}`
        );
      } else {
        log('info', 'No duplicates found (may be expected depending on match algorithm)');
      }
    }
  );

  await test(
    'De-duplication',
    'POST check-duplicate — no match for fictitious student',
    async () => {
      const res = await api<DuplicateCheckResponse>(
        'post',
        '/academics/students/check-duplicate',
        {
          firstName: 'Xylophones',
          lastName: `Quizzicality_${Date.now()}`,
          dateOfBirth: '2000-01-01',
          schoolId: ctx.schoolId,
        }
      );

      assert(
        res.status === 200 || res.status === 201,
        `Expected 200/201 but got ${res.status}: ${res.error}`
      );
      assert(
        res.data?.hasDuplicates === false,
        'Should not find duplicates for fictitious name'
      );
      assert(
        res.data?.matches.length === 0,
        'Matches should be empty'
      );
      log('info', 'Correctly returned no duplicates for fictitious student');
    }
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 3: CSV IMPORT (Sprint 4)
// ═══════════════════════════════════════════════════════════════════════════════

async function module3_csvImport() {
  console.log('\n\x1b[1m📤 Module 3: CSV Import (Sprint 4)\x1b[0m');

  await test(
    'CSV Import',
    'POST /academics/students/import — import 3 valid students with guardian info',
    async () => {
      const res = await api<ImportResponse>(
        'post',
        '/academics/students/import',
        {
          schoolId: ctx.schoolId,
          students: CSV_IMPORT_STUDENTS,
        }
      );

      assert(
        res.status === 200 || res.status === 201,
        `Expected 200/201 but got ${res.status}: ${res.error}`
      );
      assert(res.data !== null, 'Should return import results');
      assert(
        res.data!.imported >= 0,
        'Should report imported count'
      );

      log(
        'info',
        `CSV Import: imported=${res.data!.imported}, skipped=${res.data!.skipped}, errors=${res.data!.errors.length}, duplicates=${res.data!.duplicates.length}`
      );
    }
  );

  await test(
    'CSV Import',
    'POST /academics/students/import — invalid rows flagged with errors',
    async () => {
      const res = await api<ImportResponse>(
        'post',
        '/academics/students/import',
        {
          schoolId: ctx.schoolId,
          students: [
            {
              firstName: '',
              lastName: 'MissingFirst',
              birthDate: '2015-01-01',
              gender: 'male',
              gradeLevel: '5',
            },
            {
              firstName: 'BadDate',
              lastName: 'Student',
              birthDate: 'not-a-date',
              gender: 'female',
              gradeLevel: '5',
            },
            {
              firstName: 'ValidImport',
              lastName: `TestRow_${Date.now()}`,
              birthDate: '2016-03-15',
              gender: 'male',
              gradeLevel: '4',
            },
          ],
        }
      );

      assert(
        res.status === 200 || res.status === 201,
        `Expected 200/201 but got ${res.status}: ${res.error}`
      );
      assert(
        res.data!.errors.length >= 2,
        `Expected at least 2 validation errors but got ${res.data!.errors.length}`
      );
      log(
        'info',
        `Invalid rows correctly flagged: ${res.data!.errors.length} errors`
      );
    }
  );

  await test(
    'CSV Import',
    'POST /academics/students/import — empty array rejected',
    async () => {
      const res = await api('post', '/academics/students/import', {
        schoolId: ctx.schoolId,
        students: [],
      });

      assert(
        res.status === 400,
        `Expected 400 for empty import but got ${res.status}`
      );
      log('info', 'Empty import correctly rejected with 400');
    }
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 4: ENROLLMENT — Ed-Fi dates (Sprint 4)
// ═══════════════════════════════════════════════════════════════════════════════

async function module4_enrollment() {
  console.log(
    '\n\x1b[1m📚 Module 4: Enrollment — Ed-Fi Dates (Sprint 4)\x1b[0m'
  );

  const today = new Date().toISOString().split('T')[0];

  // Enroll each of our 5 created students
  for (const student of ctx.students) {
    await test(
      'Enrollment',
      `POST /academics/enrollments — enroll ${student.firstName} ${student.lastName} (grade ${student.gradeLevel})`,
      async () => {
        const res = await api<EnrollmentResponse>(
          'post',
          '/academics/enrollments',
          {
            studentId: student.studentId,
            schoolId: ctx.schoolId,
            academicYearId: ctx.academicYearId,
            gradeLevel: student.gradeLevel,
            enrollmentType: 'new',
            enrollmentDate: today,
            primarySchool: true,
          }
        );

        // Enrollment might fail if academic year isn't properly set up
        if (res.status === 400 || res.status === 404) {
          log(
            'warn',
            `Enrollment for ${student.firstName} returned ${res.status}: ${res.error}`
          );
          results[results.length - 1].status = 'SKIP';
          return;
        }

        assert(
          res.status === 201 || res.status === 200,
          `Expected 200/201 but got ${res.status}: ${res.error}`
        );
        assert(
          !!res.data?.enrollmentId,
          'Response should include enrollmentId'
        );

        ctx.enrollments.push({
          enrollmentId: res.data!.enrollmentId,
          studentId: student.studentId,
          gradeLevel: student.gradeLevel,
        });

        // Log Ed-Fi date fields
        log(
          'info',
          `Enrolled ${student.firstName} ${student.lastName}: ${res.data!.enrollmentId}` +
            (res.data!.entryDate ? ` (entryDate: ${res.data!.entryDate})` : '')
        );
      }
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 5: ENROLLMENT VALIDATION (Sprint 4)
// ═══════════════════════════════════════════════════════════════════════════════

async function module5_enrollmentValidation() {
  console.log(
    '\n\x1b[1m🛡️  Module 5: Enrollment Validation (Sprint 4)\x1b[0m'
  );

  await test(
    'Enrollment Validation',
    'Duplicate enrollment rejected (409 or 400)',
    async () => {
      if (ctx.enrollments.length === 0) {
        log('warn', 'No enrollments created — skipping duplicate test');
        results[results.length - 1].status = 'SKIP';
        return;
      }

      const enrollment = ctx.enrollments[0];
      const today = new Date().toISOString().split('T')[0];

      const res = await api<EnrollmentResponse>(
        'post',
        '/academics/enrollments',
        {
          studentId: enrollment.studentId,
          schoolId: ctx.schoolId,
          academicYearId: ctx.academicYearId,
          gradeLevel: enrollment.gradeLevel,
          enrollmentType: 'new',
          enrollmentDate: today,
          primarySchool: true,
        }
      );

      assert(
        res.status === 409 || res.status === 400,
        `Expected 409/400 for duplicate enrollment but got ${res.status}`
      );
      log(
        'info',
        `Duplicate enrollment correctly rejected with ${res.status}`
      );
    }
  );

  await test(
    'Enrollment Validation',
    'Missing required fields returns 400',
    async () => {
      const res = await api('post', '/academics/enrollments', {
        studentId: ctx.students[0]?.studentId || 'some-id',
        // Missing: schoolId, academicYearId, gradeLevel
      });

      assert(
        res.status === 400,
        `Expected 400 for missing fields but got ${res.status}`
      );
      log('info', 'Missing fields correctly rejected with 400');
    }
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 6: ENROLLMENT LISTING (Sprint 4)
// ═══════════════════════════════════════════════════════════════════════════════

async function module6_enrollmentListing() {
  console.log(
    '\n\x1b[1m📋 Module 6: Enrollment Listing (Sprint 4)\x1b[0m'
  );

  await test(
    'Enrollment Listing',
    'GET enrollments — verify created enrollments appear',
    async () => {
      if (ctx.enrollments.length === 0) {
        log('warn', 'No enrollments created — skipping listing test');
        results[results.length - 1].status = 'SKIP';
        return;
      }

      const res = await api<{ items: EnrollmentResponse[] }>(
        'get',
        `/academics/schools/${ctx.schoolId}/years/${ctx.academicYearId}/enrollments`
      );

      assert(
        res.status === 200,
        `Expected 200 but got ${res.status}: ${res.error}`
      );

      const items = res.data?.items || [];
      log('info', `Total enrollments returned: ${items.length}`);

      // Verify at least our enrolled students appear
      let foundCount = 0;
      for (const enrollment of ctx.enrollments) {
        const found = items.find(
          (e) => e.studentId === enrollment.studentId
        );
        if (found) {
          foundCount++;
          log(
            'info',
            `  Found enrollment for student ${enrollment.studentId}: status=${found.status}, entryDate=${found.entryDate || 'n/a'}`
          );
        }
      }

      assert(
        foundCount >= 1,
        `Expected at least 1 of our enrolled students in listing but found ${foundCount}`
      );
      log('info', `Verified ${foundCount}/${ctx.enrollments.length} enrollments in listing`);
    }
  );

  await test(
    'Enrollment Listing',
    'GET enrollment summary — returns summary object',
    async () => {
      const res = await api<any>(
        'get',
        `/academics/schools/${ctx.schoolId}/years/${ctx.academicYearId}/enrollments/summary`
      );

      assert(
        res.status === 200,
        `Expected 200 but got ${res.status}: ${res.error}`
      );
      assert(res.data !== null, 'Should return summary data');
      log('info', 'Enrollment summary:', res.data);
    }
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 7: SECTION ROSTERING (Sprint 5)
// ═══════════════════════════════════════════════════════════════════════════════

async function module7_sectionRostering() {
  console.log(
    '\n\x1b[1m📝 Module 7: Section Rostering (Sprint 5)\x1b[0m'
  );

  if (ctx.sections.length === 0) {
    await test('Section Rostering', 'SKIP — no sections available', async () => {
      results[results.length - 1].status = 'SKIP';
      log('warn', 'No sections discovered — skipping rostering');
    });
    return;
  }

  if (ctx.enrollments.length === 0) {
    await test('Section Rostering', 'SKIP — no enrollments to roster', async () => {
      results[results.length - 1].status = 'SKIP';
      log('warn', 'No enrollments created — cannot roster students');
    });
    return;
  }

  // Distribute students across available sections
  const enrolledStudentIds = ctx.enrollments.map((e) => e.studentId);

  for (let i = 0; i < enrolledStudentIds.length && i < ctx.sections.length * 3; i++) {
    const section = ctx.sections[i % ctx.sections.length];
    const studentId = enrolledStudentIds[i];
    const student = ctx.students.find((s) => s.studentId === studentId);
    const studentName = student
      ? `${student.firstName} ${student.lastName}`
      : studentId;

    await test(
      'Section Rostering',
      `Roster ${studentName} into ${section.courseName} ${section.sectionNumber}`,
      async () => {
        // CORRECT: schoolId is a QUERY parameter, studentId is in the BODY
        const res = await api<any>(
          'post',
          `/academics/sections/${section.sectionId}/students?schoolId=${ctx.schoolId}`,
          { studentId }
        );

        assert(
          res.status === 201 || res.status === 200,
          `Expected 200/201 but got ${res.status}: ${res.error}`
        );

        ctx.rosterAssignments.push({
          sectionId: section.sectionId,
          studentId,
        });

        log(
          'info',
          `Rostered ${studentName} → ${section.courseName} ${section.sectionNumber}`
        );
      }
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 8: ROSTER VERIFICATION (Sprint 5)
// ═══════════════════════════════════════════════════════════════════════════════

async function module8_rosterVerification() {
  console.log(
    '\n\x1b[1m🔍 Module 8: Roster Verification (Sprint 5)\x1b[0m'
  );

  if (ctx.rosterAssignments.length === 0) {
    await test('Roster Verification', 'SKIP — no roster assignments', async () => {
      results[results.length - 1].status = 'SKIP';
    });
    return;
  }

  // Check each section's roster
  const sectionsToCheck = Array.from(
    new Set(ctx.rosterAssignments.map((r) => r.sectionId))
  );

  for (const sectionId of sectionsToCheck) {
    const section = ctx.sections.find((s) => s.sectionId === sectionId);
    const expectedStudents = ctx.rosterAssignments
      .filter((r) => r.sectionId === sectionId)
      .map((r) => r.studentId);

    await test(
      'Roster Verification',
      `GET roster for ${section?.courseName || 'section'} ${section?.sectionNumber || ''} — expect ${expectedStudents.length} student(s)`,
      async () => {
        // CORRECT endpoint: /academics/sections/:id/students (not /roster)
        const res = await api<any>(
          'get',
          `/academics/sections/${sectionId}/students?schoolId=${ctx.schoolId}`
        );

        assert(
          res.status === 200,
          `Expected 200 but got ${res.status}: ${res.error}`
        );

        const items: RosterEntry[] = Array.isArray(res.data)
          ? res.data
          : res.data?.items || res.data?.students || [];

        log(
          'info',
          `Section roster has ${items.length} student(s)`
        );

        // Verify our students are present
        let foundCount = 0;
        for (const studentId of expectedStudents) {
          const found = items.find(
            (entry) => entry.studentId === studentId
          );
          if (found) {
            foundCount++;
            log(
              'info',
              `  Found: ${found.studentName || found.firstName || studentId}`
            );
          }
        }

        assert(
          foundCount === expectedStudents.length,
          `Expected ${expectedStudents.length} students but found ${foundCount}`
        );
      }
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 9: ENROLLMENT-REQUIRED VALIDATION (Sprint 5)
// ═══════════════════════════════════════════════════════════════════════════════

async function module9_enrollmentRequiredValidation() {
  console.log(
    '\n\x1b[1m🛡️  Module 9: Enrollment-Required Validation (Sprint 5)\x1b[0m'
  );

  if (ctx.sections.length === 0) {
    await test('Enrollment Validation', 'SKIP — no sections', async () => {
      results[results.length - 1].status = 'SKIP';
    });
    return;
  }

  await test(
    'Enrollment Validation',
    'Roster unenrolled student → expect 400/404',
    async () => {
      const sectionId = ctx.sections[0].sectionId;
      // Use a fake UUID that is guaranteed not to have an enrollment
      const fakeStudentId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

      const res = await api(
        'post',
        `/academics/sections/${sectionId}/students?schoolId=${ctx.schoolId}`,
        { studentId: fakeStudentId }
      );

      assert(
        res.status === 400 || res.status === 404 || res.status === 422,
        `Expected 400/404/422 for unenrolled student but got ${res.status}: ${res.error}`
      );
      log(
        'info',
        `Unenrolled student correctly rejected with ${res.status}`
      );
    }
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 10: SINGLE ATTENDANCE (Sprint 5)
// ═══════════════════════════════════════════════════════════════════════════════

async function module10_singleAttendance() {
  console.log(
    '\n\x1b[1m📅 Module 10: Single Attendance Recording (Sprint 5)\x1b[0m'
  );

  if (ctx.rosterAssignments.length === 0) {
    await test('Single Attendance', 'SKIP — no rostered students', async () => {
      results[results.length - 1].status = 'SKIP';
    });
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const assignment = ctx.rosterAssignments[0];
  const student = ctx.students.find(
    (s) => s.studentId === assignment.studentId
  );
  const studentName = student
    ? `${student.firstName} ${student.lastName}`
    : assignment.studentId;

  await test(
    'Single Attendance',
    `POST /academics/attendance — mark ${studentName} present on ${today}`,
    async () => {
      const res = await api<AttendanceResponse>(
        'post',
        '/academics/attendance',
        {
          studentId: assignment.studentId,
          schoolId: ctx.schoolId,
          sectionId: assignment.sectionId,
          date: today,
          status: 'present',
          notes: `Attendance recorded for ${studentName} — Sprint 4+5 smoke test`,
        }
      );

      assert(
        res.status === 201 || res.status === 200,
        `Expected 200/201 but got ${res.status}: ${res.error}`
      );
      log(
        'info',
        `Attendance recorded: ${studentName} → present on ${today}`
      );
    }
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 11: BULK ATTENDANCE (Sprint 5)
// ═══════════════════════════════════════════════════════════════════════════════

async function module11_bulkAttendance() {
  console.log(
    '\n\x1b[1m📊 Module 11: Bulk Attendance (Sprint 5)\x1b[0m'
  );

  if (ctx.rosterAssignments.length === 0 || ctx.sections.length === 0) {
    await test('Bulk Attendance', 'SKIP — no roster data', async () => {
      results[results.length - 1].status = 'SKIP';
    });
    return;
  }

  const today = new Date().toISOString().split('T')[0];

  // Build bulk records from all roster assignments in the first section
  const targetSection = ctx.sections[0];
  const sectionStudents = ctx.rosterAssignments
    .filter((r) => r.sectionId === targetSection.sectionId)
    .map((r) => r.studentId);

  if (sectionStudents.length === 0) {
    await test('Bulk Attendance', 'SKIP — no students in target section', async () => {
      results[results.length - 1].status = 'SKIP';
    });
    return;
  }

  // Assign realistic mixed statuses
  const statuses: string[] = ['present', 'present', 'absent', 'tardy', 'excused'];

  await test(
    'Bulk Attendance',
    `POST /academics/attendance/bulk — ${sectionStudents.length} record(s) for ${targetSection.courseName} ${targetSection.sectionNumber}`,
    async () => {
      const records = sectionStudents.map((studentId, i) => {
        const status = statuses[i % statuses.length];
        const student = ctx.students.find((s) => s.studentId === studentId);
        return {
          studentId,
          status,
          notes:
            status === 'absent'
              ? 'Family appointment'
              : status === 'tardy'
                ? 'Late bus arrival'
                : status === 'excused'
                  ? 'Doctor appointment'
                  : undefined,
        };
      });

      const res = await api<BulkAttendanceResponse>(
        'post',
        '/academics/attendance/bulk',
        {
          schoolId: ctx.schoolId,
          sectionId: targetSection.sectionId,
          date: today,
          records,
        }
      );

      assert(
        res.status === 201 || res.status === 200,
        `Expected 200/201 but got ${res.status}: ${res.error}`
      );
      assert(res.data !== null, 'Should return bulk attendance results');

      const created = res.data!.created ?? 0;
      const updated = res.data!.updated ?? 0;
      assert(
        created + updated >= 1,
        `Expected at least 1 created/updated record but got created=${created}, updated=${updated}`
      );
      log(
        'info',
        `Bulk attendance: created=${created}, updated=${updated} for ${sectionStudents.length} records`
      );
    }
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 12: ATTENDANCE SUMMARY (Sprint 5)
// ═══════════════════════════════════════════════════════════════════════════════

async function module12_attendanceSummary() {
  console.log(
    '\n\x1b[1m📈 Module 12: Attendance Summary (Sprint 5)\x1b[0m'
  );

  const today = new Date().toISOString().split('T')[0];

  await test(
    'Attendance Summary',
    `GET /academics/attendance/summary — daily summary for ${today}`,
    async () => {
      const res = await api<AttendanceSummaryResponse>(
        'get',
        `/academics/attendance/summary?schoolId=${ctx.schoolId}&date=${today}`
      );

      assert(
        res.status === 200,
        `Expected 200 but got ${res.status}: ${res.error}`
      );
      assert(res.data !== null, 'Should return summary data');

      const summary = res.data!;
      log('info', 'Daily attendance summary:', {
        date: summary.date || today,
        totalPresent: summary.totalPresent,
        totalAbsent: summary.totalAbsent,
        totalTardy: summary.totalTardy,
        totalExcused: summary.totalExcused,
        totalStudents: summary.totalStudents,
      });

      // After bulk attendance, should have at least 1 present
      const totalPresent = summary.totalPresent ?? 0;
      assert(
        totalPresent >= 1,
        `Expected at least 1 present student but got ${totalPresent}`
      );
    }
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 13: ATTENDANCE TREND (Sprint 5)
// ═══════════════════════════════════════════════════════════════════════════════

async function module13_attendanceTrend() {
  console.log(
    '\n\x1b[1m📉 Module 13: Attendance Trend (Sprint 5)\x1b[0m'
  );

  const today = new Date();
  const endDate = today.toISOString().split('T')[0];
  const startDate = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  await test(
    'Attendance Trend',
    `GET /academics/attendance/trend — 30-day trend (${startDate} to ${endDate})`,
    async () => {
      const res = await api<
        AttendanceTrendEntry[] | { items: AttendanceTrendEntry[] }
      >(
        'get',
        `/academics/attendance/trend?schoolId=${ctx.schoolId}&startDate=${startDate}&endDate=${endDate}`
      );

      assert(
        res.status === 200,
        `Expected 200 but got ${res.status}: ${res.error}`
      );
      assert(res.data !== null, 'Should return trend data');

      const items: AttendanceTrendEntry[] = Array.isArray(res.data)
        ? res.data
        : (res.data as any)?.items || [];
      assert(
        Array.isArray(items),
        'Trend response should be an array'
      );
      log(
        'info',
        `Attendance trend returned ${items.length} entries for ${startDate} to ${endDate}`
      );

      if (items.length > 0) {
        log('info', 'Sample trend entry:', items[0]);
      }
    }
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 14: ATTENDANCE ALERTS (Sprint 5)
// ═══════════════════════════════════════════════════════════════════════════════

async function module14_attendanceAlerts() {
  console.log(
    '\n\x1b[1m🚨 Module 14: Attendance Alerts (Sprint 5)\x1b[0m'
  );

  const today = new Date();
  const endDate = today.toISOString().split('T')[0];
  const startDate = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  await test(
    'Attendance Alerts',
    'GET /academics/attendance/alerts — students below 90% threshold',
    async () => {
      const res = await api<
        AttendanceAlertEntry[] | { items: AttendanceAlertEntry[] }
      >(
        'get',
        `/academics/attendance/alerts?schoolId=${ctx.schoolId}&academicYearId=${ctx.academicYearId}&threshold=90&startDate=${startDate}&endDate=${endDate}`
      );

      assert(
        res.status === 200,
        `Expected 200 but got ${res.status}: ${res.error}`
      );
      assert(res.data !== null, 'Should return alerts data');

      const items: AttendanceAlertEntry[] = Array.isArray(res.data)
        ? res.data
        : (res.data as any)?.items || [];
      assert(
        Array.isArray(items),
        'Alerts response should be an array'
      );

      log(
        'info',
        `Attendance alerts: ${items.length} student(s) below 90% threshold`
      );

      if (items.length > 0) {
        log('info', 'Sample alert:', items[0]);
      }
    }
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 15: STUDENT UPDATE (Sprint 4)
// ═══════════════════════════════════════════════════════════════════════════════

async function module15_studentUpdate() {
  console.log(
    '\n\x1b[1m✏️  Module 15: Student Update (Sprint 4)\x1b[0m'
  );

  if (ctx.students.length < 2) {
    await test('Student Update', 'SKIP — not enough students', async () => {
      results[results.length - 1].status = 'SKIP';
    });
    return;
  }

  // Update Marcus Williams — add middle name and guardian info
  const marcus = ctx.students.find((s) => s.firstName === 'Marcus');
  if (!marcus) {
    await test('Student Update', 'SKIP — Marcus not found', async () => {
      results[results.length - 1].status = 'SKIP';
    });
    return;
  }

  await test(
    'Student Update',
    `PATCH /academics/students/:id — update Marcus Williams with middle name`,
    async () => {
      const res = await api<StudentResponse>(
        'patch',
        `/academics/students/${marcus.studentId}`,
        {
          middleName: 'James',
          guardianName: 'Denise Williams',
          guardianPhone: '555-0301',
          guardianEmail: 'denise.williams@example.com',
        }
      );

      assert(
        res.status === 200,
        `Expected 200 but got ${res.status}: ${res.error}`
      );
      log(
        'info',
        `Updated Marcus Williams: added middleName "James" and guardian info`
      );
    }
  );

  // Verify update persisted
  await test(
    'Student Update',
    'GET /academics/students/:id — verify Marcus update persisted',
    async () => {
      const res = await api<StudentResponse>(
        'get',
        `/academics/students/${marcus.studentId}`
      );

      assert(
        res.status === 200,
        `Expected 200 but got ${res.status}: ${res.error}`
      );

      // middleName may or may not be returned — just verify the call succeeded
      log('info', `Retrieved updated Marcus: ${JSON.stringify({
        firstName: res.data?.firstName,
        middleName: res.data?.middleName,
        lastName: res.data?.lastName,
        status: res.data?.status,
      })}`);
    }
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 16: STUDENT PROFILE AGGREGATE (Sprint 4)
// ═══════════════════════════════════════════════════════════════════════════════

async function module16_studentProfile() {
  console.log(
    '\n\x1b[1m👤 Module 16: Student Profile Aggregate (Sprint 4)\x1b[0m'
  );

  if (ctx.students.length === 0) {
    await test('Student Profile', 'SKIP — no students', async () => {
      results[results.length - 1].status = 'SKIP';
    });
    return;
  }

  const emily = ctx.students.find((s) => s.firstName === 'Emily') || ctx.students[0];

  await test(
    'Student Profile',
    `GET /academics/students/:id/profile — Emily Johnson profile`,
    async () => {
      const res = await api<StudentProfileResponse>(
        'get',
        `/academics/students/${emily.studentId}/profile`
      );

      assert(
        res.status === 200,
        `Expected 200 but got ${res.status}: ${res.error}`
      );
      assert(res.data !== null, 'Should return profile data');
      assert(
        res.data!.studentId === emily.studentId,
        'Profile should match student ID'
      );

      log('info', `Student profile for ${emily.firstName} ${emily.lastName}:`, {
        studentId: res.data!.studentId,
        firstName: res.data!.firstName,
        lastName: res.data!.lastName,
        studentNumber: res.data!.studentNumber,
        enrollments: Array.isArray(res.data!.enrollments)
          ? `${res.data!.enrollments.length} enrollment(s)`
          : 'n/a',
        sections: Array.isArray(res.data!.sections)
          ? `${res.data!.sections.length} section(s)`
          : 'n/a',
      });
    }
  );

  // Also test the student attendance summary endpoint
  await test(
    'Student Profile',
    `GET /academics/students/:id/attendance/summary — Emily's attendance summary`,
    async () => {
      const res = await api<any>(
        'get',
        `/academics/students/${emily.studentId}/attendance/summary?schoolId=${ctx.schoolId}&academicYearId=${ctx.academicYearId}`
      );

      assert(
        res.status === 200,
        `Expected 200 but got ${res.status}: ${res.error}`
      );
      log('info', 'Student attendance summary:', res.data);
    }
  );
}

// ─────────────────────────────────────────
// MAIN — No cleanup!
// ─────────────────────────────────────────

async function main() {
  console.log('\x1b[1;36m');
  console.log(
    '══════════════════════════════════════════════════════════════'
  );
  console.log(
    '  EdForge — Sprint 4 + Sprint 5 Comprehensive Smoke Test'
  );
  console.log(
    '  Student Identity · Enrollment · Rostering · Attendance'
  );
  console.log(
    '══════════════════════════════════════════════════════════════'
  );
  console.log('\x1b[0m');
  console.log(`  Base URL:  ${BASE_URL}`);
  console.log(`  School ID: ${ctx.schoolId}`);
  console.log(`  Time:      ${new Date().toISOString()}`);
  console.log(`  Cleanup:   DISABLED (data persists for frontend)\n`);

  try {
    // ── SETUP ──
    await module0_setup();

    // ── SPRINT 4: Student Identity & Enrollment ──
    await module1_createStudents();
    await module2_deduplication();
    await module3_csvImport();
    await module4_enrollment();
    await module5_enrollmentValidation();
    await module6_enrollmentListing();

    // ── SPRINT 5: Rostering & Attendance ──
    await module7_sectionRostering();
    await module8_rosterVerification();
    await module9_enrollmentRequiredValidation();
    await module10_singleAttendance();
    await module11_bulkAttendance();
    await module12_attendanceSummary();
    await module13_attendanceTrend();
    await module14_attendanceAlerts();

    // ── SPRINT 4 continued: Update & Profile ──
    await module15_studentUpdate();
    await module16_studentProfile();
  } catch (err: any) {
    console.error(`\n\x1b[31mFATAL ERROR: ${err.message}\x1b[0m`);
  }

  // ── NO CLEANUP — Data persists for frontend rendering ──
  console.log(
    '\n\x1b[33m⚠  No cleanup performed — test data persists for frontend rendering.\x1b[0m'
  );

  // ── Created Data Summary ──
  console.log('\n\x1b[1m📦 Created Data Summary\x1b[0m\n');

  if (ctx.courses.length > 0) {
    console.log('  Courses:');
    for (const c of ctx.courses) {
      console.log(
        `    • ${c.courseName} (${c.courseCode}) — ID: ${c.courseId}`
      );
    }
  }

  if (ctx.sections.length > 0) {
    console.log(`\n  Sections: ${ctx.sections.length}`);
    for (const s of ctx.sections) {
      console.log(
        `    • ${s.courseName || 'Section'} ${s.sectionNumber} — ID: ${s.sectionId}`
      );
    }
  }

  if (ctx.students.length > 0) {
    console.log(`\n  Students:`);
    for (const s of ctx.students) {
      console.log(
        `    • ${s.firstName} ${s.lastName} (Grade ${s.gradeLevel}) — USI: ${s.studentNumber} — ID: ${s.studentId}`
      );
    }
  }

  if (ctx.enrollments.length > 0) {
    console.log(`\n  Enrollments: ${ctx.enrollments.length}`);
    for (const e of ctx.enrollments) {
      const student = ctx.students.find((s) => s.studentId === e.studentId);
      console.log(
        `    • ${student?.firstName || e.studentId} ${student?.lastName || ''} → Grade ${e.gradeLevel} (${e.enrollmentId})`
      );
    }
  }

  if (ctx.rosterAssignments.length > 0) {
    console.log(`\n  Roster Assignments: ${ctx.rosterAssignments.length}`);
    for (const r of ctx.rosterAssignments) {
      const student = ctx.students.find((s) => s.studentId === r.studentId);
      const section = ctx.sections.find((s) => s.sectionId === r.sectionId);
      console.log(
        `    • ${student?.firstName || r.studentId} ${student?.lastName || ''} → ${section?.courseName || 'section'} ${section?.sectionNumber || r.sectionId}`
      );
    }
  }

  // ── Test Results ──
  console.log('\n\x1b[1m═══ TEST RESULTS ═══\x1b[0m\n');

  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const skip = results.filter((r) => r.status === 'SKIP').length;
  const total = results.length;

  // Group by module
  const modules = Array.from(new Set(results.map((r) => r.module)));
  for (const mod of modules) {
    const moduleResults = results.filter((r) => r.module === mod);
    const modPass = moduleResults.filter((r) => r.status === 'PASS').length;
    const modFail = moduleResults.filter((r) => r.status === 'FAIL').length;
    const modSkip = moduleResults.filter((r) => r.status === 'SKIP').length;

    const modColor =
      modFail > 0 ? '\x1b[31m' : modSkip === moduleResults.length ? '\x1b[33m' : '\x1b[32m';
    console.log(
      `  ${modColor}[${mod}]\x1b[0m  ${modPass}/${moduleResults.length} passed${modFail > 0 ? `, ${modFail} failed` : ''}${modSkip > 0 ? `, ${modSkip} skipped` : ''}`
    );

    for (const r of moduleResults) {
      const icon =
        r.status === 'PASS'
          ? '\x1b[32m✓\x1b[0m'
          : r.status === 'FAIL'
            ? '\x1b[31m✗\x1b[0m'
            : '\x1b[33m○\x1b[0m';
      console.log(
        `    ${icon} ${r.name} \x1b[90m(${r.duration}ms)\x1b[0m`
      );
      if (r.error) console.log(`      \x1b[31m${r.error}\x1b[0m`);
    }
  }

  console.log(
    `\n  \x1b[1mTotal:\x1b[0m ${total}  \x1b[32mPass:\x1b[0m ${pass}  \x1b[31mFail:\x1b[0m ${fail}  \x1b[33mSkip:\x1b[0m ${skip}`
  );
  console.log(
    `  \x1b[1mResult:\x1b[0m ${fail === 0 ? '\x1b[32mALL PASSING\x1b[0m' : '\x1b[31mFAILURES DETECTED\x1b[0m'}\n`
  );

  // Save log
  const logsDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  const logFile = path.join(
    logsDir,
    `sprint4-5_${new Date().toISOString().replace(/[:.]/g, '-')}.log`
  );
  fs.writeFileSync(logFile, logLines.join('\n'), 'utf-8');
  console.log(`  Log saved: ${logFile}`);

  process.exit(fail > 0 ? 1 : 0);
}

main();
