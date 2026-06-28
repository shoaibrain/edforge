# Midnight Lockin — Post-Ship Plan

**Commit organization • Production readiness • ClientApp sprint plan for Saraswati go-live and beyond**

> Scope of this document: everything between "Midnight Lockin backend is done in UAT" (where we are today) and "Saraswati is live + foundation is in place for a second archetype." Incorporates design review feedback.

---

## 0. Executive Summary

**Backend:** Midnight Lockin implementation is UAT-deployed and working end-to-end. 44 source files + 10 new files are uncommitted on `project-midnight-lockin`. All three microservices build clean; 85 new tests pass; archetype propagation verified end-to-end. This document organizes those changes into 11 atomic commits and defines the 10-sprint path to go-live and beyond.

**What's shipping in the commit batch:**
- First-class `archetype` on `Tenant` (PABSON / GENERIC; immutable write-once)
- Archetype-first regional defaults in `WorkspaceSettings` (PABSON → NPR / Asia/Kathmandu / bikram_sambat / DD-MM-YYYY / 24h / Sunday / ne-NP / south_asian / dual-date)
- `isLocked` write path on first `planning → active` academic-year transition (P0.16)
- `emisStudentId` sparse-indexed (GSI7) on `Student`; `emisSchoolCode` on `School`
- IEMIS import pipeline with BS→AD conversion, Nepali name parsing, gender normalization (P0.5, P0.6)
- Multi-role RBAC (same user can hold Principal + Teacher at one school)
- Finance `currency` type widened from literal `'NPR'` to `string` (partial P0.12; resolver deferred to J.1)
- Archetype-aware grade taxonomy (ECD/PPC for PABSON only)
- Field governance library (`FIELD_MUTABILITY.immutable = ['schoolCode', 'archetype']`)
- Tenant-seeder Lambda + provision script propagate archetype through SBT event whitelist (commit already in repo; compatible)
- Retired `@edforge/tenant-locale-defaults` workspace package; content moved into `@aibrains/shared-types/src/locale/`
- AdminWeb tenant-create form: archetype dropdown with info panel

**What's NOT shipping in this batch (deferred, tracked):**
- School-level regional-field removal (starts in Sprint H)
- Finance currency resolver (J.1)
- Force-unlock endpoint for WorkspaceSettings (J.3 / TE.12)
- `'saturday'` in `defaultWeekStartsOn` Zod enum (J.2 / P1.10)
- Nepali UI strings (E — deferred until reviewer identified)

---

## 1. Production Ship Readiness

### 1.1 Verdict

**SHIP READY** with three mechanical pre-commit chores (below) + the prod deploy ladder.

### 1.2 Pre-commit chores

Before staging any source changes, do these three things in order:

**Chore A — Wipe non-committable untracked files:**
```bash
rm -f Students_2082_All.xlsx
rm -rf .edforge-analysis/
```
Rationale: `Students_2082_All.xlsx` contains Saraswati PII (student names, guardian phone numbers, DOBs) and must not enter git. `.edforge-analysis/` is agent-internal scratch.

**Chore B — Add to `.gitignore`:**
```
# Generated artifacts
packages/*/dist/
packages/**/*.tsbuildinfo

# Agent/internal scratch
.edforge-analysis/
*.xlsx

# Plan files live at repo root intentionally — no ignore
```

**Chore C — Remove tracked generated artifacts (prevents dist/ contamination in every subsequent commit):**
```bash
git rm --cached packages/shared-types/dist/index.d.ts.map
git rm --cached packages/shared-types/dist/schemas/academics/student.schema.d.ts.map
git rm --cached packages/shared-types/dist/schemas/identity/school.schema.d.ts.map
# Verify: git status should show 3 more files as 'deleted' (from index only; files remain on disk)
```

Chores A/B/C are commit #1 in the plan below.

### 1.3 Commit organization (11 atomic commits)

Each commit leaves the tree building. Every `nest build identity && nest build academics && nest build finance` at any intermediate commit must pass. Commits are ordered so that no commit references a symbol defined only in a later one.

