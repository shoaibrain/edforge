# School-Scoped Grade Level Filtering — Sprint Plan

## Context

### Problem
The Curriculum module at `/academics/curriculum` displays **all 14 grade levels (Pre-K through Grade 12)** regardless of which school is selected. Westfield High School has `gradeRange: { start: "9", end: "12" }` but:

1. **Grade Levels tab** shows Pre-K through Grade 12 (should show only 9–12)
2. **"Add New Course" form** shows all 14 grade level chips (should show only 9–12)
3. **Enrollment Table** grade filter dropdown has a hardcoded array at `EnrollmentTable.tsx:40` showing all PK–12

### Root Cause Analysis

**Data flow gap:** The active school's `gradeRange` is not accessible in the Academics MFE.

1. **API returns `gradeRange`** — `/api/schools` returns `gradeRange: { start: "9", end: "12" }` per school
2. **Shell strips it** — `mapApiSchool()` at `apps/shell/src/services/tenant.service.ts:92` maps only `id, name, code, type, status, address, phone, email`
3. **Broadcast is minimal** — `SchoolContextPayload` at `packages/config/src/school-context-channel.ts` only carries `{ schoolId, schoolStatus }`
4. **Academics store is ID-only** — `apps/academics/src/stores/app.store.ts` stores only `activeSchoolId` and `activeSchoolStatus`
5. **Components use hardcoded constants** — `GRADE_LEVEL_OPTIONS` (all PK–12) used directly without filtering

**Infrastructure ready but unwired:**
- `GradeLevelsTab` already has an optional `schoolGradeRange` prop with working filter logic (lines 131–139), but never receives it
- `CourseForm`'s `GradeLevelSelector` has no filtering capability — uses `GRADE_LEVEL_OPTIONS` directly

### Existing Utilities to Reuse

| Utility | Location | Purpose |
|---------|----------|---------|
| `GRADE_LEVEL_OPTIONS` | Re-exported from `@aibrains/shared-types` via `academics/src/schemas/course.form.ts` | Canonical PK–12 options `{ value, label }[]` |
| `ORDERED_GRADES` | `@aibrains/shared-types` → `schemas/identity/grade-levels.ts` | `['PK','K','1',...,'12']` |
| `getGradeLevelsInRange()` | `@aibrains/shared-types` → `validators/grade-level.ts:132` | Returns grade codes between start/end (inclusive) |
| `getGradeLevelLabel()` | `@aibrains/shared-types` | Maps `"9"` → `"Grade 9"` |
| `GradeLevelsTab.schoolGradeRange` | `components/curriculum/GradeLevelsTab.tsx:35` | Already-wired optional prop with filter logic |
| `apiGet()` | `apps/academics/src/lib/api.ts:125` | Typed GET helper with auth/tenant injection |

### Out of Scope (Backlog)

These components also use hardcoded grade options but are deferred to a separate ticket:
- `EditStudentModal.tsx` — constructs own grade options from `GRADE_LEVEL_DESCRIPTORS`
- `EnrollExistingStudentModal.tsx` — same pattern
- `rostering/index.tsx:75` — hardcodes its own `GRADE_LEVEL_OPTIONS`
- `PersonalInfoStep.tsx` / `ReviewStep.tsx` in the registration wizard
- Context broadcast optimization (extending `SchoolContextPayload` with `gradeRange`)
- Curriculum page header compacting (separate UI polish ticket)

---

## Sprint 1: Data Layer — School Profile Access

**Goal:** Make the active school's `gradeRange` accessible to Academics MFE components via React Query hooks and a shared grade-filtering utility.

**Demoable outcome:** `useSchoolGradeRange(schoolId)` returns `{ start: "9", end: "12" }` for Westfield High. `useFilteredGradeOptions(gradeRange)` returns only 4 options.

---

### Task 1.0: Verify backend `GET /schools/{schoolId}` returns `gradeRange`

**What:** Manual verification that the single-school API endpoint returns the `gradeRange` field.

