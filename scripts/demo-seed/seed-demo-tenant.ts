/// <reference types="node" />
/**
 * Demo tenant seeder CLI — Sprint S1.11.
 *
 * Wires the deterministic demo data engine (@edforge/pilot-fixtures) to a
 * provisioned tenant: builds the full DemoTenantData bundle for an archetype
 * and POSTs it through the tenant API with an operator JWT, or (--reset)
 * re-baselines a demo tenant. Models the existing seed-script pattern
 * (JWT-from-file, axios, validateStatus, dry-run default-able).
 *
 * Run:
 *   export ARCHETYPE=PABSON                 # or GENERIC
 *   export API_BASE=https://<api-id>.execute-api.<region>.amazonaws.com/prod
 *   export JWT_FILE=/tmp/demo-tenant-admin-jwt.txt
 *
 *   # Inspect the plan (no JWT / network needed):
 *   ./scripts/demo-seed/seed-demo-tenant.sh --dry-run
 *
 *   # Seed:
 *   ./scripts/demo-seed/seed-demo-tenant.sh
 *
 *   # Re-baseline a demo tenant (deletes only demo-marked rows):
 *   ./scripts/demo-seed/seed-demo-tenant.sh --reset --confirm-demo
 *
 * Idempotent: a re-run creates nothing already present.
 */

import * as fs from 'fs';

import {
  DEMO_ARCHETYPES,
  DemoReset,
  DemoSeeder,
  buildDemoTenant,
  standardResetTargets,
  type ApiClient,
  type DemoArchetype,
  type DemoTenantData,
  type HttpMethod,
} from '@edforge/pilot-fixtures';

// ── args / env ──────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const has = (flag: string): boolean => argv.includes(flag) || process.env[flag.replace(/^--/, '').toUpperCase().replace(/-/g, '_')] === 'true';

const ARCHETYPE = (process.env.ARCHETYPE ?? '').toUpperCase();
const SEED = process.env.SEED ?? 'demo';
const API_BASE = process.env.API_BASE ?? '';
const JWT_FILE = process.env.JWT_FILE ?? '/tmp/demo-tenant-admin-jwt.txt';
const DRY_RUN = has('--dry-run');
const RESET = has('--reset');
const CONFIRM_DEMO = has('--confirm-demo');
const NO_MEMBERSHIP = has('--no-membership');
const NO_SCORES = has('--no-scores');

function fail(msg: string, code = 2): never {
  console.error(`✗ ${msg}`);
  process.exit(code);
}

if (!DEMO_ARCHETYPES.includes(ARCHETYPE as DemoArchetype)) {
  fail(`ARCHETYPE must be one of ${DEMO_ARCHETYPES.join(' | ')} (got '${ARCHETYPE || '<unset>'}')`);
}
const archetype = ARCHETYPE as DemoArchetype;

// ── plan summary (dry-run) ──────────────────────────────────────────────────

function bundleCounts(data: DemoTenantData): Record<string, number> {
  return {
    school: 1,
    academicYear: 1,
    terms: data.academicYear.terms.length,
    sections: data.sections.length,
    staff: data.staff.length,
    courses: data.courses.length,
    courseSections: data.courseSections.length,
    students: data.students.length,
    exam: 1,
    marks: data.marks.length,
    resultCards: data.resultCards.length,
    feeStructures: data.feeStructures.length,
    invoices: data.invoices.length,
    payments: data.payments.length,
  };
}

function printHeader(): void {
  console.log('');
  console.log('Demo tenant seeder');
  console.log(`  archetype: ${archetype}`);
  console.log(`  seed:      ${SEED}`);
  console.log(`  api:       ${API_BASE || '(unset)'}`);
  console.log(`  mode:      ${RESET ? 'reset' : 'seed'}${DRY_RUN ? ' (dry-run)' : ''}`);
  console.log('');
}

// ── real client (axios, lazy-imported so dry-run needs no axios/JWT) ─────────

async function makeAxiosClient(): Promise<ApiClient> {
  if (!API_BASE) fail('API_BASE is required for a live run');
  const raw = fs.existsSync(JWT_FILE) ? fs.readFileSync(JWT_FILE, 'utf8').replace(/[\n\r ]+/g, '') : '';
  if (!raw) fail(`JWT not found/empty at ${JWT_FILE} — place a fresh demo-tenant-admin JWT there`);
  const token = raw.startsWith('Bearer ') ? raw : `Bearer ${raw}`;
  // Non-literal specifier: keeps dry-run free of an axios type/runtime
  // dependency (axios is only needed on the live path).
  const specifier = 'axios';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import(specifier);
  const axios = mod.default ?? mod;
  return {
    request: async <T = unknown>(method: HttpMethod, path: string, body?: unknown) => {
      const r = await axios({
        method,
        url: `${API_BASE}${path}`,
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        data: body,
        validateStatus: () => true,
        timeout: 30_000,
      });
      return { status: r.status, body: r.data as T };
    },
  };
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  printHeader();
  const data = buildDemoTenant(archetype, SEED);

  if (DRY_RUN) {
    const label = RESET ? 'Would reset demo-marked rows for' : 'Would create';
    console.log(`── plan — ${label} ${archetype} ──`);
    for (const [k, v] of Object.entries(bundleCounts(data))) {
      console.log(`   ${k.padEnd(16)} ${v}`);
    }
    console.log('');
    console.log('(dry-run — no HTTP requests made)');
    return;
  }

  const client = await makeAxiosClient();

  if (RESET) {
    if (!CONFIRM_DEMO) fail('--reset requires --confirm-demo (refusing to delete from a non-demo tenant)');
    const summary = await new DemoReset(client, { confirmDemo: true }).reset(standardResetTargets());
    console.log('✓ reset complete:', JSON.stringify(summary));
    return;
  }

  const summary = await new DemoSeeder(client, {
    courseSectionMembership: !NO_MEMBERSHIP,
    recordScoresAndPublish: !NO_SCORES,
  }).seed(data);
  console.log('✓ seed complete:');
  console.log('   created:', JSON.stringify(summary.created));
  console.log('   skipped:', JSON.stringify(summary.skipped));
}

main().catch((err) => {
  console.error('FATAL:', err?.stack ?? err);
  process.exit(1);
});
