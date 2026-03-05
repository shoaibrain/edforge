# Finance Module Hardening — Sprint Plan

> **Context:** UAT testing of the Nepal-launch Finance Module revealed a critical frontend crash (`feeStructures.map is not a function`), and a thorough code audit uncovered security gaps, data-integrity bugs, and missing edge-case handling across the full stack (shared-types, backend microservice, frontend). This plan remediates every finding as atomic, testable tickets organized into demoable sprints.
>
> **Branch:** `payments`
> **Reviewed by:** Subagent architect review incorporated (see revision notes at bottom).

---

## Sprint 1 — Critical Crash Fixes & Frontend Resilience

**Goal:** Eliminate all app-crashing bugs. Every settings/finance page loads without error on empty data, malformed API responses, and normal data. The frontend never crashes from a data-shape mismatch.

**Cross-sprint dependency note:** Sprint 1 is frontend-only. Sprint 2 is backend-only. They can be developed in parallel by different engineers. Exception: Ticket 2.6 (receipt schema) will require a shared-types bump that frontend must pick up.

---

### Ticket 1.1 — Fix fee-structures service pagination unwrap

**File:** `edforge-saas-frontend/apps/shell/src/services/fee-structures.service.ts`

**Problem:** `getFeeStructures()` declares return type `Promise<FeeStructure[]>` but backend returns `{ items: FeeStructure[], hasMore: boolean }`. The `unwrapResponse()` helper in `api.ts` looks for a `data` key (not `items`), so the raw object passes through. `FeeStructureList` calls `.map()` on the object and crashes.

**Changes:**
1. Update `getFeeStructures()` to expect the paginated shape and extract `items`:
   ```typescript
   export async function getFeeStructures(schoolId: string): Promise<FeeStructure[]> {
     const response = await apiGet<{ items: FeeStructure[]; hasMore: boolean }>(
       `/finance/schools/${schoolId}/fee-structures`
     )
     return Array.isArray(response) ? response : (response.items ?? [])
   }
   ```
2. Add a defensive `Array.isArray` guard so both old and new response shapes work.

**Validation:**
- Unit test: mock API returning `{ items: [...], hasMore: false }` → service returns `FeeStructure[]`.
- Unit test: mock API returning `[]` directly → service returns `[]`.
- Manual: navigate to `/settings/fee-structures` with zero fee structures → page renders empty state, no crash.

---

### Ticket 1.2a — Add defensive array guard in FeeStructureList

**File:** `edforge-saas-frontend/apps/shell/src/components/payments/FeeStructureList.tsx`

**Changes:** Add a guard at the top of the component:
```typescript
if (!Array.isArray(feeStructures)) return null
```

**Validation:**
- Unit test: pass `undefined`, `null`, `{}`, and valid array as `feeStructures` prop → no crash.

---

### Ticket 1.2b — Add defensive array guard in fee-structures page

**File:** `edforge-saas-frontend/apps/shell/src/pages/settings/fee-structures.tsx`

**Changes:** Line 134, ensure the fallback produces an array:
```typescript
const safeFeeStructures = Array.isArray(feeStructures) ? feeStructures : []
```
Pass `safeFeeStructures` to `<FeeStructureList>`.

**Validation:**
- Unit test: render page with `useFeeStructures` returning `{ data: { items: [], hasMore: false } }` → no crash.

---

### Ticket 1.2c — Add defensive array guard in FeePaymentPage

**File:** `edforge-saas-frontend/apps/shell/src/pages/parent-portal/FeePaymentPage.tsx`

**Changes:** Line 42, handle both paginated and array response shapes:
```typescript
const invoices = Array.isArray(invoiceData?.data)
  ? invoiceData.data
  : Array.isArray(invoiceData?.items)
    ? invoiceData.items
    : []
```

**Validation:**
- Unit test: render with `invoiceData = { items: [], hasMore: false }` → no crash.
- Unit test: render with `invoiceData = { data: [] }` → no crash.

---

### Ticket 1.2d — Add defensive array guard in InvoiceList

**File:** `edforge-saas-frontend/apps/shell/src/components/payments/InvoiceList.tsx`

**Changes:** Add `Array.isArray` guard before `.filter()` calls on the invoices prop.

**Validation:**
- Unit test: pass `undefined` as invoices → renders empty state, no crash.

---

### Ticket 1.3 — Add React error boundaries around finance routes

**Files:**
- Create `edforge-saas-frontend/apps/shell/src/components/payments/FinanceErrorBoundary.tsx`
- Wrap in `fee-structures.tsx`, `payment-gateways.tsx`, `FeePaymentPage.tsx`, `callback.tsx`

**Changes:**
1. Create a reusable `FinanceErrorBoundary` component that catches render errors, logs them, and shows a "Something went wrong — try refreshing" UI with a retry button.
2. Wrap each finance page's root content area with `<FinanceErrorBoundary>`.

**Validation:**
- Unit test: render a child that throws → error boundary catches, displays fallback UI, does not crash parent.
- Manual: temporarily throw in `FeeStructureList` → error boundary shows recovery UI.

---

### Ticket 1.4 — Audit and fix all frontend finance service return types

**Files:**
- `edforge-saas-frontend/apps/shell/src/services/invoices.service.ts`
- `edforge-saas-frontend/apps/shell/src/services/payments.service.ts`
- `edforge-saas-frontend/apps/shell/src/services/payment-gateways.service.ts`

**Changes:**
1. Define a shared interface matching the backend pagination shape:
   ```typescript
   interface FinancePaginatedResponse<T> { items: T[]; hasMore: boolean; lastEvaluatedKey?: string }
   ```
2. `invoices.service.ts` — `getInvoices()` currently returns `PaginatedResponse<Invoice>` (with `data` field). Backend returns `{ items, hasMore }`. Update to use `FinancePaginatedResponse<Invoice>` and extract `items`.
3. `payments.service.ts` — `getSchoolPayments()` returns `Payment[]` but backend returns paginated. Fix to unwrap `items`.
4. `payment-gateways.service.ts` — verify `getEnabledGateways()` and `getAdminGateways()` return shapes match backend.
5. For each function, add a runtime guard: if response is not the expected shape, log a warning and return safe defaults.

