# EdForge Baseline Architecture Report — Project Midnight Lockin

_Read-only static analysis. All claims cite `file:line`. Items that could not be fully verified are labeled **UNVERIFIED**._

## 0. Executive summary

1. **`isLocked` is never written to `true` anywhere.** The update path at `server/application/microservices/identity/src/tenants/tenants.service.ts:282` blocks changes when `isLocked=true`, but no code path sets it; `grep "isLocked.*=.*true"` returns zero hits. The `LockIndicator` UI at `edforge-saas-frontend/apps/shell/src/pages/settings/workspace.tsx:183` can never light up.
2. **No archetype / country / region lookup anywhere.** The only country awareness is three duplicated `COUNTRY_DEFAULTS` maps: `server/application/microservices/identity/src/common/entities/workspace-settings.entity.ts:74`, `server/application/microservices/identity/src/common/entities/department.entity.ts:193`, `packages/tenant-locale-defaults/src/index.ts:61`, plus inlined Lambda code at `server/lib/bootstrap-template/tenant-seeder-lambda.ts:128`. Tenant has optional `country?: string` (`tenant.entity.ts:40`) written only at provision (`tenant-seeder-lambda.ts:282`) and never surfaced for update. No `archetype` concept in code.
3. **Tenant, School, and SchoolConfiguration duplicate ~6 regional fields** (`timezone`, `locale`, `dateFormat`, `timeFormat`, `calendarSystem`, `academicCalendarType`) with **no inheritance / fallback / precedence logic**. Each endpoint reads its own row.
4. **`isCurrent` vs `status` on academic year are orthogonal and can contradict.** `getCurrentAcademicYear()` reads `status==='active'` (`academic-years.service.ts:138`), but `setCurrentAcademicYear()` only flips `isCurrent` (`:303-313`). Nothing aligns them. This matches prod observation.
5. **Single-role-per-school enforced solely by SK pattern** `USER#{userId}#ROLE#{schoolId}`. An `assignRole` on existing active → `ConflictException` (`roles.service.ts:107-109`). A user can hold different active roles at different schools.
6. **No EMIS/IEMIS/government-ID field anywhere in code.** `grep "emisStudentId|iemisId|iemis"` returns zero hits in source. Only the `.edforge-analysis/*.md` docs mention it. `studentNumber` is the only external ID, generated as `{PREFIX}-{YEAR}-{SEQ}` via atomic counter at `student-id.service.ts:31-54`. With no `schoolCode` passed (as at `students.service.ts:95`), prefix falls to `schoolId.substring(0,3).toUpperCase()` — that is the `6D0` in `6D0-2026-00008`.

## 1. Tenant Settings

### 1.1 Schema and Data Model

Two rows per tenant in `edforge-identity-basic` (only BASIC is wired — `tenant-seeder-lambda.ts:240-247`):

| Row | PK | SK | Entity |
|---|---|---|---|
| Tenant metadata | `TENANT#{tid}` | `METADATA` | `Tenant` (`tenant.entity.ts:24-71`) |
| Workspace settings | `TENANT#{tid}` | `SETTINGS#WORKSPACE` | `WorkspaceSettings` (`workspace-settings.entity.ts:57-68`) |

- Entity: `server/application/microservices/identity/src/common/entities/workspace-settings.entity.ts:57`.
- Tenant entity with `country?: string` (`tenant.entity.ts:40`).
- Zod schema: `packages/shared-types/src/schemas/identity/tenant.schema.ts:140-161`.
- Default constructor: `workspace-settings.entity.ts:126-153`.
- Lazy-create on first GET: `tenants.service.ts:187-200`.
- Seed on provision: `server/lib/bootstrap-template/tenant-seeder-lambda.ts:294-328`.

### 1.2 API Endpoints and Validation

Controller: `server/application/microservices/identity/src/tenants/tenants.controller.ts`.

