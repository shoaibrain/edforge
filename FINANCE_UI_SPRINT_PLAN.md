# Finance Module UI/UX — Audit & Sprint Plan

## Table of Contents
- [Audit: Issues Found](#audit-issues-found)
- [Proposed Architecture](#proposed-architecture)
- [Sprint 1: Critical Bug Fixes & Data Layer Corrections](#sprint-1-critical-bug-fixes--data-layer-corrections)
- [Sprint 2: Remove Redundancy — Merge Dashboard into Overview](#sprint-2-remove-redundancy--merge-dashboard-into-overview)
- [Sprint 3: Sidebar & Navigation Cleanup](#sprint-3-sidebar--navigation-cleanup)
- [Sprint 4: Overview Page — Google-Standard Redesign](#sprint-4-overview-page--google-standard-redesign)
- [Sprint 5: Student Accounts & List Pages Polish](#sprint-5-student-accounts--list-pages-polish)
- [Review Notes & Risk Register](#review-notes--risk-register)

---

## Audit: Issues Found

### P0 — Critical Bugs

| # | Issue | File(s) | Root Cause | Resolves In |
|---|-------|---------|------------|-------------|
| BUG-1 | **Student Accounts page shows "No student accounts found" despite API returning data** | `packages/finance-services/src/services/invoices.service.ts:97-105`, `apps/finance/src/routes/billing/accounts/index.tsx:469-471` | The API returns `{ items: [...], hasMore: false }` (paginated shape). The service `getStudentAccounts()` declares return type `Promise<StudentAccount[]>` and passes the raw response through. In the component, `Array.isArray(accounts)` evaluates `false` because the response is an object `{ items, hasMore }`, not an array. Fallback `[]` is used → empty table. | Ticket 1.1 |
| BUG-2 | **PaymentsTab dead filter — shows ALL school payments for every student** | `apps/finance/src/routes/billing/accounts/index.tsx:245-248` | `studentPayments` filter has `return true` (line 247), meaning it never actually filters by student. The code falls through to `PaymentsFromLedger` anyway, but the full `useSchoolPayments(schoolId)` call is wasted — fetching all school payments and discarding them. | Ticket 1.2 (remove dead code), Ticket 5.3 (replace with proper filter) |

### P1 — Redundancy

| # | Issue | Description | Resolves In |
|---|-------|-------------|-------------|
| RED-1 | **Three pages all call `useDashboardSummary` for the same KPI data** | Overview (`/finance`), Billing landing (`/finance/billing`), and Dashboard (`/finance/dashboard`) all fetch and display the same 4 summary metrics (Total Invoiced, Total Collected, Outstanding, Overdue). | Ticket 2.1, 2.4, 2.5 |
| RED-2 | **Overview "Quick Access" cards duplicate sidebar navigation** | The 4 Quick Access cards (Billing, Student Accounts, Financial Reports, Fee Structures) link to the exact same destinations as the sidebar links. Double navigation for no value. | Ticket 2.1, 2.2 |
| RED-3 | **Billing landing page (`/finance/billing`) is an unnecessary intermediate layer** | It shows the same KPIs as Overview + 4 action cards (Student Accounts, All Invoices, Payments, Record Payment) that duplicate sidebar and Overview Quick Access. User has to click through this page to reach actual tools. | Ticket 2.5 |
| RED-4 | **Dashboard page is a detailed duplicate of Overview** | Dashboard shows 5 summary cards (same 4 KPIs + collection rate), plus breakdowns and recent activity. This is what the Overview page should show — having a separate Dashboard is confusing. | Ticket 2.1, 2.4 |
| RED-5 | **Widget visibility menu is premature** | The 3-dot menu on Overview only controls 2 widgets (Quick stats, Quick access). Over-engineering for minimal value. | Ticket 2.2 |

### P2 — UX / Information Architecture

| # | Issue | Description | Resolves In |
|---|-------|-------------|-------------|
| UX-1 | **"Reports" sidebar link opens "Financial Dashboard" page** | Naming mismatch creates confusion. The sidebar says "Reports", the page title says "Financial Dashboard". | Ticket 3.1 (removes "Reports" link entirely) |
| UX-2 | **No direct "Invoices" link in sidebar** | User must go Overview → Quick Access → Billing → All Invoices, or know the URL. Invoices are the primary billing artifact but have no sidebar entry. | Ticket 3.1 |
| UX-3 | **Inconsistent stat card designs across 3 pages** | Overview uses 180px carousel cards with icons. Billing uses horizontal stat cards. Dashboard uses border-based summary cards. Three different designs for the same data. | Ticket 4.1, 4.2 |
| UX-4 | **Stat carousel on Overview feels cramped on desktop** | Fixed 180px width cards with horizontal scroll on a wide screen wastes space. Desktop users see ~4 cards with scroll arrows — a simple grid would be cleaner. | Ticket 4.2 |
| UX-5 | **Invoice ↔ Student Account relationship unclear in UI** | No visible linkage in the Student Accounts page explaining that accounts are created automatically when invoices are generated. The empty state message is the only hint. | Ticket 5.4 |

### P3 — Code Quality

| # | Issue | Description | Resolves In |
|---|-------|-------------|-------------|
| CQ-1 | **`getStudentAccounts` return type mismatch** | Service declares `Promise<StudentAccount[]>` but API returns paginated `{ items, hasMore }`. TypeScript doesn't catch this at runtime because `apiGet` generic strips the actual shape. | Ticket 1.1 |
| CQ-2 | **Dead code in PaymentsTab** | `useSchoolPayments` is called, filtered to `return true`, then immediately abandoned in favor of `PaymentsFromLedger`. The entire `PaymentsTab` function body before `return <PaymentsFromLedger>` is dead. | Ticket 1.2 |
| CQ-3 | **`react-spring` + `framer-motion` dual animation libraries** | `ModuleOverviewPage` uses both `@react-spring/web` (for ActionCard hover) and `framer-motion` (for everything else). Should use one. | Ticket 2.2, 2.3 |

---

## Proposed Architecture

### Before (Current)
```
/finance                → Overview (Quick Stats carousel + Quick Access cards)
/finance/billing        → Billing Landing (KPI cards + action cards)
/finance/billing/accounts    → Student Accounts
/finance/billing/invoices    → Invoice List
/finance/billing/invoices/$invoiceId → Invoice Detail
/finance/billing/invoices/bulk-generate → Bulk Generate
/finance/billing/payments    → Payment List
/finance/billing/payments/record → Record Payment
/finance/dashboard      → Financial Dashboard (duplicate of Overview)
/finance/configuration/fee-structures → Fee Structures
/finance/configuration/payment-gateways → Payment Gateways
```

### After (Proposed)
```
/finance                → Finance Home (merged Dashboard + Overview)
                          ├─ KPI Summary Cards (responsive grid, not carousel)
                          ├─ Invoice Status Breakdown
                          ├─ Payment Methods Breakdown
                          ├─ Recent Activity Feed
                          ├─ Date filters + Academic Year + CSV Export
                          └─ No Quick Access cards (sidebar handles navigation)

/finance/invoices            → Invoice List (promoted from /billing/invoices)
/finance/invoices/$invoiceId → Invoice Detail (parameter name preserved)
/finance/invoices/bulk-generate → Bulk Generate
/finance/accounts            → Student Accounts (promoted from /billing/accounts)
/finance/payments            → Payment List (promoted from /billing/payments)
/finance/payments/record     → Record Payment
/finance/fee-structures      → Fee Structures (promoted from /configuration/fee-structures)
/finance/payment-gateways    → Payment Gateways
```

### Sidebar (After)
```
Overview                       → /finance
─── BILLING ───
Invoices                       → /finance/invoices
Student Accounts               → /finance/accounts
Payments                       → /finance/payments
─── CONFIGURATION ───
Fee Structures                 → /finance/fee-structures
Payment Gateways               → /finance/payment-gateways
```

### Key Decisions
1. **Remove `/finance/billing` intermediate page** — its KPI stats merge into Overview, its action cards are unnecessary because the sidebar provides direct navigation.
2. **Remove `/finance/dashboard` route** — merge all dashboard content (breakdowns, activity feed, filters, export) into the Overview page.
3. **Flatten URL structure** — `/finance/billing/invoices` → `/finance/invoices`. Fewer nesting levels = clearer mental model.
4. **Remove Quick Access cards** — sidebar already provides all the navigation. Overview should show *data*, not *navigation*.
5. **Add Invoices directly to sidebar** — it's the most-used billing tool but currently hidden behind an intermediate page.
6. **Preserve `$invoiceId` parameter name** — all `useParams()` consumers use `invoiceId`, not `id`. No parameter rename.

---

## Sprint 1: Critical Bug Fixes & Data Layer Corrections

**Goal:** Fix the Student Accounts rendering bug and clean up dead code paths. After this sprint, Student Accounts page correctly renders data from the API.

**Demo Criteria:** Navigate to `/finance/billing/accounts` → see student account rows with correct balances, totals, and last payment dates. Expand a row → Ledger/Invoices/Payments tabs all render data.

**Dependency Order:** 1.1 → 1.2 (can be parallel) → 1.3

---

### Ticket 1.1 — Fix `getStudentAccounts` service to handle paginated response

**File:** `packages/finance-services/src/services/invoices.service.ts`

**Problem:** `getStudentAccounts` declares `Promise<StudentAccount[]>` but the API returns `{ items: StudentAccount[], hasMore: boolean }`.

**Change:**
```typescript
// BEFORE
export async function getStudentAccounts(
  schoolId: string,
  params?: { studentId?: string }
): Promise<StudentAccount[]> {
  return apiGet<StudentAccount[]>(
    `/finance/schools/${schoolId}/student-accounts`,
    params as Record<string, unknown>
  )
}

// AFTER
export async function getStudentAccounts(
  schoolId: string,
  params?: { studentId?: string }
): Promise<StudentAccount[]> {
  const response = await apiGet<{ items: StudentAccount[]; hasMore: boolean } | StudentAccount[]>(
    `/finance/schools/${schoolId}/student-accounts`,
    params as Record<string, unknown>
  )
  if (Array.isArray(response)) return response
  return response?.items ?? []
}
```

**Also clean up the component-level defensive check** in `apps/finance/src/routes/billing/accounts/index.tsx:471`:
```typescript
// BEFORE (defensive, now unnecessary)
const accountList: StudentAccount[] = Array.isArray(accounts) ? accounts : []

// AFTER (service guarantees array)
const accountList: StudentAccount[] = accounts ?? []
```

**Validation:**
1. Run the finance MFE locally.
2. Navigate to `/finance/billing/accounts`.
3. Confirm API call to `/api/finance/schools/{schoolId}/student-accounts` returns `{ items: [...], hasMore: false }`.
4. Confirm the UI now renders student account rows matching the API response.
5. Confirm search by student name filters correctly.
6. Expand a row → Ledger, Invoices, and Payments tabs render.

---

### Ticket 1.2 — Remove dead code in PaymentsTab component

**File:** `apps/finance/src/routes/billing/accounts/index.tsx`

**Problem:** `PaymentsTab` calls `useSchoolPayments(schoolId)`, applies a filter that `return true`, then ignores the result and renders `<PaymentsFromLedger>` instead. The `useSchoolPayments` call is wasted network/memory.

**Change:** Simplify `PaymentsTab` to only render `PaymentsFromLedger`:
```typescript
// BEFORE: 23 lines of dead code with useSchoolPayments
function PaymentsTab({ schoolId, studentId }: { schoolId: string; studentId: string }) {
  const { data: allPayments, isLoading } = useSchoolPayments(schoolId) // WASTED
  const payments = ... // DEAD
  const studentPayments = payments.filter(() => return true) // DEAD
  return <PaymentsFromLedger schoolId={schoolId} studentId={studentId} />
}

// AFTER: Direct delegation (Sprint 5, Ticket 5.3 will replace this with proper per-student payments)
function PaymentsTab({ schoolId, studentId }: { schoolId: string; studentId: string }) {
  return <PaymentsFromLedger schoolId={schoolId} studentId={studentId} />
}
```

**Note:** This ticket intentionally removes the broken filter and keeps the `PaymentsFromLedger` fallback. Ticket 5.3 will later replace `PaymentsFromLedger` with actual per-student payment records using `useSchoolPayments` with correct `studentAccountId` filtering.

**Validation:**
1. Navigate to Student Accounts → expand a row → click Payments tab.
2. Confirm payment data still renders correctly via `PaymentsFromLedger`.
3. Open Network tab → confirm no `useSchoolPayments` network call when only Payments tab is active.

---

### Ticket 1.3 — Add `items` response unwrapping test to finance-services

**File:** `packages/finance-services/src/__tests__/invoices.service.test.ts` (new file)

**Prerequisites:** This package has no test infrastructure yet. This ticket includes:
1. Add `vitest` to devDependencies if not present.
2. Add a `test` script to `packages/finance-services/package.json`.
3. Create the test file with mocked `apiGet`.

**Test cases:**
1. `getStudentAccounts` with paginated response `{ items: [...], hasMore: false }` → returns the `items` array.
2. `getStudentAccounts` with raw array response `[...]` → returns the array as-is.
3. `getStudentAccounts` with empty `{ items: [], hasMore: false }` → returns `[]`.
4. `getStudentAccounts` with `undefined`/`null` response → returns `[]`.

**Validation:** Tests pass: `pnpm --filter @edforge/finance-services test`

---

## Sprint 2: Remove Redundancy — Merge Dashboard into Overview

**Goal:** Eliminate the `/finance/dashboard` and `/finance/billing` intermediate pages. Merge all dashboard content (breakdowns, activity feed, filters, CSV export) into the Overview page at `/finance`. After this sprint, the Overview page is the single source of financial summary data.

**Demo Criteria:** Navigate to `/finance` → see KPI cards, Invoice Status Breakdown, Payment Methods Breakdown, Recent Activity, date filters, and CSV Export — all on one page. `/finance/dashboard` redirects to `/finance`. `/finance/billing` redirects to `/finance/billing/invoices` (old path, pre-flattening).

**Dependency Order:** 2.1 → 2.2 → 2.3 → 2.4 + 2.5 (parallel) → 2.6 → 2.7

> **IMPORTANT:** Ticket 2.1 MUST complete before 2.4 (dashboard deletion), because 2.1 ports content from the dashboard file. Ticket 2.2 MUST complete before 2.3, because 2.2 removes the component that uses `@react-spring/web`.

---

### Ticket 2.1 — Create unified FinanceOverview page combining Overview + Dashboard

**File:** `apps/finance/src/routes/overview.tsx`

**Change:** Replace the current Overview component with a unified page that includes:
1. Page header ("Finance Overview" with description)
2. Date range filters (From, To) + Academic Year dropdown + Clear Filters button
3. KPI summary cards in a responsive grid (not carousel): Total Invoiced, Total Collected, Outstanding, Overdue, Collection Rate
4. Invoice Status Breakdown (percentage bars)
5. Payment Methods Breakdown (percentage bars)
6. Recent Activity Feed (combined invoices + payments, sorted by date)
7. CSV Export button in header

**Source of truth for each section (port from `dashboard/index.tsx`):**
- KPI cards: `SummaryCard` component (grid layout, 2 cols mobile → 5 cols desktop)
- Breakdowns: `PercentageBar` + breakdown rendering
- Recent Activity: `RecentActivityFeed` component (update navigation paths to current `/billing/invoices/{id}` and `/billing/payments` — these will be updated again in Sprint 3)
- Filters: filter state + UI
- CSV Export: export button + mutation

**Delete from this file:** Remove `ModuleOverviewPage` import, remove `actionCards` array. No Quick Access section.

**Validation:**
1. Navigate to `/finance` → see the unified dashboard.
2. Apply date filters → KPI cards + breakdowns update.
3. Click Export CSV → CSV file downloads.
4. Recent Activity items are clickable and navigate correctly.

---

### Ticket 2.2 — Delete ModuleOverviewPage component and remove `@react-spring/web`

**Files:**
- `apps/finance/src/components/ModuleOverviewPage.tsx` — **delete entire file**
- `apps/finance/rsbuild.config.ts` — remove `'@react-spring/web'` from Module Federation `shared` config

**What this removes:**
- The `ModuleOverviewPage` component (only consumer was Overview page)
- The `WidgetVisibilityMenu` (only controlled Quick Access and Quick Stats toggles)
- The `StatsCarousel` component (replaced by a simple grid in 2.1)
- The `ActionCard` component with `@react-spring/web` hover animations
- The `@react-spring/web` singleton declaration from Module Federation shared config

**Validation:**
1. `grep -r "ModuleOverviewPage" apps/finance/src/` returns no results.
2. `grep -r "@react-spring/web" apps/finance/` returns no results (checks both src and config).
3. `pnpm build --filter finance` succeeds.

---

### Ticket 2.3 — Remove `@react-spring/web` from package dependencies

**Files:**
- `apps/finance/package.json` — remove `@react-spring/web` from dependencies (if present)
- Root `pnpm-lock.yaml` will update automatically

**Note:** The library may be in the monorepo root or workspace-level dependencies. Check both `apps/finance/package.json` and the shared Module Federation config package.

**Validation:**
1. `pnpm install` succeeds.
2. `pnpm build --filter finance` succeeds.
3. Finance MFE `remoteEntry.js` loads in shell without errors.

---

### Ticket 2.4 — Delete Dashboard route and redirect to Overview

**Files:**
- `apps/finance/src/routes/dashboard/index.tsx` — **delete file**
- `apps/finance/src/router.tsx` — remove `dashboardRoute`, add redirect

**Change in router.tsx:**
```typescript
// Remove:
import FinancialDashboardPage from './routes/dashboard/index'
const dashboardRoute = createRoute({ ... path: '/dashboard' ... })

// Add redirect route:
import { redirect } from '@tanstack/react-router'
const dashboardRedirect = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard',
  beforeLoad: () => { throw redirect({ to: '/' }) },
})
```

**Validation:**
1. Navigate to `/finance/dashboard` → redirects to `/finance`.
2. Build succeeds.
3. No remaining imports of the deleted dashboard file.

---

### Ticket 2.5 — Delete Billing landing page and redirect to current invoices path

**Files:**
- `apps/finance/src/routes/billing/index.tsx` — **delete file**
- `apps/finance/src/router.tsx` — remove `billingRoute`, add redirect

**Change:** `/finance/billing` → redirects to `/finance/billing/invoices` (the current, pre-flattening invoices path). Sprint 3 will update this redirect target to `/finance/invoices`.

**Validation:**
1. Navigate to `/finance/billing` → redirects to `/finance/billing/invoices`.
2. Build succeeds.

---

### Ticket 2.6 — Update internal navigation links referencing deleted pages

**Files to check and update:**
- `apps/finance/src/routes/overview.tsx` — ensure `RecentActivityFeed` navigation paths use current `/billing/invoices/{id}` and `/billing/payments`
- All route files — grep for standalone `/billing` or `/dashboard` as navigation targets
- Any `<Link to="/billing">` or `navigate({ to: '/billing' })` → update to appropriate specific page

**Validation:**
1. Click through all sidebar links — no 404s.
2. Click through all navigation links within pages — no 404s or empty pages.
3. `grep -r '"\/billing"' apps/finance/src/routes/` returns no results (no links to deleted billing landing page).
4. `grep -r '"\/dashboard"' apps/finance/src/routes/` returns no results.

---

### Ticket 2.7 — Sprint 2 build verification

**What:** Full monorepo build verification after all Sprint 2 changes.

**Steps:**
1. Run `pnpm build` across the full monorepo.
2. Verify no TypeScript errors in finance MFE or shell.
3. Verify the finance Module Federation `remoteEntry.js` loads correctly in the shell dev server.
4. Verify no console errors on page load.
5. Click through all remaining pages: Overview, Invoices, Invoice Detail, Student Accounts, Payments, Record Payment, Fee Structures, Payment Gateways.

**Validation:** All checks pass. No regressions.

---

## Sprint 3: Sidebar & Navigation Cleanup

**Goal:** Update sidebar navigation to match the new architecture. Add Invoices as a direct sidebar entry. Remove the "Reports" link. Flatten URL paths. Add backward-compatible redirects.

**Demo Criteria:** Sidebar shows: Overview, Invoices, Student Accounts, Payments, Fee Structures, Payment Gateways. All links navigate correctly. Old URLs redirect to new URLs. No intermediate landing pages.

**Dependency Order:** 3.1 + 3.2 (must ship together as one commit) → 3.3

---

### Ticket 3.1 — Update sidebar configuration for Finance module

**File:** `apps/shell/src/config/sidebar-modules.ts`

**Change:** Update the `financeModule` config:
```typescript
const financeModule: ModuleConfig = {
  id: 'finance',
  title: 'Finance',
  icon: DollarSign,
  backTo: { path: '/home', label: 'Back to Home' },
  groups: [
    {
      id: 'main',
      items: [
        { id: 'finance-home', label: 'Overview', icon: GalleryVerticalEnd, href: '/finance',
          permission: { action: 'view', resource: 'billing' } },
      ],
    },
    {
      id: 'billing',
      label: 'BILLING',
      items: [
        { id: 'invoices', label: 'Invoices', icon: FileText, href: '/finance/invoices',
          permission: { action: 'view', resource: 'billing' }, requiresActiveSchool: true },
        { id: 'student-accounts', label: 'Student Accounts', icon: UsersRound, href: '/finance/accounts',
          permission: { action: 'view', resource: 'billing' }, requiresActiveSchool: true },
        { id: 'payments', label: 'Payments', icon: Wallet, href: '/finance/payments',
          permission: { action: 'view', resource: 'billing' }, requiresActiveSchool: true },
      ],
    },
    {
      id: 'configuration',
      label: 'CONFIGURATION',
      items: [
        { id: 'fee-structures', label: 'Fee Structures', icon: CreditCard, href: '/finance/fee-structures',
          permission: { action: 'manage', resource: 'billing' }, requiresActiveSchool: true },
        { id: 'payment-gateways', label: 'Payment Gateways', icon: Settings, href: '/finance/payment-gateways',
          permission: { action: 'manage', resource: 'billing' }, requiresActiveSchool: true },
      ],
    },
  ],
}
```

**Key changes:**
- Remove "Billing" overview link (was `/finance/billing`)
- Add "Invoices" direct link (new, `/finance/invoices`)
- Remove "Reports" link (was `/finance/dashboard`) — **resolves UX-1**
- Update Student Accounts href: `/finance/billing/accounts` → `/finance/accounts`
- Update Payments href: `/finance/billing/payments` → `/finance/payments`
- Update Fee Structures href: `/finance/configuration/fee-structures` → `/finance/fee-structures`
- Add Payment Gateways to sidebar: `/finance/payment-gateways`

**Also check and update** any shell tests in `apps/shell/src/config/__tests__/` that validate sidebar module config structure.

---

### Ticket 3.2 — Flatten finance routes and update all internal navigation references

> **Note:** This ticket was originally split into 3.2 (route changes), 3.3 (navigation references), and 3.4 (redirects). Reviewer identified that these MUST be atomic — changing routes without updating `navigate()` calls and `<Link>` components breaks the app. They are now merged into one ticket.

**File:** `apps/finance/src/router.tsx` + all route component files

**Route path changes:**
```
/billing/invoices              → /invoices
/billing/invoices/$invoiceId   → /invoices/$invoiceId    (parameter name PRESERVED)
/billing/invoices/bulk-generate → /invoices/bulk-generate
/billing/accounts              → /accounts
/billing/payments              → /payments
/billing/payments/record       → /payments/record
/configuration/fee-structures  → /fee-structures
/configuration/payment-gateways → /payment-gateways
```

**Legacy redirect routes (add to router.tsx):**
```
/billing           → /invoices
/billing/invoices  → /invoices
/billing/invoices/$invoiceId → /invoices/$invoiceId
/billing/accounts  → /accounts
/billing/payments  → /payments
/billing/payments/record → /payments/record
/dashboard         → /                     (already added in Sprint 2)
/configuration/fee-structures → /fee-structures
/configuration/payment-gateways → /payment-gateways
```

**Files to update `navigate()` and `<Link>` references:**
- `apps/finance/src/routes/overview.tsx` — RecentActivityFeed navigation targets
- `apps/finance/src/routes/billing/accounts/index.tsx` — invoice detail link on line 196
- `apps/finance/src/routes/billing/invoices/index.tsx` — bulk-generate, record payment links
- `apps/finance/src/routes/billing/invoices/$invoiceId.tsx` — back navigation, payment links
- `apps/finance/src/routes/billing/payments/index.tsx` — record payment link
- Any file referencing `/billing/...` or `/configuration/...` paths

**Note on file locations:** The physical route files remain under `routes/billing/` and `routes/configuration/` directories. Only the `path` property in `router.tsx` changes. Moving file directories is optional cleanup, not required for functionality.

**Validation:**
1. Full click-through test of all navigation:
   - Each sidebar link navigates to correct page
   - Invoice list → Invoice detail → back
   - Student Accounts → expand → Invoices tab → click invoice → detail page
   - Record Payment link from payments page
   - Recent Activity feed links from Overview
   - Bulk generate link from invoices page
2. All old URLs redirect correctly to new URLs.
3. `grep -rn '"/billing/' apps/finance/src/routes/` — no remaining old path references in navigation calls.
4. `pnpm build --filter finance` succeeds.
5. Active sidebar link highlighting works on each page.

---

### Ticket 3.3 — Sprint 3 build verification and shell integration test

**What:** Full integration test after sidebar + route changes.

**Steps:**
1. `pnpm build` across monorepo.
2. Start shell dev server with finance MFE.
3. Verify sidebar renders correctly with new links.
4. Verify each sidebar link activates the correct highlight.
5. Test all old URLs redirect correctly (manually or via script).
6. Verify no TypeScript errors, no console errors.

**Validation:** All checks pass.

---

## Sprint 4: Overview Page — Google-Standard Redesign

**Goal:** Redesign the unified Overview page with clean, intuitive Google Material-inspired design. Consistent card components, proper spacing, clear visual hierarchy, accessibility basics.

**Demo Criteria:** Overview page looks polished: clean card grid, readable breakdowns, consistent typography, responsive on mobile and desktop.

**Dependency Order:** 4.1 → 4.2, 4.3 (parallel) → 4.4 → 4.5 → 4.6

---

### Ticket 4.1 — Design and implement consistent SummaryCard component

**File:** `apps/finance/src/components/SummaryCard.tsx` (new)

**What:** Create a single, reusable summary card component used across the Overview page. Google-inspired: clean white/surface background, subtle border, icon in a colored circle, large value, small label.

**Props:**
```typescript
interface SummaryCardProps {
  label: string
  value: string
  icon: LucideIcon
  iconColorClass: string  // e.g., 'text-blue-600 dark:text-blue-400'
  iconBgClass: string     // e.g., 'bg-blue-100 dark:bg-blue-900/30'
  trend?: { value: string; type: 'up' | 'down' | 'neutral' }
}
```

**Design:**
- `bg-[rgb(var(--surface-primary))]` background card with `border-[rgb(var(--border-primary))]`
- 16px padding
- Label: 12px, uppercase, tracking-wider, `text-[rgb(var(--text-tertiary))]`
- Value: 24px (`text-xl`), bold, `text-[rgb(var(--text-primary))]`
- Icon: 32px circle with colored background, positioned top-right
- Optional trend indicator below value (small text with arrow icon)
- `aria-label` on icon container for screen readers
- Sufficient color contrast ratios for WCAG AA

**Validation:**
1. Component renders correctly when used in the Overview page.
2. Supports dark mode (all colors use CSS variables or dark: variants).
3. Icon has `aria-label` attribute.
4. Trend indicator shows appropriate up/down/neutral arrow.

---

### Ticket 4.2 — Implement responsive KPI card grid on Overview

**File:** `apps/finance/src/routes/overview.tsx`

**Change:** Replace stat carousel with a responsive CSS grid:
- Mobile (< 640px): 2 columns
- Tablet (640-1024px): 3 columns
- Desktop (> 1024px): 5 columns (Total Invoiced, Total Collected, Outstanding, Overdue, Collection Rate)

Use the `SummaryCard` component from Ticket 4.1.

```html
<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
```

**Validation:**
1. Resize browser → cards reflow correctly at each breakpoint.
2. Values match API response data.
3. No horizontal scrolling at any viewport width.

---

### Ticket 4.3 — Implement clean breakdown charts (Invoice Status + Payment Methods)

**File:** `apps/finance/src/routes/overview.tsx`

**Change:** Port and clean up the `PercentageBar` component from the old Dashboard page. Place Invoice Status Breakdown and Payment Methods Breakdown in a 2-column grid below the KPI cards.

**Design improvements:**
- Section titles: 14px (`text-sm`) semibold, not uppercase
- Percentage bars: 6px height, rounded-full, smooth color transitions
- Labels: Capitalize and format (`partially_paid` → `Partially Paid`) — use a `formatStatusLabel` utility
- Show count alongside percentage: `Partially Paid — 1 (25%)`
- Empty state: "No data" message with muted icon

**Validation:**
1. Breakdowns show correct data matching API response.
2. Percentage bars have correct widths.
3. Labels are human-readable (no underscores).
4. Empty state shows when no invoices/payments exist.

---

### Ticket 4.4 — Implement Recent Activity feed on Overview

**File:** `apps/finance/src/routes/overview.tsx`

**Change:** Port `RecentActivityFeed` from old Dashboard page. Clean up:
- Combined list of recent invoices + recent payments, sorted by date descending
- Invoice items show: icon, invoice number, student name, amount, status badge, date
- Payment items show: icon, receipt number, gateway, amount, status badge, date
- Clickable rows navigate to invoice detail (`/invoices/{id}`) or payments page (`/payments`)
- Limit to 10 items with "View all" link

**Validation:**
1. Activity feed shows correct items matching API.
2. Clicking an invoice item navigates to `/invoices/{id}`.
3. Clicking a payment item navigates to `/payments`.
4. Dates are formatted correctly using `formatDate()`.

---

### Ticket 4.5 — Add date filters and CSV export to Overview

**File:** `apps/finance/src/routes/overview.tsx`

**Change:** Port filter UI and export button from old Dashboard page. Place in a filter bar between the header and KPI cards.

**Layout:**
```
[From: date picker] [To: date picker] [Academic Year: dropdown] [Clear Filters]     [Export CSV ↓]
```

**Validation:**
1. Set From/To dates → KPIs and breakdowns update (API called with `from`/`to` query params).
2. Select Academic Year → data filters.
3. Clear Filters resets all.
4. Export CSV downloads a CSV file.

---

### Ticket 4.6 — Remove framer-motion page-level entry animations

**Files:** `apps/finance/src/routes/overview.tsx`, and any other route files using `motion.div` wrappers for full-page entry.

**Change:** Remove the outer `<motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>` wrappers on page-level containers. These add visual jank on navigation and don't follow Google's Material design patterns (which prefer instant page transitions).

**Keep `framer-motion` for:**
- `AnimatePresence` on tab content transitions (Student Accounts expanded rows)
- Subtle loading fade-ins where appropriate

**Validation:**
1. Navigate between pages → instant content rendering, no slide-up animation.
2. Tab transitions in Student Accounts still animate smoothly.
3. Build succeeds; no unused `framer-motion` imports.

---

## Sprint 5: Student Accounts & List Pages Polish

**Goal:** Improve the Student Accounts page with better data display and actual payment records. Apply consistency to all list pages (Invoices, Payments, Student Accounts) with shared components.

> **Note:** Original Sprints 5 and 6 have been merged. Both were UI polish work with no architectural changes, and separately they were underloaded.

**Demo Criteria:** Student Accounts shows enhanced detail view with proper payments. All list pages share consistent status badges, table styles, empty states, and loading skeletons.

**Dependency Order:** 5.1 → 5.2 (parallel), 5.3 → 5.4 → 5.5 → 5.6 → 5.7 → 5.8

---

### Ticket 5.1 — Standardize StatusBadge component across all pages

**File:** `apps/finance/src/components/StatusBadge.tsx` (new)

**What:** Extract the status badge into a shared component. Currently, `statusBadge()`, `paymentStatusBadge()`, and `invoiceStatusBadge` are defined independently in 3 different files with slightly different color maps.

**Component:**
```typescript
interface StatusBadgeProps {
  status: string
  type: 'invoice' | 'payment'
}

export function StatusBadge({ status, type }: StatusBadgeProps) { ... }
```

**Color map (unified):**
- `draft`: gray
- `issued`: blue
- `partially_paid`: amber
- `paid` / `completed`: green
- `overdue` / `failed`: red
- `cancelled`: gray-500
- `refunded` / `partially_refunded`: purple
- `pending` / `processing`: yellow

**Text formatting:** `partially_paid` → `Partially Paid` (capitalize + replace underscores)

**Validation:**
1. All pages (Invoices, Payments, Student Accounts, Overview activity feed) use the shared `StatusBadge`.
2. Colors are consistent across all usages.
3. `grep -r "statusBadge\b" apps/finance/src/routes/` — no remaining inline badge functions.

---

### Ticket 5.2 — Add account summary information to Student Accounts table

**File:** Student Accounts route component (now at `/accounts` route)

**Change:** Enhance the main table:
- Student Name (existing)
- Balance → rename column header to "Outstanding" for clarity
- Total Paid (existing)
- Last Payment Date (existing)
- Status indicator: green dot if balance = 0, amber dot if balance > 0

**Validation:**
1. Table columns render correctly with new header names.
2. Status indicators match the account data.
3. Search by student name still works.

---

### Ticket 5.3 — Replace PaymentsFromLedger with actual payment records per student

**File:** Student Accounts page, PaymentsTab component

**Change:** Replace the `PaymentsFromLedger` workaround with actual payment records filtered by `studentAccountId`:

```typescript
function PaymentsTab({ schoolId, accountId }: { schoolId: string; accountId: string }) {
  const { data: allPayments, isLoading } = useSchoolPayments(schoolId)
  const payments = (Array.isArray(allPayments) ? allPayments : [])
    .filter((p) => p.studentAccountId === accountId)
  // ... render actual payment records
}
```

**Show per payment:**
- Receipt Number
- Date (formatted with `formatDateDual`)
- Amount (formatted with `formatNPR`)
- Gateway (Cash, Bank Transfer, eSewa, etc.) — capitalize
- Status (using shared `StatusBadge` from Ticket 5.1)
- Refund info if applicable (refund amount, reason)

**Note (from component comment):** This client-side filter fetches ALL school payments and filters in-memory. This works for current school sizes but will degrade at scale (100+ payments). A future backend ticket should add a server-side student-scoped payment endpoint (GSI2-based). Track as tech debt.

**Also delete:** Remove the now-unused `PaymentsFromLedger` component and update the `PaymentsTab` prop signature to accept `accountId` instead of `studentId`.

**Validation:**
1. Expand a student account → Payments tab shows actual payment records.
2. Each payment shows gateway, receipt number, and status.
3. Refunded/partially refunded payments show refund details.
4. Only payments for the selected student account appear (not all school payments).

---

### Ticket 5.4 — Improve Ledger tab with better formatting

**File:** Student Accounts page, LedgerTab component

**Change:**
- Format `entryType` properly: `invoice` → "Invoice Charged", `payment` → "Payment Received", `refund` → "Refund Processed", `adjustment` → "Adjustment", `write_off` → "Write-off"
- Show running balance with color coding (green when 0 or credit, red when debit balance)
- Add a summary row at the bottom: Total Debits | Total Credits | Current Balance
- Format dates using `formatDateDual()` for BS + AD Nepali calendar support

**Validation:**
1. Expand a student account → Ledger tab shows properly formatted entries.
2. Running balance is correct and color-coded.
3. Summary row totals match the account balance.

---

### Ticket 5.5 — Add empty state with action prompt for Student Accounts

**File:** Student Accounts page

**Change:** Improve the empty state:
- Icon: Users icon (existing)
- Title: "No student accounts yet"
- Description: "Student accounts are created automatically when you generate invoices for students."
- Action button: "Generate Invoice" → navigates to `/invoices` (or invoice generation modal)

**Validation:**
1. With no student accounts, the empty state renders with the action button.
2. Clicking "Generate Invoice" navigates correctly.

---

### Ticket 5.6 — Standardize table styles across all list pages

**Files:** Invoice list, Payments list, Student Accounts

**Change:** Ensure consistent:
- Table header: `text-xs font-medium uppercase tracking-wider text-[rgb(var(--text-secondary))] bg-[rgb(var(--surface-secondary))]`
- Row hover: `hover:bg-[rgb(var(--surface-secondary))]`
- Cell padding: `px-4 py-3`
- Font size: `text-sm` for data, `text-xs` for headers
- Currency: always `formatNPR()` for full amounts in tables
- Dates: consistent use of `formatDateDual()` for BS+AD

**Validation:**
1. Visual comparison of Invoices, Payments, Student Accounts tables.
2. All tables have identical header styling, row height, padding, and typography.

---

### Ticket 5.7 — Add consistent empty states to Invoices and Payments pages

**Files:** Invoice list page, Payments list page

**Change:** Add empty states matching the pattern from Ticket 5.5:
- Invoices empty: "No invoices yet" + "Generate Invoice" button + description
- Payments empty: "No payments recorded" + description about how payments are created via invoices

**Validation:**
1. Filter to a state with no results → empty state shows.
2. Empty state has clear messaging and action button where applicable.

---

### Ticket 5.8 — Add loading skeletons to list pages

**Files:** Invoice list, Payments list, Student Accounts

**Change:** Replace spinner-only loading states with skeleton loaders:
- Skeleton table headers (gray bars matching column widths)
- 5 skeleton rows with pulsing `animate-pulse` bars
- Skeleton stat cards (if page has summary stats above table)

**Validation:**
1. Navigate to each list page with network throttled → skeleton loads before data.
2. Skeleton layout matches the actual data layout (same number of columns, similar widths).

---

## Review Notes & Risk Register

### Incorporated Reviewer Feedback

| Reviewer Issue | Resolution |
|---------------|------------|
| `@react-spring/web` in `rsbuild.config.ts` not just `package.json` | Ticket 2.2 now explicitly includes `rsbuild.config.ts` shared config cleanup |
| Tickets 3.2 + 3.3 must be atomic (route change + nav update) | Merged into single Ticket 3.2 |
| Ticket 3.4 (redirects) duplicates 3.2 redirect mention | Absorbed into Ticket 3.2; separate Ticket 3.4 deleted |
| Sprint 2 ordering issue (2.4 could delete dashboard before 2.1 ports it) | Added explicit dependency order to Sprint 2 header |
| Ticket 2.5 redirect target ambiguous (pre/post-flattening) | Clarified: redirect to `/finance/billing/invoices` (current path), Sprint 3 updates |
| Ticket 5.3 contradicts 1.2 | Added note in Ticket 1.2 explaining intentional two-phase approach |
| Component-level defensive check not cleaned up in 1.1 | Added to Ticket 1.1 |
| No test infrastructure in finance-services package | Added prerequisites to Ticket 1.3 |
| Storybook reference in 4.1 doesn't exist | Changed to "renders correctly when used in Overview page" |
| `$invoiceId` parameter rename risk | Explicitly preserved `$invoiceId` in Proposed Architecture |
| Sprint 5+6 underloaded separately | Merged into single Sprint 5 |
| Missing build verification ticket | Added Ticket 2.7 and Ticket 3.3 |
| Missing accessibility considerations | Added `aria-label` and contrast requirements to Ticket 4.1 |
| RecentActivityFeed navigation paths need updating | Called out explicitly in Ticket 2.6 and Ticket 3.2 |

### Risk Register

| Risk | Mitigation |
|------|------------|
| Module Federation `remoteEntry.js` breaks after removing `@react-spring/web` from shared config | Ticket 2.7 explicitly verifies MFE loading in shell |
| Client-side payment filtering in Ticket 5.3 degrades at scale (100+ payments) | Documented as tech debt; future backend ticket for server-side student-scoped endpoint needed |
| Old bookmarked URLs break after route flattening | All old paths have redirect routes (Ticket 3.2) |
| React Query cache keys unaffected by route changes | **Verified:** Query keys in `usePayments.ts` use `schoolId` and filter objects, not URL paths. No changes needed. |
| Shell sidebar test may need updates | Called out in Ticket 3.1 |

### API Limitation Notes

**Student Account ↔ Payment Relationship:** There is currently no server-side endpoint to query payments by `studentAccountId`. The client-side filter in Ticket 5.3 fetches all school payments via `GET /finance/schools/{schoolId}/payments` and filters by `studentAccountId` in memory. This is acceptable for schools with <500 payments but needs a dedicated `GET /finance/schools/{schoolId}/student-accounts/{accountId}/payments` endpoint for production scale. The existing codebase comment at `accounts/index.tsx:244` acknowledges this: "Once GSI2-based student payment query is available, replace this client-side filter."

---

## Appendix: Relationship Between Invoice & Student Account

```
Student Account  ← 1:1 per student per school (auto-created with first invoice)
    │
    ├── Invoice 1 (generates a debit ledger entry on issuance)
    │       └── Payment 1 (generates a credit ledger entry on completion)
    │
    ├── Invoice 2
    │       ├── Payment 2a (partial → generates partial credit)
    │       └── Payment 2b (remaining → generates remaining credit)
    │
    └── Refund (generates a debit entry, reversing a prior credit)

Student Account Balance = Sum(debits) - Sum(credits) = Amount currently owed
```

- **Student Account** is created automatically when the first invoice is generated for a student at a school.
- **Invoices** generate debit entries on the student's ledger.
- **Payments** generate credit entries on the student's ledger.
- **Refunds** generate debit entries (reverse a prior credit).
- The **balance** field on Student Account represents the current amount owed.

---

## Summary

| Sprint | Focus | Tickets | Key Outcome |
|--------|-------|---------|-------------|
| 1 | Bug Fixes | 3 | Student Accounts renders data; dead code removed |
| 2 | Remove Redundancy | 7 | Single unified Overview; Dashboard + Billing landing deleted |
| 3 | Sidebar & Navigation | 3 | Flat URL structure; Invoices in sidebar; clean navigation; legacy redirects |
| 4 | Overview Redesign | 6 | Google-standard Overview with KPIs, breakdowns, activity feed |
| 5 | List Pages Polish | 8 | Enhanced Student Accounts, shared StatusBadge, consistent tables/skeletons |

**Total: 27 tickets across 5 sprints**

Each sprint produces a demoable, deployable increment that builds on the previous sprint's work.
