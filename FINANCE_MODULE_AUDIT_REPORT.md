# EdForge Finance Module - Technical Audit & MVP Scope Report

**Date:** 2026-03-15
**Auditor:** Claude Opus 4.6 (Automated Technical Audit)
**Scope:** Finance microservice — MVP readiness for Nepal pilot (20-50 schools, April 2026)

---

## Section 1: Finance Module Overview

### Tech Stack
- **Runtime:** NestJS (TypeScript) on AWS ECS Fargate
- **Database:** DynamoDB (single-table design, PAY_PER_REQUEST billing)
- **Events:** AWS EventBridge (SBT bus), fire-and-forget publishing
- **Inter-service:** HTTP webhooks (academics → finance) + EventBridge
- **Auth:** JWT token vending machine for tenant-isolated DynamoDB access, InternalApiKeyGuard for webhooks
- **Container:** Docker multi-stage build, Node 20-Alpine, port 3010, 512 MiB / 256 CPU

### Primary Entities and Relationships

```
FeeStructureEntity (school-scoped fee catalog)
    │
    ├──[auto-apply on enrollment]──▶ InvoiceEntity (billing document per student)
    │                                     │
    │                                     ├──▶ PaymentEntity (payment against invoice)
    │                                     │        │
    │                                     │        └──▶ RefundData[] (embedded refunds)
    │                                     │
    │                                     └──▶ InvoiceLineItemData[] (embedded, snapshots fee at creation)
    │
    ├──▶ DiscountRuleEntity (discount policies, applied during invoice generation)
    │
    └──▶ CreditNoteEntity (scholarships, waivers, adjustments)

BillingAccountEntity (one per student per school)
    │
    └──▶ LedgerEntryEntity (append-only transaction log: debits/credits/running balance)

GatewayConfigEntity (payment gateway credentials per school)

RefundRequestEntity (governed refund workflow with approval chain)
```

### File Count
64 TypeScript files across 12 modules:
- `fee-structures/`, `invoices/`, `payments/`, `student-accounts/` (core)
- `payment-gateways/` with `adapters/` (eSewa, Khalti)
- `dashboard/`, `discount-rules/`, `credit-notes/`, `refunds/` (ancillary)
- `webhooks/` (enrollment integration)
- `common/` (entities, services, guards, mappers, errors)

---

## Section 2: MVP Feature Status Table

| # | MVP Feature | Status | Gap |
|---|------------|--------|-----|
| 1 | **Fee structure configuration** | **Partial** | Missing: `enrollmentType` applicability filter — only `gradeLevels[]` exists. Missing: explicit `activationDate` field (uses `effectiveFrom` which serves the purpose). `frequency` field exists (`one_time`, `monthly`, `quarterly`, `annual`). Currency stored. Status (`isActive`) exists. |
| 2 | **Automatic fee obligation generation** | **Partial** | Obligations are modeled as **Invoices**, not as standalone immutable ledger entries. The enrollment webhook (`POST /internal/webhooks/enrollment-completed`) creates a draft invoice with line items, but: (a) invoices are mutable (status changes, amountPaid updates), not immutable obligation records; (b) no explicit `enrollmentReferenceId` stored on the invoice; (c) the enrollment webhook in the controller duplicates logic that also exists in `EnrollmentBillingService` — dual code paths; (d) due date is hardcoded to +30 days rather than derived from fee structure rules. |
| 3 | **Student fee ledger view** | **Implemented** | `GET /finance/schools/{schoolId}/student-accounts/{accountId}/ledger` returns paginated ledger entries. `GET /finance/schools/{schoolId}/student-accounts/{accountId}` returns balance, totalPaid. Invoices queryable per student via GSI2. Outstanding balance available on BillingAccount entity. |
| 4 | **Manual payment recording** | **Implemented** | `POST /finance/schools/{schoolId}/payments/manual` records cash/cheque/bank_transfer. Stores amount, currency, gateway (payment method), paidBy (staff ID), references invoiceId. Updates invoice status atomically. Records ledger entry. Receipt number auto-generated. |
| 5 | **School-wide fee reporting** | **Partial** | Dashboard endpoint (`GET /finance/schools/{schoolId}/dashboard/summary`) provides: totalInvoiced, totalCollected, outstanding, overdue, invoicesByStatus, paymentsByGateway, recentPayments, recentInvoices. **Missing:** (a) breakdown by grade level; (b) breakdown by fee type; (c) monthly collection summary; (d) aging report (overdue >30 days buckets). Dashboard fetches ALL invoices and payments into memory (up to 10K each) — will not scale beyond ~200 students. |
| 6 | **Audit trail** | **Partial** | LedgerEntryEntity is append-only and immutable — covers financial transactions. Fee structure changes use structured audit logging via `AuditLoggerService`. Invoice status transitions are logged. **Missing:** (a) obligation status change history is not stored on the entity itself (only in CloudWatch logs); (b) no queryable audit trail entity for who changed what on an invoice. |
| 7 | **Due date management** | **Missing** | Fee structures have NO due date rule fields (`dueOnEnrollment`, `dueOnFirstOfMonth`, `dueWithinNDays`). Due dates are hardcoded in the enrollment webhook: `new Date() + 30 days`. For manual invoice generation, `dueDate` is a required input parameter — no automatic calculation from fee structure rules. |