| Method | Path | Guards | Body |
|---|---|---|---|
| GET | `/tenants/lookup?subdomain=x` | public | — |
| GET | `/tenants/my/settings` | Jwt | — |
| GET | `/tenants/:tenantId/settings` | Jwt + `TenantAdmin` | — |
| PATCH | `/tenants/:tenantId/settings/confirm` | Jwt + `TenantAdmin` | — |
| POST | `/tenants/:tenantId/onboarding/complete` | Jwt + `TenantAdmin` | — |
| PATCH | `/tenants/:tenantId/settings` | Jwt + `TenantAdmin` | `UpdateWorkspaceSettingsDtoZ` |
| GET | `/tenants/:tenantId` | Jwt | — |
| **PATCH** | `/tenants/:tenantId` | **Jwt only — no role guard** | `UpdateTenantDtoZ` (`tenants.controller.ts:143-153`) |

Validation: Zod via `nestjs-zod`. `regionalSettingsSchema` (`tenant.schema.ts:111-121`) enforces enum for `dateFormat/timeFormat/weekStartsOn/calendarSystem/numberFormat`; `defaultTimezone`/`defaultLocale`/`defaultCurrency` are free-form strings with no region allow-list.

### 1.3 Frontend Components

- **AdminWeb** only creates tenants — `client/AdminWeb/src/pages/Tenants/TenantCreate.tsx:1-564`. Country dropdown from `packages/tenant-locale-defaults/src/index.ts:138` (NPL, USA, IND, OTHER).
- **edforge-saas-frontend shell** has `apps/shell/src/pages/settings/workspace.tsx`. Dropdown values hard-coded in-file (no region filtering):
  - `TIMEZONE_OPTIONS` (13) `workspace.tsx:74-88`
  - `LOCALE_OPTIONS` (9) `:90-100`
  - `CURRENCY_OPTIONS` (5) `:118-124`
  - `CALENDAR_SYSTEM_OPTIONS` (gregorian | bikram_sambat) `:126-129`
  - `NUMBER_FORMAT_OPTIONS` (international | south_asian) `:131-134`

No code filters by country.

### 1.4 Locking Mechanism (or absence thereof)

**Writes of `isLocked: true`: zero occurrences** across the whole tree.

Reads: `tenants.service.ts:282` (gate), `workspace.tsx:366, 384-388` (UI), `packages/tenant-settings-resolver/src/{ddb,http}-resolver.ts` (pass-through).

Initializations to `false`: `workspace-settings.entity.ts:146`, `tenant-seeder-lambda.ts:307`, `tenant.schema.ts:145`.

**The "locked when academic year active" semantic does not exist at tenant level.** Only the school entity and school config have active-year locks (see §2.3).

### 1.5 Field-by-field inventory

| Path | Type | Default | Mutation | Immutable? | Notes |
|---|---|---|---|---|---|
| `regional.defaultTimezone` | IANA | `America/New_York` | PATCH /settings | no | Free-form; 13 UI choices |
| `regional.defaultLocale` | BCP-47 | `en-US` | PATCH /settings | no | Free-form; 9 UI choices |
| `regional.defaultDateFormat` | enum 3 | `MM/DD/YYYY` | PATCH /settings | no | — |
| `regional.defaultTimeFormat` | enum 2 | `12h` | PATCH /settings | no | — |
| `regional.defaultWeekStartsOn` | enum `sunday\|monday` | `sunday` | PATCH /settings | no | Zod enum missing `saturday` though `packages/tenant-locale-defaults/src/index.ts:22` declares it |
| `regional.defaultCurrency` | ISO-4217 | `USD` | PATCH /settings | no | 5 UI choices |
| `regional.defaultCalendarSystem` | `gregorian\|bikram_sambat` | `gregorian` | PATCH /settings | no | Switching mid-year unguarded |
| `regional.enableDualDateDisplay` | bool | `false` | PATCH /settings | no | UI only if BS selected |
| `regional.defaultNumberFormat` | enum 2 | `international` | PATCH /settings | no | — |
| `branding.organizationName` | string ≤200 | tenant name | PATCH /settings | no | — |
| `branding.logoUrl/primaryColor/accentColor` | string? | undefined | PATCH /settings | no | UI section hidden for pilot |
| `policies.defaultAttendancePolicy` | enum 3 | `daily` | PATCH /settings | no | UI section hidden for pilot |
| `isLocked` | bool | `false` | **no setter** | — | See §1.4 |
| `lockReason` | string? | undefined | **no setter** | — | — |
| `workspaceConfirmedAt` | ISO? | undefined | PATCH /settings/confirm | no | Idempotent |
| `onboardingCompletedAt` | ISO? | undefined | POST /onboarding/complete | no | Idempotent |

