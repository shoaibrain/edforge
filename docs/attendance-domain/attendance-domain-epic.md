# EPIC — Student Attendance Domain (PABSON daily-first, Ed-Fi-aligned, multi-archetype-ready)

> **Status:** DRAFT v3 (architecture/scalability + terminology pass) · **Scope:** academics + identity backend, `@aibrains/shared-types`, `edforge-saas-frontend` attendance UI · **Archetype driver:** PABSON (Saraswati pilot), designed to generalize to future archetypes (CBS, NGO-run, CBSE_IN, NAIS_US, GEMS_UAE) and regions · **Tier:** BASIC only.
>
> Single source of truth for the Attendance Domain epic: an evidence-based review
> of what is built, the Ed-Fi v6 reference model, **how the design stays scalable
> and maintainable across archetypes/regions and Ed-Fi-certifiable**, a gap
> analysis, the target architecture, and an atomic, demoable sprint plan.
>
> **Companion reading:** [`ARCHITECTURE.md`](../../ARCHITECTURE.md),
> [`CLAUDE.md`](../../CLAUDE.md), [`docs/pilot-greenlight/c3-1-attendance-perf-diagnosis.md`](../pilot-greenlight/c3-1-attendance-perf-diagnosis.md),
> [`docs/operations/iemis-integration-platform-plan.md`](../operations/iemis-integration-platform-plan.md).
>
> **v3 changelog (this revision):** Reframed around **scalability/maintainability
> across archetypes + regions and the Ed-Fi certification path** (new §2). **Fixed
> the terminology model:** backend/services speak Ed-Fi **`Section`**; the UI says
> **"Classroom."** A **homeroom is a `Section` with a homeroom designation — NOT a
> new `Class` entity** (v2's `Class` is dropped). Co-teachers are **already native**
> (`CourseSection.coTeacherIds[]`), so primary + co-teacher are first-class. Added
> a **configurable `AttendanceCountingPolicy`** (researched PABSON/IEMIS + Ed-Fi
> chronic-absenteeism defaults) resolved archetype→tenant→school. Carries forward
> v2's verified corrections (bulk-scan + module-wiring already shipped; reuse the
> existing identity calendar; `derivedFrom` backfill prerequisite; HTTP resolver;
> GSI one-per-deploy discipline).

---

## 0. The problem in one paragraph

EdForge records attendance **section-first** (a teacher marks a subject `Section`
— UI: "Classroom"), and school-day attendance exists only as a **derived** roll-up.
Nepalese PABSON schools instead take **one daily homeroom roll-call** per student
per day. Because there is no daily/homeroom workflow, only ~40 of 250 students get
recorded per day, so the dashboard rate (`attending ÷ enrolled`) is a meaningless
~16% coverage artifact. A per-school **attendance policy** (`daily|period|both`)
exists in the data model but is **inert**. This epic makes attendance
**policy-driven and daily-first**, modeling a **homeroom as a designated Ed-Fi
`Section`** (reusing the roster, teacher, and co-teacher structures that already
exist), makes the rate honest via the **existing instructional calendar**, replaces
the **premature unbounded alerts table** with the shared TanStack `DataTable`, and
— crucially — does all of this as **archetype/region-resolved configuration**, so
a new school type or country is a config change, not a code fork, and so the
canonical `StudentSchoolAttendanceEvent` record is always produced in an
**Ed-Fi-certifiable** shape.

---

## 1. Decisions locked

| # | Decision | Choice | Consequence |
|---|---|---|---|
| D1 | **Daily roster unit** | **Homeroom = a designated Ed-Fi `Section`** (UI: a "homeroom Classroom"). Reuse `CourseSection` + `SectionEnrollment` roster + `Enrollment.sectionId`/`homeroomTeacherId`. **No new `Class` entity.** | Add a `sectionType` discriminator to `CourseSection`; seed/designate homeroom sections; roster via the existing `SectionEnrollment` GSI1. |
| D2 | **Policy placement** | **Per-school override + tenant default**, on the existing `daily\|period\|both` enum. Effective = `school.attendancePolicy ?? tenant.defaultAttendancePolicy`, itself **archetype-defaulted**. | Resolver reads school config over **HTTP**; PABSON archetype default = `daily`. |
| D3 | **Granularities in scope** | **Daily/school-day + per-subject-section**. Defer per-period, Program, Intervention. | `CourseSection.classPeriodId` scaffolding already present for the deferred per-period work. |
| D4 | **Denominator** | **Honest rate + monthly rollup**, reusing the **existing** identity instructional calendar. | Wire `getInstructionalDayCount` into trend/monthly/chronic; surface coverage %. |
| D5 | **Counting policy** | **Configurable `AttendanceCountingPolicy`** (category→attending/absent/excluded, half-day = 0.5, chronic definition, thresholds), **archetype-defaulted, tenant/school-overridable** — see §2.3. | One config object, no hardcoded PABSON math; resolves the ADA/excused question (§11 Q1) with a researched default. |
| D6 | **Teacher binding** | **Primary + co-teacher**, already native on `CourseSection` (`primaryTeacherId` + `coTeacherIds[]`). | Daily roll-call authorized for the homeroom section's primary **or** any co-teacher; data-scope grants the roster to all of them. |

