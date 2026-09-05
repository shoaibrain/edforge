# Cost redesign — measurements

Numbers observed on the deployed system, recorded per sprint so the estimates
in `TARGET_ARCHITECTURE.md` can be checked against reality. Every figure here
comes from a CloudWatch `REPORT` line or a CloudFormation event; nothing is
extrapolated.

## Sprint 1 — service Lambdas beside ECS (2026-09-04)

Deployed by `scripts/deploy.sh tenant-template-stack-basic prod --exclusively`
with `CDK_PARAM_LAMBDA_SERVICES=true`. CloudFormation update 83 s; ECS
services untouched (same task definitions and deployment timestamps before
and after). Functions: `nodejs22.x`, x86_64, 1,769 MB, 29 s, outside the VPC.

### Package sizes

| Service | Bundle (minified, on disk) | Deployment package (zipped) | Layers |
|---|---|---|---|
| identity | 7.6 MiB | 2.0 MiB | — |
| academics | 7.2 MiB | 1.9 MiB | — |
| finance | 8.1 MiB | 2.2 MiB | sharp (linux-x64, 17 MiB unzipped) |

### Cold and warm invocations (`GET /health/live`, direct invoke)

| Service | Init Duration (module load) | First-request Duration (Nest bootstrap + request) | Cold total | Warm Duration | Max memory |
|---|---|---|---|---|---|
| identity | 1,833 ms | 269 ms | ≈ 2.10 s | 4.1 ms | 301 MB |
| academics | 1,763 ms | 238 ms | ≈ 2.00 s | 5.8 ms | 310 MB |
| finance | 1,631 ms | 287 ms | ≈ 1.92 s | 4.8 ms | 333 MB |

- **Estimate check.** `TARGET_ARCHITECTURE.md` §1.3 estimated 1.6–2.3 s cold
  from the 0.54–0.68 s local bootstrap. Measured cold totals 1.92–2.10 s sit
  inside the band. The split is worth knowing: ~85% of the cold start is
  loading the bundle (decorators executing at module scope), not
  `NestFactory.create`.
- **Memory.** Peak 301–333 MB against 1,769 MB allocated. The allocation is
  for the vCPU, not the memory; halving it would halve CPU and roughly double
  the cold start. Revisit only if warm latency stays this low under real
  traffic (C8).
- **Warm.** 4–6 ms handler duration; wall time from a laptop in another
  region was 300–460 ms, i.e. network dominated.
- **Billed cold start.** 1.9–2.1 s billed on the first invocation of each
  environment (Init Duration is billed on `nodejs22.x`).
- **Guarded route without a token:** 401 in 6 ms from the passport guard, no
  JWKS fetch.

### Authenticated invocations (operator-minted dev-tenant ID token, warm environments)

| Case | Result | Duration | What it proves |
|---|---|---|---|
| identity `GET /users/me` | 200, `tenantId` equals the token's | 248–271 ms | JWT verified against the pool from the shared default environment; TVM assumed the identity ABAC role with the `tenant` session tag (CloudTrail); DynamoDB read under it |
| academics `GET /academics/students?schoolId=` | 200 | 84–278 ms | same chain on the academics role (CloudTrail shows the tagged AssumeRole) |
| finance `GET /finance/jobs/<random id>` | 404 naming the job | 92 ms | finance table read under the tenant-scoped role returned a definitive not-found; no identity round-trip on this route |
| finance `GET /finance/schools/<id>/invoices` | 404 from the permission guard | 3.5 s | **F1.1**: the guard asks identity over HTTP at the Cloud Map URL, unreachable from outside the VPC, and fails closed. Expected until Sprint 2 gives the services a public base URL |

The first-request durations above include the per-invocation `AssumeRole`
(the TVM caches nothing across tenants), which is the 200–250 ms floor an
authenticated warm request pays today; C8 revisits credential caching.

## Sprint 2 — API-B (strangler REST API) in front of the functions (2026-09-04)

Direct-invoke numbers above become end-to-end numbers here: API Gateway +
TOKEN authorizer (30 s cache) + `aws_proxy` + serverless-express + Nest.
Window: the C2.8 smoke run (identity, golden thread, academics, finance
suites plus manual probes), 124 requests in 40 minutes, from a laptop in
another region.

### API-B (CloudWatch `AWS/ApiGateway`, `ApiName=TenantAPILambda`)

| Metric | p50 | p90 | p99 | max |
|---|---|---|---|---|
| Latency (edge to client, ms) | 79 | 296 | 2,425 | 3,115 |
| IntegrationLatency (Lambda side, ms) | 71 | 337 | 2,434 | 2,612 |

- 5XX: **0** of 124. 4XX: 24, all expected by the suites (400 validation,
  401 without a token, 403 on `/health` paths that are in neither API's
  spec, 404/409 fixture states).
- The p99 is the cold start (≈ 2 s Init + first request), the same figure
  the Sprint 1 direct invokes measured; a warm request through the whole
  chain costs ~70–80 ms at the integration and ~80 ms end to end.
- The finance prefix rides the VPC link to ECS: `GET .../invoices` 576 ms
  end to end from the laptop, i.e. the same path API-A uses.

### Response sizes (API-B access logs, same window)

