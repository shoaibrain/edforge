/**
 * Read-only persistence audit — PABSON academic-year `calendarType` + the
 * school-config `academicCalendarType` it inherits from.
 *
 * WRITES NOTHING. This is ground-truth gathering before deciding any heal of
 * the GB1.4 create-time fix (AY `calendarType` now inherits the school config;
 * existing rows are not auto-healed).
 *
 * Two layers matter and both were touched by the 2026-06-04 default-masking
 * incident, so we print both rather than assume:
 *
 *   1. School CONFIG row (entityKey `SCHOOL#<id>#CONFIG`) → `academicCalendarType`.
 *      For a PABSON/NPL school this SHOULD be 'annual' (COUNTRY_CONFIG_OVERRIDES.NPL
 *      / ARCHETYPE_CONFIG_OVERRIDES.PABSON). But createSchool's `.default()`
 *      masking (#243) could have persisted the US default 'semester', and the
 *      regional-cluster heal did NOT touch this field — so it may still be stale.
 *
 *   2. Academic-year rows (entityType 'ACADEMIC_YEAR') → `calendarType`. Created
 *      before the GB1.4 fix, these inherited nothing and fell back to 'semester'.
 *
 * The PABSON-correct value for both is 'annual'. The audit flags every AY whose
 * calendarType !== 'annual' and shows, alongside it, what its school's CONFIG
 * row currently holds — so a heal can be scoped from real persistence, not a guess.
 *
 * Usage:
 *   AWS_PROFILE=prod npx ts-node scripts/audit-pabson-academic-years.ts
 *   AWS_PROFILE=prod npx ts-node scripts/audit-pabson-academic-years.ts --tenant <tenantId>
 *
 *   Env: AWS creds via your shell/profile; AWS_REGION (default ap-south-1);
 *        IDENTITY_TABLE (default edforge-identity-basic).
 *
 * Per the deploy-evidence convention, tee raw output to a private/local path
 * such as ${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION ?? 'ap-south-1';
const TABLE = process.env.IDENTITY_TABLE ?? 'edforge-identity-basic';

const tenantArgIdx = process.argv.indexOf('--tenant');
const TENANT_FILTER = tenantArgIdx >= 0 ? process.argv[tenantArgIdx + 1] : undefined;

/** PABSON-correct academicCalendarType / AY calendarType (NPL country + PABSON archetype default). */
const PABSON_EXPECTED = 'annual';

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

interface TenantRow {
  tenantId: string;
  tenantName?: string;
  archetype?: string;
  country?: string;
}

interface SchoolRow {
  entityKey: string;
  schoolId?: string;
  schoolCode?: string;
  name?: string;
  address?: { country?: string };
}

interface ConfigRow {
  entityKey: string;
  academicCalendarType?: string;
}

interface AyRow {
  entityKey: string;
  yearId?: string;
  schoolId?: string;
  name?: string;
  status?: string;
  isCurrent?: boolean;
  calendarType?: string;
  startDate?: string;
  endDate?: string;
}

/** PABSON tenant metadata rows (entityType='TENANT', entityKey='METADATA', archetype='PABSON'). */
async function pabsonTenants(): Promise<TenantRow[]> {
  const out: TenantRow[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: '#et = :t AND entityKey = :mk AND archetype = :a',
        ExpressionAttributeNames: { '#et': 'entityType', '#c': 'country' },
        ExpressionAttributeValues: { ':t': 'TENANT', ':mk': 'METADATA', ':a': 'PABSON' },
        ProjectionExpression: 'tenantId, tenantName, archetype, #c',
        ExclusiveStartKey,
      }),
    );
    for (const it of res.Items ?? []) out.push(it as TenantRow);
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

/** Every row under the SCHOOL# prefix for a tenant, partitioned by kind. */
async function schoolSpaceForTenant(tenantId: string): Promise<{
  schools: SchoolRow[];
  configs: ConfigRow[];
  ays: AyRow[];
}> {
  const schools: SchoolRow[] = [];
  const configs: ConfigRow[] = [];
  const ays: AyRow[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'tenantId = :tid AND begins_with(entityKey, :skp)',
        ExpressionAttributeNames: { '#nm': 'name', '#st': 'status', '#ad': 'address' },
        ExpressionAttributeValues: { ':tid': tenantId, ':skp': 'SCHOOL#' },
        ProjectionExpression:
          'entityKey, entityType, schoolId, schoolCode, #nm, #ad, ' +
          'academicCalendarType, yearId, #st, isCurrent, calendarType, startDate, endDate',
        ExclusiveStartKey,
      }),
    );
    for (const it of res.Items ?? []) {
      const et = it.entityType as string;
      const key = it.entityKey as string;
      if (et === 'SCHOOL') schools.push(it as SchoolRow);
      else if (et === 'ACADEMIC_YEAR') ays.push(it as AyRow);
      else if (key.endsWith('#CONFIG')) configs.push(it as ConfigRow);
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return { schools, configs, ays };
}

