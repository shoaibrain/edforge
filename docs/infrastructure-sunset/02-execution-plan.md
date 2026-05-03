---
title: EdForge Infrastructure Sunset & Cost Optimization — Execution Plan
date: 2026-05-01
companion: 01-audit-report.md
target: us-east-2 teardown + ap-south-1 ≤$100/month
---

# How to use this document

Each phase is self-contained. Phase 0 is a hard prerequisite for Phase 1. Phases 2–4 in ap-south-1 can run in any order subject to the maintenance-window flags. Phase 5 (documentation/stale-reference cleanup) runs in parallel with the others and finishes after Phase 1.

Every action below is described as **instructions to the engineer**, not as code. Refer to the audit report (`01-audit-report.md`) for the "why" behind any item.

Risk levels:
- **GREEN** — No data risk, no downtime, fully reversible.
- **YELLOW** — Brief downtime acceptable in a pilot maintenance window. No data risk if the runbook is followed.
- **RED** — Should not be attempted in this plan. Listed for completeness as Phase 4 (deferred).

---

# Phase 0 — Safety First (BLOCKING for Phase 1)

**Goal:** Make it impossible to teardown the wrong account by accident, and snapshot prod state before any change is applied.

## 0.1 Harden `scripts/cleanup/cleanup.sh`

Add the following at the very top of the script, immediately after the shebang and any `set -euo pipefail` line:

1. Resolve `ACCOUNT_ID` via `aws sts get-caller-identity --query Account --output text`.
2. Resolve `REGION` via `aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]'`.
3. Define `ALLOWED_ACCOUNT="715860911762"` and `ALLOWED_REGION="us-east-2"` and `BLOCKLIST_ACCOUNT="257526644020"` and `BLOCKLIST_PROFILE="prod"`.
4. If `$ACCOUNT_ID` equals `$BLOCKLIST_ACCOUNT`, abort with a banner that reads "REFUSING TO RUN — this is the production account."
5. If `$AWS_PROFILE` equals `$BLOCKLIST_PROFILE`, abort with the same banner.
6. If `$ACCOUNT_ID` does not equal `$ALLOWED_ACCOUNT` OR `$REGION` does not equal `$ALLOWED_REGION`, abort with a banner showing the resolved values.
7. Update the existing user-confirmation prompt to print the resolved account, region, and `$AWS_PROFILE` value so the operator visually confirms before typing `y`.
8. Add an explicit DynamoDB delete pass. **Insertion point: after the wildcard Cognito cleanup block (around the existing line ~287) and BEFORE the ECR repository delete loop (around the existing line ~289).** Iterate over the four EdForge tables (`edforge-identity-basic`, `edforge-academics-basic`, `edforge-finance-basic`, `TenantMapping`) and issue `aws dynamodb delete-table --table-name <name>` for any that still exist. Skip silently if the table is already gone. This pass exists to catch RETAIN-policy survivors that `cdk destroy` left behind. Note: in us-east-2 the tables hold no production data so direct deletion is safe; the same pass MUST NOT exist in any prod-targeting variant of the script.

Mirror items 1–6 verbatim into `cleanup-cloudfront.sh` and `cleanup-cognito.sh` at their entry points. CloudFront is global so the `REGION` check is informational only.

**Files affected:** `scripts/cleanup/cleanup.sh`, `scripts/cleanup/cleanup-cloudfront.sh`, `scripts/cleanup/cleanup-cognito.sh`.
**Risk:** GREEN.
**Rollback:** Revert the file in git; the original behavior returns.

## 0.2 Remove or rewrite stale cleanup tooling

Three files in `scripts/cleanup/` contain references to a foreign account (`346698404105`) and a region (`us-east-1`) that EdForge has never used. Decide between two paths:

**Option A (recommended):** Delete `scripts/cleanup/aws-nuke-setup.sh`, `scripts/cleanup/README-AWS-NUKE.md`, and `scripts/cleanup/delete-remaining-stacks.sh`. The first two are fully redundant with hardened `cleanup.sh`. The third file's `--retain-resources` pattern is useful conceptually but the configured ARNs are unusable. Replace it later with a fresh script if `DELETE_FAILED` recovery is ever needed.

**Option B:** Keep the files but rewrite each one's account/region/profile constants to reflect EdForge reality (`715860911762` / `us-east-2` / `uat`) and add the same Phase-0.1 guards. Update the ECR repo list in the aws-nuke config to include `finance`. Replace the DynamoDB filter pattern with literal table names.

**Recommendation:** Option A. Less code is safer code.

**Files affected:** As above. Also confirm `.gitignore` does not list `scripts/cleanup/aws-nuke-setup.sh` or `delete-remaining-stacks.sh` — if the files are being kept untracked elsewhere, deletion will not actually remove them from disk on developer machines until they `git clean`. Grep `.gitignore` and any nested `.gitignore` to confirm.
**Risk:** GREEN (deleting unused scripts is reversible via git).

## 0.3 `cleanup-secrets.sh` — delete

Pattern `rds_proxy_multitenant` matches no EdForge resources. Delete the file. If the deploy wrapper still calls it, remove the call.

**Files affected:** `scripts/cleanup/cleanup-secrets.sh`, plus any caller (the only known caller is `cleanup.sh` line ~103 — replace the conditional block with a no-op or remove it).
**Risk:** GREEN.

## 0.4 Enable production stack termination protection

