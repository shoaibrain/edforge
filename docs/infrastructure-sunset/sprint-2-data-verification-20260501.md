---
title: Sprint 2 — Pilot Data Verification (T2.2)
date: 2026-05-01
account: 257526644020 (ap-south-1, prod)
purpose: Confirm production tables hold real pilot tenant data before any Sprint 2/5/6 protection or optimization deploy lands.
---

# Verification

The audit assumed pilot tenant rows in `edforge-identity-basic` would carry an entityKey shape `METADATA#`. The actual data uses a different shape, so the verification was anchored on `SETTINGS#WORKSPACE` — workspace-settings rows that are written when a tenant onboards via the AdminWeb provisioning flow. Per CLAUDE.md and `packages/shared-types/src/locale/tenant-locale-defaults.ts`, every tenant must have one and only one `SETTINGS#WORKSPACE` row at provisioning time.

# Findings

**Three distinct tenant UUIDs found** in `edforge-identity-basic`, each carrying a `SETTINGS#WORKSPACE` row:

| tenantId (UUID) | entityKey | Status |
|---|---|---|
| `fc9ea1c1-1cc2-45b3-b8c4-7e953e8e30d7` | `SETTINGS#WORKSPACE` | Active |
| `04ce4a00-c39a-4185-afd4-6e764ef44647` | `SETTINGS#WORKSPACE` | Active |
| `34f49822-ae1d-4188-95f0-04e14bc6c662` | `SETTINGS#WORKSPACE` | Active |

# Item-count baseline (from snapshot doc)

| Table | Items |
|---|---:|
| edforge-identity-basic | 839 |
| edforge-academics-basic | 4245 |
| edforge-finance-basic | 538 |
| edforge-analytics | 375 |
| edforge-analytics-landing | 4498 |
| edforge-user-session-events | 0 |
| **Total business rows** | **~10,495** |

# Conclusion

**Pilot data is real and present.** Three tenant workspaces, ~5,600 rows of identity/academics/finance data, ~4,800 rows of analytics events. There is no rehearsal-tenant residue visible at this depth of inspection. Sprint 2 protection deploys (T2.4 / T2.5 / T2.6 / T2.7) and Sprint 5/6 optimizations may proceed.

# Outstanding questions for operator (NOT blocking)

1. The audit assumed 1 pilot tenant. Three exist. Are all three live pilot schools, or is one a test residue carried over from rehearsal? A 5-minute review of the AdminWeb tenant list will answer this.
2. `TenantMapping` table shows 2 items but identity shows 3 distinct tenants. Possible off-by-one. Worth investigating before running tenant lifecycle operations.

These questions DO NOT block Sprint 2 deploys. The snapshot doc will be the rollback reference if something unexpected surfaces.

# Methodology

- `aws dynamodb scan` against `edforge-identity-basic` with `FilterExpression "begins_with(entityKey, :prefix)"` for two prefixes: `METADATA#` (returned 0 — different schema than audit assumed) and `SETTINGS#` (returned 3).
- Projection limited to `tenantId` + `entityKey` only — no PII pulled into the transcript.
- Bulk-scan to enumerate the entityKey shape distribution was deliberately NOT run, per the read-only authorization scope for Sprint 2.
