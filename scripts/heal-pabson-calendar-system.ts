/**
 * One-shot data heal — PABSON school regional default cluster.
 *
 * Remediates the 2026-06-04 create-school regional-default-masking incidents
 * (#241 calendar + #243 timezone/locale/academicCalendarType). `createSchoolSchema`
 * carried `.default()` on the regional fields, which the global ZodValidationPipe
 * applied BEFORE the service derivation — so a school created WITHOUT those fields
 * persisted the US DTO defaults instead of the governed/country values:
 *
 *   calendarSystem  gregorian        →  bikram_sambat   (PABSON is governed Bikram Sambat)
 *   timezone        America/Chicago  →  Asia/Kathmandu  (NPL country default)
 *   locale          en-US            →  ne-NP           (NPL country default)
 *
 * The values live ONLY on the School entity row (entityType='SCHOOL',
 * entityKey=`SCHOOL#<schoolId>`); the CONFIG row does not store calendarSystem
 * (getConfiguration reads it from the School row, S0.4). NPL-correct values are
 * Nepal's governance facts (country-config.ts: NPL defaultTimezone/Locale/
 * CalendarSystem). PABSON schools must be NPL — a PABSON school with a non-NPL
 * address is anomalous and is FLAGGED for manual review, not auto-healed.
 *
 * Each field is healed only when it equals its exact masked US-default value, so
 * an operator-chosen value is never clobbered. ALWAYS review the dry-run first.
 *
 * This is a direct DDB write — it intentionally bypasses the service-layer
 * field-governance lock (locked-during-active-year). That lock governs operator
 * UI edits; this is an authorized remediation.
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
 * Per the deploy-evidence convention, tee raw output to a private/local path
 * such as ${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys} for DRYRUN and APPLY.
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

/** Masked US DTO default → NPL-correct value, per regional field. PABSON=NPL. */
const FIELD_HEALS = {
  calendarSystem: { bad: 'gregorian', good: 'bikram_sambat' },
  timezone: { bad: 'America/Chicago', good: 'Asia/Kathmandu' },
  locale: { bad: 'en-US', good: 'ne-NP' },
} as const;
type Field = keyof typeof FIELD_HEALS;
const FIELDS = Object.keys(FIELD_HEALS) as Field[];

interface SchoolRow {
  tenantId: string;
  entityKey: string;
  schoolId?: string;
  schoolCode?: string;
  name?: string;
  calendarSystem?: string;
  timezone?: string;
  locale?: string;
  address?: { country?: string };
}

/** Tenant ids whose metadata row carries archetype === 'PABSON'. The tenant
 *  metadata row is keyed `entityKey='METADATA'` (the SK) but stored with
 *  `entityType='TENANT'` (tenant.entity.ts) — filter on the real entityType. */
async function pabsonTenantIds(): Promise<string[]> {
  const ids: string[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: '#et = :t AND entityKey = :mk AND archetype = :a',
        ExpressionAttributeNames: { '#et': 'entityType' },
        ExpressionAttributeValues: { ':t': 'TENANT', ':mk': 'METADATA', ':a': 'PABSON' },
        ProjectionExpression: 'tenantId',
        ExclusiveStartKey,
      }),
    );
    for (const it of res.Items ?? []) ids.push(it.tenantId as string);
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return ids;
}

/** School rows (entityType='SCHOOL') for a tenant carrying ANY masked regional value. */
async function affectedSchoolsForTenant(tenantId: string): Promise<SchoolRow[]> {
  const rows: SchoolRow[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'tenantId = :tid AND begins_with(entityKey, :skp)',
        FilterExpression: '#et = :school AND (#cs = :badCs OR #tz = :badTz OR #lo = :badLo)',
        ExpressionAttributeNames: {
          '#et': 'entityType',
          '#cs': 'calendarSystem',
          '#tz': 'timezone',
          '#lo': 'locale',
          '#nm': 'name',
          '#ad': 'address',
        },
        ExpressionAttributeValues: {
          ':tid': tenantId,
          ':skp': 'SCHOOL#',
          ':school': 'SCHOOL',
          ':badCs': FIELD_HEALS.calendarSystem.bad,
          ':badTz': FIELD_HEALS.timezone.bad,
          ':badLo': FIELD_HEALS.locale.bad,
        },
        ProjectionExpression: 'tenantId, entityKey, schoolId, schoolCode, #nm, #cs, #tz, #lo, #ad',
        ExclusiveStartKey,
      }),
    );
    for (const it of res.Items ?? []) rows.push(it as SchoolRow);
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return rows;
}

/** Which fields on this row carry their masked US-default value. */
function fieldsToHeal(row: SchoolRow): Field[] {
  return FIELDS.filter((f) => row[f] === FIELD_HEALS[f].bad);
}

/** SET the healed fields, guarded so each only flips while still at its bad value. */
async function healRow(row: SchoolRow, fields: Field[]): Promise<void> {
  const sets: string[] = [];
  const conds: string[] = ['#et = :school'];
  const names: Record<string, string> = { '#et': 'entityType' };
  const values: Record<string, unknown> = { ':school': 'SCHOOL' };
  fields.forEach((f, i) => {
    const nk = `#f${i}`;
    names[nk] = f;
    values[`:good${i}`] = FIELD_HEALS[f].good;
    values[`:bad${i}`] = FIELD_HEALS[f].bad;
    sets.push(`${nk} = :good${i}`);
    conds.push(`${nk} = :bad${i}`);
  });
  await doc.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { tenantId: row.tenantId, entityKey: row.entityKey },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ConditionExpression: conds.join(' AND '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

async function main(): Promise<void> {
  console.log(`\n🩹 PABSON regional-cluster heal — table=${TABLE} region=${REGION} mode=${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);
  const tenants = await pabsonTenantIds();
  console.log(`PABSON tenants: ${tenants.length}`);

  let healedFields = 0;
  let healedRows = 0;
  let flagged = 0;
  for (const tenantId of tenants) {
    const rows = await affectedSchoolsForTenant(tenantId);
    for (const row of rows) {
      const country = row.address?.country?.toUpperCase();
      const id = `tenant=${row.tenantId} school=${row.schoolId ?? row.entityKey} code=${row.schoolCode ?? '-'} "${row.name ?? ''}"`;

      // PABSON should be NPL. A non-NPL PABSON school is anomalous — its correct
      // regional values are ambiguous, so flag it for manual review, don't guess.
      if (country && country !== 'NPL') {
        flagged++;
        console.log(`  ⚠️ FLAG (non-NPL PABSON, manual review) ${id} country=${country}`);
        continue;
      }

      const fields = fieldsToHeal(row);
      if (fields.length === 0) continue;
      healedRows++;
      for (const f of fields) {
        healedFields++;
        console.log(`  ${APPLY ? 'HEAL' : 'WOULD HEAL'} ${id} ${f}: ${FIELD_HEALS[f].bad} -> ${FIELD_HEALS[f].good}`);
      }
      if (APPLY) {
        try {
          await healRow(row, fields);
        } catch (e: any) {
          console.log(`    ⚠️ skipped ${row.entityKey}: ${e?.name} — ${e?.message}`);
        }
      }
    }
  }

  console.log(
    `\n📊 ${APPLY ? 'Healed' : 'Would heal'} ${healedFields} field value(s) across ${healedRows} school row(s); ` +
      `${flagged} flagged for manual review; ${tenants.length} PABSON tenant(s) scanned.`,
  );
  if (!APPLY && healedFields > 0) console.log('Review the list above, then re-run with --apply to write.');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
