/// <reference types="node" />
/**
 * Sprint A — region-aware address round-trip smoke
 *
 * Verifies the 4 Nepal-aware extension fields (wardNumber, municipality,
 * district, province) added in Sprint A.1/A.2 to addressSchema and
 * staffAddressSchema actually round-trip end-to-end through the deployed
 * backend stack:
 *
 *   POST   /staff               (create with Nepal address)
 *   GET    /staff/:id           (verify all 4 fields persisted)
 *   PATCH  /staff/:id           (update wardNumber only)
 *   GET    /staff/:id           (verify ward updated, other 3 fields stable)
 *   PATCH  /staff/:id           (replace addresses with second Nepal entry)
 *   GET    /staff/:id           (verify second entry round-trips)
 *   DELETE /staff/:id           (cleanup)
 *
 * This is the regression guard for the 2026-04-28 incident: prior UAT
 * deploy was missing Sprint A schema additions, so Zod silently stripped
 * Nepal fields on input → DDB rows had US-shape only → response missing
 * fields → silent data loss. Running this smoke post-deploy catches a
 * recurrence immediately.
 *
 * Coverage scope: Staff only. Student create-path is more complex (often
 * goes through /academics/enrollment with nested guardian addresses + an
 * RHF wizard); a follow-up smoke can extend to /academics/students if
 * needed. The schema patterns are identical (both use the legacy
 * `addressSchema` + Nepal extension) so verifying staff is sufficient
 * to prove the deployed schema parsing accepts the 4 fields.
 *
 * Usage:
 *   export ADMIN_TOKEN="<JWT>"
 *   export SCHOOL_ID="<existing school uuid on the JWT tenant>"
 *   export API_BASE="https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod"  # UAT
 *   #  or   https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod          # prod
 *   npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/smoke-tests/sprintA-region-aware-address-smoke.ts
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

const ok2xx = (s: number) => s >= 200 && s < 300;

// Two distinct Nepal address shapes — exercises Province/District integrity
// across the canonical post-2017 federalism splits (Bagmati P3 + Madhesh P2).
interface NepalAddress {
  addressTypeDescriptor: 'home' | 'mailing' | 'work' | 'temporary';
  streetNumberName: string;
  city: string;
  stateAbbreviationDescriptor: string;
  postalCode: string;
  country: string;
  wardNumber: string;
  municipality: string;
  district: string;
  province: string;
}

const NEPAL_ADDR_1: NepalAddress = {
  addressTypeDescriptor: 'home',
  streetNumberName: 'Tole-12, Bishal Bazar',
  city: '',
  stateAbbreviationDescriptor: '',
  postalCode: '44600',
  country: 'NPL',
  wardNumber: '12',
  municipality: 'Kathmandu Metropolitan City',
  district: 'Kathmandu',
  province: 'Bagmati',
};

const NEPAL_ADDR_2: NepalAddress = {
  addressTypeDescriptor: 'mailing',
  streetNumberName: 'Tole-7, Janakpur',
  city: '',
  stateAbbreviationDescriptor: '',
  postalCode: '45600',
  country: 'NPL',
  wardNumber: '7',
  municipality: 'Janakpurdham Sub-Metropolitan City',
  district: 'Dhanusha',
  province: 'Madhesh',
};

const NEPAL_FIELDS = ['wardNumber', 'municipality', 'district', 'province'] as const;

function assertNepalFieldsPreserved(label: string, addr: Record<string, unknown>, expected: NepalAddress) {
  for (const f of NEPAL_FIELDS) {
    check(
      `${label} — addresses[].${f} preserved`,
      addr?.[f] === expected[f],
      { expected: expected[f], got: addr?.[f] },
    );
  }
}

async function main(): Promise<void> {
  console.log('Sprint A — region-aware address round-trip smoke');
  console.log(`  base:     ${BASE}`);
  console.log(`  region:   ${BASE.includes('ap-south-1') ? 'PROD (ap-south-1)' : BASE.includes('us-east-2') ? 'UAT (us-east-2)' : 'unknown'}`);
  console.log(`  schoolId: ${SCHOOL_ID || '(MISSING — set SCHOOL_ID)'}`);

  if (!TOKEN || !SCHOOL_ID) {
    console.error('✗ ADMIN_TOKEN and SCHOOL_ID env vars are required.');
    process.exit(1);
  }

  // ── Provision temp staff with Nepal address ──────────────────────────────
  console.log('\n— POST /staff with Nepal-shaped address —');
  const uniqueSuffix = `${Date.now()}`.slice(-6);
  const createBody = {
    staffUniqueId: `SMOKE-A-${uniqueSuffix}`,
    firstName: 'SmokeA',
    lastSurname: `Region${uniqueSuffix}`,
    birthDate: '1990-01-01',
    gender: 'male' as const,
    primarySchoolId: SCHOOL_ID,
    role: 'teacher' as const,
    employmentType: 'full_time' as const,
    hireDate: '2026-04-28',
    email: `smoke-a-${uniqueSuffix}@example.test`,
    phone: '9812345678',
    addresses: [NEPAL_ADDR_1],
  };
  const created = await call('POST', '/staff', createBody);
  check('POST /staff — 2xx', ok2xx(created.status), { status: created.status, body: created.body });
  const staffId = created.body?.staffId;
  check('POST /staff — returned staffId', !!staffId, created.body);
  if (!staffId) {
    console.error('✗ no staffId returned, aborting');
    process.exit(1);
  }
  console.log(`  ✓ created temp staff ${staffId}`);

  // POST response should already include the 4 Nepal fields on addresses[0]
  const createdAddr = (created.body?.addresses ?? [])[0] ?? {};
  assertNepalFieldsPreserved('POST response', createdAddr, NEPAL_ADDR_1);

  try {
    // ── GET /staff/:id — confirm DDB persisted Nepal fields ───────────────
    console.log('\n— GET /staff/:id — verify DDB persistence —');
    const got = await call('GET', `/staff/${staffId}`);
    check('GET /staff/:id — 200', got.status === 200, { status: got.status });
    const gotAddr = (got.body?.addresses ?? [])[0] ?? {};
    assertNepalFieldsPreserved('GET response', gotAddr, NEPAL_ADDR_1);

    // ── PATCH wardNumber only (full-replace addresses array semantics) ────
    // Backend's updateStaff replaces the entire addresses array per
    // `updates.push('addresses = :addresses')`, so we send the full updated
    // address with only wardNumber differing.
    console.log('\n— PATCH /staff/:id — update wardNumber —');
    const updated_ward = '15';
    const patchBody = {
      addresses: [{ ...NEPAL_ADDR_1, wardNumber: updated_ward }],
    };
    const patched = await call('PATCH', `/staff/${staffId}`, patchBody);
    check('PATCH /staff/:id — 2xx', ok2xx(patched.status), { status: patched.status, body: patched.body });
    const patchedAddr = (patched.body?.addresses ?? [])[0] ?? {};
    check(
      'PATCH response — wardNumber updated',
      patchedAddr.wardNumber === updated_ward,
      { expected: updated_ward, got: patchedAddr.wardNumber },
    );
    // Other 3 Nepal fields should stay stable
    for (const f of ['municipality', 'district', 'province'] as const) {
      check(
        `PATCH response — ${f} stable`,
        patchedAddr[f] === NEPAL_ADDR_1[f],
        { expected: NEPAL_ADDR_1[f], got: patchedAddr[f] },
      );
    }

    // GET to confirm DDB has the patched ward
    const got2 = await call('GET', `/staff/${staffId}`);
    check('GET /staff/:id (post-PATCH) — 200', got2.status === 200);
    const got2Addr = (got2.body?.addresses ?? [])[0] ?? {};
    check(
      'GET (post-PATCH) — wardNumber persisted',
      got2Addr.wardNumber === updated_ward,
      { expected: updated_ward, got: got2Addr.wardNumber },
    );

    // ── Replace addresses with a different Nepal entry (Madhesh province) ─
    console.log('\n— PATCH /staff/:id — replace with Madhesh-shaped address —');
    const replaced = await call('PATCH', `/staff/${staffId}`, { addresses: [NEPAL_ADDR_2] });
    check('PATCH /staff/:id (replace) — 2xx', ok2xx(replaced.status), { status: replaced.status });
    const replacedAddr = (replaced.body?.addresses ?? [])[0] ?? {};
    assertNepalFieldsPreserved('PATCH (replace) response', replacedAddr, NEPAL_ADDR_2);

    const got3 = await call('GET', `/staff/${staffId}`);
    const got3Addr = (got3.body?.addresses ?? [])[0] ?? {};
    assertNepalFieldsPreserved('GET (post-replace)', got3Addr, NEPAL_ADDR_2);
  } finally {
    // ── Cleanup ──
    console.log('\n— Cleanup —');
    const del = await call('DELETE', `/staff/${staffId}`);
    if (ok2xx(del.status)) {
      console.log(`  ✓ deleted temp staff ${staffId}`);
    } else {
      console.log(`  ! could not delete temp staff ${staffId} (status ${del.status}) — manual cleanup may be needed`);
    }
  }

  console.log(`\n${fails.length === 0 ? '✓ ALL SPRINT-A REGION-AWARE SMOKE CHECKS GREEN' : `✗ ${fails.length} FAILURES`}`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error('crash:', e?.message ?? e); process.exit(2); });
