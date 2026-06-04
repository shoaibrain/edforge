/**
 * One-shot data heal — PABSON academic-year `calendarType`.
 *
 * Remediates the GB1.4 create-time gap: before the fix, `createAcademicYear`
 * did not inherit the school's `academicCalendarType`, so every academic year
 * fell back to the DTO default `'semester'`. The create-time fix (#246) only
 * affects NEW rows; existing AY rows keep the masked `'semester'`. The
 * 2026-06-04 read-only audit (audit-pabson-academic-years.ts) confirmed 5 such
 * rows across 2 PABSON tenants while every school CONFIG row already correctly
 * holds `academicCalendarType='annual'`.
 *
 * Target value is resolved EXACTLY as the create-time path now resolves it —
 * from the AY's own school CONFIG `academicCalendarType` — so the heal can never
 * diverge from what a fresh create would produce. NPL default `'annual'` is the
 * fallback only when no config row exists (PABSON is the Nepal governance body).
 *
 * Bug-signature guard: an AY is healed ONLY when its `calendarType='semester'`
 * AND its school config resolves to a NON-semester value. A school that
 * genuinely runs semesters (config says `'semester'`) is left untouched — we
 * never clobber a deliberate operator choice, only the masked fallback.
 *
 * TERM awareness: existing TERM rows are NOT restructured (out of scope). The
 * heal COUNTS terms under each healed AY and flags any with terms, because
 * flipping a year semester→annual while semester-shaped terms exist leaves a
 * structural inconsistency a human must reconcile separately.
 *
 * This is a direct DDB write — it intentionally bypasses the service-layer
 * field-governance lock (locked-during-active-year). That lock governs operator
 * UI edits; this is an authorized remediation. The guarded ConditionExpression
 * makes it idempotent and race-safe.
 *
 * Usage:
 *   Dry run (default — writes nothing, prints the change set):
 *     AWS_PROFILE=prod npx ts-node scripts/heal-pabson-academic-year-calendar-type.ts
 *   Apply:
 *     AWS_PROFILE=prod npx ts-node scripts/heal-pabson-academic-year-calendar-type.ts --apply
 *   Scope to one tenant:
 *     AWS_PROFILE=prod npx ts-node scripts/heal-pabson-academic-year-calendar-type.ts --tenant <tenantId>
 *
 *   Env: AWS creds via your shell/profile; AWS_REGION (default ap-south-1);
 *        IDENTITY_TABLE (default edforge-identity-basic).
 *
 * Per the deploy-log convention, tee output to
 *   docs/deploys/prod-heal-pabson-ay-caltype-<TS>-<sha>.log (DRYRUN and APPLY).
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

const tenantArgIdx = process.argv.indexOf('--tenant');
const TENANT_FILTER = tenantArgIdx >= 0 ? process.argv[tenantArgIdx + 1] : undefined;

/** The masked create-time fallback we heal away from. */
const BAD_CALENDAR_TYPE = 'semester';
/** NPL/PABSON default, used only when an AY has no school CONFIG row. */
const NPL_DEFAULT_CALENDAR_TYPE = 'annual';

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

interface ConfigRow {
  entityKey: string;
  academicCalendarType?: string;
}

interface AyRow {
  tenantId: string;
  entityKey: string;
  yearId?: string;
  schoolId?: string;
  name?: string;
  status?: string;
  isCurrent?: boolean;
  calendarType?: string;
}

/** PABSON tenant ids (entityType='TENANT', entityKey='METADATA', archetype='PABSON'). */
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