---

## Section 3: Entities Assessment

### 3.1 FeeStructureEntity

**File:** `finance/src/common/entities/fee-structure.entity.ts`

**Current Schema:**
- `feeStructureId`, `schoolId`, `name`, `description`
- `academicYear`, `academicYearId`
- `feeType`: tuition | admission | exam | transport | library | lab | hostel | uniform | miscellaneous | custom
- `amount`, `currency` (defaults to NPR), `taxRate`, `taxType`
- `frequency`: one_time | monthly | quarterly | annual
- `gradeLevels[]` — applicability filter by grade
- `isActive`, `autoApplyOnEnrollment`, `proRateOnMidTermEntry`
- `effectiveFrom`, `effectiveTo` — date range
- `versionParentId`, `templateParentId`, `isOverride` — version chain

**What's Correct:**
- Tenant-scoped, school-scoped with correct GSI1 key
- Frequency field with correct enum values
- Grade-level applicability via `gradeLevels[]`
- Amount stored as number, currency stored
- Active/inactive status
- Versioning for financial field changes (amount, taxRate, taxType create new version atomically)
- effectiveFrom/effectiveTo for activation date range

**What's Missing or Wrong:**
1. **No `enrollmentType` applicability** — cannot filter fees by enrollment type (new, transfer, returning). The MVP requirement specifies "applicability rules by grade or enrollment type."
2. **No due date rule** — no field for `dueDateRule` (e.g., `{ type: 'days_after_enrollment', days: 30 }` or `{ type: 'fixed_day_of_month', day: 1 }`). Due dates are hardcoded elsewhere.
3. `gradeLevels` defaults to `[]` which means "applies to all grades" — this is correct behavior but should be documented.

### 3.2 InvoiceEntity (used as fee obligation)

**File:** `finance/src/common/entities/invoice.entity.ts`

**Current Schema:**
- `invoiceId`, `invoiceNumber` (formatted, sequential per school)
- `studentAccountId`, `studentId`, `studentName`, `schoolId`, `schoolName`
- `academicYear`, `billingPeriod`
- `lineItems[]` — embedded array, each with `feeStructureId`, `feeStructureVersion`, `description`, `amount`, `quantity`, `discount`, `taxRate`, `taxAmount`, `total`
- `subtotal`, `taxTotal`, `discountTotal`, `grandTotal`
- `amountPaid`, `amountDue`, `currency` (NPR)
- `dueDate`, `issuedDate`
- `status`: draft → issued → partially_paid → paid → overdue → cancelled → written_off
- GSI1 (school+status+dueDate), GSI2 (student+issuedDate), GSI3 (school+invoiceNumber)

**What's Correct:**
- Amount stored at creation time (snapshotted from fee structure, not derived)
- Currency stored at invoice level
- Status lifecycle with valid transitions enforced in code
- Links back to fee structures via `lineItems[].feeStructureId`
- Tenant + school isolation via partition keys
- Academic period linkage via `academicYear` field

**What's Missing or Wrong:**
1. **Invoice ≠ Fee Obligation** — This is a critical architectural observation. The MVP spec calls for "immutable ledger entries — one per matching fee structure." The current invoice is a **mutable billing document** with status transitions, amountPaid updates, and aggregated line items. There is no standalone "fee obligation" entity.
2. **No enrollment reference** — `lineItems` reference `feeStructureId` but the invoice itself has no `enrollmentId` or `enrollmentReferenceId` field linking it to the enrollment event that triggered it.
3. **Mutability** — Invoice `amountPaid`, `amountDue`, and `status` are updated in-place. The spec requires immutable obligation records. The LedgerEntryEntity provides immutability for the transaction log, but the obligation record itself is mutable.
4. **One invoice per enrollment, not one per fee** — The enrollment webhook creates ONE invoice with multiple line items, rather than one obligation record per fee structure. This conflation means you cannot independently waive/write-off a single fee without affecting the entire invoice.

**Assessment:** For MVP, using invoices as obligations is **acceptable** with caveats. The line items snapshot amounts correctly, and the ledger provides the immutable audit trail. However, this will need refactoring for per-fee-line-item lifecycle management in a later sprint.

### 3.3 PaymentEntity

**File:** `finance/src/common/entities/payment.entity.ts`

**Current Schema:**
- `paymentId`, `invoiceId`, `studentAccountId`, `schoolId`, `studentId`
- `amount`, `currency` (NPR)
- `gateway`: esewa | khalti | fonepay | connectips | stripe | cash | bank_transfer | cheque
- `gatewayTransactionId`, `gatewaySessionId`
- `status`: pending → processing → completed | failed | cancelled → refunded | partially_refunded
- `paidAt`, `paidBy`, `receiptNumber`
- `metadata{}`, `refunds[]` (embedded), `idempotencyKey`
- GSI1 (school+status+paidAt), GSI2 (student+createdAt)

