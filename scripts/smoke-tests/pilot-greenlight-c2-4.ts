/// <reference types="node" />
/**
 * Sprint C2.4 — Pilot greenlight read-path test: holiday exclusion.
 *
 * Per the C2 execution plan, the fourth non-negotiable read-path test:
 *
 *   Sample N non-instructional dates (holidays + weekends + vacations)
 *   per the fixture, and for each:
 *     1. POST /academics/attendance with date=<AD>
 *     2. Assert: HTTP 400
 *     3. Assert: response.errorCode === 'DATE_NOT_INSTRUCTIONAL'
 *     4. Assert: response.details.reason matches fixture classification
 *
 * Pure rejection test — no data is written, no cleanup required. The
 * backend's `validateInstructionalDay` blocks the write before any
 * persistence happens.
 *
 * Depends on PR-B (DATE_NOT_INSTRUCTIONAL structured error, PR #98,
 * merged + deployed).
 *
 * Pilot-agnostic per invariant 13: PILOT_ID env-var default is excluded.
 *
 * Run
 * ===
 *   # Operator places fresh prod JWT at /private/tmp/c0-c-3-prod-jwt.txt
 *   export PILOT_ID=pabson-saraswati-bs-2083                # optional override
 *   export TENANT_ID=<dev tenant uuid>                       # required
 *   export SCHOOL_ID=<existing school in tenant>             # required
 *   export STUDENT_ID=<existing student in school>           # required
 *
 *   AWS_PROFILE=prod npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/smoke-tests/pilot-greenlight-c2-4.ts
 */

import * as fs from 'fs';
import axios from 'axios';

import {
  loadPilotFixture,
  shiftProfileForDate,
  bsDayOfWeek,
  type PilotFixture,
  type DayClassification,
} from '@edforge/pilot-fixtures';
import { bsToGregorian, getBsMonthDays } from '@aibrains/shared-types';

// ── config ─────────────────────────────────────────────────────────────────

const PILOT_ID = process.env.PILOT_ID ?? 'pabson-saraswati-bs-2083';
const JWT_FILE = process.env.JWT_FILE ?? '/private/tmp/c0-c-3-prod-jwt.txt';

const RAW_TOKEN = fs.existsSync(JWT_FILE)
  ? fs.readFileSync(JWT_FILE, 'utf8').replace(/[\n\r ]+/g, '')
  : '';
const TOKEN = RAW_TOKEN.startsWith('Bearer ') ? RAW_TOKEN : `Bearer ${RAW_TOKEN}`;

const BASE =
  process.env.API_BASE ??
  'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';
const TENANT_ID = process.env.TENANT_ID ?? '';
const SCHOOL_ID = process.env.SCHOOL_ID ?? '';
const STUDENT_ID = process.env.STUDENT_ID ?? '';

const SAMPLES_HOLIDAY = Number(process.env.SAMPLES_HOLIDAY ?? 3);
const SAMPLES_WEEKEND = Number(process.env.SAMPLES_WEEKEND ?? 3);
const SAMPLES_VACATION = Number(process.env.SAMPLES_VACATION ?? 2);

// ── env validation ─────────────────────────────────────────────────────────

const required = {
  ADMIN_TOKEN: RAW_TOKEN,
  TENANT_ID,
  SCHOOL_ID,
  STUDENT_ID,
};
for (const [k, v] of Object.entries(required)) {
  if (!v) {
    console.error(`Missing required: ${k}`);
    if (k === 'ADMIN_TOKEN') {
      console.error(
        `  — JWT file not found or empty at ${JWT_FILE}. ` +
          `Operator: place a fresh prod TenantAdmin JWT there.`,
      );
    }
    if (k === 'STUDENT_ID') {
      console.error(`  — must reference an existing student in the school`);
    }
    process.exit(2);
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

const fails: string[] = [];
function check(name: string, ok: boolean, detail?: unknown): boolean {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) {
    const d = typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2);
    console.log(`  └─ ${d}`);
    fails.push(name);
  }
  return ok;
}

async function postAttendance(
  date: string,
): Promise<{ status: number; body: any }> {
  const r = await axios({
    method: 'POST',
    url: `${BASE}/academics/attendance`,
    headers: { Authorization: TOKEN, 'Content-Type': 'application/json' },
    data: {
      studentId: STUDENT_ID,
      date,
      status: 'present',
      schoolId: SCHOOL_ID,
      attendanceType: 'daily',
    },
    validateStatus: () => true,
    timeout: 30_000,
  });
  return { status: r.status, body: r.data };
}

function bsToAd(bsDate: string): string {
  const [y, m, d] = bsDate.split('/').map(Number);
  return bsToGregorian(y, m, d);
}

interface SampledDate {
  bsDate: string;
  adDate: string;
  classification: DayClassification;
}

/**
 * Walk every BS date in the AY and bucket by fixture classification.
 * Deterministic enumeration.
 */
