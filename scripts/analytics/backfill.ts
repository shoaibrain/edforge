/**
 * Layer 6.6 — rollup backfill.
 *
 * Invokes the AnalyticsRollupLambda sequentially for each date in a given
 * range. Useful after correcting a publisher bug or re-aggregating a period
 * where the rollup Lambda was paused.
 *
 * Idempotent because the rollup Lambda writes a sentinel row
 * (ROLLUP_PROCESSED#<date>) and short-circuits if the sentinel already
 * exists. To re-process a date, delete the sentinel row first.
 *
 * Usage:
 *   AWS_PROFILE=prod AWS_REGION=ap-south-1 \
 *     npx ts-node scripts/analytics/backfill.ts \
 *       --from 2026-04-01 --to 2026-04-14 \
 *       --function edforge-analytics-rollup \
 *       [--execute] [--pause-ms 500]
 *
 * Default mode is --dry-run: prints the invocation plan without calling
 * Invoke. Pass --execute to actually invoke.
 */

import {
  LambdaClient,
  InvokeCommand,
} from '@aws-sdk/client-lambda';

interface Args {
  from: string;
  to: string;
  functionName: string;
  execute: boolean;
  pauseMs: number;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const args: Args = {
    from: '',
    to: '',
    functionName: 'edforge-analytics-rollup',
    execute: false,
    pauseMs: 500,
  };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--from' && a[i + 1]) args.from = a[++i];
    else if (a[i] === '--to' && a[i + 1]) args.to = a[++i];
    else if (a[i] === '--function' && a[i + 1]) args.functionName = a[++i];
    else if (a[i] === '--execute') args.execute = true;
    else if (a[i] === '--dry-run') args.execute = false;
    else if (a[i] === '--pause-ms' && a[i + 1]) args.pauseMs = parseInt(a[++i], 10);
  }
  if (!args.from || !args.to) {
    console.error('ERROR: --from and --to (yyyy-mm-dd) are required');
    process.exit(1);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.from) || !/^\d{4}-\d{2}-\d{2}$/.test(args.to)) {
    console.error('ERROR: dates must be yyyy-mm-dd');
    process.exit(1);
  }
  return args;
}

function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  if (end < start) {
    console.error('ERROR: --to is before --from');
    process.exit(1);
  }
  for (
    let cur = new Date(start);
    cur.getTime() <= end.getTime();
    cur.setUTCDate(cur.getUTCDate() + 1)
  ) {
    out.push(cur.toISOString().slice(0, 10));
  }
  return out;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = parseArgs();
  const dates = dateRange(args.from, args.to);
  const mode = args.execute ? 'EXECUTE' : 'DRY-RUN';

  console.log(`Function: ${args.functionName}`);
  console.log(`Range:    ${args.from} → ${args.to}  (${dates.length} day(s))`);
  console.log(`Mode:     ${mode}`);
  console.log(`Pause:    ${args.pauseMs}ms between invocations\n`);

  if (!args.execute) {
    console.log('Plan:');
    for (const d of dates) {
      console.log(`  [dry-run] invoke ${args.functionName} with { date: "${d}" }`);
    }
    console.log('\nTo actually run, rerun with --execute.');
    return;
  }

  const lambda = new LambdaClient({});
  let invoked = 0;
  let failed = 0;

  for (const d of dates) {
    try {
      const r = await lambda.send(
        new InvokeCommand({
          FunctionName: args.functionName,
          Payload: Buffer.from(JSON.stringify({ date: d })),
          InvocationType: 'RequestResponse',
        }),
      );
      invoked++;
      const statusCode = r.StatusCode ?? 0;
      const payload = r.Payload
        ? Buffer.from(r.Payload).toString('utf-8')
        : '{}';
      const resultSummary = (() => {
        try {
          const parsed = JSON.parse(payload);
          if (parsed?.processed !== undefined) {
            return `processed=${parsed.processed} skipped=${parsed.skipped} dormant=${parsed.dormant}`;
          }
          return payload.slice(0, 200);
        } catch {
          return payload.slice(0, 200);
        }
      })();
      console.log(`  ${d}: HTTP ${statusCode} · ${resultSummary}`);
      if (r.FunctionError) {
        console.error(`    → FunctionError: ${r.FunctionError}`);
        failed++;
      }
    } catch (err) {
      console.error(`  ${d}: FAIL — ${(err as Error).message}`);
      failed++;
    }
    if (args.pauseMs > 0) await sleep(args.pauseMs);
  }

  console.log(`\nSummary: invoked=${invoked} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('backfill failed:', e);
  process.exit(1);
});
