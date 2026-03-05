# School Creation & Configuration — Production Readiness Sprint Plan

## Executive Summary

A staff-engineer-level audit of the School Creation Wizard, backend API, and downstream consumers (Curriculum, Academics). This document identifies every gap, inconsistency, and missing feature required to make the "Add School" flow production-ready for Pilot Schools, then organizes remediation into atomic, commitable sprints.

This plan was independently reviewed by a second engineer to verify completeness, ticket atomicity, dependency ordering, and Ed-Fi compliance coverage. All review findings have been incorporated.

---

## Audit Findings

### Critical Issues (P0 — Must Fix Before Pilot)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| C1 | **School Type → Grade Range not auto-updating.** Changing school type in Step 1 does NOT update grade range dropdowns. User selects "Elementary" but grade range stays 9–12 (the `high` default). The wizard `initialData` sets `high/9/12` but no `useEffect` in `BasicInfoStep` watches `schoolType` to reset grade range. | `BasicInfoStep.tsx` | User submits contradictory data (elementary school with 9–12 range). Breaks downstream curriculum, compliance, and reporting. |
| C2 | **Submitted payload contains contradictory data.** From the captured request: `schoolType: "middle"`, `gradeRange: { start: "9", end: "12" }`, `schoolCategories: ["HighSchool"]`. A middle school cannot have 9–12 grade range and HighSchool category. Backend performs zero cross-field validation. | `schools.service.ts`, `school.schema.ts` | Invalid data persisted in production, compliance failures, incorrect Ed-Fi exports. |
| C3 | **Curriculum page shows ALL grade levels (PK–12) regardless of school's gradeRange.** `GradeLevelsTab.tsx` iterates `GRADE_LEVEL_OPTIONS` (PK–12 hardcoded) without filtering by the selected school's configured grade range. | `GradeLevelsTab.tsx` | Confusing UX; courses can be assigned to grades outside the school's range; compliance violations. |
| C4 | **404 on `GET /schools/:schoolId/academic-years/current`** — new schools have no academic year, but the curriculum page calls this endpoint unconditionally. React Query retries 3 times on 404, causing 3 failed requests per page load. No graceful empty-state or onboarding flow. | Curriculum page, `useSchool.ts` | Red errors in console, potentially broken page state for newly-created schools. |
| C5 | **School status stuck at `setup` forever.** School is created with `status: 'setup'` but there is no mechanism/UI to transition it to `active`. No setup checklist or activation flow exists. | `schools.service.ts`, frontend | Schools may be unusable in downstream features that filter by `status: 'active'`. |
| C6 | **No SchoolConfiguration created on school creation.** The backend creates the school entity but does NOT auto-create a `SchoolConfiguration` entity. Config is lazy-created on first GET, which means if any feature reads config before the settings page is visited, it triggers a side-effect write in a GET request. | `schools.service.ts:createSchool()` | Race conditions, unexpected writes in GET calls. |
| C7 | **`updateSchool` has no cross-validation either.** PATCHing only `schoolType` to `elementary` without updating `gradeRange` puts the school in a contradictory state. The generic PATCH endpoint also accepts `status` in the body, bypassing any future status transition validation. | `schools.service.ts:updateSchool()`, `school.schema.ts` | Data integrity backdoor; status transition rules can be circumvented. |

### High Issues (P1 — Required for Production Quality)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| H1 | **No backend cross-validation between schoolType and gradeRange.** Backend accepts any schoolType+gradeRange combination without validation. An elementary school with grades 9–12 is silently accepted. | `school.schema.ts`, `schools.service.ts` | Data integrity; bad data propagates to Ed-Fi exports. |
| H2 | **Ed-Fi Compliance step auto-suggest only fires on mount (empty deps `[]`).** If user goes back to Step 1, changes school type, then returns to Step 4, the auto-suggested category and descriptor are NOT re-computed. | `EdFiComplianceStep.tsx:useEffect([], [])` | Stale Ed-Fi suggestions after type change; user may submit mismatched descriptors. |
| H3 | **Grade levels on EdFi step use additionalGrades in local `useState`.** If user navigates forward then back, `additionalGrades` resets to `[]` because component remounts. Previously selected additional grades are lost. | `EdFiComplianceStep.tsx` | Data loss during wizard navigation. |
| H4 | **Review step shows raw LEA UUID** instead of human-readable LEA name. `SummaryField label="District (LEA)" value={data.localEducationAgencyId}` shows a UUID. | `ReviewStep.tsx:143` | Poor UX; user cannot verify LEA selection. |
| H5 | **No school edit/update wizard.** Schools can only be created, not edited through the wizard. Updating a school requires direct API calls or a separate UI that doesn't exist. | Frontend | Users cannot fix mistakes post-creation without developer intervention. |
| H6 | **`shortName` field not auto-populated.** The shortName in Step 1 is optional and empty by default. But the submitted DTO uses `shortName: (data.shortName) || undefined` which means it's often undefined. Meanwhile the captured request shows `shortName: "TSO"` being set to school code, suggesting a disconnect. | `BasicInfoStep.tsx`, `transformWizardDataToDto` | Inconsistent short name behavior; some views may show blank. |
| H7 | **Timezone hardcoded to `America/Chicago` in DTO transform.** `transformWizardDataToDto()` hardcodes `timezone: 'America/Chicago'` regardless of the school's address or user's selection. Backend default is `America/New_York`. No timezone picker in the form. | `school-wizard.utils.ts:171` | Incorrect time calculations for schools in other timezones. |
| H8 | **No EdFi Compliance step validation schema.** The EdFi step has no Zod schema. Empty identification code entries (added but not filled) are submitted as-is with blank `identificationCode` values. | `school-wizard.schemas.ts`, `SchoolWizard.tsx` | Invalid/empty data in Ed-Fi exports; backend Zod validation may reject (identificationCode min 1 char). |
| H9 | **Curriculum grade levels derived from courses, not school config.** Even when school has `gradeLevels` field populated, the curriculum page ignores it and uses a hardcoded PK-12 list, deriving grade content from courses only. | `GradeLevelsTab.tsx` | School's configured grade levels are meaningless downstream. |
| H10 | **No academic year auto-creation on school setup.** A new school needs an academic year before curriculum, sections, schedules, or attendance can function. No onboarding flow creates one. | Backend, Frontend | New schools are effectively non-functional until admin manually creates an academic year. |
| H11 | **Duplicate `GRADE_LEVEL_OPTIONS` arrays across codebase.** At least 3 separate definitions: `school-wizard.utils.ts` (`GRADE_OPTIONS`), `course.form.ts` (`GRADE_LEVEL_OPTIONS`), and `student.form.ts` (`GRADE_LEVEL_OPTIONS`). These can drift out of sync. | Multiple frontend files | Inconsistent grade options across different UI surfaces. |
| H12 | **Address completeness not validated.** User can fill `street1` but leave `city`, `state`, `zipCode` empty. Backend schema requires all if address object is present, but frontend `locationContactSchema` has no address field validation — only email/website format. | `school-wizard.schemas.ts`, `school.schema.ts` | Backend rejects partially-filled addresses with a confusing error; or partial addresses are silently accepted if backend doesn't validate properly. |

