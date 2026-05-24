/// <reference types="node" />
/**
 * Sprint D.2 Phase 4 — Promotion-rules live smoke.
 *
 * Validates the prod academics service (`academicsbasic` ECS, ap-south-1)
 * is running the Phase 1-3 code that:
 *   - lazy-seeds an archetypeDefaulted rule on first GET when no rule
 *     exists for (schoolId, gradeLevel) (D.2.3);
 *   - POST/GET/PATCH/DELETE round-trip on /academics/promotion-rules (D.2.2);
 *   - PATCH on a lazy-seeded row flips archetypeDefaulted=false (D.2.4);
 *   - DELETE is soft (isActive=false); subsequent GET returns 200 with
 *     isActive=false (audit-traceable per D.2.2 contract). LIST filters
 *     soft-deleted rows out (verified by R7).
 *
 * Scope: read/write of the promotion-rules CRUD only. The promote-from +
 * commit endpoints (D.2.5/D.2.6) and the cross-year flip (D.2.9/D.2.10)
 * require a real cohort with result-cards and are operator-driven, not
 * synthetic-friendly.
 *
 * Repeatable: uses GRADE_LEVEL=99 (synthetic) so it won't collide with
 * operator-created rules at real grade levels. Cleans up on exit.
 *
 * Usage
 * =====
 *
 *   export PROD_ADMIN_TOKEN="$(cat /tmp/prod-jwt.txt)"
 *   export TENANT_ID=21aea5da-...
 *   export SCHOOL_ID=<uuid>
 *   npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/smoke-tests/d2-promotion-rules.ts
 *
 * Env
 * ===
 *   PROD_ADMIN_TOKEN   required — Cognito id-token for a TenantAdmin in TENANT_ID
 *   TENANT_ID          required — target tenant UUID
 *   SCHOOL_ID          required — target school UUID
 *   GRADE_LEVEL        optional — defaults to '99' (synthetic, won't collide)
 *   ARCHETYPE_ID       optional — defaults to 'PABSON'
 *   API_BASE_URL       optional — prod API GW base
 *
 * Exit codes: 0 = all green, 1 = one or more checks failed, 2 = config error.
 */

import axios from 'axios';

