/// <reference types="node" />
/**
 * Sprint C2.2 — Pilot greenlight read-path test: shift-profile parity.
 *
 * Per the C2 execution plan, the second non-negotiable read-path test:
 *
 *   Sample 30 dates across the AY — 10 regular + 10 exam-window +
 *   10 weekend/holiday — and for each:
 *     1. Compute classification via fixture's `shiftProfileForDate`
 *     2. HTTP GET /schools/:id/shift-profile?date=<AD>
 *     3. Assert: backend.classification === fixture.classification
 *
 * Depends on PR-A (`/shift-profile` endpoint, PR #96, merged + deployed).
 *
 * Sampling is deterministic — no random seed. Re-runs produce identical
 * picks so divergence is reproducible.
 *
 * Pilot-agnostic per invariant 13: PILOT_ID env-var default is excluded.
 *
 * Run
 * ===
 *   # Operator places fresh prod JWT at /private/tmp/c0-c-3-prod-jwt.txt
 *   export PILOT_ID=pabson-saraswati-bs-2083                # optional override
 *   export TENANT_ID=<dev tenant uuid>                       # required
 *   export SCHOOL_ID=<existing school in tenant>             # required
 *   export ACADEMIC_YEAR_ID=<active AY uuid>                 # required
 *
 *   AWS_PROFILE=prod npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/smoke-tests/pilot-greenlight-c2-2.ts
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
const ACADEMIC_YEAR_ID = process.env.ACADEMIC_YEAR_ID ?? '';

const SAMPLES_PER_BUCKET = Number(process.env.SAMPLES_PER_BUCKET ?? 10);

// ── env validation ─────────────────────────────────────────────────────────

const required = {
  ADMIN_TOKEN: RAW_TOKEN,
  TENANT_ID,
  SCHOOL_ID,
  ACADEMIC_YEAR_ID,
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

interface ShiftProfileResponse {
  date: string;
  classification: DayClassification;
  isInstructionalDay: boolean;
  dayOfWeek: string;
  bellScheduleId?: string;
  bellScheduleName?: string;
  reason: string;
}

async function fetchShiftProfile(
  adDate: string,
): Promise<{ status: number; body: any }> {
  const url = `${BASE}/schools/${SCHOOL_ID}/shift-profile?date=${adDate}`;
  const r = await axios({
    method: 'GET',
    url,
    headers: { Authorization: TOKEN },
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
  expected: DayClassification;
  bucket: 'regular' | 'exam' | 'off';
}

/**
 * Walk every BS date in an AY and bucket each by fixture classification.
 * Deterministic: enumerates months 1..12 in fixed order; days within each
 * month in fixed order.
 */
