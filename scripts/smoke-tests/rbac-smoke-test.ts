/**
 * RBAC/ABAC Smoke Test — Cross-Role API Validation
 *
 * Tests that each school role receives the correct permissions
 * and data scope when calling Academics endpoints.
 *
 * Usage:
 *   1. Set role-specific tokens as environment variables:
 *      PRINCIPAL_TOKEN, TEACHER_TOKEN, STAFF_TOKEN, COUNSELOR_TOKEN, TENANT_ADMIN_TOKEN
 *   2. Set SCHOOL_ID and ACADEMIC_YEAR_ID
 *   3. Run: npx ts-node scripts/smoke-tests/rbac-smoke-test.ts
 *
 * For Teacher scope tests, also set:
 *   TEACHER_SECTION_ID  — a section the teacher IS assigned to
 *   OUT_OF_SCOPE_STUDENT_ID — a student NOT in the teacher's sections
 */

import axios, { AxiosError } from 'axios';

// ============================================
// CONFIGURATION
// ============================================

const BASE_URL = process.env.API_BASE_URL || 'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';
const SCHOOL_ID = process.env.SCHOOL_ID || '';
const ACADEMIC_YEAR_ID = process.env.ACADEMIC_YEAR_ID || '';

// Role tokens
const TOKENS: Record<string, string> = {
  TenantAdmin: process.env.TENANT_ADMIN_TOKEN || '',
  Principal: process.env.PRINCIPAL_TOKEN || '',
  Teacher: process.env.TEACHER_TOKEN || '',
  Staff: process.env.STAFF_TOKEN || '',
  Counselor: process.env.COUNSELOR_TOKEN || '',
};

// Teacher-specific scope test data
const TEACHER_SECTION_ID = process.env.TEACHER_SECTION_ID || '';
const OUT_OF_SCOPE_STUDENT_ID = process.env.OUT_OF_SCOPE_STUDENT_ID || '';

// ============================================
// HELPERS
// ============================================

interface TestResult {
  role: string;
  endpoint: string;
  method: string;
  expected: number;
  actual: number;
  passed: boolean;
  detail?: string;
}

const results: TestResult[] = [];
let passed = 0;
let failed = 0;

function extractTenantId(token: string): string {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    return payload['custom:tenantId'] || '';
  } catch {
    return '';
  }
}

async function callEndpoint(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const tenantId = extractTenantId(token);
  try {
    const response = await axios({
      method,
      url: `${BASE_URL}${path}`,
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Tenant-Id': tenantId,
        'Content-Type': 'application/json',
      },
      data: body,
      timeout: 10000,
      validateStatus: () => true, // Don't throw on 4xx/5xx
    });
    return { status: response.status, data: response.data };
  } catch (error: any) {
    return { status: 0, data: error.message };
  }
}

function record(role: string, endpoint: string, method: string, expected: number, actual: number, detail?: string) {
  const pass = actual === expected;
  results.push({ role, endpoint, method, expected, actual, passed: pass, detail });
  if (pass) {
    passed++;
    console.log(`  ✓ [${role}] ${method} ${endpoint} → ${actual} (expected ${expected})`);
  } else {
    failed++;
    console.log(`  ✗ [${role}] ${method} ${endpoint} → ${actual} (expected ${expected}) ${detail || ''}`);
  }
}

// ============================================
// PERMISSION MATRIX: what each role should get
// ============================================

interface EndpointTest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  /** Expected HTTP status per role. 200 = allowed, 403 = denied, 400 = missing param */
  expected: Record<string, number>;
}

