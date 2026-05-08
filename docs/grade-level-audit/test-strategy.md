---
title: Grade Level Audit — Test Strategy
status: Approved 2026-05-08
test-bed: dev-pabson-primary (21aea5da-511f-4dfa-a6f2-6971f63a719f)
---

# Test Strategy

## Goal

Exercise the **IEMIS-driven student import path end-to-end** on a clean dev tenant, capture evidence at every system boundary, and produce a per-scenario evidence bundle that grounds every later analysis claim. The test fixture is deliberately small (14 rows × 2 schools) so every row can be inspected individually in DDB and CloudWatch.

## Boundaries we observe

For each capture scenario, evidence is collected at four layers:

1. **UI / Network** — full request body + response from the browser network tab; screenshot of any UI feedback.
2. **DDB** — `aws dynamodb get-item` (school) and `query` (students + enrollments) on the affected tenant partition.
3. **CloudWatch** — tail of `identity-service` log group during school-create steps; tail of `academics-service` log group during import steps. Filtered for `WARN` and `ERROR`.
4. **Read APIs** — JSON responses from each of the three known read endpoints: dashboard overview, school detail, curriculum/grade-levels tab.

The four layers must agree. Any disagreement is a finding.

---

## The two schools

We provision two schools with deliberately different grade ranges. The contrast lets us observe range-filtering behavior — particularly how the system treats a student whose imported grade is **outside** the school's offered range.

| School | gradeRange.start | gradeRange.end | Why |
|---|---|---|---|
| **A — wide** | `ECD` | `12` | Maximum coverage. Every chip in the form should render; every IEMIS row should successfully enroll. Ed-Fi `gradeLevels[]` should contain all 16 descriptors. |
| **B — narrow** | `6` | `10` | Secondary-only. Form chips should be exactly 5 (`SixthGrade…TenthGrade`). Importing students in grade 1 or grade 12 is a **negative test** — does the system reject, warn, or silently corrupt? |

Naming convention to keep artifacts traceable:
- School A: `dev-pabson-primary-school-A-wide`
- School B: `dev-pabson-primary-school-B-narrow`

## The IEMIS xlsx fixture (14 rows)

Operator builds this manually. Use any plausible CEHRD-shaped column layout (firstName, lastName, dob, gender, parent name/contact, district, etc.) — what matters for the audit is the `CurrentClass` column. All other columns can be filler.

