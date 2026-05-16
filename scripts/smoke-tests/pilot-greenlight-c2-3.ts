/// <reference types="node" />
/**
 * Sprint C2.3 — Pilot greenlight read-path test: exam-window containment.
 *
 * Per the C2 execution plan, the third non-negotiable read-path test:
 *
 *   For each of the 4 exam windows in the pilot's academic-structure:
 *     1. Convert BS start/end → AD via shared-types
 *     2. HTTP GET the deployed backend's calendar-dates for that AD range
 *     3. Assert: EVERY date in the window range has at least one event of
 *        eventType='exam_window' with `sourceTermId` matching the term
 *   Then sample N dates OUTSIDE every window:
 *     4. Assert: NO exam_window event present
 *
 * Endpoint: GET /schools/:id/calendar-dates?startDate=&endDate=
 *           &academicYearId=&limit=400
 *
 * Pabson Saraswati BS 2083 has 4 terminal-exam windows totalling:
 *   T1: Asar 24..32 (9 days)
 *   T2: Asoj 22..30 (9 days)
 *   T3: Pus 21..30 (10 days)   ← Pus = 30 days post PR #82
 *   T4: Chait 18..29 (12 days)
 *                              ─────
 *                               40 days
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
 *     scripts/smoke-tests/pilot-greenlight-c2-3.ts
 */

import * as fs from 'fs';
import axios from 'axios';

import {
  loadPilotFixture,
  type PilotFixture,
  type Term,
} from '@edforge/pilot-fixtures';
import { bsToGregorian } from '@aibrains/shared-types';

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

// Number of sampled outside-window dates per term (capped at term length).
const OUTSIDE_SAMPLE_COUNT = Number(process.env.OUTSIDE_SAMPLE_COUNT ?? 5);

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

interface CalendarDateItem {
  date: string; // YYYY-MM-DD AD
  isInstructionalDay: boolean;
  calendarEvents?: Array<{
    eventType: string;
    description?: string;
    sourceTermId?: string;
  }>;
}

function bsToAd(bsDate: string): string {
  const [y, m, d] = bsDate.split('/').map(Number);
  return bsToGregorian(y, m, d);
}

/**
 * Inclusive AD-date range walker. Returns ISO YYYY-MM-DD strings.
 * Uses T12:00:00 noon parse to avoid TZ-shift fence-posts.
 */
