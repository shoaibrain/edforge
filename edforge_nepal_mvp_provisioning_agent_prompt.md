# EdForge — Nepal MVP: Tenant Provisioning & Onboarding
## Agent Prompt for Claude Code (IDE)

---

## WHO YOU ARE

You are a senior full-stack engineer and technical lead on EdForge. You have been given
three audit documents and a complete picture of the system. Your job is to:

1. Design and write an exhaustive sprint plan covering every atomic task needed to make
   tenant provisioning and onboarding work end-to-end for Nepal pilot schools
2. Submit that plan to a sub-agent for review
3. Incorporate all sub-agent feedback
4. Write the final approved plan to `docs/nepal-mvp-provisioning-sprint.md`

You will NOT write implementation code in this prompt. You will produce a sprint plan.
Implementation follows after the plan is approved.

---

## WHAT YOU KNOW — READ THIS BEFORE WRITING ANYTHING

### The System Today (from audit)

**AdminWeb (SaaS Provider Console)**
- `POST /tenant-registrations` payload: `{ tenantId, tenantData: { tenantName, email, tier, useFederation, useEc2, useRProxy }, tenantRegistrationData: { registrationStatus } }`
- Zero regional fields in form or payload. No country, currency, calendarSystem, timezone, locale.
- No tenant edit page. AdminWeb is create + delete only.
- Provisioning automation: SBT → CDK → DynamoDB + Cognito + ECS + routing (works correctly)
- Workspace settings created **lazily on first API access** with US defaults:
  `{ defaultCurrency: 'USD', defaultTimezone: 'America/New_York', defaultCalendarSystem: 'gregorian', enableDualDateDisplay: false, defaultNumberFormat: 'international', defaultLocale: 'en-US' }`
- Invitation email: plain text, no personalization, no onboarding steps
- Key files: `client/AdminWeb/src/pages/Tenants/TenantCreate.tsx`, `client/AdminWeb/src/services/tenantService.ts`, `server/lib/tenant-template/identity-provider.ts`, `server/lib/provision-scripts/provision-tenant.sh`, `server/application/microservices/identity/src/common/entities/workspace-settings.entity.ts`

**Platform App (Tenant-Facing)**
- After first login (forced password change), admin lands at `/home` → `AdminCommandCenter`
- No mandatory onboarding wizard. Optional `OrgSetupOnboarding` lives in Settings → Organization, is dismissible, covers only SEA/LEA/School hierarchy setup — NOT regional settings
- Shell fetches on load: `GET /users/me`, `GET /tenants/:id`, `GET /tenants/:id/schools`, `GET /schools/:id/academic-years/current`, `GET /tenants/:id/settings`, `GET /schools/:id/configuration`
- `useResolvedSettings()` implements correct precedence chain: School Config → School → Workspace Settings → System Defaults. This works — but if workspace settings are wrong (US defaults for Nepal), everything downstream is wrong.
- Currency: **WORKING** — `useCurrency(resolvedSettings)` used in 27+ Finance files. Correct when settings are correct.
- BS dates in Finance: **BROKEN** — `formatDateDual()` always shows dual AD+BS regardless of `calendarSystem` or `enableDualDateDisplay` settings. Uses `toBSString()` from real working conversion utility.
- Timezone: **BROKEN** — Finance uses `toLocaleDateString('en-GB')` with browser local timezone. `resolvedSettings.timezone` is resolved but never consumed by Finance date utilities.
- School creation wizard: has `calendarSystem` field but defaults to `gregorian`, does NOT inherit from workspace settings
- Academic year creation: Gregorian date pickers only, no BS date support
- Module guards: Only Academics has a guard (`schoolStatus === 'setup'`). Finance and People have none.
- Key files: `apps/shell/src/pages/HomePage.tsx`, `apps/shell/src/components/settings/OrgSetupOnboarding.tsx`, `apps/shell/src/hooks/useResolvedSettings.ts`, `apps/finance/src/utils/format-date.ts`, `apps/shell/src/components/settings/school-wizard/SchoolWizard.tsx`

