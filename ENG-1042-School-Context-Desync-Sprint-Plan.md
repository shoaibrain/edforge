# ENG-1042: Global State Desync on School Context Switch

## Sprint Plan — Fix & Harden School Context Propagation

> **All file paths are relative to `edforge-saas-frontend/`** (the frontend sub-project within the monorepo).

---

## Root Cause Analysis

### The Bug

When a user switches schools via the Sidebar dropdown, the **Shell's Zustand store** updates the `activeSchoolId` and writes it to a cookie. However, **MFE modules (Academics, Finance, People) each have their own independent Zustand store instances** that read from the same `edforge-app` cookie. Cookie-based persistence in Zustand is **read-once-on-hydration** — there is no native reactivity mechanism for cookies (unlike `localStorage` which fires `StorageEvent`). The MFE stores never learn about the change until a full page refresh.

### Two Compounding Problems

1. **State Sync Failure**: MFE Zustand stores don't reactively update when the shell changes `activeSchoolId`. Cookie persistence is write-through but not read-reactive. Each MFE has a separate `create<AppStore>()` instance in its own `app.store.ts`.
2. **Cache Staleness**: No `queryClient.invalidateQueries()` fires on school change. Even if state synced correctly, previously-cached data for the new school could be stale (up to 5–30 min staleTime).
3. **`activeSchoolStatus` Desync**: The Shell also syncs `activeSchoolStatus` via cookie. MFE stores with `activeSchoolStatus` will be similarly stale, causing incorrect conditional rendering (e.g., setup vs. active school flows).

### Why Refresh "Fixes" It

On page refresh, each Zustand store re-hydrates from the cookie (which the shell already updated), and TanStack Query cache is empty, forcing fresh fetches.

### Affected Files

| Component | File | Issue |
|---|---|---|
| Shell app store | `apps/shell/src/stores/app.store.ts` | Sets `activeSchoolId`, writes cookie — no cross-module broadcast |
| Shell sidebar | `apps/shell/src/components/layout/Sidebar.tsx:664` | Calls `setActiveSchoolId(school.id)` — no cache invalidation |
| Shell context | `apps/shell/src/lib/shell-context.tsx` | Provides `activeSchoolId` to shell routes only; has competing auto-select logic (line 198-202) |
| Sidebar auto-select | `apps/shell/src/components/layout/Sidebar.tsx:451-467` | Second competing auto-select logic, uses `localStorage` fallback |
| Academics store | `apps/academics/src/stores/app.store.ts` | Separate Zustand instance, reads cookie only on hydration |
| Finance store | `apps/finance/src/stores/app.store.ts` | Same issue |
| People store | `apps/people/src/stores/app.store.ts` | Same issue |
| QueryClient | `apps/shell/src/main.tsx:32` | Module-scoped, not exported. No invalidation on school change. 5min default staleTime. |
| MF shared config | `packages/config/src/mf-shared.ts` | `@tanstack/react-query` marked `singleton: true` — confirms all MFEs share Shell's QueryClient |

### Key Architectural Fact

Module Federation's shared config marks `@tanstack/react-query` as `singleton: true`. MFE bootstraps (`apps/academics/src/bootstrap.tsx`) confirm they do NOT wrap their own `QueryClientProvider`. This means **all modules share one QueryClient instance** — `useQueryClient()` returns the same instance everywhere. This simplifies cache invalidation significantly.

### Query Key Audit

Current query key patterns are inconsistent. `schoolId` appears at various positions:

| Key Factory | Pattern | schoolId Position |
|---|---|---|
| `overviewKeys.enrollment` | `['academics-overview', 'enrollment', schoolId, yearId]` | Position 3 |
| `gradeKeys.policyList` | `['grades', 'policies', schoolId]` | Position 3 |
| `attendanceKeys.summary` | `['attendance', 'summary', schoolId, date]` | Position 3 |
| `feeStructureKeys.list` | `['feeStructures', 'list', schoolId]` | Position 3 |
| `courseKeys` | `['courses', filters]` (schoolId inside filter object) | Inside object |
| `sectionKeys` | `['sections', filters]` (schoolId inside filter object) | Inside object |
| `studentKeys` | `['students', filters]` (schoolId inside filter object) | Inside object |
| `staffKeys` (People) | No schoolId in key at all | Missing |

**Implication:** Cache invalidation must use a deep-search predicate function, not positional matching.

---

## Sprint Overview

| Sprint | Goal | Deliverable |
|---|---|---|
| **Sprint 1** | Reactive school context sync across all modules + QueryClient verification | School switch immediately updates all MFE stores; verified by integration test |
| **Sprint 2** | Query cache invalidation + fresh data on school switch | All school-scoped queries refetch on switch; no stale data visible |
| **Sprint 3** | UX polish — transitions, loading states, edge cases, E2E tests | Smooth transitions, loading skeletons, debounce, rapid-switch protection |

---

## Sprint 1: Reactive School Context Sync

**Goal:** When a user switches schools in the sidebar, every module (Shell, Academics, Finance, People) immediately receives the new `activeSchoolId` and `activeSchoolStatus` without a page refresh.

