# Exams & Assessments — Ed-Fi Gap Analysis + Roadmap

**Status:** planning · **Created:** 2026-06-06 · **Archetype scope:** PABSON (V1)
**Trigger:** first-pilot exam→result-card validation on `dev-pabson-primary`
(school `SPA983`, Grade 2). End-to-end generation works, but the run surfaced
a cluster of correctness, semantic, and Ed-Fi-alignment gaps.

This doc is the source of truth for completing the exam/assessment epic in an
**Ed-Fi V6-compliant, scalable, PABSON-aligned** way. It pairs with
[`sprint-plan.md`](./sprint-plan.md) (platform hardening) and the
[ELS sprint plan](../pilot-greenlight/exam-grade-level-scoping-sprint-plan.md).

---

## 1. The central architectural finding

In Ed-Fi V6 a **`Grade` is structurally anchored to a `StudentSectionAssociation`** —
there is no section-free Grade. A Grade's identity *is* the StudentSectionAssociation
natural key + `GradingPeriod` + `GradeTypeDescriptor`. **Subject is not a field on
Grade**; it is derived transitively:

```text
Grade → StudentSectionAssociation → Section → CourseOffering → Course → AcademicSubjectDescriptor
                                                              (subject lives here)
ReportCard  = optional per-(student, GradingPeriod) aggregation of Grades + GPA
StudentAcademicRecord / CourseTranscript = transcript layer (per Session, section-free)
```

**Consequence for EdForge today:** an exam scores against the school-level
`Enrollment` (the StudentSchoolAssociation analogue) keyed on
`schoolId + academicYear + gradeLevel`, with **no link to Section / CourseOffering**.
A student who is school-enrolled but in **no section** (observed: *Shruti Jha*) still
receives a result card — and that card **cannot be projected onto an Ed-Fi `Grade`.**

**Resolution (decision locked, §4):** do **not** re-anchor the runtime model on
sections. Ed-Fi's own documented best practice for self-contained / whole-grade-cohort
classrooms is **"one Course + CourseOffering + Section per (grade × subject)."** So the
compliant path is a **projection/synthesis layer at the reporting boundary** that
manufactures the subject-grade Section + StudentSectionAssociation + Grade +
GradingPeriod from EdForge's grade-cohort exam data. This is the *same* report-time
projection pattern already established for IEMIS Flash and grade-level
canonicalization (see CLAUDE.md “School-first architecture”). Operator UX stays simple
(exam per grade-level); Ed-Fi fidelity is produced at export.

### Ed-Fi sources
- Student Academic Record Domain — Overview & Best Practices
  (`docs.ed-fi.org/.../student-academic-record-domain/overview`, `/best-practices`)
- Teaching & Learning Domain — Best Practices (self-contained classroom: one
  Course/CourseOffering/Section per subject-grade)
- School Calendar Domain — GradingPeriod ("often, but not necessarily, a division of a session")
- Key Structure in the Ed-Fi ODS/API (Grade ↔ StudentSectionAssociation)
- SIS v5 certification — StudentSchoolAssociation & StudentSectionAssociation scenarios
  (a certifying SIS must demonstrate **section-level** enrollment create/update-end-date/delete)

> Sourcing caveat: `docs.ed-fi.org` blocks direct fetch; the Grade↔Section anchoring
> is confirmed across the model-reference + Key Structure pages and the ODS schema, but
> exact field-level cardinality wording was inferred, not quoted.

---

## 2. Gap table

