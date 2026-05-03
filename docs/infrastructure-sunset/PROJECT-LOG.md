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

### What needs operator (Sprint 5)

1. Review and merge this PR.
2. `cdk diff shared-infra-stack`, `tenant-template-stack-basic`, `controlplane-stack` against prod (read-only, covered by deploy-step authorization).
3. Deploy each via `./scripts/deploy-analytics.sh <stack> prod`. Order: `shared-infra-stack` first (Gateway Endpoints + Flow Logs disable land here), then `tenant-template-stack-basic` (Service Connect retention), then `controlplane-stack` (Cognito post-auth retention).
4. Post-deploy verification:
   - `aws ec2 describe-vpc-endpoints --filters Name=vpc-id,Values=vpc-0a5e1a669f077354b --profile prod` — 2 endpoints listed
   - `aws ec2 describe-flow-logs --profile prod` — 0 active flow logs for the EdForge VPC
   - Service Connect log groups show 7-day retention; Cognito post-auth log group shows 14-day retention
5. Re-verify Sprint 2 guards still active (T5.7 of sprint plan):
   - Stacks still `terminationProtection=True`
   - DDB tables still `DeletionProtectionEnabled=True`
   - Cognito pools still `DeletionProtection=ACTIVE`
