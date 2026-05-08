---
title: H — Curriculum / Grade Levels tab observations
captured: 2026-05-08
school: dev-pabson-primary-school-A-wide (4209e3d8-d2e2-4e0e-9961-790341c264f4)
state: post-school-create + post-AY + post-school-activate, **before** IEMIS import (for the first capture) and **after** import (the second screenshot)
---

# Curriculum → Grade Levels tab — what the UI shows

## Pre-import screenshot (school active, 0 students)

URL: `edforge.app/academics/curriculum` → Grade levels tab

Top-row cards:
- **Total Grade Levels:** `16`
- **Course Assignments:** `0`
- **Avg. Courses / Grade:** `0.0`
- **Grades with Courses:** `0`

Table — first column key + display:

| Key (left) | Display | Course Count | Students |
|---|---|---|---|
| `ECD` | ECD (Early Childhood Development) | 0 | — |
| `PPC` | PPC (Pre-Primary Class) | 0 | — |
| `PK` | Pre-K | 0 | — |
| `K` | Kindergarten | 0 | — |
| `1` | Grade 1 | 0 | — |
| `2` | Grade 2 | 0 | — |
| `3` | Grade 3 | 0 | — |
| `4` | Grade 4 | 0 | — |
| `5` | Grade 5 | 0 | — |
| `6` | Grade 6 | 0 | — |
| `7` | Grade 7 | 0 | — |
| `8` | Grade 8 | 0 | — |
| `9` | Grade 9 | 0 | — |
| `10` | Grade 10 | 0 | — |
| `11` | Grade 11 | 0 | — |
| `12` | Grade 12 | 0 | — |

Footer: "Showing 1-16 of 16 results"

## Diagnostic interpretation

- The **count `16` matches** the Ed-Fi descriptor names the school stored (`gradeLevels[]` length = 16).
- The **left key column displays internal codes** (`ECD`, `PPC`, `PK`, `K`, `1`-`12`) — Value Space A.
- The **display column uses UI labels** — Value Space D, derived via `getGradeLevelLabel(code)` from `@aibrains/shared-types/schemas/identity/grade-levels.ts`.

So this view is doing **Ed-Fi-descriptor → internal-code → UI-label** translation. The pipeline:

```
School.gradeLevels[]              "EarlyChildhoodDevelopment", "FirstGrade", ...   (Value Space B)
   └─→ reverse-lookup via GRADE_RANGE_TO_DESCRIPTOR (or its inverse)
        ↓
        internal codes              "ECD", "1", ...                                 (Value Space A)
        ↓
        rendered with getGradeLevelLabel()
        ↓
        UI labels                   "ECD (Early Childhood Development)", "Grade 1"  (Value Space D)
```

This is the first read-path we've observed where translation **does** happen. Question for T3: where is the reverse-lookup implemented? Is there a single canonical inverse map, or is it duplicated?

## Post-import screenshot (after 200-row IEMIS import)

The Academics Overview shows the Enrollment-by-grade-level chart with bars labeled:
- 1st Grade, 2nd Grade, 3rd Grade, 4th Grade, 5th Grade, 6th Grade, 7th Grade, 8th Grade, 9th Grade, 10th Grade, 11th Grade, 12th Grade, ECD

= 13 buckets visible. Note: **no PPC bucket** even though the Curriculum table has both ECD and PPC. This is the empirical confirmation of Sprint C3.T1: rows with `CurrentClass='ECD/PPC'` were collapsed to `gradeLevel='ECD'` only.

## Architectural smell

The Curriculum tab presents **16 grade levels** because the school stored 16 Ed-Fi descriptors. But the school's stated **gradeRange is `ECD → 12`**, which under `computeGradeLevels()` yields exactly 16 entries (ECD, PPC, PK, K, 1-12). So the Curriculum tab is a **re-rendering** of the school's `gradeLevels[]`, not an independent enumeration.

If the operator had selected only `gradeRange = 6 → 10` (School B negative test), the Curriculum tab should show 5 entries — confirming this in Scenario H for School B is a useful follow-up.
