/// <reference types="node" />
/**
 * Sprint C2.0 — Pilot write-path smoke (skeleton).
 *
 * The foundation script for Sprint C2's greenlight gate. Establishes the
 * fixture↔backend loop:
 *
 *   1. Load the pilot fixture via `@edforge/pilot-fixtures` (workspace symlink)
 *   2. Read the operator JWT from /private/tmp/c0-c-3-prod-jwt.txt
 *   3. POST one staff training against the deployed tenant
 *   4. Assert: 2xx response + trainingId returned
 *   5. Wait briefly for audit write propagation (audit is best-effort post
 *      the primary write — typically a few hundred ms)
 *   6. Query DDB directly for an audit row referencing the trainingId
 *   7. Assert: audit row exists with action=create and targetEntity=staff_training
 *   8. Cleanup: DELETE the training
 *   9. Exit 0 on success, exit 1 on any failure
 *
 * This skeleton does ONE write. The full C2.0 plan (50 students bulk-import
 * + enrollment + period attendance) lands in PR #9 (the harness consolidation)
 * once the read-path tests (C2.1–C2.5) have validated the underlying behavior.
 *
 * Event-emission verification (per the C2.0 plan literal "event-log count =
 * write count") is DEFERRED to Sprint C8.4 which introduces the read-side
 * event-log entity. Today we can only assert audit-row presence — the event
 * publishes through EventServiceBase but isn't queryable post-emit yet.
 *
 * Parametric: accepts PILOT_ID env var; defaults to pabson-saraswati-bs-2083.
 * Adding pilot 2 = drop fixture + set PILOT_ID and the same script runs.
 *
 * Pilot-agnostic per invariant 13: no pilot-specific names in this script;
 * the pilot id is a runtime argument.
 *
 * Run
 * ===
 *   # Operator places fresh prod JWT at /private/tmp/c0-c-3-prod-jwt.txt
 *   export PILOT_ID=pabson-saraswati-bs-2083                # optional override
 *   export TENANT_ID=<dev tenant uuid>                       # required
 *   export STAFF_ID=<existing staff in tenant>               # required
 *   export SCHOOL_ID=<existing school in tenant>             # required
 *   AWS_PROFILE=prod npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/smoke-tests/pilot-write-path.ts
 */

import * as fs from 'fs';
import axios from 'axios';
import {
  DynamoDBClient,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';

import { loadPilotFixture } from '@edforge/pilot-fixtures';

// ── config ─────────────────────────────────────────────────────────────────

const PILOT_ID = process.env.PILOT_ID ?? 'pabson-saraswati-bs-2083';
const JWT_FILE = process.env.JWT_FILE ?? '/private/tmp/c0-c-3-prod-jwt.txt';

const RAW_TOKEN = fs.existsSync(JWT_FILE)
  ? fs.readFileSync(JWT_FILE, 'utf8').replace(/[\n\r ]+/g, '')
  : '';
const TOKEN = RAW_TOKEN.startsWith('Bearer ') ? RAW_TOKEN : `Bearer ${RAW_TOKEN}`;

const BASE =
  process.env.API_BASE ??
  'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';
const TENANT_ID = process.env.TENANT_ID ?? '';
const STAFF_ID = process.env.STAFF_ID ?? '';
const SCHOOL_ID = process.env.SCHOOL_ID ?? '';
const TABLE = process.env.IDENTITY_TABLE ?? 'edforge-identity-basic';
const REGION = process.env.AWS_REGION ?? 'ap-south-1';
const AUDIT_PROPAGATION_DELAY_MS = Number(process.env.AUDIT_DELAY_MS ?? 1500);

// ── env validation ─────────────────────────────────────────────────────────

const required = {
  ADMIN_TOKEN: RAW_TOKEN,
  TENANT_ID,
  STAFF_ID,
  SCHOOL_ID,
};
for (const [k, v] of Object.entries(required)) {
  if (!v) {
    console.error(`Missing required: ${k}`);
    if (k === 'ADMIN_TOKEN') {
      console.error(
        `  — JWT file not found or empty at ${JWT_FILE}. ` +
          `Operator: place a fresh prod TenantAdmin JWT there.`,
      );
    }
    process.exit(2);
  }
}

const ddb = new DynamoDBClient({ region: REGION });

// ── helpers ────────────────────────────────────────────────────────────────

const fails: string[] = [];
function check(name: string, ok: boolean, detail?: unknown): boolean {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) {
    const d = typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2);
    console.log(`  └─ ${d}`);
    fails.push(name);
  }
  return ok;
}

async function http(
  method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const r = await axios({
    method,
    url: `${BASE}${path}`,
    headers: { Authorization: TOKEN, 'Content-Type': 'application/json' },
    data: body,
    validateStatus: () => true,
    timeout: 30_000,
  });
  return { status: r.status, body: r.data };
}

/**
 * Find a recent IEMIS audit row that references our trainingId.
 *
 * The identity service uses TWO audit mechanisms:
 *   1. `AuditedWriteService` — general audit, entityKey shape
 *      `SCHOOL#<schoolId>#AUDIT#<ts>#<auditId>`. Used by schools,
 *      academic-years, calendar-dates.
 *   2. `IemisAuditLogger` — IEMIS-scoped audit, entityKey shape
 *      `AUDIT#IEMIS#<ts>#<eventId>`. Used by staff trainings,
 *      credentials, leave, and other IEMIS reportable operations.
 *
 * Staff trainings audit via path #2 (the IEMIS logger). The trainingId
 * lives in `metadata.trainingId`, not as a top-level attribute, so we
 * scan recent IEMIS audit rows + filter client-side on
 * `metadata.M.trainingId.S`.
 *
 * `targetEntity` mapping is per-write-type. The skeleton supports
 * `staff.training.created` events; future C2 PRs may extend this to
 * other event types via a `expectedEventType` parameter.
 */
