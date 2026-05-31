/**
 * Sprint S1 — Tier-2 visual seed for the 2083 AY in dev-pabson-primary.
 *
 * Pre-conditions (verified manually before running):
 *   - The 2083 AY exists and its calendar has been generated (364 days, 27 holidays)
 *   - JWT in /tmp/dev-jwt.txt is fresh + valid (custom:tenantId 21aea5da-...)
 *
 * What this script does:
 *   1. Confirms the 2083 AY exists.
 *   2. Creates a Term ("Term 1", first_quarter, Apr 15 → Jul 14 2026)
 *      with examStartDate=2026-06-01, examEndDate=2026-06-05 set on create.
 *   3. Confirms auto-sync wrote 5 exam_window CalendarDate rows on those dates.
 *   4. Prints exact dates the operator should navigate to in the UI to see
 *      the orange day-cells.
 *
 * Hard-rejects the real-prod Saraswati schoolId.
 *
 * Run:  npx ts-node scripts/smoke-tests/s1-tier2-seed-exam-window-2083.ts
 */

import axios from 'axios';
import type { AxiosError } from 'axios';
import * as fs from 'fs';

const BASE_URL =
  process.env.SMOKE_BASE_URL ||
  'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';
const JWT_PATH = process.env.SMOKE_JWT_PATH || '/tmp/dev-jwt.txt';

const SCHOOL_ID: string = '4209e3d8-d2e2-4e0e-9961-790341c264f4'; // dev-pabson-primary Saraswati
const REAL_PROD_SARASWATI: string = '61a247a4-44d6-4fc0-a414-062fd4d7e694';
const AY_2083_ID = '0167de00-cc49-476b-9654-ef98a8cf9014';

if (SCHOOL_ID === REAL_PROD_SARASWATI) {
  console.error('FATAL: would not target real-prod Saraswati.');
  process.exit(2);
}
if (!fs.existsSync(JWT_PATH)) {
  console.error(`FATAL: ${JWT_PATH} missing.`);
  process.exit(2);
}

const RAW_JWT = fs.readFileSync(JWT_PATH, 'utf8').trim();
const AUTH = RAW_JWT.startsWith('Bearer ') ? RAW_JWT : `Bearer ${RAW_JWT}`;

const http = axios.create({
  baseURL: BASE_URL,
  headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
  validateStatus: () => true,
  timeout: 30_000,
});

async function req(method: 'GET' | 'POST' | 'PUT', url: string, body?: any) {
  try {
    const res = await http({ method, url, data: body });
    return { status: res.status, data: res.data };
  } catch (err) {
    const e = err as AxiosError;
    return { status: e.response?.status ?? 0, data: e.response?.data ?? null };
  }
}

