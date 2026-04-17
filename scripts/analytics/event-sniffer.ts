/**
 * 0.3 — event-sniffer.ts
 *
 * Temporarily attaches a catch-all EventBridge rule matching source prefix
 * `edforge.` OR `sbt` on the controlplane bus, and forwards matching events
 * to a CloudWatch Logs group at `/edforge/analytics/sniff`. Tears down on
 * SIGINT, SIGTERM, and normal exit.
 *
 * Usage:
 *   AWS_PROFILE=uat \
 *   npx ts-node scripts/analytics/event-sniffer.ts \
 *     --bus <busName> --duration 300 [--min-detail-types 25]
 *
 * While this script is running, run 0.2 (synthetic-traffic.ts) in a separate
 * terminal to generate traffic.
 *
 * On exit, writes docs/analytics/event-surface.md with every distinct
 * (source, detailType) pair observed. Exits 1 if fewer than --min-detail-types
 * distinct DetailType values were seen.
 *
 * Flags:
 *   --bus <name>            Required unless EVENT_BUS_NAME env var is set.
 *   --duration <seconds>    How long to sniff (default: 300 = 5 minutes).
 *   --region <r>            Default: ap-south-1.
 *   --min-detail-types <n>  Threshold for exit-1 fail (default: 25).
 *   --log-group <name>      Default: /edforge/analytics/sniff.
 *
 * Required IAM:
 *   logs:CreateLogGroup, logs:PutResourcePolicy, logs:DescribeLogStreams,
 *   logs:FilterLogEvents,
 *   events:PutRule, events:PutTargets, events:RemoveTargets, events:DeleteRule.
 */

import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  DescribeLogGroupsCommand,
  FilterLogEventsCommand,
  PutResourcePolicyCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import {
  EventBridgeClient,
  PutRuleCommand,
  PutTargetsCommand,
  RemoveTargetsCommand,
  DeleteRuleCommand,
} from '@aws-sdk/client-eventbridge';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

interface Args {
  bus: string;
  duration: number;
  region: string;
  minDetailTypes: number;
  logGroup: string;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const out: Args = {
    bus: process.env.EVENT_BUS_NAME || '',
    duration: 300,
    region: process.env.AWS_REGION || 'ap-south-1',
    minDetailTypes: 25,
    logGroup: '/edforge/analytics/sniff',
  };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--bus' && a[i + 1]) out.bus = a[++i];
    else if (a[i] === '--duration' && a[i + 1]) out.duration = parseInt(a[++i], 10);
    else if (a[i] === '--region' && a[i + 1]) out.region = a[++i];
    else if (a[i] === '--min-detail-types' && a[i + 1]) out.minDetailTypes = parseInt(a[++i], 10);
    else if (a[i] === '--log-group' && a[i + 1]) out.logGroup = a[++i];
  }
  if (!out.bus) {
    console.error('ERROR: --bus is required (or set EVENT_BUS_NAME)');
    process.exit(1);
  }
  return out;
}

async function ensureLogGroup(logs: CloudWatchLogsClient, name: string): Promise<void> {
  const desc = await logs.send(new DescribeLogGroupsCommand({ logGroupNamePrefix: name }));
  const exists = (desc.logGroups || []).some((g) => g.logGroupName === name);
  if (!exists) {
    await logs.send(new CreateLogGroupCommand({ logGroupName: name }));
    console.log(`Created log group ${name}`);
  } else {
    console.log(`Log group ${name} exists`);
  }
}

async function ensureLogResourcePolicy(
  logs: CloudWatchLogsClient,
  region: string,
  accountId: string,
  logGroup: string,
): Promise<void> {
  const logGroupArn = `arn:aws:logs:${region}:${accountId}:log-group:${logGroup}:*`;
  const policyName = 'EdforgeAnalyticsSnifferEventsPolicy';
  const doc = {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'EventBridgeToCWLogs',
        Effect: 'Allow',
        Principal: { Service: ['events.amazonaws.com', 'delivery.logs.amazonaws.com'] },
        Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
        Resource: logGroupArn,
      },
    ],
  };
  await logs.send(
    new PutResourcePolicyCommand({ policyName, policyDocument: JSON.stringify(doc) }),
  );
  console.log(`Ensured log resource policy ${policyName}`);
}

function registerCleanup(handler: () => Promise<void>) {
  let running = false;
  const wrap = async (sig: string) => {
    if (running) return;
    running = true;
    console.log(`\n[${sig}] Cleaning up…`);
    try {
      await handler();
    } catch (e) {
      console.error('Cleanup error:', e);
    }
    process.exit(sig === 'normal' ? 0 : 1);
  };
  process.on('SIGINT', () => wrap('SIGINT'));
  process.on('SIGTERM', () => wrap('SIGTERM'));
  process.on('uncaughtException', (e) => {
    console.error('uncaughtException:', e);
    wrap('uncaughtException');
  });
  return () => wrap('normal');
}

async function pollLogs(
  logs: CloudWatchLogsClient,
  logGroup: string,
  startMs: number,
  seen: Map<string, { source: string; detailType: string; count: number; firstTs: string }>,
): Promise<void> {
  let nextToken: string | undefined;
  let endMs = Date.now();
  do {
    const r = await logs.send(
      new FilterLogEventsCommand({
        logGroupName: logGroup,
        startTime: startMs,
        endTime: endMs,
        nextToken,
        limit: 1000,
      }),
    );
    for (const e of r.events || []) {
      if (!e.message) continue;
      try {
        const parsed = JSON.parse(e.message);
        const source = parsed.source || parsed.Source || '(unknown)';
        const detailType = parsed['detail-type'] || parsed.DetailType || '(unknown)';
        const key = `${source}::${detailType}`;
        const existing = seen.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          seen.set(key, {
            source,
            detailType,
            count: 1,
            firstTs: new Date(e.timestamp || Date.now()).toISOString(),
          });
        }
      } catch {
        // ignore non-JSON lines
      }
    }
    nextToken = r.nextToken;
  } while (nextToken);
}

