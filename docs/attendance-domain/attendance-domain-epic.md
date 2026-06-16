# EPIC — Student Attendance Domain (PABSON daily-first, Ed-Fi-aligned)

> **Status:** DRAFT v2 (reviewer-corrected) · **Scope:** academics + identity backend, `@aibrains/shared-types`, `edforge-saas-frontend` attendance UI · **Archetype driver:** PABSON (Saraswati pilot) · **Tier:** BASIC only.
>
> This document is the single source of truth for the Attendance Domain epic: an
> evidence-based review of what is built today, the Ed-Fi v6 reference model, a
> gap analysis, the target architecture, and an atomic, demoable sprint plan.
>
> **Companion reading:** [`ARCHITECTURE.md`](../../ARCHITECTURE.md),
> [`CLAUDE.md`](../../CLAUDE.md) (edit traps + house rules — every ticket honors
> them), [`docs/pilot-greenlight/c3-1-attendance-perf-diagnosis.md`](../pilot-greenlight/c3-1-attendance-perf-diagnosis.md),
> and the IEMIS track
> [`docs/operations/iemis-integration-platform-plan.md`](../operations/iemis-integration-platform-plan.md).
>
> **v2 changelog (review incorporated — trust code over planning docs):**
> Corrected four stale "current-state" claims that the planning docs got wrong
> but the code disproves: (1) the alerts/overview **bulk-scan + lazy-trend perf
> fix is already shipped** (`attendance.service.ts:1139–1284`); (2) the academics
> **`module-wiring.spec.ts` already exists** and covers attendance; (3) the
> instructional **calendar/holiday source already exists and is consumed**
> (`identity` `CalendarDate` + academics `getCalendarDate`/`validateInstructionalDay`);
> (4) **`Enrollment` already carries `sectionId` + `homeroomTeacherId`** and a
> grade roster is queryable via GSI1 today. Also: the policy enum is
> `daily|period|both` (there is **no** `attendanceMode`/`section` field — do not
> invent one); direct `SCH_ATTEND` rows **do not stamp `derivedFrom`** (a backfill
> is a prerequisite for any precedence rule); the per-school config is read over
> **HTTP** (`getSchoolConfiguration`), so no new cross-service IAM grant is needed;
> and new GSIs are **one-per-deploy** and slot-scarce, so prefer overloading.

---

## 0. The problem in one paragraph

EdForge records attendance **section-first**: a teacher opens a *course section*
(a subject — "Math Introductory", "Health, Physical & Creative Arts") and marks
the students in it. School-day attendance exists only as a **derived**
(`worst-status-wins`) roll-up of those subject sections. Nepalese PABSON schools
do not work this way: a **class teacher takes one daily roll-call for their whole
class** (e.g. "Grade 9 A") once in the morning, and that is the day's record.
Because there is no daily/homeroom workflow, only a sparse handful of subject
sections get recorded each day (~40 of 250 students in the Saraswati dev tenant),
so the dashboard's headline rate — `attending ÷ enrolled` — is structurally
pinned at ~10–16% and is meaningless. A per-school **attendance policy**
(`daily | period | both`) exists in the data model but is **inert** (written,
governed, tested for persistence — never read or honored). This epic makes
attendance **policy-driven and daily-first**, introduces a thin **class/homeroom**
roster (reusing fields already on `Enrollment`), makes the rate **honest** by
fixing coverage + reusing the existing instructional calendar for the
denominator, replaces the **premature unbounded alerts table** with the existing
EdForge TanStack `DataTable`, and pays down genuine remaining debt — **without
regressing the section path**.

---

## 1. Decisions locked for this epic (answered)

| # | Decision | Choice | Consequence |
|---|---|---|---|
| D1 | **Daily roster unit** | **Homeroom/class grouping** — a thin `Class` (homeroom = grade + section label + class teacher); membership **reuses the existing `Enrollment.sectionId` + `Enrollment.homeroomTeacherId`**; each enrolled student has one homeroom per year; class teacher takes one daily roll-call. | A `Class` *definition* entity + assignment UI + idempotent backfill. **No new membership field and (likely) no new GSI** — grade roster is already GSI1-queryable. |
| D2 | **Policy placement** | **Per-school override + tenant default**, on the **existing `daily\|period\|both` enum**. Tenant `WorkspaceSettings.policies.defaultAttendancePolicy` stays the default; add a per-school `attendancePolicy` override on `SchoolConfiguration`. Effective = `school.attendancePolicy ?? tenant.defaultAttendancePolicy`. | Resolver in academics reads school config over **HTTP** (`getSchoolConfiguration`) — no new DDB/IAM grant. `period` = today's subject-section path (true per-period timetable stays deferred). |
| D3 | **Granularities in scope** | **Daily/whole-school-day** (new primary) **+ per-subject-section** (existing, wired to policy). | **Deferred:** per-period (timetable/`ClassPeriod`), Program, Intervention attendance. |
| D4 | **Denominator** | **Honest rate + monthly rollup** in this epic, **reusing the existing instructional calendar** (no second calendar). | Wire `getInstructionalDayCount`/`CalendarDate` into the rate math; surface coverage %; monthly aggregation entity. |

**Assumptions (correct me if wrong) — see §10 for the open detail questions:**

- **A1 — Negative marking is in scope.** Daily roll-call supports "mark the
  absentees, default the rest present" fast entry (Ed-Fi *negative attendance*
  process) **and still writes a present event per roster student** (Ed-Fi best
  practice). A `ClassAttendanceTaken` marker records that attendance *was* taken.
