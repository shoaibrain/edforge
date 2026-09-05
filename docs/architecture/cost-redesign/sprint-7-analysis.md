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

## Execution

Filled in as executed.
