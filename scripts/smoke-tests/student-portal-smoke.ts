/**
 * EdForge — Student Portal Smoke Test
 *
 * Validates that a Student user can access their self-service endpoints:
 *
 *   1. GET /academics/students?schoolId=... (identity resolution — DataScope returns self only)
 *   2. GET /academics/students/:id/grades?schoolId=...
 *   3. GET /academics/students/:id/attendance/summary?schoolId=...
 *   4. GET /academics/students/:id/attendance?schoolId=...&startDate=...&endDate=...
 *   5. GET /academics/students/:id/sections?schoolId=...
 *   6. POST /academics/grades/record → should be 403 (students cannot create grades)
 *   7. GET /academics/students (admin list) → should return only self (DataScope filter)
 *
 * Usage:
 *   ID_TOKEN=<student-jwt> npx ts-node scripts/smoke-tests/student-portal-smoke.ts
 *   ID_TOKEN=<student-jwt> SCHOOL_ID=<uuid> npx ts-node scripts/smoke-tests/student-portal-smoke.ts
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

if (!ID_TOKEN) {
  console.error('\x1b[31mERROR: ID_TOKEN environment variable is required (must be a Student user JWT).\x1b[0m');
  console.error('Usage: ID_TOKEN=<student-jwt> npx ts-node scripts/smoke-tests/student-portal-smoke.ts');
  process.exit(1);
}

// ─────────────────────────────────────────
// TYPES
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

// ─────────────────────────────────────────
// API HELPER
// ─────────────────────────────────────────

const api = axios.create({
  baseURL: BASE_URL,
  headers: { Authorization: `Bearer ${ID_TOKEN}` },
  timeout: 15000,
  validateStatus: () => true,
});

async function apiCall<T = unknown>(config: AxiosRequestConfig): Promise<ApiResponse<T>> {
  const start = Date.now();
  try {
    const res = await api(config);
    return {
      status: res.status,
      data: res.status >= 200 && res.status < 300 ? (res.data as T) : null,
      error: res.status >= 400 ? JSON.stringify(res.data) : null,
      duration: Date.now() - start,
    };
  } catch (err: any) {
    return {
      status: 0,
      data: null,
      error: err.message,
      duration: Date.now() - start,
    };
  }
}

// ─────────────────────────────────────────
// TEST RUNNER
// ─────────────────────────────────────────

const results: TestResult[] = [];

async function test(name: string, module: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, module, status: 'PASS', duration: Date.now() - start });
    console.log(`  ✅ ${name} (${Date.now() - start}ms)`);
  } catch (err: any) {
    results.push({ name, module, status: 'FAIL', duration: Date.now() - start, error: err.message });
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// ─────────────────────────────────────────
// MODULE 1: STUDENT IDENTITY RESOLUTION
// ─────────────────────────────────────────

let studentId: string | null = null;

async function testIdentityResolution() {
  console.log('\n📋 Module 1: Student Identity Resolution');

  await test('GET /academics/students returns self via DataScope', 'Identity', async () => {
    const res = await apiCall<any>({
      method: 'GET',
      url: `/academics/students?schoolId=${SCHOOL_ID}&limit=10`,
    });
    assert(res.status === 200, `Expected 200, got ${res.status}: ${res.error}`);

    const items = res.data?.items || res.data?.data || (Array.isArray(res.data) ? res.data : []);
    assert(items.length >= 1, `Expected at least 1 student record (self), got ${items.length}`);
    assert(items.length <= 5, `DataScope should return only self, got ${items.length} records (possible admin access leak)`);

    studentId = items[0].studentId;
    assert(!!studentId, 'studentId should be present');
    console.log(`    Resolved studentId: ${studentId}`);
  });
}

// ─────────────────────────────────────────
// MODULE 2: GRADES ACCESS
// ─────────────────────────────────────────

async function testGradesAccess() {
  console.log('\n📋 Module 2: Grades Access');

  if (!studentId) {
    results.push({ name: 'Grades (skipped — no studentId)', module: 'Grades', status: 'SKIP', duration: 0 });
    console.log('  ⏭️  Skipped — studentId not resolved');
    return;
  }

  await test('GET /academics/students/:id/grades returns 200', 'Grades', async () => {
    const res = await apiCall<any>({
      method: 'GET',
      url: `/academics/students/${studentId}/grades?schoolId=${SCHOOL_ID}`,
    });
    assert(res.status === 200, `Expected 200, got ${res.status}: ${res.error}`);
    assert(res.data !== null, 'Response body should not be null');
    // grades may be empty array — that's OK
    const grades = res.data?.grades || [];
    console.log(`    Found ${grades.length} grade(s)`);
    if (res.data?.gpa) {
      console.log(`    GPA: ${res.data.gpa.cumulativeGpa}`);
    }
  });

  await test('Grades response has isFinal (not status) on each grade', 'Grades', async () => {
    const res = await apiCall<any>({
      method: 'GET',
      url: `/academics/students/${studentId}/grades?schoolId=${SCHOOL_ID}`,
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const grades = res.data?.grades || [];
    for (const g of grades) {
      assert(typeof g.isFinal === 'boolean', `Grade ${g.gradeId} missing isFinal (boolean), got ${typeof g.isFinal}`);
      assert(!('status' in g), `Grade ${g.gradeId} has unexpected "status" field — frontend should derive status from isFinal`);
    }
    console.log(`    Validated ${grades.length} grade(s): all have isFinal, none have status`);
  });

  await test('POST /academics/grades/record returns 403 for Student', 'Grades', async () => {
    const res = await apiCall({
      method: 'POST',
      url: '/academics/grades/record',
      data: {
        studentId,
        courseId: 'fake-course',
        schoolId: SCHOOL_ID,
        numericGrade: 95,
        letterGrade: 'A',
      },
    });
    assert(res.status === 403, `Expected 403 (forbidden), got ${res.status}`);
  });
}

// ─────────────────────────────────────────
// MODULE 3: ATTENDANCE ACCESS
// ─────────────────────────────────────────

async function testAttendanceAccess() {
  console.log('\n📋 Module 3: Attendance Access');

  if (!studentId) {
    results.push({ name: 'Attendance (skipped)', module: 'Attendance', status: 'SKIP', duration: 0 });
    return;
  }

  await test('GET attendance summary returns 200', 'Attendance', async () => {
    const res = await apiCall<any>({
      method: 'GET',
      url: `/academics/students/${studentId}/attendance/summary?schoolId=${SCHOOL_ID}`,
    });
    assert(res.status === 200, `Expected 200, got ${res.status}: ${res.error}`);
    console.log(`    Attendance rate: ${res.data?.attendanceRate ?? 'N/A'}%`);
  });

  await test('Attendance summary uses present/absent/late/excused fields', 'Attendance', async () => {
    const res = await apiCall<any>({
      method: 'GET',
      url: `/academics/students/${studentId}/attendance/summary?schoolId=${SCHOOL_ID}`,
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const d = res.data;
    assert(typeof d?.present === 'number', `Missing "present" (number), got ${typeof d?.present}`);
    assert(typeof d?.absent === 'number', `Missing "absent" (number), got ${typeof d?.absent}`);
    assert(typeof d?.late === 'number', `Missing "late" (number), got ${typeof d?.late}`);
    assert(typeof d?.excused === 'number', `Missing "excused" (number), got ${typeof d?.excused}`);
    assert(!('presentDays' in d), 'Unexpected "presentDays" — backend uses "present"');
    assert(!('absentDays' in d), 'Unexpected "absentDays" — backend uses "absent"');
    console.log(`    Validated: present=${d.present}, absent=${d.absent}, late=${d.late}, excused=${d.excused}`);
  });

  await test('GET attendance records returns 200', 'Attendance', async () => {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const endDate = now.toISOString().slice(0, 10);

    const res = await apiCall<any>({
      method: 'GET',
      url: `/academics/students/${studentId}/attendance?schoolId=${SCHOOL_ID}&startDate=${startDate}&endDate=${endDate}`,
    });
    assert(res.status === 200, `Expected 200, got ${res.status}: ${res.error}`);
    const items = res.data?.items || [];
    console.log(`    Found ${items.length} attendance record(s) this month`);
  });
}

// ─────────────────────────────────────────
// MODULE 4: SCHEDULE ACCESS
// ─────────────────────────────────────────

async function testScheduleAccess() {
  console.log('\n📋 Module 4: Schedule / Sections Access');

  if (!studentId) {
    results.push({ name: 'Sections (skipped)', module: 'Schedule', status: 'SKIP', duration: 0 });
    return;
  }

  await test('GET /academics/students/:id/sections returns 200', 'Schedule', async () => {
    const res = await apiCall<any>({
      method: 'GET',
      url: `/academics/students/${studentId}/sections?schoolId=${SCHOOL_ID}`,
    });
    assert(res.status === 200, `Expected 200, got ${res.status}: ${res.error}`);
    const items = Array.isArray(res.data) ? res.data : (res.data?.items || []);
    console.log(`    Found ${items.length} section(s)`);
  });

  await test('Sections response is a plain array (not { items } wrapper)', 'Schedule', async () => {
    const res = await apiCall<any>({
      method: 'GET',
      url: `/academics/students/${studentId}/sections?schoolId=${SCHOOL_ID}`,
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(res.data), `Expected sections response to be an array, got ${typeof res.data}`);
    console.log(`    Validated: response is array with ${res.data.length} item(s)`);
  });
}

// ─────────────────────────────────────────
// MODULE 5: DENIED ACTIONS
// ─────────────────────────────────────────

async function testDeniedActions() {
  console.log('\n📋 Module 5: Verify Denied Actions');

  await test('POST /academics/students (create student) returns 403', 'Denied', async () => {
    const res = await apiCall({
      method: 'POST',
      url: '/academics/students',
      data: {
        firstName: 'ShouldFail',
        lastName: 'Student',
        schoolId: SCHOOL_ID,
        dateOfBirth: '2010-01-01',
        gender: 'male',
        currentGradeLevel: '5',
      },
    });
    assert(res.status === 403, `Expected 403, got ${res.status}`);
  });

  await test('DELETE /academics/students/:id returns 403', 'Denied', async () => {
    if (!studentId) return;
    const res = await apiCall({
      method: 'DELETE',
      url: `/academics/students/${studentId}?schoolId=${SCHOOL_ID}`,
    });
    assert(res.status === 403 || res.status === 405, `Expected 403/405, got ${res.status}`);
  });
}

// ─────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────

async function main() {
  console.log('🔬 Student Portal Smoke Test');
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   School: ${SCHOOL_ID}`);

  await testIdentityResolution();
  await testGradesAccess();
  await testAttendanceAccess();
  await testScheduleAccess();
  await testDeniedActions();

  // ─── Summary ───
  console.log('\n' + '═'.repeat(60));
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;
  console.log(`  Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);

  if (failed > 0) {
    console.log('\n  Failed tests:');
    for (const r of results.filter(r => r.status === 'FAIL')) {
      console.log(`    ❌ [${r.module}] ${r.name}: ${r.error}`);
    }
  }

  // Write log file
  const logDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `student-portal-smoke-${Date.now()}.json`);
  fs.writeFileSync(logFile, JSON.stringify({ results, timestamp: new Date().toISOString() }, null, 2));
  console.log(`\n  Log: ${logFile}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