---

## 2. Architecture, scalability & Ed-Fi certification (why this design generalizes)

This epic exists to meet a **Nepalese PABSON** business need, but EdForge is built
for **archetypes**, not one school. The design below is the part that keeps it
scalable and maintainable as new archetypes (CBS public schools, NGO-run, and
later CBSE_IN / NAIS_US / GEMS_UAE) and regions onboard, and keeps the door open
to **Ed-Fi certification**.

### 2.1 EdForge's scalability pillars — and how attendance must honor each

| Pillar (existing) | What it means | How this epic honors it |
|---|---|---|
| **Archetype-first config** (`Tenant.archetype`, `ARCHETYPE_DEFAULTS`) | Behavior flows from archetype → country → school defaults; **never** `country==='NPL'` branches (GB1.4). | Attendance **mode** (D2) + **counting policy** (D5) + chronic threshold are archetype-defaulted config, resolved at runtime — not PABSON `if`s. A new archetype ships as a defaults row. |
| **Region/locale on `WorkspaceSettings`** (timezone, calendar, **week-start Sun–Fri**, BS/Gregorian, number format) | Regional behavior is data, set once per tenant. | Attendance uses the school's instructional calendar (already region-aware: `isWeekend`/`isHoliday` honor Nepal's Sun–Fri week); BS dates render via `@aibrains/shared-types`. No weekend/holiday logic is hardcoded. |
| **School-first grade codes + canonical projection at the reporting boundary** | Schools label grades locally; canonical (CEHRD) projection happens only at IEMIS/Ed-Fi export. | Monthly/IEMIS attendance rollups apply `schoolGradeToCanonical` at the **reporting boundary**, not in operational records. Homeroom sections likewise project to an Ed-Fi homeroom/advisory `CourseOffering` **at the export boundary** (same pattern), so operational data stays school-shaped. |
| **Ed-Fi vocabulary on the backend** (`Section`, `StudentSchoolAttendanceEvent`, descriptors; `@edforge/edfi-ts-models`) | Backend speaks Ed-Fi for compliance; the **UI translates to operator language** ("Classroom"). | See §2.2. Every attendance write produces Ed-Fi-shaped records with descriptors (§2.4). |
| **Single-table DDB, overloaded GSIs, one-GSI-per-deploy** | Scale via access-pattern design, not new indexes. | All new access patterns **overload existing GSIs** (GSI1 school-scope for rosters; GSI2/GSI3 for student/date). **No new physical GSI** is required (see §6). |
| **Event-driven, registry-validated** | Domain actions emit Zod-validated events; analytics consumes async. | Attendance emitters move to the already-registered `attendance.*` events; the analytics aggregator scales independently. |

### 2.2 Terminology: `Section` (backend) ↔ "Classroom" (UI); homeroom = a designated Section

EdForge deliberately speaks **Ed-Fi `Section`** in the services/data model (for
Ed-Fi language + compliance) and **"Classroom"** in the presentation layer
(where teaching happens). This epic **must not** introduce a third concept.

- A **`CourseSection`** (`entityType:'SECTION'`, `SECTION#{schoolId}#{sectionId}`)
  already carries `sectionName`, `primaryTeacherId`, **`coTeacherIds[]`**,
  `subjectArea`, `classPeriodId?` (Ed-Fi `ClassPeriodReference` scaffolding),
  `isActive`.
- A **homeroom** is therefore modeled as a **`Section` with `sectionType:'homeroom'`**
  (new discriminator; default `'instructional'`). The class teacher(s) are the
  section's `primaryTeacherId` + `coTeacherIds`. The roster is the existing
  **`SectionEnrollment`** (`SEC_ENROLL#{schoolId}#{sectionId}#{studentId}`, roster
  GSI1 `SEC_ENROLL#{sectionId}#{lastName}`). The student's homeroom pointer is the
  already-present `Enrollment.sectionId` + `Enrollment.homeroomTeacherId`.
- **UI:** the homeroom appears as a "homeroom Classroom"; the Daily-Entry tab lets
  the class teacher pick their homeroom Classroom and take the day's roll-call.
- **Ed-Fi referential integrity for certification:** Ed-Fi `Section` references a
  `CourseOffering`→`Course`. For homeroom sections we follow the school-first
  pattern: keep operational homeroom sections lightweight (no real subject), and
  **synthesize the Ed-Fi "Homeroom/Advisory" `CourseOffering` at the export
  boundary** (recommended), or seed a per-school synthetic Homeroom course if
  strict referential integrity is wanted earlier (alternative, §6).