| # | Gap | Evidence (file:line) | Ed-Fi reference | Tier |
|---|---|---|---|---|
| 1 | **Subject renders `unknown`** | `exam-courses.service.ts addExamCourse` denormalizes only the *optional, finer* `course.academicSubject`; a course with the *required* `subjectArea` only → `undefined` → stripped by `removeUndefinedValues:true` (`dynamodb-client.service.ts:44`) → Lambda `ec.academicSubject ?? 'unknown'` (`handler.ts:343`). **Wrong field denormalized:** `subjectArea` is the always-present Ed-Fi descriptor. | `subjectArea` ↔ AcademicSubjectDescriptor (required, on Course); `academicSubject` = finer-than-Ed-Fi local granularity (optional) | **0 (bug)** |
| 2 | **Silent generation failure** | Lambda throw → DLQ; Exam stays `closed` with no cards and no operator signal. **Fix is event-driven + state, NOT a new alarm/SNS** (see §4.9): operator-visible `resultGenerationStatus` + a `ResultGenerationFailed` domain event on the existing bus | ops | **1** |
| 3 | **Tombstone was mutable** | ✅ fixed in `a244196` (8 mutation gates + active-only list + gsi1sk refresh) | n/a | **0 (done)** |
| 4 | **Ungraded student → 0/100 “E” (fail)** | `term-aggregation.ts` iterates every grade-enrollment; no score → 0% → letter `E` | A Grade is recorded only where a section grade exists; missing ≠ fail | **1 (policy)** |
| 5 | **`isActive` exposed in DTOs** | `result-card.schema.ts` (and peers) include `isActive` in the response | Ed-Fi has no `isActive`; uses association end-dates | **1** |
| 6 | **No Section anchor on grades** | `exam.entity.ts` Exam = `schoolId+ay+term+gradeLevels[]` (no `sectionId`/`courseOfferingId`); `handler.ts:370-383` aggregates school `Enrollment`, not `SectionEnrollment` | Grade ⇒ StudentSectionAssociation (required) | **2 (cert)** |
| 7 | **No active mappers** for ReportCard, StudentSectionAssociation, GradingPeriod | only the StudentSchoolAssociation mapper exists; ResultCard→ReportCard is doc-only | SIS v5 requires section-enrollment CRUD | **2** |
| 8 | **SectionEnrollment ⊥ school Enrollment** | `section-enrollment.entity.ts` is a standalone join; nothing enforces an active school Enrollment, or that its date window sits within the SSA window | SSA-section window ⊆ SSA window | **3** |
| 9 | **CourseOffering sparse; GradingPeriod implicit** | Sections reference `Course` directly; `termId` is the only grading-period notion (no entity/mapper) | CourseOffering + GradingPeriod are first-class | **3** |
| 10 | **Grading-scheme mismatch (adoption blocker)** | EdForge defaults PABSON to **Letter+GPA** (`PABSON_LETTERS`, `termGpa`/`overallGrade`); the real pilot (Shree Saraswati) grades by **Division** (Distinction ≥85 / First ≥65 / Second ≥50 / Third ≥40 / Fail). Card we produce ≠ card the school prints. | Grade carries descriptor + numeric; scheme is implementation/archetype choice (Ed-Fi is scheme-agnostic) | **1.5 (value)** |
| 11 | **No Theory/Practical components** | Real subjects split Th.+P. with separate full/pass (e.g., Pre-Voc Account 100/50, 40/20); `ExamCourse{maxMarks,passingMarks}` + `ExamScore{rawScore}` are single-valued | components → GradebookEntry/StudentGradebookEntry; rolled-up subject mark → Grade | **1.5** |
| 12 | **No Result(Pass/Fail) / Position / H.M.** | `overallGrade` only; `classRank`/`sectionRank`=null; no per-subject class-max | StudentAcademicRecord (cumulative) / ReportCard fields; rank is optional | **1.5 (schema) / V1.5 (compute)** |

---

## 3. `isActive` vs `status` (clarification — not a code change beyond #5)

Two **orthogonal** axes, both intentional:

- **`status`** — the entity *lifecycle* (Exam: `draft → scheduled → in_progress →
  closed → published`; ResultCard: `draft → published`). This is the workflow state.
- **`isActive`** — a uniform *soft-delete / existence* flag on every entity (single-table
  DDB has no hard deletes). `true` = live; `false` = tombstoned. Reads filter
  `isActive !== false`; deletes set `false`.

A `draft` exam being `isActive:true` is **correct** — it exists, it is not deleted.
Ed-Fi itself has no `isActive`; it expresses "ended" via association end-dates
(`StudentSchoolAssociation.exitWithdrawDate`). **Action (Tier 1):** keep both axes,
document them here, and stop emitting `isActive` in operator-facing response DTOs (it is
an internal concern; soft-deleted rows are already filtered server-side).

---

## 4. Locked decisions (2026-06-06)

