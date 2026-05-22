/**
 * Sprint D.1.5 — Backfill PABSON GradingPolicy for existing schools.
 *
 * Materializes the CEHRD 10-letter scale (incl. `NG` Not-Graded sentinel)
 * for schools in a PABSON-archetype tenant that don't yet have a default
 * GradingPolicy. New schools get the policy automatically via the
 * D.1.3 lazy-seed path on first `GET /schools/:id/grading-policies`; this
 * script handles the Saraswati pilot + dev-pabson-primary tenants whose
 * schools were activated BEFORE D.1.3 shipped.
 *
 * Two-step flow:
 *   1. Scan academics table for SCHOOL entities (entityType=SCHOOL).
 *      WAIT — schools live in IDENTITY table. So Scan identity table for
 *      SCHOOL entityType, partition-filtered to known PABSON tenants.
 *   2. For each school, check academics table for existing default policy
 *      (Query GSI1 with `isDefault=true AND isActive=true`). Skip if found.
 *   3. If no default policy: build the CEHRD seed from
 *      ArchetypeDefaults.PABSON and PUT a new GradingPolicyEntity row.
 *
 * Usage:
 *
 *   # Dry-run (default) — prints what WOULD be written, no DDB mutation:
 *   npx ts-node scripts/backfill-pabson-grading-policy.ts
 *
 *   # Apply — actually writes the rows:
 *   APPLY=true npx ts-node scripts/backfill-pabson-grading-policy.ts
 *
 *   # Target a specific tenant:
 *   TENANT_ID=21aea5da-511f-4dfa-a6f2-6971f63a719f npx ts-node ...
 *
 *   # Override table names / region:
 *   IDENTITY_TABLE=edforge-identity-basic \
 *   ACADEMICS_TABLE=edforge-academics-basic \
 *   AWS_REGION=ap-south-1 \
 *   AWS_PROFILE=prod \
 *   npx ts-node scripts/backfill-pabson-grading-policy.ts
 *
 * Safety
 * ======
 *   - Idempotent: skips schools that already have a default policy.
 *   - Tenant-filter: ONLY applies to tenants whose Tenant.archetype === 'PABSON'.
 *     GENERIC / other tenants are listed but left untouched (their
 *     5-letter US policy is the right default and lazy-seeds on first GET).
 *   - DRY_RUN by default — only actually writes when APPLY=true.
 *   - Conditional write: `attribute_not_exists(entityKey)` so two
 *     concurrent runners can't double-create.
 *
 * Exit codes
 * ==========
 *   0 — clean (all in-scope schools have a default policy now, or dry-run completed)
 *   1 — partial: one or more writes errored (operator must inspect log + retry)
 *   2 — config error (missing env / unreachable table)
 */

import {
  DynamoDBClient,
  ScanCommand,
  QueryCommand,
  PutItemCommand,
  ConditionalCheckFailedException,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { randomUUID } from 'crypto';
import { getArchetypeDefaults } from '@aibrains/shared-types';

// ============================================================================
// Configuration
// ============================================================================

const REGION = process.env.AWS_REGION || 'ap-south-1';
const IDENTITY_TABLE = process.env.IDENTITY_TABLE || 'edforge-identity-basic';
const ACADEMICS_TABLE = process.env.ACADEMICS_TABLE || 'edforge-academics-basic';
const TENANT_ID_FILTER = process.env.TENANT_ID;
const APPLY = process.env.APPLY === 'true';

const ddb = new DynamoDBClient({ region: REGION, maxAttempts: 3 });

// ============================================================================
// Types — minimal projections of the entities we touch.
// ============================================================================

interface TenantRow {
  tenantId: string;
  name?: string;
  archetype?: string;
  status?: string;
}

interface SchoolRow {
  tenantId: string;
  schoolId: string;
  name?: string;
}

// ============================================================================
// Helpers
// ============================================================================

async function listPabsonTenants(): Promise<TenantRow[]> {
  const out: TenantRow[] = [];
  let lastEvaluatedKey: Record<string, AttributeValue> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: IDENTITY_TABLE,
        FilterExpression:
          'entityKey = :metadata AND archetype = :pabson' +
          (TENANT_ID_FILTER ? ' AND tenantId = :tid' : ''),
        ExpressionAttributeValues: {
          ':metadata': { S: 'METADATA' },
          ':pabson': { S: 'PABSON' },
          ...(TENANT_ID_FILTER ? { ':tid': { S: TENANT_ID_FILTER } } : {}),
        },
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );
    for (const item of r.Items ?? []) {
      const u = unmarshall(item);
      out.push({
        tenantId: u.tenantId as string,
        name: u.name as string | undefined,
        archetype: u.archetype as string | undefined,
        status: u.status as string | undefined,
      });
    }
    lastEvaluatedKey = r.LastEvaluatedKey;
  } while (lastEvaluatedKey);
  return out;
}

