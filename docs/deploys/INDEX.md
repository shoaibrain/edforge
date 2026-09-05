# Deploy Evidence Index

Tracked source must not contain raw deployment logs, smoke-test transcripts,
JWT-derived claims, tenant UUIDs, account IDs, ARNs, presigned URLs, operator
emails, or environment-specific hostnames.

Raw deploy output belongs in a local/private evidence store such as
`$EDFORGE_DEPLOY_LOG_DIR` or `/tmp/edforge-deploys`. Summaries may be added to
this file only after they are manually redacted and are useful as durable public
project history.

## Current Policy

- `docs/deploys/INDEX.md` is the only tracked file allowed in this directory by
  default.
- Do not force-add `.log`, `.csv`, or ad-hoc deploy prompt files under
  `docs/deploys/`.
- When a deploy needs review evidence, keep raw output private and add a short
  sanitized note here with commit/PR numbers, high-level outcome, validation
  status, and follow-up work.
- Run `npm run lint:deploy-evidence` before opening a PR that touches deploy
  evidence.

## Sanitized Timeline

Detailed historical raw logs, CSVs, and ad-hoc deploy prompts were removed from
tracked source after the July 2026 source-hygiene review because they contained
operator-specific deployment evidence. The entries below preserve durable public
status without raw log links, account IDs, ARNs, tenant UUIDs, operator emails,
JWT claims, or environment-specific hostnames.

### 2026-09-05 — Cost redesign Sprint 4: production frontend cut over to API-B — Green (compressed soak)

- **Scope:** PR #450 (C4.1, C4.4 code) and the operator-authorised cutover
  (C4.2). The operator asked for the remaining sprints in one day, informed
  the customer and accepted interruption; the audit and the compressed plan
  are in `docs/architecture/cost-redesign/sprint-4-analysis.md`. No CDK
  deploy: the per-container `desiredCount` field defaults to 1 and the
  flag-on tenant diff had zero resource changes.
- **Pre-flight (C4.1):** `api-ab-parity.ts`, 30 read-only routes on the dev
  tenant against API-A and API-B with one token: 28 × 200 on both, the other
  two identical 4xx on both, 0 differ after normalising error timestamps,
  presigned-URL signatures and pagination cursors; median latency API-A
  952 ms, API-B 860 ms. `identity-service-flow.ts` on API-B: 84 checks, 2
  failures, both the Sprint 2 fixture drift (`EMIS_CODE_REQUIRED`).
- **Cutover (C4.2):** Vercel Production `API_BASE_URL` and `VITE_API_URL`
  moved to the API-B URL and the current Production deployment rebuilt from
  the same source (Ready after four minutes on both production aliases).
  Proof: a request through the production domain's `/api` proxy was
  answered by API-B's authorizer and logged in API-B's access log; API-A's
  access log recorded nothing after the rebuild (the last entry was an
  in-flight request from the previous build, seconds after the flip).
  Rollback: the two values back and a rebuild.
- **Soak (C4.3, compressed):** signals watched while Sprint 5 is prepared:
  API-B 5xx, function errors, alarms, pilot login by the operator. One
  pre-existing alarm noted: `edforge-analytics-functions-errors` has been
  in ALARM since the Sprint 0 analytics deploy on 2026-09-03 with no
  analytics function erroring since; follow-up under C8.1.
- **Scale-to-zero (C4.4):** deferred to C5.3 by design (D4.1): the containers
  still address each other over Service Connect, so identity and academics
  stay up until finance has moved to its function.

### 2026-09-04/05 — Cost redesign Sprint 3: finance timers on Scheduler, bulk jobs on SQS workers — Green (24 h lease monitor pending)