Tenant entity itself (`tenant.entity.ts:24-71`) has **no field-governance classifier**. `updateTenantSchema` (`tenant.schema.ts:55-62`) omits `country` — making it effectively write-once at provision.

## 2. School Configuration

### 2.1 Schema and Data Model

Two rows per school:

| Row | SK | Entity |
|---|---|---|
| School metadata | `SCHOOL#{schoolId}` | `School` (`school.entity.ts:18-74`) |
| School config | `SCHOOL#{schoolId}#CONFIG` | `SchoolConfiguration` (`department.entity.ts:47-77`) |

Key fields on **`School`**: `timezone` (`school.entity.ts:47`), `locale` (`:48`), `academicCalendarType` (`:49`), `calendarSystem` (`:50`).

Key fields on **`SchoolConfiguration`**: `timezone/locale/dateFormat/timeFormat` (`department.entity.ts:54-57`), `academicCalendarType` (`:60`), `gradingScale/attendanceRequired` (`:61-62`), `schoolDays: number[]` (`:65`), `startTime/endTime/periodDuration` (`:66-68`), notification flags, `features: SchoolFeatures`.

Defaults: `DEFAULT_SCHOOL_CONFIG` at `department.entity.ts:153-188` (US). Country overrides at `department.entity.ts:193-235` (NPL, IND, GBR). Merge via `getDefaultConfigForCountry()` (`:241-245`).

### 2.2 Overlap with Tenant Settings

| Field | WorkspaceSettings | School | SchoolConfig |
|---|---|---|---|
| timezone | ✅ | ✅ | ✅ |
| locale | ✅ | ✅ | ✅ |
| dateFormat | ✅ | ❌ | ✅ |
| timeFormat | ✅ | ❌ | ✅ |
| calendarSystem | ✅ | ✅ | ❌ |
| currency | ✅ | ❌ | ❌ |
| weekStartsOn | ✅ | ❌ | implicit via `schoolDays[0]` |
| academicCalendarType | ❌ | ✅ | ✅ |
| gradingScale | ❌ | ❌ | ✅ |
| schoolDays | ❌ | ❌ | ✅ |

### 2.3 Inheritance and Override Logic

**No fallback, no inheritance, no precedence logic.**

- `GET /schools/:id/configuration` returns the `CONFIG` row only (lazy-create from `DEFAULT_SCHOOL_CONFIG` if absent — `schools.service.ts:900-924`). Does **not** read workspace settings.
- `GET /tenants/:id/settings` returns workspace row only. `packages/tenant-settings-resolver` resolves tenant only, does not merge school overrides.
- Country at school create uses `createDto.address.country` — **the school's address country, not the tenant's country** (`schools.service.ts:90-91`).

**School field governance** (`packages/shared-types/src/identity/field-governance.ts:14-52`):
- `immutable`: `['schoolCode']`.
- `lockedDuringActiveYear`: `['academicCalendarType', 'calendarSystem', 'gradeRange', 'gradeLevels', 'gradingScale', 'schoolDays', 'startTime', 'endTime', 'periodDuration']`.
- Enforced by querying active academic years at PATCH time (`schools.service.ts:284-313` for school; `:788-814` for config). `forceOverride:true + overrideReason` bypasses with audit severity `'high'`.

**The school-level lock works**; the tenant-level lock (§1.4) does not.

**Can a school override tenant's calendar or currency?** Yes, silently. No validator rejects divergence. Currency isn't even on the school row — finance code must pull from workspace settings.

## 3. Academic Year and Term Structure

### 3.1 Schema and State Machine

