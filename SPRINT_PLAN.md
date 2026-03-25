# EdForge — Bug Fixes & Quality Improvement Sprint Plan

> Generated from thorough codebase analysis on 2026-03-24.
> Reviewed by staff engineer subagent with improvements incorporated.
> Covers: Staff creation regression, Fee Structure form issues, and cross-cutting form/settings enforcement bugs.
> Focus: Nepal pilot schools — prioritizes NPR currency, Bikram Sambat calendar, and classes 1-10/12.

---

## Root Cause Analysis

### BUG 1: Staff Creation is Broken (Critical)

**Symptom**: Clicking "Add Staff Member" on the Staff Directory page creates a Cognito *user* only (`POST /api/users`), NOT an Ed-Fi-compliant staff record. The staff list remains empty because `GET /api/staff?schoolId=...` returns no items — no staff entity was ever created.

**Root Cause**: The V2 redesign of `staff.tsx` replaced the navigation to the 5-step Staff Creation Wizard (`/staff/new` -> `StaffWizard.tsx`) with a simple `CreateUserModal` that only calls `peopleService.createUser()`. This modal:
1. Only creates a Cognito user + DynamoDB user record via `POST /api/users`
2. Does NOT create a Staff entity (no `POST /api/staff` or `POST /api/staff/with-user`)
3. Does NOT create StaffSchoolAssociation / StaffAssignment
4. Does NOT collect Ed-Fi required fields (staffUniqueId, role, hireDate, employment type, school assignment)

**Evidence**:
- `staff.tsx:319` — "Add Staff Member" button calls `modal.openCreate()`
- `staff.tsx:633` — This opens `<CreateUserModal>`, NOT the wizard
- `CreateUserModal.tsx:83` — Mutation calls `peopleService.createUser()` which hits `POST /api/users`
- The 5-step wizard (`StaffWizard.tsx`) and its route (`staff/new.tsx`) still exist but are completely disconnected

**The wizard (`StaffWizard.tsx`) handles everything correctly**:
- Step 1: Personal Info (Ed-Fi demographics)
- Step 2: Contact Info
- Step 3: Employment (role, type, hire date, optional user account creation)
- Step 4: School Assignment (primary school, role assignment, FTE)
- Step 5: Review & Submit
- Calls either `POST /staff` or `POST /staff/with-user` depending on user account toggle

### BUG 2: Duplicate API Calls on Security Policies Page

**Symptom**: Two `GET /api/users` calls with different limits (50 and 100) fire on the Security Policies page.

**Root Cause**: Cache key mismatch between `rbac-security.tsx` and `AssignUserModal.tsx`:
- `rbac-security.tsx:258` — `queryKey: ['users', 'list', searchQuery]` with `limit: 50`
- `AssignUserModal.tsx:38` — `queryKey: ['users', 'list']` with `limit: 100`

Different query keys prevent React Query deduplication. Both fire independently.

### BUG 3: Fee Structure Form — Multiple Issues

**3a. Grade Levels sent as empty array (`gradeLevels: []`)**
- The form uses `[]` to mean "All Grades" — semantically confusing and fragile
- Grade levels are string literals ("PK", "K", "1"...) not references to actual school grade data
- For auto-apply on enrollment to work correctly, grade levels must reference the school's actual configuration

**3b. Currency defaults to USD instead of tenant's NPR**
- `FinanceLayout.tsx:123-126` — Settings initialized from Shell broadcast, falls back to `SYSTEM_DEFAULTS`
- `resolved-settings.ts:29` — `SYSTEM_DEFAULTS.currency = 'USD'`
- Race condition: if settings aren't broadcast before form renders, currency defaults to USD
- No backend validation prevents wrong currency from being persisted

**3c. No Bikram Sambat calendar in fee structure dates**
- `FeeStructureForm.tsx:93` — `effectiveFrom`/`effectiveTo` use plain `<input type="date">`
- BS date utilities exist in `packages/date-utils/` but aren't integrated into fee structure forms

**3d. Grade levels not validated against school configuration**
- Backend accepts any string in `gradeLevels[]` without validation
- Frontend chip toggle UX is counterintuitive (clicking a grade while "All" is active deselects only that grade)

