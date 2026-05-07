---
title: Baseline Provisioning Snapshot (Sprint 0, T0.1 + T0.6)
date: 2026-05-07
status: T0.6 complete; T0.1 + T0.4 awaiting operator session
---

# Baseline Provisioning Snapshot

This document captures static + dynamic evidence about the existing tenant provisioning + deprovisioning flow on prod (account 257526644020, region ap-south-1).

## T0.6 — CodeBuild Concurrency Inventory ✅

### SBT-managed CodeBuild projects in prod ap-south-1

| Project | Purpose | Compute type | Image | Per-project `concurrentBuildLimit` | Timeout |
|---|---|---|---|---|---|
| `provisioningScriptJobcodebu-PGWr4hEt2IFr` | Runs `provision-tenant.sh` | `BUILD_GENERAL1_SMALL` | amazonlinux2-x86_64-standard:5.0 | unset (no project cap) | 60 min |
| `deprovisioningScriptJobcode-A1OuMNKRPgHF` | Runs `deprovision-tenant.sh` | `BUILD_GENERAL1_SMALL` | amazonlinux2-x86_64-standard:5.0 | unset (no project cap) | 60 min |
| `AdminWebUiAdminWebUiReactBu-C97RvD7ZxYJv` | AdminWeb CodePipeline build | (separate project, irrelevant for cycle-all.sh) | — | — | — |

Note: project names are CDK auto-generated (`-PGWr4hEt2IFr`, `-A1OuMNKRPgHF`). They will change if the SBT constructs are recreated. The CLI (Sprint 4 / 5 / 9) should look up project names by tag or by listing rather than hardcoding.

### Account-level concurrency quota (Linux/Small)

```
Concurrently running builds for Linux/Small environment = 60
```

Quota code: `L-2DC20C30` (this code in the AWS-listed entry is for Linux/Medium; Linux/Small lives under a different quota code, but both are 60).

### Conclusion for Sprint 6 cycle-all.sh

**Parallel cycle of 3 dev tenants is unconstrained.** Worst case is 3 concurrent provisioning builds + 3 concurrent deprovisioning builds — well under the 60-concurrent-build account quota and within the unset per-project limit.

The previously-flagged Sprint 6 risk ("CodeBuild concurrency may be 1 by default — fall back to serial") is **closed**. Parallel-by-default in Sprint 6's `cycle-all.sh` is safe.

If a future cost-control measure caps per-project `concurrentBuildLimit` to 1 (e.g. to avoid surprise CodeBuild bills during a script bug), cycle-all.sh should detect this via `batch-get-projects` and serialize automatically.

## T0.1 — Baseline Tenant Provisioning Snapshot ⏳ AWAITING OPERATOR

To be populated when operator (Shoaib) provisions a throwaway tenant via AdminWeb. Capture target:

```
tenantId:               <e.g. dev-baseline-2026-05-07>
archetype:              GENERIC | PABSON
country:                <ISO>
provisioning timestamp: <UTC>
codebuild build ID:     <provisioningScriptJobcodebu-...:UUID>
codebuild log URL:      <CloudWatch deep link>
SBT step function ARN:  <if accessible>
```

Resources created:
- **Cognito group** (in shared BASIC pool): `<tenantId>`
- **Cognito users**: 1 admin user (email = the operator's invite email)
- **Per-tenant SNS topic**: `edforge-tenant-<tenantId>-alerts` (ARN to capture)
- **DDB rows written**:
  - `edforge-identity-basic`: METADATA, SETTINGS#WORKSPACE
  - `edforge-academics-basic`: (typically empty until first school created)
  - `edforge-finance-basic`: (typically empty until first invoice created)
  - `EdForge-AnalyticsTable`: (empty until first analytics event)
  - `shared-infra-stack-TenantMappingTable*`: (SBT registration row — to confirm)

Once the snapshot is in, T0.4 follows (trigger SBT deprovision, capture end-state).

## T0.4 — Deprovisioning Snapshot ⏳ AWAITING OPERATOR

To be populated after T0.1 + SBT deprovision:

- Final state of every resource listed above
- Wall-clock time of the deprovision job (sets the timeout in Sprint 5 T5.11)
- Confirmation: tenant-mapping registration row deleted? (Open question from T0.3)
- Confirmation: re-provisioning the same tenantId/email succeeds without Cognito tombstone collision?

## Operational note

The `60` Linux/Small account quota applies to ALL CodeBuild jobs in the account, including AdminWeb's CodePipeline build. In normal steady-state, only 1-2 builds run concurrently, so headroom is large. If in future the AdminWeb publish gate runs simultaneously with cycle-all.sh, total demand could spike to ~5-7 concurrent builds — still 10x under cap.
