/// <reference types="node" />
/**
 * Sprint C2.1 — Pilot greenlight read-path test: instructional days.
 *
 * Per the C2 execution plan, the first non-negotiable read-path test:
 *
 *   For each term in the pilot's academic-structure:
 *     1. Compute expected instructional-day count from the fixture
 *        via @edforge/pilot-fixtures' instructionalDaysInRange()
 *     2. HTTP GET the deployed backend for the same date range
 *     3. Assert: backend count === fixture count
 *
 * Endpoint: GET /schools/:id/calendar-dates?startDate=&endDate=&isInstructionalDay=true&limit=400
 *
 * The plan-literal endpoint was GET /academic-years/.../instructional-days
 * (date-range filter); that doesn't exist. Instead we use the EXISTING
 * /calendar-dates list endpoint with isInstructionalDay=true filter +
 * date-range query params. Count the items.
 *
 * **Caveat:** assumes the dev tenant's calendar-dates have been generated
 * for the AY. If the per-term query returns 0 rows AND the fixture
 * expects > 0, that's the signal the calendar wasn't generated. Seed via
 * POST /schools/:id/academic-years/:yearId/generate-calendar.
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
 *     scripts/smoke-tests/pilot-greenlight-c2-1.ts
 */

import * as fs from 'fs';
import axios from 'axios';

import {
  loadPilotFixture,
  instructionalDaysInRange,
  expandHolidays,
  bsDayOfWeek,
  type PilotFixture,
} from '@edforge/pilot-fixtures';
import { bsToGregorian, gregorianToBs } from '@aibrains/shared-types';

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

async function http(
  method: 'GET',
  path: string,
): Promise<{ status: number; body: any }> {
  const r = await axios({
    method,
    url: `${BASE}${path}`,
    headers: { Authorization: TOKEN },
    validateStatus: () => true,
    timeout: 30_000,
  });
  return { status: r.status, body: r.data };
}

/**
 * Convert BS YYYY/MM/DD → AD YYYY-MM-DD via shared-types canonical
 * converter. shared-types 0.44.0+ has the corrected Pus 2083 = 30
 * days fix (PR #82); this call exercises the canonical path.
 */
function bsToAd(bsDate: string): string {
  const [y, m, d] = bsDate.split('/').map(Number);
  return bsToGregorian(y, m, d);
}

/**
 * Print the dates that fixture and backend disagree on for the given
 * term range. Resolves each AD date back to BS for operator readability.
 *
 * Two sets:
 *   - fixture-only-non-instructional: fixture thinks non-instructional,
 *     backend thinks instructional. These are days the fixture has as
 *     holidays/vacations/weekends but the backend doesn't.
 *   - backend-only-non-instructional: backend thinks non-instructional,
 *     fixture thinks instructional. These are days the backend has as
 *     holidays/weekends but the fixture doesn't (likely missing holidays
 *     in the fixture).
 */