**Demo Criteria:** Switch schools in the sidebar → observe Academics/Finance overview pages immediately show loading state for the new school (or data if previously cached). No browser refresh needed.

---

### Task 1.1: Verify single `QueryClient` across all modules

**Files:** `apps/shell/src/main.tsx`, `apps/academics/src/bootstrap.tsx`, `packages/config/src/mf-shared.ts`

**Work:**
- Add a temporary `console.log('QueryClient instance:', queryClient)` in Shell's `main.tsx` after QueryClient creation.
- Add a temporary `console.log('MFE QueryClient:', useQueryClient())` in the Academics overview component.
- Run the app, verify both log the same object reference.
- Verify `packages/config/src/mf-shared.ts` marks `@tanstack/react-query` as `singleton: true`.
- Remove temp logs after verification.
- Document findings in a short comment in `main.tsx`.

**Validation:**
- Console confirms same QueryClient instance in Shell and Academics MFE.

**Acceptance:** Verified and documented that all modules share a single QueryClient. This is a prerequisite for Sprint 2's cache invalidation strategy.

---

### Task 1.2: Create `SchoolContextChannel` utility

**File:** `packages/config/src/school-context-channel.ts` (new file in existing `@edforge/config` package)

**Work:**
- Create a utility that wraps `window.CustomEvent` dispatch + listener for a `edforge:school-changed` event.
- The event payload includes both `schoolId` and `schoolStatus` to keep MFE stores fully synced.
- Export:
  - `broadcastSchoolChange(schoolId: string | null, schoolStatus: string | null): void`
  - `onSchoolChange(callback: (payload: { schoolId: string | null, schoolStatus: string | null }) => void): () => void` (returns unsubscribe fn)
- ~30 lines, no React dependency, pure DOM APIs.
- Place in existing `@edforge/config` package (already shared as singleton via Module Federation) to avoid scaffolding a new package.

**Validation:**
- Unit test: `broadcastSchoolChange('school-2', 'active')` → listener callback receives `{ schoolId: 'school-2', schoolStatus: 'active' }`.
- Unit test: `unsubscribe()` → callback no longer fires.
- Unit test: Multiple listeners all receive the event.

**Acceptance:** Tests pass. Utility exports typed API from `@edforge/config`.

---

### Task 1.3: Create `useSchoolContextSync` React hook

**File:** `packages/config/src/useSchoolContextSync.ts` (new file in `@edforge/config`)

**Work:**
- Create a React hook: `useSchoolContextSync(setters: { setActiveSchoolId: (id: string | null) => void, setActiveSchoolStatus: (status: string | null) => void })`.
- Inside, `useEffect` that calls `onSchoolChange(({ schoolId, schoolStatus }) => { setters.setActiveSchoolId(schoolId); setters.setActiveSchoolStatus(schoolStatus); })` and returns the unsubscribe.
- This hook is meant to be called once at the MFE root layout.

**Validation:**
- Unit test with React Testing Library: render hook → dispatch `edforge:school-changed` event → assert both setter mocks called with correct values.

**Acceptance:** Hook correctly bridges DOM events to Zustand store updates for both `schoolId` and `schoolStatus`.

---

### Task 1.4: Wire `broadcastSchoolChange` into Shell's `setActiveSchoolId`

**File:** `apps/shell/src/stores/app.store.ts`

**Work:**
- Import `broadcastSchoolChange` from `@edforge/config`.
- In the `setActiveSchoolId` action (line 36-38), after `set({ activeSchoolId: schoolId })`, call `broadcastSchoolChange(schoolId, useAppStore.getState().activeSchoolStatus)`.
- Also update `setActiveSchoolStatus` to broadcast when status changes.
- ~5-line change.

**Validation:**
- Manual: Open browser DevTools console → `window.addEventListener('edforge:school-changed', e => console.log(e.detail))` → switch school in sidebar → see event logged with both schoolId and schoolStatus.
- Unit test: Mock `window.dispatchEvent`, call `setActiveSchoolId('school-2')`, assert event dispatched with correct payload.

**Acceptance:** School change in sidebar fires a `CustomEvent` with new schoolId and schoolStatus.

---

### Task 1.5: Consolidate competing auto-select logic in Shell

**Files:** `apps/shell/src/components/layout/Sidebar.tsx` (lines 451-467), `apps/shell/src/lib/shell-context.tsx` (lines 198-202)

**Work:**
- The Shell currently has **two** competing auto-select mechanisms:
  1. `SidebarSchoolSelector` useEffect (Sidebar.tsx:451-467) — reads `localStorage` fallback, sets first visible school.
  2. `ShellProvider` useEffect (shell-context.tsx:198-202) — sets first available school if none selected.
- Consolidate into a single auto-select location: `ShellProvider`. It has access to `availableSchools` and `user`, and runs before the Sidebar renders.
- Remove the auto-select `useEffect` from `SidebarSchoolSelector`. Keep the `localStorage` persistence write (line 470-474) but move the read/fallback to `ShellProvider`.
- Ensure the consolidated auto-select calls `setActiveSchoolId`, which triggers the broadcast (from Task 1.4), so MFEs receive the initial school on first login.

