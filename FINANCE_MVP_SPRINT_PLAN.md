# EdForge Finance MVP — Sprint Plan & Implementation Tickets

**Source:** Architecture Specification v1.0 + Peer Review (March 15, 2026)
**Goal:** Each sprint produces demoable, testable, buildable software. Each ticket is an atomic, commitable unit of work.

> **Parallel execution note:** Sprints 2 and 3 have no cross-dependencies and can run in parallel after Sprint 1 completes.

---

## Sprint 1: Enrollment-to-Invoice Core Flow + Security Baseline

**Sprint Goal:** A student enrollment event triggers the creation of a correctly issued invoice with duplicate protection. Test credentials are cleaned from source. Payment Gateways UI nav item is removed.

**Demo:** Enroll a student via the academics webhook → billing account created → invoice auto-generated and auto-issued → ledger debit entry created → re-sending the same webhook produces no duplicate. Finance sidebar has no Payment Gateways link.

**Tickets: 14 | Points: 22**

---

### S1-T1: Add `enrollmentId` field to `InvoiceEntity`

**Type:** Schema Change | **Depends on:** Nothing | **Points:** 1

**What:**
Add `enrollmentId?: string` as an optional top-level attribute on `InvoiceEntity`. Stores the enrollment event ID that triggered invoice creation. Enables idempotency checks and enrollment-to-obligation traceability.

**Files to modify:**
- `finance/src/common/entities/invoice.entity.ts` — Add `enrollmentId?: string` to `InvoiceEntity` interface (after line 53). Add it to `createInvoiceEntity()` params and entity construction.
- `packages/shared-types/src/schemas/finance/invoice.schema.ts` — Add `enrollmentId: uuidSchema.optional()` to `invoiceResponseSchema` (after line 53).
- `finance/src/common/mappers/invoice.mapper.ts` — Map `enrollmentId` in entity→DTO mapper.

**What NOT to change:** No DynamoDB table/GSI changes needed — this is a new attribute on existing items, DynamoDB is schemaless.

**Validation:**
- `npm run build` passes (both `finance` and `shared-types`)
- Existing invoice creation still works (field is optional)
- TypeScript: `InvoiceEntity` type includes `enrollmentId?: string`

---

### S1-T2: Add `gradeLevel` field to `InvoiceEntity`

**Type:** Schema Change | **Depends on:** Nothing (parallel with S1-T1) | **Points:** 1

**What:**
Add `gradeLevel?: string` as a top-level attribute on `InvoiceEntity`. Denormalized from the enrollment webhook payload at creation time. Enables grade-level reporting without cross-service calls.

**Files to modify:**
- `finance/src/common/entities/invoice.entity.ts` — Add `gradeLevel?: string` to interface and `createInvoiceEntity()`.
- `packages/shared-types/src/schemas/finance/invoice.schema.ts` — Add `gradeLevel: z.string().optional()` to `invoiceResponseSchema`.
- `finance/src/common/mappers/invoice.mapper.ts` — Map `gradeLevel`.

**Validation:**
- `npm run build` passes
- Existing invoice creation still works

---

### S1-T3: Add `statusHistory` field to `InvoiceEntity`

**Type:** Schema Change | **Depends on:** Nothing (parallel with S1-T1, S1-T2) | **Points:** 1

**What:**
Add `statusHistory?: StatusHistoryEntry[]` as an embedded array on `InvoiceEntity` where each entry has `{ from: string; to: string; changedAt: string; changedBy: string; reason?: string }`. Initialize as empty array on creation.

**Files to modify:**
- `finance/src/common/entities/invoice.entity.ts` — Define `StatusHistoryEntry` interface. Add `statusHistory?: StatusHistoryEntry[]` to `InvoiceEntity`. Initialize to `[]` in `createInvoiceEntity()`.
- `packages/shared-types/src/schemas/finance/invoice.schema.ts` — Add `statusHistoryEntrySchema` and `statusHistory` to `invoiceResponseSchema`.
- `finance/src/common/mappers/invoice.mapper.ts` — Map `statusHistory`.

**Validation:**
- `npm run build` passes
- New invoices have `statusHistory: []`

---

### S1-T4: Populate `statusHistory` in `update()` and `issue()`

**Type:** Logic Change | **Depends on:** S1-T3 | **Points:** 2

**What:**
First half of statusHistory population. Modify `InvoicesService.update()` and `issue()` to append to `statusHistory` on status transitions.

**Critical:** Use `list_append(if_not_exists(statusHistory, :emptyList), :historyEntry)` in all DynamoDB UpdateExpressions. This ensures backward compatibility with existing invoices that were created before the `statusHistory` field existed — `if_not_exists` initializes the list on first append.

**Files to modify:**
- `finance/src/invoices/invoices.service.ts`:
  - In `update()` (line ~383): When `dto.status` is set, append `{ from: existing.status, to: dto.status, changedAt: now, changedBy: context.userId }` to `statusHistory` via `list_append(if_not_exists(...))`.
  - In `issue()` (line ~427): Append `{ from: 'draft', to: 'issued', changedAt: now, changedBy: context.userId }`.