- **Scope:** PR #449 (C3.1–C3.8, C3.10, C3.11). Step 1 `tenant-template-stack-basic`
  with `CDK_PARAM_LAMBDA_SERVICES=true`: `edforge-finance-<tier>-scheduled`
  (index.scheduledHandler, 300 s), `edforge-finance-<tier>-worker` (3,008 MB,
  900 s, sharp), `edforge-academics-<tier>-worker` (900 s), the finance and
  academics jobs queues with dead-letter queues, four Scheduler schedules
  created `DISABLED`, the finance-functions and jobs-DLQ alarms (ten alarms
  in total, the budget), queue send/consume grants, and the academics ABAC
  role's put/get/delete on the staging sub-prefix. Both task definitions
  gained `JOBS_TRANSPORT=inline`, their queue URL and (academics) the
  staging bucket name, so academics and finance rolled once with their
  current images. Step 2 `analytics-stack`: tag-scoped one-day expiry on
  the reports-staging bucket, filter verified on the live bucket.
- **Gates before step 1:** CI green; independent review (one blocker fixed:
  the staging bucket name was missing on academics); flag-on `cdk diff`
  with **zero DynamoDB lines** after a near miss where a global `<TIER>`
  substitution would have replaced the three tables (caught by the diff,
  fixed, documented in `sprint-3-analysis.md`).
- **Result:** step 1 update 426 s, `UPDATE_COMPLETE`; academics revision 3 → 4,
  finance 8 → 9, both rollouts `COMPLETED`; three new functions Active;
  event source mappings enabled (batch 1, max concurrency 2, partial batch
  responses); four schedules `DISABLED`; alarms 10, both new ones OK. Step 2
  update 42 s. Nothing enqueues and no schedule fires until C3.5.
- **Step 3** (ECR build + forced rollout, finance and academics): both
  services steady on the pushed digests, zero boot errors. A second finance
  build followed for a sweeper guard (the queued-orphan scan divided by an
  infinite age under the queue transport and logged one error per sweep).
- **Step 4** (`JOBS_TRANSPORT=sqs` on both task definitions, the three
  remaining finance timers off): 293 s, environment-only diff, zero DynamoDB
  lines; finance revision 10, academics 5, both `COMPLETED`.
- **Acceptance through API-B on the dev tenant (queue path):** bulk invoice
  generation of 30 invoices → 202 → finance worker → all 30 succeeded in
  under ten seconds (worker 4.3 s, 405 MB of 3,008 MB); school lock released,
  fence counter advanced; IEMIS import of two rows → staged to S3 → academics
  worker → both students created (0.9 s, 326 MB), staging object deleted;
  both dead-letter queues empty.
- **Finding (C3.9 run):** a 500-invoice zip export through the finance worker
  rendered no PDFs. The renderer locates its fonts relative to its own file,
  which in the single-file Lambda bundle resolves to `/fonts` and does not
  exist. Every render failed, each failure recorded itself through a fresh
  credential fetch, and the parallel failures saturated DNS. The handler
  still returned normally: job left `running`, message deleted, `Errors`
  metric zero, no alarm. Bulk PDF exports on the container had run for
  months; nothing in the unit tests or the bundle load check renders a PDF.
- **Rollback (approved, same day):** finance back to the step-3 state —
  `JOBS_TRANSPORT=inline`, the three timers on the container again, payment
  sweep still off — 289 s, finance revision 11 `COMPLETED`, timers logged as
  scheduled at boot, sweeper clean; a 30-invoice generation through API-A
  then ran in process (no fence, no worker invocation). Academics stayed on
  the queue.
- **Fix (functions only, 40 s):** the renderer reads `PDF_FONT_DIR` (patch
  release), the bundle script ships the four fonts beside `index.js` and the
  bundle check asserts them, every function gets `PDF_FONT_DIR=/var/task/fonts`
  (the deployed worker archive was downloaded and lists the four files); both
  worker handlers read the job back after the run and end the invocation with
  an error when it is not terminal or produced nothing, so the existing
  functions-errors alarm covers this class. Bundle-mode spike: same ENOENT
  without the variable, a two-script PDF with it.
- **Gate:** API-B proxies every `/finance/*` route to the container, so the
  finance function was invoked directly with a proxy event for the
  500-invoice zip export (temporary invoke permission, stale sentinel
  removed by the operator): **500/500 in 193 s, 658 MB peak, 2.6 PDFs/s**,
  lock fence 3, zip and presigned URL produced, queue and DLQ empty, the only
  "ERROR" line the runtime's deprecation notice. Under the 450 s chunking
  threshold; no fan-out (`measurements.md`).