### Medium Issues (P2 — Should Fix)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| M1 | **School code auto-generation is naive.** `generateSchoolCode("A")` → `"A"` (1 char, fails min 2 validation). `generateSchoolCode("Test-School")` → `"T"` (ignores hyphenated words). | `school-wizard.utils.ts:110-117` | Auto-generated codes may fail validation. |
| M2 | **No confirmation dialog before school creation.** Clicking "Create School" on Review step immediately submits. No "Are you sure?" confirmation for this irreversible (school code cannot change) operation. | `SchoolWizard.tsx` | Accidental school creation. |
| M3 | **Error handling on submit is minimal.** `handleSubmit` has no try/catch; errors propagate to WizardContainer's generic error handler. Duplicate school code error (`ConflictException`) is not shown as a user-friendly message. | `SchoolWizard.tsx:124-129` | Users see generic "Something went wrong" instead of "School code already exists". |
| M4 | **`locale` hardcoded to `en-US`.** No locale picker in the form. Hardcoded in `transformWizardDataToDto()`. | `school-wizard.utils.ts` | Schools serving non-English populations have incorrect locale. |
| M5 | **`academicCalendarType` hardcoded to `semester`.** No calendar type picker in the form. Some schools use quarter or trimester. | `school-wizard.utils.ts` | Incorrect calendar type for non-semester schools. |
| M6 | **Address validation is weak.** State is validated as `z.string().min(1).max(100)` but should be a 2-letter US state code for US addresses. Zip code has no format validation. | `school.schema.ts` | Invalid address data. |
| M7 | **`contactInfo` field in schema but not used.** The schema defines `contactInfo` as optional but the wizard/DTO never populates it. Dead schema field. | `school.schema.ts` | Confusion; potential for partial data. |
| M8 | **No duplicate school name check.** Backend checks for duplicate school code but not duplicate school name. Two schools named "Lincoln High School" with codes "LHS1" and "LHS2" are allowed. | `schools.service.ts` | Confusing for users who see two identically-named schools. |
| M9 | **Delete school is soft-delete to `inactive` but not `closed`.** The `deleteSchool` method sets status to `inactive`, but the schema defines `closed` as a separate terminal status. Semantic confusion. | `schools.service.ts:375-389` | Status lifecycle is ambiguous. |
| M10 | **Ed-Fi `titleIPartASchoolDesignationDescriptor` uses freeform string.** Should be an enum with Ed-Fi standard values ("Not A Title I School", "Title I Schoolwide Eligible", etc.) instead of `z.string().max(200)`. | `school.schema.ts` | Ed-Fi compliance gap. |
| M11 | **DynamoDB query in `createSchool` reads entire school partition.** Duplicate school code check queries ALL entities with SK prefix `SCHOOL#`, which includes departments, configs, and calendar dates (can outnumber school entities 400:1). | `schools.service.ts:61-67` | Performance degradation as data grows. |

### Low Issues (P3 — Nice to Have)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| L1 | **No address autocomplete/geocoding.** Address is manually typed with no Google Maps or similar integration. | `LocationContactStep.tsx` | Slower data entry; potential for typos. |
| L2 | **No image upload for school logo.** `logoUrl` field exists in schema but no upload UI. | Frontend | Cannot brand schools. |
| L3 | **No bulk import for schools.** Large districts with 50+ schools must create each one manually. | Frontend/Backend | Poor scalability for large tenants. |
| L4 | **Students column on grade level tab always shows `—`.** Placeholder, never connected to actual enrollment data. | `GradeLevelsTab.tsx:229` | Incomplete UI. |
| L5 | **Ed-Fi `ORDERED_GRADES` missing Postsecondary.** `ORDERED_GRADES` only covers PK–12 but Ed-Fi includes `Postsecondary` for career/technical schools with 13th-year programs. | `school-wizard.utils.ts` | Compliance gap for vocational schools. |

---

## Recommended Grade Range Defaults by School Type

To fix C1, the following mapping should be implemented:

| School Type | Default Grade Start | Default Grade End | Notes |
|-------------|-------------------|-----------------|-------|
| `elementary` | `PK` | `5` | Pre-K through 5th |
| `middle` | `6` | `8` | 6th through 8th |
| `high` | `9` | `12` | 9th through 12th |
| `k12` | `PK` | `12` | Full Pre-K through 12th |
| `charter` | `PK` | `12` | Full range (user customizes) |
| `private` | `PK` | `12` | Full range (user customizes) |
| `vocational` | `9` | `12` | Typically high school level |
| `special_education` | `PK` | `12` | Full range (user customizes) |

---

## Sprint Plan

### Sprint 1: School Type ↔ Grade Range Sync & Cross-Validation

**Goal:** When the user changes school type, grade range updates automatically. Backend rejects contradictory type/range combinations. Grade constants are unified across the codebase. This sprint makes the core Step 1 data model consistent and trustworthy.

**Demoable Outcome:** Change school type dropdown → grade range auto-updates. Submit contradictory data via API → gets rejected with descriptive error. Existing schools with bad data can be identified.

**Fixes:** C1, C2, C7, H1, H11

---

#### Ticket 1.1: Consolidate grade level constants into @aibrains/shared-types

**File:** `packages/shared-types/src/schemas/identity/grade-levels.ts` (new), update imports in `course.form.ts`, `student.form.ts`, `school-wizard.utils.ts`

**Task:**
- Create `packages/shared-types/src/schemas/identity/grade-levels.ts` with canonical definitions:
  - `ORDERED_GRADES`: `['PK', 'K', '1', '2', ... '12']`
  - `GRADE_LEVEL_OPTIONS`: `[{ value: 'PK', label: 'Pre-K' }, ...]`
  - `GRADE_RANGE_TO_DESCRIPTOR`: mapping from grade code to Ed-Fi descriptor name
  - `getGradeLevelLabel(value: string): string` helper
- Export from shared-types barrel file
- Replace duplicate definitions in:
  - `edforge-saas-frontend/apps/shell/src/components/settings/school-wizard/school-wizard.utils.ts` (remove `GRADE_OPTIONS`, `ORDERED_GRADES`, `GRADE_RANGE_TO_DESCRIPTOR`)
  - `edforge-saas-frontend/apps/academics/src/schemas/course.form.ts` (remove `GRADE_LEVEL_OPTIONS`, `getGradeLevelLabel`)
  - `edforge-saas-frontend/apps/academics/src/schemas/student.form.ts` (remove `GRADE_LEVEL_OPTIONS`)
- Update all import paths

**Validation:**
- `grep -r "GRADE_LEVEL_OPTIONS" apps/` → all point to shared-types re-exports only
- `grep -r "ORDERED_GRADES" apps/` → all point to shared-types re-exports only
- Build succeeds for both shell and academics apps
- Existing tests pass

---

#### Ticket 1.2: Add school type → grade range default mapping constant

**File:** `packages/shared-types/src/schemas/identity/grade-levels.ts` (extend from 1.1)

**Task:**
- Add `SCHOOL_TYPE_GRADE_DEFAULTS` constant mapping each school type to its default `{ start, end }` grade range (per table above)
- Add `getDefaultGradeRange(schoolType: string): { start: string; end: string }` helper function
- Export both

**Validation:**
- Unit test: `getDefaultGradeRange('elementary')` returns `{ start: 'PK', end: '5' }`
- Unit test: `getDefaultGradeRange('middle')` returns `{ start: '6', end: '8' }`
- Unit test: `getDefaultGradeRange('high')` returns `{ start: '9', end: '12' }`
- Unit test: `getDefaultGradeRange('k12')` returns `{ start: 'PK', end: '12' }`
- Unit test: `getDefaultGradeRange('unknown')` returns `{ start: 'PK', end: '12' }` (safe fallback)

---

#### Ticket 1.3: Wire school type change to auto-update grade range in BasicInfoStep

**File:** `edforge-saas-frontend/apps/shell/src/components/settings/school-wizard/steps/BasicInfoStep.tsx`

**Task:**
- Import `getDefaultGradeRange` from shared-types
- Add a `useEffect` that watches `data.schoolType`
- When `schoolType` changes, call `getDefaultGradeRange(schoolType)` and update both `gradeRange.start` and `gradeRange.end` via `updateData()`
- Track whether user has manually changed grade range via `gradeRangeWasManual` flag — set to `true` on any `onChange` event of the grade range dropdowns (not by comparing values to defaults)
- If `gradeRangeWasManual` is `true`, do NOT auto-update grade range on type change
- Extract the grade-range-reset logic into a pure function for testability

**Validation:**
- Unit test of the pure reset function: `shouldAutoUpdateGradeRange(wasManual=false, newType='elementary')` → returns `{ start: 'PK', end: '5' }`
- Unit test: `shouldAutoUpdateGradeRange(wasManual=true, newType='elementary')` → returns `null` (no update)
- Manual test: Select "Elementary" → grade range shows PK to 5th Grade
- Manual test: Select "Middle" → grade range shows 6th to 8th Grade
- Manual test: Select "Elementary" → manually change to PK–8 → switch to "Middle" → grade range stays PK–8 (manual override respected because onChange was triggered)

---

#### Ticket 1.4: Update wizard initialData to use the grade range helper

**File:** `edforge-saas-frontend/apps/shell/src/components/settings/school-wizard/SchoolWizard.tsx`

**Task:**
- Import `getDefaultGradeRange` from shared-types
- Replace hardcoded `'gradeRange.start': '9', 'gradeRange.end': '12'` with computed values from `getDefaultGradeRange('high')`
- Ensure `initialData` is consistent (default school type + matching grade range)

**Validation:**
- Manual test: Open wizard → default is High School with 9–12
- Code review: No hardcoded grade values remain in `SchoolWizard.tsx`