**Validation:**
- Unit test per service function: mock each backend response shape → verify correct unwrap.
- TypeScript compilation passes with strict mode.

---

### Ticket 1.5 — Clean up dynamic form POST memory leak in usePaymentFlow

**File:** `edforge-saas-frontend/apps/shell/src/hooks/usePaymentFlow.ts`

**Problem:** Line ~161: dynamic `<form>` is appended to `document.body` and submitted, but never removed from the DOM.

**Changes:**
1. After `form.submit()`, schedule cleanup:
   ```typescript
   form.submit()
   setTimeout(() => {
     if (form.parentNode) form.parentNode.removeChild(form)
   }, 1000)
   ```

**Validation:**
- Unit test: mock `form.submit()`, call `confirmAndPay()` with form_post method → verify `removeChild` is called on the form after timeout.
- Manual: initiate eSewa payment → inspect DOM → no orphaned `<form>` elements.

---

**Sprint 1 Demo:** Navigate through all finance settings pages (fee structures, payment gateways) and parent portal (invoices, payment flow) with an empty database. Every page renders without crash. Show error boundary catching a simulated error.

---

## Sprint 2 — Backend Data Integrity & Invoice Math

**Goal:** All financial calculations are correct. Invoice lifecycle (generate → issue → pay → void → refund) maintains consistent state across invoice, payment, ledger, and student account entities.

**Intra-sprint dependency:** Ticket 2.3 creates `reversePaymentOnInvoice()`. Ticket 2.4 depends on 2.3. Implement 2.3 before 2.4.

**Shared-types note:** Tickets 2.5 and 2.6 modify schemas. Bump shared-types to `0.10.1` at the end of this sprint (see Ticket 2.9).

---

### Ticket 2.1 — Fix invoice tax calculation

**File:** `server/application/microservices/finance/src/invoices/invoices.service.ts`

**Problem:** Line 66: `Math.round(afterDiscount * fs.taxRate) / 100`. The `taxRate` schema allows `0–100` (integer percentage). The formula `Math.round(X * taxRate) / 100` produces the correct result when `taxRate` is an integer (e.g., `Math.round(500 * 13) / 100 = 65`), but is semantically confusing and brittle. If anyone stores `0.13` instead of `13`, the result is wrong by 100x.

**Changes:**
1. Normalize to explicitly divide by 100:
   ```typescript
   const taxAmount = afterDiscount > 0
     ? Math.round(afterDiscount * (fs.taxRate / 100) * 100) / 100
     : 0;
   ```
2. Add a comment: `// taxRate is integer percentage (0–100), e.g. 13 = 13%`
3. Add service-layer guard in fee-structure creation: `if (taxRate > 100 || taxRate < 0) throw BadRequestException`.

**Validation:**
- Unit test: `amount=10000, taxRate=13` → `taxAmount=1300`.
- Unit test: `amount=10000, taxRate=0` → `taxAmount=0`.
- Unit test: `amount=1234.56, taxRate=13` → verify correct 2-decimal rounding (`160.49`).
- Unit test: `amount=10000, discount=5000, taxRate=13` → `taxAmount=650`.

---

### Ticket 2.2 — Add status guard to applyPayment

**File:** `server/application/microservices/finance/src/invoices/invoices.service.ts`

**Problem:** `applyPayment()` (line 374) sets status to `paid` or `partially_paid` without checking current status. A `draft` invoice could skip `issued`. A `cancelled` invoice could become `partially_paid`.

**Changes:**
1. Add a guard at the top of `applyPayment()`:
   ```typescript
   const payableStatuses = ['issued', 'partially_paid', 'overdue'];
   if (!payableStatuses.includes(invoice.status)) {
     throw new BadRequestException(
       `Cannot apply payment to invoice in '${invoice.status}' status`
     );
   }
   ```

**Validation:**
- Unit test: `applyPayment` on `draft` invoice → throws `BadRequestException`.
- Unit test: `applyPayment` on `cancelled` invoice → throws.
- Unit test: `applyPayment` on `issued` invoice → succeeds, status becomes `partially_paid` or `paid`.
- Unit test: `applyPayment` on `overdue` invoice → succeeds.

---

### Ticket 2.3a — Create reversePaymentOnInvoice method

**File:** `server/application/microservices/finance/src/invoices/invoices.service.ts`

**Problem:** No mechanism to reverse a payment's effect on an invoice (needed by void and refund).

**Changes:**
1. Add `reversePaymentOnInvoice(schoolId, invoiceId, amount, context)`:
   - Fetch invoice entity.
   - Subtract `amount` from `amountPaid`, add to `amountDue`.
   - Recalculate status: `amountPaid === 0 ? 'issued' : 'partially_paid'`.
   - Use optimistic locking.
   - Update GSI1SK with new status.

**Validation:**
- Unit test: reverse 5000 on invoice with `amountPaid=5000, amountDue=5000, grandTotal=10000` → `amountPaid=0, amountDue=10000, status='issued'`.
- Unit test: reverse 3000 on invoice with `amountPaid=7000, amountDue=3000, grandTotal=10000` → `amountPaid=4000, amountDue=6000, status='partially_paid'`.
- Unit test: reverse on invoice where `amountPaid < amount` → throws error (cannot reverse more than paid).

---

### Ticket 2.3b — Wire voidPayment to reverse invoice and post ledger entry

**File:** `server/application/microservices/finance/src/payments/payments.service.ts`

**Depends on:** Ticket 2.3a.

**Problem:** `voidPayment()` (line 603) changes payment status to `cancelled` but does NOT decrease `invoice.amountPaid`, increase `invoice.amountDue`, revert invoice status, or post a reversal ledger entry.

