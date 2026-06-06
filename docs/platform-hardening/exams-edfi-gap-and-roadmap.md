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

```
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
| 1 | **Subject renders `unknown`** | `exam-courses.service.ts addExamCourse` denormalizes only the *optional* `course.academicSubject`; a course with the *required* `subjectArea` only → `undefined` → stripped by `removeUndefinedValues:true` (`dynamodb-client.service.ts:44`) → Lambda `ec.academicSubject ?? 'unknown'` (`handler.ts:343`) | AcademicSubjectDescriptor on Course | **0 (bug)** |
| 2 | **Silent generation failure** | Lambda throw → DLQ → CloudWatch alarm with **no SNS action**; Exam stays `closed` with no cards and no operator signal | ops | **0** |
| 3 | **Tombstone was mutable** | ✅ fixed in `a244196` (8 mutation gates + active-only list + gsi1sk refresh) | n/a | **0 (done)** |
| 4 | **Ungraded student → 0/100 “E” (fail)** | `term-aggregation.ts` iterates every grade-enrollment; no score → 0% → letter `E` | A Grade is recorded only where a section grade exists; missing ≠ fail | **1 (policy)** |
| 5 | **`isActive` exposed in DTOs** | `result-card.schema.ts` (and peers) include `isActive` in the response | Ed-Fi has no `isActive`; uses association end-dates | **1** |
| 6 | **No Section anchor on grades** | `exam.entity.ts` Exam = `schoolId+ay+term+gradeLevels[]` (no `sectionId`/`courseOfferingId`); `handler.ts:370-383` aggregates school `Enrollment`, not `SectionEnrollment` | Grade ⇒ StudentSectionAssociation (required) | **2 (cert)** |
| 7 | **No active mappers** for ReportCard, StudentSectionAssociation, GradingPeriod | only the StudentSchoolAssociation mapper exists; ResultCard→ReportCard is doc-only | SIS v5 requires section-enrollment CRUD | **2** |
| 8 | **SectionEnrollment ⊥ school Enrollment** | `section-enrollment.entity.ts` is a standalone join; nothing enforces an active school Enrollment, or that its date window sits within the SSA window | SSA-section window ⊆ SSA window | **3** |
| 9 | **CourseOffering sparse; GradingPeriod implicit** | Sections reference `Course` directly; `termId` is the only grading-period notion (no entity/mapper) | CourseOffering + GradingPeriod are first-class | **3** |

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

---

## 5. Roadmap

### Phase 0 — ship what's done
- Deploy `a244196` (tombstone gate + active-only list + gsi1sk refresh + tests) via the
  MAC/pipeline: academics ECR push + `tenant-template-stack-basic` (Lambda guard-split).
  `cdk diff` expected to be Lambda-code + metadata only. Re-validate a fresh close.

### Phase 1 — correctness & semantics (this sprint)
- **1a. Subject fix.** Denormalize `subjectArea` onto `ExamCourse` (always present);
  card subject label = `academicSubject ?? subjectArea`. Update
  `createExamCourseEntity` + `addExamCourse` + the ExamCourse DTO + the Lambda
  aggregation + `result-card` rendering. Optional one-off backfill of existing
  ExamCourse rows missing the subject. *Decision-independent; safe to start immediately.*
  Deploy: academics ECR + Lambda.
- **1b. Ungraded → "Absent / Not Graded"** (decision §4.1). Introduce an explicit
  un-scored course-row state in `term-aggregation.ts` (do not compute 0%→E); surface it
  in the ResultCard schema + UI. Add aggregation tests for the absent path.
- **1c. `resultGenerationStatus` backbone.** Add `resultGenerationStatus`
  (`pending | generated | failed`), `resultsGeneratedAt`, `lastGenerationError` to the
  Exam entity; Lambda writes outcome after the batch; FE renders "pending / failed"
  instead of an empty/zeroed card. Wire the SNS action on the result-batch
  FailedInvocations alarm (close gap #2). Deploy: academics + `tenant-template-stack-basic`.
- **1d. Stop exposing `isActive`** in operator response DTOs; document the two axes
  (this doc §3 + a CLAUDE.md note).

### Phase 2 — Ed-Fi grading projection (certification foundation; decision §4.2)
- **2a. GradingPeriod mapper** — project `Term` (`termId`, with `examStartDate`/`examEndDate`)
  → Ed-Fi `GradingPeriod` (+ `GradingPeriodDescriptor`).
- **2b. Subject-grade synthesis** — at export, for each (gradeLevel × ExamCourse subject)
  manufacture `Course "Grade N <Subject>"` (+ `AcademicSubjectDescriptor`),
  `CourseOffering`, and one `Section`.
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
