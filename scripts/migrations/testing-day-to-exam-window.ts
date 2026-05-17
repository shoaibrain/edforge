/**
 * C0.b.5 — Legacy `testing_day` → `exam_window` calendar event migration.
 *
 * One-shot DDB migration that finds every `CALENDARDATE` row whose
 * `calendarEvents[].eventType === 'testing_day'` and rewrites those
 * entries to `eventType: 'exam_window'`. Preserves every other field
 * on the calendarEvent (description, isAllDay, sourceTermId, etc.) and
 * every other field on the row.
 *
 * Why this exists
 * ---------------
 * Sprint S1's calendar-event-descriptor cutover (2026-05-14) removed
 * `testing_day` from the enum and replaced it with two narrower kinds:
 *   - `exam_window`  — term-scoped, auto-synced from GradingPeriod.exam*Date
 *   - `monthly_test` — program-scoped (PABSON monthly cadence)
 *
 * The schema change is documented at
 * `packages/shared-types/src/schemas/identity/calendar-date.schema.ts:23`.
 * Historical rows written before the cutover may still carry the legacy
 * value; the descriptor schema now rejects it, so any subsequent read or
 * round-trip-through-the-DTO would fail Zod validation.
 *
 * Per the C0.b.5 ticket spec, this migration maps `testing_day` →
 * `exam_window` (not `monthly_test`). The mapping reflects the dominant
 * historical use of `testing_day` in the codebase before the split.
 * Operators wanting `monthly_test` semantics for individual rows can
 * relabel manually post-migration.
 *
 * Safety
 * ------
 *   1. Dry-run default; --apply required for any mutation.
 *   2. Per-row read-modify-write via UpdateItem with `SET
 *      calendarEvents = :new` — preserves every other attribute on the
 *      row exactly (no field loss).
 *   3. Idempotent: re-runs are no-ops after the first --apply because
 *      no `testing_day` events remain to match.
 *   4. Audit log per UpdateItem: tenantId, entityKey, count of events
 *      rewritten, before/after eventType array, ts, caller IAM.
 *   5. Rate-limited writes (100ms gap) to be polite to DDB.
 *
 * Usage
 * -----
 *   npx ts-node scripts/migrations/testing-day-to-exam-window.ts                # dry-run, all tenants
 *   npx ts-node scripts/migrations/testing-day-to-exam-window.ts --apply        # destructive
 *   npx ts-node scripts/migrations/testing-day-to-exam-window.ts --tenant <id>  # scoped
 *   npx ts-node scripts/migrations/testing-day-to-exam-window.ts --tenant <id> --apply
 *
 * Auth
 * ----
 * Dry-run: `dynamodb:Scan` on `edforge-identity-basic` (ReadOnlyAccess).
 * --apply: also `dynamodb:UpdateItem`. Operator attaches a temporary
 * inline policy per the Sprint 0.5 README in `scripts/cleanup-orphans/`.
 *
 * Validation (per the C0.b.5 AC)
 * ------------------------------
 * Pre-migration: this script's dry-run prints the row count and a sample.
 * Post-migration: re-run the dry-run — expects "0 candidates". Also the
 * shared-types `calendarEventDescriptorSchema` Zod check now passes
 * round-trip-through-DTO on every CalendarDate row.
 */