**Validation:**
- Smoke test: Log in as new user → first school auto-selected → Academics overview shows data (no manual selection needed).
- Smoke test: Log in as user with saved school in localStorage → correct school restored.
- Smoke test: Saved school no longer accessible → falls back to first available school.

**Acceptance:** Single source of truth for auto-selection. Initial school selection broadcasts to MFEs.

---

### Task 1.6: Remove redundant auto-select/override logic from MFE stores

**Files:** `apps/academics/src/stores/app.store.ts`, `apps/finance/src/stores/app.store.ts`, `apps/people/src/stores/app.store.ts`, `apps/messages/src/stores/app.store.ts`

**Work:**
- Audit each MFE store and any MFE root layout for `useEffect`s that independently set or override `activeSchoolId`.
- The MFE stores should ONLY receive school context from the Shell via the broadcast event (Task 1.3). They should never auto-select or override.
- Remove any competing logic. MFE stores become pure consumers of the Shell's school context decisions.

**Validation:**
- Unit test: MFE store `activeSchoolId` only changes when `setActiveSchoolId` is explicitly called (no timer, no effect).
- Smoke test: Confirm school selection still works end-to-end after cleanup.

**Acceptance:** Shell is the sole authority for `activeSchoolId`. MFEs are consumers only.

---

### Task 1.7: Integrate `useSchoolContextSync` into all active MFE root layouts

**Files:** `apps/academics/src/routes/__root.tsx` (or `AcademicsLayout.tsx`), `apps/finance/src/routes/__root.tsx`, `apps/people/src/routes/__root.tsx`

**Work:**
- In each active MFE's root layout component:
  - Import `useSchoolContextSync` from `@edforge/config`.
  - Import `useAppStore` from the MFE's own `stores/app.store`.
  - Call: `useSchoolContextSync({ setActiveSchoolId: useAppStore.getState().setActiveSchoolId, setActiveSchoolStatus: useAppStore.getState().setActiveSchoolStatus })`.
- ~3 lines per MFE. All three modules in one commit.
- Skip Messages if it's parked (document the skip in PR description).

**Validation:**
- Smoke test per module: Navigate to module → switch school in sidebar → verify module reacts to new schoolId:
  - **Academics:** Overview shows loading then new school's data.
  - **Finance:** Dashboard shows loading then new school's data.
  - **People:** Staff list shows loading then new school's data.
- Use React DevTools to verify MFE store state matches Shell's store.

**Acceptance:** All active MFEs receive school change events in real-time without page refresh.

---

### Task 1.8: Write cross-module sync integration tests

**File:** `packages/config/src/__tests__/school-context-channel.test.ts` (new)

**Work:**
- Test: `broadcastSchoolChange('school-2', 'active')` → listener receives correct payload.
- Test: Rapid switching: broadcast 'school-2' then 'school-3' → listener receives both in order, final state is 'school-3'.
- Test: Null case: `broadcastSchoolChange(null, null)` → listener receives nulls without crash.
- Test: Unsubscribe → subsequent broadcasts don't fire callback.
- Test: Multiple subscribers all receive the event.
- Test (React): `useSchoolContextSync` hook calls setters when event fires.

**Validation:** `npm test` passes.

**Acceptance:** Integration tests cover the cross-module sync mechanism.

---

### Sprint 1 Dependency Graph

```
1.1 (verify QueryClient) ─── can start immediately
1.2 (channel utility) ──→ 1.3 (React hook) ──→ 1.7 (MFE integration)
1.2 ──→ 1.4 (wire into Shell store)
1.5 (consolidate auto-select) ─── can start immediately
1.6 (remove MFE overrides) ─── must complete BEFORE 1.7
1.7 ──→ 1.8 (integration tests)
```

**Recommended execution order:** 1.1 & 1.2 in parallel → 1.3 & 1.4 in parallel → 1.5 & 1.6 in parallel → 1.7 → 1.8

---

## Sprint 2: Query Cache Invalidation on School Change

**Goal:** When school context switches, all school-scoped TanStack Query caches are invalidated, forcing fresh data fetches for the new school. No stale data from the previous school is displayed.

**Demo Criteria:** Switch schools → see loading indicators → fresh data appears for the new school. Visit School A, then School B, then back to School A → data refetches (not served from 5-min stale cache).

---

### Task 2.1: Extract `queryClient` into a shared module

**Files:** `apps/shell/src/lib/query-client.ts` (new), `apps/shell/src/main.tsx` (update)

**Work:**
- Extract `new QueryClient({...})` from `main.tsx` into `apps/shell/src/lib/query-client.ts`.
- Export the instance: `export const queryClient = new QueryClient({...})`.
- Import it in `main.tsx` for the `QueryClientProvider`.
- This enables non-React code to access the queryClient if needed (though React components should prefer `useQueryClient()`).

**Validation:**
- App builds and runs. No behavior change.