1. **Ungraded students in a closed exam → "Absent / Not Graded".** Generate the card for
   the roster, but render an un-scored course as a **distinct non-failing state**
   (`AB` / `—`), **not** `0% → E`. A missing grade is not a failing grade. This keeps the
   operator full-roster view while being Ed-Fi honest (a Grade is emitted only where a
   score exists; absences carry an absence semantic, not a fail).
2. **Ed-Fi section-anchored grades → synthesize at the projection boundary.** Keep exams
   grade-level at runtime; manufacture subject-grade `Section` + `StudentSectionAssociation`
   + `Grade` + `GradingPeriod` only at the Ed-Fi / IEMIS export layer. No runtime
   section-precondition for scoring in V1.
3. **First implementation step → this planning doc, before code.** (You are reading it.)
4. **No patching of existing dev/pilot data.** All fixes are forward-looking — fresh
   exams re-denormalize, and the real pilot (*Shree Saraswati*) starts with no exam/course
   data, so backfill scripts are unnecessary. The `dev-pabson-primary` tenant is the test
   bed; its stale rows are disposable.
5. **`subjectArea` is the Ed-Fi `AcademicSubjectDescriptor`** (required, coarse rollup);
   `academicSubject` is optional finer local granularity. The card subject and the Ed-Fi
   projection both derive from `subjectArea`, enriched by `academicSubject` when present.
6. **Grading scheme is per-school configurable; PABSON seeds Division.** `GradingPolicy`
   gains a `schemeType: 'division' | 'letter_gpa'`. V1 supports **both**; the PABSON
   archetype seeds **Division-by-percentage** as the default (matches Shree Saraswati),
   with Letter+GPA available (e.g., SEE/board-prep). A school may hold multiple policies;
   an exam may name one, else the default. See §7.
7. **Theory/Practical assessment components ship in V1.** `ExamCourse` gains
   `components[]` (each with its own `fullMarks`/`passMarks`); `ExamScore` records
   per-component marks; pass is checked per component. Single-component subjects remain
   the back-compat default. See §7.
8. **Class statistics — schema now, compute in V1.5.** `ResultCard` gains
   `position`/`highestInClass` fields now (final shape), but the cohort post-aggregation
   pass that fills them is deferred to V1.5.
9. **No new CloudWatch alarm / SNS for result generation** (cost + complexity). The
   EDA-native signal is: (a) operator-visible `resultGenerationStatus` on the Exam that
   the FE reads, and (b) a `ResultGenerationFailed` / `ResultGenerationCompleted` domain
   event on the **existing** academics EventBridge bus for the future notification-system
   epic to consume. The already-provisioned DLQ stays as the technical dead-letter net.
   No new infra.

---

## 5. Roadmap

### Phase 0 — ship what's done
- Deploy `a244196` (tombstone gate + active-only list + gsi1sk refresh + tests) via the
  MAC/pipeline: academics ECR push + `tenant-template-stack-basic` (Lambda guard-split).
  `cdk diff` expected to be Lambda-code + metadata only. Re-validate a fresh close.

### Phase 1 — correctness & semantics (this sprint)
- **1a. Subject fix (correct field + defensive resolution + operator nudge).**
  - **Backend:** denormalize the *required* `subjectArea` onto `ExamCourse` (it is the
    Ed-Fi `AcademicSubjectDescriptor` and is always present), keeping `academicSubject` as
    optional enrichment. Resolve the card subject as
    `academicSubject ?? subjectArea ?? courseName` so a **validly-created course never
    renders `unknown`** (`subjectArea`/`courseName` are always present). Update
    `createExamCourseEntity` + `addExamCourse` + the ExamCourse DTO + the Lambda
    aggregation + `result-card` rendering.
  - **No backfill** (decision §4.4) — fix is forward-looking; fresh exams re-denormalize.
  - **FE (data quality, not a gate):** in the Curriculum table, show an actionable
    badge/tooltip when a course has only `subjectArea` and no granular `academicSubject`,
    nudging the operator to enrich it for finer report-card / Ed-Fi labels. `subjectArea`
    alone remains valid.
  - *Decision-independent; safe to start immediately.* Deploy: academics ECR + Lambda
    (backend); `edforge-saas-frontend` (the Curriculum nudge).