function writeSurfaceDoc(
  seen: Map<string, { source: string; detailType: string; count: number; firstTs: string }>,
  args: Args,
  busName: string,
): string {
  const rows = [...seen.values()].sort((a, b) => {
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return a.detailType.localeCompare(b.detailType);
  });
  const distinctDetailTypes = new Set(rows.map((r) => r.detailType)).size;
  const lines: string[] = [];
  lines.push('# Event Surface — Observed');
  lines.push('');
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Bus: \`${busName}\``);
  lines.push(`- Sniff duration: ${args.duration}s`);
  lines.push(`- Distinct (source, detailType) pairs: ${rows.length}`);
  lines.push(`- Distinct DetailType values: ${distinctDetailTypes}`);
  lines.push(`- Threshold: ${args.minDetailTypes}`);
  lines.push(`- Status: ${distinctDetailTypes >= args.minDetailTypes ? '✅ PASS' : '❌ FAIL'}`);
  lines.push('');
  lines.push('| Source | DetailType | Count | First seen |');
  lines.push('| --- | --- | --- | --- |');
  for (const r of rows) {
    lines.push(`| \`${r.source}\` | \`${r.detailType}\` | ${r.count} | ${r.firstTs} |`);
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs();
  const runId = randomUUID().slice(0, 8);
  const ruleName = `edforge-analytics-sniffer-${runId}`;
  const targetId = `sniffer-target-${runId}`;

  const sts = new STSClient({ region: args.region });
  const ident = await sts.send(new GetCallerIdentityCommand({}));
  const accountId = ident.Account!;
  const logs = new CloudWatchLogsClient({ region: args.region });
  const eb = new EventBridgeClient({ region: args.region });

  await ensureLogGroup(logs, args.logGroup);
  await ensureLogResourcePolicy(logs, args.region, accountId, args.logGroup);

  const logGroupArn = `arn:aws:logs:${args.region}:${accountId}:log-group:${args.logGroup}:*`;

  const eventPattern = {
    source: [{ prefix: 'edforge.' }, { prefix: 'sbt' }],
  };

  console.log(`Creating temporary rule ${ruleName} on bus ${args.bus}…`);
  await eb.send(
    new PutRuleCommand({
      Name: ruleName,
      EventBusName: args.bus,
      EventPattern: JSON.stringify(eventPattern),
      State: 'ENABLED',
      Description: `Temporary sniffer for analytics Layer 0 verification (runId=${runId})`,
    }),
  );
  await eb.send(
    new PutTargetsCommand({
      Rule: ruleName,
      EventBusName: args.bus,
      Targets: [{ Id: targetId, Arn: logGroupArn }],
    }),
  );
  console.log(`Rule + target created. Sniffing for ${args.duration}s…`);

  const startMs = Date.now();
  const seen = new Map<string, { source: string; detailType: string; count: number; firstTs: string }>();

  const cleanup = async () => {
    try {
      await eb.send(
        new RemoveTargetsCommand({ Rule: ruleName, EventBusName: args.bus, Ids: [targetId] }),
      );
      await eb.send(new DeleteRuleCommand({ Name: ruleName, EventBusName: args.bus }));
      console.log(`Removed rule ${ruleName}`);
    } catch (e) {
      console.error('Failed to remove rule:', e);
    }
  };
  const normalExit = registerCleanup(cleanup);

  const pollIntervalMs = 15_000;
  const endMs = startMs + args.duration * 1000;
  while (Date.now() < endMs) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    try {
      await pollLogs(logs, args.logGroup, startMs, seen);
      const distinctDetailTypes = new Set([...seen.values()].map((v) => v.detailType)).size;
      console.log(
        `  …${Math.round((Date.now() - startMs) / 1000)}s elapsed · ` +
          `${seen.size} (source,detailType) pairs · ${distinctDetailTypes} distinct DetailTypes`,
      );
    } catch (e) {
      console.error('Poll error:', e);
    }
  }

  // Final poll to catch tail events
  await new Promise((r) => setTimeout(r, 5000));
  await pollLogs(logs, args.logGroup, startMs, seen);

  const md = writeSurfaceDoc(seen, args, args.bus);
  const outFile = path.resolve(__dirname, '../../docs/analytics/event-surface.md');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, md);
  console.log(`\nWrote ${outFile}`);

  const distinctDetailTypes = new Set([...seen.values()].map((v) => v.detailType)).size;
  await cleanup();
  if (distinctDetailTypes < args.minDetailTypes) {
    console.error(
      `❌ Only ${distinctDetailTypes} distinct DetailTypes observed (threshold: ${args.minDetailTypes}).`,
    );
    process.exit(1);
  }
  console.log(`✅ ${distinctDetailTypes} distinct DetailTypes observed.`);
  // Explicit exit to bypass the signal-handler wrap
  process.exit(0);
}

main().catch((e) => {
  console.error('event-sniffer failed:', e);
  process.exit(1);
});