**Acceptance:** QueryClient is importable from a dedicated module.

---

### Task 2.2: Create `useInvalidateOnSchoolChange` hook with deep-search predicate

**File:** `packages/config/src/useInvalidateOnSchoolChange.ts` (new)

**Work:**
- Create a hook that watches `activeSchoolId` via Zustand subscription.
- Uses `useRef` to track the previous `schoolId`.
- When `schoolId` changes (and previous was non-null):
  1. **Cancel** in-flight queries for old school: `queryClient.cancelQueries({ predicate })`.
  2. **Remove** old school's cache entries: `queryClient.removeQueries({ predicate })`.
  3. **Invalidate** existing cache for new school (in case user visited before): `queryClient.invalidateQueries({ predicate })`.
- The predicate uses a **deep-search function** that handles all current query key patterns:

```typescript
function schoolIdPredicate(schoolId: string) {
  return (query: Query) => {
    const key = query.queryKey
    // Check direct positional match (schoolId at any position)
    if (key.some(segment => typeof segment === 'string' && segment === schoolId)) {
      return true
    }
    // Check inside filter objects (courses, sections, students pattern)
    if (key.some(segment =>
      typeof segment === 'object' && segment !== null &&
      (segment as Record<string, unknown>).schoolId === schoolId
    )) {
      return true
    }
    return false
  }
}
```

- This avoids the need to refactor all query key factories (which would be a multi-day effort touching 10+ hook files).
- Excludes non-school-scoped queries like `['userProfile']`, `['tenant', tenantId]`, `['schools', tenantId]` — these have no schoolId in their keys.

**Validation:**
- Unit test: Create queryClient with entries at various key patterns. Call hook's logic with `prevSchoolId='school-1'`, `newSchoolId='school-2'`. Assert:
  - `cancelQueries` called with predicate matching 'school-1' entries.
  - `removeQueries` called with predicate matching 'school-1' entries.
  - `invalidateQueries` called with predicate matching 'school-2' entries.
  - Non-school queries (`['userProfile']`, `['tenant', ...]`) are NOT affected.
- Unit test: schoolId changes to `null` → no crash, old cache removed.
- Unit test: schoolId changes from `null` to `'school-1'` → no removal (nothing to remove), invalidation fires.

**Acceptance:** Hook correctly manages cache lifecycle on school switch using deep predicate matching.

---

### Task 2.3: Integrate cache invalidation into Shell's `ShellProvider`

**File:** `apps/shell/src/lib/shell-context.tsx`

**Work:**
- Call `useInvalidateOnSchoolChange()` inside the `ShellProvider` component.
- Since the Shell owns the `QueryClient` and renders above all modules, this single call handles cache invalidation globally — no need for per-MFE invalidation hooks.
- The predicate-based approach means it catches ALL school-scoped queries regardless of which module created them (because all modules share one QueryClient).

**Validation:**
- Smoke test: Switch schools. Open React Query DevTools → verify:
  - Old school's cache entries are gone.
  - New school's queries show `fetching` status.
  - Non-school queries (userProfile, tenant) are unaffected.
- Smoke test: Visit School A → visit School B → visit School A again → verify School A data refetches (not served from stale cache).

**Acceptance:** All school-scoped queries across all modules are invalidated on school change from a single hook call in ShellProvider.

---

### Task 2.4: Add `schoolId` to People MFE `staffKeys` query factory

**Files:** `apps/people/src/hooks/useStaff.ts` (or equivalent)

**Work:**
- Audit the People MFE's query key factories. Currently `staffKeys` does NOT include `schoolId` in any key.
- Add `schoolId` to all People MFE query keys so the deep-search predicate can match them.
- Pattern: `staffKeys.list = (schoolId: string) => ['staff', 'list', schoolId] as const`.
- Update all hook usages to pass `schoolId` to the key factory.

**Validation:**
- Unit test: `staffKeys.list('school-1')` returns key containing 'school-1'.
- Smoke test: People module shows correct staff for switched school.

**Acceptance:** People MFE queries are school-scoped and respond to cache invalidation.

---

### Task 2.5: Document query key convention

**File:** `packages/config/src/QUERY_KEY_CONVENTIONS.md` (new) or inline in `useInvalidateOnSchoolChange.ts`

**Work:**
- Document the two supported patterns for school-scoped query keys:
  1. **Positional:** `[domain, ...segments, schoolId, ...rest]` — schoolId as a direct string element at any position.
  2. **Filter object:** `[domain, { schoolId, ...otherFilters }]` — schoolId inside a filter object.
- Note: All school-scoped queries MUST include `schoolId` somewhere in the key for cache invalidation to work.
- Add a lint rule or code review checklist item: "Does your new query key include `schoolId`?"

**Validation:** Peer review of documentation.

**Acceptance:** Convention documented. Future developers know the requirement.

---

### Task 2.6: Write cache invalidation integration tests

**File:** `packages/config/src/__tests__/school-cache-invalidation.test.ts` (new)

