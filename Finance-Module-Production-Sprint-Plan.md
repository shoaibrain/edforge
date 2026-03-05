# Finance Module — Production Sprint Plan

> **Goal**: Ship a production-ready Finance module for EdForge pilot schools in Nepal.
> Cut all stubs, wire every page to real backend data, harden business logic,
> and validate end-to-end with smoke tests.

---

## Current State Audit Summary

### What's REAL (API-backed, functional)
| Feature | Frontend | Backend | Status |
|---------|----------|---------|--------|
| Fee Structure CRUD | `configuration/fee-structures.tsx` | `fee-structures.controller.ts` | Working |
| Invoice Generation (single + bulk) | `billing/invoices/*` | `invoices.controller.ts` | Working |
| Invoice Issue / Cancel | `billing/invoices/$invoiceId.tsx` | `invoices.service.ts` | Working |
| Manual Payment Recording | `billing/payments/record.tsx` | `payments.controller.ts` | Working |
| Gateway Payment Initiation | `payments.service.ts` (frontend) | `payments.service.ts` + adapters | Working (Khalti, eSewa) |
| Payment Verification Callback | `payments.service.ts` (frontend) | `payments.service.ts` | Working |
| Void / Refund | `billing/payments/index.tsx` | `payments.service.ts` | Partial (no gateway refund execution) |
| Student Accounts + Ledger | `billing/accounts/index.tsx` | `student-accounts.controller.ts` | Working |
| Dashboard Summary KPIs | `dashboard/index.tsx` | `dashboard.service.ts` | Working |
| Payment Gateway Config | `configuration/payment-gateways.tsx` | `payment-gateways.controller.ts` | Working |
| Enrollment Webhook (auto-billing) | N/A | `enrollment-webhook.controller.ts` | Working |
| Overdue Detection (cron) | N/A | `overdue-detection.service.ts` | Working |

### What's STUBBED / FAKE (must be removed or replaced)
| Item | Location | Problem |
|------|----------|---------|
| Overview "Quick Stats" | `routes/overview.tsx:21-58` | Hardcoded: `$125,890`, `$23,456`, `$89,234`, `$34,567` — all USD, all fake |
| Overview action cards | `routes/overview.tsx:73-98` | "General Ledger" links to deleted route; "Fee Structures" links to old `/settings/` route |
| Ledger (GL / AP / AR tabs) | `routes/ledger/index.tsx` (365 lines) | 100% placeholder: "147 accounts", "342 journal entries", "FY24 Q2", "$47,250" |
| Dead route files | `routes/expenses/index.tsx`, `routes/payroll/index.tsx`, `routes/tuition/index.tsx` | Not in router tree but on disk — hardcoded USD placeholder data |
| Sidebar "Ledger" nav item | `sidebar-modules.ts:589` | Links to fully-stubbed page |
| Sidebar "Dashboard" nav item | `sidebar-modules.ts:590` | Redundant — same metrics appear in Billing overview |

### What's BROKEN or needs fixes
| Issue | Location | Severity |
|-------|----------|----------|
| `formatNPR` duplicated in 8+ files | 8 local copies vs canonical `@edforge/types` export | High (inconsistent formatting) |
| Fee Structure form modal z-index | `FeeStructureForm.tsx` — modal renders behind table rows | High (visible in screenshot) |
| `window.confirm()` used in 3 places | `invoices/index.tsx:113`, `$invoiceId.tsx:60`, `payments/index.tsx:78` | Medium (UX inconsistency) |
| DashboardSummary `recentPayments` type mismatch | Backend returns `{id,amount,...}`, frontend type expects full `Payment` | Medium |
| No pagination on invoice/payment lists | Frontend loads all into memory | Medium (perf at scale) |
| Payment sweep service is placeholder | `payment-sweep.service.ts` — logs only, doesn't expire | Medium |
| Academic year defaults to Gregorian | Forms show "2026" instead of "2082" (Bikram Sambat) | Medium (Nepal UX) |
| Refund amount no client-side validation | `max` attr on `<input type="number">` is advisory | Low |
| CSV export no download trigger | `invoices.service.ts:exportInvoicesCsv` | Low |
| `toLocaleDateString()` without locale | Renders differently per browser language setting | Low |

### What's NOT in scope for Nepal school MVP
- Full double-entry GL/AP/AR (enterprise accounting)
- Expense tracking and vendor management
- Payroll
- Payment plans / installment EMI
- Automated payment reminders / email notifications
- Revenue forecasting / trend analysis
- Multi-currency support (NPR only)

### Known Scaling Limitations (acceptable for pilot)
- **Overdue detection** uses a DynamoDB `Scan` (scans entire table, not just invoices). Acceptable up to ~10,000 total items. Must refactor to GSI3-based query before scaling beyond pilot.
- **Dashboard aggregation** fetches all invoices + payments per school into memory. Capped at 10,000 items per entity type. Acceptable for pilot-scale schools.
- **Payment sweep** has the same scan concern as overdue detection.

---

## Sprint Plan

---