### 2.3 Attendance as resolved configuration, not code branches

Two orthogonal config objects, both **archetype-defaulted and tenant/school-
overridable**, resolved by one academics `AttendancePolicyResolver`:

**(a) `attendancePolicy` (mode)** — `daily | period | both` (existing enum). Picks
which workflow(s) are authoritative for a school. `period` = today's subject-section
path (true per-period timetable stays deferred).

**(b) `AttendanceCountingPolicy`** — how statuses roll up to metrics. Defaults are
**research-based** (see below) but every field is overridable so a future archetype
needs **zero code**:

```
AttendanceCountingPolicy {
  attendingCategories:  [present, late, tardy, remote]   // count toward ADA numerator
  partialDayWeight:     { half_day: 0.5 }                // half-day = 0.5 in num AND denom
  excusedTreatment:     'absent_for_rate'                // excused reduces attendance rate…
  chronicCountsExcused: true                             // …and counts toward chronic absenteeism
  chronicThresholdPct:  10                               // absent ≥10% of instructional days
  atRiskThresholdPct:   90                               // dashboard alert threshold
}
```

**Why these defaults (PABSON/Nepal + Ed-Fi research):**
- Nepal IEMIS monthly attendance % = present-days ÷ working-days; an approved-leave
  day is still a *non-attended* day, so **`excused` reduces the attendance rate**
  (matches today's effective behavior). **Late-but-present counts as attended.**
- **Chronic absenteeism** (US ED / Ed-Fi early-warning convention) counts **both
  excused and unexcused** absences against the student — so `chronicCountsExcused:
  true`, even though excused is flagged separately for discipline/reporting. This
  is why rate and chronic are **separate** computations with different excused
  treatment, and why it must be config (an ADM/"membership" archetype could set
  `excusedTreatment:'present_for_membership'`).
- **Half-day = 0.5** in both numerator and denominator (Ed-Fi `eventDuration`).

Resolution order (mirrors `ARCHETYPE_DEFAULTS`): `school override → tenant setting →
archetype default → platform default`. **No `country==='NPL'` branch** anywhere.

### 2.4 Ed-Fi certification path & the "always produce the school-day event" invariant

Ed-Fi SIS certification (DS v5/v6) exercises the **`StudentSchoolAttendanceEvent`**
resource (plus `StudentSectionAttendanceEvent` and `SectionAttendanceTakenEvent`)
with defined create/read scenarios, and Ed-Fi best practice is explicit: **the SIS
should compute and report school-level attendance as a `StudentSchoolAttendanceEvent`
rather than leaving derivation to a downstream report.** Design implications baked
into this epic so a later certification track is a thin export layer, not a rewrite:

- **Invariant — the canonical `SCH_ATTEND` (school-day) record is ALWAYS produced:**
  directly in `daily` mode (homeroom roll-call), and **derived + persisted** in
  `period`/`section` mode (today's derivation, kept and made provenance-safe).
  Reporting never re-derives.
- **Positive + negative both written:** even with negative ("absentees only") fast
  entry, a present event is written per roster student (Ed-Fi best practice). The
  `SectionAttendanceTaken` marker records that attendance *was* taken.
- **Descriptors populated on every write path** (today the daily/direct path leaves
  them unset): `attendanceEventCategoryDescriptor`, `attendanceEventReasonDescriptor`,
  `educationalEnvironmentDescriptor`, and **`eventDuration`** (days; 0.5 for half-day).
  The `@edforge/edfi-ts-models` projections are the export contract.
- **Descriptor namespacing** stays Ed-Fi-standard (e.g. `uri://ed-fi.org/AttendanceEventCategoryDescriptor`)
  so certification doesn't require remapping.
- **Out of this epic but unblocked by it:** exposing the Ed-Fi **API resources**
  (`/ed-fi/studentSchoolAttendanceEvents`, …) is a separate **Ed-Fi API / IEMIS
  export track**; this epic guarantees the *data* is certification-shaped.

---

## 3. Evidence-based current state (verified)

Backend verified on `claude/pensive-euler-qa3a1v`; frontend on
`edforge-saas-frontend @ 0e6c7d0` (separate repo, read via GitHub).

- **Write model:** `SectionAttendance` (`SEC_ATTEND#{date}#{sectionId}#{studentId}`,
  Ed-Fi `StudentSectionAttendanceEvent`) is the primary path; `SchoolAttendance`
  (`SCH_ATTEND#{date}#{studentId}`, `StudentSchoolAttendanceEvent`) is derived
  (`worst-status-wins`) **or** direct (`recordAttendance` L317–398, `/attendance/bulk`)
  — but **direct rows don't stamp `derivedFrom`** (G10). `SectionAttendanceTaken`
  marker exists.
- **`CourseSection` already has `primaryTeacherId` + `coTeacherIds[]` + `sectionName`
  + `classPeriodId?`** (`course.entity.ts:149–196`); roster is `SectionEnrollment`
  with a roster GSI1; `Enrollment` already has `sectionId?` + `homeroomTeacherId?`
  (`enrollment.entity.ts:52–53`). **Homeroom is buildable with zero new entities.**
- **Rate is a coverage artifact:** `attendance.service.ts:853–930` →
  `attending ÷ enrolled`; ~40/250 recorded ⇒ ~16%. Fix = coverage (daily workflow)
  + surface coverage %; calendar-days fix corrects trend/monthly only.
- **Already shipped (don't rebuild):** the `c3-1` **bulk-scan + lazy-trend**
  (`attendance.service.ts:1139–1284`); the academics **`module-wiring.spec.ts`**
  (covers attendance modules); the **instructional calendar** (identity
  `CalendarDate` + `getCalendarDate`/`getInstructionalDayCount`, consumed by
  `validateInstructionalDay`).
- **Inert policy:** `WorkspaceSettings.policies.defaultAttendancePolicy`
  (`daily|period|both`) — zero runtime reads; tenant-level only. Per-school
  `attendanceRequired` boolean exists, unenforced. **No `attendanceMode` field.**
- **Frontend:** render path `ClassroomsModule → AttendanceModule → AttendanceDashboard`
  (contains bespoke unbounded `AlertsTableV2`) / `AttendanceGrid` (section-driven,
  `SectionSelector` mandatory). A shared `@edforge/ui` TanStack `DataTable` exists;
  attendance is **absent** from `TANSTACK_TABLE_PLAN.md`. No FE policy/mode concept.

---

## 4. Ed-Fi v6 Student Attendance domain — reference model

- **Granularities:** School (whole instructional day), Section (per class period),
  Program, Intervention. Daily/homeroom ⇒ **School**; period secondary ⇒ **Section**.
- **Entities:** `StudentSchoolAttendanceEvent`, `StudentSectionAttendanceEvent`
  (optional `classPeriods[]`), `StudentProgramAttendanceEvent`,
  `StudentInterventionAttendanceEvent`, `SectionAttendanceTakenEvent`. (No school-day
  "taken" event — EdForge's `SectionAttendanceTaken` is a non-Ed-Fi primitive.)
- **Two processes:** *positive+negative* (event per student) or *negative only*
  (absences only; presence inferred via the `*Taken` event). **Best practice: still
  write both present and absent events.**
- **Event shape:** `attendanceEventCategoryDescriptor` (In Attendance / Excused /
  Unexcused / Tardy / Early departure…), `eventDate`, **`eventDuration`** in days
  (1, 0.5), `school/sectionAttendanceDuration` (minutes), `arrival/departureTime`,
  `attendanceEventReason`, `educationalEnvironmentDescriptor`.
- **Expected vs Actual:** rate/ADA/ADM use expected (instructional `CalendarDate`s)
  as denominator; holidays excluded; half-day = 0.5 both sides.
- **High-stakes:** chronic absenteeism (absent ≥10% instructional days, excused +
  unexcused), ADA/ADM funding, early warning.

---

## 5. Gap analysis

| # | Capability | Current | Target | Severity |
|---|---|---|---|---|
| G1 | Daily/homeroom attendance | Only derived from subject sections | First-class School-day via homeroom `Section` roster | **Critical** |
| G2 | Policy honored | Inert, tenant-only | Per-school `attendancePolicy` resolved + enforced | **Critical** |
| G3 | Meaningful rate (coverage) | `attending ÷ enrolled`, sparse | Full-roster daily coverage + coverage% surfaced | **Critical** |
| G4 | Homeroom roster primitive | `Enrollment.sectionId`/`homeroomTeacherId` + `coTeacherIds` exist but unused for homeroom | `sectionType:'homeroom'` on `Section`; reuse `SectionEnrollment` roster | **High** |
| G5 | Calendar denominator | Calendar exists + consumed for *validation* only | Wire `getInstructionalDayCount` into rate/trend/monthly | **High** |
| G6 | Counting policy / chronic | Hardcoded; excused ambiguous; no chronic def | Configurable `AttendanceCountingPolicy` (D5), archetype-defaulted | **High** |
| G7 | Alerts/overview perf | **Already fixed** | Load-test AC + server-side pagination for the table | **Low** |
| G8 | Alerts table UX | Bespoke unbounded flexbox | `@edforge/ui` TanStack `DataTable` | **High** |
| G9 | Dashboard coherence | Cluttered, misleading | Coherent KPI hierarchy on real data | **Medium** |
| G10 | `derivedFrom` provenance | Direct rows untagged; derivation can clobber | Stamp `'direct'` (+ backfill); precedence early-return | **Medium** |
| G11 | Event taxonomy | Registry exists; emitters still PascalCase | Switch emitters to registered `attendance.*` | **Medium** |
| G12 | Ed-Fi descriptors on daily path + `eventDuration` | Daily/direct writes leave descriptors unset; no `eventDuration` | Populate on every write (cert-shape, §2.4) | **Medium** |
| G13 | Monthly aggregation (IEMIS) | None | Monthly rollup, working-day denom, canonical grade projection | **Medium** |
| G14 | Co-teacher attendance scope | `coTeacherIds` exists; data-scope is section-typed | Homeroom scope incl. primary + co-teachers | **Medium** |
| G15 | Ed-Fi API export | Projections unused | **Deferred** to a certification track (data made cert-shaped here) | **Deferred** |

---

## 6. Target architecture

```
 identity (HTTP)                              academics
 WorkspaceSettings.policies.default… ─┐
 SchoolConfiguration.attendancePolicy ┼─► AttendancePolicyResolver
 CalendarDate (range, EXISTS) ────────┘     ├─ effective mode (daily|period|both)
 ARCHETYPE_DEFAULTS ──────────────────┘     └─ AttendanceCountingPolicy (D5)
                                                    │
        mode∈{daily,both}                           │            mode∈{period,both}
   ┌────────────────────────────┐                   │     ┌──────────────────────────┐
   │ DAILY roll-call            │                   │     │ SECTION (today)          │
   │ roster = homeroom SECTION  │                   │     │ roster = subject SECTION │
   │   (SectionEnrollment)      │                   │     │ writes SEC_ATTEND        │
   │ teachers = primary+co      │                   │     │  → DERIVES + persists    │
   │ writes SCH_ATTEND          │                   │     │     SCH_ATTEND           │
   │  derivedFrom='direct'(AUTH)│                   │     │ SectionAttendanceTaken   │
   │ + descriptors+eventDuration│                   │     └──────────┬───────────────┘
   │ SectionAttendanceTaken(HR) │                   │                │
   └────────────┬───────────────┘                   │                │
                └──────── INVARIANT: SCH_ATTEND always produced ─────┘
                                     │
        getInstructionalDayCount ────┼──► honest rate/trend + monthly rollup (canonical grade projection)
                                     │
                Dashboard + Alerts (@edforge/ui DataTable, coverage%)
```

**Entity changes (no new top-level entity):**
- `CourseSection`: add `sectionType: 'instructional' | 'homeroom'` (default
  `'instructional'`). Homeroom sections reuse `primaryTeacherId`/`coTeacherIds`.
- `SchoolAttendance`: stamp `derivedFrom:'direct'`; add optional
  `homeroomSectionId` (grouping/reporting) + Ed-Fi descriptor fields populated.
- Reuse `SectionEnrollment` for the homeroom roster (existing GSI1) — **no new GSI**.
- Reuse `SectionAttendanceTaken` keyed to the **homeroom** sectionId as the daily
  "taken" marker — **no new `ClassAttendanceTaken` entity**.
- `MonthlyAttendanceRollup` (`ATTEND_MONTH#{yyyymm}#{schoolId}` on the main table)
  — listed per school via the **existing GSI1 school-scope**
  (`gsi1pk = TENANT#{tid}#SCHOOL#{schoolId}`, `gsi1sk = ATTEND_MONTH#{yyyymm}`);
  point reads are a direct `GetItem`. **No new physical GSI** (respects the
  one-GSI-per-deploy constraint).
- **Homeroom `CourseOffering` is synthesized at the Ed-Fi export boundary** (school-
  first projection pattern); alternative: seed a per-school synthetic Homeroom course.

---

## 7. Cross-cutting guardrails (every ticket)

1. **Three-way route registration** (controller + `tenant-api-prod.json` + nginx only
   for new prefixes; `/academics/*` covered). `npm run lint:routes`.
2. **Cross-service reads over HTTP** (`getSchoolConfiguration`, `getCalendarDate`) —
   **no new DDB/IAM grant**.
3. **shared-types bump + consumer pin bumps same PR**; publish only if AdminWeb
   consumes the changed export (the policy-enum likely does). **S2.T2 edits
   [`tenant-locale-defaults.ts`](../../packages/shared-types/src/locale/tenant-locale-defaults.ts)**,
   so it rides that file's **full** deploy chain (change-to-deploy matrix): bump +
   `npm publish` `@aibrains/shared-types` → **`controlplane-stack` redeploy** (the
   defaults JSON is synth-inlined into the tenant-seeder Lambda) **+ identity ECR
   push** (the workspace-settings entity carries a hand-duplicated copy). Keep the
   canonical file and the identity duplicate in lockstep.
4. **Extend the existing** academics `module-wiring.spec.ts` for any new module.
5. **Archetype not country** (GB1.4) — policy + counting defaults via
   `ARCHETYPE_DEFAULTS`; `check-no-country-branch.sh`.
6. **`isActive`/internal flags not in response DTOs** (P1d); `sectionType` may surface.
7. **zod `~3.24.4`**; **BS calendar reuse**; **deploy ladder + one-GSI-per-deploy**
   (prefer overloading); **render-path smoke** on every FE ticket; **no premature
   optimization**.

---

## 8. Sprint plan

Six sprints; each demoable, builds on the prior, ships with tests (or a named
validation). Ordering: S1 closes real debt + the provenance prerequisite; S2 makes
policy + counting a resolvable contract (no behavior change); S3 designates the
homeroom Section (reuse, not build); S4 lights up the daily roll-call (the coverage
fix); S5 makes trend/monthly/chronic honest via the existing calendar; S6 makes it
elegant.

### Sprint 1 — Close real debt + provenance prerequisite (zero behavior change)
**Demo:** a section write can't clobber a direct `SCH_ATTEND` row; events validate; coverage metric visible; `/overview` p95 < 1s @ 1k students.

| Ticket | Work | Validation |
|---|---|---|
| **S1.T1** | Stamp `derivedFrom:'direct'` on all direct `SCH_ATTEND` writes (`recordAttendance` L366, bulk L503) + idempotent **backfill** of existing untagged direct rows. | spec asserts tag; backfill dry-run + idempotency test |
| **S1.T2** | Derivation precedence: early-return when an existing row's `derivedFrom !== 'section_attendance'`. | derivation spec: direct row survives later section write |
| **S1.T3** | Switch emitters (`academics-events.service.ts:566,588,611,635`) to the registered `attendance.recorded`/`updated`; retire PascalCase passthrough. | event-validation test + **analytics-consumer compat check** |
| **S1.T4** | Perf AC (verify): confirm alerts/overview use the shipped bulk-scan; commit a k6 harness proving p95 targets. | harness output + response-shape snapshot |
| **S1.T5** | Coverage telemetry `recorded/enrolled` per school/day. | unit test on emission |
| **S1.T6** | `scripts/dev/seed-attendance.ts` (idempotent). | re-run idempotency |

### Sprint 2 — Policy + counting as a resolvable, archetype-defaulted contract (read-path only)
**Demo:** School A→`daily`; `GET /academics/attendance/policy?schoolId=A` → `{ effectiveMode:'daily', counting:{…}, source:'school' }`; School B inherits; PABSON archetype default = `daily`.

| Ticket | Work | Validation |
|---|---|---|
| **S2.T1** | Atomic enum-consumer change: per-school `attendancePolicy?: 'daily'\|'period'\|'both'` on shared-types `updateSchoolConfigSchema` + response (reuse existing enum). Covers shared-types + identity entity + **identity duplicate** + governance + **AdminWeb consumer**. | build + type tests; consumer compile |
| **S2.T2** | `AttendanceCountingPolicy` type + `ARCHETYPE_DEFAULTS` rows (PABSON defaults per §2.3; GENERIC = today's behavior) in canonical `tenant-locale-defaults.ts` (+ identity duplicate). | archetype-defaults unit test; **no country branch** |
| **S2.T3** | identity: persist `attendancePolicy`; default from tenant policy on school create; governance `alwaysEditable`. | `schools.service.spec.ts` + governance spec |
| **S2.T4** | academics `AttendancePolicyResolver`: HTTP `getSchoolConfiguration` (widen return type) → `{ effectiveMode, countingPolicy }` via `school → tenant → archetype → platform`; cached; in module-wiring spec. | resolver spec (override/fallback/degrade) |
| **S2.T5** | `GET /academics/attendance/policy?schoolId=`. | controller spec; `lint:routes` |
| **S2.T6** | FE: `attendancePolicy` selector in school settings (Daily / Section / Both) + inherited-default display. | vitest + `dev:shell` smoke |

### Sprint 3 — Designate the homeroom Section (reuse, not build)
**Demo:** designate "Grade 9 A" homeroom (a `Section`, `sectionType:'homeroom'`, primary + co-teacher), its roster = existing `SectionEnrollment`; `GET …/sections?type=homeroom` lists it; students backfilled to a homeroom.

| Ticket | Work | Validation |
|---|---|---|
| **S3.T1** | Confirm `Enrollment.sectionId` semantics (homeroom vs course pointer); record decision (reuse vs add `homeroomSectionId`). | written decision + probe test on dev data |
| **S3.T2** | `CourseSection.sectionType` discriminator (default `'instructional'`) + shared-types + filter/CRUD support; homeroom sections allowed without a subject course (Ed-Fi course synthesized at export, §2.2/§6). | entity + schema + service spec |
| **S3.T3** | Homeroom roster read: `GET /academics/sections/:id/roster` via existing `SectionEnrollment` GSI1 (scope-filtered; **no new GSI**). | service spec (roster, RBAC scope) |
| **S3.T4** | Designate/assign: create homeroom sections + enroll students (writes `SectionEnrollment` + `Enrollment.sectionId`/`homeroomTeacherId`); support primary + co-teacher. | service spec incl. co-teacher |
| **S3.T5** | Idempotent backfill `scripts/dev/backfill-homerooms.ts` (from grade + existing `sectionId` if populated; else operator-driven), `--dry-run`. | dry-run snapshot + idempotency |
| **S3.T6** | FE: homeroom designation/assignment UI (a "homeroom Classroom"). | vitest + `dev:shell` smoke |

### Sprint 4 — Daily roll-call workflow, policy + counting honored (the coverage fix)
**Demo:** in a `daily` school, open homeroom "Grade 9 A", mark 2 absentees, save → 30 `SCH_ATTEND` rows (`derivedFrom:'direct'`, descriptors + `eventDuration` set) + `SectionAttendanceTaken`; `/summary` ~93% on real coverage; a `period` school is byte-unchanged.

| Ticket | Work | Validation |
|---|---|---|
| **S4.T1** | `POST /academics/attendance/daily/bulk` — roster-scoped to a homeroom section. **Roster expansion** (write present per unmarked, A1) + **populate Ed-Fi descriptors + `eventDuration`** (G12). | daily spec: full-roster write; negative default; descriptors set; idempotent re-save |
| **S4.T2** | Reuse `SectionAttendanceTaken` keyed to the homeroom section as the daily "taken" marker. | marker spec |
| **S4.T3** | Roster-diff-on-resave semantics (student added/removed mid-day; don't clobber manual marks). | add/remove/re-save spec |
| **S4.T4** | Policy honoring (write): `daily` ⇒ school-day authoritative, derivation suppressed; `period` ⇒ unchanged; `both` ⇒ direct wins (extends S1.T2). **Apply `AttendanceCountingPolicy`.** | per-mode spec; **regression spec: `period` byte-unchanged** |
| **S4.T5** | Policy honoring (read): summary/overview read authoritative source per mode; counting policy applied; coverage% computed. | per-mode summary spec; shape snapshot |
| **S4.T6** | **Homeroom data scope (security):** scope type granting a homeroom's roster to its **primary + co-teachers** (D6). | data-scope spec + **negative test** (no cross-homeroom write) |
| **S4.T7** | FE Daily Entry by homeroom Classroom (when mode∈{daily,both}); "absentees-only/default-present" fast path; `period` keeps subject `SectionSelector`. | vitest + Playwright + render-path smoke |

### Sprint 5 — Honest trend/monthly/chronic via the existing calendar
**Demo:** trend + school average realistic; a month with 3 holidays computes on working days; chronic list = "absent ≥10% of instructional days (excused+unexcused)".

| Ticket | Work | Validation |
|---|---|---|
| **S5.T1** | Consume identity calendar (`getInstructionalDayCount`/`CalendarDate`) to exclude non-instructional days from trend/averages. | trend spec vs fixture month; shape snapshot |
| **S5.T2** | Apply `AttendanceCountingPolicy` to rate: `half_day`=0.5 both sides; `excusedTreatment`; document ADA semantics. | rate spec covering half-day + excused |
| **S5.T3** | `MonthlyAttendanceRollup` + `GET /academics/attendance/monthly` — working-day denom, per-grade (**canonical projection**) + per-homeroom; BS month labels. | rollup spec vs hand-computed fixture |
| **S5.T4** | Chronic absenteeism per `chronicThresholdPct` + `chronicCountsExcused`; threshold from policy (D5). | chronic spec on real denominator |
| **S5.T5** | FE: KPIs + at-risk on real rates; monthly view; coverage% KPI. | vitest + visual check |

### Sprint 6 — UX coherence: dashboard + bounded TanStack alerts table
**Demo:** coherent KPI hierarchy on real numbers; alerts is a paginated/sortable/filterable `@edforge/ui` `DataTable` with student drill-down; no table exceeds `pageSize` rows.

| Ticket | Work | Validation |
|---|---|---|
| **S6.T1** | Server-side pagination (limit/cursor) on `/academics/attendance/alerts`. | pagination spec; back-compat default |
| **S6.T2** | Replace `AlertsTableV2` with `@edforge/ui` `DataTable` (`getRowId`, `pages`, faceted filter, skeleton); **add attendance to `TANSTACK_TABLE_PLAN.md`**. | vitest (≤ pageSize); render-path smoke |
| **S6.T3** | Dashboard hierarchy: KPI band (coverage%, rate, chronic) → trend → breakdowns; drop misleading charts; clear "not taken yet" vs "0%" states. | Playwright snapshots; token check |
| **S6.T4** | Alerts → student drill-down (reuse `useStudentAttendance`); policy-aware empty states ("assign students to homerooms"). | vitest + Playwright |
| **S6.T5** | a11y + responsive (keyboard roll-call grid, table semantics, status-pill contrast). | axe + manual keyboard pass |

---

## 9. Out of scope / deferred (named tracks)

- **Per-period attendance** (`CourseSection.classPeriodId` + `classPeriods[]`) — V1.5.
- **Program / Intervention** attendance.
- **Ed-Fi API export & certification track** — expose `/ed-fi/studentSchoolAttendanceEvents`
  etc. from the `edfi-ts-models` projections. **This epic makes the data
  certification-shaped (§2.4); the export/cert is a follow-on track.**
- **ADA/ADM funding** beyond the monthly rollup.
- **Discipline/incident absences** (Form-19 SOFT).
- **Materialized daily rollups** beyond the monthly one.

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Direct rows lack `derivedFrom` → precedence protects nothing | **S1.T1 backfill is a hard prerequisite**, ordered first |
| `both` mode double-counts | S4.T4 precedence: direct authoritative; derivation suppressed |
| Homeroom-as-Section breaks Ed-Fi referential integrity (Section needs CourseOffering) | Synthesize homeroom `CourseOffering` at the **export boundary** (school-first pattern); alt: seed synthetic Homeroom course |
| Policy/counting hardcodes PABSON → not scalable | **D5 config resolved archetype→tenant→school**; CI `check-no-country-branch` |
| Reused `Enrollment.sectionId` is a course pointer, not homeroom | S3.T1 verifies before building; fallback `homeroomSectionId` |
| New GSI needed (slot-scarce, one-per-deploy) | Reuse `SectionEnrollment` GSI1; only escalate to a one-per-deploy GSI ticket if proven necessary |
| Denominator/coverage change alters historical numbers | Frame as correction; **response shape byte-identical** (snapshot gate); changelog + before/after demo |
| Enum/shared-types change breaks consumers | S2.T1 atomic enum-consumer ticket + CI typecheck; publish if AdminWeb consumes |
| Renaming event emitters breaks analytics | S1.T3 consumer-compat check |
| FE wrong-component edit | render-path smoke per FE ticket; route→component trace in §3 |

---

## 11. Open questions (resolved defaults in **bold**; non-blocking)

1. **Numerator/excused (ADA):** **RESOLVED via D5 default** — attending = present +
   late/tardy + remote (+ half_day 0.5); **`excused` reduces the attendance rate**
   (Nepal/IEMIS) but is **counted toward chronic absenteeism** (Ed-Fi). All
   configurable per archetype. Confirm against the first IEMIS Flash submission.
2. **Co-teachers:** **RESOLVED (D6)** — primary + co-teacher both supported (native
   `coTeacherIds`); roll-call + scope cover all.
3. **`both`-mode authoritative source for IEMIS monthly** — assumed school-day/daily
   authoritative; sections feed per-subject analytics.
4. **Homeroom section-label source** for backfill (S3.T1/T5) — is `Enrollment.sectionId`
   populated today, and where does "A/B" originate?
5. **At-risk threshold owner** — tenant vs archetype vs school (D5 makes it config;
   default archetype).

---

### Appendix A — Key evidence index (file:line)

- Coverage/rate math: `attendance.service.ts:853–930`
- Direct write (untagged): `attendance.service.ts:317–398`, bulk `:463–567`
- **Bulk-scan alerts ALREADY shipped:** `attendance.service.ts:1139–1284`
- Derivation: `common/services/school-attendance-derivation.service.ts`
- **`CourseSection` w/ co-teachers + classPeriodId:** `course.entity.ts:149–196`
- **Homeroom fields on enrollment:** `enrollment.entity.ts:52–53`; roster GSI1: `section-enrollment.entity.ts`
- HTTP accessors: `identity-client.service.ts:935` (`getSchoolConfiguration`), `:962` (`getCalendarDate`)
- Calendar consumed: `validateInstructionalDay` (`attendance.service.ts:1645+`)
- Inert policy: `workspace-settings.entity.ts:59–61`, `tenant-seeder-lambda.ts:347`
- Module-wiring spec EXISTS: `academics/src/__tests__/module-wiring.spec.ts:35–39`
- GSI one-per-deploy: `ecs-dynamodb.ts:104–108`
- FE (`@ edforge-saas-frontend 0e6c7d0`): `routes/attendance/dashboard.tsx` (`AlertsTableV2`); `@edforge/ui packages/ui/src/components/data-table`; `TANSTACK_TABLE_PLAN.md` (attendance absent)