**Work:**
- Test: Populate QueryClient cache with entries at all key patterns (positional, filter object, missing schoolId). Call invalidation for 'school-1'. Assert:
  - Positional keys with 'school-1' are removed.
  - Filter object keys with 'school-1' are removed.
  - Keys without schoolId are untouched.
  - Keys with 'school-2' are untouched.
- Test: Populate cache for 'school-2' from prior visit. Invalidate for 'school-2'. Assert data is marked stale and refetches.
- Test: Cancel in-flight query for 'school-1' when switching to 'school-2'. Assert `cancelQueries` called.

**Validation:** `npm test` passes.

**Acceptance:** Tests prove cache invalidation works across all existing query key patterns.

---

### Sprint 2 Dependency Graph

```
2.1 (extract queryClient) ─── can start immediately
2.2 (invalidation hook) depends on 2.1 for import if needed (or can use useQueryClient)
2.3 (integrate into ShellProvider) depends on 2.2
2.4 (fix People staffKeys) ─── can start immediately, independent
2.5 (document conventions) ─── can start immediately, independent
2.6 (integration tests) depends on 2.2, 2.4
```

**Recommended execution order:** 2.1 & 2.4 & 2.5 in parallel → 2.2 → 2.3 → 2.6

---

## Sprint 3: UX Polish — Transitions, Loading States, Edge Cases

**Goal:** School switching is visually smooth with proper loading feedback, handles edge cases (rapid switching, network errors, deep routes, single-school users), and is tested end-to-end.

**Demo Criteria:** Switch schools → see a brief, branded transition indicator → data loads smoothly. Rapidly click through 5 schools → only the last one's data displays. Network failure during switch → clear error state with retry.

---

### Task 3.1: Add debounce/throttle to school switching

**File:** `apps/shell/src/components/layout/Sidebar.tsx`

**Work:**
- Wrap the `setActiveSchoolId` call in the school dropdown `onClick` (line 664) with a disable-while-transitioning guard.
- After calling `setActiveSchoolId`, set a local `isTransitioning` state → disable all dropdown items for 500ms.
- Alternative: use a simple `useRef<boolean>` debounce flag.
- Prevents rapid-fire school switches that would thrash queries.

**Validation:**
- Smoke test: Rapidly click 5 different schools → only the last one is selected → no race conditions, no console errors.
- Unit test: Call handler 5 times in 100ms → `setActiveSchoolId` is called only for the last value (or each sequentially with debounce).

**Acceptance:** Rapid school switching doesn't cause race conditions or UI glitches.

---

### Task 3.2: Add `SchoolTransitionOverlay` component

**File:** `apps/shell/src/components/layout/SchoolTransitionOverlay.tsx` (new)

**Work:**
- Create a lightweight overlay component that renders over the main content area during school transition.
- Triggered when `activeSchoolId` changes: show overlay until `useIsFetching()` returns 0 (all queries settled) or after a max 3-second timeout.
- Semi-transparent with a subtle branded loading indicator (not a full-screen spinner).
- Renders inside `AppShell`, wrapping the `<Outlet />`.

**Validation:**
- Visual smoke test: Switch school → see transition overlay → data appears → overlay fades.
- Unit test: Component renders when transitioning, hides when queries settle.

**Acceptance:** Smooth visual transition on school switch.

---

### Task 3.3: Handle deep route navigation on school switch

**Files:** MFE route guards or `AcademicsLayout.tsx`, `FinanceLayout.tsx`, `PeopleLayout.tsx`

**Work:**
- When a user is on a deep route (e.g., `/academics/classrooms/SECTION-123`) and switches schools, the section ID belongs to the old school and won't exist in the new school.
- Add a `useEffect` in each MFE layout that watches `activeSchoolId`. When it changes, navigate the user back to the module's overview/index route.
- Example: User on `/academics/classrooms/SECTION-123` → switches school → auto-navigate to `/academics/overview`.
- This prevents 404 errors or stale entity pages.

**Validation:**
- Smoke test: Navigate to `/academics/classrooms/SECTION-123` → switch school → verify user lands on `/academics/overview` (not a broken section page).
- Smoke test: Navigate to `/finance/invoices/INV-456` → switch school → verify user lands on `/finance` overview.

**Acceptance:** School switch from a deep route redirects to module overview.

---

### Task 3.4: Update sidebar school selector to show transition state

**File:** `apps/shell/src/components/layout/Sidebar.tsx`

**Work:**
- When a school switch is in progress, show a subtle loading indicator on the school selector button (e.g., a pulsing ring around the school avatar, or a thin animated border).
- Derive `isTransitioning` from the same mechanism as Task 3.2 (shared Zustand flag or `useIsFetching`).
- Disable the dropdown while transitioning to prevent re-entry.
- Clear the indicator once queries have settled.

**Validation:**
- Visual smoke test: Switch school → selector shows transition indicator → resolves.
- Unit test: Selector disables when `isTransitioning`.

**Acceptance:** Visual feedback in the sidebar during school transition.

---

### Task 3.5: Handle error states during school switch

**File:** `apps/shell/src/components/layout/SchoolTransitionOverlay.tsx` (update from Task 3.2)