**Changes:**
1. After voiding the payment, call `this.invoicesService.reversePaymentOnInvoice(...)`.
2. Post a debit ledger entry:
   ```typescript
   await this.studentAccountsService.recordLedgerEntry(
     account, 'adjustment', paymentId,
     `Void of payment ${existing.receiptNumber}: ${reason}`,
     existing.amount, 0, context
   );
   ```

**Validation:**
- Unit test: void completed payment for 5000 on invoice `grandTotal=10000, amountPaid=5000` → invoice reverts to `amountPaid=0, status='issued'`. Ledger has debit of 5000.
- Unit test: void on fully-paid invoice → invoice reverts to `issued`.
- Unit test: void on partially-paid invoice (two payments, void one) → invoice stays `partially_paid`.

---

### Ticket 2.4 — Wire refund to update invoice balance

**File:** `server/application/microservices/finance/src/payments/payments.service.ts`

**Depends on:** Ticket 2.3a.

**Problem:** `refund()` (line 642) records a ledger debit but does NOT update `invoice.amountPaid` or `invoice.amountDue`.

**Changes:**
1. After creating the refund and updating the payment, call `reversePaymentOnInvoice()` with the refund amount.
2. Count all non-failed refunds toward the limit:
   ```typescript
   const totalRefunded = existing.refunds
     .reduce((sum, r) => sum + (r.status !== 'failed' ? r.amount : 0), 0);
   ```

**Validation:**
- Unit test: full refund of 10000 payment → invoice `amountDue` restores to `grandTotal`, status becomes `issued`.
- Unit test: partial refund of 3000 on 10000 payment → invoice `amountDue` increases by 3000.
- Unit test: attempt refund exceeding refundable amount → `BadRequestException`.

---

### Ticket 2.5 — Add minimum payment amount validation

**Files:**
- `server/application/microservices/finance/src/payments/payments.service.ts`
- `packages/shared-types/src/schemas/finance/payment.schema.ts`

**Changes:**
1. In `recordManualPayment()` and `initiatePayment()`:
   ```typescript
   if (dto.amount < 1) throw new BadRequestException('Minimum payment amount is NPR 1');
   ```
2. In shared-types schema: `amount: z.number().positive().min(1, 'Minimum payment is NPR 1')`.

**Validation:**
- Unit test: payment of 0.50 → throws.
- Unit test: payment of 1 → succeeds.
- Unit test: payment of -5 → throws (schema rejects).

---

### Ticket 2.6 — Fix receipt grandTotal to reflect payment amount

**Files:**
- `server/application/microservices/finance/src/payments/payments.service.ts`
- `packages/shared-types/src/schemas/finance/payment.schema.ts`
- `edforge-saas-frontend/apps/shell/src/components/payments/PaymentReceipt.tsx`

**Problem:** `getReceipt()` (line 261) uses `invoice.grandTotal` for the receipt, not `payment.amount`. For partial payments, the receipt shows the full invoice total.

**Changes:**
1. Backend: set receipt `grandTotal: payment.amount` and add `invoiceGrandTotal: invoice.grandTotal`.
2. Schema: add optional `invoiceGrandTotal` to `receiptSchema`.
3. Frontend: display both values when they differ.

**Validation:**
- Unit test: partial payment of 5000 on 10000 invoice → receipt `grandTotal = 5000`.
- Manual: view receipt after partial payment → shows "Amount Paid: NPR 5,000" with reference to "Invoice Total: NPR 10,000".

---

### Ticket 2.7 — Fix schoolName resolution in invoice generation

**File:** `server/application/microservices/finance/src/invoices/invoices.service.ts`

**Problem:** Lines 98–102: `schoolName` is always set to `schoolId` (UUID). The identity client check is a no-op — it sets `schoolName = schoolId` regardless.

**Changes:**
1. Update `IdentityClientService` to return school data including name, or add `getSchool()`.
2. Use the returned school name:
   ```typescript
   let schoolName = schoolId;
   try {
     const school = await this.identityClient.getSchool(schoolId, context);
     schoolName = school?.name || schoolId;
   } catch { /* use schoolId as fallback */ }
   ```

**Validation:**
- Unit test: mock identity client returning `{ name: 'Westfield High School' }` → invoice `schoolName` is `'Westfield High School'`.
- Unit test: identity client throws → invoice `schoolName` falls back to schoolId UUID.

---

### Ticket 2.8 — Add mapper null-safety for refunds and lineItems

**Files:**
- `server/application/microservices/finance/src/common/mappers/payment.mapper.ts`
- `server/application/microservices/finance/src/common/mappers/invoice.mapper.ts`

**Changes:**
- Payment mapper: `refunds: (entity.refunds ?? []).map(...)`
- Invoice mapper: `lineItems: (entity.lineItems ?? []).map(...)`

**Validation:**
- Unit test: entity with `refunds: undefined` → mapper returns empty array, no crash.
- Unit test: entity with `lineItems: null` → mapper returns empty array, no crash.

---

### Ticket 2.9 — Add entity-level validation in factory functions

**Files:**
- `server/application/microservices/finance/src/common/entities/invoice.entity.ts`
- `server/application/microservices/finance/src/common/entities/payment.entity.ts`
- `server/application/microservices/finance/src/common/entities/fee-structure.entity.ts`

**Changes:**
1. In `createInvoiceEntity()`:
   ```typescript
   if (data.lineItems.length === 0) throw new Error('Invoice must have at least one line item');
   if (data.grandTotal < 0) throw new Error('Grand total cannot be negative');
   if (data.dueDate && data.issuedDate && data.dueDate < data.issuedDate) {
     throw new Error('Due date must be after issued date');
   }
   ```
2. In `createPaymentEntity()`: `if (data.amount <= 0) throw new Error('Payment amount must be positive');`
3. In `createFeeStructureEntity()`: `if (data.taxRate < 0 || data.taxRate > 100) throw new Error('Tax rate must be 0-100');`

**Validation:**
- Unit test per factory: invalid data → descriptive error.
- Unit test per factory: valid data → entity created.

---

### Ticket 2.10 — Bump shared-types to 0.10.1

