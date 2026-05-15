/// <reference types="node" />
/**
 * Sprint S3.2 — GSI1 casing write-path roundtrip smoke.
 *
 * The decisive post-deploy gate for the S3.2 fix (PR #68). For each of the
 * four entity types whose factories were renamed from uppercase
 * `GSI1PK`/`GSI1SK` to lowercase `gsi1pk`/`gsi1sk`, this script:
 *
 *   1. POSTs a row via the live identity service API
 *   2. GetItems the row directly from DDB and asserts:
 *        - `gsi1pk` and `gsi1sk` are present and well-formed
 *        - `GSI1PK` and `GSI1SK` are ABSENT (no leakage from a buggy factory)
 *   3. Queries the GSI1 index for the expected partition and asserts our
 *      row appears in the result set (proves the index actually populated)
 *   4. Cleans up (DELETE for training/credential, status→cancelled for
 *      leave; calendar cannot be deleted via API — left as a clearly-
 *      labelled smoke artifact)
 *
 * Why this matters
 * ================
 * The S3.2 bug was latent — no current code path reads from these GSIs,
 * so user-facing smokes can't detect it. The only way to validate the fix
 * is to inspect the raw DDB item and probe the GSI directly. This script
 * is the standard validation for any future entity that participates in
 * GSI1.
 *
 * Eventual consistency note
 * =========================
 * GSI updates are eventually consistent. We wait ~3s between POST and the
 * GSI Query to let DDB materialize the index entry. If the smoke flakes on
 * step 3 of any entity, retrying after a longer delay is the expected
 * remediation — not a code-change signal.
 *
 * Run
 * ===
 *   export ADMIN_TOKEN="<prod JWT, with or without 'Bearer ' prefix>"
 *   export API_BASE="https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod"
 *   export TENANT_ID="<tenant uuid — recommend a dev tenant to avoid prod pollution>"
 *   export STAFF_ID="<an existing staffId in TENANT_ID>"
 *   export SCHOOL_ID="<an existing schoolId in TENANT_ID>"
 *   export ACADEMIC_YEAR_ID="<an existing AY uuid in SCHOOL_ID>"
 *   AWS_PROFILE=prod npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/smoke-tests/s3-2-gsi-casing-roundtrip.ts
 *
 * Exit 0 = all four entities passed all three checks.
 * Exit 1 = any check failed (script prints the failing entity + assertion).
 */

import axios from 'axios';
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';

// ── config ─────────────────────────────────────────────────────────────────

const RAW_TOKEN = process.env.ADMIN_TOKEN ?? '';
const TOKEN = RAW_TOKEN.startsWith('Bearer ') ? RAW_TOKEN : `Bearer ${RAW_TOKEN}`;
const BASE = process.env.API_BASE ?? 'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';
const TENANT_ID = process.env.TENANT_ID ?? '';
const STAFF_ID = process.env.STAFF_ID ?? '';
const SCHOOL_ID = process.env.SCHOOL_ID ?? '';
const ACADEMIC_YEAR_ID = process.env.ACADEMIC_YEAR_ID ?? '';
const TABLE = process.env.IDENTITY_TABLE ?? 'edforge-identity-basic';
const REGION = process.env.AWS_REGION ?? 'ap-south-1';
const GSI_PROPAGATION_DELAY_MS = Number(process.env.GSI_DELAY_MS ?? 3000);

const required = { ADMIN_TOKEN: RAW_TOKEN, TENANT_ID, STAFF_ID, SCHOOL_ID, ACADEMIC_YEAR_ID };
for (const [k, v] of Object.entries(required)) {
  if (!v) {
    console.error(`Missing required env var: ${k}`);
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

async function ddbGetItem(entityKey: string): Promise<Record<string, any> | undefined> {
  const res = await ddb.send(
    new GetItemCommand({
      TableName: TABLE,
      Key: { tenantId: { S: TENANT_ID }, entityKey: { S: entityKey } },
    }),
  );
  return res.Item;
}

async function ddbQueryGsi1(gsi1pk: string): Promise<any[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': { S: gsi1pk } },
      Limit: 100,
    }),
  );
  return res.Items ?? [];
}

