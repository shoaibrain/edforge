/**
 * EdForge — Sprint 4: Portal Access Smoke Test
 *
 * Validates Sprint 4 improvements:
 *
 *   Module 1: Create Parent Account — POST /identity/users/parent-accounts
 *   Module 2: Create Student Account — POST /identity/users/student-accounts
 *   Module 3: Link Guardian to User — POST /academics/students/:id/link-guardian
 *   Module 4: Duplicate Email Rejection — Cannot create two accounts with same email
 *
 * Usage:
 *   ID_TOKEN=<jwt> npx ts-node scripts/smoke-tests/sprint4-portal-access.ts
 *   ID_TOKEN=<jwt> SCHOOL_ID=<uuid> npx ts-node scripts/smoke-tests/sprint4-portal-access.ts
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
  console.error('\x1b[31mERROR: ID_TOKEN environment variable is required.\x1b[0m');
  console.error('Usage: ID_TOKEN=<jwt> npx ts-node scripts/smoke-tests/sprint4-portal-access.ts');
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
// HELPERS
// ─────────────────────────────────────────

const randomSuffix = () => Math.random().toString(36).slice(2, 7);

async function createTestStudent(suffix: string): Promise<any> {
  const res = await apiCall({
    method: 'POST',
    url: '/academics/students',
    data: {
      firstName: `PortalTest${suffix}`,
      lastName: `Sprint4${suffix}`,
      dateOfBirth: '2012-06-15',
      gender: 'male',
      schoolId: SCHOOL_ID,
      currentGradeLevel: '5',
      guardians: [
        {
          firstName: `ParentFirst${suffix}`,
          lastName: `ParentLast${suffix}`,
          relationship: 'mother',
          email: `parent-${suffix}@smoketest.local`,
          phone: '+12025551234',
          isPrimary: true,
          hasPortalAccess: false,
          canPickup: true,
        },
      ],
    },
  });
  assert(res.status === 201, `Create student failed: ${res.error}`);
  return res.data;
}

// ─────────────────────────────────────────
// MODULE 1: CREATE PARENT ACCOUNT
// ─────────────────────────────────────────

async function testCreateParentAccount() {
  console.log('\n📋 Module 1: Create Parent Account');

  const suffix = randomSuffix();
  const student = await createTestStudent(suffix);

  await test('Create parent account succeeds', 'ParentAccount', async () => {
    const res = await apiCall<any>({
      method: 'POST',
      url: '/identity/users/parent-accounts',
      data: {
        email: `parent-${suffix}@smoketest.local`,
        firstName: `ParentFirst${suffix}`,
        lastName: `ParentLast${suffix}`,
        schoolId: SCHOOL_ID,
        studentId: student.studentId,
        guardianId: student.guardians?.[0]?.guardianId,
      },
    });
    assert(res.status === 201, `Expected 201, got ${res.status}: ${res.error}`);
    const data = res.data;
    assert(!!data.userId, 'Response should include userId');
    assert(data.schoolRole === 'Parent', `Expected schoolRole=Parent, got ${data.schoolRole}`);
  });

  await test('Duplicate parent email is rejected', 'ParentAccount', async () => {
    const res = await apiCall({
      method: 'POST',
      url: '/identity/users/parent-accounts',
      data: {
        email: `parent-${suffix}@smoketest.local`,
        firstName: 'Duplicate',
        lastName: 'Parent',
        schoolId: SCHOOL_ID,
        studentId: student.studentId,
      },
    });
    assert(res.status === 409, `Expected 409, got ${res.status}: ${JSON.stringify(res.data)}`);
  });
}

// ─────────────────────────────────────────
// MODULE 2: CREATE STUDENT ACCOUNT
// ─────────────────────────────────────────

async function testCreateStudentAccount() {
  console.log('\n📋 Module 2: Create Student Account');

  const suffix = randomSuffix();
  const student = await createTestStudent(suffix);

  await test('Create student account succeeds', 'StudentAccount', async () => {
    const email = `student-${suffix}@smoketest.local`;
    const res = await apiCall<any>({
      method: 'POST',
      url: '/identity/users/student-accounts',
      data: {
        email,
        firstName: student.firstName || `PortalTest${suffix}`,
        lastName: student.lastName || `Sprint4${suffix}`,
        schoolId: SCHOOL_ID,
        studentId: student.studentId,
      },
    });
    assert(res.status === 201, `Expected 201, got ${res.status}: ${res.error}`);
    const data = res.data;
    assert(!!data.userId, 'Response should include userId');
    assert(data.schoolRole === 'Student', `Expected schoolRole=Student, got ${data.schoolRole}`);
  });
}

// ─────────────────────────────────────────
// MODULE 3: LINK GUARDIAN TO USER
// ─────────────────────────────────────────

async function testLinkGuardian() {
  console.log('\n📋 Module 3: Link Guardian to User');

  const suffix = randomSuffix();
  const student = await createTestStudent(suffix);

  // Create a parent account first
  const parentRes = await apiCall<any>({
    method: 'POST',
    url: '/identity/users/parent-accounts',
    data: {
      email: `parent-link-${suffix}@smoketest.local`,
      firstName: `ParentFirst${suffix}`,
      lastName: `ParentLast${suffix}`,
      schoolId: SCHOOL_ID,
      studentId: student.studentId,
      guardianId: student.guardians?.[0]?.guardianId,
    },
  });
  assert(parentRes.status === 201, `Create parent failed: ${parentRes.error}`);
  const parentUserId = (parentRes.data as any).userId;

  await test('Link guardian to user succeeds', 'LinkGuardian', async () => {
    const res = await apiCall<any>({
      method: 'POST',
      url: `/academics/students/${student.studentId}/link-guardian?schoolId=${SCHOOL_ID}`,
      data: {
        userId: parentUserId,
        guardianId: student.guardians?.[0]?.guardianId,
        guardianEmail: `parent-link-${suffix}@smoketest.local`,
      },
    });
    assert(res.status === 201 || res.status === 200, `Expected 2xx, got ${res.status}: ${res.error}`);
    assert(res.data?.linked === true, 'Expected linked=true');
  });

  await test('Guardian now has portal access', 'LinkGuardian', async () => {
    const res = await apiCall<any>({
      method: 'GET',
      url: `/academics/students/${student.studentId}/profile?schoolId=${SCHOOL_ID}`,
    });
    assert(res.status === 200, `Get profile failed: ${res.error}`);
    const guardians = res.data?.guardians || [];
    const linked = guardians.find((g: any) => g.email === `parent-link-${suffix}@smoketest.local`);
    assert(!!linked, 'Guardian not found in profile');
    assert(linked.hasPortalAccess === true, 'Guardian should have hasPortalAccess=true');
    assert(linked.userId === parentUserId, `Guardian userId should be ${parentUserId}`);
  });
}

// ─────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────

async function main() {
  console.log('🔬 Sprint 4: Portal Access Smoke Test');
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   School: ${SCHOOL_ID}`);

  await testCreateParentAccount();
  await testCreateStudentAccount();
  await testLinkGuardian();

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
  const logFile = path.join(logDir, `sprint4-portal-access-${Date.now()}.json`);
  fs.writeFileSync(logFile, JSON.stringify({ results, timestamp: new Date().toISOString() }, null, 2));
  console.log(`\n  Log: ${logFile}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
