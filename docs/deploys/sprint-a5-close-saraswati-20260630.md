# Sprint A.5 close — Saraswati pilot tenant backfill (2026-06-30)

Operational close-out for the second leg of the A.5 grade-snapshot backfill: the **real pilot tenant** (Shree Saraswati Secondary English Boarding School, tenantId `34f49822-ae1d-4188-95f0-04e14bc6c662`). Companion to [`sprint-a5-close-dev-pabson-20260630.md`](sprint-a5-close-dev-pabson-20260630.md) which closed the internal-dev leg earlier the same day.

## TL;DR

**26/26 rows backfilled cleanly in 8.2s.** Zero unresolved, zero skipped, zero errors. Closes Sprint A.5 — issue [#343](https://github.com/shoaibrain/edforge/issues/343) (the spike that gated the Saraswati run on a careful pre-check) can also be closed; the recon proved the data was a tiny, well-formed scope (24 invoices + 2 payments) and the run validated the prediction.

## JWT-verified tenant identity

| Field | Value |
|---|---|
| `custom:tenantId` | `34f49822-ae1d-4188-95f0-04e14bc6c662` |
| `cognito:groups[0]` | `34f49822-...` (matches) |
| `custom:userRole` | `TenantAdmin` |
| `cognito:username` / `email` | `shoaib.rain1@gmail.com` (the Saraswati pilot operator's account — distinct from the dev-pabson operator) |
| `custom:tenantTier` | `BASIC` |
| School name (from DDB) | Shree Saraswati Secondary English Boarding School |
| School ID | `61a247a4-44d6-4fc0-a414-062fd4d7e694` |

## Pre-apply recon (read-only, no writes)

DDB partition for tenant `34f49822-...` showed:

| Entity type | Total | Missing `gradeLevel` (backfill scope) |
|---|---|---|
| **INVOICE** | **24** | **24** (100%) |
| **PAYMENT** | **2** | **2** (100%) |
| BILLING_ACCOUNT | 676 | n/a (out of script scope) |
| BILLING_ACCOUNT_LOOKUP | 676 | n/a |
| LEDGER_ENTRY | 23 | n/a |
| FEE_STRUCTURE | 15 | n/a |
| SEQUENCE | 4 | n/a |

**Invoice status mix:** 14 issued · 3 draft · 3 overdue · 2 cancelled · 2 paid (matched the operator-facing dashboard exactly).

**createdAt distribution:** 1 row on 2026-05-24 (the first-ever Saraswati invoice — Aatif Ansari, paid via cash for NPR 3,799) + 23 rows on 2026-06-21. All 24 invoices PRE-DATE Sprint A.1 (which shipped 2026-06-25 11:42 UTC), so all legitimately needed the backfill.

**Sample row shape** verified clean — every row had populated `schoolName`, `studentName`, `statusHistory`, `lineItems` (3 per invoice), `taxSummary`, full gsi1/2/3 keys. No malformed rows, no test data, no anomalies. Confidence going into the apply was high.

## Memory note: prior memory was stale

`memory/project_saraswati_prod_activation.md` (dated 2026-05-19) said *"operator is mid-setup … next operator step is the IEMIS XLSX student import"* — implying zero finance activity. The actual state on 2026-06-30: the operator has generated 24 invoices, recorded 2 cash payments, and is actively managing collections (the dashboard shows 13% collected, NPR 11,397 overdue). The memory needs a refresh; tracked as a small follow-up in the PR.

## Sequence

| # | Time (UTC) | Step | Result |
|---|---|---|---|
| 1 | 02:14Z | Read-only DDB recon (no JWT needed) | 26 backfill rows identified; all PRE-A.1; no anomalies |
| 2 | 02:16Z | Operator paste JWT → decode + verify tenantId matches recon | ✓ |
| 3 | 02:17Z | Operator open temp IAM policy `temp-a5-backfill-saraswati-updateitem-20260630` via CloudShell | ✓ |
| 4 | 02:17Z | `simulate-principal-policy` verify | `Decision: allowed`, `MatchedStatements: 1` |
| 5 | 02:18Z | `--dry-run` (concurrency=8) | **26/26 resolved in 6.9s**; CSV captured |
| 6 | 02:19Z | Surface dry-run to operator, await explicit go on `--apply` | "go" |
| 7 | 02:20Z | `--apply` | **26/26 written in 8.2s** |
| 8 | 02:21Z | DDB verify: `attribute_not_exists(gradeLevel)` count for both INVOICE and PAYMENT | **0** (was 24+2) |
| 9 | 02:21Z | Spot-check: `INV-61A-2606-0014` (Misti Chaudhary) → `gradeLevel:3`, `gradeLevelResolutionStatus:resolved`, `gsi14pk/sk` populated, `status:issued`, `invoiceNumber`, `version` **unchanged** | ✓ additive-only writes confirmed |
| 10 | 02:21Z | Signal operator: SAFE TO REVOKE | ✓ |
| (post) | — | Operator revokes the inline IAM grant via `aws iam delete-user-policy` | ✓ (per the prior session's pattern) |

## Apply summary (from the script's terminal output)

```
Summary
  scanned=26
  invoicesResolved=24
  invoicesUnresolved=0
  invoicesSkipped=0
  paymentsResolved=2
  paymentsUnresolved=0
  paymentsSkipped=0
  alreadyFilled=0
  errors=0
  durationSec=8.2
  findings=saraswati-finance-grade-backfill-apply-20260630-022019.csv
```

## Grade distribution discovered

The 26 resolved rows split as:

| Grade | Rows |
|---|---|
| 3 | 18 |
| 10 | 4 |
| 1 | 2 |
| 6 | 1 |
| 4 | 1 |

A small-school distribution heavy on grade 3 with some upper grades — consistent with a PABSON-archetype boarding school's early-pilot enrollment.

## Operator-visible UI impact

**Zero.** The backfill is additive only — adds `gradeLevel`, `gradeLevelResolutionStatus`, `gsi14pk`, `gsi14sk` to each row. Does NOT modify amounts, status, line items, invoice numbers, gsi1/2/3, or any field the operator sees on the dashboard. The `version` counter on the rows is unchanged (the script's UpdateExpression doesn't bump it on backfill writes).

**New capability unlocked:** filtering invoices/payments by grade level (the B.1/B.2 routes) now actually works for Saraswati. Pre-backfill these returned empty because GSI14 was sparse. The Unknown-grade chip ([PR #261](https://github.com/shoaibrain/edforge-saas-frontend/pull/261)) filters an empty bucket for Saraswati — all 26 rows resolved cleanly, none landed `unresolved`.

## Artifacts

| File | Purpose |
|---|---|
| `saraswati-finance-grade-backfill-dryrun-20260630-021841.csv` | Dry-run findings (26 rows, all `resolution=resolved`) |
| `saraswati-finance-grade-backfill-apply-20260630-022019.csv` | Apply findings (same shape, writes committed) |
| `sprint-a5-close-saraswati-20260630.md` | This summary |

## What this closes

- **Sprint A.5** for the real pilot tenant — both legs (dev-pabson + Saraswati) done.
- **Issue [#343](https://github.com/shoaibrain/edforge/issues/343)** — the recon spike's prediction tree:
  > `< 50 rows total with gradeLevel missing → Run dry-run, manually review CSV, then --apply.`
  
  We landed at 26 rows; dry-run reviewed; applied cleanly.

## Refs

- Plan: `.claude/plans/finance-module-bulk-mighty-honey.md` §A.5
- Companion (internal-dev leg): [`sprint-a5-close-dev-pabson-20260630.md`](sprint-a5-close-dev-pabson-20260630.md)
- BE script parallelize PR: https://github.com/shoaibrain/edforge/pull/348 (merged)
- FE Unknown-chip PR: https://github.com/shoaibrain/edforge-saas-frontend/pull/261 (open)
- Saraswati activation memory (stale; needs refresh): `memory/project_saraswati_prod_activation.md`
