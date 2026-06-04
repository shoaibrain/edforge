/**
 * GB2 Lifecycle Seeding — Smoke Test
 *
 * Validates the GB2 behaviors against a deployed environment, end-to-end through
 * API Gateway (so it also proves the shared-infra-stack route registration for
 * the two new endpoints — a 403 here means the API GW spec wasn't deployed):
 *
 *   GB2.2/2.3 — GET /academics/board-exams?schoolId=… lazily seeds the
 *               archetype's board exams (PABSON → BLE@8, SEE@10; NEB_11/12 only
 *               if the school reaches those grades) and is idempotent (a second
 *               call returns the same set — no top-up).
 *   GB2.5     — GET /academics/exams/exam-pattern returns the archetype's
 *               examPattern (PABSON → unit_test/terminal/send_up/pre_board/final).
 *   GB2.4     — POST /academics/courses WITHOUT curriculumRef defaults it from
 *               the governance profile (PABSON → CDC_NCF_2076). The smoke course
 *               is soft-deleted afterward.
 *
 * Requires an EXISTING PABSON school (board exams + course-create reference it).
 * Point GB2_SCHOOL_ID at a PABSON school in the tenant your JWT belongs to
 * (use the dev-pabson tenant first).
 *
 * Usage:
 *   export GB2_JWT_FILE=/path/to/token   # or GB2_JWT=<token>
 *   export GB2_SCHOOL_ID=<existing PABSON schoolId>
 *   export GB2_BASE_URL=https://<api-gw>/prod        # optional; default below
 *   TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node"}' \
 *     npx ts-node scripts/smoke-tests/gb2-seeding.ts
 */

import axios from 'axios';
import { readFileSync } from 'fs';

// ============================================
// CONFIGURATION
// ============================================

const ID_TOKEN =
  process.env.GB2_JWT ||
  (process.env.GB2_JWT_FILE ? readFileSync(process.env.GB2_JWT_FILE, 'utf8').trim() : '') ||
  'PASTE_YOUR_JWT_HERE';
const BASE_URL =
  process.env.GB2_BASE_URL || 'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';
const SCHOOL_ID = process.env.GB2_SCHOOL_ID || 'PASTE_EXISTING_PABSON_SCHOOL_ID';
const TENANT_ARCHETYPE: 'PABSON' | 'GENERIC' =
  (process.env.GB2_ARCHETYPE as 'PABSON' | 'GENERIC') || 'PABSON';

// PABSON expectations (the meaningful case — GENERIC has no board exams + CCSS).
const EXPECTED_EXAM_PATTERN = ['unit_test', 'terminal', 'send_up', 'pre_board', 'final'];
const EXPECTED_CURRICULUM_REF = 'CDC_NCF_2076';
const VALID_BOARD_EXAM_TYPES = ['BLE', 'SEE', 'NEB_11', 'NEB_12'];

// ============================================
// HELPERS
// ============================================

const headers = { Authorization: `Bearer ${ID_TOKEN}`, 'Content-Type': 'application/json' };

interface TestResult { name: string; status: 'PASS' | 'FAIL'; error?: string }
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
  const res = await axios({
    method,
    url: `${BASE_URL}${path}`,
    headers,
    data,
    timeout: 30000, // fail fast instead of blocking the deploy on a hung request
    validateStatus: () => true,
  });
  return { status: res.status, data: res.data };
}

const sortedTypes = (rows: any[]): string[] =>
  (Array.isArray(rows) ? rows.map((r) => r.examType) : []).sort();

// ============================================
// TESTS
// ============================================

async function boardExamsSeedOnEmpty() {
  console.log('\n📍 GB2.2/2.3: GET /academics/board-exams — seed-on-empty + idempotent');
  const first = await api('get', `/academics/board-exams?schoolId=${SCHOOL_ID}`);
  if (first.status === 403) {
    fail('board-exams route', `403 SigV4 — API GW route not registered (deploy shared-infra-stack)`);
    return;
  }
  if (first.status !== 200) {
    fail('board-exams GET', `Status ${first.status}: ${JSON.stringify(first.data)}`);
    return;
  }
  if (!Array.isArray(first.data)) {
    fail('board-exams response', `expected an array, got ${typeof first.data}: ${JSON.stringify(first.data)}`);
    return;
  }
  const types = sortedTypes(first.data);
  if (types.length === 0) {
    fail('board-exams seeded', `empty — expected at least BLE/SEE for a PABSON school covering grade 8+`);
    return;
  }
  const allValid = types.every((t) => VALID_BOARD_EXAM_TYPES.includes(t));
  if (allValid) pass(`board-exams seeded: [${types.join(', ')}] (all valid PABSON board exams)`);
  else fail('board-exams valid', `got [${types.join(', ')}] — not all in ${VALID_BOARD_EXAM_TYPES.join('/')}`);

  if (types.includes('BLE') && types.includes('SEE')) pass('board-exams include BLE + SEE');
  else fail('board-exams BLE/SEE', `expected BLE+SEE, got [${types.join(', ')}]`);

  // Idempotency: a second call returns the same set (no top-up / no duplicates).
  const second = await api('get', `/academics/board-exams?schoolId=${SCHOOL_ID}`);
  const types2 = sortedTypes(second.data);
  if (JSON.stringify(types2) === JSON.stringify(types)) pass(`idempotent: re-list returns the same ${types.length} board exam(s)`);
  else fail('board-exams idempotent', `first [${types.join(', ')}] vs second [${types2.join(', ')}]`);
}

