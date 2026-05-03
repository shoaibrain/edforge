/// <reference types="node" />
/**
 * IEMIS Sprints 0-3 smoke — UAT.
 *
 * Usage:
 *   npx ts-node scripts/smoke-tests/iemis-sprints-0-3.ts
 *   npx ts-node scripts/smoke-tests/iemis-sprints-0-3.ts 2>&1 | tee docs/deploys/uat-smoke-sprint0-3-$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD).log
 *
 * Exit 0 = all green; exit 1 = some check failed.
 */

import axios from 'axios';

// ── config ─────────────────────────────────────────────────────────────────

// Paste a Cognito ID token for a UAT / prod tenant-admin. Accepts raw JWT or
// "Bearer <jwt>" form — call() normalizes via authHeader().
const ADMIN_TOKEN: string = 'PASTE_TENANT_ADMIN_JWT_HERE';

// Optional: tenant-user (non-admin) JWT for RBAC-deny tests. '' to skip.
const USER_TOKEN: string = '';

const BASE_URL = 'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';

// UAT tenant: testtenant007 (PABSON/NPL)
// RAS (emisSchoolCode=170840012) | HPS (emisSchoolCode=170840012) | MES (no code)
const IEMIS_SCHOOL_ID = '7031d447-313c-4624-a218-00a0d2a793cc'; // RAS

/** Optional: a real student UUID in testtenant007. Leave '' to skip S3 PATCH/SSA tests. */
const STUDENT_ID = '';

// ── helpers ────────────────────────────────────────────────────────────────

function authHeader(t: string): string {
  return t.startsWith('Bearer ') ? t : `Bearer ${t}`;
}

async function call(token: string, method: 'GET' | 'POST' | 'PATCH', path: string, body?: any) {
  const r = await axios({
    method,
    url: `${BASE_URL}${path}`,
    headers: { Authorization: authHeader(token), 'Content-Type': 'application/json' },
    data: body,
    validateStatus: () => true,
    timeout: 30_000,
  });
  return { status: r.status, body: r.data };
}

const fails: string[] = [];

function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) {
    console.log(`  └─ ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    fails.push(name);
  }
}

// ── checks ─────────────────────────────────────────────────────────────────

async function main() {
  if (ADMIN_TOKEN.includes('PASTE_')) {
    console.error('✗ ADMIN_TOKEN not configured — paste a real JWT at the top of this file.');
    process.exit(2);
  }
  console.log(`IEMIS Sprints 0-3 smoke @ ${BASE_URL}\n`);

  // S1.5 — verify-school-code format-only validator
  let r = await call(ADMIN_TOKEN, 'GET', '/iemis/verify-school-code/12345678');
  check('S1.5 — 8-digit code → valid=true', r.status === 200 && r.body?.valid === true, r);

  r = await call(ADMIN_TOKEN, 'GET', '/iemis/verify-school-code/abc12345');
  check('S1.5 — non-digit code → valid=false', r.status === 200 && r.body?.valid === false, r);

  r = await call(ADMIN_TOKEN, 'GET', '/iemis/verify-school-code/4225353');
  check('S1.5 — 7-digit code → valid=false', r.status === 200 && r.body?.valid === false, r);

  // S1.10 — admin can read audit
  r = await call(ADMIN_TOKEN, 'GET', '/iemis/audit');
  check('S1.10 — admin /iemis/audit → 200 with items[]',
    r.status === 200 && Array.isArray(r.body?.items), r);

  // S1.7 — tenant-user forbidden
  if (USER_TOKEN) {
    r = await call(USER_TOKEN, 'GET', '/iemis/audit');
    check('S1.7 — tenant-user /iemis/audit → 403', r.status === 403, r);
  } else {
    console.log('- S1.7 skipped (no USER_TOKEN)');
  }

  // S1.4 — PABSON gate: POST student without emisStudentId to IEMIS school
  r = await call(ADMIN_TOKEN, 'POST', '/academics/students', {
    schoolId: IEMIS_SCHOOL_ID,
    firstName: 'Smoke',
    lastName: `Test${Date.now()}`,
    dateOfBirth: '2015-04-10',
    gender: 'male',
    currentGradeLevel: '3',
  });
  const gateOk =
    r.status === 400 &&
    (r.body?.errorCode === 'EMIS_STUDENT_ID_REQUIRED' ||
      r.body?.response?.errorCode === 'EMIS_STUDENT_ID_REQUIRED' ||
      String(r.body?.message ?? '').toLowerCase().includes('emisstudentid'));
  check('S1.4 — PABSON student without emisStudentId → 400', gateOk, r);

  // S3 checks require a real student id
  if (STUDENT_ID) {
    const qs = `?schoolId=${IEMIS_SCHOOL_ID}`;
    const url = (p: string) => `/academics/students/${STUDENT_ID}${p}${qs}`;

    r = await call(ADMIN_TOKEN, 'PATCH', url('/descriptors'), {
      sexDescriptor: 'uri://ed-fi.org/SexDescriptor#Female',
      motherTongueDescriptor: 'uri://ed-fi.org/LanguageDescriptor#Maithili',
    });
    check('S3.7 — PATCH descriptors valid URIs → 200', r.status === 200, r);

    r = await call(ADMIN_TOKEN, 'PATCH', url('/descriptors'), { sexDescriptor: 'uri://bad-shape' });
    check('S3.7 — PATCH malformed URI → 400', r.status === 400, r);

    r = await call(ADMIN_TOKEN, 'PATCH', url('/descriptors'), {
      sexDescriptor: 'uri://ed-fi.org/SexDescriptor#NotReal',
    });
    check('S3.7 — PATCH URI not in catalog → 400', r.status === 400, r);

    r = await call(ADMIN_TOKEN, 'PATCH', url('/descriptors'), { firstName: 'injected' });
    check('S3.7 — PATCH unknown key (strict Zod) → 400', r.status === 400, r);

    r = await call(ADMIN_TOKEN, 'PATCH', url('/descriptors'), {
      disabilities: [
        {
          descriptor: 'uri://ed-fi.org/DisabilityDescriptor#Hearing',
          notes: 'SMOKE-TEST-NOTE',
        },
      ],
    });
    check('S3.7 — PATCH disabilities with notes → 200 (audit row should strip notes)',
      r.status === 200, r);

    r = await call(ADMIN_TOKEN, 'GET', url('/student-school-associations'));
    check('S3.3 — SSA listByStudent → 200 with items[]',
      r.status === 200 && Array.isArray(r.body?.items), r);
  } else {
    console.log('- S3 PATCH / SSA checks skipped (STUDENT_ID empty)');
  }

  console.log(`\n${fails.length === 0 ? '✓ ALL CHECKS GREEN' : `✗ ${fails.length} FAILURES`}`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('crash:', e?.message ?? e);
  process.exit(2);
});