### What Nepal Schools Actually Need
- **Bikram Sambat calendar** — legally required on all official documents (transcripts, academic records)
- **NPR currency** with South Asian number grouping (1,00,000 not 100,000)
- **Asia/Kathmandu timezone** (UTC+5:45) on all timestamps
- **Dual date display** — BS primary, Gregorian secondary on finance documents
- Academic year in BS (2082/2083, starts Baisakh 1 ≈ April 14 Gregorian)
- School days: Sunday–Friday (not Mon–Fri)

### The 15 Identified Gaps (from gap analysis)

| Gap | Severity | Blocks MVP |
|-----|----------|-----------|
| G-01: No regional fields in tenant creation form | HIGH | YES |
| G-02: US defaults in workspace settings initialization | HIGH | YES |
| G-03: Brand new tenant returns wrong settings | HIGH | YES |
| G-04: Currency works IF settings correct | MEDIUM | YES (dependency) |
| G-05: BS date display hardcoded (always on) | MEDIUM | PARTIAL |
| G-06: Timezone not consumed by Finance | MEDIUM | YES |
| G-07: No mandatory first-login onboarding | HIGH | YES |
| G-08: Finance/People have no module guards | MEDIUM | NO |
| G-09: School creation doesn't inherit workspace settings | MEDIUM | YES |
| G-10: Academic year has no BS date support | HIGH | YES |
| G-11: AdminWeb has no tenant edit page | MEDIUM | YES |
| G-12: Finance hardcodes en-GB locale | LOW | NO |
| G-13: Email is bare plain text | LOW | NO (addressed separately) |
| G-14: Deprecated formatNPR* functions still exist | LOW | NO |
| G-15: Workspace settings page exists but not enforced | MEDIUM | YES |

---

## YOUR TASK

Write a sprint plan that closes every Nepal MVP gap. Structure it as follows.

---

## SPRINT PLAN REQUIREMENTS

Every sprint must:
- Produce **demoable, runnable software** at the end
- Build directly on the previous sprint (no orphaned work)
- Have a clear, single sentence **Demo** statement

Every task must be:
- **Atomic** — one commit, one concern
- **Named** — verb + noun (e.g. "Add country field to TenantCreate form")
- **Located** — exact file path(s) stated
- **Validated** — either a test OR an explicit validation step that proves it works
- **Bounded** — scoped tightly. If a task feels big, split it.

---

## SPRINT STRUCTURE TO WRITE

---

### Sprint 0 — Backend: Workspace Settings Initialization Fix

**Goal:** A tenant created for Nepal gets Nepal-correct workspace settings from the moment of provisioning. No manual configuration required.

**Demo:** Create a test tenant via AdminWeb with `country: "NPL"`. Call `GET /api/tenants/:id/settings`. Response shows `NPR`, `Asia/Kathmandu`, `bikram_sambat`, `true` for `enableDualDateDisplay`, `south_asian` for `numberFormat`.

Tasks to include:

**S0.1 — Add `country` field to `CreateTenantRequest` DTO**
- File: wherever the tenant creation DTO/interface is defined in the backend
- What: Add `country: string` (ISO 3166-1 alpha-3: "NPL", "USA", etc.) as an optional field
- Validation: Unit test that DTO accepts and validates `country` field

**S0.2 — Add regional defaults map to workspace settings entity**
- File: `server/application/microservices/identity/src/common/entities/workspace-settings.entity.ts`
- What: Replace the hardcoded US defaults in `createDefaultWorkspaceSettings()` with a
  `COUNTRY_DEFAULTS` map. When country is "NPL", seed NPR + Asia/Kathmandu + bikram_sambat + true + south_asian. When country is unknown/absent, fall back to existing US defaults.
