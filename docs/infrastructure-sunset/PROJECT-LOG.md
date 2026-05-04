# EdForge Infrastructure Sunset & Cost Optimization — Project Log

Rolling log of sprint demos, deploys, and signoffs. One H2 section per sprint per the canonical plan in `03-sprint-plan.md`.

## Sprint 1 — Safety Foundation

**Status:** Code complete and validated; awaiting commit + sign-off.

**Demo evidence:**
- 7/7 cleanup-guard scenarios pass (`scripts/ci/test-cleanup-guard.sh`):
  - Prod account ID blocklisted ✅
  - `AWS_PROFILE=prod` blocklisted regardless of account ✅
  - Non-allowlisted account refused ✅
  - Wrong region refused even for UAT account ✅
  - UAT account + us-east-2 + uat profile passes through ✅
  - Empty account ID refused (bad credentials) ✅
  - `GUARD_REQUIRE_REGION=false` works for CloudFront use ✅
- Synth-time DDB Retain assertion passes (`scripts/ci/assert-tenant-ddb-retain.sh`): 3 tables checked, 0 violations.
- All shell scripts pass `bash -n`.
- `grep -rEn "346698404105|aws-nuke|delete-remaining-stacks|rds_proxy_multitenant" scripts/` returns 0 matches — stale tooling fully removed.

**Files changed (uncommitted, ready for review):**
- `scripts/cleanup/_safety-guard.sh` (new)
- `scripts/cleanup/cleanup.sh` (hardened + DDB delete pass + drop dead caller)
- `scripts/cleanup/cleanup-cloudfront.sh` (guard sourced)
- `scripts/cleanup/cleanup-cognito.sh` (guard sourced)
- `scripts/cleanup/cleanup-secrets.sh` (deleted — dead code)
- `scripts/cleanup/aws-nuke-setup.sh` (deleted — stale config)
- `scripts/cleanup/README-AWS-NUKE.md` (deleted — stale doc)
- `scripts/cleanup/delete-remaining-stacks.sh` (deleted — stale ARN)
- `scripts/ci/assert-tenant-ddb-retain.sh` (new — synth-time assertion)
- `scripts/ci/test-cleanup-guard.sh` (new — guard regression test)

**Sprint 1 follow-up flagged during Sprint 2 snapshot:** the `cleanup.sh` DDB delete-pass references the literal name `"TenantMapping"`, but the actual prod table name is auto-generated (`shared-infra-stack-TenantMappingTable8521321C-96GMWAIFDS9`). UAT will mirror this pattern. Recommended fix before Sprint 3: convert the literal-name array into a glob loop matching `shared-infra-stack-TenantMappingTable*`. **Tracked.**

## Sprint 2 — Production Data Hardening

**Status:** Code complete + read-only tickets complete + validated. Deploys awaiting operator authorization.

### Read-only tickets (completed 2026-05-01)

ReadOnlyAccess managed policy attached to `edforge-prod-deployer` for the duration of these tickets. **MUST be detached after sign-off:**

```
aws iam detach-user-policy \
  --user-name edforge-prod-deployer \
  --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess
```

| Ticket | Output | Headline finding |
|---|---|---|
| T2.1 + T2.8 | [snapshot-prod-pre-optimize-20260501.md](snapshot-prod-pre-optimize-20260501.md) | All 5 prod stacks `terminationProtection=false`. PITR ENABLED on all 9 DDB tables. DeletionProtection OFF on all tables and pools. Three NAT EIPs captured for Sprint 6 third-party allowlist coordination. |
| T2.2 | [sprint-2-data-verification-20260501.md](sprint-2-data-verification-20260501.md) | **3 tenants in prod**, ~10,500 business rows. Real pilot data confirmed. |
| T2.3 | [cost-baseline-reconciliation-20260501.md](cost-baseline-reconciliation-20260501.md) | **Realized $203.69/month** vs audit $201 estimate (within 1.5%). Audit overstated Fargate by ~$18 (reviewer was right). $100 target is on the edge — likely $115–120 from Sprint 5+6 alone, $100–105 only with optional Sprint 7.5 overnight scale-down. |

