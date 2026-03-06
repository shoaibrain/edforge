# EdForge Finance Module — Production Readiness Sprint Plan

## Context

EdForge is preparing its finance module for first production deployment with schools in Nepal. QA testing has revealed significant bugs, architectural gaps, and incomplete end-to-end flows. The finance module must enable:

- **Schools (Tenants)**: Configure fees, issue invoices, accept payments (eSewa/Khalti/manual), process refunds, view dashboards
- **Parents/Guardians**: View outstanding fees, make full/partial payments via eSewa/Khalti, view payment history and receipts

The current implementation has a solid foundation (DynamoDB single-table design, HMAC-signed eSewa integration, ledger-based accounting, idempotent operations) but has critical bugs and missing features that block production use.

### Repositories
- **Backend**: `/home/user/edforge` — branch `claude/fix-finance-bugs-JGDr6`
- **Frontend**: `/home/user/edforge-saas-frontend` — branch `claude/fix-finance-bugs-JGDr6`

---

## Identified Issues (from QA Testing)

### P0 — Critical Bugs (Block Production)

| # | Issue | Root Cause | Impact |
|---|-------|-----------|--------|
| 1 | **studentName is empty** in all invoice/account API responses | Backend `invoicesService.generate()` stores studentName from IdentityClient, but if the call fails or returns empty, it persists blank. Also, manually-created invoices may not resolve names. | Users see blank student names everywhere |
| 2 | **Parent portal first load returns empty invoices** | `useInvoices` hook fires before `activeChild` is resolved — first call has no `studentId` filter, second call with studentId works | Parents see "no invoices" on first page load |
| 3 | **dueDate uses Bikram Sambat format as ISO date** | Invoice `dueDate: "2081-05-05"` — BS year used in ISO date field. Overdue detection compares against `new Date()` (AD), so BS dates are ~57 years in the future and never trigger overdue | Overdue detection never fires; all invoices appear "on time" |
| 4 | **Payment metadata has localhost URLs** | `cancelUrl: "http://localhost:3000/parent-portal/fees"` — frontend passes `window.location.origin` which is localhost in dev, but this persists if payment was initiated in dev | Failed payments reference wrong URLs; not a prod issue per se but indicates env handling weakness |
| 5 | **Dashboard shows all zeros with draft invoices** | Dashboard only aggregates `issued/partially_paid/paid/overdue` statuses — drafts excluded | Admin sees $0 everywhere when all invoices are in draft, confusing |
| 6 | **No webhook/async verification from payment gateways** | Relies entirely on return-URL callback. If user closes browser tab after paying on eSewa, payment stays `pending` until 30-min sweep marks it `failed` — even if eSewa actually charged them | Real money charged but EdForge doesn't know; requires manual reconciliation |

### P1 — Architectural Gaps

| # | Issue | Details |
|---|-------|---------|
| 7 | Grade levels stored as bare strings | `["1", "2", "3"]` — no validation against school's actual grade configuration. No link to enrollment system grades |
| 8 | No partial payment in parent portal UI | Backend supports partial payments but parent UI only allows full invoice amount |
| 9 | No payment history for parents | Parent portal only shows payable invoices, not past payments/receipts |
| 10 | No notification system | No email/SMS for invoice issuance, payment confirmation, overdue reminders |
| 11 | No payment plans/installments | Only single invoice → single/multiple payments. No scheduled installment support |
| 12 | No late fee/penalty automation | Overdue invoices marked but no automatic penalty application |
| 13 | No reconciliation tools | No way to match gateway settlements with internal records |
| 14 | Gateway credentials stored in plain key-value | Rely on DynamoDB encryption at rest only; no application-level encryption |
| 15 | eSewa redirect opens in same tab | User fully leaves EdForge; no warning or popup alternative |
| 16 | Bulk invoice generation requires manual student ID entry | No student picker/search component |

---

## Release Strategy

| Milestone | Sprints | Gate |
|-----------|---------|------|
| **V1 Launch** | Sprints 1-3 | Core payment flow works E2E, bugs fixed, fee automation works |
| **V1.1** | Sprints 4-5 | Parent portal polished, notifications live |
| **V2** | Sprints 6-8 | Payment plans, reconciliation, multi-gateway |

**V1 Launch target**: Sprints 1-3 are the minimum viable scope for production deployment with Nepal schools. Each sprint is ~2 weeks for a 2-developer team.

---

## Sprint Plan

### Sprint 1: Critical Bug Fixes & Data Integrity _(V1 LAUNCH — REQUIRED)_
**Goal**: Fix all P0 bugs so the core payment flow works end-to-end correctly.
**Demoable outcome**: Admin creates invoice → issues it → parent sees it → parent pays via eSewa → payment verified → invoice marked paid → dashboard shows correct numbers.

#### Task 1.1: Fix empty studentName in invoices and accounts
- **Files**:
  - `server/.../invoices/invoices.service.ts` — `generate()` method
  - `server/.../common/services/identity-client.service.ts`
  - `server/.../common/mappers/invoice.mapper.ts`
