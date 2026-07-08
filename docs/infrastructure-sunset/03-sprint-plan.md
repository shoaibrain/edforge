---
title: EdForge Infrastructure Sunset & Cost Optimization — Sprint & Ticket Plan
companion: 01-audit-report.md, 02-execution-plan.md
status: Canonical (post review)
---

# Reading guide

This is the work-breakdown companion to the audit (`01-audit-report.md`) and the execution plan (`02-execution-plan.md`). The execution plan describes **what** changes; this document organizes those changes into atomic, commitable tickets grouped into demoable sprints.

Every ticket carries:
- **Files** — the exact files (or new files) touched.
- **Change** — what the engineer does.
- **Validation** — concrete proof of correctness (test, smoke check, or CLI verification).
- **Risk** — GREEN (no downtime, no data risk), YELLOW (deploy required, brief risk window), or RED (do not attempt during pilot).
- **Deploy command** — when relevant. Always uses the standard wrapper per CLAUDE.md.
- **Rollback** — when relevant.

Sprint dependencies are explicit at the top of each sprint. Non-dependent sprints can run in parallel across multiple engineers.

# Cross-cutting conventions

These apply to every ticket and are not repeated per-ticket:

1. Every ticket commits to its own branch and merges via PR. No direct-to-main.
2. Every infra-touching ticket logs to `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}` per CLAUDE.md filename convention. After us-east-2 teardown the `<env>-` prefix may be dropped (Sprint 7).
3. Every prod CFN change is preceded by a `cdk diff` whose output is tee'd to `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/prod-cdk-diff-<stack>-<ts>-<gitsha>.log`. The diff log is the review artifact for the PR.
4. No `--no-verify` on commits, no `cdk deploy` outside the wrapper, no destructive AWS actions without account/region check on the operator's terminal first.
5. Sprint demos are written to a single rolling file: `docs/infrastructure-sunset/PROJECT-LOG.md`, one H2 section per sprint. No per-sprint demo files.

# Sprint dependency graph

```
Sprint 1 (Safety Foundation) ────┐
Sprint 2 (Data Hardening) ───────┤
                                  ├──► Sprint 3 (Teardown) ──► Sprint 7 (Docs/stretch)
                                  │
Sprint 4 (Frontend repointing) ──┤
Sprint 5 (Safe optimizations) ───┘
                                  └──► Sprint 6 (NAT/ECS) ──► Sprint 8 (Verification & closure)
```

- Sprint 1 and Sprint 2 have no dependencies and can run in parallel.
- Sprint 3 requires Sprint 1 (hardened cleanup script).
- Sprint 4 has no hard dependency. Easier after Sprint 3 because the prod URL is unambiguously the only live one.
- Sprint 5 has no dependency; safe ap-south-1 changes can land any time.
- Sprint 6 requires Sprint 2 (termination protection + deletion protection at all three layers).
- Sprint 7 requires Sprint 3 (docs reflect single-region only after teardown).
- Sprint 8 requires Sprint 6 (cost verification only meaningful post-NAT-reduction).

---

# Sprint 1 — Safety Foundation

**Sprint goal:** Make it physically impossible for cleanup tooling to destroy production by accident, and add a synth-time guardrail against the most catastrophic future-PR mistake (re-enabling `DestroyPolicySetter` on tenant-template-stack).

**Sprint demo (recorded in `PROJECT-LOG.md`):**
1. `AWS_PROFILE=prod ./scripts/cleanup/cleanup.sh` aborts immediately with a "REFUSING — production account" banner.
2. `unset AWS_PROFILE; AWS_DEFAULT_PROFILE=prod ./scripts/cleanup/cleanup.sh` still aborts via the account-id check.
3. A throwaway PR adding `cdk.Aspects.of(tenantTemplateStackBasic).add(new DestroyPolicySetter(...))` fails the new synth-time test in CI.

**Hard prerequisite:** none.

## T1.1 — Add account/region/profile guards to `cleanup.sh`
- **Files:** `scripts/cleanup/cleanup.sh`.
- **Change:** Resolve `ACCOUNT_ID` (sts), `REGION` (ec2 describe-availability-zones), and read `AWS_PROFILE` at the top of the script. Refuse to proceed if `ACCOUNT_ID == 257526644020`, if `AWS_PROFILE == prod`, or if `ACCOUNT_ID != 715860911762` / `REGION != us-east-2`. Display all three resolved values in the existing confirmation banner.
- **Validation:**
  1. With `AWS_PROFILE=prod` exported, run `cleanup.sh`; confirm exit code != 0 and banner shows "REFUSING".
  2. With `AWS_PROFILE=uat`, run `cleanup.sh`; confirm the prompt reaches `[y/N]` (do not type `y`).
  3. With `AWS_PROFILE=uat` and `AWS_REGION=ap-south-1`, run `cleanup.sh`; confirm refusal due to region mismatch.
- **Risk:** GREEN.
- **Rollback:** revert the file in git.

## T1.2 — Mirror guards into `cleanup-cloudfront.sh` and `cleanup-cognito.sh`
- **Files:** `scripts/cleanup/cleanup-cloudfront.sh`, `scripts/cleanup/cleanup-cognito.sh`.
- **Change:** Same guards as T1.1, applied at each script's entry point. CloudFront is global so the region check is informational only.
- **Validation:** repeat T1.1's prod-profile test against each script; both refuse.
- **Risk:** GREEN.

## T1.3 — Add explicit DynamoDB delete pass to `cleanup.sh`
- **Files:** `scripts/cleanup/cleanup.sh`.
- **Change:** Insert a delete-table loop AFTER the wildcard Cognito cleanup block (~line 287) and BEFORE the ECR delete loop (~line 289). Loop targets: `edforge-identity-basic`, `edforge-academics-basic`, `edforge-finance-basic`, `TenantMapping`. Use `aws dynamodb describe-table` to no-op gracefully when the table is gone. Gate on `ACCOUNT_ID == 715860911762` as defense-in-depth even though T1.1 should already have aborted on a wrong account.
- **Validation:** static read of the script confirms the new pass is correctly placed and gated. Operationally validated end-to-end during Sprint 3 (T3.2).
- **Risk:** GREEN.

