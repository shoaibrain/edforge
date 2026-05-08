---
title: Grade Level Domain — Audit (Read-only)
status: ✅ Complete — captures + 8 analysis docs landed 2026-05-08
date: 2026-05-08
test-bed: dev-pabson-primary (tenantId 21aea5da-511f-4dfa-a6f2-6971f63a719f)
---

# Grade Level Domain — Audit

**Audit-only sprint.** No production code changes. Output is evidence + analysis + a ranked fix list that informs a follow-up FIX sprint.

## Why this audit exists

EdForge has at least **5 distinct value spaces representing the same K-12 grade-level concept**, with no translation layer between two of them. Operators are observing concrete inconsistencies in the deployed app (e.g., school says it offers `EarlyChildhoodDevelopment` while the dashboard reports students in `'ECD'` — same concept, different keys). The Saraswati pilot is live with 778 students; any fix must preserve that data.

This sprint reads the system through a clean dev tenant (`dev-pabson-primary`, no schools yet, no students yet) and produces evidence-backed answers before any solution design.

## Scope (locked)

- **Standards target:** Ed-Fi v6 only. SABER is not a goal (codebase has zero SABER references).
- **Sprint shape:** Audit-only. Fix happens in a separate sprint after this one's findings.
- **Domain scope:** Grade Level only. AY / Session / Section / Course / Calendar / Attendance / Credentials / Curriculum filtering are explicitly **out of scope** (cataloged as consumers but not investigated).
- **Import path scope:** IEMIS only. Generic CSV import is out of scope (Nepal pilot priority).
- **Production touch:** zero. Saraswati's data is read-only-sized in T8 only; no live mutations.

## Methodology — evidence-first

The execution order is: **observe runtime behavior on dev-pabson-primary first**, then analyze. Every analytical claim cites a captured artifact. The reverse order (analyze code, then verify) was rejected — too easy to assert the code "should" behave a certain way without verifying it actually does.

## Documents in this audit

| # | Doc | Status |
|---|---|---|
| — | [README.md](README.md) | (this file) |
| — | [test-strategy.md](test-strategy.md) | ✅ written — 8 scenarios A–H + 14-row IEMIS fixture spec (operator expanded to 201 rows) |
| — | [capture-template.md](capture-template.md) | ✅ written — per-scenario evidence checklist |
| 01 | [01-pin-verification.md](01-pin-verification.md) | ✅ Done — duplicate-Pre-Kindergarten **closed**; shared-types 0.37.0+ live on production Vercel |
| 02 | [02-design-intent-timeline.md](02-design-intent-timeline.md) | ✅ Done — partially deliberate (A/B/C dual-shape), partially drift (E + lazy-config + duplicate label) |
| 03 | [03-value-space-catalog.md](03-value-space-catalog.md) | ✅ Done — 5 spaces × producers/consumers matrix; B→A inverse map missing |
| 04 | [04-edfi-v6-alignment.md](04-edfi-v6-alignment.md) | ✅ Done — Ed-Fi is outbound shape, not native model. Recommendation: Option 1 + later Option 3 |
| 05 | [05-school-provisioning-trace.md](05-school-provisioning-trace.md) | ✅ Done — 🚨 **`/configuration` US-defaults leak** is the audit's headline finding |
| 06 | [06-iemis-import-trace.md](06-iemis-import-trace.md) | ✅ Done — 200 students imported, 28 findings, in-process worker is fragile |
| 07 | [07-legacy-validator-reachability.md](07-legacy-validator-reachability.md) | ✅ **CLOSED** — root cause confirmed via runtime test; reach is 6 components; **escalated to HIGH**. See `artifacts/H-curriculum-tab/course-form-grade-bug.md` |
| 08 | [08-migration-and-fix-list.md](08-migration-and-fix-list.md) | ✅ **FIX-sprint hand-off** — REVISED 2nd pass; F-LEGACY-1 is the top pick |

## Headline findings (REVISED 2nd pass — read 08 first if picking this up cold)