async function examPattern() {
  console.log('\n📍 GB2.5: GET /academics/exams/exam-pattern');
  const res = await api('get', `/academics/exams/exam-pattern`);
  if (res.status === 403) {
    fail('exam-pattern route', `403 SigV4 — API GW route not registered (deploy shared-infra-stack)`);
    return;
  }
  if (res.status !== 200) {
    fail('exam-pattern GET', `Status ${res.status}: ${JSON.stringify(res.data)}`);
    return;
  }
  if (!Array.isArray(res.data?.examPattern)) {
    fail('exam-pattern response', `expected examPattern array, got: ${JSON.stringify(res.data)}`);
    return;
  }
  if (res.data.archetype === TENANT_ARCHETYPE) pass(`exam-pattern archetype = ${TENANT_ARCHETYPE}`);
  else fail('exam-pattern archetype', `expected ${TENANT_ARCHETYPE}, got ${res.data.archetype}`);

  const got = [...res.data.examPattern].sort();
  const want = [...EXPECTED_EXAM_PATTERN].sort();
  if (JSON.stringify(got) === JSON.stringify(want)) pass(`exam-pattern = [${EXPECTED_EXAM_PATTERN.join(', ')}]`);
  else fail('exam-pattern values', `expected [${want.join(', ')}], got [${got.join(', ')}]`);
}

async function curriculumDefault() {
  console.log('\n📍 GB2.4: POST /academics/courses (omit curriculumRef) → archetype default');
  const tag = `${Date.now()}`.slice(-7);
  const payload = {
    schoolId: SCHOOL_ID,
    courseCode: `GB2SMK${tag}`.slice(0, 10),
    courseName: `GB2 smoke ${tag}`,
    gradeLevels: ['8'],
    credits: 1,
    subjectArea: 'mathematics',
    courseType: 'required',
    typicalDuration: 'year',
    // curriculumRef intentionally omitted — server must default it.
  };
  const res = await api('post', '/academics/courses', payload);
  if (res.status !== 200 && res.status !== 201) {
    fail('course create', `Status ${res.status}: ${JSON.stringify(res.data)}`);
    return;
  }
  if (res.data.curriculumRef === EXPECTED_CURRICULUM_REF) {
    pass(`course curriculumRef defaulted to ${EXPECTED_CURRICULUM_REF}`);
  } else {
    fail('course curriculumRef', `expected ${EXPECTED_CURRICULUM_REF}, got ${res.data.curriculumRef}`);
  }

  // Cleanup — soft-delete the smoke course.
  const courseId = res.data.courseId ?? res.data.id;
  if (courseId) {
    const del = await api('delete', `/academics/courses/${courseId}?schoolId=${SCHOOL_ID}`);
    if (del.status === 200 || del.status === 204) pass(`cleanup: soft-deleted smoke course ${courseId}`);
    else fail('course cleanup', `Status ${del.status} — delete course ${courseId} manually`);
  }
}

async function run() {
  console.log(`\n🌱 GB2 Lifecycle Seeding Smoke — archetype: ${TENANT_ARCHETYPE}, school: ${SCHOOL_ID}\n`);
  console.log('='.repeat(64));
  if (SCHOOL_ID.startsWith('PASTE_')) {
    console.error('Set GB2_SCHOOL_ID to an existing PABSON schoolId before running.');
    process.exit(2);
  }

  await boardExamsSeedOnEmpty();
  await examPattern();
  await curriculumDefault();

  console.log('\n' + '='.repeat(64));
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${results.length} checks`);
  if (failed > 0) {
    console.log('\n❌ Failed checks:');
    results.filter((r) => r.status === 'FAIL').forEach((r) => console.log(`   - ${r.name}: ${r.error}`));
    process.exit(1);
  }
  console.log('\n✅ All checks passed — GB2 lifecycle seeding is live.');
  process.exit(0);
}

run().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