Entity: `academic-year.entity.ts:23-46`.
- `status = 'planning' | 'active' | 'completed' | 'archived'` (`base.entity.ts:88`).
- `isCurrent: boolean` — separate flag.
- `calendarType = 'semester' | 'quarter' | 'trimester' | 'annual'` (`:41`).
- Key `SCHOOL#{schoolId}#YEAR#{yearId}`.
- No BS storage on the persisted entity; Zod create schema accepts optional `startDateBS`/`endDateBS` (`academic-year.schema.ts:40-42`) which the service **silently drops** (`academic-years.service.ts:78-92`).

**Create** (`academic-years.service.ts:61-106`): always `status: 'planning'`, `isCurrent: createDto.setAsCurrent || false`, validates `endDate > startDate` only.

**Status transitions** (`:244-278`): **no state machine validation** — writes whatever value you send. Zod enum only restricts the set of possible values, not transitions. Can jump `planning → archived` or reopen `completed → active`.

**setAsCurrent** (`:283-318`): clears other `isCurrent`, sets one to `true`. Doesn't touch `status`.

### 3.2 Semantic difference between `status` and `isCurrent`

- `status === 'active'` — read by `getCurrentAcademicYear()` (`:138`) and by school field-governance checks (`schools.service.ts:299`).
- `isCurrent === true` — set by setAsCurrent flow, **used by nothing in the backend**.

**Consequence**: `/api/schools/:id/academic-years/current` returns the year with `status==='active'` even when `isCurrent===false`. The `isCurrent` flag is dead state.

### 3.3 Calendar System Integration

- `calendarType` on the year vs `academicCalendarType` on school config — same 4-value enum, never cross-validated.
- Downstream consumers of year `calendarType`: only response DTOs (`academic-years.service.ts:688`, `school-years.service.ts:151`). **No code branches on its value.**
- Saraswati runs 3 terms/4 exams; `calendarType: 'quarter'` is cosmetic — no runtime effect, but confusing in UI and API.

**Grading Periods** (`academic-year.entity.ts:56-87`): separate entities under the year. Key `SCHOOL#{schoolId}#YEAR#{yearId}#TERM#{termId}`. Auto-create corresponding `AcademicSession` if none linked (`academic-years.service.ts:413-447`).

**Bikram Sambat conversion library**: **does not exist in this codebase**. `grep -ri "bikram_sambat|bikramSambat|B\.S\."` finds only enum literals and comments. No converter package declared. **UNVERIFIED** where BS formatting happens on the frontend.

### 3.4 Locking Behavior

- Tenant settings: no lock on year transition (§1.4).
- School metadata/config: `lockedDuringActiveYear` fields rejected with 400 unless `forceOverride` (`schools.service.ts:292-313`, `:788-814`).
- **No write-time side effect** when a year's `status` flips to `active` — no cascading field lock, no `isLocked` toggle.

## 4. Tenant Provisioning Flow

### 4.1 SBT Pipeline

1. AdminWeb POST to ControlPlane API (`client/AdminWeb/src/pages/Tenants/TenantCreate.tsx:178-196`).
2. SBT runs `server/lib/provision-scripts/provision-tenant.sh`.
3. Script:
   - Parses `tenantId/tier/email/tenantName/useFederation/country` (`:41-46`).
   - **Hard-rejects tier !== 'BASIC'** (`:63-67`).
   - Deploys CDK stack (`tenant-template-stack-basic`).
   - Creates Cognito admin user with custom attributes `custom:userRole=TenantAdmin`, `custom:tenantId`, `custom:tenantTier`, `custom:tenantName` (`:166-170`).
   - Creates tenant group and adds admin (`:173-181`).
   - Creates per-tenant SNS topic `edforge-alerts-tenant-{tenantId}` (`:218-222`).
   - Exports `tenantId/tier/country` for SBT's `sbt_aws_provisionSuccess` event.
4. `TenantSeederLambda` (`server/lib/bootstrap-template/tenant-seeder-lambda.ts`):
   - Writes `METADATA` row (`:253-273`), optional `cognitoUserPoolId` + `country` (`:276-283`).
   - Writes `SETTINGS#WORKSPACE` row merging `COUNTRY_DEFAULTS[country]` over `US_DEFAULTS` (`:294-320`).
   - Conditional writes with `attribute_not_exists` for idempotency.