| # | `CurrentClass` value | Why this row exists |
|---|---|---|
| 1 | `ECD` | Pure Early Childhood Development token |
| 2 | `PPC` | Pure Pre-Primary Class token |
| 3 | `ECD/PPC` | Sprint C3 combined-band — must collapse to `ECD` with a per-row warning |
| 4 | `PK` | Pre-K (was the duplicate-PK bug source pre-shared-types-0.37.0) |
| 5 | `K` | Kindergarten |
| 6 | `1` | Lowest numeric grade |
| 7 | `5` | Mid numeric (also out-of-range for School B) |
| 8 | `10` | Two-digit numeric (boundary at School B's upper end) |
| 9 | `12` | Highest numeric (out-of-range for School B) |
| 10 | `Class 5` | "Class N" prefix-stripping path |
| 11 | `Grade 8` | "Grade N" prefix-stripping path |
| 12 | `1 ` (trailing space) | Whitespace tolerance |
| 13 | `Nursery` | Token in form dropdown but likely not in `normalizeGradeLevel` — sentinel for unknown |
| 14 | (empty cell) | Empty / null handling |

**Minimum unique student identifiers per row** — distinct first+last names, distinct dates of birth, distinct guardian contacts. Keep all PII synthetic; no real children.

Suggested filename: `iemis-grade-audit-fixture-14-rows.xlsx`. Place at a path of your choosing; reference it from the capture template.

## The 8 capture scenarios

Each scenario produces an artifact bundle in its own directory under `artifacts/`. The capture template (per-scenario checklist) lives at [capture-template.md](capture-template.md).

| ID | Action | Owner | Captures land in |
|---|---|---|---|
| **A** | Create School A (`gradeRange = ECD → 12`) via the wizard on dev-pabson-primary | Operator + Claude (DDB read) | `artifacts/A-school-create-wide/` |
| **B** | Create School B (`gradeRange = 6 → 10`) via the wizard | Operator + Claude (DDB read) | `artifacts/B-school-create-narrow/` |
| **C** | Import the 14-row IEMIS fixture into School A | Operator (import) + Claude (DDB query, CloudWatch tail) | `artifacts/C-iemis-import-A/` |
| **D** | Import the **same** 14-row fixture into School B (negative test) | Operator + Claude | `artifacts/D-iemis-import-B/` |
| **E** | `GET /api/academics/dashboard/overview?schoolId=A&academicYearId=...` | Operator (auth'd curl) | `artifacts/E-dashboard-A/` |
| **F** | Same call for School B | Operator | `artifacts/F-dashboard-B/` |
| **G** | `GET /api/schools/<id>` for both A and B | Operator | `artifacts/G-school-detail/` |
| **H** | The Curriculum / Grade-Levels tab on the academics MFE — capture each API call it makes | Operator | `artifacts/H-curriculum-tab/` |

## Expected outputs (per current code reading) — to be verified by captures

These are **predictions**, not findings. The captures will confirm or refute each one. Divergences become T8 fix candidates.

| Prediction | Where it'd show up |
|---|---|
| School A's `gradeLevels[]` stored in DDB byte-equals what the wizard's POST body shipped | A's network capture vs `ddb-school-A.json` |
| School A wizard chips render 16 distinct entries — no duplicate `Pre-Kindergarten` (per shared-types 0.37.0+ fix) | `chip-list-A.png` |
| Each Enrollment row written by IEMIS import has `gradeLevel` as **internal code** (`'ECD'`, `'PPC'`, `'1'`, …) — NOT Ed-Fi descriptor name | `ddb-enrollments-C.json` |
| Dashboard `byGradeLevel` keys for School A use internal codes (`'1'`, `'ECD'`) — different keyspace than school's `gradeLevels[]` | `dashboard-A.json` vs `school-A.json` |
| Row #3 (`ECD/PPC` combined band) produces ONE student with `gradeLevel='ECD'` + a CloudWatch warning log | `cloudwatch-import-C.log` |
| Row #13 (`Nursery`) produces either an error, a warning + skip, or a student with `gradeLevel=''` | `cloudwatch-import-C.log` + `ddb-students-C.json` |
| Row #14 (empty) — same uncertain handling | same |
| For School B (narrow 6-10), rows 1-5 + 9 (ECD, PPC, ECD/PPC, PK, K, grade 12) and the prefix-stripped row 10 (Class 5 → grade 5) are out-of-range. Either rejected at import or stored anyway. | `ddb-enrollments-D.json` + `cloudwatch-import-D.log` |

## What we are NOT testing in this audit

- Generic CSV import path (the `student-import-template.csv` shape) — out of scope per user decision; Nepal IEMIS is the priority
- Section assignment (we observe Enrollments; we don't section students)
- Manual student-by-student create (different code path; not implicated in the reported issue)
- Grade-level transitions (year rollover, promotion)
- Saraswati's existing data — read-only sized in T8 only
- Multi-tenant cross-contamination — we trust Sprint 1's tenantTag work for that

## Pre-flight checks (operator)

Before starting captures, confirm:

```bash
# ReadOnlyAccess attached on edforge-prod-deployer (was re-attached in Sprint 3; should still be on)
aws iam list-attached-user-policies --user-name edforge-prod-deployer | grep ReadOnlyAccess

# dev-pabson-primary tenant registration row is sbtaws_active=true
aws dynamodb scan \
  --table-name "controlplane-stack-controlplanesbttenantRegistrationServicetenantRegistrationTableTenantRegistrationTableD511E0AE-TWW0S842ODSN" \
  --region ap-south-1 \
  --filter-expression "tenantId = :t" \
  --expression-attribute-values '{":t":{"S":"21aea5da-511f-4dfa-a6f2-6971f63a719f"}}'
```

## When the captures are done

Once all 8 scenario directories have their artifact bundles, the audit moves to the analysis phase (T1, T2, T3, T4, T7) which is purely Claude-driven. T8 synthesizes everything into the FIX-sprint hand-off.