- Exact defaults for NPL:
  ```
  defaultCurrency: 'NPR'
  defaultTimezone: 'Asia/Kathmandu'
  defaultCalendarSystem: 'bikram_sambat'
  enableDualDateDisplay: true
  defaultNumberFormat: 'south_asian'
  defaultLocale: 'ne-NP'
  defaultDateFormat: 'DD/MM/YYYY'
  defaultWeekStartsOn: 'sunday'
  ```
- Validation: Unit test that `createDefaultWorkspaceSettings('NPL')` returns all Nepal values. Unit test that `createDefaultWorkspaceSettings('USA')` returns all US values. Unit test that `createDefaultWorkspaceSettings(undefined)` returns US defaults.

**S0.3 — Pass `country` through provisioning pipeline to workspace settings initialization**
- Files: Provisioning endpoint → TenantSeederLambda → workspace settings creation
- What: Thread the `country` value from the creation request all the way to where
  `createDefaultWorkspaceSettings()` is called, so it receives country context
- Validation: Integration test — POST create tenant with `country: "NPL"`, then GET workspace settings, assert Nepal defaults are present

**S0.4 — Write API contract test for `GET /tenants/:id/settings` new tenant response**
- File: wherever API contract/integration tests live in the backend
- What: Test that a brand new NPL tenant's settings response contains all expected Nepal fields with correct values. Test that a brand new USA tenant's settings contain US defaults.
- Validation: Test passes. This test is the regression guard going forward.

---

### Sprint 1 — AdminWeb: Regional Fields in Tenant Creation

**Goal:** The SaaS admin can set country, currency, calendar system, and timezone when creating a tenant. This data flows to the backend and seeds correct workspace settings.

**Demo:** Open AdminWeb. Create a new tenant, select Nepal. Submit. In a separate tab, call the platform app API for that tenant's settings. See NPR, bikram_sambat, Asia/Kathmandu — no manual configuration needed.

Tasks to include:

**S1.1 — Add `country` select field to `TenantCreate.tsx` form**
- File: `client/AdminWeb/src/pages/Tenants/TenantCreate.tsx`
- What: Add a "Country / Region" select field above Tier selection. Options: Nepal (NPL), United States (USA), India (IND), Other. Required field. Wire to form state `FormData.country`.
- When "Nepal" selected: visually show what will be auto-configured ("NPR currency, Bikram Sambat calendar, Nepal timezone will be applied")
- Validation: Select Nepal → informational text appears. Select USA → different text. Submit without selecting → validation error "Country is required".

**S1.2 — Add `country` to `FormData` interface and `CreateTenantRequest` payload**
- File: `client/AdminWeb/src/pages/Tenants/TenantCreate.tsx`, `client/AdminWeb/src/models/tenant.ts`
- What: Extend `FormData` interface with `country: string`. Extend `CreateTenantRequest` to include `country` in `tenantData`. Include in `handleSubmit()` payload construction.
- Validation: Submit form with Nepal selected. Verify network request body includes `tenantData.country: "NPL"`.

**S1.3 — Add `country` validation to `validateForm()`**
- File: `client/AdminWeb/src/pages/Tenants/TenantCreate.tsx`
- What: Add validation rule that `country` must be selected before submission.
- Validation: Submit form without selecting country. Validation fires. Country field shows error state.

**S1.4 — Add tenant edit capability for regional settings (AdminWeb)**
- File: `client/AdminWeb/src/pages/Tenants/TenantDetail.tsx` (currently read-only)
- What: Add a "Regional Settings" section with PATCH capability. Fields: country, currency, calendarSystem, timezone. This is the escape hatch if a tenant was created with wrong defaults.
- API: `PATCH /tenant-registrations/:id/settings` or equivalent — verify endpoint exists or note it needs creation
- Validation: Open an existing tenant detail page. See regional settings section. Change currency. Save. Reload page. Currency change persisted.

---

### Sprint 2 — Platform App: Mandatory Workspace Settings Onboarding Gate

**Goal:** When a tenant admin logs in for the first time and their workspace settings are at US defaults, they are intercepted with a required settings confirmation step before they can access any module. They cannot dismiss it. They cannot skip it.

