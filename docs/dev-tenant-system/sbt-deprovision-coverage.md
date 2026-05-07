---
title: SBT Deprovision Coverage — Gap Audit (Sprint 0, T0.3 + T0.5)
date: 2026-05-07
status: Audit complete; informs Sprint 5 design
---

# SBT Deprovision Coverage — Gap Audit

## Why this exists

Sprint 5 needs to safely deprovision a dev tenant. Before designing the CLI, we must know exactly what the existing SBT-managed `DeprovisioningScriptJob` already does — so the CLI doesn't duplicate work or, worse, fight with SBT.

This document is the static analysis. T0.4 will produce dynamic evidence by triggering the SBT job against a baseline tenant and observing actual end-state.

## Sources audited

- [server/lib/provision-scripts/deprovision-tenant.sh](../../server/lib/provision-scripts/deprovision-tenant.sh) — the script CodeBuild executes
- [server/lib/provision-scripts/provision-tenant.sh](../../server/lib/provision-scripts/provision-tenant.sh) — counterpart, to inventory what's created (so we know what needs cleanup)
- [server/lib/bootstrap-template/core-appplane-stack.ts:74-114](../../server/lib/bootstrap-template/core-appplane-stack.ts#L74-L114) — wiring of the SBT `DeprovisioningScriptJob` construct
- [server/lib/tenant-template/identity-provider.ts](../../server/lib/tenant-template/identity-provider.ts) — Cognito pool model

## Cognito model — clarification (T0.5)

**The earlier review note was wrong.** EdForge BASIC tier does NOT create a Cognito UserPool per tenant. The `IdentityProvider` construct ([identity-provider.ts:20](../../server/lib/tenant-template/identity-provider.ts#L20)) is instantiated **once per tier-stack**, and `tenant-template-stack-basic` is itself a single shared stack across all BASIC tenants.

Concretely, in BASIC:
- **One** `aws_cognito.UserPool` exists (the BASIC tenant pool) — created with `deletionProtection: isProdAccount()` ([identity-provider.ts:28](../../server/lib/tenant-template/identity-provider.ts#L28))
- **Per-tenant Cognito groups** scope users — each tenant has a group named `<tenantId>` inside the shared pool
- **Per-tenant users** carry a `custom:tenantId` attribute and live in their tenant's group

Implication for cleanup: the SBT deprovision script removes users from the tenant's group + deletes the group itself. **The pool is never destroyed during deprovisioning** (and shouldn't be — other tenants still use it).

This invalidates the earlier design assumption that the CLI would need to "delete the per-tenant pool." There is no per-tenant pool to delete.

## What SBT's `deprovision-tenant.sh` actually does (BASIC tier)

Walking the script line by line:

### 1. Tier guard (lines 26-29)
- V1 only supports `BASIC` tier deprovisioning
- ADVANCED / PREMIUM paths exist but are V1_DEFERRED
- Hard-fails on any other tier value

### 2. Cognito group + user cleanup (lines 131-145)
- Reads `TenantUserpoolId` from `tenant-template-stack-basic` CFN outputs
- Lists all users in the tenant's Cognito group (group name = tenantId)
- Calls `cognito-idp admin-delete-user` for each user
- Calls `cognito-idp delete-group` to remove the group itself
- **Pool is preserved** (correct — shared across tenants)

### 3. DDB row cleanup (lines 147-150)
- Calls `delete_items_if_exists` for THREE tables only:
  - `edforge-identity-basic`
  - `edforge-academics-basic`
  - `edforge-finance-basic`
- The function (lines 41-91) Queries the table by partition key = `tenantId` and `delete-item`s each returned row
- Uses table's KeySchema (HASH + RANGE) discovery via `describe-table` — handles tables with different sort-key shapes

### 4. Status output (lines 154-156)
- Sets `registrationStatus="Deleted"` for SBT to emit on the outgoing event

### What SBT does **NOT** do

The following resources/states are NOT touched by `deprovision-tenant.sh`:

| Resource | What it is | Why SBT misses it |
|---|---|---|
| **Per-tenant SNS topic** | Created by [provision-tenant.sh:235](../../server/lib/provision-scripts/provision-tenant.sh#L235) (`edforge-tenant-{tenantId}-alerts`); ARN stored on METADATA row as `alertTopicArn` | Not referenced in `deprovision-tenant.sh` at all |
| **Analytics table rows** | `EdForge-AnalyticsTable` — grade/attendance/finance analytics | Not in the `delete_items_if_exists` list |
| **Landing table rows** | `EdForge-AnalyticsLandingTable` — raw event landing zone | Not in the list |
| **User session events rows** | `EdForge-UserSessionEventsTable` — auth/session telemetry | Not in the list |
| **Tenant mapping registration row** | `shared-infra-stack-TenantMappingTable*` — SBT registration row keyed by tenantId | Not in the list (SBT may handle this elsewhere — TBD T0.4) |
| **CloudWatch log groups** | Per-tenant log groups (if any are created at runtime) | Retention is best-effort cleanup |
| **Cognito tombstone** | After delete-user, the `email` attribute may be tombstoned for re-use windows | Cognito-internal; not script-controllable |
| **Operator audit log retention** | Audit log entries for the deprovisioned tenant | Should be RETAINED (forensics window) — Sprint 5 T5.8 will define TTL |

## Gap matrix (drives Sprint 5 task list)

| Resource | SBT covers? | Sprint 5 gap-fill task |
|---|---|---|
| Cognito users (in tenant group) | ✅ Yes | — (verifier only) |
| Cognito group | ✅ Yes | — (verifier only) |
| Cognito pool | n/a (shared, preserve) | — |
| identity-basic DDB rows | ✅ Yes | — (verifier only) |
| academics-basic DDB rows | ✅ Yes | — (verifier only) |
| finance-basic DDB rows | ✅ Yes | — (verifier only) |
| AnalyticsTable rows | ❌ No | T5.5 (analytics-cleanup) |
| LandingTable rows | ❌ No | T5.5 (analytics-cleanup) |
| UserSessionEventsTable rows | ❌ No | T5.5 (analytics-cleanup) |
| Per-tenant SNS topic | ❌ No | T5.6 (sns-cleanup) |
| Tenant mapping registration row | ❓ Unknown — verify T0.4 | T5.7 (mapping verifier or deleter) |
| Audit log retention | n/a (retain) | T5.8 (TTL policy) |

## Side notes for Sprint 5 design

1. **The deprovision script runs as CodeBuild with `actions: ['*']` permissions** ([core-appplane-stack.ts:78-83](../../server/lib/bootstrap-template/core-appplane-stack.ts#L78)). This is overpowered but pragmatic; the CLI gap-filler can use a more constrained role since it only needs DDB delete + SNS delete on specific tenant-scoped resources.

2. **SBT alarm exists for deprovision failure** ([core-appplane-stack.ts:163-174](../../server/lib/bootstrap-template/core-appplane-stack.ts#L163)). It fires on `deprovisioningScriptJob.codebuildProject.metricFailedBuilds`. **However**, this only catches CodeBuild *infrastructure* failures, not "the script ran to completion but left orphan rows." Sprint 5's `verify-cleanup.sh` is the only gate that catches that case — and that's the whole point of the verifier model.

3. **The `delete_items_if_exists` function uses Query (not Scan)** keyed on partition key = tenantId. This means it won't catch any rows whose PK doesn't begin with `tenantId` exactly. The DDB single-table design uses `tenantId` as the literal PK, so this should be correct, but Sprint 5's `--strict` mode (T5.2) should run a full Scan with FilterExpression to catch malformed PKs as orphans. Defense in depth.

4. **No retry logic in the script**. A transient `delete-item` failure will cause the script to abort mid-deprovision. Sprint 5's CLI orchestrator (T5.11) makes deprovision idempotent — re-running it is safe and completes cleanup left behind.

## Open questions for T0.4 (live evidence)

These cannot be answered by static analysis; T0.4 will trigger the SBT job and inspect end-state:

1. Does SBT clean up the tenant-mapping registration row, or does it linger? (Affects T5.7 scope.)
2. Does the per-tenant SNS topic created in provisioning still exist after deprovision? (Confirms T5.6 is needed.)
3. After deprovision, does re-provisioning the same tenantId succeed, or does Cognito email-tombstone collide?
4. What's the wall-clock time of a typical BASIC tier deprovision? (Sets the timeout in T5.11.)
