---
title: Sprint 2 — Production Deploy Runbook (T2.4 / T2.5 / T2.6 / T2.7)
date: 2026-05-01
account: 257526644020 (ap-south-1, prod)
purpose: Step-by-step deploy of the Sprint 2 protection changes to production. Operator-driven. Each step is independently reviewable, independently revertible, and produces a deploy log.
---

# Pre-flight

- [ ] Sprint 1 + Sprint 2 code reviewed and committed to a feature branch.
- [ ] PR opened, CI green (`scripts/ci/test-cleanup-guard.sh` and `scripts/ci/assert-tenant-ddb-retain.sh` both pass).
- [ ] Snapshot doc reviewed: [snapshot-prod-pre-optimize-20260501.md](snapshot-prod-pre-optimize-20260501.md).
- [ ] Data-verification reviewed: [sprint-2-data-verification-20260501.md](sprint-2-data-verification-20260501.md).
- [ ] ReadOnlyAccess still attached to `edforge-prod-deployer` for the diff/verification steps below.

Verify your shell context before EVERY command:

```bash
echo "$AWS_PROFILE"                          # must echo: prod
aws sts get-caller-identity --profile prod   # Account: 257526644020
aws ec2 describe-availability-zones --profile prod \
  --query 'AvailabilityZones[0].RegionName' --output text   # ap-south-1
```

# Step 1 — `cdk diff` per stack (read-only; produces 5 review artifacts)

Run from `server/`. Each `cdk diff` is read-only against prod and writes a deploy log to `docs/deploys/`.

```bash
cd server
source .env.prod    # required: loads CDK_PARAM_* env vars

# Helper for log filename
_log() {
  printf "../docs/deploys/prod-cdk-diff-%s-%s-%s.log" "$1" "$(date +%Y%m%d-%H%M%S)" "$(git rev-parse --short HEAD)"
}

# 1.1 — shared-infra-stack
LOG=$(_log shared-infra-stack); AWS_PROFILE=prod CDK_NAG_ENABLED=false npx cdk diff shared-infra-stack 2>&1 | tee "$LOG"

# 1.2 — controlplane-stack
LOG=$(_log controlplane-stack); AWS_PROFILE=prod CDK_NAG_ENABLED=false npx cdk diff controlplane-stack 2>&1 | tee "$LOG"

# 1.3 — analytics-stack
LOG=$(_log analytics-stack); AWS_PROFILE=prod CDK_NAG_ENABLED=false npx cdk diff analytics-stack 2>&1 | tee "$LOG"

# 1.4 — core-appplane-stack
LOG=$(_log core-appplane-stack); AWS_PROFILE=prod CDK_NAG_ENABLED=false npx cdk diff core-appplane-stack 2>&1 | tee "$LOG"

# 1.5 — tenant-template-stack-basic
LOG=$(_log tenant-template-stack-basic); AWS_PROFILE=prod CDK_NAG_ENABLED=false npx cdk diff tenant-template-stack-basic 2>&1 | tee "$LOG"
```

## What to look for in each diff

| Stack | Expected diff | Red flags |
|---|---|---|
| **shared-infra-stack** | `EnableTerminationProtection: false → true` (stack metadata). `TenantMappingTable: DeletionProtectionEnabled: → true`. **Possibly more** because of the latent-bug fix in `super(scope, id, props)`. | Any unexpected resource churn (subnets, NATs, security groups, listeners). The fix should be a metadata-only change for env-binding; if CFN sees it as a stack move, **stop and investigate** before deploy. |
| **controlplane-stack** | `EnableTerminationProtection: false → true`. `CognitoAuthUserPool*: DeletionProtection: → ACTIVE` (via L1 escape hatch). | Any change to SBT-managed Lambda code or API Gateway routes. |
| **analytics-stack** | `EnableTerminationProtection: false → true`. `AnalyticsTable / LandingTable / UserSessionEventsTable: DeletionProtectionEnabled: → true` (3 tables). | Lambda code changes, EventBridge rule changes. |
| **core-appplane-stack** | `EnableTerminationProtection: false → true`. **Nothing else.** | Anything else is a red flag — this stack has no resource changes in Sprint 2. |
| **tenant-template-stack-basic** | `EnableTerminationProtection: false → true`. 3 DDB tables `DeletionProtectionEnabled: → true`. `basicUserPoolbasic: DeletionProtection: undefined → true`. | Any change to ECS task definitions, target groups, listener rules, security groups. |