- **1b. Ungraded → "Absent / Not Graded"** (decision §4.1). Introduce an explicit
  un-scored course-row state in `term-aggregation.ts` (do not compute 0%→E); surface it
  in the ResultCard schema + UI. Add aggregation tests for the absent path.
- **1c. `resultGenerationStatus` backbone (event-driven, no new infra — decision §4.9).**
  Add `resultGenerationStatus` (`pending | generated | failed`), `resultsGeneratedAt`,
  `lastGenerationError` to the Exam entity. The result-batch Lambda sets `pending` at start
  (or the close-transition does) and writes `generated`/`failed` (+ error) at the end; the
  FE renders "results pending / failed" instead of an empty/zeroed card. On failure the
  Lambda **emits a `ResultGenerationFailed` domain event on the existing EventBridge bus**
  (the future notification epic subscribes later). **No CloudWatch alarm, no SNS topic** —
  the existing DLQ remains the dead-letter net. Deploy: academics + Lambda (no stack infra
  change beyond the Lambda code).
- **1d. Stop exposing `isActive`** in operator response DTOs; document the two axes
  (this doc §3 + a CLAUDE.md note).

### Phase 1.5 — Assessment & Grading domain (real-card-driven; see §7)
- **1.5a. Grading scheme.** Add `GradingPolicy.schemeType` (`division | letter_gpa`); seed
  PABSON default = Division bands; branch `term-aggregation.ts` on scheme (division →
  percentage → band + Pass/Fail; letter_gpa → existing path). Per-school configurable;
  exam may name a policy.
- **1.5b. Assessment components.** `ExamCourse.components[]` (theory/practical/…, each
  `fullMarks`/`passMarks`); `ExamScore` per-component marks; per-component pass check;
  single-component back-compat.
- **1.5c. ResultCard superset.** Per-subject `{fullMarks,passMarks,theory,practical,total,
  obtained,pass,highestInClass?}` + aggregate `{totalFull,totalObtained,percentage,
  division|overallGrade,gpa?,result,position?}`; attendance/health resolved at projection.
- **1.5d. Class-stats schema** (`position`,`highestInClass`) added; cohort compute deferred
  to V1.5 (decision §4.8).

### Phase 2 — Ed-Fi grading projection (certification foundation; decision §4.2)
- **2a. GradingPeriod mapper** — project `Term` (`termId`, with `examStartDate`/`examEndDate`)
  → Ed-Fi `GradingPeriod` (+ `GradingPeriodDescriptor`).
- **2b. Subject-grade synthesis** — at export, for each (gradeLevel × ExamCourse subject)
  manufacture `Course "Grade N <Subject>"` whose `AcademicSubjectDescriptor` derives from
  the course's `subjectArea` (not the optional `academicSubject`), plus its
  `CourseOffering` and one `Section`.
- **2c. StudentSectionAssociation mapper** + ensure section-enrollment
  create/update-end-date/delete is exercisable against the API (SIS v5 cert bar).
- **2d. ResultCard → ReportCard/Grade mapper** — emit a `Grade` per
  StudentSectionAssociation per GradingPeriod; `ReportCard` aggregation optional.