**Validation:**
- Create an invoice (status: draft, statusHistory: [])
- Issue it → statusHistory has 1 entry `{ from: 'draft', to: 'issued' }`
- Update status on pre-existing invoice (no `statusHistory` field) → `if_not_exists` creates it, entry appended without error

---

### S1-T5: Populate `statusHistory` in `applyPayment()` and `reversePaymentOnInvoice()`

**Type:** Logic Change | **Depends on:** S1-T3 | **Points:** 2

**What:**
Second half of statusHistory population. Modify `InvoicesService.applyPayment()` and `reversePaymentOnInvoice()` to append to `statusHistory` when status changes.

**Critical:** Same `if_not_exists(statusHistory, :emptyList)` pattern as S1-T4 for backward compatibility.

**Files to modify:**
- `finance/src/invoices/invoices.service.ts`:
  - In `applyPayment()` (line ~465): Append history entry when status changes from current to `paid`/`partially_paid`.
  - In `reversePaymentOnInvoice()` (line ~518): Append history entry for status revert.

**Validation:**
- Apply payment that changes status → statusHistory has entry `{ from: 'issued', to: 'paid' }`
- Reverse payment → statusHistory has entry `{ from: 'paid', to: 'issued' }`
- All entries have `changedAt` (ISO timestamp) and `changedBy` (userId)

---

### S1-T6: Add `autoIssue` parameter to `InvoicesService.generate()`

**Type:** Logic Change | **Depends on:** S1-T3 (statusHistory field must exist; does NOT depend on S1-T4/T5 since autoIssue writes its own initial entry) | **Points:** 3

**What:**
Add optional `autoIssue?: boolean` parameter to `GenerateInvoiceDto` and `InvoicesService.generate()`. When `true`, the invoice is created with status `issued` (not `draft`), `issuedDate` set to the provided value, and the ledger debit entry is created inline.

**Files to modify:**
- `packages/shared-types/src/schemas/finance/invoice.schema.ts` — Add `autoIssue: z.boolean().optional()` and `issuedDate: dateSchema.optional()` to `generateInvoiceSchema`.
- `finance/src/invoices/invoices.service.ts` — In `generate()`:
  - If `dto.autoIssue === true`: set `status: 'issued'` instead of `'draft'` in `createInvoiceEntity()` call (line ~159). Set `issuedDate` from `dto.issuedDate || now`.
  - After putItem: if autoIssue, create ledger debit entry (extract from `issue()` method, lines 441-456).
  - Populate `statusHistory` with initial `[{ from: 'draft', to: 'issued', changedAt: issuedDate, changedBy: context.userId }]` in the entity itself.

**Validation:**
- `generate()` with `autoIssue: false` (default) → invoice status is `draft`, no ledger entry
- `generate()` with `autoIssue: true` → invoice status is `issued`, ledger debit entry exists, `statusHistory` has one entry
- Overdue detection service picks up auto-issued invoices after due date passes

---

### S1-T7: Update enrollment webhook Zod schema

**Type:** Schema Change | **Depends on:** Nothing (parallel) | **Points:** 1

**What:**
Add three fields to `enrollmentCompletedSchema` in the webhook controller: `enrollmentId`, `enrollmentType`, `enrollmentDate`. These flow from the academics service.

> **Deployment ordering:** Finance may deploy before academics sends the new fields. Make `enrollmentId` **optional** (`z.string().optional()`) in the initial deployment. S1-T10 handles `undefined` gracefully (skips idempotency check if missing). After academics deploys with the new payload fields, a follow-up can tighten the schema to required.

**Files to modify:**
- `finance/src/webhooks/enrollment-webhook.controller.ts` — Update `enrollmentCompletedSchema` (lines 32-41):
  - Add `enrollmentId: z.string().optional()` (optional for deployment ordering safety)
  - Add `enrollmentType: z.enum(['new_admission', 'transfer', 'returning', 're_enrollment']).optional()`
  - Add `enrollmentDate: z.string().min(1)` (ISO date — required, falls back to `new Date().toISOString()` if missing)
- `academics/src/enrollment/enrollment.service.ts` — In the HTTP webhook POST (around line 220), include `enrollmentId`, `enrollmentType`, `enrollmentDate` in the payload.

**Validation:**
- Webhook accepts payload with all new fields
- Webhook accepts payload without `enrollmentId` (optional for transition period)
- Webhook still accepts payload without optional `enrollmentType`
- `enrollmentDate` validation: rejects empty string, accepts ISO date

---

### S1-T8: Wire `EnrollmentBillingService` into the module

**Type:** Wiring Fix | **Depends on:** S1-T7 | **Points:** 1

**What:**
Register `EnrollmentBillingService` (and its dependency `ProRateService`) in `enrollment-webhook.module.ts` providers. Inject it into the controller constructor.