**3e. Form UX is basic/poor quality**
- No currency display, no loading states, tax fields always visible, plain HTML date inputs

---

## Sprint Plan

### Sprint 0: Preparation & Risk Mitigation

**Goal**: De-risk the staff wizard reconnection by verifying it compiles and renders. Set up test infrastructure for Nepali tenant.

**Demoable outcome**: Staff wizard renders at `/staff/new` in dev without console errors. Nepali test tenant has correct seed data.

#### S0.1 — Smoke-test Staff Wizard compilation and rendering

**Files**:
- `edforge-saas-frontend/apps/people/src/components/staff/wizard/StaffWizard.tsx`
- `edforge-saas-frontend/apps/people/src/components/staff/wizard/staff-wizard.schemas.ts`
- `edforge-saas-frontend/apps/people/src/routes/staff/new.tsx`
- `edforge-saas-frontend/apps/people/src/services/staff.service.ts`

**Change**: Boot the wizard route `/staff/new` in dev, fix any compilation errors, verify all 5 steps render.

**Details**:
- Navigate to `/staff/new` in dev environment
- Check console for import errors, missing dependencies, or broken component references
- Verify `staff-wizard.schemas.ts` validation schemas match current `@aibrains/shared-types` DTOs
- Verify `staffService.createStaff()` and `staffService.createStaffWithUser()` method signatures haven't changed
- Fix any compilation or rendering issues found
- Document what works and what's broken

**Validation**: `/staff/new` renders all 5 wizard steps without console errors. Each step's form fields are visible and interactive.

---

#### S0.2 — Create/verify seed data for Nepali pilot tenant in dev

**Change**: Ensure a test tenant exists with Nepal-specific configuration for all subsequent testing.

**Details**:
- Verify dev tenant has:
  - `country: 'NPL'`
  - Workspace settings: `defaultCurrency: 'NPR'`, `defaultCalendarSystem: 'bikram_sambat'`, `enableDualDateDisplay: true`, `defaultLocale: 'ne-NP'`, `defaultNumberFormat: 'south_asian'`
  - At least one school with `gradeRange: { start: '1', end: '10' }` (typical Nepali school)
  - An academic year in BS format (e.g., "2082-2083") with correct Gregorian start/end dates
- If seed data doesn't exist, create it via API or seed script
- Document the test tenant ID and school ID for use in subsequent sprint validation

**Validation**: Dev environment has a Nepali tenant with complete configuration. Subsequent tasks can reference this tenant for testing.

---

### Sprint 1: Critical Staff Creation Fix

**Goal**: Restore the Ed-Fi-compliant multi-step staff creation flow. After this sprint, staff can be created with all required Ed-Fi fields and optionally linked to a user account.

**Demoable outcome**: Click "Add Staff Member" -> navigate to wizard -> complete 5 steps -> staff appears in directory with school assignment.

> **Note**: Sprint 1 and Sprint 2 can run in parallel — they touch entirely different files and domains (People app vs Finance/Shell apps).

#### S1.1 — Reconnect "Add Staff Member" to wizard & restructure split button

**File**: `edforge-saas-frontend/apps/people/src/routes/staff.tsx`

**Change**: Replace `modal.openCreate()` (which opens `CreateUserModal`) with navigation to `/staff/new`, and move user-only creation to dropdown.

**Details**:
- Line 319: Change `onClick={() => modal.openCreate()}` -> `onClick={() => navigate({ to: '/staff/new' })}`
- Import `useNavigate` from `@tanstack/react-router`
- Restructure dropdown menu:
  - Primary button: "Add Staff Member" -> navigates to wizard
  - Dropdown option 1: "Quick add user account" -> opens `CreateUserModal`
  - Dropdown option 2: "Import from CSV" (existing, coming soon)
  - Dropdown option 3: "Bulk add" (existing, coming soon)
- Keep `CreateUserModal` component and import for the dropdown option

**Validation**: Click "Add Staff Member" -> lands on `/staff/new` with 5-step wizard. Dropdown "Quick add user account" opens the simple modal.

---

#### S1.2 — Fix wizard -> backend DTO mismatches and integration issues