- **Step 4 again (286 s)** — finance revision 12, then the acceptance through
  API-B: 30/30 through container → queue → worker (fence 4, lock released),
  IEMIS import through the academics worker, DLQs empty. **Step 5 (17 s)**:
  overdue detection, recurring billing and reconciliation `ENABLED`, payment
  sweep `DISABLED`. First window (reconciliation, 22:45 UTC): the scheduled
  function ran on time, lease row for the window written, reconciliation
  complete in 4.9 s at 346 MB of 1,769 MB, both alarms OK, no timer lines
  from the container. Monitor: one lease row per job window over 24 h.
  The two temporary deployer permissions used for the rollouts and the
  direct function invocation were removed by the operator afterwards
  (inline policies list empty); the renderer patch release is published.
- **Follow-ups (not blockers):** the finance-job janitor marks a stale job
  failed but leaves the active-export sentinel to its four-hour TTL; every
  failed render fetches role credentials afresh and concurrent failure records
  conflict on the job row (pre-existing on the container); the zip cap (2,000)
  exceeds what one worker invocation finishes inside the threshold (~1,150).

### 2026-09-04 — Cost redesign Sprint 2: API-B (strangler REST API on Lambda) deployed beside API-A — Green

- **Scope:** PR #448 (C2.1–C2.7). Three deploys in order, all through
  `scripts/deploy.sh <stack> prod --exclusively` after a `cdk diff` each:
  `shared-infra-stack` (API-B: second `SpecRestApi` from the generated
  `tenant-api-lambda.json`, seven stage variables, own usage plans on the
  same tier keys, 1 KiB compression, binary media types, two new exports;
  one resource-policy statement on the shared authorizer);
  `tenant-template-stack-basic` with `CDK_PARAM_LAMBDA_SERVICES=true`
  (API-B invoke permission on the three service functions, their sibling
  service URLs and `CORS_ORIGINS` set; environment-only function changes);
  `analytics-stack` with the same flag (invoke permission on the analytics
  API function).
- **Pre-deploy gates:** CI green incl. the new `routes` workflow; an
  independent review found no blocker and its should-fix items landed
  before deploying. Diffs matched the recorded expectations exactly:
  shared-infra additions only with **zero API-A resources in the diff**;
  tenant additions + environment-only function changes and zero ECS lines;
  analytics one permission.
- **Result:** updates of 48 s / 36 s / 18 s. API-A's prod stage still on its
  July deployment; ECS services identical to the Sprint 1 baseline. API-B
  verified: preflight 204 with CORS, 401 from the shared authorizer on
  guarded routes (including the analytics and `/internal/*` additions), and
  the unauthenticated login route answers with the service's own 400 —
  on API-A that route returns the ALB's 503 without a header (F0.5 closed
  on API-B). Both exports are imported by tenant-template and analytics
  (rollback order is the reverse of the deploy order).
- **Finding (pre-existing, F2.2):** API-A has not served `/analytics/*`
  since the 2026-07-09 API-A body update: the analytics stack's attached
  resources and authorizer exist in CloudFormation but not on the API
  (`SpecRestApi` overwrite), and `GET /analytics/fleet` on API-A returns
  403 "Missing Authentication Token". API-B serves those routes from the
  spec. See `MIGRATION_PLAN.md` follow-ups.
- **C2.8 smoke (same day, operator-minted dev-tenant token):** identity
  suite 48 pass / 2 fail (the F0.6 fixture, identical on API-A) with the
  four tenant cases that were F0.5 failures on API-A now passing; golden
  thread 48/71 with every failure a stale fixture or data state (F2.4);
  finance billing fails identically on API-A (F2.3). 124 requests, 0 5XX,
  p50 79 ms, p99 2.4 s (cold), largest response 8.2 KB, CORS headers on
  actual responses. Evidence in
  `docs/architecture/cost-redesign/measurements.md`.
- **C2.9 (operator, same day):** Vercel Preview environment pointed at
  API-B (`API_BASE_URL` for the `/api/*` route, `VITE_API_URL` for the
  build). Dashboard, academics and finance pages load; 81 requests through
  API-B in the session, 71 OK, no 5XX. Production stays on API-A.
