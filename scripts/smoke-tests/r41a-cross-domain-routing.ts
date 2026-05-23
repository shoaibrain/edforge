/// <reference types="node" />
/**
 * Sprint R41.A — Cross-domain routing smoke (CFN headroom).
 *
 * **Validation Layer 3 from the R41.A plan** (see
 * `docs/pilot-greenlight/cfn-headroom-sprint-plan.md` §3).
 *
 * After swapping `ApiDefinition.fromInline` → `ApiDefinition.fromAsset`
 * + Stage variables for the 3 deploy-time-dynamic placeholders (NLB DNS,
 * VPC Link ID, authorizer function name), the deployed API GW spec is
 * structurally equivalent — but request-time behavior MUST be verified
 * across every domain in the spec, not just academics. A regression in
 * any domain would surface as 5xx (stage var didn't substitute) or 403
 * SigV4 (route disappeared from API GW).
 *
 * 15 checkpoints span every top-level domain in `tenant-api-prod.json`:
 * academics, schools, users, staff, sessions, school-years, finance,
 * iemis, calendar-blocks, archetype-defaults, tenants, and CORS OPTIONS
 * preflight.
 *
 * What counts as PASS / FAIL
 * ==========================
 *   PASS: the response status code falls in the "routing reached the
 *         backend" set: 200, 201, 204, 400, 404, 409. These all indicate
 *         the request flowed: API GW → stage-var-substituted NLB →
 *         service → response.
 *   FAIL: 401 (auth misroute), 403 (route missing in API GW or SigV4
 *         signature), 5xx (NLB proxy failure, stage var unresolved,
 *         backend unreachable). The actual response body shape is NOT
 *         asserted — this is a routing smoke, not a behavioral smoke.
 *
 * Usage
 * =====
 *
 *   export PROD_ADMIN_TOKEN="$(cat /tmp/dev-jwt.txt)"
 *   export TENANT_ID=21aea5da-...      # dev-pabson-primary
 *   export SCHOOL_ID=4209e3d8-...      # any school with academic data
 *   npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/smoke-tests/r41a-cross-domain-routing.ts
 *
 *   # Optional:
 *   export PILOT_ID=dev-pabson-primary
 *   export API_BASE_URL=https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod
 *
 * Env
 * ===
 *   PROD_ADMIN_TOKEN  required — Cognito id-token for TenantAdmin in TENANT_ID
 *   TENANT_ID         required — target tenant UUID
 *   SCHOOL_ID         required — target school UUID (any school in the tenant)
 *   PILOT_ID          optional — pilot identifier (default 'dev-pabson-primary')
 *   API_BASE_URL      optional — prod API GW base
 *
 * Exit codes
 * ==========
 *   0  — all 15 checkpoints green
 *   1  — one or more checkpoints failed (each detailed in stdout)
 *   2  — config error (missing env)
 */

import axios, { AxiosInstance } from 'axios';
import { randomUUID } from 'crypto';

const TOKEN = process.env.PROD_ADMIN_TOKEN ?? '';
const TENANT_ID = process.env.TENANT_ID ?? '';
const SCHOOL_ID = process.env.SCHOOL_ID ?? '';
const PILOT_ID = process.env.PILOT_ID ?? 'dev-pabson-primary';
const BASE_URL =
  process.env.API_BASE_URL ??
  'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';

// Routing-success status set. Any status in this set indicates the
// request reached the backend service. 401/403/5xx mean routing broke.
const ROUTING_OK = new Set([200, 201, 204, 400, 404, 409]);

const fails: string[] = [];
const passes: string[] = [];

function check(name: string, status: number, detail?: string): boolean {
  const ok = ROUTING_OK.has(status);
  if (ok) {
    console.log(`✓ ${name} → ${status}`);
    passes.push(`${name} (${status})`);
  } else {
    console.log(`✗ ${name} → ${status}`);
    if (detail) console.log(`  └─ ${detail.slice(0, 400)}`);
    fails.push(`${name} → ${status}`);
  }
  return ok;
}

function checkCors(name: string, status: number, headers: Record<string, string>): boolean {
  const statusOk = status === 204 || status === 200;
  const hasAllowOrigin = !!headers['access-control-allow-origin'];
  const hasAllowMethods = !!headers['access-control-allow-methods'];
  const ok = statusOk && hasAllowOrigin && hasAllowMethods;
  if (ok) {
    console.log(`✓ ${name} → ${status} + CORS headers present`);
    passes.push(`${name} (${status} + CORS)`);
  } else {
    console.log(
      `✗ ${name} → ${status}; allow-origin=${hasAllowOrigin}; allow-methods=${hasAllowMethods}`,
    );
    fails.push(name);
  }
  return ok;
}

function makeClient(): AxiosInstance {
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'X-Tenant-Id': TENANT_ID,
    },
    timeout: 30_000,
    validateStatus: () => true,
  });
}

