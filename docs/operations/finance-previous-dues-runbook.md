# Finance — Previous Dues (Opening Balance) Runbook

> **Audience:** EdForge operators (school accounts, ops on-call) handling Saraswati pilot opening-balance workflows.
> **Status:** Locked at Sprint PD.4.1. Mirrors the engineering plan at [docs/pilot-onboarding-hardening/sprint-plan.md](../pilot-onboarding-hardening/sprint-plan.md) §PD.4.1.
> **Pilot:** PABSON / Saraswati (NPR currency, BS dates, ~800 students).

---

## 1. What this feature does

When a school transitions onto EdForge mid-year, students typically carry forward unpaid debt from before the platform existed — paper books, prior-year arrears, advance fee deposits that were never reconciled. The **Previous Dues** (a.k.a. **Opening Balance**) feature lets an operator record that pre-EdForge balance once, atomically, against a student's `BillingAccount`. Subsequent payments automatically settle both current invoices AND the carry-forward.

Three operator-facing concepts:

| Field | What it means | Where it's set |
|---|---|---|
| `openingBalance` | The pre-EdForge debt the student carries. NPR-denominated (or tenant currency). | Set via the registration wizard (PD.3) or the EditStudentModal Financial section. |
| `openingBalanceAsOf` | Operator's stated "as of" date (AD, `YYYY-MM-DD`). Documents when the debt was last reconciled outside EdForge. | Same surfaces. |
| `openingBalanceNote` | Operator note (≤ 500 chars) — context for future auditors. | Same surfaces. |
| `openingBalanceRemaining` | **Server-computed.** `openingBalance − openingBalanceSettled`. Decreases as payments settle the carry-forward. | Read-only on the BillingAccount response. |

---

## 2. Operator how-to

### Setting opening balance at registration

(Once Sprint PD.3 frontend lands.) During student registration:

1. Navigate to `/academics/enrollment?tab=registration`.
2. Complete the wizard through "Demographics."
3. **Financial Setup (optional)** step:
   - Type the previous-dues amount (e.g., `5000` for NPR 5,000).
   - Pick the **as of** date via the BS date picker (e.g., `बि.स. 2082 चैत्र 30` ↔ `2026-04-12` AD).
   - Add a note (e.g., "BS 2082 fourth-quarter tuition + library").
4. Submit the wizard. The student is created, then the opening balance is set in a second atomic call.

**If the financial-setup step fails** (e.g., network blip after student create), a reconciliation modal appears: "Student created, but setting Previous Dues failed: {error}. The student exists with no opening balance — Retry / Skip (set later in Edit Student)." Always click **Retry** unless the failure is permanent.

### Setting / revising opening balance after registration

1. Navigate to the student's profile (`/academics/students/{studentId}`).
2. Open **Edit Student**.
3. Expand the **Financial** section.
4. Type the new amount + as-of + note.
5. On submit, if the amount changed from what was prefilled, a **confirmation modal** appears: "Revising the previous dues from NPR {old} to NPR {new}? This creates an audit-trailed adjustment ledger entry; the original opening balance entry stays in the ledger." → Confirm.

### Viewing opening balance on a student's account

Navigate to `/finance/billing/accounts` → expand the student's row. The "Opening balance" summary card shows:

- **Amount** — the carry-forward (e.g., NPR 5,000)
- **As of** — operator's stated effective date (BS rendering for PABSON tenants)
- **Remaining** — `openingBalance − openingBalanceSettled` (e.g., NPR 3,000 after a payment partly settled the carry-forward)
- **Note** — operator note (click to expand if truncated)

The full ledger below the summary card shows the underlying `opening_balance` entry + any `adjustment` revisions + payment-against-opening entries.

---

## 3. Field-by-field interpretation

### `openingBalance` (number, optional)
- **What:** The CURRENT effective opening balance after all revisions.
- **Why current-only?** Per the entity design (PD.1.1), only the latest value is stored. The full revision history is reconstructible from the audit trail — see §6.
- **What if undefined?** Pre-PD account (created before this feature) OR operator never set it. Pre-PD accounts continue to operate exactly as before.

