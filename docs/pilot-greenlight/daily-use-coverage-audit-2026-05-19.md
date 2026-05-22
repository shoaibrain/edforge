# Daily-Use Coverage Audit — 2026-05-19

> **Audit scope:** academics + identity microservices, with eye toward the fraction of Saraswati's daily K-12 operations that runs end-to-end (operator → backend → audit/event) on EdForge as of 2026-05-19.
> **Reviewer:** read-only audit. No code or tests modified.
> **Companion docs:** [`sprint-plan-update-2026-05-19.md`](./sprint-plan-update-2026-05-19.md), [`sprint-plan.md`](./sprint-plan.md) §4 invariants, [`docs/pilots/pabson-saraswati-bs-2083/dossier.md`](../pilots/pabson-saraswati-bs-2083/dossier.md), [`deferred-work.md`](./deferred-work.md).

---

## TL;DR

- **Modules audited:** 9 (classwork, grades, courses, course-offerings, dashboard, sections, section-attendance, attendance, enrollment) + targeted searches for discipline / time-table / period-schedule / substitute / mid-year-transfer.
- 🟢 **operator-ready (full path):** enrollment, section-attendance, attendance, sections (CRUD + roster), courses, course-offerings, grades+grading-policies, classwork.
- 🟡 **partial (operator gaps):** dashboard (only shows enrollment + active sections + today's attendance — no daily-activity surfaces like "yesterday's classwork posts" or "grades-recorded-today"), section-attendance (per-section-per-day, no `classPeriodId` link), courses+course-offerings (no event emission on `course-offering` writes), sections (no UI for co-teacher assignment, despite entity field), enrollment events (legacy PascalCase, not in registry).
- 🔴 **not operator-ready (absent):** **time-table / period-schedule mapping** (the daily "Mon Period 1 = 8A Math") — `ClassPeriod` entity exists in identity, `Section.classPeriodId` is optional on entity, no service maps a section to multiple `(dayOfWeek, periodId)` slots; **discipline / behavior / incident tracking** — no module, no entity, no route; **substitute-teacher workflow** — `Schedule.substituteTeacherId` is a field on a dead entity (no service uses `Schedule`); **mid-year inter-section transfer** (within a school) — only inter-school `transfer` endpoint exists in enrollment.
- **Daily-use coverage estimate:** **~55%** of a typical Saraswati teacher/principal/admin's daily operation is operator-ready end-to-end. The remaining 45% is split between (a) the time-table gap (every teacher in a multi-period school looks at "my day" — currently no surface), (b) the dashboard daily-activity surface, and (c) discipline (low frequency but legally important for IEMIS).

---

## Top gaps for daily use (ranked by operator-impact × frequency)

| Rank | Gap | Module | Operator impact | Fix size estimate |
|---|---|---|---|---|
| 1 | **Time-table / period-schedule** (Mon Period 1 = 8A Math taught by teacher X). No entity maps `(section, dayOfWeek, periodId, teacherId)`. Teachers can't see "my day." Section-attendance can't enforce "is this section meeting in this period today?" | identity + academics + new module | **HIGH** — every teacher every morning; every attendance-taking event; every "did class happen?" question | **LARGE** — 2–3 sprints (new `Timetable` entity + endpoints + UI grid + period-resolver integration) |
| 2 | **Dashboard daily-activity surfaces** — principal opens dashboard at 8 AM; only sees enrollment count + sections count + today's attendance. Misses: classwork posted today, grades recorded yesterday, section-attendance taken % by section, incident count today. | `dashboard/` | **HIGH** — principal's first action of the day | **SMALL** — 1 sprint (extend `DashboardService.getOverview` + DTO + UI cards) |
| 3 | **Discipline / behavior / incident tracking** — no module exists. IEMIS Form 19 requires `disciplinaryReports` count; no entity to count from. Class teacher's "log this incident" daily action has no surface. | new module | **MEDIUM** — low frequency (most days no incident) but IEMIS-reporting-blocking + audit-trail-critical | **MEDIUM** — 1 sprint (Ed-Fi-aligned `DisciplineIncident` + `StudentDisciplineIncidentAssociation` entities + minimal CRUD + dashboard count) |
| 4 | **Substitute-teacher workflow** — `Schedule.substituteTeacherId` is a field on the dead `Schedule` entity ([`academics/src/common/entities/schedule.entity.ts:38`](../../server/application/microservices/academics/src/common/entities/schedule.entity.ts#L38)) but no service uses it; no controller; no event. Admin's "assign Mr. X as sub for Ms. Y today" has no surface. | new (depends on #1) | **MEDIUM** — daily for boarding schools; HIGH on the day a teacher is sick | **MEDIUM** — depends on timetable; ~1 sprint after timetable |
| 5 | **Dashboard does NOT count classwork/grades** — `DashboardService` only joins enrollment + sections + attendance. Classwork and Grades are emitted to events but never aggregated for the principal view. | `dashboard/` | **MEDIUM** — daily principal "is my school actually teaching" check | **SMALL** — extend dashboard byCourse/byTeacher views |
| 6 | **`course-offering` writes emit no events** — `CourseOfferingService.create/update/delete` does NOT call `eventsService.publishXxx` ([`course-offering.service.ts` — search shows zero `publish*` calls](../../server/application/microservices/academics/src/courses/course-offering.service.ts)). Violates invariant 6. Operator-impact is moderate (this is an admin-config event, not daily) but it's an architectural debt that grows with every new consumer. | `courses/` | **LOW** but violates §4 invariant 6 | **TINY** — ~30 LOC + 3 event-shape tests |
| 7 | **All academics events use legacy PascalCase** (`AttendanceRecorded`, `SectionAttendanceRecorded`, `GradeRecorded`, `ClassworkItemCreated`, `EnrollmentCompleted`, `StudentWithdrawn`, etc.) — NOT in the 25-event registry at [`packages/shared-types/src/events/taxonomy.ts:76-111`](../../packages/shared-types/src/events/taxonomy.ts#L76-L111). The registry has `attendance.recorded` + `attendance.updated` slots reserved but unused. Violates invariant 6 silently — events still flow but with no Zod validation. **This is the PascalCase→snake-dotted migration** deferred in [`deferred-work.md`](./deferred-work.md). | cross-cutting | **LOW** (events still flow) but blocks event-log + analytics work | **MEDIUM** — piecewise migration; needs Sprint C8 read-side groundwork |
| 8 | **No academics `module-wiring.spec.ts`** — identity has one ([`identity/src/__tests__/module-wiring.spec.ts`](../../server/application/microservices/identity/src/__tests__/module-wiring.spec.ts)), academics does NOT. The memory `feedback_module_wiring_invariant` says this trap "twice took prod down." | `academics/` (new file) | **LOW frequency / HIGH severity** — the next new academics module is one trap away from a crash-loop | **TINY** — ~150 LOC mirroring the identity spec |
| 9 | **Sections — co-teacher assignment has no UI** — entity has `coTeacherIds?: string[]` ([`course.entity.ts:149`](../../server/application/microservices/academics/src/common/entities/course.entity.ts#L149)) but `SectionForm.tsx` (frontend) only exposes `primaryTeacherId`. PABSON schools often co-teach. | sections frontend | **LOW** for Saraswati (need to confirm); MEDIUM long-term | **SMALL** — add multi-select to form + service write |
| 10 | **Mid-year inter-section transfer** — only inter-school `transfer` exists (`POST /academics/schools/.../transfer`). Common in-school operation "move 3 students from 8A to 8B mid-term" has no first-class endpoint; operator workaround is drop-from-A + add-to-B which loses audit trail of the "transfer" intent. | `sections/` | **LOW–MEDIUM** | **SMALL** — `POST /sections/:id/transfer` wrapping drop+add + atomic event |

---

## Per-module findings

### Classwork (`microservices/academics/src/classwork/`)
**Verdict:** 🟢 operator-ready

- **Entities:**
  - `ClassworkItem` ([`classwork.entity.ts:61-97`](../../server/application/microservices/academics/src/common/entities/classwork.entity.ts#L61-L97)) — itemId, sectionId, schoolId, type (`assignment|quiz|material|question`), title, topicId, sortOrder, assessmentCategory, possiblePoints, dueDate, status (`draft|published|scheduled`). GSI1 = `TENANT#tid#SCHOOL#schoolId` / `CLASSWORK#sectionId#itemId`.
  - `ClassworkTopic` ([`classwork.entity.ts:102-117`](../../server/application/microservices/academics/src/common/entities/classwork.entity.ts#L102-L117)) — organizational grouping. Same GSI1 pattern.
- **Endpoints** ([`classwork.controller.ts:38`](../../server/application/microservices/academics/src/classwork/classwork.controller.ts#L38) — `@Controller('academics/classwork')`):
  - `@Get()` ([line 53](../../server/application/microservices/academics/src/classwork/classwork.controller.ts#L53)) — list items+topics for section, `scheduling:view`
  - `@Post()` ([line 80](../../server/application/microservices/academics/src/classwork/classwork.controller.ts#L80)) — create item, `scheduling:create`
  - `@Patch('reorder')` ([line 149](../../server/application/microservices/academics/src/classwork/classwork.controller.ts#L149)) — reorder, `scheduling:edit`
  - `@Patch(':itemId')` ([line 183](../../server/application/microservices/academics/src/classwork/classwork.controller.ts#L183)) — update, `scheduling:edit`
  - `@Delete(':itemId')` ([line 238](../../server/application/microservices/academics/src/classwork/classwork.controller.ts#L238)) — delete, `scheduling:edit`
  - `@Post('topics')` ([line 270](../../server/application/microservices/academics/src/classwork/classwork.controller.ts#L270)) / `@Patch('topics/:topicId')` ([line 301](../../server/application/microservices/academics/src/classwork/classwork.controller.ts#L301)) / `@Delete('topics/:topicId')` ([line 335](../../server/application/microservices/academics/src/classwork/classwork.controller.ts#L335))
- **Three-way handoff:**
  - API GW: ✅ `/academics/classwork`, `/academics/classwork/{itemId}`, `/academics/classwork/topics`, `/academics/classwork/topics/{topicId}`, `/academics/classwork/reorder` all in [`tenant-api-prod.json`](../../server/lib/tenant-api-prod.json).
  - nginx: ✅ covered by `location ~ ^/academics` block at [`nginx.template:199`](../../server/application/reverseproxy/nginx.template#L199).
- **Frontend:** ✅ full UI — hooks at [`edforge-saas-frontend/apps/academics/src/hooks/useClasswork.ts`](../../edforge-saas-frontend/apps/academics/src/hooks/useClasswork.ts); components `ClassworkCreateMenu`, `ClassworkDrawer`, `ClassworkFeed`, `ClassworkItemCard`, `TopicSection` in [`apps/academics/src/components/classrooms/classwork/`](../../edforge-saas-frontend/apps/academics/src/components/classrooms/classwork/).
- **Audit + event coverage:** writes use direct `dynamoDb.putItem` / `updateItem` / `deleteItem` (academics has no `auditedWrite` infra — that lives only in identity). Events DO emit but as **legacy PascalCase**: `ClassworkItemCreated`, `ClassworkItemUpdated`, `ClassworkItemDeleted`, `ClassworkTopicCreated`, `ClassworkTopicUpdated`, `ClassworkTopicDeleted` ([`academics-events.service.ts:642-734`](../../server/application/microservices/academics/src/common/services/academics-events.service.ts#L642-L734)). **None registered in the 25-event taxonomy.**
- **Operator workflow:** teacher visits Section → "Classwork" tab → creates assignment with due date + points → publishes → students/parents see it (frontend portal already exists per memory `feedback_pr_first_no_more_uat`). End-to-end works. ✅
- **Module-wiring:** ✅ `ClassworkModule` imported in [`academics.module.ts:24,46`](../../server/application/microservices/academics/src/academics.module.ts#L24).
- **Gap:** none operator-facing. Only architectural debt is the PascalCase event taxonomy and the absent academics-wide `auditedWrite`.

### Grades (`microservices/academics/src/grades/`)
**Verdict:** 🟡 partial (operator-functional but reporting gap)

- **Entities:**
  - `Grade` ([`grade.entity.ts:27-75`](../../server/application/microservices/academics/src/common/entities/grade.entity.ts#L27-L75)) — gradeId, studentId, courseId, termId, teacherId, academicYearId, numericGrade, letterGrade, gpaPoints, credits, categoryGrades[], assignments[], isFinal, conductGrade, effortGrade. **GSI1** = school-scoped `GRADE#courseId#termId`; **GSI2** = student-scoped `GRADE#yearId#termId`. Composite SK = `GRADE#{studentId}#{courseId}#{termId}` — one row per (student, course, term) (Ed-Fi `StudentSectionGrade` shape).
  - `AssignmentGrade` ([`grade.entity.ts:95+`](../../server/application/microservices/academics/src/common/entities/grade.entity.ts#L95)) — embedded array on Grade, links to `ClassworkItem.assignmentId`. Bridge between classwork and grades is documented in classwork entity header comment ([`classwork.entity.ts:7`](../../server/application/microservices/academics/src/common/entities/classwork.entity.ts#L7)).
  - `GradingPolicy` (separate controller) — per-school/per-course weighting policy.
- **Endpoints** (`@Controller('academics/grades')` at [`grades.controller.ts:35`](../../server/application/microservices/academics/src/grades/grades.controller.ts#L35)):
  - `@Post('record')` — record single AssignmentGrade ([line 46](../../server/application/microservices/academics/src/grades/grades.controller.ts#L46)), `grades:create`
  - `@Post('record/bulk')` — bulk record ([line 63](../../server/application/microservices/academics/src/grades/grades.controller.ts#L63))
  - `@Get()` — get one ([line 80](../../server/application/microservices/academics/src/grades/grades.controller.ts#L80))
  - `@Get('overview')` — school+AY aggregate ([line 100](../../server/application/microservices/academics/src/grades/grades.controller.ts#L100))
  - `@Get('section/:sectionId')` — gradebook for section ([line 121](../../server/application/microservices/academics/src/grades/grades.controller.ts#L121))
  - `@Post('finalize/bulk')` — bulk finalize ([line 140](../../server/application/microservices/academics/src/grades/grades.controller.ts#L140))
  - `@Patch(':gradeId/finalize')` — finalize single ([line 172](../../server/application/microservices/academics/src/grades/grades.controller.ts#L172))
  - GradingPolicy (`@Controller('academics/grading-policies')` at [`grading-policy.controller.ts:31`](../../server/application/microservices/academics/src/grades/grading-policy.controller.ts#L31)): POST, GET, GET/:id, PATCH/:id.
- **Three-way handoff:** ✅ all of `/academics/grades`, `/academics/grades/overview`, `/academics/grades/record`, `/academics/grades/record/bulk`, `/academics/grades/finalize/bulk`, `/academics/grades/{gradeId}/finalize`, `/academics/grades/section/{sectionId}`, `/academics/grading-policies`, `/academics/grading-policies/{id}` in [`tenant-api-prod.json`](../../server/lib/tenant-api-prod.json). nginx ✅ via `/academics` prefix.
- **Frontend:** ✅ full UI — [`apps/academics/src/components/grades/`](../../edforge-saas-frontend/apps/academics/src/components/grades/) (`AssignmentEditor`, `BulkGradeModal`, `FinalizationWizard`, `GradebookGrid`, `GradingPolicyList`, `StudentGradesView`); hooks `useGrades.ts`, store `grades.store.ts`.
- **Audit + event coverage:** legacy PascalCase events `GradeRecorded` ([line 420](../../server/application/microservices/academics/src/grades/grades.service.ts#L420)), `GradeBulkRecorded` ([line 506](../../server/application/microservices/academics/src/grades/grades.service.ts#L506)), `GradeFinalized` ([line 743](../../server/application/microservices/academics/src/grades/grades.service.ts#L743)), `GradeBulkFinalized` ([line 807](../../server/application/microservices/academics/src/grades/grades.service.ts#L807)). Not in 25-event taxonomy.
- **Operator workflow:** teacher records assignment grade per student → bulk-finalize at term end → principal sees overview by school/AY. End-to-end works. ✅
- **Module-wiring:** ✅ at [`academics.module.ts:23,45`](../../server/application/microservices/academics/src/academics.module.ts#L23).
- **Gap:** **dashboard does not surface recent grade activity** (#5 above). The grades subsystem itself is operator-ready.

### Courses (`microservices/academics/src/courses/`)
**Verdict:** 🟡 partial (course-offering events missing — invariant 6 violation)

- **Entities:**
  - `Course` ([`course.entity.ts:22-75`](../../server/application/microservices/academics/src/common/entities/course.entity.ts#L22-L75)) — courseId, courseCode, courseName, schoolId, departmentId, gradeLevels[], credits, subjectArea, courseType (required|elective|honors|...), prerequisites[], standards[], textbooks[], isActive. GSI1 = `COURSE#departmentId#courseName`.
  - `CourseOffering` ([`course-offering.entity.ts:25-48`](../../server/application/microservices/academics/src/common/entities/course-offering.entity.ts#L25-L48)) — bridge between Course (catalog) and Section. courseOfferingId, courseId, academicSessionId, localCourseCode, localCourseTitle. GSI1 = `COURSE#courseId#ACADSESSION#sessionId`.
- **Endpoints:**
  - `@Controller('academics/courses')` ([`courses.controller.ts:37`](../../server/application/microservices/academics/src/courses/courses.controller.ts#L37)) — POST, GET, GET/:id, PATCH/:id, DELETE/:id; `courses:create|view|edit|delete`.
  - `@Controller('academics/course-offerings')` ([`course-offering.controller.ts:37`](../../server/application/microservices/academics/src/courses/course-offering.controller.ts#L37)) — POST, GET, GET/:id, PATCH/:id, DELETE/:id.
- **Three-way handoff:** ✅ all in [`tenant-api-prod.json`](../../server/lib/tenant-api-prod.json) (`/academics/courses`, `/academics/courses/{courseId}`, `/academics/course-offerings`, `/academics/course-offerings/{courseOfferingId}`). nginx ✅.
- **Frontend:** ✅ full — hooks `useCourses.ts`, `useCourseOfferings.ts`; components `CourseDrawer.tsx`.
- **Audit + event coverage:**
  - Course: ✅ emits `CourseCreated`, `CourseUpdated`, `CourseDeleted` (legacy PascalCase — [`courses.service.ts:129,347,431`](../../server/application/microservices/academics/src/courses/courses.service.ts#L129)).
  - **CourseOffering: ❌ zero event emissions** — `grep` in [`course-offering.service.ts`](../../server/application/microservices/academics/src/courses/course-offering.service.ts) returns zero `publish*` calls. Violates invariant 6.
- **Operator workflow:** admin creates Courses (catalog) once per AY → creates CourseOfferings to schedule each course in a session (term) → Sections attach to CourseOffering. Works end-to-end but CourseOffering writes are invisible to event consumers.
- **Module-wiring:** ✅ at [`academics.module.ts:21,43`](../../server/application/microservices/academics/src/academics.module.ts#L21).
- **Gap:** event-emission gap on CourseOffering (#6 above).

### Dashboard (`microservices/academics/src/dashboard/`)
**Verdict:** 🟡 partial (principal landing page has narrow daily-activity view)

- **Entities:** none — pure read-aggregator.
- **Endpoints:**
  - `@Controller('academics/dashboard')` ([`dashboard.controller.ts:26`](../../server/application/microservices/academics/src/dashboard/dashboard.controller.ts#L26))
  - `@Get('overview')` ([line 40](../../server/application/microservices/academics/src/dashboard/dashboard.controller.ts#L40)) — `?schoolId&academicYearId&date`; 60s cache; no permission decorator (no `@RequirePermission` — relies on `JwtAuthGuard` only).
- **Three-way handoff:** ✅ `/academics/dashboard/overview` in API spec; nginx ✅.
- **Frontend:** ✅ `useAcademicsOverview.ts` consumes; also surfaced in shell home (`useHomeData.ts`).
- **DTO shape** ([`dashboard.dto.ts:28-44`](../../server/application/microservices/academics/src/dashboard/dashboard.dto.ts#L28-L44)):
  ```ts
  { schoolId, academicYearId, date,
    enrollment: { totalEnrolled, byGradeLevel, byStatus, recentEnrollments, recentWithdrawals },
    activeSectionsCount: number,
    attendance: { date, totalStudents, totalRecorded, present, absent, late, excused, halfDay, remote, attendanceRate } | null }
  ```
- **Audit + event coverage:** N/A (read-only).
- **Operator workflow:** **the principal's first action of the day** is to open dashboard. Today they see how many students enrolled, how many sections, and today's attendance rate. They do NOT see: (a) how many classwork items were published since yesterday, (b) how many grades were recorded yesterday, (c) which sections are missing today's attendance (only the aggregate), (d) any discipline incidents (no module). The dashboard is **functional but undernourished for the daily-driver use case.**
- **Module-wiring:** ✅ at [`academics.module.ts:26,48`](../../server/application/microservices/academics/src/academics.module.ts#L26).
- **Gap:** #2 + #5 above.

### Sections (`microservices/academics/src/sections/`)
**Verdict:** 🟡 partial (class-teacher works, co-teacher entity-only, no schedule mapping)

- **Entities:** `CourseSection` ([`course.entity.ts:128-175`](../../server/application/microservices/academics/src/common/entities/course.entity.ts#L128-L175)) — sectionId, courseId, schoolId, academicYearId, termId, primaryTeacherId, **`coTeacherIds?: string[]`** (line 149), classPeriodId, locationId, sectionNumber, maxEnrollment, currentEnrollment, isActive.
- **Endpoints** (`@Controller('academics/sections')` at [`sections.controller.ts:45`](../../server/application/microservices/academics/src/sections/sections.controller.ts#L45)):
  - `@Post()`, `@Get()`, `@Get(':id')`, `@Patch(':id')`, `@Delete(':id')` — section CRUD
  - `@Post(':id/students')` — enroll student in section ([line 179](../../server/application/microservices/academics/src/sections/sections.controller.ts#L179))
  - `@Get(':id/students')` — roster ([line 198](../../server/application/microservices/academics/src/sections/sections.controller.ts#L198))
  - `@Delete(':id/students/:studentId')` — drop ([line 216](../../server/application/microservices/academics/src/sections/sections.controller.ts#L216))
- **Three-way handoff:** ✅ all routes in [`tenant-api-prod.json`](../../server/lib/tenant-api-prod.json); nginx ✅.
- **Frontend:** ✅ `useSections.ts`, `SectionForm.tsx` (exposes `primaryTeacherId` at line 209 — but NOT `coTeacherIds`), roster view, students/profile/ScheduleTab.tsx wired to `useRemoveStudent`.
- **Audit + event coverage:** legacy events `SectionCreated`, `SectionUpdated`, `SectionDeleted` ([`sections.service.ts:241,531,589`](../../server/application/microservices/academics/src/sections/sections.service.ts#L241)).
- **Operator workflow:** admin creates Section per (course, AY, term) → assigns class teacher → enrolls students. End-to-end works for primary teacher + roster. **Co-teacher field exists on entity but no UI**. Mid-year inter-section transfer not first-class (workaround: drop+add).
- **Module-wiring:** ✅ at [`academics.module.ts:22,44`](../../server/application/microservices/academics/src/academics.module.ts#L22).
- **Gap:** #9 (co-teacher UI), #10 (transfer endpoint).

### Section-Attendance (`microservices/academics/src/section-attendance/`)
**Verdict:** 🟡 partial (works end-to-end as per-section-per-day, NOT per-period)

- **Relationship to `attendance/`:** distinct entities/tables. `attendance/` records school-wide daily attendance (Ed-Fi `StudentSchoolAttendanceEvent`) per (student, date). `section-attendance/` records per-section attendance (Ed-Fi `StudentSectionAttendanceEvent`) per (student, section, date). **Neither records per-period attendance** (e.g., Period 1 = present, Period 2 = absent on same day same section). Section-attendance entity has NO `classPeriodId` field ([`section-attendance.entity.ts:27-77`](../../server/application/microservices/academics/src/common/entities/section-attendance.entity.ts#L27-L77)).
- **Entities:**
  - `SectionAttendance` ([`section-attendance.entity.ts:27-77`](../../server/application/microservices/academics/src/common/entities/section-attendance.entity.ts#L27-L77)) — studentId, schoolId, sectionId, date, dayOfWeek, status, attendanceEventCategory, attendanceEventReason, checkInTime, checkOutTime, note. GSI3 = date-school-scoped; GSI2 = student-centric.
  - `SectionAttendanceTaken` ([`section-attendance-taken.entity.ts`](../../server/application/microservices/academics/src/common/entities/section-attendance-taken.entity.ts)) — marker row per (section, date) indicating "teacher has taken attendance today."
- **Endpoints** (`@Controller('academics/section-attendance')` at [`section-attendance.controller.ts:40`](../../server/application/microservices/academics/src/section-attendance/section-attendance.controller.ts#L40)):
  - `@Post()` — record one ([line 53](../../server/application/microservices/academics/src/section-attendance/section-attendance.controller.ts#L53)), `attendance:create`
  - `@Post('bulk')` — record many ([line 70](../../server/application/microservices/academics/src/section-attendance/section-attendance.controller.ts#L70))
  - `@Get()` — by date ([line 87](../../server/application/microservices/academics/src/section-attendance/section-attendance.controller.ts#L87))
  - `@Get('student/:studentId')` — student history ([line 115](../../server/application/microservices/academics/src/section-attendance/section-attendance.controller.ts#L115))
  - `@Patch(':date/:sectionId/:studentId')` — correction ([line 142](../../server/application/microservices/academics/src/section-attendance/section-attendance.controller.ts#L142))
- **Three-way handoff:** ✅ all routes in [`tenant-api-prod.json`](../../server/lib/tenant-api-prod.json); nginx ✅.
- **Frontend:** ✅ `useSectionAttendance.ts`, `SectionAttendanceWrapper.tsx`, integrated in classroom overview.
- **Audit + event coverage:** legacy PascalCase `SectionAttendanceRecorded` ([line 152](../../server/application/microservices/academics/src/section-attendance/section-attendance.service.ts#L152)), `BulkSectionAttendanceRecorded` ([line 355](../../server/application/microservices/academics/src/section-attendance/section-attendance.service.ts#L355)). The taxonomy has registered `attendance.recorded` + `attendance.updated` ([`taxonomy.ts:96-97`](../../packages/shared-types/src/events/taxonomy.ts#L96)) but they are unused.
- **Operator workflow:** teacher takes section attendance once per day per section. End-to-end works. **However**: Saraswati's Shift 2 bell schedule has 8 periods × 45 min ([dossier](../pilots/pabson-saraswati-bs-2083/dossier.md#bell-schedule)). A teacher who teaches the same students in Period 1 (English) and Period 4 (English) cannot record separate attendance per period — they take it once for the section per day. This is a deliberate Ed-Fi design choice (StudentSectionAttendanceEvent is per-section-per-date, not per-period) but **the practical Saraswati flow** is that the class teacher takes morning attendance once and that's the day's record. So this gap is more theoretical than blocking, but it surfaces when the principal asks "did Period 4 actually meet today?"
- **Module-wiring:** ✅ at [`academics.module.ts:25,47`](../../server/application/microservices/academics/src/academics.module.ts#L25).
- **Gap:** per-period attendance + timetable (gap #1); event taxonomy.

### Attendance (`microservices/academics/src/attendance/`)
**Verdict:** 🟢 operator-ready (school-day attendance is the daily backbone)

- **Entities:** `Attendance` ([`attendance.entity.ts:23-`](../../server/application/microservices/academics/src/common/entities/attendance.entity.ts#L23)) — entityType `ATTENDANCE`; per (student, date). Also `SchoolAttendance` ([`school-attendance.entity.ts:28`](../../server/application/microservices/academics/src/common/entities/school-attendance.entity.ts#L28)) — aggregate rollups.
- **Endpoints** (`@Controller('academics/attendance')` at [`attendance.controller.ts:46`](../../server/application/microservices/academics/src/attendance/attendance.controller.ts#L46)):
  - `@Post()`, `@Post('bulk')`, `@Get()` (by date), `@Get('summary')`, `@Get('student/:id')`, `@Get('student/:id/summary')`, `@Get('overview')`, `@Get('trend')`, `@Get('alerts')`, `@Patch(':date/:studentId')`.
- **Three-way handoff:** ✅ all routes in [`tenant-api-prod.json`](../../server/lib/tenant-api-prod.json); nginx ✅.
- **Frontend:** ✅ full — attendance route, alerts surface, trend chart, daily overview.
- **Audit + event coverage:** legacy `AttendanceRecorded`, `BulkAttendanceRecorded` ([`academics-events.service.ts:431,452`](../../server/application/microservices/academics/src/common/services/academics-events.service.ts#L431)). Note: this is the module C3.1 sprint hardened (Phase-2 bulk-scan rewrite of `getAttendanceAlerts` per commit `a295ee1`).
- **Operator workflow:** ✅ daily school-wide attendance taking and reporting works end-to-end.
- **Module-wiring:** ✅ at [`academics.module.ts:20,42`](../../server/application/microservices/academics/src/academics.module.ts#L20).
- **Gap:** event taxonomy only.

### Enrollment (`microservices/academics/src/enrollment/`)
**Verdict:** 🟢 operator-ready (Sprint C4 async import + close-year live)

- **Entities:** `Enrollment` + related associations (not re-detailed; module has been hardened across Sprints C2, C3, C4 — see memory notes).
- **Endpoints** (`@Controller('academics')` at [`enrollment.controller.ts:44`](../../server/application/microservices/academics/src/enrollment/enrollment.controller.ts#L44) — uses bare academics prefix because routes are under `/academics/schools/:schoolId/years/:yearId/...` and `/academics/enrollments`):
  - `@Post('enrollments')` — create
  - `@Get('schools/:schoolId/years/:yearId/enrollments')` — list
  - `@Get('schools/:schoolId/years/:yearId/enrollments/summary')` — aggregate
  - `@Get('students/:studentId/enrollment')` — student-centric
  - `@Patch('schools/:schoolId/years/:yearId/students/:studentId/enrollment')` — update
  - `@Post('schools/:schoolId/years/:yearId/students/:studentId/withdraw')`
  - `@Post('schools/:schoolId/years/:yearId/students/:studentId/transfer')` ([line 210](../../server/application/microservices/academics/src/enrollment/enrollment.controller.ts#L210)) — inter-school
  - `@Post('schools/:schoolId/years/:yearId/students/:studentId/no-show')` ([line 232](../../server/application/microservices/academics/src/enrollment/enrollment.controller.ts#L232))
  - `@Post('schools/:schoolId/years/:yearId/enrollments/close-year')` ([line 251](../../server/application/microservices/academics/src/enrollment/enrollment.controller.ts#L251))
  - `@Get('schools/:schoolId/years/:yearId/enrollments/export')` ([line 272](../../server/application/microservices/academics/src/enrollment/enrollment.controller.ts#L272)) — CSV
  - `@Get('schools/:schoolId/academic-years/:yearId/calendars')` ([line 294](../../server/application/microservices/academics/src/enrollment/enrollment.controller.ts#L294))
  - `student-school-association.controller.ts`: GET endpoints for student-school associations.
- **Three-way handoff:** ✅ all in [`tenant-api-prod.json`](../../server/lib/tenant-api-prod.json); nginx ✅.
- **Frontend:** ✅ full — `useEnrollments.ts`, transfer + no-show + close-year + import flow.
- **Audit + event coverage:** legacy `EnrollmentCompleted`, `StudentWithdrawn`, `StudentTransferred` ([`enrollment.service.ts:244,795,952`](../../server/application/microservices/academics/src/enrollment/enrollment.service.ts#L244)). Registry has `enrollment.{created,promoted,retained,withdrawn}` reserved — unused.
- **Operator workflow:** ✅ green per memory `project_sprint_C4_async_import_shipped` + Saraswati's 206-student real import.
- **Module-wiring:** ✅ at [`academics.module.ts:19,41`](../../server/application/microservices/academics/src/academics.module.ts#L19).
- **Gap:** event taxonomy.

### Searches for absent modules

- **Discipline / Behavior / Incident:** `find ... -type d \( -name "*discipline*" -o -name "*behavior*" -o -name "*incident*" \)` returns **zero**. `grep -rln "Discipline\|Behavior\|Incident" microservices/` returns only references in attendance docstrings / permission strings / iemis-transform's `disabilities` parser (false positives). **No entity, no controller, no event.** This is the IEMIS-relevant gap.
- **Time-table / period-schedule:** `Schedule` entity exists at [`academics/src/common/entities/schedule.entity.ts:22-`](../../server/application/microservices/academics/src/common/entities/schedule.entity.ts#L22) with fields `teacherId`, `substituteTeacherId`, `sectionId`, `courseId` — but `grep -rln Schedule academics/src` returns no service that actually queries or writes this entity. **It's a vestigial entity.** ClassPeriod exists in identity ([`class-period.entity.ts`](../../server/application/microservices/identity/src/common/entities/class-period.entity.ts)) with CRUD endpoints at `/schools/:schoolId/class-periods` — but it represents *one* time-block-of-day, not the weekly grid. There is no `Timetable` / `MasterSchedule` entity binding `(dayOfWeek, periodId, sectionId, teacherId)`.
- **Substitute-teacher:** `substituteTeacherId` field exists on dead `Schedule` entity, used by zero services. **No surface.**
- **Mid-year inter-section transfer:** inter-school transfer exists at `/academics/schools/.../transfer`. No within-school equivalent.

---

## Proposed "Sprint D-DAILY" ticket list

> Tickets are atomic — one commit, one PR each. Ordering: high-value low-cost first.

- **D-DAILY.1 — Dashboard daily-activity surfaces** (gap #2, #5)
  - **Files:** `server/application/microservices/academics/src/dashboard/dashboard.service.ts` (extend `getOverview` to query GSI1 on `CLASSWORK#` prefix between `?date - 1d` and `?date` for `recentClassworkCount`, query GSI1 on `GRADE#` prefix for `recentGradeCount`, query GSI3 attendance for `sectionsWithAttendanceTaken` vs `activeSectionsCount`); `dashboard.dto.ts` (extend `DashboardOverviewDto`); `dashboard.service.spec.ts` (+6 tests); frontend `apps/academics/src/components/overview/...` (3 new cards).
  - **Validation:** Jest unit on `dashboard.service` + Jest snapshot on DTO + manual smoke against Saraswati at 8 AM showing each surface.
  - **AC:** dashboard response includes `{ recentClassworkCount, recentGradeCount, sectionsWithAttendanceTaken, totalActiveSections }`; UI renders 3 new cards above the fold; 60s cache key extended.

- **D-DAILY.2 — Course-Offering event emission** (gap #6, invariant 6 violation)
  - **Files:** `server/application/microservices/academics/src/courses/course-offering.service.ts` (add `eventsService.publishCourseOfferingCreated/Updated/Deleted` calls in create/update/delete); `academics-events.service.ts` (add 3 PascalCase publish methods + 3 event interfaces, matching the existing `CourseCreated` shape); `course-offering.service.spec.ts` (+3 emission tests).
  - **Validation:** Jest unit.
  - **AC:** every CourseOffering write emits one event with `{eventType, tenantId, courseOfferingId, schoolId, ...}`; existing tests stay green; invariant 6 audit-grep passes.

- **D-DAILY.3 — Academics `module-wiring.spec.ts`** (gap #8, memory `feedback_module_wiring_invariant`)
  - **Files:** `server/application/microservices/academics/src/__tests__/module-wiring.spec.ts` (NEW) — mirror identity's spec; instantiate `AcademicsModule` via `Test.createTestingModule`; assert every controller is in `compile()`-time `controllers` array; assert every service is resolvable; list each module (`StudentsModule`, `EnrollmentModule`, ..., `DashboardModule`) explicitly in the watchlist.
  - **Validation:** Jest. Run on every PR via CI.
  - **AC:** spec fails on a deliberate "forgot to import in `academics.module.ts`" mutation; passes on `main`.

- **D-DAILY.4 — Co-teacher UI in SectionForm** (gap #9)
  - **Files:** `edforge-saas-frontend/apps/academics/src/components/scheduling/SectionForm.tsx` (multi-select `coTeacherIds`); section service write path (`sections.service.ts` already accepts `coTeacherIds` per entity — verify and add validation); `section.form.ts` schema.
  - **Validation:** Playwright manual; SectionForm e2e adding 2 co-teachers.
  - **AC:** form persists `coTeacherIds`; reads back on edit; teacher autocomplete filters to school's staff.

- **D-DAILY.5 — Within-school inter-section transfer endpoint** (gap #10)
  - **Files:** `microservices/academics/src/sections/sections.controller.ts` (`@Post(':id/transfer')` accepting `{ targetSectionId, studentIds[] }`); `sections.service.ts` (atomic TransactWriteItems: drop from source + add to target + emit `StudentTransferredBetweenSections` event); `sections.service.spec.ts` (+3 tests); `tenant-api-prod.json` (1 route); `nginx.template` unchanged (existing `/academics` prefix); `academics-events.service.ts` (+1 publish method).
  - **Validation:** Jest unit + integration test exercising the TransactWriteItems atomicity.
  - **AC:** single-call transfer succeeds atomically; partial-failure rolls back both sides; event payload includes both sectionIds.

- **D-DAILY.6 — Discipline / Behavior / Incident MVP** (gap #3 — IEMIS-relevant)
  - **Files:** `server/application/microservices/academics/src/discipline/discipline.module.ts` (NEW); `discipline.controller.ts` (`@Controller('academics/discipline-incidents')` — POST, GET, GET/:id, PATCH/:id); `discipline.service.ts`; `common/entities/discipline-incident.entity.ts` (Ed-Fi `DisciplineIncident` + `StudentDisciplineIncidentAssociation`); descriptor catalog `IncidentLocationDescriptor`, `BehaviorDescriptor`, `DisciplineActionDescriptor` under `packages/shared-types/src/descriptors/`; `academics-events.service.ts` (+3 publish methods); `tenant-api-prod.json` (+3 routes — new `/academics/discipline-incidents` prefix); `nginx.template` unchanged (covered by existing `/academics` block); frontend route + form.
  - **Validation:** Jest unit; route-drift lint; manual smoke creating one incident + verifying it surfaces on dashboard count.
  - **AC:** end-to-end create-and-view; IEMIS Form-19 mapper has a count to draw from; descriptors land in `edforge:` namespace per invariant 11.

- **D-DAILY.7 — Per-period attendance / Time-table (Timetable entity)** (gap #1 — LARGE; split into sub-tickets)
  - **D-DAILY.7a:** `Timetable` entity + key shape (`SCHOOL#schoolId#TIMETABLE#{academicYearId}#{termId}#{dayOfWeek}#{periodId}` → `{sectionId, primaryTeacherId, locationId}`). New `microservices/identity/src/timetable/` module (identity owns this because `ClassPeriod` and `Location` live there). CDK: extend `ecs-dynamodb.ts` if a new GSI is needed for "teacher's day" query. Module-wiring spec updated in the SAME PR (memory `feedback_module_wiring_invariant`).
  - **D-DAILY.7b:** API GW + nginx new prefix `/schools/:schoolId/timetable` (THREE-way handoff: controller + tenant-api-prod.json + nginx.template).
  - **D-DAILY.7c:** Frontend grid UI: weekly grid for the operator to drag sections into period × day cells; "My day" teacher view.
  - **D-DAILY.7d:** Section-attendance optional `classPeriodId` field + per-period attendance recording (frontend uses the timetable to know which period is "now").
  - **Validation:** Each sub-ticket has Jest + smoke. Sprint-level smoke: teacher logs in at 10 AM → "My day" shows Period 1 in progress → records attendance for that section-period → dashboard shows the period as "attendance taken."
  - **AC:** Each AC scoped to its sub-ticket. Overall: a Saraswati teacher can see their day and take attendance per period.

- **D-DAILY.8 — Substitute-teacher day assignment** (gap #4 — depends on D-DAILY.7)
  - **Files:** `microservices/identity/src/timetable/substitute.service.ts` — `POST /schools/:schoolId/timetable/substitutes` with `{ date, periodId, sectionId, substituteTeacherId, reason }`; the resolver for "who teaches this section in this period today" prefers a substitute row over the base timetable.
  - **Validation:** Jest unit.
  - **AC:** admin can mark Mr. X as sub for Ms. Y for one period; "My day" view picks up the substitution; original timetable row unchanged.

- **D-DAILY.9 — PascalCase → snake-dotted event migration (academics quick-win)** (gap #7 — partially overlaps deferred-work but is now in-scope because it unblocks dashboard event-log)
  - **Files:** add 6 new Zod schemas to `packages/shared-types/src/events/` for `attendance.recorded`, `attendance.updated`, `classwork.item_created`, `grade.recorded`, `grade.finalized`, `enrollment.created`. Add to `EVENT_REGISTRY` ([`taxonomy.ts:76`](../../packages/shared-types/src/events/taxonomy.ts#L76)). Update `academics-events.service.ts` `publishAttendanceRecorded` / `publishSectionAttendanceRecorded` / etc. to `publishValidatedEvent` with new types. Keep legacy publisher as alias for 1 sprint, then delete.
  - **Validation:** Jest registry-completeness test; emission tests.
  - **AC:** event-log integration test sees 6 new event types; legacy publishers still flow but log deprecation warning.
  - **NOTE:** if this conflicts with `deferred-work.md` "PascalCase → snake-dotted event migration" timing, defer this ticket and revisit during Sprint C8 (event-log completion) as that doc suggests.

---

## Architecture/invariant violations found

Cross-checked against the 13 invariants in [`sprint-plan.md:217-235`](./sprint-plan.md#L217-L235) and the §4 recap in [`sprint-plan-update-2026-05-19.md:39-55`](./sprint-plan-update-2026-05-19.md#L39-L55):

- **Invariant 5 (Every write goes through `auditedWrite()`):** **Academics has NO `auditedWrite` infrastructure.** `grep -rn auditedWrite microservices/academics/src` returns zero hits. The pattern lives only in identity (`identity/src/common/services/audited-write.service.ts`). Every academics write goes through `dynamoDb.putItem` / `updateItem` / `deleteItem` directly, with no append-only audit-row companion. This is the largest invariant-5 gap in the codebase and is invisible at code-review time because there's no academics-side audit lint. **Recommendation:** parallel architectural ticket — port `AuditedWriteService` to academics. Scope ~1 sprint.

- **Invariant 6 (Every domain action emits an event with a registry schema):** violated in two ways:
  - **CourseOffering** writes emit zero events (gap #6 / D-DAILY.2).
  - **All academics events are legacy PascalCase**, not in the 25-event registry at [`taxonomy.ts`](../../packages/shared-types/src/events/taxonomy.ts) (gap #7 / D-DAILY.9). The registry reserves `attendance.recorded`, `attendance.updated`, `enrollment.{created,promoted,retained,withdrawn}`, but every emit-site in academics emits a different `eventType` literal (`AttendanceRecorded`, `EnrollmentCompleted`, `StudentWithdrawn`, etc.). C0.c.3 wired `EventServiceBase.publishEvent` to validate against the registry and DLQ on unknown — meaning every academics emit today logs a "UNKNOWN_EVENT_TYPE" warning OR falls through the legacy backward-compat branch in `EventServiceBase`. Confirm via prod CloudWatch query (per memory `project_pilot_greenlight_c3_closed` and [`deferred-work.md`](./deferred-work.md) "PascalCase → snake-dotted event migration").

- **Invariant 7 (No silent fallbacks — explicit 404 + errorCode):** classwork / grades / sections / courses all throw `NotFoundException` (with a string message, not a structured `errorCode`). Compared with identity's `errorCode: NO_CURRENT_AY` pattern (per [`deferred-work.md` Bug 3](./deferred-work.md#bug-3-ux--no_current_ay-404-reaches-the-operator-as-a-generic-error)), academics' 404s are softer. Not a blocker but a consistency gap.

- **Invariant 8 / 12 (No code branches on `tenant.archetype`):** `grep -rn 'archetype' server/application/microservices/*/src/` confirms zero hits in service code — invariant 12 holds. Spot-checked: no archetype branching in academics modules audited.

- **Module-wiring invariant:** **Academics has no `module-wiring.spec.ts`** (gap #8 / D-DAILY.3). This is a latent landmine per memory `feedback_module_wiring_invariant`.

- **Invariant 13 (No pilot-specific names in code):** `grep -rni 'saraswati\|pabson\|bs-2083' server/application/microservices/academics/src/` returns zero hits — invariant 13 holds.

---

## Open questions for the CEO/PM

1. **Time-table (gap #1) priority:** is D-DAILY.7 in-scope for the pre-classes-start sprint window (≤2 weeks)? Or do we defer and let Saraswati run on per-section-per-day attendance for Term 1? **Recommendation:** defer per-period; ship per-day + dashboard improvements + discipline first; revisit timetable after Term 1 retro. Saraswati's daily flow is "class teacher takes morning attendance once" — that's already supported.
2. **Discipline (gap #3) IEMIS reporting requirements:** is discipline-incident count a hard IEMIS-Form-19 requirement for the Saraswati pilot, or is it on the "future / nice-to-have" list? **Recommendation:** confirm with admin during C13.2 onboarding before sizing D-DAILY.6.
3. **Co-teacher (gap #9) Saraswati realism:** does Saraswati actually co-teach any sections (e.g., ECD/PPC), or is class-teacher-only the norm? If norm = single teacher, D-DAILY.4 can be deferred.
4. **PascalCase event migration (gap #7) scheduling:** the deferred-work doc says "any time before Sprint C8." Is D-DAILY.9 worth doing now to unblock D-DAILY.1 dashboard event-log, or do we let dashboard query DDB directly (current approach) and defer events to C8? **Recommendation:** defer to C8; D-DAILY.1 should query DDB GSIs, not events.
5. **Academics-wide `AuditedWriteService`:** is invariant 5's academics gap acceptable for the pilot (writes are audit-trace-able via CloudWatch logs even without an audit-row), or does it block Saraswati go-live? **Recommendation:** acceptable for pilot. Track as B0.1 architectural debt.

---

## Read-only validation evidence

For each module audited, I confirmed:
1. The controller exists at the stated path with the stated decorators.
2. The entity exists with the stated GSI shape.
3. Each operator-facing route is present in [`server/lib/tenant-api-prod.json`](../../server/lib/tenant-api-prod.json) (line-counted: 36 academics routes).
4. nginx covers all `/academics` subroutes via [`nginx.template:199`](../../server/application/reverseproxy/nginx.template#L199).
5. Frontend hook + UI consumer exist for every 🟢 module (search results in `edforge-saas-frontend/apps/academics/src/hooks/` and `services/academics.service.ts`).
6. Event emission is present (legacy PascalCase) for every write path I inspected, except `course-offering.service.ts`.
7. Module is wired into [`academics.module.ts`](../../server/application/microservices/academics/src/academics.module.ts) (all 8 imports + providers verified).

No code or tests were modified during this audit.