---

#### Ticket 1.5: Add backend cross-validation for schoolType vs gradeRange (create + update)

**File:** `packages/shared-types/src/schemas/identity/school.schema.ts`, `server/application/microservices/identity/src/schools/schools.service.ts`

**Task:**
- Add a `.refine()` to `schoolGradeRangeSchema` that validates start grade index ≤ end grade index using `ORDERED_GRADES`
- Add a `.superRefine()` to `createSchoolSchema` that validates grade range is reasonable for the given school type:
  - `elementary`: start must be PK/K/1, end must be ≤ 8
  - `middle`: start must be ≥ 4, end must be ≤ 9
  - `high`: start must be ≥ 7, end must be 12
  - `k12`, `charter`, `private`, `special_education`: any range PK–12 is valid
  - `vocational`: start must be ≥ 7, end must be 12
- Return descriptive error messages: "Elementary school grade range should end at or below 8th grade"
- In `schools.service.ts:updateSchool()`, when either `schoolType` or `gradeRange` is being updated: load the current school entity and validate the combination of (new value OR existing value) against the same cross-validation rules. Return 400 with descriptive message if invalid.
- Remove `status` from `UpdateSchoolDto` (or from the simple-fields list in `updateSchool()`) to prevent bypassing the dedicated status transition API (added in Sprint 3)

**Validation:**
- Unit test: elementary + {PK, 5} → valid
- Unit test: elementary + {9, 12} → invalid with descriptive error
- Unit test: middle + {6, 8} → valid
- Unit test: middle + {PK, 12} → invalid
- Unit test: k12 + {PK, 12} → valid
- Unit test: high + {9, 12} → valid
- Unit test: charter + {K, 8} → valid (charter is flexible)
- Unit test: `{ start: '12', end: '9' }` → invalid (ordering)
- Unit test: `{ start: '5', end: '5' }` → valid (single-grade school)
- Smoke test: Create high school (9-12). PATCH schoolType to "elementary" without changing gradeRange → 400 error. PATCH gradeRange to {PK, 5} simultaneously → 200.

---

### Sprint 2: Ed-Fi Compliance Step Hardening & Wizard Navigation State

**Goal:** Ed-Fi compliance step correctly reacts to school type changes, preserves state across wizard navigation, and validates its data. The Review step shows human-readable values. Address validation prevents partial entries.

**Demoable Outcome:** Navigate back and forth between steps — no data loss. Change school type after visiting Ed-Fi step — suggestions update. Review step shows LEA name, not UUID. Empty identification codes are stripped before submission.

**Fixes:** H2, H3, H4, H8, H12

---

#### Ticket 2.1: Fix Ed-Fi auto-suggest to react to school type changes (not just mount)

**File:** `edforge-saas-frontend/apps/shell/src/components/settings/school-wizard/steps/EdFiComplianceStep.tsx`

**Task:**
- Change the two `useEffect([], [])` hooks for auto-suggesting category and descriptor to depend on `schoolType`
- When `schoolType` changes, if the user hasn't manually modified the category/descriptor, update the suggestion
- Track whether user manually modified categories or descriptor (set flag on any user click/change in category toggles or descriptor dropdown)
- If user has manually set values, show a non-intrusive notice: "School type changed — suggested category is now X. Click to apply."

**Validation:**
- Manual test: Fill Step 1 as "High School" → go to Step 4 → HighSchool category suggested → go back → change to "Elementary" → return to Step 4 → Elementary category now suggested
- Manual test: On Step 4, manually select "Ungraded" → go back → change type → return → "Ungraded" stays (manual override), notice appears with suggestion

---

#### Ticket 2.2: Persist additionalGrades in wizard data instead of local useState

**File:** `edforge-saas-frontend/apps/shell/src/components/settings/school-wizard/steps/EdFiComplianceStep.tsx`

