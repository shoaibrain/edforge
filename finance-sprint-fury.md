# Finance Sprint Fury — End-to-End Payment & Billing MVP

> **Context:** The Finance module backbone exists — fee structures, gateway config, invoice/payment entities, gateway adapters (eSewa/Khalti). But the feature is **not end-to-end**. Parents get 403 Forbidden on the fee payment page (missing `billing:view` permission). There is no admin UI for invoice management, no enrollment-to-billing integration, no bulk billing, and no financial dashboard. This plan delivers a **production-ready, enterprise-grade** Finance module from the current state to a fully operational MVP.
>
> **Repos:** Backend `edforge` (branch: `payments`), Frontend `edforge-saas-frontend` (branch: `payments`)
>
> **Architecture:** NestJS microservices, DynamoDB single-table, AWS Cognito auth, eSewa/Khalti gateways, React + TanStack Router/Query frontend.
>
> **Review notes:** This plan incorporates feedback from a staff-engineer architectural review covering security gaps, sprint ordering, missing plumbing tickets, performance concerns, and testing requirements.

---

## Sprint 1 — Parent Access & Student-Scoped Billing

**Goal:** Parents can log in, navigate to Fee Payments, see their child's invoices (or empty state), and see available payment gateways. The 403 Forbidden blocker is eliminated. All billing data is properly scoped — parents only see their own children's data. Entity-level ownership enforcement prevents horizontal access (parent A cannot read parent B's invoices).

**Critical path:** This sprint unblocks ALL subsequent parent-facing work.

---

### Ticket 1.1 — Add billing permissions to Parent, Student, Principal, VicePrincipal roles

**File:** `server/application/microservices/identity/src/common/entities/role-assignment.entity.ts`

**Problem:** The `DEFAULT_ROLE_PERMISSIONS.Parent` array does not include `billing:view` or `billing:create`. The `PermissionGuard` checks `billing:view` on invoice/gateway list endpoints, causing 403 for all parent users. Additionally, `Principal` and `VicePrincipal` lack `billing:*`.

**Changes:**

| Role | Permissions to Add | Rationale |
|------|-------------------|-----------|
| `Parent` | `billing:view`, `billing:create` | View invoices/receipts, initiate gateway payments |
| `Student` | `billing:view` | Student portal (future) can view own invoices |
| `Principal` | `billing:*` | Full billing oversight |
| `VicePrincipal` | `billing:*` | Full billing oversight |
| `Staff` | `billing:view` | Office staff look up fee records |

Also verify that `Accountant` has `billing:*` (it currently does — just confirm after changes).

**Validation:**
- Deploy identity service, log in as parent → `/finance/schools/{schoolId}/invoices` returns 200.
- Log in as student → same endpoint returns 200.
- Log in as teacher (no billing permissions) → returns 403.
- Log in as principal → full billing access.

---

### Ticket 1.2 — Add student-scoped invoice filtering for parent role

**File:** `server/application/microservices/finance/src/invoices/invoices.controller.ts`

**Problem:** `GET /finance/schools/:schoolId/invoices` returns ALL school invoices. Parents should only see invoices for their linked students. Currently no server-side enforcement.

**Changes:**
1. In the `list()` controller method, detect the caller's school-level role (not just `globalRole`):
   ```typescript
   // Get user's school-level role for scoping
   const userRole = await this.identityClient.getUserSchoolRole(
     tenant.userId, schoolId, context
   );
   // If non-admin role, auto-scope to caller's linked students
   if (userRole === 'Parent' || userRole === 'Student') {
     const studentIds = await this.identityClient.getLinkedStudentIds(
       tenant.userId, schoolId, context
     );
     if (studentIds.length === 0) return { items: [], hasMore: false };
     if (!studentId) {
       options.studentIds = studentIds;
     } else if (!studentIds.includes(studentId)) {
       throw new ForbiddenException('Access denied to this student');
     }
   }
   ```
2. Update `InvoicesService.list()` to accept `studentIds?: string[]` filter and query GSI2 for each student, merging results.

**Validation:**
- Parent with one child → sees only that child's invoices.
- Parent with two children → sees both children's invoices.
- Parent cannot pass arbitrary `studentId` query param to access other students.

---

### Ticket 1.2b — Add student-ownership enforcement on all single-entity GET endpoints (SECURITY)

**Files:**
- `server/application/microservices/finance/src/invoices/invoices.controller.ts` (GET /:id)
- `server/application/microservices/finance/src/payments/payments.controller.ts` (GET /:id, GET /:id/receipt)
- `server/application/microservices/finance/src/student-accounts/student-accounts.controller.ts` (GET /:id, GET /:id/ledger)

**Problem:** Ticket 1.2 scopes list endpoints, but single-entity GET endpoints (e.g., `GET /invoices/:invoiceId`) have no student-ownership check. A parent who guesses an invoiceId can read any family's financial data, including student name, fee amounts, and payment history.

**Changes:**
1. Create a reusable helper `enforceStudentOwnership()`:
   ```typescript
   async enforceStudentOwnership(
     entity: { studentId?: string; studentAccountId?: string },
     userId: string, schoolId: string, context: RequestContext
   ): Promise<void> {
     const role = await this.identityClient.getUserSchoolRole(userId, schoolId, context);
     if (role === 'TenantAdmin' || role === 'Principal' || role === 'Accountant') return;
     if (role === 'Parent' || role === 'Student') {
       const linkedStudentIds = await this.identityClient.getLinkedStudentIds(
         userId, schoolId, context
       );
       const entityStudentId = entity.studentId || entity.studentAccountId;
       if (!linkedStudentIds.includes(entityStudentId)) {
         throw new ForbiddenException('Access denied to this resource');
       }
     }
   }
   ```
2. Call `enforceStudentOwnership()` in every single-entity GET handler after fetching the entity.
3. Apply to: invoices (get), payments (get, receipt), student-accounts (get, ledger).

**Validation:**
- Parent A fetches their own child's invoice → 200.
- Parent A fetches Parent B's child's invoice → 403.
- Admin fetches any invoice → 200.

---

### Ticket 1.3 — Add `getLinkedStudentIds` endpoint in identity service

**Files:**
- Create `server/application/microservices/identity/src/users/users.controller.ts` (new endpoint)
- Update `server/application/microservices/identity/src/users/users.service.ts`

**Problem:** Finance service needs to know which students are linked to a parent user for data scoping. This information is in the identity/academics service but no API exists to query it from finance.

**Changes:**
1. Add endpoint to identity service:
   ```typescript
   @Get(':userId/linked-students')
   @UseGuards(JwtAuthGuard)
   async getLinkedStudents(
     @Param('userId') userId: string,
     @Query('schoolId') schoolId: string,
     @TenantCredentials() tenant,
   ): Promise<{ studentIds: string[] }> {
     return this.usersService.getLinkedStudentIds(userId, schoolId, context);
   }
   ```
2. Implement `UsersService.getLinkedStudentIds()`:
   - Query `ParentStudentLink` entities (or `StudentSchoolAssociation` with parent reference) from DynamoDB.
   - Return array of `studentId` values.
3. Add corresponding route to `tenant-api-prod.json` (API Gateway).

**Validation:**
- Parent user → returns their linked student IDs.
- Admin user → returns empty (admin uses full school scope).
- Non-existent user → returns empty array.

---

### Ticket 1.3b — Add `getLinkedStudentIds` client in finance service

**File:** `server/application/microservices/finance/src/common/services/identity-client.service.ts`

**Changes:**
1. Add method to IdentityClientService:
   ```typescript
   async getLinkedStudentIds(
     userId: string, schoolId: string, context: RequestContext
   ): Promise<string[]> {
     const response = await this.httpClient.get<{ studentIds: string[] }>(
       `${this.identityServiceUrl}/users/${userId}/linked-students`,
       { schoolId },
       { tenantId: context.tenantId, userId: context.userId, jwtToken: context.jwtToken, userRole: context.role },
     );
     return response.data?.studentIds ?? [];
   }
   ```
2. Cache result for 5 minutes with cache key `${context.tenantId}:${userId}:${schoolId}` (includes tenantId to prevent cross-tenant leakage).

**Validation:**
- Cache hit within TTL → no HTTP call made.
- Different tenant same userId → separate cache entries.

---

### Ticket 1.4 — Block parents from recordManualPayment (SECURITY)

**File:** `server/application/microservices/finance/src/payments/payments.controller.ts`

**Problem:** `POST /finance/schools/:schoolId/payments/manual` requires only `billing:create`. After Ticket 1.1, parents will have this permission. A parent could falsely record a manual cash payment for their own invoice, marking it as paid without actually paying.

**Changes:**
1. Add role-based guard in `recordManualPayment()`:
   ```typescript
   @Post('manual')
   @RequirePermission({ resource: 'billing', action: 'create' })
   async recordManualPayment(@Body() dto, @TenantCredentials() tenant, @Req() req) {
     const context = buildRequestContext(tenant, req);
     const role = await this.identityClient.getUserSchoolRole(
       tenant.userId, context.schoolId, context
     );
     if (role === 'Parent' || role === 'Student') {
       throw new ForbiddenException('Manual payment recording requires admin access');
     }
     // ... existing logic
   }
   ```

**Validation:**
- Admin records manual cash payment → 200 success.
- Parent calls same endpoint → 403.

---

### Ticket 1.5 — Add student-ownership check to payment initiation (SECURITY)

**File:** `server/application/microservices/finance/src/payments/payments.service.ts`

**Problem:** `POST /payments/initiate` requires `billing:create`. A parent could initiate a payment against any invoice in the school, not just their own children's invoices.

**Changes:**
1. In `initiatePayment()`, after fetching the invoice, verify student ownership:
   ```typescript
   // Verify parent owns the student on this invoice
   await this.enforceStudentOwnership(
     { studentAccountId: invoice.studentAccountId },
     context.userId, schoolId, context
   );
   ```

**Validation:**
- Parent initiates payment for their child's invoice → proceeds.
- Parent initiates payment for another child's invoice → 403.

---

### Ticket 1.6 — Update FeePaymentPage to filter by active child + handle 403

**File:** `edforge-saas-frontend/apps/shell/src/pages/parent-portal/FeePaymentPage.tsx`

**Problem:** The page calls `useInvoices(schoolId)` without a student filter. The frontend should explicitly pass the `studentId` for the active child. Additionally, 403 errors should show a friendly message instead of a crash.

**Changes:**
1. Import `useParentPortal` context to get `activeChild.studentId`.
2. Pass `studentId` filter to `useInvoices`:
   ```typescript
   const { activeChild } = useParentPortal()
   const { data: invoiceData } = useInvoices(schoolId, {
     studentId: activeChild?.studentId,
     status: 'issued', // Only show payable invoices to parents
   })
   ```
3. Support `studentIds` (plural) for parents with multiple children when no specific child selected.
4. Show empty state "No pending fees for {childName}" when no invoices.
5. Handle 403 in TanStack Query hooks:
   ```typescript
   retry: (failureCount, error) => {
     if (error?.response?.status === 403) return false;
     return failureCount < 2;
   },
   ```
6. Show "You don't have permission to view billing information" for 403, not a crash.

**Validation:**
- Parent with child → sees only issued/partially_paid invoices for that child.
- No invoices → shows friendly empty state.
- Teacher navigates to fees → sees permission denied message.

---

### Ticket 1.7 — API Gateway route: linked-students endpoint

**File:** `server/lib/tenant-api-prod.json`

**Changes:**
1. Add route for `GET /users/{userId}/linked-students`:
   ```json
   "/users/{userId}/linked-students": {
     "get": {
       "x-amazon-apigateway-integration": {
         "uri": "http://identity-api.basic.sc:3010/users/{userId}/linked-students",
         "type": "http_proxy",
         "httpMethod": "GET"
       }
     }
   }
   ```

**Validation:**
- API Gateway routes requests to identity service.

---

### Ticket 1.8 — Unit tests for student-scoping logic

**Files:**
- `server/application/microservices/finance/src/invoices/invoices.service.spec.ts`
- `server/application/microservices/identity/src/users/users.service.spec.ts`

**Changes:**
1. Test `InvoicesService.list()` with `studentIds` filter:
   - Single student → returns only that student's invoices.
   - Multiple students → merges results.
   - Empty studentIds → returns empty.
2. Test `UsersService.getLinkedStudentIds()`:
   - Parent with linked students → returns correct IDs.
   - User with no links → returns empty array.
3. Test `enforceStudentOwnership()`:
   - Linked student → passes.
   - Unlinked student → throws ForbiddenException.
   - Admin → always passes.

**Validation:**
- All unit tests pass with `jest --coverage`.

---

**Sprint 1 Demo:** Log in as parent → Fee Payments loads without 403 → shows empty state "No pending fees" (since no invoices generated yet) → gateway list shows configured gateways. Log in as teacher → permission denied message. Verify Parent A cannot access Parent B's data via direct API call.

---

## Sprint 2 — Admin Invoice Management ‖ Sprint 3 — Enrollment-to-Billing Integration

> **Parallelizable:** Sprints 2 (pure frontend) and 3 (pure backend) share no file dependencies. Frontend developers can work Sprint 2 while backend developers work Sprint 3 concurrently.

---

## Sprint 2 — Admin Invoice Management

**Goal:** School administrators can generate invoices for individual students, view/filter invoices, issue them (draft → issued), and cancel them. This is the admin-side prerequisite before parents can pay anything.

---

### Ticket 2.0 — Add invoice hooks and service layer to frontend

**Files:** Create/update `edforge-saas-frontend/apps/shell/src/hooks/usePayments.ts`, `edforge-saas-frontend/apps/shell/src/services/invoices.service.ts`

> **Note:** This ticket is implemented FIRST because Tickets 2.1 and 2.2 depend on these hooks.

**Changes:**
1. Add `useIssueInvoice` mutation:
   ```typescript
   export function useIssueInvoice(schoolId: string) {
     const queryClient = useQueryClient()
     return useMutation({
       mutationFn: (invoiceId: string) => issueInvoice(schoolId, invoiceId),
       onSuccess: () => {
         queryClient.invalidateQueries({ queryKey: paymentKeys.invoices(schoolId) })
       },
     })
   }
   ```
2. Add `useCancelInvoice` mutation.
3. Add `useGenerateInvoice` mutation.
4. Add `issueInvoice()`, `cancelInvoice()`, `generateInvoice()` to `invoices.service.ts`.
5. Add `useStudentSearch` hook for student selector in invoice generation form.

**Validation:**
- TypeScript compiles with no errors.
- Mutations correctly invalidate invoice list queries.

---

### Ticket 2.1 — Create admin invoice list + generation page

**Files:** Create `edforge-saas-frontend/apps/shell/src/pages/settings/invoices.tsx` and route

**Changes:**
1. Create invoice list page at `/settings/invoices`:
   - Table: Invoice #, Student, Amount, Due Date, Status, Created, Actions
   - Filters: Status dropdown, Student search, Academic Year
   - Pagination with cursor-based loading
   - Action buttons: View, Issue (for drafts), Cancel
2. "Generate Invoice" button opens modal/form:
   - Student selector (search by name — resolves student to `studentAccountId` via backend `getOrCreate`)
   - Fee structure multi-select (checkboxes with amounts)
   - Per-fee discount inputs (amount + reason)
   - Academic year selector
   - Billing period input
   - Due date picker
   - Notes textarea
   - Auto-calculated totals preview (subtotal, discounts, tax, grand total)
3. Submit calls `POST /finance/schools/{schoolId}/invoices`.
4. Add route to `router.tsx` under settings section.

> **Backend note:** Update `generateInvoiceSchema` to accept either `studentAccountId` OR `studentId`. Backend resolves `studentId` → account via `getOrCreate`. This is more UX-friendly than requiring the frontend to know account IDs.

**Validation:**
- Admin navigates to `/settings/invoices` → sees empty invoice list.
- Clicks "Generate Invoice" → form appears with student selector and fee structures.
- Fills form → submits → invoice appears in list with `draft` status.

---

### Ticket 2.2 — Create invoice detail page

**Files:** Create `edforge-saas-frontend/apps/shell/src/pages/settings/invoice-detail.tsx`

**Changes:**
1. Route: `/settings/invoices/:invoiceId`
2. Displays full invoice data:
   - Header: Invoice #, Status badge, Dates (issued, due)
   - Student info: Name, Student ID, School
   - Line items table: Description, Amount, Qty, Discount, Tax, Total
   - Totals section: Subtotal, Discount, Tax, Grand Total
   - Payment summary: Amount Paid, Amount Due
   - Action buttons based on status:
     - Draft: "Issue Invoice", "Cancel"
     - Issued: "Record Payment", "Cancel"
     - Partially Paid: "Record Payment"
3. Issue action calls `POST /invoices/{id}/issue` → status badge updates to "Issued".
4. Cancel action calls `PATCH /invoices/{id}` with `{ status: 'cancelled' }` → confirms with modal.

**Validation:**
- Click invoice in list → navigates to detail page with all data.
- Issue draft → status changes to "issued", ledger entry created.
- Cancel → status changes to "cancelled".

---

### Ticket 2.3 — Add settings sidebar navigation for billing

**File:** `edforge-saas-frontend/apps/shell/src/pages/settings/` (sidebar component)

**Changes:**
1. Add "Invoices" link to settings sidebar under PAYMENTS section (below Fee Structures and Payment Gateways).
2. Add "Student Accounts" link for future Sprint 5 work.
3. Only show billing links for users with `billing:view` permission.

**Validation:**
- Admin → sees Invoices link in settings sidebar.
- Teacher → does not see billing links.
- Click Invoices → navigates to invoice list page.

---

**Sprint 2 Demo:** Admin logs in → Settings → Invoices (empty list) → Generate Invoice → selects student "Ram Sharma", selects "Admission Fee" (NPR 35,000) and "First Term Exam Fee" (NPR 1,500) → sets due date → submits → invoice #INV-0001 appears as Draft → clicks "Issue" → status becomes Issued → the invoice is now visible in parent portal. Show the parent portal seeing the issued invoice.

---

## Sprint 3 — Enrollment-to-Billing Integration

**Goal:** When a student enrolls (StudentSchoolAssociation is created), a billing account is auto-created and an admission invoice is auto-generated as a draft. Admins can review and issue. Withdrawal cancels pending invoices.

> **Runs in parallel with Sprint 2.** No shared file dependencies.

---

### Ticket 3.0 — Update @aibrains/shared-types with finance schema changes

**File:** `packages/shared-types/src/schemas/finance/fee-structure.schema.ts`, `packages/shared-types/src/schemas/finance/invoice.schema.ts`

**Problem:** Sprint 3 introduces `autoApplyOnEnrollment` on fee structures and changes the bulk generation schema. These must be in shared-types before backend work begins.

**Changes:**
1. Add `autoApplyOnEnrollment: z.boolean().optional().default(false)` to `createFeeStructureSchema` and `feeStructureResponseSchema`.
2. Update `bulkGenerateInvoiceSchema`:
   - Replace `studentAccountIds` with `targetType: z.enum(['grade_level', 'section', 'student_list'])` and `targetIds: z.array(z.string())`.
3. Add `enrollmentCompletedEventSchema`:
   ```typescript
   export const enrollmentCompletedEventSchema = z.object({
     tenantId: z.string(),
     studentId: z.string(),
     schoolId: z.string(),
     academicYearId: z.string(),
     gradeLevel: z.string(),
     studentName: z.string(),
   });
   ```
4. Add `dashboardSummarySchema` for Sprint 7 (pre-create).
5. Bump version, publish to npm.

**Validation:**
- `npm run typecheck` passes.
- `npm run build` succeeds.
- `npm publish` publishes new version.

---

### Ticket 3.1 — Create enrollment billing webhook endpoint with auth

**Files:**
- Create `server/application/microservices/finance/src/webhooks/enrollment-webhook.controller.ts`
- Create `server/application/microservices/finance/src/webhooks/enrollment-webhook.module.ts`

**Problem:** Finance service doesn't listen for enrollment events. The academics service publishes `EnrollmentCompleted` events, but nothing consumes them for billing.

**Changes:**
1. Create an internal webhook endpoint with service-to-service authentication:
   ```typescript
   @Controller('internal/webhooks')
   export class EnrollmentWebhookController {
     @Post('enrollment-completed')
     @UseGuards(InternalApiKeyGuard) // Validates x-internal-api-key header
     async handleEnrollmentCompleted(
       @Body() event: EnrollmentCompletedDtoZ // Zod-validated DTO
     ) {
       // 1. Create billing account (idempotent getOrCreate)
       // 2. Look up school's admission fee structures
       // 3. Auto-generate draft invoice if admission fees exist
     }
   }
   ```
2. Create `InternalApiKeyGuard` that validates shared secret from env `INTERNAL_API_KEY`.
3. Validate event payload with Zod `enrollmentCompletedEventSchema`.
4. Idempotency: Check if billing account already exists for this student+school before creating.
5. Create `EnrollmentWebhookModule` importing `InvoicesModule`, `StudentAccountsModule`, `FeeStructuresModule`.
6. Add `EnrollmentWebhookModule` to `FinanceModule.imports`.

**Validation:**
- POST with valid event + correct API key → billing account created + invoice generated.
- POST without API key → 401.
- Duplicate POST → no-op (idempotent).
- Missing required fields → 400 (Zod validation).

---

### Ticket 3.2 — Wire academics enrollment to finance webhook

**File:** `server/application/microservices/academics/src/enrollment/enrollment.service.ts`

**Changes:**
1. After publishing `EnrollmentCompleted` event, also call the finance webhook:
   ```typescript
   // Fire-and-forget call to finance service for billing setup
   this.httpClient.post(
     `${this.financeServiceUrl}/internal/webhooks/enrollment-completed`,
     { tenantId, studentId, schoolId, academicYearId, gradeLevel, studentName },
     { tenantId, userId, jwtToken, userRole },
     { headers: { 'x-internal-api-key': this.internalApiKey } }
   ).catch(err => this.logger.error(`Finance webhook failed: ${err.message}`));
   ```
2. Add `FINANCE_SERVICE_URL` and `INTERNAL_API_KEY` to academics service config.

> **Note:** This creates bidirectional HTTP between academics and finance (finance already calls identity). Acceptable for MVP but logged as tech debt.

**Validation:**
- Create enrollment via API → finance webhook called → billing account + invoice created.
- Finance service down → enrollment still succeeds (fire-and-forget).

---

### Ticket 3.3 — Create admission fee template configuration

**File:** `server/application/microservices/finance/src/fee-structures/fee-structures.service.ts`

**Problem:** When auto-generating an admission invoice on enrollment, the system needs to know which fee structures to include. Schools should be able to configure which fees auto-apply on enrollment.

**Changes:**
1. Add `autoApplyOnEnrollment: boolean` field to `FeeStructureEntity`:
   ```typescript
   autoApplyOnEnrollment?: boolean; // true = include in auto-generated enrollment invoices
   ```
2. Add the field to `CreateFeeStructureDto` and `UpdateFeeStructureDto` (from updated shared-types).
3. Add `getEnrollmentFees(schoolId, gradeLevel, context)` method:
   - Queries ALL fee structures for school via GSI1 `begins_with(GSI1SK, 'FEE_STRUCTURE')`.
   - Filters client-side for `autoApplyOnEnrollment = true` and grade level applicability.
   - Returns matching fee structures.
   - **Scale ceiling:** <100 fee structures per school; client-side filter is fine.
4. Frontend: Add "Auto-apply on Enrollment" toggle in fee structure form.

**Validation:**
- Mark "Admission Fee" as auto-apply → set to true in DynamoDB.
- `getEnrollmentFees()` returns only admission-tagged fees.
- Grade-level filtering works (e.g., lab fee only for Grade 9+).

---

### Ticket 3.4 — Auto-generate admission invoice in enrollment webhook

**File:** `server/application/microservices/finance/src/webhooks/enrollment-webhook.controller.ts`

**Changes:**
1. In the enrollment webhook handler, after creating the billing account:
   ```typescript
   const admissionFees = await this.feeStructuresService.getEnrollmentFees(
     event.schoolId, event.gradeLevel, context
   );

   if (admissionFees.length > 0) {
     const dueDate = new Date();
     dueDate.setDate(dueDate.getDate() + 30); // 30 days from now

     const invoice = await this.invoicesService.generate(event.schoolId, {
       feeStructureIds: admissionFees.map(f => f.feeStructureId),
       studentAccountId: account.accountId,
       academicYear: event.academicYearId,
       billingPeriod: 'Admission',
       dueDate: dueDate.toISOString(),
       notes: 'Auto-generated on enrollment',
     }, context);

     this.logger.log({
       action: 'invoice.auto_generated',
       studentId: event.studentId,
       invoiceId: invoice.id,
       feeCount: admissionFees.length,
       grandTotal: invoice.grandTotal,
     });
   }
   ```
2. Invoice stays in `draft` status — admin must review and issue.

**Validation:**
- Student enrolls → 2 admission fees configured → draft invoice with 2 line items created.
- No admission fees configured → billing account created, no invoice.
- Invoice has correct fee amounts, tax, totals.

---

### Ticket 3.5 — Handle enrollment withdrawal — cancel pending invoices

**File:** `server/application/microservices/finance/src/webhooks/enrollment-webhook.controller.ts`

**Changes:**
1. Add `POST /internal/webhooks/student-withdrawn` endpoint (with `InternalApiKeyGuard`).
2. On withdrawal:
   - Find all `draft` invoices for this student at this school.
   - Cancel them with reason "Student withdrawn from school".
   - Do NOT cancel `issued` or `partially_paid` invoices (those need admin review).
   - Log a warning for any issued/partially_paid invoices.
3. Wire academics `withdrawStudent()` to call this webhook (same fire-and-forget pattern).

**Validation:**
- Student with draft invoice → withdrawal → invoice cancelled.
- Student with issued invoice → withdrawal → invoice stays issued, warning logged.
- Student with no invoices → withdrawal → no-op.

---

### Ticket 3.6 — Admin notification for auto-generated invoices

**File:** `server/application/microservices/finance/src/webhooks/enrollment-webhook.controller.ts`

**Changes:**
1. After auto-generating a draft invoice, publish a `BillingAccountCreated` event:
   ```typescript
   this.eventsService.publishBillingAccountCreated(
     tenantId, schoolId, studentId, account.accountId, invoiceId
   );
   ```
2. Add `publishBillingAccountCreated` to `FinanceEventsService`.
3. Structured logs for CloudWatch alerting (future: email/push notifications post-MVP).

**Validation:**
- Event published with correct payload.
- CloudWatch log shows `action: 'billing_account.created'`.

---

### Ticket 3.7 — Unit tests for enrollment webhook

**Files:**
- `server/application/microservices/finance/src/webhooks/enrollment-webhook.controller.spec.ts`

**Changes:**
1. Test enrollment completed → billing account + invoice created.
2. Test duplicate enrollment → idempotent (no duplicate account or invoice).
3. Test missing fields → 400 validation error.
4. Test no admission fees configured → account created, no invoice.
5. Test withdrawal → draft invoices cancelled, issued invoices untouched.
6. Test InternalApiKeyGuard → missing key returns 401.

**Validation:**
- All tests pass.

---

### Ticket 3.8 — Deployment config: new environment variables

**Files:**
- ECS task definitions / deployment configs

**Changes:**
1. Add to academics service env: `FINANCE_SERVICE_URL`, `INTERNAL_API_KEY`.
2. Add to finance service env: `INTERNAL_API_KEY` (same shared secret).
3. Verify service discovery entries so academics can reach finance.

**Validation:**
- Environment variables set in staging/production configs.

---

**Sprint 3 Demo:** Admin configures "Admission Fee" (NPR 35,000) with "Auto-apply on Enrollment" toggle ON. Admin enrolls new student "Sita Gurung" in Grade 5. Show CloudWatch logs: billing account created, draft invoice auto-generated. Admin navigates to Invoices → sees draft invoice for Sita with Admission Fee line item → reviews → issues invoice. Parent logs in → sees issued invoice for NPR 35,000 under Fee Payments.

---

## Sprint 4 — Parent Payment Flow End-to-End

**Goal:** A parent can view an issued invoice, select a payment gateway, pay via eSewa (test mode), return to callback, see verification, and view/download a receipt. The complete payment lifecycle works.

**Depends on:** Sprint 1 (parent access), Sprint 2 (invoice exists and is issued)

---

### Ticket 4.0 — Define payment flow FSM states

**File:** `edforge-saas-frontend/apps/shell/src/hooks/usePaymentFlow.ts`

**Problem:** The FeePaymentPage needs a multi-step flow managed by a finite state machine. Define states and transitions.

**Changes:**
1. Define FSM states:
   ```typescript
   type PaymentFlowState =
     | { status: 'list' }                           // Invoice list
     | { status: 'detail'; invoiceId: string }       // Invoice detail
     | { status: 'gateway_select'; invoiceId: string } // Choose gateway
     | { status: 'confirm'; invoiceId: string; gateway: PaymentGateway } // Confirm
     | { status: 'redirecting'; sessionId: string }  // Waiting for gateway redirect
     | { status: 'verifying'; sessionId: string }    // Callback verification
     | { status: 'success'; payment: Payment }       // Payment complete
     | { status: 'error'; message: string }          // Error state
   ```
2. Transitions: `list → detail → gateway_select → confirm → redirecting → verifying → success|error`
3. Back navigation at each step.
4. 30-minute auto-timeout on `redirecting` state (from hardening sprint).

**Validation:**
- FSM transitions correctly through all states.
- Back button returns to previous state.
- TypeScript exhaustiveness check on `status` discriminant.

---

### Ticket 4.1 — Build InvoiceDetail component for parent portal

**File:** Create `edforge-saas-frontend/apps/shell/src/components/payments/InvoiceDetail.tsx`

**Changes:**
1. Shows full invoice breakdown:
   - School name, Invoice # header
   - Student name
   - Line items table: Description, Amount, Tax, Total
   - Totals: Subtotal, Discount, Tax, Grand Total
   - Status badge and due date
   - Amount Due (highlighted)
2. "Pay Now" button (only for `issued`, `partially_paid`, `overdue` statuses).
3. Uses the `useInvoice(schoolId, invoiceId)` hook for single invoice fetch.
4. NPR formatting with lakh grouping via `formatNPR()`.

**Validation:**
- Renders invoice with correct line items, totals, formatting.
- "Pay Now" visible for payable statuses, hidden for draft/cancelled/paid.
- NPR formatting correct (e.g., "NPR 1,50,000.00").

---

### Ticket 4.2 — Build GatewaySelector component

**File:** Create `edforge-saas-frontend/apps/shell/src/components/payments/GatewaySelector.tsx`

**Changes:**
1. Grid of available payment gateways (from `useEnabledGateways`).
2. Each gateway card shows:
   - Gateway icon/logo (eSewa green, Khalti purple)
   - Display name
   - Test Mode badge (if applicable)
3. Click selects gateway → highlighted state.
4. "Confirm Payment" button (disabled until gateway selected).
5. Manual payment options (cash, cheque) only visible to admin users.

**Validation:**
- Shows only enabled gateways.
- Selection state works.
- Test mode badge visible in test environments.

---

### Ticket 4.3 — Build PaymentConfirmation component

**File:** Create `edforge-saas-frontend/apps/shell/src/components/payments/PaymentConfirmation.tsx`

**Changes:**
1. Summary card:
   - Invoice #, Student Name
   - Amount: NPR {amountDue}
   - Payment Gateway: {selected gateway name}
   - "You will be redirected to {gateway} to complete payment"
2. "Pay NPR {amount}" button (calls `usePaymentFlow.confirmAndPay`).
3. "Go Back" link to return to gateway selection.
4. Loading state during initiation.
5. Error state with retry option.

**Validation:**
- Shows correct amount and gateway.
- Click Pay → loading spinner → redirect to gateway.
- Error → shows message with retry button.

---

### Ticket 4.4 — Wire FeePaymentPage with invoice → detail → pay flow

**File:** `edforge-saas-frontend/apps/shell/src/pages/parent-portal/FeePaymentPage.tsx`

**Changes:**
1. Integrate the FSM flow from Ticket 4.0:
   - List view: InvoiceList with payable invoices for active child
   - Detail view: InvoiceDetail with "Pay Now" button
   - Gateway selection: GatewaySelector
   - Confirmation: PaymentConfirmation
   - Redirect: Loading state while redirecting to gateway
2. Navigation: Invoice click → Detail → Pay Now → Gateway Select → Confirm → Redirect
3. Back navigation at each step.
4. Show payment history section below active invoices (completed payments).

**Validation:**
- Full flow: list → detail → gateway → confirm → redirect.
- Back button at each step works.
- Payment history shows past payments.

---

### Ticket 4.5 — Build ReceiptPage with download/print

**Files:** Update `edforge-saas-frontend/apps/shell/src/pages/payments/receipt.tsx`

**Changes:**
1. Route: `/payments/:paymentId/receipt`
2. Receipt layout (print-optimized):
   - School name/address header
   - Receipt #, Date, Transaction ID
   - Student name, Invoice #
   - Line items table
   - Payment method (eSewa/Khalti/Cash)
   - Total paid, Grand Total, Amount Due remaining
   - "Payment received — Thank you" footer
3. "Print Receipt" button (uses `window.print()` with print-specific CSS).
4. "Download PDF" button — lazy-load `html2canvas` + `jsPDF` only on click to avoid ~400KB bundle impact:
   ```typescript
   const handleDownload = async () => {
     const { default: html2canvas } = await import('html2canvas')
     const { default: jsPDF } = await import('jspdf')
     // ... generate PDF
   }
   ```
5. "Back to Invoices" navigation link.

**Validation:**
- Receipt renders with correct data.
- Print button → browser print dialog with clean layout.
- Download → PDF saved with receipt data.
- PDF libraries only loaded on demand.

---

### Ticket 4.6 — Fix verifyPayment session lookup performance

**File:** `server/application/microservices/finance/src/payments/payments.service.ts`

**Problem:** `verifyPayment()` queries the base table with `gatewaySessionId = :sessionId` as a filter expression. This scans ALL entities in the tenant partition — a full partition scan.

**Changes:**
1. Store a mapping entity on payment creation:
   ```typescript
   // PK: TENANT#{tenantId}, SK: SESSION#{sessionId}
   // paymentId, schoolId, invoiceId
   ```
2. In `verifyPayment()`, first look up the SESSION entity for O(1) resolution, then fetch the payment by its PK/SK.
3. Add TTL attribute to SESSION entity (24 hours) for auto-cleanup.

**Validation:**
- Payment verification uses SESSION lookup → O(1) instead of partition scan.
- TTL cleans up stale session mappings.

---

### Ticket 4.7 — Verify full eSewa test payment flow

**No code changes** — integration test script.

**File:** Create `scripts/smoke-tests/finance-payment-flow.sh`

**Steps:**
1. Admin: Generate invoice for student, issue it.
2. Parent: Log in, navigate to Fee Payments, click invoice, click Pay Now.
3. Select eSewa gateway, confirm.
4. Redirect to eSewa test page → complete payment with test credentials.
5. Callback redirect → verification → success state shown.
6. Auto-redirect to receipt page.
7. Verify: Invoice status updated to `paid`, ledger entry created, receipt data correct.

**Validation:**
- End-to-end eSewa test flow completes without errors.
- All data consistent: invoice.amountDue = 0, payment.status = completed, ledger balanced.
- Smoke test script passes in CI with `ESEWA_TEST_MODE=true`.

---

### Ticket 4.8 — Unit tests for payment lifecycle

**Files:** `server/application/microservices/finance/src/payments/payments.service.spec.ts`

**Changes:**
1. Test initiate payment → session created, redirect URL returned.
2. Test verify payment success → payment completed, invoice updated, ledger entry posted.
3. Test verify payment failure → payment failed, invoice unchanged.
4. Test student ownership enforcement → parent can only pay own child's invoice.
5. Test duplicate callback → idempotent (no double-charge).
6. Test amount exceeds due → rejected.

**Validation:**
- All tests pass.

---

**Sprint 4 Demo:** Full payment flow. Parent logs in → sees invoice "INV-0001 — NPR 35,000" → clicks it → sees line items → clicks "Pay Now" → selects eSewa → confirms → redirected to eSewa test page → pays → returns → "Payment Successful" → receipt page with all details → Print receipt. Show admin side: invoice status = paid, payment in list, ledger entry with credit.

---

## Sprint 5 — Admin Payment Operations & Student Accounts

**Goal:** School admin can record manual payments (cash/cheque/bank), view all payments with filters, void payments, process refunds, and view student billing accounts with ledger history.

---

### Ticket 5.1 — Create admin manual payment recording page

**File:** Create `edforge-saas-frontend/apps/shell/src/pages/settings/record-payment.tsx`

**Changes:**
1. Form fields:
   - Invoice selector (search by invoice # or student name)
   - Payment method: Cash / Bank Transfer / Cheque (radio buttons)
   - Amount (pre-filled with amountDue, editable for partial)
   - Reference # (for bank transfer/cheque)
   - Date paid (defaults to today)
   - Notes (optional)
2. Preview section showing invoice details and remaining balance.
3. Submit calls `POST /finance/schools/{schoolId}/payments/manual`.
4. On success, show receipt and offer to record another.

**Validation:**
- Fill form → submit → payment created, invoice updated.
- Partial payment → invoice status becomes `partially_paid`.
- Full payment → invoice status becomes `paid`.

---

### Ticket 5.2 — Create admin payments list page

**File:** Create `edforge-saas-frontend/apps/shell/src/pages/settings/payments.tsx`

**Changes:**
1. Table: Receipt #, Student, Invoice #, Amount, Gateway, Status, Date, Actions
2. Filters: Status, Gateway type, Date range
3. Actions per payment:
   - View receipt
   - Void (only for `completed` status) — opens confirmation modal
   - Refund (only for `completed`/`partially_refunded`) — opens amount + reason modal
4. Status badges: completed (green), failed (red), cancelled (gray), refunded (orange)

**Validation:**
- Payments list shows all school payments with correct data.
- Void → payment cancelled, invoice amountDue restored.
- Refund → partial refund dialog, amount validated against refundable amount.

---

### Ticket 5.3 — Create student accounts page

**File:** Create `edforge-saas-frontend/apps/shell/src/pages/settings/student-accounts.tsx`

**Changes:**
1. Table: Student Name, Balance, Total Paid, Last Payment, Actions
2. Search by student name.
3. Click student → detailed account view:
   - Account summary card (balance, total paid)
   - Invoices tab: all invoices for this student
   - Payments tab: all payments for this student
   - Ledger tab: full ledger history (debit/credit/balance)
4. Ledger table: Date, Type (invoice/payment/refund/adjustment), Description, Debit, Credit, Balance

**Validation:**
- Student accounts list → shows all accounts with balances.
- Click student → ledger shows chronological entries.
- Running balance is correct.

---

### Ticket 5.4 — Add void and refund mutation hooks

**File:** `edforge-saas-frontend/apps/shell/src/hooks/usePayments.ts`

**Changes:**
1. `useVoidPayment(schoolId)` mutation.
2. `useRefundPayment(schoolId)` mutation.
3. Both invalidate related queries (payments, invoices, student accounts) on success.

> **Note:** Void and refund require `billing:manage` permission. Verify that `Accountant` role's `billing:*` matches `billing:manage` via wildcard expansion in PermissionGuard.

**Validation:**
- Void → payment status updates, invoice refreshes with restored amountDue.
- Refund → payment shows partial_refunded status, refund entry in refunds array.

---

### Ticket 5.5 — Add settings sidebar links for Payments and Student Accounts

**File:** Settings sidebar component

**Changes:**
1. Add "Payments" link (route: `/settings/payments`).
2. Add "Student Accounts" link (route: `/settings/student-accounts`).
3. Update route definitions in `router.tsx`.

**Validation:**
- Navigation works.
- Permission-gated (billing:view required).

---

### Ticket 5.6 — Unit tests for void and refund operations

**File:** `server/application/microservices/finance/src/payments/payments.service.spec.ts`

**Changes:**
1. Test void completed payment → payment cancelled, invoice amountDue restored, ledger entry.
2. Test void non-completed payment → rejected.
3. Test refund → amount validated against refundable amount.
4. Test refund exceeds remaining → rejected.
5. Test partial refund → status becomes partially_refunded.
6. Test full refund → status becomes refunded.

**Validation:**
- All tests pass.

---

**Sprint 5 Demo:** Admin records manual cash payment for student's exam fee → receipt generated → payment appears in list. Admin records partial payment (NPR 20,000 of 35,000) → invoice becomes `partially_paid`. Admin voids a payment → invoice reverts to `issued`. Admin processes partial refund → ledger shows refund entry. Admin views student account → ledger shows all transactions with running balance.

---

## Sprint 6 — Bulk Billing & Recurring Fees

**Goal:** Admin can generate invoices in bulk for entire grade levels or sections. Overdue invoices are automatically detected.

---

### Ticket 6.1a — Create bulk invoice generation API (student_list target)

**File:** `server/application/microservices/finance/src/invoices/invoices.service.ts`

**Changes:**
1. Add `generateBulk(schoolId, dto, context)` method supporting `student_list` target type:
   ```typescript
   interface BulkGenerateInvoiceDto {
     feeStructureIds: string[];
     targetType: 'grade_level' | 'section' | 'student_list';
     targetIds: string[];
     academicYear: string;
     billingPeriod: string;
     dueDate: string;
     notes?: string;
   }
   ```
2. For `student_list`: Use provided student IDs directly.
3. For each student: `getOrCreate` billing account, generate invoice.
4. Use `Promise.allSettled` with `p-limit(10)` concurrency limiter for parallelized throughput.
5. Return summary: `{ generated: number, skipped: number, errors: string[] }`.
6. Duplicate prevention: Skip students with active (draft/issued) invoice with same fee structures + billing period.

**Validation:**
- Bulk generate for 10 students → 10 invoices created.
- Re-run same bulk → 0 new (all skipped as duplicates).
- Concurrency limiter prevents DynamoDB throttling.

---

### Ticket 6.1b — Add grade_level and section resolution for bulk generation

**File:** `server/application/microservices/finance/src/invoices/invoices.service.ts`

**Changes:**
1. For `grade_level` target: Call academics service HTTP to get all enrolled students in that grade.
2. For `section` target: Call academics service HTTP to get section roster.
3. Resolve student IDs, then delegate to the same per-student generation from 6.1a.

**Validation:**
- Bulk generate for Grade 5 (25 students) → 25 invoices created.
- Section with 30 students → 30 invoices.
- Invalid grade level → 0 generated, error in response.

---

### Ticket 6.2 — Create bulk invoice generation UI

**File:** Create `edforge-saas-frontend/apps/shell/src/components/payments/BulkInvoiceForm.tsx`

**Changes:**
1. Step 1: Select target — Grade Level dropdown, Section dropdown, or Manual student selection.
2. Step 2: Select fee structures (checkboxes with amounts).
3. Step 3: Set billing period, due date, notes.
4. Step 4: Preview — show count of students, per-student total, grand total.
5. Submit → progress bar showing generation progress.
6. Result summary: "Generated 25 invoices. 2 skipped (duplicate)."

**Validation:**
- Select Grade 5 → shows "25 students found".
- Select 2 fee structures → preview shows per-student total.
- Submit → invoices generated → list refreshes.

---

### Ticket 6.3 — Add bulk issue backend endpoint + frontend action

**Files:**
- `server/application/microservices/finance/src/invoices/invoices.controller.ts`
- `edforge-saas-frontend/apps/shell/src/pages/settings/invoices.tsx`

**Changes:**
1. Backend: Add `POST /finance/schools/:schoolId/invoices/bulk-issue` endpoint:
   ```typescript
   @Post('bulk-issue')
   @RequirePermission({ resource: 'billing', action: 'edit' })
   async bulkIssue(@Body() dto: { invoiceIds: string[] }, @TenantCredentials() tenant, @Req() req) {
     const context = buildRequestContext(tenant, req);
     return this.invoicesService.bulkIssue(dto.invoiceIds, context);
   }
   ```
2. Service method issues all provided draft invoices, posts ledger entries.
3. Returns `{ issued: number, failed: number, errors: string[] }`.
4. Frontend: Add checkbox column to invoice table for multi-select.
5. "Bulk Issue" button appears when draft invoices are selected.
6. Confirmation modal: "Issue {N} invoices? Students will be able to see and pay these."
7. Progress indicator + partial success handling.

**Validation:**
- Select 25 draft invoices → click "Bulk Issue" → all 25 transition to "issued".
- Mix of draft and non-draft → partial success.
- Error on one doesn't block others.

---

### Ticket 6.4 — Add overdue detection job

**File:** Create `server/application/microservices/finance/src/common/services/overdue-detection.service.ts`

**Problem:** Invoices past their due date should be automatically marked `overdue`.

**Changes:**
1. Service runs every hour via `setInterval` (same pattern as PaymentSweepService).
2. **Multi-tenant credential access:** Use a service-account approach — iterate known tenant IDs from a config/lookup table and obtain per-tenant DynamoDB clients.
3. Per tenant, query GSI1 for `INVOICE` entities:
   - Query 1: `begins_with(GSI1SK, 'INVOICE#issued')`, filter `dueDate < today`
   - Query 2: `begins_with(GSI1SK, 'INVOICE#partially_paid')`, filter `dueDate < today`
   - **Note:** This is filter-after-fetch pattern. Acceptable for school-scale data (<10K invoices per school).
4. Update status to `overdue`, update GSI1SK.
5. Log overdue transitions.
6. Publish `InvoiceOverdue` event for each.
7. Configurable via `DISABLE_OVERDUE_DETECTION=true` env var.
8. Register in `InvoicesModule` or create `OverdueDetectionModule` and add to `FinanceModule.imports`.

**Validation:**
- Invoice with dueDate yesterday, status `issued` → becomes `overdue`.
- Invoice with dueDate tomorrow → stays `issued`.
- `paid` invoices → never marked overdue.

---

### Ticket 6.5 — Add overdue indicator in frontend

**Files:** Invoice list components (admin and parent)

**Changes:**
1. Overdue status badge in red with "Overdue" text.
2. Overdue invoices sorted to top of parent portal list.
3. "Overdue by X days" text next to due date.

**Validation:**
- Overdue invoice → red badge in both admin and parent views.

---

### Ticket 6.6 — API Gateway routes for bulk endpoints

**File:** `server/lib/tenant-api-prod.json`

**Changes:**
1. Add `POST /finance/schools/{schoolId}/invoices/bulk-issue`.
2. Ensure internal webhook endpoints are NOT exposed via API Gateway.

**Validation:**
- Bulk issue accessible via API Gateway.
- Internal webhooks NOT accessible externally.

---

### Ticket 6.7 — Unit tests for bulk generation and overdue detection

**Files:**
- `server/application/microservices/finance/src/invoices/invoices.service.spec.ts`

**Changes:**
1. Test bulk generation with student_list → N invoices created.
2. Test duplicate detection → skip existing active invoices.
3. Test partial failures → summary shows generated + errors.
4. Test overdue detection → issued past-due → marked overdue.
5. Test overdue → paid invoices not affected.

**Validation:**
- All tests pass.

---

**Sprint 6 Demo:** Admin clicks "Bulk Generate" → selects Grade 5 → selects "Monthly Tuition" (NPR 6,500) → 25 invoices created → "Bulk Issue" → all 25 issued. Wait for overdue detection cycle → past-due invoices marked overdue. Parent sees overdue badge on their child's invoice.

---

## Sprint 7 — Financial Dashboard & Reporting

**Goal:** Admin has a financial overview dashboard with revenue metrics, collection rates, and exportable reports. Parents see a fee summary for their child.

---

### Ticket 7.1 — Create financial summary API endpoint

**Files:** Create `server/application/microservices/finance/src/dashboard/dashboard.service.ts` and controller

**Changes:**
1. `GET /finance/schools/:schoolId/dashboard/summary` endpoint:
   ```typescript
   interface FinanceDashboardSummary {
     totalInvoiced: number;
     totalCollected: number;
     totalOutstanding: number;
     totalOverdue: number;
     collectionRate: number;
     invoiceCounts: {
       draft: number; issued: number; partially_paid: number;
       paid: number; overdue: number; cancelled: number;
     };
     paymentsByGateway: Record<string, { count: number; total: number }>;
     recentPayments: Payment[];
   }
   ```
2. Aggregation approach:
   - Query GSI1 for all `INVOICE` and `PAYMENT` entities in the school partition.
   - **Scale ceiling:** For schools with >10K invoices (~120MB reads), add a hard limit of 10,000 items max per entity type.
   - Compute aggregates server-side with pagination.
   - **Future improvement (post-MVP):** Add a `SCHOOL_FINANCIAL_SUMMARY` materialized entity that gets updated via increment/decrement on invoice issue / payment complete. Dashboard reads this single entity instead of aggregating.
3. Cache result for 5 minutes (in-memory, per-instance). Document that horizontal scaling creates cache divergence — acceptable for MVP.

**Validation:**
- Returns correct totals matching sum of individual entities.
- Empty school → all zeros.
- 10,000-item limit prevents runaway queries.

---

### Ticket 7.2 — Create admin financial dashboard page

**File:** Create `edforge-saas-frontend/apps/shell/src/pages/settings/financial-dashboard.tsx`

**Changes:**
1. Summary cards row:
   - Total Invoiced (NPR)
   - Total Collected (NPR, green)
   - Outstanding (NPR, amber)
   - Overdue (NPR, red)
   - Collection Rate (%)
2. Invoice status breakdown (horizontal bar chart or donut — simple CSS, no chart library).
3. Payment methods breakdown (eSewa, Khalti, Cash, etc.).
4. Recent payments table (last 10).
5. "Export Report" button → triggers CSV download.

**Validation:**
- Dashboard shows correct metrics.
- Numbers match admin invoice/payment lists.

---

### Ticket 7.3 — Create CSV export endpoint for invoices

**File:** `server/application/microservices/finance/src/invoices/invoices.controller.ts`

**Changes:**
1. Add `GET /finance/schools/:schoolId/invoices/export` endpoint:
   - Query param: `format=csv`
   - Returns `Content-Type: text/csv` with download headers.
   - Columns: Invoice #, Student, Grand Total, Amount Paid, Amount Due, Status, Due Date, Issued Date.
2. **Use NestJS `StreamableFile`** to stream response and avoid buffering 10,000 rows in memory:
   ```typescript
   @Get('export')
   @RequirePermission({ resource: 'billing', action: 'view' })
   async exportInvoices(@Query('format') format: string, @Res() res: Response) {
     res.setHeader('Content-Type', 'text/csv');
     res.setHeader('Content-Disposition', 'attachment; filename="invoices.csv"');
     const stream = this.invoicesService.streamInvoicesCsv(schoolId, context);
     stream.pipe(res);
   }
   ```
3. Limit: 10,000 rows max.

**Validation:**
- Export → valid CSV file downloads.
- CSV opens correctly in Excel/Google Sheets.
- Large dataset (1000+ invoices) → export streams without memory issues.

---

### Ticket 7.4 — Add financial dashboard to settings navigation

**File:** Settings sidebar

**Changes:**
1. Add "Financial Dashboard" as first item in PAYMENTS section.
2. Route: `/settings/financial-dashboard`.
3. Only visible to users with `billing:view` permission.

**Validation:**
- Admin → sees dashboard link.
- Dashboard page loads with data.

---

### Ticket 7.5 — Add "Overview" section to parent portal fees page

**File:** `edforge-saas-frontend/apps/shell/src/pages/parent-portal/FeePaymentPage.tsx`

**Changes:**
1. Add summary cards at top of fee payment page:
   - Total Fees: NPR X (sum of all issued/overdue invoice grandTotals)
   - Paid: NPR Y (sum of amountPaid)
   - Remaining: NPR Z (sum of amountDue)
2. Color coding: paid (green), remaining (amber/red if overdue).
3. Show "All fees are paid" success state when remaining = 0.

**Validation:**
- Parent sees correct fee summary for their child.
- Changes after payment reflect immediately.

---

### Ticket 7.6 — API Gateway routes for dashboard and export endpoints

**File:** `server/lib/tenant-api-prod.json`

**Changes:**
1. Add `GET /finance/schools/{schoolId}/dashboard/summary`.
2. Add `GET /finance/schools/{schoolId}/invoices/export`.

**Validation:**
- Routes proxy correctly to finance service.

---

### Ticket 7.7 — Smoke test: finance end-to-end

**File:** Create `scripts/smoke-tests/finance-e2e.sh`

**Changes:**
1. Admin: Create fee structure → generate invoice → issue invoice.
2. Parent: List invoices → verify scoped to own child → initiate payment.
3. Admin: Record manual payment → void → refund.
4. Admin: Bulk generate → bulk issue.
5. Admin: Dashboard summary → verify totals → export CSV.
6. Verify: Parent cannot access other students' data (403 on direct ID access).

**Validation:**
- Full E2E smoke test passes.

---

**Sprint 7 Demo:** Admin opens Financial Dashboard → sees overview: NPR 9,12,500 invoiced, NPR 3,50,000 collected, 38% collection rate. Invoice breakdown shows 15 paid, 8 overdue, 2 draft. Payment methods: 60% eSewa, 30% Cash, 10% Khalti. Export CSV → opens in spreadsheet. Parent sees "Total Fees: NPR 36,500 | Paid: NPR 35,000 | Remaining: NPR 1,500" at top of fee page.

---

## Appendix A: Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Parent data scoping | Server-side student ID filtering via linked students API + entity-level ownership checks on all GETs | Security — never trust client to self-scope; prevent horizontal access |
| Manual payment role guard | Block Parent/Student from `recordManualPayment` | Prevent fraudulent self-payment recording |
| Internal webhook auth | Shared secret header (`x-internal-api-key`) | Simple service-to-service auth; prevents fabricated enrollment events |
| Enrollment → billing | HTTP webhook (fire-and-forget) with shared secret | Simple, no EventBridge infra needed for MVP |
| Bulk invoice generation | Parallel per-student with `p-limit(10)` concurrency + duplicate detection | Balances throughput with DynamoDB capacity |
| Overdue detection | Polling job (hourly interval) with per-tenant iteration | No DynamoDB Streams configured; simple and reliable |
| Receipt PDF | Client-side HTML-to-PDF (lazy-loaded) | Avoids server-side headless browser dependency; lazy-load prevents bundle bloat |
| Financial dashboard | Aggregation query with 5-min cache + 10K item limit | DynamoDB query + filter; post-MVP: materialized summary entity |
| Parent billing permissions | Default role permissions with `billing:view` + `billing:create` | No per-user overrides needed for MVP |
| Payment session lookup | SESSION mapping entity with TTL | O(1) verification instead of partition scan |
| CSV export | NestJS StreamableFile | Streams response to avoid memory buffering 10K rows |

## Appendix B: Files Created/Modified Per Sprint

| Sprint | New Files | Modified Files |
|--------|-----------|----------------|
| S1 | users.controller.ts (identity), identity-client.service.ts methods | role-assignment.entity.ts, invoices.controller.ts, payments.controller.ts, student-accounts.controller.ts, FeePaymentPage.tsx, tenant-api-prod.json |
| S2 | invoices.tsx, invoice-detail.tsx, invoices.service.ts (FE) | router.tsx, usePayments.ts, sidebar |
| S3 | enrollment-webhook.controller.ts, enrollment-webhook.module.ts, InternalApiKeyGuard, zod-dtos.ts | enrollment.service.ts (academics), fee-structure.entity.ts, fee-structures.service.ts, finance.module.ts, shared-types schemas |
| S4 | InvoiceDetail.tsx, GatewaySelector.tsx, PaymentConfirmation.tsx, receipt.tsx, finance-payment-flow.sh | FeePaymentPage.tsx, usePaymentFlow.ts, payments.service.ts, callback.tsx |
| S5 | record-payment.tsx, payments.tsx, student-accounts.tsx | usePayments.ts, router.tsx, sidebar |
| S6 | BulkInvoiceForm.tsx, overdue-detection.service.ts | invoices.service.ts, invoices.controller.ts, payments.module.ts, tenant-api-prod.json |
| S7 | dashboard.service.ts, dashboard.controller.ts, financial-dashboard.tsx, finance-e2e.sh | FeePaymentPage.tsx, invoices.controller.ts, router.tsx, sidebar, tenant-api-prod.json |

## Appendix C: Security Checklist

| Check | Sprint | Enforcement |
|-------|--------|-------------|
| Parent list scoping (invoices) | S1 | Server-side `getLinkedStudentIds()` in list endpoints |
| Parent entity-level ownership (GET by ID) | S1 | `enforceStudentOwnership()` on all single-entity GETs |
| Manual payment role guard | S1 | Block Parent/Student from `recordManualPayment` |
| Payment initiation ownership | S1 | Verify parent owns student on target invoice |
| Internal webhook auth | S3 | `InternalApiKeyGuard` validates `x-internal-api-key` |
| Payment session O(1) lookup | S4 | SESSION mapping entity replaces partition scan |
| CSV export stream | S7 | `StreamableFile` prevents memory exhaustion |
| Cross-tenant cache isolation | S1 | Cache keys include `tenantId` |

## Appendix D: Deferred Items (Post-MVP)

| Item | Reason |
|------|--------|
| KMS encryption for gateway credentials | Infrastructure complexity; secrets already behind PermissionGuard |
| Email/SMS notifications for invoices and payments | Requires notification service infrastructure |
| DynamoDB TransactWrite for payment atomicity | Current optimistic locking sufficient for school-scale |
| Materialized `SCHOOL_FINANCIAL_SUMMARY` entity | Dashboard aggregation acceptable for MVP scale |
| Multi-currency support | Nepal schools use NPR only |
| Installment plans | Can be modeled as multiple invoices; no special entity needed |
| Late fee auto-calculation | Post-MVP; can be added as overdue detection enhancement |
| Audit trail for all billing actions | Structured logging covers this for MVP; formal audit entity post-MVP |
| Redis/ElastiCache for dashboard cache | In-memory cache acceptable for single-instance MVP |
| DynamoDB Streams for real-time overdue detection | Polling job sufficient for school-scale |
| Permission split (`billing:pay` vs `billing:create`) | Role guard on `recordManualPayment` sufficient for MVP |