**Demo:** Create a fresh Nepal tenant. Log in as the tenant admin. After password change, instead of landing on the dashboard, a full-screen "Configure Your Workspace" wizard appears. Admin confirms NPR + BS + Asia/Kathmandu. Clicks "Start Using EdForge". Lands on dashboard. Navigates to Finance. See NPR amounts.

Tasks to include:

**S2.1 — Create `useWorkspaceSetupRequired()` hook**
- File: `apps/shell/src/hooks/useWorkspaceSetupRequired.ts` (new)
- What: Returns `true` if workspace settings appear to be at unconfigured defaults.
  Logic: if `resolvedSettings.currency === 'USD' && resolvedSettings.timezone === 'America/New_York'`
  AND a `localStorage` key `edforge-workspace-configured-{tenantId}` is not set.
  (The localStorage key prevents showing the gate on every login once confirmed.)
- Validation: Unit test with mock resolvedSettings at US defaults → returns true. Unit test with NPR settings → returns false. Unit test with confirmed localStorage flag → returns false.

**S2.2 — Create `WorkspaceSetupGate` component**
- File: `apps/shell/src/components/onboarding/WorkspaceSetupGate.tsx` (new)
- What: Full-screen, non-dismissible overlay. Shows:
  - Welcome message with organization name
  - "Before you start, confirm your workspace settings"
  - 4 review fields (read-only with edit link): Currency, Calendar System, Timezone, Number Format
  - These are pre-populated from the current workspace settings (which Sprint 0 now seeds correctly for Nepal)
  - "These settings apply to your entire organization and cannot be changed mid-year without contacting support."
  - Single CTA: "Confirm & Start Using EdForge"
  - Secondary link: "These look wrong — edit settings" → opens Workspace Settings page in same window
- No X button. No dismiss. Cannot be bypassed.
- Validation: Render with US defaults → shows component. Render with NPR settings → still shows if localStorage flag absent. Click Confirm → sets localStorage flag, fires PATCH to confirm workspace settings, emits `onComplete`. Render again after onComplete → does not show.

**S2.3 — Wire `WorkspaceSetupGate` into shell routing**
- File: `apps/shell/src/router.tsx` or `apps/shell/src/pages/HomePage.tsx`
- What: After authentication and before rendering the home page content, check `useWorkspaceSetupRequired()`. If true, render `WorkspaceSetupGate` instead of the normal home page content. Once `onComplete` fires, render normal home page.
- Validation: Fresh tenant → `WorkspaceSetupGate` appears. Click confirm → home page appears. Reload → home page appears directly (flag is set). Clear localStorage → gate appears again.

**S2.4 — Add "Confirm workspace settings" PATCH endpoint**
- File: backend identity microservice
- What: `PATCH /tenants/:id/settings/confirm` — sets a `workspaceConfirmedAt` timestamp on the workspace settings record. This is the signal that the admin has reviewed and accepted their settings.
- Validation: Call endpoint. GET workspace settings. `workspaceConfirmedAt` is set. Call again. No error (idempotent).

---

### Sprint 3 — Platform App: School Creation Inherits Workspace Settings

**Goal:** When an admin creates a new school, the `calendarSystem`, `timezone`, and `locale` fields are pre-populated from the tenant's confirmed workspace settings. Admin can override if needed.

**Demo:** Nepal tenant. Workspace settings = BS + NST + ne-NP. Open school creation wizard. Observe that `calendarSystem` field shows "Bikram Sambat" pre-selected, `timezone` shows "Asia/Kathmandu" pre-selected. Create school without changing anything. School record has Nepal settings.

Tasks to include:

**S3.1 — Read workspace settings in `SchoolWizard`**
- File: `apps/shell/src/components/settings/school-wizard/SchoolWizard.tsx` and `school-wizard.utils.ts`
- What: Import `useResolvedSettings()`. Use `resolvedSettings.calendarSystem`, `resolvedSettings.timezone`, `resolvedSettings.locale` as default values for the corresponding wizard fields instead of hardcoded `'gregorian'` and `'America/Chicago'`.
- Validation: Nepal tenant → open school wizard → calendarSystem field shows "Bikram Sambat", timezone shows "Asia/Kathmandu". US tenant → shows "Gregorian" and "America/New_York".