function bucketAllDates(fixture: PilotFixture): {
  regular: SampledDate[];
  exam: SampledDate[];
  off: SampledDate[]; // weekend OR holiday OR vacation
} {
  const year = parseInt(fixture.metadata.primaryAcademicYearId.split('-')[1], 10);
  const start = fixture.academicStructure.startBsDate;
  const end = fixture.academicStructure.endBsDate;
  const [, , startD] = start.split('/').map(Number);
  const [, endM, endD] = end.split('/').map(Number);
  const [, startM] = start.split('/').map(Number);

  const regular: SampledDate[] = [];
  const exam: SampledDate[] = [];
  const off: SampledDate[] = [];

  let m = startM;
  let d = startD;
  while (true) {
    const bsDate = `${year}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
    const profile = shiftProfileForDate(fixture, bsDate);
    const sample: SampledDate = {
      bsDate,
      adDate: bsToAd(bsDate),
      expected: profile.classification,
      bucket:
        profile.classification === 'regular'
          ? 'regular'
          : profile.classification === 'exam_day'
            ? 'exam'
            : 'off',
    };
    if (sample.bucket === 'regular') regular.push(sample);
    else if (sample.bucket === 'exam') exam.push(sample);
    else off.push(sample);

    if (m === endM && d === endD) break;
    d++;
    const monthLen = getBsMonthDays(year, m);
    if (d > monthLen) {
      m++;
      d = 1;
    }
  }

  return { regular, exam, off };
}

/**
 * Even-spaced deterministic picks from a candidate list. Stable across
 * runs — no random seed.
 */
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

// ── main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('');
  console.log(`Sprint C2.2 — shift-profile parity read-path test`);
  console.log(`  pilot:    ${PILOT_ID}`);
  console.log(`  base:     ${BASE}`);
  console.log(`  tenant:   ${TENANT_ID}`);
  console.log(`  school:   ${SCHOOL_ID}`);
  console.log(`  ayId:     ${ACADEMIC_YEAR_ID}`);
  console.log(`  samples:  ${SAMPLES_PER_BUCKET}/bucket × 3 buckets`);
  console.log('');

  // ── 1. Load fixture + sample
  console.log('── 1. Load fixture + sample dates ─────────');
  const fixture = loadPilotFixture(PILOT_ID);
  check('Fixture loaded', !!fixture.metadata);

  const buckets = bucketAllDates(fixture);
  console.log(
    `   ✓ AY totals: regular=${buckets.regular.length} exam=${buckets.exam.length} off=${buckets.off.length}`,
  );

  const samples: SampledDate[] = [
    ...pickN(buckets.regular, SAMPLES_PER_BUCKET),
    ...pickN(buckets.exam, SAMPLES_PER_BUCKET),
    ...pickN(buckets.off, SAMPLES_PER_BUCKET),
  ];
  console.log(`   ✓ sampled ${samples.length} dates`);
  // Show per-classification counts among the samples
  const byClassification = samples.reduce<Record<string, number>>((acc, s) => {
    acc[s.expected] = (acc[s.expected] ?? 0) + 1;
    return acc;
  }, {});
  for (const [c, n] of Object.entries(byClassification)) {
    console.log(`     ${c}: ${n}`);
  }

  // ── 2. Per-sample HTTP GET + parity check
  console.log('');
  console.log('── 2. Per-sample parity verification ──────');
  let parityPassed = 0;
  let httpFailed = 0;
  const mismatches: Array<{
    sample: SampledDate;
    actual: DayClassification | null;
    httpStatus: number;
  }> = [];

  for (const s of samples) {
    const res = await fetchShiftProfile(s.adDate);
    if (res.status < 200 || res.status >= 300) {
      httpFailed++;
      mismatches.push({ sample: s, actual: null, httpStatus: res.status });
      continue;
    }
    const body = res.body as ShiftProfileResponse;
    if (body.classification === s.expected) {
      parityPassed++;
    } else {
      mismatches.push({
        sample: s,
        actual: body.classification,
        httpStatus: res.status,
      });
    }
  }

  console.log(
    `   ${parityPassed}/${samples.length} dates: fixture classification === backend classification`,
  );
  console.log(`   ${httpFailed} HTTP errors`);

  check(
    `All ${samples.length} sampled dates produce matching classification`,
    mismatches.length === 0,
    mismatches.length === 0 ? undefined : `${mismatches.length} divergent`,
  );

  // ── 3. Mismatch breakdown
  if (mismatches.length > 0) {
    console.log('');
    console.log('── 3. Mismatch diagnostic ─────────────────');
    for (const m of mismatches) {
      const dow = bsDayOfWeek(
        ...(m.sample.bsDate.split('/').map(Number) as [number, number, number]),
      );
      if (m.actual === null) {
        console.log(
          `   ${m.sample.adDate} (${m.sample.bsDate}, ${dow}): ` +
            `HTTP ${m.httpStatus} — expected ${m.sample.expected}`,
        );
      } else {
        console.log(
          `   ${m.sample.adDate} (${m.sample.bsDate}, ${dow}): ` +
            `fixture=${m.sample.expected} backend=${m.actual}`,
        );
      }
    }
  }

  // ── Summary
  console.log('');
  console.log('═══ SUMMARY ═══');
  if (fails.length === 0) {
    console.log('✓ All checks passed.');
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