### Sprint 1 — Clean Foundation: Navigation, Stubs & `formatNPR` Consolidation

**Goal**: Remove all fake data and dead code, fix navigation hierarchy, consolidate currency formatting, wire Overview page with real dashboard metrics. After this sprint, every page in the Finance module renders real data or is hidden.

**Demoable outcome**: Navigate Finance module — no fake numbers, no USD symbols, clean sidebar, Overview shows live school financial stats in NPR with proper lakh/crore formatting.

---

#### Task 1.1 — Delete dead stub route files
**Files**:
- Delete `apps/finance/src/routes/ledger/index.tsx` (365 lines, 100% hardcoded GL/AP/AR)
- Delete `apps/finance/src/routes/expenses/index.tsx` (174 lines, hardcoded USD placeholder)
- Delete `apps/finance/src/routes/payroll/index.tsx` (skeleton stub)
- Delete `apps/finance/src/routes/tuition/index.tsx` (skeleton stub)
- Edit `apps/finance/src/router.tsx` — remove `ledgerRoute` import and route tree entry (expenses/payroll/tuition are not in router but imports may reference them)

**Why**: These files are not routed but exist on disk with fake data. They add confusion during builds and grep searches. Delete them to ensure zero fake data exists in the module.

**Validation**:
- `pnpm typecheck` in finance app — zero errors
- `ls apps/finance/src/routes/` — only `overview.tsx`, `billing/`, `dashboard/`, `configuration/`
- Navigate to `/finance/ledger` — shows 404 or redirects to overview

---

#### Task 1.2 — Restructure sidebar: remove ACCOUNTING group, rename Dashboard to Reports
**Files**:
- `apps/shell/src/config/sidebar-modules.ts`

**Changes**:
- Remove entire `accounting` group (Ledger + Dashboard nav items)
- Add "Reports" nav item to the `billing` group (after "Student Accounts"):
  ```
  { id: 'reports', label: 'Reports', icon: Layers, href: '/finance/dashboard', permission: { action: 'view', resource: 'billing' }, requiresActiveSchool: true }
  ```
- Result: Overview → BILLING (Billing, Invoices, Payments, Student Accounts, Reports) → CONFIGURATION

**Why**: "Dashboard" conflicts with the Overview concept used across all EdForge modules. The `/finance/dashboard` page shows KPI breakdowns, invoice status distributions, and recent payments — it's a reporting view. Removing the empty ACCOUNTING group (since Ledger is gone) keeps the sidebar clean.

**Validation**:
- Sidebar shows 3 groups: main (Overview), BILLING (5 items), CONFIGURATION (2 items)
- No "ACCOUNTING" heading
- "Reports" navigates to `/finance/dashboard` correctly

---

#### Task 1.3 — Consolidate `formatNPR` — replace 8 local copies with shared import
**Files** (all in `apps/finance/src/`):
- `routes/billing/index.tsx` — delete local `formatNPR` + `formatNPRShort`, import from `@edforge/types`
- `routes/billing/invoices/index.tsx` — same
- `routes/billing/invoices/$invoiceId.tsx` — same
- `routes/billing/payments/index.tsx` — same
- `routes/billing/payments/record.tsx` — same
- `routes/billing/accounts/index.tsx` — same
- `routes/dashboard/index.tsx` — delete local `formatNPR` + `formatNPRShort`, import from `@edforge/types`
- `components/billing/BulkInvoiceForm.tsx` — same
- `components/configuration/FeeStructureList.tsx` — same

**Changes per file**:
- Remove the local `function formatNPR(amount: number): string { return amount.toLocaleString('en-IN', ...) }` definition
- Add `import { formatNPR } from '@edforge/types'`
- For files using `formatNPRShort`: create a thin wrapper using the canonical `formatNPR` with `{ decimals: 0 }` option, or add a `formatNPRShort` export to `@edforge/types`

**Why**: Local copies use `en-IN` locale (standard Indian grouping) which differs from the canonical version's explicit lakh/crore algorithm. Currency formatting must be consistent across the module. Single source of truth prevents divergence.

**Validation**:
- `pnpm typecheck` in finance app — zero errors
- Grep for `function formatNPR` in `apps/finance/src/` — zero results (no more local copies)
- Navigate to Billing, Invoices, Payments, Dashboard — all NPR amounts display correctly
- NPR 150,000 displays as `NPR 1,50,000.00` (lakh grouping, not `NPR 150,000.00`)

---

#### Task 1.4 — Wire Overview page with real dashboard data and fix action cards
**Files**:
- `apps/finance/src/routes/overview.tsx`

**Changes**:
- Import `useDashboardSummary` from `@edforge/finance-services`
- Import `formatNPR` from `@edforge/types`
- Import `useAppStore` from stores
- Replace hardcoded `$125,890` etc. with real `summary.totalCollected`, `summary.outstanding`, `summary.overdue`, `summary.collectionRate`
- Format all amounts with `formatNPR()` (NPR, not USD)
- Remove "Expenses (MTD)" stat card (no backend for expenses)
- Show loading spinner while fetching
- Show "Select a school" message when no `activeSchoolId`
- **Fix action cards**:
  - Remove "General Ledger" card (route deleted in Task 1.1)
  - Replace with "Student Accounts" → `/finance/billing/accounts`
  - Fix "Fee Structures" href: `/settings/fee-structures` → `/finance/configuration/fee-structures`