/** All rows under SCHOOL# for a tenant: config rows, AY rows, and per-AY term counts. */
async function schoolSpaceForTenant(tenantId: string): Promise<{
  configs: Map<string, string>; // schoolId -> academicCalendarType
  ays: AyRow[];
  termCounts: Map<string, number>; // `${schoolId}#${yearId}` -> term count
}> {
  const configs = new Map<string, string>();
  const ays: AyRow[] = [];
  const termCounts = new Map<string, number>();
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'tenantId = :tid AND begins_with(entityKey, :skp)',
        ExpressionAttributeNames: { '#nm': 'name', '#st': 'status' },
        ExpressionAttributeValues: { ':tid': tenantId, ':skp': 'SCHOOL#' },
        ProjectionExpression:
          'tenantId, entityKey, entityType, schoolId, yearId, #nm, #st, isCurrent, ' +
          'calendarType, academicCalendarType',
        ExclusiveStartKey,
      }),
    );
    for (const it of res.Items ?? []) {
      const et = it.entityType as string;
      const key = it.entityKey as string;
      if (et === 'ACADEMIC_YEAR') {
        ays.push(it as AyRow);
      } else if (et === 'TERM') {
        const m = key.match(/^SCHOOL#(.+?)#YEAR#(.+?)#TERM#/);
        if (m) {
          const k = `${m[1]}#${m[2]}`;
          termCounts.set(k, (termCounts.get(k) ?? 0) + 1);
        }
      } else if (key.endsWith('#CONFIG') && typeof it.academicCalendarType === 'string') {
        const m = key.match(/^SCHOOL#(.+?)#CONFIG$/);
        if (m) configs.set(m[1], it.academicCalendarType as string);
      }
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return { configs, ays, termCounts };
}

/** SET calendarType, guarded so it only flips while still at the bad fallback value. */
async function healAy(row: AyRow, target: string): Promise<void> {
  await doc.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { tenantId: row.tenantId, entityKey: row.entityKey },
      UpdateExpression: 'SET calendarType = :good',
      ConditionExpression: '#et = :ay AND calendarType = :bad',
      ExpressionAttributeNames: { '#et': 'entityType' },
      ExpressionAttributeValues: {
        ':good': target,
        ':ay': 'ACADEMIC_YEAR',
        ':bad': BAD_CALENDAR_TYPE,
      },
    }),
  );
}

async function main(): Promise<void> {
  console.log(
    `\n🩹 PABSON academic-year calendarType heal — table=${TABLE} region=${REGION} ` +
      `mode=${APPLY ? 'APPLY' : 'DRY-RUN'}` +
      (TENANT_FILTER ? ` tenant=${TENANT_FILTER}` : '') +
      '\n',
  );

  let tenants = await pabsonTenantIds();
  if (TENANT_FILTER) tenants = tenants.filter((t) => t === TENANT_FILTER);
  console.log(`PABSON tenants in scope: ${tenants.length}`);

  let healed = 0;
  let skippedNoMismatch = 0;
  let flaggedWithTerms = 0;

  for (const tenantId of tenants) {
    const { configs, ays, termCounts } = await schoolSpaceForTenant(tenantId);

    for (const ay of ays) {
      if (ay.calendarType !== BAD_CALENDAR_TYPE) continue;
      const sid = ay.schoolId ?? '?';

      // Resolve target exactly as create-time does: from the school config,
      // NPL default only when there is no config row.
      const configCal = configs.get(sid);
      const target = configCal ?? NPL_DEFAULT_CALENDAR_TYPE;

      // Bug-signature guard: only heal when the school disagrees with the AY.
      // A school that genuinely runs semesters is left untouched.
      if (target === BAD_CALENDAR_TYPE) {
        skippedNoMismatch++;
        continue;
      }

      const id =
        `tenant=${tenantId} school=${sid} ay=${ay.yearId ?? ay.entityKey} ` +
        `"${ay.name ?? ''}" status=${ay.status ?? '?'} isCurrent=${ay.isCurrent === true}`;
      const terms = termCounts.get(`${sid}#${ay.yearId ?? ''}`) ?? 0;
      const termNote =
        terms > 0
          ? `  ⚠️ has ${terms} TERM row(s) — semester-shaped terms may need separate reconciliation`
          : '';
      if (terms > 0) flaggedWithTerms++;

      healed++;
      console.log(
        `  ${APPLY ? 'HEAL' : 'WOULD HEAL'} ${id} calendarType: ${BAD_CALENDAR_TYPE} -> ${target}` +
          `${configCal ? '' : ' (no config row; NPL default)'}${termNote}`,
      );

      if (APPLY) {
        try {
          await healAy(ay, target);
        } catch (e: any) {
          console.log(`    ⚠️ skipped ${ay.entityKey}: ${e?.name} — ${e?.message}`);
        }
      }
    }
  }

  console.log(
    `\n📊 ${APPLY ? 'Healed' : 'Would heal'} ${healed} academic-year row(s); ` +
      `${flaggedWithTerms} have existing TERM rows (flagged above); ` +
      `${skippedNoMismatch} left untouched (school config also '${BAD_CALENDAR_TYPE}'); ` +
      `${tenants.length} PABSON tenant(s) scanned.`,
  );
  if (!APPLY && healed > 0) console.log('Review the list above, then re-run with --apply to write.');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
