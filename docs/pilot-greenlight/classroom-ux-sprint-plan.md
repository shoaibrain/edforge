# Classroom UX Modernization — Sprint Plan

> **Status:** draft created 2026-06-05 after visual review of the live
> `edforge-saas-frontend` classroom screens and a route-to-component trace.
> **Scope:** tenant-facing MFE classroom experience for People/Add Students,
> Gradebook, and Attendance. Includes one confirmed persistence bug spanning
> frontend, shared contracts, and backend bulk section-attendance.

Primary URLs reviewed:

- `/academics/classrooms/:sectionId?tab=people`
- `/academics/classrooms/:sectionId?tab=progress&view=gradebook`
- `/academics/classrooms/:sectionId?tab=progress&view=attendance`

> **Security note:** a bearer token was included in the investigation prompt that
> seeded this plan. Treat it as exposed and **rotate/revoke it** if still valid.

---

## Executive Summary

The classroom pages are functionally coherent, but the visual systems are
inconsistent across adjacent daily-use workflows:

- The People roster already uses `TanstackDataTable` and DiceBear avatars, but the
  Add Students modal is a bespoke scroll list with weak information hierarchy and
  no avatar/grade/status affordances.
- The Add Students modal fetches active students and excludes already-enrolled
  ones, but it does not constrain candidates to the grade levels allowed by the
  section's parent course/curriculum.
- The Gradebook table is a custom native table with spreadsheet behavior but
  lacks the shared student-identity treatment, sticky scan anchors, and table
  affordances used elsewhere.
- The Attendance grid is a custom div grid with useful attendance-specific
  behavior, but it under-communicates student identity, uses a native reason
  dropdown, and has a confirmed reason-persistence bug.

The plan is sequenced around two rules:

1. **Fix data contracts before polishing UI that depends on them.**
2. **Build table shells and reusable identity primitives before rewriting
   behavior-heavy Gradebook and Attendance flows.**

---

## Current Render Path

```text
apps/shell/src/router.tsx
  /academics/$ -> lazy academics/AcademicsModule
apps/academics/src/bootstrap.tsx -> RouterProvider(basepath: /academics)
apps/academics/src/router.tsx -> /classrooms/$sectionId
apps/academics/src/routes/classrooms/$sectionId.tsx
  tab=people                      -> SectionRoster
  tab=progress&view=gradebook     -> ProgressTab -> SectionGradesTab -> GradebookGrid
  tab=progress&view=attendance    -> ProgressTab -> SectionAttendanceWrapper -> AttendanceGrid
```

Key change points:

- `apps/academics/src/components/common/StudentSelector.tsx`
- `apps/academics/src/components/scheduling/SectionRoster.tsx`
- `apps/academics/src/components/grades/GradebookGrid.tsx`
- `apps/academics/src/components/attendance/SectionAttendanceWrapper.tsx`
- `apps/academics/src/components/attendance/AttendanceGrid.tsx`
- `apps/academics/src/components/attendance/AttendanceRow.tsx`
- `apps/academics/src/services/academics.service.ts`
- `packages/ui/src/components/data-table/DataTable.tsx`
- `packages/shared-types/src/schemas/academics/section-attendance.schema.ts`
- `server/application/microservices/academics/src/section-attendance/section-attendance.service.ts`
- `server/application/microservices/academics/src/common/mappers/section-attendance.mapper.ts`

---

## Attendance Reason Root Cause

**Verdict: a frontend + backend contract gap on the bulk section-attendance path.**
The UI captures an attendance reason as `excuseType`, but bulk save strips it
before it reaches the server; the shared bulk schema does not allow reason
fields; the backend bulk handler never writes `entity.reason`, and its update
path passes `record.notes` into Ed-Fi descriptor derivation instead of the reason.

Frontend breakpoints: `AttendanceRow.tsx` captures `excuseType`;
`AttendanceGrid.tsx` initializes `excuseType` undefined, ignores it in dirty
detection, and omits it from `handleSave`; `SectionAttendanceWrapper.tsx` maps GET
records to `{ studentId, status, notes }` (drops `excuseReason`) and passes only
those to bulk save + offline persistence; `useOfflineAttendance.ts` stores/flushes
only `studentId/status/notes`; `academics.service.ts` `BulkSectionAttendanceRecord`
lacks `excuseReason`/`excuseType`.

Shared contract breakpoint: `bulkSectionAttendanceRecordSchema` allows
`studentId/studentName/status/checkInTime/notes` but not `excuseReason`/`excuseType`.

Backend breakpoints: single-record `recordSectionAttendance` writes
`reason: dto.excuseReason` and derives descriptors from it, but bulk create does
not set `reason`, bulk update does not update `reason`, bulk update calls
`populateEdFiDescriptors(record.status, record.notes)`, bulk no-op detection
ignores reason-only changes, and the concurrent-create fallback repeats the bulk
update issue. Read path `sectionAttendanceEntityToDto` already maps
`excuseReason: entity.reason` — so once bulk writes `reason`, GET returns it.

---

## Cross-Sprint Conventions

- Every ticket is small enough for one focused commit, with a `Validation` line.
- Frontend tickets start with a URL-to-component trace in the PR body.
- Backend route additions honor three-way registration (controller,
  `tenant-api-prod.json`, `nginx.template` for new prefixes).
