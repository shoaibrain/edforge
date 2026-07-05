# Family Billing — Operator Runbook (FB-5.6)

> **Status:** written with the EPIC-FB implementation PR; the end-to-end execution record (§6) is filled in during post-deploy live validation on the dev tenant. This release is **backend-only** — every flow below is driven via the API with a TenantAdmin JWT until the frontend tasks ship.

All calls: base `https://<tenant-domain>/api`, headers `Authorization: Bearer <JWT>`, `X-Tenant-Id: <tenantId>`.

## 1. Linking existing students into families

No data migration exists or is needed — pilot data has no family information (audit finding L4). Families are created explicitly:

```bash
# 1. Create the family (school-scoped)
POST /academics/schools/{schoolId}/families
{ "schoolId": "...", "name": "Adhikari family",
  "primaryContact": { "name": "Mohan Adhikari", "phone": "98...", "email": "..." } }

# 2. Link each child (one family per student — 409 if already linked elsewhere)
POST /academics/schools/{schoolId}/families/{familyId}/members
{ "studentId": "..." }

# 3. Verify from either direction
GET /academics/schools/{schoolId}/families/{familyId}/members
GET /academics/students/{studentId}/family        # → family + siblings (status included)
```

Permissions: `students:edit` to create/link, `students:view` to read. Unlink: `DELETE .../members/{studentId}` (idempotent).

## 2. Agreement rollout checklist (per family)

1. **Preconditions:** students linked into a family (§1); every student actively enrolled at the school; you hold `billing:manage` (ALL agreement operations require it — owner decision FB-2.0b).
2. **Draft** — `POST /finance/schools/{schoolId}/agreements` with type `fixed_total` (family total + per-student allocation summing exactly) or `per_student` (explicit per-student amounts), `coveredFeeTypes` (ONLY these standard fee types are replaced; everything else still bills normally), term dates, payer snapshot, optional `familyId`.
3. **Review the draft** — `GET .../agreements/{id}`. Draft edits are in-place (`PATCH` with current `version` in the body; 409 = someone else edited first).
4. **Activate** — `POST .../agreements/{id}/activate` with `{ "version": n }`.
   - `409 CONFLICTING_OPEN_INVOICES` → the listed open standard invoices cover feeTypes this agreement replaces. Resolve each (cancel the draft/issued invoice, or apply a credit note), or re-activate with `"acknowledgeOpenInvoices": true` after review — the acknowledgement is audit-logged.
   - `409 AGREEMENT_OVERLAP` → another agreement already covers one of the students (lock-enforced, atomic). One active agreement per student, ever.
5. **Generate invoices normally** (single, bulk, or via enrollment). Covered students are priced by the agreement automatically; `bulk-preview` shows `billingSource: standard | agreement | mixed` per student before you commit.
6. **Verify pricing** — invoice detail shows `feeOverrideMode: "agreement"`, agreement lines, and `suppressedFeeStructureIds`; `GET .../invoices/{id}/provenance` explains every line.

## 3. Pricing precedence (what wins)

| Situation | Outcome |
|---|---|
| Fee type covered by an active agreement | **Agreement line** replaces the standard fee (suppression, provenance recorded) |
| Fee type matched by an active `sibling` discount rule (family has ≥ minSiblings actively-enrolled children, self included) | Rule discount applied to the standard line, `discountRuleId` recorded — **replaces** any manual discount on that line |
| Operator manual discount, no rule match | Manual discount stands |
| Agreement-covered fee type + sibling rule | **Agreement wins** — rules never touch agreement lines |
| Standard invoice explicitly forced for a covered student | Requires `overrideAgreement: true` + `billing:manage`; emits `AGREEMENT_BYPASSED` audit event |
| Same agreement + same billing period billed twice | Blocked: `409 AGREEMENT_ACTIVE` (duplicate-billing guard) |
| Same agreement generated again (any period label) | Blocked: agreements bill once per term (`409 AGREEMENT_ACTIVE`). Agreement amounts are per-term totals; `billingFrequency` is descriptive — installments are partial payments against the one invoice (owner decision 2026-07-05) |

## 4. Family settlement (one payment, several children)

```bash
# See everything open for the family + a suggested oldest-due-first split
GET /finance/schools/{schoolId}/families/{familyId}/open-invoices

# Record one payment across up to 20 invoices (same school + currency)
POST /finance/schools/{schoolId}/payments/manual
{ "amount": 25000, "currency": "NPR", "gateway": "cheque", "paidDate": "...",
  "applications": [ { "invoiceId": "...", "amount": 20000 },
                    { "invoiceId": "...", "amount": 5000 } ],
  "familyId": "..." , "idempotencyKey": "..." }
```

Each child's ledger records its own share; the receipt (JSON + PDF) shows the per-invoice breakdown. Overpayment beyond the targets' total due is rejected (no credit memo in V1). Voiding a family payment reverses every application atomically. Gateway (eSewa/Khalti) payments remain single-invoice.

## 5. Rollback (feature flags)

Task-def env vars (redeploy `tenant-template-stack-basic` to change):

- `BILLING_AGREEMENTS_ENABLED=false` → agreement routes 404; invoice generation returns to standard pricing (resolver hook inert); **already-issued agreement-priced invoices remain valid, readable, and payable** (pinned by tests, FB-3.9).
- `FAMILY_GROUPS_ENABLED=false` → family routes 404; family open-invoices returns 404 via academics; per-student billing unaffected.

## 6. Execution record (dev tenant)

_To be completed during post-deploy live validation — family created, agreement activated, agreement-priced generation verified on all paths, family payment recorded, provenance checked, flag-off rollback exercised._
