# Pilot Onboarding Hardening — Sprint Plan (v1.1 LOCKED)

> **Status:** Locked source of truth for the Pilot Onboarding Hardening effort.
> **Pilot:** PABSON / Saraswati — ~800-student onboarding, BS 2083 academic year (mid-April 2026).
> **Owner ask (Shahid Bhai, 2026-06-27):** Two non-negotiables before the school can transition: (1) Previous Dues input at registration; (2) Custom Yearly Fee Agreement override.

## v1.1 Changelog (2026-06-27 — post-PR-#330-review)

Material updates after PR #330 implementation + reviewer feedback (P2.1):

- **Endpoint path corrected** — every reference to `/billing-accounts/.../opening-balance` now reads `/student-accounts/.../opening-balance` to match the actual controller prefix (`@Controller('finance/schools/:schoolId/student-accounts')`). The entity is still called "BillingAccount"; the API surface name "student-accounts" was inherited from the existing controller and adopted rather than renamed for back-compat.
- **Service signature corrected** — `setOpeningBalance(schoolId, accountId, amount, asOf, note, context)` — `schoolId` is the FIRST parameter (Phase D P1.1 cross-school-bypass fix). The plan originally omitted it because the bypass risk wasn't surfaced until the review.
- **PD.2 scope clarifications** explicitly carried into the deferral table:
  - **Opening-balance-only payments (no invoice)** — DEFERRED to V1.5. Originally listed as PD.2.3 case 6 ("No invoices, only opening → payment fully against opening"). Implementation scope-cleared per discovery-workflow finding: would have required migrating 27 `payment.invoiceId` read sites with high regression risk. Operator workaround for opening-only settlement: issue a $0 placeholder invoice first OR wait for the next regular invoice.
  - **Credit-memo overflow** — DEFERRED to V1.5. Originally listed as PD.2.3 case 5 ("excess routes to existing credit-memo flow"). Implementation discovery confirmed no credit-memo flow exists in pre-PD code; PD.2.3 instead rejects with `PAYMENT_EXCEEDS_ALLOCATABLE`.
  - **Partial refund on split payment** — DEFERRED. NEW error code `PAYMENT_REFUND_SPLIT_PARTIAL_UNSUPPORTED`. Operator workaround: void + re-record.
  - **Gateway-path split** (eSewa/Khalti) — DEFERRED. Gateway amount fixed at initiate-redirect time; `completePayment` stays single-invoice for V1.
- **Schema-level invariants extended** beyond Σ-sum:
  - At most ONE `'invoice'` application
  - At most ONE `'opening_balance'` application
  - `'invoice'` application appears FIRST when present (ledger ordering)
  - Top-level `payment.invoiceId` mirrors first invoice application's `invoiceId`
  All four codified in `paymentResponseSchema.superRefine()`.
- **PD.1.6** retroactively replaced ledger-scan with denormalized `openingBalanceSettled` counter on `BillingAccountEntity` (PD.1.6-rev1, commit `decadfc`). Mapper computes `openingBalanceRemaining = openingBalance − openingBalanceSettled`. PD.2.3 maintains the counter atomically in the same TransactWriteItems.
- **CONC-9** corrected the "payment wins" claim — actual semantics are last-write-wins via optimistic version check; loser gets 409, UI retries.
- **PD.4.2 CloudWatch alarm** explicitly deferred to a follow-up PR (analytics-stack CDK change is out of PR-PD scope).

Mechanical fixes (no scope change): stale line numbers refreshed where they had drifted; spec file paths verified against the actual on-disk shapes.

PR-CA scope (Custom Yearly Fee Agreement) is unchanged at v1.1.

## 1. Context

EdForge today registers students and auto-creates a `BillingAccount` (via the enrollment-completed webhook) but offers no way to record financial state that originated *before* EdForge, and no way to record a per-student annual fee deal that *overrides* the school's standard catalog. The pilot operator cannot cleanly onboard a single returning student without these.

This plan delivers both as **two atomic PRs**, deployable independently:

- **PR-PD** — Previous Dues (Opening Balance on `BillingAccount`)
- **PR-CA** — Custom Yearly Fee Agreement (new `StudentFeeAgreement` entity)

Either can land or roll back first. PR-CA's module-wiring spec extends PR-PD's seed spec (see §5 sequencing).

## 2. Architecture & invariants

### Reuse, never reinvent

