/**
 * School Creation Flow - Smoke Test
 *
 * Validates the school creation wizard fixes from the School-Creation-Production sprint:
 * - Cross-validation of schoolType vs gradeRange
 * - Backend rejection of invalid combinations
 * - Status transition API
 * - Config auto-creation with school
 *
 * Usage:
 *   1. Paste your Cognito JWT in ID_TOKEN below
 *   2. Run: npx ts-node scripts/smoke-tests/school-creation-flow.ts
 */

import axios from 'axios';

// ============================================
// CONFIGURATION
// ============================================

const ID_TOKEN = 'PASTE_YOUR_JWT_HERE';
const BASE_URL = 'https://jjz4fkqxvd.execute-api.us-east-2.amazonaws.com/prod';

// ============================================
// HELPERS
// ============================================

const headers = { Authorization: `Bearer ${ID_TOKEN}`, 'Content-Type': 'application/json' };

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL';
  error?: string;
}

const results: TestResult[] = [];

function pass(name: string) {
  results.push({ name, status: 'PASS' });
  console.log(`  ✅ ${name}`);
}

function fail(name: string, error: string) {
  results.push({ name, status: 'FAIL', error });
  console.log(`  ❌ ${name}: ${error}`);
}

async function api(method: 'get' | 'post' | 'patch' | 'delete', path: string, data?: any) {
  const url = `${BASE_URL}${path}`;
  const res = await axios({ method, url, headers, data, validateStatus: () => true });
  return { status: res.status, data: res.data };
}

// ============================================
// TESTS
// ============================================

async function run() {
  console.log('\n🏫 School Creation Flow - Smoke Tests\n');
  console.log('='.repeat(60));

  let schoolId: string | undefined;
  const testCode = `TST${Date.now().toString(36).toUpperCase().slice(-4)}`;

  // ── Test 1: Create school with valid data ──
  console.log('\n📋 Test 1: Create school with valid schoolType/gradeRange');
  try {
    const res = await api('post', '/schools', {
      name: `Smoke Test School ${testCode}`,
      schoolCode: testCode,
      schoolType: 'high',
      gradeRange: { start: '9', end: '12' },
      timezone: 'America/Chicago',
    });
    if (res.status === 201 || res.status === 200) {
      schoolId = res.data.schoolId;
      if (res.data.status === 'setup') {
        pass('School created with status=setup');
      } else {
        fail('School created with status=setup', `Got status=${res.data.status}`);
      }
    } else {
      fail('Create school', `Status ${res.status}: ${JSON.stringify(res.data)}`);
    }
  } catch (e: any) {
    fail('Create school', e.message);
  }

  // ── Test 2: Config auto-created ──
  if (schoolId) {
    console.log('\n📋 Test 2: Config auto-created with school');
    try {
      const res = await api('get', `/schools/${schoolId}/configuration`);
      if (res.status === 200 && res.data.timezone) {
        pass('Config exists immediately after school creation');
      } else {
        fail('Config auto-created', `Status ${res.status}`);
      }
    } catch (e: any) {
      fail('Config auto-created', e.message);
    }
  }

  // ── Test 3: Reject contradictory schoolType + gradeRange ──
  console.log('\n📋 Test 3: Reject middle school with high school grades');
  try {
    const res = await api('post', '/schools', {
      name: 'Bad Middle School',
      schoolCode: `BAD${testCode.slice(0, 3)}`,
      schoolType: 'middle',
      gradeRange: { start: '9', end: '12' },
    });
    if (res.status === 400) {
      pass('Backend rejected middle + grades 9-12');
    } else {
      fail('Reject contradictory combo', `Expected 400, got ${res.status}`);
    }
  } catch (e: any) {
    fail('Reject contradictory combo', e.message);
  }

  // ── Test 4: Reject reversed grade range ──
  console.log('\n📋 Test 4: Reject reversed grade range (end < start)');
  try {
    const res = await api('post', '/schools', {
      name: 'Reversed Grades School',
      schoolCode: `REV${testCode.slice(0, 3)}`,
      schoolType: 'high',
      gradeRange: { start: '12', end: '9' },
    });
    if (res.status === 400) {
      pass('Backend rejected reversed grade range');
    } else {
      fail('Reject reversed range', `Expected 400, got ${res.status}`);
    }
  } catch (e: any) {
    fail('Reject reversed range', e.message);
  }

  // ── Test 5: Status transition: setup → active ──
  if (schoolId) {
    console.log('\n📋 Test 5: Status transition setup → active');
    try {
      const res = await api('patch', `/schools/${schoolId}/status`, { status: 'active' });
      if (res.status === 200 && res.data.status === 'active') {
        pass('Status transitioned to active');
      } else {
        fail('Status transition', `Status ${res.status}, school status=${res.data?.status}`);
      }
    } catch (e: any) {
      fail('Status transition', e.message);
    }
  }

  // ── Test 6: Reject invalid transition: active → setup ──
  if (schoolId) {
    console.log('\n📋 Test 6: Reject invalid transition active → setup');
    try {
      const res = await api('patch', `/schools/${schoolId}/status`, { status: 'setup' });
      if (res.status === 400) {
        pass('Backend rejected active → setup transition');
      } else {
        fail('Reject invalid transition', `Expected 400, got ${res.status}`);
      }
    } catch (e: any) {
      fail('Reject invalid transition', e.message);
    }
  }

  // ── Test 7: Update school with cross-validation ──
  if (schoolId) {
    console.log('\n📋 Test 7: Reject update that creates contradictory combo');
    try {
      const res = await api('patch', `/schools/${schoolId}`, {
        schoolType: 'elementary',
        gradeRange: { start: '9', end: '12' },
      });
      if (res.status === 400) {
        pass('Backend rejected elementary + grades 9-12 on update');
      } else {
        fail('Reject contradictory update', `Expected 400, got ${res.status}`);
      }
    } catch (e: any) {
      fail('Reject contradictory update', e.message);
    }
  }

  // ── Test 8: Duplicate school code rejection ──
  console.log('\n📋 Test 8: Reject duplicate school code');
  try {
    const res = await api('post', '/schools', {
      name: 'Duplicate Code School',
      schoolCode: testCode,
      schoolType: 'high',
      gradeRange: { start: '9', end: '12' },
    });
    if (res.status === 409) {
      pass('Backend rejected duplicate school code');
    } else {
      fail('Reject duplicate code', `Expected 409, got ${res.status}`);
    }
  } catch (e: any) {
    fail('Reject duplicate code', e.message);
  }

  // ── Cleanup ──
  if (schoolId) {
    console.log('\n🧹 Cleanup: deleting test school');
    await api('delete', `/schools/${schoolId}`);
  }

  // ── Summary ──
  console.log('\n' + '='.repeat(60));
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${results.length} tests`);

  if (failed > 0) {
    console.log('\n❌ Failed tests:');
    results.filter((r) => r.status === 'FAIL').forEach((r) => {
      console.log(`   - ${r.name}: ${r.error}`);
    });
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
  }
}

run().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