### 4.2 Onboarding Steps

`edforge-saas-frontend/apps/shell/src/components/onboarding/OnboardingFlow.tsx` — 7 steps: Welcome → Identity → WorkspaceConfirm (→ `PATCH /tenants/:id/settings/confirm`) → CreateSchool → AcademicYear (auto-skipped if no school) → InviteTeam → Complete (→ `POST /tenants/:id/onboarding/complete`). 30-min sessionStorage persistence.

### 4.3 Regional Configuration at Creation Time

Three code points must agree; ownership is split:
1. AdminWeb dropdown: `COUNTRY_OPTIONS` from `@edforge/tenant-locale-defaults` (`TenantCreate.tsx:36`).
2. Seeder Lambda: `COUNTRY_DEFAULTS` inlined at synth time (`tenant-seeder-lambda.ts:25, 116`).
3. Identity entity lazy-create: **duplicate** at `workspace-settings.entity.ts:74-106`.

**`country` is write-once at provision** — not exposed in `updateTenantSchema`.

## 5. RBAC/ABAC

### 5.1 Role Definitions and Storage

**Global role** — Cognito `custom:userRole` + mirror on `User` entity (`user.entity.ts:51`). Values: `'TenantAdmin' | 'TenantUser'` (`base.entity.ts:98`). Login sets `status: 'active'` unconditionally (`auth.service.ts:139` with in-code TODO).

**School role** — `ROLE_ASSIGNMENT` rows, key `USER#{userId}#ROLE#{schoolId}`. Values: `'Principal' | 'VicePrincipal' | 'Teacher' | 'Accountant' | 'Staff' | 'Counselor' | 'Nurse' | 'Student' | 'Parent'` (`base.entity.ts:103`). Seniority map `roles.service.ts:40-50`. Default permission lattice `role-assignment.entity.ts:130-218`.

### 5.2 JWT Token Construction

`libs/auth/src/jwt.strategy.ts:16-32`: `sub`, `cognito:username`, `cognito:groups?`, `custom:tenantId`, `custom:tenantTier` (BASIC/ADVANCED/PREMIUM), `custom:tenantName`, `custom:userRole` (TenantAdmin/TenantUser), `email`.

**School roles are NOT in the JWT.** Queried from DDB on each request (`auth.service.ts:192-204`, `permission.guard.ts`). 5-min cache `permission.guard.ts:41`.

### 5.3 Access Control Enforcement

Three layers:
1. **`JwtAuthGuard`** (`libs/auth/src/jwt-auth.guard.ts`) — populates `request.user` as `TenantContext` (`tenant-context.interface.ts:35-88`).
2. **`GlobalRoleGuard`** (`identity/src/common/guards/global-role.guard.ts`) — checks `user.globalRole` against `@RequireGlobalRole(...)`.
3. **`PermissionGuard`** (`academics/src/common/guards/permission.guard.ts:57-170`) — resource:action ABAC. TenantAdmin bypass (`:76-81`). Extract `schoolId` from params/query/body → 400 if missing. Cache lookup → HTTP call to identity `/roles/check-permission` → cache result. Deny-wins overrides (`roles.service.ts:531-541`).

**Teacher accessing a section outside their assignment** → `DataScopeService` (`data-scope.service.ts:89-100`): Principal/VP/Staff/Counselor/Nurse/Accountant → school scope; Teacher → section scope (filtered to `scope.studentIds` at `students.service.ts:359-377`); Parent → student scope (linked IDs); Student → student scope (self). Fail-closed default (`:57-58`).

**Principal accessing a different school** → PermissionGuard → identity `checkPermission` → `roles.service.ts:509` fetches assignment at `USER#{userId}#ROLE#{OTHER}` → not found → 403 `'No active role at this school'`. Correct isolation.

**User with no role** → 403 on anything decorated with `@RequirePermission`. `/tenants/my/settings` still works (no permission decorator).

### 5.4 Multi-Role Support

