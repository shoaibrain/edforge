# Finance Module Revamp — Sprint Plan

## Context

### Problem
1. **Wrong location**: All finance operational pages (invoices, payments, student-accounts, financial-dashboard, bulk-invoices, record-payment) live in `apps/shell/src/pages/settings/`. Settings should ONLY contain configuration: fee-structures and payment-gateways.
2. **Finance MFE is parked**: `apps/finance` (port 3003) exists with Module Federation, has Overview + Ledger + stub billing route, but is disabled via `[MVP-PARKED]` markers throughout the codebase.
3. **Invoice generation bug**: Frontend sends `studentId` field but backend Zod schema expects `studentAccountId`. Backend's `getOrCreate()` actually treats the value as a student ID anyway — semantic mismatch.
4. **No finance smoke tests**: No automated runtime tests for the finance API flow.
5. **Webhook routes**: Confirmed internal-only — NOT in API Gateway. Protected by `x-internal-api-key` header for service-to-service calls within VPC. This is correct and intentional.

### Architecture Decisions

1. **Fix the bug FIRST**: Rename `studentAccountId` → `studentId` in shared-types schemas BEFORE extracting services, so extracted code uses correct names from the start.

2. **API client extraction**: Shell's `lib/api.ts` exports `apiGet/apiPost/apiPatch/apiDelete` configured with Cognito JWT injection, tenant header extraction, 401 redirect, 403 toasts. Finance services depend on these. Extract the typed helpers + axios instance + JWT request interceptor into `@edforge/api-client` shared package. Shell-specific response interceptors (auth store 401 redirect, sonner toasts) stay registered in shell's bootstrap — NOT in the shared package.

3. **Service extraction**: Create `@edforge/finance-services` package containing invoice/payment/dashboard services + React Query hooks, importing from `@edforge/api-client`. Shared via Module Federation singleton between shell and finance MFE.

4. **Full unpark in Sprint 1**: Unpark ALL finance references at once — Module Federation remote, router, sidebar, home page widgets, breadcrumbs, build scripts. No half-parked state.

5. **Deprecate-then-delete**: Mark old shell files as `@deprecated` in Sprint 2, delete in Sprint 4 after redirects are validated.

### Critical Files
- `packages/shared-types/src/schemas/finance/invoice.schema.ts` — `studentAccountId` (line 68), `studentAccountIds` (line 88)
- `server/application/microservices/finance/src/invoices/invoices.service.ts` — `dto.studentAccountId` refs (lines ~91, ~549, ~574, ~575, ~595)
- `edforge-saas-frontend/apps/shell/src/lib/api.ts` — API client with Cognito JWT + interceptors (imports `@edforge/auth`, `sonner`, dynamic auth store)
- `edforge-saas-frontend/apps/shell/src/services/invoices.service.ts` — Local `BulkGenerateInvoiceDto` with `studentAccountIds` (line 156)
- `edforge-saas-frontend/apps/finance/src/router.tsx` — Finance MFE router (flat stub routes → nested billing layout)
- `edforge-saas-frontend/apps/shell/src/config/sidebar-modules.ts` — `[MVP-PARKED]` finance module (~lines 616-632)
- `edforge-saas-frontend/apps/shell/src/config/modules.config.ts` — `finance: false` (line 18)
- `edforge-saas-frontend/apps/shell/rsbuild.config.ts` — Finance remote commented out (~line 107)
- `edforge-saas-frontend/apps/shell/src/pages/parent-portal/FeePaymentPage.tsx` — Parent portal uses invoice/payment hooks (needs import update)
- `edforge-saas-frontend/package.json` — `dev:finance` echoes "parked" (line 15); `dev:mvp`/`build:mvp` exclude finance (lines 17-18)

### Target Route Structure (Finance MFE)
```
/finance                             → Overview (live stats from dashboard API)
/finance/billing                     → Billing Overview (KPIs + action cards)
/finance/billing/invoices            → Invoice list + generate modal
/finance/billing/invoices/:id        → Invoice detail
/finance/billing/invoices/bulk-generate → Bulk generation wizard
/finance/billing/payments            → Payments list
/finance/billing/payments/record     → Manual payment form
/finance/billing/accounts            → Student accounts + expandable ledger
/finance/dashboard                   → Financial dashboard with charts
/finance/ledger                      → GL/AP/AR (already exists)
```

---