**What's Correct:**
- References specific invoice via `invoiceId`
- Records payment method via `gateway` field (cash, bank_transfer, cheque for manual)
- Records staff ID via `paidBy`
- Amount and currency stored
- Idempotency support
- Receipt number auto-generated
- Optimistic locking via version field

**What's Missing or Wrong:**
1. **Single-invoice binding** — Payment references exactly ONE `invoiceId`. The MVP spec says "Record a payment against one or more obligations." Multi-invoice payment is not supported. This is a significant gap for schools that want to accept a lump-sum payment covering multiple invoices.
2. **No `paidDate` field distinct from `paidAt`** — For manual payments, the `paidDate` from the DTO is stored in `paidAt`, but there's no separate "date the payment was actually received" vs "date the payment was recorded in the system." The `RecordManualPaymentDto` does accept `paidDate` and stores it correctly in `paidAt`.

### 3.4 GatewayConfigEntity

**File:** `finance/src/common/entities/gateway-config.entity.ts`

**Current Schema:**
- `configId`, `schoolId`, `gateway` (enum), `isEnabled`, `isTestMode`
- `displayName`, `displayOrder`
- `credentials{}` (encrypted in DynamoDB, never exposed to frontend)

**Assessment:** This is **configuration storage only** — correct for MVP. However, the adapters (`esewa.adapter.ts`, `khalti.adapter.ts`) contain **live integration code** that must be flagged for MVP removal (see Section 5).

### 3.5 LedgerEntryEntity

**File:** `finance/src/common/entities/ledger-entry.entity.ts`

**Current Schema:**
- `entryId`, `studentAccountId`, `studentId`
- `entryType`: invoice | payment | refund | adjustment | write_off
- `referenceId`, `description`
- `debit`, `credit`, `balance` (running balance)
- `date`
- GSI2 (student+date+entryId)

**What's Correct:**
- Append-only (entries never updated)
- Running balance computed at creation time
- References source entity via `referenceId`
- Timestamp and actor tracked via `createdBy`/`createdAt`

**What's Missing:**
- No `schoolId` on the entity itself (scoped via `studentAccountId` which embeds schoolId, but not directly queryable by school)
- No GSI1 for school-level ledger queries (e.g., "all ledger entries for a school in a date range")

### 3.6 BillingAccountEntity

**Exists as a first-class entity.** One per student per school. Stores `balance`, `totalPaid`, `lastPaymentDate`. Created idempotently via `getOrCreate()` on enrollment. This is sound for MVP.

---

## Section 4: Enrollment-to-Obligation Flow

### What Happens Today

**Trigger:** When `EnrollmentService.create()` in the academics microservice creates an enrollment:

1. **Academics side** (`enrollment.service.ts:205-220`):
   - Creates enrollment entity in DynamoDB
   - Publishes `EnrollmentCompleted` event to EventBridge (fire-and-forget)
   - Sends synchronous HTTP POST to `{FINANCE_SERVICE_URL}/internal/webhooks/enrollment-completed` with: `tenantId`, `studentId`, `schoolId`, `academicYearId`, `gradeLevel`

2. **Finance side** — Two code paths exist (duplication):

   **Path A: `EnrollmentWebhookController.handleEnrollmentCompleted()`** (`enrollment-webhook.controller.ts:67-174`):
   - Validates payload via Zod schema
   - Resolves student name from Identity service
   - Creates/gets billing account (idempotent)
   - Queries `FeeStructuresService.getEnrollmentFees()` — filters by `autoApplyOnEnrollment=true` AND `gradeLevels` match
   - Generates draft invoice with all matching fees as line items
   - Due date: hardcoded `new Date() + 30 days`
   - Publishes `BillingAccountCreated` event

   **Path B: `EnrollmentBillingService.handleEnrollment()`** (`enrollment-billing.service.ts:44-123`):
   - Nearly identical logic but with additional duplicate detection (checks existing invoices to prevent re-billing)
   - This service exists but **the controller does NOT use it** — the controller has its own inline implementation

### Critical Gaps

1. **Controller does NOT delegate to `EnrollmentBillingService`** — The controller at `enrollment-webhook.controller.ts:67-174` reimplements the same logic that `EnrollmentBillingService.handleEnrollment()` does. The `EnrollmentBillingService` is injected into the module but the controller does its own inline version **without** the duplicate detection that the service provides. This means re-enrollment events could create duplicate invoices via the controller path.

2. **No enrollment reference stored** — The invoice has no field linking it to the enrollment event that triggered it. If the same student enrolls, withdraws, and re-enrolls, there's no way to correlate invoices to specific enrollment instances.

3. **Due date hardcoded** — `dueDate = now + 30 days` regardless of what the fee structure says. No fee structure-level due date rules exist.

4. **No EventBridge consumer on finance side** — Finance only listens via HTTP webhook. The EventBridge `EnrollmentCompleted` event is published but has no finance-side subscriber. If the HTTP webhook fails, there's no retry mechanism (EventBridge event goes unprocessed by finance).

5. **Draft status on auto-generated invoices** — Auto-generated invoices are created as `draft`, meaning they don't appear as "owed" until manually issued. The enrollment flow does NOT auto-issue. For pilot schools, this means an admin must manually issue every auto-generated invoice, which defeats the purpose of automation.