**Task:**
- Replace `const [additionalGrades, setAdditionalGrades] = useState<string[]>([])` with reading/writing from wizard `data._additionalGrades` (prefixed with underscore to indicate it's wizard-internal)
- On mount, initialize from `data._additionalGrades || []`
- On toggle, `updateData({ _additionalGrades: newArray })`
- Adjust the `useEffect` that syncs `gradeLevels` accordingly
- Ensure `transformWizardDataToDto()` strips any `_` prefixed keys from the output

**Validation:**
- Manual test: Add "Postsecondary" as additional grade → navigate to Step 5 → go back to Step 4 → "Postsecondary" is still selected
- Manual test: Submit → `_additionalGrades` is NOT in the final DTO
- Unit test: `transformWizardDataToDto()` with `_additionalGrades` in data → not present in output

---

#### Ticket 2.3: Add validation schema for Ed-Fi Compliance step

**File:** `edforge-saas-frontend/apps/shell/src/components/settings/school-wizard/school-wizard.schemas.ts`

**Task:**
- Add `edfiComplianceSchema` Zod schema
- Validate: if `identificationCodes` array has entries, each must have non-empty `identificationCode`
- Validate: if `institutionTelephones` array has entries, each must have non-empty `telephoneNumber`
- Validate: if `accountabilityRatings` array has entries, each must have non-empty `title` and `rating`
- Wire the schema into `SCHOOL_WIZARD_STEPS` for the edfi step

**Validation:**
- Manual test: Add an identification code entry → leave code blank → click Continue → validation error appears
- Manual test: Add a phone entry → fill in number → Continue → passes
- Manual test: No entries added → Continue → passes (all optional)

---

#### Ticket 2.4: Strip empty array entries in transformWizardDataToDto

**File:** `edforge-saas-frontend/apps/shell/src/components/settings/school-wizard/school-wizard.utils.ts`

**Task:**
- In `transformWizardDataToDto()`, filter out identification codes where `identificationCode` is empty string
- Filter out phone entries where `telephoneNumber` is empty
- Filter out rating entries where `title` or `rating` is empty
- After filtering, if array is now empty, set to `undefined`
- Also strip any keys starting with `_` (wizard-internal state like `_additionalGrades`)

**Validation:**
- Unit test: Transform data with one empty id code and one filled → output has only the filled one
- Unit test: Transform data with all empty id codes → output has `identificationCodes: undefined`
- Unit test: Transform data with `_additionalGrades: ['Postsecondary']` → key not in output

---

#### Ticket 2.5: Improve Review step to show human-readable values for all fields

**File:** `edforge-saas-frontend/apps/shell/src/components/settings/school-wizard/steps/ReviewStep.tsx`

**Task:**
- **LEA name resolution:** Accept LEA list as a prop (or use the `useLocalEducationAgencies` hook). Look up `data.localEducationAgencyId` in the LEA list. Display: "Rain Independent School District" with UUID in small text
- **School categories:** Show as labeled chips using `SCHOOL_CATEGORY_DESCRIPTORS` label lookup
- **Grade levels:** Show as readable labels (e.g., "Ninth Grade" not "NinthGrade") using `SCHOOL_GRADE_LEVEL_DESCRIPTORS`
- **Charter status / admin funding:** Show label from descriptor arrays, not raw enum value
- **Identification codes:** Show system type + code value per entry
- **Institution telephones:** Show type + number per entry
- **Accountability ratings:** Show title, rating, org, year per entry

**Validation:**
- Manual test: Select an LEA in Step 3 → Review step shows LEA name, not UUID
- Manual test: No LEA selected → Shows "Not assigned" or section is empty
- Manual test: Fill all Ed-Fi fields → Review step renders each with proper labels and formatting
- Manual test: No Ed-Fi fields filled → Section shows "Not provided — can be added later"

---

#### Ticket 2.6: Add address completeness validation to wizard schema

**File:** `edforge-saas-frontend/apps/shell/src/components/settings/school-wizard/school-wizard.schemas.ts`

**Task:**
- Extend `locationContactSchema` with a `.refine()`:
  - If any address field (`address.street1`, `address.city`, `address.state`, `address.zipCode`) is filled, then ALL of `street1`, `city`, `state`, and `zipCode` are required
  - Error message: "City is required when address is provided" (per missing field)
- `address.street2` and `address.country` remain optional

**Validation:**
- Manual test: Fill street1 but leave city empty → click Continue → "City is required when address is provided"
- Manual test: Leave all address fields empty → Continue succeeds (address is optional)
- Manual test: Fill all required address fields → Continue succeeds

---

### Sprint 3: School Activation Flow & Post-Creation Onboarding

**Goal:** After school creation, there's a clear path from `setup` → `active` status. The system auto-creates required downstream entities (SchoolConfiguration, Academic Year). Curriculum page handles new schools gracefully.

**Demoable Outcome:** Create school → see setup checklist → create academic year → activate school → curriculum page shows grade levels matching school config.

**Fixes:** C4, C5, C6, H9, H10

---

#### Ticket 3.1: Add transactional write support to DynamoDBClientService

**File:** `server/application/microservices/identity/src/common/services/dynamodb-client.service.ts`

**Task:**
- Add a `transactWrite(client, items: TransactWriteItem[])` method wrapping DynamoDB `TransactWriteItems`
- Each item is a `{ Put: { TableName, Item } }` or `{ Update: {...} }` or `{ Delete: {...} }`
- This ensures atomicity when creating a school + its configuration in a single request
- Handle `TransactionCanceledException` with descriptive error messages

**Validation:**
- Unit test: `transactWrite` with 2 Put items succeeds
- Unit test: `transactWrite` with a condition failure on item 2 rolls back item 1 (TransactionCanceledException)

---

#### Ticket 3.2: Auto-create SchoolConfiguration on school creation (atomic)

**File:** `server/application/microservices/identity/src/schools/schools.service.ts`

**Task:**
- In `createSchool()`, replace the single `putItem(school)` with a `transactWrite` call that atomically creates both:
  1. The school entity
  2. The default SchoolConfiguration entity
- Keep the lazy-creation logic in `getConfiguration()` as a fallback ONLY for schools created before this change ships
- Add a log line: "School and configuration created atomically: {schoolId}"

**Validation:**
- Smoke test: Create school → immediately GET `/schools/:id/configuration` → returns default config (no side-effect creation)
- Smoke test: If second put would fail (simulate condition), neither entity is created
- Unit test: `createSchool()` calls `transactWrite` with exactly 2 items

---

#### Ticket 3.3: Backfill SchoolConfiguration for existing schools

**File:** `scripts/backfill-school-config.ts` (new)

**Task:**
- Create a CLI script that:
  1. Connects to DynamoDB
  2. Queries all SCHOOL entities across tenants
  3. For each school, checks if a CONFIG entity exists (SK=`SCHOOL#{id}#CONFIG`)
  4. If missing, creates a default SchoolConfiguration
  5. Reports: X schools found, Y already had config, Z backfilled
- Idempotent (safe to run multiple times)

**Validation:**
- Run against test environment → all schools have configs after run
- Run again → "0 backfilled" (idempotent)
- After backfill, safe to remove the lazy-creation fallback from `getConfiguration()` in a future cleanup ticket

---

#### Ticket 3.4: Add school status transition API and validation

**File:** `server/application/microservices/identity/src/schools/schools.controller.ts`, `schools.service.ts`

**Task:**
- Add `PATCH /schools/:schoolId/status` endpoint with body `{ status: string }`
- Define valid state transitions:
  - `setup` → `active` (requires: name, code, type, gradeRange all present)
  - `active` → `inactive`
  - `active` → `suspended`
  - `inactive` → `active`
  - `suspended` → `active`
  - `active` → `closed` (terminal)
  - `setup` → `closed` (abandon creation)
- Validate preconditions before activation
- Publish `SchoolStatusChanged` event with payload: `{ schoolId, tenantId, previousStatus, newStatus, timestamp }`

**Validation:**
- Smoke test: Create school (status=setup) → PATCH to active → 200 OK, status=active
- Smoke test: Try to PATCH setup → suspended → 400 (invalid transition)
- Unit test: all valid transitions succeed, all invalid transitions fail
- Unit test: Event payload contains `previousStatus` and `newStatus`

---

#### Ticket 3.5: Configure useCurrentAcademicYear to not retry on 404

**File:** `edforge-saas-frontend/apps/academics/src/hooks/useSchool.ts`

**Task:**
- Add a `retry` function to `useCurrentAcademicYear` React Query options: `retry: (failureCount, error) => error.status !== 404 && failureCount < 3`
- This prevents 3 redundant failed requests for new schools with no academic year

**Validation:**
- Manual test: Select a school with no academic year → Network tab shows only 1 request to `/academic-years/current`, not 3
- Existing schools with academic years continue to work normally

---

#### Ticket 3.6: Handle missing academic year gracefully on curriculum page

**File:** `edforge-saas-frontend/apps/academics/src/routes/curriculum/index.tsx`

**Task:**
- Check `useCurrentAcademicYear()` result: if `query.isError && query.error?.response?.status === 404`, treat as "no academic year configured"
- Show an onboarding empty state: "No academic year configured for this school. Create one to get started with curriculum management."
- Add a "Create Academic Year" CTA button that links to the academic year creation flow
- Do not show grade levels table or courses tab when no academic year exists

**Validation:**
- Manual test: Select newly-created school → curriculum shows empty state with CTA, not error
- Manual test: Create academic year → refresh → curriculum loads normally
- Manual test: School with academic year → curriculum loads as before (no regression)

---

#### Ticket 3.7: Filter curriculum grade levels by school's configured gradeRange

**File:** `edforge-saas-frontend/apps/academics/src/components/curriculum/GradeLevelsTab.tsx`, `edforge-saas-frontend/apps/academics/src/routes/curriculum/index.tsx`

**Task:**
- Add `schoolGradeRange?: { start: string; end: string }` prop to `GradeLevelsTab`
- Import `ORDERED_GRADES` from shared-types (established in Sprint 1, Ticket 1.1)
- Filter `GRADE_LEVEL_OPTIONS` to only include grades within the school's configured range
- Still show any grades with courses assigned even if outside the range (with a visual indicator: "Outside configured range" badge)
- Grades within range but without courses show normally (no badge)
- Update stats to reflect filtered grade count
- In curriculum page, fetch school details using `useSchool(activeSchoolId)` and pass `school.gradeRange` to `GradeLevelsTab`
- Handle loading state while school data is being fetched; fall back to PK–12 for legacy schools with no gradeRange

**Validation:**
- Manual test: Elementary school (PK–5) → Grade levels tab shows only PK through Grade 5
- Manual test: High school (9–12) → shows only Grade 9 through Grade 12
- Manual test: Switch between schools with different grade ranges → grade levels tab updates
- Edge case: Course assigned to Grade 8 in a high school (9–12) → Grade 8 row appears with "Outside configured range" badge
- Edge case: Grade 10 in a high school (9–12) with no courses → shows normally, no badge
- Edge case: School with no gradeRange (legacy data) → falls back to PK–12

---

#### Ticket 3.8: Add school setup checklist UI component

**File:** `edforge-saas-frontend/apps/shell/src/components/settings/SchoolSetupChecklist.tsx` (new)

**Task:**
- Create a `SchoolSetupChecklist` component shown when school status is `setup`
- Checklist items:
  1. Basic information completed (always done after creation)
  2. Address and contact info added (check if address exists)
  3. Assigned to a district (check if LEA ID exists)
  4. Academic year created (check if currentAcademicYearId exists)
  5. Ed-Fi compliance fields set (check if gradeLevels and schoolCategories are populated)
- Each item shows checkmark or pending indicator
- "Activate School" button at bottom, enabled when minimum requirements met (items 1 + 4)
- Button calls the status transition API from Ticket 3.4

**Validation:**
- Manual test: Newly created school → shows checklist with most items pending
- Manual test: Create academic year → checklist updates → "Activate School" becomes enabled
- Manual test: Click "Activate School" → school status changes to active, checklist disappears

---

### Sprint 4: Error Handling, Validation Hardening & Data Quality

**Goal:** All error paths are handled gracefully. School creation is robust against bad data. Existing bad data can be identified and fixed. Form has timezone and calendar type pickers.

**Demoable Outcome:** Submit duplicate school code → friendly error message. Submit with validation errors → field-level errors appear. Run data quality report → identifies schools with mismatched type/range.

**Fixes:** M1, M2, M3, M5, H7

**Note:** Sprint 4 depends on Sprint 2 (both modify wizard step components).

---

#### Ticket 4.1: Add error handling with user-friendly messages to wizard submit

**File:** `edforge-saas-frontend/apps/shell/src/components/settings/school-wizard/SchoolWizard.tsx`

**Task:**
- Wrap `handleSubmit` in try/catch
- Parse error response to detect specific error types:
  - `ConflictException` (409): "A school with code [CODE] already exists. Please choose a different code."
  - `BadRequestException` (400): Show the error message from the server (e.g., grade range validation failure)
  - Network error: "Unable to create school. Please check your connection and try again."
  - Generic 500: "An unexpected error occurred. Please try again or contact support."
- Display error in a toast notification or inline error banner on the Review step
- Do NOT navigate away from the form on error — let user fix and retry

**Validation:**
- Manual test: Create school → create another with same code → friendly error message about duplicate code
- Manual test: Disconnect network → submit → network error message
- Manual test: After error, user can modify and resubmit successfully

---

#### Ticket 4.2: Improve school code auto-generation to handle edge cases

**File:** `edforge-saas-frontend/apps/shell/src/components/settings/school-wizard/school-wizard.utils.ts`

**Task:**
- Fix `generateSchoolCode()`:
  - Handle single-word names: "Academy" → "ACAD" (first 4 chars instead of just "A")
  - Handle hyphenated words: "K-12 Academy" → "K12A" (strip hyphens, take first chars)
  - Handle names with articles/prepositions: "The Academy of Arts" → "AA" (skip "The", "of", "and")
  - Ensure minimum 2 characters output (pad with first letters of name if needed)
  - Ensure maximum 10 characters
- Add comprehensive tests

**Validation:**
- Unit test: "Lincoln High School" → "LHS"
- Unit test: "Academy" → "ACAD"
- Unit test: "The Academy of Arts and Sciences" → "AAS"
- Unit test: "A" → "AA" (padded to minimum)
- Unit test: "K-12 School" → "K12S"
- Unit test: "" → "XX" (empty name fallback)

---

#### Ticket 4.3: Add timezone picker to the school creation wizard

**File:** `edforge-saas-frontend/apps/shell/src/components/settings/school-wizard/steps/LocationContactStep.tsx`, `school-wizard.utils.ts`

**Task:**
- Add a timezone select dropdown to the Location & Contact step
- Pre-populate based on country/state selection if available (US states → timezone mapping)
- Default to `America/Chicago` if not changed
- Common US timezones: America/New_York, America/Chicago, America/Denver, America/Los_Angeles, America/Anchorage, Pacific/Honolulu
- Update `transformWizardDataToDto()` to use the selected timezone instead of hardcoded value

**Validation:**
- Manual test: Select state "CA" → timezone auto-suggests "America/Los_Angeles"
- Manual test: Manually select timezone → submits with correct value
- Manual test: No timezone selected → defaults to America/Chicago

---

#### Ticket 4.4: Add academic calendar type selector to wizard

**File:** `edforge-saas-frontend/apps/shell/src/components/settings/school-wizard/steps/OrganizationStep.tsx`, `school-wizard.utils.ts`

**Task:**
- Add academic calendar type selector: Semester, Quarter, Trimester
- Default to Semester
- Update `transformWizardDataToDto()` to use selected value instead of hardcoded `'semester'`

**Validation:**
- Manual test: Select "Quarter" → submits with `academicCalendarType: "quarter"`
- Manual test: No change → submits with "semester" default

---

#### Ticket 4.5: Add data quality validation script for existing schools

**File:** `scripts/validate-school-data.ts` (new)

**Task:**
- Create a CLI script that:
  1. Authenticates using environment-configured AWS credentials (direct IAM, not TVM — this is an ops script)
  2. Scans DynamoDB for all SCHOOL entities across tenants
  3. Validates each school against the cross-validation rules (type vs grade range)
  4. Also validates: gradeRange ordering, required fields present, Ed-Fi descriptor values valid
  5. Reports mismatches with school ID, tenant ID, name, and specific issue
  6. Outputs a CSV of issues to `./school-data-report.csv`
- Does NOT auto-fix — report only
- Requires `AWS_REGION` and `TABLE_NAME` env vars

**Validation:**
- Run against test environment → identifies the known mismatched "Test School ONE" (middle school with 9–12 range)
- Output clearly shows the issue and affected school
- CSV file is parseable and includes all relevant columns

---

#### Ticket 4.6: Add confirmation dialog before school creation

**File:** `edforge-saas-frontend/apps/shell/src/components/settings/school-wizard/SchoolWizard.tsx`

**Task:**
- Before calling `tenantService.createSchool()`, show a confirmation dialog:
  - "Create school [Name] with code [Code]?"
  - "Note: School code cannot be changed after creation."
  - [Cancel] [Create School] buttons
- Only submit after user confirms

**Validation:**
- Manual test: Click "Create School" → dialog appears → click Cancel → nothing happens, form stays
- Manual test: Click "Create School" → dialog appears → click Create → school is created

---

### Sprint 5: School Edit Wizard & Settings Integration

**Goal:** Schools can be updated after creation through a wizard-style interface. Settings page shows complete school information and allows in-place editing.

**Demoable Outcome:** Click "Edit School" → opens pre-populated wizard → update fields → save → school data updated.

**Fixes:** H5

---

#### Ticket 5.1: Make SchoolWizard support edit mode

**File:** `edforge-saas-frontend/apps/shell/src/components/settings/school-wizard/SchoolWizard.tsx`

**Task:**
- Add `mode: 'create' | 'edit'` and optional `schoolId: string` props
- In edit mode:
  - School code field is read-only (cannot change after creation)
  - Submit text changes to "Save Changes"
  - API call changes to `tenantService.updateSchool(schoolId, dto)` instead of `createSchool(dto)`
  - Header shows "Edit School" instead of "Create New School"
  - Confirmation dialog says "Save changes to [Name]?"
- Handle the DTO differences (UpdateSchoolDto vs CreateSchoolDto — update only sends changed fields)

**Validation:**
- Manual test: Open edit wizard → school code is read-only
- Manual test: Change school name → Save → API called with PATCH, name updated
- Manual test: No changes made → Save → graceful "No changes to save" message

---

#### Ticket 5.2: Create school edit page route

**File:** `edforge-saas-frontend/apps/shell/src/pages/settings/school-edit.tsx` (new)

**Task:**
- Create route `/settings/organization/schools/:schoolId/edit`
- Fetch school data by ID using existing `tenantService.getSchool(schoolId)`
- Transform API response back to flat wizard format (inverse of `transformWizardDataToDto`)
- Pass as `initialData` to `SchoolWizard` with `mode="edit"`
- Show loading skeleton while fetching
- Handle 404 (school not found) with appropriate message

**Validation:**
- Manual test: Navigate to edit page → school data pre-populated in all wizard steps
- Manual test: Navigate to edit page for non-existent school → 404 message
- Manual test: Edit and save → redirects to organization page with updated data

---

#### Ticket 5.3: Add "Edit" action and detail view to organization settings

**File:** `edforge-saas-frontend/apps/shell/src/components/settings/organization/` (existing components)

**Task:**
- Add "Edit" button/link to each school row/card in the organization hierarchy view
- Navigate to `/settings/organization/schools/:schoolId/edit`
- Only show for users with appropriate permissions (TenantAdmin, Admin)
- Add school detail slide-over panel showing all school info (Identity, Location, Org, Ed-Fi, Config, Statistics) when clicking school name
- Include status change controls (activate, deactivate) in the detail panel, calling the status transition API

**Validation:**
- Manual test: Click "Edit" on a school → navigates to edit wizard with school data loaded
- Manual test: Non-admin user → "Edit" button not visible
- Manual test: Click school name → detail panel opens with all info
- Manual test: Click "Activate" in detail panel → school status changes

---

### Sprint 6: End-to-End Smoke Tests

**Goal:** Full end-to-end test coverage for the school creation → activation → curriculum flow. All sprints' work validated in integration.

**Demoable Outcome:** Automated test suite runs: create school → verify data → activate → verify curriculum → update school → verify changes. All pass.

**Note:** Unit tests for individual functions are written within their respective sprint tickets. This sprint covers only integration/E2E smoke tests.

---

#### Ticket 6.1: E2E smoke test for school creation happy path

**File:** `scripts/smoke-tests/school-creation.ts` (new)

**Task:**
- Script that:
  1. Creates a school via POST /schools with all fields (including Ed-Fi fields)
  2. Verifies response contains all submitted data
  3. Fetches the school via GET /schools/:id
  4. Verifies all Ed-Fi fields are persisted correctly
  5. Verifies school configuration was auto-created (GET /schools/:id/configuration returns 200)
  6. Cleans up (deletes the test school)
- Uses environment-configured auth token

**Validation:**
- Script runs successfully against deployed environment
- All assertions pass
- No orphaned test data after cleanup

---

#### Ticket 6.2: E2E smoke test for school type ↔ grade range validation

**File:** `scripts/smoke-tests/school-validation.ts` (new)

**Task:**
- Script that:
  1. Attempts to create an elementary school with grades 9–12 → expects 400 with descriptive error
  2. Creates an elementary school with grades PK–5 → expects 201
  3. Attempts to create a school with start > end grade → expects 400
  4. Creates a k12 school with grades PK–12 → expects 201
  5. Attempts to PATCH elementary school's type to "high" without changing gradeRange → expects 400
  6. Cleans up

**Validation:**
- Script runs successfully
- Invalid requests are properly rejected with descriptive error messages
- Valid requests succeed

---

#### Ticket 6.3: E2E smoke test for school activation flow

**File:** `scripts/smoke-tests/school-activation.ts` (new)

**Task:**
- Script that:
  1. Creates a school (status=setup)
  2. Creates an academic year for the school
  3. Sets the academic year as current
  4. Activates the school via status transition API
  5. Verifies status is now `active`
  6. Verifies curriculum API works (no 404 on current academic year)
  7. Attempts invalid transition (active → setup) → expects 400
  8. Cleans up

**Validation:**
- Script runs successfully
- All status transitions work correctly
- Event payloads contain correct previousStatus and newStatus

---

## Dependencies Between Sprints

```
Sprint 1 (Core Sync & Validation)
    ├─→ Sprint 2 (Ed-Fi Step Hardening) — depends on shared-types constants from S1
    └─→ Sprint 3 (Activation Flow) — depends on grade-level constants from S1

Sprint 2 (Ed-Fi Hardening)
    └─→ Sprint 4 (Error Handling) — both modify wizard step components, S4 after S2

Sprint 3 (Activation Flow) — can run in parallel with Sprint 2
    └─→ Sprint 5 (Edit Wizard) — needs status transition API from S3

Sprint 4 (Error Handling) — after Sprint 2
    └─→ Sprint 5 (Edit Wizard) — reuses hardened wizard from S4

Sprint 5 (Edit Wizard) — after Sprint 3 + Sprint 4

Sprint 6 (E2E Tests) — after all previous sprints
```

**Recommended execution order:** S1 → S2 & S3 (parallel) → S4 (after S2) → S5 → S6

---

## Out of Scope (Future Work)

- Address autocomplete / geocoding (L1)
- School logo upload (L2)
- Bulk school import (L3)
- Student enrollment integration on grade levels tab (L4)
- Ed-Fi ODS push/sync
- Multi-language support / locale picker for school forms (M4)
- Postsecondary grade in ORDERED_GRADES for vocational schools (L5)
- Ed-Fi `titleIPartASchoolDesignationDescriptor` enum conversion (M10)
- Parent/Student portal school view
- GSI1 optimization for school code uniqueness check (M11)