function bucketAllDates(fixture: PilotFixture): {
  holiday: SampledDate[];
  weekend: SampledDate[];
  vacation: SampledDate[];
} {
  const year = parseInt(fixture.metadata.primaryAcademicYearId.split('-')[1], 10);
  const start = fixture.academicStructure.startBsDate;
  const end = fixture.academicStructure.endBsDate;
  const [, startM, startD] = start.split('/').map(Number);
  const [, endM, endD] = end.split('/').map(Number);

  const holiday: SampledDate[] = [];
  const weekend: SampledDate[] = [];
  const vacation: SampledDate[] = [];

  let m = startM;
  let d = startD;
  while (true) {
    const bsDate = `${year}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
    const profile = shiftProfileForDate(fixture, bsDate);
    const sample: SampledDate = {
      bsDate,
      adDate: bsToAd(bsDate),
      classification: profile.classification,
    };
    if (profile.classification === 'holiday') holiday.push(sample);
    else if (profile.classification === 'weekend') weekend.push(sample);
    else if (profile.classification === 'vacation') vacation.push(sample);

    if (m === endM && d === endD) break;
    d++;
    const monthLen = getBsMonthDays(year, m);
    if (d > monthLen) {
      m++;
      d = 1;
    }
  }

  return { holiday, weekend, vacation };
}

function pickN<T>(candidates: T[], n: number): T[] {
  if (candidates.length === 0) return [];
  if (candidates.length <= n) return candidates;
  const step = candidates.length / n;
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    out.push(candidates[Math.floor(i * step)]);
  }
  return out;
}

/**
 * Backend's `reason` taxonomy is a subset of fixture's classification:
 *   fixture 'holiday'  → backend 'holiday'
 *   fixture 'weekend'  → backend 'weekend'
 *   fixture 'vacation' → backend 'vacation'
 *
 * (`break` is reserved for backend's eventType taxonomy, distinct from
 * the response's `reason` field.)
 */
function expectedReason(classification: DayClassification): string {
  switch (classification) {
    case 'holiday':
      return 'holiday';
    case 'weekend':
      return 'weekend';
    case 'vacation':
      return 'vacation';
    default:
      // exam_day / regular wouldn't be in this test — defensive default
      return 'non_instructional';
  }
}

// ── main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('');
  console.log(`Sprint C2.4 — holiday exclusion read-path test`);
  console.log(`  pilot:    ${PILOT_ID}`);
  console.log(`  base:     ${BASE}`);
  console.log(`  tenant:   ${TENANT_ID}`);
  console.log(`  school:   ${SCHOOL_ID}`);
  console.log(`  student:  ${STUDENT_ID}`);
  console.log(`  samples:  holiday=${SAMPLES_HOLIDAY} weekend=${SAMPLES_WEEKEND} vacation=${SAMPLES_VACATION}`);
  console.log('');

  // 1. Load fixture + bucket
  console.log('── 1. Load fixture + sample non-instr dates ──');
  const fixture = loadPilotFixture(PILOT_ID);
  check('Fixture loaded', !!fixture.metadata);

  const buckets = bucketAllDates(fixture);
  console.log(
    `   ✓ AY totals: holiday=${buckets.holiday.length} weekend=${buckets.weekend.length} vacation=${buckets.vacation.length}`,
  );

  const samples: SampledDate[] = [
    ...pickN(buckets.holiday, SAMPLES_HOLIDAY),
    ...pickN(buckets.weekend, SAMPLES_WEEKEND),
    ...pickN(buckets.vacation, SAMPLES_VACATION),
  ];
  console.log(`   ✓ sampled ${samples.length} non-instructional dates`);
  if (samples.length === 0) {
    console.log('');
    console.log('FATAL: no non-instructional dates sampled — fixture has no holidays/weekends?');
    process.exit(2);
  }

  // 2. Per-sample POST + assertions
  console.log('');
  console.log('── 2. Per-sample rejection verification ────');

  for (const s of samples) {
    const dow = bsDayOfWeek(
      ...(s.bsDate.split('/').map(Number) as [number, number, number]),
    );
    console.log(
      `\n  ▸ ${s.adDate} (BS ${s.bsDate}, ${dow}) — fixture says ${s.classification}`,
    );

    const res = await postAttendance(s.adDate);

    // Assert: HTTP 400
    check(
      `${s.adDate} POST /academics/attendance → 400`,
      res.status === 400,
      { status: res.status, body: res.body },
    );
    if (res.status !== 400) continue;

    // Assert: errorCode
    check(
      `${s.adDate} response.errorCode === DATE_NOT_INSTRUCTIONAL`,
      res.body?.errorCode === 'DATE_NOT_INSTRUCTIONAL',
      { errorCode: res.body?.errorCode, message: res.body?.message },
    );

    // Assert: details.reason
    const expectedR = expectedReason(s.classification);
    check(
      `${s.adDate} response.details.reason === ${expectedR}`,
      res.body?.details?.reason === expectedR,
      `expected=${expectedR} got=${res.body?.details?.reason}`,
    );

    // Assert: details.date matches the date we sent
    check(
      `${s.adDate} response.details.date echoes request`,
      res.body?.details?.date === s.adDate,
      { sent: s.adDate, echoed: res.body?.details?.date },
    );
  }

  // Summary
  console.log('');
  console.log('═══ SUMMARY ═══');
  if (fails.length === 0) {
    console.log(`✓ All ${samples.length * 4} checks passed across ${samples.length} non-instructional dates.`);
    process.exit(0);
  } else {
    console.log(`✗ ${fails.length} check(s) failed:`);
    for (const f of fails) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FATAL:', err?.stack ?? err);
  process.exit(1);
});
