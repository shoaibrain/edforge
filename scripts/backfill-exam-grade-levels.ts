/**
 * ELS.4 backfill — populate `Exam.gradeLevels` on legacy rows.
 *
 * Pre-ELS.1, the `Exam` entity had no `gradeLevels` field. Without this
 * backfill, ELS.3's result-batch Lambda filter degrades to "no filter"
 * for legacy rows on re-close — preserving the pre-ELS.3 off-scope-cards
 * bug for older data. This script writes `gradeLevels =
 * school.enabledGradeLevels` onto every EXAM row missing the field, so the
 * Lambda's filter consistently scopes by grade for all data.
 *
 * Idempotent — `attribute_not_exists(gradeLevels)` ConditionExpression
 * skips already-populated rows. Safe to re-run.
 *
 * **Two-table read:** EXAM rows live in `edforge-academics-basic`; school
 * enabledGradeLevels live in `edforge-identity-basic`. The script reads
 * both, joins by `(tenantId, schoolId)`, and writes back to academics.
 *
 * **gradeRange fallback** — when a school has no `enabledGradeLevels` AND
 * no `gradeRange`, we cannot derive a scope; the EXAM row is left
 * untouched (idempotent skip in subsequent runs). The Lambda's back-compat
 * path keeps the legacy "all enrollments" behavior for these.
 *
 * Usage:
 *   Dry run (default — writes nothing, prints the change set):
 *     AWS_PROFILE=prod npx ts-node scripts/backfill-exam-grade-levels.ts
 *   Apply:
 *     AWS_PROFILE=prod npx ts-node scripts/backfill-exam-grade-levels.ts --apply
 *   Scope to one tenant:
 *     AWS_PROFILE=prod npx ts-node scripts/backfill-exam-grade-levels.ts --tenant <tenantId>
 *
 *   Env: AWS creds via your shell/profile; AWS_REGION (default ap-south-1);
 *        ACADEMICS_TABLE (default edforge-academics-basic);
 *        IDENTITY_TABLE (default edforge-identity-basic).
 *
 * Per the deploy-log convention, tee output to
 *   docs/deploys/prod-backfill-exam-gradelevels-<TS>-<sha>.log (DRYRUN and APPLY).
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION ?? 'ap-south-1';
const ACADEMICS_TABLE = process.env.ACADEMICS_TABLE ?? 'edforge-academics-basic';
const IDENTITY_TABLE = process.env.IDENTITY_TABLE ?? 'edforge-identity-basic';
const APPLY = process.argv.includes('--apply');

const tenantArgIdx = process.argv.indexOf('--tenant');
const TENANT_FILTER = tenantArgIdx >= 0 ? process.argv[tenantArgIdx + 1] : undefined;
if (tenantArgIdx >= 0 && (!TENANT_FILTER || TENANT_FILTER.startsWith('--'))) {
  console.error('Missing value for --tenant');
  process.exit(1);
}

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

interface ExamRow {
  tenantId: string;
  entityKey: string;
  examId?: string;
  schoolId?: string;
  examName?: string;
  status?: string;
  gradeLevels?: string[];
}

interface SchoolDetails {
  enabledGradeLevels?: string[];
  gradeRange?: { start: string; end: string };
}

/** Strict ascending list of grade codes used to derive enabledGradeLevels
 * from a legacy gradeRange. Mirrors the canonical ORDERED_GRADES catalog
 * in shared-types; duplicated here to keep this script dependency-free. */
const ORDERED_GRADES = [
  'ECD', 'PPC', 'PG', 'NUR', 'LKG', 'UKG',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
];

function deriveFromRange(start: string, end: string): string[] | null {
  const s = ORDERED_GRADES.indexOf(start);
  const e = ORDERED_GRADES.indexOf(end);
  if (s < 0 || e < 0 || s > e) return null;
  return ORDERED_GRADES.slice(s, e + 1);
}

