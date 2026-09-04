# Sprint 3 — pre-implementation audit (2026-09-04)

Read before C3.1 was written, against the code as merged in PR #448. Nothing
here re-opens Q4 (Scheduler + SQS worker + DynamoDB lock with fencing); it
corrects the plan where the code disagreed and settles the message shapes.

## What was read

The four finance timer services and `FinanceMetricsService`; the bulk-ops
module (`FinanceJobsService` state machine, the three worker classes, the
in-memory `PerSchoolLock`, `PdfRenderConcurrencyBucket`, the stale-job
sweeper); the 202 hand-offs in the invoices and payments controllers; the
finance `DynamoDBClientService` (tenant-scoped client from the JWT vs the
system client on the role); the CDK `ScheduledLambda` pattern and its four
users; the analytics stack's `finance-job-janitor`; the finance task
definition; the academics IEMIS import controller, jobs service and async
executor; the SQS usage that already exists in the CDK code.

## Findings

1. **All four timer kill-switches already exist.** `DISABLE_RECURRING_BILLING`,
   `DISABLE_OVERDUE_DETECTION`, `DISABLE_BILLING_RECONCILIATION` and
   `DISABLE_PAYMENT_SWEEP` are all read in `onModuleInit`; the task
   definition sets only `DISABLE_PAYMENT_SWEEP=true` today. C3.5's "add the
   gates" is done; C3.5 is a task-definition change plus rolling update.
2. **The run bodies are already public methods.** `generateRecurringInvoices()`,
   `detectOverdue()`, `reconcile()`, `sweep()`; every interval callback is
   `this.<method>().catch(log)`. Recurring billing also fires once after a
   5-minute `setTimeout` at startup. C3.2's `runOnce()` is a thin, uniform
   entry the scheduled handler can call by name; the interval and the startup
   timer call it too so one test proves the timer path uses it.
3. **Timers use the system client, not the TVM.** All four scan across tenants
   with `getSystemClient()` (the role's direct table grant). The scheduled
   function therefore needs no JWT and no per-tenant session; the Lambda
   execution role already carries the same direct grant (C1.6).
4. **The active-export sentinel is a submit-time guard and stays.**
   `FinanceJobsService.create()` writes the job row and a per-school sentinel
   in one `TransactWriteItems`; a second export for the same school gets a
   409 at submission. The plan retired it "in favour of the lock", but the
   lock (C3.6) is acquired by the *worker* and cannot produce the 409 the
   operator UI relies on. Decision D3.1: keep the sentinel; `DdbSchoolLock`
   replaces only the in-memory `PerSchoolLock` (run-time serialization).
5. **Fencing needs the fence on the job row.** `FinanceJobsService`
   transitions already carry status conditions (`markRunning` requires
   `queued`, `markCompleted` requires `running`); the workers call them with
   the request context only. Under `JOBS_TRANSPORT=sqs` the worker claims the
   job with `markRunning` and stores the lock's fence on the row; later
   transitions add `fence = :fence`. Under `inline` no fence is passed and the
   conditions are unchanged, so ECS behaviour today is byte-identical.
6. **The academics IEMIS import cannot ride in an SQS message.** The rows
   arrive as a JSON body (`students[]`, up to 1,000 rows) and are handed to
   `executeIemisImportAsync(jobId, rows, schoolId, context, year)`; a
   thousand rows exceed SQS's 256 KB message limit. C3.11 stages the rows in
   the academics staging bucket (`REPORTS_STAGING_BUCKET` is already in the
   task definition) under `iemis-import/<tenantId>/<jobId>.json` with a
   1-day lifecycle, and the message carries the key. Its `markRunning` has no
   status condition; it gains `status = queued` so a redelivery cannot
   double-claim.
7. **The plan's `count-alarms.ts` gate was never written** (C0.4 promised it;
   only per-stack assertions exist). Alarms stand at 8; C3.4 and C3.7 use the
   two reserved slots, so the repo-level gate is written in C3.4 and enforced
   in the `routes` workflow alongside the other CDK specs.