6. **Missing `enrollmentDate` propagation** — The enrollment webhook payload includes `enrollmentDate` only in the `EnrollmentBillingService` interface, but the controller's Zod schema (`enrollmentCompletedSchema`) does NOT include `enrollmentDate`. Pro-rating for mid-term entry cannot work without this field.

---

## Section 5: Code Flagged for MVP Removal

### 5.1 eSewa Payment Gateway Adapter
- **File:** `finance/src/payment-gateways/adapters/esewa.adapter.ts`
- **What it does:** Live eSewa ePay v2 integration — HMAC-SHA256 signature generation, HTML form auto-submit, transaction verification via eSewa API
- **Contains hardcoded test credentials:** Merchant ID `EPAYTEST`, Secret Key `8gBm/:&EnhH.1/q`
- **Why out of scope:** No payment gateway integration for MVP
- **Removal safety:** Safe — adapter is loaded by `GatewayAdapterRegistryService` but only invoked when `gateway` is `esewa`. Manual payments use `cash`/`bank_transfer`/`cheque` which bypass adapters entirely.

### 5.2 Khalti Payment Gateway Adapter
- **File:** `finance/src/payment-gateways/adapters/khalti.adapter.ts`
- **What it does:** Live Khalti ePay v2 integration — server-to-server REST, payment URL generation, pidx lookup
- **Contains hardcoded test credentials:** Phone 9806800001, password Nepal@123, MPIN 1122, OTP 123456
- **Why out of scope:** No payment gateway integration for MVP
- **Removal safety:** Safe — same pattern as eSewa.

### 5.3 Gateway Adapter Registry
- **File:** `finance/src/payment-gateways/adapters/gateway-adapter-registry.service.ts`
- **What it does:** Factory that registers and resolves gateway adapters
- **Removal safety:** Safe to gut — keep the class but remove adapter registrations. Used by `PaymentsService` but behind `hasAdapter()` guard.

### 5.4 Gateway Adapter Interface
- **File:** `finance/src/payment-gateways/adapters/gateway-adapter.interface.ts`
- **Removal safety:** Keep as-is (interface only, no runtime impact). Architecturally needed for future gateway integration.

### 5.5 Payment Initiation Endpoint
- **Endpoint:** `POST /finance/schools/{schoolId}/payments/initiate`
- **File:** `finance/src/payments/payments.controller.ts`
- **Method:** `PaymentsService.initiatePayment()` (`payments.service.ts:354-502`)
- **What it does:** Creates pending payment, calls gateway adapter, returns redirect URL
- **Why out of scope:** Gateway payments not in MVP
- **Removal safety:** Safe — endpoint is independent. Flag but do not delete; disable at API Gateway level.

### 5.6 Payment Verification Endpoint
- **Endpoint:** `GET /finance/payments/verify/{sessionId}`
- **File:** `finance/src/payments/payments.controller.ts`
- **Method:** `PaymentsService.verifyPayment()` (`payments.service.ts:508-612`)
- **What it does:** Verifies payment after gateway callback, marks completed or failed
- **Confirmed:** This IS eSewa/Khalti-specific — the session-based verification flow is a gateway pattern
- **Why out of scope:** Gateway payments not in MVP
- **Removal safety:** Safe — independent endpoint.

### 5.7 Payment Sweep Background Job
- **File:** `finance/src/common/services/payment-sweep.service.ts`
- **What it does:** Runs every 30 minutes, finds pending gateway payments older than 30 minutes, calls gateway adapter to check real status
- **Why out of scope:** Only relevant for gateway payments
- **Removal safety:** Safe — can be disabled via `DISABLE_PAYMENT_SWEEP=true` environment variable. Recommend disabling rather than removing code.

### 5.8 Payment Reconcile Endpoint
- **Endpoint:** `POST /finance/schools/{schoolId}/payments/{paymentId}/reconcile`
- **What it does:** Admin-triggered reconciliation — calls gateway adapter to check payment status
- **Why out of scope:** Only useful for gateway payments
- **Removal safety:** Safe — disable at API Gateway level.

### 5.9 Payment Gateway Management Endpoints
- **Endpoints:**
  - `GET /finance/schools/{schoolId}/payment-gateways` (list enabled)
  - `GET /finance/schools/{schoolId}/payment-gateways/admin` (list all with masked creds)
  - `PUT /finance/schools/{schoolId}/payment-gateways/{gateway}` (save config)
- **File:** `finance/src/payment-gateways/payment-gateways.controller.ts`
- **Why out of scope:** No gateway configuration needed for MVP
- **Removal safety:** Safe — disable at API Gateway level. Keep code for future use.

### 5.10 Discount Rules (Entire Module)
- **Endpoint:** `GET/POST/PATCH/DELETE /finance/schools/{schoolId}/discount-rules`
- **Files:** `finance/src/discount-rules/` (controller, service, module)
- **Entity:** `finance/src/common/entities/discount-rule.entity.ts`
- **Mapper:** `finance/src/common/mappers/discount-rule.mapper.ts`
- **Why out of scope:** Discount rules engine explicitly excluded from MVP
- **Removal safety:** Safe — self-contained module. The `InvoicesService.generate()` accepts a `discounts` parameter in the DTO but this is manually provided, not auto-applied from rules. Can remove the module without affecting invoice generation.