**Validation:** `curl -H "Authorization: Bearer <token>" /api/schools/d5adb754-9997-42f0-9ee5-98f41e6c4d73` returns response containing `"gradeRange": { "start": "9", "end": "12" }`. Can also verify via browser Network tab.

---

### Task 1.1: Add `getSchoolProfile()` to school service

**File:** `apps/academics/src/services/school.service.ts`

**What:** Add a function that calls `GET /schools/{schoolId}` and returns the raw response (not the Shell's stripped-down `School` type). Only type the fields we need.

```ts
export interface SchoolProfileDto {
  schoolId: string
  name: string
  schoolCode: string
  schoolType: string
  gradeRange?: { start: string; end: string }
  status: string
}

export async function getSchoolProfile(schoolId: string): Promise<SchoolProfileDto> {
  return apiGet<SchoolProfileDto>(`/schools/${schoolId}`)
}
```

**Note:** This is a cross-domain call to the Identity service's school endpoint (same one the Shell calls), routed through the API gateway. Architecturally fine — the Academics MFE's api.ts handles auth/tenant headers.

**Validation:** Import in a test/console, call with a known schoolId, confirm `gradeRange` is present in the response.

---

### Task 1.2: Add `useSchoolProfile()` and `useSchoolGradeRange()` hooks

**File:** `apps/academics/src/hooks/useSchool.ts`

**What:** Two React Query hooks:

```ts
export function useSchoolProfile(schoolId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['school-profile', schoolId],
    queryFn: () => getSchoolProfile(schoolId!),
    enabled: enabled && !!schoolId,
    staleTime: 5 * 60 * 1000,  // School profile rarely changes
  })
}

export function useSchoolGradeRange(schoolId: string | null) {
  const { data: profile, isLoading } = useSchoolProfile(schoolId)
  return { gradeRange: profile?.gradeRange ?? null, isLoading }
}
```

**Cache note:** `staleTime: 5min` is acceptable — school gradeRange essentially never changes mid-session. If an admin changes it in Settings, a page refresh picks it up.

**Validation:** React Query DevTools shows the query keyed by schoolId, returns expected gradeRange.

---

### Task 1.3: Create shared `useFilteredGradeOptions()` hook

**File:** `apps/academics/src/hooks/useGradeOptions.ts` (new file)

**What:** A single utility hook that all grade-level consumers import, eliminating duplicated filter logic. Uses the existing `getGradeLevelsInRange()` from shared-types.

```ts
import { useMemo } from 'react'
import { getGradeLevelsInRange, type GradeLevel } from '@aibrains/shared-types'
import { GRADE_LEVEL_OPTIONS } from '../schemas/course.form'

type GradeOption = (typeof GRADE_LEVEL_OPTIONS)[number]

/**
 * Returns GRADE_LEVEL_OPTIONS filtered to the school's grade range.
 * Falls back to full PK–12 when gradeRange is null/undefined.
 */
export function useFilteredGradeOptions(
  gradeRange: { start: string; end: string } | null | undefined
): readonly GradeOption[] {
  return useMemo(() => {
    if (!gradeRange) return GRADE_LEVEL_OPTIONS
    try {
      const validCodes = getGradeLevelsInRange(
        gradeRange.start as GradeLevel,
        gradeRange.end as GradeLevel
      )
      const validSet = new Set(validCodes)
      const filtered = GRADE_LEVEL_OPTIONS.filter((o) => validSet.has(o.value))
      return filtered.length > 0 ? filtered : GRADE_LEVEL_OPTIONS
    } catch {
      return GRADE_LEVEL_OPTIONS // Graceful fallback
    }
  }, [gradeRange])
}
```

**Why a hook:** Encapsulates `useMemo` + error handling. All three consumers (GradeLevelsTab, CourseForm, EnrollmentTable) import this instead of duplicating logic.

**Validation:** Unit test: `useFilteredGradeOptions({ start: '9', end: '12' })` returns 4 options. `useFilteredGradeOptions(null)` returns all 14.

---

## Sprint 2: Curriculum Module — Wire Grade Range

**Goal:** The Grade Levels tab and Course Form only show grades matching the school's configured range.

**Demoable outcome:** Select Westfield High → Curriculum → Grade Levels tab shows only Grade 9–12. "Add New Course" form shows only 4 grade chips.

---

### Task 2.1: Pass `schoolGradeRange` to `GradeLevelsTab` from `CurriculumModule`

**File:** `apps/academics/src/routes/curriculum/index.tsx`

**What:**
1. Import `useSchoolGradeRange` from hooks
2. Call `useSchoolGradeRange(schoolId)` in `CurriculumModule`
3. Pass to `<GradeLevelsTab schoolGradeRange={gradeRange ?? undefined} />`

**No changes to GradeLevelsTab** — the prop and filter logic already exist. However, consider optionally refactoring `GradeLevelsTab`'s internal `filteredGradeOptions` to use the shared `useFilteredGradeOptions` hook for consistency (can be deferred).

**Loading state:** When `gradeRange` is still loading (null), `GradeLevelsTab` falls back to showing all PK–12 (existing behavior). Once resolved, it re-renders with filtered grades. This flash is acceptable since the school profile query is fast and cached.

**Validation:** Navigate to Curriculum → Grade Levels tab with Westfield High. Verify only 4 rows: Grade 9, 10, 11, 12. Stat card "Total Grade Levels" shows 4. Switch to an elementary school → shows PK–5.

---

### Task 2.2: Add `schoolGradeRange` filtering to `CourseForm` and thread through `CourseDrawer`

**Files:**
- `apps/academics/src/components/curriculum/CourseForm.tsx`
- `apps/academics/src/components/curriculum/CourseDrawer.tsx`
- `apps/academics/src/routes/curriculum/index.tsx`

**What (CourseForm.tsx):**
1. Add `schoolGradeRange` to `CourseFormProps`
2. Pass it to `GradeLevelSelector` as a prop
3. Inside `GradeLevelSelector`, use `useFilteredGradeOptions(schoolGradeRange)` instead of raw `GRADE_LEVEL_OPTIONS`

```tsx
interface CourseFormProps {
  isEdit?: boolean
  schoolGradeRange?: { start: string; end: string } | null
}

function GradeLevelSelector({ schoolGradeRange }: {
  schoolGradeRange?: { start: string; end: string } | null
}) {
  const options = useFilteredGradeOptions(schoolGradeRange)
  // ... render options instead of GRADE_LEVEL_OPTIONS
}

export function CourseForm({ isEdit, schoolGradeRange }: CourseFormProps) {
  // ... in JSX:
  <GradeLevelSelector schoolGradeRange={schoolGradeRange} />
}
```

**What (CourseDrawer.tsx):**
1. Add `schoolGradeRange` to `CourseDrawerProps`
2. Pass to `CourseFormView`
3. `CourseFormView` passes to `<CourseForm schoolGradeRange={...} />`

**What (index.tsx):**
```tsx
<CourseDrawer
  open={drawerOpen}
  onClose={closeDrawer}
  mode={drawerMode}
  course={selectedCourse}
  onModeChange={setDrawerMode}
  schoolGradeRange={gradeRange}
/>
```

**Note:** `GradeLevelSelector` is currently a standalone function in `CourseForm.tsx` that takes no props and reads from `useFormContext()`. This change restructures it to accept a prop. `CourseFormView` lives inside `CourseDrawer.tsx`, not `CourseForm.tsx`.

**Validation:** Open "Add New Course" drawer on Westfield High. Verify only 4 grade chips (9, 10, 11, 12). Create a course with Grade 9 — succeeds. Edit existing course — correct grades shown.

---

### Task 2.3: Handle existing courses with out-of-range grade selections (edit mode)

**File:** `apps/academics/src/components/curriculum/CourseForm.tsx`

**What:** When editing a course with grades outside the school's current range (edge case: school range was narrowed after course creation), include those grades so they can be deselected but not lost silently.

Modify `GradeLevelSelector`:
```tsx
function GradeLevelSelector({ schoolGradeRange }: ...) {
  const selected: string[] = watch('gradeLevels') ?? []
  const baseOptions = useFilteredGradeOptions(schoolGradeRange)

  // Include any already-selected grades that fall outside the school range
  const options = useMemo(() => {
    const baseValues = new Set(baseOptions.map((o) => o.value))
    const outOfRange = selected
      .filter((v) => !baseValues.has(v))
      .map((v) => GRADE_LEVEL_OPTIONS.find((o) => o.value === v))
      .filter(Boolean) as typeof baseOptions[number][]
    return outOfRange.length > 0 ? [...baseOptions, ...outOfRange] : baseOptions
  }, [baseOptions, selected])

  // ... render with visual differentiation for out-of-range grades
}
```

**Validation:** Create a course with Grade 8 on a K-8 school. Switch school to 9-12. Edit that course — Grade 8 is still visible but visually distinct.

---

## Sprint 3: Enrollment Table Grade Filter

**Goal:** Apply grade range filtering to the Enrollment module's grade filter dropdown.

**Demoable outcome:** Enrollment page's grade filter dropdown only shows school-specific grades.

---

### Task 3.1: Replace hardcoded grades in `EnrollmentTable` and wire from parent

**Files:**
- `apps/academics/src/components/enrollment/EnrollmentTable.tsx`
- `apps/academics/src/routes/enrollment/index.tsx`

**What (EnrollmentTable.tsx):**
1. Add `schoolGradeRange` prop to `EnrollmentTableProps`
2. Replace the hardcoded `gradeLevels` array (line 40) with filtered options
3. Use `useFilteredGradeOptions` hook

**Format mismatch resolution:** The hardcoded array uses display-like values: `['Pre-K', 'K', '1', '2', ...]`. But `GRADE_LEVEL_OPTIONS` labels are `'Pre-K', 'Kindergarten', 'Grade 1', 'Grade 2'...`. The dropdown's `<option value={g}>` uses these as both value AND display text. After replacing with `GRADE_LEVEL_OPTIONS`, the labels will change (e.g., `'K'` → `'Kindergarten'`, `'1'` → `'Grade 1'`). The `value` prop should use `opt.value` (the grade code) and the display should use `opt.label`. This also requires verifying the enrollment API filter accepts grade codes (`'PK'`, `'K'`, `'9'`) rather than display labels.

```tsx
interface EnrollmentTableProps {
  // ... existing props
  schoolGradeRange?: { start: string; end: string } | null
}

// Inside component:
const gradeLevelOptions = useFilteredGradeOptions(schoolGradeRange)

// In JSX (grade filter select):
{gradeLevelOptions.map((opt) => (
  <option key={opt.value} value={opt.value}>{opt.label}</option>
))}
```

**What (enrollment/index.tsx):**
1. Import `useSchoolGradeRange`
2. Pass `schoolGradeRange={gradeRange}` to `<EnrollmentTable />`

**Validation:** Enrollment page grade filter for Westfield High shows only Grade 9–12. For elementary school, shows Pre-K through Grade 5. Filter selection sends correct grade code to API.

---

## Verification Checklist

1. **Westfield High School (grades 9–12):**
   - [ ] Curriculum → Grade Levels tab shows only 4 rows (9, 10, 11, 12)
   - [ ] "Add New Course" shows only 4 grade chips
   - [ ] "Edit Course" shows school grades + any pre-selected out-of-range grades
   - [ ] Enrollment → grade filter dropdown shows only 9, 10, 11, 12

2. **Shree Saraswati School (K–10):**
   - [ ] Grade Levels tab shows K through 10 (11 rows)
   - [ ] Course form shows 11 grade chips

3. **School with no gradeRange:**
   - [ ] Falls back to full PK–12 (graceful degradation)

4. **School switching:**
   - [ ] Switch from high school to elementary → grade options update immediately

5. **Type safety:**
   - [ ] `pnpm turbo typecheck` passes with zero errors

6. **Data integrity:**
   - [ ] Creating a course with filtered grades saves correctly
   - [ ] Editing a course with out-of-range grades doesn't lose data