- Shared-types minor bumps require consumer pin bumps in the same PR (`^0.x` does
  not float to the next minor). Do not widen the `zod ~3.24.4` pin / `<3.25.0` fence.
- Do not rely on client-only eligibility filtering for enrollment correctness.
- School grade labels are school-first local labels — do not canonicalize them to
  reporting descriptors for classroom eligibility.
- No frontend test files were found during the audit; the first FE test ticket
  establishes the smallest acceptable harness rather than assuming one exists.

---

## Sprint 1 — Attendance Reason Persistence

**Goal.** The reason selected in the Attendance UI persists through save, refresh,
backend storage, and Ed-Fi descriptor derivation.
**Demo.** Mark a student absent, choose a reason, save, refresh → the same reason
hydrates; GET returns `excuseReason`; the Ed-Fi category/reason reflect the
selected reason instead of defaulting to unexcused.

- **1.1 Shared schema accepts reason fields** — add `excuseType`/`excuseReason` to
  `bulkSectionAttendanceRecordSchema`; tests for valid/invalid bulk reason payloads.
- **1.2 Backend bulk create persists reason** — normalized reason per record
  (`excuseReason` ?? `excuseType`); pass `reason` to `createSectionAttendanceEntity`;
  `populateEdFiDescriptors(status, reason)` (not notes). Jest spec.
- **1.3 Backend bulk update persists reason + detects reason-only changes** —
  include `existing.reason` in no-op detection; `reason = :reason` in the update
  expression; descriptors from reason. Jest specs (no-reason→medical, reason-only
  change increments, true no-op).
- **1.4 Concurrent-create fallback uses the same reason logic.** Jest spec.
- **1.5 FE service types** — add `excuseType?`/`excuseReason?` to
  `BulkSectionAttendanceRecord`. *(needs the shared-types publish + FE pin bump)*
- **1.6 FE AttendanceGrid** — include reason in `existingRecords`, init/backfill
  `excuseType`, include in `hasChanges` + dirty filtering, map to bulk payload as
  `excuseReason`.
- **1.7 FE wrapper + offline cache carry reason** — GET mapping, `persistLocally`,
  localStorage, manual/autosave/reconnect flush, correction fallback.
- **1.8 Smoke** — bulk-save absent + reason, GET, assert `excuseReason` matches and
  descriptors are not derived from notes.
- **1.9 Shared package + consumer pin hygiene** — bump consumers in the same PR;
  preserve `zod` pins.

---

## Sprint 2 — Student Identity UI Foundation

**Goal.** A reusable `StudentIdentityCell` (DiceBear avatar, name, student number,
grade badge, optional status) used across roster, selector, gradebook, attendance.
Tickets: 2.1 ownership decision (prefer `packages/ui` only if app-agnostic);
2.2 build the component; 2.3 apply to People roster; 2.4 establish the minimal FE
test harness (Vitest + Testing Library) with one smoke test.

---

## Sprint 3 — Eligible Add Students Selector

**Goal.** Add Students becomes an eligibility-aware, TanStack-backed selector that
only offers valid students for the section's parent course/curriculum and explains
why. Tickets: 3.1 eligible-grade source of truth; 3.2 expose/resolve section
eligible grade levels; 3.3 backend multi-grade student filtering (no first-page
client filtering); 3.4 **server-enforced** enrollment grade guard; 3.5 eligible
students hook; 3.6 TanStack selector shell; 3.7 capacity + bulk enroll footer;
3.8 eligibility empty/exclusion states; 3.9 route smoke.

---

## Sprint 4 — Gradebook Table Modernization

**Goal.** Scan-friendly, avatar-based gradebook preserving inline editing/keyboard
behavior. Tickets: 4.1 read-only TanStack row/column model (+ merge adapter test);
4.2 sticky student identity column; 4.3 assignment header metadata; 4.4 restore
inline editing on TanStack cells; 4.5 loading/empty/error states; 4.6 a11y pass.

---

## Sprint 5 — Attendance Table Modernization

**Goal.** A professional daily-use attendance table with consistent identity,
polished status/reason controls, and reason-safe draft/save. Tickets: 5.1 TanStack
row model (behavior-equivalent first); 5.2 identity column; 5.3 polished status
controls; 5.4 reason dropdown/combobox; 5.5 reason-safe dirty state + row save
feedback; 5.6 bulk actions + filters; 5.7 E2E smoke.

---

## Sprint 6 — Polish, Accessibility, Rollout Validation

6.1 visual regression capture set; 6.2 responsive layout audit; 6.3 keyboard +
screen-reader audit; 6.4 performance check (30/100-student data sets);
6.5 classroom UX closeout runbook.

---

## Backlog / Deliberate Non-Goals

Full mobile classroom redesign; parent/student portal table adaptations; gradebook
export/print polish beyond basic modernization; advanced virtualization unless
perf-proven; replacing every academics table with TanStack in this effort; new
avatar-upload/profile-photo features (this plan uses existing DiceBear identity).

---

*Plan authored 2026-06-05 from a live visual review + route-to-component trace, and
revised after a review-subagent pass: fix contracts before UI polish, enforce
eligibility server-side, avoid first-page client filtering, and split table
rewrites into shell vs. behavior tickets.*
