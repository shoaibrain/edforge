# TARGET_ARCHITECTURE — compute and routing (Q1, Q2)

> **Status: draft, step 1 of Phase 2.** This file currently answers the two
> questions everything else depends on: how NestJS runs per request (Q1) and what
> replaces the rproxy, ALB and NLB (Q2). The diagram, Q3 (SBT), Q4 (finance
> background work), Q5 (isolation chain), the full request path, the complete cost
> table and the "what bills at idle" section are added in the next step once these
> two answers are accepted.

Every number below is either measured in this repo (§1.3) or a published
`ap-south-1` list price with the source named. The design point is the August
bill: ~570 API Gateway requests in the month.

---

## 1. Q1 — How NestJS runs per request

### 1.1 The three options

| | A. One Lambda per service, Nest app cached outside the handler (`@codegenie/serverless-express`) | B. Lambda Web Adapter (LWA) running the unmodified Nest HTTP server | C. Per-route Lambdas |
|---|---|---|---|
| Deployment units | 3 | 3 | 279 paths → ~280 functions |
| Code change in the service | one new entry file per service (~40 lines); `main.ts` untouched for local dev | none in the app; `PORT`/readiness env vars only | every controller split into a handler; DI graph fragmented |
| Nest bootstrap per cold start | once per execution environment | once per execution environment | once per environment, but 280× more environments to warm |
| Request path inside the function | API GW event → in-process Express `req`/`res` | API GW event → LWA extension → `localhost:8080` HTTP → Nest | event → handler |
| Extra moving part | one npm dependency (TypeScript, in-repo) | a Lambda layer published by AWS Labs, pinned by ARN (`…:753240598075:layer:LambdaAdapterLayerX86:28`), a Rust binary you do not build | none |
| CFN resource count | ~5 per service | ~5 per service | Function + Permission + LogGroup + Version per route ≈ 1,100 resources; over the 500-per-stack limit, so at least three new stacks |
| Cold-start overhead beyond Nest itself | ≈ 0 (in-process) | + LWA readiness poll of `/health` (10–50 ms) + one loopback HTTP hop per request | none, but a cold start on *every* route the operator touches for the first time that hour |
| Local development | `nest start:dev` unchanged | unchanged | a new local harness |
| Idle cost | $0 | $0 | $0 |

**Recommendation: A.** The reasons, in order of weight:

1. **It is the smallest change that keeps everything in TypeScript.** Option B is
   attractive because `main.ts` stays byte-identical, but it buys that with an
   opaque binary in a layer whose version is pinned by ARN outside the CDK
   dependency graph, a second process to reason about when debugging a frozen
   environment, and a loopback hop on every request. Option A's entry file is ~40
   lines and the same three services keep the same `main.ts` for local runs.
2. **The DI container survives exactly as far as it needs to.** Nest's singleton
   providers live in the cached app for the lifetime of the execution environment
   (minutes to hours between requests at this load). That is the same lifetime
   semantics as one ECS task, minus the guarantee — which is why Q4 has to move the
   correctness-bearing state (locks, 202 hand-offs) out of process regardless.
3. **Option C is rejected, not deferred.** It gives no idle-cost benefit (three
   functions and 280 functions both cost $0 when idle), multiplies cold starts by
   the number of distinct routes an operator touches, and turns the route-drift
   check into a 280-way deployment mapping. The only argument for it — smaller
   bundles per route — is worth ~100 ms of code-load time, and it costs the DI
   graph. If a single route ever needs its own scaling or memory profile (the bulk
   PDF workers in Q4 are that case) it gets its own function *as a worker*, not as
   an HTTP route.

Option B is the documented fallback: if bundling (§1.4) turns out to fight a
dependency we cannot externalise, LWA runs the `nest build` output with
`node_modules` unbundled and nothing else changes in this design.

### 1.2 What changes in each service

`main.ts` stays as it is and keeps serving `npm run start:dev:<svc>` and the
compose file. Each service gains one file:

```ts
// server/application/microservices/identity/src/lambda.ts
import serverlessExpress from '@codegenie/serverless-express';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { IdentityModule } from './identity.module';
import { configureApp } from './app-setup';   // the middleware/pipes/filters/CORS block lifted out of main.ts

let cached: ReturnType<typeof serverlessExpress> | undefined;

async function build() {
  const expressApp = express();
  const app = await NestFactory.create(IdentityModule, new ExpressAdapter(expressApp), { logger });
  configureApp(app);          // same calls main.ts makes today, minus compression()
  await app.init();           // no listen()
  return serverlessExpress({
    app: expressApp,
    binarySettings: { contentTypes: ['application/pdf', 'application/zip', 'application/octet-stream'] },
  });
}

export const handler = async (event, context) => {
  cached ??= await build();
  return cached(event, context);
};
```

The only refactor is mechanical: the `app.use(...)`, `useGlobalFilters`,
`useGlobalPipes`, `HealthService.registerDependencies` and `enableCors` calls move
from `bootstrap()` into a shared `configureApp(app)` that both entry points call.
Three things in that block change meaning under Lambda:

- **`compression()` is dropped in the Lambda entry.** API Gateway REST compresses
  responses itself when `minimumCompressionSize` is set on the API, and a gzip
  body from the function would have to be base64-encoded through the proxy
  contract. Keep it in `main.ts` for local parity if desired; it is inert either way.
- **`onModuleInit` timers must not start in Lambda.** Finance's four `setInterval`
  services (and the three 5-second metrics flush timers) already have
  `DISABLE_*` gates for two of them; the Lambda entry sets a single
  `EDFORGE_RUNTIME=lambda` environment variable and the timer services skip
  `onModuleInit` when it is present. Lambda freezes the environment between
  invocations, so an interval timer neither fires on schedule nor is safe to rely
  on; Q4 replaces them with EventBridge Scheduler. `@codegenie/serverless-express`
  sets `callbackWaitsForEmptyEventLoop = false`, so a stray timer cannot hang a
  response, but it would fire mid-invocation and bill duration for nothing.
- **Metrics flush becomes end-of-invocation.** `FinanceMetricsService` batches
  `PutMetricData` on a timer; under Lambda the idiomatic replacement is CloudWatch
  Embedded Metric Format written to the function log (zero extra API calls, no
  timer, no lost batch when the environment is reaped). This is a Q4 item; until
  it lands the flush timer is simply disabled and the metrics are absent, which is
  acceptable at 570 requests a month.

### 1.3 Cold-start analysis, measured

The estimate is built from a bundling spike run against this worktree's source,
not from folklore. Method: compile all three services with `tsc` (decorator
metadata intact), bundle the emitted JavaScript with esbuild
(`--platform=node --target=node20 --keep-names`, `sharp`/`@img/*` external),
minify, then time `node --require preload.js bundle.min.js` where the preload
records the moment the HTTP server reaches `listening` and exits.

| Service | Bundle input | Minified | Zipped | Time to `listen` (Apple M4, Node 22, 3 runs) | RSS at listen |
|---|---:|---:|---:|---|---:|
| identity | 14.2 MB (26 modules, 31 controllers, 34k LOC) | 8.1 MB | 2.0 MB | 634 / 562 / 570 ms | 211 MB |
| academics | 13.8 MB (17 modules, 21 controllers, 36k LOC) | 7.7 MB | 1.9 MB | 546 / 538 / 536 ms | 203 MB |
| finance | 15.8 MB (14 modules, 14 controllers, 28k LOC) | 8.7 MB | 2.2 MB | 601 / 629 / 679 ms | 221 MB |

Top contributors to every bundle are the same: `@aibrains/shared-types` (~1.7 MB
across its two resolution paths), `pdf-lib` + `@react-pdf/*` + `fontkit` + `brotli`
(~3.3 MB, pulled in by `@aibrains/pdf-renderer` even in academics, which only
imports it transitively through `identity-client.service.ts`), `@nestjs/swagger`
(561 KB, decorators only — the UI is never mounted), `libphonenumber-js` (520 KB),
and the AWS SDK v3 clients. `sharp` is declared in `package.json` but imported
nowhere in `microservices/` or `libs/`; it is excluded from the bundle rather than
shipped as a 15 MB native binary.