## Sprint 1: Fix Invoice Bug + Unpark Finance MFE + Extract Service Layer (7 tickets)

**Goal**: Invoice generation bug fixed end-to-end. Finance MFE fully unparked and live at `/finance`. Shared `@edforge/api-client` and `@edforge/finance-services` packages established. No functional regression.

**Demo**: Navigate to `/finance` → see Overview page. Generate an invoice with fixed `studentId` field. Finance appears in home page sidebar and widgets.

---

### S1-T1: Fix shared-types — rename `studentAccountId` to `studentId` in invoice schemas

Fix the bug FIRST so all downstream extraction uses correct naming.

**Modify:**
- `packages/shared-types/src/schemas/finance/invoice.schema.ts`:
  - Line 68: `studentAccountId: uuidSchema` → `studentId: uuidSchema`
  - Line 88: `studentAccountIds: z.array(uuidSchema)` → `studentIds: z.array(uuidSchema)`
- Bump version in `packages/shared-types/package.json`, build, publish to npm

**Validate:** `pnpm --filter @aibrains/shared-types build` passes. `GenerateInvoiceDto` type now has `studentId`. `BulkGenerateInvoiceDto` has `studentIds`.

---

### S1-T2: Fix backend invoice service to use `studentId` field

**Modify:**
- `server/application/microservices/finance/src/invoices/invoices.service.ts`:
  - `generate()` ~line 91: `dto.studentAccountId` → `dto.studentId`
  - `generateBulk()` ~line 549: `dto.studentAccountIds` → `dto.studentIds`
  - Loop refs ~lines 574, 575, 595: all `studentAccountId` → `studentId`
- `server/application/package.json` — Update `@aibrains/shared-types` to new version
- Verify `common/dto/zod-dtos.ts` auto-updates from schema

**Validate:** `npm run build:finance` passes. POST `/finance/schools/{schoolId}/invoices` with `{ studentId: "..." }` returns 201.

---

### S1-T3: Fix frontend invoice services + remove `as any` casts

**Modify:**
- `apps/shell/src/services/invoices.service.ts`:
  - Line 156: `studentAccountIds: string[]` → `studentIds: string[]`
  - Line 151: error type `studentAccountId` → `studentId`
- `apps/shell/src/pages/settings/invoices.tsx` — Remove `as any` cast on generate call, use `studentId`
- `apps/shell/src/components/payments/BulkInvoiceForm.tsx` — Rename `studentAccountIds` → `studentIds`
- `apps/shell/src/pages/parent-portal/FeePaymentPage.tsx` — Verify no `studentAccountId` refs

**Validate:** Network tab shows `{ studentId: "..." }` in POST body. `pnpm --filter shell tsc --noEmit` passes. No `as any` casts on invoice generation.

---

### S1-T4: Extract `@edforge/api-client` shared package

Extract typed API helpers from shell's `lib/api.ts`. Keep shell-specific interceptors (401 redirect, 403 toast) in shell.

**Create:**
- `packages/api-client/package.json` (deps: `axios`, `@edforge/auth`)
- `packages/api-client/tsconfig.json`
- `packages/api-client/src/index.ts` — Exports `createApiClient()`, `apiGet`, `apiPost`, `apiPut`, `apiPatch`, `apiDelete`, all type exports (`ApiRequestMeta`, `ApiResponse`, `PaginatedResponse`, `ApiError`, `ExtraConfig`)
- JWT request interceptor (using `getIdToken()` from `@edforge/auth`) lives in the package
- Response interceptors (401/403) do NOT go in the package — shell registers those on the returned instance

**Modify:**
- `pnpm-workspace.yaml` — Add `packages/api-client`
- `apps/shell/src/lib/api.ts` — Import base client from `@edforge/api-client`, register shell-specific response interceptors locally

**Validate:** `pnpm --filter @edforge/api-client build` passes. Shell works identically (login/logout, 401 redirect, 403 toasts all still function).

---

### S1-T5: Extract `@edforge/finance-services` package and wire shell imports

Create the shared finance services package, then update ALL shell consumers.

**Create:**
- `packages/finance-services/package.json` (deps: `@edforge/api-client`, `@tanstack/react-query`)
- `packages/finance-services/tsconfig.json`, `vitest.config.ts`
- `packages/finance-services/src/index.ts`
- `packages/finance-services/src/services/invoices.service.ts` (from shell, now importing `@edforge/api-client`)
- `packages/finance-services/src/services/payments.service.ts`
- `packages/finance-services/src/hooks/usePayments.ts`

