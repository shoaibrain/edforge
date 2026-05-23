/// <reference types="node" />
/**
 * Sprint A.2 Phase 2 — Course extension live smoke (4-curl).
 *
 * Validates the prod academics service (`academicsbasic` ECS, ap-south-1)
 * is running the Phase 2 code that:
 *   - persists `academicSubject` + `stateSubjectCode` + `curriculumRef`
 *     on POST /courses;
 *   - rejects invalid `curriculumRef` at the Zod pipe (400);
 *   - supports PATCH of the 3 new fields on legacy rows;
 *   - returns legacy `subjectArea`-only courses without back-compat errors.
 *
 * Repeatable: cleans up the synthetic course on exit (DELETE) so re-running
 * doesn't pollute the target school's catalog. Idempotent.
 *
 * Usage
 * =====
 *
 *   export PROD_ADMIN_TOKEN="$(cat /tmp/dev-jwt.txt)"
 *   export TENANT_ID=21aea5da-...
 *   export SCHOOL_ID=<uuid>
 *   npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/smoke-tests/a2-course-extension.ts
 *
 * Env
 * ===
 *   PROD_ADMIN_TOKEN   required — Cognito id-token for a TenantAdmin in TENANT_ID
 *   TENANT_ID          required — target tenant UUID (defaults to dev-pabson-primary)
 *   SCHOOL_ID          required — target school UUID
 *   API_BASE_URL       optional — prod API GW base
 *
 * Exit codes: 0 = all green, 1 = one or more checks failed, 2 = config error.
 */

import axios from 'axios';

const TOKEN = process.env.PROD_ADMIN_TOKEN ?? '';
const TENANT_ID = process.env.TENANT_ID ?? '';
const SCHOOL_ID = process.env.SCHOOL_ID ?? '';
const BASE_URL =
  process.env.API_BASE_URL ??
  'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';

const SYNTHETIC_COURSE_CODE = `A2-SMOKE-${Date.now()}`;

const fails: string[] = [];
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) {
    console.log(`  └─ ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    fails.push(name);
  }
}

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) {
  const r = await axios({
    method,
    url: `${BASE_URL}${path}`,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    data: body,
    validateStatus: () => true,
    timeout: 30_000,
  });
  return { status: r.status, body: r.data };
}

async function main() {
  if (!TOKEN || !TENANT_ID || !SCHOOL_ID) {
    console.error(
      '✗ PROD_ADMIN_TOKEN, TENANT_ID, SCHOOL_ID env vars are required',
    );
    process.exit(2);
  }

  console.log(`A.2 Phase 2 smoke @ ${BASE_URL}`);
  console.log(`Tenant: ${TENANT_ID}  School: ${SCHOOL_ID}\n`);

  let createdCourseId: string | undefined;

  // ──────────────────────────────────────────────────────────
  // P1 — POST valid: new fields persist
  // ──────────────────────────────────────────────────────────
  const p1Body = {
    courseCode: SYNTHETIC_COURSE_CODE,
    courseName: 'A.2 Smoke — Synthetic Math',
    schoolId: SCHOOL_ID,
    gradeLevels: ['4', '5'],
    credits: 1,
    subjectArea: 'mathematics',
    courseType: 'required',
    typicalDuration: 'year',
    // A.2.1 fields
    academicSubject: 'mathematics',
    curriculumRef: 'CDC_NCF_2076',
    stateSubjectCode: 'A2-SMOKE',
  };
  const p1 = await call('POST', '/academics/courses', p1Body);
  const p1Ok =
    p1.status >= 200 &&
    p1.status < 300 &&
    p1.body?.academicSubject === 'mathematics' &&
    p1.body?.curriculumRef === 'CDC_NCF_2076' &&
    p1.body?.stateSubjectCode === 'A2-SMOKE';
  check(
    'P1 — POST /courses with A.2 fields persists academicSubject + curriculumRef + stateSubjectCode',
    p1Ok,
    p1Ok ? undefined : { status: p1.status, body: p1.body },
  );
  if (p1Ok) createdCourseId = p1.body.courseId;

  // ──────────────────────────────────────────────────────────
  // P2 — POST invalid curriculumRef returns 400 from Zod pipe
  // ──────────────────────────────────────────────────────────
  const p2Body = {
    ...p1Body,
    courseCode: SYNTHETIC_COURSE_CODE + '-BAD',
    curriculumRef: 'INVALID_CURRICULUM_THAT_DOES_NOT_EXIST',
  };
  const p2 = await call('POST', '/academics/courses', p2Body);
  check(
    'P2 — POST /courses with invalid curriculumRef returns 400 (Zod pipe)',
    p2.status === 400,
    { status: p2.status, body: p2.body },
  );

  // ──────────────────────────────────────────────────────────
  // P3 — PATCH the synthetic course to verify update path of new fields
  // ──────────────────────────────────────────────────────────
  let p3Ok = false;
  if (createdCourseId) {
    const p3 = await call(
      'PATCH',
      `/academics/courses/${createdCourseId}?schoolId=${SCHOOL_ID}`,
      { stateSubjectCode: 'A2-SMOKE-PATCHED', curriculumRef: 'CDC_NCF_2076' },
    );
    p3Ok =
      p3.status >= 200 &&
      p3.status < 300 &&
      p3.body?.stateSubjectCode === 'A2-SMOKE-PATCHED' &&
      p3.body?.curriculumRef === 'CDC_NCF_2076';
    check(
      'P3 — PATCH /courses/:id updates A.2 fields (stateSubjectCode round-trips)',
      p3Ok,
      p3Ok ? undefined : { status: p3.status, body: p3.body },
    );
  } else {
    check(
      'P3 — PATCH /courses/:id updates A.2 fields',
      false,
      'skipped: P1 did not create a course to patch',
    );
  }

  // ──────────────────────────────────────────────────────────
  // P4 — Legacy GET: existing courses without A.2 fields still 200
  // (uses listCourses; if the school is brand-new there may be no rows
  // but the endpoint itself MUST 200 for back-compat to hold)
  // ──────────────────────────────────────────────────────────
  const p4 = await call('GET', `/academics/courses?schoolId=${SCHOOL_ID}&limit=10`);
  const p4Ok = p4.status === 200 && Array.isArray(p4.body?.items);
  check(
    'P4 — GET /courses returns 200 with items[] (legacy rows back-compat)',
    p4Ok,
    p4Ok ? undefined : { status: p4.status, body: p4.body },
  );

  // ──────────────────────────────────────────────────────────
  // Cleanup — DELETE the synthetic course so re-runs are idempotent
  // ──────────────────────────────────────────────────────────
  if (createdCourseId) {
    const del = await call(
      'DELETE',
      `/academics/courses/${createdCourseId}?schoolId=${SCHOOL_ID}`,
    );
    if (del.status >= 200 && del.status < 300) {
      console.log(`✓ cleanup: synthetic course ${createdCourseId} soft-deleted`);
    } else {
      console.log(
        `! cleanup: DELETE ${createdCourseId} returned ${del.status} (manual cleanup may be needed)`,
      );
    }
  }

  console.log(
    `\n${fails.length === 0 ? '✓ ALL A.2 SMOKE CHECKS GREEN' : `✗ ${fails.length} FAILURES`}`,
  );
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error('crash:', msg);
  process.exit(2);
});
