# Project Midnight Lockin — Sprint Plan

_Authoritative Phase 3 synthesis. Derived from `MIDNIGHT_LOCKIN_BASELINE_REPORT.md` (Phase 1) and `MIDNIGHT_LOCKIN_BASELINE_REVIEW.md` (Phase 2). Where the two conflict, the review is authoritative. Sprint target: lock the foundation before Saraswati go-live, mid-April 2026 (B.S. 2083)._

---

## Open Decisions (blocking)

_From review §7. Each needs explicit sign-off from Shoaib before the corresponding task can start. Proposed defaults represent the recommendation; each is overridable, but must be decided, not deferred._

1. **Is `country` the right abstraction, or is `archetype` distinct?** — Proposed default: **archetype is distinct**, orthogonal to country. A new enum `Archetype = 'PABSON' | 'CBSE_IN' | 'NAIS_US' | 'GEMS_UAE' | 'GENERIC'` lives on `Tenant` alongside `country`. PABSON + NPL is valid; NepalGovt + NPL is a separate archetype. Country stays ISO-3166; archetype carries governance/reporting contract. **Decision required from Shoaib.**

2. **Migration plan for existing WorkspaceSettings row when archetype is introduced** — Proposed default: add `archetype` as a new optional field on **Tenant** (not WorkspaceSettings). Existing Saraswati row gets backfilled to `PABSON` by a one-shot script before Apr 15. Workspace settings are *downstream* of archetype (archetype defaults get applied at tenant create). **Decision required from Shoaib.**

3. **Precedence for duplicated regional fields (timezone/locale/calendarSystem)** — Proposed default: **tenant is authoritative; school/SchoolConfig cannot override regional fields.** Remove `timezone`, `locale`, `calendarSystem`, `academicCalendarType` from School & SchoolConfig in v1. Keep `schoolDays`, `startTime`, `endTime`, `periodDuration`, `gradingScale` as school-specific. Finance reads tenant. Analytics already reads tenant. **Decision required from Shoaib.**

4. **Migrate finance currency from `'NPR'` literal type to `string` sourced from WorkspaceSettings before Saraswati ships?** — Proposed default: **YES** — but scoped to entity types and constructor defaults only (not a full DDB migration). Saraswati data stays NPR; types become `string`. Mappers read currency from tenant settings resolver at invoice/payment *create* time, with a runtime assertion `currency === tenantCurrency`. No DDB rewrite of existing items. **Decision required from Shoaib.**

5. **Is `BsDatePicker` approved for parent-facing contexts for Saraswati pilot?** — Proposed default: **YES for admin/teacher flows (DOB entry, exam dates); NO for parent portal v1** (parent portal remains read-only for dates, displayed as BS+AD side-by-side via `enableDualDateDisplay`). **Decision required from Shoaib.**

6. **When `isLocked` write path is implemented, what does it freeze?** — Proposed default: **(b) per-field governance extended to workspace fields.** Add `lockedDuringActiveYear` + `immutableAfterCreate` classifications to the workspace row (via `field-governance.ts`). `isLocked: boolean` remains as the UI signal but is derived from "any academic year active" OR "academic year just activated for the first time". Freeze set: `defaultCurrency`, `defaultCalendarSystem`, `defaultTimezone`, `archetype`. Mutable during active year: branding, policies. **Decision required from Shoaib.**

7. **Academic year state-machine DAG** — Proposed default:
   ```
   planning → active → completed → archived
                ↑  ↓
               (reopen from completed → active allowed; archived is terminal)
   ```
   And `status='active'` transition **atomically sets `isCurrent=true` and clears it on all other years for that school** — collapsing the two flags at write time. `isCurrent` becomes a read-time projection; mark field `@deprecated` and remove in P1. **Decision required from Shoaib.**

8. **CSV import gender normalization location** — Proposed default: **(a) normalize in service** (`students.service.ts`). Accept `M`/`F`/`Male`/`Female`/`male`/`female`/`MALE`/`FEMALE` and map to canonical `'male'|'female'`. Also accept `Other`/`other`. Template stays IEMIS-faithful. **Decision required from Shoaib.**

9. **`schoolCode` backfill → `studentNumber` regeneration policy** — Proposed default: **NO retroactive renumbering** for Saraswati 779. Once a student has a `studentNumber`, it's immutable. A new admin action "Assign canonical IDs" regenerates only for students still on the `{UUID3}-…` fallback pattern, and only if explicitly invoked. Parents never see two IDs for the same child. Ship with `schoolCode` populated at school creation so the issue never materializes in Saraswati. **Decision required from Shoaib.**

10. **`isCurrent` migration path** — Proposed default: **(a) migrate existing rows to sync** (one-shot script: for each school, find the year with `status='active'`; set `isCurrent=true` on that one and `false` on all others). Then mark `isCurrent` `@deprecated`. Remove field in P1 after dashboards and reports stop referencing it. **Decision required from Shoaib.**

11. **Cross-service auth: user JWT forwarding vs service-to-service token** — Proposed default: **keep JWT forwarding for v1 pilot (no change)**, but add task in P2 for service identity tokens. Track as known debt. Saraswati-blocking fix: add an allowlist so identity only accepts `/roles/check-permission` calls from the academics/finance VPC. **Decision required from Shoaib.**

12. **BS data support window** — Proposed default: **2000-2090 is sufficient for v1**. DOB of an 80-year-old would be ~B.S. 2003; table starts at 2000. For grad cert lookups >40 years back, document "not supported" and gate via entry validation. Extend to B.S. 1950 in P3 if needed. **Decision required from Shoaib.**

---

## P0 — Go-Live Blockers (Saraswati, mid-April 2026)

### P0.1: Add `RequireGlobalRole('TenantAdmin')` guard to `PATCH /tenants/:tenantId`
- **What**: Attach `GlobalRoleGuard` + `@RequireGlobalRole('TenantAdmin')` to the generic tenant update endpoint.
- **Why**: baseline §5.5 #1 / review §2.1 — any authenticated tenant user can currently change `name`, `status`, `branding`, `address`, `contactEmail`. Security regression.
- **Where**: `server/application/microservices/identity/src/tenants/tenants.controller.ts:143`.
- **How**: Replace `@UseGuards(JwtAuthGuard)` with `@UseGuards(JwtAuthGuard, GlobalRoleGuard)` and add `@RequireGlobalRole('TenantAdmin')` — matches pattern already in use at `:111-122` for `/settings`.
- **Acceptance**: Non-admin JWT hitting `PATCH /tenants/:tenantId` → 403. Admin JWT → 200.
- **Tests**: Unit test on controller (mock guard); integration test: (a) TenantUser role PATCH → 403, (b) TenantAdmin PATCH → 200, (c) missing JWT → 401.
- **Risk**: Minimal. 10-min change. Risk: if any internal service calls this endpoint with a TenantUser token, it will break; grep `PATCH /tenants/` confirms none.
- **Dependencies**: None.

### P0.2: Add `emisStudentId` field to Student entity + GSI
- **What**: New required-for-NPL-tenants field `emisStudentId: string` on Student, unique per tenant, indexed for lookup.
- **Why**: baseline gap #10 / §6.4 — IEMIS/CEHRD government reporting impossible without persisting the IEMIS Student ID. 779 Saraswati students have these IDs.
- **Where**:
  - Entity: `server/application/microservices/academics/src/common/entities/student.entity.ts:24-75` (add field).
  - Zod: `packages/shared-types/src/schemas/academics/student.schema.ts` (add to create/update schemas).
  - GSI: new DDB GSI on academics table — PK `TENANT#{tenantId}#EMIS#{emisStudentId}`, SK `STUDENT#{studentId}` (or reuse an existing GSI if slot available; check `server/lib/tenant-template/academics-table.ts` for GSI budget).
  - Lookup method: `StudentsService.findByEmisStudentId(tenantId, emisStudentId)`.