- **Change**: Ensure `generate()` always resolves studentName via IdentityClient before persisting. Add fallback: if identity call fails, use `studentId` as display name and log a warning. Add a `backfillStudentNames()` method for existing records with empty names.
- **Acceptance**: All invoice and student-account API responses include non-empty `studentName`.
- **Validation**: Unit test for `generate()` with mocked IdentityClient (success + failure cases). Integration test: create invoice → GET invoice → assert studentName populated.
- **Dependencies**: None

#### Task 1.2: Fix parent portal first-load empty invoices (SECURITY + UX)
- **Files**:
  - `edforge-saas-frontend/packages/finance-services/src/hooks/usePayments.ts` (line ~90-97)
  - `edforge-saas-frontend/apps/shell/src/pages/parent-portal/FeePaymentPage.tsx`
  - `server/.../invoices/invoices.controller.ts` — backend student-scoping enforcement
- **Change**:
  1. **Frontend**: Guard the `useInvoices` hook with `enabled: !!schoolId && !!filters?.studentId` when called from parent context, so it doesn't fire until activeChild is resolved.
  2. **Backend**: Enforce server-side student scoping — when the requesting user has role `Parent`, the invoice list endpoint MUST require and filter by `studentId` (derived from the parent's linked children). A parent should never receive invoices for students they aren't linked to. Return 403 if no studentId provided for parent role.
- **Acceptance**: Parent portal loads invoices correctly on first visit. Backend rejects unscoped invoice queries from parent users.
- **Validation**: Unit test: parent role request without studentId → 403. Parent role with correct studentId → returns only that student's invoices. Frontend: login as parent → /parent-portal/fees → invoices appear immediately with single API call.
- **Dependencies**: None

#### Task 1.3a: Backend — Enforce AD date format for dueDate
- **Files**:
  - `server/.../invoices/invoices.service.ts` — `generate()` and `update()`
  - `server/.../common/entities/invoice.entity.ts` — add date validation
- **Change**: Add Zod validation in the invoice DTO to reject dates with year > 2100 (clearly BS dates). Return 400 with clear error message: "dueDate must be in AD (Gregorian) format, not Bikram Sambat". Add `isValidADDate()` utility.
- **Acceptance**: Backend rejects BS-format dates. Only ISO 8601 AD dates accepted.
- **Validation**: Unit test: `generate()` with dueDate "2081-05-05" → 400 error. With "2026-05-05" → success.
- **Dependencies**: None

#### Task 1.3b: Frontend — Convert BS date picker to AD before API call
- **Files**:
  - `edforge-saas-frontend/apps/finance/src/routes/billing/invoices/` — invoice creation form
  - `edforge-saas-frontend/packages/date-utils/` — BS↔AD conversion utilities
- **Change**: If the invoice form date picker returns BS dates, apply `bsToAd()` conversion before sending to API. Display dates in BS for Nepali locale but transmit in AD. Ensure `packages/date-utils` has reliable BS↔AD conversion.
- **Acceptance**: Admin sees BS dates in UI but API always receives AD dates.
- **Validation**: Manual test: pick date in BS calendar → inspect API request → dueDate is AD format.
- **Dependencies**: Task 1.3a

#### Task 1.3c: One-time data migration for existing BS dueDates
- **Files**:
  - `server/.../common/scripts/migrate-bs-dates.ts` (new one-time script)
- **Change**: Scan all existing invoices. Convert any dueDate with year > 2050 from BS to AD. Log all changes. Idempotent (safe to run multiple times).
- **Acceptance**: All existing invoices have AD-format dueDates after migration.
- **Validation**: Run script → query invoices → assert no dueDate with year > 2050. Run again → assert no changes (idempotent).
- **Dependencies**: Task 1.3a

#### Task 1.4: Add draft invoice totals to dashboard
- **Files**:
  - `server/.../dashboard/dashboard.service.ts`
- **Change**: Add `totalDraft` field to DashboardSummary showing sum of grandTotal for draft invoices. Keep existing totals as-is (only counting issued+). Add `draftCount` to invoicesByStatus (already counted, just make it visible in summary).
- **Acceptance**: Dashboard shows draft invoice totals separately so admin knows pending value.
- **Validation**: Unit test: mock invoices with mixed statuses → assert totalDraft computed correctly.
- **Dependencies**: None

#### Task 1.5: Add proactive payment verification (server-initiated)
- **Files**:
  - `server/.../common/services/payment-sweep.service.ts`
  - `server/.../payments/payments.service.ts`
  - `server/.../payment-gateways/adapters/esewa.adapter.ts`
  - `server/.../payment-gateways/adapters/khalti.adapter.ts`
- **Change**: Before marking a pending payment as `failed` in the sweep job, first call the gateway's `verifyPayment()` to check actual status. If gateway says COMPLETE, call `completePayment()` instead of `failPayment()`. **Key design issue**: The sweep uses `getSystemClient()` (no tenant context), but gateway config lookup requires `RequestContext` with `tenantId`/`jwtToken`. Solution: store `tenantId` on the payment entity (already exists), and create a `getSystemContextForTenant(tenantId)` helper that uses a service account token for gateway verification calls.
- **Acceptance**: Payments that succeed on gateway side but whose callback was missed are still completed within 30 minutes.
- **Validation**: Integration test: create pending payment → mock gateway verify returning COMPLETE → run sweep → assert payment status = completed and invoice updated.
- **Dependencies**: None

#### Task 1.6: Idempotent payment completion (prevent double ledger entries)
- **Files**:
  - `server/.../payments/payments.service.ts` — `completePayment()` and `verifyPayment()`
- **Change**: Harden `completePayment()` to gracefully handle `ConditionalCheckFailedException` from DynamoDB optimistic locking. If the payment is already completed (race between callback + sweep), return the existing completed payment instead of throwing. This is critical for real money — concurrent verification paths (callback URL, sweep job, future webhook) must not double-debit the invoice or create duplicate ledger entries.
- **Acceptance**: Concurrent completePayment calls for same payment result in exactly one ledger entry and one invoice update.
- **Validation**: Integration test: simulate two concurrent completePayment calls → assert only one ledger entry, payment status = completed.
- **Dependencies**: None

#### Task 1.7: Migrate existing broken data (BS dates + localhost URLs)
- **Files**:
  - `server/.../common/scripts/migrate-bs-dates.ts` (covered in Task 1.3c)
  - `server/.../common/scripts/cleanup-localhost-payments.ts` (new)
- **Change**: One-time script to update metadata.cancelUrl and metadata.returnUrl on failed/pending payments that contain "localhost". Mark these clearly in metadata as "migrated". This is cleanup only — doesn't affect active payments.
- **Acceptance**: No payment records reference localhost URLs after migration.
- **Validation**: Run script → query payments → assert no localhost in metadata URLs.
- **Dependencies**: None

#### Task 1.8: Fix payment return/cancel URL environment handling
- **Files**:
  - `edforge-saas-frontend/apps/shell/src/hooks/usePaymentFlow.ts`
  - `edforge-saas-frontend/packages/config/` — environment config
- **Change**: Use a centralized config value for `APP_URL` (from env var or config) instead of `window.location.origin`. Ensure it resolves to the production URL in production builds.
- **Acceptance**: Payment metadata always contains correct production URLs in production.
- **Validation**: Manual test: verify initiatePayment request body has correct returnUrl/cancelUrl. Check env config resolution.
- **Dependencies**: None

---

### Sprint 2: Payment Flow Hardening & Security _(V1 LAUNCH — REQUIRED)_
**Goal**: Make the payment flow resilient and secure for real money transactions.
**Demoable outcome**: Payment succeeds even if browser is closed after eSewa payment. Credentials are encrypted. Payment receipt displays correctly.

#### Task 2.1: Implement gateway-initiated webhook endpoint
- **Files**:
  - `server/.../payments/payments.controller.ts` — new `POST /payments/webhook/:gateway` endpoint
  - `server/.../payments/payments.service.ts` — new `handleWebhook()` method
  - `server/.../payment-gateways/adapters/gateway-adapter.interface.ts` — add `parseWebhook()` to interface
  - `server/.../payment-gateways/adapters/esewa.adapter.ts` — implement webhook parsing
- **Change**: Add a public webhook endpoint that eSewa/Khalti can call with payment status updates. Validate HMAC signature. Idempotent: if payment already completed, return 200 OK. Parse gateway-specific webhook format and delegate to `verifyPayment()` + `completePayment()`.
- **Acceptance**: eSewa IPN/webhook correctly updates payment status even without user return.
- **Validation**: Integration test: POST webhook with valid HMAC → assert payment completed. POST with invalid HMAC → 401. POST for already-completed payment → 200 (idempotent).
- **Dependencies**: Task 1.5

#### Task 2.2: Application-level credential encryption (KMS envelope)
- **Files**:
  - `server/.../common/services/credential-encryption.service.ts` (new)
  - `server/.../payment-gateways/payment-gateways.service.ts`
  - `server/.../common/entities/gateway-config.entity.ts`
- **Change**: Encrypt gateway credentials before storing in DynamoDB using AWS KMS envelope encryption. Decrypt on read when needed for payment processing. Store encrypted blob + encrypted data key.
- **Acceptance**: Gateway credentials stored as encrypted ciphertext in DynamoDB. Decrypted only in-memory when processing payments.
- **Validation**: Unit test: encrypt → decrypt roundtrip. Integration test: save gateway config → read raw DynamoDB → assert credentials are not plaintext.
- **Dependencies**: None

#### Task 2.3: Printable payment receipt page
- **Files**:
  - `server/.../payments/payments.service.ts` — `getReceipt()` method (already exists, returns structured data)
  - `edforge-saas-frontend/apps/shell/src/pages/payments/receipt.tsx`
- **Change**: Build a clean, print-optimized HTML receipt page using the existing `getReceipt()` API data. Include: school name/logo, student name, invoice number, line items, payment amount, gateway, receipt number, date. Add `@media print` CSS for clean printing. Add browser Print button. No server-side PDF generation needed for V1 — `window.print()` is sufficient.
- **Acceptance**: After successful payment, receipt page shows formatted receipt. Browser print produces clean output.
- **Validation**: Manual test: complete payment → receipt page → verify all fields → Ctrl+P → clean print preview.
- **Dependencies**: None

#### Task 2.4: eSewa redirect UX improvement
- **Files**:
  - `edforge-saas-frontend/apps/shell/src/hooks/usePaymentFlow.ts`
  - `edforge-saas-frontend/apps/shell/src/components/payments/PaymentForm.tsx`
- **Change**: Before redirecting to eSewa, show a modal warning: "You will be redirected to eSewa to complete payment. Do not close this window until you are redirected back." Add a "Return to EdForge" fallback link visible after redirect (via localStorage flag checked on page load).
- **Acceptance**: User is warned before redirect. If they manually navigate back, they see payment status (pending/completed).
- **Validation**: Manual test: initiate payment → see warning → redirect → close tab → reopen EdForge → see pending payment status.
- **Dependencies**: None

#### Task 2.5: Payment amount validation against gateway minimums
- **Files**:
  - `server/.../payments/payments.service.ts` — `initiatePayment()`
  - `server/.../payment-gateways/adapters/esewa.adapter.ts`
  - `server/.../payment-gateways/adapters/khalti.adapter.ts`
- **Change**: Validate payment amount against gateway-specific minimums before initiating. eSewa minimum: NPR 10. Khalti minimum: NPR 10 (1000 paisa). Return clear error if amount too low.
- **Acceptance**: Payment initiation with amount below gateway minimum returns 400 with descriptive error.
- **Validation**: Unit test: initiate NPR 5 payment via eSewa → assert 400 error.
- **Dependencies**: None

#### Task 2.6: Admin audit logging for financial operations
- **Files**:
  - `server/.../common/services/audit-log.service.ts` (new)
  - `server/.../common/entities/audit-log.entity.ts` (new)
  - `server/.../invoices/invoices.service.ts` — add audit calls
  - `server/.../payments/payments.service.ts` — add audit calls
- **Change**: Log all admin financial actions: invoice create/issue/cancel, payment void/refund, fee structure changes, gateway config changes. Store: who, what, when, from-state, to-state. Use a new AUDIT_LOG entity type in DynamoDB. Fire-and-forget (don't block operations).
- **Acceptance**: All financial admin actions logged with actor, timestamp, and change details.
- **Validation**: Integration test: issue invoice → query audit log → assert entry with correct actor and state change.
- **Dependencies**: None

---

### Sprint 3: Fee Structure Automation & Enrollment Pipeline _(V1 LAUNCH — REQUIRED)_
**Goal**: Schools can configure fees that auto-apply when students enroll.
**Demoable outcome**: Admin configures fee structure with auto-apply → enrolls student → invoice auto-generated → parent sees it.

#### Task 3.1: Validate grade levels against school configuration
- **Files**:
  - `server/.../fee-structures/fee-structures.service.ts`
  - `server/.../common/services/identity-client.service.ts` — add `getSchoolGrades()`
  - `edforge-saas-frontend/apps/finance/src/components/configuration/FeeStructureForm.tsx`
- **Change**: Backend: validate gradeLevels against school's actual grade configuration (fetched from identity/academics service). Frontend: replace free-text grade input with a multi-select populated from school's grades API.
- **Acceptance**: Can only select valid grades for the school. Invalid grades rejected by backend.
- **Validation**: Unit test: create fee structure with invalid grade → assert 400. Frontend test: grade dropdown shows school's actual grades.
- **Dependencies**: None

#### Task 3.2: Enable and test autoApplyOnEnrollment flow
- **Files**:
  - `server/.../webhooks/enrollment-webhook.controller.ts`
  - `server/.../fee-structures/fee-structures.service.ts` — `getEnrollmentFees()`
  - `edforge-saas-frontend/apps/finance/src/components/configuration/FeeStructureForm.tsx` — toggle UI
- **Change**: Ensure `autoApplyOnEnrollment` toggle works in UI and is respected by enrollment webhook. Fix `getEnrollmentFees()` to query active fee structures where `autoApplyOnEnrollment=true` AND (gradeLevels empty OR gradeLevels contains student's grade). Add integration test for the full flow.
- **Acceptance**: When student enrolls and fee structures have autoApply=true for their grade, draft invoice is auto-created.
- **Validation**: Integration test: create fee structure (autoApply=true, grade="5") → POST enrollment webhook (grade="5") → assert invoice created with correct line items.
- **Dependencies**: Task 3.1

#### Task 3.3: Student picker for invoice generation
- **Files**:
  - `edforge-saas-frontend/apps/finance/src/routes/billing/invoices/index.tsx` — invoice creation modal
  - `edforge-saas-frontend/packages/finance-services/` — add student search hook
- **Change**: Replace manual studentId text input with a searchable student picker component. Fetch students from identity/academics API with debounced search. Show student name, grade, and ID.
- **Acceptance**: Admin can search and select students when creating invoices instead of typing UUIDs.
- **Validation**: Manual test: open create invoice dialog → type student name → see autocomplete → select → invoice created with correct studentId.
- **Dependencies**: None

#### Task 3.4: Bulk invoice generation with student picker
- **Files**:
  - `edforge-saas-frontend/apps/finance/src/routes/billing/invoices/bulk-generate.tsx`
- **Change**: Add multi-select student picker (search + select multiple). Add grade-level filter (select grade → show all students in that grade). Preview total before generating.
- **Acceptance**: Admin can bulk-generate invoices by selecting students from a list, not typing IDs.
- **Validation**: Manual test: select 5 students → select fee structures → generate → all 5 invoices created.
- **Dependencies**: Task 3.3

---

### Sprint 4: Parent Portal Enhancements _(V1.1)_
**Goal**: Complete parent payment experience with partial payments, history, and receipts.
**Demoable outcome**: Parent can make partial payment, view all past payments, download receipts.

#### Task 4.1: Partial payment support in parent portal
- **Files**:
  - `edforge-saas-frontend/apps/shell/src/components/payments/PaymentForm.tsx`
  - `edforge-saas-frontend/apps/shell/src/hooks/usePaymentFlow.ts`
- **Change**: Add amount input field to payment form (pre-filled with amountDue, editable). Validate: amount > 0 AND amount <= amountDue. Pass custom amount to `initiatePayment()`.
- **Acceptance**: Parent can enter a partial amount and pay less than full invoice amount.
- **Validation**: Manual test: invoice for NPR 35,000 → enter NPR 10,000 → pay → invoice status = partially_paid, amountDue = 25,000.
- **Dependencies**: None (backend already supports)

#### Task 4.2: Payment history page for parents
- **Files**:
  - `edforge-saas-frontend/apps/shell/src/pages/parent-portal/PaymentHistoryPage.tsx` (new)
  - `edforge-saas-frontend/apps/shell/src/router.tsx` — add route
  - `edforge-saas-frontend/packages/finance-services/` — add `useStudentPayments` hook
- **Change**: New page at `/parent-portal/payment-history` showing all payments for the active child. Columns: date, invoice #, amount, gateway, status, receipt link. Filter by status. Sort by date.
- **Acceptance**: Parent can see complete payment history with receipt links.
- **Validation**: Manual test: parent with 3 payments → history shows all 3 with correct details → receipt link works.
- **Dependencies**: None

#### Task 4.3: Parent invoice detail with payment breakdown
- **Files**:
  - `edforge-saas-frontend/apps/shell/src/components/payments/InvoiceDetail.tsx`
- **Change**: Show payment history for each invoice (list of payments with amounts, dates, gateways). Show remaining balance prominently. If partially paid, show "Pay Remaining" button.
- **Acceptance**: Parent can see which payments have been made against an invoice and how much remains.
- **Validation**: Manual test: partially paid invoice → detail shows payment list + remaining amount.
- **Dependencies**: Task 4.1

#### Task 4.4: Paid/completed invoices view for parents
- **Files**:
  - `edforge-saas-frontend/apps/shell/src/pages/parent-portal/FeePaymentPage.tsx`
- **Change**: Add tab/toggle: "Outstanding" (issued/partially_paid) and "Completed" (paid). Show paid invoices with payment date and receipt link.
- **Acceptance**: Parent can view both outstanding and completed invoices.
- **Validation**: Manual test: parent with mix of paid/unpaid invoices → both tabs show correct invoices.
- **Dependencies**: None

---

### Sprint 5: Notifications & Communication _(V1.1)_
**Goal**: Automated notifications for key financial events.
**Demoable outcome**: Parent receives email when invoice is issued. Parent receives email when payment succeeds. Admin gets overdue summary.

#### Task 5.1: Notification service foundation
- **Files**:
  - `server/.../common/services/notification.service.ts` (new)
  - `server/.../common/services/email-template.service.ts` (new)
- **Change**: Create a notification service that listens to finance domain events (InvoiceIssued, PaymentCompleted, InvoiceOverdue) and sends email notifications. Use AWS SES or a configured SMTP provider. Template-based emails with school branding.
- **Acceptance**: Notification service can send templated emails for finance events.
- **Validation**: Unit test: trigger InvoiceIssued event → assert email sent with correct template and recipient.
- **Dependencies**: None

#### Task 5.2: Invoice issuance notification to parent
- **Files**:
  - `server/.../invoices/invoices.service.ts` — after `issue()`
  - `server/.../common/services/notification.service.ts`
- **Change**: When invoice is issued, send email to parent/guardian with: school name, student name, invoice amount, due date, and "Pay Now" link to parent portal.
- **Acceptance**: Parent receives email when admin issues an invoice.
- **Validation**: Integration test: issue invoice → assert email queued with correct content.
- **Dependencies**: Task 5.1

#### Task 5.3: Payment confirmation notification
- **Files**:
  - `server/.../payments/payments.service.ts` — after `completePayment()`
  - `server/.../common/services/notification.service.ts`
- **Change**: When payment completes (manual or gateway), send receipt email to parent/guardian and confirmation to school admin.
- **Acceptance**: Both parent and school receive confirmation emails on successful payment.
- **Validation**: Integration test: complete payment → assert two emails sent (parent + admin).
- **Dependencies**: Task 5.1

#### Task 5.4: Overdue reminder notifications
- **Files**:
  - `server/.../common/services/overdue-detection.service.ts`
  - `server/.../common/services/notification.service.ts`
- **Change**: When overdue detection marks an invoice as overdue, send reminder email to parent with outstanding amount and new urgency. Also send daily digest to admin with all overdue invoices.
- **Acceptance**: Parents get overdue reminders. Admin gets daily overdue summary.
- **Validation**: Integration test: mark invoice overdue → assert reminder email sent.
- **Dependencies**: Task 5.1, Task 1.3 (correct dueDate)

---

### Sprint 6: Payment Plans & Installments _(V2 — Post-Launch)_
**Goal**: Schools can create structured payment plans for large fees.
**Demoable outcome**: Admin creates payment plan (3 monthly installments for NPR 150,000) → parent sees installment schedule → pays first installment.

#### Task 6.1: Payment plan data model
- **Files**:
  - `server/.../common/entities/payment-plan.entity.ts` (new)
  - `server/.../common/entities/base.entity.ts` — add PAYMENT_PLAN entity type
  - `packages/shared-types/src/schemas/finance/payment-plan.schema.ts` (new)
- **Change**: New entity with: id, invoiceId, studentAccountId, totalAmount, installments (array of {amount, dueDate, status, invoiceId}), frequency, status (active/completed/cancelled). Each installment generates a child invoice.
- **Acceptance**: Payment plan entity can be created and stored in DynamoDB.
- **Validation**: Unit test: create payment plan → assert entity stored with correct keys and installments.
- **Dependencies**: None

#### Task 6.2: Payment plan service (CRUD + installment generation)
- **Files**:
  - `server/.../payment-plans/payment-plans.service.ts` (new)
  - `server/.../payment-plans/payment-plans.controller.ts` (new)
  - `server/.../payment-plans/payment-plans.module.ts` (new)
- **Change**: Service to create payment plan from an invoice: splits grandTotal into N installments with configurable frequency (monthly/quarterly/custom). Each installment creates a child invoice linked to the plan. Installment invoices are auto-issued on their start date.
- **Acceptance**: Admin can create payment plan → child invoices generated with staggered due dates.
- **Validation**: Integration test: create plan with 3 monthly installments for NPR 150,000 → assert 3 invoices created (50,000 each) with correct due dates.
- **Dependencies**: Task 6.1

#### Task 6.3: Payment plan admin UI
- **Files**:
  - `edforge-saas-frontend/apps/finance/src/routes/billing/payment-plans/` (new)
  - `edforge-saas-frontend/apps/finance/src/router.tsx`
- **Change**: Admin page to create/view/manage payment plans. Create form: select invoice → choose # installments + frequency → preview schedule → create. List view: show all plans with status, progress bar (X of Y paid).
- **Acceptance**: Admin can create and monitor payment plans from the UI.
- **Validation**: Manual test: create plan → see installment schedule → verify child invoices in invoice list.
- **Dependencies**: Task 6.2

#### Task 6.4: Payment plan view for parents
- **Files**:
  - `edforge-saas-frontend/apps/shell/src/pages/parent-portal/FeePaymentPage.tsx`
  - `edforge-saas-frontend/apps/shell/src/components/payments/PaymentPlanView.tsx` (new)
- **Change**: If an invoice has a payment plan, show the installment schedule to parents. Highlight current/next installment due. Allow paying individual installments.
- **Acceptance**: Parent sees installment schedule and can pay individual installments.
- **Validation**: Manual test: parent views invoice with plan → sees schedule → pays first installment → schedule updates.
- **Dependencies**: Task 6.2, Task 6.3

---

### Sprint 7: Reconciliation, Reporting & Late Fees _(V2 — Post-Launch)_
**Goal**: Financial reporting, reconciliation tools, and automated late fee enforcement.
**Demoable outcome**: Admin can export collection report, view gateway reconciliation, and late fees auto-apply.

#### Task 7.1: Late fee configuration (admin-applied, not auto)
- **Files**:
  - `server/.../invoices/invoices.service.ts` — add `addLateFee()` method
  - `server/.../invoices/invoices.controller.ts` — add endpoint
  - `edforge-saas-frontend/apps/finance/src/routes/billing/invoices/` — add "Apply Late Fee" action
- **Change**: Admin can manually apply a late fee to an overdue invoice. Configure late fee as flat amount or percentage of outstanding balance. This adds a line item to the invoice and updates grandTotal/amountDue. **Intentionally manual for V1** — automatic late fee application is legally sensitive in Nepal and requires school-by-school policy configuration.
- **Acceptance**: Admin can apply late fee to overdue invoice. Invoice totals updated correctly.
- **Validation**: Integration test: apply NPR 500 late fee to overdue invoice → assert line item added, grandTotal increased by 500.
- **Dependencies**: Task 1.3a

#### Task 7.2: Financial collection report
- **Files**:
  - `server/.../dashboard/dashboard.service.ts` — add `getCollectionReport()`
  - `server/.../dashboard/dashboard.controller.ts` — add endpoint
  - `edforge-saas-frontend/apps/finance/src/routes/dashboard/index.tsx`
- **Change**: Report showing: total billed vs collected by period (month/quarter), collection rate trend, outstanding by grade level, top overdue accounts. Exportable as CSV.
- **Acceptance**: Admin can view and export collection report with period filtering.
- **Validation**: Manual test: dashboard shows collection trends → export CSV → verify data matches.
- **Dependencies**: None

#### Task 7.3: Gateway reconciliation view
- **Files**:
  - `server/.../payments/payments.service.ts` — add `getReconciliationReport()`
  - `server/.../payments/payments.controller.ts` — add endpoint
  - `edforge-saas-frontend/apps/finance/src/routes/billing/payments/` — add reconciliation tab
- **Change**: Show payments grouped by gateway with: total collected, # transactions, failed transactions, pending transactions. Allow admin to manually verify/reconcile pending payments against gateway.
- **Acceptance**: Admin can see payment gateway summary and manually reconcile discrepancies.
- **Validation**: Manual test: payments from multiple gateways → reconciliation view shows correct totals.
- **Dependencies**: None

#### Task 7.4: Credit notes / adjustments admin UI
- **Files**:
  - `edforge-saas-frontend/apps/finance/src/routes/billing/accounts/` — add adjustment action
  - `server/.../student-accounts/student-accounts.service.ts` — expose adjustment creation
  - `server/.../student-accounts/student-accounts.controller.ts` — add endpoint
- **Change**: Admin can create a credit/debit adjustment on a student account with reason. This creates a ledger entry and updates the account balance. Used for scholarships, fee waivers, corrections.
- **Acceptance**: Admin can issue credit to a student account; balance and ledger updated correctly.
- **Validation**: Integration test: create credit adjustment → assert ledger entry + balance decreased.
- **Dependencies**: None

---

### Sprint 8: Multi-Gateway & Production Hardening _(V2 — Post-Launch)_
**Goal**: ConnectIPS integration, audit logging, and production hardening.
**Demoable outcome**: Parents can pay via ConnectIPS. All admin actions logged. System handles edge cases gracefully.

#### Task 8.1: ConnectIPS gateway adapter
- **Files**:
  - `server/.../payment-gateways/adapters/connectips.adapter.ts` (new)
  - `server/.../payment-gateways/adapters/gateway-adapter-registry.service.ts`
- **Change**: Implement ConnectIPS adapter following same pattern as eSewa/Khalti. ConnectIPS uses REST API + HMAC signing. Add test mode support.
- **Acceptance**: Parents can initiate and complete payments via ConnectIPS.
- **Validation**: Integration test with ConnectIPS sandbox credentials.
- **Dependencies**: None

#### Task 8.2: Admin audit log UI (view audit trail)
- **Files**:
  - `edforge-saas-frontend/apps/finance/src/routes/billing/` — add audit log viewer
  - `server/.../common/services/audit-log.service.ts` — add query endpoint
- **Change**: Admin UI to view audit trail per entity (invoice, payment, student account). Shows: who did what, when, state changes. Filterable by entity type, actor, date range. Builds on the audit logging foundation from Task 2.6.
- **Acceptance**: Admin can view complete audit history for any financial entity.
- **Validation**: Manual test: perform several admin actions → view audit log → verify all actions recorded.
- **Dependencies**: Task 2.6

#### Task 8.3: Rate limiting and abuse prevention
- **Files**:
  - `server/.../payments/payments.controller.ts` — add rate limiting
  - `server/.../common/guards/rate-limit.guard.ts` (new)
- **Change**: Rate limit payment initiation: max 5 per minute per user per invoice. Rate limit webhook endpoints: max 100 per minute per IP. Prevent payment spam and potential DDoS on gateway integration.
- **Acceptance**: Excessive payment initiation attempts are rejected with 429.
- **Validation**: Unit test: 6 rapid payment initiations → assert 6th rejected.
- **Dependencies**: None

#### Task 8.4: Production environment checklist & hardening
- **Files**: Various configuration and deployment files
- **Change**:
  - Verify all env vars configured for production (KMS key, SES, gateway prod credentials)
  - Add health check endpoint for finance service
  - Add CloudWatch alarms for: payment failures > threshold, sweep job not running, high error rate
  - Add DynamoDB backup/PITR configuration for finance table
  - Review and update CORS, CSP headers
- **Acceptance**: All production checklist items verified and deployed.
- **Validation**: Deploy to staging → run full payment flow → verify monitoring alerts fire correctly.
- **Dependencies**: All previous sprints

---

## Key Files Reference

### Backend (`/home/user/edforge/server/application/microservices/finance/src/`)
| File | Purpose |
|------|---------|
| `invoices/invoices.service.ts` | Invoice generation, status management |
| `payments/payments.service.ts` | Payment processing, verification, refunds |
| `student-accounts/student-accounts.service.ts` | Account CRUD, ledger recording |
| `fee-structures/fee-structures.service.ts` | Fee structure CRUD |
| `payment-gateways/adapters/esewa.adapter.ts` | eSewa HMAC + form POST |
| `payment-gateways/adapters/khalti.adapter.ts` | Khalti REST API |
| `payment-gateways/payment-gateways.service.ts` | Gateway config CRUD |
| `dashboard/dashboard.service.ts` | Financial metrics aggregation |
| `common/services/overdue-detection.service.ts` | Cron: mark overdue invoices |
| `common/services/payment-sweep.service.ts` | Cron: expire stale payments |
| `webhooks/enrollment-webhook.controller.ts` | Enrollment → billing account + invoice |
| `common/entities/base.entity.ts` | DynamoDB key builders |
| `common/services/identity-client.service.ts` | Student/school info lookup |

### Frontend (`/home/user/edforge-saas-frontend/`)
| File | Purpose |
|------|---------|
| `apps/shell/src/pages/parent-portal/FeePaymentPage.tsx` | Parent fee viewing + payment |
| `apps/shell/src/pages/payments/callback.tsx` | Payment callback handler |
| `apps/shell/src/hooks/usePaymentFlow.ts` | Payment flow state machine |
| `apps/finance/src/routes/billing/invoices/index.tsx` | Admin invoice management |
| `apps/finance/src/routes/billing/payments/index.tsx` | Admin payment management |
| `apps/finance/src/routes/configuration/fee-structures.tsx` | Fee structure config |
| `apps/finance/src/routes/configuration/payment-gateways.tsx` | Gateway config |
| `packages/finance-services/src/` | API client + React Query hooks |

---

## Verification Plan

### End-to-End Test Flow (after each sprint)
1. **Admin flow**: Login as TenantAdmin → configure fee structure → configure eSewa gateway → create invoice → issue invoice → verify dashboard
2. **Parent flow**: Login as Parent → view fees → select invoice → pay via eSewa (test mode) → complete payment on eSewa → return to callback → see receipt
3. **Verification**: Invoice status = paid, student account balance = 0, ledger has debit + credit entries, dashboard shows correct totals
4. **Edge cases**: Close browser during eSewa payment → verify sweep/webhook catches it. Partial payment → verify partially_paid status. Refund → verify balance reversal.

### Test Commands
```bash
# Backend unit tests
cd /home/user/edforge && pnpm test --filter=finance

# Frontend tests
cd /home/user/edforge-saas-frontend && pnpm test

# Full build verification
cd /home/user/edforge-saas-frontend && pnpm build
```

---

## Appendix: Review Feedback (Incorporated)

The following improvements were suggested by a Staff Engineer review and have been incorporated into the plan above:

1. **Task 1.2 reclassified as SECURITY bug** — Parent portal first-load isn't just UX; without studentId filter, the initial API call could leak all school invoices to a parent. Added backend enforcement of student-scoped queries for parent role.

2. **Idempotent payment completion (Task 2.5) moved to Sprint 1 (now Task 1.6)** — The `ConditionalCheckFailedException` race condition between sweep and callback is a data integrity risk for real money. Must be fixed before any real payments flow.

3. **Task 1.3 split into 3 sub-tasks (1.3a/1.3b/1.3c)** — Original task spanned backend validation, frontend conversion, and data migration across two repos. Split for atomicity. Removed "handle both formats during migration" (adds permanent complexity) in favor of one-time data migration.

4. **Task 1.5 design gap addressed** — Payment sweep uses `getSystemClient()` but gateway verification needs tenant-scoped credentials. Plan now specifies creating a `getSystemContextForTenant()` helper.

5. **Receipt generation simplified** — PDF generation via Puppeteer is infrastructure-heavy for V1. Changed to print-optimized HTML page with `@media print` CSS and `window.print()`.

6. **Audit logging moved from Sprint 8 to Sprint 2** — Financial compliance requires audit trails early, not as an afterthought.

7. **Late fees changed from auto to manual** — Auto-modifying invoice amounts is legally sensitive in Nepal. V1 provides admin-initiated late fees only.

8. **Added missing tasks**: Gateway minimum payment validation (Task 2.5), data migration for localhost URLs (Task 1.7).

9. **Release strategy added** — Clear V1/V1.1/V2 gates. Sprints 1-3 = V1 launch minimum. Sprints 4-5 = V1.1 polish. Sprints 6-8 = V2 post-launch.

### Open Questions for Team
- Does the identity service have an API to fetch school grade levels? (Needed for Task 3.1)
- Is eSewa IPN/webhook documented? The ePay v2 API may not support server-initiated webhooks — verify with eSewa before Sprint 2. Proactive verification in sweep (Task 1.5) may be the only reliable fallback.
- What is the Nepali academic year start? If Baishakh (mid-April), V1 launch deadline is Sprint 3 completion by early April.
- ConnectIPS merchant registration requirements — defer research until Sprint 8 scope.
- Should overdue detection and payment sweep cron jobs use per-tenant partitioning instead of full table scans? This is a scalability concern for 100+ tenants.