**Validation**:
- Navigate to `/finance` — stats show real NPR amounts from school data
- No `$` currency symbols anywhere
- All 4 action cards navigate to valid Finance module routes
- Empty school shows "No financial data yet" message
- Loading spinner appears while data fetches

---

#### Task 1.5 — Fix DashboardSummary `recentPayments` type alignment
**Files**:
- `edforge-saas-frontend/packages/types/src/payment.ts`
- `apps/finance/src/routes/dashboard/index.tsx` (update type annotation on line ~152)

**Changes**:
```typescript
// In packages/types/src/payment.ts — before:
recentPayments: Payment[]

// After:
recentPayments: Array<{
  id: string
  amount: number
  gateway: string
  status: string
  receiptNumber?: string
  paidAt?: string
  createdAt: string
}>
```
- Update `dashboard/index.tsx` line that types recentPayments as `Payment[]` to use the new inline type

**Why**: Backend intentionally returns a lightweight projection (7 fields) not the full Payment object (18+ fields). Frontend must match the actual API contract.

**Validation**:
- `pnpm typecheck` in types package — zero errors
- `pnpm typecheck` in finance app — zero errors
- Dashboard "Recent Payments" table renders without type coercion

---

### Sprint 2 — Fee Structure Hardening & Form UX

**Goal**: Fix the fee structure configuration form, validate business rules around grade levels, enrollment auto-application, effective dates, and Bikram Sambat academic year. After this sprint, school admins can confidently configure all Nepal school fee types.

**Demoable outcome**: Create fee structures for tuition, admission, exam, transport, lab fees — all with proper grade-level chip selectors, NPR amounts, BS academic year defaults, and tax configuration.

---

#### Task 2.1 — Fix FeeStructureForm modal z-index and overlay
**Files**:
- `apps/finance/src/routes/configuration/fee-structures.tsx`
- `apps/finance/src/components/configuration/FeeStructureForm.tsx`

**Changes**:
- Wrap modal in a portal or add `fixed inset-0 z-50` backdrop
- Add semi-transparent backdrop overlay (`bg-black/50`)
- Ensure form fields don't bleed behind table rows (visible in user screenshot)
- Add `overflow-y-auto max-h-[90vh]` to modal content for smaller screens
- Close modal on Escape key press
- Close modal on backdrop click

**Validation**:
- Open "Add Fee Structure" form — modal appears above table with dark backdrop
- Scroll within modal if content overflows viewport
- Press Escape → modal closes
- Click backdrop → modal closes
- No visual overlap between modal and table rows

---

#### Task 2.2 — Replace grade levels text input with multi-select chips
**Files**:
- `apps/finance/src/components/configuration/FeeStructureForm.tsx`

**Changes**:
- Replace free-text "Grade Levels" input with a multi-select chip component
- Grade options: `['1','2','3','4','5','6','7','8','9','10','11','12']` (Nepal K-12 grades)
- Include "All Grades" toggle that selects/deselects all
- Store as `string[]` in form state (matches backend schema `gradeLevels: z.array(z.string())`)
- When "All Grades" selected, send empty array `[]` (backend interprets as all grades)

**Why**: Current text input (`"1, 2, 3"`) requires users to know exact comma format. Chip selector is clearer and prevents formatting errors.

**Validation**:
- Open fee structure form — grade selector shows clickable grade chips
- Toggle "All Grades" selects/deselects all
- Save with specific grades → API receives `["1","2","3"]`
- Save with all grades → API receives `[]`
- Edit existing fee structure — pre-selected grades highlighted

---

#### Task 2.3 — Add Bikram Sambat academic year utility and form defaults
**Files**:
- `apps/finance/src/utils/bikram-sambat.ts` (new — small utility)
- `apps/finance/src/components/configuration/FeeStructureForm.tsx`

**Changes**:
- Create `getCurrentBSYear()` utility: approximate conversion `gregorianYear + 56` or `+57` depending on month (Baisakh starts mid-April). This is a simple offset — not a full calendar library.
  ```typescript
  export function getCurrentBSYear(): string {
    const now = new Date()
    const gregYear = now.getFullYear()
    const month = now.getMonth() // 0-indexed
    // BS year starts ~mid-April. Before April = previous BS year.
    const bsYear = month < 3 ? gregYear + 56 : gregYear + 57
    return `${bsYear}/${(bsYear + 1) % 100}`  // e.g. "2082/83"
  }
  ```
- Set default `academicYear` in FeeStructureForm to `getCurrentBSYear()` instead of `new Date().getFullYear().toString()`

**Why**: Nepal schools operate on Bikram Sambat calendar. Defaulting to "2026" (Gregorian) when school staff think in "2082/83" (BS) causes confusion.

