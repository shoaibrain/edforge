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
   the reports-staging bucket under the tenant's ABAC prefix
   (`tenant=<tenantId>/iemis-import/<jobId>.json`, tagged; the bucket gets a
   tag-scoped 1-day expiry), and the message carries the key. **Correction
   (review 2026-09-05):** `REPORTS_STAGING_BUCKET` was set on the identity
   container only; the stack now sets it on academics too, or the transport
   flip would have failed every import with a stuck `queued` row. Its
   `markRunning` had no status condition; it gains `status = queued` so a
   redelivery cannot double-claim.
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
- **D3.7** (review 2026-09-05) Honesty about the fence: with the
  `queued`-only claim, a job row is claimed at most once, so the status
  conditions already deliver "a lost worker cannot commit"; the fence on
  the row is defence in depth that becomes decisive only if a future
  takeover path stamps a new fence. It stays, cheap and documented as such.
  Other review-driven changes: any error thrown outside the worker classes
  is a batch item failure (retry, then the DLQ alarm), never a silent ack;
  the lock waits 15 s then hands the message back to SQS; the in-process
  queued-orphan sweep is off under `JOBS_TRANSPORT=sqs`; the active-export
  sentinel is deleted only by the job that created it; the scheduled entry
  honours the `DISABLE_<JOB>` kill switches and releases its lease when a
  run throws so a retry can take the window. Runbook: with
  `CDK_PARAM_ADVANCED_TEMPLATE_ENABLED` on, the alarm budget (exactly 10 in
  prod) would trip `assertAlarmBudget` at synth; it is off in prod.
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

## Near miss caught by the diff gate (2026-09-05)

The first version of C3.7 added `<TIER>` to the stack's global service-info
substitution map so the queue URL in the task definition could name the
queue by tier. `cdk diff` showed the three DynamoDB tables **replaced**:
`createStorageIfNeeded()` derives each table's construct id from the
`<TIER>` placeholder in `TABLE_NAME` and appends the tenant name when the
placeholder is absent, so resolving it early renamed the constructs
(`edforge-finance-basic` → `edforge-finance-basic-basic`) — an orphaned
production table and an empty replacement. The placeholder now reaches the
table code untouched and is substituted for the other environment values
only after the table name is final. The lesson is general: the tenant
stack's service-info placeholders are consumed in different places by
different code, and a global substitution is a change to every consumer.

## Acceptance finding (2026-09-04): the Lambda bundle has no fonts

The C3.9 run — a 500-invoice zip export through `edforge-finance-<tier>-worker`
— rendered nothing. `@aibrains/pdf-renderer` computes its font directory as
`path.resolve(__dirname, '..', '..') + '/fonts'`; in a real `node_modules`
layout that is the package root, but `scripts/build-lambda.sh` ships one
file, `index.js`, so `__dirname` is the task root and the path becomes
`/fonts/NotoSans-Regular.woff`, which does not exist. Every render threw
`ENOENT`, each failure recorded itself on the job row through a fresh
credential fetch, and 500 of those in parallel saturated the resolver
(`getaddrinfo EBUSY` against STS). The handler returned normally after 11 s
(peak 580 MB), so the message was deleted rather than retried, the job row
stayed `running` with 246 failures counted, the active-export sentinel kept
pointing at it, the `Errors` metric stayed at zero and neither alarm fired.
The 30-invoice generation and the IEMIS import had passed through the same
workers minutes earlier; neither renders a PDF, and neither do the unit
tests or the bundle load check.

Blast radius while step 4 was live (about 100 minutes): every bulk invoice
or receipt PDF export from any tenant would have failed the same way. No
tenant submitted one in that window (the queue's only messages were the
acceptance jobs). The finance API function on API-B has the same bundle and
therefore the same defect for single-invoice PDFs; identity and academics
import the renderer too, so all service bundles need the fix, not only the
finance worker.

Rollback: finance returned to the step-3 configuration (`JOBS_TRANSPORT=
inline`, the three timers on the container, payment sweep off) in one
environment-only deploy; academics stayed on the queue. The stuck dev job
clears through the container sweeper's 120-minute `running` recovery, which
also removes the sentinel.

Fix (next PR on this branch): the renderer reads an explicit font directory
from the environment before falling back to the package-relative path;
`build-lambda.sh` copies the four `.woff` files into `dist-lambda/<svc>/fonts/`
for every service; the functions get `PDF_FONT_DIR=/var/task/fonts`. The
renderer change is a patch release of the published package (the Docker
images resolve it from the registry and are unaffected without the variable).
Gate before flipping finance again: the 500-invoice export green through the
worker. Two more changes make that gate safe and this failure visible:

- `CDK_PARAM_API_JOBS_TRANSPORT=sqs` puts only the API functions (API-B,
  preview) on the queue transport while the containers keep the value in
  service-info, so the worker path is exercised from preview before the
  production flip.
- The worker handlers read the job back after the worker class returns. A
  job still `queued`/`running` (its final write failed, as here) or `failed`
  without producing a single document ends the invocation with
  `JobOutcomeError`. That is an invocation error on purpose, not a batch item
  failure: the functions-errors alarm already watches it (the alarm budget has
  no slot for a job-failure metric), and the redelivery that follows is
  dropped by the status rules, so nothing runs twice. Both export workers
  already ended an all-failed run with `markFailed`; the incident showed that
  write itself failing under the credential storm, which the worker class
  swallows by contract.

Still open after this fix (follow-ups, not blockers): every failed render
recorded itself through a fresh role-credential fetch (the storm), and
concurrent failure records on the job row conflict with each other
("Record was modified by another request"), so some failures go unrecorded
when many renders fail at once. Both exist on the container too.