- Multi-school: yes (one role per school, many schools).
- Multi-role-per-school: **no** — SK uniqueness (`USER#{userId}#ROLE#{schoolId}`) + explicit conflict check at `roles.service.ts:107-109`.
- Multi-global-role: no.

### 5.5 Known Bugs / Anomalies

1. **`PATCH /tenants/:tenantId`** (regular update, not settings) has only `JwtAuthGuard`, no role check (`tenants.controller.ts:143`). Any authenticated tenant user can change `name`, `status`, `branding`, `address`, `contactEmail`.
2. `AuthService.login` sets `user.status='active'` regardless of Cognito state (`auth.service.ts:139`) — TODO acknowledged.
3. `invalidateAllUserSessions` (`auth.service.ts:655-707`) — old JWT remains valid until 1h expiry after role demotion (comment `:652-653`).
4. VicePrincipal has `billing:*` in defaults (`role-assignment.entity.ts:161`) — **UNVERIFIED** whether this matches product intent.
5. 5-min permission cache (`permission.guard.ts:41`) → role revocation lag.
6. `roles.cross-tenant.spec.ts` exists — **UNVERIFIED** whether those assertions run in CI.

## 6. Student Entity and Import

### 6.1 Schema and Relationships

Entity: `academics/src/common/entities/student.entity.ts:24-75`. PK `STUDENT#{studentId}`. GSI1 `TENANT#{tid}#SCHOOL#{schoolId}` / `STUDENT#{LASTNAME}#{FIRSTNAME}`.

Fields: `studentId` (UUID), `studentNumber`, `primarySchoolId`, `currentGradeLevel`, `status: StudentStatus` (`active | inactive | pending | graduated | transferred | withdrawn | suspended` — `academics/src/common/entities/base.entity.ts:218`), `guardians: Guardian[]` (embedded), `portalUserId?`.

Cross-school via `Enrollment` (Ed-Fi `StudentSchoolAssociation`) at `enrollment.entity.ts:27-97`. Deleting a student blocked if active `SEC_ENROLL` rows exist (`students.service.ts:504-521`).

### 6.2 ID Generation

- `studentId = uuid()` v4 (`students.service.ts:91`).
- `studentNumber` via `StudentIdService.generateStudentUniqueId()` (`student-id.service.ts:31-54`): `{PREFIX}-{YEAR}-{SEQ_5}` (e.g., `WHS-2026-00001`). Atomic DDB counter at SK `COUNTER#STUDENT_USI#{schoolId}#{year}` (`:42`). PREFIX from `schoolCode` sanitized/uppercased/max-6, OR **`schoolId.substring(0,3).toUpperCase()`** when `schoolCode` is undefined (`:99-108`).
- `students.service.ts:92-97` always passes `schoolCode: undefined` → prefix is UUID slice → prod sees `6D0-…`. `schoolCode` is available on School entity but never fetched for this.

### 6.3 CSV Import Pipeline

`POST /academics/students/import` (`students.controller.ts:194-211`). Guards: Jwt + PermissionGuard + `@RequirePermission({resource:'students', action:'create'})`. Body: `{ students: Record<string, unknown>[], schoolId }`.

Service: `StudentsService.importStudents()` (`students.service.ts:902-1052`).

Expected fields per row:
- Required: `firstName`, `lastName`, `birthDate` (YYYY-MM-DD; alias `dateOfBirth`), `gender` (**lowercase** `male|female|other|prefer_not_to_say`), `gradeLevel` (alias `currentGradeLevel`).
- Optional: `guardianName`, `guardianPhone`, `guardianEmail`.

Flow:
1. Max **200 rows** per request (`:916-918`).
2. Phase 1: validate + dedup; Phase 2: write in batches of 10 via `Promise.allSettled` (`:1026-1047`).
3. Inline required-field validation (`:941-960`) — does **not** use Zod `createStudentSchema`.
4. Dedup per row (`:963-995`): calls `checkDuplicateDetailed()` which scans up to **1000 students in-memory per row** (`students.service.ts:792-806`). `high` confidence (exact FN+LN+DOB) → skip + push to `duplicates`; `medium` (Levenshtein ≥0.7 / 0.8) → flag but still import.
5. `createStudent` failures → `errors[{row, field:'general', message}]`.