**Validation**:
- Open fee structure form — academic year field defaults to "2082/83" (or current BS year)
- User can override to any value
- Existing fee structures retain their original academic year on edit

---

#### Task 2.4 — Add fee structure form field validation feedback
**Files**:
- `apps/finance/src/components/configuration/FeeStructureForm.tsx`

**Changes**:
- Ensure Zod validation errors display inline below each field (red text)
- Required fields: name, feeType, amount, frequency, effectiveFrom
- Amount validation: min 0, max 10,000,000 NPR — show "Maximum NPR 1,00,00,000"
- Tax rate validation: 0-100%
- Effective date validation: effectiveTo must be after effectiveFrom (if set)
- Disable Save button while form has errors

**Validation**:
- Submit empty form — all required fields show red error messages
- Enter amount > 10,000,000 — shows max amount error
- Enter tax rate > 100 — shows validation error
- Set effectiveTo before effectiveFrom — shows date range error
- Fix all errors and submit — fee created successfully

---

#### Task 2.5 — Replace `window.confirm()` with styled delete dialog for fee structures
**Files**:
- `apps/finance/src/routes/configuration/fee-structures.tsx`

**Changes**:
- Replace any `window.confirm()` with styled modal dialog component
- Show fee structure name in confirmation: "Delete 'Annual Tuition Fee'?"
- Warning text: "This action cannot be undone. Existing invoices using this fee structure will not be affected."
- Cancel + Confirm Delete buttons, both disabled while `deleteMutation.isPending`
- Trap focus within dialog, close on Escape

**Validation**:
- Click delete icon on fee structure → styled modal appears (not browser dialog)
- Cancel dismisses modal, fee unchanged
- Confirm deletes fee, shows success toast, list refreshes
- Both buttons disabled during deletion

---

#### Task 2.6 — Validate fee structure ↔ enrollment auto-apply flow
**Files**:
- Create `scripts/smoke-tests/finance-fee-enrollment.ts`

**Smoke test**:
1. Create fee structure with `autoApplyOnEnrollment: true` for grade "10"
2. Enroll a student in grade 10 (via Academics module or enrollment webhook)
3. Verify: enrollment webhook fires, billing account created, draft invoice generated with fee
4. Enroll a student in grade 5 — verify no invoice generated (wrong grade level)
5. Create fee with `autoApplyOnEnrollment: false` — verify no auto-invoice on enrollment

**Validation**: Smoke test passes for all 3 scenarios.

---

### Sprint 3 — Invoice Lifecycle Hardening

**Goal**: Validate the complete invoice lifecycle — generation, issue, payment application, status transitions, bulk operations, CSV export, and pagination. After this sprint, the billing workflow is bulletproof.

**Demoable outcome**: Generate invoices for 50 students in bulk, issue them, record payments, see statuses update correctly, paginate through large lists, export to CSV.

---

#### Task 3.1 — Validate invoice status state machine (backend)
**Files**:
- `server/application/microservices/finance/src/invoices/invoices.service.ts` (fix if needed)
- Create `scripts/smoke-tests/finance-invoice-lifecycle.ts`

**Test cases**:
- draft → issued ✓
- issued → partially_paid (via partial payment) ✓
- partially_paid → paid (via full payment) ✓
- issued → overdue (via overdue detection) ✓
- overdue → paid (via payment) ✓
- paid → (any transition) → expect 400 "Terminal state"
- cancelled → (any transition) → expect 400 "Terminal state"
- written_off → (any transition) → expect 400 "Terminal state"
- draft → paid → expect 400 "Must issue first"

**Validation**: Smoke test covers all valid + invalid transitions, expects correct HTTP status codes and error messages.

---

#### Task 3.2 — Replace `window.confirm()` in invoice cancel flows
**Files**:
- `apps/finance/src/routes/billing/invoices/index.tsx` (line 113)
- `apps/finance/src/routes/billing/invoices/$invoiceId.tsx` (line 60)

**Changes**:
- Replace `if (!confirm(...)) return` with styled CancelInvoiceDialog component
- Show invoice number in dialog: "Cancel Invoice INV-XXX-2503-0042?"
- Warning text: "This cannot be undone. The invoice will be marked as cancelled."
- Require reason text input before confirming
- Cancel + Confirm buttons, disabled while mutation pending

**Validation**:
- Click "Cancel" on invoice list → styled modal (not browser dialog)
- Click "Cancel" on invoice detail → same styled modal
- Must enter reason before confirming
- Confirm → invoice cancelled, toast shown, list refreshes

---

#### Task 3.3 — Fix bulk invoice generation error reporting
**Files**:
- `apps/finance/src/components/billing/BulkInvoiceForm.tsx`

**Changes**:
- When bulk generate returns partial failures, show detailed error table:
  - Student name | Error reason | Suggested fix
- Common errors: "Duplicate invoice exists", "No billing account", "Fee structure not applicable to grade"
- Add "Retry Failed" button for transient errors