**Files to modify:**
- `finance/src/webhooks/enrollment-webhook.module.ts` — Add imports for `EnrollmentBillingService` and `ProRateService`. Add both to `providers` array.
- `finance/src/webhooks/enrollment-webhook.controller.ts` — Add `private readonly enrollmentBillingService: EnrollmentBillingService` to constructor injection.

**Do NOT delete the controller's inline logic yet — that happens in S1-T11.**

**Validation:**
- Application starts without NestJS dependency injection errors
- `EnrollmentBillingService` is instantiated (add a log in constructor: `this.logger.log('EnrollmentBillingService initialized')`)
- Existing webhook endpoint still works (controller still uses its own inline logic)

---

### S1-T9: Update `EnrollmentBillingService` params and idempotency

**Type:** Logic Change | **Depends on:** S1-T8 | **Points:** 2

**What:**
Update `EnrollmentBillingParams` interface with new fields and implement idempotency check. This is the first half of the service update — focused on params and duplicate detection only.

**Files to modify:**
- `finance/src/webhooks/enrollment-billing.service.ts`:
  - Update `EnrollmentBillingParams` interface: add `enrollmentId?: string`, `enrollmentType?: string`, `enrollmentDate: string`.
  - In `handleEnrollment()` — **new step before billing account creation:** If `params.enrollmentId` is defined, query existing invoices for this student via `listForStudents()` and check if any have `enrollmentId === params.enrollmentId`. If found, return early with existing data (idempotent).
  - If `enrollmentId` is `undefined` (transition period), skip the idempotency check.

**Validation:**
- Call `handleEnrollment()` with `enrollmentId` → creates invoice
- Call again with same `enrollmentId` → returns same data, no new invoice created
- Call with `enrollmentId: undefined` → creates invoice (no idempotency check, backward compat)
- Call with different `enrollmentId` for same student → creates new invoice

---

### S1-T10: Wire autoIssue and new fields into enrollment billing generate call

**Type:** Logic Change | **Depends on:** S1-T1, S1-T2, S1-T6, S1-T9 | **Points:** 2

**What:**
Update the `invoicesService.generate()` call in `EnrollmentBillingService` to pass `autoIssue: true`, `enrollmentId`, `gradeLevel`, and `issuedDate: enrollmentDate`. Keep the hardcoded `dueDate = new Date() + 30 days` with a TODO annotation.

**Files to modify:**
- `finance/src/webhooks/enrollment-billing.service.ts`:
  - In `handleEnrollment()` — Update the generate call:
    - Pass `autoIssue: true`
    - Pass `issuedDate: params.enrollmentDate`
    - Pass `enrollmentId: params.enrollmentId` (may be undefined)
    - Pass `gradeLevel: params.gradeLevel`
  - Keep the hardcoded `dueDate = new Date() + 30 days` — annotate with `// TODO: S2-T3 will replace with fee structure due date rules`

**Validation:**
- Call `handleEnrollment()` → returns `{ accountId, invoiceId, feeCount }`
- Generated invoice has `enrollmentId` set (when provided), `gradeLevel` set, `status: 'issued'`, `statusHistory` with one entry
- Ledger debit entry exists for the auto-issued invoice

---

### S1-T11: Refactor controller to delegate to `EnrollmentBillingService`

**Type:** Refactor | **Depends on:** S1-T10 | **Points:** 2

**What:**
Delete the inline billing logic from `EnrollmentWebhookController.handleEnrollmentCompleted()`. Replace with a single delegation to `EnrollmentBillingService.handleEnrollment()`. The controller becomes: Zod validation → build params → build context → delegate → return.

**Files to modify:**
- `finance/src/webhooks/enrollment-webhook.controller.ts`:
  - Delete lines ~94-167 (inline billing account creation, fee lookup, invoice generation, event publishing).
  - Replace with: `return this.enrollmentBillingService.handleEnrollment(params, context)`.
  - Remove unused constructor injections now handled by the service: `StudentAccountsService`, `InvoicesService`, `FeeStructuresService`, `FinanceEventsService`, `IdentityClientService`.
- `finance/src/webhooks/enrollment-webhook.module.ts` — Clean up providers accordingly.

**Validation:**
- `POST /internal/webhooks/enrollment-completed` with valid payload → creates billing account + issued invoice
- Same payload again → returns existing data (idempotent)
- `POST /internal/webhooks/student-withdrawn` still works (separate handler, unchanged)
- Application builds and starts clean, no dead imports

---

### S1-T12: Verify + fix overdue detection compatibility with auto-issued invoices

**Type:** Validation / Bug Fix | **Depends on:** S1-T11 | **Points:** 1

**What:**
Confirm that `OverdueDetectionService` correctly picks up auto-issued enrollment invoices past their due date. The `markOverdue()` method (line 160-178) uses a direct DynamoDB `updateItem` — it does NOT go through `InvoicesService.update()`, so it won't populate `statusHistory`. Fix this.

