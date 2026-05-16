/// <reference types="node" />
/**
 * Sprint C2.5 — Pilot greenlight read-path test: edge cases.
 *
 * Per the C2 execution plan, the fifth read-path test covers 6 surgical
 * edge cases that exercise calendar-boundary behavior without overlapping
 * the bulk-coverage tests C2.1-C2.4:
 *
 *   1. AY boundary day (Baisakh 3 — first day of AY)
 *   2. Next-AY day-1 (Baisakh 1 2084 — provisional window start)
 *   3. Next-AY result-publish day (Baisakh 8 2084)
 *   4. Next-AY new-session-begin day (Baisakh 12 2084)
 *   5. Mid-vacation day (Summer Vacation, Saun 5 = 2083/04/05)
 *   6. Day after a school-specific program day (Magh 30 = 2083/10/30,
 *      day after the 2-day Saraswati Puja program block)
 *
 * Cases 1, 5, 6 are inside the current AY → expect 200 with a specific
 * classification.
 * Cases 2, 3, 4 are outside the current AY → expect 404 (no CalendarDate
 * row exists for next-AY dates until C9 provisions them).
 *
 * Why this matters
 * ----------------
 * - AY-boundary cases probe off-by-one fences (Saun 32 vs Saun 33 etc.)
 * - Next-AY cases probe what the operator UI does when an admin clicks
 *   a date past the AY range (must show "calendar not generated" not
 *   "non-instructional")
 * - Mid-vacation probes that vacation blocks classify correctly when
 *   the queried date is in the middle of the block (not just the edges)
 * - Day-after-program probes that single program days don't bleed into
 *   adjacent days' classification
 *
 * Depends on PR-A (`/shift-profile` endpoint, PR #96, merged + deployed).
 *
 * Pilot-agnostic: cross-year-marker dates come from the fixture's
 * `crossYearMarkers`. Mid-vacation + day-after-program dates are
 * resolved via the fixture's `holidaysConsolidated.blocks` +
 * `programs.programs` for the active pilot. NOTE: case 6 falls back
 * to a generic "any day immediately following any program day" if no
 * day-after-program candidate is in-range for the AY.
 *
 * Run
 * ===
 *   # Operator places fresh prod JWT at /private/tmp/c0-c-3-prod-jwt.txt
 *   export PILOT_ID=pabson-saraswati-bs-2083                # optional override
 *   export TENANT_ID=<dev tenant uuid>                       # required
 *   export SCHOOL_ID=<existing school in tenant>             # required
 *
 *   AWS_PROFILE=prod npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/smoke-tests/pilot-greenlight-c2-5.ts
 */

import * as fs from 'fs';
import axios from 'axios';