**Modify (wire shell):**
- All 8 shell finance settings pages — Update imports to `@edforge/finance-services`
- `apps/shell/src/components/payments/BulkInvoiceForm.tsx` — Update imports
- `apps/shell/src/pages/parent-portal/FeePaymentPage.tsx` — Update imports
- `apps/shell/package.json` — Add `@edforge/finance-services` dependency

**Validate:** `pnpm --filter @edforge/finance-services tsc --noEmit` passes. `pnpm --filter shell build` passes. All settings finance pages render identically. `grep -r "from.*\.\./services/invoices\|from.*\.\./services/payments\|from.*\.\./hooks/usePayments" apps/shell/src/pages/settings/` returns nothing.

---

### S1-T6: Unpark Finance MFE — full re-enablement

Follow `MODULE_PARKING.md` checklist completely. ALL finance markers removed.

**Modify:**
- `apps/shell/rsbuild.config.ts` — Uncomment `finance: remoteUrl('finance', 'finance', 3003)`
- `apps/shell/src/router.tsx` — Uncomment `FinanceModule` lazy import + `financeRoute`, replace `financeComingSoonRoute` in route tree
- `apps/shell/src/config/sidebar-modules.ts` — Uncomment `financeModule`, add to `SIDEBAR_MODULES`, uncomment `detectModuleFromPath` for `/finance`
- `apps/shell/src/config/modules.config.ts` — Set `finance: true`, remove from `PARKED_MODULE_PATHS`
- `apps/shell/src/components/layout/Breadcrumbs.tsx` — Uncomment finance route labels
- Home widgets — Uncomment finance references in QuickActionsWidget, WelcomeTipWidget, CarouselWidget, RecentlyVisitedCarousel
- `apps/finance/rsbuild.config.ts` — Add `@edforge/api-client` and `@edforge/finance-services` to Module Federation `shared` config (singleton: true, eager: true)
- `apps/finance/package.json` — Add both packages as dependencies
- `edforge-saas-frontend/package.json`:
  - Line 15: `dev:finance` → proper dev command
  - Lines 17-18: Add `@edforge/finance` to `dev:mvp` and `build:mvp` filters

**Validate:** `pnpm dev` starts shell + finance. `/finance` shows Overview (not ComingSoon). `/finance/ledger` shows GL/AP/AR. Finance in home sidebar + widgets. `grep -r "MVP-PARKED.*finance" apps/shell/src` returns 0.

---

### S1-T7: Write baseline finance smoke test

**Create:** `scripts/smoke-tests/finance-billing-flow.ts`

Tests: Create fee structure → Generate invoice with `studentId` field → List invoices → Get detail → Issue → Dashboard summary → Cancel

**Validate:** `npx ts-node scripts/smoke-tests/finance-billing-flow.ts` — all green.

---

## Sprint 2: Move Billing Pages to Finance MFE (7 tickets)

**Goal**: Invoice, payment, student account, and dashboard pages move to finance MFE. Shell settings routes become redirects. Finance sidebar shows full billing navigation.

**Demo**: Full billing workflow from `/finance/billing`: invoices → record payment → student accounts → dashboard. Old settings URLs redirect.

---

### S2-T1: Restructure finance MFE router for nested billing routes + error boundaries

Convert flat `/billing` stub to layout route with `Outlet`. Add error boundaries to ALL routes.

**Create:** `apps/finance/src/layouts/BillingLayout.tsx`, `apps/finance/src/components/FinanceErrorBoundary.tsx`

**Modify:** `apps/finance/src/router.tsx`:
- `billingRoute` → layout route rendering `<BillingLayout><Outlet/></BillingLayout>`
- Add child route definitions for all billing pages + dashboard
- Add `errorComponent: FinanceErrorBoundary` to every route

**Validate:** `pnpm --filter finance tsc --noEmit` passes. Router compiles with nested structure.

---

### S2-T2: Move invoice pages (list + detail + bulk generate) to finance MFE

**Create:**
- `apps/finance/src/routes/billing/invoices/index.tsx`
- `apps/finance/src/routes/billing/invoices/[invoiceId].tsx`
- `apps/finance/src/routes/billing/invoices/bulk-generate.tsx`
- `apps/finance/src/components/BulkInvoiceForm.tsx`