8. **`ScheduledLambda` bundles its own `NodejsFunction`** (esbuild, no
   decorator metadata) and is used four times in the analytics stack. C3.4's
   `ScheduledTarget` takes an existing `IFunction`; the two share the
   Scheduler role and retry-policy code.
9. **Message shape.** `{ version: 1, jobId, jobType, tenantId, schoolId,
   input, context: { tenantId, userId, email, role, jwtToken } }` for finance;
   the worker reconstructs the `RequestContext` the worker classes take and
   mints the tenant-scoped client through the TVM exactly as the in-process
   worker does. The JWT is the operator's; a message that outlives the token
   (an hour) fails at the TVM and is marked failed, which is the correct
   outcome for a job nobody is waiting for any more. Messages carry a JWT, so
   the queue uses SQS-managed encryption and a 1-day retention.
10. **Function shapes.** Three more functions from the same finance bundle
    and one from the academics bundle, all created by `LambdaService` with
    new optional props (`handler`, `nameSuffix`, `memorySize`, `timeout`):
    `edforge-finance-<tier>-scheduled` (`index.scheduledHandler`, 1,769 MB,
    300 s), `edforge-finance-<tier>-worker` and
    `edforge-academics-<tier>-worker` (`index.workerHandler`, 3,008 MB,
    900 s, SQS event source `batchSize 1`, `maxConcurrency 2`,
    `reportBatchItemFailures`). Each gets the service's principal grants
    (C1.6) plus queue consume; the API function and the ECS task role get
    queue send.
11. **Redelivery and the janitor agree.** The `finance-job-janitor` marks
    `running` jobs failed after 60 minutes with a status condition; the
    worker's redelivery rule ("running with a live lock → drop; running with
    an expired lock → `markFailed('worker lost')`") never races it because
    both transitions condition on `status = running`.

## Decisions taken

- **D3.1** Keep the active-export sentinel; `DdbSchoolLock` replaces
  `PerSchoolLock` only.
- **D3.2** IEMIS rows staged in S3, key in the message (F6).
- **D3.3** `JOBS_TRANSPORT` (`inline` default, `sqs`) is the single switch
  for the queue path and the lock implementation on both ECS and Lambda; the
  functions are created behind `CDK_PARAM_LAMBDA_SERVICES` as before.
- **D3.4** The scheduled function runs the Nest app as an application
  context (`NestFactory.createApplicationContext`), no HTTP adapter; the
  worker likewise.
- **D3.6** (implementation) The finance and academics dead-letter depths
  share one metric-math alarm (`edforge-jobs-dlq-<tier>`): the budget is
  ten and the finance-functions alarm took the ninth slot. Contention on
  the DynamoDB lock is bounded polling (10 min) then `SchoolLockBusyError`,
  which the workers rethrow so the message is retried rather than the job
  failed; queue visibility is the worker timeout plus a minute because the
  `queued`-only claim already prevents double runs. The staging bucket
  gets a tag-scoped one-day expiry as the backstop for the worker's own
  delete of the staged IEMIS rows (they are student data; the bucket's
  existing rules never expire anything).
- **D3.5** Deploy order inside the sprint: functions and queues first
  (nothing consumes them until the switch flips), then the task-definition
  change (`DISABLE_*` for the remaining three timers, `JOBS_TRANSPORT=sqs`)
  with the finance rolling update, then the schedules enabled — timers off
  before schedules on, as the plan says.

## Refined ticket deltas

| Ticket | Delta |
|---|---|
| C3.1 | As planned; lease rows live under `pk = SYSTEM#<jobName>` so no tenant partition is touched. |
| C3.2 | `runOnce()` delegates to the existing method; startup timer and interval both call it. |
| C3.4 | Also writes the repo-level alarm-count gate (F7) and wires it into CI. |
| C3.5 | Task-definition change only (gates exist). |
| C3.6 | Sentinel kept (D3.1); fence stored on the job row at claim (F5). |
| C3.7 | Message shape and function shapes per F9/F10. |
| C3.11 | Rows staged in S3 (F6); `markRunning` gains its status condition. |
