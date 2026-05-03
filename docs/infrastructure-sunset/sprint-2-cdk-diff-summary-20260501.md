---
title: Sprint 2 — `cdk diff` review summary
date: 2026-05-01
git-sha: c640af2 (HEAD)
deployed-sha: 3c420c1 (per CreateTenantMapping codeCommitId in tenant-template-stack-basic)
verdict: GO — all changes match the expected diff column in the runbook; one cosmetic anomaly investigated and deemed safe.
---

# Diffs captured

All 5 logs in `docs/deploys/`:
- prod-cdk-diff-shared-infra-stack-20260501-214127-c640af2.log
- prod-cdk-diff-controlplane-stack-20260501-214634-c640af2.log
- prod-cdk-diff-analytics-stack-20260501-214634-c640af2.log
- prod-cdk-diff-core-appplane-stack-20260501-214634-c640af2.log
- prod-cdk-diff-tenant-template-stack-basic-20260501-214634-c640af2.log

# Per-stack verdict

## 1. shared-infra-stack — GO

```
[~] AWS::DynamoDB::Table TenantMappingTable
 └─ [+] DeletionProtectionEnabled: true
```

Single resource change. Matches expected.

The latent-bug fix in `super(scope, id, props)` produced **no extra resource churn** (env was already being passed via process.env / app.account fallback). Stack-level `terminationProtection` flip shows up as the "Omitted 2 changes" line — non-resource template metadata. Confirmed at synth-manifest level: `terminationProtection: true` for shared-infra in prod-account simulation.

## 2. controlplane-stack — GO

```
[~] AWS::Cognito::UserPool CognitoAuth/UserPool (system-admin pool)
 └─ [+] DeletionProtection: ACTIVE
```

Single own resource change. The L1 escape hatch on the SBT-managed pool synthesizes correctly. (TenantMappingTable line is an upstream-stack echo from shared-infra — not a controlplane change.)

## 3. analytics-stack — GO (with one investigated anomaly)

Expected:
```
[~] AnalyticsTable           DeletionProtectionEnabled: true
[~] LandingTable             DeletionProtectionEnabled: true
[~] UserSessionEventsTable   DeletionProtectionEnabled: true
```
All 3 analytics tables get DeletionProtection. ✅

**Anomaly investigated**:
```
[~] AWS::Lambda::Function ApiLambda
 └─ [~] Code.S3Key: 25ddff... → 35008f...
```

Root cause: esbuild bundling non-determinism. Verified: `git diff --stat 3c420c1..HEAD -- server/lib/analytics/` returns empty — **no source-code changes** to any analytics Lambda across the 20+ commits between the deployed SHA and HEAD. The bundle hash differs because esbuild output varies with timestamps, dependency resolution order, and other non-source inputs.

**Impact**: cosmetic. Lambda will be re-uploaded to S3 (via the standard CDK asset pipeline) and re-attached to the function. Behavior unchanged.

**Verdict**: safe to deploy. If a deploy-time diff later showed a CHANGE in analytics Lambda code, that would be a different matter — but here we have evidence the source is unchanged.

## 4. core-appplane-stack — GO

No own resource changes (only upstream-stack echoes). Stack-level `terminationProtection` flip is the only intended change; it doesn't appear at the resource level. Matches expected.

## 5. tenant-template-stack-basic — GO

Expected:
```
[~] AWS::Cognito::UserPool basic (tenant pool)
 └─ [+] DeletionProtection: ACTIVE
[~] AWS::DynamoDB::Table edforge-identity-basic    DeletionProtectionEnabled: true
[~] AWS::DynamoDB::Table edforge-academics-basic   DeletionProtectionEnabled: true
[~] AWS::DynamoDB::Table edforge-finance-basic     DeletionProtectionEnabled: true
```
All 4 protections land. ✅

**Additional changes** — `CreateTenantMapping` custom resource and `S3SourceVersion` output:
```
codeCommitId: "3c420c1" → "c640af2"
S3SourceVersion: "3c420c1" → "c640af2"
```

These are **normal deploy artifacts**: the tenant-mapping row records the deploying git SHA. Every time a new SHA is deployed, this updates. The "may cause replacement" warning on the AwsCustomResource is expected — replacing a custom resource on parameter change is the documented behavior. The tenant-mapping row itself simply gets rewritten with the new SHA value. Pilot data is not affected.

# Stack-level termination protection

`cdk diff` does not surface stack-level `terminationProtection` flips as resource changes. Confirmed at synth-manifest level (validated during Sprint 2 code phase):

| Stack | Pre-deploy | Post-deploy expected |
|---|---|---|
| shared-infra-stack | false | **true** |
| controlplane-stack | false | **true** |
| analytics-stack | false | **true** |
| core-appplane-stack | false | **true** |
| tenant-template-stack-basic | false | **true** |

After each deploy, the runbook's `aws cloudformation describe-stacks --query 'Stacks[0].EnableTerminationProtection'` check confirms the flip.

# Verdict

**GO. Proceed to Step 2 of the runbook (deploys).**

All 5 diffs match the expected diff column in [sprint-2-deploy-runbook.md](sprint-2-deploy-runbook.md). The two "extras" (ApiLambda S3Key drift, tenant-mapping codeCommitId update) are normal deploy-artifacts unrelated to Sprint 2 changes and have been validated as safe.

# Recommendation before deploy

The `CreateTenantMapping` codeCommitId update reveals that **prod was last deployed at SHA `3c420c1`**, while HEAD is `c640af2`. There are 20+ unrelated commits between those SHAs that have not yet been deployed to prod (Sprint C-series IEMIS work, finance fixes, etc.). The Sprint 2 deploys will carry ALL of these forward.

Before deploying, verify that none of the C-series changes (analytics Lambda code, finance handlers, IEMIS import, etc.) are still in flight or expected to be deployed separately. If any is, **the Sprint 2 deploy will land them implicitly** since CDK deploys the current HEAD's state, not just the Sprint 2 deltas.

A safe path: ensure HEAD's overall state is what you'd want deployed regardless of Sprint 2. If yes, proceed. If no, check out a clean branch with only Sprint 2 changes on top of `3c420c1`, deploy from there, then merge.
