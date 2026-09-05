# Sprint 7 — pre-implementation audit and design (2026-09-05)

Tenant lifecycle without CodeBuild (Q3). Read before C7.1–C7.5 were coded;
decisions below refine the tickets in MIGRATION_PLAN.md.

## What was read

- `core-appplane-stack.ts` (the two `TenantLifecycleScriptJob`s, the
  `CoreApplicationPlane`, the CodeBuild failure alarm and its
  `edforge-provisioning-alerts` topic, the `DestroyPolicySetter` aspect on
  the stack), `provision-tenant.sh`, `deprovision-tenant.sh`,
  `update-provision-source.sh`.
- SBT 0.9.1 source: `event-manager.js` (detail types are prefixed
  `sbt_aws_`, sources `sbt.control.plane` / `sbt.application.plane`),
  `script-job.js` and `tenant-lifecycle-script-jobs.js` (the outgoing
  envelope), `tenant-registrations/index.py` (what the onboarding and
  offboarding events carry) and `tenant-registration.service.js` (what SBT
  itself does with our success and failure events).
- `tenant-seeder-lambda.ts` (the consumer of `provisionSuccess`),
  `control-plane-stack.ts`, the `bin` wiring and stack dependency order,
  `analytics-stack.ts` (the control-plane errors alarm that C7.3 was written
  to extend), `migrate-tenant-alert-topics.ts` (alert-topic semantics), the
  AdminWeb tenant model.

## Findings

**F7.1 The contract is exact and small.** SBT's registration service puts
`sbt_aws_onboardingRequest` on the bus (source `sbt.control.plane`) with the
detail flattened: `tenantRegistrationData | tenantData | { tenantId }`, so
`tenantRegistrationId`, `tenantId`, `tenantName`, `email`, `tier`, `country`,
`archetype`, `tenantTag`, `prices`, `useFederation` sit at `detail.*`. The
script job answers with source `sbt.application.plane`, detail-type
`sbt_aws_provisionSuccess`, detail
`{ tenantRegistrationId, jobOutput: { tenantData: {…}, tenantRegistrationData: { registrationStatus } } }`
or `sbt_aws_provisionFailure` with `jobOutput: { tenantStatus: 'Failed to provision tenant.' }`.
SBT consumes all four lifecycle results itself through an API destination
that PATCHes `/tenant-registrations/{tenantRegistrationId}` with
`$.detail.jobOutput` — that is how the registration's status and the
tenant's `tenantConfig` land in the control-plane tables. Our seeder is the
other consumer of `provisionSuccess`. Offboarding: `sbt_aws_offboardingRequest`
with the tenant data merged with the registration item; the script job
answers `sbt_aws_deprovisionSuccess` with `tenantRegistrationData: { registrationStatus: 'Deleted' }`.

**F7.2 What the provisioning script actually does for a BASIC tenant** (the
rest is the deferred silo path): read the pool and client ids from the
tenant stack outputs; `admin-create-user` with `email`, `email_verified`,
`phone_number=+11234567890`, `custom:userRole=TenantAdmin`,
`custom:tenantId`, `custom:tenantTier`, `custom:tenantName`; `create-group
<tenantId>`; `admin-add-user-to-group`; create `edforge-alerts-tenant-<tenantId>`
and subscribe the admin email; attach `alertTopicArn` to the identity METADATA
row with a 60-second poll because the seeder writes that row asynchronously;
export `tenantConfig = { userPoolId, appClientId, apiGatewayUrl }` and
`registrationStatus = Created`. It also validates `archetype` (PABSON |
GENERIC) and `tenantTag` (falls back to `production`).

**F7.3 Deprovisioning has no safety gate today** beyond the tier check: it
deletes every Cognito user in the tenant group, the group, and every item of
the tenant partition in the three tables. Only 3 of the 6 registrations have
an identity METADATA row (tags production ×2, internal-dev ×1).

**F7.4 The `apiGatewayUrl` the script reads no longer exists** — the
`ApiGatewayUrl` export went with API-A in C6.3, so the script would have
written an empty value since Sprint 6. The Lambda passes the API-B URL.

**F7.5 KMS keys.** SBT creates one key per script job without a removal
policy; the stack's `DestroyPolicySetter` aspect sets DESTROY on every
resource, so removing the jobs deletes the keys through CloudFormation, which
schedules deletion with the KMS default 30-day window. Billing stops at
scheduling (Phase 1).