import {
  DynamoDBClient,
  ScanCommand,
  UpdateItemCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Config
// ============================================================================

const REGION = process.env.AWS_REGION || 'ap-south-1';
const TABLE = process.env.IDENTITY_TABLE || 'edforge-identity-basic';
const RATE_LIMIT_MS = 100;
const PRINT_SAMPLE_CAP = 20;

const LEGACY = 'testing_day';
const REPLACEMENT = 'exam_window';

const ddb = new DynamoDBClient({ region: REGION });
const sts = new STSClient({ region: REGION });

// ============================================================================
// Args
// ============================================================================

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const tenantIdx = args.findIndex((a) => a === '--tenant');
const tenantFilter = tenantIdx >= 0 ? args[tenantIdx + 1] : undefined;

if (tenantIdx >= 0 && !tenantFilter) {
  console.error('Usage error: --tenant requires a tenantId argument');
  process.exit(2);
}

// ============================================================================
// Types
// ============================================================================

interface CalendarEvent {
  eventType: string;
  description?: string;
  isAllDay?: boolean;
  startTime?: string;
  endTime?: string;
  gradeLevelScope?: string[];
  category?: string;
  audience?: string;
  sourceTermId?: string;
}

interface CandidateRow {
  tenantId: string;
  entityKey: string;
  events: CalendarEvent[];
  /** Indices of events whose eventType matches LEGACY. */
  legacyIdx: number[];
}

// ============================================================================
// Decoders — DDB AttributeValue → JS
// ============================================================================

function av<T = unknown>(v: AttributeValue | undefined): T | undefined {
  if (!v) return undefined;
  if ('S' in v) return v.S as any;
  if ('N' in v) return Number(v.N) as any;
  if ('BOOL' in v) return v.BOOL as any;
  if ('L' in v) return v.L?.map((x) => av(x)) as any;
  if ('M' in v) {
    const obj: Record<string, any> = {};
    for (const [k, vv] of Object.entries(v.M ?? {})) obj[k] = av(vv);
    return obj as any;
  }
  if ('NULL' in v) return null as any;
  return undefined;
}

function calendarEventToAV(e: CalendarEvent): AttributeValue {
  const m: Record<string, AttributeValue> = {
    eventType: { S: e.eventType },
  };
  if (e.description !== undefined) m.description = { S: e.description };
  if (e.isAllDay !== undefined) m.isAllDay = { BOOL: e.isAllDay };
  if (e.startTime !== undefined) m.startTime = { S: e.startTime };
  if (e.endTime !== undefined) m.endTime = { S: e.endTime };
  if (e.category !== undefined) m.category = { S: e.category };
  if (e.audience !== undefined) m.audience = { S: e.audience };
  if (e.sourceTermId !== undefined) m.sourceTermId = { S: e.sourceTermId };
  if (e.gradeLevelScope !== undefined) {
    m.gradeLevelScope = { L: e.gradeLevelScope.map((s) => ({ S: s })) };
  }
  return { M: m };
}

// ============================================================================
// Scan for candidates
// ============================================================================

async function scanCandidates(): Promise<CandidateRow[]> {
  const out: CandidateRow[] = [];
  let lastKey: Record<string, AttributeValue> | undefined;
  let pageCount = 0;

  // DDB can't filter inside a List<Map> sub-field server-side; we filter
  // client-side after pulling all CALENDARDATE rows. `entityType` filter
  // is server-side to keep the scan small.
  const filterParts = ['entityType = :ct'];
  const eav: Record<string, AttributeValue> = {
    ':ct': { S: 'CALENDARDATE' },
  };
  if (tenantFilter) {
    filterParts.push('tenantId = :tid');
    eav[':tid'] = { S: tenantFilter };
  }

  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: filterParts.join(' AND '),
        ExpressionAttributeValues: eav,
        ProjectionExpression: 'tenantId, entityKey, calendarEvents',
        ExclusiveStartKey: lastKey,
      }),
    );
    pageCount += 1;

    for (const item of res.Items ?? []) {
      const tenantId = item.tenantId?.S;
      const entityKey = item.entityKey?.S;
      const events = (av(item.calendarEvents) as CalendarEvent[] | undefined) ?? [];
      if (!tenantId || !entityKey) continue;
      const legacyIdx: number[] = [];
      events.forEach((e, i) => {
        if (e.eventType === LEGACY) legacyIdx.push(i);
      });
      if (legacyIdx.length === 0) continue;
      out.push({ tenantId, entityKey, events, legacyIdx });
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  console.error(
    `  [scan] paged ${pageCount} times; ${out.length} CALENDARDATE rows carry ${LEGACY} event(s)`,
  );
  return out;
}

// ============================================================================
// Migrate one row
// ============================================================================

async function migrate(
  c: CandidateRow,
  audit: (line: string) => void,
): Promise<'migrated' | 'error'> {
  const rewritten: CalendarEvent[] = c.events.map((e) =>
    e.eventType === LEGACY ? { ...e, eventType: REPLACEMENT } : e,
  );
  const beforeTypes = c.events.map((e) => e.eventType).join(',');
  const afterTypes = rewritten.map((e) => e.eventType).join(',');

  try {
    await ddb.send(
      new UpdateItemCommand({
        TableName: TABLE,
        Key: {
          tenantId: { S: c.tenantId },
          entityKey: { S: c.entityKey },
        },
        UpdateExpression: 'SET calendarEvents = :ce, updatedAt = :ts',
        ExpressionAttributeValues: {
          ':ce': { L: rewritten.map(calendarEventToAV) },
          ':ts': { S: new Date().toISOString() },
        },
      }),
    );
    audit(
      `MIGRATE\t${c.tenantId}\t${c.entityKey}\trewrote=${c.legacyIdx.length}\tbefore=[${beforeTypes}]\tafter=[${afterTypes}]\tts=${new Date().toISOString()}`,
    );
    return 'migrated';
  } catch (e) {
    const err = e as { name?: string; message?: string };
    audit(
      `ERROR\t${c.tenantId}\t${c.entityKey}\t${err.name ?? '?'}\t${err.message ?? '?'}`,
    );
    return 'error';
  }
}