**Validation**:
- Bulk generate for 5 students, 2 already have invoices → shows 3 success + 2 duplicates with student names
- Error table is scrollable for large batches
- "Retry Failed" retries only the failed students

---

#### Task 3.4 — Fix CSV export download trigger
**Files**:
- `edforge-saas-frontend/packages/finance-services/src/services/invoices.service.ts`

**Changes**:
- Ensure `exportInvoicesCsv()` creates a blob, generates object URL, triggers `<a>` click for download
- Add filename: `invoices-{schoolId}-{YYYY-MM-DD}.csv`
- Handle errors: show toast on failure
- Handle empty data: show "No data to export" toast

**Validation**:
- Click "Export CSV" on invoices page → browser downloads `.csv` file
- Open CSV — contains invoice data with correct NPR amounts
- When no invoices → shows "No data to export" toast

---

#### Task 3.5 — Add invoice and payment list pagination
**Files**:
- `apps/finance/src/routes/billing/invoices/index.tsx`
- `apps/finance/src/routes/billing/payments/index.tsx`
- `edforge-saas-frontend/packages/finance-services/src/hooks/usePayments.ts` (both queries)

**Changes**:
- Add cursor-based pagination using `lastEvaluatedKey` from backend
- Show 25 items per page
- Add "Load More" button at bottom of list
- Show count in header: "Showing 25 of 142 invoices"
- Apply same pattern to both invoices and payments lists (same hook file)
- Filters reset pagination to first page

**Why**: Doing both in one task since they share the same hook file and pattern. Implementing the pagination abstraction once and applying twice.

**Validation**:
- School with >25 invoices → shows first 25 + "Load More"
- Click "Load More" → next batch appends
- School with >25 payments → same behavior
- Change status filter → pagination resets to page 1

---

#### Task 3.6 — Add print-friendly CSS for invoice detail page
**Files**:
- `apps/finance/src/routes/billing/invoices/$invoiceId.tsx`

**Changes**:
- Add `@media print` styles that:
  - Hide sidebar, header, navigation buttons
  - Show school name, invoice number, student name, line items, totals
  - Clean black-on-white layout
  - Include school address/contact if available
- Add "Print" button in invoice detail header

**Why**: Nepal school administrators need to print paper invoices for parents, many of whom don't have regular internet access. Full PDF generation is post-MVP, but `Ctrl+P` with print CSS is essential and low-effort.

**Validation**:
- Open invoice detail → click "Print" or `Ctrl+P`
- Print preview shows clean invoice layout without app chrome
- Line items, totals, student name, dates all visible

---

#### Task 3.7 — Validate invoice detail page with payment history
**Files**: No code changes — validation only

**Validation**:
- Open invoice detail for invoice with 2 partial payments
- Verify: line items, subtotal, tax, discount, grand total all mathematically correct
- Verify: payment history shows both payments with gateway, amount, date
- Verify: "Amount Due" = grandTotal - sum(payments)
- Verify: status badge shows correct state (partially_paid)
- Verify: "Issue" button only visible for draft invoices
- Verify: "Cancel" button not visible for paid invoices

---

### Sprint 4 — Payment Processing & Gateway Hardening

**Goal**: Validate all payment flows — manual recording, gateway initiation/verification, void, refund, and stale payment cleanup. After this sprint, schools can collect payments via cash, bank transfer, eSewa, and Khalti with confidence.

**Demoable outcome**: Record a cash payment, initiate a Khalti payment (test mode), void a payment, process a refund — all with correct ledger entries and styled confirmation dialogs.

---

#### Task 4.1 — Replace `window.confirm()` with styled dialogs for void/refund
**Files**:
- `apps/finance/src/routes/billing/payments/index.tsx`

**Changes**:
- Create VoidPaymentDialog component:
  - Show payment details (amount, gateway, date)
  - Reason text input (required)
  - Cancel + Confirm buttons, disabled while mutation pending
- Create RefundPaymentDialog component:
  - Show payment details
  - Amount input: pre-filled with `payment.amount - alreadyRefunded`, editable for partial refund
  - **Client-side validation**: `refundAmount > 0 && refundAmount <= payment.amount - alreadyRefunded`
  - Show inline error if amount exceeds available refundable amount
  - Reason text input (required)
  - Cancel + Confirm buttons, disabled while mutation pending

**Validation**:
- Click "Void" → styled modal with reason input (not browser dialog)
- Enter reason, confirm → payment voided, invoice updated, ledger entry created
- Click "Refund" → modal with pre-filled amount + reason
- Enter amount > refundable → inline error "Cannot exceed NPR X"
- Valid refund → processed, ledger updated
- Cancel on either dialog → no action taken

---

#### Task 4.2a — Implement payment sweep: pending payment query
**Files**:
- `server/application/microservices/finance/src/common/services/payment-sweep.service.ts`

**Changes**:
- Replace the placeholder `handleCron()` body with actual logic:
  - Use GSI1 query scoped to each active school (not a table scan)
  - Query for PAYMENT entities with `status = 'pending'` and `createdAt < cutoffTime`
  - Cutoff: 30 minutes ago (configurable via env var `PAYMENT_EXPIRY_MINUTES`)