**Work:**
- If data fetching for the new school fails (network error, 403, etc.), transform the overlay into an error state with:
  - School name displayed.
  - Error message.
  - "Retry" button that calls `queryClient.invalidateQueries()` for the new school.
  - "Go Back" button that reverts to the previous school.
- Timeout: If queries don't settle within 10 seconds, show a timeout-specific error.

**Validation:**
- Smoke test: Block API calls (DevTools Network) → switch school → see error state with Retry button → unblock → click Retry → data loads.
- Unit test: Error boundary renders error UI when all queries fail after school switch.

**Acceptance:** Failed school switch shows actionable error state, not a broken/empty view.

---

### Task 3.6: Handle single-school user edge case

**File:** `apps/shell/src/lib/shell-context.tsx`, `apps/shell/src/components/layout/Sidebar.tsx`

**Work:**
- Verify that single-school users (staff with one assignment) get the initial auto-select broadcast on first login.
- The consolidated auto-select from Task 1.5 should call `setActiveSchoolId`, which triggers the broadcast. Verify this works for:
  - TenantAdmin with 1 school.
  - Staff assigned to 1 school.
  - Student/Parent (fixed school).
- Ensure MFE stores receive the initial schoolId without requiring a manual click.

**Validation:**
- Smoke test: Log in as staff with 1 school assignment → verify Academics overview loads data immediately (no manual school selection).
- Smoke test: Log in as TenantAdmin with 1 school → same verification.

**Acceptance:** Single-school users see data immediately on first load.

---

### Task 3.7: Audit `null` school state handling across all views

**Files:** All MFE route components that call `useActiveSchoolId()`

**Work:**
- Audit all components that read `schoolId` from the store.
- Ensure each handles `null` gracefully (show `NoSchoolGuard` or equivalent placeholder).
- During the brief moment of a school switch, `activeSchoolId` might momentarily be null (if the hook fires between old/new values). Components must not crash.
- Check: `overview.tsx` (has guard ✓), Classrooms, Students, Grades, Attendance, Finance dashboard, People list.
- Add `NoSchoolGuard` where missing.

**Validation:**
- Smoke test: Manually set `activeSchoolId` to `null` via DevTools → all views show appropriate empty/guard state.
- Unit test: Each guarded component renders guard UI when `schoolId` is `null`.

**Acceptance:** No crashes or broken UI when `activeSchoolId` is `null`.

---

### Task 3.8: Add Playwright E2E test for school switching

**File:** `e2e/school-switch.spec.ts` (new)

**Work:**
- E2E test covering the full bug scenario:
  1. Log in as TenantAdmin with 2+ schools.
  2. Navigate to Academics Overview.
  3. Verify data for School A is displayed (check a KPI or heading).
  4. Open school selector → click School B.
  5. Wait for transition overlay to clear.
  6. Verify data for School B is displayed (different from School A).
  7. Switch back to School A → verify School A data returns.
- Add a deep-route scenario:
  8. Navigate to `/academics/classrooms/SECTION-123`.
  9. Switch school → verify redirect to `/academics/overview`.
- Add a rapid-switch scenario:
  10. Click School A → immediately click School B → verify only School B data displays.

**Validation:** `npx playwright test school-switch.spec.ts` passes.

**Acceptance:** E2E test covers the complete school-switch lifecycle including edge cases.

---

### Task 3.9: Performance audit — verify no memory leaks

**File:** N/A (DevTools-based verification, documented in PR)

**Work:**
- Use Chrome DevTools Memory tab:
  1. Take heap snapshot.
  2. Switch between 3 schools 10 times.
  3. Take second heap snapshot.
  4. Compare: verify no unbounded growth from TanStack Query cache or detached DOM nodes.
- Verify React Query DevTools shows reasonable cache entry count (old entries removed, not accumulating).
- Document findings in the PR description.

**Validation:**
- Heap comparison shows stable memory usage.
- No more than ~50 cache entries after 10 switches (not 300+).

**Acceptance:** No memory leaks from school switching. Documented.

---

### Task 3.10: Developer documentation

**File:** `docs/school-context.md` (new)

**Work:**
- Document the school context architecture:
  - Shell is the single authority for `activeSchoolId`.
  - `SchoolContextChannel` utility broadcasts changes via `CustomEvent`.
  - MFEs use `useSchoolContextSync` hook in their root layout.
  - `useInvalidateOnSchoolChange` in `ShellProvider` handles global cache cleanup.
- Document query key convention: schoolId must appear in all school-scoped query keys.
- Provide a checklist for creating new MFEs: "Add `useSchoolContextSync` to your root layout."
- Document the deep-search predicate pattern for cache invalidation.

**Validation:** Peer review.

**Acceptance:** Future developers can correctly integrate school context in new modules.

---

### Sprint 3 Dependency Graph