**No `schoolCode` or external/government ID input; no BS date handling.**

### 6.4 Government ID Support

**Absent.** No `emisStudentId` / `iemisId` / `iemisSchoolCode` on Student entity, School entity, CSV import, or Zod schemas. Closest is School's Ed-Fi `identificationCodes?: Array<{identificationCode, educationOrganizationIdentificationSystemDescriptor}>` at `school.entity.ts:71` — **unused by any code path for lookup, validation, or display.**

### 6.5 Guardian Handling

Embedded `Guardian[]` on student (`student.entity.ts:47, 93-109`). Guardian has optional `userId` linking to a portal User.

Portal provisioning: opt-in (`hasPortalAccess: true` + valid `email`), runs async after create (`students.service.ts:1142-1227`). Failures logged, never propagated.

`linkGuardianToUser()` (`:1060-1119`): match by `guardianId`, fallback to email. Sets `userId + hasPortalAccess=true`.

CSV import creates one guardian: splits `guardianName` at first space → `firstName, lastName` (`students.service.ts:1011-1020`), mangles compound Nepali names. `isPrimary: true, hasPortalAccess: false, canPickup: true`.

## 7. Data Integrity

### 7.1 Audit Trail

Entity `AuditLogEntry` at `identity/src/common/entities/audit.entity.ts:23-36`. Key `SCHOOL#{schoolId}#AUDIT#{timestamp}#{auditId}`.

Written on:
- School update (`schools.service.ts:418-434`).
- School status transition (`:539-549`).
- School config update (`:877-892`).

**Not written on**: tenant update, workspace settings update, academic year create/status change/setCurrent, role assign/update/change/deactivate, student create/update/delete/import.

All audit writes are non-blocking `.catch(err => logger.error(...))`. No rollback on audit failure.

### 7.2 Validation Patterns

- Zod DTOs at controller boundary via `nestjs-zod`.
- Minimal entity invariants. `schoolCode` uniqueness checked by pre-scan at create (`schools.service.ts:64-78`) but the PutItem has no `ConditionExpression` — race possible.
- DDB condition expressions used in: seeder idempotency (`tenant-seeder-lambda.ts:289`), school soft-delete version check (`schools.service.ts:682`), role reactivate (`roles.service.ts:424`).
- `validateStudentNumberUnique` (`students.service.ts:738-740`) explicitly avoids the DDB `Limit`-before-`FilterExpression` trap.
- **School existence validated via cross-service HTTP before student create, but fails OPEN** (`students.service.ts:691-725`): during identity outage, orphan students can be created.

### 7.3 Error Handling

- Standard NestJS: `NotFoundException`, `ConflictException`, `ForbiddenException`, `BadRequestException`.
- Secondary effects (event publish, audit write, portal provisioning, analytics emit) consistently use `.catch(err => logger.error(...))` — never awaited, never rolls back.
- **No DynamoDB streams / triggers / DLQs** on any identity or academics table (`grep StreamViewType|StreamSpecification` in `server/lib/` returns zero). Event fan-out is all app-level via SBT EventBridge.
- No periodic reconciliation; student with deleted `primarySchoolId` is still returned by `getStudent`.

## 8. Summary of Gaps