### 5.11 Credit Notes (Entire Module)
- **Endpoint:** `GET/POST/DELETE /finance/schools/{schoolId}/credit-notes`, `POST .../apply`
- **Files:** `finance/src/credit-notes/` (controller, service, module)
- **Entity:** `finance/src/common/entities/credit-note.entity.ts`
- **Mapper:** `finance/src/common/mappers/credit-note.mapper.ts`
- **Why out of scope:** Credit notes (scholarships, waivers) explicitly excluded from MVP
- **Removal safety:** Safe — self-contained module.

### 5.12 Refunds (Entire Module)
- **Endpoint:** `GET/POST /finance/schools/{schoolId}/refunds`, approve/reject/process/complete
- **Files:** `finance/src/refunds/` (controller, service, module)
- **Entity:** `finance/src/common/entities/refund-request.entity.ts`
- **Mapper:** `finance/src/common/mappers/refund-request.mapper.ts`
- **Why out of scope:** Refund workflow explicitly excluded from MVP
- **Removal safety:** **Partial dependency** — `PaymentsService.refund()` at `payments.service.ts:859-961` creates embedded `RefundData[]` on the payment entity. This inline refund on payments is separate from the `RefundsService` approval workflow. The refund module can be removed, but the inline refund in `PaymentsService` should also be disabled for MVP.

### 5.13 Pro-Rating Service
- **File:** `finance/src/common/services/pro-rate.service.ts`
- **What it does:** Calculates pro-rated fees for mid-term enrollment (quarterly/annual fees reduced by remaining days)
- **Why out of scope:** Pro-rationing logic explicitly excluded from MVP
- **Removal safety:** **Check dependency** — `EnrollmentBillingService` imports `ProRateService` but the controller path (`EnrollmentWebhookController`) does not use it. The `ProRateService` is injected into `EnrollmentBillingService` but I did not see it called in the `handleEnrollment()` method. Safe to keep but ensure it's not invoked.

### 5.14 Payment Void Endpoint
- **Endpoint:** `POST /finance/schools/{schoolId}/payments/{paymentId}/void`
- **File:** `payments.service.ts:788-857`
- **Assessment:** This is useful for MVP (correcting manual payment errors). **Keep** — this is within MVP scope for manual payment management.

---

## Section 6: DynamoDB Access Pattern Gaps

### Existing GSIs (Active)
| GSI | PK Pattern | SK Pattern | Supports |
|-----|-----------|------------|----------|
| GSI1 | `TENANT#{tid}#SCHOOL#{sid}` | `{EntityType}#{sort}` | School-scoped queries for all entity types |
| GSI2 | `TENANT#{tid}#STUDENT#{sid}` | `{EntityType}#{sort}` | Student-scoped queries |
| GSI3 | `TENANT#{tid}#SCHOOL#{sid}` | `INVNUM#{number}` | O(1) invoice number lookup |

### Gaps for MVP

1. **Query: All obligations by due date across a school (aging report)**
   - **Need:** `SELECT * FROM invoices WHERE schoolId=X AND dueDate < '2026-03-01' AND status IN ('issued','overdue','partially_paid') ORDER BY dueDate`
   - **Current:** GSI1SK is `INVOICE#{status}#{dueDate}` — this means you can query invoices BY STATUS efficiently (`begins_with(gsi1sk, 'INVOICE#overdue#')`) but you CANNOT query across ALL non-paid statuses sorted by dueDate. You'd need 3 separate queries (issued, overdue, partially_paid) and merge client-side.
   - **Impact:** Medium — aging report requires 3 queries per school. Acceptable for MVP with <50 schools.

2. **Query: Aggregate obligations by grade level**
   - **Need:** Dashboard breakdown by grade (e.g., "Grade 1: NPR 50,000 outstanding")
   - **Current:** No grade-level attribute on InvoiceEntity. Grade must be resolved from the fee structure or the student's enrollment — requires cross-service call.
   - **Impact:** High — cannot produce grade-level reports without either: (a) denormalizing `gradeLevel` onto the invoice, or (b) joining with academics data.

3. **Query: Aggregate obligations by fee type**
   - **Need:** Dashboard breakdown by fee type (e.g., "Tuition: NPR 200,000, Transport: NPR 50,000")
   - **Current:** Fee type is embedded in `lineItems[].description` and `lineItems[].feeStructureId` — not a top-level indexed attribute.
   - **Impact:** Medium — requires in-memory aggregation after fetching all invoices. Current dashboard already does this (fetches up to 10K invoices).

4. **Query: All obligations for a school sorted by student name**
   - **Need:** Admin view: list all students with outstanding fees, sorted alphabetically
   - **Current:** BillingAccountEntity has GSI1 sorted by student name. Can query `begins_with(gsi1sk, 'BILLING_ACCOUNT')`. Then need separate invoice queries per student.
   - **Impact:** Low — achievable with billing account listing + conditional invoice fetch.