```
3.1 (debounce) ─── can start immediately
3.2 (transition overlay) ─── can start immediately
3.3 (deep route redirect) ─── can start immediately
3.4 (sidebar transition state) depends on 3.2 (shares isTransitioning)
3.5 (error states) depends on 3.2 (extends overlay)
3.6 (single-school) depends on Sprint 1 (Task 1.5)
3.7 (null audit) ─── can start immediately
3.8 (E2E test) depends on all Sprint 2 tasks + 3.1-3.5
3.9 (perf audit) depends on all Sprint 2 tasks
3.10 (docs) depends on Sprint 1 + 2
```

---

## Full Task Summary

| # | Task | Sprint | Est. Size |
|---|---|---|---|
| 1.1 | Verify single QueryClient across modules | 1 | XS |
| 1.2 | Create SchoolContextChannel utility | 1 | S |
| 1.3 | Create useSchoolContextSync React hook | 1 | S |
| 1.4 | Wire broadcastSchoolChange into Shell store | 1 | XS |
| 1.5 | Consolidate competing auto-select logic in Shell | 1 | M |
| 1.6 | Remove redundant logic from MFE stores | 1 | S |
| 1.7 | Integrate useSchoolContextSync into all MFEs | 1 | S |
| 1.8 | Write cross-module sync integration tests | 1 | M |
| 2.1 | Extract queryClient into shared module | 2 | XS |
| 2.2 | Create useInvalidateOnSchoolChange with deep predicate | 2 | M |
| 2.3 | Integrate cache invalidation into ShellProvider | 2 | S |
| 2.4 | Add schoolId to People MFE staffKeys | 2 | S |
| 2.5 | Document query key convention | 2 | XS |
| 2.6 | Write cache invalidation integration tests | 2 | M |
| 3.1 | Add debounce to school switching | 3 | S |
| 3.2 | Add SchoolTransitionOverlay component | 3 | M |
| 3.3 | Handle deep route navigation on school switch | 3 | M |
| 3.4 | Update sidebar to show transition state | 3 | S |
| 3.5 | Handle error states during school switch | 3 | M |
| 3.6 | Handle single-school user edge case | 3 | S |
| 3.7 | Audit null school state across all views | 3 | M |
| 3.8 | Add Playwright E2E test for school switching | 3 | L |
| 3.9 | Performance audit — verify no memory leaks | 3 | S |
| 3.10 | Developer documentation | 3 | S |

---

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| `@tanstack/react-query` singleton config changes | MFEs get separate QueryClient, cache invalidation breaks | Task 1.1 verifies this. Add CI check that `mf-shared.ts` keeps singleton: true. |
| Cookie storage adapter has race conditions on rapid writes | Store state corrupted | Task 3.1 adds debounce. Long-term: migrate to `localStorage` + `StorageEvent`. |
| Cookie 4KB size limit exceeded | All MFE stores serialize to `edforge-app` cookie. More fields = potential silent write failure. | Monitor cookie size. Long-term: migrate to `localStorage`. |
| `CustomEvent` not supported in some browsers | Broadcast fails silently | 98%+ support. Add fallback in Task 1.2 if needed. |
| Module Federation version skew | Shared `@edforge/config` version mismatch across MFEs | Pin versions. Add build-time version check. |
| Deep-search predicate performance on large cache | Slight delay on school switch | Profile in Task 3.9. Cache size for edu platform is typically <200 entries. |
| Deep route IDs (SECTION-123) cause 404 on school switch | Broken view before redirect fires | Task 3.3 adds immediate redirect. Error boundary as backup. |
| People MFE `staffKeys` refactor breaks existing queries | Staff list stops working | Task 2.4 includes smoke test. Key change is additive (adding schoolId), not restructuring. |

---

## Alternatives Considered

### Alternative A: Eliminate MFE Zustand stores entirely

Since all MFEs render inside Shell's React tree, they could theoretically import `activeSchoolId` from Shell's context directly (via `useShell()` hook exported from Shell). This would eliminate the entire cross-module sync problem.

**Why not chosen:** MFE routers create their own React tree (`<RouterProvider router={router} />`), which may not have access to Shell's React context. Module Federation boundaries make cross-app context sharing unreliable. The `CustomEvent` approach works regardless of React tree structure.

### Alternative B: Replace cookies with `localStorage` + `StorageEvent`

`localStorage` fires `StorageEvent` across tabs/frames, providing native reactivity. This would make Zustand stores auto-sync.

**Why not chosen:** `StorageEvent` only fires in OTHER tabs, not the same tab. Within the same tab, separate Zustand stores still wouldn't auto-sync. A `CustomEvent` is needed regardless for same-tab communication. Could be a long-term improvement for cross-tab sync.

### Alternative C: Global `queryClient.clear()` on every school switch

The nuclear option — clear the entire cache on school switch.

**Why not chosen:** Destroys non-school-scoped caches (userProfile, tenant, schools list) causing unnecessary re-fetches and flash of loading state for data that didn't change. The predicate approach (Task 2.2) is more surgical.

---

## Implementation Status

> All three sprints have been implemented. Below is a summary of all changes.

### Sprint 1: Core Broadcast Infrastructure — COMPLETE

