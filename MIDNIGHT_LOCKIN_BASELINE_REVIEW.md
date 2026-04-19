# Midnight Lockin Baseline Review

_Independent critique of `MIDNIGHT_LOCKIN_BASELINE_REPORT.md`. Produced by a fresh-context agent that re-verified claims against live source. Treat as authoritative overlay where it conflicts with the baseline report._

## 1. Schema Spot-Checks

1. **WorkspaceSettings.isLocked** @ `server/application/microservices/identity/src/common/entities/workspace-settings.entity.ts:64` — **Correct**. Field is `isLocked: boolean` (not optional). Initialized to `false` at `:146`. Zod mirror at `packages/shared-types/src/schemas/identity/tenant.schema.ts:145` with `.default(false)`. Report cite is accurate.

2. **SchoolConfiguration.schoolDays** @ `server/application/microservices/identity/src/common/entities/department.entity.ts:65` (not `:65` directly in report but within the entity range `:47-77`) — **Correct**. `schoolDays: number[]` on line 65 with comment "0=Sun, 1=Mon, ... 6=Sat". NPL override at `:200` has `[0,1,2,3,4,5]` (Sun-Fri, Saturday off), which aligns with Nepal school calendar. Report's §2.1 cite of `:65` is accurate.

3. **AcademicYear.calendarType** @ `server/application/microservices/identity/src/common/entities/academic-year.entity.ts:41` — **Correct**. Type is `'semester' | 'quarter' | 'trimester' | 'annual'` as claimed. Report §3.1 cite accurate.

4. **Student.dateOfBirth** @ `server/application/microservices/academics/src/common/entities/student.entity.ts:36` — **Minor discrepancy in report's §6.1 inventory**. Report §6.1 lists fields but omits that the entity field is `dateOfBirth` while the CSV import accepts `birthDate` OR `dateOfBirth` (at `students.service.ts:937`). Report §6.3 names it correctly. Low-impact wording nit.

5. **regionalSettingsSchema.defaultWeekStartsOn** @ `packages/shared-types/src/schemas/identity/tenant.schema.ts:116` — **Correct and a real bug**. Zod is `z.enum(['sunday', 'monday']).default('sunday')` — missing `'saturday'`. Compare to `@edforge/tenant-locale-defaults/src/index.ts:22` which declares `WeekStartsOn = 'sunday' | 'monday' | 'saturday'`. Report §1.5 and Gap #22 correctly flag this divergence.

## 2. API Endpoint Spot-Checks

1. **PATCH /tenants/:tenantId** @ `tenants.controller.ts:143` — **Correct (flagged bug)**. Guards on line 144 are exactly `@UseGuards(JwtAuthGuard)` — no `GlobalRoleGuard`, no `@RequireGlobalRole`. Body DTO is `UpdateTenantDtoZ` whose Zod schema at `tenant.schema.ts:55-62` allows changes to `name`, `contactEmail`, `contactPhone`, `address`, `status`, `branding` — all mutable by any authenticated tenant user, including non-admins. Report Gap #3 confirmed.

2. **PATCH /tenants/:tenantId/settings** @ `tenants.controller.ts:111-122` — **Correct**. Guards: `JwtAuthGuard + GlobalRoleGuard`, decorator `@RequireGlobalRole('TenantAdmin')`. Body: `UpdateWorkspaceSettingsDtoZ`. Service path `tenants.service.ts:271-309` confirms lock check on `:282` before any write. Report accurate.

3. **GET /tenants/my/settings** @ `tenants.controller.ts:49-57` — **Correct**. Only `@UseGuards(JwtAuthGuard)`; no role guard, no permission decorator. Lazy-creates via `tenants.service.ts:187-200` if missing. Report §1.2 accurate; any JWT (even a user with zero school role assignments) will get their own tenant's settings.

## 3. Locking Logic

