/// <reference types="node" />
/**
 * IEMIS minimal prod smoke — validates the Sprint 1 /iemis/* path end-to-end on
 * prod after the 2026-04-24 deploy. Uses any prod tenant-admin JWT (we use
 * "prodtestadmin" since Saraswati's admin belongs to the real principal).
 *
 * Covers:
 *   P1 — GET /iemis/verify-school-code/12345678 → 200 {valid:true}
 *   P2 — GET /iemis/verify-school-code/abc → 200 {valid:false}
 *   P3 — GET /iemis/verify-school-code/999999999  → 200 {valid:true} (9 digits ok)
 *   P4 — GET /iemis/audit → 200, items[] non-empty, includes our verify events
 *   P5 — GET /iemis/audit with limit=5 → 200, items.length <= 5
 *
 * Not covered here (need Saraswati tenant fixtures):
 *   — cross-tenant 409 on duplicate emisSchoolCode (needs a 2nd prod tenant)
 *   — student descriptor PATCH (needs a real student row with emisStudentId)
 *
 * Usage:
 *   export PROD_ADMIN_TOKEN="eyJ..."
 *   npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/smoke-tests/iemis-prod-smoke-minimal.ts
 *
 * Exit 0 = green; exit 1 = any check failed.
 */

import axios from 'axios';

const TOKEN = process.env.PROD_ADMIN_TOKEN ?? '';
const BASE_URL = 'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';

const fails: string[] = [];
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) {
    console.log(`  └─ ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    fails.push(name);
  }
}

async function call(method: 'GET' | 'PATCH', path: string, body?: any) {
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
  if (!TOKEN) {
    console.error('✗ PROD_ADMIN_TOKEN env var empty');
    process.exit(2);
  }

  console.log(`IEMIS prod minimal smoke @ ${BASE_URL}\n`);

  // P1 — valid 8-digit code
  const p1 = await call('GET', '/iemis/verify-school-code/12345678');
  check('P1 — verify-school-code valid 8-digit returns 200 + {valid:true}',
    p1.status === 200 && p1.body?.valid === true && p1.body?.code === '12345678',
    p1);

  // P2 — invalid format (short + non-numeric)
  const p2 = await call('GET', '/iemis/verify-school-code/abc');
  check('P2 — verify-school-code malformed returns 200 + {valid:false}',
    p2.status === 200 && p2.body?.valid === false,
    p2);

  // P3 — valid 9-digit code (same as Saraswati's)
  const p3 = await call('GET', '/iemis/verify-school-code/170840012');
  check('P3 — verify-school-code valid 9-digit returns 200 + {valid:true}',
    p3.status === 200 && p3.body?.valid === true && p3.body?.code === '170840012',
    p3);

  // Wait a beat for audit emit to land.
  await new Promise((r) => setTimeout(r, 2000));

  // P4 — audit list returns events
  const p4 = await call('GET', '/iemis/audit');
  const items = Array.isArray(p4.body?.items) ? p4.body.items : [];
  check('P4 — /iemis/audit returns 200 with non-empty items[]',
    p4.status === 200 && items.length >= 3,
    { status: p4.status, itemCount: items.length, firstEvent: items[0]?.eventType });

  // P5 — audit with limit
  const p5 = await call('GET', '/iemis/audit?limit=2');
  const itemsLimited = Array.isArray(p5.body?.items) ? p5.body.items : [];
  check('P5 — /iemis/audit?limit=2 returns <=2 items',
    p5.status === 200 && itemsLimited.length <= 2,
    { status: p5.status, itemCount: itemsLimited.length });

  console.log(`\n${fails.length === 0 ? '✓ ALL PROD SMOKE CHECKS GREEN' : `✗ ${fails.length} FAILURES`}`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('crash:', e?.message ?? e);
  process.exit(2);
});