5. **Query: Monthly collection trend**
   - **Need:** "NPR collected in Jan, Feb, Mar..." for trend charts
   - **Current:** Payments have GSI1SK `PAYMENT#{status}#{paidAt}` — can query completed payments in a date range with `begins_with(gsi1sk, 'PAYMENT#completed#2026-03')` for March 2026.
   - **Impact:** None — this access pattern IS supported by current GSI1.

6. **Commented-out GSIs (GSI7-GSI12)**
   - **File:** `server/lib/tenant-template/ecs-dynamodb.ts:95-171`
   - GSI7 (Student-Centric), GSI10 (Invoice Status) are commented out due to DynamoDB deployment limitation (one GSI change per update).
   - **Impact:** These are NOT available. The application-level code uses GSI1 and GSI2 which ARE deployed. The commented GSIs would have provided better access patterns but are not blocking.

---

## Section 7: Critical Bugs or Data Integrity Risks

### 7.1 CRITICAL: Enrollment Webhook Duplicate Invoice Risk
- **Location:** `enrollment-webhook.controller.ts:67-174`
- **Issue:** The controller implements its own inline billing logic WITHOUT duplicate detection. If the academics service retries the webhook (e.g., on network timeout), duplicate invoices will be created.
- **Root cause:** `EnrollmentBillingService` is **completely unwired dead code**. It is NOT registered in `enrollment-webhook.module.ts` providers (confirmed: lines 18-33 list only `InternalApiKeyGuard`, `DynamoDBClientService`, `FinanceEventsService`, `IdentityClientService`). The controller's constructor does NOT inject it. The service exists as a file but is never instantiated by NestJS.
- **Fix:** Wire `EnrollmentBillingService` into the module providers and refactor the controller to delegate to it (it already has duplicate detection). Alternatively, port the duplicate detection logic from the service into the controller directly.

### 7.2 HIGH: Auto-Generated Invoices Stuck in Draft
- **Location:** `invoices.service.ts:159` — `status: 'draft'` hardcoded in `createInvoiceEntity()`
- **Issue:** All invoices created via `generate()` start as `draft`, including auto-generated enrollment invoices. Drafts are NOT visible as "owed" and do NOT trigger overdue detection. An admin must manually issue each auto-generated invoice for it to become active.
- **Impact:** For 50 schools with potentially thousands of enrollments, requiring manual invoice issuance defeats automation.
- **Fix:** Auto-generated enrollment invoices should call `issue()` after generation, or add an `autoIssue` parameter to `generate()`.

### 7.3 HIGH: Payment-Invoice Update Not Atomic (Manual Path)
- **Location:** `payments.service.ts:114-127` (manual path)
- **Issue:** `recordManualPayment()` does: (1) putItem(payment), (2) invoicesService.applyPayment(), (3) studentAccountsService.recordLedgerEntry() as three separate operations. If step 2 or 3 fails, the payment is recorded but the invoice/ledger is inconsistent.
- **Mitigation:** The gateway path (`completePayment` at line 617) has try/catch with CRITICAL logging for partial failures. The manual path does NOT have this mitigation.
- **Note:** `recordLedgerEntry` itself uses TransactWriteItems internally (ledger entry + balance update is atomic). The non-atomicity is between the three top-level operations.
- **Fix:** Add the same try/catch with CRITICAL logging as the gateway path. Full transactional guarantee across payment+invoice+ledger is not feasible in DynamoDB (different entity keys), but error detection and logging is essential.

### 7.4 MEDIUM: Dashboard Memory Pressure
- **Location:** `dashboard.service.ts:88-91`
- **Issue:** `getSummary()` calls `fetchAllEntities()` which loads ALL invoices and ALL payments for a school into memory (up to 10K each). For schools with 500+ students and monthly invoicing, this could mean 6K+ invoices per year.
- **Impact:** Memory pressure on 512 MiB container. May cause OOM for large schools.
- **Fix:** For MVP, the 5-minute cache and 10K limit provide acceptable safeguards. Post-MVP, need server-side aggregation (DynamoDB Streams → aggregation table or use query-level filtering).

### 7.5 MEDIUM: Missing enrollmentDate in Webhook Schema
- **Location:** `enrollment-webhook.controller.ts:32-41`
- **Issue:** The `enrollmentCompletedSchema` Zod schema does not include `enrollmentDate`. This field is present in the `EnrollmentBillingService` interface but cannot be passed through the controller.
- **Impact:** Pro-rating cannot work (out of MVP scope anyway), but more importantly, due date calculation based on enrollment date is impossible.

### 7.6 LOW: Hardcoded NPR Currency
- **Location:** `invoice.entity.ts:61` — `currency: 'NPR'` (TypeScript literal type)
- **Issue:** Currency is hardcoded to NPR at the type level. While correct for Nepal pilot, this makes future multi-currency support a type-level refactor.
- **Assessment:** Acceptable for MVP. NPR is correct for Nepal.