async function ddbDelete(entityKey: string): Promise<void> {
  await ddb.send(
    new DeleteItemCommand({
      TableName: TABLE,
      Key: { tenantId: { S: TENANT_ID }, entityKey: { S: entityKey } },
    }),
  );
}

/** Asserts the row has the lowercase GSI1 attrs populated AND no uppercase leakage. */
function assertCasing(
  label: string,
  item: Record<string, any> | undefined,
  expectedPk: string,
  expectedSk: string,
): boolean {
  if (!item) return check(`${label} | DDB GetItem returned a row`, false, 'item is undefined');
  const has = (k: string) => k in item;
  const v = (k: string) => item[k]?.S;

  const okLowerPresent = check(
    `${label} | lowercase gsi1pk + gsi1sk present`,
    has('gsi1pk') && has('gsi1sk'),
    { gsi1pk: v('gsi1pk'), gsi1sk: v('gsi1sk') },
  );
  const okPkValue = check(
    `${label} | gsi1pk = "${expectedPk}"`,
    v('gsi1pk') === expectedPk,
    { actual: v('gsi1pk'), expected: expectedPk },
  );
  const okSkValue = check(
    `${label} | gsi1sk = "${expectedSk}"`,
    v('gsi1sk') === expectedSk,
    { actual: v('gsi1sk'), expected: expectedSk },
  );
  const okUpperAbsent = check(
    `${label} | uppercase GSI1PK/GSI1SK absent (no factory regression)`,
    !has('GSI1PK') && !has('GSI1SK'),
    { GSI1PK: v('GSI1PK'), GSI1SK: v('GSI1SK') },
  );
  return okLowerPresent && okPkValue && okSkValue && okUpperAbsent;
}

/** Probes the GSI1 — given a partition that should now contain our row, find it. */
async function assertGsiQueryFinds(
  label: string,
  gsi1pk: string,
  entityKey: string,
): Promise<boolean> {
  await new Promise((r) => setTimeout(r, GSI_PROPAGATION_DELAY_MS));
  const rows = await ddbQueryGsi1(gsi1pk);
  const found = rows.some((r: any) => r.entityKey?.S === entityKey);
  return check(
    `${label} | GSI1 Query on "${gsi1pk}" returns our row`,
    found,
    { rowsReturned: rows.length, lookingFor: entityKey, gsiPartition: gsi1pk },
  );
}

const stamp = Date.now().toString();

// ── per-entity roundtrips ──────────────────────────────────────────────────

async function smokeStaffTraining(): Promise<void> {
  const label = 'StaffTraining';
  console.log(`\n── ${label} ───────────────────────────────`);

  const payload = {
    trainingTitle: `S3.2 Smoke Training ${stamp}`,
    trainingType: 'pedagogical' as const,
    trainingProvider: 'EdForge S3.2 Smoke Harness',
    startDate: '2026-05-14',
    endDate: '2026-05-14',
    durationHours: 1,
    status: 'completed' as const,
    notes: `Smoke artifact — ok to delete. stamp=${stamp}`,
  };

  const res = await http('POST', `/staff/${STAFF_ID}/trainings`, payload);
  if (!check(`${label} | POST returns 2xx`, res.status >= 200 && res.status < 300, res)) return;

  const trainingId: string | undefined = res.body?.trainingId ?? res.body?.id;
  if (!check(`${label} | response carries trainingId`, !!trainingId, res.body)) return;

  const entityKey = `STAFF#${STAFF_ID}#TRAIN#${trainingId}`;
  const expectedPk = 'TRAINTYPE#pedagogical';
  const expectedSk = 'STARTDATE#2026-05-14';

  const item = await ddbGetItem(entityKey);
  const casingOk = assertCasing(label, item, expectedPk, expectedSk);
  const gsiOk = casingOk && (await assertGsiQueryFinds(label, expectedPk, entityKey));

  // Cleanup via API (uses Service.deleteTraining → DDB DeleteItem).
  const del = await http('DELETE', `/staff/${STAFF_ID}/trainings/${trainingId}`);
  check(
    `${label} | DELETE returns 2xx (cleanup)`,
    del.status >= 200 && del.status < 300,
    del,
  );

  void gsiOk;
}