import {
  loadPilotFixture,
  shiftProfileForDate,
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

// ── env validation ─────────────────────────────────────────────────────────

const required = {
  ADMIN_TOKEN: RAW_TOKEN,
  TENANT_ID,
  SCHOOL_ID,
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

/**
 * Compute the BS date immediately after the given one. Walks forward by
 * one day, rolling over month boundaries. Throws if it would roll past
 * end of year (caller's problem — case 6 only asks within a single year).
 */
function nextBsDay(bsDate: string): string {
  const [y, m, d] = bsDate.split('/').map(Number);
  const monthLen = getBsMonthDays(y, m);
  let nm = m;
  let nd = d + 1;
  if (nd > monthLen) {
    nm = m + 1;
    nd = 1;
  }
  if (nm > 12) {
    throw new Error(`nextBsDay: year-boundary at ${bsDate} (out of scope)`);
  }
  return `${y}/${String(nm).padStart(2, '0')}/${String(nd).padStart(2, '0')}`;
}

interface EdgeCase {
  name: string;
  bsDate: string;
  adDate: string;
  expected:
    | { kind: 'classification'; value: DayClassification }
    | { kind: 'not-found' };
}

function planEdgeCases(fixture: PilotFixture): EdgeCase[] {
  const cases: EdgeCase[] = [];

  // 1. AY boundary day — first day of AY
  const ayStartBs = fixture.academicStructure.startBsDate;
  cases.push({
    name: 'AY boundary day (first day of AY)',
    bsDate: ayStartBs,
    adDate: bsToAd(ayStartBs),
    expected: {
      kind: 'classification',
      value: shiftProfileForDate(fixture, ayStartBs).classification,
    },
  });

  // 2/3/4. Next-AY dates from crossYearMarkers — expect 404
  const xy = fixture.academicStructure.crossYearMarkers;
  if (xy) {
    const provisionalStart = xy.provisionalWindow.startBsDate;
    cases.push({
      name: 'Next-AY day-1 (provisional window start)',
      bsDate: provisionalStart,
      adDate: bsToAd(provisionalStart),
      expected: { kind: 'not-found' },
    });
    cases.push({
      name: 'Next-AY result-publish day',
      bsDate: xy.resultPublishBsDate,
      adDate: bsToAd(xy.resultPublishBsDate),
      expected: { kind: 'not-found' },
    });
    cases.push({
      name: 'Next-AY new-session-begin day',
      bsDate: xy.newSessionBeginBsDate,
      adDate: bsToAd(xy.newSessionBeginBsDate),
      expected: { kind: 'not-found' },
    });
  }

  // 5. Mid-vacation day — middle of the longest school_specific block
  const vacationBlocks = fixture.holidaysConsolidated.blocks.filter(
    (b) => b.category === 'school_specific',
  );
  if (vacationBlocks.length > 0) {
    // Pick the longest vacation block
    const v = vacationBlocks
      .map((b) => {
        const [, sm, sd] = b.startBsDate.split('/').map(Number);
        const [, em, ed] = b.endBsDate.split('/').map(Number);
        return { b, span: (em - sm) * 32 + (ed - sd) };
      })
      .sort((a, b) => b.span - a.span)[0].b;

    // Midpoint of the block
    const [vy, sm, sd] = v.startBsDate.split('/').map(Number);
    const [, em, ed] = v.endBsDate.split('/').map(Number);
    // Approximation: midpoint by day-of-month if same month, else start+2
    const midM = sm === em ? sm : sm;
    const midD =
      sm === em
        ? Math.floor((sd + ed) / 2)
        : Math.min(sd + 2, getBsMonthDays(vy, sm));
    const midBs = `${vy}/${String(midM).padStart(2, '0')}/${String(midD).padStart(2, '0')}`;
    cases.push({
      name: `Mid-vacation day (block "${v.name}")`,
      bsDate: midBs,
      adDate: bsToAd(midBs),
      expected: {
        kind: 'classification',
        value: shiftProfileForDate(fixture, midBs).classification,
      },
    });
  }

  // 6. Day after a school-specific program day. We pick the LAST day of
  // any multi-day school_specific program block; if no multi-day block,
  // fall back to the day after the first school_specific single-day
  // program.
  const programs = fixture.programs.programs.filter(
    (p) => p.category === 'school_specific',
  );
  if (programs.length > 0) {
    // Prefer a multi-day program; fall back to a single-day
    const multi = programs.find((p) => p.startBsDate !== p.endBsDate);
    const target = multi ?? programs[0];
    try {
      const dayAfter = nextBsDay(target.endBsDate);
      cases.push({
        name: `Day after program "${target.name}"`,
        bsDate: dayAfter,
        adDate: bsToAd(dayAfter),
        expected: {
          kind: 'classification',
          value: shiftProfileForDate(fixture, dayAfter).classification,
        },
      });
    } catch {
      // Year-boundary roll — skip case 6 quietly
    }
  }

  return cases;
}

// ── main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('');
  console.log(`Sprint C2.5 — edge-case read-path test`);
  console.log(`  pilot:    ${PILOT_ID}`);
  console.log(`  base:     ${BASE}`);
  console.log(`  tenant:   ${TENANT_ID}`);
  console.log(`  school:   ${SCHOOL_ID}`);
  console.log('');

  // 1. Plan edge cases
  console.log('── 1. Load fixture + plan edge cases ──────');
  const fixture = loadPilotFixture(PILOT_ID);
  check('Fixture loaded', !!fixture.metadata);

  const cases = planEdgeCases(fixture);
  console.log(`   ✓ planned ${cases.length} edge cases`);

  // 2. Per-case verification
  console.log('');
  console.log('── 2. Per-case verification ───────────────');
  for (const c of cases) {
    console.log(
      `\n  ▸ ${c.name}\n     BS ${c.bsDate} → AD ${c.adDate}`,
    );
    const res = await fetchShiftProfile(c.adDate);

    if (c.expected.kind === 'not-found') {
      check(
        `${c.adDate} expects 404 (no CalendarDate row, outside AY)`,
        res.status === 404,
        { status: res.status, body: res.body },
      );
      continue;
    }

    // Inside AY → expect 200 with matching classification
    if (!check(
      `${c.adDate} GET /shift-profile → 2xx`,
      res.status >= 200 && res.status < 300,
      { status: res.status, body: res.body },
    )) {
      continue;
    }
    check(
      `${c.adDate} backend.classification === fixture.classification (${c.expected.value})`,
      res.body?.classification === c.expected.value,
      { backend: res.body?.classification, fixture: c.expected.value, reason: res.body?.reason },
    );
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