- **A2 — UX redesign is in scope** as the final sprints, after the numbers become
  real.
- **A3 — At-risk threshold** stays 90% but becomes a tenant/archetype setting
  (it is a hardcoded hook default today), once the denominator is real.
- **A4 — Class teacher** is an existing staff/user; no new RBAC *role*, only a new
  data-scope *type* (homeroom) — treated as a security-sensitive change with its
  own ticket.
- **A5 — PABSON defaults to `daily`** via **archetype** defaults (not
  `country==='NPL'` — GB1.4); `GENERIC` stays `period` (today's behavior).

---

## 2. Evidence-based current-state architecture

References verified against branch `claude/pensive-euler-qa3a1v` (backend, this
tree) and `shoaibrain/edforge-saas-frontend @ 0e6c7d0` (frontend — a **separate
repo**, read via GitHub; §2.4 is verified against that ref, not this tree).

### 2.1 Write model — three entities, section-first, school-derived

| Entity | Type / SK key | Ed-Fi mapping | Role |
|---|---|---|---|
| `SectionAttendance` | `SEC_ATTEND#{date}#{sectionId}#{studentId}` | `StudentSectionAttendanceEvent` | **Primary path the UI drives.** Per student × subject-section × date (per-day, **not** per-period). |
| `SchoolAttendance` | `SCH_ATTEND#{date}#{studentId}` | `StudentSchoolAttendanceEvent` | Per student × date. **Direct write path exists** (`recordAttendance` L317–398, `/attendance/bulk`) but is unused by any daily workflow, and **direct rows do not stamp `derivedFrom`** (see G10). Derivation writes the same key with `derivedFrom:'section_attendance'`. |
| `SectionAttendanceTaken` | `SEC_ATTEND_TAKEN#{date}#{sectionId}` | `SectionAttendanceTakenEvent` | Per section × date completion marker ("X/8 sections recorded"). |

- **Keys / GSIs:** main table `PK=tenantId`, `SK=entityKey`. The student-centric
  and school+date access patterns are written by the entity factories /
  `GSIKeyBuilder` onto the **physical** `gsi2pk`/`gsi3pk` columns —
  i.e. attendance **overloads** physical GSI2 (CDK-labelled "Academic Year
  Index") and GSI3 (CDK-labelled "Assignment Index"). **Cite the entity files**
  (`school-attendance.entity.ts`, `section-attendance.entity.ts`, `base.entity.ts`
  builders), **not** the CDK comments in `ecs-dynamodb.ts` (which describe the
  indexes' original purpose). `GSIKeyBuilder.attendanceDate(tid,school,date)` →
  `TENANT#{tid}#SCHOOL#{schoolId}#DATE#{date}`.
- **Derivation** (`common/services/school-attendance-derivation.service.ts`):
  fire-and-forget after each section write; `worst-status-wins`; optimistic-locked
  upsert; **provenance is only checked for the no-op short-circuit** — so it can
  update a non-`section_attendance` row when status differs (G10).
- **Not implemented:** per-period, Program, Intervention attendance (only unused
  `@edforge/edfi-ts-models` projections; `schedule.entity.ts` vestigial).

### 2.2 Read / aggregation — the *coverage* artifact and what's already fixed

The daily rate (`getDailyAttendanceSummary`, `attendance.service.ts:853–930`) is:

```ts
const totalStudents = enrolledStudents.length || scopedAttendance.length; // ENROLLED
const attending = present + late + halfDay + remote;
attendanceRate = Math.round((attending / totalStudents) * 100 * 100) / 100;  // attending ÷ enrolled
```

The intent (`actual ÷ expected`) is Ed-Fi-correct. **The headline ~16% is a
*coverage* artifact, not a denominator-days bug:** on any instructional day only
`totalRecorded`≈40 of `enrolled` 250 have a `SCH_ATTEND` row (sparse, section-
derived), so even all-present caps at ~16%. Live proof: `2026-05-17` →
`totalRecorded:40, present:40, attendanceRate:16`. **Two distinct fixes:**
(a) **coverage** — the daily roll-call workflow (Sprint 4) brings recorded≈expected
so a day's rate becomes meaningful; (b) **calendar-days** — excluding
holidays/weekends (Sprint 5) corrects *trend/monthly/chronic* averages, not a
single day's rate. The dashboard must also **surface coverage% (`recorded ÷
expected`)** so sparsity is visible rather than hidden.

**Already shipped (do not re-build):** the `c3-1` perf fix. `getAttendanceAlerts`
(`attendance.service.ts:1139–1284`) is the **bulk-scan** version — one GSI1
enrollment query (L1162), then "one GSI3 query per date, parallel batches of 10"
(L1194–1213), in-memory group-by, sort, **top-20 slice with in-memory trend**
(`computeRecentVsBaselineTrend`, zero extra queries). `getAttendanceOverview`
calls this bulk path. What's *missing* is a **load-test harness/AC verification**
and **server-side pagination** on `/alerts` (needed by the new table, Sprint 6).

### 2.3 Policy config — present but inert

- `WorkspaceSettings.policies.defaultAttendancePolicy: 'daily' | 'period' | 'both'`
  (`workspace-settings.entity.ts:59–61`), seeded `'daily'`
  (`tenant-seeder-lambda.ts:347`), governed `alwaysEditable`, schema'd, unit-tested
  **for persistence only**. **Grep proof of inertness:** appears only in entity,
  seeder, governance, and `*.spec.ts` — **zero reads in any academics runtime
  path.** It is also **tenant-level only**.
- Per-school `SchoolConfiguration.attendanceRequired: boolean`
  (`department.entity.ts:62`) + `SchoolFeatures.attendance: boolean` exist but are
  **not enforced** by the attendance path. **There is no `attendanceMode` field**
  anywhere — D2's per-school override is net-new.

### 2.4 Frontend — render path + the premature alerts table (verified @ `edforge-saas-frontend 0e6c7d0`)

```
ClassroomsModule  (apps/academics/src/routes/classrooms/index.tsx)
  └─ AttendanceModule  (apps/academics/src/routes/attendance/index.tsx)
       ├─ tab "overview"     → AttendanceDashboard  (routes/attendance/dashboard.tsx)
       │     └─ AlertsTableV2  (module-private, inside dashboard.tsx)   ← the problem
       └─ tab "daily-entry"  → AttendanceGrid  (components/attendance/AttendanceGrid.tsx)
             └─ SectionSelector (REQUIRED) + AttendanceRow (P/A/L/E/R)
```

- **`AlertsTableV2`** is a **bespoke flexbox list** (`<div className="flex">`
  header + `sorted.map()` rows, `useState` sort) rendering **all** `atRiskStudents`
  with **no pagination/virtualization/`<table>`/DataTable** → unbounded, exactly
  as flagged.
- A shared **`@edforge/ui` `DataTable`** (TanStack v8, `useDataTable`, pagination
  `pages|loadMore|virtual`, faceted filters, `DataTableSkeleton`) **already exists
  and is exported**. `TANSTACK_TABLE_PLAN.md` (8 sprints) **does not inventory
  attendance at all** — the alerts table is off-plan. Plan success criterion #1:
  *"No table renders more than `pageSize` rows (default 20)."*
- **Daily Entry is strictly section-driven**: `SectionSelector` mandatory; no
  section ⇒ "Select a Class Section" empty state; writes go to
  `POST /academics/section-attendance/bulk`.
- **No attendance mode/policy in the FE** — only `features.attendance` (module
  on/off) + `attendanceRequired` boolean. Charts are hand-rolled inline SVG/div
  bars. Offline cache + Zustand store exist.

### 2.5 Ed-Fi alignment today + the calendar that already exists

Descriptor mapping exists (`edfi-attendance-descriptors.ts`): status →
`attendanceEventCategoryDescriptor`, `educationalEnvironmentDescriptor`,
`attendanceEventReason`. **The instructional calendar already exists and is
consumed:** identity ships a `CalendarDate` entity (SK `SCHOOL#{schoolId}#DATE#{date}`,
GSI1 by academic year) with `{isInstructionalDay, isHoliday, isWeekend,
calendarEvents}`, a **range route** `GET /schools/:schoolId/calendar-dates`, a
`getInstructionalDayCount(schoolId,start,end)` helper, and identity
`academic-year.service.getHolidays()`. Academics already calls
`identityClient.getCalendarDate` in `validateInstructionalDay`
(`attendance.service.ts:1645+`) to block writes on non-instructional days. **Gaps
vs Ed-Fi:** no `eventDuration` (full/half-day in *days*); the rate math doesn't
use the calendar denominator; daily/direct writes don't populate
`attendanceEventCategory`/`attendanceEventReason`; Program/Intervention/per-period
absent; no Ed-Fi-shaped export.

---

## 3. Ed-Fi v6 Student Attendance domain — the reference model

- **Four granularities:** **School** (whole instructional day, marked each
  instructional day), **Section** (per class period the section meets), **Program**,
  **Intervention**. Daily/homeroom settings use **School**; period-based secondary
  settings use **Section**.
- **Entities:** `StudentSchoolAttendanceEvent`, `StudentSectionAttendanceEvent`
  (optional `classPeriods[]`), `StudentProgramAttendanceEvent`,
  `StudentInterventionAttendanceEvent`, and `SectionAttendanceTakenEvent` (records
  *that attendance was taken* — the linchpin of the negative model). **Note:** Ed-Fi
  has **no** school-day "taken" event; EdForge's `SectionAttendanceTaken` (and the
  proposed `ClassAttendanceTaken`) are **non-Ed-Fi EdForge primitives**.
- **Two reporting processes (policy choice, applied consistently):** *positive +
  negative* (every student gets an event each day/period) or *negative only* (only
  absences/tardies recorded; presence inferred via the `*Taken` event). **Best
  practice: still write both present and absent events to the store regardless.**
- **Event shape:** `attendanceEventCategoryDescriptor` (In Attendance, Excused
  Absence, Unexcused Absence, Tardy, Early departure…), `eventDate`, **`eventDuration`
  in *days*** (`1`, `0.5`…), `schoolAttendanceDuration`/`sectionAttendanceDuration`
  (minutes), `arrivalTime`/`departureTime`, `attendanceEventReason`,
  `educationalEnvironmentDescriptor`.
- **Expected vs Actual (denominator):** rate / ADA / ADM use **expected**
  attendance (from the **Calendar**: instructional `CalendarDate`s; for sections,
  scheduled class-period meetings) as the denominator, **actual** events as the
  numerator; holidays/non-instructional days excluded. **A half-day is 0.5 of both
  numerator and denominator.**
- **High-stakes use cases:** chronic absenteeism (typically **absent ≥ 10% of
  instructional days**), ADA/ADM for funding, early warning, disciplinary absence.

**Mapping to PABSON:** daily roll-call = **School-day** attendance, negative-or-
positive process, with a **Class/homeroom** roster as the operational grouping
(Ed-Fi has no homeroom; it is an EdForge primitive projecting to
`StudentSchoolAttendanceEvent`).

---

## 4. Gap analysis

| # | Capability | Current state | Target | Severity |
|---|---|---|---|---|
| G1 | **Daily/homeroom attendance** | Only derived from subject sections | First-class School-day attendance via class roster | **Critical** |
| G2 | **Policy honored** | `defaultAttendancePolicy` inert, tenant-only | Per-school `attendancePolicy` resolved + enforced | **Critical** |
| G3 | **Meaningful rate (coverage)** | `attending ÷ enrolled`, sparse coverage → ~16% | Full-roster daily coverage + coverage% surfaced | **Critical** |
| G4 | **Roster primitive** | `Enrollment.sectionId`/`homeroomTeacherId` exist but unused; no `Class` definition | Thin `Class` entity reusing those fields; GSI1 roster | **High** |
| G5 | **Calendar denominator** | Calendar exists + consumed for *validation*, not for the *rate* | Wire `getInstructionalDayCount` into trend/monthly/chronic | **High** |
| G6 | **Chronic absenteeism** | Ad-hoc `< threshold` on sparse data | ≥10%-of-instructional-days on real denominator | **High** |
| G7 | **Alerts/overview perf** | **Already fixed** (bulk-scan shipped) | Load-test AC + server-side pagination for the table | **Low** (verify only) |
| G8 | **Alerts table UX** | Bespoke unbounded flexbox | `@edforge/ui` TanStack `DataTable`, paginated | **High** |
| G9 | **Dashboard coherence** | Cluttered hand-rolled charts, misleading numbers | Coherent KPI hierarchy on real data | **Medium** |
| G10 | **`derivedFrom` provenance** | Direct rows untagged; derivation can clobber them | Stamp `'direct'` (+ backfill); precedence early-return | **Medium** |
| G11 | **Event taxonomy** | Registry+schemas exist; emitters still PascalCase, unvalidated | Switch emitters to registered `attendance.*` names | **Medium** |
| G12 | ~~Module-wiring spec~~ | **Already exists & covers attendance** | Extend for new modules only | **struck** |
| G13 | **Monthly aggregation (IEMIS)** | None | Monthly rollup w/ working-day denominator | **Medium** |
| G14 | **`eventDuration`/half-day** | `half_day` status only | Ed-Fi `eventDuration` (0.5) in num+denom | **Low** |
| G15 | **Program/Intervention/per-period** | Unused projections | **Deferred** (explicit) | **Deferred** |

---

## 5. Target architecture

```
        identity service                                academics service
  ┌───────────────────────────┐        HTTP GET /schools/:id/configuration
  │ WorkspaceSettings.policies │◄──────────────────────────────┐
  │   .defaultAttendancePolicy │  (tenant default)              │
  │ SchoolConfiguration        │                                │
  │   .attendancePolicy  (NEW) │  (per-school override)         │
  │ CalendarDate (EXISTS)      │  GET /schools/:id/calendar-dates (range, EXISTS)
  └─────────────┬──────────────┘                                │
                │                            ┌───────────────────▼────────────────┐
                │                            │ AttendancePolicyResolverService     │
                │                            │  effective = school.attendancePolicy │
                │                            │            ?? tenant.default         │
                │                            └───────┬──────────────────┬──────────┘
                │            mode∈{daily,both}       │                  │  mode∈{period,both}
                │                          ┌─────────▼────────┐ ┌───────▼────────┐
                │                          │ DAILY workflow   │ │ SECTION (today)│
                │                          │ roster = Class   │ │ roster=Section │
                │                          │ writes SCH_ATTEND│ │ writes SEC_ATTEND
                │                          │  derivedFrom=     │ │  → derives SCH  │ (only when section is authoritative)
                │                          │  'direct' (AUTH) │ │ SectionAttendanceTaken
                │                          │ ClassAttendanceTaken
                │                          └─────────┬────────┘ └───────┬────────┘
                │  getInstructionalDayCount(range)   └────────┬─────────┘
                └────────────────────────────────────────────▼─────────────
                              Expected-attendance denominator + monthly rollup
                                            │
                              Dashboard + Alerts (@edforge/ui DataTable, coverage%)
```

**Entities:**
- `Class` (homeroom **definition**): `CLASS#{classId}` → `{ gradeLevel,
  sectionLabel, classTeacherId, schoolId, academicYearId, isActive }`. **Membership
  reuses `Enrollment.sectionId` (homeroom pointer) + `Enrollment.homeroomTeacherId`**
  — confirm `Enrollment.sectionId` is the homeroom pointer (not overloaded for a
  course section) in S3.T1; if ambiguous, add `Enrollment.classId`. **Roster query
  reuses GSI1** (`ENROLLMENT#{yearId}#{gradeLevel}`) filtered by homeroom — **no new
  GSI** unless a homeroom-direct index proves necessary (then it is its own
  one-per-deploy ticket, see guardrail #9).
- `ClassAttendanceTaken`: `CLASS_ATTEND_TAKEN#{date}#{classId}` (daily analogue of
  `SectionAttendanceTaken`; **non-Ed-Fi**).
- `SchoolAttendance` gains optional `classId` + must stamp `derivedFrom:'direct'`
  on direct writes.
- `MonthlyAttendanceRollup`: `ATTEND_MONTH#{yyyymm}#{schoolId}` (working-day
  denominator) — overloads an existing GSI partition, no new physical GSI.
- **Reuse** identity `CalendarDate` for instructional days/holidays — **do not
  build a second calendar.**

---

## 6. Cross-cutting guardrails (apply to every ticket)

1. **Three-way route registration** — controller **+** `tenant-api-prod.json`
   **+** `nginx.template` (only for a *new top-level prefix*; `/academics/*` is
   already covered, so new sub-paths need controller + API-GW spec only). Run
   `npm run lint:routes`.
2. **Cross-service reads over HTTP, not new DDB grants** — academics reads identity
   school config + calendar via the **existing HTTP `IdentityClientService`**
   (`getSchoolConfiguration` L935, `getCalendarDate` L962). **No new IAM grant.**
   (The METADATA direct-DDB grant is purpose-built and not extended here.)
3. **shared-types bump + consumer pin bumps in the same PR** (`server/application/
   package.json`, `server/package.json`, root lockfile). **Publish to npm only if
   an AdminWeb-consumed export changes** — confirm whether AdminWeb imports the
   school-config/policy schema before deciding (it consumes tenant defaults in
   `TenantCreate`, so the policy-enum change likely **does** need publish).
4. **Module-wiring invariant** — academics `__tests__/module-wiring.spec.ts`
   **already exists** (covers `AttendanceModule`/`SectionAttendanceModule`/
   `DashboardModule`); **extend it** for new modules (`ClassModule`) in the same PR.
5. **Archetype not country** (GB1.4) — PABSON default `daily` via archetype
   defaults; never `country === 'NPL'`. `bash scripts/lint/check-no-country-branch.sh`.
6. **`isActive` not in response DTOs** (P1d) — `Class`'s response schema + mapper
   omit `isActive`.
7. **zod pinned `~3.24.4`** — new schemas use the same pin.
8. **BS calendar** — reuse `gregorianToBs`/`bsToGregorian` from `@aibrains/shared-types`.
9. **Deploy ladder + GSI discipline** — DDB/IAM → `tenant-template-stack-basic`
   first, `cdk diff` before deploy, **one GSI added per deploy, wait for ACTIVE**
   (AWS limit, `ecs-dynamodb.ts:104–108`). **Prefer overloading an existing GSI**
   over adding a physical one. Each new physical GSI = its own infra-first ticket
   naming the slot.
10. **Two-repo git hygiene** + **render-path smoke** for every FE ticket (CLAUDE.md
    FE trap) + **no premature optimization** (no materialized rollups beyond the
    monthly one D4 requires).

---

## 7. Sprint plan

Six sprints; each is independently demoable, builds on the prior, and ships with
tests (or a named alternative validation). **Ordering:** S1 closes the *genuine*
remaining debt + the `derivedFrom` prerequisite; S2 makes policy a resolvable
contract with **no behavior change**; S3 builds the thin roster; S4 lights up the
daily workflow (the coverage fix — loudest complaint); S5 makes
trend/monthly/chronic honest via the existing calendar; S6 makes it elegant.

---

### Sprint 1 — Close real debt + the provenance prerequisite (zero behavior change)

**Goal:** the surface is provenance-safe, registry-clean, observable, and
load-verified. **Demo:** a section write can no longer clobber a direct
`SCH_ATTEND` row; attendance events validate against the registry; a coverage
metric is visible; a load test confirms `/overview` p95 < 1s at 1k students.

| Ticket | Work | Validation | Deploy/registration |
|---|---|---|---|
| **S1.T1** | **`derivedFrom` provenance:** stamp `derivedFrom:'direct'` on all direct `SCH_ATTEND` writes (`recordAttendance` L366, bulk L503); idempotent **backfill** script to stamp existing untagged direct rows. | `attendance.service.spec.ts` asserts tag on write; backfill dry-run + idempotency test. | academics ECR; backfill run non-prod first |
| **S1.T2** | **Derivation precedence:** `school-attendance-derivation.service` early-returns when an existing row's `derivedFrom !== 'section_attendance'` (never overwrites a direct/daily row). | `school-attendance-derivation.service.spec.ts`: direct row survives later section write; section-derived row still updates. | academics ECR (depends on S1.T1) |
| **S1.T3** | **Events:** switch academics emitters (`academics-events.service.ts:566,588,611,635`) from PascalCase to the **already-registered** `attendance.recorded`/`attendance.updated` Zod-validated names (retire the `UNKNOWN_EVENT_TYPE` passthrough). | `events/attendance` validation test; **analytics-consumer compatibility check** (aggregator still parses). | academics ECR (no shared-types change) |
| **S1.T4** | **Perf AC (verify, not build):** confirm `getAttendanceAlerts`/`getAttendanceOverview` use the shipped bulk-scan; add a k6/autocannon harness in `docs/deploys/` proving p95 < 500ms (alerts) / < 1s (overview) at 1k students × 30 sections. | Harness output committed; snapshot-equality smoke on response shape. | none (test/harness) |
| **S1.T5** | **Coverage telemetry:** structured log + metric `attendance.coverage = recorded / enrolled` per school/day in `getDailyAttendanceSummary`. | unit test asserts emission; manual CloudWatch check non-prod. | academics ECR |
| **S1.T6** | **Seed tooling:** `scripts/dev/seed-attendance.ts` — N students × M days for perf/UX testing (idempotent). | re-run idempotency; populates dev tenant. | dev tooling |

---

### Sprint 2 — Attendance policy as a per-school, resolvable contract (read-path only)

**Goal:** every school's effective policy is configurable + readable end-to-end;
**no write/read behavior branches yet** (cannot regress recording). **Demo:** set
School A → `daily`; `GET /academics/attendance/policy?schoolId=A` → `{ effective:'daily',
source:'school' }`; School B (unset) → tenant default; PABSON tenant default = `daily`.

| Ticket | Work | Validation | Deploy/registration |
|---|---|---|---|
| **S2.T1** | **Enum-consumer ticket (atomic):** add per-school `attendancePolicy?: 'daily'\|'period'\|'both'` to shared-types `updateSchoolConfigSchema` + `schoolConfigResponseSchema`, reusing the **existing enum** (no `section`/`attendanceMode`). One PR covering: shared-types + identity entity/persistence + **identity hand-duplicated copy** + governance + **AdminWeb consumer** check. | shared-types build + type tests; consumer compile. | shared-types bump + **consumer pin bumps**; **publish if AdminWeb consumes** (guardrail #3). |
| **S2.T2** | identity: persist `SchoolConfiguration.attendancePolicy`; on **school create**, default from `WorkspaceSettings.policies.defaultAttendancePolicy`. | `schools.service.spec.ts`: create inherits; update persists. | identity ECR |
| **S2.T3** | identity field governance: classify `config.attendancePolicy` (`alwaysEditable`); contract test updated. | `workspace-field-governance.spec.ts`. | none (test) |
| **S2.T4** | Archetype default (A5): PABSON `defaultAttendancePolicy='daily'`, GENERIC `'period'`, via archetype defaults (canonical `tenant-locale-defaults.ts` + identity duplicate + seeder `tenant-seeder-lambda.ts:347`). | archetype-default unit test; **no country branch** (`check-no-country-branch.sh`). | controlplane (seeder) + identity ECR (locale-defaults deploy row) |
| **S2.T5** | academics `AttendancePolicyResolverService`: reads school config via **HTTP `getSchoolConfiguration`** (widen its inline return type to surface `attendancePolicy`); `effective = school.attendancePolicy ?? tenantDefault`; cached. Register in module-wiring spec. | `attendance-policy-resolver.spec.ts` (override wins; tenant fallback; graceful degrade → `period`). | academics ECR (**no IAM change**) |
| **S2.T6** | academics `GET /academics/attendance/policy?schoolId=` → `{ effective, source }`. | controller spec; `lint:routes`. | controller + `tenant-api-prod.json` |
| **S2.T7** | FE: `attendancePolicy` selector in `school-configuration.tsx` (Daily / Section / Both); shows inherited default when unset. | vitest + `dev:shell` render-path smoke. | frontend repo |

---

### Sprint 3 — Thin Class / Homeroom roster (reuse what exists)

**Goal:** the daily roster unit exists + is populated, reusing
`Enrollment.sectionId`/`homeroomTeacherId`. **Demo:** create "Grade 9 A" + class
teacher; assign students; `GET /academics/classes/:id/roster` returns them via
GSI1 (no new index); existing students backfilled.

| Ticket | Work | Validation | Deploy/registration |
|---|---|---|---|
| **S3.T1** | **Verify + decide membership:** confirm whether `Enrollment.sectionId` (L52) is the homeroom pointer or overloaded for course sections; record the decision (reuse `sectionId` vs add `Enrollment.classId`). | written decision + a probe test against dev data. | none (investigation) |
| **S3.T2** | `Class` definition entity (`CLASS#{classId}`: gradeLevel, sectionLabel, classTeacherId, school, year, isActive) + factory + mapper (omit `isActive` in response). | `class.entity.spec.ts` key templates. | academics-only (no GSI if reusing GSI1) |
| **S3.T3** | shared-types: `Class` create/update/response Zod schemas. | build + type tests. | shared-types (ECS-only) + pin bumps |
| **S3.T4** | `ClassModule` (service + controller): CRUD `/academics/classes`; **extend** module-wiring spec. | `classes.service.spec.ts` + controller spec; `lint:routes`. | controller + `tenant-api-prod.json` |
| **S3.T5** | Assign / bulk-assign students (writes `Enrollment.sectionId` + `homeroomTeacherId`); `GET /academics/classes/:id/roster` via **GSI1 grade query filtered by homeroom** (scope-filtered). | service spec (assign, roster, RBAC scope); confirm GSI1 sufficiency (else escalate to a GSI ticket). | controller + API-GW spec |
| **S3.T6** | **Idempotent backfill** `scripts/dev/backfill-classes.ts`: create `Class` rows + set enrollment homeroom from existing data; **resolve the section-label source first** (S3.T1) — if none exists, backfill creates one `Class` per (grade) and leaves assignment to the operator. `--dry-run`. | dry-run snapshot; idempotency test; non-prod run. | dev tooling; non-prod first |
| **S3.T7** | FE: minimal class management (create class, assign students). | vitest + `dev:shell` smoke. | frontend repo |

---

### Sprint 4 — Daily (school-day) attendance workflow, policy-honored (the coverage fix)

**Goal:** a class teacher takes one daily roll-call → full-roster `SCH_ATTEND`
coverage; policy now **branches** behavior. **Demo:** in a `daily` school, open
"Grade 9 A", mark 2 absentees, save → 30 `SCH_ATTEND` rows (`derivedFrom:'direct'`,
28 present/2 absent) + `ClassAttendanceTaken`; `/summary` shows ~93% on real
coverage. A `period` school is byte-unchanged.

| Ticket | Work | Validation | Deploy/registration |
|---|---|---|---|
| **S4.T1** | `POST /academics/attendance/daily/bulk` — roster-scoped (classId). **Roster expansion:** fetch the class roster, write `SCH_ATTEND` (`derivedFrom:'direct'`, `classId`) for **every** student, defaulting unmarked → present (A1) and writing present events; **populate Ed-Fi descriptors** (`attendanceEventCategory`/`Reason`) at write time. | `attendance.service.daily.spec.ts`: full-roster write; negative-marking default; descriptors set; idempotent re-save (optimistic lock). | controller + `tenant-api-prod.json` |
| **S4.T2** | `ClassAttendanceTaken` entity + marker upsert on daily save (mirrors `SectionAttendanceTaken`; **mark non-Ed-Fi** in code comment). | entity + service spec. | academics (GSI overload, no new index) |
| **S4.T3** | **Roster-diff-on-resave semantics:** define + implement what happens when the roster changed mid-day (student added/removed after first roll-call) — re-save reconciles without clobbering manual marks. | spec covering add/remove/re-save. | academics ECR |
| **S4.T4** | **Policy honoring (write):** inject resolver — `daily` ⇒ school-day authoritative, section writes optional, **derivation suppressed**; `period` ⇒ unchanged; `both` ⇒ direct daily wins (extends S1.T2 precedence). | `attendance-policy.write.spec.ts` across modes; **regression spec proves `period` path byte-unchanged**. | academics ECR |
| **S4.T5** | **Policy honoring (read):** `getDailyAttendanceSummary`/overview read the authoritative source per mode; class-completion vs section-completion surfaced per mode. | summary spec per mode; overview shape stable (snapshot). | academics ECR |
| **S4.T6** | **Class-teacher data scope (security):** add a `homeroom`/`class` scope type to `DataScopeService` so a class teacher can read/write only their roster. | `data-scope.service.spec.ts` + **negative test** (no cross-class write). | academics ECR |
| **S4.T7** | FE **Daily Entry by class**: when `effective∈{daily,both}` the Daily-Entry tab offers a **Class** roster selector + roll-call grid (reuse `AttendanceRow`, "absentees-only / default-present" fast path); `period` keeps `SectionSelector`. | vitest + Playwright happy-path + **render-path smoke**. | frontend repo |

---

### Sprint 5 — Honest trend/monthly/chronic via the existing calendar

**Goal:** averages + chronic flags become trustworthy + IEMIS-ready by **reusing**
the identity calendar. **Demo:** the 30-day trend + school average move to realistic
ranges; a month with 3 holidays computes on working days only; chronic list =
"absent ≥ 10% of instructional days to date".

| Ticket | Work | Validation | Deploy/registration |
|---|---|---|---|
| **S5.T1** | Consume the **existing** identity calendar in academics: use `getInstructionalDayCount` / `CalendarDate` range to exclude non-instructional days from **trend + averages** (per-day rate unchanged; non-instructional days dropped). | trend spec against a fixture month with holidays; response shape unchanged (snapshot). | academics ECR (HTTP, no new entity/IAM) |
| **S5.T2** | **`eventDuration`/half-day fidelity (G14):** count `half_day` as 0.5 in **both** numerator and denominator; pin **excused-absence** treatment for ADA (documented in code + this doc §10 Q1). | rate spec covering half-day + excused. | academics ECR |
| **S5.T3** | `MonthlyAttendanceRollup` entity + `GET /academics/attendance/monthly?schoolId=&month=` — working-day denominator, per-grade + per-class breakdown (IEMIS Flash-ready); BS month labels via shared-types. | rollup spec vs hand-computed fixture. | controller + API-GW spec; entity (GSI overload) |
| **S5.T4** | **Chronic absenteeism (G6):** per-student `absentInstructionalDays / instructionalDaysToDate ≥ threshold`; threshold becomes a tenant/archetype setting (A3); at-risk surfaced from the real denominator. | chronic-calc spec; alerts spec on real denominator. | academics ECR |
| **S5.T5** | FE: dashboard KPIs + at-risk bind to real rates; add a **monthly view** + **coverage% KPI**. | vitest; visual check on seeded data. | frontend repo |

---

### Sprint 6 — UX coherence: dashboard redesign + bounded TanStack alerts table

**Goal:** elegant, coherent, bounded; alerts is a first-class `DataTable`. **Demo:**
Overview presents a clear KPI hierarchy on real numbers; "Attendance Alerts" is a
paginated/sortable/filterable `@edforge/ui` `DataTable` with row → student
drill-down; no table renders more than `pageSize` rows.

| Ticket | Work | Validation | Deploy/registration |
|---|---|---|---|
| **S6.T1** | Add **server-side pagination** (limit/cursor) to `/academics/attendance/alerts` (the bulk-scan already produces the full sorted set; slice server-side). | pagination spec; backward-compatible default. | academics ECR |
| **S6.T2** | Replace `AlertsTableV2` with `@edforge/ui` `DataTable`: `createColumnHelper` columns, `getRowId=studentId`, `pages` pagination, faceted filter (grade/trend), skeleton. **Add attendance to `TANSTACK_TABLE_PLAN.md` inventory.** | vitest (renders ≤ pageSize); render-path smoke. | frontend repo |
| **S6.T3** | Dashboard information hierarchy: primary KPI band (coverage %, attendance rate, chronic count) → trend → breakdowns; drop/merge misleading hand-rolled charts; clear zero/empty states ("not taken yet today" ≠ "0%"). | Playwright visual snapshots; design-token check. | frontend repo |
| **S6.T4** | Alerts → student drill-down (reuse `useStudentAttendance`); chronic badge + reason; policy-aware empty states ("assign students to classes"). | vitest + Playwright. | frontend repo |
| **S6.T5** | a11y + responsive pass (keyboard roll-call grid, table semantics, status-pill contrast). | axe in Playwright; manual keyboard pass. | frontend repo |

---

## 8. Out of scope / explicitly deferred

- **Per-period attendance** (timetable + `ClassPeriod` + `classPeriods[]`) — V1.5.
- **Program** + **Intervention** attendance.
- **Ed-Fi API export** of attendance events (the `edfi-ts-models` projections) —
  follow-on feeding the IEMIS integration platform.
- **ADA/ADM funding** beyond the monthly rate rollup.
- **Discipline/incident absences** (Form-19 SOFT per prior CEO note).
- **Materialized daily rollups** beyond the monthly one (avoid premature
  optimization; the alerts bulk-scan already meets perf targets).

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **No `derivedFrom` tag on existing direct rows** → precedence protects nothing | **S1.T1 backfill is a hard prerequisite** for S1.T2/S4.T4; ordered first. |
| `both` mode double-counts (daily + derived) | S4.T4 precedence: direct daily authoritative; derivation suppressed/early-returns; spec asserts single authoritative row. |
| Policy-enum change breaks consumers (seeder/governance/AdminWeb/identity dup) | S2.T1 is one atomic enum-consumer ticket with the full list; CI `cdk-typecheck` + service build; publish if AdminWeb consumes. |
| Reused `Enrollment.sectionId` is actually a course-section pointer | S3.T1 verifies before building; fallback `Enrollment.classId` field. |
| New GSI needed for roster (slot-scarce, one-per-deploy) | Prefer GSI1 grade query + homeroom filter (S3.T5); only escalate to a dedicated one-per-deploy GSI ticket if GSI1 proves insufficient. |
| Denominator/coverage change alters historical numbers (operator surprise) | Frame as a correction; **response shape byte-identical** (snapshot gate on S4.T5/S5.T1); changelog + before/after demo on seeded data. |
| FE wrong-component edit (CLAUDE.md trap) | Render-path smoke gate on every FE ticket; route→component trace in §2.4. |
| Renaming event emitters breaks analytics aggregator | S1.T3 includes an explicit consumer-compatibility check. |

---

## 10. Open questions (non-blocking; defaults assumed)

1. **Numerator policy for ADA:** count `excused` and `late/tardy` as attending?
   (Assumed: present+late+remote+halfDay(0.5) = attending; excused in denominator,
   not numerator — matches today's code. **Confirm for IEMIS**, which may treat
   excused differently.)
2. **`both`-mode authoritative source for IEMIS monthly** (assumed: school-day/
   daily authoritative; sections feed per-subject analytics only).
3. **Homeroom section-label source** for the backfill (S3.T1/T6) — is
   `Enrollment.sectionId` populated today, and where does "A/B" come from?
4. **At-risk threshold owner** — tenant vs archetype vs per-school (assumed
   tenant/archetype; A3).
5. **Class-teacher → homeroom binding** — one teacher per class, or co-teachers?
   (Assumed one `classTeacherId`; co-teachers deferred.)

---

### Appendix A — Key evidence index (file:line)

- Coverage/rate math: `attendance.service.ts:853–930`
- Direct write path (untagged provenance): `attendance.service.ts:317–398` (`recordAttendance`), bulk `:463–567`
- **Bulk-scan alerts ALREADY shipped:** `attendance.service.ts:1139–1284`
- Derivation worst-status-wins: `common/services/school-attendance-derivation.service.ts`
- Inert policy: `workspace-settings.entity.ts:59–61`, `tenant-seeder-lambda.ts:347`, `field-governance.ts`
- Per-school config: `department.entity.ts:62` (`attendanceRequired`)
- **Homeroom fields already on enrollment:** `enrollment.entity.ts:52–53` (`sectionId`, `homeroomTeacherId`); roster GSI1SK `:163` (`ENROLLMENT#{year}#{grade}`)
- **HTTP cross-service accessors:** `identity-client.service.ts:935` (`getSchoolConfiguration`), `:962` (`getCalendarDate`)
- **Calendar exists/consumed:** `validateInstructionalDay` (`attendance.service.ts:1645+`), identity `CalendarDate` entity + range route + `getInstructionalDayCount`
- **Module-wiring spec EXISTS:** `academics/src/__tests__/module-wiring.spec.ts:35–39`
- GSI scarcity / one-per-deploy: `ecs-dynamodb.ts:104–108`
- FE render path (`@ edforge-saas-frontend 0e6c7d0`): `routes/classrooms/index.tsx` → `routes/attendance/index.tsx` → `routes/attendance/dashboard.tsx` (`AlertsTableV2`) / `components/attendance/AttendanceGrid.tsx`; shared table `@edforge/ui packages/ui/src/components/data-table`; `TANSTACK_TABLE_PLAN.md` (attendance absent)
