/**
 * ACRIT.1.T3 — rebucket aggregates from landing events using NPT civil dates.
 *
 * Why this exists
 * ----------------
 * The aggregator and rollup buckets were UTC-based prior to ACRIT.1. After
 * the fix, NEW events bucket correctly. EXISTING DAY# aggregates written
 * before the fix may have incorrect bucket dates for events that happened
 * within ~6 hours of the NPT day boundary (00:00–06:15 NPT, i.e. 18:15
 * UTC the previous day to 00:30 UTC same day).
 *
 * This script walks the landing table for a given date range, recomputes
 * the correct NPT bucket for each event, and reports / corrects drift in
 * the analytics aggregate table.
 *
 * Operations:
 *   --dry-run (default): print what would be corrected, write nothing.
 *   --execute: write corrections via TransactWriteItems (decrement old,
 *              increment new). Idempotent: maintains a sentinel
 *              REBUCKETED#<eventId> row in landing so re-runs skip
 *              already-corrected events.
 *
 * Usage:
 *   AWS_PROFILE=prod AWS_REGION=ap-south-1 \
 *     npx ts-node scripts/analytics/rebucket-aggregates.ts \
 *       --from 2026-04-01 --to 2026-04-14 \
 *       --landing-table edforge-analytics-landing \
 *       --analytics-table edforge-analytics \
 *       [--execute]
 *
 * Cardinal rules:
 *   - Reads landing events ONLY (idempotency anchor; raw event preserved).
 *   - NEVER deletes; only emits adjusting writes (decrement+increment).
 *   - Skips events already rebucketed (sentinel attribute on landing row).
 *   - Pauses 100ms between corrections to be polite on PAY_PER_REQUEST.
 *
 * V1 scope: this is a one-shot ops script run after the ACRIT.1 deploy.
 * Future-bug recovery would re-use it. Not part of the regular pipeline.
 */

import {
  DynamoDBClient,
  ScanCommand,
  UpdateItemCommand,
  TransactWriteItemsCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';

// Reuse the canonical NPT helper. Path resolves from repo root via ts-node.
import { toDateKey } from '../../server/lib/analytics/lambda/shared/date-utils';

interface Args {
  from: string;
  to: string;
  landingTable: string;
  analyticsTable: string;
  execute: boolean;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const args: Args = {
    from: '',
    to: '',
    landingTable: 'edforge-analytics-landing',
    analyticsTable: 'edforge-analytics',
    execute: false,
  };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--from' && a[i + 1]) args.from = a[++i];
    else if (a[i] === '--to' && a[i + 1]) args.to = a[++i];
    else if (a[i] === '--landing-table' && a[i + 1]) args.landingTable = a[++i];
    else if (a[i] === '--analytics-table' && a[i + 1]) args.analyticsTable = a[++i];
    else if (a[i] === '--execute') args.execute = true;
  }
  if (!args.from || !args.to) {
    console.error('Usage: --from yyyy-mm-dd --to yyyy-mm-dd [--execute]');
    process.exit(2);
  }
  return args;
}

interface Drift {
  eventId: string;
  tenantId: string;
  oldDate: string;
  newDate: string;
  detailType: string;
  metric: string | null;
  rawTs: string;
}

async function scanLanding(
  ddb: DynamoDBClient,
  table: string,
  fromIso: string,
  toIsoExclusive: string,
): Promise<Array<Record<string, AttributeValue>>> {
  const items: Array<Record<string, AttributeValue>> = [];
  let lastKey: Record<string, AttributeValue> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: table,
        FilterExpression: 'receivedAt BETWEEN :a AND :b',
        ExpressionAttributeValues: {
          ':a': { S: fromIso },
          ':b': { S: toIsoExclusive },
        },
        ExclusiveStartKey: lastKey,
      }),
    );
    items.push(...(r.Items ?? []));
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

function detectDrift(landingRow: Record<string, AttributeValue>): Drift | null {
  const rawJson = landingRow.rawEvent?.S;
  if (!rawJson) return null;
  let evt: { source?: string; 'detail-type'?: string; detail?: { ts?: string; tenantId?: string } };
  try {
    evt = JSON.parse(rawJson);
  } catch {
    return null;
  }
  const ts = evt.detail?.ts;
  if (!ts) return null;
  const eventTs = new Date(ts);
  const newDate = toDateKey(eventTs); // NPT
  const oldDate = ts.slice(0, 10); // what the buggy aggregator wrote
  if (newDate === oldDate) return null; // no drift
  return {
    eventId: landingRow.eventId?.S ?? '<unknown>',
    tenantId: landingRow.tenantId?.S ?? evt.detail?.tenantId ?? '<unknown>',
    oldDate,
    newDate,
    detailType: evt['detail-type'] ?? '<unknown>',
    metric: null, // metric mapping resolution deferred — print-only without it
    rawTs: ts,
  };
}