1. **No archetype abstraction** — adding CBSE/GEMS = edit 3 duplicated dicts + inline Lambda code (`workspace-settings.entity.ts:74`, `department.entity.ts:193`, `packages/tenant-locale-defaults/src/index.ts:61`, `tenant-seeder-lambda.ts:128`).
2. **`isLocked` is write-dead** (`workspace-settings.entity.ts:64`, `tenants.service.ts:282`).
3. **`PATCH /tenants/:tenantId` has no role guard** (`tenants.controller.ts:143`).
4. **Duplicate regional fields** with no inheritance across three rows.
5. **`isCurrent` vs `status` orthogonal** (`academic-years.service.ts:283-318` vs `:138`).
6. **`calendarType` on academic year has no runtime consumer** (`academic-years.service.ts:85`).
7. **No academic-year state machine** (`academic-years.service.ts:244-278`).
8. **`startDateBS` / `endDateBS` accepted by Zod, dropped by service** (`academic-year.schema.ts:40-42` vs `academic-years.service.ts:78-92`).
9. **No BS↔AD conversion library** declared anywhere.
10. **No EMIS/IEMIS ID** on Student or School, no CSV column.
11. **School `identificationCodes` Ed-Fi bag unused** (`school.entity.ts:71`).
12. **CSV import dedup O(N²)** — 779 × 1000 reads (`students.service.ts:796-806`).
13. **CSV `gender` case-sensitive lowercase** (`students.service.ts:938, 953`) — `M`/`F` fails.
14. **No way to preserve existing external IDs in import** — `studentNumber` always auto-generated.
15. **`studentNumber` prefix defaults to first 3 chars of school UUID** (`student-id.service.ts:107-108`, `students.service.ts:95`) → `6D0-…` in prod.
16. **Guardian split-by-space** mangles Nepali names (`students.service.ts:1013`).
17. **No audit trail** on tenant, workspace settings, academic year, role, or student mutations.
18. **No DynamoDB streams/triggers** — no async reconciliation.
19. **Student-create school validation fails-open** (`students.service.ts:718-724`).
20. **`AuthService.login` sets `user.status='active'` regardless of Cognito state** (`auth.service.ts:139`).
21. **School-level `calendarSystem` can diverge from tenant** (`schools.service.ts:126`).
22. Zod `weekStartsOn` missing `saturday` vs `packages/tenant-locale-defaults/src/index.ts:22`.
23. **Tenant `country` is write-once at provisioning** (`tenant.schema.ts:55-62`).
24. **5-min permission cache** (`permission.guard.ts:41`) → role revocation lag.
25. **`roles.cross-tenant.spec.ts` — UNVERIFIED** in CI.

## 9. Risk Assessment

### Go-live blockers for Saraswati (mid-April 2026)

1. **Gap #3** — unprotected `PATCH /tenants/:tenantId`. Add `GlobalRoleGuard + RequireGlobalRole('TenantAdmin')` to `tenants.controller.ts:143`. 10-min fix.
2. **Gaps #10, #14** — IEMIS/CEHRD reporting impossible without persisting IEMIS School Code and Student ID. Add explicit fields or use `identificationCodes` on School + a new Student field.
3. **Gap #13** — CSV `gender` lowercase-only. Saraswati's Excel uses `M`/`F` → 100% import failure. Normalize in `students.service.ts:938` or change the template.
4. **Gap #15** — `6D0-…` IDs unacceptable on parent-facing ID cards. Fetch `school.schoolCode` in `students.service.ts:95`.
5. **Gap #9** — no BS converter. PABSON requires B.S. display for parents and government. Ship a BS↔AD library or scope pilot to Gregorian-only (not realistic for Nepal).
6. **Gap #17** — no audit trail on student/role changes. Nepal pilot will hit a parent data dispute within term 1; triage is impossible without it.
7. **Gap #12** — O(N²) import dedup for 779 students ≈ 779K DDB reads and ~30-60s import time (and ~$1 RCU). Tolerable at pilot scale but re-imports amplify.

### High-risk, fix within first month

8. **Gap #2** — implement the write side of `isLocked`, or remove it. Current state misleads operators.
9. **Gap #4** — document or enforce which row wins for each duplicated field.
10. **Gap #5** — collapse `isCurrent` into `status`, or remove `isCurrent`.
11. **Gap #7** — academic year state machine table.
12. **Gap #16** — smarter guardian name parsing.
13. **Gap #19** — switch student-create school-validation to fail-closed.

### Medium-risk / backlog

14. **Gap #1** (archetype), **#8** (BS round-trip), **#20** (login status), **#24** (cache TTL), **#18** (no streams).

### Low-risk / informational

15. Gaps #6, #11, #21, #22, #23, #25.

---

_Files read: ~50. Phase 1 agent duration: ~15 min, 103 tool uses._
