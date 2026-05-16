/// <reference types="node" />
/**
 * Pilot term seeder — operator helper.
 *
 * Backstop for the exam-window seeding automation gap surfaced by the
 * 2026-05-16 harness run (4/6 green, blocked at C2.2 + C2.3). Filed in
 * `docs/pilot-greenlight/deferred-work.md` § "Exam-window seeding
 * automation gap — blocks harness greenlight".
 *
 * Context
 * =======
 * Sprint C2 shipped + deployed. The C2.2 (shift-profile parity) and C2.3
 * (exam-window containment) smokes both depend on `exam_window`
 * CalendarDate rows existing in DDB. Those rows are auto-synced by the
 * identity service when a GradingPeriod is created with examStartDate +
 * examEndDate (Sprint S1.3 — see `academic-year.schema.ts:120` comment).
 *
 * `dev-pabson-primary`'s AY 2083 today has only **Term 1** of the four
 * fixture-defined Terms. Three are missing. No Term rows → no
 * exam_window rows → smokes fail.
 *
 * `scripts/pilot-greenlight/seed-pilot-calendar.ts` already exists but
 * only seeds **holidays + breaks** via `POST /generate-calendar`. It
 * does NOT touch GradingPeriods. This script fills that gap.
 *
 * What it does
 * ============
 * 1. Load the pilot fixture via `@edforge/pilot-fixtures`
 * 2. `GET /schools/:id/academic-years/:yearId/grading-periods` to see
 *    what terms already exist (idempotency)
 * 3. For each fixture term whose `name` is NOT already in DDB:
 *      `POST /schools/:id/academic-years/:yearId/grading-periods`
 *      with `{ name, termType, sequence, startDate, endDate,
 *      examStartDate, examEndDate }` (BS → AD conversion via
 *      shared-types). The backend auto-syncs exam_window CalendarDate
 *      rows for the examStart..examEnd range.
 * 4. After all terms exist, for each term: `GET /calendar-dates` over
 *    `examStartDate..examEndDate` filtered by `eventType=exam_window`
 *    and assert the row count equals `(examEnd - examStart + 1)`.
 *
 * Why this is safe to re-run
 * --------------------------
 * - Step 2 detects existing terms by `name`. Re-runs skip already-present
 *   terms; only newly-discovered fixture terms are POSTed.
 * - exam_window auto-sync is idempotent on the identity side — re-syncing
 *   over already-correct rows is a no-op (the service uses
 *   sourceTermId-keyed upserts).
 * - This script does NOT delete or modify existing terms. If an operator
 *   has tweaked Term 1's dates manually, the script will not overwrite
 *   them.
 *
 * Pilot-agnostic per invariant 13: PILOT_ID is a required env-var; no
 * default. Works for any registered pilot fixture.
 *
 * Run
 * ===
 *   # Operator places fresh prod JWT at /private/tmp/c0-c-3-prod-jwt.txt
 *   export PILOT_ID=pabson-saraswati-bs-2083
 *   export TENANT_ID=<dev tenant uuid>
 *   export SCHOOL_ID=<school uuid>
 *   export ACADEMIC_YEAR_ID=<active AY uuid>
 *
 *   AWS_PROFILE=prod npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/pilot-greenlight/seed-pilot-terms.ts
 *
 *   # Then re-run the harness — expect 6/6
 *   AWS_PROFILE=prod npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/smoke-tests/pilot-greenlight.ts
 */

import * as fs from 'fs';
import axios from 'axios';

import { loadPilotFixture } from '@edforge/pilot-fixtures';
import { bsToGregorian } from '@aibrains/shared-types';

// ── config ─────────────────────────────────────────────────────────────────

const PILOT_ID = process.env.PILOT_ID ?? '';
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

const DRY_RUN = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');

// Delay between Term POST and the verification GET — auto-sync writes are
// best-effort post the primary write. Bumpable if propagation is slow.
const AUTO_SYNC_DELAY_MS = Number(process.env.AUTO_SYNC_DELAY_MS ?? 2000);

// ── env validation ─────────────────────────────────────────────────────────

const required = {
  PILOT_ID,
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
    if (k === 'PILOT_ID') {
      console.error(`  — e.g. PILOT_ID=pabson-saraswati-bs-2083`);
    }
    process.exit(2);
  }
}

// ── http ───────────────────────────────────────────────────────────────────

