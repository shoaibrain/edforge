---
title: 07 — Legacy Validator Reachability
status: ✅ Closed — runtime test produced definitive answer 2026-05-08
date: 2026-05-08
---

# Legacy Validator Reachability — CLOSED

## TL;DR

The legacy validator at [packages/shared-types/src/validators/grade-level.ts](../../packages/shared-types/src/validators/grade-level.ts) is **reachable, frequently used, and broken for any PABSON primary school**. Its `getGradeLevelsInRange` function uses an internal 14-entry `GRADE_LEVELS` constant that excludes `'ECD'` and `'PPC'`, and its `slice()` arithmetic produces a degenerate single-entry result for any input starting with `'ECD'`.

This is the **root cause of the F-COURSE-FORM-1 user-visible bug** discovered during the audit's 2nd-pass runtime tests. T7 and F-COURSE-FORM-1 collapse into one fix: **F-LEGACY-1, severity HIGH**.

## Code-level evidence

```ts
// packages/shared-types/src/validators/grade-level.ts:13-28
export const GRADE_LEVELS = [
  'PK', 'K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'
] as const;
//   ↑ no 'ECD', no 'PPC'

// lines 132-141
export function getGradeLevelsInRange(start: GradeLevel, end: GradeLevel): GradeLevel[] {
  const startIndex = getGradeLevelIndex(start);   // 'ECD' → -1
  const endIndex   = getGradeLevelIndex(end);     // '12'  → 13
  if (startIndex > endIndex) return [];           // (-1 > 13) = false; passes through
  return GRADE_LEVELS.slice(startIndex, endIndex + 1);  // slice(-1, 14) = ['12']
}
```

`Array.slice(-1, 14)` returns the last element only. Result: `['12']`. The form-driven UIs that consume this hook display "Grade 12" as the only option for any school whose grade range starts with `'ECD'`.

## Reach (definitive)

`useFilteredGradeOptions` at [edforge-saas-frontend/apps/academics/src/hooks/useGradeOptions.ts:19-36](../../edforge-saas-frontend/apps/academics/src/hooks/useGradeOptions.ts#L19-L36) is the wrapper around `getGradeLevelsInRange`. Grep for that hook surfaces 6 components:

| Importer | Component | Effect |
|---|---|---|
| 1 | [`CourseForm`](../../edforge-saas-frontend/apps/academics/src/components/curriculum/CourseForm.tsx) | Curriculum module unusable for non-secondary schools |
| 2 | [`EnrollExistingStudentModal`](../../edforge-saas-frontend/apps/academics/src/components/enrollment/EnrollExistingStudentModal.tsx) | Manual single-student enrollment broken |
| 3 | [`EnrollmentTable`](../../edforge-saas-frontend/apps/academics/src/components/enrollment/EnrollmentTable.tsx) | Filter dropdowns missing all but Grade 12 |
| 4 | [`EditStudentModal`](../../edforge-saas-frontend/apps/academics/src/components/students/EditStudentModal.tsx) | Cannot change a student to ECD/PPC/PK/K/1-11 |
| 5 | [`PersonalInfoStep`](../../edforge-saas-frontend/apps/academics/src/components/students/registration/steps/PersonalInfoStep.tsx) | New-student registration only allows Grade 12 |
| 6 | [`routes/rostering/index.tsx`](../../edforge-saas-frontend/apps/academics/src/routes/rostering/index.tsx) | Rostering filters degraded to Grade 12 only |

The legacy `gradeLevelEnumSchema` Zod validator at line 71 of `validators/grade-level.ts` is also exported but its reach is unverified; not a focus given the more impactful `getGradeLevelsInRange` finding.

## Why IEMIS bulk import bypasses this

[server/application/microservices/academics/src/students/iemis-transform.ts](../../server/application/microservices/academics/src/students/iemis-transform.ts) `normalizeGradeLevel` uses `ORDERED_GRADES` from `schemas/identity/grade-levels.ts` (the modern 16-entry list). It does NOT call `getGradeLevelsInRange`. That's why the 200-student IEMIS import succeeded for `dev-pabson-primary` and Saraswati despite the form path being silently broken.

## Saraswati impact

Saraswati is a PABSON primary school. Her `gradeRange.start` is almost certainly `'ECD'` or pre-primary equivalent. **All 6 form components above are silently broken for her tenant today.** It hasn't surfaced as a complaint because the operator has been using IEMIS bulk import for student onboarding and has not yet exercised:

- The Curriculum module to create courses
- Single-student manual enroll/edit paths
- The rostering UI

Time-to-first-vocal-complaint estimate: 1-2 weeks of operator usage in any module other than IEMIS.

## Fix

**F-LEGACY-1, escalated severity HIGH, effort S.**

Two implementation options:

### Option A — File-level consolidation (preferred)

Make `validators/grade-level.ts` re-export `ORDERED_GRADES` (16 entries) from `schemas/identity/grade-levels.ts` as `GRADE_LEVELS`. Single source of truth. The slice arithmetic works correctly when the array has ECD/PPC at the start because `getGradeLevelIndex('ECD')` returns `0` instead of `-1`.

### Option B — Inline fix

Patch `getGradeLevelsInRange` to import `ORDERED_GRADES` directly. Keep the legacy `GRADE_LEVELS` constant for any backward-compat use. Smaller blast radius but leaves the duplicate-source-of-truth in place.

Recommend **A**. The legacy file is 2 years stale and the duplicate-source-of-truth is the structural smell that produced this whole class of bug.

## Test matrix to ship with the fix

| Input | Expected | Currently |
|---|---|---|
| `('ECD', '12')` | 16 entries | `['12']` 🚨 |
| `('ECD', 'PPC')` | `['ECD', 'PPC']` | `['12']` 🚨 |
| `('ECD', 'ECD')` | `['ECD']` | `[]` |
| `('PPC', '5')` | 8 entries | `['12']` 🚨 |
| `('PK', '12')` | 14 entries | 14 entries ✅ |
| `('6', '10')` | 5 entries | 5 entries ✅ |
| `('12', 'ECD')` | `[]` | `[]` ✅ (start > end correctly returns empty) |

Add as snapshot test in shared-types CI. Then verify each of the 6 consumer components renders the correct option set in jsdom or Storybook.

## Why this audit found it when prior reviews didn't

The earlier code-trace agent reading `validators/grade-level.ts` flagged the file as Nepal-incomplete but didn't trace through `useFilteredGradeOptions` to its 6 consumers AND didn't run the math on the `slice()` call. **Static analysis caught the smell, but only the runtime test proved the consequence.** This is the empirical receipt for "evidence-first audit methodology" — the agent's "needs-runtime-confirmation" verdict on T7 was correct; the runtime confirmation was delivered by simply trying to create a course on the test school.