const TOKEN = process.env.PROD_ADMIN_TOKEN ?? '';
const TENANT_ID = process.env.TENANT_ID ?? '';
const SCHOOL_ID = process.env.SCHOOL_ID ?? '';
const GRADE_LEVEL = process.env.GRADE_LEVEL ?? '99';
const ARCHETYPE_ID = process.env.ARCHETYPE_ID ?? 'PABSON';
const BASE_URL =
  process.env.API_BASE_URL ??
  'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';

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
    console.error('✗ PROD_ADMIN_TOKEN, TENANT_ID, SCHOOL_ID env vars are required');
    process.exit(2);
  }

  console.log(`D.2 Phase 4 smoke @ ${BASE_URL}`);
  console.log(`Tenant: ${TENANT_ID}  School: ${SCHOOL_ID}  GradeLevel: ${GRADE_LEVEL}\n`);

  const createdRuleIds: string[] = [];

  // ──────────────────────────────────────────────────────────
  // R1 — Reachability + lazy-seed: GET with gradeLevel
  //
  // D.2.3 contract: when no active rule exists for (schoolId, gradeLevel),
  // a default rule is lazy-seeded from ArchetypeDefaults and returned.
  // archetypeDefaulted MUST be true on the seeded row.
  // ──────────────────────────────────────────────────────────
  const r1 = await call(
    'GET',
    `/academics/promotion-rules?schoolId=${SCHOOL_ID}&gradeLevel=${GRADE_LEVEL}`,
  );
  const r1List = Array.isArray(r1.body) ? r1.body : [];
  const r1Seeded = r1List.find(
    (rule: { gradeLevel: string; isActive: boolean }) =>
      rule.gradeLevel === GRADE_LEVEL && rule.isActive !== false,
  );
  const r1Ok =
    r1.status === 200 &&
    r1Seeded !== undefined &&
    r1Seeded.archetypeDefaulted === true;
  check(
    'R1 — GET ?schoolId=&gradeLevel= lazy-seeds with archetypeDefaulted=true',
    r1Ok,
    r1Ok ? undefined : { status: r1.status, count: r1List.length, found: r1Seeded },
  );
  if (r1Seeded?.ruleId) createdRuleIds.push(r1Seeded.ruleId);

  // ──────────────────────────────────────────────────────────
  // R2 — POST a fresh rule (operator-created, archetypeDefaulted=false)
  //
  // Use a DIFFERENT gradeLevel so the lazy-seeded row from R1 doesn't
  // collide on (schoolId, gradeLevel) uniqueness.
  // ──────────────────────────────────────────────────────────
  const altGradeLevel = `${GRADE_LEVEL}A`;
  const r2 = await call('POST', '/academics/promotion-rules', {
    schoolId: SCHOOL_ID,
    gradeLevel: altGradeLevel,
    archetypeId: ARCHETYPE_ID,
    passingThresholdPct: 50,
    minAttendancePct: 75,
    subjectsRequired: [],
    description: 'D.2 smoke — synthetic rule',
  });
  const r2Ok =
    r2.status >= 200 &&
    r2.status < 300 &&
    r2.body?.gradeLevel === altGradeLevel &&
    r2.body?.passingThresholdPct === 50 &&
    r2.body?.archetypeDefaulted === false;
  check(
    'R2 — POST creates rule with archetypeDefaulted=false',
    r2Ok,
    r2Ok ? undefined : { status: r2.status, body: r2.body },
  );
  if (r2.body?.ruleId) createdRuleIds.push(r2.body.ruleId);

  // ──────────────────────────────────────────────────────────
  // R3 — GET single rule by id
  // ──────────────────────────────────────────────────────────
  let r3Ok = false;
  const r2RuleId = r2.body?.ruleId;
  if (r2RuleId) {
    const r3 = await call(
      'GET',
      `/academics/promotion-rules/${r2RuleId}?schoolId=${SCHOOL_ID}`,
    );
    r3Ok =
      r3.status === 200 &&
      r3.body?.ruleId === r2RuleId &&
      r3.body?.gradeLevel === altGradeLevel;
    check(
      'R3 — GET /promotion-rules/:ruleId returns the created rule',
      r3Ok,
      r3Ok ? undefined : { status: r3.status, body: r3.body },
    );
  } else {
    check('R3 — GET /promotion-rules/:ruleId returns the created rule', false, 'skipped: R2 did not return a ruleId');
  }

  // ──────────────────────────────────────────────────────────
  // R4 — PATCH the lazy-seeded rule flips archetypeDefaulted=false
  //
  // D.2.4 contract: first PATCH on a lazy-seeded row is an operator
  // override → service sets archetypeDefaulted=false even if the
  // operator didn't supply that field.
  // ──────────────────────────────────────────────────────────
  let r4Ok = false;
  if (r1Seeded?.ruleId) {
    const r4 = await call(
      'PATCH',
      `/academics/promotion-rules/${r1Seeded.ruleId}?schoolId=${SCHOOL_ID}`,
      { passingThresholdPct: 42 },
    );
    r4Ok =
      r4.status === 200 &&
      r4.body?.passingThresholdPct === 42 &&
      r4.body?.archetypeDefaulted === false;
    check(
      'R4 — PATCH lazy-seeded rule flips archetypeDefaulted=false + applies field update',
      r4Ok,
      r4Ok ? undefined : { status: r4.status, body: r4.body },
    );
  } else {
    check('R4 — PATCH lazy-seeded rule', false, 'skipped: R1 did not return a lazy-seeded ruleId');
  }

  // ──────────────────────────────────────────────────────────
  // R5 — DELETE (soft, isActive=false) returns 204
  // ──────────────────────────────────────────────────────────
  let r5Ok = false;
  if (r2RuleId) {
    const r5 = await call(
      'DELETE',
      `/academics/promotion-rules/${r2RuleId}?schoolId=${SCHOOL_ID}`,
    );
    r5Ok = r5.status === 204;
    check(
      'R5 — DELETE /promotion-rules/:ruleId returns 204',
      r5Ok,
      r5Ok ? undefined : { status: r5.status, body: r5.body },
    );
  } else {
    check('R5 — DELETE /promotion-rules/:ruleId returns 204', false, 'skipped: R2 did not return a ruleId');
  }

  // ──────────────────────────────────────────────────────────
  // R6 — After soft-delete, GET still returns the row with isActive=false
  //
  // D.2.2 contract: soft-delete retains the row for audit traceability.
  // GET on the row succeeds; LIST filters it out. (Verified live 2026-05-24.)
  // ──────────────────────────────────────────────────────────
  let r6Ok = false;
  if (r2RuleId) {
    const r6 = await call(
      'GET',
      `/academics/promotion-rules/${r2RuleId}?schoolId=${SCHOOL_ID}`,
    );
    r6Ok = r6.status === 200 && r6.body?.isActive === false;
    check(
      'R6 — GET soft-deleted rule returns 200 + isActive=false (audit-traceable)',
      r6Ok,
      r6Ok ? undefined : { status: r6.status, body: r6.body },
    );
  } else {
    check('R6 — GET soft-deleted rule returns 200 + isActive=false', false, 'skipped: R2 did not return a ruleId');
  }

  // ──────────────────────────────────────────────────────────
  // R7 — LIST filters out soft-deleted rows (lazy-seed must fire again
  //      if (schoolId, gradeLevel) had only soft-deleted entries).
  // ──────────────────────────────────────────────────────────
  let r7Ok = false;
  if (r2RuleId) {
    const r7 = await call(
      'GET',
      `/academics/promotion-rules?schoolId=${SCHOOL_ID}&gradeLevel=${altGradeLevel}`,
    );
    const r7List = Array.isArray(r7.body) ? r7.body : [];
    const sawDeleted = r7List.some(
      (rule: { ruleId: string }) => rule.ruleId === r2RuleId,
    );
    r7Ok = r7.status === 200 && !sawDeleted;
    check(
      'R7 — LIST /promotion-rules filters out soft-deleted rows',
      r7Ok,
      r7Ok ? undefined : { status: r7.status, sawDeleted, listLen: r7List.length },
    );
  } else {
    check('R7 — LIST filters out soft-deleted rows', false, 'skipped: R2 did not return a ruleId');
  }

  // ──────────────────────────────────────────────────────────
  // Cleanup — soft-delete every rule we touched/created, including
  // the lazy-seeded one from R1. Idempotent re-runs depend on this.
  // ──────────────────────────────────────────────────────────
  for (const ruleId of createdRuleIds) {
    const del = await call(
      'DELETE',
      `/academics/promotion-rules/${ruleId}?schoolId=${SCHOOL_ID}`,
    );
    if (del.status === 204 || del.status === 404) {
      console.log(`  cleanup: rule ${ruleId} → ${del.status}`);
    } else {
      console.log(`! cleanup: rule ${ruleId} → ${del.status} (manual cleanup may be needed)`);
    }
  }

  console.log(
    `\n${fails.length === 0 ? '✓ ALL D.2 SMOKE CHECKS GREEN' : `✗ ${fails.length} FAILURES`}`,
  );
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error('crash:', msg);
  process.exit(2);
});
