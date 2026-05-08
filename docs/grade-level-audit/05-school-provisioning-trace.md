---
title: 05 — School Provisioning Trace
status: Done — captures + code-trace complete
date: 2026-05-08
test-bed: dev-pabson-primary (21aea5da-511f-4dfa-a6f2-6971f63a719f), School A (4209e3d8-d2e2-4e0e-9961-790341c264f4)
---

# School Provisioning Trace

The school-create wizard ships a request body. The backend stores three different "regional" footprints. **Two of them disagree with each other and with the tenant's Workspace Settings.** This document traces every byte from wizard → DDB → read APIs and names the divergence sites.

## Captured artifacts

- Request body — [artifacts/A-school-create-wide/01-network/request-POST-schools.json](artifacts/A-school-create-wide/01-network/request-POST-schools.json)
- Response body — [artifacts/A-school-create-wide/01-network/response-POST-schools.json](artifacts/A-school-create-wide/01-network/response-POST-schools.json)
- School-detail GET — [artifacts/G-school-detail/01-network/response-GET-schools-A.json](artifacts/G-school-detail/01-network/response-GET-schools-A.json)
- School `/configuration` GET — [artifacts/G-school-detail/01-network/response-GET-schools-A-configuration.json](artifacts/G-school-detail/01-network/response-GET-schools-A-configuration.json)
- Tenant settings (PABSON-correct baseline) — [artifacts/00-preflight/tenant-settings.json](artifacts/00-preflight/tenant-settings.json)
- AY create + activation — [artifacts/A-school-create-wide/01-network/request-POST-academic-year.json](artifacts/A-school-create-wide/01-network/request-POST-academic-year.json), [request-PATCH-school-activate.json](artifacts/A-school-create-wide/01-network/request-PATCH-school-activate.json)
- Operator notes — [artifacts/A-school-create-wide/notes.md](artifacts/A-school-create-wide/notes.md)

## The three regional keyspaces, side-by-side

For one tenant + one school, captured live:

| Concept | A. Tenant `WorkspaceSettings.regional` | B. School root entity | C. School `/configuration` sub-resource |
|---|---|---|---|
| Source | Tenant-seeder Lambda from `@aibrains/shared-types/locale/tenant-locale-defaults.ts` | Wizard form field, written by `SchoolsService.createSchool` | `DEFAULT_SCHOOL_CONFIG` constant at [department.entity.ts:153-188](../../server/application/microservices/identity/src/common/entities/department.entity.ts#L153-L188), with optional `COUNTRY_CONFIG_OVERRIDES` merge **only at create** |
| Captured value (timezone) | `Asia/Kathmandu` ✅ | `Asia/Kathmandu` ✅ (operator entered) | `America/New_York` 🚨 |
| Captured value (locale) | `ne-NP` ✅ | `ne-NP` ✅ | `en-US` 🚨 |
| Captured value (calendar) | `bikram_sambat` ✅ | `bikram_sambat`, `academicCalendarType=annual` ✅ | `academicCalendarType=semester` 🚨 |
| Captured value (date format) | `DD/MM/YYYY` ✅ | (not stored) | `MM/DD/YYYY` 🚨 |
| Captured value (week start) | `sunday` ✅ | (not stored) | `schoolDays=[1,2,3,4,5]` (Mon-Fri) 🚨 |
| Captured value (grading) | (not stored) | (not stored) | letter A-F, GPA 4.0 → 0.0 🚨 |
| Captured value (currency) | `NPR` ✅ | (not stored) | (not stored) |

**Layer A is correct.** Workspace Settings is the only place that reflects the PABSON archetype defaults end-to-end.

**Layer B is correct here only because the wizard let the operator enter Asia/Kathmandu / ne-NP manually.** The schema permits the operator to override at form submit. CLAUDE.md explicitly forbids this: *"Regional settings (currency, timezone, calendar, locale, number format, week start) live ONLY on `WorkspaceSettings` at the tenant level. School entities MUST NOT override them."* The school root carries fields it should not own.

**Layer C is wrong.** Every regional field is a US default that ignores both A and B.

## How Layer C went wrong — the orphan timestamp

The captured `SchoolConfiguration.createdAt = 2026-05-08T00:35:58.226Z`. The school's own `createdAt = 2026-05-08T18:53:26.643Z`. **The configuration row was written ~18 hours before the school it claims to belong to.**

Code path that explains it (per code-trace agent finding):

1. The intended path: `SchoolsService.createSchool()` at [schools.service.ts:110](../../server/application/microservices/identity/src/schools/schools.service.ts#L110) extracts `countryCode = createDto.address.country || 'USA'` (line 144), calls `getDefaultConfigForCountry(countryCode)` to merge `COUNTRY_CONFIG_OVERRIDES` (line 193-235) onto `DEFAULT_SCHOOL_CONFIG`, and writes the row at lines 297-313.

2. The actual path observed: a `GET /api/schools/<schoolId>/configuration` fired before the school existed (operator browsing during early-day setup, or a frontend prefetch). The `getConfiguration` handler at [schools.service.ts:873-889](../../server/application/microservices/identity/src/schools/schools.service.ts#L873-L889) hits the lazy fallback at lines 884-887 (`createDefaultConfig`) which uses **pure `DEFAULT_SCHOOL_CONFIG` with no country merge**. That row stayed and was never overwritten when the operator later created the school via the wizard.

So:
- **Defect 1:** The lazy `createDefaultConfig` fallback ignores the country/archetype merge that the eager `createSchool` path at least attempts. Two creation paths, one of them strictly worse.
- **Defect 2:** Even the "good" path falls back to `'USA'` when `address.country` is missing. There is no PABSON-aware path; archetype is never consulted at config creation. (PABSON ≠ NPL — PABSON is a Nepal *operational pattern*; the country override map keys off `'NPL'`, which is acceptable, but archetype carries strictly more information and is the canonical first-class field per CLAUDE.md.)
- **Defect 3:** The write is idempotent on `getConfiguration` only when the row exists. There's no reconciliation when the school is later created with a different country than the lazy default.
- **Defect 4:** Workspace Settings is never consulted. Even when a tenant has the correct archetype-driven defaults visible at the tenant level, the school sub-resource doesn't inherit.

## Why this matters — Layer C is consumed live in production

The agent's grep across the academics service:

| Consumer | File:line | What it reads | Effect for Nepal pilot |
|---|---|---|---|
| Bell-schedule validation | [sections.service.ts:177](../../server/application/microservices/academics/src/sections/sections.service.ts#L177) | `schoolConfig.schoolDays` (default `[1,2,3,4,5]`) | Class periods validated against Mon-Fri. Friday is a school day in Nepal; **Saturday in the Sun-Fri week is not** — but `[1,2,3,4,5]` includes Friday and excludes Sunday. Sunday is day-1 in `defaultWeekStartsOn=sunday`, which would map to index `0` if the system used `Sunday=0` indexing. **Off-by-one risk depending on Day-of-Week numbering convention** — needs a sections.service.ts unit test on a Nepal week to settle. |
| Grading | [grades.service.ts:604+, 668+, 1195+](../../server/application/microservices/academics/src/grades/grades.service.ts#L604) | `policy.gradingScale` from config | Letter A-F bands get applied. Nepal/CEHRD reports in percentage with 8-grade scale. Any report card or transcript generated from this would carry US letter grades. **Pilot-blocker for Saraswati credentialing.** |
| Identity client export | [identity-client.service.ts:694-711](../../server/application/microservices/academics/src/common/services/identity-client.service.ts#L694-L711) | `getSchoolConfiguration()` exports `{ startTime, endTime, schoolDays, periodDuration }` | Any future consumer of this method inherits the leak. |

**Verdict on Layer C: live, harmful, blast radius extends to attendance scheduling and gradebook.**

## The two-phase activation gate

After school create, the operator must run two more state transitions before the Academics module is accessible:

1. `POST /api/schools/<id>/academic-years` → AY in `'planning'`. **Server auto-computes BS dates** (`startDateBS=2083/01/02`, `endDateBS=2083/12/30`) from the AD inputs via `gregorianToBs` from `@aibrains/shared-types`. ✅ This is what good Nepal-aware code looks like.
2. `PUT /api/schools/<id>/academic-years/<yearId>/status` body `{status:'active'}` → AY moves to `'active'`. **`isCurrent` stays `false`.** Whoever asks "what's the current AY for this school" must take a separate action or rely on an implicit resolver.
3. `PATCH /api/schools/<id>/status` body `{status:'active'}` → school moves `'setup'` → `'active'`. **Only after this** does the Academics module unlock.

Operator UX hazards:
- The gate is implicit. Nothing in any response says "you cannot use Academics until both AY-active and school-active". A non-engineer pilot operator would be lost.
- AY `isCurrent` is a separate boolean from `status='active'`. A school can have multiple `'active'` AYs with none current. The dashboard / IEMIS-import flows that rely on "the current AY" need a deterministic resolver — code-search audit pending.

## What the wizard does right

- The 16 Ed-Fi descriptor names shipped in the request body have **no duplicate `Pre-Kindergarten`** (PPC → `PrePrimaryClass`, PK → `Prekindergarten` cleanly distinct). The shared-types 0.37.0 fix is live in production.
- The wizard offers "additional grade levels" chips (`Infant/Toddler`, `Prenursery`, `Nursery`, `Transitional Kindergarten`, `Postsecondary`, `Ungraded`, `Other`) drawn from the broader Ed-Fi v6 GradeLevelDescriptor catalog. Operator can extend `gradeLevels[]` beyond the auto-computed range.
- BS dates auto-compute server-side using the canonical converter.
- The school root carries `address.country='NPL'`, `address.province='Bagmati'`, `address.district='Lalitpur'` — proper Nepal address shape (Sprint A region-aware-forms work, captured in memory `project_iemis_sprintA_prod.md`).

## What the wizard does wrong

- It writes regional fields onto the school entity that should not exist on the school entity per CLAUDE.md.
- `gradeLevels[]` and `gradeRange` are independent and can disagree. Nothing validates that the descriptors in `gradeLevels[]` are consistent with `gradeRange.start/end`.
- `schoolType` (form value `'k12'`) and `schoolTypeDescriptor` (form value `'Regular'`) are two parallel fields tracking the same concept. **Two more value spaces for school type** — outside this audit's scope but worth flagging.

## Verification checks (run when DDB read access is available)

1. `aws dynamodb get-item --table-name edforge-identity-basic --key '{"PK":{"S":"TENANT#21aea5da-511f-4dfa-a6f2-6971f63a719f"},"SK":{"S":"SCHOOL#4209e3d8-d2e2-4e0e-9961-790341c264f4"}}'` — confirm school METADATA row stores `gradeLevels[]` byte-equal to the captured request body.
2. `aws dynamodb get-item --table-name edforge-identity-basic --key '{"PK":{"S":"TENANT#21aea5da-511f-4dfa-a6f2-6971f63a719f"},"SK":{"S":"SCHOOL#4209e3d8-d2e2-4e0e-9961-790341c264f4#CONFIG"}}'` — confirm SchoolConfiguration row carries the US defaults and the orphan timestamp.
3. CloudWatch tail of `identity-service` log group around `2026-05-08T00:35:00Z` to `00:36:30Z` — find the `getConfiguration` request that caused the lazy create. The correlation-id should be in the log line.

## Verdict

The school provisioning path produces a working entity and unblocks the operator to use Academics, but it leaves **three regional keyspaces in inconsistent states**. The most serious is `SchoolConfiguration` — it's actively read by attendance and grading code paths and silently corrupts behavior for non-US tenants. The pre-pilot Saraswati tenant has been live since April 2026 and is presumed to carry the same orphan-config row; T8's migration shape must include a backfill step.

The duplicate-Pre-Kindergarten visual bug is closed by shared-types 0.37.0; the original screenshot showing the duplicate must have been pre-fix or stale Vercel cache and does not reproduce. **Fix candidate F-PK-1 from the original plan is downgraded to "stale screenshot — close out."**
