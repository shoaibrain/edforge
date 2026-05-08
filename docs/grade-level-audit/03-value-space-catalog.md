---
title: 03 — Value-Space Catalog
status: Done — informed by captures (T5/T6) + code-trace agents
date: 2026-05-08
---

# Value-Space Catalog

EdForge has **five distinct value spaces representing the same K-12 grade-level concept**. This catalog enumerates each one — its canonical reference, its consumers, its producers, and its blast risk. Sources: live captures from `dev-pabson-primary` (T5/T6), code-trace agents on identity + academics services + edforge-saas-frontend MFEs.

## The five spaces, at a glance

| ID | Name | Canonical reference | Example values | Where stored | Producers | Read-path consumers |
|---|---|---|---|---|---|---|
| **A** | Internal codes | `ORDERED_GRADES` in [packages/shared-types/src/schemas/identity/grade-levels.ts](../../packages/shared-types/src/schemas/identity/grade-levels.ts) | `'ECD'`, `'PPC'`, `'PK'`, `'K'`, `'1'`–`'12'` | `Enrollment.gradeLevel` (DDB), `gradeRange.start/end` on School form | School wizard (form input), `normalizeGradeLevel()` in IEMIS transform | Dashboard `byGradeLevel`, Enrollment GSI1SK, Curriculum tab (left key column) |
| **B** | Ed-Fi descriptor names | [packages/shared-types/src/ed-fi/descriptors/grade-level-descriptor.ts](../../packages/shared-types/src/ed-fi/descriptors/grade-level-descriptor.ts) | `'EarlyChildhoodDevelopment'`, `'PrePrimaryClass'`, `'Prekindergarten'`, `'FirstGrade'`–`'TwelfthGrade'` | `School.gradeLevels[]` (DDB), `Course.gradeLevels[]` (DDB) | School wizard (`computeGradeLevels(start,end)` in shared-types), course form | `GET /api/schools/<id>` response, school-detail UI, Ed-Fi outbound mappers |
| **C** | Ed-Fi descriptor URIs | [packages/shared-types/src/mappers/edfi/education-org.mapper.ts](../../packages/shared-types/src/mappers/edfi/education-org.mapper.ts) | `'uri://ed-fi.org/GradeLevelDescriptor#FirstGrade'` | (not stored — computed at outbound serialize) | Outbound Ed-Fi v6 export mappers | External Ed-Fi consumers (CEHRD Flash, district SIS export) |
| **D** | UI labels | `GRADE_LEVEL_OPTIONS` in `grade-levels.ts` (one impl) AND `formatGradeLabel()` at [edforge-saas-frontend/apps/academics/src/hooks/useAcademicsOverview.ts:338-348](../../edforge-saas-frontend/apps/academics/src/hooks/useAcademicsOverview.ts#L338) (a second, duplicate impl) | `'Grade 1'`, `'1st Grade'`, `'ECD (Early Childhood Development)'`, `'Pre-K'`, `'Kindergarten'` | (not stored — computed in MFE render) | `getGradeLevelLabel(code)` (course form), `formatGradeLabel(grade)` (chart) — **two implementations** | Form dropdowns, chip lists, Curriculum-tab display column, dashboard chart bars |
| **E** | Legacy validator set | [packages/shared-types/src/validators/grade-level.ts](../../packages/shared-types/src/validators/grade-level.ts) | `['PK', 'K', '1'-'12']` — **does NOT include ECD or PPC** | (validator only — no storage) | Imports from various places (T7 will enumerate exhaustively) | Anything importing the legacy set — Nepal-broken if reached on a pre-primary path |

## Producer/consumer matrix (full)

For every read or write site, what value space and what break risk.

### Producers (write sites)

| Site | File:line | Writes which space? | What value? | Notes |
|---|---|---|---|---|
| School create wizard | [edforge-saas-frontend/apps/shell/src/components/settings/school-wizard/EdFiComplianceStep.tsx](../../edforge-saas-frontend/apps/shell/src/components/settings/school-wizard/EdFiComplianceStep.tsx) | B (descriptor names) | `gradeLevels[]` array | Computed via `computeGradeLevels(start,end)` in shared-types; "additional grade levels" chips let operator extend |
| `SchoolsService.createSchool` | server identity [schools.service.ts:110+](../../server/application/microservices/identity/src/schools/schools.service.ts#L110) | B (pass-through) | Stores client `gradeLevels[]` byte-equal | No server-side recompute or validation |
| Course form | edforge-saas-frontend academics MFE `course.form.ts:213` | B (descriptor names) | `Course.gradeLevels[]` | UI does name-matching against `GRADE_LEVEL_OPTIONS.value` — **but stores Ed-Fi descriptor names, not codes** (per code-trace agent finding — descriptor↔code coupling unverified) |
| `normalizeGradeLevel()` | academics [iemis-transform.ts:296-315](../../server/application/microservices/academics/src/students/iemis-transform.ts#L296) | A (internal codes) | Returns `'1'`/`'ECD'`/`'PPC'`/etc. | Sprint C3.T1 added `ECD/PPC` → `'ECD'` |
| `createEnrollmentForImport` | academics [enrollment.service.ts:319-457](../../server/application/microservices/academics/src/enrollment/enrollment.service.ts#L319) | A (internal codes) | `Enrollment.gradeLevel` field | Also writes to `GSI1SK = ENROLLMENT#<yearId>#<gradeLevel>` |
| Manual student create | (different path; out of audit scope) | A or B (unknown) | unknown | Audit T8 risk note — needs a separate investigation |
| `IEMIS_IMPORT_JOB` row | academics [iemis-import-job.entity.ts:42-81](../../server/application/microservices/academics/src/students/iemis-import-job.entity.ts#L42) | (job state — irrelevant) | findings carry `gradeLevel` as `'ECD'` etc. (Space A) | Findings array capped at 500 |
| Outbound Ed-Fi export | [education-org.mapper.ts](../../packages/shared-types/src/mappers/edfi/education-org.mapper.ts) | C (URIs) | Translates `gradeLevels[]` (Space B) → `uri://...` | Used by Ed-Fi v6 compliance exports only |

### Consumers (read sites)

| Site | File:line | Reads which space? | Translation? | Break risk |
|---|---|---|---|---|
| `GET /api/schools/<id>` | identity [schools.service.ts](../../server/application/microservices/identity/src/schools/schools.service.ts) | B | none — pass-through | resilient |
| Curriculum / Grade-Levels tab (display) | [edforge-saas-frontend/apps/academics/src/components/curriculum/GradeLevelsTab.tsx](../../edforge-saas-frontend/apps/academics/src/components/curriculum/GradeLevelsTab.tsx) | reads B (school) + D (display via `getGradeLevelLabel`) | Implicit B↔A by string-matching `course.gradeLevels[]` against `GRADE_LEVEL_OPTIONS.value` | **at-risk** — descriptor `EarlyChildhoodDevelopment` won't match `value='ECD'` unless an inverse lookup runs; if descriptors are stored on Course but the matcher uses codes, ECD courses count zero |
| Curriculum / Grade-Levels tab (course count) | same | iterates `Course.gradeLevels[]` (B) and matches against `GRADE_LEVEL_OPTIONS.value` (A) | **descriptor → code via lookup loop** | **broken** — see comment above; needs verification at runtime |
| Curriculum / Grade-Levels tab (student count) | same — column hardcoded to `—` | (no read) | (no translation) | resilient — no enrollment counts displayed yet |
| Dashboard `byGradeLevel` aggregation | academics [dashboard.service.ts:118-203](../../server/application/microservices/academics/src/dashboard/dashboard.service.ts#L118) | A | none | resilient (uses Space A end-to-end) |
| Dashboard chart bar labels | edforge-saas-frontend academics [useAcademicsOverview.ts:338-348](../../edforge-saas-frontend/apps/academics/src/hooks/useAcademicsOverview.ts#L338) | A → D via `formatGradeLabel(grade)` | A→D | resilient (codes match the formatter's switch cases); duplicate impl risk if shared-types `getGradeLevelLabel` updates and formatGradeLabel doesn't |
| Section bell-schedule validation | academics [sections.service.ts:177](../../server/application/microservices/academics/src/sections/sections.service.ts#L177) | reads `schoolConfig.schoolDays` (NOT a grade-level field; flagged here for completeness as adjacent regional drift) | n/a | **at-risk** — flagged in 05-school-provisioning-trace.md |
| Grading | academics [grades.service.ts:604+](../../server/application/microservices/academics/src/grades/grades.service.ts#L604) | reads `schoolConfig.gradingScale` (US A-F leak; not Space-A/B/C/D/E but related drift) | n/a | **at-risk** — flagged in 05 |
| Outbound Ed-Fi export | [education-org.mapper.ts](../../packages/shared-types/src/mappers/edfi/education-org.mapper.ts) | reads B → produces C | B→C | resilient |
| Legacy validator imports | [packages/shared-types/src/validators/grade-level.ts](../../packages/shared-types/src/validators/grade-level.ts) | E | none | **at-risk for Nepal pre-primary** — T7 enumerates the import sites |

## Translation map — what exists and what doesn't

```
                   ┌──────────────┐
                   │ E (legacy)   │ ← does NOT include ECD/PPC; Nepal-incomplete
                   │ ['PK','K',   │   T7 task: enumerate consumers, prove reach
                   │ '1'-'12']    │
                   └──────────────┘
                      ⌃ no path

  ┌──────────────────┐         ┌──────────────────────┐         ┌─────────────────┐
  │  A (internal)    │  ───►   │  B (Ed-Fi descriptor)│  ───►   │  C (Ed-Fi URI)  │
  │  ECD, PPC, K,    │  forward│  EarlyChildhood-     │  forward│  uri://ed-fi.org│
  │  PK, 1..12       │  via    │  Development,        │  via    │  /Grade...      │
  │                  │  GRADE_ │  PrePrimaryClass,... │  mapper │                 │
  │                  │  RANGE_ │                      │         │                 │
  │                  │  TO_    │                      │         │                 │
  │                  │  DESCR. │                      │         │                 │
  └────────┬─────────┘         └──────────┬───────────┘         └─────────────────┘
           │                              │
           │  forward via                 │  forward via
           │  getGradeLevelLabel()        │  no canonical
           │                              │  inverse exists ⚠
           ▼                              ▼
  ┌──────────────────┐         ┌──────────────────────┐
  │  D (UI label)    │         │  D (UI label)        │
  │  "ECD (Early..." │         │  (via implicit name- │
  │  "Grade 1"       │         │   matching loop)     │
  └──────────────────┘         └──────────────────────┘
```

**Two missing edges:**

1. **B → A inverse:** No canonical map from Ed-Fi descriptor name (`'EarlyChildhoodDevelopment'`) back to internal code (`'ECD'`). The Curriculum tab's per-grade course-count aggregation **assumes Course.gradeLevels[] contains internal codes** (it iterates and string-matches against `GRADE_LEVEL_OPTIONS.value`), but the course-create form **writes Ed-Fi descriptor names**. This is a latent correctness bug — the count for `ECD` will be wrong as soon as a course is created with `gradeLevels=['EarlyChildhoodDevelopment']`. **Verify under T6 once a course is created on the test school.**

2. **D → A inverse:** No reverse from UI label back to code. Not a real concern (UI label is downstream); flagged for completeness.

## Duplicate-implementation hazards

| Concept | Implementation 1 | Implementation 2 | Drift risk |
|---|---|---|---|
| Code → UI label | `getGradeLevelLabel(code)` in shared-types | `formatGradeLabel(grade)` in academics MFE | **HIGH** — they live in different packages, will drift independently |
| Country defaults | `COUNTRY_CONFIG_OVERRIDES` in identity entity | `COUNTRY_DEFAULTS` in shared-types/locale | **MEDIUM** — used by different code paths (school config vs tenant settings); CLAUDE.md "If you change one, change both" rule is a known sharp edge |

## Break-risk classification (explicit "unknown" rule)

Per the audit's matrix discipline, every cell must have a verdict. Cells with no verdict above:

- **Manual student create path** — the audit scoped to IEMIS-only. T8 fix list flags this as "FIX sprint must verify with enrollment owners" before any normalize-on-write change.
- **`'Grade 8'` as a UI label seen in Curriculum tab** — this is `formatGradeLabel('8')` output, which proves the curriculum tab renders some grades as `'Grade N'` (forward map of digits) but the **left key column** in the same screenshot showed `8` not `8 Grade 8`. Inconsistent display style across rows in the same table. **at-risk** (cosmetic, but operator-confusing).

## Verdict

The five-space split is **partially deliberate, partially accidental drift.** Spaces A, B, C have intentional separation for outbound Ed-Fi compliance. Space D is unavoidable (UI labels must exist). Space E is **accidental drift** — a legacy validator that pre-dates the ECD/PPC introduction and was never retired.

The fragmented translation layer means a bug in any one consumer can corrupt downstream views without any one author seeing it. The Curriculum-tab course-count aggregation is the highest-leverage near-term concern: it silently gives wrong counts whenever a course is created with descriptor names (the form's actual output).

Recommendations carry forward to T8.