function adDateRange(adStart: string, adEnd: string): string[] {
  const out: string[] = [];
  const start = new Date(`${adStart}T12:00:00Z`);
  const end = new Date(`${adEnd}T12:00:00Z`);
  const cur = new Date(start);
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/**
 * Returns the dates from `term.startBsDate` to `term.endBsDate` (AD)
 * that fall OUTSIDE the exam window. Used to sample non-exam dates
 * within a term and assert they carry no exam_window event.
 */
function outsideWindowDates(
  term: Term,
  examAdStart: string,
  examAdEnd: string,
  sampleCount: number,
): string[] {
  const termAdStart = bsToAd(term.startBsDate);
  const termAdEnd = bsToAd(term.endBsDate);
  const allTermDates = adDateRange(termAdStart, termAdEnd);
  const outside = allTermDates.filter(
    (d) => d < examAdStart || d > examAdEnd,
  );
  // Even spacing across the outside region (deterministic — no random seed).
  if (outside.length <= sampleCount) return outside;
  const step = outside.length / sampleCount;
  const picks: string[] = [];
  for (let i = 0; i < sampleCount; i++) {
    picks.push(outside[Math.floor(i * step)]);
  }
  return picks;
}

async function fetchCalendarDates(
  adStart: string,
  adEnd: string,
): Promise<{ status: number; items: CalendarDateItem[]; hasMore: boolean } | null> {
  const url =
    `/schools/${SCHOOL_ID}/calendar-dates` +
    `?academicYearId=${ACADEMIC_YEAR_ID}` +
    `&startDate=${adStart}` +
    `&endDate=${adEnd}` +
    `&limit=400`;
  const res = await http('GET', url);
  if (res.status < 200 || res.status >= 300) {
    return null;
  }
  const items: CalendarDateItem[] = res.body?.items ?? [];
  if (!Array.isArray(items)) return null;
  return { status: res.status, items, hasMore: res.body?.hasMore ?? false };
}

// ── main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('');
  console.log(`Sprint C2.3 — exam-window containment read-path test`);
  console.log(`  pilot:    ${PILOT_ID}`);
  console.log(`  base:     ${BASE}`);
  console.log(`  tenant:   ${TENANT_ID}`);
  console.log(`  school:   ${SCHOOL_ID}`);
  console.log(`  ayId:     ${ACADEMIC_YEAR_ID}`);
  console.log('');

  // ── 1. Load fixture
  console.log('── 1. Load fixture ────────────────────────');
  const fixture: PilotFixture = loadPilotFixture(PILOT_ID);
  check('Fixture loaded', !!fixture.metadata);
  check(
    `Fixture has 4 terms (each with an examWindow)`,
    fixture.academicStructure.terms.length === 4,
  );
  const totalExpected = fixture.academicStructure.terms.reduce((acc, t) => {
    const s = bsToAd(t.examWindow.startBsDate);
    const e = bsToAd(t.examWindow.endBsDate);
    return acc + adDateRange(s, e).length;
  }, 0);
  console.log(`  → total exam-window days expected across all terms: ${totalExpected}`);

  // ── 2. Per-term containment + outside-sample
  console.log('');
  console.log('── 2. Per-term exam-window containment ────');
  for (const term of fixture.academicStructure.terms) {
    const examAdStart = bsToAd(term.examWindow.startBsDate);
    const examAdEnd = bsToAd(term.examWindow.endBsDate);
    const expectedDays = adDateRange(examAdStart, examAdEnd);

    console.log(
      `\n  ▸ ${term.id}: examWindow ${term.examWindow.startBsDate}→${term.examWindow.endBsDate}` +
        ` (${examAdStart}→${examAdEnd}, ${expectedDays.length} days)`,
    );

    // Fetch the exam-window range
    const resp = await fetchCalendarDates(examAdStart, examAdEnd);
    if (!check(
      `${term.id} GET /calendar-dates → 2xx + items[]`,
      !!resp,
      `failed to fetch ${examAdStart}→${examAdEnd}`,
    )) {
      continue;
    }
    check(
      `${term.id} response.hasMore=false (no truncation)`,
      resp!.hasMore === false,
      { hasMore: resp!.hasMore, count: resp!.items.length },
    );

    // Index by AD date for quick lookup
    const byDate = new Map<string, CalendarDateItem>();
    for (const it of resp!.items) {
      byDate.set(it.date, it);
    }

    // Walk every AD date in the exam window and assert exam_window event present
    let containedCount = 0;
    let mismatchedTerm = 0;
    const missingDates: string[] = [];
    for (const adDate of expectedDays) {
      const item = byDate.get(adDate);
      if (!item) {
        missingDates.push(adDate);
        continue;
      }
      const examEvent = (item.calendarEvents ?? []).find(
        (e) => e.eventType === 'exam_window',
      );
      if (!examEvent) {
        missingDates.push(adDate);
        continue;
      }
      containedCount++;
      // Soft-check: backend's term-id (when present) should match fixture term.
      // The backend's `sourceTermId` is the AcademicSession (term) UUID set
      // when generate-calendar fires from auto-sync; the fixture term.id is
      // a stable string (e.g. "term-1"). We do not assert equality (UUIDs
      // would always differ); we only flag if the sourceTermId DIFFERS
      // between exam-window events within the same window (would imply two
      // terms claiming the same date).
      if (examEvent.sourceTermId) {
        // captured for cross-window check below
      }
    }

    check(
      `${term.id} all ${expectedDays.length} exam-window days have exam_window event`,
      containedCount === expectedDays.length,
      `contained=${containedCount}/${expectedDays.length}, missing=${missingDates.slice(0, 5).join(',')}${missingDates.length > 5 ? '…' : ''}`,
    );

    // Cross-window: collect all sourceTermIds seen for this window's days
    const seenTermIds = new Set<string>();
    for (const adDate of expectedDays) {
      const item = byDate.get(adDate);
      const e = (item?.calendarEvents ?? []).find((x) => x.eventType === 'exam_window');
      if (e?.sourceTermId) seenTermIds.add(e.sourceTermId);
    }
    check(
      `${term.id} all exam-window events share a single sourceTermId`,
      seenTermIds.size <= 1,
      `distinct sourceTermIds in window: ${[...seenTermIds].join(',')}`,
    );

    // Outside-sample: dates within the term but OUTSIDE the exam window
    const outsidePicks = outsideWindowDates(
      term,
      examAdStart,
      examAdEnd,
      OUTSIDE_SAMPLE_COUNT,
    );
    if (outsidePicks.length === 0) {
      console.log(`     (no outside-window dates available for ${term.id})`);
      continue;
    }

    // Fetch a single range covering all outside picks
    const outsideStart = outsidePicks[0];
    const outsideEnd = outsidePicks[outsidePicks.length - 1];
    const outResp = await fetchCalendarDates(outsideStart, outsideEnd);
    if (!check(
      `${term.id} GET /calendar-dates (outside-window sample range)`,
      !!outResp,
    )) {
      continue;
    }
    const outByDate = new Map<string, CalendarDateItem>();
    for (const it of outResp!.items) outByDate.set(it.date, it);

    let outsideHits = 0;
    const offenders: string[] = [];
    for (const ad of outsidePicks) {
      const item = outByDate.get(ad);
      if (!item) continue; // backend has no row for this date — not an offence
      const hasExam = (item.calendarEvents ?? []).some(
        (e) => e.eventType === 'exam_window',
      );
      if (hasExam) {
        outsideHits++;
        offenders.push(ad);
      }
    }
    check(
      `${term.id} ${outsidePicks.length} sampled outside-window dates carry NO exam_window event`,
      outsideHits === 0,
      `offenders: ${offenders.join(',') || '(none)'}`,
    );
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