### 7.7 MEDIUM: Overdue Detection Uses Cross-Tenant GSI Scan
- **Location:** `common/services/overdue-detection.service.ts:86-104`
- **Issue:** `detectOverdue()` uses `ScanCommand` on GSI1 with a `FilterExpression`. This is a **full GSI scan across ALL tenants** — not a query scoped to a single tenant. For 50 schools across multiple tenants, this means every invoice in the table is touched every 60 minutes. With optimistic locking and 50K item safety limit, it's safe, but RCU consumption will grow linearly with total invoice count.
- **Impact:** Acceptable for MVP scale but will not scale to 500+ schools.
- **Note:** Uses system DynamoDB client (IAM role, not tenant-scoped TVM). This is correct for background jobs but means the job sees all tenants' data.

### 7.8 MEDIUM: `EnrollmentBillingService` is Dead Code
- **Location:** `webhooks/enrollment-billing.service.ts`
- **Issue:** This 165-line service is never instantiated — it's not registered in any NestJS module. It contains better logic than the controller (duplicate detection, proper pro-rating integration) but is completely unused.
- **Impact:** Confusing for developers. Contains the correct implementation that should be wired in.
- **Fix:** Wire into `enrollment-webhook.module.ts` or consolidate its logic into the controller.

### 7.9 MEDIUM: Hardcoded Gateway Test Credentials in Source
- **Location:** `payment-gateways/adapters/esewa.adapter.ts` (merchant ID `EPAYTEST`, secret key `8gBm/:&EnhH.1/q`), `khalti.adapter.ts` (test phone, password, MPIN, OTP)
- **Issue:** Test credentials are hardcoded in source code. While these are publicly known test credentials (not production secrets), their presence in source is a security smell and could lead to confusion about which credentials are in use.
- **Fix:** Remove or obfuscate in MVP. These adapters are being disabled anyway.

### 7.10 LOW: `hasDuplicateInvoice()` Skips Detection When billingPeriod is Empty
- **Location:** `invoices.service.ts:744`
- **Issue:** `if (!billingPeriod) return false;` — when no billing period is specified, duplicate detection is skipped entirely. The enrollment webhook sets billingPeriod to `'Admission'` so this works for enrollment, but bulk generation with empty billingPeriod could create duplicates.
- **Impact:** Low for MVP — enrollment path always sets billingPeriod.

### 7.11 LOW: GSI1SK Status Encoding Makes Cross-Status Queries Expensive
- **Location:** All entities using `GSI1SK: {EntityType}#{status}#{date}`
- **Issue:** Encoding status in the sort key means querying "all invoices regardless of status" requires either: (a) dropping to `begins_with(gsi1sk, 'INVOICE')` which returns ALL invoices, or (b) multiple status-specific queries merged client-side.
- **Assessment:** This is a known DynamoDB single-table design trade-off. Acceptable for MVP scale.

---

## Section 8: Recommended Implementation Priority

Given the April 1st deadline (approximately 16 days), here is the prioritized work plan:

### P0 — Must Ship (Week 1: March 15-21)

**1. Fix enrollment webhook: wire EnrollmentBillingService + duplicate detection** (1 day)
- Register `EnrollmentBillingService` in `enrollment-webhook.module.ts` providers
- Refactor `EnrollmentWebhookController.handleEnrollmentCompleted()` to delegate to `EnrollmentBillingService.handleEnrollment()`
- This activates the duplicate detection that prevents re-billing on webhook retries
- Add `enrollmentDate` to the Zod schema

**2. Auto-issue enrollment invoices** (0.5 day)
- After `invoicesService.generate()`, immediately call `invoicesService.issue()` so the invoice is active and visible
- Or: modify `generate()` to accept an optional `autoIssue: true` parameter
- This is critical — without it, no enrollment invoice is ever "owed"

**3. Fix manual payment atomicity** (0.5 day)
- Add try/catch with CRITICAL logging to `recordManualPayment()` (matching the `completePayment()` gateway path pattern at line 667-715)
- This is the PRIMARY payment path for MVP — must be robust

**4. Disable out-of-scope features** (0.5 day)
- Set `DISABLE_PAYMENT_SWEEP=true` in environment
- Remove/comment out gateway adapter registrations in `GatewayAdapterRegistryService`
- Disable payment-gateways, discount-rules, credit-notes, refunds routes at API Gateway level (remove from `tenant-api-prod.json`)
- Disable initiate/verify payment endpoints at API Gateway level
- Remove or obfuscate hardcoded test credentials in eSewa/Khalti adapters

**5. Remove dead code** (0.5 day)
- If the controller is refactored to use `EnrollmentBillingService`, no extra work needed
- If not, delete `enrollment-billing.service.ts` to avoid confusion
- Ensure `ProRateService` is not invoked anywhere in the enrollment path

### P1 — Critical for Pilot (Week 2: March 22-28)

**6. Add due date rules to fee structure** (1.5 days)
- Add `dueDateRule: { type: 'days_after_enrollment' | 'fixed_day_of_month' | 'on_enrollment', days?: number, dayOfMonth?: number }` to `FeeStructureEntity`
- Implement due date calculation in enrollment billing based on fee structure rules instead of hardcoded +30 days
- Update `CreateFeeStructureDto` and `UpdateFeeStructureDto`
- Note: hardcoded +30 days is functional for launch — this can slip to P2 if needed