**Files**:
- `edforge-saas-frontend/apps/people/src/components/staff/wizard/StaffWizard.tsx`
- `edforge-saas-frontend/apps/people/src/components/staff/wizard/staff-wizard.utils.ts`
- `edforge-saas-frontend/apps/people/src/components/staff/wizard/staff-wizard.schemas.ts`
- `edforge-saas-frontend/apps/people/src/services/staff.service.ts`
- `server/application/microservices/identity/src/staff/staff.service.ts`

**Change**: Fix any DTO/schema mismatches between the wizard's data transformation and the current backend expectations. This is the task where bitrot from disconnection is addressed.

**Details**:
- Compare `staff-wizard.utils.ts` `transformWizardToDto()` output shape with current `CreateStaffDto` in `@aibrains/shared-types`
- Compare `transformWizardToWithUserDto()` output with `CreateStaffWithUserDto`
- Fix any field name changes, type changes, or missing/added fields
- Verify `staffService.createStaff()`, `staffService.createStaffWithUser()`, and `staffService.createAssignment()` client method signatures match backend controller
- Run `staff.service.spec.ts` to confirm backend tests pass
- Default "Create user account" toggle to ON (pilot schools need most staff to have login access)

**Validation**: Create staff via wizard (with and without user account) -> staff appears in directory list -> staff has correct school assignment. Backend spec tests green.

---

#### S1.3 — Verify wizard navigation (cancel, success redirect, back button)

**File**: `edforge-saas-frontend/apps/people/src/routes/staff/new.tsx`

**Change**: Ensure navigation in/out of wizard works correctly.

**Details**:
- Verify cancel button navigates back to `/staff` directory
- Verify successful creation redirects to staff detail page or directory
- Verify browser back button works correctly from each wizard step
- Fix any broken navigation

**Validation**: Cancel -> returns to directory. Complete wizard -> redirected to new staff member. Browser back works.

---

#### S1.4 — Write tests for staff creation critical path

**Files**:
- New: `edforge-saas-frontend/apps/people/src/__tests__/staff-wizard-submit.test.ts`
- Existing: `server/application/microservices/identity/src/staff/staff.service.spec.ts`

**Change**: Add component-level tests (mocking API) AND verify backend spec covers the creation path.

**Details**:
- Component test: wizard form validation rejects incomplete data
- Component test: submit without user account -> `POST /staff` called with correct DTO shape
- Component test: submit with user account -> `POST /staff/with-user` called
- Component test: additional school assignments created via `POST /staff/:id/assignments`
- Backend: verify `staff.service.spec.ts` covers `createStaff`, `createStaffWithUser`, and school assignment creation
- Add missing backend test cases if any

**Validation**: All component tests and backend spec tests pass. CI green.

---

### Sprint 2: Fix Duplicate API Calls & Currency Enforcement

**Goal**: Eliminate wasteful duplicate network calls and ensure tenant currency is correctly enforced in fee structures.

**Demoable outcome**: Security Policies page makes one user fetch. Fee Structure form shows NPR for Nepali tenant with currency indicator. Backend rejects wrong currency.

> **Note**: Can run in parallel with Sprint 1.

#### S2.1 — Fix duplicate user API calls on Security Policies page

**Files**:
- `edforge-saas-frontend/apps/shell/src/pages/settings/rbac-security.tsx`
- `edforge-saas-frontend/apps/shell/src/components/modals/AssignUserModal.tsx`

**Change**: Unify query keys and limit parameters.

**Details**:
- `rbac-security.tsx:258` — Change `queryKey: ['users', 'list', searchQuery]` -> `queryKey: ['users', 'list']`
  - `searchQuery` is in the queryKey but the API call doesn't pass it to server — client-side filtering only
- `rbac-security.tsx:259` — Change `limit: 50` -> `limit: 100` to match modal
- Both now use `queryKey: ['users', 'list']` with `limit: 100`, enabling cache deduplication
- `AssignUserModal.tsx:38` already uses `['users', 'list']` — no change needed there

**Validation**: Open Security Policies -> Network tab shows ONE `/api/users` call. Open Assign User modal -> no additional call (cached).