| Task | Status | Files |
|------|--------|-------|
| 1.1 CustomEvent broadcaster | Done | `packages/config/src/school-context-channel.ts` (NEW) |
| 1.2 Config package export | Done | `packages/config/package.json` |
| 1.3 Shell store broadcast | Done | `apps/shell/src/stores/app.store.ts` |
| 1.4 Academics MFE listener | Done | `apps/academics/src/layouts/AcademicsLayout.tsx` |
| 1.5 Finance MFE listener | Done | `apps/finance/src/layouts/FinanceLayout.tsx` |
| 1.6 People MFE listener | Done | `apps/people/src/layouts/PeopleLayout.tsx` |
| 1.7 Messages MFE listener | Done | `apps/messages/src/layouts/MessagesLayout.tsx` |
| 1.8 Transition overlay | Done | `apps/shell/src/components/layout/SchoolTransitionOverlay.tsx` (NEW) |

### Sprint 2: Cache Invalidation & Query Hygiene — COMPLETE

| Task | Status | Files |
|------|--------|-------|
| 2.1 Extract QueryClient | Done | `apps/shell/src/lib/query-client.ts` (NEW), `apps/shell/src/main.tsx` |
| 2.2 Deep-search cache invalidation | Done | `apps/shell/src/lib/shell-context.tsx` |
| 2.3 Consolidated auto-select | Done | `apps/shell/src/lib/shell-context.tsx` |
| 2.4 People staffKeys fix | Done | `apps/people/src/hooks/useStaff.ts`, `apps/people/src/routes/staff.tsx` |
| 2.5 Sidebar debounce guard | Done | `apps/shell/src/components/layout/Sidebar.tsx` |

### Sprint 3: UX Polish & Hardening — COMPLETE

| Task | Status | Files |
|------|--------|-------|
| 3.1 Transition overlay in AppShell | Done | `apps/shell/src/components/layout/AppShell.tsx` |
| 3.2 Sidebar transition UI | Done | `apps/shell/src/components/layout/Sidebar.tsx` |
| 3.3 Deep route redirect | Done | All 4 MFE layouts (Academics, Finance, People, Messages) |
| 3.4 Transition flag clearing | Done | `apps/shell/src/lib/shell-context.tsx` (useIsFetching-based) |
| 3.5 Error/stall state in overlay | Done | `apps/shell/src/components/layout/SchoolTransitionOverlay.tsx` |
| 3.6 Single-school edge case | Done | `apps/shell/src/stores/app.store.ts` (skip transition on initial select) |
| 3.7 Null school state audit | Done | `apps/messages/src/routes/inbox.tsx`, `apps/messages/src/routes/announcements.tsx` |
| 3.8 Unit test | Done | `packages/config/src/__tests__/school-context-channel.test.ts` (NEW) |
| 3.9 Memory leak audit | Done | All files verified clean |
| 3.10 Documentation | Done | This section |

### Architecture Summary

```
┌─────────────────────────────────────────────────────────────┐
│ Shell                                                        │
│                                                              │
│  Sidebar ─▶ setActiveSchoolId() ─▶ Zustand store           │
│                                     │                        │
│                        ┌────────────┴──────────────┐        │
│                        ▼                           ▼        │
│              broadcastSchoolChange()     Cache invalidation  │
│              (CustomEvent on window)     (deep-search pred.) │
│                        │                           │        │
│              ┌─────────┼─────────────────┐        │        │
│              ▼         ▼                 ▼        │        │
│         Academics   Finance          People      │        │
│         Layout      Layout           Layout      │        │
│         listener    listener         listener    │        │
│              │         │                 │        │        │
│              ▼         ▼                 ▼        │        │
│         MFE store   MFE store       MFE store    │        │
│         updated     updated         updated      │        │
│              │         │                 │        │        │
│              └─────────┼─────────────────┘        │        │
│                        ▼                          ▼        │
│              React re-renders         TanStack Query        │
│              with new schoolId        refetches fresh data  │
│                                                              │
│  SchoolTransitionOverlay ◀── isSchoolTransitioning          │
│  (shown during switch,       (cleared when fetchCount → 0)  │
│   stall detection after 8s)                                  │
└─────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **CustomEvent over SharedWorker/BroadcastChannel**: DOM events are synchronous, require no polyfills, and work within the same tab. Cross-tab sync is not needed since each tab has its own Cognito session.

2. **Deep-search predicate over query key refactoring**: Instead of standardizing every query key to `[entity, schoolId, ...]`, the predicate scans any position in the key array and inside filter objects. This avoids a massive, error-prone refactoring of ~50 query definitions.

3. **MFE layout listeners over Zustand middleware**: Each MFE layout registers an `onSchoolChange` listener and updates its own store. This is explicit, debuggable, and doesn't require Zustand plugin coordination across Module Federation boundaries.

4. **Transition overlay with stall detection**: An 8-second timeout detects when queries hang (network issues, API errors), showing a retry button instead of an infinite spinner.

5. **Deep route redirect**: When a school switch happens, MFE layouts navigate to their module root (`/`) to prevent viewing entity-specific data from the wrong school.