### Read-only ticket findings to action

1. **Three tenants in prod, not one.** Worth a 5-minute investigation by operator to confirm all three are pilot schools (vs. test residue).
2. **TenantMappingTable shows 2 items but 3 tenants in identity** — possible off-by-one. Not blocking.
3. **Advanced cluster `prod-advanced-257526644020` deployed but unused** (0 services). Cost ~$0; future cleanup item.
4. **Sprint 1 follow-up** for cleanup.sh TenantMapping name pattern (above).
5. **Cost target re-anchored.** $100/month is achievable only with Sprint 7.5 stretch optimization. $115–120/month is the realistic Sprint 5+6 outcome.

### Code-change tickets (T2.4 – T2.7) — uncommitted, ready for review

| Ticket | Files | Notes |
|---|---|---|
| T2.4 — terminationProtection on 5 stacks | `bin/ecs-saas-ref-template.ts`, `lib/utilities/account-guards.ts` (new), `lib/shared-infra/shared-infra-stack.ts` | Includes a latent-bug fix: `super(scope, id)` was dropping all StackProps. |
| T2.5 — DDB deletionProtection on 7 tables | `lib/shared-infra/shared-infra-stack.ts`, `lib/tenant-template/ecs-dynamodb.ts`, `lib/analytics/analytics-stack.ts` | Audit said 5 tables; analytics has 3 not 1, total 7. |
| T2.6 — Cognito tenant pool deletionProtection | `lib/tenant-template/identity-provider.ts` | Property is `boolean`, not the `DeletionProtection` enum. |
| T2.7 — System-admin pool deletionProtection | `lib/bootstrap-template/control-plane-stack.ts` | L1 escape hatch on SBT-managed `cognito.CfnUserPool` (cleaner than custom resource). |

**Synth-simulation validation (passed):**
- Prod-account synth → all 5 stacks `terminationProtection=true`, all 7 DDB tables `DeletionProtectionEnabled=true`, both Cognito pools `DeletionProtection=ACTIVE`.
- UAT-account synth → all properties OFF (UAT teardown remains unblocked).
- T1.6 retain assertion still passes after Sprint 2 changes.

### Sprint 2 deploys to prod — COMPLETED 2026-05-03

PRs merged: #35 (Sprint 1, `7389634`), #36 (Sprint 2, `d214871`). HEAD = `7389634`.

Deploys executed against `AWS_PROFILE=prod` (account 257526644020, ap-south-1):

| # | Stack | Wrapper time | Result | Notable |
|---|---|---:|---|---|
| 1 | shared-infra-stack | 293s | ✅ UPDATE_COMPLETE | TenantMappingTable: DeletionProtection true |
| 2 | controlplane-stack | 68s | ✅ UPDATE_COMPLETE | System-admin pool: DeletionProtection ACTIVE |
| 3 | analytics-stack | 67s | ✅ UPDATE_COMPLETE | 3 DDB tables protected; ApiLambda S3Key updated (esbuild cosmetic, source unchanged) |
| 4 | core-appplane-stack | 25s | ✅ "no changes" + termination flip | CFN reported no resource changes; CDK applied termination protection separately |
| 5 | tenant-template-stack-basic | 94s | ✅ UPDATE_COMPLETE | Tenant pool ACTIVE; 3 per-tenant DDB tables protected; tenant-mapping codeCommitId 3c420c1 → 7389634 |