async function findRecentIemisAuditRows(
  trainingId: string,
): Promise<Record<string, any>[]> {
  const skPrefix = `AUDIT#IEMIS#`;
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'tenantId = :tid AND begins_with(entityKey, :sk)',
      ExpressionAttributeValues: {
        ':tid': { S: TENANT_ID },
        ':sk': { S: skPrefix },
      },
      // entityKey sorts lex; ISO-8601 timestamps in the key sort
      // chronologically. Reverse for most-recent-first.
      ScanIndexForward: false,
      Limit: 50,
    }),
  );

  // Filter client-side: row's metadata.trainingId must match ours.
  return (res.Items ?? []).filter(
    (it) => it.metadata?.M?.trainingId?.S === trainingId,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('');
  console.log(`Sprint C2.0 — Pilot write-path smoke (skeleton)`);
  console.log(`  pilot:    ${PILOT_ID}`);
  console.log(`  base:     ${BASE}`);
  console.log(`  tenant:   ${TENANT_ID}`);
  console.log(`  school:   ${SCHOOL_ID}`);
  console.log(`  staff:    ${STAFF_ID}`);
  console.log('');

  // ── 1. Load fixture
  console.log('── 1. Load fixture ────────────────────────');
  const fixture = loadPilotFixture(PILOT_ID);
  check('Fixture loaded', !!fixture.metadata, fixture.metadata?.pilotId);
  check(
    `Fixture pilotId matches PILOT_ID env (${PILOT_ID})`,
    fixture.metadata.pilotId === PILOT_ID,
  );
  check(
    `Fixture has 12 calendar months`,
    Object.keys(fixture.calendar).length === 12,
  );
  check(
    `Fixture has bell-schedule shifts`,
    fixture.bellSchedule.shifts.length > 0,
  );
  check(
    `Fixture has academic-structure terms`,
    fixture.academicStructure.terms.length > 0,
  );

  // ── 2. POST a minimal staff training (one write, one audit, one event)
  console.log('');
  console.log('── 2. POST staff training ─────────────────');
  const trainingPayload = {
    trainingType: 'pedagogical',
    title: `C2.0-smoke ${new Date().toISOString()}`,
    description: 'C2.0 write-path smoke — autogenerated; will be deleted.',
    startDate: '2026-05-16',
    endDate: '2026-05-16',
    hours: 1,
  };
  const post = await http(
    'POST',
    `/staff/${STAFF_ID}/trainings`,
    trainingPayload,
  );
  check(`POST /staff/.../trainings → 2xx`, post.status >= 200 && post.status < 300, {
    status: post.status,
    body: post.body,
  });
  const trainingId = post.body?.trainingId;
  check(`Response carries trainingId`, !!trainingId, post.body);

  if (!trainingId) {
    console.log('');
    console.log('FATAL: cannot proceed without trainingId.');
    process.exit(1);
  }

  // ── 3. Wait for audit row propagation (audit is best-effort post-write)
  console.log('');
  console.log(`── 3. Wait ${AUDIT_PROPAGATION_DELAY_MS}ms for audit row to land ─────`);
  await sleep(AUDIT_PROPAGATION_DELAY_MS);

  // ── 4. Query DDB for the IEMIS audit row(s)
  console.log('');
  console.log('── 4. IEMIS audit row verification ────────');
  const auditRows = await findRecentIemisAuditRows(trainingId);
  check(
    `At least one IEMIS audit row references trainingId=${trainingId}`,
    auditRows.length >= 1,
    `found ${auditRows.length} rows`,
  );

  // Spot-check the first audit row's shape.
  if (auditRows.length > 0) {
    const a = auditRows[0];
    check(
      `audit row eventType=staff.training.created`,
      a.eventType?.S === 'staff.training.created',
      a.eventType,
    );
    check(
      `audit row entityKey starts with AUDIT#IEMIS#`,
      typeof a.entityKey?.S === 'string' &&
        a.entityKey.S.startsWith('AUDIT#IEMIS#'),
      a.entityKey,
    );
    check(
      `audit row metadata.staffId matches`,
      a.metadata?.M?.staffId?.S === STAFF_ID,
      a.metadata?.M?.staffId,
    );
  }

  // ── 5. Event-emission verification — DEFERRED
  console.log('');
  console.log('── 5. Event-emission verification ─────────');
  console.log(
    '  ⊘ DEFERRED to Sprint C8.4 (event-log entity). Today the event ' +
      'publishes through EventServiceBase but is not queryable post-emit.',
  );
  console.log(
    '  ⊘ Indirect evidence: audit row above presumes the same code path ' +
      'that triggers event emission also wrote the audit, per invariant 5+6.',
  );

  // ── 6. Cleanup
  console.log('');
  console.log('── 6. Cleanup ─────────────────────────────');
  const del = await http('DELETE', `/staff/${STAFF_ID}/trainings/${trainingId}`);
  check(
    `DELETE /staff/.../trainings/${trainingId} → 2xx`,
    del.status >= 200 && del.status < 300,
    { status: del.status, body: del.body },
  );

  // ── Summary
  console.log('');
  console.log('═══ SUMMARY ═══');
  if (fails.length === 0) {
    console.log('✓ All checks passed.');
    console.log(`(audit count = 1 write; event-log verification deferred to C8.4)`);
    process.exit(0);
  } else {
    console.log(`✗ ${fails.length} check(s) failed:`);
    for (const f of fails) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FATAL:', err?.stack ?? err);
  process.exit(1);
});
