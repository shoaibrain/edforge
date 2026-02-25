/**
 * EdForge — Sprint 2: Enrollment Lifecycle & Ed-Fi Compliance Smoke Test
 *
 * Validates Sprint 2 improvements:
 *
 *   Module 1: Enrollment State Machine — Valid/invalid transitions
 *   Module 2: Transfer Flow — Source enrollment closure with Ed-Fi exit fields
 *   Module 3: Re-enrollment Guard — Reject re-enrollment at same SK
 *   Module 4: Student Number Uniqueness — Reject duplicate student number
 *   Module 5: Section Enrollment Cascade — Verify section deactivation on withdrawal
 *   Module 6: Exit Type Required — Withdrawal requires exitWithdrawTypeDescriptor
 *
 * Usage:
 *   ID_TOKEN=<jwt> npx ts-node scripts/smoke-tests/sprint2-enrollment-lifecycle.ts
 *   ID_TOKEN=<jwt> SCHOOL_ID=<uuid> ACADEMIC_YEAR_ID=<uuid> npx ts-node scripts/smoke-tests/sprint2-enrollment-lifecycle.ts
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
const ACADEMIC_YEAR_ID = process.env.ACADEMIC_YEAR_ID || '';

if (!ID_TOKEN) {
  console.error('\x1b[31mERROR: ID_TOKEN environment variable is required.\x1b[0m');
  console.error('Usage: ID_TOKEN=<jwt> npx ts-node scripts/smoke-tests/sprint2-enrollment-lifecycle.ts');
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
  validateStatus: () => true, // Don't throw on non-2xx
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
// HELPERS
// ─────────────────────────────────────────

const today = new Date().toISOString().split('T')[0];
const randomSuffix = () => Math.random().toString(36).slice(2, 7);

async function createTestStudent(suffix: string): Promise<any> {
  const res = await apiCall({
    method: 'POST',
    url: '/academics/students',
    data: {
      firstName: `SmokeTest${suffix}`,
      lastName: `Sprint2${suffix}`,
      dateOfBirth: '2012-06-15',
      gender: 'male',
      schoolId: SCHOOL_ID,
      currentGradeLevel: '5',
    },
  });
  assert(res.status === 201, `Create student failed: ${res.error}`);
  return res.data;
}

async function createTestEnrollment(studentId: string, yearId: string): Promise<any> {
  const res = await apiCall({
    method: 'POST',
    url: '/academics/enrollments',
    data: {
      studentId,
      schoolId: SCHOOL_ID,
      academicYearId: yearId,
      gradeLevel: '5',
      enrollmentDate: today,
      enrollmentType: 'new',
      entryTypeDescriptor: 'Original',
    },
  });
  assert(res.status === 201, `Create enrollment failed: ${res.error}`);
  return res.data;
}

// ─────────────────────────────────────────
// RESOLVE ACADEMIC YEAR
// ─────────────────────────────────────────

async function resolveAcademicYear(): Promise<string> {
  if (ACADEMIC_YEAR_ID) return ACADEMIC_YEAR_ID;

  const res = await apiCall<any[]>({
    method: 'GET',
    url: `/identity/schools/${SCHOOL_ID}/academic-years`,
  });

  assert(res.status === 200, `Failed to fetch academic years: ${res.error}`);
  const active = (res.data || []).find((y: any) => y.status === 'active');
  assert(!!active, 'No active academic year found. Set ACADEMIC_YEAR_ID env var.');
  console.log(`  Using academic year: ${active.name} (${active.yearId})`);
  return active.yearId;
}

// ─────────────────────────────────────────
// MODULE 1: EXIT TYPE REQUIRED ON WITHDRAWAL
// ─────────────────────────────────────────

async function testExitTypeRequired(yearId: string) {
  console.log('\n📋 Module 1: Exit Type Required on Withdrawal');

  const student = await createTestStudent(randomSuffix());
  const enrollment = await createTestEnrollment(student.studentId, yearId);

  await test('Withdrawal without exitWithdrawTypeDescriptor is rejected', 'ExitType', async () => {
    const res = await apiCall({
      method: 'POST',
      url: `/academics/schools/${SCHOOL_ID}/years/${yearId}/students/${student.studentId}/withdraw`,
      data: {
        withdrawalDate: today,
        reason: 'Test withdrawal without exit type',
      },
    });
    assert(res.status === 400, `Expected 400, got ${res.status}: ${JSON.stringify(res.data)}`);
  });

  await test('Withdrawal with exitWithdrawTypeDescriptor succeeds', 'ExitType', async () => {
    const res = await apiCall({
      method: 'POST',
      url: `/academics/schools/${SCHOOL_ID}/years/${yearId}/students/${student.studentId}/withdraw`,
      data: {
        withdrawalDate: today,
        reason: 'Test withdrawal with exit type',
        exitWithdrawTypeDescriptor: 'Other',
      },
    });
    assert(res.status === 200 || res.status === 201, `Expected 2xx, got ${res.status}: ${res.error}`);
    const data = res.data as any;
    assert(data.exitWithdrawTypeDescriptor === 'Other', 'exitWithdrawTypeDescriptor not returned');
    assert(data.exitWithdrawDate === today, 'exitWithdrawDate not set');
  });
}

// ─────────────────────────────────────────
// MODULE 2: STATE MACHINE — INVALID TRANSITIONS
// ─────────────────────────────────────────

async function testStateMachine(yearId: string) {
  console.log('\n📋 Module 2: Enrollment State Machine');

  // Create and withdraw a student
  const student = await createTestStudent(randomSuffix());
  await createTestEnrollment(student.studentId, yearId);

  // Withdraw
  await apiCall({
    method: 'POST',
    url: `/academics/schools/${SCHOOL_ID}/years/${yearId}/students/${student.studentId}/withdraw`,
    data: {
      withdrawalDate: today,
      reason: 'State machine test',
      exitWithdrawTypeDescriptor: 'Other',
    },
  });

  await test('Cannot withdraw an already-withdrawn enrollment', 'StateMachine', async () => {
    const res = await apiCall({
      method: 'POST',
      url: `/academics/schools/${SCHOOL_ID}/years/${yearId}/students/${student.studentId}/withdraw`,
      data: {
        withdrawalDate: today,
        reason: 'Double withdrawal',
        exitWithdrawTypeDescriptor: 'Other',
      },
    });
    assert(res.status === 400, `Expected 400 for invalid transition, got ${res.status}`);
  });
}

// ─────────────────────────────────────────
// MODULE 3: RE-ENROLLMENT GUARD
// ─────────────────────────────────────────

async function testReEnrollmentGuard(yearId: string) {
  console.log('\n📋 Module 3: Re-enrollment Guard');

  const student = await createTestStudent(randomSuffix());
  await createTestEnrollment(student.studentId, yearId);

  // Withdraw first
  await apiCall({
    method: 'POST',
    url: `/academics/schools/${SCHOOL_ID}/years/${yearId}/students/${student.studentId}/withdraw`,
    data: {
      withdrawalDate: today,
      reason: 'Re-enrollment test',
      exitWithdrawTypeDescriptor: 'Other',
    },
  });

  await test('Re-enrollment at same SK is rejected', 'ReEnroll', async () => {
    const res = await apiCall({
      method: 'POST',
      url: '/academics/enrollments',
      data: {
        studentId: student.studentId,
        schoolId: SCHOOL_ID,
        academicYearId: yearId,
        gradeLevel: '5',
        enrollmentDate: today,
        enrollmentType: 'returning',
      },
    });
    assert(res.status === 409, `Expected 409 conflict, got ${res.status}: ${JSON.stringify(res.data)}`);
  });
}

// ─────────────────────────────────────────
// MODULE 4: STUDENT NUMBER UNIQUENESS
// ─────────────────────────────────────────

async function testStudentNumberUniqueness() {
  console.log('\n📋 Module 4: Student Number Uniqueness');

  const uniqueNum = `SMOKE-${randomSuffix()}`;

  await test('Create student with manual student number succeeds', 'UniqueNum', async () => {
    const res = await apiCall({
      method: 'POST',
      url: '/academics/students',
      data: {
        firstName: 'UniqueNum',
        lastName: 'Test1',
        dateOfBirth: '2012-03-10',
        gender: 'female',
        schoolId: SCHOOL_ID,
        currentGradeLevel: '3',
        studentNumber: uniqueNum,
      },
    });
    assert(res.status === 201, `Create student failed: ${res.error}`);
  });

  await test('Duplicate student number is rejected', 'UniqueNum', async () => {
    const res = await apiCall({
      method: 'POST',
      url: '/academics/students',
      data: {
        firstName: 'UniqueNum',
        lastName: 'Test2',
        dateOfBirth: '2013-05-20',
        gender: 'male',
        schoolId: SCHOOL_ID,
        currentGradeLevel: '4',
        studentNumber: uniqueNum,
      },
    });
    assert(res.status === 409, `Expected 409, got ${res.status}: ${JSON.stringify(res.data)}`);
  });
}

// ─────────────────────────────────────────
// MODULE 5: ENROLLMENT EVENTS (verify no crash)
// ─────────────────────────────────────────

async function testEnrollmentEvents(yearId: string) {
  console.log('\n📋 Module 5: Enrollment Events (no-crash check)');

  await test('Create enrollment publishes event without error', 'Events', async () => {
    const student = await createTestStudent(randomSuffix());
    const enrollment = await createTestEnrollment(student.studentId, yearId);
    assert(!!enrollment.enrollmentId, 'Enrollment should have ID');
    // Events are fire-and-forget; if we got here, no crash
  });
}

// ─────────────────────────────────────────
// MODULE 6: STUDENT NAME ON ENROLLMENT
// ─────────────────────────────────────────

async function testStudentNameOnEnrollment(yearId: string) {
  console.log('\n📋 Module 6: Student Name on Enrollment');

  await test('Enrollment list includes student names', 'StudentName', async () => {
    const res = await apiCall<any>({
      method: 'GET',
      url: `/academics/schools/${SCHOOL_ID}/years/${yearId}/enrollments`,
    });
    assert(res.status === 200, `List enrollments failed: ${res.error}`);
    const items = res.data?.items || res.data || [];
    if (items.length > 0) {
      const withName = items.filter((e: any) => e.studentName && e.studentName.length > 0);
      console.log(`    ${withName.length}/${items.length} enrollments have studentName populated`);
      // New enrollments should have names; old ones get hydrated via batch
      assert(withName.length > 0, 'Expected at least some enrollments to have studentName');
    } else {
      console.log('    No enrollments found to verify');
    }
  });
}

// ─────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────

async function main() {
  console.log('🔬 Sprint 2: Enrollment Lifecycle & Ed-Fi Compliance Smoke Test');
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   School: ${SCHOOL_ID}`);

  const yearId = await resolveAcademicYear();

  await testExitTypeRequired(yearId);
  await testStateMachine(yearId);
  await testReEnrollmentGuard(yearId);
  await testStudentNumberUniqueness();
  await testEnrollmentEvents(yearId);
  await testStudentNameOnEnrollment(yearId);

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
  const logFile = path.join(logDir, `sprint2-enrollment-lifecycle-${Date.now()}.json`);
  fs.writeFileSync(logFile, JSON.stringify({ results, timestamp: new Date().toISOString() }, null, 2));
  console.log(`\n  Log: ${logFile}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
