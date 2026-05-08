---
title: F-COURSE-FORM-1 / F-LEGACY-1 — root cause confirmed by runtime test
captured: 2026-05-08T20:15:39Z
---

# Course-Create form shows only "Grade 12" — root cause

## Symptom

On `dev-pabson-primary-school-A-wide` (gradeRange `ECD → 12`, school stores 16 grade-level Ed-Fi descriptors), the **Add New Course** drawer's Grade Levels selector shows **only one chip: `Grade 12`**.

React debugger output of the options array passed to the chip selector:

```json
[ { "value": "12", "label": "Grade 12" } ]
```

Course-create POST went through with `gradeLevels:["12"]` and the backend stored it as-is. The Curriculum tab now shows `Grade 12` row with course count `1` (correct given what was submitted).

## Root cause — `getGradeLevelsInRange` slice() bug

[packages/shared-types/src/validators/grade-level.ts:13-28](../../../packages/shared-types/src/validators/grade-level.ts#L13-L28) defines:

```ts
export const GRADE_LEVELS = ['PK','K','1','2','3','4','5','6','7','8','9','10','11','12'] as const;
//                          ^^^^^^^^^^ no 'ECD', no 'PPC' — Nepal-incomplete
```

[lines 132-141](../../../packages/shared-types/src/validators/grade-level.ts#L132-L141) defines:

```ts
export function getGradeLevelsInRange(start: GradeLevel, end: GradeLevel): GradeLevel[] {
  const startIndex = getGradeLevelIndex(start);  // 'ECD' → -1 (indexOf returns -1 for missing)
  const endIndex   = getGradeLevelIndex(end);    // '12'  → 13
  if (startIndex > endIndex) return [];          // (-1 > 13) = false; no early return
  return GRADE_LEVELS.slice(startIndex, endIndex + 1);  // slice(-1, 14)
}
```

`Array.prototype.slice(-1, 14)` returns the **last element only** because negative `start` means "start from end". Result: `['12']`.

This function is consumed by `useFilteredGradeOptions` at [edforge-saas-frontend/apps/academics/src/hooks/useGradeOptions.ts:19-36](../../../edforge-saas-frontend/apps/academics/src/hooks/useGradeOptions.ts#L19-L36) which feeds:

| Component | Effect for ECD-having school |
|---|---|
| `CourseForm` (Curriculum) | Only Grade 12 selectable. **Curriculum module unusable.** |
| `EnrollExistingStudentModal` | Only Grade 12 selectable. **Manual enrollment broken.** |
| `EnrollmentTable` | Only Grade 12 in filter dropdowns |
| `EditStudentModal` | Only Grade 12 selectable when editing student grade |
| `PersonalInfoStep` (registration) | Only Grade 12 in new-student registration |
| `routes/rostering/index.tsx` | Only Grade 12 in rostering filters |

## Why IEMIS bulk import was unaffected

IEMIS bypasses these forms entirely. `iemis-transform.ts normalizeGradeLevel()` uses `ORDERED_GRADES` from `schemas/identity/grade-levels.ts` (the modern 16-entry list), not the legacy validator's 14-entry list. That's why the 200-student import succeeded — the broken legacy code path is form-only.

## Saraswati impact

Saraswati is a primary school with PABSON archetype. Her `gradeRange.start` is almost certainly `'ECD'` or similar pre-primary. **Every form-based grade-level interaction is broken for her right now.** The reason it hasn't surfaced is presumably that the pilot operator is using IEMIS bulk import for student enrollment and hasn't yet exercised:
- The Curriculum module (creating courses)
- Manual student enroll/edit (single-student paths)
- The rostering UI

This is likely a **silent pilot blocker that becomes a vocal one within 1-2 weeks of operator usage**.

## Test cases that should be added with the fix

| Input | Expected output of `getGradeLevelsInRange` |
|---|---|
| `('ECD', '12')` | `['ECD','PPC','PK','K','1','2','3','4','5','6','7','8','9','10','11','12']` (16 entries) |
| `('PPC', '5')` | `['PPC','PK','K','1','2','3','4','5']` (8 entries) |
| `('6', '10')` | `['6','7','8','9','10']` (5 entries) — School B negative-test case |
| `('PK', '12')` | `['PK','K','1',...,'12']` (14 entries) — pre-existing US K-12 path |
| `('12', '12')` | `['12']` |
| `('12', 'ECD')` | `[]` (start > end) |
| `('ECD', 'ECD')` | `['ECD']` |

## Fix path

**Replace the legacy implementation with the modern one.** Either:

- **Option A (preferred — small, structural):** Make `validators/grade-level.ts` re-export from `schemas/identity/grade-levels.ts`. Single source of truth at the file level. Update `GRADE_LEVELS` to be a synonym for `ORDERED_GRADES`. The `slice()` math works correctly when ECD/PPC are first in the array.

- **Option B (faster, less clean):** Inline-fix `getGradeLevelsInRange` to import `ORDERED_GRADES` and use it instead of the local `GRADE_LEVELS`. Keep the legacy file otherwise intact for backward compat.

Either way, write the test cases above first; they will fail on the broken implementation and pass after the fix.

**Track as F-LEGACY-1 (priority HIGH).** Closes both the legacy validator concern (T7's original target) and the curriculum-form-only-shows-Grade-12 user-visible bug. They are the same root cause.
