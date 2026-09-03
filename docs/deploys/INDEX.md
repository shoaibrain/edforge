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
