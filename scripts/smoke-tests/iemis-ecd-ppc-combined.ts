/// <reference types="node" />
/**
 * Sprint C3.T1 — IEMIS combined-band ECD/PPC import smoke.
 *
 * Locks the post-fix behaviour for BUG-S7 — Saraswati's IEMIS export ships
 * the literal token `ECD/PPC` in `CurrentClass` for the combined pre-primary
 * cohort. Pre-fix, those rows hit `normalizeGradeLevel` which returned `''`
 * → "Grade level is required" error → row blocked. Post-fix, the row
 * imports as canonical `ECD` with a per-row warning so the operator can
 * re-classify if the school's roster intends PPC.
 *
 * Uses `dryRun: true` so no DDB writes happen on UAT — purely exercises
 * the transform pipeline against a real running academics service.
 *
 * Synthetic payload covers three combined-band variants + a control:
 *   - row 1: CurrentClass="ECD/PPC"     (canonical combined band)
 *   - row 2: CurrentClass="ECD / PPC"   (whitespace tolerance)
 *   - row 3: CurrentClass="ecd/ppc"     (case insensitive)
 *   - row 4: CurrentClass="ECD"         (plain ECD — no warning expected)
 *   - row 5: CurrentClass="2"           (numeric grade — no warning expected)
 *
 * Usage:
 *   export ADMIN_TOKEN="<JWT for the target tenant>"
 *   export SCHOOL_ID="<existing PABSON school uuid>"
 *   export API_BASE="https://tw8pfmqsdi.execute-api.us-east-2.amazonaws.com/prod"  # UAT
 *   #  or   https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod          # prod
 *   npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/smoke-tests/iemis-ecd-ppc-combined.ts
 *
 * Exit 0 = green; exit 1 = any check failed.
 */

import axios from 'axios';

const TOKEN = process.env.ADMIN_TOKEN ?? '';
const SCHOOL_ID = process.env.SCHOOL_ID ?? '';
const API_BASE = process.env.API_BASE ?? 'https://tw8pfmqsdi.execute-api.us-east-2.amazonaws.com/prod';

for (const [name, val] of Object.entries({ ADMIN_TOKEN: TOKEN, SCHOOL_ID })) {
  if (!val) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
}

const fails: string[] = [];
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? '\u2713' : '\u2717'} ${name}`);
  if (!ok) {
    console.log(`  \u2514\u2500 ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    fails.push(name);
  }
}

interface ImportFinding {
  row: number;
  field: string;
  level: 'warn' | 'error';
  message: string;
}

interface ImportResponse {
  succeeded: number;
  failed: number;
  skipped: number;
  findings: ImportFinding[];
  duplicates: Array<{ row: number; emisStudentId: string; existingStudentId: string }>;
}

function makeRow(currentClass: string, sn: number, emisStudentId: string): Record<string, unknown> {
  return {
    'S.N': sn,
    'IEMIS Code': '170840012',
    'Current School': 'Saraswati English Boarding School',
    'Student Id': emisStudentId,
    'FullName': `Smoke Student ${sn}`,
    'Gender': sn % 2 === 0 ? 'Male' : 'Female',
    'Father Name': `Father ${sn}`,
    'Mother Name': `Mother ${sn}`,
    'CurrentClass': currentClass,
    'Section': '',
    'Year': '2082',
    'Permanent Address': 'Kshireshwarnath-9, Dhanusha',
    'Temporary Address': '',
    'DOB': '2076-01-01',
    'Is Transferred': 'No',
    'Mother Tongue': 'Nepali',
    'Disability Type': 'No Disability',
    'Age': 6,
    'Guardian Name': '',
    'Guardian Contact Number': '',
  };
}

async function main(): Promise<void> {
  const stamp = Date.now().toString().slice(-6);
  // Use unique synthetic emisStudentIds so they don't collide with real
  // imports. dryRun=true means nothing actually persists, but unique IDs
  // also keep the smoke idempotent if dryRun ever flips off in CI.
  const students = [
    makeRow('ECD/PPC', 1, `SMOKE${stamp}001`),
    makeRow('ECD / PPC', 2, `SMOKE${stamp}002`),
    makeRow('ecd/ppc', 3, `SMOKE${stamp}003`),
    makeRow('ECD', 4, `SMOKE${stamp}004`),
    makeRow('2', 5, `SMOKE${stamp}005`),
  ];

  console.log(`POST ${API_BASE}/academics/students/import/iemis  (dryRun=true, ${students.length} synthetic rows)`);
  const r = await axios.post<ImportResponse>(
    `${API_BASE}/academics/students/import/iemis`,
    { students, schoolId: SCHOOL_ID, dryRun: true },
    {
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      validateStatus: () => true,
      timeout: 30_000,
    },
  );

  check('POST returns 2xx', r.status >= 200 && r.status < 300, { status: r.status, body: r.data });
  if (r.status < 200 || r.status >= 300) process.exit(1);

  const body = r.data;
  // dryRun=true: succeeded counts rows that would import; failed counts validation errors
  check('All 5 synthetic rows pass transform validation', body.succeeded === 5, {
    succeeded: body.succeeded,
    failed: body.failed,
  });
  check('Zero validation errors', body.failed === 0, body.failed);

  const errors = body.findings.filter((f) => f.level === 'error');
  check(`No error-level findings (was ${errors.length})`, errors.length === 0, errors.slice(0, 3));

  const combinedWarnings = body.findings.filter(
    (f) => f.level === 'warn'
      && f.field === 'CurrentClass'
      && /Combined band/i.test(f.message),
  );
  check(
    'Exactly 3 combined-band warnings (rows 1-3 with ECD/PPC variants)',
    combinedWarnings.length === 3,
    combinedWarnings.map((w) => ({ row: w.row, message: w.message })),
  );

  const warnedRows = new Set(combinedWarnings.map((w) => w.row));
  check('Combined-band warnings fired on rows 1, 2, 3', [1, 2, 3].every((n) => warnedRows.has(n)), Array.from(warnedRows));
  check('Combined-band warnings did NOT fire on row 4 (plain ECD)', !warnedRows.has(4));
  check('Combined-band warnings did NOT fire on row 5 (numeric grade 2)', !warnedRows.has(5));

  // Each warning's message should reference the original raw token + ECD placement
  for (const w of combinedWarnings) {
    const messageOk = /placed in ECD/i.test(w.message);
    check(`Row ${w.row} warning includes "placed in ECD"`, messageOk, w.message);
  }

  console.log(`\nResult: ${fails.length === 0 ? 'PASS' : `FAIL (${fails.length} checks)`}`);
  console.log(
    `succeeded=${body.succeeded} failed=${body.failed} warnings=${body.findings.filter((f) => f.level === 'warn').length}`,
  );
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error('FATAL:', (e as Error)?.message ?? e);
  process.exit(1);
});