async function main() {
  console.log(`R41.A — Cross-domain routing smoke`);
  console.log(`Pilot: ${PILOT_ID}`);
  console.log(`Tenant: ${TENANT_ID || '(MISSING)'}`);
  console.log(`School: ${SCHOOL_ID || '(MISSING)'}`);
  console.log(`API: ${BASE_URL}`);
  console.log('');

  if (!TOKEN || !TENANT_ID || !SCHOOL_ID) {
    console.error(
      '✗ Required env vars missing: PROD_ADMIN_TOKEN, TENANT_ID, SCHOOL_ID',
    );
    process.exit(2);
  }

  const client = makeClient();
  // Random UUID for path-parameterized endpoints — backend should return 404
  // (or 200 if it happens to exist, fine either way; both prove routing).
  const randomId = randomUUID();

  console.log('--- Layer 3: 15 cross-domain routing checkpoints ---');

  // 1. academics (dashboard — non-parameterized GET)
  {
    const r = await client.get(`/academics/dashboard/overview?schoolId=${SCHOOL_ID}`);
    check('1. GET  /academics/dashboard/overview', r.status, JSON.stringify(r.data));
  }

  // 2. academics (result-cards LIST — A.4 endpoint)
  {
    const r = await client.get(`/academics/result-cards?examId=${randomId}`);
    check('2. GET  /academics/result-cards?examId=…', r.status, JSON.stringify(r.data));
  }

  // 3. academics (exam state-machine PATCH — A.3 endpoint; random UUID → 404)
  {
    const r = await client.patch(`/academics/exams/${randomId}/status`, {
      transitionTo: 'closed',
    });
    check('3. PATCH /academics/exams/{examId}/status', r.status, JSON.stringify(r.data));
  }

  // 4. schools / SchoolConfiguration — F-CONFIG-1a path
  {
    const r = await client.get(`/schools/${SCHOOL_ID}/configuration`);
    check('4. GET  /schools/{schoolId}/configuration', r.status, JSON.stringify(r.data));
  }

  // 5. users — auth context
  {
    const r = await client.get(`/users/me`);
    check('5. GET  /users/me', r.status, JSON.stringify(r.data));
  }

  // 6. staff — IEMIS staff path
  {
    const r = await client.get(`/staff/${randomId}`);
    check('6. GET  /staff/{id}', r.status, JSON.stringify(r.data));
  }

  // 7. sessions
  {
    const r = await client.get(`/sessions?schoolId=${SCHOOL_ID}&limit=1`);
    check('7. GET  /sessions', r.status, JSON.stringify(r.data));
  }

  // 8. school-years
  {
    const r = await client.get(`/school-years?schoolId=${SCHOOL_ID}&limit=1`);
    check('8. GET  /school-years', r.status, JSON.stringify(r.data));
  }

  // 9. finance — fee structures
  {
    const r = await client.get(`/finance/fee-structures?schoolId=${SCHOOL_ID}&limit=1`);
    check('9. GET  /finance/fee-structures', r.status, JSON.stringify(r.data));
  }

  // 10. iemis — jobs
  {
    const r = await client.get(`/iemis/jobs?limit=1`);
    check('10. GET /iemis/jobs', r.status, JSON.stringify(r.data));
  }

  // 11. calendar-blocks
  {
    const r = await client.get(`/calendar-blocks?schoolId=${SCHOOL_ID}&limit=1`);
    check('11. GET /calendar-blocks', r.status, JSON.stringify(r.data));
  }

  // 12. archetype-defaults (Sprint 0.4)
  {
    const r = await client.get(`/archetype-defaults?archetype=PABSON`);
    check('12. GET /archetype-defaults?archetype=PABSON', r.status, JSON.stringify(r.data));
  }

  // 13. tenants
  {
    const r = await client.get(`/tenants/${TENANT_ID}`);
    check('13. GET /tenants/{tenantId}', r.status, JSON.stringify(r.data));
  }

  // 14. OPTIONS CORS preflight (academics) — proves CORS mock integration
  // is unaffected by the R41.A stage-var change (OPTIONS doesn't use the
  // dynamic placeholders; pure mock integration).
  {
    const r = await axios.options(`${BASE_URL}/academics/exams`, {
      headers: {
        Origin: 'https://edforge.app',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type,Authorization',
      },
      timeout: 30_000,
      validateStatus: () => true,
    });
    checkCors(
      '14. OPTIONS /academics/exams (CORS preflight)',
      r.status,
      r.headers as Record<string, string>,
    );
  }

  // 15. academics (grading-policies — D.1 endpoint, schoolId-scoped)
  {
    const r = await client.get(
      `/academics/grading-policies?schoolId=${SCHOOL_ID}&limit=1`,
    );
    check('15. GET /academics/grading-policies', r.status, JSON.stringify(r.data));
  }

  // ──────────────────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────────────────
  console.log('');
  console.log(`=== R41.A cross-domain routing smoke results ===`);
  console.log(`Passed: ${passes.length}/15`);
  console.log(`Failed: ${fails.length}/15`);
  if (fails.length > 0) {
    console.log('');
    console.log('Failures:');
    for (const f of fails) console.log(`  ✗ ${f}`);
    console.log('');
    console.log('Likely causes:');
    console.log('  401 → JWT expired or wrong tenant. Refresh /tmp/dev-jwt.txt.');
    console.log('  403 → SigV4 / API GW route missing. Stage var did not substitute.');
    console.log('  5xx → backend unreachable. Check ECS service health + stage var resolution.');
    process.exit(1);
  }

  console.log('');
  console.log('✓ All 15 routing checkpoints reached their backend services.');
  console.log('  R41.A request-time stage variable substitution is healthy.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