**Tenant-level `isLocked`: Confirmed write-dead.** Grep across the entire repo (`isLocked.*true` / `isLocked:\s*true` / `isLocked\s*=\s*true`) returns **zero code writes** that set it to `true`. All hits are:
- Report / docs references
- Initializations to `false` (`workspace-settings.entity.ts:146`, `tenant-seeder-lambda.ts:307`, Zod `.default(false)`)
- Reads (`tenants.service.ts:282`, `workspace.tsx:366`, resolver packages, analytics spec fixtures)
- Test mocks (always `false`)

The only way `isLocked=true` could ever be observed would be a direct DDB manual edit. Report §1.4 and Gap #2 confirmed.

**School-level `lockedDuringActiveYear`: Confirmed enforced.** `schools.service.ts:290-313` calls `classifyUpdateFields()` from `packages/shared-types/src/identity/field-governance.ts`, queries `ACADEMIC_YEAR` rows filtered by `status='active'`, and throws `BadRequestException` unless `forceOverride=true + overrideReason` are set. Enforcement is live. Same pattern applied to school config updates at `:788-814`. Report §2.3 confirmed.

## 4. RBAC

**Scenario trace — `TenantUser` with `Principal` at School A accessing `GET /api/academics/students?schoolId=B`:**

1. `JwtAuthGuard` (controller-level at `students.controller.ts:57`) → `JwtStrategy.validate()` at `libs/auth/src/jwt.strategy.ts:62-88` produces `TenantContext` with `globalRole='TenantUser'` (no school roles present in JWT — correct per report §5.2).
2. Route hits `listStudents` (`:91-94`) decorated with `@UseGuards(PermissionGuard)` + `@RequirePermission({resource:'students', action:'view'})`.
3. `PermissionGuard.canActivate()` at `permission.guard.ts:57-170`:
   - `globalRole !== 'TenantAdmin'` → no bypass.
   - Extract `schoolId = 'B'` from `request.query.schoolId`.
   - Cache miss on first call → HTTP `POST` to identity `/roles/check-permission` via `IdentityClientService`.
4. In identity service, `roles.service.ts:489-550` runs `checkPermission`:
   - `globalRole='TenantUser'` → skip admin bypass.
   - `checkPermissionDto.schoolId='B'` → proceed.
   - Fetch `RoleAssignment` at `USER#{userId}#ROLE#B` → **not found**.
   - Line 515-519: returns `{ allowed: false, reason: 'No active role at this school' }`.
5. Back in PermissionGuard: `result.allowed === false` → throw `ForbiddenException('Permission denied: students:view')` → HTTP **403**.

**Matches** the baseline report's §5.3 claim about `roles.service.ts:509`. ✅

**Scenario 2 — user with JWT but no role assignment anywhere hitting `/tenants/my/settings`:**
1. `JwtAuthGuard` passes (valid JWT).
2. Controller handler has **no** permission decorator or `GlobalRoleGuard` (see `tenants.controller.ts:49-57`).
3. Service lazy-creates settings for their tenant and returns them.
→ Works (status 200). **Matches** the baseline report's claim "`/tenants/my/settings` still works (no permission decorator)".

## 5. Gaps Found (Phase 1 omissions)

1. **Finance currency is hardcoded `'NPR'` at TypeScript literal-type level** — NOT sourced from WorkspaceSettings. `server/application/microservices/finance/src/common/entities/invoice.entity.ts:70` types `currency: 'NPR'` (literal); same at `payment.entity.ts:37`. Constructor defaults at `:141` and `:84` write `'NPR'` unconditionally. `fee-structure.entity.ts:91` and `credit-note.entity.ts:78` and `refund-request.entity.ts:65` default `data.currency || 'NPR'`. Adding a second archetype (CBSE India, NAIS USA) **will produce invoices typed as `'NPR'` even for USD/INR tenants**. Phase 1 never looked at finance entities and therefore understated Gap #1 severity.