// ============================================================================
// Audit log
// ============================================================================

function openAuditLog(callerArn: string): {
  logPath: string;
  append: (line: string) => void;
  close: () => void;
} {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const mode = apply ? 'APPLY' : 'DRYRUN';
  const logPath = path.join(
    __dirname,
    '..',
    '..',
    'docs',
    'deploys',
    `prod-testing-day-migration-${ts}-${mode}.log`,
  );
  const stream = fs.createWriteStream(logPath, { flags: 'a' });
  stream.write(`# C0.b.5 — testing_day → exam_window migration\n`);
  stream.write(`# mode:    ${mode}\n`);
  stream.write(`# region:  ${REGION}\n`);
  stream.write(`# table:   ${TABLE}\n`);
  stream.write(`# tenant:  ${tenantFilter ?? '(all)'}\n`);
  stream.write(`# caller:  ${callerArn}\n`);
  stream.write(`# started: ${new Date().toISOString()}\n`);
  stream.write(`#\n`);
  return {
    logPath,
    append: (line: string) => stream.write(line + '\n'),
    close: () => stream.end(),
  };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const caller = await sts.send(new GetCallerIdentityCommand({}));
  const callerArn = caller.Arn ?? '(unknown)';

  console.error('');
  console.error('============================================================');
  console.error(`  C0.b.5 — ${LEGACY} → ${REPLACEMENT} migration`);
  console.error(`  table:  ${TABLE}`);
  console.error(`  region: ${REGION}`);
  console.error(`  caller: ${callerArn}`);
  console.error(`  tenant: ${tenantFilter ?? '(all tenants)'}`);
  console.error(
    `  mode:   ${apply ? '\x1b[33mAPPLY (destructive)\x1b[0m' : '\x1b[32mDRY-RUN\x1b[0m'}`,
  );
  console.error('============================================================');

  console.error(`[1/2] scanning CALENDARDATE rows for ${LEGACY} events...`);
  const candidates = await scanCandidates();

  console.error('');
  console.error(`  ⇒ ${candidates.length} rows have ${LEGACY} events`);
  console.error('');

  if (candidates.length === 0) {
    console.error(`No ${LEGACY} rows found. Migration is a no-op.`);
    console.error('(Either nothing migrated yet OR a prior --apply already cleared them.)');
    return;
  }

  // Print sample
  const sample = candidates.slice(0, PRINT_SAMPLE_CAP);
  console.log(`# candidates (sample of ${sample.length}/${candidates.length})`);
  console.log('# tenantId\tentityKey\teventCount\tlegacyCount\teventTypes');
  for (const c of sample) {
    const types = c.events.map((e) => e.eventType).join(',');
    console.log(
      `${c.tenantId}\t${c.entityKey}\t${c.events.length}\t${c.legacyIdx.length}\t[${types}]`,
    );
  }
  if (candidates.length > sample.length) {
    console.log(`# ... and ${candidates.length - sample.length} more not shown`);
  }
  console.log('');

  const { logPath, append, close } = openAuditLog(callerArn);
  console.error(`[2/2] audit log: ${logPath}`);

  if (!apply) {
    append('# DRY-RUN only — no DDB writes performed.');
    for (const c of candidates) {
      const types = c.events.map((e) => e.eventType).join(',');
      append(
        `CANDIDATE\t${c.tenantId}\t${c.entityKey}\tlegacy=${c.legacyIdx.length}\ttypes=[${types}]`,
      );
    }
    close();
    console.error('');
    console.error('Dry-run complete. To actually migrate: re-run with --apply.');
    return;
  }

  // APPLY MODE
  console.error('');
  console.error('\x1b[33m--apply mode: migrating rows...\x1b[0m');
  let migrated = 0;
  let errored = 0;
  for (const c of candidates) {
    const outcome = await migrate(c, append);
    if (outcome === 'migrated') migrated += 1;
    else errored += 1;
    await new Promise((res) => setTimeout(res, RATE_LIMIT_MS));
  }
  append(`# ended:  ${new Date().toISOString()}`);
  append(`# migrated: ${migrated}, errored: ${errored}`);
  close();

  console.error('');
  console.error('============================================================');
  console.error(`  Result: migrated=${migrated}, errored=${errored}`);
  console.error(`  Audit log: ${logPath}`);
  console.error('');
  console.error('  Validation: re-run this script in dry-run mode; expect');
  console.error('  "0 rows have testing_day events" (idempotency check).');
  console.error('============================================================');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
