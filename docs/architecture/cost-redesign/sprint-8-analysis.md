# Sprint 8 — post-teardown inspection, findings and decisions (2026-09-05)

Read-only inspection of the production account the morning after Sprint 6
(11:26 UTC), once #452 and #453 were merged and the `rproxy` repository
deleted. Every number is from CloudWatch, Cost Explorer or a DynamoDB read;
nothing was changed by the inspection (the one dead-letter queue was peeked
with a zero visibility timeout).

## What was read

- CloudFormation stacks and their resource types; Lambda, API Gateway, ELB,
  EC2, ECS, ECR, Cloud Map, KMS, CodeBuild, Step Functions, DynamoDB, SQS,
  Scheduler, EventBridge, SNS, S3, CloudFront, Cognito, IAM inventories.
- CloudWatch: alarms, dashboards, log groups with retention and size, API-B
  and function metrics for 12 hours, `REPORT` lines for cold-start counts,
  DynamoDB consumed capacity per table and index for 24 hours.
- Cost Explorer: daily cost by service 24 Aug → 5 Sep, usage types for the
  cutover days, August by usage type.
- The aggregator DLQ's contents, the janitor handlers, the aggregator's metric
  map, the SBT registrations and identity `METADATA` rows.

## Findings

**A. The job janitors were 91 % of DynamoDB reads.** `edforge-finance-job-janitor`
and `edforge-iemis-job-janitor` each ran a `Scan` with a `status = running`
filter every five minutes. Scans bill on bytes read: 552 read units per sweep
on the finance table (4.6 MB) and about 1,040 on the academics table (8.3 MB),
288 sweeps a day — 454k of the 498k read units the account consumed in 24
hours, about $2 a month at August's price, linear in table size. The tables
had no running job at all (finance: 63 succeeded, 5 failed; academics: 24
succeeded). The janitors predate the epic (Sprint I.1, F-IEMIS-1) and were
written for containers that could die mid-job; the SQS workers still need
the safety net for a timeout or an out-of-memory kill.

**B. The "stale" analytics alarm was real.** `edforge-analytics-functions-errors`
adds the aggregator DLQ into its metric math, and the aggregator writes to
that queue itself. The 28 messages were identity `LoginSuccess` events
(emitted by the Cognito post-authentication trigger since July; the metric
map only knew the in-app `edforge.analytics` source) and `InvoiceGenerated`
events that lost a DynamoDB `TransactionConflict` during the 500-invoice run
on 4 September (18 that day). Function errors, EventBridge failed invocations
and throttles were all zero. The alarm term was queue depth, so it stayed
red as long as any message was younger than 14 days.

**C. Sprint 7's production gate has nothing to read for half the tenants.**
Only 3 of the 6 SBT registrations have an identity `METADATA` row (tags:
`production` ×2, `internal-dev` ×1); the other three predate the seeder.

**D. Nine CDK framework helper functions run `nodejs20.x`** (LogRetention,
AwsCustomResource, S3AutoDeleteObjects and the Provider framework across four
stacks), a runtime AWS deprecated on 30 April 2026. `aws-cdk-lib` was pinned
at 2.195.0 (current 2.268.0).

**E. API keys and usage plans are dead plumbing.** Shared-infra still mints
three tiered keys, attaches three usage plans to API-B's stage and publishes
six SSM parameters; the authorizer's key lookup has failed AccessDenied since
before the epic and no method requires a key.

**F. Cold starts are 8–23 % of requests in the quiet hours** (identity 30 of
274, academics 28 of 123, finance 5 of 63 in 12 hours; Init p50 1.76–1.93 s;
API-B p50 225 ms, p90 2.8 s, p99 5.5 s). Provisioned concurrency would cost
about $19 a month per function at 1,769 MB.

Also recorded: 16 orphaned log groups (nine ECS, API-A execution logs and its
pre-created group, the 0.93 GB VPC flow-log group, the VPC default-SG custom
resource, two from the deleted advanced stack, `/aws/apigateway/welcome`);
the deployer's ECR push policy and `ecs:UpdateService` grant are obsolete;
X-Ray Transaction Search and Application Signals are active at $0; the daily
`recurring-billing` schedule had not yet reached its first 01:30 NPT window
since the final Sprint 3 deploy.

