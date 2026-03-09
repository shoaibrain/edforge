/**
 * EdForge — Section Attendance Smoke Test
 *
 * Validates the new section-level attendance endpoints:
 *
 *   Test 1: Record single section attendance (POST)
 *   Test 2: Record bulk section attendance (POST /bulk)
 *   Test 3: Get section attendance by date (GET)
 *   Test 4: Get student section attendance history (GET /student/:id)
 *   Test 5: Update section attendance (PATCH)
 *   Test 6: Cross-section isolation — records from section A don't appear in section B
 *
 * Usage:
 *   ID_TOKEN=<jwt> npx ts-node scripts/smoke-tests/section-attendance-flow.ts
 *   ID_TOKEN=<jwt> SCHOOL_ID=<uuid> SECTION_ID=<uuid> npx ts-node scripts/smoke-tests/section-attendance-flow.ts
 */

import axios, { AxiosRequestConfig } from 'axios';

// ─────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────

const ID_TOKEN = process.env.ID_TOKEN || '';
const BASE_URL = process.env.API_BASE_URL || 'https://udmx0atz53.execute-api.us-east-2.amazonaws.com/prod';
const SCHOOL_ID = process.env.SCHOOL_ID || '';
const SECTION_ID = process.env.SECTION_ID || '';
const SECTION_ID_B = process.env.SECTION_ID_B || ''; // Second section for isolation test
const STUDENT_ID = process.env.STUDENT_ID || '';

if (!ID_TOKEN) {
  console.error('\x1b[31mERROR: ID_TOKEN environment variable is required.\x1b[0m');
  console.error('Usage: ID_TOKEN=<jwt> SCHOOL_ID=<uuid> SECTION_ID=<uuid> STUDENT_ID=<uuid> npx ts-node scripts/smoke-tests/section-attendance-flow.ts');
  process.exit(1);
}

if (!SCHOOL_ID || !SECTION_ID || !STUDENT_ID) {
  console.error('\x1b[31mERROR: SCHOOL_ID, SECTION_ID, and STUDENT_ID are required.\x1b[0m');
  process.exit(1);
}

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  duration: number;
  error?: string;
}

const results: TestResult[] = [];
const today = new Date().toISOString().split('T')[0];

async function api<T = any>(
  method: string,
  path: string,
  data?: any,
): Promise<{ status: number; data: T | null; error: string | null }> {
  const config: AxiosRequestConfig = {
    method: method as any,
    url: `${BASE_URL}${path}`,
    headers: {
      Authorization: `Bearer ${ID_TOKEN}`,
      'Content-Type': 'application/json',
    },
    data,
    validateStatus: () => true,
  };
  try {
    const res = await axios(config);
    return { status: res.status, data: res.data, error: null };
  } catch (err: any) {
    return { status: 0, data: null, error: err.message };
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

async function runTest(name: string, fn: () => Promise<void>) {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, status: 'PASS', duration: Date.now() - start });
    console.log(`  \x1b[32mPASS\x1b[0m ${name} (${Date.now() - start}ms)`);
  } catch (err: any) {
    results.push({ name, status: 'FAIL', duration: Date.now() - start, error: err.message });
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}: ${err.message}`);
  }
}

// ─────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────

async function main() {
  console.log('\n=== Section Attendance Smoke Tests ===\n');
  console.log(`  Base URL:   ${BASE_URL}`);
  console.log(`  School:     ${SCHOOL_ID}`);
  console.log(`  Section A:  ${SECTION_ID}`);
  console.log(`  Section B:  ${SECTION_ID_B || '(skipping isolation test)'}`);
  console.log(`  Student:    ${STUDENT_ID}`);
  console.log(`  Date:       ${today}\n`);

  // Test 1: Record single section attendance
  await runTest('Record single section attendance', async () => {
    const res = await api('POST', '/academics/section-attendance', {
      studentId: STUDENT_ID,
      sectionId: SECTION_ID,
      schoolId: SCHOOL_ID,
      date: today,
      status: 'present',
    });
    assert(res.status === 201 || res.status === 200, `Expected 200/201, got ${res.status}: ${JSON.stringify(res.data)}`);
    assert(res.data?.sectionAttendanceId, 'Missing sectionAttendanceId in response');
    assert(res.data?.sectionId === SECTION_ID, 'sectionId mismatch');
    assert(res.data?.status === 'present', 'status mismatch');
  });

  // Test 2: Get section attendance by date
  await runTest('Get section attendance by date', async () => {
    const res = await api('GET', `/academics/section-attendance?sectionId=${SECTION_ID}&schoolId=${SCHOOL_ID}&date=${today}`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(res.data?.items), 'Expected items array');
    const match = res.data.items.find((r: any) => r.studentId === STUDENT_ID);
    assert(!!match, 'Student record not found in section attendance');
    assert(match.status === 'present', 'Status mismatch in retrieved record');
  });

  // Test 3: Record bulk section attendance
  await runTest('Record bulk section attendance', async () => {
    const res = await api('POST', '/academics/section-attendance/bulk', {
      sectionId: SECTION_ID,
      schoolId: SCHOOL_ID,
      date: today,
      records: [
        { studentId: STUDENT_ID, status: 'late', notes: 'Arrived 5 min late' },
      ],
    });
    assert(res.status === 200 || res.status === 201, `Expected 200/201, got ${res.status}`);
    assert(res.data?.success === true, 'Bulk response should indicate success');
    assert(res.data?.totalProcessed >= 1, 'Should process at least 1 record');
  });

  // Test 4: Get student section attendance history
  await runTest('Get student section attendance history', async () => {
    const res = await api('GET', `/academics/section-attendance/student/${STUDENT_ID}?sectionId=${SECTION_ID}&schoolId=${SCHOOL_ID}`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(res.data), 'Expected array response');
    assert(res.data.length >= 1, 'Should have at least 1 record');
  });

  // Test 5: Update section attendance (correction)
  await runTest('Update section attendance (PATCH)', async () => {
    const res = await api('PATCH', `/academics/section-attendance/${today}/${SECTION_ID}/${STUDENT_ID}?schoolId=${SCHOOL_ID}`, {
      status: 'absent',
      notes: 'Corrected: student was absent',
    });
    assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
    assert(res.data?.status === 'absent', 'Status should be updated to absent');
  });

  // Test 6: Cross-section isolation
  if (SECTION_ID_B) {
    await runTest('Cross-section isolation', async () => {
      const res = await api('GET', `/academics/section-attendance?sectionId=${SECTION_ID_B}&schoolId=${SCHOOL_ID}&date=${today}`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const items = res.data?.items || [];
      const leak = items.find((r: any) => r.sectionId === SECTION_ID);
      assert(!leak, `Section A records leaked into Section B query! Found ${items.length} records`);
    });
  }

  // ─── Summary ───
  console.log('\n=== Results ===\n');
  const pass = results.filter(r => r.status === 'PASS').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  console.log(`  ${pass} passed, ${fail} failed out of ${results.length} tests\n`);

  if (fail > 0) {
    console.log('  Failed tests:');
    for (const r of results.filter(r => r.status === 'FAIL')) {
      console.log(`    - ${r.name}: ${r.error}`);
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