**Files to modify:**
- `finance/src/common/services/overdue-detection.service.ts` — In `markOverdue()` (line 160-178): Add `statusHistory` append to the UpdateExpression: `SET ..., statusHistory = list_append(if_not_exists(statusHistory, :emptyList), :historyEntry)` with `:historyEntry` containing `[{ from: invoice.status, to: 'overdue', changedAt: now, changedBy: 'system' }]`.

**Validation:**
- Create an auto-issued invoice with dueDate in the past
- Trigger `detectOverdue()`
- Invoice status changes to `overdue`
- `statusHistory` includes `{ from: 'issued', to: 'overdue', changedBy: 'system' }`

---

### S1-T13: Remove test credentials from adapter comment blocks

**Type:** Security / Hygiene | **Depends on:** Nothing (parallel) | **Points:** 1

**What:**
The eSewa and Khalti adapter files contain hardcoded test credentials in JSDoc comment blocks (lines 10-11 in esewa.adapter.ts, line 11 in khalti.adapter.ts). **These are NOT in runtime code** — the adapters correctly use `config.credentials.*` at runtime. However, test credentials in source code comments risk leakage via repo exposure and should be removed.

**Files to modify:**
- `finance/src/payment-gateways/adapters/esewa.adapter.ts` — Remove lines with `EPAYTEST` and `8gBm/:&EnhH.1/q` from the JSDoc block. Replace with: `*   Credentials: configured via GatewayConfig entity (never hardcoded)`.
- `finance/src/payment-gateways/adapters/khalti.adapter.ts` — Remove line with `9806800001/Nepal@123/1122/123456` from JSDoc block. Replace with: `*   Test credentials: see Khalti developer docs`.

**Validation:**
- `grep -r 'EPAYTEST\|8gBm\|9806800001\|Nepal@123' finance/src/` returns no results
- `npm run build` passes
- Adapter runtime behavior unchanged (credentials come from config, not comments)

---

### S1-T14: Remove Payment Gateways nav item from finance UI sidebar

**Type:** UI Change | **Depends on:** Nothing (parallel) | **Points:** 1

**Files to modify:**
- `edforge-saas-frontend/apps/shell/src/config/sidebar-modules.ts` — Remove the `payment-gateways` entry from the `configuration` group in `financeModule`.

**Validation:**
- Finance sidebar shows: Overview, Billing, Student Accounts, Payments, Reports, Fee Structures
- "Payment Gateways" does NOT appear
- Frontend builds

---

## Sprint 2: Fee Structure Enhancements

> **Can run in parallel with Sprint 3** — no cross-dependencies.

**Sprint Goal:** Fee structures drive correct due dates and apply to the right enrollment types. Schools can configure fee catalogs that produce correct obligations.

**Demo:** Create fee structures with different due date rules and enrollment types → enroll students of different types → verify each gets correct fees with correct due dates.

**Tickets: 5 | Points: 8**

---

### S2-T1: Add `dueDateRule` to `FeeStructureEntity`

**Type:** Schema Change | **Depends on:** Sprint 1 complete | **Points:** 1

**What:**
Add `dueDateRule?: DueDateRule` to `FeeStructureEntity` where `DueDateRule = { type: 'days_after_enrollment' | 'fixed_day_of_month' | 'on_enrollment'; days?: number; dayOfMonth?: number }`.

**Files to modify:**
- `finance/src/common/entities/fee-structure.entity.ts` — Define `DueDateRule` interface. Add `dueDateRule?: DueDateRule` to `FeeStructureEntity`. Default to `undefined` in `createFeeStructureEntity()`.
- `packages/shared-types/src/schemas/finance/fee-structure.schema.ts` — Add `dueDateRuleSchema` to create/update/response schemas.
- `finance/src/common/mappers/fee-structure.mapper.ts` — Map `dueDateRule`.

**Validation:**
- `npm run build` passes
- Create fee structure without `dueDateRule` → works (backward compatible)
- Create fee structure with `dueDateRule: { type: 'days_after_enrollment', days: 15 }` → stored and returned correctly

---

### S2-T2: Implement due date calculation utility

**Type:** New Utility | **Depends on:** S2-T1 | **Points:** 2

**What:**
Create a pure function `calculateDueDate(rule: DueDateRule | undefined, enrollmentDate: string): string` that returns a YYYY-MM-DD string.

**Logic:**
- `undefined` → `enrollmentDate + 30 days` (backward compatibility)
- `{ type: 'on_enrollment' }` → `enrollmentDate`
- `{ type: 'days_after_enrollment', days: N }` → `enrollmentDate + N days`
- `{ type: 'fixed_day_of_month', dayOfMonth: D }` → if enrollment is before day D this month, return D of this month; otherwise D of next month. Clamp D to 28.

**Files to create:**
- `finance/src/common/utils/due-date.util.ts`