- **Sprint 2 complete.** Next: Sprint 3 (finance background work off-process).

### 2026-09-04 — Cost redesign Sprint 1: service Lambdas deployed beside ECS — Green

- **Scope:** `tenant-template-stack-basic` deployed with
  `CDK_PARAM_LAMBDA_SERVICES=true` (PR #447, C1.6–C1.8): one Lambda function
  per NestJS service (`edforge-<svc>-basic-api`, nodejs22.x, 1,769 MB, 29 s,
  outside the VPC), execution roles with the same tenant-scoped grants as the
  ECS task roles, the ABAC roles trusting both, 30-day log groups, the sharp
  layer on finance. Nothing routes traffic to the functions yet.
- **Pre-deploy gates:** CDK typecheck, lint, route drift, CDK jest 502 tests,
  Sprint 1 application specs, bundle guard (isolated load), wrapper test;
  flag-off `cdk diff` showed only the per-deploy commit-id churn; flag-on diff
  additions only. An independent review found no blocker; its should-fix
  items (Cognito environment for the functions, reserved-key filter,
  flag-only bundle gate) were fixed before deploying.
- **Result:** CloudFormation update 83 s. The four ECS services kept their task
  definitions and deployment timestamps. Direct-invoke smoke 10/11 with an
  operator-minted dev-tenant token: `/health/live` 200 cold and warm on all
  three, guarded route 401 without a token, identity `users/me` 200 with the
  token's tenant, academics students 200, finance job lookup a definitive 404
  from its table; CloudTrail shows `AssumeRole` on the ABAC roles from the
  Lambda roles with the `tenant` session tag; `REPORT` lines present in
  CloudWatch (the logs grant is real). The eleventh case (finance invoices)
  is the known follow-up F1.1: the permission guard's school check calls
  identity at the VPC-only Cloud Map URL and fails closed until Sprint 2.
  Cold start 1.9–2.1 s, warm 4–6 ms — see
  `docs/architecture/cost-redesign/measurements.md`.
- **Access:** the deployer user received a temporary inline policy allowing
  `lambda:InvokeFunction` on the three functions only, for the smoke; removed
  after validation.
- **Rollback:** redeploy with the flag unset (removes the additions; ECS is
  unaffected either way).

### 2026-09-03 — Cost redesign Sprint 0, part 1: core-appplane, analytics, tenant-template-basic — Green

- **Scope:** PR #443 (branch `sprint/cost-redesign-0`, HEAD `f22ac87`). No
  non-production environment exists (2026-05 sunset), so each stack went to
  production behind a reviewed `cdk diff`, one stack at a time, via
  `scripts/deploy.sh <stack> prod --exclusively`.
- **core-appplane-stack:** CodeBuild lifecycle alarms merged 2→1 (metric math),
  two build log groups with 30-day retention. CDK flagged the CodeBuild projects
  "may be replaced" for `LogsConfig`; CloudFormation applied it in place. 48 s.
- **analytics-stack:** finance performance dashboard removed (account back to 3
  dashboards), alarms 11→3 (`edforge-analytics-functions-errors`,
  `edforge-control-plane-functions-errors`, rollup heartbeat), seven functions
  `nodejs20.x`→`nodejs22.x`, no function replacement. 35 s. Post-deploy: both
  5-minute janitors invoked 3× on the new runtime with 0 errors.
- **tenant-template-stack-basic:** result-batch alarms 2→1, result-batch and
  post-auth-trigger runtimes → `nodejs22.x`. Diff showed **no task-definition
  change**; deploy took 29 s (no ECS rollout). ECS services unchanged.
- **shared-infra-stack** (after Docker Desktop was restarted and its build
  cache pruned — the host disk was at 99 %): tenant API authorizer
  `python3.10`→`python3.12` with a new layer version (pins fixed:
  `boto3~=1.35`, powertools 2.43.1), updated in place — the
  `TenantApiAuthorizerArn` export value is unchanged; SES reputation alarms
  2→1; 30-day retention on the authorizer and API Gateway execution-log groups.
  Bundling 2.5 min, deploy 163 s. Post-deploy: bad-token probe → 401 (authorizer
  executes on 3.12), 28 `Allow` decisions from live traffic, init 0.8–1.1 s.
- **controlplane-stack:** 30-day retention on the SBT control-plane Lambdas,
  the DLQ processor and the AdminWeb build log group. Deploy 41 s (bundling
  ~7 min).
- **Account after Sprint 0:** 8 alarms (was 19), 3 dashboards (was 4), every
  EdForge-owned Lambda on `nodejs22.x` / `python3.12`, 5 stacks
  `UPDATE_COMPLETE`, ECS task definitions unchanged.
- **Authenticated identity smoke (operator-minted `internal-dev` tenant ID
  token, ~20:09 UTC):** 84 tests run, 81 passed. The three failures are
  pre-existing and unrelated to the sprint: two school-create tests send a
  fixture without the PABSON `emisSchoolCode` (rule since 2026-04-21; MIGRATION_PLAN
  F0.6), and `GET /tenants/lookup` gets the ALB's default 503 because the
  unauthenticated operations carry no `tenantPath` header for the single listener
  rule (F0.5). Every authorizer-gated module passed (users 20/20, sessions,
  security, tenants 3/4, RBAC 11/11).
- **Surfaced, not fixed (follow-ups in MIGRATION_PLAN §0):** the authorizer
  role grants `apigateway:GET` on an `execute-api:` ARN, so `GetApiKey` is
  `AccessDenied` on every cold container (caught; empty `usageIdentifierKey`;
  pre-existing since at least 2026-08-28; no route requires an API key). Ten CDK
  framework singleton Lambdas (LogRetention, AwsCustomResource, Provider,
  autoDeleteObjects, VpcRestrictDefaultSG) are still `nodejs20.x` — that runtime
  is set by `aws-cdk-lib` 2.195 and needs a library bump.

### 2026-09-03 — Cost redesign C0.2: dormant advanced template stack deleted — Green

- **Scope:** operations only, no code deploy. `tenant-template-stack-advanced`
  (a 2026-04-05 template, zero tenants, zero services) deleted from production via
  `scripts/operations/delete-advanced-template-stack.sh` (preflight → delete →
  verify), issued as the CDK deploy role because the deployer identity carries no
  direct `cloudformation:DeleteStack`.
- **Outcome:** auto-scaling group, its t3.micro and 30 GiB volume, the advanced
  ECS cluster and the `advanced` tenant-mapping row are gone. The advanced Cognito
  pool was retained by CloudFormation's `Retain` policy (empty, unprotected, free);
  console deletion by an operator with `cognito-idp:DeleteUserPool` is a follow-up.
- **Expected cost delta:** −$11.07/month (EC2-Instances and EBS lines). Next-day
  Cost Explorer check pending.
- **Follow-ups:** C0.1 (flag-gating the stack in `bin/`) must merge before any
  `cdk deploy --all`; see `docs/architecture/cost-redesign/MIGRATION_PLAN.md`.

### 2026-07-03 — Identity RBAC/ABAC Hardening + `defaultSchoolId` — Green

- **Scope:** Identity service image-only deploy for PRs #403-#409. No CDK deploy.
- **Pre-flight:** `@aibrains/shared-types@0.91.0` was published; CDK diff showed
  only the expected image SHA stamp for the deployed identity change. Pre-existing
  control-plane/AdminWeb drift was explicitly scoped out.
- **Runtime:** identity ECS rollout completed with one healthy task, no rollback,
  and clean Nest bootstrap.
- **Validation:** unauthenticated route probes returned 401; authenticated
  TenantAdmin smoke for `GET /users/me` returned `defaultSchoolId`; guarded staff,
  school, and session routes returned 200 for the admin smoke account.
- **Residual:** portal-account staff-read 403 was not live-smoked in that window;
  coverage existed in the StaffReadGuard unit matrix and `abac-conformance` CI.

### 2026-06-30 — Sprint A.5 Finance Grade Snapshot Backfill, Pilot Tenant — Green

- **Scope:** Operational DDB backfill for the real pilot tenant after a read-only
  reconciliation pass and explicit operator approval gate.
- **Result:** 26 rows scanned, resolved, and written; post-apply verification found
  zero remaining INVOICE/PAYMENT rows missing `gradeLevel`.
- **Safety:** temporary least-privilege IAM was simulator-verified before writes
  and revoked after verification; writes were additive-only and did not change
  invoice status, version, invoice number, or existing GSI state.
- **Closes:** Sprint A.5 pilot leg and issue #343's "< 50 rows -> dry-run + apply"
  branch.

### 2026-06-30 — Sprint A.5 Finance Grade Snapshot Backfill, Dev Tenant — Green

- **Scope:** Operational DDB backfill for the dev-pabson-primary finance dataset
  using the post-parallelization script from PR #348.
- **Result:** 691 rows scanned, resolved, and written; post-apply verification
  found zero remaining rows missing `gradeLevel`.
- **Safety:** the first apply attempt was blocked by missing `UpdateItem`
  permission and mutated zero rows. The operator then granted a temporary
  narrowly-scoped policy, simulator-verified it, reran apply, verified the result,
  and revoked the policy.
- **Follow-up:** a dedicated reusable finance-backfill IAM role remains preferable
  to one-off temporary grants.

### 2026-06-28 — Finance PermissionGuard Hardening + Async Job Framework — Green

- **Scope:** PR #338 (`PermissionGuard` school-scope hardening) and PR #339
  (finance async job framework + `GET /finance/jobs/:jobId`).
- **Deploy:** shared-infra-stack deployed the new API Gateway route; finance ECS
  rolled to the merged app code. Cosmetic tenant-template SHA-stamp drift and
  unrelated control-plane drift were skipped.
- **Validation:** finance task became healthy, Nest bootstrap was clean,
  `BulkOperationsModule` initialized, the jobs route mapped, and unauthenticated
  route probes returned 401 rather than API Gateway fallthrough.
- **Residual:** full auth-gated smoke required a fresh JWT after the original
  token expired.

### 2026-06-28 — Finance Bulk Ops Sprint C Phase 1 Backend — Green

- **Scope:** PR #337 backend Phase 1 for the operator-validated bulk invoice
  wizard flow; `@aibrains/shared-types@0.88.0` was published before deployment.
- **Deploy:** shared-infra-stack added grade-level query params plus the
  `/bulk-preview` route; tenant-template-stack-basic added GSI14 across BASIC
  tables and propagated the finance task-role IAM update; finance ECS rolled to
  the Phase 1 image.
- **Validation:** finance task was healthy, Nest bootstrap was clean, and the
  bulk-preview route mapped in the running container.
- **Residual:** authenticated bulk-preview smoke was operator-pending at the
  time of the entry.

### 2026-06-27 — Pilot Onboarding Previous-Dues Backend — Green After Hotfixes

- **Scope:** PR #330 previous-dues backend deployment, followed by two direct
  recovery hotfixes during the rollout window.
- **Deploy:** shared-infra-stack added the opening-balance route; finance ECS
  ultimately rolled cleanly after both dependency-injection hotfixes.
- **Incident summary:** two new images crash-looped during bootstrap because
  modules that locally provided shared services were missing newly-required
  providers. ECS circuit breaker kept the prior task definition live until the
  final image booted cleanly.
- **Validation:** route probe returned 401 after deployment, proving API Gateway
  and service routing were live; prod smoke later passed all 7 previous-dues
  lifecycle cases.
- **Follow-up:** the module-wiring invariant was expanded so modules that locally
  provide `StudentAccountsService` or `PermissionGuard` must also provide their
  full constructor dependency set.

### 2026-06-20 — Cognito To SES Cutover — Green

- **Scope:** SES Sprint 0-2 cutover of BASIC tenant Cognito email delivery from
  Cognito default sender to the verified SES identity.
- **Result:** production tenant pool `EmailConfiguration` used SES developer
  sending; independent Gmail and Outlook recipient flows passed SPF, DKIM, DMARC,
  and end-to-end onboarding validation.
- **Architecture note:** durable design and retrospective details moved to
  `docs/operations/ses-cognito-cutover-closeout.md`.