### `openingBalanceAsOf` (string `YYYY-MM-DD`, optional)
- **What:** The operator-supplied "as of" date.
- **Why it matters:** Payments recorded against this account MUST have `paidDate >= openingBalanceAsOf` (PD.2.3 chronology guard) — a payment cannot be recorded BEFORE the carry-forward it would settle.
- **Validation:** Must be ≤ today.

### `openingBalanceNote` (string ≤ 500 chars, optional)
- **What:** Free-form operator context. Examples: "BS 2082 carry-forward — last reconciled by Principal Bhandari", "Includes 1500 advance deposit, balance owed for Q4 tuition".
- **Not validated for content** — operators are trusted. The 500-char cap is the only limit.

### `openingBalanceRemaining` (number, server-computed, optional)
- **What:** `max(0, openingBalance − openingBalanceSettled)`. The amount of the carry-forward the student still owes.
- **Why server-computed?** Per PD.1.6-rev1, the `openingBalanceSettled` counter is maintained atomically by the payment-allocation logic. The mapper computes the remaining at read time. Frontends/mobile/reports should NOT compute it themselves.
- **Clamp:** clamped to ≥ 0 as defense against a corrupted counter; operators should never see negative remaining.

---

## 4. Payment-allocation behavior

When the operator records a payment via `POST /finance/schools/:schoolId/payments/manual`:

### Allocation algorithm

```
toInvoice  = min(payment.amount, invoice.amountDue)
toOpening  = min(payment.amount − toInvoice, openingBalance − openingBalanceSettled)
leftover   = payment.amount − toInvoice − toOpening

if leftover > 0:
  reject with 400 PAYMENT_EXCEEDS_ALLOCATABLE
```

### Ledger ordering contract

**Invoice settlement ALWAYS precedes opening-balance settlement** (older debt first). The ledger shows the two `payment` entries in this order, with descriptions:

- `Payment {receiptNumber} via {gateway} → invoice {invoiceNumber}`
- `Payment {receiptNumber} via {gateway} → opening balance`

### Example: NPR 3,000 payment against an invoice with NPR 2,000 due + opening balance NPR 5,000

```
Before:
  account.balance              = 7000   (invoice 2000 + opening 5000)
  account.openingBalance       = 5000
  account.openingBalanceSettled = 0
  openingBalanceRemaining       = 5000

Operator records: amount=3000, gateway=cash
Allocation:
  toInvoice = 2000  (full invoice settle)
  toOpening = 1000  (overflow against opening)
  applications: [
    { targetType: 'invoice', invoiceId: '...', amount: 2000 },
    { targetType: 'opening_balance', amount: 1000 }
  ]

After:
  account.balance              = 4000   (was 7000, paid 3000)
  account.openingBalance       = 5000   (UNCHANGED — counter tracks settlements)
  account.openingBalanceSettled = 1000  (incremented atomically)
  openingBalanceRemaining       = 4000  (5000 − 1000)
  invoice.status                = 'paid'

Ledger (chronological):
  ...
  Payment RCT-2026-1234 via cash → invoice INV-2026-0001  | credit 2000
  Payment RCT-2026-1234 via cash → opening balance        | credit 1000
```

---

## 5. Common failure modes + diagnosis

### `409 CONCURRENT_UPDATE`

**Symptom:** UI surfaces "Try again — another change just landed."

**Cause:** Two operators (or two browser tabs) tried to mutate the same `BillingAccount` row simultaneously. The optimistic-version-check on the account Update rejected the later transaction.

**Recovery:** Refresh the page (re-fetches the latest account state) and resubmit.

**Last-write-wins:** Whichever transaction commits FIRST wins. There is no priority field; the loser receives 409. (The PD.1.4 JSDoc has the honest write-up — earlier claims of "payment wins" were aspirational.)

### `400 PAYMENT_EXCEEDS_ALLOCATABLE`

**Symptom:** Operator tries to record a payment larger than `invoice.amountDue + openingBalanceRemaining`.

**Cause:** The total payable amount on this student is bounded by the current invoice debt + the carry-forward remaining. Overpayment beyond that is rejected — there is no credit-memo flow in V1.

**Recovery:** Reduce the payment amount to ≤ `allocatable` (returned in the error params), OR record two smaller payments, OR (V1.5) issue a credit-note via the existing flow.

### `400 PAYMENT_PAID_DATE_BEFORE_OPENING_AS_OF`

