/**
 * One-shot data heal — PABSON school `calendarSystem`: gregorian → bikram_sambat.
 *
 * Remediates the 2026-06-04 GB1.1 calendar-derivation incident. `createSchoolSchema`
 * defaulted `calendarSystem` to 'gregorian', and the global ZodValidationPipe
 * applied that default before the service's archetype derivation — so a PABSON
 * school created WITHOUT an explicit calendarSystem persisted as 'gregorian'
 * instead of the governed 'bikram_sambat'. (The masking predates GB1.1, so the
 * scope is every such row, not only those created since the GB1 roll.)
 *
 * The value lives ONLY on the School entity row (entityType='SCHOOL',
 * entityKey=`SCHOOL#<schoolId>`). The CONFIG row does not store it —
 * `getConfiguration` reads it from the School row (S0.4). So this heals exactly
 * one row per school.
 *
 * Scope: every PABSON tenant's School rows where calendarSystem === 'gregorian'.
 * PABSON is governed Bikram Sambat, so an explicit 'gregorian' on a PABSON school
 * is the incident, not operator intent. ALWAYS review the dry-run list first.
 *
 * This is a direct DDB write — it intentionally bypasses the service-layer
 * field-governance lock on calendarSystem (locked-during-active-year). That lock
 * governs operator UI edits; this is an authorized remediation.
 *
 * Usage:
 *   Dry run (default — writes nothing, prints the change set):
 *     AWS_PROFILE=prod npx ts-node scripts/heal-pabson-calendar-system.ts
 *   Apply:
 *     AWS_PROFILE=prod npx ts-node scripts/heal-pabson-calendar-system.ts --apply
 *
 *   Env: AWS creds via your shell/profile; AWS_REGION (default ap-south-1);
 *        IDENTITY_TABLE (default edforge-identity-basic).
 *
 * Per the deploy-log convention, tee output to
 *   docs/deploys/prod-heal-pabson-calendar-<TS>-<sha>.log (DRYRUN and APPLY).
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION ?? 'ap-south-1';
const TABLE = process.env.IDENTITY_TABLE ?? 'edforge-identity-basic';
const APPLY = process.argv.includes('--apply');

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

interface SchoolRow {
  tenantId: string;
  entityKey: string;
  schoolId?: string;
  schoolCode?: string;
  name?: string;
  calendarSystem?: string;
}

/** Tenant ids whose METADATA row carries archetype === 'PABSON'. */
async function pabsonTenantIds(): Promise<string[]> {
  const ids: string[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: 'entityType = :m AND archetype = :a',
        ExpressionAttributeValues: { ':m': 'METADATA', ':a': 'PABSON' },
        ProjectionExpression: 'tenantId',
        ExclusiveStartKey,
      }),
    );
    for (const it of res.Items ?? []) ids.push(it.tenantId as string);
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return ids;
}

/** School rows (entityType='SCHOOL') for a tenant whose calendarSystem is 'gregorian'. */
async function gregorianSchoolsForTenant(tenantId: string): Promise<SchoolRow[]> {
  const rows: SchoolRow[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'tenantId = :t AND begins_with(entityKey, :sk)',
        FilterExpression: 'entityType = :s AND calendarSystem = :g',
        ExpressionAttributeValues: { ':t': tenantId, ':sk': 'SCHOOL#', ':s': 'SCHOOL', ':g': 'gregorian' },
        ProjectionExpression: 'tenantId, entityKey, schoolId, schoolCode, #n, calendarSystem',
        ExpressionAttributeNames: { '#n': 'name' },
        ExclusiveStartKey,
      }),
    );
    for (const it of res.Items ?? []) rows.push(it as SchoolRow);
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return rows;
}

/** Set calendarSystem='bikram_sambat', guarded so it only touches a still-gregorian School row. */
async function healSchool(row: SchoolRow): Promise<void> {
  await doc.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { tenantId: row.tenantId, entityKey: row.entityKey },
      UpdateExpression: 'SET calendarSystem = :b',
      ConditionExpression: 'entityType = :s AND calendarSystem = :g',
      ExpressionAttributeValues: { ':b': 'bikram_sambat', ':s': 'SCHOOL', ':g': 'gregorian' },
    }),
  );
}

async function main(): Promise<void> {
  console.log(`\n🩹 PABSON calendarSystem heal — table=${TABLE} region=${REGION} mode=${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);
  const tenants = await pabsonTenantIds();
  console.log(`PABSON tenants: ${tenants.length}`);

  let total = 0;
  let healed = 0;
  for (const tenantId of tenants) {
    const rows = await gregorianSchoolsForTenant(tenantId);
    for (const row of rows) {
      total++;
      console.log(
        `  ${APPLY ? 'HEAL' : 'WOULD HEAL'} tenant=${row.tenantId} school=${row.schoolId ?? row.entityKey} ` +
          `code=${row.schoolCode ?? '-'} "${row.name ?? ''}" gregorian -> bikram_sambat`,
      );
      if (APPLY) {
        try {
          await healSchool(row);
          healed++;
        } catch (e: any) {
          console.log(`    ⚠️ skipped ${row.entityKey}: ${e?.name ?? e?.message}`);
        }
      }
    }
  }

  console.log(
    `\n📊 ${APPLY ? `Healed ${healed}/${total}` : `${total} school row(s) would be healed`} across ${tenants.length} PABSON tenant(s).`,
  );
  if (!APPLY && total > 0) console.log('Review the list above, then re-run with --apply to write.');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