async function listSchoolsForTenant(tenantId: string): Promise<SchoolRow[]> {
  const out: SchoolRow[] = [];
  let lastEvaluatedKey: Record<string, AttributeValue> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: IDENTITY_TABLE,
        KeyConditionExpression:
          'tenantId = :tid AND begins_with(entityKey, :prefix)',
        FilterExpression: '#entityType = :school',
        ExpressionAttributeNames: { '#entityType': 'entityType' },
        ExpressionAttributeValues: {
          ':tid': { S: tenantId },
          ':prefix': { S: 'SCHOOL#' },
          ':school': { S: 'SCHOOL' },
        },
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );
    for (const item of r.Items ?? []) {
      const u = unmarshall(item);
      // Filter to top-level SCHOOL rows only (skip SCHOOL#...#YEAR#..., etc).
      if (typeof u.entityKey === 'string' && /^SCHOOL#[^#]+$/.test(u.entityKey)) {
        out.push({
          tenantId,
          schoolId: u.schoolId as string,
          name: u.name as string | undefined,
        });
      }
    }
    lastEvaluatedKey = r.LastEvaluatedKey;
  } while (lastEvaluatedKey);
  return out;
}

async function hasDefaultPolicy(
  tenantId: string,
  schoolId: string,
): Promise<boolean> {
  const r = await ddb.send(
    new QueryCommand({
      TableName: ACADEMICS_TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression:
        'gsi1pk = :pk AND begins_with(gsi1sk, :prefix)',
      FilterExpression: 'isDefault = :true AND isActive = :true',
      ExpressionAttributeValues: {
        ':pk': { S: `TENANT#${tenantId}#SCHOOL#${schoolId}` },
        ':prefix': { S: 'GRADEPOLICY#' },
        ':true': { BOOL: true },
      },
      Limit: 1,
    }),
  );
  return (r.Items?.length ?? 0) > 0;
}

function buildPabsonPolicyEntity(tenantId: string, schoolId: string) {
  const profile = getArchetypeDefaults('PABSON');
  const policyId = randomUUID();
  const now = new Date().toISOString();
  return {
    tenantId,
    entityKey: `GRADEPOLICY#${schoolId}#${policyId}`,
    entityType: 'GRADEPOLICY',
    policyId,
    schoolId,
    policyName: 'PABSON Default Grading Policy',
    description:
      'CEHRD 10-letter scale (A+ through E + NG Not-Graded sentinel) seeded ' +
      'by backfill-pabson-grading-policy script (D.1.5).',
    gpaScale: '4.0',
    letterGrades: profile.letterGrades.map((l) => ({
      letter: l.letter,
      minPercentage: l.minPct,
      maxPercentage: l.maxPct,
      gpaPoints: l.gpaPoints,
      isPassing: l.isPassing,
      ...(l.isTerminalFail !== undefined ? { isTerminalFail: l.isTerminalFail } : {}),
      ...(l.displayName !== undefined ? { displayName: l.displayName } : {}),
    })),
    categoryWeights: [
      { categoryId: 'tests', categoryName: 'Tests', weight: 30 },
      { categoryId: 'quizzes', categoryName: 'Quizzes', weight: 20 },
      { categoryId: 'homework', categoryName: 'Homework', weight: 20 },
      { categoryId: 'participation', categoryName: 'Participation', weight: 10 },
      { categoryId: 'projects', categoryName: 'Projects', weight: 20 },
    ],
    roundingRule: 'nearest',
    minimumPassingGrade: Math.min(
      ...profile.letterGrades.filter((l) => l.isPassing).map((l) => l.minPct),
    ),
    isDefault: true,
    isActive: true,
    createdAt: now,
    createdBy: 'system-backfill-d1.5',
    updatedAt: now,
    updatedBy: 'system-backfill-d1.5',
    version: 1,
    gsi1pk: `TENANT#${tenantId}#SCHOOL#${schoolId}`,
    gsi1sk: `GRADEPOLICY#PABSON DEFAULT GRADING POLICY`,
  };
}

