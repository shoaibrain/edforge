/**
 * Sprint E.1 — Flash I/II Reporting Snapshot Smoke Test
 *
 * Exercises the operator-facing reporting API and the async aggregation
 * pipeline end-to-end against a LIVE prod identity service.
 *
 * Scope: internal-dev tenant (dev-pabson-primary / DPPSW). Real-prod
 * Saraswati school is hard-rejected.
 *
 * What this exercises
 * ===================
 * E.1.4 + E.1.5    POST /reporting/snapshots/preflight  — sync validation
 * E.1.4            POST /reporting/snapshots            — async generation
 * E.1.4            GET  /reporting/snapshots/:id        — read state
 * E.1.3            Lambda-driven CSV gen                — poll until generated
 * E.1.7            PATCH /reporting/snapshots/:id/transition — submit/verify
 *
 * Usage
 * =====
 *   1. Paste the internal-dev Cognito id-token into /tmp/dev-jwt.txt
 *      (use the Write tool — see memory `project_grade_level_fix_T4_shipped`
 *      for JWT-transcription retro).
 *   2. (Optional) Override target school via SMOKE_SCHOOL_ID.
 *   3. Run: `npx ts-node scripts/smoke-tests/e1-flash-i-ii-smoke.ts`
 *
 * Exit codes
 * ==========
 *   0  All assertions pass
 *   1  One or more assertions failed
 *   2  Pre-flight failure (JWT missing, wrong schoolId, network down)
 */

import axios from 'axios';
import type { AxiosError, AxiosRequestConfig } from 'axios';
import * as fs from 'fs';

const BASE_URL =
  process.env.SMOKE_BASE_URL ||
  'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';
const JWT_PATH = process.env.SMOKE_JWT_PATH || '/tmp/dev-jwt.txt';

const DEFAULT_SCHOOL_ID = '4209e3d8-d2e2-4e0e-9961-790341c264f4';   // internal-dev Saraswati
const REAL_PROD_SARASWATI_SCHOOL_ID = '61a247a4-44d6-4fc0-a414-062fd4d7e694';
const SCHOOL_ID = process.env.SMOKE_SCHOOL_ID || DEFAULT_SCHOOL_ID;
const ACADEMIC_YEAR_BS = process.env.SMOKE_AY_BS || '2083';
const TEMPLATE_ID = (process.env.SMOKE_TEMPLATE_ID ||
  'IEMIS_NPL_CEHRD_FLASH_I') as
  | 'IEMIS_NPL_CEHRD_FLASH_I'
  | 'IEMIS_NPL_CEHRD_FLASH_II';
const POLL_TIMEOUT_SEC = Number(process.env.SMOKE_POLL_TIMEOUT_SEC || '90');
const POLL_INTERVAL_SEC = Number(process.env.SMOKE_POLL_INTERVAL_SEC || '3');

if (SCHOOL_ID === REAL_PROD_SARASWATI_SCHOOL_ID) {
  console.error(
    `\nFATAL: Refusing to run E.1 smoke against real-prod Saraswati ` +
    `(${REAL_PROD_SARASWATI_SCHOOL_ID}). Use only internal-dev tenants.`,
  );
  process.exit(2);
}

if (!fs.existsSync(JWT_PATH)) {
  console.error(`\nFATAL: JWT file not found at ${JWT_PATH}.`);
  process.exit(2);
}
const ID_TOKEN = fs.readFileSync(JWT_PATH, 'utf8').trim();
if (!ID_TOKEN.startsWith('eyJ')) {
  console.error(`\nFATAL: JWT does not look like a Cognito id-token.`);
  process.exit(2);
}

const C = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
};

interface AssertionResult {
  name: string;
  status: 'PASS' | 'FAIL';
  detail?: string;
}
const results: AssertionResult[] = [];