**7. Add enrollment type applicability to fee structure** (1 day)
- Add `enrollmentTypes?: string[]` to `FeeStructureEntity` (empty = all types)
- Filter in `getEnrollmentFees()` by enrollment type from the webhook payload
- Update enrollment webhook to pass enrollment type

**8. Enhance dashboard reporting** (2 days)
- Add grade-level breakdown: denormalize `gradeLevel` onto InvoiceEntity at creation time
- Add fee-type breakdown: aggregate from `lineItems[].feeStructureId` → fee type mapping
- Add aging report: bucket overdue invoices by 0-30, 31-60, 61-90, 90+ days
- Add monthly collection summary: query payments by month

**9. Add obligation-level audit trail** (1 day)
- Store status change history on InvoiceEntity: `statusHistory: Array<{ from: string, to: string, changedAt: string, changedBy: string }>`
- Populate on every status transition in `InvoicesService.update()`

### P2 — Nice to Have (Week 3: March 29 - April 1)

**10. Multi-invoice payment support** (2 days)
- Accept array of `invoiceIds` in `RecordManualPaymentDto`
- Split payment amount across invoices (oldest-first or user-specified allocation)
- Record ledger entries for each invoice

**11. Smoke tests for pilot workflows** (1 day)
- End-to-end test: create school → create fee structures → enroll student → verify auto-invoice → record manual payment → verify ledger
- Data integrity validation: balance consistency checks

**12. Seed data for pilot schools** (0.5 day)
- Script to create standard Nepal fee structures (admission, tuition, exam fees) for pilot schools
- Configure academic year and grade levels

---

## Appendix A: File Reference Index

| Module | Key Files |
|--------|-----------|
| Entities | `common/entities/fee-structure.entity.ts`, `invoice.entity.ts`, `payment.entity.ts`, `ledger-entry.entity.ts`, `billing-account.entity.ts`, `gateway-config.entity.ts`, `credit-note.entity.ts`, `discount-rule.entity.ts`, `refund-request.entity.ts` |
| Core Services | `fee-structures/fee-structures.service.ts`, `invoices/invoices.service.ts`, `payments/payments.service.ts`, `student-accounts/student-accounts.service.ts` |
| Enrollment | `webhooks/enrollment-webhook.controller.ts`, `webhooks/enrollment-billing.service.ts` |
| Infrastructure | `common/services/dynamodb-client.service.ts`, `common/services/finance-events.service.ts`, `common/services/sequence.service.ts` |
| Out of Scope | `payment-gateways/adapters/esewa.adapter.ts`, `khalti.adapter.ts`, `discount-rules/*`, `credit-notes/*`, `refunds/*`, `common/services/pro-rate.service.ts`, `common/services/payment-sweep.service.ts` |
| Dashboard | `dashboard/dashboard.service.ts`, `dashboard/dashboard.controller.ts` |
| CDK/Infra | `server/lib/tenant-template/ecs-dynamodb.ts`, `server/lib/tenant-api-prod.json`, `server/lib/service-info.json` |

## Appendix B: API Endpoint Classification

### Keep for MVP
- `POST/GET/PATCH/DELETE /finance/schools/{schoolId}/fee-structures` (all)
- `POST/GET /finance/schools/{schoolId}/invoices` (generate, list)
- `POST /finance/schools/{schoolId}/invoices/bulk-generate`
- `POST /finance/schools/{schoolId}/invoices/bulk-issue`
- `GET /finance/schools/{schoolId}/invoices/export`
- `GET/PATCH /finance/schools/{schoolId}/invoices/{id}`
- `POST /finance/schools/{schoolId}/invoices/{id}/issue`
- `GET /finance/schools/{schoolId}/invoices/{invoiceId}/payments`
- `POST /finance/schools/{schoolId}/payments/manual`
- `GET /finance/schools/{schoolId}/payments`
- `GET /finance/schools/{schoolId}/payments/export`
- `GET /finance/payments/{paymentId}`
- `GET /finance/payments/{paymentId}/receipt`
- `POST /finance/schools/{schoolId}/payments/{paymentId}/void`
- `GET /finance/schools/{schoolId}/student-accounts` (all)
- `GET /finance/schools/{schoolId}/dashboard/summary`
- `POST /internal/webhooks/enrollment-completed`
- `POST /internal/webhooks/student-withdrawn`

### Disable for MVP (Remove from API Gateway)
- `POST /finance/schools/{schoolId}/payments/initiate`
- `GET /finance/payments/verify/{sessionId}`
- `POST /finance/schools/{schoolId}/payments/{paymentId}/refund`
- `POST /finance/schools/{schoolId}/payments/{paymentId}/reconcile`
- `GET/POST /finance/schools/{schoolId}/payment-gateways` (all)
- `GET/POST/PATCH/DELETE /finance/schools/{schoolId}/discount-rules` (all)
- `GET/POST/DELETE /finance/schools/{schoolId}/credit-notes` (all)
- `GET/POST /finance/schools/{schoolId}/refunds` (all)