---

#### S2.2 — Enforce currency in fee structure form with loading guard and display

**Files**:
- `edforge-saas-frontend/apps/finance/src/routes/configuration/fee-structures.tsx`
- `edforge-saas-frontend/apps/finance/src/components/configuration/FeeStructureForm.tsx`
- `edforge-saas-frontend/apps/finance/src/layouts/FinanceLayout.tsx`

**Change**: Don't render form until settings are resolved. Show currency indicator on amount field.

**Details**:
- `FinanceLayout.tsx`: Track `settingsResolved` boolean — true when settings arrive from Shell broadcast, false initially
  - Add direct API fallback: if Shell broadcast hasn't arrived within 500ms, call `GET /api/workspace-settings` directly
  - This makes finance MFE self-sufficient rather than depending on inter-MFE messaging timing
- `FeeStructureForm.tsx`: Add `currency` prop to `FeeStructureFormProps`
  - Display currency code (e.g., "NPR") as prefix on the Amount input field
  - NPR formatting: no decimal places (NPR 20,000 not NPR 20,000.00)
- `fee-structures.tsx`: Pass `settings.currency` to form; only render form when settings are resolved

**Validation**: Create fee structure for Nepali tenant -> form shows "NPR" prefix on amount -> API payload has `currency: "NPR"`.

---

#### S2.3 — Add backend currency validation for fee structures

**Files**:
- `server/application/microservices/finance/src/fee-structures/fee-structures.service.ts`
- New test cases in fee structure spec

**Change**: Validate that currency in create DTO matches tenant's configured currency. Emit structured log on mismatch.

**Details**:
- On create, fetch workspace settings for the tenant (or get from request context if available)
- Compare `dto.currency` with `workspaceSettings.regional.defaultCurrency`
- If mismatch, return 400 with error code `CURRENCY_MISMATCH` and clear message
- Emit structured log with `{ event: 'currency_mismatch', expected, received, tenantId }` for monitoring/alerting
- Add unit test: create with wrong currency -> 400. Correct currency -> 201.

**Validation**: `POST` fee structure with `currency: "USD"` for Nepali tenant -> 400. With `currency: "NPR"` -> 201. Structured log emitted on mismatch.

---

### Sprint 3: Fee Structure Form Redesign

**Goal**: Redesign the fee structure form with proper grade level selection, BS calendar integration, and improved UX.

**Demoable outcome**: Fee structure form with multi-select grade dropdown, BS date pickers, currency indicator, and clean grouped layout.

#### S3.1 — Create shared TenantDatePicker component

**File**: New `edforge-saas-frontend/packages/ui/src/components/TenantDatePicker.tsx`

**Change**: Reusable date picker that handles BS/Gregorian based on resolved settings. Created first so it can be consumed in S3.4.

**Details**:
- Props: `value: string` (ISO Gregorian), `onChange: (iso: string) => void`, `label`, `error`, `calendarSystem`, `enableDualDateDisplay`
- When `calendarSystem === 'bikram_sambat'`: render BS date picker using existing `packages/date-utils/` utilities
  - Convert displayed BS date to/from Gregorian for form state
  - If `enableDualDateDisplay`, show both BS and AD values
- When `calendarSystem === 'gregorian'`: render standard date picker (not plain `<input type="date">`)
- Internally always produces ISO Gregorian string
- Export from `@edforge/ui` package

**Validation**: Component renders BS picker for `bikram_sambat` setting. Selecting BS 2083/01/15 produces correct Gregorian ISO string. Dual display shows both.

---

#### S3.2 — Create shared CurrencyInput component

**File**: New `edforge-saas-frontend/packages/ui/src/components/CurrencyInput.tsx`

**Change**: Reusable currency amount input. Created first so it can be consumed in S3.5.

**Details**:
- Props: `value`, `onChange`, `currency` (e.g., "NPR"), `numberFormat` ("south_asian" | "international")
- Display currency code as prefix
- Format display based on `numberFormat` — South Asian: 20,00,000 (lakhs/crores grouping)
- NPR: no decimal places. USD: 2 decimal places.
- Currency is read-only (not user-editable)

