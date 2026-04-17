# V1 Basic-Only MVP: Park Advanced/Premium Tier for Future Release

## Context

EdForge is a next-generation EMIS platform forked from the [AWS SBT-AWS ECS SaaS Reference Architecture](https://github.com/aws-samples/saas-reference-architecture-ecs). The reference architecture supports 3 tiers (Basic, Advanced, Premium) with different isolation models.

**V1 MVP Decision:** Ship only the Basic tier. Advanced and Premium tiers are **parked** (not deleted) for future release. All multi-tier code is preserved with clear architectural comments explaining the V1 decision and what's needed to re-enable each tier.

### Why This Test Tenant Failed (for the record)
The Advanced tier tenant "testadvanced" (tenantId: `690b13a8-29c7-49bb-a4e4-2791c67d8ebc`) failed due to:
1. CDK Nag errors blocked the per-tenant stack deployment (`Found errors` in CodeBuild logs)
2. SBT masked the failure as success (ISSUE-008) — script continued with empty outputs
3. Cognito user creation failed (empty UserPoolId — `ParamValidation: UserPoolId length=0`)
4. TenantSeeder tried to write to `edforge-identity-advanced` but that table doesn't exist — Advanced creates `edforge-identity-testadvanced` per tenant (table naming mismatch between seeder hardcode and CDK naming)
5. Result: tenant registered in SBT tables as "Created" but zero infrastructure provisioned, no user created, no metadata seeded

### Design Philosophy
- **Comment out, don't delete** — preserve multi-tier architecture for future enablement
- **Add `V1_DEFERRED:` comment blocks** explaining the architectural decision and re-enablement path
- **No changes to deployed infrastructure** — `shared-infra-stack`, `tenant-template-stack-basic` remain untouched
- **No changes to core SBT framework integration** — ControlPlane, EventBridge, Step Functions remain as-is
- **Guard rails only** — add validation to prevent non-BASIC tier requests from reaching broken code paths

---

## Sprint 1: Guard Rails + UI Lock (Block Non-Basic Creation)

**Goal:** Prevent non-BASIC tenant creation at UI and script level. All multi-tier code stays intact but is bypassed.
**Demo:** Admin opens TenantCreate → sees only BASIC tier selectable. Non-BASIC API calls are rejected early.
**Rollback:** Revert commits. All changes are additive guards and UI restrictions.

### Task 1.1: Lock TenantCreate default tier to BASIC
**File:** `client/AdminWeb/src/pages/Tenants/TenantCreate.tsx`
- Change line 56: `tier: "ADVANCED"` → `tier: "BASIC"`
- Add comment above: `// V1_DEFERRED: Default was "ADVANCED". Restore when Advanced tier provisioning is production-ready.`
- **Validation:** Run AdminWeb locally, confirm form defaults to BASIC.

### Task 1.2: Disable Advanced/Premium tier cards in TenantCreate
**File:** `client/AdminWeb/src/pages/Tenants/TenantCreate.tsx`
- In the tier selection Grid (lines 343-376), add a `disabled` state and visual indicator for ADVANCED and PREMIUM cards
- Show a "Coming Soon" badge on Advanced/Premium cards instead of hiding them entirely (preserves the product vision in the UI)
- Prevent `handleChange("tier")` from accepting non-BASIC values
- Add comment block:
  ```tsx
  {/* V1_DEFERRED: Advanced and Premium tier selection disabled for MVP.
      To re-enable:
      1. Fix CDK Nag errors in tenant-template-stack for silo deployment
      2. Fix table naming mismatch in TenantSeeder Lambda (hardcoded vs per-tenant table names)
      3. Resolve SBT ISSUE-008 (Step Functions masking CodeBuild failures)
      4. Re-enable these cards by removing the disabled prop */}
  ```
- **Validation:** UI shows all 3 tier cards, but only BASIC is clickable. Advanced/Premium show "Coming Soon".

### Task 1.3: Disable Advanced/Premium config switches in TenantCreate
**File:** `client/AdminWeb/src/pages/Tenants/TenantCreate.tsx`
- Disable the Federation, EC2, and Reverse Proxy switches entirely for V1 (they are all Advanced/Premium features)
- Add comment:
  ```tsx
  {/* V1_DEFERRED: Configuration switches (Federation, EC2, Reverse Proxy) are
      Advanced/Premium-only features. Hardcoded to safe defaults for Basic tier:
      useFederation=false, useEc2=false, useRProxy=true.
      To re-enable: Remove disabled prop when Advanced/Premium tiers are supported. */}
  ```
- Hardcode in submit payload: `useFederation: "false"`, `useEc2: "false"`, `useRProxy: "true"`
- **Validation:** All config switches are visually disabled with explanatory text. Submit payload has hardcoded values.

### Task 1.4: Add V1 comment to pricing constants
**File:** `client/AdminWeb/src/constants/pricing.ts`
- Keep all 3 tier definitions intact
- Add a comment block at the top:
  ```typescript
  /**
   * V1_DEFERRED: All three pricing tiers are defined here for future use.
   * V1 MVP only supports BASIC tier. Advanced and Premium are displayed as
   * "Coming Soon" in the TenantCreate form but cannot be selected.
   *
   * To re-enable Advanced/Premium:
   * 1. Fix provisioning pipeline (see provision-tenant.sh V1_DEFERRED comments)
   * 2. Fix TenantSeeder table naming (see tenant-seeder-lambda.ts V1_DEFERRED comments)
   * 3. Remove "Coming Soon" gates in TenantCreate.tsx
   */
  ```
- **Validation:** `npm run build` succeeds. Pricing constants unchanged.

### Task 1.5: Add tier guard in provision-tenant.sh
**File:** `server/lib/provision-scripts/provision-tenant.sh`
- After line 46 (`export COUNTRY="${country:-}"`), add:
  ```bash
  # ============================================
  # V1_DEFERRED: Only BASIC tier is supported in V1 MVP.
  # Advanced and Premium tier provisioning code is preserved below but bypassed.
  # The Advanced/Premium code paths have known issues:
  #   1. CDK Nag errors block per-tenant stack deployment
  #   2. Table naming mismatch: TenantSeeder expects edforge-identity-advanced
  #      but CDK creates edforge-identity-{tenantName} per tenant
  #   3. SBT ISSUE-008: Step Functions mask CodeBuild failures as success
  #
  # To re-enable Advanced/Premium provisioning:
  #   1. Fix CDK Nag suppressions in tenant-template-nag.ts for actual service names
  #   2. Fix TenantSeeder Lambda to dynamically resolve table names per tenant
  #   3. Add error handling for cdk deploy failures (set -e not catching CDK Nag exit)
  #   4. Remove this guard
  # ============================================
  if [[ $TIER != "BASIC" ]]; then
    echo "ERROR: V1 only supports BASIC tier. Received tier: $TIER"
    echo "Advanced and Premium tiers are deferred to a future release."
    exit 1
  fi
  ```
- **DO NOT modify** the existing PREMIUM/ADVANCED `if` block (lines 66-119) — leave it intact as reference architecture
- **Validation:** Read script. Guard is before CDK deploy branch. All existing code below is preserved.

### Task 1.6: Add tier guard in TenantSeeder Lambda
**File:** `server/lib/bootstrap-template/tenant-seeder-lambda.ts`
- In inline Lambda code, after `const tierUpper = tier.toUpperCase();` (line ~258), add:
  ```javascript
  // V1_DEFERRED: Only BASIC tier is supported in V1 MVP.
  // Advanced/Premium table routing is preserved below but has a known bug:
  // The IDENTITY_TABLE_ADVANCED env var points to 'edforge-identity-advanced'
  // but CDK creates per-tenant tables like 'edforge-identity-{tenantName}'.
  // To enable Advanced/Premium, fix table name resolution to be dynamic per tenant.
  if (tierUpper !== 'BASIC') {
    console.warn(\`V1_DEFERRED: Only BASIC tier supported. Received: \${tierUpper}. Skipping seed.\`);
    console.warn('To enable Advanced/Premium, fix table name resolution in this Lambda and CDK.');
    return { statusCode: 200, body: JSON.stringify({ message: 'V1: non-BASIC tier skipped', tier: tierUpper }) };
  }
  ```
- **DO NOT modify** the `IDENTITY_TABLE_PREMIUM`, `IDENTITY_TABLE_ADVANCED` env vars or IAM policies — they document the intended architecture
- **Validation:** Read inline code. Guard is before DynamoDB PutItem. All existing env vars and IAM preserved.

### Task 1.7: Deploy controlplane-stack
- Deploy `controlplane-stack` to activate the TenantSeeder Lambda guard (Task 1.6)
- **Pre-check:** No provisioning jobs in-flight (check Step Functions console)
- **Validation:** Verify Lambda code version in AWS Console. Existing Basic tenants unaffected.

---

## Sprint 2: Annotate Architecture + Deploy Script Guards

**Goal:** Add architectural decision comments throughout the codebase. Deploy provisioning script guard. Annotate deprovision script.
**Demo:** Provisioning script rejects non-BASIC tier requests. All multi-tier code is documented with re-enablement instructions.
**Rollback:** Revert commits. Redeploy `core-appplane-stack` from previous commit.

### Task 2.1: Add tier guard in deprovision-tenant.sh
**File:** `server/lib/provision-scripts/deprovision-tenant.sh`
- After the tier variable assignment, add:
  ```bash
  # V1_DEFERRED: Only BASIC tier deprovisioning is supported in V1 MVP.
  # Advanced/Premium deprovisioning (cdk destroy of per-tenant stacks) is preserved below.
  # To re-enable: Remove this guard and test per-tenant stack destruction end-to-end.
  if [[ $TIER != "BASIC" ]]; then
    echo "ERROR: V1 only supports BASIC tier deprovisioning. Received tier: $TIER"
    exit 1
  fi
  ```
- **DO NOT modify** the existing PREMIUM/ADVANCED `if` block — leave it as reference architecture
- **Validation:** Read script. Guard is before CDK destroy branch. All existing code preserved.

### Task 2.2: Annotate CDK entry point (ecs-saas-ref-template.ts)
**File:** `server/bin/ecs-saas-ref-template.ts`
- Add comment block before `advancedTierTempStack` (line 108):
  ```typescript
  /**
   * V1_DEFERRED: Advanced Tier Template Stack
   *
   * This stack creates the Advanced tier infrastructure template. It is part of the
   * original SBT-AWS ECS SaaS reference architecture multi-tier design.
   *
   * In V1 MVP, only the Basic tier (tenant-template-stack-basic) is actively used.
   * This Advanced template stack is synthesized by CDK but should NOT be deployed
   * independently — it serves as the template for per-tenant Advanced stacks
   * created by provision-tenant.sh during Advanced tier onboarding.
   *
   * Known issues to fix before enabling:
   * 1. CDK Nag suppressions reference legacy service names (orders, products, users)
   *    instead of EdForge services (identity, academics, finance)
   * 2. Advanced cluster reference assumes cluster already exists (ACTIVE mode)
   * 3. Table naming mismatch with TenantSeeder Lambda
   *
   * To re-enable Advanced tier:
   * 1. Fix CDK Nag in tenant-template-nag.ts for EdForge service names
   * 2. Fix TenantSeeder to resolve table names dynamically per tenant
   * 3. Test cdk deploy of a per-tenant Advanced stack end-to-end
   * 4. Remove tier guard in provision-tenant.sh
   */
  ```
- **DO NOT remove** the `advancedTierTempStack` — it documents the multi-tier architecture
- **Validation:** `cdk synth` still produces all stacks including the advanced template.

### Task 2.3: Annotate TenantTemplateStack branching
**File:** `server/lib/tenant-template/tenant-template-stack.ts`
- Add comment block before the Advanced cluster `if` branch (line 94):
  ```typescript
  // V1_DEFERRED: Advanced tier cluster sharing
  // When tier=ADVANCED and advancedCluster=ACTIVE, the stack references an existing
  // shared Advanced cluster instead of creating a new one. This enables cost-efficient
  // multi-tenant isolation for the Advanced tier.
  //
  // In V1 MVP, only BASIC tier is deployed (advancedCluster always INACTIVE),
  // so this branch is never executed. The EcsCluster construct (else branch)
  // creates the shared prod-basic cluster.
  //
  // To re-enable: Ensure the Advanced cluster exists before deploying Advanced tenants.
  // The cluster name pattern is: prod-advanced-{accountId}
  ```
- Add comment before `shouldDeployServices` (line 91):
  ```typescript
  // V1_DEFERRED: shouldDeployServices is always true for BASIC tier.
  // For ADVANCED with INACTIVE cluster, services are skipped (cluster-only stack).
  // This pattern supports a two-phase Advanced deployment:
  //   Phase 1: Deploy cluster only (INACTIVE)
  //   Phase 2: Deploy services into existing cluster (ACTIVE)
  ```
- **Validation:** `cdk synth tenant-template-stack-basic` output unchanged.

### Task 2.4: Annotate seed-existing-tenant.sh
**File:** `server/lib/provision-scripts/seed-existing-tenant.sh`
- Add comment block before the tier-specific feature definitions:
  ```bash
  # V1_DEFERRED: Feature tiers for Advanced and Premium are defined below
  # but only BASIC features are used in V1 MVP.
  # The feature limits per tier are:
  #   BASIC: 1 school, 50 users, 500 students, no finance/analytics
  #   PREMIUM: 5 schools, 200 users, 2000 students, all features
  #   ADVANCED: 100 schools, 1000 users, 10000 students, all features
  # To re-enable: Remove tier guard in provision-tenant.sh
  ```
- **Validation:** Script unchanged functionally.

### Task 2.5: Annotate service-info files
**Files:** `server/service-info.txt` AND `server/lib/service-info.json`
- Add a `_v1_note` field to the JSON root:
  ```json
  "_v1_note": "V1 MVP: All 3 services (identity, academics, finance) are deployed for Basic tier. Finance is functionally dormant in V1 but retained to avoid CloudFormation resource deletion on redeployment. Advanced/Premium tiers use <TIER> placeholder which gets replaced with tenantName during CDK synthesis."
  ```
- **Validation:** Valid JSON after edit. No functional changes.

### Task 2.6: Deploy core-appplane-stack
- Deploy `core-appplane-stack` to activate the provisioning and deprovisioning script guards
- **Pre-check:** No provisioning jobs in-flight
- **Deploy order:** `controlplane-stack` was already deployed in Sprint 1 (Task 1.7)
- **Validation:**
  1. Create a BASIC tenant from AdminWeb — succeeds end-to-end
  2. Verify existing Basic tenants can still log in (regression)
  3. If possible, attempt non-BASIC creation via API — fails with clear error

---

## Sprint 3: CDK Nag Fix + Dashboard Polish

**Goal:** Fix the long-standing CDK Nag suppression mismatch (legacy service names from AWS SaaS reference). Polish Dashboard to clarify V1 scope.
**Demo:** `CDK_NAG_ENABLED=true cdk synth` passes cleanly. Dashboard shows "Basic" tier as active and Advanced/Premium as "Coming Soon".
**Rollback:** Nag changes are synthesis-time only. Dashboard changes are UI-only.

### Task 3.1: Fix TenantTemplateNag service name suppressions
**File:** `server/lib/cdknag/tenant-template-nag.ts`
- Replace ALL legacy SaaS reference service name paths with EdForge service names:
  - `orders-EcsServices/*` → remove (no orders service in EdForge)
  - `products-EcsServices/*` → remove (no products service in EdForge)
  - `users-EcsServices/*` → `identity-EcsServices/*`
  - `orders-ecsTaskRole/*` → remove
  - `products-ecsTaskRole/*` → remove
  - `users-ecsTaskRole/*` → `identity-ecsTaskRole/*`
  - Add suppression blocks for `academics-EcsServices/*`, `academics-ecsTaskRole/*`
  - Add suppression blocks for `finance-EcsServices/*`, `finance-ecsTaskRole/*`
- Add comment at the top:
  ```typescript
  /**
   * CDK Nag Suppressions for EdForge ECS Services
   *
   * IMPORTANT: This file was originally forked from the AWS SBT-AWS ECS SaaS
   * Reference Architecture which had 'orders', 'products', and 'users' services.
   * EdForge uses 'identity', 'academics', and 'finance' services.
   *
   * V1_DEFERRED: Finance service is deployed but functionally dormant in V1.
   * All three services need Nag suppressions to pass CDK synthesis.
   */
  ```
- **Validation:** `CDK_NAG_ENABLED=true npx cdk synth tenant-template-stack-basic` — zero Nag errors.

### Task 3.2: Update Dashboard tier display for V1
**File:** `client/AdminWeb/src/pages/Dashboard/Dashboard.tsx`
- Keep Advanced and Premium tier counts in the stats
- Add a visual indicator (grey out or "Coming Soon" label) next to Advanced and Premium chips
- Add comment:
  ```tsx
  {/* V1_DEFERRED: Advanced/Premium tier stats shown for architecture completeness.
      These will always show 0 in V1 MVP since only Basic tier is supported.
      To re-enable: Remove "Coming Soon" labels when tiers are production-ready. */}
  ```
- **Validation:** Dashboard shows tier distribution with Basic active and Advanced/Premium greyed out.

### Task 3.3: Add V1 comment to .env file
**File:** `server/.env`
- Add comment block at the top:
  ```bash
  # ============================================
  # V1 MVP: Only BASIC tier is supported.
  # Advanced/Premium tier env vars below are preserved for future use.
  # CDK_PARAM_USE_EC2_ADVANCED and CDK_ADV_CLUSTER are not actively used in V1.
  #
  # To re-enable Advanced/Premium:
  # 1. Remove tier guards in provision-tenant.sh and deprovision-tenant.sh
  # 2. Fix CDK Nag suppressions for EdForge service names
  # 3. Fix TenantSeeder table naming (see tenant-seeder-lambda.ts)
  # 4. Test end-to-end Advanced tier provisioning
  # ============================================
  ```
- **DO NOT remove** `CDK_PARAM_USE_EC2_ADVANCED` or `CDK_ADV_CLUSTER` — they document the intended configuration
- **Validation:** `cdk synth` with existing .env produces correct output.

---

## Sprint 4: Cleanup + End-to-End Validation

**Goal:** Clean up orphaned test tenant data. Full E2E validation of Basic tier provisioning. Negative test for non-BASIC rejection.
**Demo:** New Basic tenant provisioned end-to-end successfully. Orphaned "testadvanced" data cleaned up. Non-BASIC tier requests rejected cleanly with helpful error messages.

### Task 4.1: Clean up orphaned "testadvanced" tenant data
- Delete `testadvanced` tenant record from SBT DynamoDB tables:
  - `controlplane-stack-...-TenantDetails-...` (tenantId: `690b13a8-29c7-49bb-a4e4-2791c67d8ebc`)
  - `controlplane-stack-...-TenantRegistrationTable-...` (registrationId: `159ad5d4-7e73-46d0-ab0f-eec02d7cef62`)
- Verify in CloudFormation: `tenant-template-stack-690b13a8-29c7-49bb-a4e4-2791c67d8ebc` does NOT exist (it was never created)
- **Validation:** AdminWeb tenant list no longer shows "testadvanced".

### Task 4.2: End-to-end Basic tier provisioning test
**Test steps:**
1. From AdminWeb, create a new BASIC tenant (e.g., "pilotschool", country: NPL)
2. Verify in CloudWatch Logs:
   - CodeBuild: `provision-tenant.sh` runs, skips CDK deploy branch (tier guard)
   - CodeBuild: Cognito `admin-create-user` succeeds with valid UserPoolId from `tenant-template-stack-basic`
   - TenantSeeder: writes METADATA + SETTINGS#WORKSPACE to `edforge-identity-basic`
3. Verify tenant admin email receives "Welcome to EdForge" email
4. Verify tenant appears in AdminWeb with status "Created", tier "BASIC"
5. **Verify tenant admin can log in** to the tenant application via Cognito
6. Test deprovisioning: delete the test tenant, verify Cognito + DynamoDB cleanup
7. **Verify existing Basic tenants can still log in** (regression check)

### Task 4.3: Negative test — non-BASIC tier rejection
- Use `aws` CLI or curl to call SBT control plane API directly with `tier: "ADVANCED"`
- Verify CodeBuild fails with "V1 only supports BASIC tier" message
- Verify CloudWatch alarm fires (already configured in core-appplane-stack)
- Verify TenantSeeder Lambda logs show "V1_DEFERRED: Only BASIC tier supported"
- **Validation:** Clear error messages at both provisioning script and TenantSeeder levels.

### Task 4.4: Write V1 architecture decision record
- Create `docs/adr/001-v1-basic-only-tier.md` documenting:
  - Decision: V1 ships Basic tier only
  - Context: Advanced/Premium provisioning has known issues (CDK Nag, table naming, SBT ISSUE-008)
  - Consequences: Multi-tier code preserved with `V1_DEFERRED` comments throughout codebase
  - Re-enablement checklist (consolidated from all `V1_DEFERRED` comments):
    1. Fix CDK Nag suppressions in `tenant-template-nag.ts` for EdForge service names
    2. Fix TenantSeeder Lambda to resolve table names dynamically per tenant (not hardcoded per tier)
    3. Add proper error handling for `cdk deploy` failures in `provision-tenant.sh`
    4. Address SBT ISSUE-008 (Step Functions masking CodeBuild failures)
    5. Test end-to-end Advanced tier provisioning with a real tenant
    6. Test end-to-end Premium tier provisioning with EC2 cluster option
    7. Remove tier guards in `provision-tenant.sh`, `deprovision-tenant.sh`, and TenantSeeder Lambda
    8. Re-enable tier selection in AdminWeb `TenantCreate.tsx`
- **Validation:** Document exists and is comprehensive.

---

## Deployment Order

| Order | Action | When | Pre-check |
|-------|--------|------|-----------|
| 1 | AdminWeb rebuild + deploy | Sprint 1 complete | None — UI only |
| 2 | `cdk deploy controlplane-stack` | Sprint 1 (Task 1.7) | No in-flight provisioning jobs |
| 3 | `cdk deploy core-appplane-stack` | Sprint 2 (Task 2.6) | No in-flight provisioning jobs |
| 4 | No CDK deploy needed | Sprint 3 | `cdk synth` + `cdk diff` verification only |
| 5 | No CDK deploy needed | Sprint 4 | E2E test only |

**NOT deployed:** `shared-infra-stack` and `tenant-template-stack-basic` — zero changes, zero risk to existing Basic tier infrastructure.

---

## Files Changed (Comment/Annotate, NOT Delete)

| File | Sprint | Change Type |
|------|--------|-------------|
| `client/AdminWeb/src/pages/Tenants/TenantCreate.tsx` | 1 | Default to BASIC, disable (not hide) Advanced/Premium cards + config switches |
| `client/AdminWeb/src/constants/pricing.ts` | 1 | Add V1_DEFERRED comment block (definitions preserved) |
| `server/lib/provision-scripts/provision-tenant.sh` | 1 | Add tier guard BEFORE existing code (all code preserved) |
| `server/lib/bootstrap-template/tenant-seeder-lambda.ts` | 1 | Add tier guard BEFORE existing code (all code preserved) |
| `server/lib/provision-scripts/deprovision-tenant.sh` | 2 | Add tier guard BEFORE existing code (all code preserved) |
| `server/bin/ecs-saas-ref-template.ts` | 2 | Add V1_DEFERRED comment block (all code preserved) |
| `server/lib/tenant-template/tenant-template-stack.ts` | 2 | Add V1_DEFERRED comment blocks (all code preserved) |
| `server/lib/provision-scripts/seed-existing-tenant.sh` | 2 | Add V1_DEFERRED comment block (all code preserved) |
| `server/service-info.txt` + `server/lib/service-info.json` | 2 | Add `_v1_note` field (all services preserved) |
| `server/lib/cdknag/tenant-template-nag.ts` | 3 | Fix legacy service name suppressions (bug fix from SaaS reference fork) |
| `client/AdminWeb/src/pages/Dashboard/Dashboard.tsx` | 3 | Grey out Advanced/Premium tier stats with "Coming Soon" |
| `server/.env` | 3 | Add V1 comment block (all values preserved) |
| `docs/adr/001-v1-basic-only-tier.md` | 4 | New architecture decision record |

## Files Intentionally NOT Changed
These files reference Advanced/Premium but are safe and correct as-is:
- `server/lib/shared-infra/shared-infra-stack.ts` — API keys for all tiers preserved (already deployed)
- `server/lib/shared-infra/api-gateway.ts` — passes all tier API keys to authorizer
- `server/lib/shared-infra/Resources/tenant_authorizer.py` — handles all tiers gracefully
- `server/lib/shared-infra/layers/utils.py` — TenantTier enum with all 3 tiers
- `client/AdminWeb/src/pages/Tenants/TenantDetail.tsx` — displays any tier correctly
- `client/AdminWeb/src/pages/Tenants/TenantList.tsx` — displays tier badges for any tier
- `client/AdminWeb/src/models/tenant.ts` — data model supports all tiers
- `client/AdminWeb/src/services/tenantService.ts` — service layer unchanged
- `client/AdminWeb/src/hooks/useDashboardStats.ts` — counts all tiers (stats logic preserved)
- `server/lib/tenant-template/ecs-cluster.ts` — Advanced cluster naming preserved
- `server/lib/tenant-template/identity-provider.ts` — works for all tiers
- `server/lib/bootstrap-template/core-appplane-stack.ts` — provisioning job config preserved
- `server/lib/bootstrap-template/control-plane-stack.ts` — SBT ControlPlane unchanged