## T1.4 — Delete `cleanup-secrets.sh` and its caller
- **Files:** `scripts/cleanup/cleanup-secrets.sh` (delete), `scripts/cleanup/cleanup.sh` (remove the conditional invocation around the existing line 98–104).
- **Change:** Pattern `rds_proxy_multitenant` matches no EdForge resources; remove dead code.
- **Validation:** `grep -r rds_proxy_multitenant .` returns no matches; `grep -r cleanup-secrets.sh .` returns no matches.
- **Risk:** GREEN.

## T1.5 — Delete aws-nuke tooling
- **Files:** `scripts/cleanup/aws-nuke-setup.sh` (delete), `scripts/cleanup/README-AWS-NUKE.md` (delete), `scripts/cleanup/delete-remaining-stacks.sh` (delete).
- **Change:** The aws-nuke configuration was used long ago against an unrelated account (`346698404105`); it has no role in the current sunset. Confirm `.gitignore` does not retain these paths after deletion.
- **Validation:** `git status` shows the three files staged for deletion; `grep -r 346698404105 .` returns no matches.
- **Risk:** GREEN.

## T1.6 — Synth-time assertion: tenant-template-stack DDB tables synthesize as `Retain`
- **Files:** new `scripts/ci/assert-tenant-ddb-retain.ts`; CI workflow file (`.github/workflows/<job>.yml` or equivalent) to invoke the assertion.
- **Change:** Replace the brittle grep-based check with a CDK-synth-time test. The script invokes `cdk synth tenant-template-stack-basic` against a fixed test profile, parses the synthesized CloudFormation JSON, and fails if any `AWS::DynamoDB::Table` resource has `DeletionPolicy != Retain` or `UpdateReplacePolicy != Retain`. This catches the dangerous case regardless of how a future PR introduces the change (alias, helper function, broad-aspect refactor). The grep-only check is defeatable by trivial indirection (`const a = DestroyPolicySetter; cdk.Aspects.of(...).add(new a())`); the synth check is not.
- **Validation:**
  1. Open a throwaway PR that applies a destroy aspect to tenant-template-stack-basic via any indirection. CI must fail.
  2. Run the assertion against the current main branch. It must pass.
  3. Document the test in CLAUDE.md house rules.
- **Risk:** GREEN.

## T1.7 — Hardened-cleanup integration test (regression guard)
- **Files:** new `scripts/ci/cleanup-guard.test.sh`; CI workflow.
- **Change:** Promote the Sprint 1 demo's "guards refuse with prod profile" check to a permanent CI test that runs on every PR touching `scripts/cleanup/*`. The test mocks `aws sts get-caller-identity` (or sets a fake `AWS_PROFILE=prod` value) and asserts non-zero exit + the "REFUSING" string in stdout.
- **Validation:** the CI test runs and passes on the current main; a deliberately-broken guard PR (e.g., commenting out the account check) fails the test.
- **Risk:** GREEN.

## T1.8 — Sprint 1 demo + log entry
- **Files:** new section in `docs/infrastructure-sunset/PROJECT-LOG.md` ## Sprint 1.
- **Change:** Capture the three demo scenarios with terminal output / CI screenshots inline.
- **Validation:** doc reviewable.
- **Risk:** GREEN.

---

# Sprint 2 — Production Data Hardening

**Sprint goal:** Three layers of protection (CFN termination, Cognito deletion, DDB deletion) so that any single mistake — operator typo, console misclick, runaway script — fails closed for pilot data.