**F7.6 Alarm budget.** Removing the script jobs removes
`edforge-provisioning-codebuild-failures` (10 → 9). The control-plane errors
alarm in analytics-stack was written as metric math "so the
provisioner/deprovisioner Lambdas can be added as further terms".

## Decisions

- **D7.1 Shape.** One construct, `TenantLifecycleLambdas`, in
  controlplane-stack (the plan's location): two `NodejsFunction`s on
  `nodejs22.x` behind rules on the SBT bus for the two request events, with
  the source and detail types taken from the `IEventManager` instance. They
  emit the script job's exact envelopes so SBT's PATCH target and the seeder
  keep working unchanged; `tenantData` carries every field the script
  exported plus `alertTopicArn`, `tenantConfig` carries the API-B URL.
- **D7.2 Idempotent by construction.** EventBridge and Lambda both retry, so
  every step is create-if-missing (`UsernameExistsException`,
  `GroupExistsException`, an existing membership, `CreateTopic` returning the
  existing ARN, `Subscribe` deduplicating) and a second run converges to the
  same tenant. Permanent failures (non-BASIC tier, unknown archetype after
  normalisation is not one — it falls back to GENERIC like the script) emit
  `provisionFailure`, publish a summary to `edforge-provisioning-alerts` and
  return without throwing; unexpected exceptions throw so the retries and the
  control-plane errors alarm see them.
- **D7.3 The seeder persists `alertTopicArn`.** The script attached it to
  METADATA with a poll-retry after the seeder had written the row. The Lambda
  creates the topic before emitting `provisionSuccess` and puts the ARN in
  `tenantData`; the seeder gains one attribute. One writer of METADATA, no
  race. This is the one change to the seeder; the plan said "untouched", and
  the deviation is deliberate.
- **D7.4 Default-deny deprovisioning (D8.3).** The deprovisioner reads the
  identity METADATA row: `tenantTag` absent, row absent, or `production` →
  refuse unless the event detail carries `confirmProduction: true`; refusal
  emits `deprovisionFailure` (`tenantStatus`) so the registration reflects it,
  and publishes to the provisioning-alerts topic. The only producer of the
  flag is `scripts/tenant/offboard.ts`, which puts the offboarding event on
  the bus directly with `tenantRegistrationId` looked up from the
  registration table. AdminWeb's delete therefore works for
  `internal-dev`/`internal-dev-rehearsal` tenants and is refused for
  production and legacy untagged tenants.
- **D7.5 Permissions.** The pool id is only known at runtime (the tenant
  stack depends on controlplane, so it cannot be imported), so the functions
  read the tenant stack's `TenantUserpoolId` / `UserPoolClientId` outputs with
  `cloudformation:DescribeStacks` once per warm environment, and the Cognito
  grant is on `userpool/*`. DynamoDB: `GetItem` on identity METADATA, and
  `Query` + `BatchWriteItem` on the three tables for the deprovisioner. SNS on
  `edforge-alerts-tenant-*` and `Publish` on `edforge-provisioning-alerts`
  (a fixed name; core-appplane depends on controlplane, so the ARN is built,
  not imported). `events:PutEvents` on the SBT bus.
- **D7.6 Retirement flag.** `CDK_PARAM_SBT_SCRIPT_JOBS=true` keeps today's
  jobs, alarm and `CoreApplicationPlane`; default off emits none of them. The
  alert topic and its subscription stay in core-appplane in both modes.
  `provision-tenant.sh`, `deprovision-tenant.sh` and
  `update-provision-source.sh` stay as the silo-tier path; the source bucket
  gets a lifecycle rule (C7.5) by an operator command documented in the
  upload script.
- **D7.7 Order.** Deploy controlplane (functions live, rules attached — from
  that moment a new registration is provisioned by both the Lambda and the
  script job until core-appplane follows; the script job's second
  `admin-create-user` fails on the existing user, which SBT reports as a
  failure event that the Lambda's success already superseded). To avoid that
  window, core-appplane is deployed immediately after controlplane and no
  tenant is created between the two. Then the round trip (C7.4) with a
  throwaway `internal-dev-rehearsal` tenant created from AdminWeb, verified
  and offboarded by the smoke script.
  **Superseded in execution** (see Execution): core-appplane went first,
  because the deployed core-appplane imported the SBT bus ARN through a
  controlplane auto-export that the new controlplane template drops, and
  CloudFormation will not remove an export another stack still imports.

## Execution

Executed 2026-09-05 (times UTC). Deploy logs and the before/after state
snapshots stay in the private evidence directory; nothing below carries an
identifier.

### Order as executed — core-appplane first

The pre-flight found what the design missed: the deployed core-appplane
template imported the SBT bus **ARN** from a CDK auto-export on controlplane
(the script jobs' `events:PutEvents` grants), and the new controlplane
template drops that export because nothing references it any more.
CloudFormation refuses to remove an export while another stack imports it, so
controlplane-first (D7.7) would have rolled back. Executed order:
core-appplane → controlplane → analytics. The trade: between the first two
deploys neither the script job nor the function consumed
`sbt_aws_onboardingRequest`. That window (21:41–21:51) ran with no tenant
created; the registration table showed nothing in progress before or after.

| Step | Stack | Window | Result |
|---|---|---|---|
| 0 | all three | 21:30–21:38 | one `cdk diff` of the three stacks, identical to the reviewed diffs (16 / 28 / 1 change lines) |
| 1 | core-appplane | 21:39:14 → 21:41:47 (CFN 106 s) | 27 resources removed; both KMS keys `PendingDeletion` (deletion date 2026-10-05, billing stopped at scheduling); both script-job rules off the bus; the CodeBuild alarm gone (nine alarms remain); the alerts topic, its policy and subscription untouched |
| 2a | controlplane | 21:42:17 → 21:43:56 | **UPDATE_ROLLBACK_COMPLETE** — "No export named shared-infra-stack:ExportsOutputRef…TenantApiLambda… found". `tenantApiUrl: sharedInfraStack.apiGatewayLambda.baseUrl` had made CDK mint a second, auto-named export on shared-infra for the REST API id, which only a shared-infra deploy creates; `cdk diff` of the consumer cannot show that. The rollback left the stack identical to its pre-deploy state. |
| fix | — | 45aade9 | the controlplane imports the existing named export `TenantApiLambdaUrl` (same string, live in every environment) through `cdk.Fn.importValue(API_B_URL_EXPORT)`; typecheck, eslint and the 41 bootstrap-template tests green; fresh diff: shared-infra **no differences**, controlplane identical to the reviewed diff |
| 2b | controlplane | 21:50:22 → 21:53:34 | 12 additions plus the seeder's inline code; the bus ARN export gone, the two function exports added |
| 3 | analytics | 21:53:43 → 21:54:56 (CFN 15 s) | control-plane errors alarm expression `FILL(seeder, 0) + FILL(prov, 0) + FILL(deprov, 0)`, state OK |

### Verification (read-only, after step 3)

- Both functions `Active` on `nodejs22.x` (provisioner 60 s / 256 MB,
  deprovisioner 300 s / 512 MB) with the designed environment;
  `TENANT_API_URL` resolves to the API-B production base URL.
- Rules `edforge-tenant-provisioner` and `edforge-tenant-deprovisioner`
  enabled on the SBT bus — pattern `source: sbt.control.plane` with
  `sbt_aws_onboardingRequest` / `sbt_aws_offboardingRequest`, one Lambda
  target each, two retries, 15-minute maximum event age.
- Log groups for both functions with 30-day retention.
- IAM Policy Simulator against the deployed roles: every designed action
  `allowed` — provisioner: `AdminCreateUser`, `CreateGroup`,
  `AdminAddUserToGroup` on the BASIC pool, `CreateTopic` and `Subscribe` on
  `edforge-alerts-tenant-*`, `Publish` on the alerts topic, `PutEvents` on
  the bus, `DescribeStacks` on the tenant stack; deprovisioner:
  `ListUsersInGroup`, `AdminDeleteUser`, `DeleteGroup`, `Query` and
  `BatchWriteItem` on the three tables, `GetItem` on identity,
  `DeleteTopic`, `PutEvents`. Negative controls `implicitDeny`: provisioner
  `AdminDeleteUser`; deprovisioner `AdminCreateUser` and `GetItem` on the
  finance table.
- The deployed seeder code carries `alertTopicArn`.
- Registration table: three `Created`, one `Deleted`, nothing in progress.
- Nine alarms, all OK; no customer-managed KMS key enabled in the account.

### Round trip (C7.4) — passed

A throwaway tenant (tag `internal-dev-rehearsal`, archetype GENERIC, country
USA, tier BASIC) created from AdminWeb at 22:11 UTC and deleted from AdminWeb
at 22:53 UTC, watched live on the function logs, the seeder log and the SBT
registration table.

| Time (UTC) | Step | Evidence |
|---|---|---|
| 22:11:33 | provisioner | user, group and alert topic created, success event emitted; 1.8 s, 107 MB |
| 22:11:35 | seeder | METADATA (with tag and alert topic) and workspace settings written; registration `Created`, active |
| 22:11 | smoke `EXPECT=provisioned` | 7/7 |
| 22:15 | admin invite | first login set the password; login history, session, user row written; Cognito user `CONFIRMED` |
| 22:15–22:26 | real use | school, academic year, generated calendar (382 identity rows), dashboards served by academics and finance |
| 22:53:27 | deprovisioner | 1 user deleted, 382 + 1 + 0 rows deleted across the three tables, group and topic deleted, success event emitted; 1.1 s, 115 MB |
| 22:53 | SBT | registration `Deleted`, inactive |
| 22:54 | smoke `EXPECT=deprovisioned` | 5/5; no message on the provisioning-alerts topic; both function alarms OK |

The window between the two deploys and the whole round trip produced no
message on `edforge-provisioning-alerts` and no alarm transition.

### Found on the way (pre-existing, not Sprint 7)

The inspection of the rehearsal tenant's activity surfaced defects that need
their own tickets; none is caused by this sprint and none was fixed here:

- Product: the shell home header always renders a Bikram Sambat date
  (frontend #346); "Import IEMIS" and "Govt. Reports" are offered to every
  tenant and the APIs behind them are not gated by archetype (frontend #345,
  backend #456).
- Runtime (to ticket): the analytics tenant-settings resolver rejects every
  workspace-settings row because the seeder stores the three sections as JSON
  strings while the resolver wants maps, so day buckets fall back to fleet
  defaults for all tenants; the identity feature-usage analytics emit is
  fire-and-forget and the frozen Lambda container sends it late ("Signature
  expired", 33 a day); the GENERIC bell-schedule preset's `passing` periods are
  validated as class periods, so GENERIC schools are created without a bell
  schedule.

### After the delete — what is left of a tenant (audit, 2026-09-05 23:00 UTC)

Read-only audit of the account after the rehearsal tenant and the three
tenants deleted earlier on the script-job path:

| Where | Rehearsal tenant | Three older deleted tenants |
|---|---|---|
| Cognito BASIC pool | admin user gone (lookup by username and by email attribute both empty), group gone; the email is free for the next tenant | no user or group left; the pool holds 30 users in exactly the three live groups |
| identity / academics / finance tables | 0 / 0 / 0 rows | 0 / 0 / 0 rows each |
| tenant alert topic | deleted (its pending email subscription with it) | none left |
| S3 (pdfs, pdf-assets, reports staging/archive, analytics exports) | no object under any tenant prefix (`tenants/<id>/`, `tenant=<id>/`, `exports/<id>/`); every service bucket is empty | same |
| analytics tables (`edforge-analytics`, `edforge-analytics-landing`) | 11 day-bucket rows and the raw landing events remain, all with a 90-day TTL (expire 2026-12-04) | none left (expired) |
| SBT tables | tenant row kept with `sbtaws_active=false`; registration `Deleted`, inactive | rows kept inactive; the two oldest carry an empty registration status |
| shared-infra tenant mapping table | one row (`basic` → stack); nothing per tenant | — |

Parity with the retired script: `deprovision-tenant.sh` deleted the same
three partitions, the users and the group, and nothing else. The function
adds the alert topic. Analytics rows are left to their TTL by design; if a
hard purge is ever required, the deprovisioner is the place (the aggregate
table is keyed `TENANT#<id>`).

SBT keeps deleted tenants as inactive rows, so the AdminWeb list shows them
greyed out with the delete action disabled (`client/AdminWeb/src/pages/Tenants/TenantList.tsx:140,190–218`).
The status chip on those cards reads `COMPLETE` because the list API returns
tenant rows without a registration status and the mapper defaults to
`complete` (`TenantList.tsx:133–139`); a deleted tenant should read
`DELETED`, and the list should hide inactive tenants by default — an
AdminWeb follow-up, not a data problem.

### Closed

- C7.5 done by the operator 2026-09-05: lifecycle rule `expire-provision-source`
  on the provisioning source bucket (30-day expiry for current and noncurrent
  versions; the bucket is versioned and held one tarball).
- PR #455 merged 2026-09-05. Sprint 7 complete; the account carries no fixed
  monthly line.
- Lesson for the plan: a stack that stops referencing another stack's
  resource is deployed **before** the producer, and a new reference into a
  stack that is not part of the deploy must use an export that already
  exists (`cdk diff` of the consumer does not reveal either).
