/// <reference types="node" />
/**
 * IEMIS Layer 4 — Negative + stress tests (UAT).
 *
 * Runs AFTER Layers 0-3 are green. Hits the live UAT API Gateway with a real
 * tenant-admin JWT plus AWS SDK for DDB + CloudWatch checks.
 *
 * Covers:
 *   N1 — bad-UUID path on PATCH /academics/students/:id/descriptors → 404 (not 500)
 *   N2 — Zod-malformed body on PATCH /descriptors → 400 (not 500)
 *   N3 — unknown descriptor URI shape → 400
 *   S1 — 50-iter PATCH stress loop → all 200, all audit rows landed
 *   O1 — no `iemis.audit.emit_failure` lines in academics log group in last 2h
 *   O2 — no ERROR/Exception lines referencing /iemis or descriptors in identity/academics last 2h
 *   O3 — `edforge-iemis-audit-emit-failures-basic` alarm still OK
 *
 * Usage:
 *   export ADMIN_TOKEN="eyJ..."   # tenant-admin JWT (same one Layer 1 used)
 *   AWS_PROFILE=prod npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/smoke-tests/iemis-layer4-negative-stress.ts
 *
 * Exit 0 = all green; exit 1 = failure.
 */

import axios from 'axios';
import {
  DynamoDBClient,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';
import {
  CloudWatchClient,
  DescribeAlarmsCommand,
} from '@aws-sdk/client-cloudwatch';
import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  FilterLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';

// ── config ─────────────────────────────────────────────────────────────────

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';
const BASE_URL = 'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';
const REGION = 'ap-south-1';
const TENANT_ID = '264ff030-1cd8-4dc3-bdfe-f2728c3e40d0'; // testtenant007
const STUDENT_ID = '001d6f36-2d38-437f-ab3f-b0c6222d258f'; // Md. Aamir Mansuri
const ACADEMICS_TABLE = 'edforge-academics-basic';
const ALARM_NAME = 'edforge-iemis-audit-emit-failures-basic';

// Log groups to scan. Names are CDK-generated with hashes — resolved dynamically
// at run start via DescribeLogGroups + a name-contains filter.
const LOG_GROUP_HINTS = [
  'identityTaskDefidentitycontainer',
  'academicsTaskDefacademicscontainer',
  'identityEcsServicesIdentityLogGroup', // S1.12 dedicated LogGroup watched by IEMIS alarm
];

// ── helpers ────────────────────────────────────────────────────────────────

const fails: string[] = [];

function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) {
    console.log(`  └─ ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    fails.push(name);
  }
}

function authHeader(t: string): string {
  return t.startsWith('Bearer ') ? t : `Bearer ${t}`;
}

async function httpCall(method: 'PATCH' | 'GET', path: string, body?: any) {
  return axios({
    method,
    url: `${BASE_URL}${path}`,
    headers: { Authorization: authHeader(ADMIN_TOKEN), 'Content-Type': 'application/json' },
    data: body,
    validateStatus: () => true,
    timeout: 30_000,
  });
}

async function countAuditRowsForStudent(ddb: DynamoDBClient): Promise<number> {
  // Count all AUDIT#IEMIS# rows whose metadata.studentId matches STUDENT_ID.
  // Paginates through the partition so we don't cap out at Limit=500 if the
  // tenant accumulates many audit rows (stress test adds 50 per run).
  let count = 0;
  let exclusiveStartKey: Record<string, any> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: ACADEMICS_TABLE,
        KeyConditionExpression: 'tenantId = :t AND begins_with(entityKey, :p)',
        ExpressionAttributeValues: {
          ':t': { S: TENANT_ID },
          ':p': { S: 'AUDIT#IEMIS#' },
        },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    count += (res.Items ?? []).filter(
      (r: any) => r.metadata?.M?.studentId?.S === STUDENT_ID,
    ).length;
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return count;
}

async function resolveLogGroups(logs: CloudWatchLogsClient): Promise<string[]> {
  const resolved: string[] = [];
  for (const hint of LOG_GROUP_HINTS) {
    const res = await logs.send(
      new DescribeLogGroupsCommand({ logGroupNamePrefix: 'tenant-template-stack-basic' }),
    );
    const match = (res.logGroups ?? []).find((lg) => lg.logGroupName?.includes(hint));
    if (match?.logGroupName) resolved.push(match.logGroupName);
  }
  return resolved;
}

async function scanLogs(logs: CloudWatchLogsClient, group: string, pattern: string, sinceMs: number) {
  const res = await logs.send(
    new FilterLogEventsCommand({
      logGroupName: group,
      filterPattern: pattern,
      startTime: sinceMs,
      limit: 50,
    }),
  );
  return res.events ?? [];
}

// ── checks ─────────────────────────────────────────────────────────────────

async function main() {
  if (!ADMIN_TOKEN) {
    console.error('✗ ADMIN_TOKEN env var is empty. Export a fresh tenant-admin JWT first.');
    process.exit(2);
  }

  const ddb = new DynamoDBClient({ region: REGION });
  const cw = new CloudWatchClient({ region: REGION });
  const logs = new CloudWatchLogsClient({ region: REGION });

  console.log(`IEMIS Layer 4 @ ${REGION} (tenant ${TENANT_ID}, student ${STUDENT_ID.slice(0, 8)}…)\n`);

  const t0 = Date.now();

  // ── Negative tests ──
  console.log('— Negative tests —');

  // N1 — bad UUID on descriptor PATCH
  const n1 = await httpCall(
    'PATCH',
    '/academics/students/00000000-0000-0000-0000-000000000000/descriptors',
    { sexDescriptor: 'uri://ed-fi.org/SexDescriptor#Male' },
  );
  check('N1 — bad-UUID descriptor PATCH returns 404 (not 500)',
    n1.status === 404,
    { status: n1.status, body: n1.data });

  // N2 — Zod-malformed URI (wrong shape)
  const n2 = await httpCall(
    'PATCH',
    `/academics/students/${STUDENT_ID}/descriptors`,
    { sexDescriptor: 'uri://bad-shape' },
  );
  check('N2 — malformed descriptor URI returns 400 (Zod rejection)',
    n2.status === 400,
    { status: n2.status, body: n2.data });

  // N3 — non-URI string for descriptor
  const n3 = await httpCall(
    'PATCH',
    `/academics/students/${STUDENT_ID}/descriptors`,
    { sexDescriptor: 'not-even-a-uri' },
  );
  check('N3 — non-URI descriptor value returns 400',
    n3.status === 400,
    { status: n3.status, body: n3.data });

  // ── Stress test ──
  console.log('\n— Stress test —');

  const ITERS = 50;
  const stressStart = Date.now();
  const auditCountBefore = await countAuditRowsForStudent(ddb);

  let nonOk = 0;
  for (let i = 0; i < ITERS; i++) {
    // Flip between Male / Female so each iteration represents an actual change.
    const sex = i % 2 === 0
      ? 'uri://ed-fi.org/SexDescriptor#Male'
      : 'uri://ed-fi.org/SexDescriptor#Female';
    const r = await httpCall(
      'PATCH',
      `/academics/students/${STUDENT_ID}/descriptors`,
      { sexDescriptor: sex },
    );
    if (r.status !== 200) nonOk++;
  }
  const stressMs = Date.now() - stressStart;
  check(`S1 — ${ITERS}× PATCH /descriptors all returned 200`,
    nonOk === 0,
    { nonOkCount: nonOk, totalMs: stressMs, avgMs: Math.round(stressMs / ITERS) });

  // Let audit writes land (fire-and-forget pattern).
  await new Promise((r) => setTimeout(r, 3000));

  const auditCountAfter = await countAuditRowsForStudent(ddb);
  const landed = auditCountAfter - auditCountBefore;
  check(`S1 — ≥${ITERS} new student.descriptor.edited audit rows landed during stress`,
    landed >= ITERS,
    { landed, before: auditCountBefore, after: auditCountAfter });

  // ── Observability ──
  console.log('\n— Observability —');

  const logGroups = await resolveLogGroups(logs);
  if (logGroups.length === 0) {
    check('O0 — resolved CloudWatch log groups', false, 'No log groups matched hints');
  } else {
    console.log(`  resolved log groups: ${logGroups.map((g) => g.split('-').pop()).join(', ')}`);
  }

  // O1 — no iemis.audit.emit_failure lines in either log group since t0
  for (const lg of logGroups) {
    const events = await scanLogs(logs, lg, '"iemis.audit.emit_failure"', t0);
    const shortName = lg.split('-').slice(-2, -1)[0] ?? lg;
    check(`O1 — ${shortName}: no iemis.audit.emit_failure since stress start`,
      events.length === 0,
      events.length > 0 ? { count: events.length, first: events[0]?.message?.slice(0, 200) } : undefined);
  }

  // O2 — ERROR lines referencing /iemis or descriptors in the 2h BEFORE this
  // test run started. Scanning up to `now` would pick up our own intentional
  // N1-N3 4xx responses (Nest's GlobalExceptionFilter logs all 4xx at ERROR).
  // The 2h baseline window is what we care about for pre-existing failures.
  const twoHoursBeforeT0 = t0 - 2 * 60 * 60 * 1000;
  for (const lg of logGroups) {
    const events = await scanLogs(logs, lg, '?ERROR ?Exception', twoHoursBeforeT0);
    const relevantBeforeT0 = events.filter((e) => {
      if ((e.timestamp ?? 0) >= t0) return false;
      const msg = e.message ?? '';
      // Nest logs 4xx responses at ERROR via GlobalExceptionFilter and emits a
      // trailing `<ErrorClass>Exception: <msg>` stack line. Both are correct
      // behavior (client errors, not server failures), so exclude them.
      if (/GlobalExceptionFilter.*- 4\d\d/.test(msg)) return false;
      if (/^(NotFound|BadRequest|Unauthorized|Forbidden|Conflict|UnprocessableEntity)Exception:/.test(msg)) return false;
      return /iemis|descriptor|AUDIT#IEMIS/i.test(msg);
    });
    const shortName = lg.split('-').slice(-2, -1)[0] ?? lg;
    check(`O2 — ${shortName}: no ERROR/Exception referencing iemis/descriptor in the 2h before test start`,
      relevantBeforeT0.length === 0,
      relevantBeforeT0.length > 0
        ? { count: relevantBeforeT0.length, first: relevantBeforeT0[0]?.message?.slice(0, 200) }
        : { scannedInWindow: events.length });
  }

  // O3 — alarm state still OK
  const alarmRes = await cw.send(new DescribeAlarmsCommand({ AlarmNames: [ALARM_NAME] }));
  const alarm = alarmRes.MetricAlarms?.[0];
  check('O3 — edforge-iemis-audit-emit-failures-basic alarm is OK',
    alarm?.StateValue === 'OK',
    { state: alarm?.StateValue, reason: alarm?.StateReason });

  console.log(`\n${fails.length === 0 ? '✓ ALL LAYER 4 CHECKS GREEN' : `✗ ${fails.length} FAILURES`}`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('crash:', e?.message ?? e);
  process.exit(2);
});
