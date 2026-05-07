/**
 * Sprint 0.5 T0.9c — SBT control plane row state verifier (READ-ONLY).
 *
 * THROWAWAY ops script. Will be productized as Sprint 5 verifier helper.
 *
 * Confirms that the existing SBT deprovision flow has correctly marked the tenant
 * as inactive in BOTH SBT control plane tables. Pattern (verified in T0.8):
 *
 *   tenantManagementTable: row exists, sbtaws_active=false
 *   tenantRegistrationTable: row exists, sbtaws_active=false, registrationStatus="Deleted"
 *
 * No mutations. Returns nonzero exit if either flag is missing/wrong.
 *
 * Usage:
 *   npx ts-node scripts/cleanup-orphans/verify-sbt-state.ts <tenantId>
 *
 * Auth: read-only DDB on the two control plane tables
 */

import {
  DynamoDBClient,
  GetItemCommand,
  ScanCommand,
} from '@aws-sdk/client-dynamodb';

const SARASWATI_TENANT_ID = '34f49822-ae1d-4188-95f0-04e14bc6c662';

const ALLOWED_TENANTS: readonly string[] = [
  '34392ed6-2e51-4fc8-ae2c-242eb5710e40',
  'fc9ea1c1-1cc2-45b3-b8c4-7e953e8e30d7',
  '04ce4a00-c39a-4185-afd4-6e764ef44647',
];

const REGION = process.env.AWS_REGION || 'ap-south-1';

const TENANT_MANAGEMENT_TABLE = 'controlplane-stack-controlplanesbttenantManagementServicetenantManagementTableTenantDetails2B9D9269-16G0O6OGQRWOZ';
const TENANT_REGISTRATION_TABLE = 'controlplane-stack-controlplanesbttenantRegistrationServicetenantRegistrationTableTenantRegistrationTableD511E0AE-TWW0S842ODSN';

const args = process.argv.slice(2);
const tenantId = args[0];

if (!tenantId) {
  console.error('Usage: verify-sbt-state.ts <tenantId>');
  process.exit(2);
}

if (tenantId === SARASWATI_TENANT_ID) {
  console.error(`REFUSED: tenantId ${tenantId} is Saraswati. Aborting (verifier should not run on production tenant — Saraswati is active, not deprovisioned).`);
  process.exit(3);
}

if (!ALLOWED_TENANTS.includes(tenantId)) {
  console.error(`REFUSED: tenantId ${tenantId} is not in the test tenant whitelist. Aborting.`);
  process.exit(4);
}

const client = new DynamoDBClient({ region: REGION });

async function checkManagementRow(tid: string): Promise<{ ok: boolean; reason?: string }> {
  const r = await client.send(new GetItemCommand({
    TableName: TENANT_MANAGEMENT_TABLE,
    Key: { tenantId: { S: tid } },
  }));
  if (!r.Item) return { ok: false, reason: 'Row not found in tenantManagementTable' };
  const active = r.Item.sbtaws_active;
  if (!active) return { ok: false, reason: 'sbtaws_active attribute missing' };
  if (active.BOOL !== false) return { ok: false, reason: `sbtaws_active=${JSON.stringify(active)} (expected BOOL false)` };
  return { ok: true };
}

async function checkRegistrationRow(tid: string): Promise<{ ok: boolean; reason?: string; row?: any }> {
  // Registration table is keyed by tenantRegistrationId, not tenantId — must scan
  const r = await client.send(new ScanCommand({
    TableName: TENANT_REGISTRATION_TABLE,
    FilterExpression: 'tenantId = :t',
    ExpressionAttributeValues: { ':t': { S: tid } },
  }));
  if (!r.Items || r.Items.length === 0) {
    return { ok: false, reason: 'Row not found in tenantRegistrationTable' };
  }
  if (r.Items.length > 1) {
    return { ok: false, reason: `Multiple registration rows (${r.Items.length}) for tenantId — investigate` };
  }
  const item = r.Items[0];
  const active = item.sbtaws_active;
  const status = item.registrationStatus;
  if (!active || active.BOOL !== false) {
    return { ok: false, reason: `sbtaws_active=${JSON.stringify(active)} (expected BOOL false)`, row: item };
  }
  if (!status || status.S !== 'Deleted') {
    return { ok: false, reason: `registrationStatus=${JSON.stringify(status)} (expected S "Deleted")`, row: item };
  }
  return { ok: true, row: item };
}

async function main() {
  console.log(`\n=== Verify SBT post-deprovision state: ${tenantId} ===\n`);

  const mgmt = await checkManagementRow(tenantId);
  console.log(`  tenantManagementTable: ${mgmt.ok ? 'OK (sbtaws_active=false)' : `FAIL — ${mgmt.reason}`}`);

  const reg = await checkRegistrationRow(tenantId);
  console.log(`  tenantRegistrationTable: ${reg.ok ? 'OK (sbtaws_active=false, registrationStatus=Deleted)' : `FAIL — ${reg.reason}`}`);

  if (!mgmt.ok || !reg.ok) {
    console.error('\nFAIL — SBT post-deprovision state is not as expected. Investigate before proceeding.');
    process.exit(1);
  }
  console.log('\nPASS — SBT marked tenant inactive in both control plane tables.');
}

main().catch((e) => { console.error(e); process.exit(1); });