**Validation**: NPR input shows "NPR" prefix, South Asian grouping (20,000). USD shows "$ 20,000.00".

---

#### S3.3 — Replace grade level chips with multi-select dropdown

**File**: `edforge-saas-frontend/apps/finance/src/components/configuration/FeeStructureForm.tsx`

**Change**: Replace `GradeLevelChips` with a multi-select dropdown. Change semantics: "All Grades" now sends explicit grade list.

**Details**:
- Remove `GradeLevelChips` component
- Implement multi-select dropdown using Headless UI `Listbox` (already a project dependency)
- Options populated from `gradeOptions` (school's actual grade range, e.g., ["1","2",...,"10"] for Nepali school)
- "All Grades" is a special option that selects/deselects all individual grades
- When "All Grades" selected, populate `gradeLevels` with all values from `gradeOptions` (NOT empty array)
- Selected grades shown as tags/badges below dropdown
- When all grades individually selected, auto-show "All Grades" indicator
- Frontend always sends explicit grade list now

**Validation**: Dropdown shows school grades -> select specific grades -> tags appear -> submit contains those grades. "All Grades" -> submit contains full list like `["1","2","3","4","5","6","7","8","9","10"]`.

---

#### S3.4 — Integrate BS date picker and currency input into FeeStructureForm

**Files**:
- `edforge-saas-frontend/apps/finance/src/components/configuration/FeeStructureForm.tsx`
- `edforge-saas-frontend/apps/finance/src/routes/configuration/fee-structures.tsx`

**Change**: Replace plain `<input type="date">` with `TenantDatePicker` and `<input type="number">` with `CurrencyInput`.

**Details**:
- Add `calendarSystem`, `enableDualDateDisplay`, and `currency` props to `FeeStructureFormProps`
- Replace `effectiveFrom`/`effectiveTo` inputs with `TenantDatePicker`
- Replace amount input with `CurrencyInput`
- `fee-structures.tsx`: Pass settings props from `useFinanceSettings()` to form

**Validation**: Nepali tenant fee form shows BS date pickers and NPR amount input. Gregorian tenant shows standard pickers and correct currency.

---

#### S3.5 — Validate grade levels against school grade range on backend

**File**: `server/application/microservices/finance/src/fee-structures/fee-structures.service.ts`

**Change**: On create/update, validate grade level strings against school's configured `gradeRange`.

**Details**:
- Fetch school entity to get `gradeRange.start` and `gradeRange.end`
- Compute valid grades using `ORDERED_GRADES` slice
- Reject any grade strings not in the valid set
- Return 400 with specific invalid grades listed
- Also add unit test for `getEnrollmentFees()` backward compatibility: verify it still works for both old `gradeLevels: []` records AND new explicit grade lists

**Validation**: Create fee with grade "11" for school with gradeRange 1-10 -> 400. Valid grades -> 201. Existing `[]` records still match in enrollment billing.

---

#### S3.6 — Improve fee structure form layout and grouped sections

**File**: `edforge-saas-frontend/apps/finance/src/components/configuration/FeeStructureForm.tsx`

**Change**: Restructure form layout with logical grouping and conditional visibility.

**Details**:
- Group fields with section headers:
  - **Basic Info**: Name, Description, Fee Type, Academic Year
  - **Pricing**: Amount (CurrencyInput), Tax Type, Tax Rate (only visible when Tax Type != "none")
  - **Scope**: Grade Levels (multi-select dropdown), Frequency
  - **Enrollment Rules**: Auto-apply on enrollment toggle, Pro-rate on mid-term entry toggle
  - **Effective Period**: From date, To date (TenantDatePicker)
- Conditionally show Tax Rate only when Tax Type is not "none"
- Add loading skeleton while academic years / school data load
- Apply V2 design system styling consistent with rest of app

**Validation**: Form renders with clean grouped sections. Tax rate hidden when "none". Proper loading states.

---

#### S3.7 — Backfill existing `gradeLevels: []` fee structures (migration script)

**Change**: One-time data migration to populate explicit grade lists for existing records.

**Details**:
- Write a DynamoDB scan+update script that:
  - Finds all fee structures with `gradeLevels: []`
  - For each, looks up the school's `gradeRange`
  - Populates `gradeLevels` with the explicit list from the school's range
- Run in dev/staging first, then production
- Include dry-run mode that logs what would change without writing
- This eliminates the need to maintain two code paths in `getEnrollmentFees()` long-term

**Validation**: Dry-run shows correct mappings. After run, no fee structures have `gradeLevels: []`. Enrollment billing still works.

---

### Sprint 4: Settings Resolution Hardening & Finance Forms Audit

**Goal**: Make settings resolution robust (direct API fallback), audit finance-specific forms for currency/calendar issues.

**Demoable outcome**: Finance module never shows USD for Nepali tenant, even under slow network. All finance forms use correct calendar.

> **Scope narrowed for MVP**: Audit finance app only (not all 4 MFEs). Only fee structure and academic year forms need BS calendar. Post-pilot: expand to all apps.

#### S4.1 — Add direct API fallback for workspace settings in FinanceLayout

**File**: `edforge-saas-frontend/apps/finance/src/layouts/FinanceLayout.tsx`

**Change**: If Shell broadcast hasn't arrived within 500ms, fetch settings directly via API.

**Details**:
- On mount, start a 500ms timer
- If `onSchoolChange` callback fires before timeout, use broadcast settings (current path)
- If timeout fires first, call `GET /api/tenants/:tenantId/workspace-settings` directly
- Use `apiGet` from `@edforge/api-client`
- Merge response into `ResolvedSettings` format
- Cancel timer if broadcast arrives first (no double-fetch)
- This makes finance MFE self-sufficient for settings

**Validation**: Simulate slow Shell broadcast -> finance module still resolves correct NPR settings via API fallback within ~600ms.

---

#### S4.2 — Audit finance app forms for currency hardcoding

**Files**: All form components in `edforge-saas-frontend/apps/finance/src/`

**Change**: Find and fix any form that hardcodes "USD" or doesn't use resolved settings currency.

**Details**:
- Search for `USD`, `\$`, `dollar`, `currency` in finance app code
- Check: invoice forms, payment forms, billing account forms, report displays
- Verify each uses `settings.currency` from `useFinanceSettings()`
- Fix any instances found
- Document findings

**Validation**: Grep for hardcoded "USD" in finance form code -> zero results (except type definitions/defaults).

---

#### S4.3 — Audit finance app date inputs for BS calendar support

**Files**: All form components in `edforge-saas-frontend/apps/finance/src/` with date inputs

**Change**: Replace plain `<input type="date">` in finance forms with `TenantDatePicker`.

**Details**:
- Search for `type="date"`, `type="datetime"`, `DatePicker` in finance app
- Prioritize: fee structures (done in S3.4), invoice dates, payment dates, billing period dates
- Replace with `TenantDatePicker` (created in S3.1)
- Verify BS conversion produces correct Gregorian dates

**Validation**: All date inputs in finance forms use TenantDatePicker. Nepali tenant sees BS dates.

---

### Sprint 5: Backend Data Integrity & Validation Hardening

**Goal**: Add backend validation to prevent invalid data regardless of frontend bugs. Defense-in-depth.

**Demoable outcome**: Backend rejects invalid data with clear error messages. Monitoring alerts on validation failures.

#### S5.1 — Add workspace-settings-aware validation guard for finance endpoints

**File**: New `server/application/microservices/finance/src/common/guards/workspace-settings.guard.ts`

**Change**: NestJS guard that injects workspace settings into request context for use by service-level validation.

**Details**:
- Guard fetches workspace settings for the current tenant (from `x-tenant-id` header)
- Attaches settings to request object (e.g., `request.workspaceSettings`)
- Caches per-request to avoid repeated DB lookups
- Apply to fee structure, invoice, and payment controllers

**Validation**: Guard correctly attaches workspace settings to request. Services can access them.

---

#### S5.2 — Add staff creation validation: require school assignment

**File**: `server/application/microservices/identity/src/staff/staff.service.ts`

**Change**: Validate that `createStaff` always includes valid `primarySchoolId`.

**Details**:
- Validate `primarySchoolId` is provided and is a real school in the tenant
- Validate `role` is a valid staff role enum value
- Validate `hireDate` is a valid date (not in future by more than 30 days — grace for pre-hire entry)
- Add corresponding test cases

**Validation**: Create staff without schoolId -> 400. Invalid schoolId -> 400. Valid data -> 201.

---

#### S5.3 — Add fee structure effective date validation

**File**: `server/application/microservices/finance/src/fee-structures/fee-structures.service.ts`

**Change**: Validate effective dates against academic year dates.

**Details**:
- `effectiveFrom` should be within or close to the academic year's date range (warn if outside, don't block)
- `effectiveTo` should be after `effectiveFrom` (already validated in frontend schema)
- Add validation that `effectiveFrom` is a valid ISO date string
- Return warning field in response (not blocking) if dates don't align with academic year

