# Exam Management FE (Slices 2 & 3) — Sprint Plan

**Status:** 🔲 PLAN (added to roadmap 2026-06-06 from first-look feedback on the
shipped Exams surface — exam list has no edit/close/score-entry UI)
**Track:** Exam → Result → Report-Card FE — **the orphaned middle** (between
Slice 1 *list + create* and Slice 4 *result cards* / the RC-UX.* tail)
**Depends on:** **Nothing new — the backend is fully shipped.** A.3 (Exam BE:
CRUD, status state machine, exam-courses, single + bulk scores) and A.4 (Result
BE) are in prod. Every gap below is a **missing frontend surface only**.

---

## 0. Why this matters (PM framing)

The exam→result operator loop is **broken in the middle.** Today an exam
in-charge can *create* an exam (Slice 1) and *view* result cards *after they
somehow exist* (Slice 4), but there is **no UI for everything in between**:
editing the exam, attaching subjects, entering marks, and **closing** the exam.
The product literally instructs the operator — in the Result Cards empty state —
to *"Close the exam after all scores are entered,"* while offering **no button to
enter scores or close the exam.**

Two consequences make this the highest-leverage FE work on the board:

1. **A school cannot actually run a term.** The exam in-charge has no way to drive
   an exam from `draft` to `published`. The feature is a façade without this.
2. **It self-validates the result-card work we just shipped.** Closing an exam
   (`in_progress → closed`) is the *exact* EventBridge trigger that fires the
   result-batch Lambda, which **generates the ResultCards and writes the
   `studentIdentity` snapshot** (RC-UX.1). So the **Close Exam control is
   simultaneously the operator's "generate results" button and the only *organic*
   way to produce a card that proves RC-UX.1 / RC-UX.2 (names & faces) work** —
   no manual prod poke required.

This sprint is **pure wiring of a 100%-shipped backend.** No new endpoints, no
new IAM, no new infra (one optional BE hardening item, EM-3.3, called out below).

---

## 1. What's missing today (gap, code-confirmed)