Edit `server/bin/ecs-saas-ref-template.ts` to add `terminationProtection: true` to the props of every stack instantiation that runs in the prod account. The setting must be conditional so UAT teardown is unaffected. **Use an account-id check (e.g. `app.account === '257526644020'` or equivalent reading from `cdk.Stack.of(...).account` after stack instantiation), NOT a string match on `EDFORGE_ENV`.** Account-id is the strongest signal and survives shell-environment mistakes; a developer who fat-fingers `EDFORGE_ENV=prod` while pointing at the UAT profile would otherwise enable termination protection on stacks scheduled for teardown.

**Stacks to protect (prod only):**
- `shared-infra-stack`
- `controlplane-stack`
- `analytics-stack`
- `core-appplane-stack`
- `tenant-template-stack-basic`

Deploy each protected stack with the standard wrapper:
```
./scripts/deploy-analytics.sh <stack-name> prod
```

Verify with `aws cloudformation describe-stacks --stack-name <name> --query 'Stacks[0].EnableTerminationProtection'` — must return `true`.

**Files affected:** `server/bin/ecs-saas-ref-template.ts`.
**Risk:** YELLOW (deploy required, but no resource changes; CFN no-op except stack metadata).
**Rollback:** Set `terminationProtection: false` and redeploy.

## 0.5 Enable Cognito tenant-pool deletion protection

Edit `server/lib/tenant-template/identity-provider.ts` to add `deletionProtection: cognito.DeletionProtection.ACTIVE` to the `UserPool` construct. Apply only to the prod-profile path (or unconditionally if SBT-CognitoAuth in `controlplane-stack.ts` allows passthrough).

Deploy via:
```
./scripts/deploy-analytics.sh tenant-template-stack-basic prod
```

Verify with `aws cognito-idp describe-user-pool --user-pool-id <pool-id> --query 'UserPool.DeletionProtection'` — must return `ACTIVE`.

**Files affected:** `server/lib/tenant-template/identity-provider.ts`. Optionally `server/lib/bootstrap-template/control-plane-stack.ts` if SBT exposes the property.
**Risk:** YELLOW (CFN update on Cognito pool — no user data changes; pool stays in place).
**Rollback:** Switch the property back to `INACTIVE` and redeploy.

## 0.5b Enable DynamoDB table deletion protection

`RemovalPolicy.RETAIN` defends only against CloudFormation-driven deletion. A direct `aws dynamodb delete-table` call or a console deletion bypasses RETAIN. For irrecoverable pilot data this is the last line of defence and must be on.

Edit the table definitions:

- `server/lib/shared-infra/shared-infra-stack.ts:269-275` — add `deletionProtectionEnabled: true` to the `TenantMappingTable`.
- `server/lib/tenant-template/ecs-dynamodb.ts` — add `deletionProtectionEnabled: true` to each of the three EdForge tables (`edforge-identity-basic`, `edforge-academics-basic`, `edforge-finance-basic`).
- `server/lib/analytics/analytics-stack.ts` — add `deletionProtectionEnabled: true` to the analytics events table.