function configForSchool(configs: ConfigRow[], schoolId: string): ConfigRow | undefined {
  return configs.find((c) => c.entityKey === `SCHOOL#${schoolId}#CONFIG`);
}

async function main(): Promise<void> {
  console.log(
    `\n🔎 PABSON academic-year audit (READ-ONLY) — table=${TABLE} region=${REGION}` +
      (TENANT_FILTER ? ` tenant=${TENANT_FILTER}` : '') +
      `\n   PABSON-correct calendarType = '${PABSON_EXPECTED}'\n`,
  );

  let tenants = await pabsonTenants();
  if (TENANT_FILTER) tenants = tenants.filter((t) => t.tenantId === TENANT_FILTER);
  console.log(`PABSON tenants in scope: ${tenants.length}\n`);

  let ayTotal = 0;
  let ayMisclassified = 0;
  let configStale = 0;
  let nonNplSchools = 0;

  for (const t of tenants) {
    console.log(`━━ tenant ${t.tenantId}  "${t.tenantName ?? '?'}"  country=${t.country ?? '?'}`);
    const { schools, configs, ays } = await schoolSpaceForTenant(t.tenantId);

    if (schools.length === 0 && ays.length === 0) {
      console.log('   (no schools / academic years)\n');
      continue;
    }

    const aysBySchool = new Map<string, AyRow[]>();
    for (const ay of ays) {
      const sid = ay.schoolId ?? '?';
      const list = aysBySchool.get(sid) ?? [];
      list.push(ay);
      aysBySchool.set(sid, list);
    }

    for (const s of schools) {
      const sid = s.schoolId ?? s.entityKey.replace(/^SCHOOL#/, '');
      const country = s.address?.country?.toUpperCase() ?? '?';
      if (country !== 'NPL' && country !== '?') nonNplSchools++;
      const cfg = configForSchool(configs, sid);
      const cfgCal = cfg?.academicCalendarType ?? '(no config row)';
      const cfgFlag = cfg && cfg.academicCalendarType !== PABSON_EXPECTED ? ' ⚠️ STALE' : '';
      if (cfg && cfg.academicCalendarType !== PABSON_EXPECTED) configStale++;

      console.log(
        `   • school ${sid}  code=${s.schoolCode ?? '-'}  "${s.name ?? ''}"  country=${country}`,
      );
      console.log(`       config.academicCalendarType = ${cfgCal}${cfgFlag}`);

      const schoolAys = aysBySchool.get(sid) ?? [];
      if (schoolAys.length === 0) {
        console.log('       academic years: (none)');
      }
      for (const ay of schoolAys) {
        ayTotal++;
        const bad = ay.calendarType !== PABSON_EXPECTED;
        if (bad) ayMisclassified++;
        console.log(
          `       AY ${ay.yearId ?? ay.entityKey}  "${ay.name ?? ''}"  ` +
            `status=${ay.status ?? '?'}  isCurrent=${ay.isCurrent === true}  ` +
            `dates=${ay.startDate ?? '?'}..${ay.endDate ?? '?'}  ` +
            `calendarType=${ay.calendarType ?? '(unset)'}${bad ? '  ⚠️ MISCLASSIFIED' : '  ✅'}`,
        );
      }
    }

    // AY rows whose school row is gone (orphans) — still real persistence.
    const knownSchoolIds = new Set(schools.map((s) => s.schoolId ?? s.entityKey.replace(/^SCHOOL#/, '')));
    for (const [sid, list] of aysBySchool) {
      if (knownSchoolIds.has(sid)) continue;
      for (const ay of list) {
        ayTotal++;
        const bad = ay.calendarType !== PABSON_EXPECTED;
        if (bad) ayMisclassified++;
        console.log(
          `   • ORPHAN AY (school ${sid} not found)  ${ay.yearId ?? ay.entityKey}  "${ay.name ?? ''}"  ` +
            `status=${ay.status ?? '?'}  calendarType=${ay.calendarType ?? '(unset)'}${bad ? '  ⚠️ MISCLASSIFIED' : ''}`,
        );
      }
    }
    console.log('');
  }

  console.log('────────────────────────────────────────────────────────');
  console.log(
    `📊 ${tenants.length} PABSON tenant(s) · ${ayTotal} academic year(s) · ` +
      `${ayMisclassified} AY calendarType !== '${PABSON_EXPECTED}' · ` +
      `${configStale} school config(s) with stale academicCalendarType · ` +
      `${nonNplSchools} non-NPL PABSON school(s).`,
  );
  console.log('This audit wrote nothing. Use it to scope the heal from real persistence.\n');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
