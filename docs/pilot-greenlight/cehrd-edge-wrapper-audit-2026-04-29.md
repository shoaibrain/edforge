# EdForge — Pre-Pilot Hardening Audit (Finance + School/IEMIS)

**Audience:** EdForge engineering + product leads. Pre-pilot hardening review for the Saraswati go-live.

**Scope of this document.** Originally two production-blocking, evidence-backed defects + the surrounding gaps before pilot tenants self-serve the Finance module and import IEMIS rosters. As of **2026-04-29** the original P0/P1 surface is closed; one residual blocker remains for the actual Saraswati IEMIS file (combined-band `ECD/PPC` token).

> Repo paths use `[name](relative/path)` markdown links. Server repo root: `/Users/shoaibrain/edforge`. Frontend repo root: `/Users/shoaibrain/edforge/edforge-saas-frontend` (separate git remote).

---

## STATUS — 2026-04-29

| | What | PR | Status |
|---|---|---|---|
| Sprint 1 | ECD/PPC descriptors + Ledger tab regression | [#29](https://github.com/shoaibrain/edforge/pull/29) + [#43](https://github.com/shoaibrain/edforge-saas-frontend/pull/43) | ✅ shipped UAT + prod (BUG-F1, F4, S1, S2, S3, S8, S9 closed) |
| Sprint 2.A | Currency from tenant settings + payment-currency mismatch | [#30](https://github.com/shoaibrain/edforge/pull/30) | ✅ shipped UAT + prod (BUG-F2 closed) |
| Sprint 2.B-T3 | `BILLING_ACCOUNT_LOOKUP` mirror row + transactional getOrCreate | [#31](https://github.com/shoaibrain/edforge/pull/31) | ✅ shipped UAT + prod (BUG-F7 closed) |
| Sprint 2.B-T4 | Atomic Payment + Invoice + Ledger + Account `TransactWriteItems` | [#32](https://github.com/shoaibrain/edforge/pull/32) | ✅ shipped UAT + prod (BUG-F3 closed) |
| **Sprint 3 (revised)** | **ECD/PPC combined-band import + Saraswati school correction** | **next** | 🔴 only remaining pilot-blocker |
| Sprint 4 — UX polish | Real Payments tab, ledger chip, skeletons | — | ⏸ deferred — not pilot-blocking |
| Sprint 5 — Ops coverage | Reconciliation Lambda, dashboard, CI gate | — | ✂️ cut — load-bearing pieces subsumed by T4; rest is defense-in-depth |

**Net of remaining work for pilot launch:** one server PR + one operator data correction. Rest is post-launch polish.

---

## 0. TL;DR — original P0s (both closed)

| ID | Status | Symptom | Root cause | Fix size |
|---|---|---|---|---|
| **BUG-F1** | ✅ closed (#43) | Ledger tab always shows "No ledger entries yet." even though API returns 3 items | `getStudentLedger()` declared `Promise<StudentLedgerEntry[]>` but the API returns `{ items, hasMore }`. The component fell back to `[]` via `Array.isArray()` guard. | 3 lines in [invoices.service.ts](edforge-saas-frontend/packages/finance-services/src/services/invoices.service.ts) |
| **BUG-S1** | ✅ closed (#29) | `gradeRange.start = "ECD"` caused HTTP 400 from `/api/schools` | `GRADE_RANGE_TO_DESCRIPTOR.ECD = 'EarlyEducation'`, but the backend zod enum had no such member. The Ed-Fi descriptor catalog inside the same package already defined the right code (`EarlyChildhoodDevelopment`); they were never wired together. | shared-types 0.37.0 |

Both were pure mismatches — the data and the conventions both already existed; the wiring was wrong.

---

## 1. Finance Module — As-implemented architecture

### 1.1 Service topology

NestJS microservice [server/application/microservices/finance](server/application/microservices/finance/), one image (`edforge/finance`), one ECS service per tenant tier (`financebasic` in V1). Routed three-ways per CLAUDE.md:

1. NestJS controllers ([finance.module.ts](server/application/microservices/finance/src/finance.module.ts))
2. API Gateway OpenAPI in [tenant-api-prod.json](server/lib/tenant-api-prod.json) (deployed via `shared-infra-stack`)
3. nginx rproxy in [nginx.template](server/application/reverseproxy/nginx.template#L218-L222) → `proxy_pass http://finance-api.${NAMESPACE}.sc:3010`

### 1.2 Submodule inventory

```
common/             ← shared entities + DDB key builders + DTO shapes
fee-structures/     ← school-scoped fee templates (auto-apply on enrollment)
invoices/           ← invoice CRUD + bulk + auto-issue path
payments/           ← cash/cheque/bank/eSewa/Khalti, void, refund, reconcile
student-accounts/   ← BillingAccount aggregate + Ledger queries (BUG-F1 root)
credit-notes/       ← scholarships, grants, fee waivers
discount-rules/     ← rule-based discounts on invoice line items
refunds/            ← RefundRequest workflow (request → approve → process)
payment-gateways/   ← per-school gateway config (eSewa/Khalti API keys)
dashboard/          ← summary aggregates
webhooks/           ← /internal/webhooks/enrollment-completed (auto-issue)
```

### 1.3 Persistence model — single-table DDB (`edforge-finance-basic`)

PK = `tenantId` (raw UUID). SK varies per entity. Three GSIs (school-scoped, student-scoped, invoice-number lookup).

| Entity | SK shape | Notes |
|---|---|---|
| `BillingAccount` | `BILLING_ACCOUNT#<schoolId>#<studentId>` | One per (school, student) |
| `BillingAccountLookup` | `ACCOUNT#<accountId>` | **Sprint 2.B-T3 mirror row.** Direct-key lookup so getByAccountId is O(1) |
| `LedgerEntry` | `LEDGER#<accountId>#<entryId>` | Append-only; `studentAccountId` = BillingAccount.accountId |
| `Invoice` | `INVOICE#<schoolId>#<invoiceId>` | GSI3 unique on invoiceNumber |
| `Payment` | `PAYMENT#<schoolId>#<paymentId>` | Refunds nested in `refunds[]` |
| `FeeStructure` | `FEE_STRUCTURE#<schoolId>#<feeStructureId>` | Versioned; auto-apply flag |
| `CreditNote` / `RefundRequest` / `DiscountRule` / `GatewayConfig` / `PaymentSession` | various | (unchanged) |

### 1.4 Payment write path — atomic post-T4

Sprint 2.B-T4 collapsed `recordManualPayment` and `completePayment` into a single `TransactWriteItems` of 4 ops:

1. Put `Payment` (status=completed, with attribute_not_exists guard)
2. Update `Invoice` (apply payment, version + status as ConditionExpression)
3. Put `LedgerEntry`
4. Update `BillingAccount` (balance, totalPaid, version)

Standalone wrappers (`recordLedgerEntry`, `applyPayment`) still serve void/refund/invoice-issue paths unchanged. `TransactionCanceledException` → 409 `ConflictException` with parsed per-op detail (`payment_put / invoice_apply / ledger_put / account_update`) so operators can tell which guard rejected.

---

## 2. Finance Module — Catalogued issues

| ID | Sev | Title | Status |
|---|---|---|---|
| BUG-F1 | P0 | `getStudentLedger` doesn't unwrap `{items, hasMore}` | ✅ closed (Sprint 1, PR #43) |
| BUG-F2 | P1 | Currency literal `'NPR'` hardcoded | ✅ closed (Sprint 2.A, PR #30). Note: CreditNote / FeeStructure / RefundRequest entities still default `'NPR'` — fast-follow before second non-NPR tenant; not pilot-blocking |
| BUG-F3 | P1 (escalated) | Payment + ledger writes sequential, not transactional | ✅ closed (Sprint 2.B-T4, PR #32). Atomic 4-op TransactWriteItems with parsed CancellationReasons |
| BUG-F4 | P1 | LedgerTab swallows `isError` | ✅ closed (Sprint 1, PR #43) |
| BUG-F5 | P2 | Payments tab derives history from invoice `amountPaid`, not actual payment records | ⏸ deferred (Sprint 4) — works today, polish only |
| BUG-F6 | P2 | No ledger smoke coverage | ✅ effectively closed — `finance-ledger-render.ts` (Sprint 1) + `finance-currency-from-tenant-settings.ts` (Sprint 2.A) exercise the ledger end-to-end |
| BUG-F7 | P2 | `getByAccountId` GSI scan + filter | ✅ closed (Sprint 2.B-T3, PR #31). New `BILLING_ACCOUNT_LOOKUP` mirror row |
| BUG-F8 | P2 | LedgerTab uses `FinanceStatusChip` for `entryType` | ⏸ deferred (Sprint 4) — cosmetic |
| BUG-F9 | P3 | Ledger DTO carries both `debit` and `credit` | ⏸ deferred — cosmetic, revisit during ledger-export work |

> **Tier scope reminder.** All on the BASIC tier path. ECS deploy target is `financebasic` in `prod-basic`. Advanced/Premium tier finance is V1_DEFERRED.

---

## 3. School create + IEMIS — As-implemented architecture

### 3.1 Grade-level taxonomy (where the truth lives)

The repo has one canonical source for grade codes:

- **Internal codes (UI + IEMIS):** `ORDERED_GRADES = ['ECD','PPC','PK','K','1'..'12']` in [grade-levels.ts](packages/shared-types/src/schemas/identity/grade-levels.ts). PABSON archetype subset omits PK/K: `PABSON_GRADE_LEVELS = ['ECD','PPC','1'..'12']`.
- **Internal → Ed-Fi descriptor mapping:** `GRADE_RANGE_TO_DESCRIPTOR` ([grade-levels.ts:79-97](packages/shared-types/src/schemas/identity/grade-levels.ts#L79-L97)) — used by the wizard's `computeGradeLevels()` to derive the array sent to `/api/schools`. Sprint 1 fixed `ECD → 'EarlyChildhoodDevelopment'` and `PPC → 'PrePrimaryClass'`.
- **Authoritative Ed-Fi descriptor catalog:** [grade-level-descriptor.ts](packages/shared-types/src/ed-fi/descriptors/grade-level-descriptor.ts).
- **Backend zod enum:** `schoolGradeLevelDescriptorSchema` in [education-org-descriptors.ts:212-234](packages/shared-types/src/schemas/identity/education-org-descriptors.ts#L212-L234) — Sprint 1 added `EarlyChildhoodDevelopment` + `PrePrimaryClass` to the validator.

### 3.2 IEMIS bulk import — current behaviour (post-Sprint-1)

[iemis-transform.ts](server/application/microservices/academics/src/students/iemis-transform.ts) parses each xlsx row via `transformIemisRow()`. Grade extraction is two functions:

- `normalizeGradeLevel(raw)` ([line 275-291](server/application/microservices/academics/src/students/iemis-transform.ts#L275-L291)) — accepts `'ECD'|'PPC'|'PK'|'K'` literally; strips `CLASS|GRADE|G` prefixes for `1..12`. Returns `''` on no match. **Does NOT recognize the literal token `"ECD/PPC"`** — this is the residual pilot blocker.
- `isValidGradeForArchetype(grade, archetype)` in [import-normalize.ts:121-131](server/application/microservices/academics/src/common/utils/import-normalize.ts#L121-L131) — for PABSON: `grade ∈ PABSON_GRADE_LEVELS` (which includes `ECD` and `PPC` individually).

### 3.3 What Saraswati's actual file contains (verified 2026-04-29)

Operator uploaded `chunk1.xlsx` (200 rows) for `Shree Saraswati Secondary English Boarding School` (`schoolId 61a247a4-44d6-4fc0-a414-062fd4d7e694`, tenant `34f49822-ae1d-4188-95f0-04e14bc6c662`):

- **15 rows** (rows 10, 20, 40, 44, 49, 52, 58, 74, 81, 93, 95, 98, 100, …) blocked with `"Grade level is required"`.
- **All 15 errors are on rows where `CurrentClass = "ECD/PPC"`** — the literal combined-band token (slash and all). Not `"Nursery"`, `"LKG"`, or `"UKG"` — those don't appear in the file at all. Earlier speculation about needing those aliases was wrong.
- **185 rows** skipped as duplicates (`emisStudentId` already imported from a prior run on rows with numeric `CurrentClass = "2"`, `"4"`, `"7"`, etc.).
- **13 warnings** — guardian phone placeholders (separate finding, not blocking).

### 3.4 Saraswati school's current state in DDB

```
schoolId       : 61a247a4-44d6-4fc0-a414-062fd4d7e694
tenantId       : 34f49822-ae1d-4188-95f0-04e14bc6c662
emisSchoolCode : 170840012
gradeRange     : { start: "PK", end: "10" }
gradeLevels    : ["Prekindergarten", "Kindergarten", "FirstGrade", ..., "TenthGrade"]
status         : "setup"
createdAt      : "2026-04-23T07:02:04.895Z"
```

The school predates Sprint 1 (created 2026-04-23, Sprint 1 shipped 2026-04-28). It does NOT include `EarlyChildhoodDevelopment` or `PrePrimaryClass` in `gradeLevels`. After the parser fix, these students would import (the parser is the only blocker today), but the school's gradeLevels list would be semantically out of date with what students it serves.

---

## 4. School + IEMIS — Catalogued issues

| ID | Sev | Title | Status |
|---|---|---|---|
| BUG-S1 | P0 | `GRADE_RANGE_TO_DESCRIPTOR.ECD = 'EarlyEducation'` rejected by server | ✅ closed (Sprint 1, shared-types 0.37.0) |
| BUG-S2 | P0 | `GRADE_RANGE_TO_DESCRIPTOR.PPC = 'Prekindergarten'` collapses PPC→PK | ✅ closed (Sprint 1) |
| BUG-S3 | P0 | Backend zod enum missing the two PABSON descriptors | ✅ closed (Sprint 1) |
| BUG-S4 | P1 → reclassified | `normalizeGradeLevel` doesn't accept synonyms `'Nursery'`/`'LKG'`/`'UKG'`/`'Pre-Primary'` | ✂️ **cut** — Saraswati's actual file does NOT contain these tokens (verified 2026-04-29). Was speculation; revisit only if a future tenant's IEMIS export actually emits them |
| BUG-S5 | P1 | GENERIC archetype IEMIS upload policy | ✂️ **cut** — no GENERIC tenants exist. Revisit when one does |
| BUG-S6 | P2 | "Grade level is required" message conflates missing vs unrecognized | ⏸ deferred — operator can disambiguate from the spreadsheet itself |
| **BUG-S7** | **P0 (now)** | **Saraswati cohort holds the literal token `'ECD/PPC'` (combined band)** | 🔴 **OPEN — only remaining pilot blocker. Sprint 3 below.** |
| BUG-S8 | P2 | Wizard "Auto-computed" chip duplicates | ✅ closed by BUG-S2 fix in Sprint 1 |
| BUG-S9 | P3 | `EarlyEducation` token nowhere else | ✅ closed (Sprint 1 removed it) |

---

## 5. Sprint plan

### Completed sprints (memorialized, not for action)

#### ~~Sprint 1 — P0 hotfixes (Ledger + ECD/PPC)~~ ✅ shipped 2026-04-28

**Closed:** BUG-F1, BUG-F4, BUG-S1, BUG-S2, BUG-S3, BUG-S8, BUG-S9.

PRs [shoaibrain/edforge#29](https://github.com/shoaibrain/edforge/pull/29) (server) + [shoaibrain/edforge-saas-frontend#43](https://github.com/shoaibrain/edforge-saas-frontend/pull/43) (frontend). shared-types 0.37.0. UAT + prod smokes 8/8 green.

#### ~~Sprint 2.A — Currency from tenant settings~~ ✅ shipped 2026-04-29

**Closed:** BUG-F2.

PR [#30](https://github.com/shoaibrain/edforge/pull/30). shared-types 0.38.0. New `TenantSettingsService` (NestJS @Injectable wrapping identity `GET /tenants/my/settings`, 5-min LRU cache). New `PAYMENT_CURRENCY_MISMATCH` 400 error code. UAT smoke 10/10 green.

> Note: CreditNote / FeeStructure / RefundRequest entities still default `'NPR'` — fast-follow before a second non-NPR tenant onboards; not pilot-blocking.

#### ~~Sprint 2.B-T3 — `BILLING_ACCOUNT_LOOKUP` mirror row~~ ✅ shipped 2026-04-29

**Closed:** BUG-F7.

PR [#31](https://github.com/shoaibrain/edforge/pull/31). New entityType + key shape `ACCOUNT#<accountId>`. `getOrCreate` writes both rows in one TransactWriteItems. `getByAccountId` reads via mirror first with GSI fallback for legacy data + cross-school protection. UAT 34/34 backfilled; prod has zero legacy data so backfill was a no-op.

#### ~~Sprint 2.B-T4 — Atomic Payment + Invoice + Ledger + Account~~ ✅ shipped 2026-04-29

**Closed:** BUG-F3.

PR [#32](https://github.com/shoaibrain/edforge/pull/32). `recordManualPayment` and `completePayment` now run a single 4-op `TransactWriteItems`. New helpers `buildLedgerEntryTransactItems` + `buildApplyPaymentTransactItem`. `TransactionCanceledException` → 409 `ConflictException` with parsed per-op detail (`CONCURRENT_UPDATE` error code). Standalone `recordLedgerEntry` / `applyPayment` wrappers preserved for void/refund/invoice-issue paths. UAT smoke 10/10 + DDB cross-check confirms all 4 entities reconcile after every atomic write.

---

### Sprint 3 (revised) — Saraswati IEMIS import unblock

**Goal:** Saraswati can self-serve their student roster import from CEHRD IEMIS xlsx without manual cleanup or re-formatting. Demo: upload the actual `chunk1.xlsx` file → all 200 rows resolve cleanly (15 ECD/PPC rows import as ECD with a documented warning; 185 numeric-grade duplicates skip; 0 errors).

**Single ticket** — closes BUG-S7 + corrects Saraswati's school doc. ~50 lines of code + 1 operator step.

#### S3-T1 — `ECD/PPC` combined-band parser fix (BUG-S7) — server, single PR

**Why a single canonical descriptor (not a new combined Ed-Fi value):** the user's directive is "scalably resolve to the edforge internal Ed-Fi standards." We don't invent `EarlyChildhoodEducationCombined` because (a) it's not an Ed-Fi standard, (b) any future tenant with a similar combined token gets the same straightforward resolution, (c) operators see a per-row warning and can re-classify if needed.

**Code change** in [iemis-transform.ts](server/application/microservices/academics/src/students/iemis-transform.ts):

1. `normalizeGradeLevel(raw)` line 275-291 — add the combined-band rule **before** the existing literal check:
   ```ts
   if (upper === 'ECD/PPC' || upper === 'ECD/PPC ' || upper === 'ECD / PPC') return 'ECD';
   ```
   Tolerates whitespace variants. Returns `'ECD'` per audit BUG-S7's default policy.

2. `transformIemisRow(row, ...)` around line 181-188 — when the original raw token matches the combined-band pattern, push a **warning** (not error) finding to the row's `findings[]`:
   ```
   Row N · CurrentClass — Combined band "ECD/PPC" — placed in ECD; manual review recommended
   ```
   Operator gets a heads-up; the import proceeds.

**Tests:**
- Unit: `normalizeGradeLevel('ECD/PPC')` → `'ECD'`; tolerant of `'ecd/ppc'`, `'ECD/PPC '`, `'ECD / PPC'`; still returns `''` for unrecognized tokens.
- Unit: `transformIemisRow` for a row with `CurrentClass: 'ECD/PPC'` produces a `findings` entry of level `warning` containing the literal text "Combined band".
- Smoke: a sanitized fixture under `tests/fixtures/iemis/saraswati-chunk1-anonymized.xlsx` (the actual 200-row Saraswati file with names + IDs scrubbed) re-imported via the import endpoint asserts:
  - 15 rows imported with grade `ECD` and a combined-band warning each
  - 185 rows skipped as duplicates
  - 0 errors

**Deploy ladder:**

1. Build academics ECR (server-only change; no shared-types bump needed; no controlplane redeploy).
2. Roll `academicsbasic` on UAT, wait stable.
3. Run the smoke against UAT with the operator's actual `chunk1.xlsx` (or the sanitized fixture) — assert 15 ECD imports + 185 duplicates + 0 errors.
4. Merge → main → build prod academics ECR → roll prod `academicsbasic`.
5. Operator re-uploads on prod; expects identical clean result.

**Rollback:** ECR `:latest` re-tag prior digest, `aws ecs update-service --force-new-deployment`.

#### S3-T2 — Saraswati school doc correction (operator step, no code)

The school's `gradeRange.start = "PK"` and `gradeLevels` lacks `EarlyChildhoodDevelopment` + `PrePrimaryClass`. After T1 ships, ECD students will import successfully (parser is the only validator), but the school's `gradeLevels` advertises a band that excludes them — semantic drift.

**Two paths to fix:**

- **(a) Use the existing school-update API** if `PATCH /api/schools/:schoolId` exists. Quick curl-check first; if it accepts a partial body with `gradeRange` + `gradeLevels`, this is a one-line operator action. Cleanest.
- **(b) DDB direct update** via `aws dynamodb update-item` from an admin role (the prod-deployer can't do this — same IAM scope guard we hit on the C2.B-T3 backfill). One-shot script, two attribute updates: prepend `EarlyChildhoodDevelopment` + `PrePrimaryClass` to `gradeLevels`, set `gradeRange.start = "ECD"`.

**Validation:** GET `/api/schools/61a247a4-...` after the update — assert `gradeRange.start === "ECD"` and `gradeLevels` includes both new descriptors.

#### S3-T3 — Dress rehearsal (operator-led, I assist)

After T1 + T2 land, walk through the actual pilot import end-to-end on UAT first, then prod:

1. Re-upload `chunk1.xlsx` → confirm 15 ECD + 185 dupes + 0 errors.
2. Optionally import `chunk2.xlsx` if there are more rows to add.
3. Spot-check 3-5 imported students via GET `/api/academics/students/{id}` — confirm `currentGradeLevel === "ECD"`, `emisStudentId` matches the file.
4. Verify the operator UI shows the 15 ECD students in the Students list under their school.

This is operator-led; my role is to run the smokes alongside and surface any drift via DDB queries / CloudWatch on request.

---

### Out of scope (consciously cut or deferred)

| Was | Why cut/deferred |
|---|---|
| **S2-T5** EventBridge-scheduled reconciliation Lambda | T4 closed BUG-F3 atomically — the silent-failure mode it was designed to defend against no longer exists. Pure defense-in-depth; not pilot-blocking. |
| **S2-T6** Ledger pagination smoke | `finance-ledger-render.ts` + `finance-currency-from-tenant-settings.ts` already exercise the ledger read path end-to-end. Pagination assertion is polish. |
| **Sprint 4** entire (BUG-F5 real Payments tab, BUG-F8 ledger chip, skeleton states, doc comment) | UX polish; the Payments tab works (just shows invoice-summary view). Pilot can launch without it. |
| **S5-T1** CloudWatch alarm on `"CRITICAL: Payment completed but ledger entry failed"` log | The CRITICAL log line **no longer exists post-T4** (the transaction either commits or rolls back; no partial-failure path). Alarm has nothing to fire on. |
| **S5-T2** Pilot dashboard | Useful but not load-bearing; pilot can launch with manual CloudWatch checks. |
| **S5-T4** Pre-prod CI smoke gate | Process improvement; we've been running per-PR pre-deploy smokes manually with full evidence in `docs/deploys/`. |
| **BUG-S4** Nursery/LKG/UKG synonym aliases | Saraswati's actual file does not contain these tokens. Speculation. Revisit only if a future tenant's IEMIS export actually emits them. |
| **BUG-S5** GENERIC archetype IEMIS preflight | No GENERIC tenants exist. Revisit when one does. |
| **BUG-S6** Distinct error messages (missing vs unrecognized) | Nice ergonomics; not pilot-blocking. |

**Out-of-scope from the original audit (still deferred):**

- New finance features (split payments, recurring billing, scholarships UI, dunning workflows).
- IEMIS export back to CEHRD Flash.
- Multi-currency on a single invoice.
- AdminWeb v2 / landing-v2 work (separate workstream).
- Anything tagged `V1_DEFERRED` (Advanced/Premium tier, multi-region).

---

## 6. Validation strategy summary (unchanged)

Where unit tests don't make sense or aren't worth the cost, every ticket includes one of:

- **Operator smoke under [scripts/smoke-tests/](scripts/smoke-tests/)** — tee'd, repeatable, lives in repo for replay during incidents.
- **DDB direct assertion** — `aws dynamodb query` against UAT/prod to confirm shape, used as the post-deploy verification step.
- **CloudWatch log inspection** — used in T3/T4 to confirm fast-paths fire and fallbacks don't.
- **jsdom bundle sim** — only required for shared-types changes that flow into AdminWeb. Not needed in Sprint 3 (server-only, no shared-types change).

---

## 7. Evidence index (verifiable now)

- **Saraswati IEMIS upload result (2026-04-29):** 0 will-import, 15 errors all `"Grade level is required"` on `CurrentClass = "ECD/PPC"` rows, 185 duplicates, 13 warnings (guardian phone placeholders, unrelated).
- **Saraswati school doc:** `schoolId 61a247a4-...`, `tenantId 34f49822-...`, `gradeRange.start = "PK"`, `gradeLevels` excludes ECD/PPC descriptors. Created 2026-04-23 (pre-Sprint-1).
- **Sprint 1 prod proof:** ECD school create smoke 8/8 ✓ on `prodtestadmin` tenant (`schoolId 68bcf749-...`), shared-types 0.37.0 live on npm.
- **Sprint 2.B-T4 prod proof:** finance image `897c4e2-20260429222423` (sha256:029b50f4...) live in ap-south-1; `recordManualPayment` is now a single 4-op TransactWriteItems with parsed per-op CancellationReasons surfacing as 409 `CONCURRENT_UPDATE`.
- **`grep -r "ECD/PPC" packages/shared-types/src server/application`** → only the audit comment in `grade-level-descriptor.ts` (intentionally NOT aliased pre-fix); `normalizeGradeLevel` does not handle it.

---

*Audit revised 2026-04-29 after Sprints 1 + 2 shipped. Remaining work: single-ticket Sprint 3 + operator data correction + dress rehearsal. Estimated total remaining engineering effort: ~50 lines of code + smoke + ops walkthrough.*
