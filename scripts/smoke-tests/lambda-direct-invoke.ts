/**
 * Cost-redesign C1.8 — invoke the service Lambdas directly (no API Gateway
 * yet) with the recorded events under scripts/lambda-events and report the
 * status code, duration and cold-start Init Duration of every call.
 *
 *   ID_TOKEN=<cognito id token> [SCHOOL_ID=<uuid>] [TIER=basic] \
 *     npx tsx scripts/smoke-tests/lambda-direct-invoke.ts
 *
 * Without ID_TOKEN only the unauthenticated events run (health-live on all
 * three services, users-me without a header → 401). The caller needs
 * lambda:InvokeFunction on edforge-<svc>-<tier>-api.
 *
 * Each function is invoked twice for health-live: the first call reports
 * Init Duration when it lands on a fresh execution environment (the number
 * TARGET §1.3 estimates at 1.6–2.3 s), the second must reuse the cached
 * Nest app (no Init Duration, single-digit ms).
 */
import * as fs from 'fs';
import * as path from 'path';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const TIER = (process.env.TIER ?? 'basic').toLowerCase();
const ID_TOKEN = process.env.ID_TOKEN;
const SCHOOL_ID = process.env.SCHOOL_ID ?? '';
const EVENTS = path.resolve(__dirname, '../lambda-events');
const client = new LambdaClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

type Case = { svc: string; event: string; expect: number; auth: boolean };
const CASES: Case[] = [
  { svc: 'identity', event: 'health-live.json', expect: 200, auth: false },
  { svc: 'identity', event: 'health-live.json', expect: 200, auth: false },
  { svc: 'academics', event: 'health-live.json', expect: 200, auth: false },
  { svc: 'academics', event: 'health-live.json', expect: 200, auth: false },
  { svc: 'finance', event: 'health-live.json', expect: 200, auth: false },
  { svc: 'finance', event: 'health-live.json', expect: 200, auth: false },
  { svc: 'identity', event: 'users-me-unauthenticated.json', expect: 401, auth: false },
  { svc: 'identity', event: 'users-me.json', expect: 200, auth: true },
  { svc: 'academics', event: 'academics-students.json', expect: 200, auth: true },
  { svc: 'finance', event: 'finance-invoices.json', expect: 200, auth: true },
];

function loadEvent(name: string): string {
  const raw = fs.readFileSync(path.join(EVENTS, name), 'utf8');
  return raw.replace(/\$\{ID_TOKEN\}/g, ID_TOKEN ?? '').replace(/\$\{SCHOOL_ID\}/g, SCHOOL_ID);
}

function parseReport(logTail: string): { duration?: string; init?: string; memory?: string } {
  const report = logTail.split('\n').find((l) => l.startsWith('REPORT '));
  if (!report) return {};
  const pick = (re: RegExp) => report.match(re)?.[1];
  return {
    duration: pick(/\tDuration: ([\d.]+) ms/),
    init: pick(/Init Duration: ([\d.]+) ms/),
    memory: pick(/Max Memory Used: (\d+) MB/),
  };
}

async function main() {
  const rows: string[] = [];
  let failures = 0;
  for (const c of CASES) {
    if (c.auth && !ID_TOKEN) {
      rows.push(`${c.svc.padEnd(10)} ${c.event.padEnd(32)} SKIP (no ID_TOKEN)`);
      continue;
    }
    const fn = `edforge-${c.svc}-${TIER}-api`;
    const t0 = Date.now();
    const out = await client.send(
      new InvokeCommand({ FunctionName: fn, Payload: Buffer.from(loadEvent(c.event)), LogType: 'Tail' }),
    );
    const wall = Date.now() - t0;
    const body = out.Payload ? Buffer.from(out.Payload).toString('utf8') : '';
    let status: number | string = 'n/a';
    let snippet = '';
    try {
      const parsed = JSON.parse(body) as { statusCode?: number; body?: string; errorMessage?: string };
      status = parsed.statusCode ?? parsed.errorMessage ?? 'no statusCode';
      snippet = (parsed.body ?? '').slice(0, 80).replace(/\s+/g, ' ');
    } catch {
      snippet = body.slice(0, 80);
    }
    const rep = parseReport(out.LogResult ? Buffer.from(out.LogResult, 'base64').toString('utf8') : '');
    const ok = status === c.expect && !out.FunctionError;
    if (!ok) failures++;
    rows.push(
      `${c.svc.padEnd(10)} ${c.event.padEnd(32)} ${ok ? 'PASS' : 'FAIL'} status=${String(status).padEnd(4)} ` +
        `wall=${String(wall).padStart(5)}ms dur=${(rep.duration ?? '?').padStart(8)}ms init=${(rep.init ?? '-').padStart(8)}ms ` +
        `mem=${rep.memory ?? '?'}MB${out.FunctionError ? ` fnError=${out.FunctionError}` : ''}${ok ? '' : ` :: ${snippet}`}`,
    );
  }
  console.log(rows.join('\n'));
  console.log(`\n${CASES.length - failures}/${CASES.length} passed`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