**Validation**: Create fee with dates outside academic year -> 201 with warning. Dates within range -> clean 201. Invalid date format -> 400.

---

#### S5.4 — Protect versioned fee structures from hard delete

**File**: `server/application/microservices/finance/src/fee-structures/fee-structures.service.ts`

**Change**: Convert delete to soft-delete for versioned fee structures to preserve audit trail.

**Details**:
- If `fee.version > 1` or `fee.versionParentId` is set, soft-delete (set `isActive: false`, `deletedAt: now`)
- Only hard-delete version 1 structures with no children
- This preserves version history and audit trail for compliance

**Validation**: Delete a versioned fee structure -> soft-deleted (isActive: false). Delete a v1 structure with no children -> hard-deleted.

---

### Sprint 6: E2E Testing & Final Polish

**Goal**: Comprehensive end-to-end testing of all fixed flows. Verify complete workflows for Nepali pilot.

**Demoable outcome**: Complete staff + fee structure flows working end-to-end for Nepali tenant with BS calendar, NPR, and proper grade levels.

#### S6.1 — E2E test: Staff creation flow (wizard -> directory -> assignment)

**Details**:
- Test complete wizard flow: fill all 5 steps -> submit -> verify staff in directory
- Test with user account creation toggle on/off
- Test cancel navigation returns to directory
- Test validation at each step (required fields)
- Verify staff appears in `GET /staff?schoolId=...`
- Verify StaffAssignment created via `GET /staff/:id/assignments`
- Test split button dropdown "Quick add user account" still works

