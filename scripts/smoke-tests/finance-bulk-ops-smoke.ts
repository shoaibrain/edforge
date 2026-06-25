/**
 * Finance Bulk-Operations Smoke Test — Sprint 0.4 Scaffolding
 *
 * Lives alongside the existing finance smokes (`finance-billing-flow.ts`,
 * `finance-currency-from-tenant-settings.ts`, …) and exercises the new
 * bulk-ops endpoints end-to-end against a live backend.
 *
 * Case inventory (from the locked Sprint plan, plan §0.4):
 *
 *   [ A ] sync-generate (≤25 students) — Sprint C.4 ships the impl
 *   [ B ] async-generate (≥26 students) — Sprint E.3 ships the impl
 *   [ C ] ZIP export — Sprint F.4 ships the impl
 *   [ D ] merged-PDF export — Sprint H.3 ships the impl
 *   [ E ] GET /finance/jobs/:jobId — Sprint D.3 ships the impl
 *   [ F ] 413 boundary at 26 students — Sprint C.4 ships the impl
 *   [ G ] 404-not-403 on cross-school job access — Sprint D.3 contract
 *   [ H ] idempotent submission replay — Sprint 0.2 + C.4 wired
 *   [ I ] GET /finance/audit/bulk-export — Sprint 0.3 shipped (live now)
 *
 * Cases A–H land their bodies as their respective sprints close. Each
 * future PR removes one `SKIP` marker and fills the corresponding fn.
 * Case I runs today against the FinanceAuditController endpoint that
 * just landed and is the smoke harness's "is everything wired" canary.
 *
 * Usage:
 *   TENANT_ADMIN_TOKEN=<jwt> SCHOOL_ID=<uuid> npx ts-node \
 *     scripts/smoke-tests/finance-bulk-ops-smoke.ts
 *
 * Optional env overrides:
 *   API_BASE_URL          — defaults to prod gateway
 *   FINANCE_SMOKE_FOCUS   — substring of a case label to run only that
 *
 * Exit code: 0 if every non-skipped case passes; 1 otherwise. Skipped
 * cases are reported but don't fail the harness.
 */

import axios from 'axios';

// ─────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────

const BASE_URL =
  process.env.API_BASE_URL ||
  'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';
const TOKEN = process.env.TENANT_ADMIN_TOKEN || '';
const SCHOOL_ID = process.env.SCHOOL_ID || '';
const FOCUS = (process.env.FINANCE_SMOKE_FOCUS || '').toLowerCase();

if (!TOKEN) {
  console.error('\x1b[31mERROR\x1b[0m: TENANT_ADMIN_TOKEN is required.');
  process.exit(1);
}

function extractTenantId(token: string): string {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64').toString(),
    );
    return payload['custom:tenantId'] || '';
  } catch {
    return '';
  }
}

const TENANT_ID = extractTenantId(TOKEN);
if (!TENANT_ID) {
  console.error(
    '\x1b[31mERROR\x1b[0m: TENANT_ADMIN_TOKEN appears malformed (no custom:tenantId).',
  );
  process.exit(1);
}

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'x-tenant-id': TENANT_ID,
    'Content-Type': 'application/json',
  },
  timeout: 15_000,
  validateStatus: () => true,
});

// ─────────────────────────────────────────
// HARNESS
// ─────────────────────────────────────────

type CaseStatus = 'PASS' | 'FAIL' | 'SKIP';

interface CaseResult {
  label: string;
  status: CaseStatus;
  durationMs: number;
  detail?: string;
}

const results: CaseResult[] = [];

async function run(
  label: string,
  fn: () => Promise<{ status: CaseStatus; detail?: string }>,
): Promise<void> {
  if (FOCUS && !label.toLowerCase().includes(FOCUS)) return;

  const start = Date.now();
  process.stdout.write(`  • ${label} `);
  try {
    const { status, detail } = await fn();
    const durationMs = Date.now() - start;
    results.push({ label, status, durationMs, detail });
    const color =
      status === 'PASS' ? '\x1b[32m' : status === 'FAIL' ? '\x1b[31m' : '\x1b[33m';
    console.log(
      `${color}${status}\x1b[0m (${durationMs}ms)${detail ? ` — ${detail}` : ''}`,
    );
  } catch (err) {
    const durationMs = Date.now() - start;
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ label, status: 'FAIL', durationMs, detail });
    console.log(`\x1b[31mFAIL\x1b[0m (${durationMs}ms) — ${detail}`);
  }
}

const skip = (sprint: string) => async () => ({
  status: 'SKIP' as const,
  detail: `awaiting Sprint ${sprint} endpoint`,
});

// ─────────────────────────────────────────
// CASES
// ─────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n📋 Finance Bulk-Operations Smoke Test');
  console.log(`  BASE_URL  = ${BASE_URL}`);
  console.log(`  TENANT_ID = ${TENANT_ID}`);
  console.log(`  SCHOOL_ID = ${SCHOOL_ID || '(none — some cases will skip)'}`);
  if (FOCUS) console.log(`  FOCUS     = ${FOCUS}`);
  console.log('');

  await run('A. sync-generate (≤25 students)', skip('C.4'));
  await run('B. async-generate (≥26 students)', skip('E.3'));
  await run('C. ZIP export', skip('F.4'));
  await run('D. merged-PDF export', skip('H.3'));
  await run('E. GET /finance/jobs/:jobId', skip('D.3'));
  await run('F. 413 boundary at 26 students', skip('C.4'));
  await run('G. cross-school job access → 404 (not 403)', skip('D.3'));
  await run('H. idempotent submission replay', skip('C.4 + 0.2 wired'));

  // ─── Case I — live (Sprint 0.3) ──────────────────────────────────
  await run('I. GET /finance/audit/bulk-export — list audit events', async () => {
    const res = await api.get('/finance/audit/bulk-export', {
      params: { limit: 5 },
    });
    if (res.status !== 200) {
      return {
        status: 'FAIL',
        detail: `expected 200, got ${res.status}: ${JSON.stringify(res.data).slice(0, 120)}`,
      };
    }
    const body = res.data;
    if (!body || typeof body.hasMore !== 'boolean' || !Array.isArray(body.items)) {
      return {
        status: 'FAIL',
        detail: `response shape mismatch — expected {items[], hasMore} got ${JSON.stringify(body).slice(0, 120)}`,
      };
    }
    return {
      status: 'PASS',
      detail: `items=${body.items.length}, hasMore=${body.hasMore}`,
    };
  });

  // ─── SUMMARY ─────────────────────────────────────────────────────
  console.log('\n📊 Summary');
  const counts = results.reduce(
    (acc, r) => {
      acc[r.status]++;
      return acc;
    },
    { PASS: 0, FAIL: 0, SKIP: 0 },
  );
  console.log(
    `  \x1b[32m${counts.PASS} pass\x1b[0m  \x1b[31m${counts.FAIL} fail\x1b[0m  \x1b[33m${counts.SKIP} skip\x1b[0m  (of ${results.length} total)`,
  );

  if (counts.FAIL > 0) {
    console.log('\n❌ FAILED cases:');
    for (const r of results.filter((x) => x.status === 'FAIL')) {
      console.log(`  - ${r.label}: ${r.detail}`);
    }
    process.exit(1);
  }
  console.log('\n✅ All non-skipped cases passed.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n💥 Smoke harness crashed:', err);
  process.exit(1);
});