Update all imports to `@edforge/finance-services`. Update internal links (`/settings/*` → `/finance/billing/*`).

**Validate:** `/finance/billing/invoices` renders list. Generate modal works. Detail page shows line items. Bulk generate wizard completes.

---

### S2-T3: Move payment + record-payment pages to finance MFE

**Create:**
- `apps/finance/src/routes/billing/payments/index.tsx`
- `apps/finance/src/routes/billing/payments/record.tsx`

Update imports. Preserve query param forwarding (`?invoiceId=...&amount=...`).

**Validate:** Payments table loads, void/refund work. Record payment form (cash/bank/cheque) creates payment. Success state renders.

---

### S2-T4: Move student-accounts + financial-dashboard to finance MFE

**Create:**
- `apps/finance/src/routes/billing/accounts/index.tsx`
- `apps/finance/src/routes/dashboard/index.tsx`

**Validate:** Accounts table with expandable ledger. Dashboard KPIs, breakdowns, recent payments, CSV export.

---

### S2-T5: Add redirects + update sidebar navigation

**Modify:**
- `apps/shell/src/router.tsx` — Replace all settings finance route components with `beforeLoad` redirects preserving query params:
  - `/settings/invoices` → `/finance/billing/invoices`
  - `/settings/invoices/:id` → `/finance/billing/invoices/:id`
  - `/settings/bulk-invoices` → `/finance/billing/invoices/bulk-generate`
  - `/settings/payments` → `/finance/billing/payments`
  - `/settings/record-payment` → `/finance/billing/payments/record`
  - `/settings/student-accounts` → `/finance/billing/accounts`
  - `/settings/financial-dashboard` → `/finance/dashboard`
- `apps/shell/src/config/sidebar-modules.ts`:
  - Remove: invoices, payments, record-payment, student-accounts, financial-dashboard from settings module
  - Update `financeModule`: add billing sub-items (Invoices, Payments, Student Accounts) + Dashboard

**Validate:** All old URLs redirect (with query params). Settings sidebar only shows: Fee Structures, Payment Gateways. Finance sidebar shows full billing tree.

---

### S2-T6: Deprecate old shell finance files (safety net)

Add `@deprecated` comments to old shell files. Do NOT delete yet.

**Modify:** All 7 settings pages + old service/hook files — Add `// @deprecated: Moved to apps/finance. Will be deleted in Sprint 4.`

**Validate:** `pnpm --filter shell build` still passes. Redirects confirmed working.

---

### S2-T7: Add ABAC permission guards to finance sidebar

**Modify:** `sidebar-modules.ts` — Finance nav items: `{ action: 'view', resource: 'billing' }`. Generate/void/refund actions: `{ action: 'manage', resource: 'billing' }`.

**Validate:** Login as Student/Parent/Teacher → Finance not in sidebar. Login as TenantAdmin → full navigation.

---

## Sprint 3: UX Improvements — Student Picker, Live Data, Cross-linking (6 tickets)

**Goal**: Invoice generation uses a student picker (no raw UUIDs). Billing overview + finance overview show live API data. Pages cross-link.

**Demo**: Generate invoice by searching student name. Real-time KPIs on billing and overview pages.

---

### S3-T1: Create student picker component (single + multi-select)

**Create:** `apps/finance/src/components/StudentPicker.tsx`

Debounced search (2+ chars) against student accounts API. Dropdown: student name, grade, truncated ID. Keyboard accessible. Supports both single-select (for generate) and multi-select (for bulk generate) modes.

**Validate:** Type a name → dropdown appears → select → field populated. Arrow keys + Enter work.

---

### S3-T2: Integrate student picker into invoice generation forms

**Modify:**
- Invoice generate modal in `invoices/index.tsx` — Replace `studentId` text input with `<StudentPicker>`
- `BulkInvoiceForm.tsx` — Replace student selection step with multi-select `<StudentPicker>` with chips

**Validate:** Generate modal: search → select → submit → invoice created. Bulk form: select 3+ → generate.

---

### S3-T3: Replace billing + finance overview stubs with live data

**Modify:**
- `apps/finance/src/routes/billing/index.tsx` — Use `useDashboardSummary` for real stats, link to sub-routes
- `apps/finance/src/routes/overview.tsx` — Replace hardcoded `$125,890` etc. with real dashboard data

**Validate:** Both pages show real numbers. Action cards navigate correctly. Loading/empty states handled.

---