**Validation (inline assertions in a test file or script):**
- `calculateDueDate(undefined, '2026-03-15')` → `'2026-04-14'`
- `calculateDueDate({ type: 'on_enrollment' }, '2026-03-15')` → `'2026-03-15'`
- `calculateDueDate({ type: 'days_after_enrollment', days: 7 }, '2026-03-15')` → `'2026-03-22'`
- `calculateDueDate({ type: 'fixed_day_of_month', dayOfMonth: 1 }, '2026-03-15')` → `'2026-04-01'`
- `calculateDueDate({ type: 'fixed_day_of_month', dayOfMonth: 20 }, '2026-03-15')` → `'2026-03-20'`

---

### S2-T3: Wire due date calculation into enrollment billing

**Type:** Logic Change | **Depends on:** S2-T2 | **Points:** 2

**What:**
Replace the hardcoded `dueDate = new Date() + 30 days` in `EnrollmentBillingService.handleEnrollment()` with `calculateDueDate()` using the fee structure's `dueDateRule` and `enrollmentDate`.

When multiple fee structures have different rules, use the **earliest** due date (most conservative).

**Files to modify:**
- `finance/src/webhooks/enrollment-billing.service.ts` — Import `calculateDueDate`. After fetching fees, compute `dueDate = Math.min(...fees.map(f => calculateDueDate(f.dueDateRule, params.enrollmentDate)))`.

**Validation:**
- Fee with `{ type: 'days_after_enrollment', days: 7 }` + enrollmentDate `2026-03-15` → invoice dueDate = `2026-03-22`
- Fee with no `dueDateRule` → invoice dueDate = enrollmentDate + 30 days
- Two fees with different rules → invoice dueDate = earlier of the two

---

### S2-T4: Add `enrollmentTypes` to `FeeStructureEntity`

**Type:** Schema Change | **Depends on:** Sprint 1 complete | **Points:** 1

**What:**
Add `enrollmentTypes?: string[]` to `FeeStructureEntity`. Empty array or undefined means "applies to all enrollment types."

**Files to modify:**
- `finance/src/common/entities/fee-structure.entity.ts` — Add field, default `[]`.
- `packages/shared-types/src/schemas/finance/common.ts` — Add `enrollmentTypeEnum = z.enum(['new_admission', 'transfer', 'returning', 're_enrollment'])`.
- `packages/shared-types/src/schemas/finance/fee-structure.schema.ts` — Add `enrollmentTypes` to create/update/response schemas.
- `finance/src/common/mappers/fee-structure.mapper.ts` — Map field.

**Validation:**
- `npm run build` passes
- Create fee structure with `enrollmentTypes: ['new_admission']` → stored correctly
- Create without `enrollmentTypes` → applies to all (backward compat)

---

### S2-T5: Filter enrollment fees by enrollment type

**Type:** Logic Change | **Depends on:** S2-T4, S1-T7 | **Points:** 2

**What:**
Update `FeeStructuresService.getEnrollmentFees()` to filter by enrollment type. Update `EnrollmentBillingService` to pass it through.

**Files to modify:**
- `finance/src/fee-structures/fee-structures.service.ts` — In `getEnrollmentFees()` (line ~350): add `enrollmentType?: string` parameter. Add client-side filter: if `fs.enrollmentTypes.length > 0 && enrollmentType`, only include where `fs.enrollmentTypes.includes(enrollmentType)`.
- `finance/src/webhooks/enrollment-billing.service.ts` — Pass `params.enrollmentType` to `getEnrollmentFees()`.

**Validation:**
- Fee with `enrollmentTypes: ['new_admission']` → included for `new_admission`, excluded for `transfer`
- Fee with `enrollmentTypes: []` → included for all types
- Fee with `enrollmentTypes: ['transfer', 'returning']` → excluded for `new_admission`

---

## Sprint 3: Manual Payments & Reporting

> **Can run in parallel with Sprint 2** — no cross-dependencies.

**Sprint Goal:** Administrators can record manual payments and view accurate financial reports with grade-level breakdowns, fee-type breakdowns, and aging data.

**Demo:** Record a manual cash payment → invoice status updates → ledger shows credit → dashboard reflects collection → aging report shows overdue buckets.

**Tickets: 7 | Points: 13**

---

### S3-T1: Harden `recordManualPayment()` error handling

**Type:** Bug Fix | **Depends on:** Sprint 1 complete | **Points:** 2

**What:**
Wrap `applyPayment()` and `recordLedgerEntry()` calls in `recordManualPayment()` with try/catch blocks that log at CRITICAL severity but do NOT revert the payment record. Match the pattern in `completePayment()` (line 667-715).

**Files to modify:**
- `finance/src/payments/payments.service.ts` — In `recordManualPayment()` (lines 126-153):
  - Wrap `this.invoicesService.applyPayment(...)` in try/catch. On failure log: `{ action: 'payment.manual_partial_failure', step: 'apply_to_invoice', paymentId, invoiceId, schoolId, amount, receiptNumber, error: err.message, message: 'CRITICAL: Payment recorded but invoice update failed. Manual reconciliation required.' }`
  - Wrap `this.studentAccountsService.recordLedgerEntry(...)` in same pattern.