- Add logging: "Found {count} stale pending payments for school {schoolId}"

**Validation**:
- Create a pending gateway payment
- Manually trigger sweep with 0-minute threshold
- Verify: sweep finds the pending payment in logs

---

#### Task 4.2b — Implement payment sweep: expire stale payments
**Files**:
- `server/application/microservices/finance/src/common/services/payment-sweep.service.ts`

**Changes**:
- For each stale payment found in 4.2a:
  - Update status to `failed` with `metadata.failureReason: "Payment session expired"`
  - Use optimistic locking (skip if already updated by another process)
  - Publish `PaymentFailed` event via EventBridge
  - Note: pending gateway payments do NOT pre-debit invoices, so no invoice reversal needed
- Add logging: "Expired {count} stale payments"

**Validation**:
- Create pending payment, trigger sweep
- Verify: payment status = `failed`
- Verify: invoice `amountPaid` unchanged (was never incremented for pending)
- Verify: EventBridge event published
- Check logs: "Expired 1 stale payments"

---

#### Task 4.3 — Validate manual payment flow end-to-end
**Files**:
- Create `scripts/smoke-tests/finance-manual-payment.ts`

**Smoke test**:
1. Create fee structure, generate invoice for NPR 35,000, issue it
2. Record cash payment for NPR 15,000 → verify: status = "partially_paid", amountPaid = 15,000, amountDue = 20,000
3. Record bank transfer for NPR 20,000 → verify: status = "paid", amountPaid = 35,000, amountDue = 0
4. Check student account ledger: 1 debit (invoice issue) + 2 credits (payments), running balance = 0
5. Verify receipt numbers generated: `RCP-{prefix}-{YYMM}-{seq}` format
6. Verify dashboard summary reflects updated totals

**Validation**: Smoke test passes all assertions.

---

#### Task 4.4 — Validate gateway payment flow (Khalti test mode)
**Files**: No code changes — integration test

**Prerequisites**: Khalti test mode gateway configured for the school

**Test steps**:
1. Issue an invoice for NPR 1,000
2. Initiate payment via API → verify redirect URL returned with `pidx`
3. Follow redirect to Khalti test page (test creds: 9806800001, Nepal@123, MPIN: 1122, OTP: 123456)
4. Complete payment at Khalti → gateway redirects back to callback URL
5. Call verify endpoint with callback params
6. Verify: payment marked `completed`, invoice updated, ledger entry created, receipt number generated

**Validation**: End-to-end Khalti test mode payment completes successfully.

---

#### Task 4.5 — Validate void payment reversal
**Files**: No code changes — smoke test (add to `finance-manual-payment.ts`)

**Smoke test**:
1. Issue invoice (NPR 10,000), record cash payment (NPR 10,000) → status = paid
2. Void the payment → verify:
   - Payment status = cancelled/voided
   - Invoice amountPaid reverted to 0, status reverted to "issued"
   - Ledger: credit reversal entry added, running balance back to original
   - Student account balance increased by payment amount
   - Dashboard outstanding increased

---

#### Task 4.6 — Add invoice search/autocomplete to Record Payment page
**Files**:
- `apps/finance/src/routes/billing/payments/record.tsx`

**Changes**:
- Replace raw "Invoice ID" text input with search-by-invoice-number or search-by-student-name
- Query backend: `GET /invoices?search={term}&status=issued,partially_paid,overdue`
- Show dropdown with matching invoices: `INV-XXX-2503-0042 — Student Name — NPR 5,000 due`
- On select: auto-fill invoice details (amount due, student name)
- Validate: selected invoice must be in payable status

**Why**: School admins don't have invoice UUIDs memorized. Searching by student name or invoice number is essential for daily payment recording.

**Validation**:
- Type student name → dropdown shows matching invoices
- Select invoice → amount pre-filled with amountDue
- Submit → payment recorded successfully

---

### Sprint 5 — QA, Error Handling & Production Readiness

**Goal**: Add error boundaries, validate permissions, run comprehensive smoke tests, fix date formatting. After this sprint, the module is ready for pilot school deployment.

**Demoable outcome**: Full walkthrough of Finance module — no crashes, no fake data, correct permissions, consistent date formatting, all flows working end-to-end.

---

#### Task 5.1 — Add React error boundary to Finance MFE root
**Files**:
- `apps/finance/src/layouts/FinanceLayout.tsx`

**Changes**:
- Wrap main content area in an error boundary component
- Fallback UI: "Something went wrong" card with:
  - Error message (dev only, hidden in prod)
  - "Reload" button (calls `window.location.reload()`)
  - "Go to Overview" link
- Log errors to console in dev

**Validation**:
- Trigger a rendering error (e.g., bad data shape) → error boundary catches, shows fallback UI
- Click "Reload" → page refreshes
- Normal navigation → no error boundary visible

---