function pass(name: string, detail?: string): void {
  results.push({ name, status: 'PASS', detail });
  console.log(`${C.green}✓${C.reset} ${name}${detail ? `  ${C.gray}${detail}${C.reset}` : ''}`);
}
function fail(name: string, detail: string): void {
  results.push({ name, status: 'FAIL', detail });
  console.log(`${C.red}✗${C.reset} ${name}  ${C.red}${detail}${C.reset}`);
}
function note(msg: string): void {
  console.log(`${C.gray}  · ${msg}${C.reset}`);
}

function authConfig(extra: AxiosRequestConfig = {}): AxiosRequestConfig {
  return {
    headers: { Authorization: `Bearer ${ID_TOKEN}` },
    validateStatus: () => true,
    timeout: 30_000,
    ...extra,
  };
}

function describeError(e: AxiosError): string {
  if (!e.response) return e.message;
  const body = e.response.data;
  return `${e.response.status} — ${typeof body === 'string' ? body : JSON.stringify(body)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function preflight(): Promise<void> {
  const r = await axios.post(
    `${BASE_URL}/reporting/snapshots/preflight`,
    {
      schoolId: SCHOOL_ID,
      templateId: TEMPLATE_ID,
      academicYearBs: ACADEMIC_YEAR_BS,
    },
    authConfig(),
  );

  if (r.status !== 200 && r.status !== 201) {
    fail('E.1.5 pre-flight returns 200', `status=${r.status} body=${JSON.stringify(r.data)}`);
    return;
  }
  pass('E.1.5 pre-flight returns 200');

  const body = r.data;
  if (typeof body.rowCount !== 'number') {
    fail('E.1.5 pre-flight body has rowCount', `body=${JSON.stringify(body)}`);
  } else {
    pass('E.1.5 pre-flight body has rowCount', `rowCount=${body.rowCount}`);
  }
  if (!Array.isArray(body.errors)) {
    fail('E.1.5 pre-flight body has errors[]', `body=${JSON.stringify(body)}`);
  } else {
    pass('E.1.5 pre-flight body has errors[]', `errors=${body.errors.length}`);
  }
  if (!Array.isArray(body.warnings)) {
    fail('E.1.5 pre-flight body has warnings[]', `body=${JSON.stringify(body)}`);
  } else {
    pass(
      'E.1.5 pre-flight body has warnings[]',
      `warnings=${body.warnings.length}` +
        (body.warnings.length ? ` (e.g. ${body.warnings[0].code})` : ''),
    );
  }
  if (typeof body.canProceed !== 'boolean') {
    fail('E.1.5 pre-flight body has canProceed', `body=${JSON.stringify(body)}`);
  } else {
    pass('E.1.5 pre-flight body has canProceed', `canProceed=${body.canProceed}`);
  }
}

async function createAndPoll(): Promise<string | null> {
  // Create the snapshot
  const createR = await axios.post(
    `${BASE_URL}/reporting/snapshots`,
    {
      schoolId: SCHOOL_ID,
      templateId: TEMPLATE_ID,
      academicYearBs: ACADEMIC_YEAR_BS,
      dryRun: true,    // V1 smoke uses dryRun to avoid littering the staging bucket
    },
    authConfig(),
  );
  if (createR.status !== 200 && createR.status !== 201) {
    fail(
      'E.1.4 POST /reporting/snapshots returns 200/201',
      `status=${createR.status} body=${JSON.stringify(createR.data)}`,
    );
    return null;
  }
  pass('E.1.4 POST /reporting/snapshots returns 2xx');

  const snapshotId = createR.data?.snapshotId;
  if (!snapshotId) {
    fail('E.1.4 response carries snapshotId', `body=${JSON.stringify(createR.data)}`);
    return null;
  }
  pass('E.1.4 response carries snapshotId', `snapshotId=${snapshotId}`);

  const initialStatus = createR.data?.status;
  if (initialStatus !== 'generating') {
    fail('E.1.4 initial status is generating', `status=${initialStatus}`);
  } else {
    pass('E.1.4 initial status is generating');
  }

  // Poll until generated or failed
  note(`polling status — timeout ${POLL_TIMEOUT_SEC}s, every ${POLL_INTERVAL_SEC}s`);
  const startedAt = Date.now();
  let lastStatus = initialStatus;
  while (Date.now() - startedAt < POLL_TIMEOUT_SEC * 1000) {
    await sleep(POLL_INTERVAL_SEC * 1000);
    const getR = await axios.get(
      `${BASE_URL}/reporting/snapshots/${snapshotId}?schoolId=${SCHOOL_ID}`,
      authConfig(),
    );
    if (getR.status !== 200) {
      fail('E.1.4 GET snapshot returns 200', `status=${getR.status}`);
      return null;
    }
    lastStatus = getR.data?.status;
    note(`  status=${lastStatus} rowCount=${getR.data?.rowCount ?? '?'}`);
    if (lastStatus === 'generated' || lastStatus === 'failed') {
      pass(
        `E.1.3 Lambda transitioned snapshot to terminal state`,
        `status=${lastStatus} rowCount=${getR.data?.rowCount ?? 0}`,
      );
      if (lastStatus === 'failed') {
        note(
          `  errorCode=${getR.data?.errorCode} ` +
          `errorSummary=${getR.data?.errorSummary}`,
        );
      }
      return snapshotId;
    }
  }
  fail(
    'E.1.3 Lambda transitioned snapshot to terminal state',
    `polling timed out after ${POLL_TIMEOUT_SEC}s — last status was ${lastStatus}`,
  );
  return snapshotId;
}

async function transitionToSubmitted(snapshotId: string): Promise<void> {
  const r = await axios.patch(
    `${BASE_URL}/reporting/snapshots/${snapshotId}/transition?schoolId=${SCHOOL_ID}`,
    { nextStatus: 'submitted' },
    authConfig(),
  );
  if (r.status !== 200) {
    fail('E.1.7 PATCH submitted → 200', `status=${r.status} body=${JSON.stringify(r.data)}`);
    return;
  }
  if (r.data?.status !== 'submitted') {
    fail('E.1.7 status is submitted after PATCH', `status=${r.data?.status}`);
    return;
  }
  pass('E.1.7 PATCH submitted → 200 + status=submitted');
  if (!r.data?.submittedAt) {
    fail('E.1.7 submittedAt populated', `body=${JSON.stringify(r.data)}`);
  } else {
    pass('E.1.7 submittedAt populated', `at=${r.data.submittedAt}`);
  }
}

async function main(): Promise<void> {
  console.log(
    `\n${C.bold}Sprint E.1 — Flash I/II Reporting Snapshot Smoke${C.reset}`,
  );
  console.log(`${C.gray}  base=${BASE_URL}${C.reset}`);
  console.log(`${C.gray}  school=${SCHOOL_ID}${C.reset}`);
  console.log(`${C.gray}  templateId=${TEMPLATE_ID}${C.reset}`);
  console.log(`${C.gray}  academicYearBs=${ACADEMIC_YEAR_BS}${C.reset}\n`);

  try {
    await preflight();
  } catch (e) {
    fail('E.1.5 pre-flight threw', describeError(e as AxiosError));
  }

  let snapshotId: string | null = null;
  try {
    snapshotId = await createAndPoll();
  } catch (e) {
    fail('E.1.4 create-and-poll threw', describeError(e as AxiosError));
  }

  if (snapshotId) {
    try {
      await transitionToSubmitted(snapshotId);
    } catch (e) {
      fail('E.1.7 transition threw', describeError(e as AxiosError));
    }
  }

  console.log(`\n${C.bold}Summary${C.reset}`);
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(`${C.green}${passed} passed${C.reset}  ${C.red}${failed} failed${C.reset}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('unhandled error', e);
  process.exit(1);
});
