# A.3.1 — Curriculum / Course Extension Readiness Audit

> **Drafted:** 2026-05-22
> **Purpose:** Confirms that Sprint A.2 foundation is in place before Sprint A.3 (Exam Subsystem Backend) ships entities that reference Course rows.
> **Companion docs:** [`a2-sprint-plan.md`](./a2-sprint-plan.md), [`a3-sprint-plan.md`](./a3-sprint-plan.md), [`sprint-closeouts.md`](./sprint-closeouts.md)

---

## What A.3 needs from Course

| A.3 use | Course field needed | Why |
|---|---|---|
| `ExamCourse.courseId` FK | `Course.courseId` | Each ExamCourse references an existing Course row in the school's catalog |
| Denormalized `ExamCourse.academicSubject` (A.2 descriptor) | `Course.academicSubject` | A.4 term-aggregation rolls scores up by descriptor (dashboard view "math overall"); BLE/SEE result-import (D.4.6 / D.5.4) joins on same descriptor |
| Denormalized `ExamCourse.courseName` + `ExamCourse.courseCode` | `Course.courseName` + `Course.courseCode` | Operator-facing display + audit log readability |
| `Exam` validation against `archetypeDefaults[archetype].examPattern` | (n/a — read from ArchetypeDefaults, not Course) | `examType` enum membership constrained by the school's archetype |

## Readiness check

### ✅ Sprint A.2 — Course Extension shipped to prod 2026-05-22

Per closeout entry in [`sprint-closeouts.md`](./sprint-closeouts.md):
- **A.2.1** — `Course` entity extended with `academicSubject` (`AcademicSubjectDescriptor` enum, 15 values) + `stateSubjectCode?` + `curriculumRef`. shared-types `0.56.0` on npm.
- **A.2.2** — `createCourse` + `updateCourse` in `courses.service.ts` pass through the 3 new fields. Zod pipe enforces enum membership.
- **A.2.3** — `subject-area-mapper.ts` provides one-way `AcademicSubjectDescriptor → SubjectArea` (Ed-Fi V6 rollup) for the 15 descriptor values.
- **A.2.4** — `PABSON_COURSE_CATALOG` (21 templates, Grades 4-10) lives in `@aibrains/shared-types/archetype/pabson-courses`.
- **A.2.5** — Backfill executed on `dev-pabson-primary` school `4209e3d8-d2e2-4e0e-9961-790341c264f4`: **17 CREATE + 4 PATCH all OK; idempotency proven on re-run (19 SKIP + 2 documented WARN, 0 spurious writes)**.

### Verification

Confirmed via authenticated `GET /academics/courses?schoolId=4209e3d8-...` against prod:
- 21 Course rows present (catalog-aligned)
- 19 rows carry `academicSubject` populated (the 2 WARN candidates `NCF-MATH-G910` + `NCF-OPMATH-G910` each have correct distinct `academicSubject` values; the matcher's grouping limitation is a known artifact, not a data integrity issue)
- All rows carry `curriculumRef: 'CDC_NCF_2076'`

## Ready for A.3 — `dev-pabson-primary` only (per CEO 2026-05-22)

| Smoke target | Status | Readiness |
|---|---|---|
| `dev-pabson-primary` tenant `21aea5da-...` school `4209e3d8-...` | ✅ has 21 PABSON-shaped Course rows with new fields | **READY** — A.3.11 smoke runs here |
| Prod Saraswati tenant `34f49822-…` | ❌ NO Course data yet (operator-led when they're ready for Term-1 exam workflow) | **OUT OF SCOPE for A.3.11 smoke** per CEO 2026-05-22 |
| Other prod tenants | ❌ no PABSON Course catalog (would need separate per-tenant backfill) | **OUT OF SCOPE — not pilot-blocking** |

## Follow-ups (not A.3-blocking)

- **Prod Saraswati Course catalog seeding** — when Saraswati's operator onboards Term-1 exam workflow, either:
  - Run `scripts/backfill-pabson-courses.ts` with prod Saraswati `TENANT_ID` + `SCHOOL_ID`, OR
  - Operator creates courses via AdminWeb / UI (when wired)
- **`NCF-MATH-G910` ↔ `NCF-OPMATH-G910` WARN edge case** — documented in [`a2-sprint-plan.md`](./a2-sprint-plan.md) §4 A.2.4 + script docstring. Both rows correctly exist with distinct `academicSubject` values. The matcher's grouping by `(subjectArea, gradeLevels)` cannot disambiguate them but the data is correct.

## A.3 is unblocked

A.3 Phase 2 (academics service) can proceed against `dev-pabson-primary` with confidence that:
1. Course rows exist with the new fields populated
2. `Course.academicSubject` denormalization into `ExamCourse` will surface real curriculum-specific values (not undefined)
3. A.3.11 smoke has a working pilot target

---

**Audit committed:** 2026-05-22. **Status:** ✅ A.2 foundation confirmed; A.3 unblocked for `dev-pabson-primary` execution.