### Phase 3 — integrity invariants
- Section-enrollment requires an active school Enrollment; SSA-section date window ⊆ SSA
  window (gap #8).
- Make `CourseOffering` the canonical session reference; make `GradingPeriod` explicit
  (gap #9).

---

## 6. Open questions / future
- IEMIS Flash I/II reconciliation has **no** Ed-Fi guidance; it is EdForge-owned and
  belongs at the same projection layer (school-local grade codes → canonical taxonomy →
  Ed-Fi subject-grade chain).
- Whether EdForge pursues the optional `StudentAcademicRecord`/`CourseTranscript`
  (transcript) layer in addition to per-period ReportCards — deferred past V1.

---

## 7. Assessment & Grading domain design (driven by the real Saraswati card)

Reference artifact: *Shree Saraswati Sec. Eng. Boa. School* "Progress Report",
1st/2nd/3rd Terminal/Final Examination 2082 BS. It is the source of business truth for
what the domains must capture. The **printable document is a separate epic** (per-school
customizable layout/branding/print); this section defines only the **structured domains**
that document consumes.

### Decode of the card
- Per-subject columns: `Full M. · Pass M. · Th. · P. · Total · Obt.M. · H.M.` — full/pass
  marks vary per subject; subjects can split into **Theory + Practical** each with its own
  full/pass; `H.M.` = highest-in-class per subject (cohort stat).
- Footer: Working/Present days, No. of students in class, Height/Weight, **Per. %**,
  **Result**, **Division**, **Position**.
- Grading System = **Division by aggregate %**: Distinction ≥85 · First ≥65 · Second ≥50 ·
  Third ≥40 · (Fail <40). **No GPA** — unlike EdForge's current Letter+GPA output.

### Design principle: separate three concerns
1. **What is measured** — assessment structure (ExamCourse components + ExamScore).
2. **How it is graded** — grading scheme (GradingPolicy, per-school, archetype-seeded).
3. **How it is presented** — document/print epic (later), consuming a presentation-neutral
   ResultCard.

This separation is what keeps it simultaneously Ed-Fi-compliant (scheme/components project
to descriptors/GradebookEntry/Grade), archetype-compliant (scheme + subjects are *data*,
not code branches — no `country===NPL`), and humanized per school (presentation layer).

### Layer 1 — Assessment structure
```ts
ExamCourse {
  courseId, subjectArea, courseName,          // subject identity (subjectArea = Ed-Fi descriptor)
  components: [                                // NEW (decision §4.7); single-component = back-compat
    { code: 'theory',    fullMarks: 100, passMarks: 40 },
    { code: 'practical', fullMarks: 50,  passMarks: 20 },
  ],
}
ExamScore { examCourseId, enrollmentId, componentScores: { theory: 78, practical: 41 } }
```
Subject obtained = Σ component marks; subject pass = each component ≥ its passMarks (Nepal
rule: pass theory **and** practical). → **Ed-Fi:** each component → `GradebookEntry` /
`StudentGradebookEntry`; the rolled-up subject mark → `Grade`.

### Layer 2 — Grading scheme (per-school, archetype-seeded; decision §4.6)
```ts
GradingPolicy {
  schoolId, isDefault, schemeType: 'division' | 'letter_gpa',
  divisions:    [{label:'Distinction',minPct:85}, {label:'First',minPct:65},
                 {label:'Second',minPct:50}, {label:'Third',minPct:40}],   // division
  letterGrades: [ …gpa bands… ],                                           // letter_gpa
  resultRule:   'pass_all_subjects',   // fail any subject → Result=Fail, division withheld
}
```
`term-aggregation.ts` branches on `schemeType`:
- **division:** per-subject Pass/Fail by passMarks → if any fail → `Result=Fail` (no
  division); else `Result=Pass`, `Division=band(aggregate %)`.
- **letter_gpa:** the existing letter/GPA path.
→ **Ed-Fi:** result label → `PerformanceLevelDescriptor`/`GradeTypeDescriptor` +
`numericGradeEarned`; GPA → `ReportCard.GradePointAverage` (optional). Ed-Fi is
scheme-agnostic, so either projects cleanly.

### Layer 3 — ResultCard (structured superset, presentation-neutral)
- Per-subject: `fullMarks, passMarks, theory?, practical?, total, obtained, pass,
  highestInClass?`.
- Aggregate: `totalFull, totalObtained, percentage, division | overallGrade, gpa?, result,
  position?`.
- Context (resolved at projection, **referenced not owned**): `workingDays, presentDays,
  classSize` from the attendance domain; `height/weight` from a health/demographic snapshot.

### Layer 4 — Class statistics (cohort pass; schema now / compute V1.5, decision §4.8)
`highestInClass` (per-subject max) and `position` (rank by total) need a second pass after
all cards for an exam are written. Fields land now; the compute step is V1.5.

### Layer 5 — Presentation (separate epic)
Per-school customizable document/print service consumes Layer 3 — column selection,
branding, BS dates, signatures. Not in this epic; the domains above must be the *superset*
any PABSON card needs so the document layer is pure formatting.

### Observability for generation (decision §4.9 — no new infra)
`resultGenerationStatus` on the Exam (FE-visible) + a `ResultGenerationFailed` domain event
on the existing EventBridge bus. No CloudWatch alarm, no SNS topic; the DLQ already exists.