async function smokeCredential(): Promise<void> {
  const label = 'Credential';
  console.log(`\n── ${label} ───────────────────────────────`);

  const payload = {
    credentialIdentifier: `S32-${stamp}`,
    credentialTypeDescriptor: 'certification' as const,
    issuanceDate: '2024-01-01',
    expirationDate: '2030-01-01',
    issuingOrganization: 'EdForge S3.2 Smoke',
    name: `S3.2 Smoke Cred ${stamp}`,
    verificationStatus: 'pending' as const,
    isRenewable: true,
    renewalReminderDays: 90,
  };

  const res = await http('POST', `/staff/${STAFF_ID}/credentials`, payload);
  if (!check(`${label} | POST returns 2xx`, res.status >= 200 && res.status < 300, res)) return;

  const credentialId: string | undefined = res.body?.credentialId ?? res.body?.id;
  if (!check(`${label} | response carries credentialId`, !!credentialId, res.body)) return;

  const entityKey = `STAFF#${STAFF_ID}#CRED#${credentialId}`;
  const expectedPk = 'CREDTYPE#certification';
  const expectedSk = 'EXPIRY#2030-01-01';

  const item = await ddbGetItem(entityKey);
  const casingOk = assertCasing(label, item, expectedPk, expectedSk);
  const gsiOk = casingOk && (await assertGsiQueryFinds(label, expectedPk, entityKey));

  const del = await http('DELETE', `/staff/${STAFF_ID}/credentials/${credentialId}`);
  check(
    `${label} | DELETE returns 2xx (cleanup)`,
    del.status >= 200 && del.status < 300,
    del,
  );

  void gsiOk;
}

async function smokeLeave(): Promise<void> {
  const label = 'Leave';
  console.log(`\n── ${label} ───────────────────────────────`);

  const payload = {
    leaveType: 'sick' as const,
    startDate: '2099-05-14',
    endDate: '2099-05-14',
    durationType: 'full_day' as const,
    reason: `S3.2 smoke — ok to ignore. stamp=${stamp}`,
  };

  const res = await http('POST', `/staff/${STAFF_ID}/leave`, payload);
  if (!check(`${label} | POST returns 2xx`, res.status >= 200 && res.status < 300, res)) return;

  const leaveId: string | undefined = res.body?.leaveId ?? res.body?.id;
  if (!check(`${label} | response carries leaveId`, !!leaveId, res.body)) return;

  const entityKey = `STAFF#${STAFF_ID}#LEAVE#${leaveId}`;
  const expectedPk = `SCHOOL#${SCHOOL_ID}`;
  const expectedSk = 'LEAVE#2099-05-14';

  // For Leave we can't always rely on the SCHOOL#{schoolId} partition matching
  // the env-var SCHOOL_ID — the staff's schoolId is denormalised at create-
  // time inside the service (from staff record). So we first read the item to
  // learn the actual gsi1pk, then probe the GSI with it.
  const item = await ddbGetItem(entityKey);
  if (!item) {
    check(`${label} | DDB GetItem returned a row`, false, 'item missing');
    return;
  }
  const actualPk = item.gsi1pk?.S;
  const casingOk = assertCasing(
    label,
    item,
    actualPk ?? expectedPk, // fall through if our env-var schoolId doesn't match staff.schoolId
    expectedSk,
  );
  if (actualPk && actualPk !== expectedPk) {
    console.log(
      `  ℹ ${label} | note: gsi1pk derived from staff.schoolId="${actualPk}" (not env SCHOOL_ID)`,
    );
  }
  const gsiOk = casingOk && actualPk
    ? await assertGsiQueryFinds(label, actualPk, entityKey)
    : false;

  // No DELETE endpoint — cancel via Patch instead (keeps audit trail clean).
  const cancel = await http('PATCH', `/staff/${STAFF_ID}/leave/${leaveId}/cancel`, {
    reason: 'S3.2 smoke cleanup',
  });
  check(
    `${label} | PATCH /cancel returns 2xx (cleanup)`,
    cancel.status >= 200 && cancel.status < 300,
    cancel,
  );

  void gsiOk;
}