**Validation**: All tests pass. Staff creation is end-to-end functional.

---

#### S6.2 — E2E test: Fee structure creation for Nepali tenant

**Details**:
- Test: form shows NPR currency indicator
- Test: BS date picker renders and converts correctly
- Test: grade level dropdown shows school's grades (1-10)
- Test: specific grade selection -> correct payload
- Test: "All Grades" -> explicit grade list in payload (not `[]`)
- Test: auto-apply on enrollment with grade filtering works with new explicit format
- Test: backend rejects wrong currency
- Test: backend rejects invalid grade levels
- Test: tax rate hidden when tax type is "none"

**Validation**: All tests pass.

---

#### S6.3 — E2E test: Security Policies page — single user fetch

**Details**:
- Test: page load -> single `/api/users` call
- Test: open Assign User modal -> no additional call
- Test: assign role -> cache invalidation -> single fresh fetch

**Validation**: Network assertions pass.

---

## Priority Matrix

| Sprint | Priority | Effort | Impact | Parallelizable |
|--------|----------|--------|--------|----------------|
| Sprint 0 (Prep) | P0 | Low | Risk mitigation | Standalone |
| Sprint 1 (Staff Creation) | P0 — Critical | Medium | Staff cannot be created | Yes, with Sprint 2 |
| Sprint 2 (API Calls & Currency) | P1 — High | Low | Data integrity | Yes, with Sprint 1 |
| Sprint 3 (Fee Form Redesign) | P1 — High | Medium | Unusable for Nepali schools | After Sprint 2 |
| Sprint 4 (Settings Hardening) | P2 — Medium | Low-Medium | Systemic robustness | After Sprint 3 |
| Sprint 5 (Backend Validation) | P2 — Medium | Medium | Defense-in-depth | After Sprint 3 |
| Sprint 6 (E2E Testing) | P2 — Medium | Medium | Confidence | After all others |