async function scanExamsMissingGradeLevels(): Promise<ExamRow[]> {
  const out: ExamRow[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  // `status` is a DDB reserved word — alias `#st` keeps the
  // ProjectionExpression legal. `entityType` is also reserved so it gets `#et`.
  const names: Record<string, string> = {
    '#et': 'entityType',
    '#gl': 'gradeLevels',
    '#st': 'status',
  };
  const values: Record<string, unknown> = { ':exam': 'EXAM' };
  let filter = '#et = :exam AND attribute_not_exists(#gl)';
  if (TENANT_FILTER) {
    filter += ' AND tenantId = :tid';
    values[':tid'] = TENANT_FILTER;
  }
  do {
    const res = await doc.send(
      new ScanCommand({
        TableName: ACADEMICS_TABLE,
        FilterExpression: filter,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ProjectionExpression: 'tenantId, entityKey, examId, schoolId, examName, #st',
        ExclusiveStartKey,
      }),
    );
    for (const it of res.Items ?? []) {
      out.push({
        tenantId: it.tenantId,
        entityKey: it.entityKey,
        examId: it.examId,
        schoolId: it.schoolId,
        examName: it.examName,
        status: it.status,
      });
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

async function getSchool(tenantId: string, schoolId: string): Promise<SchoolDetails | null> {
  // Identity table layout: PK=tenantId, SK=SCHOOL#{schoolId}#CONFIG carries
  // grade-level fields. The canonical SCHOOL#{schoolId} row holds the same
  // enabledGradeLevels on the school entity. We try the entity row first
  // (matches schools.service.ts's `getSchool` response shape).
  const res = await doc.send(
    new GetCommand({
      TableName: IDENTITY_TABLE,
      Key: { tenantId, entityKey: `SCHOOL#${schoolId}` },
      ProjectionExpression: 'enabledGradeLevels, gradeRange',
    }),
  );
  if (!res.Item) return null;
  return {
    enabledGradeLevels: res.Item.enabledGradeLevels,
    gradeRange: res.Item.gradeRange,
  };
}

function resolveSchoolGradeLevels(school: SchoolDetails | null): string[] | null {
  if (!school) return null;
  if (Array.isArray(school.enabledGradeLevels) && school.enabledGradeLevels.length > 0) {
    return school.enabledGradeLevels;
  }
  if (school.gradeRange) {
    return deriveFromRange(school.gradeRange.start, school.gradeRange.end);
  }
  return null;
}

async function setGradeLevels(row: ExamRow, gradeLevels: string[]): Promise<void> {
  await doc.send(
    new UpdateCommand({
      TableName: ACADEMICS_TABLE,
      Key: { tenantId: row.tenantId, entityKey: row.entityKey },
      UpdateExpression: 'SET #gl = :v',
      ConditionExpression: '#et = :exam AND attribute_not_exists(#gl)',
      ExpressionAttributeNames: { '#gl': 'gradeLevels', '#et': 'entityType' },
      ExpressionAttributeValues: { ':v': gradeLevels, ':exam': 'EXAM' },
    }),
  );
}

async function main(): Promise<void> {
  console.log(
    `\n🩹 ELS.4 backfill — academics=${ACADEMICS_TABLE} identity=${IDENTITY_TABLE} ` +
      `region=${REGION} mode=${APPLY ? 'APPLY' : 'DRY-RUN'}` +
      (TENANT_FILTER ? ` tenant=${TENANT_FILTER}` : '') +
      '\n',
  );

  const exams = await scanExamsMissingGradeLevels();
  console.log(`EXAM rows missing gradeLevels: ${exams.length}`);

  // School lookups are cacheable per-(tenant,school) — many exams in one school.
  const schoolCache = new Map<string, SchoolDetails | null>();
  async function schoolFor(tid: string, sid: string): Promise<SchoolDetails | null> {
    const key = `${tid}#${sid}`;
    if (schoolCache.has(key)) return schoolCache.get(key) ?? null;
    const v = await getSchool(tid, sid);
    schoolCache.set(key, v);
    return v;
  }

  let backfilled = 0;
  let skippedNoSchoolContext = 0;
  let skippedNoSchoolId = 0;

  for (const row of exams) {
    if (!row.schoolId) {
      skippedNoSchoolId++;
      continue;
    }
    const school = await schoolFor(row.tenantId, row.schoolId);
    const target = resolveSchoolGradeLevels(school);
    const id =
      `tenant=${row.tenantId} school=${row.schoolId} ` +
      `exam=${row.examId ?? row.entityKey} "${row.examName ?? ''}" status=${row.status ?? '?'}`;
    if (!target) {
      console.log(`  SKIP ${id}: school has no enabledGradeLevels and no derivable gradeRange`);
      skippedNoSchoolContext++;
      continue;
    }
    backfilled++;
    console.log(`  ${APPLY ? 'SET' : 'WOULD SET'} ${id} gradeLevels: [${target.join(', ')}]`);
    if (APPLY) {
      try {
        await setGradeLevels(row, target);
      } catch (e: any) {
        console.log(`    ⚠️ skipped ${row.entityKey}: ${e?.name} — ${e?.message}`);
      }
    }
  }

  console.log(
    `\n📊 ${APPLY ? 'Backfilled' : 'Would backfill'} ${backfilled} exam row(s); ` +
      `${skippedNoSchoolContext} skipped (no school context); ` +
      `${skippedNoSchoolId} skipped (missing schoolId on exam row).`,
  );
  if (!APPLY && backfilled > 0) {
    console.log('Review the list above, then re-run with --apply to write.');
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