**Files:** `packages/shared-types/package.json` and dependent `package.json` files.

**Changes:**
1. Bump version.
2. `npm run build` in shared-types.
3. Update backend and frontend package references.

**Validation:**
- `npm run build` succeeds.
- Backend compiles.
- Frontend compiles.

---

**Sprint 2 Demo:** Use a smoke test script to: create a fee structure → generate an invoice → issue it → make a partial manual payment → view the receipt (shows correct partial amount, correct school name) → void the payment (invoice reverts, ledger reversal posted) → re-pay in full → attempt overpay (rejected) → refund partially (invoice and ledger update correctly). Show tax calculation is correct with 13% VAT.

---

## Sprint 3 — Payment Gateway Security Hardening

**Goal:** eSewa and Khalti flows are cryptographically verified. No callback manipulation can forge a payment. Gateway credentials are encrypted at rest. All endpoints have proper authorization.

**Feature branch requirement:** Tickets 3.4 (KMS encryption) and 3.6 (session lookup) must be developed on feature branches due to high regression risk.

---

### Ticket 3.1 — Require eSewa callback signature verification

**File:** `server/application/microservices/finance/src/payment-gateways/adapters/esewa.adapter.ts`

**Problem:** Line 103: signature verification is inside `if (input.callbackData.data)`. If `data` param is missing, verification is skipped.

**Changes:**
1. Make `data` param mandatory:
   ```typescript
   if (!input.callbackData.data) {
     return {
       success: false, status: 'failed',
       failureReason: 'Missing required eSewa callback data parameter',
     };
   }
   ```

**Validation:**
- Unit test: `verifyPayment` without `data` param → returns `{ success: false }`.
- Unit test: valid base64 `data` with correct signature → proceeds to server verify.
- Unit test: valid base64 `data` with tampered signature → returns signature mismatch error.

---

### Ticket 3.2 — Add amount verification to eSewa server-side check

**File:** `server/application/microservices/finance/src/payment-gateways/adapters/esewa.adapter.ts`

**Problem:** Lines 149–158: `data.total_amount` from eSewa response is never compared against `input.amount`.

**Changes:**
1. After `COMPLETE` status, verify amount:
   ```typescript
   if (esewaStatus === 'COMPLETE') {
     if (data.total_amount !== input.amount) {
       this.logger.warn(`eSewa amount mismatch: expected ${input.amount}, got ${data.total_amount}`);
       return { success: false, status: 'failed',
         failureReason: `Amount mismatch: expected ${input.amount}, received ${data.total_amount}` };
     }
     // ... proceed
   }
   ```

**Validation:**
- Unit test: eSewa returns `COMPLETE, total_amount=5000` when `input.amount=5000` → success.
- Unit test: eSewa returns `COMPLETE, total_amount=100` when `input.amount=5000` → fails.

---

### Ticket 3.3 — Restructure Khalti amount verification order

**File:** `server/application/microservices/finance/src/payment-gateways/adapters/khalti.adapter.ts`

**Problem:** Amount verification at line 146 happens after status check. Should verify amount first.

**Changes:**
1. Check amount before evaluating status:
   ```typescript
   const expectedPaisa = Math.round(input.amount * 100);
   if (data.total_amount !== expectedPaisa) {
     return { success: false, status: 'failed',
       failureReason: `Amount mismatch: expected ${expectedPaisa} paisa, got ${data.total_amount} paisa` };
   }
   if (khaltiStatus === 'completed') {
     return { success: true, status: 'completed', ... };
   }
   ```

**Validation:**
- Unit test: Khalti returns `completed, total_amount=2500000` when expected `2500000` → success.
- Unit test: Khalti returns `completed, total_amount=50000` when expected `2500000` → fails.

---

### Ticket 3.4 — Encrypt gateway credentials with AWS KMS

**Branch:** Feature branch `feat/kms-gateway-creds`. **Backward compatibility required:** reader must handle both plaintext (pre-migration) and encrypted values.

**Files:**
- Create `server/application/microservices/finance/src/common/services/kms-encryption.service.ts`
- Modify `server/application/microservices/finance/src/payment-gateways/payment-gateways.service.ts`

**Changes:**
1. Create `KmsEncryptionService` with `encrypt(plaintext)` and `decrypt(ciphertext)`.
2. In `save()`, encrypt credentials before persisting. Prefix encrypted values with `enc:` marker.
3. In `getDecryptedEntity()`, check for `enc:` prefix — if present, decrypt; if not, treat as plaintext (backward compat).
4. Admin read endpoint continues to return `****`.

**Validation:**
- Unit test: save → DynamoDB item values start with `enc:`.
- Unit test: read encrypted value → decrypted correctly.
- Unit test: read plaintext value (pre-migration) → returned as-is.
- Integration test (staging): configure eSewa → initiate payment → HMAC signature correct (proves decryption works end-to-end).

---

### Ticket 3.5 — Add cursor decoding error handling

**Files:** All controllers and services that decode pagination cursors.

**Changes:**
1. Create a shared utility:
   ```typescript
   function decodeCursor(cursor: string): Record<string, any> | undefined {
     if (!cursor) return undefined;
     try {
       return JSON.parse(Buffer.from(cursor, 'base64').toString());
     } catch {
       throw new BadRequestException('Invalid pagination cursor');
     }
   }
   ```
2. Use in all `list()` service methods.

**Validation:**
- Unit test: valid base64 cursor → decodes correctly.
- Unit test: `"not-valid-base64!!!"` → throws `BadRequestException` (400).
- Unit test: valid base64 but invalid JSON → throws 400.

---

### Ticket 3.6a — Enable DynamoDB TTL on finance table (infrastructure)

**Files:** CDK/IaC configuration for the `edforge-finance-{tier}` table.

**Changes:**
1. Enable TTL attribute `ttl` on the DynamoDB table if not already enabled.

**Validation:**
- `aws dynamodb describe-time-to-live --table-name edforge-finance-basic` → shows TTL enabled on `ttl` attribute.

---