| # | Subject | Files | Atomicity note |
|---|---|---|---|
| **1** | `chore: gitignore dist + xlsx + internal scratch` | `.gitignore` + `git rm --cached` on 3 dist/*.map files | Foundation — everything else assumes these aren't tracked |
| **2** | `feat(shared-types): migrate tenant-locale-defaults package into shared-types/locale` | `packages/shared-types/src/locale/*` (new dir), `packages/shared-types/src/index.ts`, `packages/tenant-locale-defaults/*` (deleted), `packages/tenant-settings-resolver/{package.json,src/types.ts}` | Workspace-only package retired; consumers already pinned to `@aibrains/shared-types@0.27.0` on npm |
| **3** | `feat(shared-types): archetype field + field-governance + Zod schemas` | `packages/shared-types/src/identity/field-governance.ts`, `packages/shared-types/src/schemas/identity/{tenant,school,grade-levels}.schema.ts`, `packages/shared-types/src/schemas/academics/student.schema.ts` | All shared-types source changes in one commit; order enforces #4 can reference these symbols |
| **4** | `feat(identity): archetype-aware entities + workspace settings + P0.16 isLocked write path + multi-role RBAC` | Identity entities (`tenant`, `workspace-settings`, `academic-year`, `role-assignment`), `tenants.controller.ts`, `roles.service.ts`, `academic-years.service.ts`, `workspace-settings.entity.spec.ts`, `workspace-settings-contract.spec.ts` | Merged per review — isLocked is the direct consequence of archetype-aware entities; reviewer reading either alone has incomplete context |
| **5** | `feat(identity): schools service — emisSchoolCode + PABSON gate + schoolCode fetch` | `school.entity.ts`, `schools.service.ts` | School-level hooks used by IEMIS |
| **6** | `feat(academics): IEMIS import pipeline + emisStudentId GSI + gender normalization` | `academics/src/common/{entities,mappers,services}/*`, `academics/src/students/*`, new: `common/utils/import-normalize.{ts,spec.ts}`, `students/iemis-transform.{ts,spec.ts}`, `jest.config.js` (coverage tweaks roll in here) | 85 new tests live here; largest commit; all tests green |
| **7** | `refactor(finance): widen currency type from literal 'NPR' to string (defaults NPR)` | `finance/src/common/entities/{invoice,payment}.entity.ts`, `finance/src/common/mappers/{invoice,payment}.mapper.ts` | P0.12 partial; full currency-resolver in J.1 |
| **8** | `feat(infra): archetype propagation + GSI7 + tenant seeder + provision script` | `server/lib/bootstrap-template/tenant-seeder-lambda.{ts,spec.ts}`, `server/lib/provision-scripts/provision-tenant.sh`, `server/lib/tenant-template/ecs-dynamodb.ts` | Depends on #2 (`locale/`) for synth-time Lambda defaults |
| **9** | `feat(AdminWeb): archetype dropdown on tenant create form` | `client/AdminWeb/{package.json,src/models/tenant.ts,src/pages/Tenants/TenantCreate.tsx}` | System-admin UI |
| **10** | `docs(CLAUDE): deploy conventions, zod pin rules, publish-gate rules` | `CLAUDE.md` | Guardrails for future agents |
| **11** | `docs(midnight-lockin): baseline, review, sprint artifacts` | `MIDNIGHT_LOCKIN_BASELINE_REPORT.md`, `MIDNIGHT_LOCKIN_BASELINE_REVIEW.md`, `MIDNIGHT_LOCKIN_SPRINT_PLAN.md`, this file | Historical reference |

### 1.4 Production deploy ladder (after commits land)

**Step 0.5 — Publish shared-types to npm** (required before any stack that bundles it):
```bash
cd packages/shared-types
# verify 0.27.0 is what you intend to ship; bump if any changes since
npm publish   # 2FA prompt
npm view @aibrains/shared-types version
```

**Step 1 — Local pre-flight:**
```bash
cd server && source .env.prod
AWS_PROFILE=prod CDK_NAG_ENABLED=false CDK_PARAM_COMMIT_ID=$(git rev-parse --short HEAD) \
  npx cdk synth  # all stacks clean
```

**Step 2 — `cdk diff` each stack against prod. Log every diff.** Expected diffs must match UAT deploys modulo account ID and region (prod = `ap-south-1`, account `257526644020`).

**Step 3 — Deploy ladder (dependency order):**
```
shared-infra-stack → controlplane-stack → analytics-stack → core-appplane-stack → tenant-template-stack-basic
```
Use `./scripts/deploy.sh <stack> prod` for each. All logs into `docs/deploys/prod-*-$(date)-$(sha).log`.

**Step 4 — ECR build + push for 4 services** (identity, academics, finance, rproxy). Use `./scripts/build-application.sh <service>`.

**Step 5 — ECS force-new-deployment** for each of 4 services. Wait for `rolloutState: COMPLETED` on each.

**Step 6 — Smoke tests:** provision a test-tenant with `archetype=PABSON`. Confirm DDB rows shape matches UAT. Use the same verify script that passed in UAT.

**Step 7 — 30-minute monitor window.** On-call watches dashboards (see Sprint I-2).

### 1.5 Rollback path

- Every deploy log filename embeds the git SHA. Rollback = re-deploy the prior SHA from a worktree.
- ECR images retain `:sha-timestamp` tags (prior-good stays available).
- CFN auto-rollback handles failed deploys mid-deploy.
- ECS service rollback = redeploy prior task def revision.
- For frontend: Vercel keeps prior builds; revert via Vercel dashboard.

---

## 2. Sprint Principles

- **One concern, one commit, one test.** Every task is doable + reviewable + testable within a day.
- **Every sprint ships something demoable** — a human can click through and see the outcome.
- **Shared-types is the contract.** Frontend never redeclares workspace settings shapes.
- **Rollback matters.** Each sprint lists its rollback path in the acceptance row.
- **Accessibility is a row on every frontend sprint.** ARIA, keyboard nav, screen reader, contrast.
- **Observability is not a sprint afterthought.** It's Sprint I-2 before go-live.

---

## 3. Pre-Pilot Sprints (BLOCKERS for Saraswati go-live)

These are **ordered** — ship in order. Each builds on the previous. Sprints marked 🚨 are critical path.

### Sprint A — Tenant Identity Visibility 🚨

**Goal:** A tenant admin can tell at a glance what tenant + archetype + country govern their session; immutable fields visually labeled as such.

**Demo:** Log in as PABSON tenant admin → header shows badge "testpabsontenant1 · PABSON · NPL". Navigate to Workspace Settings → top of page shows a "Tenant Info" card with archetype + country + tier + createdAt, each with a lock icon and tooltip "Immutable — write-once at provisioning."

| # | Task | Files | Validation | a11y |
|---|---|---|---|---|
| A.1 | Extend `useTenant()` hook to surface `archetype` + `country` from tenant GET response | `apps/shell/src/lib/shell-context.tsx`, types | Vitest: mock tenant response, assert hook returns archetype + country |  — |
| A.2 | `<TenantBadge />` component | `packages/shell-components/src/TenantBadge.tsx` + test | Vitest: 3 render tests (PABSON+NPL, GENERIC+USA, archetype missing graceful degrade) | ARIA label with full archetype name |
| A.3 | Mount `<TenantBadge />` in Header | `apps/shell/src/components/layout/Header.tsx` | Playwright: `data-testid="tenant-badge"` in DOM, contains archetype + country ISO | Keyboard-reachable |
| A.4 | `<TenantInfoCard />` at top of Workspace Settings — read-only fields | `apps/shell/src/pages/settings/workspace.tsx` (new subcomponent) | Vitest: renders archetype, country, tier, created date; each has lock icon | Tooltip announces lock reason to screen reader |
| A.5 | `<FieldLockTooltip />` shared component (for reuse in Sprint B) | `packages/ui/src/components/FieldLockTooltip.tsx` + test + Storybook story | Vitest: tooltip shows lock reason + keyboard dismissible | role=tooltip; aria-describedby |
| A.6 | ABAC guard audit — enumerate every frontend call that reads tenant data; assert each has a backend guard | `docs/security/tenant-read-surface-audit.md` (new doc) | Doc committed; each endpoint has a line confirming backend guard identifier | — |

**Acceptance gate:** Native screenshot proof of badge + info card. `vitest` green. ABAC audit doc committed.

**Rollback:** Revert the frontend PR; Workspace Settings regresses to pre-Sprint-A layout (still functional).

**Principal-training note:** Tenant identity is now visible; no training needed.

### Sprint B — Per-Field Lock Governance 🚨

**Goal:** Workspace Settings uses `isFieldLocked(field, hasActiveYear)` per-field instead of a global disable. Fields locked during active year have visible indicators; branding/policies remain editable even when regional is locked.

**Demo:** With no active year → all regional fields editable, no lock icons. Trigger `isLocked=true` via backend → the lockedDuringActiveYear fields show lock icons + are disabled; branding editable; archetype/country always locked.

| # | Task | Files | Validation | a11y |
|---|---|---|---|---|
| B.1 | `useFieldLockState(fieldName)` hook — composes `isFieldLocked()` + `useWorkspaceSettings().isLocked` | `apps/shell/src/hooks/useFieldLockState.ts` + test | Vitest matrix: all (field, isLocked) combinations return correct boolean + reason | — |
| B.2 | Refactor `workspace.tsx` — drop global `disabled={isLocked}`, use `useFieldLockState()` per-input | `apps/shell/src/pages/settings/workspace.tsx` | Vitest: 6 state tests: (a) fresh tenant all editable; (b) active-year regional disabled branding editable; (c) immutable-field edit attempt shows toast; (d) PATCH success; (e) PATCH 400 lock-violation shows field-specific toast; (f) dirty-state warning on nav | — |
| B.3 | `<FieldLockIcon />` component | `packages/ui/src/components/FieldLockIcon.tsx` + test + Storybook | Vitest + snapshot | aria-label="Locked: <reason>" |
| B.4 | Update `<LockIndicator />` header — list WHICH fields locked, why | same page | Vitest: renders field names from governance rules + lockReason from API | Screen-reader reads all locked fields |
| B.5 | PATCH 400 lock-violation toast handler | `apps/shell/src/services/tenant.service.ts` mutation callbacks | Vitest + MSW: 400 with `{field: 'defaultCurrency', reason: '...'}` → toast shows `defaultCurrency` + reason | Toast announces via `aria-live=polite` |
| B.6 | Workspace settings tests ≥80% coverage (named states, not line coverage alone) | `apps/shell/src/pages/settings/workspace.test.tsx` (new) | `vitest --coverage` ≥ 80%; all 6 states from B.2 named | — |
| B.7 | Contract test — archetype PATCH returns 400 "immutable" (no silent drop) | `e2e/archetype-immutability.spec.ts` (Playwright or Vitest with MSW) | Live call against UAT: 400 with error body containing "immutable" | — |

**Acceptance gate:** Vitest coverage report ≥80% on workspace.tsx. Toggle `isLocked` in UAT DDB, refresh UI, verify per-field lock behavior. Screenshot each state.

**Rollback:** Revert Sprint-B PR; Workspace Settings regresses to global disable.

**Principal-training note:** When locked, add a 1-sentence help line: "Changes here are locked for the current academic year. Contact your system administrator to unlock."

### Sprint C — Workspace Confirmation Flow 🚨

**Goal:** A newly provisioned tenant sees an onboarding nudge until the admin explicitly confirms workspace setup. School-create is gated on `workspaceConfirmedAt`.

**Demo:** Provision fresh tenant → log in → Home page shows "Confirm your workspace" callout → click → Workspace Settings with "Confirm Setup" button → click → `workspaceConfirmedAt` set, callout disappears, "Create school" CTA enabled.

**Pre-condition (NOT a task — validate before sprint starts):** backend accepts `PATCH /tenants/:id/settings` with `{workspaceConfirmedAt: <ISO>}` and persists. Evidence: `docs/deploys/uat-smoke-workspace-confirm-$(date).log` returns 200 with the updated timestamp.

| # | Task | Files | Validation | a11y |
|---|---|---|---|---|
| C.1 | `<WorkspaceSetupCallout />` — banner shown when `!workspaceConfirmedAt` | `apps/shell/src/components/WorkspaceSetupCallout.tsx` + test | Vitest: renders only when `workspaceConfirmedAt` undefined | role=status, aria-live=polite |
| C.2 | Mount callout on Home + Sidebar entry | `apps/shell/src/pages/Home.tsx`, `apps/shell/src/components/layout/Sidebar.tsx` | Playwright: callout appears on Home; dismisses when confirmed | Skip-link works |
| C.3 | "Confirm Workspace Setup" button in workspace.tsx | same page | Vitest: button disabled when confirmed; enabled when not + no dirty changes | Button has clear label |
| C.4 | Confirmation mutation + optimistic update | `apps/shell/src/services/tenant.service.ts` | Vitest + MSW: mock mutation; double-click does NOT re-stamp timestamp (idempotent test) | — |
| C.5 | Success modal with next-steps (create school, invite staff) | inline modal | Vitest: renders + dismisses; focus-trap active | Focus trap; Esc closes |
| C.6 | Regression: school-create wizard still gates on `workspaceConfirmedAt` | verify no regression | Playwright: fresh tenant → try to create school before confirm → blocked | — |
| C.7 | Tenant-admin help doc (1 page) | `docs/guides/tenant-admin-quickstart.md` (new) | Doc committed; covers login, workspace confirm, first school, first year | Readable plain-language, no jargon |

**Acceptance gate:** Fresh UAT tenant can complete workspace confirmation end-to-end. All 6 task states pass. Help doc reviewed by non-engineer.

**Rollback:** Revert Sprint-C PR; tenant admin returns to manual unlock via direct API call.

### Sprint H — School Config Cleanup (P0.17, code-only portion) 🚨

**Goal:** School regional fields source from tenant `WorkspaceSettings` instead of hardcoded US defaults. **H.1–H.6 ship before go-live; H.7 migration runs immediately after with explicit maintenance window.**

**Demo:** Provision PABSON tenant → create school → `GET /schools/:id/configuration` returns Asia/Kathmandu / ne-NP / DD/MM/YYYY / 24h / annual.

| # | Task | Files | Validation | Rollback |
|---|---|---|---|---|
| H.1 | Inject `TenantsService` into `SchoolsService` + `AcademicYearsService` | identity/src/schools/{schools.service.ts, schools.module.ts}, academic-years/{service, module} | `npx nest build identity` clean; no circular import warnings | Remove injection |
| H.2 | Refactor `createDefaultConfig()` in schools.service.ts to read tenant WorkspaceSettings | `schools.service.ts` | Vitest unit: fresh school under PABSON tenant → config regional matches tenant | Revert method |
| H.3 | Archetype-aware `academicCalendarType` default (PABSON='annual', GENERIC='semester') | `academic-years.service.ts` | Vitest unit: per-archetype matrix | Revert default |
| H.4 | Ship H.1–H.3 to UAT (identity ECR rebuild + ECS roll) | — | Live test: create a new PABSON school under `testpabsontenant1` → config returns PABSON regional | ECS rollback |
| H.5 | Idempotent migration script — dry-run mode | `scripts/migrations/20260418-school-regional-cleanup.ts` | Running in `--dry-run` produces plan CSV; running in `--apply` twice produces zero writes on second pass | — |
| H.6 | Frontend simplification — `useResolvedSettings.ts` no longer falls back to school regional fields | `edforge-saas-frontend/apps/shell/src/hooks/useResolvedSettings.ts` | Vitest: precedence now tenant-only | Revert hook |

**Acceptance gate for H.1–H.6:** Fresh school creation under PABSON tenant in UAT gives correct PABSON regional. Migration script passes dry-run without errors.

**H.7 (post-pilot, scheduled):** Run the migration in UAT first, then prod during an announced 15-minute maintenance window. Not a Sprint task — a scheduled operation with explicit Shoaib sign-off.

**Rollback:** Revert H.1–H.6 commits. Migration (H.7) is irreversible once applied — verify dry-run first.

**Deferred — full entity field removal:** Removing `timezone`, `locale`, `calendarSystem`, `academicCalendarType` from School and SchoolConfiguration entity **is not in this sprint**. It's tracked as sprint H.8 (post-pilot) because it requires API contract change + DDB migration + multi-consumer coordination.

### Sprint I-2 — Observability + Paging Readiness 🚨

**Goal:** When Saraswati goes live, a human on-call sees critical signals and gets paged on failure. No silent failures.

**Demo:** Simulate an ECS task crash in UAT → operator receives SNS email + Slack alert within 5 minutes. CloudWatch dashboard shows current tenant health in one view.

| # | Task | Files | Validation |
|---|---|---|---|
| I-2.1 | CloudWatch dashboard — pilot health view: ECS 5xx rate, DDB throttles, Lambda errors, CodeBuild failures, SNS delivery failures | CDK stack (new: `lib/analytics/pilot-dashboard.ts`) | `aws cloudwatch get-dashboard` returns configured widgets |
| I-2.2 | SNS operator topic — confirm subscription for Shoaib + Slack webhook | `scripts/analytics/verify-sns-subscriptions.ts` | Test send → Shoaib receives within 60s |
| I-2.3 | On-call runbook for pilot | `docs/operations/saraswati-oncall.md` (new) | Covers: provisioning failure, 5xx surge, DDB throttle, AdminWeb white-screen, IEMIS import failure. Each has a decision tree + runbook step |
| I-2.4 | Paging drill — simulated ECS task crash during UAT | scripted | On-call receives page within 5min; runbook applied; incident resolved in <30min |
| I-2.5 | SLO doc: attendance save <2s p95, IEMIS import end-to-end <60s, dashboard load <3s | `docs/operations/saraswati-slos.md` (new) | Doc committed; signed by Shoaib |

**Acceptance gate:** Paging drill successfully completed end-to-end in UAT. All 5 dashboard widgets return non-error data.

**Rollback:** Disabling dashboards and SNS subscriptions reverts to current state (no observability).

### Sprint I — IEMIS Rehearsal + Saraswati Go-Live Dress 🚨

**Goal:** Full dress rehearsal with real Saraswati IEMIS data in UAT. Prod dry-run via `cdk diff`. Everything that will touch prod runs against UAT first.

**Demo:** On a fresh UAT "saraswati-uat" tenant, import 779-student IEMIS Excel; spot-check 20 records; confirm attendance + dashboard rendering; rollback drill succeeds.

| # | Task | Files | Validation |
|---|---|---|---|
| I.1 | Archive current UAT test tenants; provision fresh `saraswati-uat` (PABSON, NPL, BASIC) | manual | 3 DDB rows correct per tenant-seeder spec |
| I.2 | IEMIS import `Students_2082_All.xlsx` | `scripts/smoke-tests/saraswati-iemis-import.ts` (new) | All 779 rows complete; distribution matches expected (ECD/PPC=54, C1=38, C2=248, …) |
| I.3 | Partial-failure test — all-or-nothing rollback if row 500 fails | scripted bad-row injection | All rows rolled back; zero orphan students |
| I.4 | Spot-check 20 student records against source Excel | manual | Zero discrepancies |
| I.5 | Attendance sheet smoke test (Sunday-Friday week) | manual | Correct week shape; default schedule 08:00-15:30 |
| I.6 | Finance invoice smoke — NPR + south_asian grouping | manual | Invoice PDF readable; currency format correct |
| I.7 | Parent-portal read-only BS date + dual-date rendering | manual | Both formats visible |
| I.8 | Load test — 2000-student synthetic import (future PABSON tenant worst-case) | `scripts/load-tests/bulk-import.ts` (new) | p99 < 2min; no DDB throttles |
| I.9 | Principal training — 30-min UI walkthrough with Saraswati principal | calendar event + written walkthrough | Principal completes walkthrough; feedback captured |
| I.10 | Prod dry-run — `cdk diff` all 5 stacks against prod; capture logs | `docs/deploys/prod-dryrun-*-.log` | Diff matches UAT modulo region/account |
| I.11 | Go-live checklist | `docs/deploys/saraswati-golive-checklist.md` | Signed off by Shoaib |
| I.12 | Rollback rehearsal — pretend prod deploy failed, execute rollback procedure end-to-end in UAT | manual | ECS rollback, ECR tag swap, CFN rollback all work; within SLO time |

**Acceptance gate:** All 12 tasks signed off. Principal explicitly says "I can use this."

**Rollback:** If I.2 or I.10 fails, reschedule go-live, surface specific blockers to the right sprint.

---

## 4. Post-Pilot Sprints (NOT blockers for go-live)

### Sprint D — Branding + Policies Re-enable

**Goal:** Re-enable the commented Branding / Policies sections in workspace.tsx.

**Deferral decision:** Storybook (originally D.1) is pulled OUT of this sprint per reviewer feedback. Introduced separately only when the component library has 10+ components needing review workflow (post-pilot, likely during Sprint F).

| # | Task | Files | Validation | a11y |
|---|---|---|---|---|
| D.1 | Re-enable Branding section | `workspace.tsx` | Vitest: renders; fields editable when not locked | label+input associations |
| D.2 | `<OrganizationNameInput />` | `packages/ui/src/components/OrganizationNameInput.tsx` + test | Vitest | — |
| D.3 | `<ColorPicker />` for primary/accent | `packages/ui/src/components/ColorPicker.tsx` + test | Vitest; visual; color contrast validation | Keyboard nav |
| D.4 | Logo upload — explicit decision: ship or defer | backend pre-work if shipping | See task rewrite |
| D.5 | Policies: `defaultAttendancePolicy` dropdown | `workspace.tsx` | Vitest | — |
| D.6 | Dirty-state extended to branding + policies | `workspace.tsx` | Vitest | — |
| D.7 | Live preview panel | inline panel | Vitest + snapshot | — |

**D.4 decision gate (pre-sprint):**
- Option A (ship): Implement S3 presigned-URL flow: `POST /tenants/:id/branding/logo-upload-url` → frontend PUTs → tenant response serves `logoUrl`. Requires backend work.
- Option B (defer): Drop from Sprint D; file as "Branding V2" backlog.

Decide before Sprint D starts. Do not ship a "skip with TODO."

**Acceptance gate:** Save branding → header re-themes. Attendance policy default persists across reload.

**Rollback:** Revert PR; sections re-hide.

### Sprint F — Regional Display Primitives

**Goal:** Standardize all date + number rendering through two reusable components reading tenant settings.

**Demo:** Change `calendarSystem` in settings → every date across finance/academics/portals flips from gregorian to bikram_sambat instantly.

| # | Task | Files | Validation |
|---|---|---|---|
| F.1 | `<RegionalDate value={Date} format? dual?>` | `packages/ui/src/components/RegionalDate.tsx` + test + Storybook | Vitest: BS, AD, dual variants |
| F.2 | `<RegionalNumber value currency?>` | `packages/ui/src/components/RegionalNumber.tsx` + test + Storybook | Vitest: south_asian vs international grouping |
| F.3 | Migrate Header BS date to `<RegionalDate />` | `Header.tsx` | Vitest + visual |
| F.4 | Migrate dashboard widgets | `Home.tsx` | Vitest + visual |
| F.5 | Migrate finance invoice/payment displays | `apps/finance/src/**` | Vitest |
| F.6 | Backlog doc — list remaining raw date/number renders | `docs/clientapp/regional-primitive-migration.md` (new doc) | Doc committed |
| F.7 | BS edge case — year 2081 month 12 day 32 (variable BS month lengths) | F.1 test expansion | Vitest: asserts correct Gregorian equivalent |

**Acceptance gate:** Two components power ≥ 90% of date/number rendering. Remaining tracked in doc.

### Sprint G — Admin UX Polish

**Goal:** AdminWeb catches up with available backend data. Tenant list shows archetype. Tenant detail reads live settings.

| # | Task | Files | Validation | a11y |
|---|---|---|---|---|
| G.1 | `getTenants()` client returns archetype in list | `client/AdminWeb/src/services/tenants.service.ts` | Vitest | — |
| G.2 | Archetype column + badge on TenantList | `TenantList.tsx` | Vitest + visual | Screen-reader announces |
| G.3 | Replace `COUNTRY_SETTINGS` map with live `/tenants/:id/settings` fetch | `TenantDetail.tsx` | Vitest + MSW | — |
| G.4 | Force-unlock button (system-admin only) — **depends on J.3** | `TenantDetail.tsx` | Gate on J.3 backend ship; move to J if J.3 not shipped | Confirmation modal |

**Acceptance gate:** Admin console never displays hardcoded regional inference. G.4 lands only after J.3.

### Sprint J — Post-Pilot Cleanup

**Goal:** Close flagged follow-ups. Not blocking Saraswati; needed for second tenant.

| # | Task | Files | Validation |
|---|---|---|---|
| J.1 | Finance currency resolver — inject `TenantSettingsResolver`, stop hardcoding NPR (P1-a) | finance entities + mappers | Vitest: PABSON → NPR, GENERIC → USD |
| J.2 | Add `'saturday'` to `defaultWeekStartsOn` Zod enum (P1.10) | `packages/shared-types/src/schemas/identity/tenant.schema.ts` | Vitest |
| J.3 | Force-unlock endpoint (system-admin only, audited) — **TE.12** | `tenants.controller.ts` + service + audit entry | Integration test |
| J.4 | Normalize regional DDB shape (testtenant007 Map → String) | `scripts/migrations/20260420-regional-shape-normalize.ts` | Dry-run then apply |
| J.5 | Fix `features` field JSON parse in tenant response | `tenants.service.ts:toTenantResponse` | Vitest |
| J.6 | **Moved to Sprint A:** Contract test for SBT ScriptJob whitelist (prevents archetype propagation regression) — LAND THIS EARLIER to prevent rot | `server/lib/bootstrap-template/core-appplane-stack.spec.ts` (new) | Unit: asserts `environmentVariablesToOutgoingEvent.tenantData` is a superset of fields the tenant-seeder Lambda consumes |
| J.7 | School Configuration entity field removal (full P0.17 cleanup) | `school.entity.ts`, `department.entity.ts`, Zod schemas, DDB migration | Large task; scope in Sprint J |

**Acceptance gate:** Second PABSON tenant onboards cleanly; all debt closed.

### Sprint E — Localization (Nepali) — DEFERRED

**Deferral rationale:** Sprint E depends on a native Nepali reviewer (Open Question #4). Until identified, this sprint is deferred to post-pilot. V1 ships in English; existing Nepali strings (BS calendar labels, "Nepali (नेपाली)" in dropdowns) remain hardcoded.

**If reviewer is identified before go-live:** ship a reduced version — 5 key screens translated (Home, Settings, Workspace, Attendance, Finance) — as Sprint E'.

### Sprint D.0 — Storybook (DEFERRED)

**Deferral rationale:** Storybook infrastructure is valuable only when the component library crosses ~10 reusable components. Pre-pilot the library has ~4 (TenantBadge, FieldLockTooltip, FieldLockIcon, ColorPicker). Introduce Storybook as a stand-alone sprint when library size justifies it, likely between Sprint F and Sprint G.

---

## 5. Sprint Dependency Graph

```
A → B → C → H(1-6) → I-2 → I → [GO-LIVE] → H.7 migration → D / F / G / J (parallel)
                                                          ↘
                                                           Sprint E (after Nepali reviewer)
```

Pre-pilot critical path: **A → B → C → H(code) → I-2 → I** — all must complete before Saraswati go-live.

Post-pilot: D, F, G, J can run in parallel depending on engineering bandwidth.

---

## 6. Open Questions (for Shoaib)

| # | Question | Why it matters | Default if no answer |
|---|---|---|---|
| 1 | Who is on-call during Saraswati launch window? | Blocks Sprint I-2 completion | Shoaib + 1 fallback |
| 2 | What is the rollback SLO (time-to-revert-prod)? | Defines I.12 rehearsal gate | 30 minutes |
| 3 | What counts as "IEMIS import succeeded" — 779/779, or 775/779 with logged exceptions? | Defines I.2 pass criteria | 779/779 required; any row failure blocks go-live |
| 4 | Do we have a signed data-handling agreement with Saraswati principal? | Legal / GDPR-adjacent obligation | Must exist before I.9 |
| 5 | Who reviews Nepali strings (Sprint E)? | Blocks E entirely | Defer E to post-pilot until answered |
| 6 | D.4 logo upload — ship in D or defer? | Gates Sprint D scope | Defer; file as backlog |
| 7 | Which of J.1–J.6 block onboarding a second PABSON tenant? | Determines J priority | J.1 only (currency resolver) |
| 8 | Should `MIDNIGHT_LOCKIN_*.md` docs live in `docs/` or repo root? | Commit #11 placement | Default to repo root to stay consistent with current layout |

---

## 7. Execution Checklist (this document → reality)

### Phase 1: Commit the backend (this session)
- [ ] Chore A — remove `Students_2082_All.xlsx` + `.edforge-analysis/`
- [ ] Chore B — update `.gitignore`
- [ ] Chore C — `git rm --cached` the 3 tracked dist .map files
- [ ] Commits 1–11 per §1.3 (in order)
- [ ] `npx nest build identity && nest build academics && nest build finance` green after each commit (spot-check)
- [ ] Push branch + open PR with this plan as PR description

### Phase 2: Publish + prod deploy
- [ ] `npm publish @aibrains/shared-types` (verify version)
- [ ] Prod `cdk synth` clean
- [ ] Prod `cdk diff` each stack (logged)
- [ ] Deploy ladder (logged)
- [ ] ECR + ECS roll (logged)
- [ ] Smoke: provision test-tenant, verify DDB shape
- [ ] 30-min monitor window

### Phase 3: Sprint execution (A → B → C → H(1-6) → I-2 → I)

Each sprint:
- [ ] Ticket file under `docs/sprints/<SPRINT-ID>.md` with tasks, acceptance, rollback
- [ ] Implement
- [ ] Tests green
- [ ] Demo to Shoaib
- [ ] Merge

### Phase 4: Go-live
- [ ] All pre-pilot sprints accepted
- [ ] Principal training done
- [ ] Go-live checklist signed
- [ ] Schedule + execute

### Phase 5: Post-pilot (D, F, G, J parallel)

---

## 8. Appendix — What Changed From the Draft (after subagent review)

Key changes the reviewer demanded:
1. **Commit #1 fixed** to `git rm --cached` tracked dist files + proper `.gitignore` (was a silent hole)
2. **Commits #4 + #5 merged** — isLocked write path is not separable from archetype-aware entities
3. **`npm publish shared-types` added as step 0.5** in prod deploy ladder (was missing; would have caused AdminWeb CodeBuild 404)
4. **Sprint H.1–H.6 moved BEFORE Sprint I** — shipping Saraswati with school-regional divergence + later prod migration is strictly worse than slipping H code forward
5. **New Sprint I-2 (Observability + Paging)** inserted before Sprint I — Saraswati cannot go live without alerting
6. **Sprint E (Nepali) deferred** unless native reviewer identified before go-live
7. **Storybook deferred** until component library size justifies it
8. **5 weak tasks rewritten** with specific acceptance tests (A.4, B.6, C.1 as pre-condition not task, D.5 as explicit decision, H.7 as scheduled op)
9. **a11y row added** to every frontend sprint
10. **Rollback row added** to every sprint acceptance
11. **Principal-training row + help-doc tasks** added to Sprint C
12. **Contract test for SBT whitelist (J.6)** moved to Sprint A to prevent regression rot

---

_Version history_
- 2026-04-19 — v1.0 Initial plan, post-subagent-review
