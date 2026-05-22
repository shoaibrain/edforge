/**
 * V1 re-validation against S2 backend — pilot greenlight harness.
 *
 * For each V1 finding that S2 was meant to resolve, this script runs a
 * targeted test and emits PASS/FAIL. Produces the evidence used in
 * `docs/validation/pilot-greenlight-2026-05-14.md`.
 *
 * Scope: server-side only. UI-visible findings (F-V1-STRUCT-001 Danger
 * Zone, F-V1-STRUCT-002 dropdown filter, UX-V1-* operator forms) are
 * separately covered by visual inspection on the live frontend, not by
 * this script.
 *
 * Findings under test
 * ===================
 *   F-V1-S4-AY-AUDIT     — audit rows for AY create + Calendar generation
 *                          should exist after the operation (S2.3 fix)
 *   F-V1-S2-COLLISION    — response carries warnings[] when exam dates
 *                          overlap a holiday (S2.1 fix)
 *   F-V1-STRUCT-002 srv  — server still accepts exam_window event writes
 *                          (UI hides the type from the operator dropdown,
 *                          but the auto-sync needs the type to function;
 *                          verify the descriptor enum still includes it)
 *   F-V1-S1-OK (regress) — 4-term genesis with exam windows still works
 *                          end-to-end (no regression from S2 refactors)
 *
 * Target
 * ======
 *   School: Sunshine Private Academy (3c28654f-c623-449b-8211-67c729784d37)
 *   Tenant: dev-pabson-primary
 *   Creates a fresh AY per run; safe to re-run.
 *
 * Hard-rejects real-prod Saraswati (61a247a4-...) at startup.
 *
 * Run:  npx ts-node scripts/smoke-tests/v1-rerun-s2-validation.ts
 */

import axios from 'axios';
import type { AxiosError } from 'axios';
import * as fs from 'fs';

// ============================================================================
// CONFIG
// ============================================================================

const BASE_URL =
  process.env.SMOKE_BASE_URL ||
  'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';
const JWT_PATH = process.env.SMOKE_JWT_PATH || '/tmp/dev-jwt.txt';

const SCHOOL_ID: string = '3c28654f-c623-449b-8211-67c729784d37'; // Sunshine
const REAL_PROD_SARASWATI: string = '61a247a4-44d6-4fc0-a414-062fd4d7e694';

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

// ============================================================================
// COLORS + PASS/FAIL HARNESS
// ============================================================================

