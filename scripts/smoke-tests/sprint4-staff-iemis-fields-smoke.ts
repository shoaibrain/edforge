/// <reference types="node" />
/**
 * Sprint 4 S4.1 + S4.6 smoke — verify the 5 IEMIS Staff fields round-trip
 * through POST /staff and GET /staff/:id on the live identity service.
 *
 * This is the hotfix-lesson smoke: the 2026-04-24 student-mapper bug
 * (fixed in PR #23) silently stripped descriptor fields from response
 * bodies because the mapper hadn't been updated. This test locks the
 * same class of bug down for Staff — after this PR rolls, the 5
 * `emisStaffId`, `nationality`, `maritalStatus`, `appointmentType`,
 * `appointmentDate` fields must survive a write-then-read round trip.
 *
 * Usage:
 *   export ADMIN_TOKEN="eyJ..."           # UAT tenant-admin JWT
 *   export SCHOOL_ID="<uuid>"             # existing school on that tenant
 *   export API_BASE="https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod"
 *   npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/smoke-tests/sprint4-staff-iemis-fields-smoke.ts
 *
 * Exit 0 = all green; exit 1 = any check failed.
 */

import axios from 'axios';

const TOKEN = process.env.ADMIN_TOKEN ?? '';
const SCHOOL_ID = process.env.SCHOOL_ID ?? '';
const BASE = process.env.API_BASE ?? 'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';

const fails: string[] = [];
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) {
    console.log(`  └─ ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    fails.push(name);
  }
}

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: any) {
  const r = await axios({
    method,
    url: `${BASE}${path}`,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    data: body,
    validateStatus: () => true,
    timeout: 30_000,
  });
  return { status: r.status, body: r.data };
}

async function main() {
  if (!TOKEN) { console.error('✗ ADMIN_TOKEN empty'); process.exit(2); }
  if (!SCHOOL_ID) { console.error('✗ SCHOOL_ID empty — set to a real school uuid on the JWT tenant'); process.exit(2); }

  const uniqueStamp = Date.now().toString(36);
  const staffPayload = {
    staffUniqueId: `S4-SMOKE-${uniqueStamp}`,
    firstName: 'Sprint4',
    lastSurname: 'Smoke',
    email: `s4-smoke-${uniqueStamp}@example.test`,
    primarySchoolId: SCHOOL_ID,
    role: 'teacher',
    employmentType: 'full_time',
    hireDate: '2026-01-10',
    birthDate: '1990-06-15',
    gender: 'male',
    // ── The 5 fields under test (Sprint 4 S4.1) ──
    emisStaffId: '1234567890123456',
    nationality: 'NPL',
    maritalStatus: 'married',
    appointmentType: 'permanent',
    appointmentDate: '2023-09-01',
  };

  console.log(`Sprint 4 S4.1 + S4.6 smoke @ ${BASE}\n`);

  // 1. Create — POST /staff
  const create = await call('POST', '/staff', staffPayload);
  check('POST /staff — 200 or 201 on create with 5 IEMIS fields populated',
    create.status === 200 || create.status === 201,
    { status: create.status, body: create.body });

  if (create.status !== 200 && create.status !== 201) {
    console.log(`\n✗ Cannot continue — create failed. Aborting.`);
    process.exit(1);
  }

  const staffId = (create.body?.staffId) as string | undefined;
  if (!staffId) {
    console.log(`\n✗ Cannot continue — create response missing staffId.`);
    process.exit(1);
  }

  // 2. Assert — POST response body includes all 5 IEMIS fields
  const expected = {
    emisStaffId: '1234567890123456',
    nationality: 'NPL',
    maritalStatus: 'married',
    appointmentType: 'permanent',
    appointmentDate: '2023-09-01',
  };
  for (const [k, v] of Object.entries(expected)) {
    check(`POST response includes ${k} = ${v}`,
      (create.body as any)[k] === v,
      { got: (create.body as any)[k], expected: v });
  }

  // 3. Read-back — GET /staff/:id
  const get = await call('GET', `/staff/${staffId}`);
  check('GET /staff/:id — 200',
    get.status === 200,
    { status: get.status });

  // 4. Assert — GET response body includes all 5 IEMIS fields (mapper round-trip)
  for (const [k, v] of Object.entries(expected)) {
    check(`GET response includes ${k} = ${v} (mapper round-trip)`,
      (get.body as any)[k] === v,
      { got: (get.body as any)[k], expected: v });
  }

  // 5. PATCH — update one field (nationality) to a different value
  const patch = await call('PATCH', `/staff/${staffId}`, { nationality: 'IND' });
  check('PATCH /staff/:id — 200 on single-field update',
    patch.status === 200,
    { status: patch.status, body: patch.body });

  // 6. Assert — PATCH response body reflects the new nationality
  check('PATCH response includes updated nationality = IND',
    (patch.body as any)?.nationality === 'IND',
    { got: (patch.body as any)?.nationality });

  // 7. Assert — the other 4 fields survived the PATCH untouched
  const preserved = {
    emisStaffId: '1234567890123456',
    maritalStatus: 'married',
    appointmentType: 'permanent',
    appointmentDate: '2023-09-01',
  };
  for (const [k, v] of Object.entries(preserved)) {
    check(`PATCH response preserves ${k} = ${v} (untouched fields survive)`,
      (patch.body as any)[k] === v,
      { got: (patch.body as any)[k], expected: v });
  }

  // 8. Cleanup — delete the smoke-test staff so we don't clutter the tenant
  const del = await call('DELETE', `/staff/${staffId}`);
  check('DELETE /staff/:id — cleanup succeeds (200 or 204)',
    del.status === 200 || del.status === 204,
    { status: del.status });

  console.log(`\n${fails.length === 0 ? '✓ ALL SPRINT 4 S4.1 + S4.6 SMOKE CHECKS GREEN' : `✗ ${fails.length} FAILURES`}`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('crash:', e?.message ?? e);
  process.exit(2);
});