Every row has a **live** backend endpoint (in the API Gateway spec + reachable
through nginx's `^/academics` block) and **no** frontend surface.

| # | Gap (FE-missing) | Backend endpoint (shipped + live) |
|---|---|---|
| 1 | **Edit an exam** | `PATCH /academics/exams/{examId}` (examName/examType/dates/description) |
| 2 | **Status transitions / Close** | `PATCH /academics/exams/{examId}/status` `{targetStatus, notes?}` |
| 3 | **Manage subjects (exam-courses)** | `POST·GET·PATCH·DELETE /academics/exams/{examId}/courses` |
| 4 | **Enter scores** | `POST …/scores` (single) · `POST …/scores/bulk` (≤250) · `GET·PATCH …/scores` |
| 5 | **Exam detail view** | *(no backend — a FE shell composing the above)* |

Today a row-click on the exam list jumps **straight to the Result Cards drawer**
(`ExamTable.tsx` → `onSelectExam` → `ResultCardsDrawer`), skipping the entire
management surface. The FE service has only `getExams` / `getExamPattern` /
`createExam` (+ the four result-card fns); **no** `updateExam`, status,
exam-course, or score methods exist.

---

## 2. Architecture — the state machine **is** the spec

The backend status guards dictate the UX sequencing. The FE must mirror them so
the operator is never offered an action that 409s.

**Status enum (`exam.schema.ts`):** `draft | scheduled | in_progress | closed | published`

**Transition table** (`exams/exam-state-machine.ts:44` `ALLOWED_EXAM_TRANSITIONS`):

```
draft        → scheduled
scheduled    → draft, in_progress
in_progress  → scheduled, closed
closed       → published
published    → (terminal)
```

Invalid jumps → **409 `EXAM_STATE_INVALID_TRANSITION`**; same-state → 200 no-op.

**Action-gating guards (FE must enforce the same, for UX — backend is the source of truth):**

| Capability | Allowed while status ∈ | Backend guard / error if violated |
|---|---|---|
| Add/edit/remove **exam-courses** | `draft`, `scheduled` | `acceptsExamCourseMutations` → 409 `EXAM_LOCKED` |
| Write **scores** | `scheduled`, `in_progress` | `acceptsScoreWrites` → `draft`:`EXAM_NOT_SCHEDULED`, `closed`/`published`:`EXAM_LOCKED` |
| **Close** (generate cards) | `in_progress` → `closed` only | state machine |

**The operator pipeline this produces:**

```
 draft ──▶ scheduled ──▶ in_progress ──▶ closed ──▶ published
   │  add/edit subjects  │  enter scores   │  cards     (cards published
   └─────────────────────┘────────────────┘  generate   per RC-UX)
        (subjects lock once started)   (scores lock once closed)
```

**Route shape (the key structural decision):** introduce a dedicated exam-detail
route **`/academics/exams/$examId`** as a tabbed shell — **Overview · Subjects ·
Scores · Result Cards.** This:

- replaces the "row-click → result-cards drawer" shortcut with a real command
  center, and
- gives **RC-UX.3** (promote result cards to a full page) its natural parent —
  the "Result Cards" tab *is* RC-UX.3's `…/result-cards` surface. **One detail
  route serves both sprints**, avoiding a second drawer→page migration later.

**Gotchas carried from the contract:**
- `schoolId` is a **required query param** on exam get/update/status/delete and
  score list/bulk — thread it everywhere (the store already holds it).
- Every result-card call needs **`enrollmentId` alongside `cardId`** (already
  handled in Slice 4 — keep the pattern).
- Score payloads key on **`examCourseId` + `enrollmentId`**, not `studentId`;
  the score sheet is `roster (enrollment) × subject (examCourse)`.

---

## 3. UX direction (designer framing)

- **Exam detail = a command center, status-aware.** A **status pipeline**
  (stepper: Draft → Scheduled → In&nbsp;Progress → Closed → Published) shows where
  the exam is and surfaces **only the legal next action(s)** as primary buttons
  (Schedule / Start / Close / Publish / Reopen). Illegal transitions are not
  rendered; gated actions (e.g. "add subject" once started) are disabled with a
  one-line *why* ("Subjects lock once the exam starts").
- **Overview tab:** exam metadata + inline **Edit** (the Slice-1 create fields),
  the status pipeline, and a readiness summary (# subjects, # scores entered).
- **Subjects tab:** add subjects from the school's curriculum (course picker) with
  `maxMarks` / `passingMarks` (default 32) / `creditHours`; remove; locked
  read-only once status ∉ {draft, scheduled}.
- **Scores tab:** a **score sheet** — roster rows × subject columns (or
  subject-at-a-time for density), inline numeric entry with `rawScore ≤ maxMarks`
  validation, **bulk save** (chunk ≤250) + single-cell `PATCH`. Visible only when
  the exam accepts score writes; explains the lock otherwise.
- **Close Exam** is the prominent **terminal CTA** on `in_progress`, behind a
  confirm that states what it does ("generates result cards; subjects & scores
  lock"). After close, the **Result Cards tab** shows a "cards generating…" state
  and then populates (Lambda is async).
- **Result Cards tab:** the existing Slice 4 surface, re-homed here (and the seam
  RC-UX.3+ polishes).

---

## 4. Tickets (sequence)

### Slice 2 — Exam Management (detail + edit + status + subjects)

| Ticket | Repo | Scope | Notes |
|---|---|---|---|
| **EM-2.1** | FE | **Exam detail route** `/academics/exams/$examId` — tabbed shell (Overview · Subjects · Scores · Result Cards) + **Overview** (read `GET /exams/{id}`, status pipeline). Re-point exam-list row-click → detail route; move the existing result-cards view into the "Result Cards" tab. | Unblocks the rest **and RC-UX.3**. |
| **EM-2.2** | FE | **Edit exam** — `PATCH /exams/{id}`; reuse `ExamDrawer` in an edit mode (currently create-only) for examName/examType/dates/description. | Small. |
| **EM-2.3** | FE | **Status transitions** — `PATCH /exams/{id}/status`; guard-aware action buttons. Mirror `ALLOWED_EXAM_TRANSITIONS` client-side for which buttons to show; backend stays source of truth (handle 409 gracefully). Schedule / Start / Reopen / (Close lives in EM-3.2). | Core of the loop. |
| **EM-2.4** | FE | **Subjects (exam-courses)** — `POST·GET·PATCH·DELETE …/courses`; course picker from curriculum + maxMarks/passingMarks/creditHours; lock when status ∉ {draft, scheduled}. | |

### Slice 3 — Score Entry & Close (generate results)

| Ticket | Repo | Scope | Notes |
|---|---|---|---|
| **EM-3.1** | FE | **Score sheet** — `POST …/scores` + `POST …/scores/bulk` (chunk ≤250) + `PATCH …/scores/{id}`; roster×subject grid; `rawScore ≤ maxMarks` validation; gated to {scheduled, in_progress}. | Makes cards carry real marks (cures the `0/200` Slice-4 cards). |
| **EM-3.2** | FE | **Close Exam** — `PATCH /status {targetStatus:'closed'}`; terminal CTA + confirm; post-close poll/populate the Result Cards tab. | **This is the organic RC-UX.1/2 smoke.** |
| **EM-3.3** | BE *(optional, recommended pull-forward)* | **Deterministic `cardId = hash(tenantId, examId, enrollmentId)`** to fix the known ResultCard **duplicate-generation** bug (EventBridge at-least-once + non-deterministic id → e.g. 20 cards for 10 enrollments; `sprint-closeouts.md:90`). | Slice 3 is exactly when Close gets exercised at scale — fix it here, not in V1.5, or the first real term-close shows dupes. |

**Dependencies:** EM-2.1 gates everything (the shell). Slice 2 before Slice 3
(status machine + subjects must exist before scores/close are meaningful).
EM-2.1 also unblocks **RC-UX.3**. All FE except EM-3.3 (one BE Lambda change,
deploys via `tenant-template-stack-basic`).

**Out of scope (V1.5+ or other sprints):** the result-card surface polish
(names/faces/PDF/bulk-publish = the **RC-UX.*** sprint, downstream);
external/board-exam registration/results (backend **not** shipped — no
controllers); class/section rank; re-aggregation on post-publish score
correction.

---

## 5. Acceptance (definition of done)

- An exam in-charge can take an exam **draft → published entirely through the
  UI**: create → add subjects → schedule → start → enter scores → **close (cards
  generate)** → publish.
- The status pipeline offers **only legal transitions**; subjects lock after
  start and scores lock after close — **matching the backend guards, with zero
  409 surprises** surfaced to the operator.
- A score sheet saves single + bulk marks with `rawScore ≤ maxMarks` validation.
- **Closing an exam organically generates ResultCards carrying `studentIdentity`**
  — validating RC-UX.1 / RC-UX.2 end-to-end with no manual event injection.
- One exam-detail route (`/academics/exams/$examId`) hosts the loop and gives
  RC-UX.3 its home (no second drawer→page migration).
