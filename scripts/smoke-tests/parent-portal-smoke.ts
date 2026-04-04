/**
 * EdForge — Parent Portal Smoke Test
 *
 * Validates that a Parent user can access their children's data via self-service endpoints:
 *
 *   1. GET /academics/students?schoolId=... (DataScope returns linked children only)
 *   2. GET /academics/students/:childId/grades?schoolId=...
 *   3. GET /academics/students/:childId/attendance/summary?schoolId=...
 *   4. GET /academics/students/:childId/sections?schoolId=...
 *   5. POST /academics/grades/record → should be 403 (parents cannot create grades)
 *   6. POST /academics/students → should be 403 (parents cannot create students)
 *
 * Usage:
 *   ID_TOKEN=<parent-jwt> npx ts-node scripts/smoke-tests/parent-portal-smoke.ts
 *   ID_TOKEN=<parent-jwt> SCHOOL_ID=<uuid> npx ts-node scripts/smoke-tests/parent-portal-smoke.ts
 */

import axios, { AxiosRequestConfig } from 'axios';
import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────

const ID_TOKEN = process.env.ID_TOKEN || '';
const BASE_URL = process.env.API_BASE_URL || 'https://udmx0atz53.execute-api.us-east-2.amazonaws.com/prod';
const SCHOOL_ID = process.env.SCHOOL_ID || 'd88860fe-306a-4a2e-b76a-b5eee861ff08';

if (!ID_TOKEN) {
  console.error('\x1b[31mERROR: ID_TOKEN environment variable is required (must be a Parent user JWT).\x1b[0m');
  console.error('Usage: ID_TOKEN=<parent-jwt> npx ts-node scripts/smoke-tests/parent-portal-smoke.ts');
  process.exit(1);
}

// ─────────────────────────────────────────
// TYPES & HELPERS
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
    return { status: 0, data: null, error: err.message, duration: Date.now() - start };
  }
}

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
// MODULE 1: CHILDREN RESOLUTION
// ─────────────────────────────────────────

let children: Array<{ studentId: string; firstName: string; lastName: string }> = [];

async function testChildrenResolution() {
  console.log('\n📋 Module 1: Children Resolution');

  await test('GET /academics/students returns linked children via DataScope', 'Children', async () => {
    const res = await apiCall<any>({
      method: 'GET',
      url: `/academics/students?schoolId=${SCHOOL_ID}&limit=50`,
    });
    assert(res.status === 200, `Expected 200, got ${res.status}: ${res.error}`);

    const items = res.data?.items || res.data?.data || (Array.isArray(res.data) ? res.data : []);
    assert(items.length >= 1, `Expected at least 1 child, got ${items.length}`);

    children = items.map((s: any) => ({
      studentId: s.studentId,
      firstName: s.firstName,
      lastName: s.lastName,
    }));

    console.log(`    Found ${children.length} child(ren):`);
    children.forEach(c => console.log(`      - ${c.firstName} ${c.lastName} (${c.studentId})`));
  });
}

// ─────────────────────────────────────────
// MODULE 2: CHILD GRADES ACCESS
// ─────────────────────────────────────────

