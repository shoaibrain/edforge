# School A — Phase 1 code map (attendance readiness)

**Date:** 2026-10-26 · **Scope:** daily attendance only. Billing, assignments and
grades are out of scope except where they gate attendance.
**Method:** static read of both repos. Every UI claim below was traced
URL → shell router → MFE router → tab conditional → JSX tag, per the
route→component rule in `CLAUDE.md`. No app or database was touched.

---

## 1. Deployed version — NOT ESTABLISHED in this session

This is an open item, not a finding. I could not determine the deployed commit
from the container: there are no AWS credentials, no `server/.env.<profile>`, no
`.claude/local-context.md`, and the services expose no version endpoint
(`identity` has `GET /auth/health` only; no `/version` anywhere).

What is known:

| Fact | Value |
|---|---|
| Backend `origin/main` HEAD | `fcc2629` (2026-09-25) |
| Frontend `origin/main` HEAD | `7200171` (2026-09-24) |
| Last entry in `docs/deploys/INDEX.md` | **2026-09-22** (PR #492, school-read scoping) |
| Backend commits merged after that entry | **40** (PRs #508–#522, the `lili-50x` batch) |
| Frontend commits merged after that entry | **15** (PRs #369–#378) |

So there is a **≤55-commit window between the last recorded deploy and `main`**
whose deploy status is unrecorded. The deploy ladder stamps the source SHA into
the stack as `CDK_PARAM_COMMIT_ID` (`scripts/deploy.sh:176`), so the deployed
revision is recoverable — it is just not recoverable from here.

**To resolve (Shoaib, before Phase 2 conclusions are trusted):** read the
`CommitId` output on `tenant-template-stack-basic`, or check the newest filename
in `$EDFORGE_DEPLOY_LOG_DIR` / `/tmp/edforge-deploys`
(`deploy-<profile>-<stack>-<ts>-<sha>.log`). None of the 55 commits touch
attendance code, so the Phase 1 map below holds either way; the window matters
for the finance/guardian fixes in that batch, not for attendance.

---

## 2. Layer map

"Edit in UI" = can an operator create / edit / delete this through a screen that
is actually routed, without an API call.

| Layer | Screen (traced route) | Edit supported in UI | Blocking gaps for attendance |
|---|---|---|---|
| **Tenant / school setup** | `/settings/organization` → `SchoolDetailPage`, 6 tabs; `/settings/organization/schools/new` → 5-step wizard | **Full** — create, edit, activate, delete (typed confirm) | None. School `status='setup'` does **not** block attendance — no status gate exists in academics. |
| **Roles & logins** | `/settings/access` → `people.tsx` (global role, enable/disable/suspend/delete); `/settings/security-policies` → `rbac-security.tsx` + `AssignUserModal` (school + role) | **Create/edit yes; recovery NO** | **B1 — no resend-invite and no admin password reset.** See §3. |
| **Academic year & terms** | `/settings/organization/schools/$schoolId?tab=academic-setup` → `tabs/AcademicSetupTab.tsx` (4-step: years → sessions/terms → calendar → bell) | **Full** — create/edit AY, **Set-as-Current**, create 4 terms, bell schedules | **B2 — a current AY is a hard gate.** See §3. |
| **School calendar (working days, holidays)** | same tab, step 3 — `useGenerateCalendar`, per-date edit, `BlocksPanel` (multi-day: Dashain, vacations), holiday catalogue `GET /schools/:id/holidays` | **Full** — generate, bulk-update, per-date edit, multi-day blocks | **B3 — missing calendar silently fails open.** See §3. |
| **Grade levels** | `?tab=grade-levels` → `tabs/GradeLevelsTab.tsx` (writes `School.enabledGradeLevels`); also `/academics/curriculum?tab=grade-levels` | **Full** — toggle + Save, zero-selection blocked | None. |
| **Sections** | `/academics/classrooms` → `ClassroomsModule`; `/create` → `SectionCreatePage`; `/$sectionId/edit` → `SectionEditPage` | **Full** — create, edit, delete | None. |
| **Staff / teachers** | `/people/staff`, `/people/staff/new` → `StaffNewPage`, `/people/new`; `/academics/teachers` → `TeachersModule` | **Create/edit in `people` MFE. `/academics/teachers` is READ-ONLY** (0 mutations, directory + drawer) | None, but see N1 — the academics "Teachers" screen looks editable and is not. |
| **Teacher → section assignment** | `SectionCreatePage` / `SectionEditPage` — `primaryTeacherId` + `coTeacherIds` | **Full** | None. |
| **Students** | `/academics/students` → `StudentsModule` (delete); `/academics/students/enrollment` → 6-step wizard; `/academics/students/$studentId` → 5 tabs; `/academics/students/import/iemis` → bulk import | **Full** — create, edit, delete, bulk import | None. |
| **Student → section assignment** | `/academics/sections/$sectionId/roster` → `SectionRosterPage` (add/remove, capacity bar); `/academics/rostering` → `BulkRosteringPage` (student×section matrix, period-conflict detection); student profile → `AddToSectionModal` | **Full — three separate surfaces.** Reassign = remove + add | **B4 — enrolment does NOT assign a section.** See §3. |
| **Parent / guardian contacts** | registration wizard `GuardiansStep`; profile `?tab=family` → `FamilyTab` + `AddGuardianModal` / `EditGuardianModal` / `FamilyGroupPanel` | **Full** — add, edit, link, grant portal access | None for attendance. |
| **Attendance — policy** | `?tab=attendance` → `tabs/AttendancePolicyTab.tsx` | **TenantAdmin only** — mode `daily_presence` (PABSON default) / per-period | None. |
| **Attendance — taking** | `/academics/attendance` **→ redirects to** `/academics/classrooms?tab=attendance` → `<AttendanceModule />` → `RecordingDrawer` → `AttendanceGrid` | **Full** — per-section marking, mark-all, live tally, reason/note, offline-resilient save | **B2, B3** gate this. |
| **Attendance — edit after submit** | same drawer, `mode='recorded'` → `handleCorrection` → `PATCH .../:date/:sectionId/:studentId` | **Yes** — per-row correction, no time limit in code | None. |
| **Attendance — reports** | `AttendanceModule`: coverage banner, `SectionsToRecord`, `AtRiskPanel` (+CSV), `PatternsRail`, `TrendPanel` (30-day), `IemisExportDialog` | **Read + CSV / IEMiS Flash II export** | **B5 — Principal cannot see the export button.** See §3. Also N2: no per-student attendance tab. |

### Backend surface (for reference)

`academics` exposes two attendance controllers, both `JwtAuthGuard` +
`PermissionGuard`:

- `academics/section-attendance` — POST, POST `/bulk`, GET, GET `/student/:id`,
  PATCH `/:date/:sectionId/:studentId`. **The teacher's primary entry point.**
- `academics/attendance` — `/policy`, `/presence-locks`, `/summary`, `/overview`,
  `/trend`, `/alerts`, `/student-trends`, `/student/:id`, `/student/:id/summary`,
  POST `/iemis-export`, PATCH `/:date/:studentId`.

Backend permission matrix (`permission-matrix.spec.ts.snap`) — Teacher holds
`attendance:view/create/edit`, `scheduling:view` (sections + roster) and
`students:view`. **A teacher has everything needed to take attendance.**
Accountant holds no attendance permission at all. `TenantAdmin` bypasses the
guard entirely.

---

## 3. Blocking gaps

Ranked. B2 and B3 are the two that decide whether School A can start.

### B1 — No way to recover a teacher login *(blocks attendance if any teacher is locked out)*

`POST /users` creates the Cognito user with an operator-supplied
`temporaryPassword` (`users.service.ts:130`). There is **no resend-invite and no
admin password reset**:

- `people.tsx:450` — "The earlier `Re-invite` placeholder was dropped — its
  backend slice (#235) isn't built."
- `security.controller.ts` exposes only self-service `POST /security/change-password`
  (needs the current password).
- `AdminSetUserPasswordCommand` is **imported but never called** in
  `security.service.ts:19` — dead import, no endpoint behind it.
- The only recovery is `/forgot-password` → `ForgotPasswordPage.tsx`, which calls
  Cognito directly via Amplify v6, bypassing the backend.

**Why this bites:** Cognito's `ForgotPassword` fails for a user still in
`FORCE_CHANGE_PASSWORD` — i.e. one who never completed first login. If a
teacher's temporary password expired before they signed in once, they are locked
out and **no in-product operator action can fix it**. Recovery needs AWS console
or CLI access. Verify in Phase 2 how many teacher accounts have never logged in.

### B2 — No current academic year blocks the attendance screen outright *(hard gate)*

`AttendanceModule` gates on `useCurrentAcademicYear(schoolId)` before rendering
anything; without `currentYear.yearId` it renders
`NoCurrentAcademicYearEmptyState` — "Set up an academic year in school settings
before recording attendance." No section list, no drawer, no recording.

The condition is `isCurrent === true`, which is **orthogonal to
`status === 'active'`**. A school can hold an active AY and still be gated —
that exact drift shipped once before (Sprint 2 / PR #100) and is why
`current_academic_year` became its own activation requirement.
`AcademicSetupTab` has the recovery path: it computes
`years.find(y => y.status === 'active' && y.isCurrent !== true)` and offers
**Set as Current**.

**Phase 2 check:** exactly one AY with `isCurrent === true`.

### B3 — Missing generated calendar fails open and corrupts the IEMiS denominator *(silent)*

`RecordingDrawer` computes
`isNonInstructional = calendarDate != null && !calendarDate.isInstructionalDay`.
When no calendar row exists for the date, `calendarDate` is `null`, so the day is
treated as instructional and the grid stays enabled. `activation-requirements.ts`
names this directly: without `generate-calendar` having run, "attendance falls
through to graceful-degradation 'no calendar means allow everything' mode."

**Why this bites:** attendance will appear to work perfectly while Saturdays,
Dashain and every holiday are recorded as school days. Nothing warns anyone. The
error surfaces months later in the IEMiS Flash II present/absent day counts,
after the bad data is already in DynamoDB.

The inverse also blocks: a calendar generated with the wrong weekend (PABSON is
**Sun–Fri**, so Saturday is the only weekend day) marks real teaching days
non-instructional and **disables the grid** with "cannot submit".

**Phase 2 check:** calendar generated for the current AY; spot-check that a
normal Sunday is instructional and Saturday is not.

### B4 — Enrolling a student does not place them in a section

The 6-step enrolment wizard (`PersonalInfo → ContactInfo → Guardians → Medical →
Enrollment → Review`) has no class-section field — the "sections" in
`EnrollmentStep.tsx` are collapsible UI panels. Section placement is a separate
act on one of three surfaces (roster page, bulk rostering matrix, or
`AddToSectionModal`).

Attendance is taken **per section**. A student who is enrolled but unrostered
appears in no attendance roster and is silently absent from every count — not
marked absent, simply not present in the denominator.

Not a code defect — the capability exists and is reachable three ways. It is an
operational trap: every newly enrolled student needs a second, separate step.
**Phase 2 check:** count enrolled-but-unrostered students per grade.

Related: attendance rosters only include enrolments with
`status === 'enrolled' || 'active'` (`attendance.service.ts:1157,1485,1569`). Any
other status drops the student from the roster.

### B5 — Principals cannot reach the IEMiS export button (frontend/backend ABAC drift)

The frontend ABAC table and the backend matrix disagree on `attendance:export`:

| Role | Backend (`permission-matrix.spec.ts.snap`) | Frontend (`packages/abac/src/permissions.ts`) |
|---|---|---|
| Principal | `attendance:export` ✓ | **absent** — `['view','create','edit','manage']` |
| VicePrincipal | `attendance:export` ✓ | **absent** — `['view','create','edit','manage']` |
| TenantAdmin | bypasses guard | all actions (`engine.ts:83`) |

`AttendanceModule` renders the export dialog only when
`canExport = usePermission('export','attendance')`. For a Principal or VP that is
`false`, so the IEMiS Flash II export **and its dialog are hidden**, though the
backend would authorise the call. Only a TenantAdmin sees it.

Does not block daily attendance. Does block a Principal doing the government
export themselves — relevant if School A's Principal, not Shoaib, is meant to
file Flash II. One-line fix: add `'export'` to both roles' `attendance` arrays.

---

## 4. Non-blocking findings

- **N1 — `/academics/teachers` is a read-only directory.** No create/edit/delete
  (0 mutations). Staff are created in the `people` MFE. An operator who starts at
  the academics "Teachers" screen will conclude they cannot add a teacher.
- **N2 — no per-student attendance history in the student profile.** Live tabs
  are `overview | profile | enrollment | family | demographics`. `ScheduleTab.tsx`
  exists but is not in the tab union — likely orphaned. Backend has
  `GET /attendance/student/:id` and `/summary`; the only UI path to one student's
  attendance is the drill-down modal inside `AtRiskPanel`, i.e. only for students
  already flagged at-risk. A parent asking "which days did my child miss?" cannot
  be answered from the profile.
- **N3 — attendance permission is school-scoped, not section-scoped.**
  `PermissionGuard` resolves `schoolId` only; no section check anywhere in either
  attendance controller. Any Teacher at School A can record and correct attendance
  for **any** section at that school, not only their own. `SectionsToRecord` is
  likewise fed by `useSections({ schoolId })` with no `teacherId` filter. The
  `isSchoolWide` flag (`usePermission('manage','attendance')`, false for Teacher)
  is only a display label — the comment in `index.tsx` says the aggregate is
  "server-scoped", but the guard does not scope by section. Fine for a 13-grade
  pilot; worth knowing before anyone calls it least-privilege.
- **N4 — `attendance:delete` exists in the backend matrix (Principal/VP) with no
  UI.** Corrections go through PATCH. Nothing deletes an attendance record.

---

## 5. Route traces (evidence)

Recorded so the next reader can re-verify rather than trust a file name — the
trap `CLAUDE.md` calls out, and one this session hit once (`school-academic-years.tsx`
is *not* the live academic-setup screen; `tabs/AcademicSetupTab.tsx` is).

```
Take attendance
  /academics/attendance
    → apps/academics/src/router.tsx:248  attendanceRedirectRoute
      beforeLoad → redirect({ to: '/classrooms', search: { tab: 'attendance' }})
    → /academics/classrooms?tab=attendance
    → routes/classrooms/index.tsx:874    activeTab = search.tab
    → routes/classrooms/index.tsx:1060   {activeTab === 'attendance' && (
    → routes/classrooms/index.tsx:1062     <AttendanceModule />        ← JSX confirmed
    → routes/attendance/index.tsx:57     AttendanceModule (current-AY gate)
    → routes/attendance/index.tsx:289      <RecordingDrawer />         ← JSX confirmed
    → components/attendance/dashboard/RecordingDrawer.tsx:213 <AttendanceGrid />

Academic year / calendar / attendance policy
  /settings/organization/schools/$schoolId?tab=<...>
    → apps/shell/src/router.tsx:600      settingsOrgSchoolDetailRoute → SchoolDetailPage
    → pages/settings/school-detail.tsx:128  SchoolTab union (6 tabs)
    → pages/settings/school-detail.tsx:42-47 tabs/{AcademicSetup,AttendancePolicy,GradeLevels,Structure,Configuration,AuditLog}Tab
    NOT pages/settings/school-academic-years.tsx  ← name-collision trap, not rendered

Readiness checklist (the app's own gate)
  GET /schools/:id/activation-requirements
    → packages/shared-types/src/archetype/activation-requirements.ts
    → PABSON: academic_year_active, current_academic_year, grading_periods(4),
              bell_schedule, calendar_generated
    → GENERIC: academic_year_active, current_academic_year
```

---

## 6. Phase 2 checklist derived from this map

Ordered so a failure stops the walk early:

1. **Deployed commit** — stack `CommitId` output vs `fcc2629` / `7200171` (§1).
2. **Activation requirements** — open `?tab=academic-setup`; the banner renders
   the backend's own checklist. Record which of the 5 PABSON rows are unmet.
3. **Exactly one AY with `isCurrent=true`** (B2) — else attendance screen is dead.
4. **Calendar generated for that AY; Sunday instructional, Saturday not** (B3).
5. **13 grade levels enabled**; sections per grade; `primaryTeacherId` set per section.
6. **Teacher accounts**: count, never-logged-in count (B1), school-scoped role
   assignment present.
7. **Enrolled-but-unrostered students per grade** (B4); enrolment statuses other
   than `enrolled`/`active`.
8. **Guardian + phone coverage** per grade.
9. **Attendance already taken?** Open the drawer on one section; confirm the grid
   is enabled and a correction is offered on an already-recorded section.
10. **Export visibility** — confirm whether the login used is TenantAdmin
    (export visible) or Principal (hidden, B5).