const C = {
  reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', gray: '\x1b[90m', bold: '\x1b[1m',
};

interface ResolutionCheck {
  id: string;
  v1Severity: 'P0' | 'P1' | 'P2' | 'INFO';
  description: string;
  status: 'pending' | 'pass' | 'fail';
  expected: string;
  actual?: string;
  evidence?: string;
}

const checks: ResolutionCheck[] = [];

function record(c: ResolutionCheck) {
  checks.push(c);
  const sym = c.status === 'pass' ? `${C.green}✓ PASS${C.reset}` :
              c.status === 'fail' ? `${C.red}✗ FAIL${C.reset}` :
              `${C.gray}…${C.reset}`;
  console.log(`${sym}  ${C.bold}${c.id}${C.reset}  ${c.description}`);
  if (c.actual) console.log(`       ${C.gray}${c.actual}${C.reset}`);
  if (c.evidence) console.log(`       ${C.gray}evidence: ${c.evidence}${C.reset}`);
}

function section(title: string) {
  console.log(`\n${C.bold}${C.cyan}── ${title} ──${C.reset}`);
}

async function api(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: any,
): Promise<{ status: number; data: any }> {
  try {
    const res = await http({ method, url, data: body });
    return { status: res.status, data: res.data };
  } catch (err) {
    const e = err as AxiosError;
    return { status: e.response?.status ?? 0, data: e.response?.data ?? null };
  }
}

// ============================================================================
// MAIN
// ============================================================================

(async () => {
  console.log(`${C.bold}V1 re-validation — S2 backend resolution check${C.reset}`);
  console.log(`School: ${SCHOOL_ID}`);
  console.log(`Run at: ${new Date().toISOString()}\n`);

  // PRE-FLIGHT
  section('Pre-flight');
  const me = await api('GET', '/users/me');
  if (me.status !== 200) {
    record({
      id: 'PRE-AUTH', v1Severity: 'INFO', description: 'JWT resolves',
      status: 'fail', expected: '200', actual: `got ${me.status}`,
    });
    process.exit(1);
  }
  record({
    id: 'PRE-AUTH', v1Severity: 'INFO', description: 'JWT resolves',
    status: 'pass', expected: '200', actual: `userId=${me.data.userId ?? me.data.id}`,
  });

  // ==========================================================================
  // PHASE 1 — Create fresh AY and assert audit row lands (F-V1-S4-AY-AUDIT)
  // ==========================================================================
  section('F-V1-S4-AY-AUDIT — AcademicYear.create emits audit row (S2.3)');
  // Use a non-overlapping future range to avoid the AY_DATE_RANGE_OVERLAP
  // validation from S0.12. 2095+ is far past any existing test AY.
  const aySuffix = String(Date.now()).slice(-6);
  const ayName = `S2-${aySuffix}`;
  const ayStart = '2095-04-15';
  const ayEnd = '2096-04-13';
  const ayCreate = await api('POST', `/schools/${SCHOOL_ID}/academic-years`, {
    name: ayName,
    startDate: ayStart,
    endDate: ayEnd,
    setAsCurrent: false,
  });
  if (ayCreate.status !== 201 && ayCreate.status !== 200) {
    record({
      id: 'F-V1-S4-AY-AUDIT', v1Severity: 'P1',
      description: 'Create AY for audit assertion',
      status: 'fail', expected: '201',
      actual: `got ${ayCreate.status}: ${JSON.stringify(ayCreate.data).slice(0, 300)}`,
    });
    process.exit(1);
  }
  const yearId = ayCreate.data.yearId ?? ayCreate.data.id;
  await new Promise(r => setTimeout(r, 1500)); // allow audit write propagation

  const auditAfterAYCreate = await api(
    'GET',
    `/schools/${SCHOOL_ID}/audit-log?limit=20`,
  );
  const auditRows: any[] = (auditAfterAYCreate.data?.items ?? auditAfterAYCreate.data ?? []) as any[];
  const ayAuditRow = auditRows.find(
    r => r.targetEntity === 'ACADEMIC_YEAR' && r.targetEntityId === yearId && r.action === 'create',
  );
  if (ayAuditRow) {
    record({
      id: 'F-V1-S4-AY-AUDIT.1', v1Severity: 'P1',
      description: 'ACADEMIC_YEAR.create audit row exists after AY create',
      status: 'pass',
      expected: 'audit row with targetEntity=ACADEMIC_YEAR, action=create, yearId matched',
      actual: `found: changedBy=${ayAuditRow.changedBy}, fields=[${(ayAuditRow.changes ?? []).map((c: any) => c.field).join(', ')}]`,
      evidence: `yearId=${yearId}`,
    });
  } else {
    record({
      id: 'F-V1-S4-AY-AUDIT.1', v1Severity: 'P1',
      description: 'ACADEMIC_YEAR.create audit row exists after AY create',
      status: 'fail',
      expected: 'audit row present',
      actual: `not found among ${auditRows.length} audit rows`,
    });
  }

  // ==========================================================================
  // PHASE 2 — Generate calendar and assert audit row (S2.3) with severity=high
  // ==========================================================================
  section('F-V1-S4-AY-AUDIT (cont.) — Calendar generation emits CALENDAR.create severity=high (S2.3)');
  // Generate with 1 holiday in the range so the term-exam-collision test
  // later in PHASE 3 has a real overlap to detect.
  const PHULPATI_2095 = '2095-10-09';
  const generateRes = await api(
    'POST',
    `/schools/${SCHOOL_ID}/academic-years/${yearId}/generate-calendar`,
    {
      academicYearId: yearId,
      startDate: ayStart,
      endDate: ayEnd,
      includeWeekends: false,
      schoolDays: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      holidays: [
        { date: PHULPATI_2095, name: 'Phulpati (Dashain)', eventType: 'holiday' },
      ],
    },
  );
  if (generateRes.status !== 201 && generateRes.status !== 200) {
    record({
      id: 'F-V1-S4-AY-AUDIT.2', v1Severity: 'P1',
      description: 'Calendar generation returns 200/201',
      status: 'fail', expected: '200/201',
      actual: `got ${generateRes.status}: ${JSON.stringify(generateRes.data).slice(0, 300)}`,
    });
    process.exit(1);
  }
  const calendarId = generateRes.data.calendarId;
  await new Promise(r => setTimeout(r, 1500));

  const auditAfterCalGen = await api(
    'GET',
    `/schools/${SCHOOL_ID}/audit-log?limit=20`,
  );
  const auditRows2: any[] = (auditAfterCalGen.data?.items ?? auditAfterCalGen.data ?? []) as any[];
  const calAuditRow = auditRows2.find(
    r => r.targetEntity === 'CALENDAR' && r.targetEntityId === calendarId && r.action === 'create',
  );
  if (calAuditRow && calAuditRow.severity === 'high') {
    const changes = (calAuditRow.changes ?? []) as Array<{ field: string; newValue: any }>;
    const totalDays = changes.find(c => c.field === 'totalDays')?.newValue;
    const holidays = changes.find(c => c.field === 'holidays')?.newValue;
    record({
      id: 'F-V1-S4-AY-AUDIT.2', v1Severity: 'P1',
      description: 'CALENDAR.create audit row with severity=high exists after generate',
      status: 'pass',
      expected: 'audit row with targetEntity=CALENDAR, action=create, severity=high',
      actual: `found: totalDays=${totalDays}, holidays=${holidays}`,
      evidence: `calendarId=${calendarId}`,
    });
  } else if (calAuditRow) {
    record({
      id: 'F-V1-S4-AY-AUDIT.2', v1Severity: 'P1',
      description: 'CALENDAR.create audit row with severity=high exists after generate',
      status: 'fail',
      expected: 'severity=high',
      actual: `row found but severity=${calAuditRow.severity}`,
    });
  } else {
    record({
      id: 'F-V1-S4-AY-AUDIT.2', v1Severity: 'P1',
      description: 'CALENDAR.create audit row exists after generate',
      status: 'fail',
      expected: 'audit row present',
      actual: `not found; only ${auditRows2.length} audit rows visible`,
    });
  }

  // ==========================================================================
  // PHASE 3 — Create Term 2 with exam window overlapping Phulpati holiday
  //          → assert response carries warnings[] (F-V1-S2-COLLISION)
  // ==========================================================================
  section('F-V1-S2-COLLISION — Holiday overlap returns warnings[] in response (S2.1)');
  const term2Create = await api(
    'POST',
    `/schools/${SCHOOL_ID}/academic-years/${yearId}/grading-periods`,
    {
      name: 'Term 2',
      termType: 'quarter',
      sequence: 2,
      startDate: '2095-07-16',
      endDate: '2095-10-15',
      examStartDate: '2095-10-05',
      examEndDate: '2095-10-09', // 2095-10-09 == Phulpati seeded above
    },
  );
  if (term2Create.status !== 201 && term2Create.status !== 200) {
    record({
      id: 'F-V1-S2-COLLISION', v1Severity: 'P1',
      description: 'Term create succeeds (warning is non-blocking)',
      status: 'fail', expected: '201/200',
      actual: `got ${term2Create.status}: ${JSON.stringify(term2Create.data).slice(0, 300)}`,
    });
  } else {
    const warnings: any[] = (term2Create.data?.warnings ?? []) as any[];
    const phulpatiWarning = warnings.find(
      w => w.date === PHULPATI_2095 && w.code === 'EXAM_OVERLAPS_HOLIDAY',
    );
    if (phulpatiWarning) {
      record({
        id: 'F-V1-S2-COLLISION', v1Severity: 'P1',
        description: 'Response carries warnings[] with EXAM_OVERLAPS_HOLIDAY for Phulpati',
        status: 'pass',
        expected: `warnings[*].date === '${PHULPATI_2095}' AND code === 'EXAM_OVERLAPS_HOLIDAY'`,
        actual: `found: holidayName="${phulpatiWarning.holidayName}"`,
        evidence: `term2 examWindow=${term2Create.data.examStartDate}..${term2Create.data.examEndDate}`,
      });
    } else if (warnings.length > 0) {
      record({
        id: 'F-V1-S2-COLLISION', v1Severity: 'P1',
        description: 'Response carries warnings[] with EXAM_OVERLAPS_HOLIDAY for Phulpati',
        status: 'fail',
        expected: `entry for ${PHULPATI_2095}`,
        actual: `warnings present but Phulpati not in them: ${JSON.stringify(warnings)}`,
      });
    } else {
      record({
        id: 'F-V1-S2-COLLISION', v1Severity: 'P1',
        description: 'Response carries warnings[] with EXAM_OVERLAPS_HOLIDAY for Phulpati',
        status: 'fail',
        expected: 'warnings array non-empty',
        actual: `warnings field missing or empty; response keys: ${Object.keys(term2Create.data).join(',')}`,
      });
    }
  }
  const term2Id = term2Create.data?.termId ?? term2Create.data?.id;

  // ==========================================================================
  // PHASE 4 — Regression: 4-term genesis with exam windows still works
  // ==========================================================================
  section('F-V1-S1-OK (regression) — 4-term setup with exam windows works end-to-end');
  const otherTerms = [
    { name: 'Term 1', termType: 'quarter' as const, sequence: 1, startDate: '2095-04-15', endDate: '2095-07-15', examStartDate: '2095-07-06', examEndDate: '2095-07-10' },
    { name: 'Term 3', termType: 'quarter' as const, sequence: 3, startDate: '2095-10-16', endDate: '2096-01-15', examStartDate: '2096-01-05', examEndDate: '2096-01-09' },
    { name: 'Term 4', termType: 'quarter' as const, sequence: 4, startDate: '2096-01-16', endDate: '2096-04-13', examStartDate: '2096-04-05', examEndDate: '2096-04-09' },
  ];
  const createdTermIds: string[] = term2Id ? [term2Id] : [];
  for (const t of otherTerms) {
    const r = await api(
      'POST',
      `/schools/${SCHOOL_ID}/academic-years/${yearId}/grading-periods`,
      t,
    );
    if (r.status === 200 || r.status === 201) {
      createdTermIds.push(r.data.termId ?? r.data.id);
    }
  }
  if (createdTermIds.length === 4) {
    record({
      id: 'F-V1-S1-OK.1', v1Severity: 'INFO',
      description: 'All 4 terms created successfully',
      status: 'pass',
      expected: '4 GradingPeriod rows',
      actual: `created ${createdTermIds.length}`,
    });
  } else {
    record({
      id: 'F-V1-S1-OK.1', v1Severity: 'INFO',
      description: 'All 4 terms created successfully',
      status: 'fail',
      expected: '4 GradingPeriod rows',
      actual: `created only ${createdTermIds.length}`,
    });
  }

  // Confirm exam_window CalendarDate rows synced across 4 terms = 20 rows
  await new Promise(r => setTimeout(r, 1500));
  let totalExamWindow = 0;
  for (const t of [
    { start: '2095-07-06', end: '2095-07-10' },
    { start: '2095-10-05', end: '2095-10-09' },
    { start: '2096-01-05', end: '2096-01-09' },
    { start: '2096-04-05', end: '2096-04-09' },
  ]) {
    const cal = await api(
      'GET',
      `/schools/${SCHOOL_ID}/calendar-dates?academicYearId=${yearId}&startDate=${t.start}&endDate=${t.end}&limit=20`,
    );
    const rows = ((cal.data?.items ?? cal.data) as any[]) ?? [];
    const examRows = rows.filter(r =>
      (r.calendarEvents ?? []).some((e: any) => e.eventType === 'exam_window'),
    );
    totalExamWindow += examRows.length;
  }
  if (totalExamWindow === 20) {
    record({
      id: 'F-V1-S1-OK.2', v1Severity: 'INFO',
      description: 'Auto-sync produced 20 exam_window CalendarDate rows (5 per term × 4 terms)',
      status: 'pass', expected: '20', actual: `got ${totalExamWindow}`,
    });
  } else {
    record({
      id: 'F-V1-S1-OK.2', v1Severity: 'INFO',
      description: 'Auto-sync produced 20 exam_window CalendarDate rows',
      status: 'fail', expected: '20', actual: `got ${totalExamWindow}`,
    });
  }

  // ==========================================================================
  // PHASE 5 — F-V1-STRUCT-002 server-side: exam_window IS still accepted by
  // the descriptor enum + auto-sync (UI hides it, server doesn't reject)
  // ==========================================================================
  section('F-V1-STRUCT-002 (server-side) — exam_window descriptor still valid via API');
  // The PHASE 4 termCreate writes proved the exam_window event lands on
  // CalendarDate rows via auto-sync. To explicitly confirm the descriptor
  // enum still accepts it, read back one of the auto-synced rows and
  // verify its event payload.
  const sampleRow = await api(
    'GET',
    `/schools/${SCHOOL_ID}/calendar-dates?academicYearId=${yearId}&startDate=2095-07-06&endDate=2095-07-06&limit=5`,
  );
  const sampleRows = ((sampleRow.data?.items ?? sampleRow.data) as any[]) ?? [];
  const sampleExam = sampleRows[0]?.calendarEvents?.find(
    (e: any) => e.eventType === 'exam_window',
  );
  if (sampleExam) {
    record({
      id: 'F-V1-STRUCT-002', v1Severity: 'P2',
      description: 'exam_window descriptor still valid + auto-sync writes preserved',
      status: 'pass',
      expected: 'exam_window event present with sourceTermId',
      actual: `eventType=${sampleExam.eventType}, sourceTermId=${sampleExam.sourceTermId}, category=${sampleExam.category}`,
    });
  } else {
    record({
      id: 'F-V1-STRUCT-002', v1Severity: 'P2',
      description: 'exam_window descriptor still valid + auto-sync writes preserved',
      status: 'fail',
      expected: 'exam_window event on 2095-07-06',
      actual: `no exam_window event found on the row`,
    });
  }

  // ==========================================================================
  // SUMMARY
  // ==========================================================================
  console.log(`\n${C.bold}═══ SUMMARY ═══${C.reset}`);
  const passes = checks.filter(c => c.status === 'pass').length;
  const fails = checks.filter(c => c.status === 'fail').length;
  console.log(`${C.bold}${C.green}${passes} resolved${C.reset}  ${C.bold}${fails > 0 ? C.red : C.gray}${fails} failed${C.reset}\n`);

  // Map to V1 findings + verdict
  const v1FindingMap = [
    {
      v1Id: 'F-V1-S4-AY-AUDIT',
      severity: 'P1',
      title: 'AY create + Calendar generation do not emit audit rows',
      checkIds: ['F-V1-S4-AY-AUDIT.1', 'F-V1-S4-AY-AUDIT.2'],
    },
    {
      v1Id: 'F-V1-S2-COLLISION',
      severity: 'P1',
      title: 'Backend silently allows exam-window-during-holiday',
      checkIds: ['F-V1-S2-COLLISION'],
    },
    {
      v1Id: 'F-V1-STRUCT-002',
      severity: 'P2',
      title: 'Operator can pick exam_window (server-side: still valid descriptor)',
      checkIds: ['F-V1-STRUCT-002'],
    },
    {
      v1Id: 'F-V1-S1-OK',
      severity: 'INFO',
      title: 'PABSON 4-term genesis (regression)',
      checkIds: ['F-V1-S1-OK.1', 'F-V1-S1-OK.2'],
    },
  ];

  console.log(`${C.bold}V1 finding → resolution verdict:${C.reset}\n`);
  for (const v1 of v1FindingMap) {
    const subs = checks.filter(c => v1.checkIds.includes(c.id));
    const allPass = subs.every(s => s.status === 'pass');
    const verdict = allPass ? `${C.green}RESOLVED${C.reset}` : `${C.red}STILL FAILING${C.reset}`;
    console.log(`  [${v1.severity}] ${v1.v1Id}: ${verdict}  — ${v1.title}`);
  }

  // Write structured JSON for the report generator
  const out = {
    runId: `s2-rerun-${Date.now()}`,
    timestamp: new Date().toISOString(),
    school: SCHOOL_ID,
    ayName,
    yearId,
    summary: { passes, fails },
    checks,
    v1FindingMap,
  };
  const outPath = '/tmp/v1-rerun-findings.json';
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nStructured findings: ${C.cyan}${outPath}${C.reset}`);
  console.log(`Test data: AY="${ayName}" yearId=${yearId} on Sunshine school`);

  process.exit(fails === 0 ? 0 : 1);
})().catch(err => {
  console.error('Unhandled:', err);
  process.exit(1);
});