**S3.2 — Show inheritance indicator in school wizard**
- File: `apps/shell/src/components/settings/school-wizard/SchoolWizard.tsx`
- What: Below the calendarSystem and timezone fields, show a small note: "Inherited from organization settings — you can override this per school."
- Validation: Note appears when field value matches workspace setting. Note does not appear if admin manually changes the value.

**S3.3 — Add school days default for Nepal**
- File: `apps/shell/src/components/settings/school-wizard/school-wizard.utils.ts`
- What: Nepal school days are Sunday–Friday (days 0,1,2,3,4,5). When calendarSystem is `bikram_sambat`, default `schoolDays` to `[0,1,2,3,4,5]`. Otherwise default to `[1,2,3,4,5]` (Mon–Fri).
- Validation: Unit test — when calendarSystem is bikram_sambat, getDefaultSchoolDays() returns [0,1,2,3,4,5]. When gregorian, returns [1,2,3,4,5].

---

### Sprint 4 — Platform App: Academic Year with BS Date Support

**Goal:** Nepal tenant admins can create academic years using Bikram Sambat dates. The form shows BS date inputs when the workspace calendar is set to bikram_sambat, with the corresponding Gregorian date shown alongside for reference.

**Demo:** Nepal tenant. Go to Settings → Organization → Academic Years. Click "Create Academic Year". Form shows: Academic Year Name (pre-filled "2082/2083"), BS Start Date picker (shows Baisakh 1, 2082), Gregorian equivalent shown as "(Apr 14, 2026)". Submit. Academic year created with correct Gregorian dates stored in DB, BS dates in the `startDateBS`/`endDateBS` fields.

Tasks to include:

**S4.1 — Create `BSDateInput` component**
- File: `packages/date-utils/src/components/BSDateInput.tsx` (new)
- What: A date input that:
  - Accepts three separate number inputs: BS Year (e.g. 2082), BS Month (1–12 with Nepali month names), BS Day (1–32 depending on month)
  - Validates using the BS month days lookup table already in `packages/date-utils/src/constants.ts`
  - Computes and displays the AD equivalent via `bsToAD()` from `packages/date-utils/src/converter.ts`
  - Emits `onChange(adDate: Date)` so consuming forms receive a standard JS Date
- Validation: Unit tests — enter BS 2082/01/01, verify output is AD 2025-04-14. Enter invalid BS date (month 13), verify error state. Enter BS day beyond month max, verify error state.

**S4.2 — Add `startDateBS` and `endDateBS` fields to academic year DTO**
- File: backend academic year entity/DTO
- What: Add optional `startDateBS: string` and `endDateBS: string` (format "YYYY/MM/DD") fields. These are stored alongside the Gregorian `startDate`/`endDate` for display/reporting purposes.
- Validation: Unit test that DTO accepts and persists both date fields.

**S4.3 — Update `CreateAcademicYearModal` to conditionally use `BSDateInput`**
- File: `apps/shell/src/pages/settings/school-academic-years.tsx`
- What: Check `resolvedSettings.calendarSystem`. If `bikram_sambat`, render `BSDateInput` for start/end dates with Gregorian equivalent shown. If `gregorian`, render existing standard date inputs unchanged.
- Auto-populate academic year name based on BS year (e.g. if start date is in BS 2082, auto-fill name as "2082/2083").
- On submit: send standard Gregorian dates to API, also send `startDateBS`/`endDateBS`.
- Validation: Nepal tenant → modal shows BS inputs. US tenant → modal shows standard date inputs. Nepal tenant creates academic year → DB record has both Gregorian and BS dates. US tenant creates academic year → DB record has only Gregorian dates (BS fields absent/null).

