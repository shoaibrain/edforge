# Result Card UX & Identity-Resolution — Sprint Plan

**Status:** 🔲 PLAN (added to roadmap 2026-06-05 from first-look feedback on the
Exam→Result FE Slice 4, [edforge-saas-frontend#119](https://github.com/shoaibrain/edforge-saas-frontend/pull/119))
**Track:** Exam → Result → Report-Card FE (follows Slice 4)
**Depends on:** A.4 (ResultCard backend), exam-score entry (FE Slice 3), the
C-epic PDF service for the print/PDF ticket.

---

## 0. Why this matters (PM framing)

The **Result Card is EdForge's flagship student-facing artifact.** In a PABSON
school it is the *official, published* record of a student's term performance —
the मार्कशीट / report card that is printed, signed by the class teacher and
principal, handed to the guardian, and archived. It is a high-ceremony,
high-trust document.

The people who operate this surface — **class teacher / exam in-charge,
principal** — think in **names and faces**, organized by **section and roll
number**: *"Section 8A, roll 12, Aarav Sharma."* They do not think in UUIDs.
Downstream, **guardians** receive the published card.

Slice 4 proved the *data path* end-to-end (per-course grades, GPA, conduct +
class-teacher remark, terminal publish, Ed-Fi ReportCard semantics). But it
renders like a **database table**, not a report card: raw `studentId` UUIDs in a
too-narrow drawer. That is correct as a contract-first first cut and an honest
stopgap (`UuidBadge`), but it is not a shippable operator experience. This sprint
makes the surface **human, document-grade, and elegant.**

---

## 1. What's wrong today (Slice 4 as shipped)

| # | Problem | Why it's wrong for the user |
|---|---|---|
| 1 | **Identity is a UUID.** Cards show `studentId` (`UuidBadge`) | A business user cannot act on `7745349a…98a0`. They need legal name (+ preferred name), grade level, section + roll/EMIS no., and a face. |
| 2 | **Surface is a narrow slide-over** (`max-w-2xl`) | Both the roster list and the report-card document are cramped. A report card is a *document*, not a side panel. |
| 3 | **List is a dense identifier table** | No avatar, no name, no section grouping, no search/filter/sort, no pass/fail lens. Unscannable at a class's worth of rows (30–40+). |
| 4 | **Detail is not document/print-grade** | The card is printed + PDF'd for guardians; the current detail has no school header, identity block, or print layout. |
| 5 | **No bulk operations** | Publishing 200 cards one-by-one is unrealistic for a real term close. |
| 6 | **`window.confirm` for publish** | Functional + accessible, but a browser-native confirm is jarring for the single most consequential (irreversible) action in the domain. |

> Note: most cards currently read `0/200` because the upstream **score entry**
> (FE Slice 3) isn't built yet — the A.4 smoke only scored a couple of students.
> That is *expected*, not a Result-Card bug, but it underlines that Slice 3 is the
> prerequisite for *meaningful* cards.

---

## 2. Architecture — identity resolution (the key decision)

`ResultCard` carries only `studentId` (UUID) + `enrollmentId`. To render a human
card we need: **legal + preferred name, grade level, section name, roll number,
EMIS/symbol identifier, photo reference.** Two options:

**(A) Backend denormalization at generation time — RECOMMENDED.** The
result-batch Lambda (which already resolves `studentId` from `Enrollment` at
aggregation — the **R42 mitigation**: bulk-written `ExamScore` rows may carry an
`'unknown'` studentId placeholder, so the card takes the real id from
`Enrollment`) also writes a frozen **`studentIdentity`**
block onto the `ResultCard`: `{ legalName, preferredName?, gradeLevel,
sectionId, sectionName, rollNumber?, emisStudentId?, photoUrl? }`.

- **Correctness:** a *published* report card is an immutable legal document; the
  student's name/grade/roll/photo must be captured **as of issuance** (the Ed-Fi
  `ReportCard` is a grading-period snapshot). If the student later transfers
  section or their name is corrected, the issued card must still read as printed.
- **Performance:** no N+1 lookups at render (one exam = 30–200 cards).
- **Cleanliness:** keeps the FE simple and identifier-leak-free; extends the
  existing denormalization pattern (`courseScores[].academicSubject` — **Invariant 2**,
  copy render-time fields onto the row so the renderer needs no extra GetItem).

**(B) Frontend resolution (batch student fetch + client join)** — faster to ship
but N lookups/exam, request fan-out, no snapshot guarantee (name can drift from
the issued document). Use only as an interim if (A) slips.

**Decision: (A).** The `UuidBadge` in Slice 4 is the explicit stopgap until the
denormalized identity lands.

> Archetype note: display the identity via `@edforge/archetype`
> `EntityIdDisplay` (EMIS/symbol-aware for PABSON), not raw IDs. The schema stays
> archetype-blind; only the *display* is archetype-aware (Core/Edge discipline).

---

## 3. UX direction (designer framing)

- **Promote from a narrow drawer to a full surface.** A dedicated route
  `/academics/exams/$examId/result-cards`, master–detail: a **roster list** with
  room to breathe + a **report-card preview**. Matches the gravity of the
  artifact (and the existing full-page `/classrooms/report-card`).
- **Roster rows are human:** avatar (photo, else a deterministic
  initials-avatar) + **legal name** (preferred in parens) + **grade · section ·
  roll**; GPA / overall grade / status as secondary. Group + sort by **section
  then roll**; filter by **status** (draft/published) and **pass/fail**; search
  by **name / roll**.
- **Detail = a real report card:** school header + logo, student identity block,
  per-subject table, GPA + overall grade, conduct + class-teacher remark,
  issued/published metadata. **Print-ready**, and wired into
  `@aibrains/pdf-renderer` + the PDF service (as admit cards already are) for the
  guardian-facing PDF.
- **Bulk publish** ("Publish all draft cards for this exam") with the
  terminal-publish guardrails and a confirm summarizing the count.
- **Replace `window.confirm`** for publish with a proper confirmation modal that
  states the irreversibility (this is the domain's most consequential action).
- **Convergence:** fold the legacy grade-derived `/classrooms/report-card`
  printable into this official `ResultCard` surface so EdForge has **one** report
  card concept (official + publishable), not two.

---

## 4. Tickets (sequence)

| Ticket | Repo | Scope | Notes |
|---|---|---|---|
| **RC-UX.1** | edforge (BE) | Denormalize `studentIdentity` (legal/preferred name, gradeLevel, section, roll, EMIS, photoUrl) onto `ResultCard` at Lambda generation + entity + shared-types schema + backfill script | **Unblocks 2–5.** Frozen-at-issuance snapshot. |
| **RC-UX.2** | frontend (FE) | Roster-row list: avatar + name + grade·section·roll, via `EntityIdDisplay`; retire the `UuidBadge` table | Depends on RC-UX.1. |
| **RC-UX.3** | FE | Promote to full-page `/exams/$examId/result-cards` master–detail; widen / retire the narrow drawer | Depends on RC-UX.2. |
| **RC-UX.4** | FE | Search (name/roll) + filter (status, pass/fail) + sort/group (section, roll) | Depends on RC-UX.1 (needs names/roll/section to search + group on). |
| **RC-UX.5** | FE (+ C-epic) | Document/print-grade report-card layout + guardian PDF via `@aibrains/pdf-renderer` / PDF service | Depends on RC-UX.1 (identity block on the card) + the PDF service (C epic). |
| **RC-UX.6** | BE + FE | Bulk "publish all drafts" per exam, idempotent, with terminal-publish guardrails | |
| **RC-UX.7** | FE | Custom publish-confirmation modal (replace `window.confirm`); state irreversibility | Small; can ride RC-UX.3. |
| **RC-UX.8** | FE | Converge legacy `/classrooms/report-card` into the official `ResultCard` surface | Cleanup; after 2–5 land. |

**Dependencies:** RC-UX.1 gates 2/3/4/5. RC-UX.5 depends on the C-epic PDF
service. The upstream **exam-score entry (FE Slice 3)** is what makes cards carry
real marks — schedule it before/with this sprint so the UX is validated against
non-zero data.

**Out of scope (V1.5+):** class/section rank computation (`classRank` /
`sectionRank` are `null` in V1), re-aggregation on post-publish score correction,
guardian-portal delivery of the published PDF.

---

## 5. Acceptance (definition of done)

- A class teacher opens an exam's result cards and sees a **named, sectioned,
  searchable roster** with faces — zero UUIDs.
- Opening a card shows a **document-grade report card** that matches what will be
  printed/PDF'd, with the student's identity **as of issuance**.
- Conduct + remark edit and **publish** (single + bulk) work with clear,
  non-jarring confirmation; published cards are read-only.
- One report-card concept across EdForge (official `ResultCard`), legacy
  printable retired.