#### Task 5.2 — Standardize date formatting with locale parameter
**Files** (all files in `apps/finance/src/` using `toLocaleDateString()`):
- `routes/billing/invoices/index.tsx`
- `routes/billing/invoices/$invoiceId.tsx`
- `routes/billing/payments/index.tsx`
- `routes/billing/payments/record.tsx`
- `routes/billing/accounts/index.tsx`
- `routes/dashboard/index.tsx`
- `components/billing/BulkInvoiceForm.tsx`

**Changes**:
- Add `'en-GB'` locale to all `toLocaleDateString()` calls → consistent DD/MM/YYYY format (standard in Nepal)
- Or create a shared `formatDate(dateStr: string): string` utility and import everywhere
- Example: `new Date(date).toLocaleDateString('en-GB')` → "03/03/2026"

**Validation**:
- All dates across Finance module display in DD/MM/YYYY format
- Consistent regardless of browser language settings
- Grep for `toLocaleDateString()` without locale parameter → zero results

---

#### Task 5.3 — Validate RBAC permission matrix
**Files**: No code changes — manual testing

**Test matrix**:
| Role | Overview | Billing | Invoices | Payments | Accounts | Fee Config | Gateway Config | Reports |
|------|----------|---------|----------|----------|----------|------------|----------------|---------|
| TenantAdmin | View | View | View+Create | View+Record | View | Manage | Manage | View |
| Principal | View | View | View+Create | View+Record | View | Manage | Manage | View |
| Accountant | View | View | View+Create | View+Record | View | Manage | Manage | View |
| Teacher | Hidden | Hidden | Hidden | Hidden | Hidden | Hidden | Hidden | Hidden |
| Student | Hidden | Hidden | Hidden | Hidden | Hidden | Hidden | Hidden | Hidden |
| Parent | Hidden | Hidden | Hidden | Hidden | Hidden | Hidden | Hidden | Hidden |

**Validation**:
- Log in as each role → verify sidebar items visible/hidden per matrix
- Attempt API calls as Teacher → verify 403 response
- Attempt API calls as Parent → verify 403 or scoped to linked students

---

#### Task 5.4 — Write comprehensive smoke test suite
**Files**:
- Update `scripts/smoke-tests/finance-billing-flow.ts` (enhance existing)
- Create `scripts/smoke-tests/finance-payment-flow.ts`

**finance-billing-flow.ts** (enhanced):
1. Create fee structure (tuition, NPR 5,000, monthly, grade 10)
2. Create student billing account
3. Generate invoice for student
4. Issue invoice
5. Verify dashboard summary updated
6. Record manual cash payment (full amount)
7. Verify invoice status = paid
8. Verify student account balance = 0
9. Export invoices CSV → verify file downloads
10. Clean up test data

**finance-payment-flow.ts** (new):
1. Issue invoice → record partial cash payment → verify partially_paid
2. Record remaining bank transfer → verify paid
3. Void second payment → verify reverts to partially_paid
4. Verify ledger entries correct at each step (debit count, credit count, running balance)

**Validation**: Both smoke tests pass end-to-end against local dev server.

---

#### Task 5.5 — Validate overdue detection background job
**Files**: No code changes — operational validation

**Validation**:
- Create invoice with dueDate = yesterday, issue it
- Wait for overdue detection cron (or manually trigger)
- Verify: invoice status changed to "overdue"
- Verify: dashboard "overdue" count incremented
- Verify: EventBridge event published (check logs)

---

#### Task 5.6 — Production deployment checklist
**File**: Internal documentation (not a code file)

**Contents**:
- Environment variables required (TABLE_NAME, KHALTI credentials, ESEWA credentials, etc.)
- API Gateway routes verification for all finance endpoints
- DynamoDB table + GSI provisioning check
- Payment gateway credential setup per school (test → production)
- Feature toggle flags: `DISABLE_OVERDUE_DETECTION`, `DISABLE_PAYMENT_SWEEP`
- Known scaling limitations (scan-based overdue detection, in-memory dashboard cache)
- Monitoring: CloudWatch alarms for gateway failures, sweep failures, high error rates

---

## Post-MVP Backlog (Parked)

These features are explicitly **out of scope** for the production MVP but documented for future sprints:

| Feature | Priority | Rationale |
|---------|----------|-----------|
| General Ledger (Chart of Accounts, Journal Entries) | P2 | Full double-entry accounting is enterprise-grade; schools need billing first |
| Accounts Payable (Vendor invoices) | P3 | No vendor management in MVP |
| Accounts Receivable (Aging reports) | P2 | Student accounts + ledger cover basic AR for now |
| Expense Tracking | P3 | Out of scope for billing-focused MVP |
| Payroll | P3 | Separate domain entirely |
| Payment Plans / Installments | P2 | Schools can use partial payments as workaround |
| Automated Payment Reminders | P2 | Requires notification infrastructure |
| Invoice PDF Generation | P2 | Print CSS covers MVP need; full PDF is nice-to-have |
| Multi-currency Support | P3 | All pilot schools use NPR |
| Revenue Forecasting / Trends | P3 | Dashboard summary sufficient for MVP |
| Bulk Payment Import (CSV/Excel) | P2 | Manual recording sufficient for pilot scale |
| Refund-to-Gateway Execution | P2 | Manual refund tracking exists; gateway-initiated refund API calls not wired |
| FonePay / ConnectIPS / IME Pay Adapters | P2 | Khalti + eSewa + Cash cover 95% of Nepal payments |
| Overdue Detection GSI3 Refactor | P1 | Replace table scan with GSI3 date query before scaling beyond pilot |
| Nepali (ne-NP) Language / Devanagari UI | P2 | `formatNPR` supports Nepali locale; full UI i18n is post-MVP |
| Accessibility (WCAG 2.1 AA) | P2 | Focus trapping added for modals; full audit post-MVP |

