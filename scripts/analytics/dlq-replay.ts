/**
 * Layer 5.4 — dlq-replay.ts
 *
 * Reads messages from the AnalyticsAggregatorDLQ, validates each against the
 * analytics event zod schema, and (with --execute) republishes to the
 * EventBridge bus + deletes the original message from the DLQ.
 *
 * Default mode is --dry-run: prints what would happen without mutating
 * anything. Pass --execute to actually replay.
 *
 * Usage:
 *   AWS_PROFILE=uat AWS_REGION=us-east-2 \
 *     npx ts-node scripts/analytics/dlq-replay.ts \
 *       --queue-url https://sqs.us-east-2.amazonaws.com/.../edforge-analytics-aggregator-dlq \
 *       --bus-name controlplanestack...SbtEventBus... \
 *       [--execute] [--max 25]
 *
 * DLQ message shape (produced by aggregator/handler.ts → sendToDlq):
 *   {
 *     reason: string,
 *     event: EventBridgeEvent,     // the full envelope as received
 *     at: ISO timestamp
 *   }
 *
 * Validation policy:
 *   - The script re-runs the zod validation on the inner event.detail for
 *     source=edforge.analytics messages. Domain events (academics/finance/
 *     identity) are replayed unvalidated — they don't carry schemaVersion.
 *   - Any message whose inner event fails validation is NOT republished
 *     and remains on the DLQ; its message ID is printed for manual review.
 */

import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  type Message,
} from '@aws-sdk/client-sqs';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';

interface Args {
  queueUrl: string;
  busName: string;
  execute: boolean;
  max: number;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const out: Args = { queueUrl: '', busName: '', execute: false, max: 25 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--queue-url' && a[i + 1]) out.queueUrl = a[++i];
    else if (a[i] === '--bus-name' && a[i + 1]) out.busName = a[++i];
    else if (a[i] === '--execute') out.execute = true;
    else if (a[i] === '--dry-run') out.execute = false;
    else if (a[i] === '--max' && a[i + 1]) out.max = parseInt(a[++i], 10);
  }
  if (!out.queueUrl || !out.busName) {
    console.error('ERROR: --queue-url and --bus-name are required');
    process.exit(1);
  }
  return out;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO8601_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const ALLOWED_ROLES = new Set([
  'SystemAdmin',
  'TenantAdmin',
  'Teacher',
  'Parent',
  'Student',
]);

/**
 * Lightweight validator — mirrors the zod schema in
 * libs/analytics-events/src/analytics-event.validator.ts. Duplicated here
 * (rather than imported) because root scripts target an older TS version
 * that can't parse zod v4 type definitions.
 */
function validateAnalyticsDetail(d: Record<string, unknown>): string[] {
  const errs: string[] = [];
  if (d.schemaVersion !== 1) errs.push('schemaVersion must be 1');
  if (typeof d.eventId !== 'string' || !UUID_REGEX.test(d.eventId))
    errs.push('eventId must be a UUID');
  if (typeof d.ts !== 'string' || !ISO8601_REGEX.test(d.ts))
    errs.push('ts must be ISO8601');
  if (typeof d.tenantId !== 'string' || d.tenantId.length === 0)
    errs.push('tenantId required');
  if (d.tenantTier !== 'BASIC') errs.push("tenantTier must be 'BASIC'");
  if (typeof d.userId !== 'string' || d.userId.length === 0)
    errs.push('userId required');
  if (typeof d.role !== 'string' || !ALLOWED_ROLES.has(d.role as string))
    errs.push('role must be a known AnalyticsEventRole');
  if (typeof d.feature !== 'string' || d.feature.length === 0)
    errs.push('feature required');
  if (typeof d.action !== 'string' || d.action.length === 0)
    errs.push('action required');
  return errs;
}

interface DlqPayload {
  reason?: string;
  event?: {
    id?: string;
    source?: string;
    'detail-type'?: string;
    detail?: Record<string, unknown>;
    [k: string]: unknown;
  };
  at?: string;
}

async function receiveBatch(sqs: SQSClient, url: string, max: number): Promise<Message[]> {
  const out: Message[] = [];
  while (out.length < max) {
    const r = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: url,
        MaxNumberOfMessages: Math.min(10, max - out.length),
        WaitTimeSeconds: 1,
        VisibilityTimeout: 60,
      }),
    );
    if (!r.Messages || r.Messages.length === 0) break;
    out.push(...r.Messages);
  }
  return out;
}

function classify(payload: DlqPayload): { ok: boolean; reason: string } {
  const evt = payload.event;
  if (!evt) return { ok: false, reason: 'missing event envelope' };
  const source = evt.source || '';
  const detail = evt.detail || {};
  if (source === 'edforge.analytics') {
    const errs = validateAnalyticsDetail(detail as Record<string, unknown>);
    if (errs.length > 0) {
      return { ok: false, reason: 'analytics event fails schema: ' + errs.join(', ') };
    }
    return { ok: true, reason: 'analytics event valid' };
  }
  if (
    source === 'edforge.academics-service' ||
    source === 'edforge.finance-service' ||
    source === 'edforge.identity-service'
  ) {
    return { ok: true, reason: 'domain event (unvalidated, accepted)' };
  }
  return { ok: false, reason: `unknown source: ${source}` };
}

async function main() {
  const args = parseArgs();
  const sqs = new SQSClient({});
  const eb = new EventBridgeClient({});

  console.log(`Queue:   ${args.queueUrl}`);
  console.log(`Bus:     ${args.busName}`);
  console.log(`Mode:    ${args.execute ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log(`Max:     ${args.max}\n`);

  const messages = await receiveBatch(sqs, args.queueUrl, args.max);
  console.log(`Received ${messages.length} message(s) from DLQ.\n`);
  if (messages.length === 0) return;

  let replayed = 0;
  let quarantined = 0;
  let deleted = 0;

  for (const msg of messages) {
    const mid = msg.MessageId || '(no id)';
    let payload: DlqPayload;
    try {
      payload = JSON.parse(msg.Body || '{}');
    } catch (err) {
      console.error(`  ${mid}: body not JSON — leaving on queue. (${(err as Error).message})`);
      quarantined++;
      continue;
    }
    const cls = classify(payload);
    const originalReason = payload.reason || '(none)';
    console.log(`  ${mid}: original=${originalReason} · classify=${cls.reason}`);

    if (!cls.ok) {
      console.log(`    → quarantined (not replayed)`);
      quarantined++;
      continue;
    }

    if (!args.execute) {
      console.log(`    → dry-run: would republish to bus and delete from DLQ`);
      continue;
    }

    try {
      const evt = payload.event!;
      await eb.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: evt.source,
              DetailType: evt['detail-type'],
              Detail: JSON.stringify(evt.detail ?? {}),
              EventBusName: args.busName,
            },
          ],
        }),
      );
      replayed++;
      await sqs.send(
        new DeleteMessageCommand({
          QueueUrl: args.queueUrl,
          ReceiptHandle: msg.ReceiptHandle!,
        }),
      );
      deleted++;
      console.log(`    → replayed + deleted`);
    } catch (err) {
      console.error(`    → replay FAILED: ${(err as Error).message}; left on queue`);
      quarantined++;
    }
  }

  console.log(
    `\nSummary: received=${messages.length}  replayed=${replayed}  quarantined=${quarantined}  deleted=${deleted}`,
  );
  if (!args.execute && messages.length > 0) {
    console.log('\nTo actually replay, rerun with --execute.');
  }
}

main().catch((e) => {
  console.error('dlq-replay failed:', e);
  process.exit(1);
});