### S3-T4: Add cross-linking between finance pages

**Modify:**
- Payments table: invoice # column links to `/finance/billing/invoices/:id`
- Student accounts: "Generate Invoice" button → generate modal with student pre-selected
- Invoice detail: "Record Payment" button → `/finance/billing/payments/record?invoiceId=...&amount=...`

**Validate:** Each cross-link navigates correctly with pre-filled data.

---

### S3-T5: Add Vitest unit tests for finance-services hooks

**Create:** `packages/finance-services/src/__tests__/hooks.test.ts`

Tests: query key factory correctness, mutation cache invalidation, service URL construction.

**Validate:** `pnpm --filter @edforge/finance-services test` passes. 80%+ hook coverage.

---

### S3-T6: Write comprehensive E2E finance smoke test

**Create:** `scripts/smoke-tests/finance-e2e-flow.ts`

15 steps: fee structure → generate invoice → list → detail → issue → partial payment → verify `partially_paid` → remaining payment → verify `paid` → dashboard totals → void → refund → bulk generate → bulk issue → CSV export

**Validate:** All 15 steps green. Logs in `scripts/smoke-tests/logs/`.

---

## Sprint 4: Cleanup, Infrastructure & Production Readiness (5 tickets)

**Goal**: Old files deleted, Docker/nginx updated, full build pipeline verified, production-ready.

**Demo**: Complete end-to-end finance workflow in production-like build.

---

### S4-T1: Delete deprecated shell finance files

Safe now — redirects validated for a full sprint.

**Delete:** 7 settings pages, old `BulkInvoiceForm.tsx`, old service files (`invoices.service.ts`, `payments.service.ts`), old hooks (`usePayments.ts`)

**Modify:**
- `apps/shell/src/pages/settings/index.ts` — Remove deleted exports
- `apps/shell/src/router.tsx` — Redirect routes no longer import components

**Validate:** `pnpm --filter shell build` passes. `pnpm --filter shell tsc --noEmit` passes. All redirects still work.

---

### S4-T2: Update Docker/nginx for finance MFE

**Modify:**
- `edforge-saas-frontend/docker/docker-compose.dev.yml` — Add finance service (port 3003)
- `edforge-saas-frontend/docker/nginx/nginx.conf` — Add upstream + location for finance `remoteEntry.js`

**Validate:** `docker compose up -d && curl http://localhost:3003/remoteEntry.js` returns JS.

---

### S4-T3: Verify API Gateway routes

Check `server/lib/tenant-api-prod.json` — no `studentAccountId` in request model definitions. Update if swagger spec includes parameter names.

**Validate:** `cdk diff` shows expected changes. Deploy if needed.

---

### S4-T4: Final full-pipeline build verification

1. `pnpm install`
2. `pnpm --filter @aibrains/shared-types build`
3. `pnpm --filter @edforge/api-client build`
4. `pnpm --filter @edforge/finance-services build`
5. `pnpm build:mvp` (shell + academics + people + finance)
6. Verify `remoteEntry.js` for finance in build output
7. Full browser walkthrough — all finance routes, sidebar, breadcrumbs, no console errors

**Validate:** All builds exit 0. No TypeScript errors. No console errors in manual browser testing.

---

### S4-T5: Deploy backend + frontend and run smoke tests

1. Build + push Docker image for finance service (backend)
2. `cdk deploy` for API Gateway updates
3. `aws ecs update-service --force-new-deployment` for finance ECS service
4. Deploy frontend build
5. Run `npx ts-node scripts/smoke-tests/finance-e2e-flow.ts` against production
6. Run `npx ts-node scripts/smoke-tests/finance-billing-flow.ts` against production

**Validate:** Both smoke test suites pass. Health endpoints return 200. Logs show no errors.

---

## Summary

| Sprint | Focus | Tickets | Demo |
|--------|-------|---------|------|
| 1 | Fix invoice bug + Unpark MFE + Extract services | 7 | Finance live at `/finance`, invoice bug fixed |
| 2 | Move all billing pages to finance MFE + redirects + ABAC | 7 | Full billing from `/finance/billing`, settings cleaned |
| 3 | Student picker + Live data + Cross-linking + Tests | 6 | No raw UUIDs, real-time stats, comprehensive tests |
| 4 | Cleanup + Infrastructure + Production deploy | 5 | Old files deleted, Docker updated, smoke tests passing |
| **Total** | | **25** | |