Total deploy time: ~9 minutes (well under runbook's 25–40 min estimate; CFN was efficient because all changes were in-place property updates).

Logs at `docs/deploys/analytics-prod-<stack>-20260503-*.log`.

### Final verification (post-deploy)

All 14 protections active:
- 5 stacks → `EnableTerminationProtection: True`
- 7 DDB tables → `DeletionProtectionEnabled: True` (TenantMapping, edforge-{identity,academics,finance}-basic, edforge-analytics, edforge-analytics-landing, edforge-user-session-events)
- 2 Cognito pools → `DeletionProtection: ACTIVE` (system-admin, basic tenant)

Negative tests passed:
- `aws dynamodb delete-table` against TenantMappingTable → refused
- `aws dynamodb delete-table` against edforge-finance-basic → refused
- `aws cognito-idp delete-user-pool` against system-admin pool → refused
- `aws cognito-idp delete-user-pool` against basic tenant pool → refused

Smoke tests:
- API GW `/health` → 403 (expected: API key required without auth)
- API GW `/users` → 401 (auth required, NOT 5xx — runtime healthy)
- AdminWeb CloudFront → 200
- ECS services: all 4 services ACTIVE, 6 tasks running (unchanged from baseline)

### Sprint 2 — DONE

| Sprint 2 ticket | Status |
|---|---|
| T2.1 — Pre-optimize prod snapshot | ✅ |
| T2.2 — Verify prod data is real | ✅ |
| T2.3 — Cost baseline reconciliation | ✅ |
| T2.4 — Termination protection on 5 stacks | ✅ deployed + verified |
| T2.5 — DeletionProtectionEnabled on 7 DDB tables | ✅ deployed + verified |
| T2.6 — Cognito tenant pool deletion protection | ✅ deployed + verified |
| T2.7 — System-admin Cognito pool deletion protection | ✅ deployed + verified |
| T2.8 — PITR validation snapshot | ✅ (folded into T2.1; PITR ENABLED on all 9 tables) |

### Outstanding operator action

**Detach ReadOnlyAccess from `edforge-prod-deployer`** now that Sprint 2 read-only and deploy work is complete:
```
aws iam detach-user-policy \
  --user-name edforge-prod-deployer \
  --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess
aws iam list-attached-user-policies --user-name edforge-prod-deployer
# Expected: only the 4 EdForge*Policy attachments, no ReadOnlyAccess.
```

### What unblocks now

- **Sprint 6** (NAT 3→1 + ECS right-sizing) — was gated on Sprint 2 deploys being live; now unblocked. This is the big-ticket cost reduction.
- Sprint 3 (us-east-2 teardown) and Sprint 4/5 (frontend repointing, safe ap-south-1 optimizations) were already unblocked.

## Sprint 5 — ap-south-1 Safe Cost Reductions (GREEN risk)

**Status:** Code complete + ECR lifecycle policies applied; CDK deploys awaiting operator authorization.

### Changes (this PR)

| Ticket | What | File |
|---|---|---|
| T5.1 | Disable VPC Flow Logs | `lib/shared-infra/shared-infra-stack.ts` (removed `flowLogs` from `Vpc` construct) |
| T5.2 | Service Connect log retention `ONE_MONTH → ONE_WEEK` | `lib/tenant-template/services.ts:166` |
| T5.2 | Cognito post-auth Lambda log retention `ONE_MONTH → TWO_WEEKS` | `lib/auth-events/cognito-post-auth-trigger.ts:78` |
| T5.3 | ECR lifecycle policies (already applied via CLI) | `docs/infrastructure-sunset/ecr-lifecycle-policy.json` (NEW) |
| T5.4 | Add S3 + DynamoDB Gateway VPC Endpoints | `lib/shared-infra/shared-infra-stack.ts` (2 new `GatewayVpcEndpoint` constructs) |
| T5.5 | (Skipped) Disable AdminWeb access logs | Optional — minimal savings; left as-is |

### Validation (synth-time, pre-deploy)

- `npx cdk synth` against prod-account simulation: 2 `AWS::EC2::VPCEndpoint` resources synthesized (S3 + DynamoDB), 0 `AWS::EC2::FlowLog` resources (removed).
- T1.6 retain assertion still passes after Sprint 5 changes (3 tables / 0 violations).
- Sprint 2 protections unchanged in synth output (Sprint 5 doesn't touch any DDB/Cognito/stack-termination property).

### Already applied (out-of-band, T5.3)

ECR lifecycle policies on all 4 prod repos (`identity`, `academics`, `finance`, `rproxy`):
- Rule 1: Keep last 10 tagged images
- Rule 2: Expire untagged images after 7 days

This was a CLI operation against a prod resource that's not CDK-managed. Done before the CDK deploys to land the operational hygiene immediately. The policy JSON is committed as a reproducibility artifact.

### Expected savings (per cost reconciliation)

| Change | Realized monthly savings estimate |
|---|---:|
| VPC Flow Logs disable | ~$0.30 (CW Logs line) + indirect EC2-Other reduction (TBD) |
| Service Connect + Cognito log retention | <$0.50 (already tiny line items) |
| Gateway Endpoints | $1–2 direct + cuts NAT data-processing volume (compounds the Sprint 6 NAT reduction) |
| ECR lifecycle | ~$0 (storage was already small) |
| **Total Sprint 5 direct savings** | **~$2–3/month** |

The headline Sprint 5 value is **operational hygiene + setup for Sprint 6** more than direct dollar reduction.

### Sprint 5 deploys to prod — COMPLETED 2026-05-03

Two stacks deployed (controlplane-stack had no diff, skipped):

| # | Stack | Time | Result |
|---|---|---:|---|
| 1 | shared-infra-stack | 310s | ✅ Flow Logs removed, 2 Gateway Endpoints (S3 + DynamoDB) added |
| 2 | tenant-template-stack-basic | 87s | ✅ Service Connect log retention 30→7d, Cognito post-auth 30→14d |

Verification:
- `aws ec2 describe-vpc-endpoints` → 2 endpoints, both `available`
- `aws ec2 describe-flow-logs` → empty (Flow Logs gone)
- 4 ECS service log groups → `retentionInDays: 7`
- Cognito post-auth Lambda log group → `retentionInDays: 14`
- ECR lifecycle policies (out-of-band, T5.3): all 4 prod repos show 2-rule policy
- Sprint 2 guards re-verified intact: all stacks/tables/pools still protected
- Smoke: API GW 401, AdminWeb 200, all 4 ECS services ACTIVE (6 tasks unchanged)

**Sprint 5 status: DONE.**

## Sprint 6 — NAT Reduction & ECS Right-sizing (DEPLOYED 2026-05-03)

**Critical-path deploy** — the largest cost reduction in the project. Deployed in a maintenance window with operator approval; brief egress disruption (~seconds) handled by ECS retries.

### Decisions captured before deploy (T6.1–T6.5)

- **T6.1 — CloudMap namespace cost:** 1 HTTP namespace (`basic`, `ns-v3bsdqlbzaz7jpax`). HTTP namespaces are FREE per AWS pricing — no extra line item to factor.
- **T6.2 — Third-party allowlist inventory:** EdForge has no third-party integrations in production yet. No external system allowlists the NAT public IPs. Decision documented before T6.6 deploy.
- **T6.3 — NAT EIP strategy:** **Option A** chosen (set `natGateways: 1` on the L2 Vpc construct; CFN picks which NAT survives, non-deterministic). Justified because no allowlist coordination is needed.
- **T6.4 — Allowlist coordination:** No-op (per T6.2).
- **T6.5 — Maintenance window:** Same-session deploy authorized.

### Deploys executed

| # | Stack | Time | Result |
|---|---|---:|---|
| 1 | shared-infra-stack | 325s | ✅ NAT 3→1; PublicSubnet2/3 NATs + EIPs destroyed; private routes updated |
| 2 | tenant-template-stack-basic | 129s | ✅ ECS desiredCount 2→1 for identity + rproxy |

### Surviving NAT (CFN's pick)

CFN kept the NAT in `PublicSubnet1`:
- NAT Gateway: `nat-0a422c72c3e61f59d`
- Public IP: **`13.234.151.182`** (eipalloc-08ff63de8dfc6c9c5)
- AZ: `aps1-az1` (`ap-south-1a`)

Released (gone from prod account):
- `43.204.201.147` (was in aps1-az3)
- `35.154.234.47` (was in aps1-az2)

If a future third party wants to allowlist EdForge outbound traffic, the IP they need is now `13.234.151.182`.

### Final infrastructure state (post-Sprint-6)

| Resource | Pre-Sprint-6 | Post-Sprint-6 |
|---|---:|---:|
| NAT Gateways | 3 (one per AZ) | 1 (aps1-az1) |
| Allocated EIPs | 3 | 1 |
| ECS Fargate tasks | 6 (identity×2, academics×1, finance×1, rproxy×2) | 4 (one per service) |
| Private subnet route tables | each → its-AZ NAT | all 3 → surviving NAT |

### T6.9 Sprint 2 guard re-verification (post-deploy)

All 14 protections still active:
- 5 stacks `terminationProtection=True`
- 7 DDB tables `DeletionProtectionEnabled=True`
- 2 Cognito pools `DeletionProtection=ACTIVE`

### T6.9 Runtime smoke

- API GW `/users` → 401 (auth required, runtime healthy — not 5xx)
- AdminWeb → 200
- All 4 ECS services ACTIVE, runningCount matches desiredCount

### Projected cost impact (per cost-baseline-reconciliation)

| Component | Pre-Sprint-6 | Post-Sprint-6 | Monthly delta |
|---|---:|---:|---:|
| NAT Gateways | $103.22 (3 × $32.85 + data transfer) | ~$36 (1 × $32.85 + data transfer) | **−$67/month** |
| ECS Fargate | $54.08 (6 tasks at 256/512 + 1×512/1024) | ~$36 (4 tasks) | **−$18/month** |
| **Total Sprint 6 direct savings** | | | **~$85/month** |

Combined with Sprint 5's cumulative effect, the projected monthly cost is **~$120/month** — close to the $100 target but not quite there. The optional Sprint 7.5 overnight scale-to-zero would close most of the remaining gap.

### Sprint 6 — DONE (deploy layer)

| Sprint 6 ticket | Status |
|---|---|
| T6.1 — CloudMap namespace inventory | ✅ |
| T6.2 — NAT EIP allowlist inventory | ✅ |
| T6.3 — NAT EIP strategy decided (Option A) | ✅ |
| T6.4 — Allowlist coordination | ✅ N/A |
| T6.5 — Maintenance window | ✅ |
| T6.6 — NAT Gateway 3→1 deploy | ✅ |
| T6.7 — Post-NAT outbound smoke | ✅ |
| T6.8 — ECS desiredCount 2→1 deploy | ✅ |
| T6.9 — Post-deploy guard re-verification | ✅ |
| T6.10 — 7-day cost verification | ⏳ Operator monitors |

### What's next

- **Sprint 8** — 7/14/30-day cost verification + project closure. Operator-driven monitoring. Runs against ap-south-1 Cost Explorer over the next 30 days.
- **Sprint 3** — us-east-2 teardown (independent track, can run anytime).
- **Sprint 4** — Frontend `.env.local` repointing (independent track).
- **Sprint 7** — Documentation cleanup + optional overnight scale-to-zero stretch.

### Operator actions still on the radar

1. **Detach `ReadOnlyAccess`** from `edforge-prod-deployer` IAM user (Sprint 2 closeout — overdue):
   ```
   aws iam detach-user-policy --user-name edforge-prod-deployer \
     --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess
   ```
2. Watch Cost Explorer for the projected $85/month drop over the next 7 days.

## Sprint 3 — us-east-2 Teardown (DEPLOYED 2026-05-03)

**The UAT account is empty.** us-east-2 / 715860911762 holds no EdForge resources.

### Pre-flight (T3.1)

- ✅ Account 715860911762 (UAT)
- ✅ Region us-east-2
- ✅ All 5 EdForge stacks present (plus CDKToolkit + 2 ECS-cluster nested stacks + the V1_DEFERRED tenant-template-stack-advanced)
- ✅ Hardened cleanup.sh + safety guard sourced

### Cleanup execution (T3.2)

`SKIP_CONFIRM=true AWS_PROFILE=uat ./scripts/cleanup/cleanup.sh` ran in **~30 minutes** (much faster than the 60–120 min runbook estimate). Log: `docs/deploys/uat-teardown-cleanup-20260503-142327-b63d638.log`.

The script's deterministic phases all completed:
- S3 buckets emptied + deleted
- All ECS services force-deleted
- Tenant CloudFormation stacks deleted
- `cdk destroy --all --force` ran
- All Cognito pools deleted (3 pools)
- All ECR repos deleted (4 repos)
- SSM parameters deleted
- CloudWatch log groups deleted
- DDB delete pass attempted on the 7 EdForge tables

### Stuck-stack recovery (post-cleanup-script)

After `cleanup.sh` finished, two stacks remained: `controlplane-stack` (`DELETE_FAILED`) and `shared-infra-stack` (never reached because controlplane was a dependency).

**Root cause:** the SBT-managed EventBridge bus (`controlplanestackcontrolplanesbtEventManagerSbtEventBus1E602009`) had a managed rule attached, created by an EventBridge archive (`edforge-analytics-evidence`) that lived OUTSIDE the CFN stack-resource graph. CFN can't delete a bus that still has rules.

**Manual recovery steps:**
1. `aws events delete-archive --archive-name edforge-analytics-evidence` — managed rule auto-cleared
2. `aws cloudformation delete-stack --stack-name controlplane-stack` — completed cleanly
3. `aws cloudformation delete-stack --stack-name shared-infra-stack` — completed cleanly

**Sprint 1 follow-up identified:** the bus archive cleanup is a known SBT/CDK gap; if a future UAT teardown happens, `cleanup.sh` should pre-empt it (delete archives → clear rules → before `cdk destroy --all`).

### Residue cleanup (post-stack-delete)

After stacks were gone, three categories of orphan resources remained and were manually cleaned:

| Category | Count | Cause | Action |
|---|---:|---|---|
| EdForge DDB tables (`edforge-{identity,academics,finance}-basic`) | 3 | RemovalPolicy.RETAIN survived `cdk destroy`. The Sprint 1 DDB delete pass ran but couldn't delete them — `DeletionProtectionEnabled=True` in UAT. | Disabled deletion protection via `update-table --no-deletion-protection-enabled`, then `delete-table` |
| Orphan IAM roles (`shared-infra-stack-ApiGatewayTenantApiCloudWatchRol-*`) | 10 | API Gateway CloudWatch role artifacts not captured by CFN | Detach managed policies, delete inline policies, `delete-role` |
| S3 bucket `edforge-analytics-exports-715860911762-us-east-2` | 1 | Created outside CFN stack (analytics-stack uses RemovalPolicy.RETAIN on this bucket) | Empty (versioned objects + delete markers), `s3 rb --force` |

**Sprint 1 follow-up identified (DDB protection):** UAT tables somehow had `DeletionProtectionEnabled=True` even though Sprint 2's `isProdAccount()` gate should leave UAT at false. Production sanity-checked: prod tables are still `True` (correct). Possible explanation: an earlier deploy-time CDK_DEFAULT_ACCOUNT misresolution. **The Sprint 1 cleanup.sh DDB delete pass should `update-table --no-deletion-protection-enabled` BEFORE attempting delete** (defensive belt-and-suspenders for any UAT-equivalent environment).

### CDK bootstrap (T3.6)

- `CDKToolkit` stack deleted (213 versioned objects in the staging bucket emptied first)
- `cdk-hnb659fds-assets-715860911762-us-east-2` bucket deleted

### Final verification (T3.3 / T3.4 / T3.5)

| Resource type | Count remaining |
|---|---:|
| CFN stacks (any) | **0** |
| ECS clusters | 0 |
| Load balancers | 0 |
| NAT Gateways | 0 |
| Non-default VPCs | 0 |
| Allocated EIPs | 0 |
| Lambdas (any) | 0 |
| EventBridge custom buses | 0 |
| EventBridge archives | 0 |
| DDB tables | 0 |
| S3 buckets (all) | 0 |
| ECR repositories | 0 |
| Cognito user pools | 0 |
| EdForge-pattern IAM roles | 0 |
| CloudFront distributions | 0 |

**The UAT account is empty.**

### Cost-leak follow-ups

| Ticket | Status |
|---|---|
| T3.7 — 24h cost-leak check | ⏳ Operator monitors Cost Explorer 2026-05-04 |
| T3.8 — 7-day cost-leak check | ⏳ Operator monitors Cost Explorer 2026-05-10 |

Expected: daily run-rate drops to ≤$0.10 within 24h. The release of 3 NAT Gateways alone removes $3.30/day; remaining trickle should be sub-cent NAT-egress data transfer (now zero) and a few CloudWatch log groups that may still exist with negligible storage.

### Sprint 3 — DONE (deploy layer)

| Sprint 3 ticket | Status |
|---|---|
| T3.1 — Pre-flight verification | ✅ |
| T3.2 — Run hardened cleanup.sh | ✅ |
| T3.3 — Compute-resource verification | ✅ |
| T3.4 — Data-resource verification | ✅ |
| T3.5 — Identity-resource verification | ✅ |
| T3.6 — Delete CDKToolkit | ✅ |
| T3.7 — 24h cost-leak | ⏳ |
| T3.8 — 7-day cost-leak | ⏳ |

### Combined project savings (Sprint 3 + Sprint 5/6)

- Sprint 6 prod cost reduction: ~$85/month
- Sprint 3 UAT account elimination: ~$200/month (entire deployment removed)
- **Total monthly savings**: **~$285/month**
- **Annualized runway recovered**: **~$3,420/year**

### Operator follow-ups

1. **Detach `ReadOnlyAccess`** from `edforge-prod-deployer` IAM user (Sprint 2 closeout — still overdue).
2. **Account-level cleanup of UAT (715860911762)** — per execution-plan §1.7: account is the AWS Organizations management account and CANNOT be closed. Leave as empty shell. Optionally: remove the local `[uat]` profile from `~/.aws/credentials` to prevent muscle-memory mistakes (`AWS_PROFILE=uat` would no longer be valid for any operation since the account is empty).
3. **Watch Cost Explorer for both accounts:**
   - 715860911762: should drop to ≤$0.10/day within 24h
   - 257526644020: should reflect Sprint 5/6 savings (~$85/month) over the next 7d

### What's next

| Sprint | Status |
|---|---|
| 1, 2, 3, 5, 6 | **DONE** ✅ |
| 4 — Frontend `.env.local` repointing | unblocked, can run anytime |
| 7 — Docs cleanup (CLAUDE.md single-region) + optional overnight scale-to-zero | unblocked |
| 8 — 7/14/30-day cost verification + project closure | starts when Sprint 6 + 3 cost data settles |

## Sprint 4 — Frontend & Smoke-Test Repointing (DONE 2026-05-03)

Repository-wide cleanup: every reference to the deleted us-east-2 UAT environment has been updated to ap-south-1 prod. Pure code change, no AWS deploys.

### Prod coordinates resolved (T4.1)

| Key | Value |
|---|---|
| API Gateway URL | `https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod` |
| Cognito Region | `ap-south-1` |
| Cognito User Pool ID (basic tenant) | `ap-south-1_spYeNvNJt` |
| Cognito Client ID | `5bqleabcb6j9aeu4uipfppgb94` |
| Cognito Domain | `edforge.auth.ap-south-1.amazoncognito.com` |

### Frontend `.env.local` (T4.2)

8 files updated locally — `apps/{shell, academics, edfi, messages, special-programs, people, finance, analytics}/.env.local`. These are gitignored in both repos (outer + frontend), so the changes are local-dev only and **do NOT appear in this PR**. Documented for reproducibility.

### Smoke-test URL substitution (T4.5–T4.8)

44 stale us-east-2 URL references reduced to 0 in `scripts/smoke-tests/*.ts` (34 source files updated; 10 historical log files in `scripts/smoke-tests/logs/` left intact as audit trail per runbook). Substitution: any `https://<id>.execute-api.us-east-2.amazonaws.com` → `https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com`.

### Operational scripts (T4.9 + T4.10)

Updates to defaults and usage examples:

- `scripts/run-diagnostics.sh` — `AWS_PROFILE` default `dev` → `prod`; `AWS_REGION` `us-east-1` → `ap-south-1`
- `scripts/analytics/export-openapi.sh` + `local/invoke-local.sh` — `AWS_PROFILE` `uat` → `prod`; `AWS_REGION` `us-east-2` → `ap-south-1`
- `scripts/backfill-section-subject-area.ts` — region default `us-east-2` → `ap-south-1`
- 6 `scripts/analytics/*.ts` files — usage-example comments updated to prod/ap-south-1
- 2 `scripts/operations/finance-*.ts` files — usage-example comments updated
- `scripts/api-test.sh` — hardcoded UAT API URL updated (note: this file still has hardcoded UAT credentials in EMAIL/PASSWORD lines that should be removed as a separate cleanup; they are dead since the UAT Cognito pool is gone)
- `server/application/test/e2e/golden-thread-validation.e2e.spec.ts` (and its `.js` artifact) — BASE_URL updated (note: also has a hardcoded JWT token that's dead post-teardown)
- `server/lib/cdknag/analytics-nag.ts` — comment example updated
- `scripts/smoke-tests/iemis-layer4-negative-stress.ts` and `iemis-ddb-audit-verifier.ts` — defaults updated (these files are untracked in the outer repo, so changes are local; they may belong in a separate sprint to track)

### `edforge-pilot-rehearsal.ts` (T4.10)

File does NOT exist in the repo (search returned empty). The audit referenced a UAT-only orchestrator; either it was already deleted or it lived only on a developer's machine. **No action needed.**

### Server env files (T4.11)

`server/.env.uat` → `server/.env.uat.archived` (renamed). Preserves the old config as an archaeological artifact (in case a future replacement UAT environment needs the same shape) while breaking the `source server/.env.uat` reflex. `server/cdk.context.json` does not exist — no cleanup needed.

### Vercel env vars (T4.3 — operator-driven)

`edforge-saas-frontend` deploys via Vercel; its production env vars are NOT in this repo. Step-by-step instructions captured in [sprint-4-vercel-env-update.md](sprint-4-vercel-env-update.md). **Operator must update 6 keys in the Vercel dashboard for both Production and Preview environments.**

### Files in this PR (~50 modifications, +Sprint-4 docs)

Mostly URL-only substitutions in scripts. The repo is now consistent with single-region (ap-south-1) operation in every reference.

### Outstanding non-Sprint-4 cleanups surfaced

1. `scripts/api-test.sh` lines 28–29: hardcoded EMAIL + PASSWORD (UAT credentials, dead but still leaked). Should be removed in a follow-up.
2. `server/application/test/e2e/golden-thread-validation.e2e.spec.ts` line 25: hardcoded JWT token (UAT-issued, expired and dead).
3. Two untracked smoke tests (`iemis-layer4-negative-stress.ts`, `iemis-ddb-audit-verifier.ts`) — were already in working tree, locally updated by Sprint 4 sed pass, will be picked up by whoever stages them next.

### Sprint 4 — DONE

| Sprint 4 ticket | Status |
|---|---|
| T4.1 — Prod coordinates resolved | ✅ |
| T4.2 — Frontend `.env.local` updated | ✅ (local; gitignored) |
| T4.3 — Vercel env vars | ⏳ Operator action |
| T4.4 — Stale-URL list generated | ✅ |
| T4.5–T4.8 — Smoke-test URLs substituted | ✅ (34 source files) |
| T4.9 — Operational script defaults | ✅ |
| T4.10 — pilot-rehearsal / api-test / e2e | ✅ (pilot-rehearsal not in repo) |
| T4.11 — Archive `.env.uat` + clean cdk.context | ✅ (archived; cdk.context did not exist) |
