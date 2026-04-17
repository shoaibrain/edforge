/**
 * 0.1 — list-event-bus.ts
 *
 * Reads the live EVENT_BUS_NAME from CloudFormation exports of the controlplane-stack,
 * then lists all rules and their targets on that bus.
 *
 * Usage:
 *   AWS_PROFILE=uat npx ts-node scripts/analytics/list-event-bus.ts
 *   AWS_PROFILE=uat npx ts-node scripts/analytics/list-event-bus.ts --save
 *
 * Flags:
 *   --save            Persist output to docs/analytics/event-bus-snapshot.md
 *   --region <r>      Override region (default: ap-south-1)
 *   --stack <name>    CloudFormation stack to query (default: controlplane-stack)
 *   --export <name>   Export name containing bus name/ARN (default: auto-detect)
 *
 * Notes:
 *   - Read-only. No AWS resources created or modified.
 *   - Requires IAM: cloudformation:ListExports, events:ListRules, events:ListTargetsByRule,
 *     events:DescribeEventBus.
 */

import {
  CloudFormationClient,
  ListExportsCommand,
  Export,
} from '@aws-sdk/client-cloudformation';
import {
  EventBridgeClient,
  DescribeEventBusCommand,
  ListRulesCommand,
  ListTargetsByRuleCommand,
  Rule,
  Target,
} from '@aws-sdk/client-eventbridge';
import * as fs from 'fs';
import * as path from 'path';

interface Args {
  save: boolean;
  region?: string;
  stack: string;
  exportName?: string;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const args: Args = {
    save: a.includes('--save'),
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
    stack: 'controlplane-stack',
  };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--region' && a[i + 1]) args.region = a[++i];
    else if (a[i] === '--stack' && a[i + 1]) args.stack = a[++i];
    else if (a[i] === '--export' && a[i + 1]) args.exportName = a[++i];
  }
  return args;
}

async function listAllExports(client: CloudFormationClient): Promise<Export[]> {
  const all: Export[] = [];
  let token: string | undefined;
  do {
    const r = await client.send(new ListExportsCommand({ NextToken: token }));
    if (r.Exports) all.push(...r.Exports);
    token = r.NextToken;
  } while (token);
  return all;
}

async function resolveEventBusName(args: Args): Promise<{ name: string; source: string }> {
  if (process.env.EVENT_BUS_NAME_OVERRIDE) {
    return { name: process.env.EVENT_BUS_NAME_OVERRIDE, source: 'env EVENT_BUS_NAME_OVERRIDE' };
  }
  const cfn = new CloudFormationClient(args.region ? { region: args.region } : {});
  const exps = await listAllExports(cfn);
  const ownedByStack = exps.filter(
    (e) => e.ExportingStackId && e.ExportingStackId.includes(`:stack/${args.stack}/`),
  );
  const pool = ownedByStack.length > 0 ? ownedByStack : exps;

  if (args.exportName) {
    const hit = pool.find((e) => e.Name === args.exportName);
    if (!hit?.Value) throw new Error(`Export ${args.exportName} not found in stack ${args.stack}`);
    return { name: hit.Value, source: `export ${args.exportName}` };
  }
  // Prefer clean exports (e.g. "SbtEventBusName") over CDK auto-generated
  // "ExportsOutputRef..." and "ExportsOutputFnGetAtt..." exports.
  const isCleanName = (n?: string) => !!n && !n.startsWith('controlplane-stack:ExportsOutput');
  const cleanCandidates = pool.filter(
    (e) =>
      isCleanName(e.Name) &&
      ((e.Name || '').toLowerCase().includes('eventbus') ||
        (e.Value || '').toLowerCase().includes('eventbus')),
  );
  const candidate =
    cleanCandidates[0] ||
    pool.find(
      (e) =>
        (e.Name || '').toLowerCase().includes('eventbus') ||
        (e.Value || '').toLowerCase().includes('eventbus'),
    );
  if (!candidate?.Value) {
    const sample = pool
      .slice(0, 20)
      .map((e) => `  ${e.Name} = ${e.Value}`)
      .join('\n');
    throw new Error(
      `Could not auto-detect event bus export from stack ${args.stack}. ` +
        `Pass --export <Name>. First 20 exports:\n${sample}`,
    );
  }
  return { name: candidate.Value, source: `export ${candidate.Name}` };
}

