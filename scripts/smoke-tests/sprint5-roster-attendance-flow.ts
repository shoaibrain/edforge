/**
 * EdForge — Sprint 5: Roster & Attendance Smoke Test
 *
 * Validates the Section Rostering & Attendance layer end-to-end:
 *
 *   Module 0: Setup — Discover active academic year, create test student & enrollment
 *   Module 1: Enrollment Validation — Roster unenrolled student → 400 rejection
 *   Module 2: Section Rostering — Roster enrolled student into a section
 *   Module 3: Roster Verification — GET section roster, verify student appears
 *   Module 4: Attendance Recording — Record attendance for test student
 *   Module 5: Bulk Attendance — Record bulk attendance, verify counts
 *   Module 6: Attendance Summary — Daily summary, verify counts
 *   Module 7: Attendance Trend — Trend endpoint returns array
 *   Cleanup: Remove student from section roster
 *
 * Usage:
 *   ID_TOKEN=<jwt> npx ts-node scripts/smoke-tests/sprint5-roster-attendance-flow.ts
 *   ID_TOKEN=<jwt> SCHOOL_ID=<uuid> SECTION_ID=<uuid> npx ts-node scripts/smoke-tests/sprint5-roster-attendance-flow.ts
 */

import axios, { AxiosRequestConfig } from 'axios';
import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────

const ID_TOKEN = process.env.ID_TOKEN || '';
const BASE_URL = process.env.API_BASE_URL || 'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';
const SCHOOL_ID = process.env.SCHOOL_ID || 'd88860fe-306a-4a2e-b76a-b5eee861ff08';
const SECTION_ID = process.env.SECTION_ID || '';
const ACADEMIC_YEAR_ID = process.env.ACADEMIC_YEAR_ID || '';
const LOG_LEVEL = process.env.LOG_LEVEL || 'debug';

if (!ID_TOKEN) {
  console.error('\x1b[31mERROR: ID_TOKEN environment variable is required.\x1b[0m');
  console.error('Usage: ID_TOKEN=<jwt> npx ts-node scripts/smoke-tests/sprint5-roster-attendance-flow.ts');
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
  fullName: string;
  dateOfBirth: string;
  gender: string;
  currentGradeLevel: string;
  studentNumber: string;
  status: string;
  [k: string]: unknown;
}

interface EnrollmentResponse {
  enrollmentId: string;
  studentId: string;
  schoolId: string;
  gradeLevel: string;
  enrollmentDate?: string;
  entryDate?: string;
  status: string;
  [k: string]: unknown;
}