**Validation:**
- Normal payment → all three steps succeed
- Simulate applyPayment failure → payment IS recorded, CRITICAL log emitted, function completes
- Log includes paymentId, invoiceId, amount, receiptNumber for manual reconciliation

---

### S3-T2: Design `RecordManualPaymentDto` for future multi-invoice support

**Type:** Schema Change | **Depends on:** Nothing | **Points:** 1

**What:**
Add `invoiceIds?: string[]` alongside existing `invoiceId`. If `invoiceIds` has >1 entry, return 501 Not Implemented. Single entry treated same as `invoiceId`.

**Files to modify:**
- `packages/shared-types/src/schemas/finance/payment.schema.ts` — Add `invoiceIds: z.array(uuidSchema).optional()`.
- `finance/src/payments/payments.service.ts` — If `dto.invoiceIds?.length > 1`, throw `NotImplementedException`. If length === 1, use `dto.invoiceIds[0]`.

**Validation:**
- Existing single `invoiceId` → works unchanged
- `invoiceIds: ['abc']` → works (single)
- `invoiceIds: ['abc', 'def']` → 501 Not Implemented

---

### S3-T3: Add grade-level breakdown to dashboard

**Type:** Feature | **Depends on:** S1-T2 | **Points:** 2

**What:**
Add `outstandingByGrade: Record<string, number>` to `DashboardSummary`.

**Files to modify:**
- `finance/src/dashboard/dashboard.service.ts` — In `getSummary()`, accumulate `amountDue` by `gradeLevel` for invoices with outstanding status. Add to interface and return.

**Validation:**
- Invoices with `gradeLevel: 'Grade 1'`, `amountDue: 5000` → `outstandingByGrade['Grade 1'] === 5000`
- Missing `gradeLevel` → bucketed under `'Unknown'`

---

### S3-T4: Add fee-type breakdown to dashboard

**Type:** Feature | **Depends on:** Nothing | **Points:** 2

**What:**
Add `outstandingByFeeType: Record<string, number>` to `DashboardSummary`. Aggregate from `lineItems[].description` for outstanding invoices (status `issued`, `partially_paid`, or `overdue`).

**Files to modify:**
- `finance/src/dashboard/dashboard.service.ts` — For each outstanding invoice, iterate `lineItems`, bucket `lineItem.amount` totals by `description` (the fee name).

**Validation:**
- Invoice with "Admission Fee" line item (3000) and "Tuition Fee" line item (5000), status `issued` → `outstandingByFeeType['Admission Fee'] === 3000`, `outstandingByFeeType['Tuition Fee'] === 5000`
- Multiple invoices → values accumulate across invoices
- `paid` or `cancelled` invoices → excluded from breakdown

---

### S3-T5: Add aging report to dashboard

**Type:** Feature | **Depends on:** Nothing | **Points:** 2

**What:**
Add `agingBuckets: { current: number; overdue30: number; overdue60: number; overdue90plus: number }` to `DashboardSummary`.

**Files to modify:**
- `finance/src/dashboard/dashboard.service.ts` — For each outstanding invoice: compute `daysPastDue = today - dueDate`. Bucket: `<=0` → current, `1-30` → overdue30, `31-60` → overdue60, `61+` → overdue90plus.

**Validation:**
- Invoice due tomorrow → `current`
- Invoice due 15 days ago → `overdue30`
- Invoice due 45 days ago → `overdue60`
- Invoice due 100 days ago → `overdue90plus`
- Values are `amountDue` sums

---

### S3-T6: Add monthly collection summary to dashboard

**Type:** Feature | **Depends on:** Nothing | **Points:** 1

**What:**
Add `monthlyCollections: Array<{ month: string; amount: number; count: number }>` to `DashboardSummary`.

**Files to modify:**
- `finance/src/dashboard/dashboard.service.ts` — Group completed payments by `YYYY-MM` from `paidAt`. Sort chronologically. Return last 12 months.

**Validation:**
- 3 payments in March totaling 15,000 → `{ month: '2026-03', amount: 15000, count: 3 }`
- Months with no payments → absent from array

---

### S3-T7: Update `DashboardSummary` in shared-types Zod schema

**Type:** Schema Change | **Depends on:** S3-T3, S3-T4, S3-T5, S3-T6 | **Points:** 3

**What:**
The `DashboardSummary` interface is currently defined locally in `dashboard.service.ts` (not in shared-types). Add a Zod schema to shared-types so the frontend can type-check dashboard responses.

**Files to modify:**
- `packages/shared-types/src/schemas/finance/dashboard.schema.ts` — Create (or update if exists) with schemas for `DashboardSummary` including all new fields: `outstandingByGrade`, `outstandingByFeeType`, `agingBuckets`, `monthlyCollections`.
- `packages/shared-types/src/schemas/finance/index.ts` — Export dashboard schemas.
- `finance/src/dashboard/dashboard.service.ts` — Import types from shared-types instead of defining locally. Ensure the local interface matches the Zod schema.

