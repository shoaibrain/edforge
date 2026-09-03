/**
 * Invoke a built service bundle with a recorded API Gateway event, locally
 * (cost-redesign C1.5).
 *
 *   npx ts-node scripts/invoke-local.ts <identity|academics|finance> <event.json> [more events…]
 *
 * Runs server/application/dist-lambda/<svc>/index.js (build it first with
 * scripts/build-lambda.sh) in this process with EDFORGE_RUNTIME=lambda and
 * prints status, headers and body per event. `${ID_TOKEN}` and `${SCHOOL_ID}`
 * placeholders inside the fixture are substituted from the environment, so a
 * real token can be used against real AWS (with credentials in the ambient
 * chain) without ever landing in a file.
 */
import * as fs from 'fs';
import * as path from 'path';

async function main(): Promise<void> {
  const [svc, ...events] = process.argv.slice(2);
  if (!svc || events.length === 0) {
    console.error('usage: invoke-local.ts <identity|academics|finance> <event.json> [more…]');
    process.exit(2);
  }
  process.env.EDFORGE_RUNTIME = 'lambda';
  const bundle = path.resolve(__dirname, `../server/application/dist-lambda/${svc}/index.js`);
  if (!fs.existsSync(bundle)) {
    console.error(`bundle not found: ${bundle} — run scripts/build-lambda.sh ${svc}`);
    process.exit(2);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { handler } = require(bundle);

  const context = {
    callbackWaitsForEmptyEventLoop: false,
    functionName: `edforge-${svc}-local`,
    awsRequestId: `local-${Date.now()}`,
    getRemainingTimeInMillis: () => 29_000,
  };

  let failed = 0;
  for (const file of events) {
    const raw = fs.readFileSync(path.resolve(file), 'utf8')
      .replace(/\$\{ID_TOKEN\}/g, process.env.ID_TOKEN ?? '')
      .replace(/\$\{SCHOOL_ID\}/g, process.env.SCHOOL_ID ?? '');
    const event = JSON.parse(raw);
    const started = Date.now();
    const res = await handler(event, context);
    const ms = Date.now() - started;
    const body = typeof res.body === 'string' ? res.body.slice(0, 400) : res.body;
    console.log(`\n${event.httpMethod} ${event.path} → ${res.statusCode} (${ms} ms)`);
    console.log(JSON.stringify(res.headers ?? {}, null, 0).slice(0, 300));
    console.log(body);
    if (res.statusCode >= 500) failed += 1;
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