function buildTests(): EndpointTest[] {
  const q = `?schoolId=${SCHOOL_ID}`;

  return [
    // --- Students (read) ---
    {
      method: 'GET',
      path: `/academics/students${q}`,
      expected: { TenantAdmin: 200, Principal: 200, Teacher: 200, Staff: 200, Counselor: 200 },
    },
    // --- Courses (read) ---
    {
      method: 'GET',
      path: `/academics/courses${q}`,
      expected: { TenantAdmin: 200, Principal: 200, Teacher: 200, Staff: 200, Counselor: 200 },
    },
    // --- Sections (read) ---
    {
      method: 'GET',
      path: `/academics/sections${q}`,
      expected: { TenantAdmin: 200, Principal: 200, Teacher: 200, Staff: 200, Counselor: 200 },
    },
    // --- Attendance (read) ---
    {
      method: 'GET',
      path: `/academics/attendance${q}&date=${new Date().toISOString().split('T')[0]}`,
      expected: { TenantAdmin: 200, Principal: 200, Teacher: 200, Staff: 200, Counselor: 403 },
    },
    // --- Grades (read) ---
    {
      method: 'GET',
      path: `/academics/grades/overview${q}`,
      expected: { TenantAdmin: 200, Principal: 200, Teacher: 200, Staff: 403, Counselor: 403 },
    },
    // --- Grading Policies (read) ---
    {
      method: 'GET',
      path: `/academics/grading-policies${q}`,
      expected: { TenantAdmin: 200, Principal: 200, Teacher: 200, Staff: 403, Counselor: 403 },
    },
    // --- Enrollments (read) ---
    {
      method: 'GET',
      path: `/academics/schools/${SCHOOL_ID}/years/${ACADEMIC_YEAR_ID}/enrollments`,
      expected: { TenantAdmin: 200, Principal: 200, Teacher: 200, Staff: 200, Counselor: 200 },
    },
  ];
}

// ============================================
// TEACHER SCOPE TESTS
// ============================================

async function runTeacherScopeTests() {
  const token = TOKENS.Teacher;
  if (!token || !TEACHER_SECTION_ID) {
    console.log('\n⏭ Skipping Teacher scope tests (TEACHER_TOKEN or TEACHER_SECTION_ID not set)');
    return;
  }

  console.log('\n── Teacher Data Scope Tests ──');

  // Sections: should only return teacher's assigned sections
  const sectionsRes = await callEndpoint('GET', `/academics/sections?schoolId=${SCHOOL_ID}`, token);
  if (sectionsRes.status === 200) {
    const sections = (sectionsRes.data as any)?.items || [];
    const hasOwnSection = sections.some((s: any) => s.sectionId === TEACHER_SECTION_ID);
    record('Teacher-Scope', 'sections contains own section', 'GET', 200, hasOwnSection ? 200 : 404,
      `Found ${sections.length} sections, own section ${hasOwnSection ? 'present' : 'MISSING'}`);
  } else {
    record('Teacher-Scope', 'sections', 'GET', 200, sectionsRes.status);
  }

  // Out-of-scope student: should return 403
  if (OUT_OF_SCOPE_STUDENT_ID) {
    const studentRes = await callEndpoint(
      'GET',
      `/academics/students/${OUT_OF_SCOPE_STUDENT_ID}?schoolId=${SCHOOL_ID}`,
      token,
    );
    record('Teacher-Scope', `students/${OUT_OF_SCOPE_STUDENT_ID}`, 'GET', 403, studentRes.status,
      'Out-of-scope student should return 403');
  }
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('RBAC/ABAC Smoke Test');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`School: ${SCHOOL_ID}`);
  console.log(`Academic Year: ${ACADEMIC_YEAR_ID}`);
  console.log();

  // Check which tokens are available
  const availableRoles = Object.entries(TOKENS).filter(([, t]) => !!t).map(([r]) => r);
  if (availableRoles.length === 0) {
    console.error('No role tokens configured. Set TENANT_ADMIN_TOKEN, PRINCIPAL_TOKEN, TEACHER_TOKEN, etc.');
    process.exit(1);
  }
  console.log(`Available roles: ${availableRoles.join(', ')}`);
  console.log();

  const tests = buildTests();

  // Run permission matrix tests
  console.log('── Permission Matrix Tests ──');
  for (const test of tests) {
    for (const role of availableRoles) {
      if (!(role in test.expected)) continue;
      const res = await callEndpoint(test.method, test.path, TOKENS[role], test.body);
      record(role, test.path.replace(/\?.*/, ''), test.method, test.expected[role], res.status);
    }
  }

  // Run teacher scope tests
  await runTeacherScopeTests();

  // Summary
  console.log('\n════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  ✗ [${r.role}] ${r.method} ${r.endpoint} → ${r.actual} (expected ${r.expected}) ${r.detail || ''}`);
    });
    process.exit(1);
  }

  console.log('All tests passed!');
}

main().catch(err => {
  console.error('Smoke test error:', err);
  process.exit(1);
});