**S4.4 — Display BS academic year in Settings → Organization**
- File: wherever academic years are listed in the organization settings UI
- What: When `calendarSystem === 'bikram_sambat'`, display academic year as "BS 2082/2083" with Gregorian range "(Apr 14, 2026 – Apr 13, 2027)" as subtitle. When gregorian, show standard year display.
- Validation: Nepal tenant academic year list shows BS year label. US tenant shows standard format.

---

### Sprint 5 — Finance Module: Settings-Driven Date & Timezone Formatting

**Goal:** Finance module date display respects `calendarSystem`, `enableDualDateDisplay`, and `timezone` from resolved settings. A Nepal school sees BS dates and NST timestamps. A US school sees Gregorian dates and local timestamps. The Finance module stops having its own hardcoded formatting.

**Demo:** Log in as Nepal tenant. Navigate to Finance → Payments. Dates show "DD/MM/YYYY" with "BS: YYYY/MM/DD" secondary line. Timestamps show Nepal time. Log in as US tenant. Navigate to Finance → Payments. Dates show "MM/DD/YYYY" only. No BS line.

Tasks to include:

**S5.1 — Rewrite `formatDate()` in Finance to respect resolved settings**
- File: `apps/finance/src/utils/format-date.ts`
- What: `formatDate(dateStr, settings: ResolvedSettings)` — use `settings.dateFormat` and `settings.locale` instead of hardcoded `en-GB`. Format using `Intl.DateTimeFormat` with explicit locale.
- Validation: Unit test — `formatDate('2026-03-18', { dateFormat: 'MM/DD/YYYY', locale: 'en-US' })` returns `"03/18/2026"`. `formatDate('2026-03-18', { dateFormat: 'DD/MM/YYYY', locale: 'en-GB' })` returns `"18/03/2026"`.

**S5.2 — Rewrite `formatDateDual()` to respect `calendarSystem` and `enableDualDateDisplay`**
- File: `apps/finance/src/utils/format-date.ts`
- What: `formatDateDual(dateStr, settings: ResolvedSettings)` — only shows BS secondary line when `settings.calendarSystem === 'bikram_sambat' && settings.enableDualDateDisplay === true`. Otherwise returns same as `formatDate()`.
- Validation: Unit test — `calendarSystem: 'bikram_sambat', enableDualDateDisplay: true` → returns dual format. `calendarSystem: 'gregorian'` → returns single format. `enableDualDateDisplay: false` → returns single format.

**S5.3 — Rewrite `formatDateTime()` to respect timezone**
- File: `apps/finance/src/utils/format-date.ts`
- What: `formatDateTime(dateStr, settings: ResolvedSettings)` — pass `settings.timezone` as `timeZone` option to `Intl.DateTimeFormat`. Replace `toLocaleDateString('en-GB')` with explicit locale + timezone formatting.
- Validation: Unit test — same UTC timestamp, `timezone: 'Asia/Kathmandu'` returns time 5:45 hours ahead of `timezone: 'UTC'`. `timezone: 'America/New_York'` returns correct EST/EDT time.

**S5.4 — Update all Finance call sites to pass `resolvedSettings` to date utilities**
- Files: All 14+ Finance files that call `formatDate()`, `formatDateDual()`, `formatDateTime()`
  (listed in audit: accounts/index.tsx, invoices/$invoiceId.tsx, payments/record.tsx, payments/index.tsx, BulkInvoiceForm.tsx, etc.)
- What: Each call site must pass `resolvedSettings` as the second argument. Settings are already available via `FinanceSettingsContext`. This is a mechanical change — each file adds the settings argument.
- Do each file as a separate commit. Do not batch them.
- Validation: Each file compiles with no TypeScript errors. Finance Payments page for Nepal tenant shows BS dates. For US tenant shows no BS dates.