**Validation:**
- `npm run build` passes (both `finance` and `shared-types`)
- Frontend can import `DashboardSummary` type from `@aibrains/shared-types`
- Response from `GET /finance/schools/{schoolId}/dashboard` validates against the schema

---

## Sprint 4: Production Hardening & Feature Gates

**Sprint Goal:** Disable out-of-scope features, verify MVP works end-to-end. System is safe to hand to pilot schools.

**Demo:** Gateway endpoints return 404. Full workflow (fee config → enrollment → invoice → payment → dashboard) works.

**Tickets: 4 | Points: 8**

---

### S4-T1: Comment out gateway adapter registrations

**Type:** Configuration | **Depends on:** Nothing | **Points:** 1

**What:**
Comment out eSewa and Khalti adapter registrations in `GatewayAdapterRegistryService` so `hasAdapter()` returns `false`.

**Files to modify:**
- `finance/src/payment-gateways/adapters/gateway-adapter-registry.service.ts` — Comment out registrations with `// Disabled for MVP — re-enable when gateway integration is in scope`.

**Validation:**
- `hasAdapter('esewa')` returns `false`
- `hasAdapter('khalti')` returns `false`

---

### S4-T2: Disable payment sweep background job

**Type:** Configuration | **Depends on:** Nothing | **Points:** 1

**What:**
Set `DISABLE_PAYMENT_SWEEP=true` in ECS task definition environment.

**Files to modify:**
- `server/lib/service-info.json` — Add env var to finance service.

**Validation:**
- On startup: `Payment sweep disabled by DISABLE_PAYMENT_SWEEP env var`

---

### S4-T3: Remove out-of-scope routes from API Gateway

**Type:** Configuration | **Depends on:** Nothing | **Points:** 2

**Routes to remove from `server/lib/tenant-api-prod.json`:**
- `POST /finance/schools/{schoolId}/payments/initiate`
- `GET /finance/payments/verify/{sessionId}`
- `POST /finance/schools/{schoolId}/payments/{paymentId}/refund`
- All `/finance/schools/{schoolId}/payment-gateways/*`
- All `/finance/schools/{schoolId}/discount-rules/*`
- All `/finance/schools/{schoolId}/credit-notes/*`
- All `/finance/schools/{schoolId}/refunds/*`

**Validation:**
- CDK synth passes
- Remaining MVP routes still present (fee-structures, invoices, payments/manual, student-accounts, dashboard, webhooks)

---

### S4-T4: End-to-end smoke test script

**Type:** Testing | **Depends on:** All previous sprints | **Points:** 4

**What:**
Smoke test validating the complete MVP workflow.

**File to create:**
- `scripts/smoke-tests/finance-mvp-e2e.ts`

**Test steps:**
1. Create 3 fee structures: Admission (one_time, autoApply, due on enrollment), Tuition (monthly, autoApply, due day 1), Transport (monthly, NOT autoApply)
2. Send enrollment webhook → verify: billing account + issued invoice with 2 line items (not Transport), correct due date, `enrollmentId` stored, `gradeLevel` stored
3. Resend same webhook → verify no duplicate (idempotent)
4. Query student ledger → verify 1 debit entry
5. Record manual cash payment (half amount) → verify `partially_paid`, ledger credit
6. Record second payment (remaining) → verify `paid`
7. Query dashboard → verify totals, `outstandingByGrade`, `agingBuckets`
8. Integrity check: billing account balance = sum(credits) - sum(debits)

**Validation:**
- Script runs to completion, all 8 assertions pass

---

## Dependency Graph

```
                    Sprint 1 — Core Flow + Security
                    ================================

S1-T1 (enrollmentId) ──────────────────────────────────┐
S1-T2 (gradeLevel) ────────────────────────────────────┤
S1-T3 (statusHistory) ─┬── S1-T4 (populate update/issue)│
                        └── S1-T5 (populate pay/reverse) │
                        └── S1-T6 (autoIssue) ──────────┤
S1-T7 (webhook schema) ─── S1-T8 (wire service) ───────┤
                                     │                   │
                            S1-T9 (params + idempotency) │
                                     │                   │
                            S1-T10 (autoIssue + fields) ─┤
                                     │                   │
                            S1-T11 (refactor controller) │
                                     │                   │
                            S1-T12 (overdue compat) ─────┘
                                     │
S1-T13 (rm test creds) ═══════════  │  (parallel, no deps)
S1-T14 (rm UI nav) ═══════════════  │  (parallel, no deps)
                                     │
                  ┌──────────────────┼──────────────────┐
                  ▼                                      ▼
            Sprint 2                               Sprint 3
   (can run in parallel)                  (can run in parallel)
   =====================                  =====================
   S2-T1 (dueDateRule)                   S3-T1 (payment hardening)
   S2-T2 (due date util)                S3-T2 (multi-invoice DTO)
   S2-T3 (wire dates)                   S3-T3 (grade breakdown)
   S2-T4 (enrollTypes)                  S3-T4 (fee-type breakdown)
   S2-T5 (filter by type)               S3-T5 (aging report)
                  │                      S3-T6 (monthly summary)
                  │                      S3-T7 (dashboard types)
                  │                               │
                  └─────────────┬─────────────────┘
                                ▼
                           Sprint 4
                    Production Hardening
                    ====================
                    S4-T1 (disable adapters)
                    S4-T2 (disable sweep)
                    S4-T3 (API Gateway routes)
                    S4-T4 (e2e smoke test)
```

