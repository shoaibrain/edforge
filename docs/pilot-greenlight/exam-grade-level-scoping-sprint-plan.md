# Exam Grade-Level Scoping — Sprint Plan

**Status:** 🔲 PLAN (added to roadmap 2026-06-06 from first-pilot validation in
the Vercel preview of [edforge-saas-frontend#122/#123](https://github.com/shoaibrain/edforge-saas-frontend/pull/122).)
**Track:** Pilot data integrity / Ed-Fi grading-domain alignment.
**Depends on:** A.3 (Exam BE — CRUD, state machine, exam-courses, scores) and
A.4 (Result BE — ResultCard entity, result-batch Lambda) — both shipped to
prod. Exam Management FE Slice 2 ([#122](https://github.com/shoaibrain/edforge-saas-frontend/pull/122) /
[#123](https://github.com/shoaibrain/edforge-saas-frontend/pull/123)) — merged.
**Blocks:** Exam Management FE Slice 3 (EM-3.1 score sheet —
[#124 paused](https://github.com/shoaibrain/edforge-saas-frontend/pull/124)).
The score roster needs the grade-level filter that this sprint introduces.

---

## 0. Why this matters (PM framing)

The first-pilot operator-loop validation in Vercel preview surfaced three
cascading symptoms — all rooted in **one missing dimension** on the `Exam`
entity:

1. **Subjects picker shows the entire curriculum** (Grade 1 English, Grade 9/10
   Math, ECD program, all mixed together) when a class teacher creates a
   First Term Exam intended for a single class.
2. **Result Cards generate for every active enrollment in the academic year**
   when an exam closes — including ECD students given Grade 10-shaped result
   cards with subject totals they never sat for.
3. The Slice 3 score sheet (EM-3.1, [#124](https://github.com/shoaibrain/edforge-saas-frontend/pull/124)
   paused) would let an exam in-charge enter Grade 10 Math marks against ECD
   students; the mechanics are right, but the roster is sourced from
   "all active enrollments," which is wrong by design.

**Root cause:** `Exam` is keyed at `(school, academicYear, term)`. There is no
grade-level dimension. So every exam implicitly applies to every active
enrollment in the AY, and every subject in the catalog is offerable to it.

But in PABSON practice — and Nepal K-12 generally — exams are **per class /
per grade level**:

- **First Term Exam · Grade 2** is its own event with Grade 2 subjects,
  sat by Grade 2 students, producing Grade 2 report cards.
- **First Term Exam · Grade 8** is a separate event for Grade 8 with
  Grade 8 subjects, sat by Grade 8 students.

The current model cannot represent that. Without this scoping the operator
loop produces bad data (off-scope cards) on every term close.

---

## 1. The architectural decision — `Exam.gradeLevels: string[]`

Add a first-class **`gradeLevels: string[]` (≥1)** to `Exam`. Each entry must
be one of the school's `enabledGradeLevels` (validated server-side). Mutable
only while `exam.status === 'draft'` (mirrors `examType` mutability — the
existing grading-domain pattern).

A `string[]` (not a single grade) supports all three operational shapes that
PABSON schools actually run:

| Shape | `Exam.gradeLevels` | Use case |
|---|---|---|
| Single-class exam | `["2"]` | "First Term Exam · Grade 2" — the dominant K-8 case. |
| Grade-split exam | `["9","10"]` | NCF-OPMATH-G910 ("Optional Math · Grade 9/10 Split · Period 3") is enrolled by both Grade 9 and 10 students; one Final covers both. |
| School-wide exam | `school.enabledGradeLevels` | The no-narrowing case is still expressible — e.g., a school-wide sports-day "test event." |

This single field unlocks **three filter points** downstream that fix all the
symptoms in one stroke:

```text
Exam.gradeLevels = ["2"]                  First Term Exam · Grade 2
     ├─ Subjects picker → Course.gradeLevels ∩ Exam.gradeLevels  (non-empty)
     ├─ Score roster   → Enrollment.gradeLevel ∈ Exam.gradeLevels
     └─ Lambda roster  → same filter; only Grade 2 cards generated
```

---

## 2. Why not bind to `Section` directly?

A "purer" Ed-Fi alternative would bind exams to `Section` rows (the canonical
instructional grouping; carries grade levels, roster, and teacher). Rejecting
it for V1 because:

- **PABSON exams are per-grade-level campaigns**, not per-section. One
  "First Term Exam · Grade 2" covers **all** Grade 2 sections (2A, 2B, 2C, …)
  with one subject list and one paper. Section-binding would force the
  operator to create N exam objects for N sections.
- **Sections are single-course-scoped**; an exam covers multiple courses. So
  "Section as the exam unit" doesn't fit at the exam level — it fits at the
  per-course-grade level, which we already model via `Grade` in the classroom
  gradebook (the daily-marking flow that coexists with `Exam`).
- `gradeLevels: string[]` gets the operator-facing scope right with a single
  field, while preserving the existing exam-course-score-aggregation pipeline
  untouched.

Revisit only if PABSON practice shifts toward section-level exam papers — not
on V1's horizon.

---

## 3. Ed-Fi V6 alignment

Stays consistent with the prior domain-correction work:

- Our internal `Exam` belongs in the **Grading / Student Academic Record**
  domain (not the Assessment domain — that's for external BLE/SEE/NEB).
  `ResultCard` is the Ed-Fi `ReportCard` analogue, keyed `(student,
  gradingPeriod)`, and is **now grade-level-scoped at issuance** — preserving
  issuance-accurate semantics already established by RC-UX.1's
  `studentIdentity` snapshot.
- `Course.gradeLevels` is canonical Ed-Fi (`CourseLevelCharacteristic`
  analogue per [`grade-level-descriptor.ts`](../../packages/shared-types/src/ed-fi/descriptors/grade-level-descriptor.ts)).
- Ed-Fi `GradingPeriod` itself doesn't carry grade levels — but **operational
  term-exam events** absolutely do in real-world K-12. That's the
  operational-rollup gap that `Exam.gradeLevels` closes without violating the
  canonical Ed-Fi schema.

---

## 4. Tickets

### Backend

| Ticket | Repo | Scope | Notes |
|---|---|---|---|
| **ELS.1 (BE)** | edforge | **Schema**: add `gradeLevels: string[]` (≥1) to `Exam` entity, `createExamSchema`, `updateExamSchema`. Validate each entry against `gradeLevelDescriptorSchema` (catches typos). Service-layer checks each entry ∈ `school.enabledGradeLevels`. Publishes `@aibrains/shared-types`. | Foundation — gates ELS.2 / 3 / 6+. |
| **ELS.2 (BE)** | edforge | **Service guard** on `addExamCourse`: reject courses whose `gradeLevels[]` has no overlap with `exam.gradeLevels[]`. New error: 400 `EXAM_COURSE_GRADE_MISMATCH`. | Prevents bad subject attachment. |
| **ELS.3 (BE)** | edforge | **result-batch Lambda**: filter active enrollments by `enrollment.gradeLevel ∈ exam.gradeLevels` before aggregating. | **The data-integrity fix.** Stops future off-scope cards on every close. |
| **ELS.4 (BE)** | edforge | **Migration / backfill**: existing `Exam` rows default `gradeLevels = school.enabledGradeLevels`. Idempotent script; runs once per env. | Preserves legacy-row behavior; no historical card invalidation. |
| **ELS.5 (BE, V1.5)** | edforge | **Optional denorm**: copy `gradeLevels` onto `ResultCard` at generation time. Helps downstream IEMIS class-roster joins. | Deferrable. |

### Frontend (Exam Management FE)

| Ticket | Repo | Scope | Notes |
|---|---|---|---|
| **ELS.6 (FE)** | edforge-saas-frontend | **Create/Edit drawer**: multi-select picker for grade levels (sourced from `school.enabledGradeLevels`). Required for create. UI-locked outside Draft (mirrors backend). | Depends on ELS.1 published `shared-types`. |
| **ELS.7 (FE)** | edforge-saas-frontend | **Detail header**: grade-level chips next to exam type / term metadata so the scope is visible at a glance. | Small. |
| **ELS.8 (FE)** | edforge-saas-frontend | **Subjects tab**: course picker filters by grade-level overlap with `exam.gradeLevels`. Empty-state explains the case ("No courses match this exam's grade levels — add courses tagged for Grade 2 in Curriculum first"). | Depends on ELS.6. |
| **ELS.9 (FE)** | edforge-saas-frontend | **Scores tab (the EM-3.1 re-do)**: roster filters enrollments by `gradeLevel ∈ exam.gradeLevels`. Re-uses the score-entry mechanics from the paused [#124](https://github.com/shoaibrain/edforge-saas-frontend/pull/124). | **This unblocks Slice 3 to land clean.** |

**Dependencies / sequencing**:
ELS.1 → (ELS.2, ELS.3, ELS.4) in parallel → publish shared-types → (ELS.6 → ELS.7, ELS.8, ELS.9). ELS.4 is mandatory in the same release as ELS.3 so legacy exams don't suddenly produce zero-roster cards on re-close.

---

## 5. Acceptance (definition of done)

- A class teacher creating "First Term Exam · Grade 2" picks `gradeLevels:
  ["2"]`. Subjects picker shows only Grade 2-applicable courses; adding a
  Grade 8-only course is rejected. Scores tab roster shows only Grade 2
  enrollments. Closing the exam generates Result Cards **only** for Grade 2
  students.
- **Legacy exams** (created before this sprint) continue to behave as today
  (defaulted to all `enabledGradeLevels`). No card invalidation, no operator
  action required for existing data.
- **Grade-split exams** (`["9","10"]`) work end-to-end: subjects shared
  between Grade 9 and 10 are offerable, roster pulls Grade 9 + 10
  enrollments, cards generate for both.
- All filtering lives in one place per layer — no scattered `if (gradeLevel
  === '...')` branches in service or component code (consistent with the
  archetype-branching rule per [CLAUDE.md](../../CLAUDE.md)).

---

## 6. Out of scope (defer)

- **Re-aggregating historical result cards** under the new filter. Legacy
  rows keep their original scope; only new cards filter. Per the V1
  data-integrity guideline: never rewrite published artifacts.
- **Per-Section exam binding** (the Ed-Fi-purer alternative). Revisit only
  if PABSON practice shifts toward section-level exam papers.
- **External board exams** (BLE/SEE/NEB) — these live in the Assessment
  domain and are unaffected; they already carry their own grade-level
  constraints in `external-exam-*` schemas.
- **Grade-level migration on Enrollment promotion** — that's `D.2.10`
  (promotion) territory; this sprint only constrains exam scope at
  generation time.