const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', cyan: '\x1b[36m', gray: '\x1b[90m', bold: '\x1b[1m', yellow: '\x1b[33m' };

(async () => {
  console.log(`${C.bold}S1 Tier-2 seed — 2083 AY exam window${C.reset}`);
  console.log(`School: ${SCHOOL_ID}  AY: ${AY_2083_ID}\n`);

  // 1. Confirm AY exists and has the calendar
  const stats = await req(
    'GET',
    `/schools/${SCHOOL_ID}/calendar-dates/stats?academicYearId=${AY_2083_ID}`,
  );
  if (stats.status !== 200) {
    console.error(`${C.red}✗${C.reset} AY stats fetch failed: ${stats.status}`, stats.data);
    process.exit(1);
  }
  const s = stats.data as any;
  console.log(`${C.green}✓${C.reset} AY confirmed: ${s.academicYearName}`);
  console.log(`  totalDays=${s.totalDays} instructionalDays=${s.instructionalDays} holidays=${s.holidays} weekends=${s.totalDays - s.instructionalDays - s.holidays}`);

  // 2. Create Term 1 with exam dates set on create
  const TERM_START = '2026-04-15'; // Baisakh 1, 2083
  const TERM_END = '2026-07-14';   // Asar ~30, 2083 (approx)
  const EXAM_START = '2026-06-01'; // Jestha 18 — mid-term-ish
  const EXAM_END = '2026-06-05';   // Jestha 22 — Mon-Fri (5 consecutive school days)

  console.log(`\n${C.cyan}Creating Term 1 (${TERM_START} → ${TERM_END}) with exam window ${EXAM_START} → ${EXAM_END}${C.reset}`);
  const createTerm = await req(
    'POST',
    `/schools/${SCHOOL_ID}/academic-years/${AY_2083_ID}/grading-periods`,
    {
      name: 'Term 1',
      termType: 'quarter',
      sequence: 1,
      startDate: TERM_START,
      endDate: TERM_END,
      examStartDate: EXAM_START,
      examEndDate: EXAM_END,
    },
  );
  if (createTerm.status !== 201 && createTerm.status !== 200) {
    console.error(`${C.red}✗${C.reset} createGradingPeriod failed: ${createTerm.status}`, createTerm.data);
    process.exit(1);
  }
  const term = createTerm.data as any;
  const termId = term.termId ?? term.id;
  console.log(`${C.green}✓${C.reset} Term created: termId=${termId}`);
  console.log(`  examStartDate=${term.examStartDate} examEndDate=${term.examEndDate}`);

  // 3. Verify auto-sync rows landed
  console.log(`\n${C.cyan}Verifying exam_window CalendarDate auto-sync${C.reset}`);
  // Small delay for eventual-consistency safety on DDB reads
  await new Promise(r => setTimeout(r, 1000));
  const calRes = await req(
    'GET',
    `/schools/${SCHOOL_ID}/calendar-dates?academicYearId=${AY_2083_ID}` +
      `&startDate=${EXAM_START}&endDate=${EXAM_END}&limit=50`,
  );
  if (calRes.status !== 200) {
    console.error(`${C.red}✗${C.reset} CalendarDate fetch failed: ${calRes.status}`);
    process.exit(1);
  }
  const items = ((calRes.data as any)?.items ?? (calRes.data as any)?.data ?? []) as any[];
  const examRows = items.filter(d =>
    (d.calendarEvents ?? []).some((e: any) => e.eventType === 'exam_window' && e.sourceTermId === termId),
  );
  console.log(`${C.green}✓${C.reset} Found ${examRows.length} exam_window CalendarDate row(s)`);
  for (const row of examRows.sort((a, b) => (a.date as string).localeCompare(b.date))) {
    const evt = row.calendarEvents.find((e: any) => e.eventType === 'exam_window' && e.sourceTermId === termId);
    console.log(`    ${row.date}  ${row.dayOfWeek.padEnd(10)} gradingPeriodId=${row.gradingPeriodId} category=${evt?.category}`);
  }

  if (examRows.length !== 5) {
    console.error(`${C.red}✗${C.reset} Expected 5 rows for ${EXAM_START}..${EXAM_END}; got ${examRows.length}`);
    process.exit(1);
  }

  console.log(`\n${C.bold}${C.green}Tier-2 seed complete.${C.reset}`);
  console.log(`\n${C.bold}Next: visual check in UI${C.reset}`);
  const frontendBase = process.env.FRONTEND_BASE ?? 'http://localhost:3000';
  console.log(`  1. Go to: ${frontendBase}/settings/organization/schools/${SCHOOL_ID}?tab=academic-setup`);
  console.log(`  2. Click Calendar in setup steps (step 3).`);
  console.log(`  3. Use ${C.cyan}Next${C.reset} to navigate to ${C.bold}Jestha 2083 (May–June 2026)${C.reset}`);
  console.log(`  4. Expected: 5 ${C.yellow}ORANGE${C.reset} day-cells on June 1, 2, 3, 4, 5 (Jestha 18-22 BS)`);
  console.log(`  5. Click any of them — date detail should show:`);
  console.log(`     - Event Type: Exam Window`);
  console.log(`     - Description: "Term 1 exam"`);
  console.log(`     - Linked to Term 1\n`);
})().catch(err => {
  console.error('Unhandled:', err);
  process.exit(1);
});
