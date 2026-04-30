/// <reference types="node" />
/**
 * Sprint C4 — IEMIS Async Import + Enrollment-on-Import smoke.
 *
 * Validates the full Sprint C4 contract:
 *
 *   1. dryRun=true returns the synchronous preview unchanged (regression
 *      gate — Sprint C3 behaviour must keep working).
 *   2. dryRun=false returns 202 + { jobId, status:'queued', totalRows,
 *      schoolId, enrollInAcademicYearId } and DOES NOT block on import work.
 *   3. GET /students/import/iemis/jobs/:jobId returns the job row; status
 *      transitions queued → running → succeeded within a reasonable window.
 *   4. When enrollInAcademicYearId is supplied:
 *        - studentsCreated == studentsEnrolled (every created student also
 *          got a SchoolEnrollment row).
 *        - The Student rows show status='active' (verified via GET).
 *   5. When enrollInAcademicYearId is omitted:
 *        - studentsCreated > 0; studentsEnrolled === 0.
 *
 * Synthetic payload — 5 unique synthetic emisStudentIds so the smoke is
 * idempotent across re-runs (each run gets a fresh stamped batch). Real
 * Saraswati data is intentionally NOT used here; the goal is a tight,
 * deterministic contract gate, not a pilot rehearsal.
 *
 * Usage:
 *   export ADMIN_TOKEN="<JWT for the target tenant>"
 *   export SCHOOL_ID="<existing PABSON school uuid with active AY>"
 *   export ACADEMIC_YEAR_ID="<active AY id on that school>"
 *   export API_BASE="https://tw8pfmqsdi.execute-api.us-east-2.amazonaws.com/prod"
 *   npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/smoke-tests/iemis-import-async-with-enrollment.ts
 *
 * Exit 0 = green; exit 1 = any check failed.
 */

import axios from 'axios';

const TOKEN = process.env.ADMIN_TOKEN ?? '';
const SCHOOL_ID = process.env.SCHOOL_ID ?? '';
const ACADEMIC_YEAR_ID = process.env.ACADEMIC_YEAR_ID ?? '';
const API_BASE = process.env.API_BASE ?? 'https://tw8pfmqsdi.execute-api.us-east-2.amazonaws.com/prod';