Converting to Lambda. A single Lambda vCPU (allocated in full at 1,769 MB) is
roughly half the single-thread speed of the M4 the spike ran on, so the 0.55–0.68 s
measured becomes ~1.1–1.4 s of Nest bootstrap. To that, add the pieces the local
run does not include:

| Phase | 1,769 MB | 1,024 MB (≈0.58 vCPU) | Source |
|---|---|---|---|
| Runtime init (Node.js managed runtime) | 0.15–0.25 s | 0.15–0.25 s | AWS-published Node.js init range |
| Code load: unzip 2 MB → parse 8 MB minified JS | 0.2–0.4 s | 0.3–0.6 s | scales with CPU share |
| Nest bootstrap (measured × ~2) | 1.1–1.4 s | 1.9–2.4 s | §1.3 spike |
| First JWKS fetch (`jwks-rsa`, cached per environment) | 0.1–0.2 s | 0.1–0.2 s | one HTTPS round trip to `cognito-idp` |
| serverless-express first request | < 0.02 s | < 0.02 s | in-process |
| **Cold start, total** | **≈ 1.6–2.3 s** | **≈ 2.5–3.5 s** | |
| Warm request overhead | < 5 ms | < 5 ms | |

The authorizer adds its own cold start when both are cold (Python 3.10 + `jose`,
typically 0.3–0.6 s); it is unchanged by this design but its runtime must move off
`python3.10` before 2026-10-31 (§1.6).

**Memory setting: 1,769 MB for all three functions.** It is the smallest size that
allocates a whole vCPU, which is what a CPU-bound bootstrap wants; RSS at listen is
~210 MB, so 1,024 MB would also fit but costs ~1 s more per cold start for a saving
of ~$0.000003 per warm request. At 570 requests a month the memory setting has no
visible cost consequence either way (§3), so it is chosen for latency.

**Where a cold start lands, at endpoint level.** With ~570 requests a month and an
execution environment reaped after roughly 5–15 idle minutes, most working
sessions start cold. The first request of a session is almost always
`POST /auth/login` (identity) followed by `GET /users/me` and the settings loads,
so the operator sees one ~2 s pause at login and warm responses afterwards; the
first `/academics/*` or `/finance/*` request of the session cold-starts that
service once. Endpoint classes:

| Class | Endpoints | Cold-start tolerance |
|---|---|---|
| Interactive first-touch | `POST /auth/login`, `GET /users/me`, `GET /tenants/my/settings`, dashboard loads | Fine: one visible pause per session, product owner has accepted this |
| Interactive, already-warm service | all other `GET`/`PATCH` CRUD | Fine: warm |
| Synchronous PDF render (`GET /finance/.../pdf`, receipt PDF, identity template preview) | `@react-pdf` render ~0.2–0.5 s on top of a possible 2 s cold start | Fine, but these are the requests closest to the 29 s API Gateway ceiling only under a pathological render; today they take < 1 s warm |
| `202` bulk jobs (`POST …/invoices/bulk-generate`, `…/bulk-pdf-export`, `…/receipts/bulk-pdf-export`, IEMIS import) | the 202 itself is fast; the work after it is the Q4 problem | Not a cold-start question; a correctness one |
| CSV streams (invoices, payments, enrollments) | generated row by row through `res` | Buffered by serverless-express; fine up to the 6 MB Lambda response cap, above which the response fails (RISKS.md) |
| Cognito-gated writes on login (`AdminInitiateAuth`) | Cognito round trip ~100–300 ms | Unchanged |

There is no endpoint where a 1–3 s first-request delay is unacceptable *at current
adoption*; the two that would become unacceptable first as usage grows are login
(every session pays it) and the parent-facing payment verification callback from
eSewa/Khalti (`POST /finance/payments/verify`), because a gateway redirect that
waits 3 s looks broken to a parent. SCALE_PATH.md carries the threshold at which
that argues for keeping one environment warm, and RISKS.md carries the failure mode.

### 1.4 Packaging: how the bundle is produced