async function putPolicy(entity: ReturnType<typeof buildPabsonPolicyEntity>): Promise<void> {
  await ddb.send(
    new PutItemCommand({
      TableName: ACADEMICS_TABLE,
      Item: marshall(entity, { removeUndefinedValues: true }),
      ConditionExpression: 'attribute_not_exists(entityKey)',
    }),
  );
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<number> {
  console.log('=== D.1.5 — Backfill PABSON GradingPolicy ===');
  console.log(`  Region:         ${REGION}`);
  console.log(`  Identity table: ${IDENTITY_TABLE}`);
  console.log(`  Academics table: ${ACADEMICS_TABLE}`);
  console.log(`  Tenant filter:  ${TENANT_ID_FILTER ?? '(all PABSON tenants)'}`);
  console.log(`  Mode:           ${APPLY ? 'APPLY (will write)' : 'DRY-RUN (no writes)'}`);
  console.log('');

  const tenants = await listPabsonTenants();
  console.log(`Found ${tenants.length} PABSON tenant(s).`);
  if (tenants.length === 0) {
    console.log('No tenants matched. Exiting clean.');
    return 0;
  }

  let totalSchools = 0;
  let alreadyHave = 0;
  let toCreate = 0;
  let created = 0;
  let errors = 0;

  for (const t of tenants) {
    console.log(`\nTenant ${t.tenantId} (${t.name ?? 'unnamed'}, archetype=${t.archetype}, status=${t.status})`);
    const schools = await listSchoolsForTenant(t.tenantId);
    totalSchools += schools.length;
    console.log(`  ${schools.length} school(s)`);

    for (const s of schools) {
      const has = await hasDefaultPolicy(s.tenantId, s.schoolId);
      if (has) {
        alreadyHave++;
        console.log(`  [SKIP] school=${s.schoolId} (${s.name ?? '?'}) — already has default policy`);
        continue;
      }
      toCreate++;
      const entity = buildPabsonPolicyEntity(s.tenantId, s.schoolId);
      console.log(
        `  [${APPLY ? 'WRITE' : 'PLAN'}] school=${s.schoolId} (${s.name ?? '?'}) — ` +
        `policy=${entity.policyId} ${entity.letterGrades.length}-letter ` +
        `(min pass=${entity.minimumPassingGrade})`,
      );
      if (APPLY) {
        try {
          await putPolicy(entity);
          created++;
        } catch (e) {
          if (e instanceof ConditionalCheckFailedException) {
            console.log(`  [RACE] school=${s.schoolId} — policy was created concurrently; skipping`);
          } else {
            errors++;
            console.error(`  [ERROR] school=${s.schoolId} — ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }
    }
  }

  console.log('\n=== Summary ===');
  console.log(`  PABSON tenants:           ${tenants.length}`);
  console.log(`  Schools scanned:          ${totalSchools}`);
  console.log(`  Already have default:     ${alreadyHave}`);
  console.log(`  Need policy:              ${toCreate}`);
  if (APPLY) {
    console.log(`  Successfully created:     ${created}`);
    console.log(`  Errors:                   ${errors}`);
  } else {
    console.log(`  (dry-run — no writes)`);
  }

  return errors > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('Unhandled error:', e);
    process.exit(2);
  });