| New capability | Built by extending | Not by |
|---|---|---|
| Opening balance state | New optional fields on existing `BillingAccountEntity` | A new entity |
| Opening balance ledger | New enum value `'opening_balance'` on existing `ledgerEntryTypeEnum` (5→6 values) | A new ledger type |
| Opening balance revisions | Existing `'adjustment'` enum value | A new "revision" type |
| Opening balance writes | New methods on existing `StudentAccountsService` (no `BillingAccountsService` exists; this IS the canonical lifecycle service) | New service |
| Audit | Existing `FinanceAuditService.emit()` + extend `FinanceAuditEventType` union | New audit pipe |
| Idempotency on write endpoints | Existing `@Idempotent()` decorator + globally-registered `IdempotentInterceptor` | New mechanism |
| Atomic multi-row writes | Composite TransactWriteItems helper (extends the `buildLedgerEntryTransactItems` pattern at [`student-accounts.service.ts:300`](server/application/microservices/finance/src/student-accounts/student-accounts.service.ts#L300)) | Direct chained writes |
| Custom agreement persistence | New entity on the **same finance table**; reuses existing GSI1 (school-scoped) + GSI2 (student-scoped) | A new GSI |
| ABAC permission scope | Existing `billing:manage` for writes, `billing:view` for reads | New scope |
| Permission decorator | `@RequirePermission({ resource, action, schoolIdParam })` from [`@app/auth`](server/application/microservices/libs/auth) | New decorator |
| Module wiring | Create [`finance/__tests__/module-wiring.spec.ts`](server/application/microservices/finance/src/__tests__/) (does not exist for finance today — pre-existing gap; identity + academics have one) | Skipping the gate |
| Route registration | Three-way handoff: Nest controller + [`tenant-api-prod.json`](server/lib/tenant-api-prod.json) + `lint:routes`. nginx untouched: [`nginx.template:218`](server/application/reverseproxy/nginx.template#L218) (`location ~ ^/finance` covers everything under `/finance/*`) | Bypassing the linter |
| Frontend service URLs | Route-shape guard tests pin every URL (per `feedback_pin_service_urls_with_guard_tests`) | Unguarded fetches |
| Shared-types bump | rc-pin-then-final-bump protocol (see §5) | Drive-by pin bump |

### Archetype & scalability invariants

- **PABSON archetype**: BillingAccount currency comes from tenant `WorkspaceSettings` (NPR by default). BS dates handled at UI converter (existing `BsDatePicker`); AD `YYYY-MM-DD` stored at rest. **No `country === 'NPL'` branches** — enforced by `scripts/lint/check-no-country-branch.sh` CI invariant.
- **Ed-Fi**: financial data is outside Ed-Fi v6 scope. IEMIS Flash I/II exports are unaffected by either feature. No Ed-Fi mapping required.
- **Scalability**:
  - Opening balance: O(1) read (BillingAccount lookup), O(1) write (single PK row + ledger append). No new GSI.
  - `StudentFeeAgreement`: O(1) read by primary key (per-student-per-AY lookup). Listing by school+AY via existing GSI1; listing by student via existing GSI2.
  - `InvoicesService.generate()` gets ONE additional `GetItem` per invoice (agreement lookup). Bulk-generate amortizes; Sprint C of Bulk Ops EPIC can prefetch agreements per batch later if profiling demands.
- **Two orthogonal axes preserved**: agreement has `status` (workflow: `active`/`voided`) and `isActive` (soft-delete bit). Per the `[P1d]` rule documented in CLAUDE.md, response DTO **omits** `isActive`. Status `voided` always implies `isActive=false`; regression-tested at CA.1.1.

### Recent merge awareness

- **`@aibrains/shared-types` is at `0.84.0` on `main`** (post-attendance work).
- **Sprint A (PR #323)** — gradeLevel snapshot + GSI14 + listBySchoolAndGrade + backfill — bumps to `0.85.0`. **Must merge BEFORE either pilot PR opens** so the shared-types lineage is sequential. PR-PD then bumps to `0.86.0`; PR-CA to `0.87.0`.
- **Finance has `IdempotentInterceptor` globally registered** ([`finance.module.ts:68`](server/application/microservices/finance/src/finance.module.ts#L68)). New pilot endpoints get `@Idempotent()` for free.
- **`FinanceAuditService`** is the canonical audit pipe — both PRs extend its `FinanceAuditEventType` union.
- **Attendance work** added `homeroomGradeLevel` first-class on sections — does not interact with billing.
- **`generateBulk()` is at [`invoices.service.ts:991`](server/application/microservices/finance/src/invoices/invoices.service.ts#L991)** — current line is post-Sprint-A.
- **Sprint A.1 `gradeLevel` snapshot block** at [`invoices.service.ts:178-260`](server/application/microservices/finance/src/invoices/invoices.service.ts#L178-L260) — agreement branch in PR-CA goes **before** this block so the snapshot logic continues to run on the agreement path.

---

## 3. PR-PD — Previous Dues (Opening Balance)

### Sprint PD.0 — Shared-types extension + audit-event surface + module-wiring seed

**Goal:** Contracts ready for backend implementation in PD.1. Module-wiring spec exists BEFORE new providers land (so the gate is in place at the touch).

**Demo:** `cd packages/shared-types && npm test` shows new enum case green; `finance-audit.service.spec.ts` new cases green; `npx jest --testPathPattern="__tests__/module-wiring"` in finance passes against the current provider set.

#### PD.0.1 — Extend `ledgerEntryTypeEnum` with `'opening_balance'`
- **File:** [`packages/shared-types/src/schemas/finance/common.ts:110-117`](packages/shared-types/src/schemas/finance/common.ts#L110-L117)
- **Change:** Append `'opening_balance'` to the enum. JSDoc the semantics: "carry-forward of money owed prior to EdForge — set once via `setOpeningBalance` at BillingAccount setup; revised via `'adjustment'` entries (never overwritten — preserves append-only ledger)."
- **Test:** [`packages/shared-types/src/schemas/finance/common.spec.ts`](packages/shared-types/src/schemas/finance/common.spec.ts) (NEW if missing) — 2 cases: enum parses `'opening_balance'`; rejects `'foo'`. **Note**: use `z.string().date()` not `z.iso.date()` (v4-only API per CLAUDE.md zod pin).

#### PD.0.2 — Add audit event types for opening-balance lifecycle
- **File:** [`server/application/microservices/finance/src/common/entities/finance-audit-event.entity.ts`](server/application/microservices/finance/src/common/entities/finance-audit-event.entity.ts)
- **Change:** Extend `FinanceAuditEventType` union with: `'finance.opening_balance.set'`, `'finance.opening_balance.revised'`.
- **Test:** [`finance-audit.service.spec.ts`](server/application/microservices/finance/src/common/services/finance-audit.service.spec.ts) — 2 new cases asserting `emit()` writes the expected DDB row + CloudWatch line shape for each new event type.

#### PD.0.3 — Create `finance/__tests__/module-wiring.spec.ts` (pay down pre-existing CLAUDE.md gap)
- **File:** [`server/application/microservices/finance/src/__tests__/module-wiring.spec.ts`](server/application/microservices/finance/src/__tests__/) (NEW)
- **Reference:** copy structure from [`server/application/microservices/identity/src/__tests__/module-wiring.spec.ts`](server/application/microservices/identity/src/__tests__/module-wiring.spec.ts).
- **Watchlist (EXHAUSTIVE):** boot `FinanceModule` via `NestJS Test` and assert each is resolvable: `StudentAccountsService`, `InvoicesService`, `PaymentsService`, `FinanceAuditService`, `IdempotencyService`, `EnrollmentBillingService`, `RecurringBillingService` (if present), `OverdueDetectionService` (if present), `PaymentSweepService` (if present), `BillingReconciliationService` (if present), `CreditNotesService`, `RefundsService`, `DiscountRulesService`, `FeeStructuresService`, `DashboardService`, `IdentityClientService`, `DynamoDBClientService`, `FinanceEventsService`, all PDF renderers.
- **Also asserts:** `IdempotentInterceptor` is registered as `APP_INTERCEPTOR` (the actual wiring at [`finance.module.ts:68`](server/application/microservices/finance/src/finance.module.ts#L68)).
- **Why first:** CLAUDE.md memory `feedback_module_wiring_invariant` mandates this for every consumer. Landing the seed spec FIRST means the gate is in place when PD.1 / CA.1 add new providers — caught at the wiring change, not after services have shipped.
- **Test:** the spec itself.

#### PD.0.4 — DTO schemas for opening balance + back-compat regression test
- **Files:**
  - [`packages/shared-types/src/schemas/finance/billing-account.schema.ts`](packages/shared-types/src/schemas/finance/billing-account.schema.ts) — define `setOpeningBalanceSchema`: `{ amount: z.number().nonnegative(), asOf: z.string().date().refine(d => d <= today), note: z.string().max(500).optional() }`. Extend `billingAccountResponseSchema` with optional `openingBalance`, `openingBalanceAsOf`, `openingBalanceNote`, `openingBalanceRemaining` (all optional for back-compat).
  - **Test:** [`billing-account.schema.spec.ts`](packages/shared-types/src/schemas/finance/billing-account.schema.spec.ts) — 6 cases:
    1. Valid `setOpeningBalance` shape parses.
    2. Negative amount rejected.
    3. Future asOf rejected.
    4. Pre-PD response (no opening-balance fields) parses (back-compat).
    5. Post-PD response (all fields present) parses.
    6. `openingBalanceRemaining` derives validly from int subtraction.

#### PD.0.5 — Bump `@aibrains/shared-types` 0.85.0 → 0.86.0-rc.1; consumer pin updates
- **Files:** [`packages/shared-types/package.json`](packages/shared-types/package.json), [`server/package.json`](server/package.json), [`server/application/package.json`](server/application/package.json), root [`package-lock.json`](package-lock.json) refresh.
- **Protocol (rc-then-final to dodge the caret-pin pitfall):**
  1. Bump to `0.86.0-rc.1` and publish from feature branch.
  2. Update consumer pins to `~0.86.0-rc.1`.
  3. Open PR; CI green.
  4. Immediately before merge: bump to `0.86.0`, publish, push, re-run CI, merge within 10 minutes.
- **Test:** `cd packages/shared-types && npm run build` + `cd server/application && npx nest build finance` + `cd server && npx tsc -p tsconfig.cdk.json` all clean.

---

### Sprint PD.1 — Backend data model + service method + endpoint

**Goal:** `BillingAccount` carries opening-balance fields; `setOpeningBalance()` writes ledger + account update + audit emit atomically. `PUT /finance/schools/:schoolId/student-accounts/:accountId/opening-balance` is live.

**Demo (curl):** Create a BillingAccount, PUT opening balance, GET the account — see new fields populated, `openingBalanceRemaining` matches `openingBalance` (no settlements yet), one `opening_balance` ledger row exists, one `finance.opening_balance.set` audit row exists. PUT again with new amount → `adjustment` ledger row + `finance.opening_balance.revised` audit row.

#### PD.1.1 — Extend `BillingAccountEntity` fields + back-compat default
- **File:** [`billing-account.entity.ts`](server/application/microservices/finance/src/common/entities/billing-account.entity.ts)
- **Change:** Add three optional fields:
  ```ts
  openingBalance?: number;            // current effective opening balance (after any revisions)
  openingBalanceAsOf?: string;        // AD 'YYYY-MM-DD'
  openingBalanceNote?: string;        // operator note (≤ 500 chars)
  ```
  Default in `createBillingAccountEntity`: all three undefined.
- **Architecture note:** We deliberately store only the **current effective** value. The audit trail (`finance.opening_balance.revised` events) carries `{oldAmount, newAmount, delta}` for reconstruction. Original opening balance is recoverable from the FIRST `finance.opening_balance.set` audit event. We do NOT store `originalOpeningBalance` as a separate field — keeping the entity narrow and the audit trail authoritative.
- **Test:** [`billing-account.entity.spec.ts`](server/application/microservices/finance/src/common/entities/billing-account.entity.spec.ts) (NEW) — 3 cases: factory defaults; explicit set; mapper back-compat (pre-PD row round-trips).

#### PD.1.2 — `LedgerEntry` factory accepts `'opening_balance'` entryType
- **File:** [`ledger-entry.entity.spec.ts`](server/application/microservices/finance/src/common/entities/ledger-entry.entity.spec.ts) (extend if exists; NEW otherwise)
- **Change:** 1 new case asserting `createLedgerEntryEntity(..., entryType: 'opening_balance', ...)` produces a valid entity with `LEDGER#{accountId}#{entryId}` SK.

#### PD.1.3 — Composite TransactWriteItems helper for N-ledger / single-account-delta writes
- **File:** [`student-accounts.service.ts`](server/application/microservices/finance/src/student-accounts/student-accounts.service.ts)
- **Why this is its own ticket:** the existing `buildLedgerEntryTransactItems` at [line 300](server/application/microservices/finance/src/student-accounts/student-accounts.service.ts#L300) builds ONE ledger Put + ONE account Update. DDB rejects duplicate keys in one `TransactWriteItems` — so PD.2 (payment + opening-balance settlement) cannot fold two ledger writes against the same account UNLESS we compose them into N ledger Puts + a SINGLE account Update with the summed delta. Build that helper here as reusable infra.
- **New method:** `buildCompositeLedgerTransactItems(accountId, ledgerInputs: LedgerInput[], context)` returning `{ items: TransactWriteItem[], ledgerEntries: LedgerEntryEntity[], summedDelta: number }`.
- **Existing `buildLedgerEntryTransactItems` stays unchanged** — single-row callers don't move.
- **Test:** [`student-accounts.service.composite-ledger.spec.ts`](server/application/microservices/finance/src/student-accounts/student-accounts.service.composite-ledger.spec.ts) (NEW) — 5 cases: 1 entry equals existing helper; 2 entries with opposite signs; 3 entries summed delta correct; version-mismatch produces TCE; entries appear in insertion order in the returned array.

#### PD.1.4 — `StudentAccountsService.setOpeningBalance()` method
- **File:** [`student-accounts.service.ts`](server/application/microservices/finance/src/student-accounts/student-accounts.service.ts) (extend; do not fork)
- **Signature:**
  ```ts
  async setOpeningBalance(
    accountId: string,
    amount: number,
    asOf: string,
    note: string | undefined,
    context: RequestContext,
  ): Promise<{ account: BillingAccountEntity; ledgerEntryId: string; isRevision: boolean }>
  ```
- **Logic:**
  - GetItem account; `NotFoundException` if missing.
  - **First-time set** (`account.openingBalance == null`):
    - Build one `'opening_balance'` ledger entry (debit=amount, balance=account.balance+amount, date=today).
    - Single TransactWriteItems via `buildCompositeLedgerTransactItems` containing the ledger Put + an account Update setting (openingBalance / openingBalanceAsOf / openingBalanceNote / balance += amount / version++).
    - Emit `finance.opening_balance.set` audit.
  - **Revision** (`account.openingBalance != null`):
    - delta = amount − account.openingBalance.
    - **delta === 0**: idempotent no-op for amount. Single UpdateItem updating only asOf/note (NO version bump — avoids unnecessary 409s for concurrent payments). No ledger entry. No audit event. Return existing.
    - **delta ≠ 0**: build one `'adjustment'` ledger entry (description=`"Opening balance revision: {old} → {new}"`, debit=max(delta,0), credit=max(−delta,0), balance=account.balance+delta). Single TransactWriteItems with ledger Put + account Update (set 3 fields + balance += delta + version++). Emit `finance.opening_balance.revised` audit with `{oldAmount, newAmount, delta}` payload.
  - **Validation:**
    - amount ≥ 0 (V1 — credit-note is the path for advance payments).
    - asOf must parse as YYYY-MM-DD AND be ≤ today.
    - note ≤ 500 chars.
    - Revision down to 0 IS allowed (operator may have entered the wrong number); emits `adjustment` with credit=oldAmount.
  - **Concurrency rule (codified):** when `setOpeningBalance` and `recordManualPayment` race, the PAYMENT wins (more frequent operation, automatic retry is operator-invisible). `setOpeningBalance` returns 409 `CONCURRENT_UPDATE`; UI surfaces a "Try again — another change just landed" toast. Documented in runbook.
- **Test:** [`student-accounts.service.setOpeningBalance.spec.ts`](server/application/microservices/finance/src/student-accounts/student-accounts.service.setOpeningBalance.spec.ts) (NEW) — 12 cases:
  1. First-time set → ledger entry + account update + audit emit (all three).
  2. First-time set on account with non-zero existing balance from prior invoices → balance += openingBalance correctly.
  3. Revision new > old → `adjustment` with positive debit.
  4. Revision new < old → `adjustment` with positive credit.
  5. Revision new = old → idempotent no-op for amount; asOf/note still update (single UpdateItem); version NOT bumped; no ledger; no audit.
  6. Revision down to 0 → `adjustment` with full credit; account.openingBalance = 0 (not undefined).
  7. Negative amount → `BadRequestException`.
  8. Future asOf date → `BadRequestException`.
  9. Account not found → `NotFoundException`.
  10. Concurrent set + payment race → `TransactionCanceledException` → `ConflictException` 409 with `code: 'CONCURRENT_UPDATE'` (uses `aws-sdk-client-mock` to simulate the race; mirrors pattern in [`payments.service.spec.ts`](server/application/microservices/finance/src/payments/payments.service.spec.ts) per memory `project_sprint_C2_B_T4_atomic_payment_shipped`).
  11. Note > 500 chars → `BadRequestException`.
  12. asOf with malformed date string → `BadRequestException`.

#### PD.1.5 — `PUT /finance/schools/:schoolId/student-accounts/:accountId/opening-balance` endpoint
- **File:** [`student-accounts.controller.ts`](server/application/microservices/finance/src/student-accounts/student-accounts.controller.ts) (extend; do not fork)
- **Route shape note:** Route includes `:schoolId` so `@RequirePermission` resolves `schoolIdParam: 'schoolId'` naturally — matches every other write controller in finance (e.g., `payments.controller.ts`).
- **Method:**
  ```ts
  @Put('schools/:schoolId/student-accounts/:accountId/opening-balance')
  @RequirePermission({ resource: 'billing', action: 'manage', schoolIdParam: 'schoolId' })
  @Idempotent()
  @UseZodGuard('body', setOpeningBalanceSchema)
  async setOpeningBalance(
    @Param('schoolId') schoolId: string,
    @Param('accountId') accountId: string,
    @Body() dto,
    @Req() req,
  )
  ```
- **Returns:** updated `BillingAccount` DTO with the new fields + server-computed `openingBalanceRemaining`.
- **Test:** [`student-accounts.controller.setOpeningBalance.spec.ts`](server/application/microservices/finance/src/student-accounts/student-accounts.controller.setOpeningBalance.spec.ts) (NEW) — 5 cases:
  1. Happy path → 200 with new fields.
  2. Zod validation failure (negative amount) → 400.
  3. Cross-school access → 404 (404-not-403 contract).
  4. Missing `Idempotency-Key` header → middleware-enforced behavior matches existing pattern.
  5. **Idempotency replay**: two POSTs with the same `Idempotency-Key` invoke the handler ONCE; second returns the original response. (Mirrors [`idempotent.interceptor.wiring.spec.ts:197`](server/application/microservices/finance/src/common/interceptors/idempotent.interceptor.wiring.spec.ts#L197).)

#### PD.1.6 — `BillingAccount` response mapper extension + server-side `openingBalanceRemaining`
- **File:** [`billing-account.mapper.ts`](server/application/microservices/finance/src/common/mappers/billing-account.mapper.ts)
- **Change:** Pass through the 3 new fields when present. **Compute `openingBalanceRemaining` server-side** = `openingBalance` − (sum of `'payment'` ledger entries with `description LIKE 'Payment allocated against opening balance%'`). For PD.1, no settlements exist yet, so remaining = openingBalance. PD.2 makes this meaningful.
- **Why server-side:** Per review heuristic — every consumer (mobile? reports?) would otherwise reinvent the math.
- **Test:** [`billing-account.mapper.spec.ts`](server/application/microservices/finance/src/common/mappers/billing-account.mapper.spec.ts) (extend) — 4 cases: pre-PD account (no opening fields); post-PD account no settlements (remaining = full); post-PD account with simulated settlements (remaining = openingBalance − settled).

#### PD.1.7 — API Gateway route registration
- **File:** [`server/lib/tenant-api-prod.json`](server/lib/tenant-api-prod.json)
- **Change:** Register `PUT /finance/schools/{schoolId}/student-accounts/{accountId}/opening-balance` with `Idempotency-Key` header in `parameters`.
- **Test:** `npm run lint:routes` lists the new route as registered (no drift).
- **nginx:** untouched (`^/finance` covers — verified at `nginx.template:218`).

#### PD.1.8 — Update module-wiring spec with new providers
- **File:** [`finance/__tests__/module-wiring.spec.ts`](server/application/microservices/finance/src/__tests__/module-wiring.spec.ts) (created in PD.0.3)
- **Change:** None — PD.1 added no NEW providers (just methods on existing services). The seed watchlist already covers `StudentAccountsService`.
- **Test:** spec still green; verifies PD.1's new endpoint is reachable from a booted module (asserts the controller is registered).

#### PD.1.9 — Smoke harness scaffold + opening-balance lifecycle case
- **File:** [`scripts/smoke-tests/finance-pilot-onboarding.ts`](scripts/smoke-tests/finance-pilot-onboarding.ts) (NEW)
- **Register in:** [`scripts/smoke-tests/index.ts`](scripts/smoke-tests/index.ts) (mirroring `finance-billing-flow.ts`).
- **Cases:**
  1. PUT opening balance on a fresh account → 200 + new fields populated.
  2. GET account → fields persist + `openingBalanceRemaining` matches.
  3. PUT same value again → idempotent (200 with no version bump, no new audit row).
  4. PUT new value → 200 + `adjustment` ledger row appears + `revised` audit row.
- **Test:** smoke exits 0 against dev-pabson-primary.

---

### Sprint PD.2 — Payment allocation honors opening balance

**Goal:** When payments are recorded, opening balance is settled. Account balance correctly reflects remaining. PDF receipt shows the allocation breakdown.

**Demo (curl):** Account `openingBalance=5000` + one invoice `2000` → balance=7000. Record payment of 3000 → balance=4000. Ledger shows 4 rows: opening_balance, invoice, payment-against-invoice, payment-against-opening. Receipt PDF shows the split allocation.

#### PD.2.1 — Introduce `PaymentEntity.applications[]` array (NET-NEW field)
- **File:** [`payment.entity.ts`](server/application/microservices/finance/src/common/entities/payment.entity.ts)
- **Why:** Today `PaymentEntity` carries a single scalar `invoiceId` field (line 32). For multi-target allocations, introduce a new optional `applications?: PaymentApplication[]` array where each entry is a discriminated union:
  ```ts
  type PaymentApplication =
    | { targetType: 'invoice'; invoiceId: string; amount: number }
    | { targetType: 'opening_balance'; amount: number };
  ```
- **Back-compat policy (v1.1):**
  - Pre-PD payments: `applications` undefined; `invoiceId` carries the legacy single-invoice target.
  - Post-PD payments: `applications` populated with exactly ONE `'invoice'` entry FIRST (whose `invoiceId` matches the top-level `payment.invoiceId`) + OPTIONAL second `'opening_balance'` entry. The top-level `invoiceId` always remains populated (V1 doesn't support opening-only payments via `recordManualPayment` — that's the V1.5 deferral). The 27 pre-existing `payment.invoiceId` read sites (`dashboard.service.ts`, `payment-sweep.service.ts`, `payments.service.ts`) continue to work unchanged.
- **Schema-level invariants (PR #330 review P2.2):** `paymentResponseSchema.superRefine()` enforces all 4 invariants — Σ(applications) === amount, at-most-1 of each `targetType`, invoice-first ordering, top-level `invoiceId` matches first invoice application.
- **Pre-PR action item:** scan production payment rows to confirm the legacy shape (no operator has manually populated `applications` on a custom path). Sample DDB Query: `aws dynamodb query --table-name edforge-finance-basic --key-condition-expression "entityKey BETWEEN :a AND :b" --expression-attribute-values '{":a":{"S":"PAYMENT#"},":b":{"S":"PAYMENT$"}}' --limit 50`.
- **Test:** [`payment.entity.applications.spec.ts`](server/application/microservices/finance/src/common/entities/payment.entity.applications.spec.ts) (NEW) — 4 cases: factory defaults; explicit applications array; mixed-target invariant; legacy shape parses (back-compat).

#### PD.2.2 — `paymentResponseSchema` + mapper updates
- **Files:**
  - [`packages/shared-types/src/schemas/finance/payment.schema.ts`](packages/shared-types/src/schemas/finance/payment.schema.ts) — extend `paymentResponseSchema` with `applications?: PaymentApplication[]`.
  - [`payment.mapper.ts`](server/application/microservices/finance/src/common/mappers/payment.mapper.ts) — pass through.
- **Test:** schema spec (extended with 7 P2.2-invariant cases) + mapper spec (3 cases: legacy single-invoice, split-allocation, composition with gradeLevel + enrichment fields).

#### PD.2.3 — Payment allocation logic in `recordManualPayment` + gateway `completePayment`
- **File:** [`payments.service.ts`](server/application/microservices/finance/src/payments/payments.service.ts)
- **Change (after existing invoice-allocation loop):**
  - If `remaining payment > 0` AND `account.openingBalance > settledAgainstOpening`:
    - Compute settle = min(remaining, openingBalance − alreadySettled).
    - Append `{ targetType: 'opening_balance', amount: settle }` to `applications[]`.
    - Add ONE `'payment'` ledger entry: debit=0, credit=settle, description=`"Payment allocated against opening balance"`.
    - Account update: balance −= settle (added to the same sum-delta that existing invoice-allocation produces).
  - **Ordering contract (codified):** invoice allocations happen FIRST (older debt), opening-balance settlement happens AFTER (carry-forward). Ledger entries appear in this order in the array.
  - All inside a SINGLE TransactWriteItems block built via `buildCompositeLedgerTransactItems` (from PD.1.3).
- **Test:** [`payments.service.recordManualPayment.openingBalance.spec.ts`](server/application/microservices/finance/src/payments/payments.service.recordManualPayment.openingBalance.spec.ts) (NEW) — 13 cases (post-v1.1):
  1. Payment < invoice debt → no opening settlement (existing behavior unchanged).
  2. Payment = invoice debt → no opening settlement.
  3. Payment > invoice debt but < (invoice + opening) → partial opening settlement.
  4. Payment = invoice + opening → full opening settlement.
  5. **v1.1:** Payment > invoice + opening → `400 PAYMENT_EXCEEDS_ALLOCATABLE`; zero DDB writes. *(Pre-v1.1 said "excess routes to credit-memo flow" — no such flow exists; deferred to V1.5.)*
  6. Account WITHOUT openingBalance set → pre-PD behavior (single invoice application, no opening logic invoked).
  7. **Ledger ordering**: assert invoice ledger entry appears before opening-balance ledger entry in the array.
  8. `if_not_exists` for sparse counter (first settlement on a PD account whose counter was never written).
  9. Concurrent setOpeningBalance race → 409 `CONCURRENT_UPDATE` with dynamic per-application labels.
  10. Account row missing → 404 `ACCOUNT_NOT_FOUND` (no writes).
  11. **CONC-7:** paidDate < openingBalanceAsOf → 400 `PAYMENT_PAID_DATE_BEFORE_OPENING_AS_OF` (no writes).
  12. **CONC-7 boundary:** paidDate === openingBalanceAsOf → allowed (same-day permitted).
  13. **CONC-7 sparse:** account without openingBalanceAsOf → no chronology check (pre-PD accounts).

**v1.1 DEFERRED — "No invoices, only opening" payment shape:** the originally-planned PD.2.3 case 6 ("No invoices, only opening → payment fully allocated") is deferred to V1.5. The implementation would have required migrating 27 `payment.invoiceId` read sites (`dashboard.service.ts`, `payment-sweep.service.ts`, several methods in `payments.service.ts`) with high regression risk. Operator workaround for opening-only settlement: issue a $0 placeholder invoice first OR wait for the next regular invoice and let the overflow auto-allocate.

#### PD.2.4 — Receipt PDF shows allocation breakdown
- **File:** [`receipt-pdf.renderer.ts`](server/application/microservices/finance/src/payments/receipt-pdf.renderer.ts)
- **Change:** When `payment.applications` is present + has > 1 entry, render an "Applied to:" section listing each application target (invoice number + amount, opening balance + amount). Single-target payments render the existing layout unchanged (back-compat).
- **Test:** added to existing [`receipt-pdf.renderer.spec.ts`](server/application/microservices/finance/src/payments/receipt-pdf.renderer.spec.ts) (5 new cases post-v1.1): legacy single-invoice unchanged; split-allocation renders `Applied: ...` note; locale-aware amount formatting (`ne-NP` vs `en-US`); `applications=[invoice-only]` produces no extra note (existing layout sufficient); **CORR-6** integrity assertion — mismatched `invoiceId` between application and rendered invoice throws rather than silently mis-attribute.

#### PD.2.5 — Smoke harness extension
- **File:** `scripts/smoke-tests/finance-pilot-onboarding.ts`
- **Opt-in via env:** `INVOICE_ID` — operator pre-creates an issued invoice on the account; the smoke records a payment against it. Skip the PD.2 cases when not set.
- **Cases (post-v1.1):**
  - Baseline: fetch invoice + account to compute the planned split amount (`invoiceDue + ≤100 partial opening`).
  - Record split payment via `POST /finance/schools/:schoolId/payments/manual` ⇒ 200/201 + `applications` has 2 entries (invoice + opening) in expected amounts.
  - GET account confirms `openingBalanceRemaining` decreased by the opening-allocated amount; `openingBalance` itself unchanged (PD.1.6 counter contract).
  - Ledger ordering: both payment ledger entries present after the split write.
  - Overpayment: amount > `(invoiceDue + openingRemaining)` ⇒ 400 `PAYMENT_EXCEEDS_ALLOCATABLE`; self-skips if the prior step fully settled the invoice.

**v1.1 DEFERRED — Pure opening-balance payment smoke case:** the originally-planned case ("Pure opening-balance payment (no invoice) → fully allocated") is deferred alongside the PD.2.3 case 6 deferral above. V1 supports only invoice + opening splits; opening-only payments require V1.5 work on the 27 read sites.

---

### Sprint PD.3 — Frontend

**Goal:** Operator enters previous dues at registration; sees opening balance + remaining prominently in the ledger view; can revise via edit modal with explicit confirmation.

**Demo:** Browser walkthrough at the URLs below.

#### PD.3.1 — Client service + route-shape guard
- **Files:**
  - [`edforge-saas-frontend/packages/finance-services/src/services/student-accounts.service.ts`](edforge-saas-frontend/packages/finance-services/src/services/student-accounts.service.ts) — add `setOpeningBalance(schoolId, accountId, payload)` calling `PUT /finance/schools/{schoolId}/student-accounts/{accountId}/opening-balance` with `Idempotency-Key: <uuid>`.
  - [`packages/finance-services/src/__tests__/billing-accounts-routes.test.ts`](edforge-saas-frontend/packages/finance-services/src/__tests__/billing-accounts-routes.test.ts) (extend or NEW) — pin exact URL.

#### PD.3.2 — `useSetOpeningBalance` TanStack hook
- **File:** [`packages/finance-services/src/hooks/useSetOpeningBalance.ts`](edforge-saas-frontend/packages/finance-services/src/hooks/useSetOpeningBalance.ts) (NEW)
- **Behavior:** Mutation hook; invalidates `billingAccountsKeys.detail(accountId)` + the ledger query key on success.
- **Test:** vitest hook test (TanStack Query test harness).

#### PD.3.3 — Registration wizard — add "Financial Setup" step (previous-dues fields ONLY)
- **Route trace (verified):** URL `/academics/enrollment` → [`apps/academics/src/routes/enrollment/index.tsx:364`](edforge-saas-frontend/apps/academics/src/routes/enrollment/index.tsx#L364) renders `<RegistrationWizard />` when `activeTab === 'registration'`. The wizard component lives at [`apps/academics/src/components/students/registration/RegistrationWizard.tsx`](edforge-saas-frontend/apps/academics/src/components/students/registration/RegistrationWizard.tsx).
- **Change:** Insert a new step "Financial setup (optional)" before final submit.
- **Fields (PR-PD scope ONLY):** `previousDues` (currency-aware number input, default currency from tenant settings → NPR for PABSON), `previousDuesAsOf` (`BsDatePicker` → emits AD `YYYY-MM-DD`), `previousDuesNote` (textarea, ≤ 500 chars with counter).
- **Placeholder for PR-CA:** include a `<EmptyAgreementSlot />` component that PR-CA replaces with the agreement collapsible. Prevents merge conflicts (see §5 sequencing).
- **Submit flow:**
  - After student creation succeeds → look up the auto-created BillingAccount (via existing accounts hook).
  - If `previousDues > 0` → PUT opening balance.
  - **Error-recovery UX (per review):** if the PUT fails after student-create succeeds, present an explicit reconciliation modal: "Student created successfully, but setting Previous Dues failed: {error}. The student exists with no opening balance — would you like to retry?" with [Retry] / [Skip — set later in Edit Student] buttons. NO silent failure.
- **Test:** operator-visual at `/academics/enrollment?tab=registration` via `pnpm dev:academics`; round-trip data through the network; deliberately fail the PUT (e.g., 500 in DevTools network) and verify the reconciliation modal appears.

#### PD.3.4 — `EditStudentModal` — Financial section with revision confirmation
- **File:** [`apps/academics/src/components/students/EditStudentModal.tsx`](edforge-saas-frontend/apps/academics/src/components/students/EditStudentModal.tsx)
- **Change:** Add collapsible "Financial" section with same fields as PD.3.3, prefilled from current BillingAccount.
- **Revision UX:** On submit, if the amount changed from the prefilled value (revision case), present a confirmation modal: "Revising the previous dues from NPR {old} to NPR {new}? This creates an audit-trailed adjustment ledger entry; the original opening balance entry stays in the ledger." with [Confirm] / [Cancel]. Below the inputs: read-only "Last set: {ts} by {user}" line.
- **Test:** operator-visual; verify the confirmation modal appears only when amount changed (not when only note edited).

#### PD.3.5 — Billing Accounts page — opening balance summary card
- **Route trace (verified):** URL `/finance/billing/accounts` → [`apps/finance/src/routes/billing/accounts/index.tsx`](edforge-saas-frontend/apps/finance/src/routes/billing/accounts/index.tsx).
- **Change:** In the expanded-row ledger view, prepend an "Opening balance" summary card:
  - Amount (formatted via tenant currency formatter)
  - As of date (rendered via existing `<TenantDate>` component — BS for PABSON tenants)
  - **Remaining** (uses server-computed `openingBalanceRemaining` from PD.1.6, NOT client-derived)
  - Note (truncated with click-to-expand)
- The `opening_balance` ledger row continues to render in the entry list; the summary card is the at-a-glance.
- **Test:** vitest snapshot + operator-visual.

#### PD.3.6 — Route-shape guard tests
- **File:** `packages/finance-services/src/__tests__/billing-accounts-routes.test.ts` (already extended in PD.3.1)
- **Test:** vitest passes.

---

### Sprint PD.4 — Runbook + observability + cutover

**Goal:** Ops documentation; CloudWatch alarm wired; ship to prod.

**Demo:** Runbook reviewed by one other engineer; alarm visible in CloudWatch console; production rollout completes with green smoke + 24h monitor.

#### PD.4.1 — Runbook
- **File:** [`docs/operations/finance-previous-dues-runbook.md`](docs/operations/finance-previous-dues-runbook.md) (NEW)
- **Required sections (codified — do not skip):**
  1. **What this feature does** — one-paragraph operator-facing summary.
  2. **Operator how-to** — step-by-step for setting + revising opening balance, with screenshots.
  3. **Field-by-field interpretation** — `openingBalance`, `openingBalanceAsOf`, `openingBalanceNote`, `openingBalanceRemaining`.
  4. **Payment-allocation behavior** — when a payment is recorded, how it splits across invoices and opening balance; ordering contract.
  5. **Common failure modes + diagnosis**:
     - 409 ConflictException → concurrent edit; retry.
     - Student created but balance set failed → reconciliation modal in UI; or use Edit Student.
     - Audit row missing → check `FinanceAuditService` DDB rows + CloudWatch namespace.
  6. **Audit-query examples** — DDB Query (PK = tenantId, SK BETWEEN `AUDIT#FINANCE#opening_balance` AND `AUDIT#FINANCE#opening_balance$`) + CloudWatch Logs Insights query for `eventType: finance.opening_balance.*`.
  7. **Recovery procedures** — how to manually correct an over-set opening balance; how to query the full revision history; how to reconstruct original from audit events.
  8. **Escalation paths** — when to page on-call, what info to gather.

#### PD.4.2 — CloudWatch alarm: opening-balance-set failure rate
- **File:** [`server/lib/analytics/analytics-stack.ts`](server/lib/analytics/analytics-stack.ts)
- **Change:** Add a CloudWatch alarm `EdForge-Finance-OpeningBalance-FailureRate` on the metric `finance.opening_balance.set_failure` (extracted via metric filter on the audit-service error log). Threshold: > 5/hour. Notify operator-alert SNS topic.
- **Test:** alarm shows up in CDK synth + appears in CloudWatch console post-deploy.

#### PD.4.3 — Synthetic prod smoke
- Run `finance-pilot-onboarding.ts` against prod with a throwaway test account (created + cleaned up by the smoke).
- Verify ledger + audit rows + alarm metric increments.

#### PD.4.4 — Production deploy
- **Standard ladder:** shared-types `npm publish 0.86.0` (final, after rc green) → ECR push for finance → ECS rolling update on `financebasic` → smoke → 24h monitor.
- **CDK diff gate:** `npx cdk diff tenant-template-stack-basic` MUST be empty (no GSI, no IAM change). If diff shows ANY change, STOP — implies a missed grant or schema migration (per CLAUDE.md memory `feedback_check_root_cause_before_migration`).
- **Analytics-stack deploy:** PD.4.2 alarm requires `analytics-stack` deploy.

---

## 4. PR-CA — Custom Yearly Fee Agreement

### Sprint CA.0 — Shared-types contracts + audit-event surface

**Goal:** Entity schema + invoice DTO field + audit events ready.

**Demo:** shared-types tests green for the new schemas; finance-audit spec green for the new event types.

#### CA.0.1 — `StudentFeeAgreement` Zod schemas (entity, create, update, response)
- **File:** [`packages/shared-types/src/schemas/finance/student-fee-agreement.schema.ts`](packages/shared-types/src/schemas/finance/student-fee-agreement.schema.ts) (NEW)
- **Schemas:**
  - `installmentSchema`: `{ dueDate: z.string().date(), amount: z.number().nonnegative(), label?: z.string().max(120) }`
  - `paymentPlanEnum`: `z.enum(['annual', 'quarterly', 'monthly', 'custom'])` — **'custom' semantics:** the engine treats `installments[]` as the authoritative payment schedule; no auto-derivation. For `'annual' | 'quarterly' | 'monthly'`, if `installments[]` is empty the engine auto-derives based on AY start date + period count (CA.2.1 helper handles this).
  - `feeAgreementStatusEnum`: `z.enum(['active', 'voided'])`
  - `createStudentFeeAgreementSchema`: `{ studentId, schoolId, academicYearId, annualAmount, currency, paymentPlan, installments?, notes? }` with `.refine` that `sum(installments.amount) ≤ annualAmount` (allows under-billing for proration; rejects over-billing).
  - `updateStudentFeeAgreementSchema`: partial of create (excluding identity fields). `version: z.number().int()` required for optimistic concurrency (passed in body, NOT `If-Match` header — matches existing PATCH convention).
  - `studentFeeAgreementResponseSchema`: full payload + `status`, `version`, audit timestamps. **Omits `isActive`** per [P1d].
  - `studentFeeAgreementFilterSchema` lives in CA.1.2 (alongside its usage).
- **Test:** [`student-fee-agreement.schema.spec.ts`](packages/shared-types/src/schemas/finance/student-fee-agreement.schema.spec.ts) (NEW) — 10 cases:
  1. Valid create with annual plan + no installments.
  2. Valid create with monthly plan + 12 installments.
  3. Valid create with quarterly plan + 4 installments.
  4. Valid create with custom plan + arbitrary installments.
  5. sum(installments) > annualAmount → rejection.
  6. sum(installments) < annualAmount → accepted (warning at engine time).
  7. Empty installments + custom plan → rejection (custom requires explicit list).
  8. Update without version → rejection.
  9. Response back-compat (no agreement on pre-CA invoices).
  10. `isActive` field NOT in response (P1d enforcement).

#### CA.0.2 — `feeOverrideMode` field on invoice (response DTO + entity)
- **Files:**
  - [`packages/shared-types/src/schemas/finance/invoice.schema.ts`](packages/shared-types/src/schemas/finance/invoice.schema.ts) — extend `invoiceResponseSchema` with `feeOverrideMode: z.enum(['catalog', 'agreement']).optional()` (sparse for pre-CA invoices).
  - **Also:** `agreementId?: z.string().uuid().optional()` + `agreementVersion?: z.number().int().optional()` — snapshotted onto the invoice at generation time so a later void of the agreement doesn't orphan the invoice's provenance.
  - [`invoice.entity.ts`](server/application/microservices/finance/src/common/entities/invoice.entity.ts) — add `feeOverrideMode?`, `agreementId?`, `agreementVersion?`.
  - [`invoice.mapper.ts`](server/application/microservices/finance/src/common/mappers/invoice.mapper.ts) — pass through all 3.
- **Test:** schema spec + mapper spec — 4 cases: catalog (back-compat); agreement (all 3 fields present); back-compat parse of pre-CA invoice; round-trip preserves agreementVersion.

#### CA.0.3 — Audit event types
- **File:** [`finance-audit-event.entity.ts`](server/application/microservices/finance/src/common/entities/finance-audit-event.entity.ts)
- **Change:** Extend `FinanceAuditEventType`:
  - `'finance.fee_agreement.created'`
  - `'finance.fee_agreement.revised'`
  - `'finance.fee_agreement.voided'`
  - `'finance.invoice.generated_from_agreement'`
- **Test:** finance-audit spec — 4 new cases asserting emit shape per event.

#### CA.0.4 — Bump shared-types 0.86.0 → 0.87.0-rc.1; consumer pins
- Same rc-then-final protocol as PD.0.5.

---

### Sprint CA.1 — Backend entity + service + CRUD

**Goal:** Full CRUD with audit + idempotency. Agreement-already-invoiced policy codified.

**Demo (curl):** POST create → GET read → PATCH revise (audit emit, version bump) → DELETE void → GET returns 404; list-per-school excludes voided.

#### CA.1.1 — `StudentFeeAgreementEntity` + factory + key builder
- **File:** [`server/application/microservices/finance/src/common/entities/student-fee-agreement.entity.ts`](server/application/microservices/finance/src/common/entities/student-fee-agreement.entity.ts) (NEW)
- **Keys (`agreementId` IS the SK component — no separate field):**
  - PK: `tenantId`
  - SK: `STUDENT_FEE_AGREEMENT#{schoolId}#{studentId}#{academicYearId}` — uniquely identifies the agreement; `(schoolId, studentId, academicYearId)` IS the primary key. NO separate `agreementId` field needed; route PATCH/DELETE take all three identifiers via the route hierarchy (see CA.1.3).
  - GSI1pk: `TENANT#{tid}#SCHOOL#{schoolId}#AY#{academicYearId}` / GSI1sk: `STUDENT_FEE_AGREEMENT#{studentId}` (lists all agreements for a school in an AY in one Query). **Sparse:** cleared via `REMOVE` when status='voided' (so the active-scope query naturally excludes them).
  - GSI2pk: `TENANT#{tid}#STUDENT#{studentId}` / GSI2sk: `STUDENT_FEE_AGREEMENT#{academicYearId}` (lists all agreements for a student across all AYs). Sparse cleanup same.
- **Body:** `studentId, schoolId, academicYearId, annualAmount, currency, paymentPlan, installments[], notes, status, agreedBy, agreedAt, lifecycle (version, createdAt, updatedAt, createdBy, updatedBy, isActive)`.
- **Status invariants (regression-tested):** `status === 'voided'` ↔ `isActive === false`. Status `'active'` ↔ `isActive === true`. Mutator methods enforce.
- **Test:** [`student-fee-agreement.entity.spec.ts`](server/application/microservices/finance/src/common/entities/student-fee-agreement.entity.spec.ts) (NEW) — 8 cases: factory shape; PK/SK format; GSI1 + GSI2 sparsity on active; GSI cleared on voided (REMOVE); status/isActive invariant; version increment helper; createdAt/updatedAt drift on update; both GSIs set only when status=active.

#### CA.1.2 — `StudentFeeAgreementsService` (5 methods + agreement-already-invoiced policy)
- **File:** [`server/application/microservices/finance/src/student-fee-agreements/student-fee-agreements.service.ts`](server/application/microservices/finance/src/student-fee-agreements/student-fee-agreements.service.ts) (NEW)
- **Methods:**
  - `create(dto, context)`: validates sum(installments). `PutItem` with `attribute_not_exists(PK)` — atomic dedupe of double-submit. Emits `finance.fee_agreement.created`.
  - `findActive(studentId, schoolId, academicYearId)`: single `GetItem`; returns `null` if absent OR status='voided'.
  - `list(filter, {limit, cursor})`: Query routing — `studentId` set → GSI2; `schoolId+academicYearId` set → GSI1; neither → `BadRequestException`. FilterExpression on status.
  - `update(schoolId, studentId, academicYearId, dto, context)`: GetItem → **agreement-already-invoiced check** (see policy below) → version-checked UpdateItem → emit `finance.fee_agreement.revised` with diff payload (oldValues / newValues).
  - `void(schoolId, studentId, academicYearId, context)`: UpdateItem setting `status='voided'`, `isActive=false`, `REMOVE gsi1pk, gsi1sk, gsi2pk, gsi2sk`. Emit `finance.fee_agreement.voided`. Idempotent: voiding an already-voided agreement returns 200 (no-op).
  - `findActiveSafe(studentId, schoolId, academicYearId)`: variant of `findActive` returning `{ agreement, snapshotVersion }` — used by `InvoicesService.generate()` to snapshot agreementVersion onto the invoice (CA.2.2).
- **Agreement-already-invoiced policy (codified):**
  - `update` allowed UNCONDITIONALLY. The runbook clarifies: revising an agreement does NOT retroactively update existing invoices. Only invoices generated AFTER the revision pick up new line items. Existing invoices carry the snapshotted `agreementId + agreementVersion` (CA.0.2), so operators can audit "this invoice was generated from agreement v2 even though current is v3."
  - `void` allowed UNCONDITIONALLY. Same provenance preservation: existing invoices retain `feeOverrideMode='agreement'` + `agreementId` + `agreementVersion` even after void.
  - **DiscountRule interaction:** when an agreement is in effect, DiscountRule does NOT apply (the agreement IS the discount). Scholarship discounts can still be issued via `CreditNote` (separate entity, post-issue). Codified in CA.2.1 helper logic.
- **Test:** [`student-fee-agreements.service.spec.ts`](server/application/microservices/finance/src/student-fee-agreements/student-fee-agreements.service.spec.ts) (NEW) — 18 cases:
  1. create happy.
  2. create duplicate → 409 ConditionalCheckFailed.
  3. create with sum > annual → 400.
  4. create with installments dueDate before AY start → warning logged, NOT rejected (operator may want pre-AY billing).
  5. findActive returns active.
  6. findActive returns null on voided.
  7. findActive returns null on missing.
  8. findActiveSafe returns agreement + snapshotVersion.
  9. list via GSI1 (school+AY).
  10. list via GSI2 (student).
  11. list with both missing → 400.
  12. update happy + audit + version++.
  13. update with stale version → 409.
  14. update of voided → 400 ("cannot update voided agreement").
  15. void happy + audit + GSI keys REMOVEd.
  16. void already-voided → 200 idempotent no-op.
  17. void preserves invoice provenance (regression: invoice with agreementId still has it after void).
  18. installments with dueDate after AY end → warning logged.

#### CA.1.3 — `StudentFeeAgreementsController` (6 routes)
- **File:** [`server/application/microservices/finance/src/student-fee-agreements/student-fee-agreements.controller.ts`](server/application/microservices/finance/src/student-fee-agreements/student-fee-agreements.controller.ts) (NEW)
- **Routes:** identity carried in path; no opaque `agreementId` — uses composite (studentId, academicYearId) which is unique under (tenantId, schoolId):
  - `POST /finance/schools/:schoolId/students/:studentId/fee-agreements` body `{ academicYearId, annualAmount, currency, paymentPlan, installments?, notes? }` → create. `@Idempotent()`.
  - `GET /finance/schools/:schoolId/fee-agreements?academicYearId=&status=` → list per school. `billing:view`.
  - `GET /finance/students/:studentId/fee-agreements?academicYearId=` → list per student (no schoolId in path because student is the primary axis). `billing:view`.
  - `GET /finance/schools/:schoolId/students/:studentId/fee-agreements/:academicYearId` → read one. `billing:view`.
  - `PATCH /finance/schools/:schoolId/students/:studentId/fee-agreements/:academicYearId` → revise. `@Idempotent()`.
  - `DELETE /finance/schools/:schoolId/students/:studentId/fee-agreements/:academicYearId` → void. `@Idempotent()`.
- **All writes:** `@RequirePermission({ resource: 'billing', action: 'manage', schoolIdParam: 'schoolId' })`. Read-per-student route uses a `studentIdParam` variant if `@RequirePermission` supports it; else fallback to body-scope check.
- **Cross-tenant access:** 404 (not 403).
- **Test:** [`student-fee-agreements.controller.spec.ts`](server/application/microservices/finance/src/student-fee-agreements/student-fee-agreements.controller.spec.ts) (NEW) — 12 cases (each route × happy + permission denial; cross-tenant 404 on one canonical route).

#### CA.1.4 — `StudentFeeAgreementsModule` + Finance wiring + spec extension
- **Files:**
  - [`student-fee-agreements.module.ts`](server/application/microservices/finance/src/student-fee-agreements/student-fee-agreements.module.ts) (NEW)
  - [`finance.module.ts`](server/application/microservices/finance/src/finance.module.ts) — add to `imports`.
  - [`finance/__tests__/module-wiring.spec.ts`](server/application/microservices/finance/src/__tests__/module-wiring.spec.ts) — add `StudentFeeAgreementsService` to watchlist (extends the seed spec from PD.0.3).
- **Test:** wiring spec green; `nest build finance` clean.
- **Note:** combine CA.1.2 (service) + CA.1.4 (module wiring) into a single PR commit OR strict sequence — a service without module registration is dead-on-arrival.

#### CA.1.5 — API Gateway route registration
- **File:** `tenant-api-prod.json` — register all 6 routes.
- **Test:** `npm run lint:routes`.

#### CA.1.6 — Mapper
- **File:** [`server/application/microservices/finance/src/common/mappers/student-fee-agreement.mapper.ts`](server/application/microservices/finance/src/common/mappers/student-fee-agreement.mapper.ts) (NEW)
- **Behavior:** Entity → DTO; omit `isActive`; omit GSI keys.
- **Test:** mapper spec — 3 cases (active, voided, with-installments).

#### CA.1.7 — Smoke harness extension
- **File:** `scripts/smoke-tests/finance-pilot-onboarding.ts`
- **Cases:** create agreement; list-per-school excludes voided; list-per-student returns active; revise (version increments); void; revise-of-voided → 400.

---

### Sprint CA.2 — Agreement-aware invoice generation

**Goal:** `InvoicesService.generate()` honors active agreement. Invoice carries `agreementId + agreementVersion` snapshot. Invoice PDF shows the badge.

**Demo:** Create student with agreement annualAmount=120000, paymentPlan=monthly → generate one invoice → response shows `feeOverrideMode='agreement'`, `agreementId`, `agreementVersion`, line items reflect installments not catalog; PDF renders "Generated from custom yearly fee agreement"; audit emit fires.

#### CA.2.1 — `buildLineItemsFromAgreement` pure helper
- **File:** [`server/application/microservices/finance/src/invoices/agreement-line-items.builder.ts`](server/application/microservices/finance/src/invoices/agreement-line-items.builder.ts) (NEW)
- **Signature:** `(agreement, dto, taxPolicy) → { lineItems[], subtotal, taxTotal, discountTotal, grandTotal, warnings: string[] }`
- **Behavior:**
  - If `installments[]` is empty AND paymentPlan ≠ 'custom' → auto-derive based on AY start + period count (annual=1, quarterly=4, monthly=12). Even split of annualAmount.
  - If `installments[]` is empty AND paymentPlan === 'custom' → return `BadRequestException` (caught upstream; surfaces as 400).
  - Select installments matching `dto.billingPeriod` (or all if not specified).
  - For each selected installment: build a line item with `feeStructureId: undefined`, `description: "Custom agreement — {installment.label || installment.dueDate}"`, `amount`, `quantity: 1`, `discount: 0`, `taxRate: schoolTaxRate`, `taxType: schoolTaxType`, `taxAmount: computed`, `total: amount + taxAmount`.
  - DiscountRule does NOT apply (return `discountTotal: 0`, push warning if dto attempted to apply a discount).
  - sum(selected installments) < annualAmount portion-for-period → push warning, NOT a rejection.
- **Test:** [`agreement-line-items.builder.spec.ts`](server/application/microservices/finance/src/invoices/agreement-line-items.builder.spec.ts) (NEW) — 10 cases:
  1. Annual plan + empty installments → 1 line item, full amount.
  2. Monthly plan + empty installments → 12 line items.
  3. Quarterly plan + empty installments → 4 line items.
  4. Custom plan + empty installments → throws.
  5. Custom plan + 3 installments → 3 line items.
  6. Tax applied per school policy.
  7. dto attempted discount → 0 applied + warning pushed.
  8. installments with dueDate filter narrows selection.
  9. sum(selected) < period-portion → warning pushed.
  10. Zero installments + custom → throws.

#### CA.2.2 — `InvoicesService.generate()` agreement branch
- **File:** [`invoices.service.ts`](server/application/microservices/finance/src/invoices/invoices.service.ts) — insert BEFORE the fee-structure resolution block at line 68.
- **Change:**
  ```ts
  // Sprint CA.2.2 — agreement check
  const { agreement, snapshotVersion } = await this.studentFeeAgreementsService
    .findActiveSafe(studentId, schoolId, academicYearId);

  if (agreement) {
    // Use buildLineItemsFromAgreement instead of fee-structure path
    // Set entity.feeOverrideMode = 'agreement', entity.agreementId, entity.agreementVersion = snapshotVersion
    // Emit finance.invoice.generated_from_agreement audit
  } else {
    // Existing fee-structure path; set entity.feeOverrideMode = 'catalog'
  }
  ```
  - **Currency check:** if `agreement.currency !== account.currency` → reject with `BadRequestException` (V1: agreements must match account currency; mixed-currency is V2).
  - **Sprint A.1 gradeLevel snapshot** at lines 178-260 stays unchanged — runs AFTER the branch. Regression-tested at CA.2.2 case 8.
  - **dto-supplied line items (admin override)** still win over both (existing behavior preserved).
- **Test:** [`invoices.service.generate.agreement.spec.ts`](server/application/microservices/finance/src/invoices/invoices.service.generate.agreement.spec.ts) (NEW) — 12 cases:
  1. No agreement → catalog path; feeOverrideMode='catalog'; no audit emit.
  2. Active agreement → agreement path; feeOverrideMode='agreement'; agreementId + agreementVersion populated; audit emit.
  3. Voided agreement (findActive returns null) → catalog path.
  4. Agreement + dto.gradeLevel override → agreement wins for line items; override wins for gradeLevel snapshot.
  5. Agreement + dto.lineItems admin override → admin wins (existing behavior unchanged).
  6. Sum-of-installments < period-portion → warning logged; invoice generated.
  7. Agreement currency mismatches account → 400.
  8. **Regression:** agreement path still populates `gradeLevel` + `gsi14pk/sk` (Sprint A.1 invariant preserved).
  9. Mid-generation void race: simulate void between `findActiveSafe` and Put → invoice still carries snapshotted agreementId + agreementVersion (audit-able).
  10. Agreement with auto-derived installments (monthly, empty `installments[]`) → 12 line items in generated invoice.
  11. Agreement + bulk-generate path → `feeOverrideMode='agreement'` on each invoice; bulk counter `succeededFromAgreement` increments.
  12. DiscountRule attempted in dto when agreement is active → 0 discount applied; warning surfaced in response.

#### CA.2.3 — Cross-service IAM grant verification (false-clear trap)
- **Verification step (NO code change):** `StudentFeeAgreement` lives on the **finance table** (same table finance service already accesses). NO new IAM grant required.
- **Acceptance gate:** PR description explicitly states "agreement lookup is intra-finance; `cdk diff tenant-template-stack-basic` MUST be empty." If diff shows ANY change → STOP, investigate (per CLAUDE.md memory `feedback_check_root_cause_before_migration` + the cross-service grant trap in CLAUDE.md).
- **Test:** none (zero-change confirmation in CI gate).

#### CA.2.4 — `generateBulk()` counter extension (foundation for Bulk Ops Sprint C)
- **File:** [`invoices.service.ts:991`](server/application/microservices/finance/src/invoices/invoices.service.ts#L991)
- **Change:** Result counter from `{succeeded, failed, skipped}` to `{succeeded, succeededFromAgreement, failed, skipped}`. Increment `succeededFromAgreement` whenever per-student `generate()` returned `feeOverrideMode='agreement'`.
- **Cross-doc link:** documented in CA.4.2 as the wire that Bulk Ops Sprint C surfaces in the UI.
- **Test:** [`invoices.service.generateBulk.agreement.spec.ts`](server/application/microservices/finance/src/invoices/invoices.service.generateBulk.agreement.spec.ts) (NEW) — 3 cases: all-catalog batch (counter=0); all-agreement batch; mixed batch.

#### CA.2.5 — Invoice PDF "Generated from custom agreement" annotation
- **File:** [`invoice-pdf.renderer.ts`](server/application/microservices/finance/src/invoices/invoice-pdf.renderer.ts)
- **Change:** When `invoice.feeOverrideMode === 'agreement'`, render a header annotation: "Generated from custom yearly fee agreement (NPR {annualAmount}/year, {paymentPlan})" + the agreement reference for operator-visual audit.
- **Test:** [`invoice-pdf.renderer.agreement.spec.ts`](server/application/microservices/finance/src/invoices/invoice-pdf.renderer.agreement.spec.ts) (NEW) — 2 cases: catalog invoice (no annotation, back-compat); agreement invoice (annotation present).

---

### Sprint CA.3 — Frontend

**Goal:** Operator creates agreement at registration; views/edits/voids via student detail; sees the badge on invoice detail.

**Demo:** Browser walkthrough at the URLs below.

#### CA.3.1 — Client service + route-shape guards
- **Files:**
  - [`packages/finance-services/src/services/fee-agreements.service.ts`](edforge-saas-frontend/packages/finance-services/src/services/fee-agreements.service.ts) (NEW) — 6 methods matching CA.1.3 routes. `Idempotency-Key: <uuid>` on writes.
  - [`packages/finance-services/src/__tests__/fee-agreements-routes.test.ts`](edforge-saas-frontend/packages/finance-services/src/__tests__/fee-agreements-routes.test.ts) (NEW) — pin all 6 URLs.

#### CA.3.2 — TanStack hooks
- **File:** [`packages/finance-services/src/hooks/useFeeAgreements.ts`](edforge-saas-frontend/packages/finance-services/src/hooks/useFeeAgreements.ts) (NEW)
- **Hooks:** `useStudentFeeAgreement`, `useAgreementsBySchool`, `useCreateFeeAgreement`, `useUpdateFeeAgreement`, `useVoidFeeAgreement`.
- **Cache key:** `['fee-agreement', studentId, ay]`. Invalidation on mutations.
- **Test:** vitest hook tests.

#### CA.3.3 — Registration wizard — replace `EmptyAgreementSlot` with agreement collapsible
- **Route trace (verified):** same as PD.3.3 — `/academics/enrollment?tab=registration` → `RegistrationWizard.tsx`.
- **Change:** Replace the `<EmptyAgreementSlot />` placeholder (introduced in PD.3.3) with the agreement collapsible:
  - Fields: `annualAmount`, currency (default from tenant settings — NPR for PABSON), paymentPlan dropdown, dynamic installments editor (running-sum validator displayed inline), notes.
  - Help text on paymentPlan='custom': "You must provide an explicit installment list."
- **Submit flow:** After student creation + previous-dues handling (PR-PD), POST the agreement if filled.
- **Error-recovery UX:** if agreement POST fails after student-create succeeds → reconciliation modal (same pattern as PD.3.3): "Student created, but agreement creation failed: {error}. Retry, or skip and add later from the Agreements tab."
- **Test:** operator-visual at `/academics/enrollment?tab=registration`; round-trip; deliberately fail the POST and verify reconciliation modal.

#### CA.3.4 — Student detail — Agreements tab + void confirmation modal
- **Route trace (verified):** URL `/academics/students/{studentId}` → [`apps/academics/src/routes/students/$studentId.tsx`](edforge-saas-frontend/apps/academics/src/routes/students/$studentId.tsx).
- **Change:** Add a new tab `Agreements` between Family and Demographics. Table columns: AY, annualAmount, plan, installments count, status, actions (View / Edit / Void).
- **View modal:** read-only summary including line-item breakdown.
- **Edit modal:** uses CA.3.3 form; submits PATCH with version.
- **Void modal:** Destructive confirmation: "Voiding this agreement will not affect existing invoices but no new invoices will use it. Type 'VOID' to confirm." (Required text-match input.) On confirm → DELETE.
- **Test:** operator-visual at `/academics/students/{studentId}?tab=agreements`; void confirmation requires typing 'VOID' exactly.

#### CA.3.5 — Invoice detail — "Generated from custom agreement" badge
- **Route trace (verified):** URL `/finance/billing/invoices/{invoiceId}` → [`apps/finance/src/routes/billing/invoices/$invoiceId.tsx`](edforge-saas-frontend/apps/finance/src/routes/billing/invoices/$invoiceId.tsx).
- **Change:** When `invoice.feeOverrideMode === 'agreement'`, render a badge near the header: "Generated from custom yearly fee agreement (NPR {annualAmount}/year)" + a "View agreement" link → `/academics/students/{studentId}?tab=agreements`.
- **Test:** vitest snapshot + operator-visual at `/finance/billing/invoices/{invoiceId}`.

---

### Sprint CA.4 — Runbook + cross-doc + cutover

**Goal:** Ops documentation; cross-link to Bulk Ops plan; ship to prod.

**Demo:** Saraswati operator (or proxy) creates a real student with a custom agreement on prod; invoice generates with the agreement; auditable end-to-end.

#### CA.4.1 — Runbook
- **File:** [`docs/operations/finance-custom-fee-agreements-runbook.md`](docs/operations/finance-custom-fee-agreements-runbook.md) (NEW)
- **Required sections (same template as PD.4.1):**
  1. What this feature does.
  2. Operator how-to (create / revise / void).
  3. Field-by-field interpretation.
  4. Agreement-vs-catalog precedence; what `feeOverrideMode='agreement'` means on an invoice.
  5. Common failure modes + diagnosis.
  6. Audit-query examples — DDB + CloudWatch Logs Insights for `eventType: finance.fee_agreement.*`.
  7. Recovery procedures — what to do if an agreement was voided but operator wants to restore (answer: create a new active agreement; old is preserved in audit + invoices reference).
  8. Escalation paths.

#### CA.4.2 — Update Bulk Ops sprint plan cross-reference
- **File:** [`docs/finance-bulk-ops/sprint-plan.md`](docs/finance-bulk-ops/sprint-plan.md)
- **Change:** Add a section in Sprint C describing `feeOverrideMode` + `succeededFromAgreement` counter. Surfaces "X of these were on custom deals" in the bulk-generate result modal.

#### CA.4.3 — CLAUDE.md update — finance invariants
- **File:** [`CLAUDE.md`](CLAUDE.md) (under "Common edit traps" or a new "Finance invariants" subsection)
- **Add 2 invariants:**
  1. **Opening balance is append-only.** Never mutate prior ledger rows; revisions emit `adjustment` entries. The original opening balance is recoverable from the FIRST `finance.opening_balance.set` audit event, not from the entity.
  2. **Agreement overrides catalog atomically per invoice.** An invoice is generated from EITHER the catalog OR an active agreement (via `feeOverrideMode`). Snapshotted `agreementId + agreementVersion` preserve provenance even after the agreement is voided or revised.

#### CA.4.4 — Synthetic prod smoke
- Run `finance-pilot-onboarding.ts` against prod (full agreement lifecycle).

#### CA.4.5 — Production deploy
- **Standard ladder.** No CDK changes (same finance table, no new GSI, no new IAM). ECR push + ECS roll only.
- **CDK diff gate:** MUST be empty.

---

### Sprint CA.5 — Pilot dress rehearsal (gate before prod cutover)

**Goal:** End-to-end with the actual pilot operator (or proxy) on `dev-pabson-primary`. NOT just `finance-pilot-onboarding.ts` exit 0 — a human walks the flow.

**Demo:** Operator dressed-rehearsal report archived.

#### CA.5.1 — Dressed-rehearsal scenario script
- **File:** [`docs/operations/pilot-onboarding-dress-rehearsal.md`](docs/operations/pilot-onboarding-dress-rehearsal.md) (NEW)
- **Scenario:** Register 5 returning students with previous dues (varying amounts) + 2 students with custom agreements (one annual + one monthly plan) + 1 fresh student with neither. Generate invoices for all 8. Record payments against 3. Void one agreement. Revise one opening balance.
- **Validation:** Spot-check 5 DDB rows; spot-check 3 audit events; spot-check 1 receipt PDF for the split allocation; spot-check 1 invoice PDF for the agreement annotation.
- **Sign-off:** archived as `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/dev-pabson-primary-pilot-dress-rehearsal-{ts}.log`.

#### CA.5.2 — Go/no-go for prod
- Based on CA.5.1 output, explicit go-decision documented before CA.4.5 prod deploy.

---

## 5. Cross-PR sequencing & rollback

### Required ordering

1. **Sprint A (PR #323)** lands first. shared-types `0.84.0 → 0.85.0`.
2. **PR-PD** lands second. shared-types `0.85.0 → 0.86.0`. Includes the module-wiring spec seed (PD.0.3) + the `EmptyAgreementSlot` placeholder in the wizard (PD.3.3).
3. **PR-CA** lands third. shared-types `0.86.0 → 0.87.0`. Extends the module-wiring spec; replaces the `EmptyAgreementSlot`.

### If PR-PD is reverted after merge

- PR-CA's wiring spec extension references `StudentAccountsService.setOpeningBalance` only indirectly (via the watchlist); the spec re-runs and **passes** (the watchlist doesn't break if a method is missing — it only asserts providers are resolvable).
- PR-CA's `EmptyAgreementSlot` swap: would fail to render because the placeholder file is gone. Mitigation: include the placeholder file as part of PR-CA's diff (delete in PR-CA only, not introduce in PR-PD and delete in PR-CA). Adjust PD.3.3 to make the slot component IDEMPOTENT (present in both PRs; PR-CA's slot just shows the actual collapsible).

### Wizard merge-conflict prevention

- PD.3.3 introduces `EmptyAgreementSlot` AND the Financial Setup step with previous-dues fields.
- CA.3.3 ONLY edits `EmptyAgreementSlot` to render the agreement form.
- Both PRs touch the wizard file; the diffs are non-overlapping IF PD.3.3 leaves a clearly-marked `{/* AGREEMENT SLOT — PR-CA */}` comment block where CA.3.3 will insert.
- Convention: NO other wizard work in either PR.

### Pre-PR action items

Before opening EITHER PR:
1. Confirm `npm publish` access from operator's machine.
2. Run the production DDB Query in PD.2.1 to confirm legacy `PaymentEntity` shape (no rogue `applications` field on production rows).
3. Confirm `WorkspaceSettings.currency = NPR` on dev-pabson-primary AND Saraswati prod.
4. Confirm Sprint A (PR #323) is merged + deployed.

---

## 6. Out of scope (explicit deferrals)

| Deferred | Why |
|---|---|
| Multi-currency on agreements | Currency fixed per agreement; matches account. V2 if multi-currency tenants emerge. |
| Negative opening balances | Operators use existing credit-note flow for advance payments. |
| Partial-year proration engine | Installments are operator-managed; engine doesn't try to be clever. Auto-derive only for vanilla annual/quarterly/monthly with empty installments. |
| Bulk-create flow for agreements | V1 is per-student. CSV importer can ship later. |
| Frontend wizard re-architecture | Both features fit as additions to existing 6-step `RegistrationWizard`. |
| Bulk Ops Sprint B–I | Pilot blocker takes priority. Resume after PR-PD + PR-CA ship + stabilize. |
| New GSIs on finance table | Existing GSI1 + GSI2 cover all listing patterns. |
| Ed-Fi mapping for financial data | Outside Ed-Fi v6 scope. IEMIS Flash I/II exports unaffected. |
| Scholarship-on-top-of-agreement workflow | V1: scholarships use existing `CreditNote` flow post-issue. V2 could add `feeOverrideMode='agreement_with_scholarship'`. |
| Backfill script for existing BillingAccounts | Operators set per-account via UI during dress-rehearsal week (CA.5.1) + onboarding week. Manual is acceptable at pilot scale. |

---

## 7. Cross-PR validation gates

Per ticket / per PR / pre-merge:

- `cd packages/shared-types && npm test` clean.
- `cd server/application && npx jest --testPathPattern="microservices/finance"` baseline + all new specs green.
- `cd server && npx tsc -p tsconfig.cdk.json` clean.
- `npm run lint:routes` shows new routes registered.
- `bash scripts/lint/check-no-country-branch.sh` passes.
- `npm run test:scripts` passes.
- `scripts/smoke-tests/finance-pilot-onboarding.ts` exits 0 against dev-pabson-primary.
- Operator-visual at the URLs cited in each frontend ticket via `pnpm dev:academics` + `pnpm dev:finance`.
- Module wiring spec passes for finance (introduced in PD.0.3, extended in CA.1.4).
- `npx cdk diff tenant-template-stack-basic` is empty (no IAM / GSI change). Diff = empty is the GATE per the false-clear trap.
- CodeRabbit + Codex review green.

---

## 8. Open Questions / Risks (priority-ordered)

1. **PR-PD merge before PR-CA opens** is the safest path. If the two are developed in parallel, CA must rebase against PD.0.5's shared-types pin (`0.86.0`) before opening.
2. **Sprint A (PR #323) must land first.** If delayed, pilot work rebases against `0.84.0` baseline (mechanical fix).
3. **`PaymentEntity.applications[]` is a contract bump.** Existing payment consumers (receipt PDF, list endpoints) MUST treat the field as optional. Schema specs in PD.2.2 enforce. **Pre-PR DDB scan in PD.2.1** confirms no legacy data carries the field already.
4. **`buildCompositeLedgerTransactItems` (PD.1.3) is foundational.** Both PD.2 and CA.2 depend on it for atomic multi-row writes. Land it early in PD.1, validate against the existing `recordManualPayment` test suite first to ensure no regression.
5. **Wizard merge-conflict** mitigated by the `EmptyAgreementSlot` placeholder pattern (see §5).
6. **Currency-mismatch agreement** rejected at invoice-generation time (CA.2.2 case 7), not at agreement-creation. Operator could create a USD agreement on an NPR tenant; they'd discover the issue only at invoice gen. Acceptable for V1 — the runbook documents.
7. **Concurrent payment + setOpeningBalance race**: codified — payment wins, balance set returns 409 (PD.1.4). UI surfaces a retry toast.
8. **Voided-agreement provenance**: invoices retain `agreementId + agreementVersion` snapshots even after the agreement is voided. Operators can audit "this invoice was generated from agreement Xv2 (now voided)." Documented in CA.4.1 runbook.
9. **`@Idempotent()` not yet used in production finance code**: PD.1.5 + CA.1.3 are the first consumers. PD.0.3 wiring spec adds an integration test case asserting the interceptor actually fires end-to-end on the new routes (two POSTs same key → one handler invocation).
10. **Dress rehearsal (CA.5)** is the explicit human gate before prod. NOT skippable.

---

## 9. Critical files for implementation

### Backend (finance microservice)
- [`finance.module.ts`](server/application/microservices/finance/src/finance.module.ts)
- [`common/entities/billing-account.entity.ts`](server/application/microservices/finance/src/common/entities/billing-account.entity.ts)
- [`common/entities/ledger-entry.entity.ts`](server/application/microservices/finance/src/common/entities/ledger-entry.entity.ts)
- [`common/entities/payment.entity.ts`](server/application/microservices/finance/src/common/entities/payment.entity.ts)
- [`common/entities/student-fee-agreement.entity.ts`](server/application/microservices/finance/src/common/entities/student-fee-agreement.entity.ts) (NEW)
- [`common/entities/finance-audit-event.entity.ts`](server/application/microservices/finance/src/common/entities/finance-audit-event.entity.ts)
- [`common/services/finance-audit.service.ts`](server/application/microservices/finance/src/common/services/finance-audit.service.ts)
- [`common/mappers/`](server/application/microservices/finance/src/common/mappers/) (billing-account, student-fee-agreement, invoice, payment)
- [`student-accounts/student-accounts.service.ts`](server/application/microservices/finance/src/student-accounts/student-accounts.service.ts)
- [`student-accounts/student-accounts.controller.ts`](server/application/microservices/finance/src/student-accounts/student-accounts.controller.ts)
- [`student-fee-agreements/`](server/application/microservices/finance/src/student-fee-agreements/) (NEW directory)
- [`invoices/invoices.service.ts:68`](server/application/microservices/finance/src/invoices/invoices.service.ts#L68) (agreement branch)
- [`invoices/invoices.service.ts:991`](server/application/microservices/finance/src/invoices/invoices.service.ts#L991) (generateBulk counter)
- [`invoices/agreement-line-items.builder.ts`](server/application/microservices/finance/src/invoices/agreement-line-items.builder.ts) (NEW)
- [`invoices/invoice-pdf.renderer.ts`](server/application/microservices/finance/src/invoices/invoice-pdf.renderer.ts) (CA.2.5 annotation)
- [`payments/payments.service.ts`](server/application/microservices/finance/src/payments/payments.service.ts) (PD.2.3)
- [`payments/receipt-pdf.renderer.ts`](server/application/microservices/finance/src/payments/receipt-pdf.renderer.ts) (PD.2.4 split allocation)
- [`__tests__/module-wiring.spec.ts`](server/application/microservices/finance/src/__tests__/module-wiring.spec.ts) (NEW)
- [`tenant-api-prod.json`](server/lib/tenant-api-prod.json)
- [`analytics-stack.ts`](server/lib/analytics/analytics-stack.ts) (PD.4.2 alarm)

### Shared types
- [`common.ts:110-117`](packages/shared-types/src/schemas/finance/common.ts#L110-L117) (PD.0.1)
- [`billing-account.schema.ts`](packages/shared-types/src/schemas/finance/billing-account.schema.ts)
- [`invoice.schema.ts`](packages/shared-types/src/schemas/finance/invoice.schema.ts) (CA.0.2)
- [`payment.schema.ts`](packages/shared-types/src/schemas/finance/payment.schema.ts) (PD.2.2)
- [`student-fee-agreement.schema.ts`](packages/shared-types/src/schemas/finance/student-fee-agreement.schema.ts) (NEW)

### Frontend
- [`apps/academics/src/routes/enrollment/index.tsx:364`](edforge-saas-frontend/apps/academics/src/routes/enrollment/index.tsx#L364) (wizard mount — reference only)
- [`apps/academics/src/components/students/registration/RegistrationWizard.tsx`](edforge-saas-frontend/apps/academics/src/components/students/registration/RegistrationWizard.tsx)
- [`apps/academics/src/components/students/EditStudentModal.tsx`](edforge-saas-frontend/apps/academics/src/components/students/EditStudentModal.tsx)
- [`apps/academics/src/routes/students/$studentId.tsx`](edforge-saas-frontend/apps/academics/src/routes/students/$studentId.tsx) (Agreements tab)
- [`apps/finance/src/routes/billing/accounts/index.tsx`](edforge-saas-frontend/apps/finance/src/routes/billing/accounts/index.tsx) (opening balance summary card)
- [`apps/finance/src/routes/billing/invoices/$invoiceId.tsx`](edforge-saas-frontend/apps/finance/src/routes/billing/invoices/$invoiceId.tsx) (agreement badge)
- [`packages/finance-services/src/services/student-accounts.service.ts`](edforge-saas-frontend/packages/finance-services/src/services/student-accounts.service.ts)
- [`packages/finance-services/src/services/fee-agreements.service.ts`](edforge-saas-frontend/packages/finance-services/src/services/fee-agreements.service.ts) (NEW)
- [`packages/finance-services/src/hooks/useSetOpeningBalance.ts`](edforge-saas-frontend/packages/finance-services/src/hooks/useSetOpeningBalance.ts) (NEW)
- [`packages/finance-services/src/hooks/useFeeAgreements.ts`](edforge-saas-frontend/packages/finance-services/src/hooks/useFeeAgreements.ts) (NEW)

### Ops + docs
- [`scripts/smoke-tests/finance-pilot-onboarding.ts`](scripts/smoke-tests/finance-pilot-onboarding.ts) (NEW)
- [`docs/operations/finance-previous-dues-runbook.md`](docs/operations/finance-previous-dues-runbook.md) (NEW)
- [`docs/operations/finance-custom-fee-agreements-runbook.md`](docs/operations/finance-custom-fee-agreements-runbook.md) (NEW)
- [`docs/operations/pilot-onboarding-dress-rehearsal.md`](docs/operations/pilot-onboarding-dress-rehearsal.md) (NEW)
- [`docs/finance-bulk-ops/sprint-plan.md`](docs/finance-bulk-ops/sprint-plan.md) (cross-reference update)
- [`CLAUDE.md`](CLAUDE.md) (CA.4.3 invariants)

---

## 10. Sign-off

This plan is locked at **v1.1** as of 2026-06-27 (post-PR-#330 implementation + review). Originally locked at v1.0; v1.1 carries the post-implementation drift fixes documented in the v1.1 Changelog at the top. Material scope changes require a v1.2 revision with explicit redline + project owner re-confirm. Mechanical edits (typo fixes, line-number drift after rebase) do not require a version bump.

Sprint authors: claim tickets atomically; one commit per ticket; PR review gates per §7.