**Sprint demo (recorded in `PROJECT-LOG.md` ## Sprint 2):**
1. `aws cloudformation delete-stack --stack-name tenant-template-stack-basic --profile prod` returns "termination protection enabled" error.
2. `aws cognito-idp delete-user-pool --user-pool-id <prod-tenant-pool> --profile prod` returns deletion-protection error.
3. `aws dynamodb delete-table --table-name edforge-identity-basic --profile prod` returns deletion-protection error.
4. Pre-optimize snapshot is reviewable.

**Hard prerequisite:** none. Snapshot tickets (T2.1, T2.2) MUST run BEFORE any mutating ticket so the snapshot captures pre-change state.

## T2.1 — Capture pre-optimize prod snapshot
- **Files:** new `docs/infrastructure-sunset/snapshot-prod-pre-optimize-<YYYYMMDD>.md`.
- **Change:** Record per execution plan §0.6: CFN stacks + status + last-updated; for shared-infra-stack: VPC ID, subnet IDs, NAT Gateway count and IDs, ALB ARN, NLB ARN, REST API ID; for tenant-template-stack-basic: ECS cluster name, service ARNs and `desiredCount`, task-def revisions, target group ARNs, listener-rule priorities; for each DDB table (`TenantMapping`, three `edforge-*-basic`, analytics events table): `pointInTimeRecoveryEnabled`, `tableStatus`, `itemCount`, AND `deletionProtectionEnabled` baseline (will be `false` until T2.5); ECR repo list with `imagePushedAt` of `:latest`; CloudFront distro IDs and DomainNames; `aws cognito-idp list-user-pools --max-results 60`. Copy raw CLI outputs — no commentary.
- **Validation:** snapshot reviewable; values copy-paste-able.
- **Risk:** GREEN (read-only).

## T2.2 — Verify prod data is real (no rehearsal residue)
- **Files:** new `docs/infrastructure-sunset/sprint-2-data-verification.md`.
- **Change:** Query each `edforge-*-basic` table for `METADATA#` rows. Confirm at least one pilot tenant row exists. Confirm no rehearsal-tenant rows. Document any anomaly.
- **Validation:** doc reviewable. If rehearsal data found, escalate before any further Sprint 2 ticket lands.
- **Risk:** GREEN (read-only).

## T2.3 — Reconcile Cost Explorer baseline against the audit's bottom-up inventory
- **Files:** new `docs/infrastructure-sunset/cost-baseline-reconciliation.md`.
- **Change:** Pull the last-30-day Cost Explorer breakdown for account `257526644020` filtered to `ap-south-1` (group by service). Compare line-by-line against the inventory in `01-audit-report.md` §2.3. Document any line item where realized cost differs from projection by >20%. If material, re-anchor the savings projections in §7 of the audit before Sprint 6 lands.
- **Validation:** doc reviewable; reconciliation table complete; any deltas explained.
- **Risk:** GREEN.

## T2.4 — Termination protection on all five prod stacks (single PR)
- **Files:** `server/bin/ecs-saas-ref-template.ts` — five property additions in one PR.
- **Change:** Add `terminationProtection: true` to: `shared-infra-stack`, `controlplane-stack`, `analytics-stack`, `core-appplane-stack`, `tenant-template-stack-basic`. Gate on an account-id check (`app.account === '257526644020'` or equivalent), NOT on `EDFORGE_ENV`. The existing comment block at `ecs-saas-ref-template.ts:225-228` documenting the `DestroyPolicySetter`-removed status MUST remain intact in this PR — explicit code-review checklist item.
- **Deploy:** `./scripts/deploy-analytics.sh shared-infra-stack prod`, then the four others in dependency order. Each deploy is in-place; no resource recreation.
- **Validation:**
  1. `npx cdk synth <stack>` against prod profile shows `EnableTerminationProtection: true` in synthesized JSON for each.
  2. Post-deploy: `aws cloudformation describe-stacks --stack-name <stack> --profile prod --query 'Stacks[0].EnableTerminationProtection'` returns `true` for all five.
  3. Attempt `aws cloudformation delete-stack --stack-name tenant-template-stack-basic --profile prod`; confirm error.
- **Risk:** YELLOW (5 deploys, in-place, no resource changes).
- **Rollback:** flip property to `false`, redeploy the affected stack.

## T2.5 — DDB deletion protection on all five prod tables (single PR)
- **Files:** `server/lib/shared-infra/shared-infra-stack.ts:269-275` (TenantMappingTable), `server/lib/tenant-template/ecs-dynamodb.ts` (three edforge-*-basic tables), `server/lib/analytics/analytics-stack.ts` (analytics events table).
- **Change:** Add `deletionProtectionEnabled: true` to every table definition. Gate on the same account-id check as T2.4 so UAT teardown isn't blocked.
- **Deploy:** `./scripts/deploy-analytics.sh shared-infra-stack prod`, `./scripts/deploy-analytics.sh tenant-template-stack-basic prod`, `./scripts/deploy-analytics.sh analytics-stack prod`. CFN updates the property in place.
- **Validation:**
  1. `cdk diff` for each affected stack shows only the property addition; no other resource churn.
  2. Post-deploy: `aws dynamodb describe-table --table-name <name> --profile prod --query 'Table.DeletionProtectionEnabled'` returns `true` for all five.
  3. Attempt `aws dynamodb delete-table --table-name edforge-identity-basic --profile prod`; confirm error.
- **Risk:** YELLOW (3 deploys; in-place property change; no data risk).
- **Rollback:** flip property to `false`, redeploy.

## T2.6 — Cognito tenant pool deletion protection
- **Files:** `server/lib/tenant-template/identity-provider.ts`.
- **Change:** Add `deletionProtection: cognito.DeletionProtection.ACTIVE` to the `UserPool` construct. Gate on account-id.
- **Deploy:** `./scripts/deploy-analytics.sh tenant-template-stack-basic prod`.
- **Validation:** `aws cognito-idp describe-user-pool --user-pool-id <prod-tenant-pool> --profile prod --query 'UserPool.DeletionProtection'` returns `ACTIVE`. Attempt delete; confirm error.
- **Risk:** YELLOW.

## T2.7 — Cognito system-admin pool deletion protection (custom resource)
- **Files:** `server/lib/bootstrap-template/control-plane-stack.ts`; new `server/lib/bootstrap-template/cognito-system-admin-deletion-protection.ts` (custom resource).
- **Change:** SBT's L3 `CognitoAuth` construct does not expose `deletionProtection` as a passthrough. To avoid CFN drift on a manually-set value, implement an `AwsCustomResource` (or a Lambda-backed CustomResource) that calls `cognito-idp:UpdateUserPool` with `DeletionProtection=ACTIVE` on the system-admin pool ID after the SBT construct creates it. The custom resource runs on every `controlplane-stack` deploy, so the setting is idempotent and survives deploys.
- **Deploy:** `./scripts/deploy-analytics.sh controlplane-stack prod`.
- **Validation:** `aws cognito-idp describe-user-pool --user-pool-id <system-admin-pool> --profile prod --query 'UserPool.DeletionProtection'` returns `ACTIVE`. Attempt delete; confirm error. Re-run `controlplane-stack` deploy; verify `DeletionProtection` still `ACTIVE` (idempotency check).
- **Risk:** YELLOW.

## T2.8 — PITR validation snapshot
- **Files:** add a section to the snapshot doc from T2.1.
- **Change:** Record `PointInTimeRecoveryEnabled` for all five prod tables. Any `false` is escalated immediately — PITR is a fundamental data-protection assumption in the audit.
- **Validation:** all five tables show `true`. If any returns `false`, open an incident.
- **Risk:** GREEN (read-only).

## T2.9 — Sprint 2 demo + log entry
- **Files:** `docs/infrastructure-sunset/PROJECT-LOG.md` ## Sprint 2.
- **Change:** Capture the four demo scenarios with command outputs.
- **Risk:** GREEN.

---

# Sprint 3 — us-east-2 Teardown

**Sprint goal:** Remove every billable resource from account `715860911762` / region `us-east-2`. Verify zero spend over 7+ days.

**Sprint demo (recorded in `PROJECT-LOG.md` ## Sprint 3):** Cost Explorer for account `715860911762`, last 7 days, daily spend $0.

**Hard prerequisite:** Sprint 1 merged and live.

## T3.1 — Pre-flight verification capture
- **Files:** new `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/uat-teardown-preflight-<timestamp>-<gitsha>.log`.
- **Change:** Run and capture: `aws sts get-caller-identity`, `aws ec2 describe-availability-zones`, `echo $AWS_PROFILE`, `aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE`. Confirm all five EdForge stacks present. Confirm operator is on the hardened `cleanup.sh` (read first 30 lines).
- **Validation:** log file exists with all expected outputs.
- **Risk:** GREEN.

## T3.2 — Run hardened `cleanup.sh`
- **Files:** new `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/uat-teardown-cleanup-<timestamp>-<gitsha>.log`.
- **Change:** Execute `cleanup.sh` with output tee'd to the log. Expected runtime 60–120 minutes, dominated by CloudFront disable+delete (15–30 minutes per distribution).
- **Validation:** script exits 0; log captures every phase.
- **Risk:** YELLOW (intentional destruction in UAT — already a no-op against prod due to T1.1 guards).

## T3.3 — Compute-resource verification (CFN, ECS, ELB, NAT, VPC, Lambda, EventBridge)
- **Files:** new `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/uat-teardown-postcheck-compute-<timestamp>.log`.
- **Change:** Run, capture, and confirm empty/expected-only:
  - `aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE DELETE_FAILED --profile uat` (empty for EdForge stacks; investigate any `DELETE_FAILED`).
  - `aws ecs list-clusters --profile uat` (empty).
  - `aws elbv2 describe-load-balancers --profile uat` (empty).
  - `aws ec2 describe-nat-gateways --filter Name=state,Values=available,pending,deleting --profile uat` (empty).
  - `aws ec2 describe-vpcs --query 'Vpcs[?IsDefault==\`false\`]' --profile uat` (empty).
  - `aws ec2 describe-addresses --profile uat` (no orphan EIPs).
  - `aws lambda list-functions --profile uat` (no `tenant-seeder*`, `cognito-post-auth-*`).
  - `aws events list-event-buses --profile uat` (only `default`).
- **Validation:** log shows empty/default for each. Manually delete any survivors before continuing.
- **Risk:** GREEN.

## T3.4 — Data-resource verification (DDB, S3, ECR)
- **Files:** new `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/uat-teardown-postcheck-data-<timestamp>.log`.
- **Change:** Run, capture, and confirm empty:
  - `aws dynamodb list-tables --profile uat` (no EdForge tables).
  - `aws s3 ls --profile uat` (no EdForge-prefix buckets).
  - `aws ecr describe-repositories --profile uat` (no `identity`, `academics`, `finance`, `rproxy`).
- **Validation:** as above.
- **Risk:** GREEN.

## T3.5 — Identity-resource verification (Cognito, IAM)
- **Files:** new `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/uat-teardown-postcheck-identity-<timestamp>.log`.
- **Change:** Run, capture, and confirm empty:
  - `aws cognito-idp list-user-pools --max-results 60 --profile uat` (no EdForge-named or `SaaSFactory`-tagged pools).
  - `aws iam list-roles --profile uat --query 'Roles[?starts_with(RoleName, \`shared-infra-stack-\`) || starts_with(RoleName, \`controlplane-stack-\`) || starts_with(RoleName, \`core-appplane-stack-\`) || starts_with(RoleName, \`tenant-template-stack-\`)].RoleName'` (empty).
- **Validation:** as above. Manually delete any orphan IAM roles.
- **Risk:** GREEN.

## T3.6 — Delete CDK bootstrap stack
- **Change:** Empty the `cdk-...-assets-...` S3 staging bucket; `aws cloudformation delete-stack --stack-name CDKToolkit --profile uat`.
- **Validation:** `aws cloudformation list-stacks --profile uat` returns empty.
- **Risk:** GREEN.

## T3.7 — 24-hour cost-leak check
- **Validation:** Cost Explorer for `715860911762`, prior 24h, daily total ≤ $0.10. Investigate any line item above that threshold and remove the resource.
- **Risk:** GREEN.

## T3.8 — 7-day cost-leak check
- **Validation:** Cost Explorer same account, prior 7 days, daily total ≤ $0.10 every day.
- **Risk:** GREEN.

## T3.9 — Local profile cleanup (optional)
- **Files:** developer's `~/.aws/credentials` and `~/.aws/config` (not git).
- **Change:** Remove `[uat]` profile entry; rotate any IAM access keys still active on the account.
- **Validation:** `grep "\[uat\]" ~/.aws/credentials ~/.aws/config` returns no matches.
- **Risk:** GREEN.

## T3.10 — Sprint 3 demo + log entry
- **Files:** `docs/infrastructure-sunset/PROJECT-LOG.md` ## Sprint 3.
- **Change:** Capture the Cost Explorer screenshot; link to all teardown logs.
- **Risk:** GREEN.

---

# Sprint 4 — Frontend & Smoke-Test Repointing

**Sprint goal:** Get every developer-facing endpoint reference off us-east-2 and onto ap-south-1.

**Sprint demo (recorded in `PROJECT-LOG.md` ## Sprint 4):**
1. From a clean checkout, `pnpm install && pnpm dev` in each frontend app loads the shell and redirects login to the prod Cognito hosted UI.
2. `nepal-school-e2e.ts` against ap-south-1 with env vars set passes.
3. `grep -rEln "execute-api\\.us-east-2\\.amazonaws\\.com" .` returns only historical log files under `scripts/smoke-tests/logs/`.

**Hard prerequisite:** none. Easier after Sprint 3.

## T4.1 — Resolve prod frontend coordinates
- **Files:** new `docs/infrastructure-sunset/prod-frontend-coordinates.md`.
- **Change:** Run, against the prod profile: extract API Gateway URL from `aws cloudformation describe-stacks --stack-name shared-infra-stack`; prod tenant Cognito pool ID from `aws cognito-idp list-user-pools`; hosted UI domain from `aws cognito-idp describe-user-pool-domain`. Document all values.
- **Validation:** all four values resolved.
- **Risk:** GREEN.

## T4.2 — Update all frontend `.env.local` files (single PR)
- **Files:** `edforge-saas-frontend/apps/{shell,academics,finance,people,analytics,edfi,messages,special-programs}/.env.local`.
- **Change:** Replace `VITE_API_URL`, `VITE_COGNITO_REGION`, `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_DOMAIN` with values from T4.1 across all 8 apps. Confirm each `.env.local` is gitignored; if not, fix `.gitignore`.
- **Validation:**
  1. `pnpm dev` from each app workspace; smoke check the app shell loads.
  2. From `apps/shell/`, complete a login round-trip against prod Cognito.
- **Risk:** GREEN.

## T4.3 — Update Vercel project environment variables
- **Files:** Vercel dashboard (no repo change beyond a documentation note).
- **Change:** Update `API_BASE_URL` and any Cognito-related env vars in the Vercel **production** environment to ap-south-1 values. Repeat for the **preview** environment if previews target a separate config. Document the change in the project log.
- **Validation:**
  1. Trigger a preview deployment from any open PR; confirm the preview URL hits the ap-south-1 API.
  2. Verify production at `https://edforge.app` continues to work.
- **Risk:** YELLOW (touches the live frontend; previews are validated first; rollback is reverting the Vercel env values).

## T4.4 — Generate authoritative stale-URL list
- **Files:** new `/tmp/sprint-4-stale-urls.txt` (transient — not committed).
- **Change:** `grep -rEln "execute-api\\.us-east-2\\.amazonaws\\.com" scripts/ > /tmp/sprint-4-stale-urls.txt`. Sort and de-dupe. The list is the authoritative work queue for T4.5–T4.8 — operators MUST NOT work from memory.
- **Validation:** the file is generated and used to drive T4.5–T4.8.
- **Risk:** GREEN.

## T4.5 — Convert smoke-test base URLs (identity / IEMIS / golden-thread)
- **Files:** every file under `scripts/smoke-tests/` whose name relates to identity, auth, IEMIS, or end-to-end golden-thread flows.
- **Change:** Replace literal us-east-2 URLs with `process.env.API_BASE_URL ?? '<ap-south-1 default>'`. Switch any hardcoded `API_KEY` to env-var.
- **Validation:** sample 3 files; run `npx ts-node <file>` with env vars set against ap-south-1; tests pass.
- **Risk:** GREEN.

## T4.6 — Convert smoke-test base URLs (academics)
Same as T4.5, scoped to academics smokes.

## T4.7 — Convert smoke-test base URLs (finance)
Same as T4.5, scoped to finance smokes.

## T4.8 — Convert smoke-test base URLs (remaining)
Same as T4.5, scoped to E2E and sprint-specific smokes (`nepal-school-e2e.ts`, etc.). After this ticket the demo's grep-check returns only historical log files.

## T4.9 — Update operational script defaults
- **Files:** `scripts/run-diagnostics.sh:8` (`AWS_PROFILE` default `dev` → `prod`); `scripts/analytics/export-openapi.sh:25`, `scripts/analytics/local/invoke-local.sh:58`, `scripts/backfill-section-subject-area.ts:30`, `scripts/operations/finance-*` env-var examples (region defaults to `ap-south-1`).
- **Change:** Replace stale defaults.
- **Validation:** running each script (or its dry-run mode where applicable) without env overrides resolves to prod / ap-south-1.
- **Risk:** GREEN.

## T4.10 — Address `edforge-pilot-rehearsal.ts`
- **Files:** the orchestrator (location varies; grep at repo root).
- **Change:** Either delete the file (most likely correct — it was UAT-only), OR repoint to ap-south-1 prod values AND rotate the embedded API key. Confirm with Shoaib if unclear.
- **Validation:** `grep -r 1hq87iv6i3 .` returns no matches.
- **Risk:** GREEN.

## T4.11 — Archive `server/.env.uat` and clean `server/cdk.context.json`
- **Files:** `server/.env.uat` (rename to `.env.uat.archived` or delete), `server/cdk.context.json` (remove cached us-east-2 entries).
- **Change:** as described.
- **Validation:** `source server/.env.uat` in a fresh shell fails; `npx cdk synth` against prod still succeeds.
- **Risk:** GREEN.

## T4.12 — Sprint 4 demo + log entry
- **Files:** `docs/infrastructure-sunset/PROJECT-LOG.md` ## Sprint 4.
- **Change:** Capture the three demo scenarios.
- **Risk:** GREEN.

---

# Sprint 5 — ap-south-1 Safe Cost Reductions (GREEN risk)

**Sprint goal:** Land every no-downtime, no-data-risk optimization. Compounded ~$15–25/month savings without a maintenance window.

**Sprint demo (recorded in `PROJECT-LOG.md` ## Sprint 5):**
1. `aws ec2 describe-vpc-endpoints --profile prod` lists DynamoDB and S3 Gateway Endpoints.
2. `aws ecr describe-lifecycle-policy --repository-name <repo> --profile prod` returns the 10-image policy for all four repos.
3. Cost Explorer 7-day rolling: CloudWatch Logs line item dropped 30–60%.
4. **Post-deploy smoke green:** an auth + read + write smoke test ran successfully within 10 minutes of each Sprint 5 deploy. (This proves the no-downtime claim.)
5. **Guard re-verification:** termination protection still ACTIVE on shared-infra-stack and tenant-template-stack-basic; DDB deletion-protection still TRUE on the four tables touched by Sprint 5 deploys.

**Hard prerequisite:** none.

## T5.1 — VPC Flow Logs: REJECT-only with 7d retention (or fully disabled)
- **Files:** `server/lib/shared-infra/shared-infra-stack.ts:70-76`.
- **Change:** Either `FlowLogTrafficType.ALL` → `REJECT` and add `RetentionDays.ONE_WEEK` on the destination log group, OR remove flow logs entirely. Default recommendation: disable for pilot; re-enable on demand for incident investigation.
- **Deploy:** `./scripts/deploy-analytics.sh shared-infra-stack prod`.
- **Validation:** `aws ec2 describe-flow-logs --profile prod` reflects the new state. 7-day Cost Explorer post-deploy shows CloudWatch Logs line item dropped.
- **Risk:** GREEN.
- **Rollback:** revert the file; redeploy.

## T5.2 — Reduce Service Connect + Cognito post-auth log retention (single PR)
- **Files:** `server/lib/tenant-template/services.ts:166` (Service Connect, `ONE_MONTH` → `ONE_WEEK`); `server/lib/auth-events/cognito-post-auth-trigger.ts:78` (Cognito post-auth, `ONE_MONTH` → `TWO_WEEKS`).
- **Deploy:** `./scripts/deploy-analytics.sh tenant-template-stack-basic prod`.
- **Validation:** `aws logs describe-log-groups --profile prod` confirms updated retention on both groups.
- **Risk:** GREEN.

## T5.3 — ECR lifecycle policies on all four repos (single PR)
- **Files:** new `docs/infrastructure-sunset/ecr-lifecycle-policy.json`; apply via CLI loop to `identity`, `academics`, `finance`, `rproxy`.
- **Change:** Two rules: keep last 10 tagged images; expire untagged after 7 days.
- **Validation:** `aws ecr get-lifecycle-policy --repository-name <repo> --profile prod` returns the policy for all four.
- **Risk:** GREEN.

## T5.4 — Add S3 and DynamoDB Gateway VPC Endpoints (single PR)
- **Files:** `server/lib/shared-infra/shared-infra-stack.ts`.
- **Change:** Add two `GatewayVpcEndpoint` constructs referencing all private-subnet route tables: one for `GatewayVpcEndpointAwsService.S3`, one for `GatewayVpcEndpointAwsService.DYNAMODB`.
- **Deploy:** `./scripts/deploy-analytics.sh shared-infra-stack prod`. CFN updates in place.
- **Validation:** `aws ec2 describe-vpc-endpoints --filters Name=vpc-id,Values=<vpcId> --profile prod` lists both. Every private-subnet route table contains routes to both prefix lists.
- **Risk:** GREEN.

## T5.5 — (Optional) Disable AdminWeb access logs
- **Files:** `server/lib/shared-infra/shared-infra-stack.ts:257`.
- **Change:** Pass `accessLogsBucket: undefined` to `StaticSiteDistro` (or remove the prop).
- **Deploy:** `./scripts/deploy-analytics.sh shared-infra-stack prod`.
- **Validation:** `aws cloudfront get-distribution-config --id <id> --profile prod` shows logging disabled.
- **Risk:** GREEN.

## T5.6 — Verify auto-created CW log groups have retention applied
- **Files:** new `docs/infrastructure-sunset/sprint-5-log-retention-audit.md`.
- **Change:** After T5.1–T5.4 deploys, query `aws logs describe-log-groups --profile prod` and filter for `retentionInDays == null`. Many ECS-task-related and Service-Connect-related log groups are created lazily; new ones appearing post-deploy may default to never-expire. For any null-retention group, set retention via `aws logs put-retention-policy` (`ONE_WEEK` for traffic logs, `ONE_MONTH` for app logs).
- **Validation:** the post-deploy query returns no null-retention groups.
- **Risk:** GREEN.

## T5.7 — Post-deploy guard re-verification
- **Files:** appended to `docs/infrastructure-sunset/PROJECT-LOG.md` ## Sprint 5.
- **Change:** After all Sprint 5 deploys settle, re-run the validation queries from T2.4, T2.5, T2.6, T2.7. Confirm none of the protections were silently flipped.
- **Validation:** all five stacks still `EnableTerminationProtection: true`; all five tables still `DeletionProtectionEnabled: true`; both Cognito pools still `DeletionProtection: ACTIVE`.
- **Risk:** GREEN.

## T5.8 — 48-hour cost reduction verification
- **Validation:** Cost Explorer post-deploy 48h shows daily run-rate dropped by ~$0.50–0.80.
- **Risk:** GREEN.

## T5.9 — Sprint 5 demo + log entry
- **Files:** `docs/infrastructure-sunset/PROJECT-LOG.md` ## Sprint 5.
- **Change:** Capture all five demo items (configuration evidence + smoke green + guards still on + cost screenshot).
- **Risk:** GREEN.

---

# Sprint 6 — NAT Reduction & ECS Right-sizing

**Sprint goal:** The big-ticket cost reduction. Drop from 3 NAT Gateways to 1, drop identity and rproxy from `desiredCount=2` to `1`. Maintenance-window sprint.

**Sprint demo (recorded in `PROJECT-LOG.md` ## Sprint 6):**
1. `aws ec2 describe-nat-gateways --filter Name=state,Values=available --profile prod` returns one.
2. `aws ecs describe-services --cluster prod-basic --services identitybasic rproxybasic --profile prod` shows `desiredCount=1` for each.
3. Cost Explorer monthly forecast for ap-south-1 lands ≤$100.
4. **Guard re-verification:** termination protection + DDB deletion-protection + Cognito deletion-protection unchanged after the deploys.

**Hard prerequisite:** Sprint 2 (termination protection + deletion protection at all three layers) is live.

## T6.1 — Verify CloudMap namespace cost
- **Files:** new `docs/infrastructure-sunset/cloudmap-namespace-audit.md`.
- **Change:** Run `aws servicediscovery list-namespaces --profile prod`. Document the type. HTTP namespaces created by Service Connect are typically free; Private DNS namespaces are ~$0.50/month each. If billable type is found, factor into the projection. (Independent of Sprint 6 deploys; runs early as preparation.)
- **Validation:** doc records type and updated projection.
- **Risk:** GREEN.

## T6.2 — Inventory third-party allowlists referencing current NAT EIPs
- **Files:** new `docs/infrastructure-sunset/nat-eip-allowlist-inventory.md`.
- **Change:** Capture three current NAT EIPs (`aws ec2 describe-addresses --profile prod`). For each external system EdForge calls outbound to (IEMIS upstream endpoints, eSewa, Khalti, school-district whitelists, VPN partners), document allowlist status and contact.
- **Validation:** doc lists every external system with allowlist status known.
- **Risk:** GREEN.

## T6.3 — Decide NAT EIP strategy
- **Files:** new `docs/infrastructure-sunset/nat-eip-strategy-decision.md`.
- **Change:** Two options based on T6.2 findings:
  - **Option A — let CFN pick (default):** Set `natGateways: 1` on the L2 `Vpc` construct. CFN chooses which NAT survives; the surviving EIP is one of the existing three but the choice is non-deterministic from CDK. If no third party allowlists EdForge's NAT IPs, this is the simplest path.
  - **Option B — pin a specific EIP:** Use `natGatewayProvider: ec2.NatProvider.gateway({ eipAllocationIds: [<chosen EIP allocation ID>] })` on the VPC. This pins the surviving NAT to a known EIP, preserving any existing third-party allowlist entry. More CDK code; more deterministic.
- Document the decision.
- **Validation:** doc explicitly states the chosen option and why. If Option A, T6.4 is a no-op. If Option B, T6.4 coordinates the allowlist updates BEFORE T6.5 deploys.
- **Risk:** GREEN.

## T6.4 — Coordinate third-party allowlist updates (conditional)
- **Change:** Only required if T6.3 chose Option A AND T6.2 found allowlist references. In that case, contact each external system and have them add the EIP that will survive (which, under Option A, is non-deterministic — operator's safest move is to pre-allowlist all three current EIPs so any of them can survive without breakage). Confirm in writing.
- **Validation:** written confirmations attached.
- **Risk:** YELLOW (third-party coordination risk).

## T6.5 — Schedule and announce maintenance window
- **Change:** Pick a 30–60 min window during 23:00–01:00 NPT. Notify pilot school admins ≥24h ahead.
- **Validation:** announcement sent and acknowledged.
- **Risk:** GREEN.

## T6.6 — NAT Gateway 3→1 deploy
- **Files:** `server/lib/shared-infra/shared-infra-stack.ts` (Vpc construct).
- **Change:** Apply T6.3's chosen option. Tee deploy output to `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/prod-nat-reduction-<timestamp>-<gitsha>.log`.
- **Deploy:** `./scripts/deploy-analytics.sh shared-infra-stack prod` during the maintenance window.
- **Validation:**
  1. `aws ec2 describe-nat-gateways --filter Name=state,Values=available --profile prod` returns one.
  2. Private subnet route tables in the other two AZs route `0.0.0.0/0` to the surviving NAT.
  3. `aws ec2 describe-addresses --profile prod` returns one in-use EIP (the surviving NAT's).
- **Risk:** YELLOW (brief egress disruption; rollback re-creates two NAT gateways with FRESH EIPs — original public IPs are gone).

## T6.7 — Post-deploy outbound smoke test
- **Change:** From a running ECS task, curl: an IEMIS upstream URL (read-only), a payment-gateway sandbox endpoint, an Anthropic/OpenAI inference endpoint if used. All must return 200/expected. Run the standard auth + read + write API smoke from outside the VPC against the API Gateway URL.
- **Validation:** all smokes green within 10 minutes. If any external system fails, identify whether T6.2/T6.4 missed an allowlist; rollback NAT change immediately if needed.
- **Risk:** YELLOW.

## T6.8 — ECS desiredCount 2→1 for identity and rproxy (single PR)
- **Files:** `server/lib/tenant-template/services.ts:137-138` (the `isCriticalPath` ternary).
- **Change:** Set both branches to `1`. Lower `minCapacity` if autoscaling is configured.
- **Deploy:** `./scripts/deploy-analytics.sh tenant-template-stack-basic prod`.
- **Validation:**
  1. `aws ecs describe-services --cluster prod-basic --services identitybasic rproxybasic --profile prod --query 'services[*].[serviceName,desiredCount]'` shows `1` for each.
  2. Run an auth smoke and a routing smoke (a request that exercises `/auth/*` and `/academics/*`); both pass.
- **Risk:** YELLOW. Single-task fault tolerance reduced. Recovery from a crashed task is automatic but takes 60–180 seconds (image pull + boot + ALB register-and-healthy). Pilot users WILL see brief 5xx during a crash. Communicate to school admins.
- **Rollback:** revert the file; redeploy.

## T6.9 — Post-deploy guard re-verification
- **Change:** Re-run T2.4, T2.5, T2.6, T2.7 validation queries. Confirm protections unchanged.
- **Validation:** all guards remain ACTIVE / `true`.
- **Risk:** GREEN.

## T6.10 — 7-day cost verification
- **Validation:** Cost Explorer 7-day rolling for ap-south-1 shows daily run-rate consistent with $90–100/month (or ≤$80 if Phase 7.6 stretch lands later). Document realized vs projected.
- **Risk:** GREEN.

## T6.11 — Sprint 6 demo + log entry
- **Files:** `docs/infrastructure-sunset/PROJECT-LOG.md` ## Sprint 6.
- **Change:** Capture four demo items including the cost screenshot.
- **Risk:** GREEN.

---

# Sprint 7 — Documentation & Stretch Optimization

**Sprint goal:** Make every repo-tracked doc consistent with single-region operation. Optionally land overnight scale-to-zero for the stretch ≤$80/month target.

**Sprint demo (recorded in `PROJECT-LOG.md` ## Sprint 7):** A new engineer reads CLAUDE.md and successfully deploys to prod following its instructions, without consulting any other source.

**Hard prerequisite:** Sprint 3 (us-east-2 teardown) complete.

## T7.1 — Update CLAUDE.md
- **Files:** `CLAUDE.md`.
- **Change:** Move UAT environment-profile entries (around lines 53–54) to a "Historical environments" section at the bottom. Reorganize active-operations sections around prod-only. Update example AdminWeb CloudFront domain references at lines 110/469–470 if they reference UAT.
- **Validation:** end-to-end read; no active references to `715860911762`, `us-east-2`, or `AWS_PROFILE=uat` outside the historical section. Run the new-engineer test described in the sprint demo.
- **Risk:** GREEN.

## T7.2 — Update other docs
- **Files:** `docs/EDFORGE_V1_DEVELOPER_DOCUMENT.md`, `server/lib/API_GATEWAY_DEPLOYMENT.md`.
- **Change:** Update operational examples to ap-south-1. Replace the `us-east-1` example endpoints in `API_GATEWAY_DEPLOYMENT.md` at lines 132/140/145 with ap-south-1 examples.
- **Validation:** `grep -E "us-east-1|us-east-2|AWS_PROFILE=uat" <files>` returns no matches outside historical sections.
- **Risk:** GREEN.

## T7.3 — Update deploy-log convention
- **Files:** `CLAUDE.md` § "Deploy log convention".
- **Change:** Drop `<env>` prefix from new deploy log filenames since only one env is live. Keep prior UAT-prefixed logs as audit trail.
- **Validation:** convention reads coherently; deploy wrapper output matches.
- **Risk:** GREEN.

## T7.4 — (Optional) Rename `scripts/deploy-analytics.sh` → `scripts/deploy.sh`
- **Files:** the script + every caller (search across `scripts/`, `docs/`, and CI workflows).
- **Change:** Rename. Update CLAUDE.md and any other doc that referenced the old name.
- **Validation:** all callers updated; new name works in a deploy dry-run.
- **Risk:** GREEN.

## T7.5 — (Optional, stretch) Schedule overnight ECS scale-to-zero
- **Files:** new `docs/infrastructure-sunset/scale-to-zero-runbook.md`. Configuration is via Application Auto Scaling scheduled actions (outside CDK to avoid CFN drift).
- **Change:** Register scaling targets for each ECS service if not already; add scheduled actions to scale to 0 at 17:15 UTC (= 23:00 NPT) and back to 1 at 00:15 UTC (= 06:00 NPT). Document the cold-start trade-off (60–90s on first request after wake).
- **Validation:** `aws application-autoscaling describe-scheduled-actions --service-namespace ecs --profile prod` lists the actions. After 24h, Cost Explorer reflects projected drop (~$10–15/month).
- **Risk:** YELLOW. Pilot users hitting the API during the idle window see service unavailable. Confirm with school admins before enabling.
- **Rollback:** `aws application-autoscaling delete-scheduled-action ...` and immediately scale back to `desiredCount=1`.

## T7.6 — Sprint 7 demo + log entry
- **Files:** `docs/infrastructure-sunset/PROJECT-LOG.md` ## Sprint 7.
- **Change:** Capture the new-engineer reading test pass and (if T7.5 landed) the post-deploy cost projection.
- **Risk:** GREEN.

---

# Sprint 8 — Cost Verification & Closure

**Sprint goal:** Prove the realized monthly cost lands at the target; establish the ongoing review cadence.

**Sprint demo (recorded in `PROJECT-LOG.md` ## Sprint 8):** 30-day Cost Explorer view confirming ap-south-1 spend ≤$100 (or ≤$80 if stretch landed). Monthly review process documented; first review scheduled.

**Hard prerequisite:** Sprint 6 complete.

## T8.1 — 7-day post-Sprint-6 cost check
- **Validation:** Cost Explorer last 7 days; daily run-rate at target. Document realized vs projected in PROJECT-LOG.
- **Risk:** GREEN.

## T8.2 — 14-day post-Sprint-6 cost check
- **Validation:** trend holds. Document any line item growing >20% week-over-week.
- **Risk:** GREEN.

## T8.3 — 30-day post-Sprint-6 cost check
- **Validation:** full month at target. Document realized cost in `docs/infrastructure-sunset/cost-realized-<YYYYMM>.md`.
- **Risk:** GREEN.

## T8.4 — Establish monthly review cadence
- **Files:** new `docs/infrastructure-sunset/monthly-cost-review-runbook.md`.
- **Change:** Document the monthly review: pull Cost Explorer for ap-south-1 prod, compare to last month, flag any line item >20% MoM growth, log findings in a per-month doc. Add the review to a calendar.
- **Validation:** runbook reviewable; first review scheduled.
- **Risk:** GREEN.

## T8.5 — Project closure
- **Files:** new `docs/infrastructure-sunset/PROJECT-CLOSURE.md`.
- **Change:** Summarize: total realized monthly savings, runway extended, references to all sprint sections in PROJECT-LOG.md, references to all deploy logs. Mark the project closed.
- **Validation:** closure doc reviewable end-to-end.
- **Risk:** GREEN.