async function testChildGrades() {
  console.log('\n📋 Module 2: Child Grades Access');

  if (children.length === 0) {
    results.push({ name: 'Grades (skipped)', module: 'Grades', status: 'SKIP', duration: 0 });
    return;
  }

  const child = children[0];

  await test(`GET grades for ${child.firstName} returns 200`, 'Grades', async () => {
    const res = await apiCall<any>({
      method: 'GET',
      url: `/academics/students/${child.studentId}/grades?schoolId=${SCHOOL_ID}`,
    });
    assert(res.status === 200, `Expected 200, got ${res.status}: ${res.error}`);
    const grades = res.data?.grades || [];
    console.log(`    Found ${grades.length} grade(s)`);
    if (res.data?.gpa) {
      console.log(`    GPA: ${res.data.gpa.cumulativeGpa}`);
    }
  });

  await test(`Grades for ${child.firstName} have isFinal (not status)`, 'Grades', async () => {
    const res = await apiCall<any>({
      method: 'GET',
      url: `/academics/students/${child.studentId}/grades?schoolId=${SCHOOL_ID}`,
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const grades = res.data?.grades || [];
    for (const g of grades) {
      assert(typeof g.isFinal === 'boolean', `Grade ${g.gradeId} missing isFinal (boolean)`);
      assert(!('status' in g), `Grade ${g.gradeId} has unexpected "status" field`);
    }
    console.log(`    Validated ${grades.length} grade(s): isFinal present, no status`);
  });
}

// ─────────────────────────────────────────
// MODULE 3: CHILD ATTENDANCE ACCESS
// ─────────────────────────────────────────

async function testChildAttendance() {
  console.log('\n📋 Module 3: Child Attendance Access');

  if (children.length === 0) {
    results.push({ name: 'Attendance (skipped)', module: 'Attendance', status: 'SKIP', duration: 0 });
    return;
  }

  const child = children[0];

  await test(`GET attendance summary for ${child.firstName} returns 200`, 'Attendance', async () => {
    const res = await apiCall<any>({
      method: 'GET',
      url: `/academics/students/${child.studentId}/attendance/summary?schoolId=${SCHOOL_ID}`,
    });
    assert(res.status === 200, `Expected 200, got ${res.status}: ${res.error}`);
    console.log(`    Attendance rate: ${res.data?.attendanceRate ?? 'N/A'}%`);
  });

  await test(`Attendance summary for ${child.firstName} uses present/absent/late/excused`, 'Attendance', async () => {
    const res = await apiCall<any>({
      method: 'GET',
      url: `/academics/students/${child.studentId}/attendance/summary?schoolId=${SCHOOL_ID}`,
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const d = res.data;
    assert(typeof d?.present === 'number', `Missing "present" (number), got ${typeof d?.present}`);
    assert(typeof d?.absent === 'number', `Missing "absent" (number), got ${typeof d?.absent}`);
    assert(typeof d?.late === 'number', `Missing "late" (number), got ${typeof d?.late}`);
    assert(typeof d?.excused === 'number', `Missing "excused" (number), got ${typeof d?.excused}`);
    assert(!('presentDays' in d), 'Unexpected "presentDays" — backend uses "present"');
    console.log(`    Validated: present=${d.present}, absent=${d.absent}, late=${d.late}, excused=${d.excused}`);
  });
}

// ─────────────────────────────────────────
// MODULE 4: CHILD SCHEDULE ACCESS
// ─────────────────────────────────────────

async function testChildSchedule() {
  console.log('\n📋 Module 4: Child Schedule Access');

  if (children.length === 0) {
    results.push({ name: 'Schedule (skipped)', module: 'Schedule', status: 'SKIP', duration: 0 });
    return;
  }

  const child = children[0];

  await test(`GET sections for ${child.firstName} returns 200`, 'Schedule', async () => {
    const res = await apiCall<any>({
      method: 'GET',
      url: `/academics/students/${child.studentId}/sections?schoolId=${SCHOOL_ID}`,
    });
    assert(res.status === 200, `Expected 200, got ${res.status}: ${res.error}`);
    const items = Array.isArray(res.data) ? res.data : (res.data?.items || []);
    console.log(`    Found ${items.length} section(s)`);
  });

  await test(`Sections for ${child.firstName} is a plain array (not { items })`, 'Schedule', async () => {
    const res = await apiCall<any>({
      method: 'GET',
      url: `/academics/students/${child.studentId}/sections?schoolId=${SCHOOL_ID}`,
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

  await test('POST /academics/students (create) returns 403', 'Denied', async () => {
    const res = await apiCall({
      method: 'POST',
      url: '/academics/students',
      data: {
        firstName: 'ShouldFail',
        lastName: 'Parent',
        schoolId: SCHOOL_ID,
        dateOfBirth: '2010-01-01',
        gender: 'male',
        currentGradeLevel: '5',
      },
    });
    assert(res.status === 403, `Expected 403, got ${res.status}`);
  });

  await test('POST /academics/grades/record returns 403', 'Denied', async () => {
    const fakeStudentId = children[0]?.studentId || 'fake-id';
    const res = await apiCall({
      method: 'POST',
      url: '/academics/grades/record',
      data: {
        studentId: fakeStudentId,
        courseId: 'fake-course',
        schoolId: SCHOOL_ID,
        numericGrade: 95,
        letterGrade: 'A',
      },
    });
    assert(res.status === 403, `Expected 403, got ${res.status}`);
  });
}

// ─────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────

async function main() {
  console.log('🔬 Parent Portal Smoke Test');
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   School: ${SCHOOL_ID}`);

  await testChildrenResolution();
  await testChildGrades();
  await testChildAttendance();
  await testChildSchedule();
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
  const logFile = path.join(logDir, `parent-portal-smoke-${Date.now()}.json`);
  fs.writeFileSync(logFile, JSON.stringify({ results, timestamp: new Date().toISOString() }, null, 2));
  console.log(`\n  Log: ${logFile}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