async function http<T = any>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T | any }> {
  const r = await axios({
    method,
    url: `${BASE}${path}`,
    headers: { Authorization: TOKEN, 'Content-Type': 'application/json' },
    data: body,
    validateStatus: () => true,
    timeout: 30_000,
  });
  return { status: r.status, body: r.data };
}

function bsToAd(bsDate: string): string {
  const [y, m, d] = bsDate.split('/').map(Number);
  return bsToGregorian(y, m, d);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Map the fixture's 4-term structure → backend's `termType` enum.
 *
 * The fixture doesn't carry an explicit termType; it's a property of how
 * the school operates. Heuristic by term count is good enough for the
 * pilot greenlight context:
 *   4 → 'quarter'  3 → 'trimester'  2 → 'semester'  1 → 'year'
 * Any other count → throw (unsupported).
 */
function inferTermType(termCount: number): 'quarter' | 'trimester' | 'semester' | 'year' {
  switch (termCount) {
    case 4: return 'quarter';
    case 3: return 'trimester';
    case 2: return 'semester';
    case 1: return 'year';
    default:
      throw new Error(`Unsupported fixture term count: ${termCount}`);
  }
}

// ── main ───────────────────────────────────────────────────────────────────

interface BackendTerm {
  termId: string;
  name: string;
  startDate: string;
  endDate: string;
  examStartDate?: string;
  examEndDate?: string;
}

async function main(): Promise<void> {
  console.log('');
  console.log(`Pilot term seeder`);
  console.log(`  pilot:    ${PILOT_ID}`);
  console.log(`  base:     ${BASE}`);
  console.log(`  tenant:   ${TENANT_ID}`);
  console.log(`  school:   ${SCHOOL_ID}`);
  console.log(`  ayId:     ${ACADEMIC_YEAR_ID}`);
  console.log(`  dry-run:  ${DRY_RUN}`);
  console.log('');

  // 1. Load fixture
  console.log('── 1. Load fixture ────────────────────────');
  const fixture = loadPilotFixture(PILOT_ID);
  const fixtureTerms = fixture.academicStructure.terms;
  const termType = inferTermType(fixtureTerms.length);
  console.log(
    `   ✓ ${fixtureTerms.length} fixture-defined terms (termType=${termType})`,
  );

  // 2. Discover existing terms
  console.log('');
  console.log('── 2. Discover existing terms in DDB ──────');
  const listRes = await http<{ items: BackendTerm[] }>(
    'GET',
    `/schools/${SCHOOL_ID}/academic-years/${ACADEMIC_YEAR_ID}/grading-periods`,
  );
  if (listRes.status < 200 || listRes.status >= 300) {
    console.error(`   ✗ list failed: status=${listRes.status}`);
    console.error(JSON.stringify(listRes.body, null, 2));
    process.exit(1);
  }
  const existingTerms: BackendTerm[] = listRes.body?.items ?? [];
  const existingByName = new Map(existingTerms.map((t) => [t.name, t]));
  console.log(`   ✓ found ${existingTerms.length} existing term(s):`);
  for (const t of existingTerms) {
    console.log(`     - "${t.name}" (${t.startDate} → ${t.endDate})`);
  }

  // 3. Plan POSTs — fixture terms NOT already present (matched by name)
  console.log('');
  console.log('── 3. Plan term creates ──────────────────');
  type CreatePayload = {
    fixtureTerm: typeof fixtureTerms[number];
    sequence: number;
    dto: {
      name: string;
      termType: ReturnType<typeof inferTermType>;
      sequence: number;
      startDate: string;
      endDate: string;
      examStartDate: string;
      examEndDate: string;
    };
  };
  const toCreate: CreatePayload[] = [];
  for (let i = 0; i < fixtureTerms.length; i++) {
    const ft = fixtureTerms[i];
    if (existingByName.has(ft.name)) {
      console.log(`   ↷ "${ft.name}" already present, skip`);
      continue;
    }
    toCreate.push({
      fixtureTerm: ft,
      sequence: i + 1,
      dto: {
        name: ft.name,
        termType,
        sequence: i + 1,
        startDate: bsToAd(ft.startBsDate),
        endDate: bsToAd(ft.endBsDate),
        examStartDate: bsToAd(ft.examWindow.startBsDate),
        examEndDate: bsToAd(ft.examWindow.endBsDate),
      },
    });
  }
  console.log(`   ✓ ${toCreate.length} term(s) to create`);
  for (const c of toCreate) {
    console.log(
      `     ▸ ${c.dto.name}: ${c.dto.startDate} → ${c.dto.endDate} ` +
        `(exam ${c.dto.examStartDate} → ${c.dto.examEndDate})`,
    );
  }

  if (toCreate.length === 0) {
    console.log('');
    console.log('   (nothing to do — all fixture terms already exist)');
  }

  if (DRY_RUN) {
    console.log('');
    console.log('── DRY RUN — no POSTs performed ──────────');
    process.exit(0);
  }

  // 4. POST each missing term
  if (toCreate.length > 0) {
    console.log('');
    console.log('── 4. POST missing terms ──────────────────');
    for (const c of toCreate) {
      const res = await http(
        'POST',
        `/schools/${SCHOOL_ID}/academic-years/${ACADEMIC_YEAR_ID}/grading-periods`,
        c.dto,
      );
      if (res.status < 200 || res.status >= 300) {
        console.error(`   ✗ POST ${c.dto.name} failed: status=${res.status}`);
        console.error(JSON.stringify(res.body, null, 2));
        process.exit(1);
      }
      console.log(
        `   ✓ created "${c.dto.name}" termId=${res.body?.termId ?? '(unknown)'}`,
      );
    }
  }

  // 5. Wait briefly for auto-sync propagation
  if (toCreate.length > 0) {
    console.log('');
    console.log(`── 5. Wait ${AUTO_SYNC_DELAY_MS}ms for exam_window auto-sync ──`);
    await sleep(AUTO_SYNC_DELAY_MS);
  }

  // 6. Verify exam_window CalendarDate rows for every fixture term
  console.log('');
  console.log('── 6. Verify exam_window auto-sync ────────');
  const fails: string[] = [];
  for (let i = 0; i < fixtureTerms.length; i++) {
    const ft = fixtureTerms[i];
    const exStart = bsToAd(ft.examWindow.startBsDate);
    const exEnd = bsToAd(ft.examWindow.endBsDate);
    // Expected count = inclusive day-range from exStart to exEnd
    const expected =
      Math.round(
        (new Date(`${exEnd}T12:00:00Z`).getTime() -
          new Date(`${exStart}T12:00:00Z`).getTime()) /
          (24 * 3600 * 1000),
      ) + 1;

    const url =
      `/schools/${SCHOOL_ID}/calendar-dates` +
      `?academicYearId=${ACADEMIC_YEAR_ID}` +
      `&startDate=${exStart}` +
      `&endDate=${exEnd}` +
      `&eventType=exam_window` +
      `&limit=200`;
    const res = await http<{ items: { date: string }[] }>('GET', url);
    if (res.status < 200 || res.status >= 300) {
      fails.push(`${ft.id} verify GET failed status=${res.status}`);
      console.log(`   ✗ ${ft.id}: GET /calendar-dates → ${res.status}`);
      continue;
    }
    const items = res.body?.items ?? [];
    const ok = items.length === expected;
    console.log(
      `   ${ok ? '✓' : '✗'} ${ft.id}: ` +
        `exam_window rows ${items.length}/${expected} ` +
        `(${exStart} → ${exEnd})`,
    );
    if (!ok) fails.push(`${ft.id} expected=${expected} got=${items.length}`);
  }

  // 7. Summary
  console.log('');
  console.log('═══ SUMMARY ═══');
  if (fails.length === 0) {
    console.log(
      `✓ All ${fixtureTerms.length} fixture-defined terms are present and ` +
        `exam_window auto-sync rows match.`,
    );
    console.log('');
    console.log('Next step: re-run the pilot-greenlight harness — expect 6/6');
    console.log(
      `  AWS_PROFILE=prod npx ts-node --compiler-options '{"module":"commonjs"}' \\`,
    );
    console.log(`    scripts/smoke-tests/pilot-greenlight.ts`);
    process.exit(0);
  } else {
    console.log(`✗ ${fails.length} verification(s) failed:`);
    for (const f of fails) console.log(`  - ${f}`);
    console.log('');
    console.log(
      'If a term was just created and exam_window rows are missing, the ' +
        'auto-sync may not have propagated yet. Bump AUTO_SYNC_DELAY_MS ' +
        'and re-run; or check identity service CloudWatch logs.',
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FATAL:', err?.stack ?? err);
  process.exit(1);
});