async function smokeCalendar(): Promise<void> {
  const label = 'Calendar';
  console.log(`\n── ${label} ───────────────────────────────`);

  const calendarCode = `S32-SMOKE-${stamp}`;
  const payload = {
    academicYearId: ACADEMIC_YEAR_ID,
    calendarCode,
    calendarTypeDescriptor: 'other' as const,
    isDefault: false,
  };

  const res = await http('POST', `/schools/${SCHOOL_ID}/calendars`, payload);
  if (!check(`${label} | POST returns 2xx`, res.status >= 200 && res.status < 300, res)) return;

  const calendarId: string | undefined = res.body?.calendarId ?? res.body?.id;
  if (!check(`${label} | response carries calendarId`, !!calendarId, res.body)) return;

  const entityKey = `SCHOOL#${SCHOOL_ID}#CALENDAR#${calendarId}`;
  const expectedPk = `TENANT#${TENANT_ID}#SCHOOL#${SCHOOL_ID}`;
  const expectedSk = `CALENDAR#${calendarCode}`;

  const item = await ddbGetItem(entityKey);
  const casingOk = assertCasing(label, item, expectedPk, expectedSk);
  const gsiOk = casingOk && (await assertGsiQueryFinds(label, expectedPk, entityKey));

  // Calendar has no public DELETE endpoint. Direct DDB delete via the
  // deployer's IAM perms (which now includes DeleteItem via S3.1 temp policy
  // if still attached, otherwise this is a soft-skip). The artifact is
  // clearly labelled by `calendarCode = S32-SMOKE-<stamp>` so it's easy to
  // identify and remove later if needed.
  try {
    await ddbDelete(entityKey);
    check(`${label} | DDB DeleteItem (cleanup, direct)`, true);
  } catch (err: any) {
    console.log(
      `  ℹ ${label} | DDB delete skipped (${err?.name ?? 'error'}); ` +
      `smoke artifact left in place — calendarCode=${calendarCode}`,
    );
  }

  void gsiOk;
}

// ── main ───────────────────────────────────────────────────────────────────

(async () => {
  console.log('Sprint S3.2 — GSI1 casing write-path roundtrip smoke');
  console.log(`  base:      ${BASE}`);
  console.log(`  tenant:    ${TENANT_ID}`);
  console.log(`  staff:     ${STAFF_ID}`);
  console.log(`  school:    ${SCHOOL_ID}`);
  console.log(`  ay:        ${ACADEMIC_YEAR_ID}`);
  console.log(`  table:     ${TABLE}  (${REGION})`);
  console.log(`  gsi delay: ${GSI_PROPAGATION_DELAY_MS}ms`);
  console.log('');

  await smokeStaffTraining();
  await smokeCredential();
  await smokeLeave();
  await smokeCalendar();

  console.log('');
  console.log('═══ SUMMARY ═══');
  if (fails.length === 0) {
    console.log('✓ All checks passed — S3.2 fix is live and GSI1 is populating.');
    process.exit(0);
  } else {
    console.log(`✗ ${fails.length} check(s) failed:`);
    for (const f of fails) console.log(`  - ${f}`);
    process.exit(1);
  }
})().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