async function printDivergence(
  adStart: string,
  adEnd: string,
  backendInstructionalItems: Array<{ date: string }>,
  fixture: PilotFixture,
  term: { id: string; startBsDate: string; endBsDate: string },
): Promise<void> {
  // Backend's instructional-day AD-date set
  const backendInstructional = new Set(
    backendInstructionalItems.map((i) => i.date),
  );

  // Walk every BS date in the term range; compute fixture's view + compare
  const fixtureNonInstr: { ad: string; bs: string; why: string }[] = [];
  const backendNonInstr: { ad: string; bs: string }[] = [];
  const fixtureInstr = new Set<string>();
  const schoolDaysSet = new Set(fixture.metadata.schoolDays);
  const holidayDateSet = new Set(expandHolidays(fixture).map((h) => h.bsDate));

  // Walk term range one BS day at a time
  const startBs = term.startBsDate;
  const endBs = term.endBsDate;
  const [sy, sm, sd] = startBs.split('/').map(Number);
  const [, em, ed] = endBs.split('/').map(Number);
  let m = sm,
    d = sd;
  while (true) {
    const bsStr = `${sy}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
    const adIso = bsToGregorian(sy, m, d);
    const dow = bsDayOfWeek(sy, m, d);
    const isWeekend = !schoolDaysSet.has(dow);
    const isHoliday = holidayDateSet.has(bsStr);
    const isFixtureInstr = !isWeekend && !isHoliday;

    if (isFixtureInstr) fixtureInstr.add(adIso);
    else {
      const why = isWeekend && isHoliday ? `weekend+holiday(${dow})` : isWeekend ? `weekend(${dow})` : 'holiday';
      fixtureNonInstr.push({ ad: adIso, bs: bsStr, why });
    }

    if (m === em && d === ed) break;
    d++;
    const monthLen = (await import('@aibrains/shared-types')).getBsMonthDays(sy, m);
    if (d > monthLen) {
      m++;
      d = 1;
    }
  }

  // fixture-only-non-instr: backend says instructional, fixture says non
  const fixtureOnly = fixtureNonInstr.filter((x) => backendInstructional.has(x.ad));
  if (fixtureOnly.length > 0) {
    console.log(
      `     ⓘ fixture-only non-instructional (${fixtureOnly.length}) — fixture says NON, backend says YES:`,
    );
    for (const f of fixtureOnly) {
      console.log(`        ${f.ad} (${f.bs}) — fixture: ${f.why}`);
    }
  }

  // backend-only-non-instr: backend says non, fixture says instructional
  const backendOnlyDates: { ad: string; bs: string }[] = [];
  // Walk the term range AD dates and find ones where fixture is instr but backend isn't
  for (const adIso of fixtureInstr) {
    if (!backendInstructional.has(adIso)) {
      const bs = gregorianToBs(adIso + 'T12:00:00');
      const bsStr = `${bs.year}/${String(bs.month).padStart(2, '0')}/${String(bs.day).padStart(2, '0')}`;
      backendOnlyDates.push({ ad: adIso, bs: bsStr });
    }
  }
  if (backendOnlyDates.length > 0) {
    console.log(
      `     ⓘ backend-only non-instructional (${backendOnlyDates.length}) — fixture says YES, backend says NON:`,
    );
    for (const b of backendOnlyDates) {
      console.log(`        ${b.ad} (${b.bs}) — likely an extra holiday in backend's archetype seed`);
    }
  }
}

// ── main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('');
  console.log(`Sprint C2.1 — instructional-days read-path test`);
  console.log(`  pilot:    ${PILOT_ID}`);
  console.log(`  base:     ${BASE}`);
  console.log(`  tenant:   ${TENANT_ID}`);
  console.log(`  school:   ${SCHOOL_ID}`);
  console.log(`  ayId:     ${ACADEMIC_YEAR_ID}`);
  console.log('');

  // Load fixture
  console.log('── 1. Load fixture ────────────────────────');
  const fixture = loadPilotFixture(PILOT_ID);
  check('Fixture loaded', !!fixture.metadata);
  check(
    `Fixture has ${fixture.academicStructure.terms.length} terms`,
    fixture.academicStructure.terms.length > 0,
  );

  // Per-term verification
  console.log('');
  console.log('── 2. Per-term instructional-day verification ────');
  for (const term of fixture.academicStructure.terms) {
    const expected = instructionalDaysInRange(
      fixture,
      term.startBsDate,
      term.endBsDate,
    );
    const adStart = bsToAd(term.startBsDate);
    const adEnd = bsToAd(term.endBsDate);

    const url =
      `/schools/${SCHOOL_ID}/calendar-dates` +
      `?academicYearId=${ACADEMIC_YEAR_ID}` +
      `&startDate=${adStart}` +
      `&endDate=${adEnd}` +
      `&isInstructionalDay=true` +
      `&limit=400`;
    const res = await http('GET', url);

    if (!check(
      `${term.id} GET /calendar-dates?isInstructional=true → 2xx`,
      res.status >= 200 && res.status < 300,
      { status: res.status, body: res.body },
    )) {
      continue;
    }

    const items = res.body?.items;
    if (!Array.isArray(items)) {
      check(`${term.id} response.items is an array`, false, res.body);
      continue;
    }

    const backendCount = items.length;

    // Sanity: no pagination cap leakage (we asked for 400 — way over any term)
    check(
      `${term.id} response.hasMore=false (no truncation)`,
      res.body.hasMore === false,
      { hasMore: res.body.hasMore, count: backendCount },
    );

    console.log(
      `  → ${term.id}: ${term.startBsDate} (${adStart}) → ${term.endBsDate} (${adEnd})`,
    );
    console.log(`     fixture expected: ${expected}`);
    console.log(`     backend returned: ${backendCount}`);
    const matched = backendCount === expected;
    check(
      `${term.id} backend instructional-day count matches fixture (${expected})`,
      matched,
      `expected=${expected}, got=${backendCount}, delta=${backendCount - expected}`,
    );

    // On mismatch, print the symmetric difference so the operator can
    // see which specific dates diverge and decide whether to update the
    // fixture or the backend's holiday seed.
    if (!matched) {
      await printDivergence(adStart, adEnd, items, fixture, term);
    }
  }

  // Summary
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