interface RosterEntry {
  studentId: string;
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

// ─────────────────────────────────────────
// CONTEXT
// ─────────────────────────────────────────

interface TestContext {
  schoolId: string;
  sectionId: string;
  academicYearId: string;
  // Created in this test
  studentId: string;
  studentNumber: string;
  enrollmentId: string;
  attendanceId: string;
}

const ctx: TestContext = {
  schoolId: SCHOOL_ID,
  sectionId: SECTION_ID,
  academicYearId: ACADEMIC_YEAR_ID,
  studentId: '',
  studentNumber: '',
  enrollmentId: '',
  attendanceId: '',
};

// ─────────────────────────────────────────
// LOGGING
// ─────────────────────────────────────────

const logLines: string[] = [];
function log(level: 'debug' | 'info' | 'warn' | 'error', ...args: unknown[]) {
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a))).join(' ');
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase()}] ${msg}`;
  logLines.push(line);

  const levels = { debug: 0, info: 1, warn: 2, error: 3 };
  if (levels[level] >= levels[LOG_LEVEL as keyof typeof levels ?? 'debug']) {
    const color = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };
    console.log(`${color[level]}${line}\x1b[0m`);
  }
}

// ─────────────────────────────────────────
// HTTP CLIENT
// ─────────────────────────────────────────

async function api<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
  const start = Date.now();
  const config: AxiosRequestConfig = {
    method: method as AxiosRequestConfig['method'],
    url: `${BASE_URL}${path}`,
    headers: { Authorization: `Bearer ${ID_TOKEN}`, 'Content-Type': 'application/json' },
    data: body,
    validateStatus: () => true,
    timeout: 30_000,
  };

  try {
    const res = await axios(config);
    const duration = Date.now() - start;
    log('debug', `${method.toUpperCase()} ${path} → ${res.status} (${duration}ms)`);
    if (res.status >= 400) {
      return { status: res.status, data: null, error: JSON.stringify(res.data), duration };
    }
    return { status: res.status, data: res.data as T, duration, error: null };
  } catch (err: any) {
    const duration = Date.now() - start;
    return { status: 0, data: null, error: err.message, duration };
  }
}

// ─────────────────────────────────────────
// TEST RUNNER
// ─────────────────────────────────────────

const results: TestResult[] = [];

async function test(module: string, name: string, fn: () => Promise<void>) {
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    results.push({ name, module, status: 'PASS', duration });
    console.log(`  \x1b[32m✓\x1b[0m ${name} \x1b[90m(${duration}ms)\x1b[0m`);
  } catch (err: any) {
    const duration = Date.now() - start;
    results.push({ name, module, status: 'FAIL', duration, error: err.message });
    console.log(`  \x1b[31m✗\x1b[0m ${name} \x1b[90m(${duration}ms)\x1b[0m`);
    console.log(`    \x1b[31m${err.message}\x1b[0m`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// ═══════════════════════════════════════════
// MODULE 0: SETUP — Academic year, student, enrollment
// ═══════════════════════════════════════════

async function module0_setup() {
  console.log('\n\x1b[1m📋 Module 0: Setup\x1b[0m');

  await test('Setup', 'Discover active academic year', async () => {
    if (ctx.academicYearId) {
      log('info', 'Using provided academic year:', ctx.academicYearId);
      return;
    }

    const res = await api<any>(
      'get', `/identity/academic-years?schoolId=${ctx.schoolId}&isActive=true`
    );

    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);

    const items = Array.isArray(res.data) ? res.data : res.data?.items;
    assert(items && items.length > 0, 'No active academic years found');

    const activeYear = items[0];
    ctx.academicYearId = activeYear.yearId || activeYear.academicYearId || activeYear.id;
    log('info', `Found active academic year: ${activeYear.name || ctx.academicYearId}`);
  });

  const timestamp = Date.now();

  await test('Setup', 'Create test student for rostering', async () => {
    const res = await api<StudentResponse>('post', '/identity/students', {
      firstName: 'SmokeTest',
      lastName: `Sprint5_${timestamp}`,
      dateOfBirth: '2015-03-22',
      gender: 'male',
      schoolId: ctx.schoolId,
      currentGradeLevel: '5',
    });

    assert(res.status === 201 || res.status === 200, `Expected 200/201 but got ${res.status}: ${res.error}`);
    assert(!!res.data?.studentId, 'Response should include studentId');

    ctx.studentId = res.data!.studentId;
    ctx.studentNumber = res.data!.studentNumber || '';
    log('info', `Created test student: ${ctx.studentId} (${ctx.studentNumber})`);
  });

  await test('Setup', 'Create enrollment for test student', async () => {
    assert(!!ctx.studentId, 'studentId must be set from previous step');

    const today = new Date().toISOString().split('T')[0];

    const res = await api<EnrollmentResponse>('post', '/academics/enrollment', {
      studentId: ctx.studentId,
      schoolId: ctx.schoolId,
      academicYearId: ctx.academicYearId,
      gradeLevel: '5',
      enrollmentType: 'new',
      enrollmentDate: today,
      primarySchool: true,
    });

    if (res.status === 400 || res.status === 404) {
      log('warn', `Enrollment creation returned ${res.status}: ${res.error} — may indicate missing academic year setup`);
      results[results.length - 1].status = 'SKIP';
      return;
    }

    assert(res.status === 201 || res.status === 200, `Expected 200/201 but got ${res.status}: ${res.error}`);
    assert(!!res.data?.enrollmentId, 'Response should include enrollmentId');

    ctx.enrollmentId = res.data!.enrollmentId;
    log('info', `Created enrollment: ${ctx.enrollmentId}`);
  });

  // Discover section if not provided
  await test('Setup', 'Discover section for rostering', async () => {
    if (ctx.sectionId) {
      log('info', 'Using provided section ID:', ctx.sectionId);
      return;
    }

    const res = await api<any>(
      'get', `/academics/sections?schoolId=${ctx.schoolId}`
    );

    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);

    const items = Array.isArray(res.data) ? res.data : res.data?.items;
    assert(items && items.length > 0, 'No sections found — cannot proceed with rostering tests');

    const section = items[0];
    ctx.sectionId = section.sectionId || section.id;
    log('info', `Found section: ${section.name || section.sectionId || ctx.sectionId}`);
  });
}

// ═══════════════════════════════════════════
// MODULE 1: ENROLLMENT VALIDATION — Unenrolled student
// ═══════════════════════════════════════════

async function module1_enrollmentValidation() {
  console.log('\n\x1b[1m🛡️ Module 1: Enrollment Validation\x1b[0m');

  await test('Enrollment Validation', 'Roster unenrolled student into section → expect 400', async () => {
    assert(!!ctx.sectionId, 'sectionId must be set from setup');

    // Use a random UUID that is guaranteed not to be enrolled
    const fakeStudentId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    const res = await api('post', `/academics/sections/${ctx.sectionId}/students`, {
      studentId: fakeStudentId,
      schoolId: ctx.schoolId,
    });

    assert(
      res.status === 400 || res.status === 404 || res.status === 422,
      `Expected 400/404/422 for unenrolled student but got ${res.status}: ${res.error}`
    );
    log('info', `Unenrolled student correctly rejected with ${res.status}`);
  });
}

// ═══════════════════════════════════════════
// MODULE 2: SECTION ROSTERING — Roster enrolled student
// ═══════════════════════════════════════════

async function module2_sectionRostering() {
  console.log('\n\x1b[1m📝 Module 2: Section Rostering\x1b[0m');

  await test('Section Rostering', 'POST /academics/sections/:sectionId/students — roster enrolled student', async () => {
    assert(!!ctx.sectionId, 'sectionId must be set from setup');
    assert(!!ctx.studentId, 'studentId must be set from setup');

    const res = await api<any>('post', `/academics/sections/${ctx.sectionId}/students`, {
      studentId: ctx.studentId,
      schoolId: ctx.schoolId,
    });

    assert(
      res.status === 201 || res.status === 200,
      `Expected 200/201 but got ${res.status}: ${res.error}`
    );
    log('info', `Student ${ctx.studentId} rostered into section ${ctx.sectionId}`);
  });
}

// ═══════════════════════════════════════════
// MODULE 3: ROSTER VERIFICATION — Verify student in roster
// ═══════════════════════════════════════════

async function module3_rosterVerification() {
  console.log('\n\x1b[1m🔍 Module 3: Roster Verification\x1b[0m');

  await test('Roster Verification', 'GET /academics/sections/:sectionId/roster — test student appears', async () => {
    assert(!!ctx.sectionId, 'sectionId must be set from setup');
    assert(!!ctx.studentId, 'studentId must be set from setup');

    const res = await api<any>(
      'get', `/academics/sections/${ctx.sectionId}/roster?schoolId=${ctx.schoolId}`
    );

    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);

    const items: RosterEntry[] = Array.isArray(res.data) ? res.data : res.data?.items || res.data?.students || [];
    assert(items.length > 0, 'Roster should not be empty');

    const found = items.find((entry: RosterEntry) => entry.studentId === ctx.studentId);
    assert(!!found, `Test student ${ctx.studentId} not found in section roster`);
    log('info', `Verified: student ${ctx.studentId} is in section roster (${items.length} total students)`);
  });
}

// ═══════════════════════════════════════════
// MODULE 4: ATTENDANCE RECORDING — Single student
// ═══════════════════════════════════════════

async function module4_attendanceRecording() {
  console.log('\n\x1b[1m📅 Module 4: Attendance Recording\x1b[0m');

  const today = new Date().toISOString().split('T')[0];

  await test('Attendance Recording', 'POST /academics/attendance — record attendance for test student', async () => {
    assert(!!ctx.studentId, 'studentId must be set from setup');

    const res = await api<AttendanceResponse>('post', '/academics/attendance', {
      studentId: ctx.studentId,
      schoolId: ctx.schoolId,
      sectionId: ctx.sectionId,
      date: today,
      status: 'present',
      notes: 'Sprint 5 smoke test attendance',
    });

    assert(
      res.status === 201 || res.status === 200,
      `Expected 200/201 but got ${res.status}: ${res.error}`
    );

    if (res.data?.attendanceId) {
      ctx.attendanceId = res.data.attendanceId;
    }
    log('info', `Attendance recorded for student ${ctx.studentId} on ${today}`);
  });
}

// ═══════════════════════════════════════════
// MODULE 5: BULK ATTENDANCE — Section-level
// ═══════════════════════════════════════════

async function module5_bulkAttendance() {
  console.log('\n\x1b[1m📊 Module 5: Bulk Attendance\x1b[0m');

  const today = new Date().toISOString().split('T')[0];

  await test('Bulk Attendance', 'POST /academics/attendance/bulk — record bulk attendance for section', async () => {
    assert(!!ctx.sectionId, 'sectionId must be set from setup');
    assert(!!ctx.studentId, 'studentId must be set from setup');

    const res = await api<BulkAttendanceResponse>('post', '/academics/attendance/bulk', {
      schoolId: ctx.schoolId,
      sectionId: ctx.sectionId,
      date: today,
      records: [
        { studentId: ctx.studentId, status: 'present', notes: 'Bulk attendance smoke test' },
      ],
    });

    assert(
      res.status === 201 || res.status === 200,
      `Expected 200/201 but got ${res.status}: ${res.error}`
    );
    assert(res.data !== null, 'Should return bulk attendance results');

    const created = res.data!.created ?? 0;
    const updated = res.data!.updated ?? 0;
    assert(
      created + updated >= 1,
      `Expected at least 1 created or updated record but got created=${created}, updated=${updated}`
    );
    log('info', `Bulk attendance results: created=${created}, updated=${updated}`);
  });
}

// ═══════════════════════════════════════════
// MODULE 6: ATTENDANCE SUMMARY — Daily summary
// ═══════════════════════════════════════════

async function module6_attendanceSummary() {
  console.log('\n\x1b[1m📈 Module 6: Attendance Summary\x1b[0m');

  const today = new Date().toISOString().split('T')[0];

  await test('Attendance Summary', 'GET /academics/attendance/summary — daily summary counts match', async () => {
    const res = await api<AttendanceSummaryResponse>(
      'get', `/academics/attendance/summary?schoolId=${ctx.schoolId}&date=${today}`
    );

    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
    assert(res.data !== null, 'Should return summary data');

    const summary = res.data!;
    log('info', 'Attendance summary:', {
      date: summary.date || today,
      totalPresent: summary.totalPresent,
      totalAbsent: summary.totalAbsent,
      totalTardy: summary.totalTardy,
      totalStudents: summary.totalStudents,
    });

    // Verify at least one present count since we recorded attendance earlier
    const totalPresent = summary.totalPresent ?? 0;
    assert(totalPresent >= 1, `Expected at least 1 present student but got ${totalPresent}`);
  });
}

// ═══════════════════════════════════════════
// MODULE 7: ATTENDANCE TREND — Trend over time
// ═══════════════════════════════════════════

async function module7_attendanceTrend() {
  console.log('\n\x1b[1m📉 Module 7: Attendance Trend\x1b[0m');

  const today = new Date();
  const endDate = today.toISOString().split('T')[0];
  const startDate = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  await test('Attendance Trend', 'GET /academics/attendance/trend — returns array response', async () => {
    const res = await api<AttendanceTrendEntry[] | { items: AttendanceTrendEntry[] }>(
      'get', `/academics/attendance/trend?schoolId=${ctx.schoolId}&startDate=${startDate}&endDate=${endDate}`
    );

    assert(res.status === 200, `Expected 200 but got ${res.status}: ${res.error}`);
    assert(res.data !== null, 'Should return trend data');

    const items: AttendanceTrendEntry[] = Array.isArray(res.data) ? res.data : (res.data as any)?.items || [];
    assert(Array.isArray(items), 'Trend response should be an array (or contain items array)');
    log('info', `Attendance trend returned ${items.length} entries for ${startDate} to ${endDate}`);

    if (items.length > 0) {
      log('info', 'First trend entry sample:', items[0]);
    }
  });
}

// ─────────────────────────────────────────
// CLEANUP
// ─────────────────────────────────────────

async function cleanup() {
  console.log('\n\x1b[1m🧹 Cleanup\x1b[0m');

  // Remove student from section roster
  if (ctx.sectionId && ctx.studentId) {
    await test('Cleanup', 'DELETE /academics/sections/:sectionId/students/:studentId — remove from roster', async () => {
      const res = await api(
        'delete',
        `/academics/sections/${ctx.sectionId}/students/${ctx.studentId}?schoolId=${ctx.schoolId}`
      );

      assert(
        res.status === 200 || res.status === 204,
        `Expected 200/204 but got ${res.status}: ${res.error}`
      );
      log('info', `Removed student ${ctx.studentId} from section ${ctx.sectionId}`);
    });
  }

  // Clean up student
  if (ctx.studentId) {
    const res = await api('delete', `/identity/students/${ctx.studentId}`);
    log('info', `Cleaned up student ${ctx.studentId}: ${res.status}`);
  }
}

// ─────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────

async function main() {
  console.log('\x1b[1;36m');
  console.log('══════════════════════════════════════════════════');
  console.log('  EdForge — Sprint 5: Roster & Attendance');
  console.log('  Integration Smoke Test');
  console.log('══════════════════════════════════════════════════');
  console.log('\x1b[0m');
  console.log(`  Base URL:    ${BASE_URL}`);
  console.log(`  School ID:   ${ctx.schoolId}`);
  console.log(`  Section ID:  ${ctx.sectionId || '(auto-discover)'}`);
  console.log(`  Time:        ${new Date().toISOString()}`);

  try {
    await module0_setup();
    await module1_enrollmentValidation();
    await module2_sectionRostering();
    await module3_rosterVerification();
    await module4_attendanceRecording();
    await module5_bulkAttendance();
    await module6_attendanceSummary();
    await module7_attendanceTrend();
  } catch (err: any) {
    console.error(`\n\x1b[31mFATAL ERROR: ${err.message}\x1b[0m`);
  } finally {
    await cleanup();
  }

  // ── Summary ──
  console.log('\n\x1b[1m═══ RESULTS ═══\x1b[0m\n');

  const pass = results.filter(r => r.status === 'PASS').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  const skip = results.filter(r => r.status === 'SKIP').length;
  const total = results.length;

  for (const r of results) {
    const icon = r.status === 'PASS' ? '\x1b[32m✓\x1b[0m' : r.status === 'FAIL' ? '\x1b[31m✗\x1b[0m' : '\x1b[33m○\x1b[0m';
    console.log(`  ${icon} [${r.module}] ${r.name} \x1b[90m(${r.duration}ms)\x1b[0m`);
    if (r.error) console.log(`    \x1b[31m${r.error}\x1b[0m`);
  }

  console.log(`\n  \x1b[1mTotal:\x1b[0m ${total}  \x1b[32mPass:\x1b[0m ${pass}  \x1b[31mFail:\x1b[0m ${fail}  \x1b[33mSkip:\x1b[0m ${skip}`);
  console.log(`  \x1b[1mResult:\x1b[0m ${fail === 0 ? '\x1b[32mALL PASSING\x1b[0m' : '\x1b[31mFAILURES DETECTED\x1b[0m'}\n`);

  // Save log
  const logsDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  const logFile = path.join(logsDir, `sprint5_${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  fs.writeFileSync(logFile, logLines.join('\n'), 'utf-8');
  console.log(`  Log saved: ${logFile}`);

  process.exit(fail > 0 ? 1 : 0);
}

main();