NestJS depends on `emitDecoratorMetadata`, which esbuild does not implement, so
`NodejsFunction`'s "bundle the TypeScript with esbuild" default would silently
break constructor injection. The build is therefore two steps, both of which the
spike executed:

1. `nest build <svc>` (unchanged; `tsc` emits `__metadata("design:paramtypes", …)`),
   then
2. `esbuild dist/microservices/<svc>/src/lambda.js --bundle --platform=node
   --target=node22 --minify --keep-names --external:sharp --external:@img/*` plus
   externals for Nest's optional peer packages, writing
   `server/application/dist-lambda/<svc>/index.js`.

CDK consumes the output with `lambda.Code.fromAsset('server/application/dist-lambda/<svc>')`
in the tenant-template stack. Step 2 is a new `scripts/build-lambda.sh` alongside
`build-application.sh`; the deploy wrapper calls it where it calls the Docker
build today. The `service-info.txt` → `service-info.json` regeneration that guards
task definitions keeps guarding the function environment, since the same JSON
supplies the environment map.

Bundling facts from the spike that the build must encode: `@app/*` path aliases
resolve via `--alias`; the two holiday JSON files under `identity/src/data` are
loaded with `require('./np-….json')` and must be copied into `dist` (`nest-cli`
assets, which `tsc` alone does not do); nothing in the three services uses a native
module once `sharp` is excluded.

Runtime: **`nodejs22.x`** (or `nodejs24.x`). `nodejs20.x`, which every existing
Node.js Lambda in this account uses (`result-batch`, the seven analytics functions,
the post-auth trigger), was deprecated on 2026-04-30 and blocks function creation
from 2027-02-01. `@codegenie/serverless-express` 4.17.1 supports Node ≥ 18; 5.0.0
requires Node ≥ 24. Pin 4.17.1 with `nodejs22.x` now; moving to 24 later is a
runtime-identifier change.

### 1.5 Local development afterwards

Unchanged for the daily loop: `npm run start:dev:<svc>` still runs `main.ts` with a
real listener, the compose file still works, tests still import modules directly.
Two additions:

- `npm run build:lambda:<svc>` produces the bundle locally and a ten-line
  `scripts/invoke-local.ts` feeds it a recorded API Gateway proxy event, so the
  serverless-express path can be exercised without a deploy (this is what caught
  the JSON-asset gap in the spike).
- `EDFORGE_RUNTIME=lambda` can be set locally to run `main.ts` with timers off,
  which is the configuration that matters after Q4.

What gets worse (RISKS.md expands on these): no `docker compose up` parity for the
proxy-event path, and an ECS-Exec shell into a running task is gone — a frozen
Lambda environment cannot be entered.

### 1.6 Things Q1 surfaces that are not about cost

- Existing Node.js Lambdas are on a deprecated runtime (`nodejs20.x`, deprecated
  2026-04-30). The authorizer is on `python3.10` (deprecated 2026-10-31). Both are
  independent of this redesign and should ride the same migration PRs.
- `sharp` is a dead dependency in `server/application/package.json`.
- Academics bundles `@react-pdf` because `identity-client.service.ts` imports
  `@aibrains/pdf-renderer` types; a type-only import would drop ~3 MB from that
  bundle. Cosmetic at this load.

---

## 2. Q2 — What replaces the rproxy, the ALB and the NLB

### 2.1 Where the routing knowledge already lives

Today a request crosses three routers that each know the same thing:

- API Gateway: 279 paths, every one a `http_proxy` integration to
  `http://${stageVariables.nlbDns}<path>` through the VPC Link, with the
  authorizer's `tenantPath` context copied into a header;
- the ALB listener rule: forwards on `tenantPath == "basic"` (the tier, not a tenant)
  to the rproxy target group;
- nginx: 18 `location ~ ^/<prefix>` blocks mapping prefix → `identity-api`,
  `academics-api`, or `finance-api` on Service Connect DNS, plus a per-prefix
  method allow-list returning 405 and a catch-all that serves a static page.

The nginx prefix → service map is 18 lines of information. Everything else the two
load balancers do exists only because API Gateway REST cannot reach a private IP
without a VPC Link, and a VPC Link can only target an NLB. Once the services are
Lambdas, API Gateway can invoke them directly and all three hops delete.