- **How**: Add optional field on entity; Zod makes it required when `tenant.archetype === 'PABSON'` (validated at service layer since Zod doesn't know tenant context). CDK GSI addition requires `cdk deploy` for tenant-template-stack-basic — log via `./scripts/deploy-analytics.sh` wrapper per CLAUDE.md deploy log convention. Uniqueness enforced via `ConditionExpression: attribute_not_exists(gsi2pk)` (or equivalent new GSI PK) on PutItem.
- **Acceptance**: Student created with `emisStudentId='1708400128000841'` is retrievable via GSI. Duplicate `emisStudentId` within same tenant → 409. PABSON tenant create without `emisStudentId` → 400.
- **Tests**:
  - Unit: uniqueness check rejects duplicates.
  - Integration: create student with emisStudentId, query GSI, round-trip OK.
  - Integration: PABSON tenant requires emisStudentId; GENERIC tenant does not.
- **Risk**: GSI addition to a populated table (empty at Saraswati go-live) = safe. After go-live, adding GSIs is online but expensive. Must ship before Apr 15.
- **Dependencies**: Blocks P0.6 (CSV import). Blocked by decision #2 (archetype concept).

### P0.3: Add `emisSchoolCode` field to School entity
- **What**: New required-for-NPL-archetype field `emisSchoolCode: string` on School.
- **Why**: baseline gap #11 — School's Ed-Fi `identificationCodes` bag exists but is unused; IEMIS reporting needs a first-class column.
- **Where**:
  - Entity: `server/application/microservices/identity/src/common/entities/school.entity.ts:18-74`.
  - Zod: `packages/shared-types/src/schemas/identity/school.schema.ts`.
  - AdminWeb school create form + edforge-saas-frontend school config form.
- **How**: Optional field, required at service layer when `tenant.archetype === 'PABSON'`. No new GSI (school count per tenant is small; tenant-scoped scan acceptable). Document: populate `School.emisSchoolCode` at school creation, never silently derive.
- **Acceptance**: School entity persists `emisSchoolCode`. PABSON school create without it → 400. Shows in school detail UI.
- **Tests**: Unit for field-governance classifier treats it as `immutableAfterCreate`. Integration: create PABSON school with/without emisSchoolCode.
- **Risk**: Low.
- **Dependencies**: Blocks P0.6 (IEMIS import references it). Blocked by decision #1 (archetype).

### P0.4: Fix `studentNumber` prefix — fetch `school.schoolCode`
- **What**: In student create path, fetch `School.schoolCode` from identity service and pass it to `StudentIdService.generateStudentUniqueId()`.
- **Why**: baseline gap #15 / §6.2 — currently `schoolCode: undefined` is always passed (`students.service.ts:95`), forcing prefix to fallback `schoolId.substring(0,3).toUpperCase()` → `6D0-2026-00008`-style IDs on parent-facing ID cards.
- **Where**: `server/application/microservices/academics/src/students/students.service.ts:91-97`. Reuse existing identity HTTP client (the same one used for school-existence validation at `:691-725`).
- **How**: Add `schoolCode` to the `School` interface returned by the identity client. In `createStudent`, before calling `generateStudentUniqueId`, await `identityClient.getSchool(schoolId).schoolCode`. Pass through. If school not found → fail-closed (see P0.7, they pair).
- **Acceptance**: Student created under school with `schoolCode='SEBS'` → `studentNumber='SEBS-2026-00001'`. Student at `schoolCode='WHS'` → `WHS-2026-00001`.
- **Tests**:
  - Unit: `StudentIdService.generateStudentUniqueId({schoolCode:'SEBS'})` returns `SEBS-…`.
  - Integration: end-to-end create with real school lookup.
  - Edge: schoolCode with spaces/special chars → sanitized per existing logic at `student-id.service.ts:99-108`.
- **Risk**: Existing Saraswati students (there are none yet) won't be affected. For other tenants with existing `6D0-…` IDs — those stay (see decision #9). New students get correct prefix.
- **Dependencies**: Pairs with P0.7. Blocks P0.6 (IEMIS import).

### P0.5: Normalize CSV import `gender` field (accept M/F/Male/Female/male/female)
- **What**: Preprocess the incoming `gender` value to canonical lowercase before validation.
- **Why**: baseline gap #13 / §9 — Saraswati's Excel uses `Male`/`Female` (possibly `M`/`F`). Current `students.service.ts:938, 953` is case-sensitive lowercase → 100% import failure.
- **Where**: `server/application/microservices/academics/src/students/students.service.ts:938` and the inline validation at `:941-960`.
- **How**: Before Zod/inline validation, run `normalizeGender(raw)`: lowercase, trim, map `m|male` → `male`, `f|female` → `female`, `o|other` → `other`, `n/a|prefer_not_to_say` → `prefer_not_to_say`. Unknown → reject with row-level error (not silent drop).
- **Acceptance**: Row `{gender: 'Female'}` imports as `female`. Row `{gender: 'X'}` errors out with `{row, field:'gender', message:'Unknown gender value: X'}`.
- **Tests**: Unit on normalizer with matrix of inputs. Integration: import CSV with all case variants; all succeed.
- **Risk**: None for Saraswati. For existing imports elsewhere, loosening validation is additive.
- **Dependencies**: Blocks P0.6.

### P0.6: IEMIS-format CSV import pipeline
- **What**: Extended CSV import accepting IEMIS export format with B.S. dates, IEMIS IDs, Nepali names, and data-quality cleaning.
- **Why**: baseline gap #10, #14 / review §5.1 / §7 — Saraswati has 779 students in IEMIS format, B.S. DOB, sparse guardian data, `-null,` address literals, placeholder `123` phones.
- **Where**:
  - Controller: `server/application/microservices/academics/src/students/students.controller.ts:194-211` — new endpoint `POST /academics/students/import/iemis` OR extend existing with optional `format: 'iemis'|'generic'` in body.
  - Service: new method `StudentsService.importStudentsIemis()` adjacent to `importStudents()` at `students.service.ts:902-1052`.
  - BS converter: **import from** `@aibrains/shared-types` / `packages/shared-types/src/utils/bikram-sambat.ts` — `bsToGregorian(bsYear, bsMonth, bsDay)`. Do NOT build a new one.
  - Data-cleaning helpers: new module `academics/src/students/iemis-transform.ts`.
- **How**:
  - Column mapping (per spec): `Student Id` → `emisStudentId`; `IEMIS Code` → stored on school config (log if mismatch vs `School.emisSchoolCode`); `FullName` → split-on-last-space for first/last (not first-space); `Gender` → normalized (P0.5); `DOB` → parsed as B.S., converted via `bsToGregorian()` with tolerant zero-padding (`2072-3-13` and `2072-06-10` both valid); `CurrentClass` → `currentGradeLevel` with ECD/PPC tokens accepted (P0.9); `Father Name`/`Mother Name`/`Guardian Name`/`Guardian Contact` → three `Guardian` records (not one), `hasPortalAccess: false`; `Permanent/Temporary Address` → clean `-null,` literals → null; `Mother Tongue` → `demographics.motherTongue`; `Disability Type` → `medicalInfo.disabilityType` (`"No Disability"` → null).
  - Data cleaning: whitespace trim everywhere; `Na`/`NA`/`na` → null; `-null,` → null; placeholder `123` phone → null (with warning in error report, not error); mixed case names → Title Case using a name-aware capitalizer (don't lowercase Nepali-origin characters).
  - Dedup: on `emisStudentId` (exact match within same tenant → skip + report). Keep existing FN+LN+DOB dedup as a secondary signal (log as warning, not skip).
  - Structured error report: return `{ succeeded: number, failed: number, skipped: number, warnings: Array<{row, field, level:'warn'|'error', message}> }`.
  - Performance: replace the O(N²) dedup scan (`students.service.ts:792-806`) with a single up-front query on the new `emisStudentId` GSI (P0.2). 779 rows → 1 query, not 779K.
  - Batch size: keep 10 parallel writes via `Promise.allSettled`; raise per-request cap from 200 to 1000 for IEMIS imports.
- **Acceptance**:
  - All 779 Saraswati rows import in < 60s with no errors.
  - `emisStudentId='1708400128000841'` is preserved.
  - DOB `2072-3-13` and `2072-06-10` produce identical Gregorian dates.
  - `-null,` addresses stored as `null`, not string `"-null,"`.
  - `Na` parent names stored as `null`.
  - Placeholder `123` phone flagged as warning, not hard error.
  - Three guardians (father/mother/guardian) stored as separate contact records.
- **Tests**:
  - Unit: `bsToGregorian` round-trip for 20 sampled Saraswati DOBs.
  - Unit: data-cleaning helpers matrix (`Na`, `NA`, `-null,`, `  Name  `, `123`).
  - Unit: Nepali-aware name splitter (`"Khadka Bahadur Karki"` → `{first:'Khadka Bahadur', last:'Karki'}` via last-space rule).
  - Integration: full 779-row import against test tenant; assertion count matches grade distribution (ECD/PPC=54, C1=38, C2=248, C3=126, C4=88, C5=59, C6=47, C7=43, C8=37, C9=26, C10=13).
  - Integration: re-import same CSV → 0 new rows, 779 skipped (dedup on emisStudentId).
  - Integration: row with missing required field → error report entry with row index.
- **Risk**: Performance at 779 rows with 1 GSI lookup vs current 779K scans = order-of-magnitude improvement. If GSI write lag exists, second-import dedup may miss; mitigated by DDB consistent read on dedup query.
- **Dependencies**: Blocked by P0.2 (emisStudentId + GSI), P0.5 (gender norm), P0.9 (ECD/PPC grade). Blocks Saraswati validation (§End-to-End).

### P0.7: Switch student-create school-validation to fail-closed
- **What**: When identity service is unreachable, student create must error, not proceed.
- **Why**: baseline §7.2 / gap #19 — currently at `students.service.ts:691-725` a catch block logs and proceeds (fail-open), allowing orphan students during identity outage.
- **Where**: `server/application/microservices/academics/src/students/students.service.ts:691-725`.
- **How**: Replace `catch` body that returns success with `throw new ServiceUnavailableException('Cannot validate school — identity service unreachable')`. Add 2s timeout; 3x retry with exponential backoff. On final failure: 503.
- **Acceptance**: Mock identity to return 500 / timeout → student create returns 503. Saraswati mass import during identity outage → whole import fails cleanly (not half-succeeds).
- **Tests**: Unit: mock client to throw; assert 503. Integration: toolkit test that chokes the HTTP client.
- **Risk**: If identity flaps, student creates fail. Mitigation: circuit breaker with short window. Pilot: identity is stable; risk low.
- **Dependencies**: Pairs with P0.4 (both touch identity client in student create).

### P0.8: Archetype first-class field on Tenant (PABSON enum value)
- **What**: Add `archetype: Archetype` field to Tenant entity. For v1 only `'PABSON' | 'GENERIC'` shipped.
- **Why**: Review §7 q1, baseline gap #1 — current code has no archetype abstraction; Saraswati must be marked PABSON at tenant level so downstream code can branch (IEMIS required fields, BS default, currency default).
- **Where**:
  - Entity: `server/application/microservices/identity/src/common/entities/tenant.entity.ts:24-71`. Add `archetype: 'PABSON' | 'GENERIC'` (stringly; enum in shared-types). Defaults to `'GENERIC'`.
  - Zod: `packages/shared-types/src/schemas/identity/tenant.schema.ts:140-161`.
  - Provisioning: `server/lib/provision-scripts/provision-tenant.sh` + `server/lib/bootstrap-template/tenant-seeder-lambda.ts:253-273` — accept `archetype` env var, default GENERIC, write to DDB. AdminWeb tenant create form: new dropdown (PABSON | Generic).
  - Shared-types index: export `type Archetype = 'PABSON' | 'GENERIC' | 'CBSE_IN' | 'NAIS_US' | 'GEMS_UAE'` — additional values reserved but not valid for v1.
- **How**: Write-once at provisioning; immutable afterward (classify in `field-governance.ts` as `immutableAfterCreate`). No runtime toggle; system admin override with audit log for emergency reset.
- **Acceptance**: Saraswati tenant row has `archetype='PABSON'`. PATCH attempting to change it → 400 (immutable). AdminWeb tenant create requires archetype selection.
- **Tests**: Unit on immutability guard. Integration: create tenant with each archetype value.
- **Risk**: Adding a required field to provisioning means any in-flight provisioning scripts must pass it; confirm no stale scripts in CI.
- **Dependencies**: Decision #1, #2. Unblocks P0.2 (PABSON-required field enforcement), P0.9, P0.10, P1.x audit-scoping.

### P0.9: Grade taxonomy — add ECD/PPC levels for PABSON
- **What**: Extend `currentGradeLevel` valid values to include `ECD` and `PPC` for tenants with `archetype='PABSON'`.
- **Why**: Saraswati has 54 students in ECD/PPC. Current enum likely rejects them.
- **Where**:
  - Shared-types: `packages/shared-types/src/schemas/academics/student.schema.ts` — grade-level enum.
  - Student entity: no change (string).
  - Import + create validation: per-archetype allow-list.
- **How**: Define archetype-scoped grade maps in shared-types:
  ```
  GRADE_LEVELS_PABSON = ['ECD','PPC','1','2',…,'10','11','12']
  GRADE_LEVELS_GENERIC = ['K','1',…,'12']
  ```
  Validation at service layer pulls the right list based on tenant archetype.
- **Acceptance**: Saraswati student with `currentGradeLevel='ECD'` imports successfully. GENERIC tenant trying ECD → 400.
- **Tests**: Unit: grade-level validator per archetype. Integration: full 779 import with grade distribution assertion.
- **Risk**: If any existing tenant has grade data that conflicts — none expected in pilot.
- **Dependencies**: Blocks P0.6. Blocked by P0.8.

### P0.10: WorkspaceSettings defaults derive from archetype
- **What**: Tenant seeder + WorkspaceSettings default constructor select defaults by archetype (not by country alone).
- **Why**: Decision #2, baseline §4.3 — three duplicated COUNTRY_DEFAULTS (review §5.7 clarifies: one canonical, one hand-duplicated at `workspace-settings.entity.ts:74-106`, one synth-time inline). Archetype is a better key than country (PABSON is Nepal-specific; the future CBSE_IN is India-specific). Country stays as supplementary signal.
- **Where**:
  - Canonical: extend `packages/tenant-locale-defaults/src/index.ts:61` (or alongside it) to export `ARCHETYPE_DEFAULTS: Record<Archetype, WorkspaceSettingsDefaults>`.
  - Identity entity: `server/application/microservices/identity/src/common/entities/workspace-settings.entity.ts:74-106` stays duplicated for Dockerfile reasons (per explanatory comment at `:8-18`), but regenerate it to include archetype keyed defaults. Mark with a codegen comment.
  - Seeder lambda: `server/lib/bootstrap-template/tenant-seeder-lambda.ts:128` — synth-time JSON.stringify inline stays, sourced from the canonical package. No behavior change at seeder.
- **How**: Archetype-first lookup; country is a tiebreaker. `PABSON` → NPR, Asia/Kathmandu, Bikram Sambat calendar, week starts Sunday, south_asian number format.
- **Acceptance**: Tenant created with `archetype='PABSON'` gets `defaultCurrency='NPR'`, `defaultTimezone='Asia/Kathmandu'`, `defaultCalendarSystem='bikram_sambat'`, `defaultWeekStartsOn='sunday'`, `enableDualDateDisplay=true`, `defaultNumberFormat='south_asian'` at seed time.
- **Tests**: Unit: archetype → default map. Integration: seed + GET settings.
- **Risk**: Sync between canonical package and identity entity duplicate can drift. Mitigation: add a CI check that the two dicts equal (runtime assertion on identity boot: throw if inline defaults diverge from `@edforge/tenant-locale-defaults` import attempt at test time).
- **Dependencies**: Blocked by P0.8. Unblocks P1.5 (isLocked write path).

### P0.11: BS date integration — plumb existing converter into import + storage paths
- **What**: Use existing `gregorianToBs()` / `bsToGregorian()` from `packages/shared-types/src/utils/bikram-sambat.ts` in student DOB import, academic year `startDateBS`/`endDateBS`, and any other entry point that currently drops BS.
- **Why**: Review §5.2 — converter already exists (313 lines, BS 2000-2090, used by analytics at `analytics-service.ts:534` and `BsDatePicker.tsx`). Phase 1 missed it. Do NOT rebuild. Baseline gap #8 — `startDateBS`/`endDateBS` accepted by Zod and dropped by academic-years.service.
- **Where**:
  - Academic year service: `server/application/microservices/identity/src/academic-years/academic-years.service.ts:78-92` — stop dropping BS dates; convert to Gregorian and optionally store the BS strings alongside.
  - Student import: see P0.6 uses it.
  - Re-export: ensure all services can import from `@aibrains/shared-types` (confirm workspace deps are already set up; no new package).
- **How**: When a request carries both AD and BS, treat AD as authoritative but persist `startDateBS`/`endDateBS` as display-hint strings. When only BS is supplied (IEMIS import), convert and persist AD as canonical; store BS alongside. Display layer can always recompute from AD via `gregorianToBs()`, so BS strings are redundant but help audit.
- **Acceptance**: Create academic year with `startDateBS='2083-01-01'` → stored with correct Gregorian `startDate` equivalent (`2026-04-13` or similar). GET returns BS round-tripped correctly. Student DOB `2072-3-13` imported → entity `dateOfBirth` = Gregorian equivalent; round-trip in UI shows `2072-03-13` via BsDatePicker.
- **Tests**: Unit: 20 sampled dates round-trip AD→BS→AD. Integration: create academic year from BS dates, assert AD. E2E: frontend BsDatePicker selection → API persist → GET display.
- **Risk**: Timezone edge cases — BS date 2083-01-01 at Kathmandu midnight is one UTC day before at UTC. Analytics already handles this (`handler.ts:170-174, 187`); reuse same pattern. Pin conversions at Asia/Kathmandu timezone per-tenant.
- **Dependencies**: Blocked by P0.8 (archetype) to get correct timezone context.

### P0.12: Finance currency — entity types `string`, sourced from WorkspaceSettings
- **What**: Change TypeScript literal type `currency: 'NPR'` to `currency: string` in finance entities; at invoice/payment create time, read tenant's `defaultCurrency` from the tenant-settings resolver.
- **Why**: Review §5.1 / §7 q4 — finance entities bake `'NPR'` into the type system (`invoice.entity.ts:70`, `payment.entity.ts:37`, `fee-structure.entity.ts:91`, `credit-note.entity.ts:78`, `refund-request.entity.ts:65`). Any non-Nepal tenant would produce type-invalid data. Currency belongs at the tenant, not hardcoded in finance domain.
- **Where**:
  - Entities: all five files above — widen literal type to `string` (ISO-4217). Keep constructor default as fallback for defensive writes, but log a warning when hit.
  - Services: wherever invoices/payments/credit-notes are created, inject `TenantSettingsResolver` and call `resolver.getSettings(tenantId).regional.defaultCurrency`. Assert `dto.currency === tenantCurrency` at input validation (treat explicit currency as a hint, tenant is authoritative).
  - Shared-types: `packages/shared-types/src/schemas/finance/*.ts` — widen currency schema from literal to `z.string().length(3)` ISO-4217 regex.
  - Existing data: no DDB migration (decision #4) — existing Saraswati rows will validate fine since NPR stays NPR.
- **How**: Inject the tenant settings resolver at each finance service boundary (already used in analytics). Map `regional.defaultCurrency` through. For display, use existing `packages/shared-types/src/utils/currency.ts` (review §5.4 confirms south-asian grouping is built).
- **Acceptance**: Invoice created for PABSON tenant → `currency='NPR'`. Hypothetical USA tenant → `currency='USD'` and no type error. DDB rows readable. Existing NPR invoices unchanged.
- **Tests**:
  - Unit: invoice create with tenant resolver mock → currency matches tenant.
  - Integration: create invoice for two tenants with different currencies → both persist.
  - Regression: existing Saraswati invoices still readable and mappable.
- **Risk**: Highest-scope P0 task. Subtle: credit-note currency must match original invoice currency (already implicit). Watch for Zod schemas that anchor to literal 'NPR' in any DTO.
- **Dependencies**: Blocked by P0.8. Unblocks P2 archetype work.

### P0.13: Populate `schoolCode` at school creation for Saraswati
- **What**: Ensure Saraswati's school is created with `schoolCode='SEBS'` (or chosen value) before any student import.
- **Why**: Companion to P0.4. Without `schoolCode`, studentNumbers fall back to UUID prefix.
- **Where**: `server/application/microservices/identity/src/schools/schools.service.ts:64-78` — pre-scan uniqueness check. AdminWeb / edforge-saas-frontend school create form must require schoolCode.
- **How**: Make `schoolCode` required at the Zod schema level (currently implied but verify). Make form field required.
- **Acceptance**: Saraswati school row has `schoolCode='SEBS'` and `emisSchoolCode=<IEMIS_CODE_FROM_EXPORT>`. Student imports generate `SEBS-2026-…` IDs.
- **Tests**: Integration: create school without schoolCode → 400.
- **Risk**: Low.
- **Dependencies**: Pairs with P0.3, P0.4.

### P0.14: Multi-role-per-user for principal + teacher (Shahid Alam case)
- **What**: Allow a single user to hold both `Principal` and `Teacher` roles at the same school.
- **Why**: Baseline §5.4 — current SK pattern `USER#{userId}#ROLE#{schoolId}` enforces one role per school. Shahid Alam at Saraswati is principal + Class 9/10 teacher. Without this, either his principal dashboard or his teacher sections break.
- **Where**:
  - Entity: `server/application/microservices/identity/src/common/entities/role-assignment.entity.ts`.
  - Service: `server/application/microservices/identity/src/roles/roles.service.ts:107-109` (conflict check).
  - SK pattern: change to `USER#{userId}#ROLE#{schoolId}#{roleName}` so the same user can hold multiple rows per school.
  - Permission guard: `server/application/microservices/academics/src/common/guards/permission.guard.ts:57-170` — resolve effective permissions as **union** of all active role rows at the school.
  - DataScope: `data-scope.service.ts:89-100` — when user has both Principal (school scope) and Teacher (section scope), effective scope = MAX = school scope (admin wins). Teacher-specific section list retained for "my classes" views.
- **How**: Migrate SK in-place (1-shot script: read all rows at `USER#*#ROLE#*`, rewrite with roleName suffix). No data loss; old and new patterns coexist if migration done pre-go-live. Permission merge: union of permissions, deny-wins still applies. Seniority `roles.service.ts:40-50` used to label "primary role" for UI.
- **Acceptance**:
  - Shahid can be assigned both Principal and Teacher at Saraswati.
  - Principal dashboard loads for him.
  - His Class 9 and Class 10 sections also visible in "My Classes" view.
  - RBAC: he can access all students (principal scope) but "My Classes" filters to his assigned sections only.
- **Tests**:
  - Unit: permission guard with two role assignments → union.
  - Integration: assign two roles; attempt both-role-specific API endpoints; both succeed.
  - Integration: remove Teacher role → still Principal (dashboard still works); remove Principal → only Teacher scope.
  - E2E: Shahid login → sees principal dashboard + his classes.
- **Risk**: Touches authz core. Regression risk if permission-merge introduces bugs. Mitigation: extensive unit coverage on the merge function before deploy.
- **Dependencies**: Self-contained. Unblocks Saraswati E2E validation.

### P0.15: Audit trail on critical mutations via `AuditLoggerService` expansion
- **What**: Expand existing CloudWatch `AuditLoggerService` to cover: tenant update, workspace settings update, academic year create/activate/setCurrent, role assign/update/deactivate, student create/update/delete, student import.
- **Why**: Review §5.5 — CloudWatch audit channel already exists for users, finance, and permission denials. Baseline gap #17 incorrectly implied no audit anywhere; truth is partial coverage. Saraswati pilot needs evidence trail for parent data disputes.
- **Where**:
  - Audit service: existing `AuditLoggerService` (confirm path — likely `identity/src/common/audit/audit-logger.service.ts`).
  - Call sites to add:
    - `tenants.service.ts` update + settings update paths.
    - `academic-years.service.ts:61-106` create, `:244-278` setStatus, `:283-318` setCurrent.
    - `roles.service.ts` assign/update/deactivate/change.
    - `students.service.ts` create, update, delete, import (summary with counts + truncated error list).
- **How**: Call `auditLogger.log({action, actor, target, before, after, result})` on each. Non-blocking `.catch(err => logger.error(...))` pattern (already established). For import, log one summary entry + up to N error row entries (cap at 100).
- **Acceptance**: Every mutation listed appears in CloudWatch Logs Insights query `{ $.auditAction = "*" }`. Query by actor (userId) returns all their actions. Query by target returns all mutations on that entity.
- **Tests**: Unit: service methods call auditLogger with expected payload shape. Integration: mutation → audit log entry readable from CW.
- **Risk**: CW cost at 779-student import — ensure bulk import logs one summary, not 779 entries.
- **Dependencies**: Can run in parallel with other P0 tasks. Unblocks P1.8 (DDB audit consideration).

### P0.16: Write path for `isLocked` on first academic year activation (minimal)
- **What**: When an academic year transitions `planning → active` for the first time in a tenant's history, set `WorkspaceSettings.isLocked=true` with `lockReason='Academic year active'`.
- **Why**: Baseline §1.4 / gap #2 — `isLocked` is write-dead currently. UI reads it; toggle never fires. Pre-pilot fix is minimal: just trigger the bool. Full per-field governance is P1 (decision #6 defers the granularity).
- **Where**: `server/application/microservices/identity/src/academic-years/academic-years.service.ts:244-278` setStatus path.
- **How**: On transition to `active`, check `WorkspaceSettings.isLocked`. If false, flip to true and write `lockReason`. Idempotent (check before write). Write inside a DDB transaction with the status update if co-located; else best-effort with compensating read.
- **Acceptance**:
  - Fresh tenant, no active year → `isLocked=false`, `LockIndicator` not shown.
  - Activate first academic year → `isLocked=true` automatically.
  - `PATCH /tenants/:tenantId/settings` with `defaultCurrency` change → 400 with lock message (existing gate at `tenants.service.ts:282`).
  - UI `LockIndicator` at `apps/shell/src/pages/settings/workspace.tsx:183` lights up.
- **Tests**:
  - Unit: activate year → isLocked flips.
  - Integration: activate + try update settings → 400.
  - Regression: never-active tenant can still update settings.
- **Risk**: A tenant that's in onboarding but creates an academic year too early would lock settings prematurely. Mitigation: restrict trigger to first-time activation, not every activation.
- **Dependencies**: Blocked by decision #6. Blocks P1.5 (per-field governance).

### P0.17: Remove School/SchoolConfig `calendarSystem` and `timezone` divergence path
- **What**: At school create and update, reject any attempt to set `calendarSystem` or `timezone` divergent from tenant. Prefer: remove the field from School/SchoolConfig entirely; read from tenant.
- **Why**: Baseline §2.2 / gap #21 — school-level `calendarSystem` can diverge silently. Principle: "archetype at tenant level, not school."
- **Where**:
  - Remove or restrict: `School.timezone`, `School.locale`, `School.calendarSystem`, `School.academicCalendarType` at `school.entity.ts:47-50`.
  - `SchoolConfiguration` at `department.entity.ts:47-77` — same fields removed for regional; keep schoolDays/startTime/endTime/periodDuration/gradingScale.
  - `schools.service.ts:90-91` — stop using school's address country; use tenant.
  - `schools.service.ts:900-924` lazy-create SchoolConfig — remove regional fields.
- **How**: Phase 1 — add deprecation warning at write. Phase 2 — drop from DTOs and Zod, remove from entity. For Saraswati go-live, phase 1 is enough (logs track any divergent writes, none expected).
- **Acceptance**: School create body with `timezone` field → ignored with 400 `'timezone is a tenant-level setting'`. GET /schools/:id returns regional fields derived from tenant.
- **Tests**: Integration: create school with timezone in body → 400. GET school returns tenant timezone.
- **Risk**: Existing schools with divergent values — none in Saraswati; log & plan P1 migration.
- **Dependencies**: Decision #3.

---

## P1 — Foundation Lockdown

_First 30 days post-pilot. Correctness / integrity gaps that must close before a second school onboards._

### P1.1: Collapse `isCurrent` into `status`
- **What**: Remove `isCurrent` as a separate flag; derive from `status === 'active'`.
- **Why**: Baseline gap #5 / §3.2 — `isCurrent` is dead state. `getCurrentAcademicYear()` reads status, `setAsCurrent()` writes isCurrent. Contradictions possible.
- **Where**: `academic-years.service.ts:138, 283-318`, entity `academic-year.entity.ts:23-46`, schemas, DTOs.
- **How**: (1) Migration script: for every school's active year, set `isCurrent=true`, all others `false`. (2) Mark `isCurrent` `@deprecated` in entity; keep read path temporarily. (3) Change `setAsCurrent` to actually call `setStatus('active')` and cascade-set others to `completed` or `planning` based on dates. (4) After 30 days, drop `isCurrent` field.
- **Acceptance**: `getCurrentAcademicYear()` and `isCurrent` flag always agree. Deprecation notice in OpenAPI docs.
- **Tests**: Unit: after `setAsCurrent('Y1')`, only Y1 is active, all others non-active. Integration: UI calls `/current` → always matches.
- **Risk**: Client apps reading `isCurrent` need update. Low — only backend consumers.
- **Dependencies**: Decision #10.

### P1.2: Academic year state-machine table
- **What**: Enforce status transitions in code: only `planning→active`, `active→completed`, `completed→active` (reopen), `completed→archived` allowed. Archived terminal.
- **Why**: Baseline gap #7. Currently `academic-years.service.ts:244-278` accepts any status value.
- **Where**: `academic-years.service.ts:244-278`.
- **How**: Define `ALLOWED_TRANSITIONS: Record<Status, Status[]>` and validate. Reject invalid with 400. Audit both intent and outcome.
- **Acceptance**: `planning → archived` → 400. `archived → active` → 400. `active → completed → active` → allowed.
- **Tests**: Unit matrix over all 16 transitions.
- **Risk**: Low.
- **Dependencies**: P1.1.

### P1.3: Per-field governance extended to WorkspaceSettings
- **What**: Extend `packages/shared-types/src/identity/field-governance.ts:14-52` to cover workspace fields. Classify: `immutableAfterTenantCreate` (archetype), `lockedDuringActiveYear` (currency, calendarSystem, timezone, numberFormat, weekStartsOn), `alwaysMutable` (branding, policies).
- **Why**: Decision #6. Replaces the blunt `isLocked: boolean` with per-field semantics.
- **Where**: `packages/shared-types/src/identity/field-governance.ts`, `tenants.service.ts:271-309` enforcement.
- **How**: Same pattern already applied to School at `schools.service.ts:284-313` — reuse `classifyUpdateFields()`. UI reads governance map to render per-field lock icons.
- **Acceptance**: PATCH workspace settings with mixed fields during active year → fields in `lockedDuringActiveYear` rejected; `alwaysMutable` accepted. Audit entry per rejected field.
- **Tests**: Integration: mixed PATCH, partial accept/reject.
- **Risk**: UI regression if it assumes all-or-nothing. Mitigation: UI diff.
- **Dependencies**: P0.16.

### P1.4: Smarter guardian name parser (Nepali-aware)
- **What**: Replace "split on first space" at `students.service.ts:1013` with last-space split and Nepali-name heuristics.
- **Why**: Baseline gap #16. Compound Nepali names like `"Khadka Bahadur Karki"` become `first='Khadka'`, `last='Bahadur Karki'` — wrong.
- **Where**: `students.service.ts:1011-1020`. New helper `parseNepaliName(full)`.
- **How**: Last-space split as default (most Nepali surnames are the last token). Allow-list common double-barrel surnames (`Bahadur Thapa`, `Bahadur Shrestha`). Fall back to last-space when unsure. Always trim.
- **Acceptance**: `"Khadka Bahadur Karki"` → `{first:'Khadka Bahadur', last:'Karki'}`. `"Ram Prasad"` → `{first:'Ram', last:'Prasad'}`.
- **Tests**: Matrix over 50 sampled Saraswati guardian names.
- **Risk**: None; can be iterated post-go-live based on real data.
- **Dependencies**: None.

### P1.5: DDB audit table (in addition to CloudWatch channel)
- **What**: Decide whether to keep DDB `AuditLogEntry` (currently only school changes) or retire it in favor of CloudWatch everything. If keep: expand coverage to parity with CloudWatch.
- **Why**: Review §5.5. Two audit channels exist. Decide one source of truth. DDB queryable by schoolId; CW queryable by time/actor.
- **Where**: `identity/src/common/entities/audit.entity.ts:23-36`, all audit call sites.
- **How**: Recommendation: **keep both**. DDB for authoritative school-scoped audit (parent-facing "show me who changed my child's DOB"). CW for operational (security, perf). Add service-layer wrapper `AuditService.log()` that writes to both, atomic-on-failure-of-DDB-only.
- **Acceptance**: Every mutation in P0.15 scope produces both CW entry and DDB `AuditLogEntry` (when school-scoped). Tenant-scoped mutations DDB-logged under tenant PK.
- **Tests**: Integration: mutation → both channels updated.
- **Risk**: Dual-write drift. Mitigation: wrapper service.
- **Dependencies**: P0.15.

### P1.6: Tenant-vs-school regional field precedence — documented + enforced at read time
- **What**: For any duplicated regional field, the tenant row is canonical; school row is advisory (or removed per P0.17 decision).
- **Why**: Decision #3. Baseline gap #4.
- **Where**: `packages/tenant-settings-resolver/src/{ddb,http}-resolver.ts`.
- **How**: Resolver exposes `getEffectiveSettings(tenantId, schoolId?)` that returns tenant-authoritative fields. Document in resolver README. All finance/academics consumers switch to this API.
- **Acceptance**: All consumer services route through the resolver; no direct reads of school-level regional fields.
- **Tests**: Integration: tenant NPR, school row accidentally has `currency='USD'` → resolver returns NPR.
- **Risk**: Call-site audit needed. Grep for `school.timezone`, `school.calendarSystem`, etc.
- **Dependencies**: P0.17.

### P1.7: Fix `AuthService.login` forcing `status='active'`
- **What**: Honor Cognito user status; do not auto-activate.
- **Why**: Baseline gap #20 / §5.5 #2. In-code TODO acknowledges.
- **Where**: `auth.service.ts:139`.
- **How**: Map Cognito `UserStatus` to app status: CONFIRMED→active, UNCONFIRMED→pending, others→inactive.
- **Acceptance**: Suspended Cognito user cannot bypass by logging in.
- **Tests**: Unit + integration with mocked Cognito responses.
- **Risk**: Low.
- **Dependencies**: None.

### P1.8: JWT invalidation on role change
- **What**: Shrink role revocation lag (currently up to 1h JWT expiry + 5-min cache).
- **Why**: Baseline §5.5 #3 & #5.
- **Where**: `auth.service.ts:655-707`, `permission.guard.ts:41`.
- **How**: Add a role-version token claim; increment tenant/user version on any role change; permission guard rejects stale tokens. OR: shorten cache to 30s. Simpler: 30s cache + force-refresh on role mutation (publish event).
- **Acceptance**: After role revocation, access denied within 30s.
- **Tests**: Integration: assign role → access granted; revoke → within 30s denied.
- **Risk**: Cache coherency across instances.
- **Dependencies**: None.

### P1.9: DDB conditional write on schoolCode uniqueness
- **What**: Replace pre-scan uniqueness (`schools.service.ts:64-78`) with `ConditionExpression` on PutItem.
- **Why**: Baseline §7.2 — race condition exists.
- **Where**: `schools.service.ts:64-78`.
- **How**: Use a sentinel item `SCHOOLCODE#{code}` with `ConditionExpression: attribute_not_exists(PK)`. If fails → 409.
- **Acceptance**: Concurrent create with same schoolCode → one wins, other 409.
- **Tests**: Concurrency test with two concurrent creates.
- **Risk**: Low.
- **Dependencies**: None.

### P1.10: `defaultWeekStartsOn` Zod enum includes `saturday`
- **What**: Add `'saturday'` to the Zod enum.
- **Why**: Baseline gap #22 — Zod enum `['sunday','monday']` diverges from `tenant-locale-defaults` which declares `['sunday','monday','saturday']`. Nepal uses Sunday; unlikely issue for Saraswati but real divergence.
- **Where**: `packages/shared-types/src/schemas/identity/tenant.schema.ts:116`.
- **How**: Single-line change.
- **Acceptance**: PATCH settings with `defaultWeekStartsOn='saturday'` → 200.
- **Tests**: Unit.
- **Risk**: None.
- **Dependencies**: None.

### P1.11: Tenant `country` made mutable (TenantAdmin only, audited, confirm dialog)
- **What**: Allow country updates via PATCH tenant settings (restricted).
- **Why**: Baseline gap #23 — write-once at provisioning. If tenant's HQ moves or data was wrong, unfixable. Not critical for Saraswati but real limitation.
- **Where**: `packages/shared-types/src/schemas/identity/tenant.schema.ts:55-62`, `tenants.service.ts` update path.
- **How**: Add to `updateTenantSchema`; require TenantAdmin; audit log; no cascading regional resets (would be destructive). Warn user in UI that regional settings won't auto-update.
- **Acceptance**: TenantAdmin PATCH country → 200 + audit. Non-admin → 403.
- **Tests**: Unit + integration.
- **Risk**: None.
- **Dependencies**: P0.1.

### P1.12: CSV import perf — replace O(N²) dedup with indexed lookup
- **What**: Replace the 1000-row in-memory scan (`students.service.ts:792-806`) with indexed GSI queries.
- **Why**: Baseline gap #12. P0.6 already does this for emisStudentId path; extend to legacy FN+LN+DOB path for non-PABSON tenants.
- **Where**: `students.service.ts:792-806`.
- **How**: Add secondary GSI on `studentId` + `lastName#firstName#dob`. Query-by-GSI replaces full scan.
- **Acceptance**: 1000-row import in <30s, no scan-like RCU consumption.
- **Tests**: Load test.
- **Risk**: GSI storage cost.
- **Dependencies**: None.

---

## P2 — Archetype Generalization

_Enables the second archetype (CBSE India, NAIS USA) without rewrites. Can lag if no second archetype is scheduled._

### P2.1: Full archetype enum + configurations for CBSE_IN, NAIS_US, GEMS_UAE
- **What**: Extend `Archetype` enum beyond PABSON|GENERIC; add config rows to `ARCHETYPE_DEFAULTS`.
- **Why**: Decision #1. P0.8 reserves the enum but only PABSON ships.
- **Where**: `packages/tenant-locale-defaults/src/index.ts`, `workspace-settings.entity.ts`.
- **How**: One config row per archetype with currency, timezone, calendar, grade taxonomy, reporting cadence. Data-driven, not code-branched.
- **Acceptance**: Tenant with `archetype='CBSE_IN'` seeds with INR / Asia/Kolkata / Gregorian / south_asian.
- **Tests**: Unit per archetype.
- **Risk**: Medium.
- **Dependencies**: P0.8, P0.10.

### P2.2: Region-gated UI dropdowns (timezone/currency/calendar filtered by archetype)
- **What**: Dropdowns in AdminWeb + edforge-saas-frontend shell restrict options to what's valid for the selected archetype.
- **Why**: Baseline §1.3 — dropdowns hardcoded, no filtering.
- **Where**: `client/AdminWeb/src/pages/Tenants/TenantCreate.tsx`, `apps/shell/src/pages/settings/workspace.tsx:74-134`.
- **How**: Dropdown options sourced from `ARCHETYPE_DEFAULTS[archetype].allowedX`.
- **Acceptance**: PABSON tenant, currency dropdown → only NPR. NAIS_US → only USD.
- **Tests**: UI snapshot per archetype.
- **Risk**: UX rigidity; allow `OTHER` archetype for full freedom.
- **Dependencies**: P2.1.

### P2.3: Multi-role-per-user general support (beyond the Shahid case)
- **What**: Generalize P0.14's SK change to allow arbitrary role combinations; update UI to show all roles.
- **Why**: Reference archetypes (GEMS UAE) commonly have teacher + department head + counselor combinations.
- **Where**: Same as P0.14 but broaden.
- **How**: Role assignment UI lets admins add multiple; permission engine handles union + deny-wins cleanly.
- **Acceptance**: User with 3 roles at same school works end-to-end.
- **Tests**: Matrix over role combinations.
- **Risk**: Permission intersection bugs.
- **Dependencies**: P0.14.

### P2.4: Service-to-service auth tokens
- **What**: Replace JWT forwarding between academics/identity/finance with scoped service tokens (e.g., SigV4 IAM-auth over private VPC link, or short-lived mTLS tokens).
- **Why**: Review §7 q11 — current design leaks user JWT across services; any compromised service can impersonate user.
- **Where**: `IdentityClientService` + all cross-service HTTP clients.
- **How**: Per-service role/client-credential; scope to specific endpoint allowlist.
- **Acceptance**: Academics can call identity `/roles/check-permission` without forwarding user JWT; identity validates service identity.
- **Tests**: Integration with service-to-service token harness.
- **Risk**: Big refactor. Plan for 2 sprints.
- **Dependencies**: None.

### P2.5: Cognito locale-aware email templates
- **What**: Per-tenant email template selection based on archetype locale.
- **Why**: Review §5.10 — all emails English-only today.
- **Where**: `server/lib/tenant-template/identity-provider.ts`.
- **How**: Store template variants; select at invite time.
- **Acceptance**: PABSON tenant invite email in Nepali or English-with-BS-reference; NAIS_US in American English.
- **Tests**: Integration.
- **Risk**: Translation cost.
- **Dependencies**: P2.1.

### P2.6: Archetype-specific reporting exports
- **What**: IEMIS export for NPL/PABSON, ASER for CBSE_IN, etc. Exposed as admin actions.
- **Why**: Baseline gap #10 is reporting-in-adjacent. Tenants need their own format back.
- **Where**: New endpoint `POST /reports/export/:type`.
- **How**: Archetype-scoped formatter registry.
- **Acceptance**: PABSON admin clicks "Export IEMIS CSV" → downloads file matching `Students_2082_All.xlsx` schema.
- **Tests**: Round-trip: import → export → byte-identical on key fields.
- **Risk**: Field-mapping drift over years.
- **Dependencies**: P0.2, P0.3, P2.1.

---

## P3 — Hygiene / Backlog

### P3.1: `VicePrincipal` default permissions review
- **What**: Audit whether `VicePrincipal` should have `billing:*`.
- **Why**: Baseline §5.5 #4 — UNVERIFIED whether this matches product intent. `role-assignment.entity.ts:161`.
- **How**: Product review. Adjust defaults.
- **Dependencies**: Product input.

### P3.2: DDB Streams + DLQs for reconciliation
- **What**: Attach streams to academics/identity tables for async fan-out (analytics already has its own).
- **Why**: Baseline gap #18 / §7.3. Currently no async reconciliation; deleted schools leave orphan students invisible.
- **How**: CDK stack changes + subscriber Lambdas for orphan detection.
- **Dependencies**: None.

### P3.3: Retire `calendarType` on academic year OR give it runtime semantics
- **What**: Either wire `calendarType` into term generation logic or drop from schema.
- **Why**: Baseline gap #6 — dead field.
- **How**: Product decision. Saraswati uses 3 terms/4 exams = trimester-ish. Implement term auto-split?
- **Dependencies**: Product.

### P3.4: BS data window extension to 1950 if needed
- **What**: Backfill `BS_CALENDAR_DATA` for 1950-1999 if older DOB cases appear.
- **Why**: Decision #12. For newborn DOB and grad cert lookup.
- **Where**: `packages/shared-types/src/utils/bikram-sambat.ts`.
- **How**: Source from Government of Nepal calendar; extend table.
- **Dependencies**: Real case.

### P3.5: `roles.cross-tenant.spec.ts` — verify in CI
- **What**: Confirm the cross-tenant isolation spec runs in CI.
- **Why**: Baseline §5.5 #6 / gap #25.
- **How**: CI log inspection.
- **Dependencies**: None.

### P3.6: `shared-analytics-types` package referenced in CLAUDE.md missing
- **What**: Either create the package or update CLAUDE.md.
- **Why**: Review §5.11 — stale rule.
- **How**: Create the package (matches the naming pattern `packages/shared-analytics-types/`) or delete rule.
- **Dependencies**: None.

### P3.7: Finance currency formatter integration
- **What**: Ensure display paths use `packages/shared-types/src/utils/currency.ts` (south-asian lakh/crore grouping for NPR/INR).
- **Why**: Review §5.4 — utility exists; usage may be spotty.
- **How**: Grep all finance display components for number formatting; route through `formatCurrency()`.
- **Dependencies**: P0.12.

### P3.8: `COUNTRY_CONFIG_OVERRIDES` dedup
- **What**: Consolidate `COUNTRY_CONFIG_OVERRIDES` (at `department.entity.ts:193`) with archetype-level config since it carries schoolDays/startTime/endTime/periodDuration/gradingScale.
- **Why**: Review §5.8 — orthogonal concern currently; better under archetype.
- **How**: Merge into `ARCHETYPE_DEFAULTS` with clearer naming.
- **Dependencies**: P2.1.

---

## Testing Plan

### Unit
- **TU.1**: `bsToGregorian`/`gregorianToBs` round-trip over 100 sampled BS dates (P0.11).
- **TU.2**: `normalizeGender` matrix (P0.5): M, F, male, female, MALE, Female, other, unknown → canonical/reject.
- **TU.3**: IEMIS data-cleaning helpers (P0.6): `Na`, `NA`, `-null,`, whitespace, `123` phone.
- **TU.4**: Name splitter (P0.6 + P1.4): 50 Saraswati names, last-space rule, double-barrel surnames.
- **TU.5**: Archetype defaults lookup (P0.10): PABSON → NPR/Asia/Kathmandu/bikram_sambat.
- **TU.6**: Academic year state-machine transitions (P1.2): 16-cell matrix.
- **TU.7**: `field-governance` classifier extended to workspace (P1.3).
- **TU.8**: Permission guard union over multiple role rows (P0.14).
- **TU.9**: `StudentIdService.generateStudentUniqueId` with `schoolCode='SEBS'` → `SEBS-2026-00001` (P0.4).
- **TU.10**: EmisStudentId GSI uniqueness guard (P0.2).

### Integration
- **TI.1**: `PATCH /tenants/:tenantId` with TenantUser JWT → 403 (P0.1).
- **TI.2**: Create PABSON tenant → `WorkspaceSettings` has BS/NPR/Asia-Kathmandu (P0.10).
- **TI.3**: Create Saraswati school with `schoolCode='SEBS'` + `emisSchoolCode='12345'` (P0.3, P0.13).
- **TI.4**: Activate first academic year → `isLocked=true` (P0.16), subsequent settings PATCH → 400.
- **TI.5**: Assign Shahid both Principal and Teacher at Saraswati; verify he can access both scopes (P0.14).
- **TI.6**: IEMIS CSV import of Saraswati's 779 rows → counts match grade distribution exactly (P0.6).
- **TI.7**: Re-import same CSV → 0 new, 779 skipped (dedup on emisStudentId, P0.6 + P0.2).
- **TI.8**: Mutation audit trail present in CloudWatch for tenant update, academic year activate, role assign, student create (P0.15).
- **TI.9**: Finance invoice creation for PABSON tenant → currency read from tenant settings (P0.12), equals 'NPR'.
- **TI.10**: Hypothetical GENERIC tenant invoice creation → currency read from tenant settings (P0.12), not hardcoded.
- **TI.11**: Identity outage → student create 503 (P0.7).

### End-to-End Saraswati Validation
_Each gets a test ID; all must pass before go-live. Points directly at the archetype-specific and Saraswati checklist._

- **TE.1**: Import 779 Saraswati students from IEMIS export → all persisted, `emisStudentId` preserved unique.
- **TE.2**: All names trimmed, normalized case; no leading/trailing whitespace retained.
- **TE.3**: All B.S. DOBs converted correctly; DOB `2072-3-13` (non-padded) = `2072-06-10` (padded).
- **TE.4**: ECD/PPC students (54) imported without error.
- **TE.5**: Guardian records stored as contact records (not user accounts).
- **TE.6**: Sparse data tolerated — missing addresses null, `Na` parent names null, placeholder `123` phone flagged as warning.
- **TE.7**: Shahid Alam (principal + teacher) logs in → sees principal dashboard AND his Class 9/10 sections in "My Classes".
- **TE.8**: Teacher without principal role sees only their assigned sections; does not see all students.
- **TE.9**: Tenant settings UI shows NPR / Asia/Kathmandu / Bikram Sambat as locked/read-only after AY activation.
- **TE.10**: Academic year 2083-2084 active; B.S. dates displayed via BsDatePicker; Gregorian equivalents stored.
- **TE.11**: Attendance module accepts Sunday-Friday school week, Saturday holiday.
- **TE.12**: System admin override to edit locked settings → succeeds + writes audit entry with severity='high'.

### Archetype-specific validation checklist (test-ID cross-reference)

- [ ] Tenant with `archetype=PABSON` has immutable settings locked (currency, timezone, calendar, week start). → TI.4, TE.9
- [ ] Tenant admin cannot change immutable settings via UI or API; system admin override writes an audit entry. → TI.4, TE.12
- [ ] School configuration inherits from tenant for regional fields (no duplication). → P0.17, TI.3
- [ ] School configuration retains school-specific fields (grading scale, exam dates, feature toggles). → P0.17
- [ ] Student entity has `emisStudentId` (required for NPL/PABSON tenants, unique, indexed). → P0.2, TU.10
- [ ] CSV import accepts IEMIS export format and maps all fields correctly. → P0.6, TE.1
- [ ] B.S. dates in import are converted to Gregorian using existing bikram-sambat util. → P0.11, TE.3
- [ ] Grade levels include ECD/PPC through Class 12. → P0.9, TE.4
- [ ] Guardian data from IEMIS is stored as contact records, not user provisioning. → P0.6, TE.5
- [ ] Import handles data quality issues. → P0.6, TE.6
- [ ] Import returns structured error report. → P0.6
- [ ] Import deduplicates on `emisStudentId`. → P0.2, P0.6, TI.7
- [ ] Multi-role user (principal + teacher) can access both views. → P0.14, TE.7
- [ ] RBAC correctly scopes data access per role. → TE.8
- [ ] Academic year activation locks relevant settings. → P0.16, TI.4
- [ ] `isLocked` is enforced at the API level. → P0.16, TI.4
- [ ] `isCurrent` and `status` semantics clear/non-contradictory. → P1.1 (post-pilot)
- [ ] Workspace settings UI shows immutable fields read-only with explanation. → TE.9
- [ ] All tenant-settings and school-config changes are audit-logged. → P0.15, TI.8

---

## Rollout Plan

### Phase A: Test tenant validation (by end of Week 1 of sprint)
- Deploy all P0 tasks to staging environment.
- Create dummy PABSON tenant (`test-pabson-01`).
- Create dummy school with `schoolCode='TEST'`, `emisSchoolCode='99999'`.
- Run synthetic CSV import: 50-row subset of Saraswati data.
- Execute all TI.* and relevant TE.* tests.
- Sign off: all green before Phase B.

### Phase B: Saraswati tenant validation (Week 2-3)
- Provision Saraswati tenant on production infra (`saraswati-pilot`).
- School create: `schoolCode='SEBS'`, `emisSchoolCode=<actual>`.
- Academic year 2083-2084 created in `planning`.
- Import full 779-row IEMIS CSV (dry-run mode: return counts but don't commit).
- Verify dry-run counts match grade distribution exactly.
- Commit import.
- Create user for Shahid Alam with both Principal + Teacher roles.
- Assign sections to Class 9 / Class 10 teachers.
- Dogfood: admin logs in, verifies dashboards, exports IEMIS format (P2.6 is P2 not P0; manual verification OK for Saraswati).
- Run full TE.* suite against production-tier data. Fix any issues.
- Sign off: all green + admin UX review approved.

### Phase C: Go-live clearance (Week 4, by mid-April 2026)
- Activate academic year 2083-2084 (`planning → active`). This triggers P0.16 (`isLocked=true`).
- Verify settings UI shows lock indicator.
- Attempt settings edit → confirm blocked.
- Admin-training session with Saraswati staff.
- Go/no-go review covering:
  - All P0 tests green
  - No open blocker decisions
  - Audit trail verified writing
  - Backup + restore drill executed (DDB point-in-time restore tested)
  - Runbook for IEMIS re-export if needed
- Cutover: flip DNS/auth to Saraswati tenant for their login.
- Monitor for 72h with engineer-on-call.

---

## Appendix: Task Dependency Graph

```
Decisions (all block their associated tasks):
  D#1 (archetype abstraction) → P0.8, P0.9, P0.10, P2.1
  D#2 (migration plan) → P0.8, P0.10
  D#3 (field precedence) → P0.17, P1.6
  D#4 (finance currency migration) → P0.12
  D#5 (BsDatePicker scope) → P0.11 (partial), frontend work
  D#6 (isLocked granularity) → P0.16, P1.3
  D#7 (state machine DAG) → P1.1, P1.2
  D#8 (gender normalization location) → P0.5
  D#9 (schoolCode backfill policy) → P0.4, P0.13
  D#10 (isCurrent migration) → P1.1
  D#11 (service auth) → P2.4
  D#12 (BS data window) → P3.4

P0 graph:
  P0.1 (PATCH tenant guard) → independent
  P0.8 (archetype field) → blocks P0.2, P0.9, P0.10, P0.16
  P0.2 (emisStudentId + GSI) → blocks P0.6
  P0.3 (emisSchoolCode) → blocks P0.6
  P0.4 (studentNumber prefix) → blocks P0.6
  P0.5 (gender norm) → blocks P0.6
  P0.9 (grade taxonomy) → blocks P0.6
  P0.10 (archetype defaults) → blocks P0.16
  P0.11 (BS plumbing) → blocks P0.6
  P0.13 (schoolCode populated) → pairs with P0.4 → blocks P0.6
  P0.7 (fail-closed school validation) → independent
  P0.12 (finance currency) → depends on P0.8
  P0.14 (multi-role) → independent
  P0.15 (audit expansion) → independent
  P0.16 (isLocked write path) → depends on P0.10
  P0.17 (regional field precedence) → independent (but logically after P0.8)
  P0.6 (IEMIS import) → final blocker before Saraswati E2E

Critical path (shortest path to Saraswati E2E):
  D#1/D#2 → P0.8 → P0.2 + P0.9 + P0.10 → P0.11 → P0.6 → TE.*

P1 graph:
  P1.1 (isCurrent collapse) → blocks P1.2
  P1.3 (per-field gov workspace) → depends on P0.16
  P1.5 (DDB audit parity) → depends on P0.15
  P1.6 (precedence resolver) → depends on P0.17
  Other P1s are parallel.

P2 graph:
  P2.1 (full archetype enum) → blocks P2.2, P2.5, P2.6
  P2.3 (multi-role general) → depends on P0.14
  P2.4 (service auth) → independent
```

_End of sprint plan._