2. **BS↔AD converter DOES exist.** `packages/shared-types/src/utils/bikram-sambat.ts` (313 lines) provides `gregorianToBs()` and friends; exported from `@aibrains/shared-types` index at line 71. It is actively used by analytics at `server/lib/analytics/lambda/api/analytics-service.ts:534`. Phase 1's §3.3 "Bikram Sambat conversion library does not exist in this codebase" and Gap #9 "No BS↔AD conversion library declared anywhere" are **refuted** and should be removed. BS date calendar data covers years 2000-2090.

3. **BS UI component exists.** `edforge-saas-frontend/packages/ui/src/components/BsDatePicker.tsx` (332 lines) imports from `@aibrains/shared-types`. Phase 1's §3.3 UNVERIFIED flag on "where BS formatting happens on the frontend" is answered: here.

4. **Currency formatting utility exists.** `packages/shared-types/src/utils/currency.ts` implements South Asian lakh/crore grouping (NPR, INR) and western grouping (USD/EUR/GBP). Phase 1 didn't note this; if finance were plumbed to read `WorkspaceSettings.regional.defaultCurrency`, the display side is already built.

5. **Second audit mechanism exists (CloudWatch structured logging via `AuditLoggerService`).** Used in `users.service.ts:256` (userCreated), finance services (refunds/fee-structures/discount-rules/credit-notes with 3-4 calls each), and both permission guards (identity & academics) for `logPermissionDenied`. Phase 1's §7.1 inventory only captured the `AuditLogEntry` DDB entity and concluded "Not written on: …users…, finance…" which is **partly incorrect** — those writes happen, just to CloudWatch, not DDB. Absence of DDB audit remains valid; full audit absence is not.

6. **Analytics is tenant-regional-aware (positive).** `server/lib/analytics/lambda/api/handler.ts:170-174` pulls `defaultCalendarSystem` and `enableDualDateDisplay` from the tenant-settings resolver; `:187` pulls `defaultWeekStartsOn`. `aggregator/handler.ts` buckets time in tenant timezone. Analytics does NOT have its own calendar assumptions. Phase 1 omitted analytics entirely; this is a positive counterpoint to Gap #4 (duplication) — analytics reads from the canonical workspace row.

7. **COUNTRY_DEFAULTS claim is overstated.** Phase 1 §0 bullet 2 says "three duplicated `COUNTRY_DEFAULTS` maps" and lists three files. In reality:
   - `packages/tenant-locale-defaults/src/index.ts` — canonical source.
   - `server/lib/bootstrap-template/tenant-seeder-lambda.ts:116,128` — **imports from the canonical package** and inlines via `JSON.stringify` at CDK synth time. That is a generated copy, not a hand-maintained duplicate.
   - `client/AdminWeb/src/pages/Tenants/TenantCreate.tsx:36` — imports `COUNTRY_OPTIONS` from the canonical package. **Not a duplicate.**
   - `server/application/microservices/identity/src/common/entities/workspace-settings.entity.ts:74` — this **is** a hand-duplicated copy (with an explanatory comment at :8-18 about Dockerfile constraints).
   
   So: one canonical package + one deliberate duplicate in the identity entity + one synth-time inlined copy. The AdminWeb claim is wrong. The seeder Lambda claim is technically right but misleading about the maintenance burden.

8. **`department.entity.ts:193` is a DIFFERENT dict.** Called `COUNTRY_CONFIG_OVERRIDES`, not `COUNTRY_DEFAULTS`. It carries school-level fields (`schoolDays`, `startTime`, `endTime`, `periodDuration`, `gradingScale`) that are absent from `COUNTRY_DEFAULTS`. Phase 1 conflates these under the same "duplication" banner; they are orthogonal concerns.

9. **No migrations directory / scripts.** `find` returns none under `/server`. Consistent with DDB schema-on-read. `server/lib/provision-scripts/{provision,deprovision,seed-existing}-tenant.sh` are provision-only, not migrations.

10. **No Cognito locale-sensitive setup.** `server/lib/tenant-template/identity-provider.ts` configures only English email templates (`emailSubject: 'Welcome to EdForge…'`); no locale attribute or per-tenant email template selection. Future multi-archetype concern.