## Decisions

- **D8.1 (A)** Add a sparse running-jobs index, GSI15, to the tenant tables
  (`gsi15pk = RUNNING_JOB#<entityType>`, `gsi15sk = startedAt`), written by
  `markRunning` and removed by every terminal transition; the janitors Query
  it and sweep every 15 minutes (staleness thresholds stay 60 / 30 min, so a
  stale job is marked at most 15 minutes late). A new GSI rather than a
  PK-overload of GSI10 or GSI13: the repository's inventory rule says a slot
  is reused only when the access pattern matches its intent. The identity
  table receives the same index (the construct is shared); it stays empty.
  Not chosen: making the SQS redelivery mark a `running` job failed, which
  would retire the janitors — a later simplification, not a cost item.
- **D8.2 (B)** Map `edforge.identity-service::LoginSuccess` to
  `auth.login.success`; log and drop unmapped types instead of dead-lettering
  them; retry `TransactionConflict` up to five times with jittered backoff;
  alarm on `NumberOfMessagesSent` over 15 minutes instead of depth. The 28
  messages already in the queue age out in 14 days; the 18 lost
  `InvoiceGenerated` aggregates are not replayed (their landing rows exist,
  so a replay would be deduplicated) — an undercount of 18 invoices on the
  4 September analytics day, accepted.
- **D8.3 (C)** C7.2's gate treats a missing `METADATA` row or `tenantTag` as
  `production` (default-deny); untagged tenants are tagged before the
  deprovisioner ships.
- **D8.4 (D)** Bump `aws-cdk-lib` (and the lambda-python alpha module) to
  the current release and pin the CDK CLI as a devDependency so `npx cdk`
  resolves deterministically; one diff per stack, expecting only the helper
  functions' runtime and code hashes to change.
  Diff review of the bump found one operational consequence: the controlplane
  deploy re-runs the AdminWeb `BucketDeployment` (the library added a
  `WaitForDistributionInvalidation` property), which re-uploads the AdminWeb
  source zip and starts the AdminWeb pipeline through its S3 poll trigger — a
  rebuild plus CloudFront invalidation. The Sprint 0 controlplane deploy did
  the same on 2026-09-03 and succeeded. Two of the CI workflows run `ts-node`
  from the repo root, where TypeScript is 4.9; the `esnext.disposable` lib the
  new declarations need therefore lives in `tsconfig.cdk.json` only.
- **D8.5 (E)** Operator decision: remove the keys, plans and parameters in
  C8.5, or fix the authorizer grant and require keys if tiered throttling is
  wanted. Nothing changes until decided.
- **D8.6 (F)** Cold starts are accepted for now. No cost may be added: no
  provisioned concurrency. Of the free options, trimming module-scope work in
  the bundle is the scalable one (it shortens every cold start, including
  concurrency bursts); a ping warmer keeps one environment warm per function
  and does nothing for a second concurrent request, so it is not adopted.

## Execution

Deploy order: `tenant-template-stack-basic` (GSI15 + the services that write
it), then `analytics-stack` (janitors, aggregator, alarm), then the CDK bump
across the remaining stacks. Each step: `cdk diff` reviewed, deploy with the
wrapper, verification below. Filled in as executed.

| Step | Verification |
|---|---|
| tenant-template | Diff shows `GlobalSecondaryIndexes` +GSI15 on the three tables and new function bundles, nothing else; `describe-table` reports GSI15 `ACTIVE`; a bulk job run end to end leaves no row with gsi15 keys |
| analytics | Janitor `REPORT` lines show a Query, not a Scan; `ConsumedReadCapacityUnits` on both tables falls to traffic only; `edforge-analytics-functions-errors` returns to OK within 15 minutes of the deploy; a login lands as `auth.login.success` |
| CDK bump | Every helper function on a current runtime; shared-infra authorizer answers 401/200; controlplane's AdminWeb pipeline execution succeeds and the console loads |