---

## File Change Summary by Sprint

### Sprint 1 (12 files changed, 4 deleted)
| Action | File |
|--------|------|
| Delete | `apps/finance/src/routes/ledger/index.tsx` |
| Delete | `apps/finance/src/routes/expenses/index.tsx` |
| Delete | `apps/finance/src/routes/payroll/index.tsx` |
| Delete | `apps/finance/src/routes/tuition/index.tsx` |
| Edit | `apps/finance/src/router.tsx` |
| Edit | `apps/shell/src/config/sidebar-modules.ts` |
| Edit | `apps/finance/src/routes/overview.tsx` |
| Edit | `apps/finance/src/routes/billing/index.tsx` |
| Edit | `apps/finance/src/routes/billing/invoices/index.tsx` |
| Edit | `apps/finance/src/routes/billing/invoices/$invoiceId.tsx` |
| Edit | `apps/finance/src/routes/billing/payments/index.tsx` |
| Edit | `apps/finance/src/routes/billing/payments/record.tsx` |
| Edit | `apps/finance/src/routes/billing/accounts/index.tsx` |
| Edit | `apps/finance/src/routes/dashboard/index.tsx` |
| Edit | `apps/finance/src/components/billing/BulkInvoiceForm.tsx` |
| Edit | `apps/finance/src/components/configuration/FeeStructureList.tsx` |
| Edit | `edforge-saas-frontend/packages/types/src/payment.ts` |

### Sprint 2 (4 files changed, 1 created)
| Action | File |
|--------|------|
| Edit | `apps/finance/src/routes/configuration/fee-structures.tsx` |
| Edit | `apps/finance/src/components/configuration/FeeStructureForm.tsx` |
| Create | `apps/finance/src/utils/bikram-sambat.ts` |
| Create | `scripts/smoke-tests/finance-fee-enrollment.ts` |

### Sprint 3 (6 files changed, 2 created)
| Action | File |
|--------|------|
| Edit | `apps/finance/src/routes/billing/invoices/index.tsx` |
| Edit | `apps/finance/src/routes/billing/invoices/$invoiceId.tsx` |
| Edit | `apps/finance/src/components/billing/BulkInvoiceForm.tsx` |
| Edit | `packages/finance-services/src/services/invoices.service.ts` |
| Edit | `packages/finance-services/src/hooks/usePayments.ts` |
| Edit | `apps/finance/src/routes/billing/payments/index.tsx` |
| Create | `scripts/smoke-tests/finance-invoice-lifecycle.ts` |

### Sprint 4 (4 files changed, 1 created)
| Action | File |
|--------|------|
| Edit | `apps/finance/src/routes/billing/payments/index.tsx` |
| Edit | `apps/finance/src/routes/billing/payments/record.tsx` |
| Edit | `server/application/microservices/finance/src/common/services/payment-sweep.service.ts` |
| Create | `scripts/smoke-tests/finance-manual-payment.ts` |

### Sprint 5 (9 files changed, 1 created)
| Action | File |
|--------|------|
| Edit | `apps/finance/src/layouts/FinanceLayout.tsx` |
| Edit | `apps/finance/src/routes/billing/invoices/index.tsx` |
| Edit | `apps/finance/src/routes/billing/invoices/$invoiceId.tsx` |
| Edit | `apps/finance/src/routes/billing/payments/index.tsx` |
| Edit | `apps/finance/src/routes/billing/payments/record.tsx` |
| Edit | `apps/finance/src/routes/billing/accounts/index.tsx` |
| Edit | `apps/finance/src/routes/dashboard/index.tsx` |
| Edit | `scripts/smoke-tests/finance-billing-flow.ts` |
| Create | `scripts/smoke-tests/finance-payment-flow.ts` |

---

## Task Count Summary

| Sprint | Code Tasks | Validation/Test Tasks | Total |
|--------|-----------|----------------------|-------|
| 1 — Clean Foundation | 5 | 0 | 5 |
| 2 — Fee Structure Hardening | 5 | 1 | 6 |
| 3 — Invoice Lifecycle | 5 | 2 | 7 |
| 4 — Payment Processing | 4 | 3 | 7 |
| 5 — QA & Production Readiness | 3 | 3 | 6 |
| **Total** | **22** | **9** | **31** |