**S5.5 — Remove deprecated `formatNPR*` functions**
- File: `packages/types/src/payment.ts`
- What: Delete `formatNPR()`, `formatNPRShort()`, `formatNPRCompact()` (lines 316-379). Verify no non-deprecated call sites exist (grep first). If call sites exist, migrate them to `useCurrency()` before deleting.
- Validation: `grep -r "formatNPR" --include="*.tsx" --include="*.ts"` returns zero results. Build succeeds.

---

### Sprint 6 — End-to-End Nepal Validation & Guard Rails

**Goal:** The complete Nepal school journey works without any manual configuration. Every module is either working correctly or shows a meaningful empty state. No broken renders, no US defaults leaking through.

**Demo:** Recorded walkthrough (or Playwright test) of the complete journey described below. Every step must pass.

Tasks to include:

**S6.1 — Add Finance module prerequisite guard**
- File: `apps/finance/src/layouts/FinanceLayout.tsx`
- What: If no schools exist for this tenant (`schools.length === 0`), render a purposeful empty state: "No schools configured. Set up your organization in Settings → Organization before using Finance." with a link to Settings. Not an error — a clear actionable empty state.
- Validation: Log in as new tenant with no schools. Navigate to Finance. See empty state with link. Create a school. Navigate back to Finance. Finance renders normally.

**S6.2 — Write the complete Nepal onboarding E2E test (Playwright or equivalent)**
- File: `e2e/tests/nepal-onboarding.spec.ts` (new)
- What: Automated test covering the full journey:
  ```
  Step 1: Create Nepal tenant via AdminWeb (country: NPL)
  Step 2: Verify GET /api/tenants/:id/settings returns NPR + bikram_sambat + Asia/Kathmandu
  Step 3: Log in as tenant admin, complete password change
  Step 4: WorkspaceSetupGate appears. Confirm settings.
  Step 5: Land on home page. No errors.
  Step 6: Create academic year (BS 2082/2083)
  Step 7: Create school (inherits Nepal settings)
  Step 8: Navigate to Finance Overview. KPI tiles render (zeros OK). Currency symbol = NPR.
  Step 9: Navigate to Finance Payments. Date column shows DD/MM/YYYY + BS secondary line.
  Step 10: Navigate to Academics. No errors.
  ```
  Each step is a separate `test.step()` for clear reporting.
- Validation: Test suite passes with exit code 0.

**S6.3 — Write `docs/nepal-mvp-validation-checklist.md`**
- File: `docs/nepal-mvp-validation-checklist.md` (new)
- What: Human-readable checklist for QA or the pilot school admin to verify end-to-end:
  - AdminWeb tenant creation with Nepal country
  - Workspace settings auto-seeded correctly
  - WorkspaceSetupGate appears and is non-dismissible
  - School creation inherits Nepal settings
  - Academic year shows BS dates
  - Finance amounts show NPR
  - Finance dates show dual format
  - Finance timestamps show NST
- Each item has: what to do, what to look for, pass/fail criteria.
- Validation: Document exists and is readable by a non-engineer.

**S6.4 — Update invitation email to include "confirm workspace settings" step**
- File: `server/lib/tenant-template/identity-provider.ts`
- What: Update the email template (whether Cognito or SES — see email audit) to add Step 2 in the getting started section: "Go to Settings → Workspace and confirm your currency, timezone, and calendar system."
- This is a small targeted change, not the full email redesign (that is tracked separately).
- Validation: Create test tenant. Receive invitation email. Email body includes "Settings → Workspace" instruction.

---

## SUB-AGENT REVIEW GATE

After writing the complete sprint plan, stop. Do not begin implementation.

Invoke a sub-agent with this exact prompt:

```
You are a senior staff engineer reviewing a Nepal MVP sprint plan for EdForge.

Read these files:
  1. docs/adminweb-audit.md
  2. docs/platform-app-audit.md
  3. docs/tenant-provisioning-gap-analysis.md
  4. docs/nepal-mvp-provisioning-sprint.md (the plan you are reviewing)

Review against these criteria:

CORRECTNESS
□ Does Sprint 0 close G-02 and G-03? After Sprint 0, does a Nepal tenant get NPR + BS + NST at creation time?
□ Does Sprint 1 close G-01 and G-11? Can AdminWeb set and edit regional settings?
□ Does Sprint 2 close G-07 and G-15? Is the workspace setup gate non-dismissible and mandatory?
□ Does Sprint 3 close G-09? Does school creation inherit workspace settings?
□ Does Sprint 4 close G-10? Does academic year creation support BS dates?
□ Does Sprint 5 close G-05, G-06, G-12? Are Finance dates, dual display, and timezone all settings-driven?
□ Does Sprint 6 produce a passing E2E test that verifies the full Nepal journey?
□ Does every sprint result in demoable, runnable software?

ATOMICITY
□ Is every task a single commit? Flag any task that covers more than one concern.
□ Does every task have either a test or an explicit validation step?
□ Are there any tasks that depend on a later sprint's work? Flag ordering violations.

COMPLETENESS
□ Are there gaps in the 15 identified gaps that are NOT addressed? List them.
□ Are there tasks in the plan that are out of scope for Nepal MVP? List them.
□ Is the deprecated formatNPR* cleanup properly sequenced (grep before delete)?
□ Is the WorkspaceSetupGate localStorage key namespaced per tenant (prevents one tenant's dismissal affecting another)?
□ Is the COUNTRY_DEFAULTS map in Sprint 0 extensible (India, US, EU) without re-architecture?
□ Does Sprint 3 handle the case where workspace settings are not yet confirmed when school wizard opens?

RISK
□ Sprint 5 has 14+ call site updates — is the risk of regression acceptable? Should it be split further?
□ Does BSDateInput handle Adhik Maas (leap month in Bikram Sambat)? Flag if not addressed.
□ Is there a risk that `workspaceConfirmedAt` timestamp logic conflicts with the lazy initialization pattern?

Output as:
  APPROVED — [list of approved items]
  FLAG — [list of issues, each with: sprint, task, problem, suggested fix]
  VERDICT: APPROVED TO IMPLEMENT or CHANGES REQUIRED

If CHANGES REQUIRED: primary agent revises sprint plan and resubmits before any implementation begins.
```

---

## AFTER SUB-AGENT REVIEW

Incorporate every FLAG item that is marked as a blocking issue. For suggestions, use your judgment.

Write the final approved sprint plan to `docs/nepal-mvp-provisioning-sprint.md`.

The document must include:
- Sprint goals and demo statements
- Every task with: name, file(s), what, validation
- Dependency graph showing sprint order
- Gap coverage table (Gap ID → Sprint + Task that closes it)
- List of files changed per sprint (for scope clarity)
- A section titled "Explicitly Out of Scope" listing what is NOT being built:
  - School-level settings override UI
  - Full Nepali language i18n translation
  - eSewa/Khalti payment gateway configuration
  - Parent/Student portal
  - Multi-currency invoicing
  - Notification timezone enforcement
  - DynamoDB schema changes (settings are already schema-correct)
  - Any changes to the auth/Cognito configuration beyond email template

---

## CONSTRAINTS THAT APPLY TO THE ENTIRE PLAN

- Do NOT rebuild TanStack Table anywhere. Cell renderers only.
- Do NOT change DiceBear avatar logic anywhere.
- Do NOT change the shell architecture (topbar z-index:50, sidebar z-index:40, no position:fixed overlays).
- Do NOT change the SBT/CDK provisioning pipeline behavior — only what data is passed to it.
- Do NOT change the Cognito User Pool auth configuration.
- Every new React component must work in both light and dark theme using CSS variables.
- Every new hook must have unit tests.
- Every new utility function must have unit tests.
- The `BSDateInput` must handle the full BS calendar range in the lookup table (BS 2000–2090).
- The `COUNTRY_DEFAULTS` map must be designed to accept new countries without breaking existing ones.
- The `WorkspaceSetupGate` localStorage key must be namespaced: `edforge-workspace-confirmed-{tenantId}` not a global key.