---

## Ticket Summary

| Sprint | ID | Title | Type | Pts |
|--------|------|-------|------|-----|
| 1 | S1-T1 | Add `enrollmentId` to InvoiceEntity | Schema | 1 |
| 1 | S1-T2 | Add `gradeLevel` to InvoiceEntity | Schema | 1 |
| 1 | S1-T3 | Add `statusHistory` to InvoiceEntity | Schema | 1 |
| 1 | S1-T4 | Populate statusHistory in `update()` + `issue()` | Logic | 2 |
| 1 | S1-T5 | Populate statusHistory in `applyPayment()` + `reversePayment()` | Logic | 2 |
| 1 | S1-T6 | Add autoIssue to invoice generation | Logic | 3 |
| 1 | S1-T7 | Update webhook Zod schema | Schema | 1 |
| 1 | S1-T8 | Wire EnrollmentBillingService | Wiring | 1 |
| 1 | S1-T9 | Update service params + idempotency check | Logic | 2 |
| 1 | S1-T10 | Wire autoIssue + new fields into billing flow | Logic | 2 |
| 1 | S1-T11 | Refactor controller to delegate | Refactor | 2 |
| 1 | S1-T12 | Verify + fix overdue detection compat | Validation | 1 |
| 1 | S1-T13 | Remove test credentials from adapter comments | Security | 1 |
| 1 | S1-T14 | Remove Payment Gateways from UI | UI | 1 |
| 2 | S2-T1 | Add dueDateRule to FeeStructureEntity | Schema | 1 |
| 2 | S2-T2 | Due date calculation utility | Logic | 2 |
| 2 | S2-T3 | Wire due dates into enrollment billing | Logic | 2 |
| 2 | S2-T4 | Add enrollmentTypes to FeeStructureEntity | Schema | 1 |
| 2 | S2-T5 | Filter enrollment fees by type | Logic | 2 |
| 3 | S3-T1 | Harden recordManualPayment() | Bug Fix | 2 |
| 3 | S3-T2 | Multi-invoice DTO placeholder | Schema | 1 |
| 3 | S3-T3 | Grade-level dashboard breakdown | Feature | 2 |
| 3 | S3-T4 | Fee-type dashboard breakdown | Feature | 2 |
| 3 | S3-T5 | Aging report on dashboard | Feature | 2 |
| 3 | S3-T6 | Monthly collection summary | Feature | 1 |
| 3 | S3-T7 | DashboardSummary shared-types Zod schema | Schema | 3 |
| 4 | S4-T1 | Disable gateway adapters | Config | 1 |
| 4 | S4-T2 | Disable payment sweep | Config | 1 |
| 4 | S4-T3 | Remove out-of-scope API routes | Config | 2 |
| 4 | S4-T4 | End-to-end smoke test | Testing | 4 |
| **Total** | | **30 tickets** | | **51** |

---

## Review Corrections Applied

The following corrections from peer review were incorporated into this final version:

1. **S1-T4/T5 split** — Original S1-T4 was a single ticket covering all 4 methods. Split into two atomic commits: `update()`+`issue()` and `applyPayment()`+`reversePayment()`.
2. **`if_not_exists` pattern** — Added explicit requirement to use `if_not_exists(statusHistory, :emptyList)` in all statusHistory appends for backward compatibility with pre-existing invoices.
3. **S1-T6 dependency corrected** — Changed from "Depends on: S1-T4" to "Depends on: S1-T3". autoIssue only needs the statusHistory *field* to exist, not the populate-on-transition logic.
4. **S1-T7 deployment ordering** — Added deployment ordering note: `enrollmentId` made optional in Zod schema to handle finance deploying before academics.
5. **S1-T8/T9/T10 split** — Original S1-T8 was one large ticket. Split into: T9 (params + idempotency), T10 (autoIssue + field wiring).
6. **S3-T4 validation fix** — Removed misleading "partially paid → proportionally reduced" criterion. Replaced with clear per-invoice line item aggregation.
7. **S4-T1 rewritten** — Original described credentials as "hardcoded in runtime code". Corrected: credentials are in JSDoc comments only; runtime code uses `config.credentials.*`. Moved to Sprint 1 as S1-T13.
8. **S4-T4 route removed** — Removed `reconcile` route reference (does not exist in tenant-api-prod.json).
9. **S4-T5 moved to Sprint 1** — UI nav removal is quick, independent, and improves security posture early (now S1-T14).
10. **S3-T7 added** — New ticket for DashboardSummary shared-types Zod schema (frontend type safety).
11. **Sprints 2 & 3 parallel** — Added explicit note that Sprints 2 and 3 can run concurrently.