1. **🚨 F-LEGACY-1 (HIGH — pilot blocker for PABSON primary schools).** `getGradeLevelsInRange` in [packages/shared-types/src/validators/grade-level.ts:132-141](../../packages/shared-types/src/validators/grade-level.ts#L132-L141) does `slice(-1, end+1)` when `start='ECD'`, returning `['12']`. The bug propagates through `useFilteredGradeOptions` to **6 components**: Course form, EnrollExistingStudentModal, EnrollmentTable, EditStudentModal, PersonalInfoStep, Rostering. Saraswati is silently affected — operators can only assign Grade 12 in any of those forms. IEMIS bulk import bypasses these forms, which is why the pilot has not yet vocally complained. Detail: [artifacts/H-curriculum-tab/course-form-grade-bug.md](artifacts/H-curriculum-tab/course-form-grade-bug.md).
2. **F-CONFIG-1 (MEDIUM, downgraded).** Real schools' SchoolConfiguration rows are Nepal-correct — DDB scan confirmed. The bug is the **lazy `createDefaultConfig` fallback** that bypasses country-merge AND **orphan rows from abandoned wizards** (F-CONFIG-2; 2 in this dev tenant alone). Detail: [artifacts/A-school-create-wide/02-ddb/school-A-config.json](artifacts/A-school-create-wide/02-ddb/school-A-config.json) + [artifacts/00-preflight/orphan-config-rows.md](artifacts/00-preflight/orphan-config-rows.md).
3. **F-CURRICULUM-1 dissolved.** Runtime test showed Course.gradeLevels stores Space A internal codes — agent's claim was wrong without runtime evidence. Score one for evidence-first methodology.
4. **F-CURRICULUM-2 (MEDIUM).** Curriculum tab "Students" column hardcoded to `—` at [GradeLevelsTab.tsx:241-243](../../edforge-saas-frontend/apps/academics/src/components/curriculum/GradeLevelsTab.tsx#L241-L243). Half-finished feature shipped to prod.
5. **F-IEMIS-1 (MEDIUM).** In-process IEMIS worker has no orphan-running-job recovery. Saraswati already imported (forward-only risk).
6. **Duplicate-Pre-Kindergarten: CLOSED.** shared-types 0.37.0+ live; live POST capture confirms 16 distinct descriptors with no duplicates.

## Artifacts directory

Per-scenario captured evidence (network captures, DDB rows, CloudWatch log excerpts, API responses, screenshots) lives under [`artifacts/`](artifacts/) with one subdirectory per capture scenario:

```
artifacts/
  A-school-create-wide/      # School A: gradeRange ECD → 12 (full range)
  B-school-create-narrow/    # School B: gradeRange 6 → 10 (secondary-only)
  C-iemis-import-A/          # 14-row fixture into School A (full coverage)
  D-iemis-import-B/          # Same fixture into School B (negative test)
  E-dashboard-A/             # GET /api/academics/dashboard/overview?schoolId=A
  F-dashboard-B/             # Same for B (out-of-range students visible?)
  G-school-detail/           # GET /api/schools/<id> for both
  H-curriculum-tab/          # Curriculum/Grade-Levels tab API responses
```

## Test bed

- **Tenant:** `dev-pabson-primary`
- **tenantId:** `21aea5da-511f-4dfa-a6f2-6971f63a719f`
- **Archetype / Country:** PABSON / NPL — exercises the Nepal-specific code paths (BS calendar, NPR, ne-NP, ECD/PPC pre-primary)
- **Operator email:** `rainshoaib01@gmail.com`
- **Pre-condition:** zero schools, zero students at audit start

The pilot tenant `saraswatiboardingschool` (tenantId `34f49822-...`) is **read-only-sized in T8 only**. No mutations.

## Read the FIX-sprint hand-off first

If you're picking this up later, the entry point is **[08-migration-and-fix-list.md](08-migration-and-fix-list.md)** once it lands. That doc carries the ranked fix list with severity, surface, migration cost, Ed-Fi-alignment delta, and dependencies — enough for the FIX sprint to pick its top-N without re-running any of the investigation.

## Plan source

Original plan: [.claude/plans/compiled-whistling-thimble.md](../../.claude/plans/compiled-whistling-thimble.md) (Plan-Mode-approved 2026-05-08).