## Known Tech Debt (Post-Pilot)

These items are acceptable for MVP pilot but should be tracked:

1. **Grade levels as strings, not foreign keys**: If a school changes its `gradeRange`, existing fee structures aren't updated. Acceptable because schools won't change grade ranges mid-year. Post-pilot: consider `gradeConfigurationId` reference pattern.

2. **Settings broadcast architecture**: The Shell-to-MFE broadcast pattern is fragile. S4.1 adds an API fallback for finance, but the same issue affects all MFEs. Post-pilot: embed resolved settings in MFE initialization context (module federation `init()`).

3. **`getEnrollmentFees` client-side filter**: Fetches all fee structures and filters in app code. Fine for pilot (< 100 fee structures per school). Post-pilot: add DynamoDB GSI indexing by grade level.

4. **Nepal-specific grade labels**: `GRADE_LEVEL_OPTIONS` has English labels ("Pre-K", "Kindergarten"). For deeper Nepali localization, add Nepali labels via i18n. Not blocking for pilot (English-educated admin users).

5. **All MFE forms audit**: Sprint 4 narrows to finance app. Academics, People, and Shell apps also have date/currency inputs that need audit. Post-pilot sprint.

6. **Fee structure hard delete**: S5.4 adds soft-delete for versioned structures, but non-versioned structures still hard-delete. Post-pilot: consider soft-delete for all.

## Key Files Reference

| Component | Path |
|-----------|------|
| Staff Directory (V2) | `edforge-saas-frontend/apps/people/src/routes/staff.tsx` |
| CreateUserModal (broken shortcut) | `edforge-saas-frontend/apps/people/src/components/staff/CreateUserModal.tsx` |
| Staff Wizard (correct flow) | `edforge-saas-frontend/apps/people/src/components/staff/wizard/StaffWizard.tsx` |
| Staff Wizard Route | `edforge-saas-frontend/apps/people/src/routes/staff/new.tsx` |
| Wizard Schemas | `edforge-saas-frontend/apps/people/src/components/staff/wizard/staff-wizard.schemas.ts` |
| Wizard Utils | `edforge-saas-frontend/apps/people/src/components/staff/wizard/staff-wizard.utils.ts` |
| Staff Service (frontend) | `edforge-saas-frontend/apps/people/src/services/staff.service.ts` |
| Staff Service (backend) | `server/application/microservices/identity/src/staff/staff.service.ts` |
| Staff Controller | `server/application/microservices/identity/src/staff/staff.controller.ts` |
| Staff Assignment Service | `server/application/microservices/identity/src/staff/staff-assignment.service.ts` |
| Users Service (backend) | `server/application/microservices/identity/src/users/users.service.ts` |
| Fee Structure Form | `edforge-saas-frontend/apps/finance/src/components/configuration/FeeStructureForm.tsx` |
| Fee Structures Page | `edforge-saas-frontend/apps/finance/src/routes/configuration/fee-structures.tsx` |
| Fee Structure Service (backend) | `server/application/microservices/finance/src/fee-structures/fee-structures.service.ts` |
| Enrollment Billing Webhook | `server/application/microservices/finance/src/webhooks/enrollment-billing.service.ts` |
| Finance Layout | `edforge-saas-frontend/apps/finance/src/layouts/FinanceLayout.tsx` |
| Resolved Settings | `edforge-saas-frontend/packages/config/src/resolved-settings.ts` |
| RBAC Security Page | `edforge-saas-frontend/apps/shell/src/pages/settings/rbac-security.tsx` |
| Assign User Modal | `edforge-saas-frontend/apps/shell/src/components/modals/AssignUserModal.tsx` |
| BS Date Utilities | `edforge-saas-frontend/packages/date-utils/src/` |
| Grade Levels Config | `packages/shared-types/src/schemas/identity/grade-levels.ts` |
| Workspace Settings Entity | `server/application/microservices/identity/src/common/entities/workspace-settings.entity.ts` |
| Ed-Fi Staff Mapper | `packages/shared-types/src/mappers/edfi/staff.mapper.ts` |