### 2.2 The change to the OpenAPI spec

Each of the 408 proxied operations changes its integration block from

```json
"x-amazon-apigateway-integration": {
  "type": "http_proxy", "httpMethod": "ANY",
  "uri": "{{integration_uri}}/schools",
  "connectionType": "VPC_LINK", "connectionId": "{{connection_id}}",
  "requestParameters": { "integration.request.header.tenantPath": "context.authorizer.tenantPath" },
  "passthroughBehavior": "when_no_match"
}
```

to

```json
"x-amazon-apigateway-integration": {
  "type": "aws_proxy", "httpMethod": "POST",
  "uri": "arn:aws:apigateway:{{region}}:lambda:path/2015-03-31/functions/arn:aws:lambda:{{region}}:{{account_id}}:function:${stageVariables.identityFn}/invocations",
  "passthroughBehavior": "when_no_match"
}
```

with `identityFn` / `academicsFn` / `financeFn` chosen by top-level prefix — the
same 18-line map nginx holds, now expressed once. The 279 `MOCK` `OPTIONS`
operations, the `security` blocks, the two unauthenticated operations and the
authorizer definition do not change.

Why stage variables again: the R41.A work already proved the pattern for the
authorizer function name — a stage variable in the function-name slot of a Lambda
integration URI is documented and supported, keeps every CDK token out of the
spec body (so `shared-infra-stack` stays under the CFN template limit), and lets
the same spec asset serve any environment. The three new stage variables are set
from the functions' names exactly as `authorizerFn` is today
([api-gateway.ts:266-270](../../../server/lib/shared-infra/api-gateway.ts#L266)).
Each function grants `lambda:InvokeFunction` to `apigateway.amazonaws.com` with a
source ARN of `arn:aws:execute-api:<region>:<account>:<restApiId>/*/*/*` — the
documented requirement for stage-variable-resolved functions, which the console
prompts for and CDK expresses as `fn.addPermission`.

Two spec-level additions:

- `x-amazon-apigateway-binary-media-types: ["application/pdf", "application/zip",
  "application/octet-stream"]` at the root, so the receipt/invoice PDF responses
  (`res.send(buffer)` at `payments.controller.ts:336`, `invoices.controller.ts:683`)
  and the identity template preview survive the proxy contract; serverless-express
  base64-encodes exactly those content types.
- `minimumCompressionSize` on the REST API (CDK `minCompressionSize`) to replace the
  in-process `compression()` middleware.

Nothing about `tenantPath` survives, and nothing needs it: the services derive the
tenant from the JWT (`libs/auth/src/jwt.strategy.ts`), and the pooled BASIC stack
was the only value the header ever carried.

### 2.3 Stage variable vs. one integration per function

There is a real alternative to stage variables: put the three function ARNs into
the spec at synth time as literals, the way `{{region}}` and `{{account_id}}` are.
It removes the per-request stage-variable lookup (unmeasurable) and makes the
deployed spec self-describing in the console. It costs the R41.A headroom
argument: a function ARN is a CDK token unless the function name is fixed, and
fixing `functionName` is the exact change that triggered the 2026-05-23 export-lock
incident on the authorizer. Stage variables are recommended because they are the
pattern this codebase already paid to learn.

### 2.4 The route-drift linter becomes two-way, and stronger

`scripts/check-route-drift.ts` today walks every `*.controller.ts`, joins
`@Controller` prefix + method path, and requires a matching key in
`tenant-api-prod.json` (it never validated nginx; the "third way" was a convention
enforced by 404s). Under the new design:

1. **Nest → spec (kept):** every controller route has a path in the spec.
2. **Spec → function (new):** for every non-`OPTIONS` operation, the integration
   URI's stage variable must be the function of the service whose controller
   directory declares the route (`microservices/identity/**` → `identityFn`, …).
   This is the check that nginx's prefix table used to embody, and it is now
   enforced at lint time instead of discovered as a 404 after deploy.
3. **No residue (new):** no operation may still carry `VPC_LINK`, `connectionId`,
   or a `tenantPath` request parameter.
4. **Spec → Nest (new, cheap now):** every spec path has a controller; the script
   already notes it "doesn't validate the inverse".

The nginx template, `Dockerfile.rproxy`, the rproxy task role and its `/parents →
501` stub retire with the ALB rule. The `location = /health` handler is replaced by
nothing: there is no load balancer left to health-check, and each service's
`/health` route remains for the smoke tests.

### 2.5 REST API vs HTTP API

| | REST API (today) | HTTP API |
|---|---|---|
| Price per million requests (Mumbai) | $3.50 | $1.00 |
| Cost at 570 requests/month | $0.0020 | $0.0006 |
| Usage plans + API keys (tier throttling: basic 50 rps / 25,000 per day) | yes, `apiKeySource: AUTHORIZER`, key returned by the authorizer as `usageIdentifierKey` | no usage plans, no API keys |
| Lambda authorizer | TOKEN authorizer, 30 s result cache, in place | must be rewritten as a v2 REQUEST authorizer (payload format 2.0, "simple response") |
| OpenAPI import | `SpecRestApi` from the 279-path spec, stage variables, request validators | v2 import; no stage variables for integration targets, different extension vocabulary; the spec is rewritten, not edited |
| `MOCK` CORS preflight | 279 operations in the spec | replaced by the built-in CORS config (simpler, but a different behaviour to re-verify) |
| Analytics stack's 5 routes | attached to this REST API by import | must move |
| Response payload cap | 10 MB (6 MB through Lambda proxy) | 10 MB (6 MB through Lambda proxy) |
| Integration timeout | 29 s, raisable by quota request | 30 s, fixed |

**Recommendation: REST stays.** The per-request saving is $0.0014 a month at the
design point and would be $1.40 a month at a thousand times the traffic. Against
that, HTTP API forces a rewrite of the authorizer, a re-import of the whole spec,
a move of the analytics routes, and the loss of the one mechanism that expresses
"tier" at the edge. The tier mechanism *could* move into the authorizer's returned
context (the authorizer already knows the tier from the JWT; a v2 authorizer can
return `{ tier: "basic" }` and the function can throttle on it), but that turns an
API Gateway feature that costs nothing into application code that has to be
written, tested and kept consistent across three services. At current load the
migration risk dominates and the money does not exist. Revisit only when SCALE_PATH
says request volume makes $2.50 per million matter, which it never does before
the Lambda/Fargate crossover.

### 2.6 What Q2 removes and what it keeps

Removed from `shared-infra-stack`: the NLB, its listener and target group, the
VPC Link, the `vpcLinkId`/`nlbDns` stage variables. Removed from
`tenant-template-stack-basic`: the ALB listener rule and target group, the rproxy
service, task definition, image and role, the Service Connect namespace, the ECS
security group's ALB ingress. Removed from the *shared* stack only after the
tenant stack stops importing them: the ALB itself and its security group
(`ALBDnsName`, `ALBArn`, `AlbSgId`, `ListenerArn` are live CFN exports consumed by
`services.ts:40-46`), which is why the ALB deletes one PR after the ECS services do
(MIGRATION_PLAN.md). Kept unchanged: the REST API, its stage, the authorizer, usage
plans, API keys, the analytics routes, the `MOCK` preflight handlers, the CORS
origin list, and the two unauthenticated operations.

---

## 3. Cost of this piece alone (Q1 + Q2), at the August design point

Unit prices: Lambda `ap-south-1` x86 $0.0000166667 per GB-second (AWS Price List
API, `APS3-Lambda-GB-Second`) and $0.20 per million requests; the compute free tier
(1 M requests + 400,000 GB-s per month) is the always-free tier, not the 12-month
one. API Gateway REST $3.50 per million (pricing page lists Mumbai in the $3.50
tier). Init duration is billed for managed runtimes, so cold starts are counted.

Assumptions: 570 requests; every working session starts cold, call it 60 cold
starts a month; 1,769 MB; cold invocation ≈ 2.5 s billed (init + first request),
warm invocation ≈ 100 ms.

```
Cold:  60 × 1.769 GB × 2.5 s  = 265 GB-s
Warm: 510 × 1.769 GB × 0.1 s  =  90 GB-s
                        total = 355 GB-s  × $0.0000166667 = $0.0059
Requests: 570 × $0.20 / 1,000,000                         = $0.0001
Lambda before free tier                                    = $0.0060 ;  after free tier = $0.00
API Gateway REST: 570 × $3.50 / 1,000,000                  = $0.0020
CloudWatch Logs (function logs, ~50 MB): 0.05 × $0.57      = $0.03
S3 for three ~2 MB deployment zips                          < $0.01
                                     Q1 + Q2 monthly total ≈ $0.04   (≈ $0.05 without the free tier)
Idle (no requests):                                          $0.00
```

What this replaces: four Fargate tasks $77.20 + ALB and NLB $35.56 + NAT and EIP
$45.38 (the NAT exists only for VPC-resident compute; Lambda outside the VPC reaches
DynamoDB, STS, Cognito, EventBridge and the payment gateways with no NAT) =
**$158.14/month → ≈ $0.04/month**, and the idle cost of the request path goes from
$158.14 to $0.

The remaining fixed items (advanced-stack ASG, dashboard, alarms, SBT KMS keys) are
not touched by Q1/Q2 and are handled in the deletions and Q3.

---

## 4. Q3–Q5 decisions (summary; encoded in MIGRATION_PLAN.md §0)

- **Q3 — SBT:** posture 2. Keep the SBT control plane (HTTP API, admin Cognito
  pool, tenant registry tables, event bus, AdminWeb, tenant-seeder); replace both
  CodeBuild `ScriptJob`s with two Lambdas that consume `onboardingRequest` /
  `offboardingRequest` and emit `provisionSuccess` / `deprovisionSuccess` in SBT's
  envelope. BASIC provisioning is three Cognito calls and an SNS topic
  (`provision-tenant.sh:197-262`); the ScriptJobs' two unconditional KMS keys are
  the last dependency-imposed fixed cost. The silo-tier script path stays in the
  repo behind `CDK_PARAM_SBT_SCRIPT_JOBS`. Posture 3 (remove SBT) was rejected:
  it rebuilds the registry, admin auth and the event flow to save nothing more.
- **Q4 — finance background work:** EventBridge Scheduler → a `scheduled.ts` entry
  that boots the cached Nest app and calls `runOnce()` on the existing services,
  guarded by a DynamoDB run-lease row per job window; the three `202` hand-offs
  and the academics IEMIS import move to an SQS queue per service with a
  `worker.ts` entry reusing the existing worker classes (batch 1, `maxConcurrency`
  2, visibility ≥ function timeout, DLQ); `PerSchoolLock` becomes a conditional
  `PutItem` lock with TTL and a fencing token in the service's own table; the
  bulk-PDF worker runs at 3,008 MB / 900 s with fan-out designed but built only
  if measured above half the ceiling. The read-through caches are recomputed;
  none moves to DynamoDB (all are caches over DynamoDB or the identity API, and a
  shorter per-environment lifetime makes the session-revocation cache strictly
  more correct).
- **Q5 — isolation:** the chain `custom:tenantId` claim
  (`identity-provider.ts:84-96`) → JWT verified by `libs/auth/jwt.strategy.ts`
  → `TokenVendingMachine.assumeRole` with `Tags:[{tenant}]`
  (`libs/auth/token-vending-machine.ts`) → ABAC role policy
  `dynamodb:LeadingKeys = ${aws:PrincipalTag/tenant}` (`ecs-dynamodb.ts:321-343`)
  → partition key `tenantId` is unchanged. The only change is the principal that
  is trusted to assume the ABAC role: the Lambda execution role instead of the ECS
  task role, with the identical `sts:AssumeRole` + `sts:TagSession` grant and
  `aws:RequestTag/tenant` condition (`tenant-template-stack.ts:580-605`). The
  Lambda authorizer is untouched. No link weakens.

## 5. Open items carried into the next step

- The full request-path trace in the Phase 1 §5 format, the diagram, the complete
  cost table, and the "what bills at idle" section.
- The endpoint-level 29-second and 6 MB proximity audit (RISKS.md).