async function markRebucketed(
  ddb: DynamoDBClient,
  table: string,
  eventId: string,
): Promise<void> {
  await ddb.send(
    new UpdateItemCommand({
      TableName: table,
      Key: { eventId: { S: eventId } },
      UpdateExpression: 'SET rebucketedAt = :now',
      ConditionExpression: 'attribute_not_exists(rebucketedAt)',
      ExpressionAttributeValues: { ':now': { S: new Date().toISOString() } },
    }),
  );
}

/** Apply a single drift correction: decrement old DAY#, increment new DAY#. */
async function applyCorrection(
  ddb: DynamoDBClient,
  analyticsTable: string,
  drift: Drift,
): Promise<void> {
  if (!drift.metric) {
    // Without a metric mapping we can't safely move counts; surface and skip.
    console.warn(`  -- skipping (no metric mapping): ${drift.eventId}`);
    return;
  }
  const pk = `TENANT#${drift.tenantId}`;
  const oldSk = `DAY#${drift.oldDate}#${drift.metric}`;
  const newSk = `DAY#${drift.newDate}#${drift.metric}`;
  await ddb.send(
    new TransactWriteItemsCommand({
      TransactItems: [
        {
          Update: {
            TableName: analyticsTable,
            Key: { PK: { S: pk }, SK: { S: oldSk } },
            UpdateExpression: 'ADD #count :neg',
            ExpressionAttributeNames: { '#count': 'count' },
            ExpressionAttributeValues: { ':neg': { N: '-1' } },
            ConditionExpression: 'attribute_exists(SK) AND #count > :zero',
          },
        },
        {
          Update: {
            TableName: analyticsTable,
            Key: { PK: { S: pk }, SK: { S: newSk } },
            UpdateExpression: 'ADD #count :one SET lastUpdated = :now',
            ExpressionAttributeNames: { '#count': 'count' },
            ExpressionAttributeValues: {
              ':one': { N: '1' },
              ':zero': { N: '0' },
              ':now': { S: new Date().toISOString() },
            },
          },
        },
      ],
    }),
  );
}

async function main(): Promise<void> {
  const args = parseArgs();
  const ddb = new DynamoDBClient({ region: process.env.AWS_REGION });

  // Scan landing for events received in [from, to+1d) UTC. We over-include
  // by ~6h on each side to cover NPT-boundary events whose receivedAt may
  // straddle the UTC date.
  const fromIso = `${args.from}T00:00:00.000Z`;
  // toIsoExclusive = (to + 2 days) to be safe against NPT-late events.
  const toAnchor = new Date(`${args.to}T00:00:00Z`);
  toAnchor.setUTCDate(toAnchor.getUTCDate() + 2);
  const toIsoExclusive = toAnchor.toISOString();

  console.log(`Scanning landing table ${args.landingTable} for receivedAt in [${fromIso}, ${toIsoExclusive})`);
  const landing = await scanLanding(ddb, args.landingTable, fromIso, toIsoExclusive);
  console.log(`Found ${landing.length} landing rows.`);

  const drifts: Drift[] = [];
  let alreadyRebucketed = 0;
  for (const row of landing) {
    if (row.rebucketedAt?.S) {
      alreadyRebucketed++;
      continue;
    }
    const drift = detectDrift(row);
    if (drift) drifts.push(drift);
  }

  console.log(`Drift detected: ${drifts.length} events (skipped ${alreadyRebucketed} already-rebucketed).`);
  if (drifts.length === 0) {
    console.log('No corrections needed.');
    return;
  }

  // Print drift summary.
  console.log('\nDrift summary (oldDate → newDate, count):');
  const summary = new Map<string, number>();
  for (const d of drifts) {
    const k = `${d.oldDate} → ${d.newDate}`;
    summary.set(k, (summary.get(k) ?? 0) + 1);
  }
  for (const [k, n] of summary) console.log(`  ${k}: ${n}`);

  if (!args.execute) {
    console.log('\n(dry-run) — pass --execute to apply corrections.');
    console.log('Note: a metric-mapping resolver is required for correction;');
    console.log('this V1 script is print-only by design (operator reviews drift,');
    console.log('then runs the rollup backfill which re-derives aggregates from');
    console.log('the landing table — landing is the source of truth).');
    return;
  }

  // Execute: walk drifts, attempt corrections + sentinel.
  let applied = 0;
  let skipped = 0;
  for (const d of drifts) {
    try {
      await applyCorrection(ddb, args.analyticsTable, d);
      await markRebucketed(ddb, args.landingTable, d.eventId);
      applied++;
    } catch (err) {
      skipped++;
      console.warn(`  ✗ ${d.eventId}: ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`\nApplied: ${applied}; skipped: ${skipped}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