11. **`shared-analytics-types` package referenced in CLAUDE.md does NOT exist.** CLAUDE.md says "Cross-codebase analytics contract types live in `packages/shared-analytics-types/`" — the directory is absent from `packages/`. Not a baseline concern but a stale rule.

## 6. Contradictions Found

1. **§0 bullet 2 says "No archetype / country / region lookup anywhere" but §5.3 describes PermissionGuard's `schoolId` extraction and `DataScopeService` scope resolution** — which ARE lookup mechanisms at school granularity (tenant/school context IS the de facto "region" proxy). More precisely: there's no *archetype* table, but there IS *tenant-level regional lookup* via `tenant-settings-resolver`. The blanket "no lookup" phrasing is too strong.

2. **Report §3.3 says "Bikram Sambat conversion library does not exist" AND §1.3 lists "CALENDAR_SYSTEM_OPTIONS (gregorian | bikram_sambat)"** in the UI. If the UI supports BS and the analytics lambda converts BS, how did Phase 1 reach "does not exist"? The `grep` in §3.3 appears to have been too narrow. This contradicts Gap #9's severity claim.

3. **§5.3 says TenantAdmin "bypass" at both PermissionGuard (`:76-81`) AND at `roles.service.ts:494`** — that's two layers of the same bypass. If PermissionGuard short-circuits, the identity HTTP call never happens; the identity-side bypass is defense-in-depth and the report doesn't flag the apparent redundancy or discuss who actually hits line 494 (answer: finance's permission guard + direct HTTP callers).

4. **§7.1 says "Not written on: …student create/update/delete/import"** but Phase 1 only checked the `AuditLogEntry` DDB entity and missed the CloudWatch `AuditLoggerService` used in `permission.guard.ts` on permission denials. Student data mutations themselves don't hit either mechanism — true — but the blanket "no audit" framing understates what IS captured.

5. **§1.2 table lists `GET /tenants/my/settings` with "Jwt" but §5.3 says it "bypasses permission checks"** — not a contradiction, but the phrasing in §5.3 suggests a special bypass; in reality there's simply no `@RequirePermission` decorator on that handler. More neutrally stated: "public to any authenticated user in own tenant."

6. **§3.1 "no state machine validation" characterization** — correct for academic year status. Phase 1 calls out in the prompt this very kind of confusion ("conflates enum validation with state-transition validation"). The report itself is actually careful here (§3.1 explicitly distinguishes Zod-enum from state-machine) — that is one of the clearer sections. No other instance of that specific conflation found.

## 7. Critical Questions Before Implementation

1. **Is `country` the right abstraction, or is `archetype` distinct?** `Tenant.country` is ISO-3166 alpha-3 (NPL, IND, USA); but PABSON is a *school-type umbrella within Nepal*, not a country. Two Nepalese pilots — one PABSON school, one Nepal government school — might share `country=NPL` but have different governance (e.g., IEMIS reporting cadence). Does the archetype live above country, below it, or orthogonally?

2. **What is the migration plan for the single `WorkspaceSettings` row per tenant when we introduce archetype?** Do existing Saraswati settings stay untouched, does the archetype become a new optional field on the workspace row, or does it go on `Tenant` (alongside `country`)?

3. **Which row wins for each duplicated regional field (timezone, locale, calendarSystem)?** Tenant vs School vs SchoolConfig precedence is undefined. Finance uses `'NPR'` literal; analytics reads tenant; school config reads school. An explicit resolution policy is required before v1 go-live — otherwise behavior is arbitrary per-consumer.

4. **Should finance currency migrate from hardcoded `'NPR'` literal type to `string` sourced from WorkspaceSettings before Saraswati ships?** If yes, it's a cross-cutting change in 6+ finance entities + all mappers + DDB item migration. If no, Nepal-only is baked into types.

5. **Is the `BsDatePicker` component approved for parent-facing contexts?** It exists in `packages/ui` but I can't confirm it's rendered on parent portal views. Does rollout depend on integrating it into specific pages?

6. **When `isLocked` write path is implemented, should lock be:** (a) all-regional-fields frozen, (b) per-field via `field-governance.ts` extended to workspace fields, or (c) only calendar/currency frozen? The current entity has a single boolean — no per-field granularity.

7. **Academic year state-machine transitions: what's the allowed DAG?** Plausible: `planning → active → completed → archived`, with `completed → active` for reopen. Should `archived` be terminal? Should `status=active` atomically also set `isCurrent=true` (collapsing the two flags)?

8. **For CSV import gender normalization, does the Saraswati Students_2082_All.xlsx template use `M`/`F`?** If yes, is the fix: (a) normalize in service, (b) provide a mapping transform upstream, or (c) fix the template? The answer changes the fix location.

9. **Does `schoolCode` backfill on existing schools trigger `studentNumber` regeneration?** If Saraswati's 779 students have `6D0-2026-…` IDs from the prefix fallback, and admins then set `schoolCode='SEBS'`, do existing students get renumbered to `SEBS-2026-…`? If not, parents see inconsistent IDs.

10. **When `status='active'` is the authoritative flag and `isCurrent` is dead state, do we:** (a) migrate existing `isCurrent=true, status≠active` rows to sync, (b) delete `isCurrent` from the schema, or (c) swap which flag is authoritative? Depending on prod data, different migration paths are needed.

11. **Cross-service auth forwards the user's JWT — is that the intended pattern, or should there be a service-to-service token with narrower scope?** Currently academics calls identity with the end-user's JWT. If identity leaks a sensitive endpoint behind JwtAuthGuard only, any academics handler can trigger it. There is no per-caller-service scoping.

12. **What is the BS data support window?** `bikram-sambat.ts` covers BS 2000-2090. Is that enough for a newborn's DOB (could be recent) and a grad's cert lookup (could be 40 years back)? For 2026 go-live, probably fine; worth confirming.

## Overall verdict

**The baseline report is ~85-90% accurate on schema and endpoint details, but has three meaningful errors of omission/overstatement that would mislead an implementation agent:**

Must be corrected before handing to implementation:

- **Gap #9 "No BS↔AD conversion library" is flatly wrong.** The converter exists in `packages/shared-types/src/utils/bikram-sambat.ts`, is exported, and is consumed by analytics and a UI date picker. Building a second one would duplicate work and risk drift.

- **Gap #1 understates the finance currency problem.** `'NPR'` is hardcoded as a TypeScript literal type in invoice/payment entities — this is a *stronger* form of coupling than "duplicate regional fields" and is absent from the report's Tenant/School/SchoolConfig overlap table in §2.2. Any "make EdForge multi-archetype" plan must budget for finance entity refactor.

- **COUNTRY_DEFAULTS duplication framing is inaccurate.** One canonical package, one hand-duplicated copy (identity entity), one synth-time generated inline (seeder Lambda), and AdminWeb imports from canonical. Operators reading the report would over-estimate maintenance burden.

Should be corrected but not blocking:

- Audit trail in §7.1 misses the CloudWatch `AuditLoggerService` used broadly in finance, users, and permission guards.
- §0 bullet 2's "no country/region lookup anywhere" is too absolute given `tenant-settings-resolver` and analytics' regional reads.

The lock claim (§1.4 and §2.3), the RBAC trace (§5.3), and the `PATCH /tenants/:tenantId` bug (Gap #3) are all verified and trustworthy. The `isCurrent` vs `status` orthogonality (§3.2) is correctly characterized. Student ID generation (§6.2) and CSV import pipeline (§6.3) are accurate.

**Recommendation:** Do not hand the report to an implementation agent unchanged. Patch at minimum Gaps #9, #1 (with finance specifics), and the §0 bullet-2 framing before proceeding. The corrected version is a solid foundation for Phase 3.