Largest response 8.2 KB (`GET /academics/students`), then 4.6 KB and
4.1 KB. The 6 MB Lambda-proxy cap is three orders of magnitude away; CSV
exports go through presigned URLs. Binary passthrough remains unexercised
until a PDF route lands on a Lambda prefix (Sprint 5).

### Cross-origin

API-B's actual responses carry `access-control-allow-origin` for the
configured origin (`GET /users/me` 200 with `Origin: https://edforge.app`),
and the OPTIONS mock answers the preflight. **API-A's actual responses do
not** (only `allow-credentials` and `vary: Origin`; the ECS task definitions
set no `CORS_ORIGINS`), which is harmless today because the frontend's
api-client uses the relative base `/api` and the Vercel side proxies it —
the browser never calls API-A cross-origin. API-B is therefore the first
endpoint the app could call directly.

## Sprint 3 — jobs through the workers (2026-09-04, dev tenant via API-B)

| Job | Function | Wall time | Peak memory | Result |
|---|---|---|---|---|
| Bulk invoice generation, 30 students | finance worker (3,008 MB) | 4.3 s (+1.5 s cold init) | 405 MB | 30/30, lock released, fence 1 |
| IEMIS import, 2 rows (S3-staged) | academics worker (1,769 MB) | 0.9 s (+1.8 s cold init) | 326 MB | 2 created, staging object deleted |
| Bulk PDF export, 500 invoices, zip | finance worker | 11 s to failure | 580 MB | **0 rendered** — fonts absent from the bundle (sprint-3-analysis.md) |
| Bulk PDF export, 500 invoices, zip — after the font fix | finance worker (3,008 MB) | 193 s (+1.5 s cold init) | 658 MB | 500/500, fence 3, zip + presigned URL, queue and DLQ empty |

### C3.9 — the PDF ceiling and the chunking decision

One invocation renders **2.6 PDFs/s** at the Lambda render concurrency of
4, so a 500-invoice export (a full school for one billing run, the largest
realistic job) takes 193 s: 21 % of the 900 s timeout and under the 450 s
chunking threshold. **No fan-out is implemented.** The threshold is crossed
at about 1,150 invoices per job and the timeout at about 2,300; the zip
cap (2,000) is therefore above what one invocation finishes inside the
threshold, while the merged-PDF cap (1,000) is below it. Follow-up, not in
this sprint: either align the zip cap on the worker path to 1,000 or lift
render concurrency (memory has room, 658 MB of 3,008 MB, but rendering is
CPU-bound and a 3,008 MB function has about 1.7 vCPU, so the gain from more
parallelism is uncertain and must be measured, not assumed).

## Sprint 8 — what the bill is made of once the fixed lines are gone (2026-09-05)

Cost Explorer, daily, unblended, pre-tax: $6.06/day flat through August;
$0.75 on 5 September, a partial day (services to zero at 03:12 UTC, the
load balancers, NAT and VPC gone at 03:54 UTC). September month-to-date on
the 5th: $24.28, four of those days at the old shape.

### DynamoDB reads were the janitors

Consumed read units per table over the 24 hours to 11:30 UTC, 5 September,
against the finding that the two job janitors ran a `Scan` of their whole
table every five minutes (a Scan is billed on bytes read, not rows
matched):

| Table | Read units / 24 h | Of which janitor scans | Basis |
|---|---:|---:|---|
| edforge-academics-basic | 299,255 | ≈ 293,000 | 288 sweeps × 1,018 units (8.3 MB table ÷ 4 KB ÷ 2) |
| edforge-finance-basic | 179,877 | ≈ 159,000 | 552 units in every 5-minute bucket, all day |
| edforge-identity-basic | 18,761 | 0 | real traffic |
| every other table | < 20 | 0 | |

91 % of all reads; at August's observed price ($2.10 for 14.72 M units)
about $2.0 of the $2.16 a month DynamoDB reads cost, and linear in table
size. Sprint 8 replaces the Scan with a Query on the sparse running-jobs
index (GSI15, populated only while a job is `running`) at a 15-minute
cadence; the row below is filled in after the deploy.

| After the change | Read units / 24 h | Notes |
|---|---:|---|
| edforge-academics-basic | _pending_ | |
| edforge-finance-basic | _pending_ | |

### What remains on the bill (estimates from August unit prices and the last 24 hours)

| Line | ≈ $/month | Basis |
|---|---:|---|
| KMS, two customer keys (SBT script jobs) | 2.00 | fixed; Sprint 7 removes them |
| DynamoDB reads | 2.16 | 91 % janitor scans, see above |
| ECR, 94 images in the three service repositories | 0.39 | expiring under the 30-day lifecycle rules |
| DynamoDB writes, storage, PITR | 0.30 | 8k write units/day, 19 MB |
| API Gateway | 0.10 | $0.0035/day at pilot traffic |
| Logs storage, S3, SNS, SES, Events | 0.08 | 0.93 GB of orphaned VPC flow logs is most of it |
| Lambda, SQS, Scheduler, Cognito, alarms (10), dashboards (3) | 0.00 | permanent free tiers |
| **Pre-tax total** | **≈ 5.0** | ≈ 3.0 after Sprint 7, ≈ 1.0 after the janitor change, tax ≈ 6.6 % on top |