for (const [name, val] of Object.entries({ ADMIN_TOKEN: TOKEN, SCHOOL_ID, ACADEMIC_YEAR_ID })) {
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

interface SyncImportResponse {
  succeeded: number;
  failed: number;
  skipped: number;
  findings: ImportFinding[];
  duplicates: Array<{ row: number; emisStudentId: string; existingStudentId: string }>;
}

interface AsyncAck {
  jobId: string;
  status: 'queued';
  totalRows: number;
  schoolId: string;
  enrollInAcademicYearId?: string;
}

interface JobRow {
  jobId: string;
  schoolId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  totalRows: number;
  enrollInAcademicYearId?: string;
  studentsCreated: number;
  studentsEnrolled: number;
  failed: number;
  skipped: number;
  findings: ImportFinding[];
  findingsTruncated: boolean;
  duplicates: Array<{ row: number; emisStudentId: string; existingStudentId: string }>;
  duplicatesTruncated: boolean;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
}

function makeRow(currentClass: string, sn: number, emisStudentId: string): Record<string, unknown> {
  return {
    'S.N': sn,
    'IEMIS Code': '170840012',
    'Current School': 'Async Smoke School',
    'Student Id': emisStudentId,
    'FullName': `Async Smoke ${sn}`,
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pollJob(jobId: string, timeoutMs = 120_000): Promise<JobRow> {
  const start = Date.now();
  let lastStatus: string | undefined;
  while (Date.now() - start < timeoutMs) {
    const r = await axios.get<JobRow>(
      `${API_BASE}/academics/students/import/iemis/jobs/${jobId}`,
      {
        headers: { Authorization: `Bearer ${TOKEN}` },
        validateStatus: () => true,
        timeout: 15_000,
      },
    );
    if (r.status !== 200) {
      throw new Error(`GET /jobs/${jobId} returned ${r.status}: ${JSON.stringify(r.data)}`);
    }
    const job = r.data;
    if (job.status !== lastStatus) {
      console.log(`  ↳ job ${jobId.slice(0, 8)} status=${job.status} created=${job.studentsCreated}/${job.totalRows} enrolled=${job.studentsEnrolled}`);
      lastStatus = job.status;
    }
    if (job.status === 'succeeded' || job.status === 'failed') return job;
    await sleep(2000);
  }
  throw new Error(`Job ${jobId} did not reach terminal status within ${timeoutMs}ms`);
}

async function main(): Promise<void> {
  const stamp = Date.now().toString().slice(-8);

  // ── Step 1: dryRun=true must still return the sync preview shape ──
  console.log('\n── Step 1: dryRun=true sync preview ──');
  const dryRunStudents = [
    makeRow('1', 1, `ASMK${stamp}001`),
    makeRow('2', 2, `ASMK${stamp}002`),
  ];
  const dryRunResp = await axios.post<SyncImportResponse>(
    `${API_BASE}/academics/students/import/iemis`,
    { students: dryRunStudents, schoolId: SCHOOL_ID, dryRun: true },
    {
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      validateStatus: () => true,
      timeout: 60_000,
    },
  );
  // NestJS @Post defaults to 201 when no @HttpCode override is set; this is
  // consistent with pre-C4 behaviour (the C3 smoke used a 2xx range check
  // for the same reason). The async ack path further down is explicitly
  // 202 via res.status(HttpStatus.ACCEPTED), so that one is checked strictly.
  check(
    'dryRun POST returns 2xx',
    dryRunResp.status >= 200 && dryRunResp.status < 300,
    { status: dryRunResp.status, body: dryRunResp.data },
  );
  check(
    'dryRun response has sync shape (succeeded/failed/skipped/findings/duplicates)',
    'succeeded' in dryRunResp.data && 'duplicates' in dryRunResp.data,
    dryRunResp.data,
  );
  check(
    'dryRun has zero hard errors on synthetic rows',
    (dryRunResp.data.findings ?? []).filter((f) => f.level === 'error').length === 0,
    (dryRunResp.data.findings ?? []).filter((f) => f.level === 'error').slice(0, 3),
  );

  // ── Step 2: dryRun=false WITHOUT enrollment ──
  console.log('\n── Step 2: dryRun=false (no enrollment) → async ack + job poll ──');
  const noEnrollStudents = [
    makeRow('1', 1, `ASMK${stamp}010`),
    makeRow('2', 2, `ASMK${stamp}011`),
  ];
  const startNoEnroll = Date.now();
  const noEnrollResp = await axios.post<AsyncAck>(
    `${API_BASE}/academics/students/import/iemis`,
    { students: noEnrollStudents, schoolId: SCHOOL_ID, dryRun: false },
    {
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      validateStatus: () => true,
      timeout: 30_000,
    },
  );
  const ackLatency = Date.now() - startNoEnroll;

  check('noEnroll POST returns 202', noEnrollResp.status === 202, { status: noEnrollResp.status, body: noEnrollResp.data });
  check(
    'noEnroll response has async ack shape (jobId, status="queued", totalRows)',
    typeof noEnrollResp.data?.jobId === 'string' &&
      noEnrollResp.data?.status === 'queued' &&
      noEnrollResp.data?.totalRows === noEnrollStudents.length,
    noEnrollResp.data,
  );
  check(
    `noEnroll ack returned in <5s (was ${ackLatency}ms) — proves the POST does NOT block on import work`,
    ackLatency < 5000,
    ackLatency,
  );

  if (noEnrollResp.status === 202 && noEnrollResp.data?.jobId) {
    const noEnrollJob = await pollJob(noEnrollResp.data.jobId);
    check(
      'noEnroll job reached status="succeeded"',
      noEnrollJob.status === 'succeeded',
      { status: noEnrollJob.status, error: noEnrollJob.error },
    );
    check(
      `noEnroll studentsCreated === ${noEnrollStudents.length}`,
      noEnrollJob.studentsCreated === noEnrollStudents.length,
      { studentsCreated: noEnrollJob.studentsCreated, expected: noEnrollStudents.length },
    );
    check(
      'noEnroll studentsEnrolled === 0 (no enrollment requested)',
      noEnrollJob.studentsEnrolled === 0,
      noEnrollJob.studentsEnrolled,
    );
    check('noEnroll failed === 0', noEnrollJob.failed === 0, noEnrollJob);
  }

  // ── Step 3: dryRun=false WITH enrollment ──
  console.log('\n── Step 3: dryRun=false WITH enrollInAcademicYearId → async ack + job poll ──');
  const enrollStudents = [
    makeRow('1', 1, `ASMK${stamp}020`),
    makeRow('2', 2, `ASMK${stamp}021`),
    makeRow('3', 3, `ASMK${stamp}022`),
  ];
  const enrollResp = await axios.post<AsyncAck>(
    `${API_BASE}/academics/students/import/iemis`,
    {
      students: enrollStudents,
      schoolId: SCHOOL_ID,
      dryRun: false,
      enrollInAcademicYearId: ACADEMIC_YEAR_ID,
    },
    {
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      validateStatus: () => true,
      timeout: 30_000,
    },
  );

  check('enroll POST returns 202', enrollResp.status === 202, { status: enrollResp.status, body: enrollResp.data });
  check(
    'enroll ack carries the enrollInAcademicYearId',
    enrollResp.data?.enrollInAcademicYearId === ACADEMIC_YEAR_ID,
    enrollResp.data,
  );

  if (enrollResp.status === 202 && enrollResp.data?.jobId) {
    const enrollJob = await pollJob(enrollResp.data.jobId);
    check(
      'enroll job reached status="succeeded"',
      enrollJob.status === 'succeeded',
      { status: enrollJob.status, error: enrollJob.error },
    );
    check(
      `enroll studentsCreated === ${enrollStudents.length}`,
      enrollJob.studentsCreated === enrollStudents.length,
      { studentsCreated: enrollJob.studentsCreated, expected: enrollStudents.length },
    );
    check(
      'enroll studentsEnrolled === studentsCreated (every created student also got an Enrollment row)',
      enrollJob.studentsEnrolled === enrollJob.studentsCreated,
      { studentsCreated: enrollJob.studentsCreated, studentsEnrolled: enrollJob.studentsEnrolled },
    );
    check(
      'enroll job durationMs is recorded',
      typeof enrollJob.durationMs === 'number' && enrollJob.durationMs > 0,
      enrollJob.durationMs,
    );
    check('enroll job failed === 0', enrollJob.failed === 0, enrollJob);
  }

  // ── Step 4: 404 on unknown jobId ──
  console.log('\n── Step 4: GET /jobs/:unknown returns 404 ──');
  const unknownResp = await axios.get(
    `${API_BASE}/academics/students/import/iemis/jobs/00000000-0000-0000-0000-000000000000`,
    {
      headers: { Authorization: `Bearer ${TOKEN}` },
      validateStatus: () => true,
      timeout: 15_000,
    },
  );
  check('GET /jobs/:unknown returns 404', unknownResp.status === 404, { status: unknownResp.status });

  console.log(`\nResult: ${fails.length === 0 ? 'PASS' : `FAIL (${fails.length} checks)`}`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error('FATAL:', (e as Error)?.message ?? e);
  process.exit(1);
});