**Symptom:** Operator backdated `paidDate` to a date earlier than `openingBalanceAsOf`.

**Cause:** Records a payment received BEFORE the carry-forward existed — incoherent for reconciliation.

**Recovery:** Adjust `paidDate` to ≥ `openingBalanceAsOf` (returned in error params). If the actual payment WAS received before the carry-forward, the operator should also revise `openingBalanceAsOf` to an earlier date OR set opening balance to 0 (treating the early payment as a real EdForge invoice payment, not a carry-forward settlement).

### `400 PAYMENT_REFUND_SPLIT_PARTIAL_UNSUPPORTED`

**Symptom:** Operator tries to partially refund a payment that originally split across invoice + opening.

**Cause:** V1 doesn't ship pro-rata refund math for split payments.

**Recovery:** **Void** the entire payment + re-record at the desired amount. The void cleanly reverses both the invoice settlement AND the openingBalanceSettled counter (PD.2 Phase C SPEC-1/3 fixes).

### `404 BILLING_ACCOUNT_NOT_FOUND` on `PUT /opening-balance`

**Symptom:** Operator opens an opening-balance edit for an account that was deleted OR is in another school.

**Cause:** Per the cross-school 404 contract (CLAUDE.md): UUIDs are not enumerable across schools by design. If the operator's role doesn't grant access to this account's school, the response is 404 (not 403).

**Recovery:** Confirm the account ID + school ID + operator's school scope match.

### Student created but opening balance set failed

**Symptom:** Registration wizard reconciliation modal appears: "Student created, but setting Previous Dues failed."

**Cause:** Network blip OR a 4xx/5xx on the PUT after the student creation succeeded.

**Recovery:** Click **Retry** in the modal — the wizard re-issues only the PUT. If retry continues to fail, click **Skip** and set the opening balance later via Edit Student.

### Counter drift (rare)

**Symptom:** `openingBalanceRemaining` shows a value that doesn't match operator expectation. After voiding a split payment, the counter didn't decrement.

**Cause:** The void's `decrementOpeningBalanceSettled` call failed (logged at WARN — see §7). Sequential write semantics mean the void itself committed (payment status, invoice reverse, ledger entry) but the counter didn't go down.

**Recovery:** Issue a manual `setOpeningBalance` revision with the correct amount. The revision emits a `'finance.opening_balance.revised'` audit event + an `'adjustment'` ledger entry — both visible for future reconciliation.

---

## 6. Audit-query examples

All opening-balance writes emit a structured audit event via `FinanceAuditService`. Two event types:

| Event | When | Metadata |
|---|---|---|
| `finance.opening_balance.set` | First-time set on an account | `{ accountId, studentId, amount, asOf, note? }` |
| `finance.opening_balance.revised` | Subsequent edit (delta ≠ 0) | `{ accountId, studentId, oldAmount, newAmount, delta, asOf, note? }` |

### DDB query — last 100 opening-balance events for a tenant

```bash
aws dynamodb query \
  --table-name edforge-finance-basic \
  --key-condition-expression "tenantId = :tid AND begins_with(entityKey, :prefix)" \
  --expression-attribute-values \
    '{":tid":{"S":"<tenant-uuid>"},":prefix":{"S":"AUDIT#FINANCE_BULK#"}}' \
  --filter-expression "begins_with(eventType, :evtPrefix)" \
  --expression-attribute-values-additional \
    '{":evtPrefix":{"S":"finance.opening_balance."}}' \
  --limit 100 \
  --scan-index-forward false
```

(The `AUDIT#FINANCE_BULK#` prefix is historical — see PD.0.2 commit for the naming-legacy explanation. The `eventType` column is the actual discriminator.)

### CloudWatch Logs Insights — opening-balance revisions in the last 7 days

In the `/aws/ecs/edforge/finance` log group:

```
fields @timestamp, event, schoolId, operatorId, eventId
| filter event = 'finance.opening_balance.revised'
| sort @timestamp desc
| limit 200
```

### CloudWatch Logs Insights — opening-balance set with note

```
fields @timestamp, event, schoolId, operatorId, metadata.amount, metadata.asOf, metadata.note
| filter event = 'finance.opening_balance.set'
| sort @timestamp desc
| limit 100
```

---

## 7. Recovery procedures