async function listAllRules(eb: EventBridgeClient, busName: string): Promise<Rule[]> {
  const all: Rule[] = [];
  let token: string | undefined;
  do {
    const r = await eb.send(new ListRulesCommand({ EventBusName: busName, NextToken: token }));
    if (r.Rules) all.push(...r.Rules);
    token = r.NextToken;
  } while (token);
  return all;
}

async function listTargets(eb: EventBridgeClient, busName: string, ruleName: string): Promise<Target[]> {
  const all: Target[] = [];
  let token: string | undefined;
  do {
    const r = await eb.send(
      new ListTargetsByRuleCommand({ EventBusName: busName, Rule: ruleName, NextToken: token }),
    );
    if (r.Targets) all.push(...r.Targets);
    token = r.NextToken;
  } while (token);
  return all;
}

function formatMarkdown(
  busName: string,
  busArn: string,
  source: string,
  rules: Array<{ rule: Rule; targets: Target[] }>,
): string {
  const now = new Date().toISOString();
  const lines: string[] = [];
  lines.push(`# Event Bus Snapshot`);
  lines.push(``);
  lines.push(`- Generated: ${now}`);
  lines.push(`- Bus name: \`${busName}\``);
  lines.push(`- Bus ARN: \`${busArn}\``);
  lines.push(`- Resolved from: ${source}`);
  lines.push(`- Rule count: ${rules.length}`);
  lines.push(``);
  lines.push(`## Rules`);
  lines.push(``);
  for (const { rule, targets } of rules) {
    lines.push(`### \`${rule.Name}\``);
    lines.push(``);
    lines.push(`- State: \`${rule.State}\``);
    if (rule.Description) lines.push(`- Description: ${rule.Description}`);
    if (rule.ScheduleExpression) lines.push(`- Schedule: \`${rule.ScheduleExpression}\``);
    if (rule.EventPattern) {
      lines.push(`- Event pattern:`);
      lines.push('```json');
      try {
        lines.push(JSON.stringify(JSON.parse(rule.EventPattern), null, 2));
      } catch {
        lines.push(rule.EventPattern);
      }
      lines.push('```');
    }
    lines.push(`- Targets (${targets.length}):`);
    if (targets.length === 0) {
      lines.push(`  - _none_`);
    } else {
      for (const t of targets) {
        lines.push(`  - \`${t.Id}\` → \`${t.Arn}\`` + (t.DeadLetterConfig?.Arn ? ` (DLQ: \`${t.DeadLetterConfig.Arn}\`)` : ''));
      }
    }
    lines.push(``);
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs();
  const { name: busName, source } = await resolveEventBusName(args);
  const eb = new EventBridgeClient(args.region ? { region: args.region } : {});
  const desc = await eb.send(new DescribeEventBusCommand({ Name: busName }));
  const busArn = desc.Arn || '(unknown)';
  const rules = await listAllRules(eb, busName);
  const enriched: Array<{ rule: Rule; targets: Target[] }> = [];
  for (const r of rules) {
    const targets = r.Name ? await listTargets(eb, busName, r.Name) : [];
    enriched.push({ rule: r, targets });
  }
  const md = formatMarkdown(busName, busArn, source, enriched);
  if (args.save) {
    const out = path.resolve(__dirname, '../../docs/analytics/event-bus-snapshot.md');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, md);
    console.log(`Saved: ${out}`);
  } else {
    console.log(md);
  }
}

main().catch((e) => {
  console.error('list-event-bus failed:', e);
  process.exit(1);
});