### Ticket 3.6b — Create payment session lookup entity at initiation

**File:** `server/application/microservices/finance/src/payments/payments.service.ts`

**Changes:**
1. At payment initiation (line 318), also store a lightweight lookup entity:
   ```typescript
   const lookupEntity = {
     tenantId: context.tenantId,
     entityKey: `PAYMENT_SESSION#${sessionId}`,
     paymentEntityKey: paymentEntity.entityKey,
     schoolId,
     createdAt: new Date().toISOString(),
     ttl: Math.floor(Date.now() / 1000) + 3600, // 1hr TTL for auto-cleanup
   };
   await this.dynamoDBClient.putItem(client, lookupEntity);
   ```

**Validation:**
- Unit test: initiate payment → lookup entity created with correct keys and TTL.
- Unit test: verify DynamoDB has both payment entity and lookup entity after initiation.

---

### Ticket 3.6c — Refactor verifyPayment to use session lookup with fallback

**Branch:** Feature branch `feat/verify-lookup`. **Backward compatibility required:** must fall back to scan query for in-flight payments that lack a lookup entity.

**File:** `server/application/microservices/finance/src/payments/payments.service.ts`

**Changes:**
1. In `verifyPayment()`, try direct `getItem` for lookup entity first:
   ```typescript
   const lookupKey = `PAYMENT_SESSION#${sessionId}`;
   const lookup = await this.dynamoDBClient.getItem(client, context.tenantId, lookupKey);
   if (lookup) {
     const payment = await this.dynamoDBClient.getItem<PaymentEntity>(
       client, context.tenantId, lookup.paymentEntityKey
     );
     // ... proceed with payment
   } else {
     // Fallback: legacy scan query (for payments created before this change)
     const result = await this.dynamoDBClient.query<PaymentEntity>(...);
   }
   ```

**Validation:**
- Unit test: session with lookup entity → direct fetch, no scan.
- Unit test: session without lookup entity (legacy) → falls back to scan, still works.
- Load test: 1000 payments → verify completes in <100ms.

---

### Ticket 3.7 — Add authorization guards to verifyPayment, getPayment, getReceipt

**File:** `server/application/microservices/finance/src/payments/payments.controller.ts`

**Problem:** `verifyPayment` (line 55), `getPayment` (line 107), and `getReceipt` (line 118) have no `@UseGuards(PermissionGuard)` or `@RequirePermission()`. Any authenticated user can verify any payment session, read any payment, or download any receipt by guessing IDs.

**Changes:**
1. `verifyPayment`: add `@RequirePermission({ resource: 'billing', action: 'create' })`. Also validate that the resolved payment's `schoolId` matches the user's authorized schools.
2. `getPayment` and `getReceipt`: move `schoolId` from query param to path param (`/schools/:schoolId/payments/:paymentId`) and add `@RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })`.
3. Update frontend service URLs to match the new path structure.

**Validation:**
- Unit test: call `getPayment` without permission → 403.
- Unit test: call `getReceipt` for a payment in school A while authorized for school B → 403.
- Unit test: call `verifyPayment` with valid permission → succeeds.

---

### Ticket 3.8 — Add concurrent payment prevention for same invoice

**File:** `server/application/microservices/finance/src/payments/payments.service.ts`

**Problem:** Two users (or same user in two tabs) can both initiate gateway payments for the same invoice simultaneously. If both complete, the invoice is overpaid.

**Changes:**
1. In `initiatePayment()`, before creating the pending payment, check for existing pending gateway payments:
   ```typescript
   const pendingPayments = await this.findPendingGatewayPayments(schoolId, dto.invoiceId, context);
   if (pendingPayments.length > 0) {
     const recent = pendingPayments[0];
     const ageMs = Date.now() - new Date(recent.createdAt).getTime();
     if (ageMs < 30 * 60 * 1000) { // 30 min session
       throw new ConflictException(
         'A payment session is already in progress for this invoice. Please wait or cancel the existing session.'
       );
     }
     // Expire stale sessions
   }
   ```

**Validation:**
- Unit test: initiate payment → initiate second for same invoice → 409 Conflict.
- Unit test: initiate → wait beyond session TTL → second initiation succeeds.
- Unit test: manual payments (cash/cheque) are not blocked by pending gateway sessions.

---

**Sprint 3 Demo:** Configure eSewa gateway with test credentials. Initiate a payment → show form POST to eSewa test environment. Callback returns → show signature verified, amount matched, payment completes. Show DynamoDB credentials field is encrypted (not plaintext via CLI query). Show that tampering with callback data is rejected. Show that concurrent payment initiation is blocked. Show that unauthenticated receipt access returns 403.

---

## Sprint 4 — Ledger Integrity & Concurrency Safety

**Goal:** All financial state changes are idempotent, concurrency-safe via DynamoDB transactions, and produce correct running balances. No data corruption from concurrent requests.

**Feature branch requirement:** Ticket 4.2 (TransactWrite refactor) must be on a feature branch.

---

### Ticket 4.1 — Add idempotency to ledger entries

**File:** `server/application/microservices/finance/src/student-accounts/student-accounts.service.ts`

**Problem:** `recordLedgerEntry()` has no idempotency check. Retried payment completion creates duplicate ledger entries.

**Changes:**
1. Add a `referenceKey` parameter (e.g., `payment:<paymentId>` or `refund:<refundId>`).
2. Add a `referenceKey` attribute to the ledger entity.
3. Before TransactWrite, query for existing entry with same `referenceKey` on the same account. If found, return it (no-op).

**Validation:**
- Unit test: call `recordLedgerEntry` twice with same `referenceKey` → one entry created, second is no-op.
- Unit test: call with different `referenceKey` → two entries created.

---

### Ticket 4.2 — Wrap payment completion in DynamoDB TransactWrite

**Branch:** Feature branch `feat/payment-transact-write`.

**File:** `server/application/microservices/finance/src/payments/payments.service.ts`

**Problem:** `completePayment()` performs 4 separate writes. If any middle step fails, partial state persists.

**Changes:**
1. Refactor to use `TransactWriteItems`:
   ```typescript
   const transactItems = [
     { Update: { /* payment status → completed */ } },
     { Update: { /* invoice amountPaid, amountDue, status */ } },
     { Put: { /* ledger entry */ } },
     { Update: { /* account balance */ } },
   ];
   await this.dynamoDBClient.transactWrite(client, transactItems);
   ```
2. All items use version conditions.
3. Handle `TransactionCanceledException` — inspect cancellation reasons to distinguish version conflict from other errors, throw appropriate exception.

**Validation:**
- Unit test: mock concurrent completions → only one succeeds, other gets `ConflictException`.
- Unit test: mock DynamoDB `transactWrite` throwing `TransactionCanceledException` with reason `ConditionalCheckFailed` on payment item → throws `ConflictException` with clear message.
- Unit test: successful transaction → all 4 entities in expected state.
- Unit test: simulate DynamoDB failure → no partial state (mock verifies no individual writes).

---

### Ticket 4.3 — Add ConflictException for version locking failures

**Files:**
- `server/application/microservices/finance/src/common/services/dynamodb-client.service.ts`
- All controllers

**Changes:**
1. In `DynamoDBClientService.updateItem()`, catch `ConditionalCheckFailedException`:
   ```typescript
   } catch (error) {
     if (error.name === 'ConditionalCheckFailedException') {
       throw new ConflictException('Concurrent update detected. Please retry.');
     }
     throw error;
   }
   ```
2. NestJS `ConflictException` automatically returns 409 status.

**Validation:**
- Unit test: simulate version mismatch → throws `ConflictException`.
- Unit test: 409 response from controller.

---

### Ticket 4.4 — Add invoice number uniqueness enforcement

**File:** `server/application/microservices/finance/src/invoices/invoices.service.ts`

**Changes:**
1. Use `attribute_not_exists(entityKey)` on invoice `putItem`.
2. After generating invoice number, verify no existing invoice has it via GSI3. If collision, retry with next number.

**Validation:**
- Unit test: attempt duplicate entityKey → `ConditionalCheckFailedException`.
- Unit test: simulate sequence collision → retry gets next number.

---

### Ticket 4.5 — Add billing account creation retry limit

**File:** `server/application/microservices/finance/src/student-accounts/student-accounts.service.ts`

**Changes:**
1. Add max retry parameter (default 2):
   ```typescript
   async getOrCreate(schoolId, studentAccountId, studentName, context, retries = 0) {
     if (retries > 2) throw new ConflictException('Failed to create billing account after retries');
     // ... catch ConditionalCheckFailed → recursive call with retries + 1
   }
   ```

**Validation:**
- Unit test: simulate 3 concurrent creates → one succeeds, others fall back to fetch.
- Unit test: persistent failure → throws after 3 retries.

---

**Sprint 4 Demo:** Using a pre-written concurrent test script: fire two `POST /payments/manual` requests simultaneously for the same invoice. Show one succeeds (200), other gets 409 conflict. Show ledger has exactly one entry. Show DynamoDB transaction atomicity — all 4 entities updated or none.

---

## Sprint 5 — Schema Hardening & Input Validation

**Goal:** Shared-types schemas enforce all business rules at boundaries. Invalid data is rejected before reaching DynamoDB.

---

### Ticket 5.1 — Tighten amount schemas in shared-types

**File:** `packages/shared-types/src/schemas/finance/common.ts`

**Changes:**
1. `amountSchema = z.number().min(0).max(99_999_999.99)`
2. Receipt line items: `amount: z.number().min(0)`, `taxAmount: z.number().min(0)`, `total: z.number().min(0)`.

**Validation:**
- Unit test: `amount: -1` → fails. `amount: 100000000` → fails. `amount: 50000` → passes.

---

### Ticket 5.2 — Add amountPaid/amountDue constraints

**File:** `packages/shared-types/src/schemas/finance/invoice.schema.ts`

**Changes:** `amountPaid: z.number().min(0)`, `amountDue: z.number().min(0)`.

**Validation:**
- Unit test: `amountPaid: -5` → fails. `amountDue: 0` → passes.

---

### Ticket 5.3 — Add parseInt safety and shared parse utilities

**Files:**
- Create `server/application/microservices/finance/src/common/helpers/parse-utils.ts`
- All controllers parsing query params

**Changes:**
1. Create:
   ```typescript
   export function parsePositiveInt(value: string | undefined, defaultVal: number, max: number): number {
     if (!value) return defaultVal;
     const parsed = parseInt(value, 10);
     if (isNaN(parsed) || parsed < 1) return defaultVal;
     return Math.min(parsed, max);
   }
   ```
2. Replace all `parseInt(limit, 10)` with `parsePositiveInt(limit, 50, 200)`.

**Validation:**
- Unit test: `'abc'` → default. `'-1'` → default. `'500'` → capped at 200. `'25'` → 25.

---

### Ticket 5.4 — Add rate limiting to payment endpoints

**Files:**
- `server/application/microservices/finance/src/payments/payments.controller.ts`
- `server/application/microservices/finance/src/app.module.ts`

**Changes:**
1. Add NestJS `@nestjs/throttler` module.
2. Apply `@Throttle({ default: { limit: 10, ttl: 60000 } })` to `initiatePayment` and `recordManualPayment`.
3. Apply `@Throttle({ default: { limit: 30, ttl: 60000 } })` to read endpoints.

**Validation:**
- Unit test: 11th payment initiation within 60s → 429 Too Many Requests.
- Unit test: 10th payment initiation → succeeds.

---

### Ticket 5.5 — Publish shared-types 0.10.2 and update dependencies

**Changes:** Bump version, build, update all dependents.

**Validation:** Backend and frontend compile. All existing tests pass.

---

**Sprint 5 Demo:** Show invalid API requests rejected: negative amounts (400), missing line items (400), invalid cursors (400), non-numeric limit (uses default). Show rate limiting: fire 15 rapid payment initiations → first 10 succeed, next 5 return 429.

---

## Sprint 6 — Frontend Payment Flow Robustness

**Goal:** Payment callback handles all edge cases. Frontend payment flow is resilient and provides clear user feedback.

---

### Ticket 6.1 — Sanitize error messages in PaymentForm

**File:** `edforge-saas-frontend/apps/shell/src/hooks/usePaymentFlow.ts`

**Changes:**
1. Sanitize before storing:
   ```typescript
   const safeMessage = (error.message || 'Payment failed')
     .replace(/</g, '&lt;').replace(/>/g, '&gt;')
     .substring(0, 200);
   ```

**Validation:**
- Unit test: error with `<script>` tags → tags escaped.
- Unit test: 500-char error → truncated to 200.

---

### Ticket 6.2 — Handle duplicate/stale gateway callbacks

**File:** `edforge-saas-frontend/apps/shell/src/pages/payments/callback.tsx`

**Changes:**
1. Check `payment.status !== 'pending'` and show appropriate state immediately.
2. Cache verification result in `sessionStorage` to handle refreshes gracefully.

**Validation:**
- Automated test (React Testing Library): render callback with sessionId → `useVerifyPayment` called → simulate second render with same sessionId → verify mutation not called twice.
- Manual: complete payment → refresh callback page → success state shown immediately.

---

### Ticket 6.3 — Fix callback page gateway name in translations

**File:** `edforge-saas-frontend/apps/shell/src/pages/payments/callback.tsx`

**Changes:**
1. Extract gateway from URL params or payment data.
2. Pass to translation with fallback.

**Validation:**
- Manual: eSewa callback → shows "Verifying your eSewa payment...".
- Manual: unknown gateway → shows "Verifying your payment...".

---

### Ticket 6.4 — Add configurable payment flow timeout

**File:** `edforge-saas-frontend/apps/shell/src/hooks/usePaymentFlow.ts`

**Changes:**
1. Add timeout on `redirecting` state (configurable, default 30 min):
   ```typescript
   const PAYMENT_TIMEOUT_MS = Number(import.meta.env.VITE_PAYMENT_TIMEOUT_MS) || 30 * 60 * 1000;
   ```
2. Dispatch `ERROR` action when timeout fires.
3. Clean up timeout on unmount.

**Validation:**
- Unit test: enter `redirecting` → after timeout → `error` state with expiry message.
- Unit test: cancel before timeout → timeout cleared, no error.

---

### Ticket 6.5 — Add payment status polling for pending verifications

**File:** `edforge-saas-frontend/apps/shell/src/pages/payments/callback.tsx`

**Changes:**
1. When verification returns `status: 'pending'`, enable polling:
   ```typescript
   refetchInterval: (query) => query.state.data?.status === 'pending' ? 5000 : false,
   ```
2. Add a max polling duration (2 min). After 2 min of pending, show timeout message.

**Validation:**
- Automated test: mock 3 pending responses then 1 completed → UI transitions correctly.
- Automated test: mock 25 consecutive pending responses → polling stops at ~120s, shows timeout.

---

**Sprint 6 Demo:** Full payment flow with eSewa test environment. Show: gateway selection → confirmation → redirect → callback → receipt. Show cancel at gateway → cancelled state. Show timeout (set env var to 10s for demo). Show refresh resilience on callback page.

---

## Sprint 7 — Observability & Production Readiness

**Goal:** Structured logging for debugging, cached gateway configs, abandoned payment cleanup, and error code standardization.

---

### Ticket 7.1 — Add structured logging to finance service methods

**Files:** All service files in finance microservice.

**Changes:**
1. Log key decision points:
   ```typescript
   this.logger.log({
     action: 'payment.initiated', schoolId, invoiceId: dto.invoiceId,
     gateway: dto.gateway, amount: dto.amount, sessionId,
   });
   ```
2. Log all gateway adapter calls (request + response, excluding credentials).
3. Log all status transitions with before/after state.

**Validation:**
- Unit test: verify `logger.log` called with expected structured object for each key path.
- Manual: process payment → verify structured entries in CloudWatch with `correlationId`.

---

### Ticket 7.2 — Add gateway config caching with TTL

**File:** `server/application/microservices/finance/src/payment-gateways/payment-gateways.service.ts`

**Changes:**
1. In-memory cache with 5-min TTL.
2. Invalidate on `save()`.

**Validation:**
- Unit test: first call → DynamoDB query. Second within 5 min → cache hit.
- Unit test: save → cache invalidated, next call fetches fresh.

---

### Ticket 7.3 — Extract shared buildContext helper and code cleanup

**Files:** All finance controllers.

**Changes:**
1. Create shared `buildContext()` utility.
2. Replace duplicated methods in all controllers.

**Validation:** All existing tests pass. TypeScript compiles.

---

### Ticket 7.4 — Add abandoned payment session sweep job

**File:** Create `server/application/microservices/finance/src/common/services/payment-sweep.service.ts`

**Problem:** Pending payments that are never completed (user abandons gateway page) persist forever. No mechanism to clean them up or attempt re-verification.

**Changes:**
1. Create a scheduled service (NestJS `@Cron`) that runs every 30 minutes.
2. Query for `status: pending` payments older than 30 minutes.
3. For each: attempt gateway verification. If failed/expired, mark as `failed`.
4. Log all sweep actions.

**Validation:**
- Unit test: mock 3 pending payments (1 older than 30 min, 2 recent) → sweep processes only the old one.
- Unit test: sweep re-verifies → gateway returns expired → payment marked failed.

---

### Ticket 7.5 — Standardize backend error codes for i18n

**Files:** All service files that throw `BadRequestException`.

**Changes:**
1. Define error code constants:
   ```typescript
   export const FinanceErrors = {
     PAYMENT_EXCEEDS_DUE: 'PAYMENT_EXCEEDS_DUE',
     INVOICE_NOT_PAYABLE: 'INVOICE_NOT_PAYABLE',
     MIN_PAYMENT_AMOUNT: 'MIN_PAYMENT_AMOUNT',
     GATEWAY_NOT_ENABLED: 'GATEWAY_NOT_ENABLED',
     CONCURRENT_PAYMENT: 'CONCURRENT_PAYMENT',
     // ...
   };
   ```
2. Throw with structured error:
   ```typescript
   throw new BadRequestException({
     code: FinanceErrors.PAYMENT_EXCEEDS_DUE,
     params: { amount: dto.amount, amountDue: invoice.amountDue },
     message: `Payment amount (${dto.amount}) exceeds amount due (${invoice.amountDue})`,
   });
   ```
3. Frontend can use error code to look up i18n translation.

**Validation:**
- Unit test: each error path returns structured error with `code` field.
- Manual: trigger each error → frontend displays localized message.

---

**Sprint 7 Demo:** Show a complete payment flow. Pull up CloudWatch structured logs filtered by correlation ID — trace the full request path. Show that abandoned payment (initiate but never complete) is cleaned up by sweep job. Show that invalid API requests return structured error codes. Show gateway config cache reducing DynamoDB read latency.

---

## Appendix A: Issue-to-Ticket Mapping

| Audit Finding | Sprint | Ticket |
|---|---|---|
| P0 #1: `feeStructures.map` crash | S1 | 1.1, 1.2a-d |
| P0 #2: eSewa HMAC bypass | S3 | 3.1 |
| P0 #3: eSewa amount not verified | S3 | 3.2 |
| P0 #4: Credentials in plaintext | S3 | 3.4 |
| P1 #5: Tax calculation bug | S2 | 2.1 |
| P1 #6: applyPayment status bypass | S2 | 2.2 |
| P1 #7: Void doesn't reverse invoice | S2 | 2.3a, 2.3b |
| P1 #8: Refund doesn't update invoice | S2 | 2.4 |
| P1 #9: Refund counts only completed | S2 | 2.4 |
| P2 #10: Verify payment full scan | S3 | 3.6a-c |
| P2 #11: No min payment amount | S2 | 2.5 |
| P2 #12: Ledger idempotency | S4 | 4.1 |
| P2 #13: Receipt shows invoice total | S2 | 2.6 |
| P2 #14: eSewa test secret in comments | — | Triaged out (public test credential per eSewa docs) |
| P2 #15: schoolName is UUID | S2 | 2.7 |
| Frontend: form POST memory leak | S1 | 1.5 |
| Frontend: error boundaries missing | S1 | 1.3 |
| Frontend: service return type mismatches | S1 | 1.4 |
| Frontend: error message XSS | S6 | 6.1 |
| Frontend: callback edge cases | S6 | 6.2, 6.3 |
| Frontend: payment timeout | S6 | 6.4 |
| Frontend: pending poll | S6 | 6.5 |
| Backend: cursor decode crash | S3 | 3.5 |
| Backend: Khalti amount order | S3 | 3.3 |
| Backend: transact write atomicity | S4 | 4.2 |
| Backend: version locking gaps | S4 | 4.3 |
| Backend: invoice number uniqueness | S4 | 4.4 |
| Backend: account creation retries | S4 | 4.5 |
| Backend: mapper null safety | S2 | 2.8 |
| Backend: entity validation | S2 | 2.9 |
| Schema: amount bounds | S5 | 5.1 |
| Schema: invoice constraints | S5 | 5.2 |
| Schema: refund bounds | S5 | 5.4 (enforced at service layer) |
| Backend: logging | S7 | 7.1 |
| Backend: config caching | S7 | 7.2 |
| Backend: code duplication | S7 | 7.3 |
| **NEW: Missing authorization guards** | S3 | 3.7 |
| **NEW: Concurrent payment prevention** | S3 | 3.8 |
| **NEW: Rate limiting** | S5 | 5.4 |
| **NEW: Abandoned payment cleanup** | S7 | 7.4 |
| **NEW: Error code i18n** | S7 | 7.5 |
| **NEW: parseInt safety** | S5 | 5.3 |
| **NEW: DynamoDB TTL enablement** | S3 | 3.6a |

## Appendix B: Feature Branch Requirements

| Ticket | Branch Name | Risk |
|---|---|---|
| 3.4 | `feat/kms-gateway-creds` | Credential encryption could break reads if format changes. Backward-compat required. |
| 3.6c | `feat/verify-lookup` | In-flight payments lack lookup entity. Fallback to scan required. |
| 4.2 | `feat/payment-transact-write` | Changing 4 independent writes to single transaction. Highest regression risk. |

All other tickets are safe for direct commit to `payments` branch.

## Appendix C: Revision Notes

Improvements incorporated from architect review:
1. Split ticket 1.2 into per-component tickets (1.2a-d) for atomic reviews.
2. Split ticket 2.3 into 2.3a (create method) and 2.3b (wire void) for cleaner dependencies.
3. Split ticket 3.6 into 3.6a (infra/TTL), 3.6b (lookup creation), 3.6c (verification refactor with backward-compat fallback).
4. Moved entity-level validation (was Sprint 5) to Sprint 2 as ticket 2.9.
5. Added shared-types bump to Sprint 2 (ticket 2.10) instead of deferring to Sprint 5.
6. Added P2 #14 to mapping table with explicit "triaged out" note.
7. Added tickets: 3.7 (authorization audit), 3.8 (concurrent payment prevention), 5.4 (rate limiting), 7.4 (sweep job), 7.5 (error codes for i18n).
8. Added backward-compatibility requirement to ticket 3.4 (KMS encryption).
9. Added backward-compatible fallback to ticket 3.6c (session lookup).
10. Mandated feature branches for high-risk tickets (Appendix B).
11. Replaced "manual test" with automated tests on tickets 6.2 and 6.5.
12. Added explicit intra-sprint dependency note in Sprint 2.
13. Specified demo scripts for Sprint 2 and Sprint 4 (pre-written smoke tests).
14. Made payment flow timeout configurable (ticket 6.4) for demo purposes.
15. Improved Sprint 7 demo description to show user-visible behavior.