If any diff shows unexpected resource changes, **stop and re-synthesize against UAT-account values to compare** (you can use the synth-simulation pattern from the validation phase: set `CDK_DEFAULT_ACCOUNT=715860911762` and rerun `cdk diff` — though there's no UAT environment any more, so the only point of comparison is the snapshot doc).

# Step 2 — Deploy in dependency order

Stacks must deploy in the order listed because of `addDependency()` declarations in `bin/ecs-saas-ref-template.ts`. Don't parallelize.

Each deploy uses the standard wrapper. **Do not** run `npx cdk deploy` directly.

```bash
# 2.1 — shared-infra-stack (enables TenantMappingTable + sets stack-level termination protection)
./scripts/deploy-analytics.sh shared-infra-stack prod

# 2.2 — controlplane-stack (system-admin Cognito pool deletionProtection via L1 hatch + stack term protection)
./scripts/deploy-analytics.sh controlplane-stack prod

# 2.3 — analytics-stack (3 analytics tables + stack term protection)
./scripts/deploy-analytics.sh analytics-stack prod

# 2.4 — core-appplane-stack (only stack-level termination protection; no resource changes expected)
./scripts/deploy-analytics.sh core-appplane-stack prod

# 2.5 — tenant-template-stack-basic (per-tenant DDB + Cognito + stack term protection)
./scripts/deploy-analytics.sh tenant-template-stack-basic prod
```

Each wrapper invocation:
- Tees output to `docs/deploys/prod-<stack>-<timestamp>-<gitsha>.log` (per CLAUDE.md convention).
- Sets `CDK_NAG_ENABLED=false` to prevent legacy nag warnings from blocking.
- Runs the service-info.json substitution preflight (catches wrong-region deploys).

Total deploy time: ~25–40 minutes total (each stack takes 3–10 min for in-place property changes).

# Step 3 — Post-deploy verification (per stack)

Run after each deploy completes. Each command should return the expected value; mismatch = stop and investigate.

## After 2.1 — shared-infra-stack

```bash
# Stack-level termination protection
aws cloudformation describe-stacks --stack-name shared-infra-stack --profile prod \
  --query 'Stacks[0].EnableTerminationProtection' --output text   # → true

# TenantMappingTable deletion protection
TABLE=$(aws dynamodb list-tables --profile prod --query 'TableNames[?starts_with(@, `shared-infra-stack-TenantMappingTable`)] | [0]' --output text)
aws dynamodb describe-table --table-name "$TABLE" --profile prod \
  --query 'Table.DeletionProtectionEnabled' --output text   # → True

# Negative test: try to delete the table → must fail
aws dynamodb delete-table --table-name "$TABLE" --profile prod 2>&1 | grep -q "ResourceInUseException\|protection" && echo "PASS: delete refused" || echo "FAIL"
```

## After 2.2 — controlplane-stack

```bash
aws cloudformation describe-stacks --stack-name controlplane-stack --profile prod \
  --query 'Stacks[0].EnableTerminationProtection' --output text   # → true

# System-admin Cognito pool deletion protection
aws cognito-idp describe-user-pool --user-pool-id ap-south-1_IvK2wLe27 --profile prod \
  --query 'UserPool.DeletionProtection' --output text   # → ACTIVE

# Negative test: try to delete the system-admin pool → must fail
aws cognito-idp delete-user-pool --user-pool-id ap-south-1_IvK2wLe27 --profile prod 2>&1 | \
  grep -q "DeletionProtectionException\|protection" && echo "PASS: delete refused" || echo "FAIL"
```

## After 2.3 — analytics-stack

```bash
aws cloudformation describe-stacks --stack-name analytics-stack --profile prod \
  --query 'Stacks[0].EnableTerminationProtection' --output text   # → true

# Three analytics tables, all DeletionProtectionEnabled=True
for T in edforge-analytics edforge-analytics-landing edforge-user-session-events; do
  V=$(aws dynamodb describe-table --table-name "$T" --profile prod --query 'Table.DeletionProtectionEnabled' --output text)
  echo "  $T: $V"   # → all three: True
done
```

## After 2.4 — core-appplane-stack

```bash
aws cloudformation describe-stacks --stack-name core-appplane-stack --profile prod \
  --query 'Stacks[0].EnableTerminationProtection' --output text   # → true
# No other resource verifications needed — this stack only flipped stack-level termination protection.
```

## After 2.5 — tenant-template-stack-basic

```bash
aws cloudformation describe-stacks --stack-name tenant-template-stack-basic --profile prod \
  --query 'Stacks[0].EnableTerminationProtection' --output text   # → true

# Three per-tenant tables
for T in edforge-identity-basic edforge-academics-basic edforge-finance-basic; do
  V=$(aws dynamodb describe-table --table-name "$T" --profile prod --query 'Table.DeletionProtectionEnabled' --output text)
  echo "  $T: $V"   # → all three: True
done

# Tenant Cognito pool deletion protection
aws cognito-idp describe-user-pool --user-pool-id ap-south-1_spYeNvNJt --profile prod \
  --query 'UserPool.DeletionProtection' --output text   # → ACTIVE

# Negative test: try to delete the tenant pool → must fail
aws cognito-idp delete-user-pool --user-pool-id ap-south-1_spYeNvNJt --profile prod 2>&1 | \
  grep -q "DeletionProtectionException\|protection" && echo "PASS: delete refused" || echo "FAIL"

# Negative test: try to delete a per-tenant table → must fail
aws dynamodb delete-table --table-name edforge-finance-basic --profile prod 2>&1 | \
  grep -q "ResourceInUseException\|protection" && echo "PASS: delete refused" || echo "FAIL"
```

# Step 4 — Smoke test the running pilot

After all 5 stacks deploy, run a representative end-to-end smoke against the prod API to confirm Sprint 2 changes did not regress live functionality. Property-only CFN changes should be no-op for runtime, but verify anyway.

```bash
cd /Users/shoaibrain/edforge
LOG="docs/deploys/prod-smoke-sprint2-$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD).log"
API_BASE_URL=https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod \
API_KEY=<prod-basic-tier-key> \
AWS_PROFILE=prod \
npx ts-node scripts/smoke-tests/nepal-school-e2e.ts 2>&1 | tee "$LOG"
```

Smoke must pass. If it fails:
- Auth issues → confirm Cognito tenant pool is still configured correctly (deletion protection should not affect auth flow, but verify).
- CFN-update-related issues → review the per-stack deploy logs for warnings.

# Step 5 — Detach ReadOnlyAccess (Sprint 2 cleanup)

Once Step 4 smoke is green, detach the broad read policy from the deployer user:

```bash
aws iam detach-user-policy \
  --user-name edforge-prod-deployer \
  --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess

aws iam list-attached-user-policies --user-name edforge-prod-deployer
# Expected: only the 4 EdForge*Policy attachments, no ReadOnlyAccess.
```

# Step 6 — Update PROJECT-LOG.md

Append a "Sprint 2 deploys complete" subsection under the existing `## Sprint 2` section in [PROJECT-LOG.md](PROJECT-LOG.md). Include:

- Timestamps + git SHA per stack deploy.
- Final state of all 5 verification queries above.
- Smoke-test pass/fail.
- Any deviation from the expected diffs in Step 1 (with explanation).

# Rollback (if needed)

Each Sprint 2 change is reversible by flipping the property back to `false` and redeploying:

| Issue | Rollback |
|---|---|
| Stack termination protection blocks a legitimate operation | Set `terminationProtection: false` for the affected stack in `bin/ecs-saas-ref-template.ts` (gate flipped or removed), redeploy. |
| DDB deletion protection blocks a legitimate operation | Set `deletionProtection: false` on the affected table, redeploy. Alternatively, use the AWS CLI `aws dynamodb update-table --table-name ... --no-deletion-protection-enabled` for an immediate one-off fix. |
| Cognito tenant-pool deletion protection blocks a legitimate operation | Set `deletionProtection: false` in `identity-provider.ts`, redeploy. CLI fix: `aws cognito-idp update-user-pool ... --deletion-protection INACTIVE`. |
| System-admin pool L1 hatch needs reverting | Delete the `cognito.CfnUserPool` block from `control-plane-stack.ts`, redeploy. CLI fix: same `update-user-pool ... --deletion-protection INACTIVE`. |
| `super(scope, id, props)` fix in `shared-infra-stack.ts` causes unexpected drift | Revert that one line. Strongly investigate why before reverting — it should be a no-op given env was already passed via the props object. |

If a deploy lands but the verification fails, NEVER `cdk destroy` the stack — `RemovalPolicy.RETAIN` and the new deletion protection layer would protect the data, but the operational blast radius is huge. Roll forward with a fix instead.