### Reconstructing the full revision history of an opening balance

The entity stores only the CURRENT effective value. To reconstruct history:

1. Find the FIRST `finance.opening_balance.set` event for the account (the initial amount).
2. Iterate forward through `finance.opening_balance.revised` events ordered by `occurredAt`. Each carries `{ oldAmount, newAmount, delta }`.
3. The current `openingBalance` equals `firstSetAmount + Σ(delta)`.

### Manually correcting a counter drift

If `openingBalanceSettled` is wrong (e.g., a void's decrement failed):

1. Query the ledger to determine the correct settled amount: sum of `'payment'` entries with description matching `'opening balance'`, minus voids/refunds against those payments.
2. Compute the correct `openingBalance` to restore the right `openingBalanceRemaining`:
   `correctRemaining = realDebtOwed`
   `correctOpeningBalance = correctRemaining + openingBalanceSettled` (use the CURRENT settled value, not the corrected one — we set openingBalance to a value that makes math work given the current counter)
3. Call `setOpeningBalance` with the computed amount. The revision creates an `'adjustment'` ledger entry that auditors can trace.

Alternative (cleaner but requires DDB access): patch `openingBalanceSettled` directly via the AWS Console or a one-off script. Document the manual fix in the audit-event metadata via a follow-up `setOpeningBalance` revision with `note: "manual counter reset; see incident XYZ"`.

### Voided split-payment recovery

If a split-payment void left counter drift (the `WARN` log surfaced):

```
{ "action": "payment.void_opening_balance_decrement_failed",
  "paymentId": "...",
  "accountId": "...",
  "openingAmount": 1000,
  "error": "..." }
```

1. Query the log to find the `openingAmount` that should have been decremented.
2. Issue a `setOpeningBalance` revision that subtracts `openingAmount` from the current `openingBalance`. This restores the right `openingBalanceRemaining` while preserving auditability (the revision is logged as an event).
3. Note in the revision: `"counter recovery for failed void of payment {paymentId}; see WARN log {logStreamId}"`.

---

## 8. Escalation paths

| Issue | First-line response | Escalate to |
|---|---|---|
| 409 CONCURRENT_UPDATE storm (many in short window) | Check CloudWatch dashboard for finance latency anomalies | On-call platform engineer |
| Counter drift across many accounts | Manual revision per §7 + write incident ticket | Engineering lead + product manager |
| 500 on `PUT /opening-balance` | Check finance service CloudWatch logs for stack trace | On-call platform engineer |
| Audit row missing for a known write | DDB query first; if confirmed missing, audit DDB write failure path log lines (`DDB write failed for eventType=finance.opening_balance.*`) | Engineering lead |
| Receipt PDF shows wrong invoice number | Check WARN logs for `Receipt rendering integrity check failed` — CORR-6 guard caught data corruption | Engineering lead + immediate investigation |

---

## 9. V1 deferrals (V1.5+)

| Deferred | Why | V1.5 Path |
|---|---|---|
| Partial refunds on split payments | Pro-rata math + audit complexity | New `paymentApplicationSchema` with refund tracking per application |
| Opening-balance-only payments (no invoice) | Touches 27 `payment.invoiceId` read sites — high regression risk | Either dedicated endpoint OR refactor + migration |
| Credit-memo flow for overpayment | No credit-memo flow exists today | Build credit-memo entity first; reroute overpayment-overflow there |
| CloudWatch alarm on opening-balance failure rate (PD.4.2) | Out of PR-PD scope (analytics-stack CDK change) | Ship in PD.4 follow-up PR |
| Frontend (registration wizard step, edit modal, ledger card) | Sprint PD.3 | Land after PR-PD merges |
| Gateway payments (eSewa, Khalti) supporting opening-balance settlement | Gateway amount is fixed at initiate-redirect time | Refactor `initiatePayment` to compute split |

---

## 10. Sign-off

This runbook is locked at v1.0 (Sprint PD.4.1). Material scope changes (new error codes, new endpoints, contract changes) require a v1.1 revision. Mechanical edits (typo, link rot) do not require a version bump.

For the engineering plan + atomic ticket history, see [docs/pilot-onboarding-hardening/sprint-plan.md](../pilot-onboarding-hardening/sprint-plan.md).