The change is gated on the same account-id check as Phase 0.4 (so UAT teardown isn't blocked by a deletion-protected table).

Deploy: `./scripts/deploy-analytics.sh shared-infra-stack prod`, then `./scripts/deploy-analytics.sh tenant-template-stack-basic prod`, then `./scripts/deploy-analytics.sh analytics-stack prod`. CFN updates the property in place — no table recreation.

Verify with `aws dynamodb describe-table --table-name <name> --query 'Table.DeletionProtectionEnabled'` for each — must return `true`.

**Files affected:** `server/lib/shared-infra/shared-infra-stack.ts`, `server/lib/tenant-template/ecs-dynamodb.ts`, `server/lib/analytics/analytics-stack.ts`.
**Risk:** YELLOW (deploy required; in-place property change; no data risk).
**Rollback:** Set the property to `false` and redeploy.

## 0.6 Snapshot ap-south-1 prod state

Before any optimization touches prod, capture a full inventory snapshot — the rollback reference. Mirror the format of `pre_teardown_snapshot_cycle2.md` if that file exists; otherwise produce a new file at `docs/infrastructure-sunset/snapshot-prod-pre-optimize-<YYYYMMDD>.md`.

The snapshot must include, at minimum:
- CloudFormation stack list with status and last-updated timestamps.
- For `shared-infra-stack`: VPC ID, subnet IDs, NAT Gateway count and IDs, ALB ARN, NLB ARN, API Gateway REST API ID.
- For `tenant-template-stack-basic`: ECS cluster name, service ARNs and `desiredCount` per service, task-definition revisions in use, target group ARNs, listener-rule priorities and conditions.
- For each DynamoDB table (`TenantMapping`, `edforge-*-basic`, analytics table): `pointInTimeRecoveryEnabled`, `tableStatus`, `itemCount`.
- ECR repo list with `imagePushedAt` of `:latest` for each.
- CloudFront distribution IDs and DomainNames in use.
- `aws cognito-idp list-user-pools --max-results 60` output.

**Files affected:** New `docs/infrastructure-sunset/snapshot-prod-pre-optimize-<date>.md`.
**Risk:** GREEN (read-only).

## 0.7 Verify production data is real

Cross-check by listing items in each `edforge-*-basic` DynamoDB table. Confirm at least one `METADATA#` row exists for the pilot tenant and that no rehearsal-tenant rows are present. If rehearsal data is found in prod, escalate to Shoaib before continuing — that is a data-hygiene problem distinct from this plan.

**Files affected:** None.
**Risk:** GREEN (read-only).

## 0.8 CI assertion: `DestroyPolicySetter` MUST NOT be applied to tenant-template-stack

The protection that keeps tenant DynamoDB tables alive on stack delete is a comment block at `server/bin/ecs-saas-ref-template.ts:225-228` plus the absence of a `cdk.Aspects.of(tenantTemplateStack).add(new DestroyPolicySetter(...))` line. A future PR ("apply destroy aspect to every stack" refactor) could silently override every `RemovalPolicy.RETAIN` on tenant DDB tables. Pilot data is irrecoverable; this is cheap insurance.

Add a CI check that fails if `DestroyPolicySetter` and `tenantTemplateStack` (or `tenant-template-stack-basic`) appear within a small window of each other in `server/bin/ecs-saas-ref-template.ts`. Implementation options:

1. **Pre-commit hook**: a 5-line shell snippet using `grep -nE 'DestroyPolicySetter' server/bin/ecs-saas-ref-template.ts` and asserting the matching line numbers do not co-occur with `tenantTemplateStack`/`tenant-template-stack-basic` references within ±5 lines.
2. **CI job**: same logic in a GitHub Actions step (or whatever CI is in use). Fail the build if the assertion trips.

Either option is acceptable. The pre-commit hook gives faster feedback; the CI job is more robust because it can't be bypassed by a developer running `git commit --no-verify`.

**Files affected:** `.github/workflows/<job>.yml` (or pre-commit config) plus a small assertion script.
**Risk:** GREEN.

---

# Phase 1 — us-east-2 teardown

**Goal:** Remove every billable resource in account `715860911762` / region `us-east-2`.
**Prerequisite:** Phase 0 complete and merged.
**Operator:** Shell with `AWS_PROFILE=uat` exported. Verify before every step.

## 1.1 Pre-flight verification

Run these checks in order. Abort if any fails:

1. `aws sts get-caller-identity --query Account --output text` returns `715860911762`.
2. `aws ec2 describe-availability-zones --query 'AvailabilityZones[0].RegionName' --output text` returns `us-east-2`.
3. `echo $AWS_PROFILE` returns `uat`.
4. `aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE` lists at least the five expected stacks: `shared-infra-stack`, `controlplane-stack`, `analytics-stack` (if deployed in UAT), `core-appplane-stack`, `tenant-template-stack-basic`.
5. The `cleanup.sh` you are about to run is the **hardened version** from Phase 0.1 — confirm by reading the first 30 lines.

## 1.2 Run hardened `cleanup.sh`

Execute, with output tee'd to a deploy log per house convention:

- Log path: `docs/deploys/uat-teardown-cleanup-<YYYYMMDD-HHMMSS>-<gitsha>.log`
- Confirm at the prompt only after visually verifying the resolved account/region/profile in the WARNING banner match `715860911762` / `us-east-2` / `uat`.
- The script will run the full sequence documented in §2.2 of the audit report: empty S3 versioned objects, force-delete ECS services, delete tenant CFN stacks, `cdk destroy --all --force`, delete remaining Cognito pools, delete CW logs, delete ECR repos, plus the new explicit DDB-table delete pass added in Phase 0.1.

Expected runtime: 60–120 minutes total, **wall-clock dominated by CloudFront disable+delete** which is typically 15–30 minutes per distribution. With both the AdminWeb distribution and any access-log-related distributions in scope, plan for 30–50 minutes of CloudFront work alone. ECS service drain adds another 5–15 minutes. Step into the script with the expectation that you will be watching it idle for long stretches; this is normal.

## 1.3 Post-cleanup manual verification

After `cleanup.sh` exits, manually verify:

1. `aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE DELETE_FAILED` returns no EdForge stacks. Any `DELETE_FAILED` stack indicates a stuck resource — investigate the StackEvents output, identify the blocked resource type, and remove it manually before retrying the stack delete.
2. `aws dynamodb list-tables` lists no EdForge tables.
3. `aws s3 ls` shows no `shared-infra-stack-*`, `controlplane-stack-*`, `core-appplane-*`, `tenant-update-stack-*`, `tenant-template-stack-*`, `saas-reference-architecture-*` buckets.
4. `aws ecr describe-repositories` shows no `identity`, `academics`, `finance`, or `rproxy` repos.
5. `aws cognito-idp list-user-pools --max-results 60` shows no pools tagged `SaaSFactory=ECS-SaaS-Ref` and no pools matching the EdForge naming patterns.
6. `aws ec2 describe-nat-gateways --filter Name=state,Values=available,pending,deleting` returns an empty list. Same for `describe-vpc-endpoints`, `describe-internet-gateways` (only the default if any), and `describe-vpcs --query 'Vpcs[?IsDefault==\`false\`]'`.
7. `aws elbv2 describe-load-balancers` returns an empty list.
8. `aws iam list-roles --query 'Roles[?starts_with(RoleName, \`shared-infra-stack-\`) || starts_with(RoleName, \`controlplane-stack-\`) || starts_with(RoleName, \`core-appplane-stack-\`) || starts_with(RoleName, \`tenant-template-stack-\`)].RoleName'` returns an empty list. Manually delete any survivors.
9. `aws lambda list-functions` returns no `tenant-seeder` or `cognito-post-auth-*` functions.
10. `aws events list-event-buses` shows only the `default` bus.

## 1.4 CDK bootstrap stack — keep or remove?

`CDKToolkit` is the bootstrap stack. If this account will never run `cdk deploy` again, remove it: empty its S3 staging bucket then `aws cloudformation delete-stack --stack-name CDKToolkit`. If there is any chance UAT will be reincarnated later, keep it (the bootstrap stack costs <$0.10/month and saves a 5-minute redeploy).

**Recommendation:** Remove it. The single-region/single-account world starts after this teardown.

## 1.5 24-hour cost-leak verification

Wait 24 hours after `cleanup.sh` completes. Check Cost Explorer for account `715860911762`:

- Today and prior day spend should be zero or fractional cents.
- Any line item > $0.10/day indicates an orphaned resource — most often a NAT Gateway in a stuck VPC, an unattached EIP, or an undeleted CloudWatch log group with high data ingestion. Track it down by service name in Cost Explorer and remove.

## 1.6 7-day cost-leak verification

Re-check Cost Explorer at the 7-day mark. Verify zero daily spend for the entire week. If so, the teardown is complete.

## 1.7 Account decision

Account `715860911762` is the **AWS Organizations management account**. It cannot be closed while the organization exists. Document this in the deploy log and leave the account as a near-zero-cost shell. Optionally:

- Remove the local `[uat]` profile entry from `~/.aws/credentials` and `~/.aws/config` to prevent muscle-memory `AWS_PROFILE=uat` accidents.
- Rotate any IAM access keys still active on the account.
- Disable any CLI sessions or saved IAM Identity Center bookmarks.

**Files affected (local laptop):** `~/.aws/credentials`, `~/.aws/config`. Not in git.
**Risk:** GREEN (local-machine hygiene).

---

# Phase 2 — ap-south-1 optimization (safe changes, GREEN risk)

**Goal:** Land all no-downtime, no-data-risk changes first. These compound to roughly $20–25/month savings before any maintenance window is required.
**Prerequisite:** Phase 0 complete. Phase 1 not strictly required but reduces operator distraction.
**Profile:** `prod`. Verify `AWS_PROFILE=prod` and `aws sts get-caller-identity` returns `257526644020` before each step.

## 2.1 CloudWatch log retention

Reduce log retention on every log group that does not have an explicit business reason for longer history. Edit:

- `server/lib/shared-infra/api-gateway.ts:114` — already at `ONE_WEEK`. Keep, but verify; some prior commits may have widened it.
- `server/lib/bootstrap-template/tenant-seeder-lambda.ts:53` — already `ONE_WEEK`. Keep.
- `server/lib/tenant-template/services.ts:166` — Service Connect traffic logs at `ONE_MONTH`. **Reduce to `ONE_WEEK`** at pilot scale.
- `server/lib/tenant-template/services.ts:72` — identity-service log group at `ONE_MONTH`. **Keep at `ONE_MONTH`** — this drives the IEMIS audit metric filter, and operators may need 30-day lookback.
- `server/lib/auth-events/cognito-post-auth-trigger.ts:78` — at `ONE_MONTH`. **Reduce to `TWO_WEEKS`** — login analytics rarely need 30 days.
- `server/lib/utilities/ecs-utils.ts:161` — auto-created ECS task log groups default to `ONE_WEEK`. **Keep.**
- `server/lib/analytics/analytics-stack.ts:191`, `:630`, `:813` — all `ONE_MONTH`. **Keep at `ONE_MONTH`** — analytics troubleshooting often requires 30-day lookback.

Also reduce VPC Flow Logs:
- `server/lib/shared-infra/shared-infra-stack.ts:70-76` — switch `FlowLogTrafficType.ALL` to `FlowLogTrafficType.REJECT` (drops volume by ~90%) AND set `RetentionDays.ONE_WEEK` on the destination log group. If flow logs aren't actively being analyzed today, **disabling them entirely** is the better choice — turn them on only when investigating a network issue.

Deploy: `./scripts/deploy-analytics.sh shared-infra-stack prod`, then `./scripts/deploy-analytics.sh tenant-template-stack-basic prod`.

**Estimated savings:** $5–15/month (mostly from VPC Flow Logs).
**Risk:** GREEN.
**Rollback:** Revert the file changes; redeploy. Log groups update in place.

## 2.2 ECR lifecycle policies

Add a lifecycle policy to each of the four ECR repos (`identity`, `academics`, `finance`, `rproxy`). Two rules:

1. Keep the last 10 tagged images.
2. Expire untagged images after 7 days.

The ECR repos are not declared in CDK today — they are created by `scripts/build-application.sh`. Add lifecycle policies via CLI for each repo. Document the policy JSON in `docs/infrastructure-sunset/ecr-lifecycle-policy.json` so it is reproducible.

**Estimated savings:** $0–2/month (negligible; this is operational hygiene more than cost).
**Risk:** GREEN.
**Rollback:** `aws ecr delete-lifecycle-policy --repository-name <name>`.

## 2.3 Add free Gateway Endpoints for DynamoDB and S3

Edit `server/lib/shared-infra/shared-infra-stack.ts` to add two `GatewayVpcEndpoint` constructs to the VPC: one for `GatewayVpcEndpointAwsService.DYNAMODB` and one for `GatewayVpcEndpointAwsService.S3`. Both must reference all private subnet route tables.

Deploy: `./scripts/deploy-analytics.sh shared-infra-stack prod`. CFN will add the endpoints in-place; no resource recreation.

After deploy, verify with `aws ec2 describe-vpc-endpoints --filters Name=vpc-id,Values=<vpcId>` — should list two endpoints with `service-name` ending in `.dynamodb` and `.s3`.

Verify the route tables: `aws ec2 describe-route-tables --filters Name=vpc-id,Values=<vpcId>` — every private subnet route table must have a route with `target` = the new endpoint ID and `destination` = the prefix list ID for the corresponding service.

**Estimated savings:** $1–2/month at pilot traffic. Larger benefit comes later as DDB and S3 traffic grow — Gateway Endpoints are free and remove the data-processing charge that would otherwise scale with data volume.
**Risk:** GREEN. ECS services continue to talk to DDB/S3 through the same DNS names; only the routing changes.
**Rollback:** Remove the two `GatewayVpcEndpoint` constructs and redeploy. Route tables revert.

## 2.4 Disable AdminWeb access logs (optional)

If the AdminWeb CloudFront access-log bucket isn't actively being analyzed, the `accessLogsBucket` reference in `shared-infra-stack.ts:257` can be passed `undefined` to disable access-log delivery. Saves ~$1/month and a small amount of operational mental load.

**Estimated savings:** ~$1/month.
**Risk:** GREEN. Pure logging change.
**Rollback:** Re-add the bucket reference and redeploy.

## 2.5 Verify Phase 2 cost reduction

Wait 48 hours after deploys settle. Check Cost Explorer in account `257526644020`. Daily run-rate should drop by ~$0.50–0.80 (which is the prorated daily cost of the changes above). If not, investigate which line item didn't move.

---

# Phase 3 — ap-south-1 optimization (maintenance window, YELLOW risk)

**Goal:** The big-ticket NAT-Gateway and ECS task-count changes that require a brief maintenance window.
**Prerequisite:** Phase 2 deployed and validated. Phase 0.4 (termination protection) MUST be active.
**Maintenance window:** 30–60 minute window during low-activity NPT hours (e.g., 23:00–01:00 NPT). Notify pilot school operators 24h ahead.

## 3.1 Reduce NAT Gateways from 3 to 1

Edit `server/lib/shared-infra/shared-infra-stack.ts` — locate the `Vpc` construct (around line 66–87). Set `natGateways: 1` explicitly. Choose the surviving NAT by **AZ ID** (e.g. `apse1-az1`), not by AZ name (`ap-south-1a`). AZ-name-to-AZ-ID mapping is account-specific and there is no public stability ranking; AZ IDs are stable across accounts and are what AWS Health Dashboard correlates incidents to. Verify the active AZ ID set for this account with `aws ec2 describe-availability-zones --query 'AvailabilityZones[*].[ZoneName,ZoneId]' --output table`.

The change forces CFN to:
- Delete two NAT Gateways and **release their EIPs** (the surviving NAT keeps its existing EIP, but the two destroyed ones are freed).
- Update private-subnet route tables in the other two AZs to point to the surviving NAT.

ECS tasks in the two affected AZs will see brief egress disruption (seconds to a couple of minutes) while route tables update. Existing in-flight HTTP connections may drop; ECS retries and Cognito session tokens carry the user through.

**Critical pre-flight: confirm no third party allowlists the current NAT public IPs.** IEMIS upstream endpoints, eSewa/Khalti payment gateways, school-district whitelists, or VPN partners may have firewall rules pinned to current EIPs. If they do, after this change any traffic flowing through the now-destroyed NATs will be denied at the third party. Get a written list of where each NAT's public IP is referenced before deploying. If allowlists exist, coordinate IP rotation in advance — either ask the third party to add the surviving NAT's EIP to their allowlist (preferred) or allocate a new EIP and pin it via `eipAllocationIds` on the surviving NAT.

Deploy: `./scripts/deploy-analytics.sh shared-infra-stack prod`.

Verify: `aws ec2 describe-nat-gateways --filter Name=state,Values=available` returns exactly one. Verify private subnets have route `0.0.0.0/0 → <surviving NAT id>`.

Smoke test: run an auth + read-only API call from the prod-shaped frontend or a curl against the API Gateway URL. Run an outbound test that exercises the third-party path most likely to be allowlist-pinned (e.g., an IEMIS read or a sandbox payment-gateway call).

**Estimated savings:** $60–64/month.
**Risk:** YELLOW. Brief egress disruption (seconds-to-minutes) plus third-party allowlist coordination required.
**Rollback:** Set `natGateways: 3` and redeploy. CFN recreates two NAT gateways with **fresh EIPs** — the two original public IPs are gone. If those IPs were referenced anywhere outside our control (allowlists, DNS, monitoring), rollback does not restore them. Plan for ~5–10 minutes per gateway plus any external allowlist re-coordination.

## 3.2 Right-size ECS task counts

Edit `server/lib/tenant-template/services.ts:137-138` (the `isCriticalPath` ternary that sets `desiredCount = 2` for identity and rproxy).

For pilot scale, set `desiredCount = 1` for both. Rationale: HA pairs at pilot scale cost roughly $20/month combined for resilience to a per-task crash. **Be honest about the recovery time:** Fargate task replacement after a health-check failure is typically **60–180 seconds** (minimum 30s of failed health checks + image pull + boot + container start + ALB target-group register-and-healthy wait). Pilot users WILL see brief 5xx errors during this window. ECS replaces the task automatically, but it is not seconds — it is a couple of minutes of degraded availability per crash. Operators should communicate this to pilot school admins and schedule the rollout during NPT off-hours.

If the AWS Application Auto Scaling target tracking on these services is set to a CPU-based metric, also lower `minCapacity` to 1 in the autoscaling target.

Deploy: `./scripts/deploy-analytics.sh tenant-template-stack-basic prod`.

Verify: `aws ecs describe-services --cluster prod-basic --services identitybasic rproxybasic --query 'services[*].[serviceName,desiredCount,runningCount]'`. Both should be at 1.

**Estimated savings:** ~$21/month at ap-south-1 Fargate list pricing for two 256/512 tasks (revised down from earlier $29 estimate after cost-math reconciliation).
**Risk:** YELLOW. Single-task fault tolerance is reduced. Pilot tolerance is high; recovery from a crashed task is automatic and takes ~30 seconds.
**Rollback:** Set `desiredCount = 2` again and redeploy.

## 3.3 (Optional) ECS scheduled scale-to-zero overnight

This step is the path to the ≤$80/month stretch target. Skip if the savings are not worth the operational complexity at this stage.

Pilot schools operate roughly 10:00–16:00 NPT for student activity, with administrative work extending to ~20:00 NPT. From 23:00 NPT to 06:00 NPT, the API is idle.

Use AWS Application Auto Scaling scheduled actions. Scale all four services to `desiredCount = 0` at 23:00 NPT and back to `desiredCount = 1` at 06:00 NPT (each in UTC equivalent — `ap-south-1` does not observe DST; NPT is UTC+5:45, so 23:00 NPT = 17:15 UTC).

Considerations:
- Cold start on scale-up: Fargate task launch + NestJS boot adds 30–90 seconds to the first request after 06:00 NPT.
- A late admin user (after 23:00 NPT) sees the API offline. Communicate this to pilot operators before enabling.
- Identity tokens issued during the day continue to validate against Cognito (no infrastructure to wake) — the API requests after wake are what see the cold start.

This change is configured **outside** CDK (via `aws application-autoscaling put-scheduled-action` after the autoscaling target is registered). Keep it that way to avoid CDK/CFN drift on a setting that may be tuned operationally.

**Estimated savings:** $14–18/month.
**Risk:** YELLOW. Pilot users hitting the API during the idle window will see the service unavailable. Communicate the window to the pilot school admins.
**Rollback:** `aws application-autoscaling delete-scheduled-action ...` and immediately scale back to `desiredCount = 1`.

## 3.4 Verify Phase 3 cost reduction

Wait 7 days after deploys settle. Cost Explorer monthly forecast for ap-south-1 should land at $90–100 (or $75–85 with 3.3 enabled). If above target, identify the deviation in the cost line items before promoting any further changes.

---

# Phase 4 — Deferred (RED — do not attempt during pilot)

These optimizations would buy further savings but carry pilot-stopping risk. They are listed for completeness and to mark the pre-emption sequence: do **not** attempt during the pilot. Re-evaluate after the first paying customer or after pilot success criteria are met.

## 4.1 Eliminate the NLB by migrating API Gateway REST → HTTP API

API Gateway HTTP API (v2) supports direct ALB VPC Link integration, removing the need for the NLB and its associated VPC Link.

**Why it is RED:**
- The Lambda authorizer in `tenant_authorizer.py` reads the v1 payload format. HTTP API delivers v2 payload format. The authorizer must be rewritten.
- The OpenAPI spec at `tenant-api-prod.json` is REST-API-shaped (Swagger 2.0). HTTP API uses OpenAPI 3.x with different `x-amazon-apigateway-integration` keys.
- API keys, usage plans, and API key source (`AUTHORIZER`) all behave differently or are unavailable in HTTP API.
- The full integration test suite must be re-run end-to-end. Smoke tests pass on a dev tenant before any prod cutover.

**Estimated savings:** ~$27/month (NLB + VPC Link).
**Recommendation:** Plan as a 2-week post-pilot sprint with a UAT rebuild for staging.

## 4.2 Eliminate the rproxy task

NGINX in the rproxy task does path-based routing (`/auth/*`, `/users/*`, `/academics/*`, `/finance/*`, `/iemis/*`, etc.) plus method validation, gzip, and Service Connect DNS substitution. ALB listener rules can replicate the path routing if reorganized into per-service target groups, but cannot replicate method validation or any complex header logic that NGINX does today.

**Why it is RED:**
- A misconfigured listener rule returns 404 to a real tenant request — pilot regression.
- Multiple new ALB target groups (one per service) and several listener rules per tenant are required. CFN deploys fail in non-obvious ways (rule-priority conflicts, target-group health-check mismatches).
- The ECS task-count savings is only ~$14/month — not worth the risk during pilot.

**Estimated savings:** ~$14/month.
**Recommendation:** Defer until after the API Gateway migration in 4.1 is done; the two are easier to do together because they both touch the LB layer.

## 4.3 Fargate Spot for non-critical services

Mixed-capacity strategy with Fargate Spot for academics and finance (the non-critical-path services). Saves ~$10/month at 70% Spot weighting.

**Why it is RED:**
- Spot preemption mid-request returns 5xx to the user. Pilot operators do not want to triage these.
- Defer until ECS auto-scaling and circuit breakers are in place.

**Estimated savings:** ~$10/month.

## 4.4 Container Insights, WAF, customer-managed KMS

All currently disabled. Re-enable when scaling justifies the cost. Each carries a ~$10/month price tag.

---

# Phase 5 — Documentation, stale-reference, and frontend cleanup

**Goal:** Make every config, doc, script, and frontend `.env.local` consistent with the post-teardown reality.
**Prerequisite:** Phase 1 complete.
**Risk:** GREEN throughout — these are local-config and doc updates.

## 5.1 Frontend `.env.local` files (CRITICAL — local-dev breaks otherwise)

Update every `.env.local` under `edforge-saas-frontend/apps/*/`:

- `VITE_API_URL` → ap-south-1 prod API Gateway URL (resolve via `aws cloudformation describe-stacks --stack-name shared-infra-stack --query "Stacks[0].Outputs[?OutputKey=='ApiGatewayUrl'].OutputValue" --output text` against the prod profile, OR via the stored value in the deploy log from prod's last shared-infra deploy).
- `VITE_COGNITO_REGION` → `ap-south-1`.
- `VITE_COGNITO_USER_POOL_ID` → prod tenant pool ID (from `aws cognito-idp list-user-pools --max-results 60 --profile prod`).
- `VITE_COGNITO_DOMAIN` → prod Cognito hosted UI domain (from `aws cognito-idp describe-user-pool-domain --user-pool-id <pool> --profile prod` or from the pool's domain configuration).

For each app (`shell`, `academics`, `finance`, `people`, `analytics`, `edfi`, `messages`, `special-programs`), update its `.env.local` and verify the file is gitignored (it should be — `.env.local` is conventionally in `.gitignore`). If not gitignored today, add it to `.gitignore` in the same change.

Smoke test: `pnpm dev` from each app workspace. Confirm the shell renders, login redirect lands at the correct hosted UI domain, and a successful auth completes.

**Files affected:** `edforge-saas-frontend/apps/*/.env.local` (8+ files).

## 5.2 Smoke-test base URLs

Audit every file under `scripts/smoke-tests/` for the literal string `execute-api.us-east-2.amazonaws.com`. For each match:

- If the line already has the pattern `process.env.API_BASE_URL || 'https://...'`, leave the fallback or change it to the ap-south-1 URL — your call. The env-var override is what production CI relies on.
- If there is no env-var override, add one. Pattern: `const API = process.env.API_BASE_URL ?? '<ap-south-1 default URL>'`.
- Do not delete any historic smoke-test log under `scripts/smoke-tests/logs/` — those are post-mortem evidence.

Run a representative smoke test (e.g., `nepal-school-e2e.ts`) against ap-south-1 with `API_BASE_URL` and `API_KEY` set to confirm the conversion didn't break the test logic.

Before starting, generate the explicit work list with one command — do not work from memory:

```
grep -rEln "execute-api\.us-east-2\.amazonaws\.com" scripts/ > /tmp/smoke-test-stale-urls.txt
```

Walk that list file by file. Once empty, run the same grep across the whole repo to catch anything outside `scripts/`. Old run logs under `scripts/smoke-tests/logs/*.json` correctly fail this grep too — those are historical evidence and should be left alone (do not commit changes to log files).

**Files affected:** ~40 files under `scripts/smoke-tests/` plus `scripts/run-diagnostics.sh:8` (default `AWS_PROFILE` from `dev` → `prod` — the `dev` profile is documented in CLAUDE.md as never valid), `scripts/operations/finance-*` env-var examples, `scripts/analytics/export-openapi.sh:25`, `scripts/analytics/local/invoke-local.sh:58`, `scripts/backfill-section-subject-area.ts:30`. Use the generated `/tmp/smoke-test-stale-urls.txt` as the authoritative list for this phase — it removes any "from memory" risk.

## 5.3 Server-side env files

Archive `server/.env.uat`. Either delete it or rename to `server/.env.uat.archived` to break the `source server/.env.uat` reflex. The deploy wrapper's preflight check will catch a stale shell environment, but archiving the file is a stronger guard.

Verify `server/.env.prod` still resolves to `257526644020` / `ap-south-1`. Verify `server/.env` (shared baseline) has no UAT-specific values.

**Files affected:** `server/.env.uat`.

## 5.4 CDK context

Inspect `server/cdk.context.json` for cached AZ lookups or VPC IDs from `us-east-2`. If present, delete or trim those entries — leaving stale us-east-2 cache entries is harmless but adds noise.

**Files affected:** `server/cdk.context.json`.

## 5.5 Documentation

Update the following docs with single-region (ap-south-1) operational guidance:

- `CLAUDE.md` — the environment-profile table at lines 53–54 currently shows both UAT and prod columns. After teardown, archive the UAT column to a "Historical environments" section at the bottom and reorganize the active sections around prod-only operation. Do not delete the historical block — it is post-mortem context for the teardown decision.
- `docs/EDFORGE_V1_DEVELOPER_DOCUMENT.md` — same treatment, update any UAT examples to ap-south-1 endpoints.
- `server/lib/API_GATEWAY_DEPLOYMENT.md` — the `us-east-1` example endpoints at lines 132/140/145 are wrong (EdForge has never used us-east-1). Update to ap-south-1.

**Files affected:** As listed.

## 5.6 Deploy-log convention update

Update the convention in `CLAUDE.md` § "Deploy log convention" — drop the `<env>` prefix from new deploy logs since there is now only one live env (`prod`). Keep historical UAT-prefixed logs in `docs/deploys/` as audit trail.

Optionally rename `scripts/deploy-analytics.sh` to `scripts/deploy.sh` (B0.1.T1 already in the backlog). The wrapper is repo-wide, not analytics-specific.

**Files affected:** `CLAUDE.md`, optionally `scripts/deploy-analytics.sh`.

## 5.7 Update `edforge-pilot-rehearsal.ts`

Hardcoded default URL (`https://1hq87iv6i3.execute-api.us-east-2.amazonaws.com/prod`) and API key in this file will dangle after teardown. Either:

- Update both defaults to ap-south-1 prod values (and rotate the API key — embedded keys are bad practice regardless), or
- Remove the file from the repo if it is no longer needed (it was a UAT-only orchestrator).

**Files affected:** `edforge-pilot-rehearsal.ts` (location may vary; grep at repo root).

---

# Phase 6 — Cost verification

## 6.1 7-day post-Phase-3 check

Cost Explorer for account `257526644020`, ap-south-1, last 7 days:

- Daily run-rate should be ~$3.00–3.30 (= $90–100/month).
- If above $3.50/day, identify the line item driving the deviation and decide whether to accept (e.g., DDB write-heavy day) or investigate (e.g., a NAT charge that should not exist).

## 6.2 14-day post-Phase-3 check

Same query, last 14 days. Trend should hold. Variance < $0.20/day expected at pilot scale.

## 6.3 30-day post-Phase-3 check

Cost Explorer monthly view. The full month should land at the projected target. Document the realized cost in `docs/infrastructure-sunset/cost-realized-<YYYYMM>.md` along with the bottom-up breakdown — this becomes the post-mortem reference if cost ever creeps.

## 6.4 Ongoing monthly check

Add a ~30-minute monthly review: pull Cost Explorer for ap-south-1 prod, compare to last month, flag any line item that has grown >20% month-over-month. The most likely creep sources are: ECR storage (if lifecycle policy is bypassed), DDB read/write volume (if a service hot-loops), CloudWatch logs (if retention is widened by a future PR).

---

# Quick-reference checklist (for the operator)

A condensed checklist mapping to the phases above. Tick each as you go.

**Phase 0 — before any teardown / change**
- [ ] 0.1 — `cleanup.sh` hardened with account/region/profile guards (PR + merge + verify on file).
- [ ] 0.2 — Stale aws-nuke and `delete-remaining-stacks.sh` deleted (or rewritten if Option B chosen). `.gitignore` confirmed not retaining them.
- [ ] 0.3 — `cleanup-secrets.sh` deleted; caller in `cleanup.sh` removed.
- [ ] 0.4 — `terminationProtection: true` deployed on all five prod stacks (gated on account-id check, not env-var).
- [ ] 0.5 — Cognito `deletionProtection: ACTIVE` on tenant pool deployed.
- [ ] 0.5b — DynamoDB `deletionProtectionEnabled: true` on all five prod tables (`TenantMappingTable`, three `edforge-*-basic`, analytics events table).
- [ ] 0.6 — Prod snapshot saved at `docs/infrastructure-sunset/snapshot-prod-pre-optimize-<date>.md`.
- [ ] 0.7 — Prod data verified real (no rehearsal residue).
- [ ] 0.8 — CI/pre-commit assertion against `DestroyPolicySetter` on tenant stacks live.

**Phase 1 — us-east-2 teardown**
- [ ] 1.1 — Pre-flight checks passed.
- [ ] 1.2 — `cleanup.sh` run with output tee'd to deploy log.
- [ ] 1.3 — All 10 manual verification queries returned empty.
- [ ] 1.4 — `CDKToolkit` deleted (or kept with documented reason).
- [ ] 1.5 — 24h cost-leak check clean.
- [ ] 1.6 — 7-day cost-leak check clean.
- [ ] 1.7 — Local AWS profile `[uat]` removed (optional).

**Phase 2 — ap-south-1 safe optimizations**
- [ ] 2.1 — Log retention reduced; VPC Flow Logs disabled or REJECT-only with 7d retention.
- [ ] 2.2 — ECR lifecycle policies applied to all four repos.
- [ ] 2.3 — DynamoDB and S3 Gateway Endpoints deployed.
- [ ] 2.4 — AdminWeb access logs disabled (optional).
- [ ] 2.5 — 48h cost reduction observed.

**Phase 3 — ap-south-1 maintenance-window optimizations**
- [ ] 3.1 — NAT Gateways reduced 3 → 1.
- [ ] 3.2 — identity and rproxy `desiredCount` reduced 2 → 1.
- [ ] 3.3 — Overnight scale-to-zero scheduled (optional, stretch target).
- [ ] 3.4 — 7d cost reduction observed; total ≤$100/month confirmed.

**Phase 4 — deferred**
- [ ] No actions; revisit post-pilot.

**Phase 5 — cleanup**
- [ ] 5.1 — Every frontend `.env.local` repointed to ap-south-1.
- [ ] 5.2 — Smoke-test base URLs converted to env-var-driven.
- [ ] 5.3 — `server/.env.uat` archived.
- [ ] 5.4 — `server/cdk.context.json` cleaned.
- [ ] 5.5 — Docs updated to single-region.
- [ ] 5.6 — Deploy-log convention updated; wrapper optionally renamed.
- [ ] 5.7 — `edforge-pilot-rehearsal.ts` updated or removed.

**Phase 6 — verification**
- [ ] 6.1 — 7-day post-Phase-3 cost check.
- [ ] 6.2 — 14-day check.
- [ ] 6.3 — 30-day check.
- [ ] 6.4 — Monthly review cadence in place.
