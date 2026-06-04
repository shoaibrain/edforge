/**
 * GB1.1 Calendar Derivation - Smoke Test
 *
 * Validates the GB1.1 behavior change: school `calendarSystem` is derived from
 * the tenant's GOVERNANCE BODY (archetype), not the school's address country.
 *
 * Why the existing nepal-school-e2e.ts does NOT cover this: it passes
 * `calendarSystem: 'bikram_sambat'` explicitly in the create payload, so it
 * exercises the override path and would pass on the OLD country-branch code.
 * This smoke OMITS `calendarSystem` so the server must derive it — the only
 * way to prove GB1.1 is live.
 *
 * Expected derivation (calendarSystem OMITTED on create):
 *   - PABSON tenant  → 'bikram_sambat'  (governance body is Bikram Sambat,
 *                       regardless of the school's address country)
 *   - GENERIC tenant → 'gregorian'      (even with an NPL address — this is the
 *                       flip vs the old `country === 'NPL'` branch)
 * Override (calendarSystem PROVIDED) wins in both cases.
 *
 * Set TENANT_ARCHETYPE to match the tenant your JWT belongs to. PABSON tenants
 * require `emisSchoolCode` at create (the Sprint C gate), so it is sent only
 * for PABSON.
 *
 * Usage:
 *   1. Paste a Cognito JWT for the target tenant in ID_TOKEN below.
 *   2. Set TENANT_ARCHETYPE + BASE_URL for the environment (UAT first).
 *   3. Run: npx ts-node scripts/smoke-tests/gb1-calendar-derivation.ts
 */

import axios from 'axios';
import { readFileSync } from 'fs';

// ============================================
// CONFIGURATION
// ============================================

// JWT resolution order: $GB1_JWT, then the file at $GB1_JWT_FILE, then the
// constant below — keeps the token out of the committed file / shell history.
const ID_TOKEN =
  process.env.GB1_JWT ||
  (process.env.GB1_JWT_FILE ? readFileSync(process.env.GB1_JWT_FILE, 'utf8').trim() : '') ||
  'PASTE_YOUR_JWT_HERE';
// UAT first; swap to the prod API GW base URL for the prod leg.
const BASE_URL = 'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';
const TENANT_ARCHETYPE: 'PABSON' | 'GENERIC' = 'PABSON';

const EXPECTED_DERIVED = TENANT_ARCHETYPE === 'PABSON' ? 'bikram_sambat' : 'gregorian';
const OVERRIDE_VALUE = TENANT_ARCHETYPE === 'PABSON' ? 'gregorian' : 'bikram_sambat';

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
  const res = await axios({ method, url: `${BASE_URL}${path}`, headers, data, validateStatus: () => true });
  return { status: res.status, data: res.data };
}

/** Build a create-school payload. NPL address on purpose: for GENERIC this is the
 *  case that flips (old country-branch → bikram_sambat; GB1.1 → gregorian). */
function schoolPayload(suffix: string, calendarSystem?: string) {
  const tag = `${Date.now()}`.slice(-7);
  const payload: any = {
    // schoolCode is min(2).max(10); shortName must be unique per tenant
    // (SHORT_NAME_DUPLICATE → 409). Keep both short + per-case unique.
    schoolCode: `G${tag}${suffix[0]}`.slice(0, 10),
    name: `GB1 Calendar Derivation ${suffix}`,
    shortName: `GB1${suffix[0]}${tag.slice(-2)}`,
    schoolType: 'k12',
    gradeRange: { start: '1', end: '10' },
    phone: '9841234567',
    email: 'gb1-smoke@example.np',
    address: {
      street1: 'Smoke Test Road, Ward 1',
      municipality: 'Kathmandu Metropolitan City',
      district: 'Kathmandu',
      province: 'Bagmati Province',
      country: 'NPL',
    },
    academicCalendarType: 'annual',
  };
  if (calendarSystem) payload.calendarSystem = calendarSystem;
  // PABSON create gate requires the IEMIS school code (immutable, write-once).
  if (TENANT_ARCHETYPE === 'PABSON') payload.emisSchoolCode = `31${String(Date.now()).slice(-7)}`;
  return payload;
}

async function createAndAssertCalendar(label: string, calendarSystem: string | undefined, expected: string): Promise<string | null> {
  const res = await api('post', '/schools', schoolPayload(label, calendarSystem));
  if (res.status !== 200 && res.status !== 201) {
    fail(`Create school (${label})`, `Status ${res.status}: ${JSON.stringify(res.data)}`);
    return null;
  }
  const schoolId = res.data.schoolId;
  if (res.data.calendarSystem === expected) {
    pass(`${label}: calendarSystem = ${expected} (schoolId ${schoolId})`);
  } else {
    fail(`${label}: calendarSystem`, `Expected ${expected}, got ${res.data.calendarSystem}`);
  }
  return schoolId ?? null;
}

// ============================================
// TESTS
// ============================================

async function run() {
  console.log(`\n🗓️  GB1.1 Calendar Derivation Smoke — tenant archetype: ${TENANT_ARCHETYPE}\n`);
  console.log('='.repeat(64));
  const created: string[] = [];

  // ── Case 1 (the GB1.1 change): OMIT calendarSystem → server derives from archetype ──
  console.log(`\n📍 Case 1: omit calendarSystem → expect '${EXPECTED_DERIVED}' (derived from ${TENANT_ARCHETYPE})`);
  const derived = await createAndAssertCalendar('derive', undefined, EXPECTED_DERIVED);
  if (derived) created.push(derived);

  // ── Case 2: explicit calendarSystem still overrides the profile default ──
  console.log(`\n📍 Case 2: provide calendarSystem='${OVERRIDE_VALUE}' → override wins`);
  const overridden = await createAndAssertCalendar('override', OVERRIDE_VALUE, OVERRIDE_VALUE);
  if (overridden) created.push(overridden);

  // ── Cleanup ──
  console.log('\n🧹 Cleanup');
  for (const id of created) {
    const res = await api('delete', `/schools/${id}`);
    if (res.status === 200 || res.status === 204) pass(`Deleted ${id}`);
    else fail(`Cleanup ${id}`, `Status ${res.status} — delete manually`);
  }

  // ── Summary ──
  console.log('\n' + '='.repeat(64));
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${results.length} checks`);
  if (failed > 0) {
    console.log('\n❌ Failed checks:');
    results.filter(r => r.status === 'FAIL').forEach(r => console.log(`   - ${r.name}: ${r.error}`));
    process.exit(1);
  }
  console.log('\n✅ All checks passed — GB1.1 derivation is live.');
  process.exit(0);
}

run().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
