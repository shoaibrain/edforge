# Grades & Assessments Module — Sprint Plan

## Executive Summary

This plan addresses the Grades & Assessments module at `/academics/grades`. After thorough analysis of the frontend (React/TanStack Query), backend (NestJS/DynamoDB), API responses from all 8 sections, the grade calculation engine, and peer review from a senior engineer, I've identified **critical bugs**, **UX inconsistencies**, **architectural inefficiencies**, and **missing educational assessment features** that must be resolved for a robust, enterprise-grade EMIS.

---

## Current State Analysis

### Architecture

- **Frontend**: `edforge-saas-frontend/apps/academics/src/routes/grades/` — React, TanStack Query, Zustand, Recharts, Framer Motion
- **Backend**: `server/application/microservices/academics/src/grades/` — NestJS, DynamoDB single-table design
- **Shared Types**: `packages/shared-types/src/schemas/academics/grade.schema.ts` — Zod schemas
- **Key Entities**: Grade (per student/course/term), GradingPolicy (per school), AssignmentGrade (nested array in Grade)

### What Works

- Gradebook grid renders grades per section with inline editing
- Bulk grade recording creates assignments across all students
- Grading policy CRUD with category weights and scale
- Grade finalization workflow (review → confirm → lock)
- CSV export for at-risk students
- Client-side aggregation produces correct overview stats (when underlying data is correct)

### Issues Discovered

**1. Tab ordering & naming inconsistency (P0 — UX)**
- Current order: Gradebook → Dashboard → Grading Policies
- EdForge convention (Attendance, Students, Scheduling, Curriculum): **Overview is always the first tab**
- "Dashboard" should be "Overview" per platform naming standard

**2. Critical grade calculation bug — ungraded stubs treated as zeros (P0 — Data Integrity)**
- The weighted grade engine treats assignment stubs (`earnedPoints: undefined`) as contributing `0%` to their category weight
- **Real impact**: Dual Enrollment Calculus students who score 85-97% on quizzes and 73-100% on participation show overall grades of ~24-29% because Tests & Exams (40%), Homework (20%), Projects (10%) have only ungraded stubs
- Calculation: `(0×40 + 94.5×20 + 0×20 + 98×10 + 0×10) / 100 = 28.7%`
- **Expected**: Normalize to graded categories only: `(94.5×20 + 98×10) / 30 = 95.67%`
- Note: `calculateGrade()` already has an early-return at line 607 when ALL assignments are stubs — the bug only manifests when SOME categories have scored work and SOME have only stubs

**3. `letterGrade` always `null` (P0 — Data Integrity)**
- Every API response shows `"letterGrade": null` despite configured grading policies
- The update expression at line 182 sets `letterGrade = :letterGrade` where value is `calculated.letterGrade ?? null`
- So `calculated.letterGrade` is `undefined`, making the stored value `null`
- Root cause investigation needed: Are the grading scale ranges contiguous? Does `lookupLetterGrade(28.7, scale)` work with integer boundaries (A: 90-100, B: 80-89)? A value of 89.5 falls through both B (max 89) and A (min 90) with `<=` comparisons. The auto-created default policy uses `89.99` boundaries, but user-created policies may use integers.
- A runtime backfill exists at lines 434-448 for `getStudentGrades()` but NOT for `getSectionGrades()` — this is inconsistent

**4. Duplicate assignment stubs (P0 — Data Quality)**
- Section `2bb19773` (Honors Chemistry) shows student "Aiden Patel" with 3 duplicate "Chapter 7 Quiz" stubs (different assignmentIds, same name/type) plus 1 graded version
- The dedup check at line 171 uses `assignmentId`, so stubs with different IDs are never deduped
- This corrupts grade calculation even after the Sprint 2 fix (category shows 1 scored + 3 stubs)

**5. N+1 query pattern in Overview (P1 — Performance)**
- Overview fires 8 parallel `GET /grades/section/:id` calls (one per section)
- No backend aggregation endpoint — all aggregation is client-side
- Does not scale: 50 sections = 50 parallel API calls

**6. `academicYearId` ignored in Overview (P1 — Data Correctness)**
- In `dashboard.tsx` line 329, `academicYearId` is destructured as `_academicYearId` and unused
- Overview shows grades across ALL academic years, not just the current one

**7. No optimistic locking on grade recording (P1 — Concurrency)**
- `recordAssignmentGrade()` reads, modifies, and writes the grade document without condition expressions
- Two concurrent grade recordings for the same student can silently overwrite each other
- Contrast: `grading-policy.service.ts` line 330 correctly uses version-based conditions

**8. No formative/summative assessment classification (P2 — Feature Gap)**
- The US Dept of Education Ed Tech Developer's Guide distinguishes formative (frequent progress checks) vs summative (end-of-unit evaluation)
- Current `assignmentType` maps to policy categories but has no assessment-purpose classification

**9. Missing ARIA tab attributes (P2 — Accessibility)**
- Tab navigation uses `<nav aria-label="Grades tabs">` but individual buttons lack `role="tab"`, `aria-selected`, `aria-controls`
- Not WCAG 2.1 compliant

**Known Limitation**: The current data model is entirely percentage/letter-grade oriented. Schools using standards-based grading (proficiency levels) are not supported. This should be validated with the pilot school.

---

## Sprint Breakdown

---

### Sprint 1: Tab Reorder, Naming Alignment & Overview-First Default

**Goal**: Align the Grades module tabs with the established EdForge UI pattern.

**Demoable Outcome**: User navigates to `/academics/grades` → "Overview" is the first (active) tab with correct ARIA attributes, followed by "Gradebook", then "Grading Policies".

---

#### Ticket 1.1: Rename "Dashboard" to "Overview", reorder tabs, rename file

**Files**:
- `edforge-saas-frontend/apps/academics/src/routes/grades/index.tsx`
- Rename `edforge-saas-frontend/apps/academics/src/routes/grades/dashboard.tsx` → `overview.tsx`

**Changes**:
- `git mv dashboard.tsx overview.tsx`
- Update `GradesTab` type: `'gradebook' | 'dashboard' | 'policies'` → `'overview' | 'gradebook' | 'policies'`
- Reorder `tabs` array: Overview (BarChart3) → Gradebook (BookCheck) → Grading Policies (Settings)
- Change default state: `useState<GradesTab>('overview')`
- Replace all `activeTab === 'dashboard'` → `activeTab === 'overview'`
- Update lazy import: `const GradeOverview = lazy(() => import('./overview'))`
- In `overview.tsx`: rename export from `GradeDashboard` to `GradeOverview`, update JSDoc

**Definition of Done checklist** (cross-module consistency):
- [ ] Attendance: Overview → Daily Entry
- [ ] Students: Overview → Profile → Enrollment → Family
- [ ] Curriculum: Overview → Sections → Standards
- [ ] Scheduling: Overview → Roster
- [ ] **Grades**: Overview → Gradebook → Grading Policies

**Validation**:
- `npm run build` succeeds with zero type errors
- Navigate to `/academics/grades` → "Overview" is first tab, active by default
- All 3 tabs switch correctly with animated underline
- `git log --follow overview.tsx` shows rename history

---

#### Ticket 1.2: Add ARIA tab attributes for WCAG 2.1 compliance

**File**: `edforge-saas-frontend/apps/academics/src/routes/grades/index.tsx`

**Changes**:
- Add `role="tablist"` to the `<nav>` element
- Add `role="tab"`, `aria-selected={activeTab === tab.id}`, `aria-controls={`panel-${tab.id}`}`, `id={`tab-${tab.id}`}` to each tab button
- Add `role="tabpanel"`, `aria-labelledby={`tab-${activeTab}`}`, `id={`panel-${activeTab}`}` to the content `<div>`

**Validation**:
- Keyboard: Tab key moves between tabs, Enter/Space activates
- Screen reader: announces "Overview tab, selected, 1 of 3"
- `npm run build` succeeds

---

#### Ticket 1.3: Audit all "dashboard" references in grades-related code

**Changes**: Grep and replace remaining references:
- Comments mentioning "dashboard"
- Any test files referencing "dashboard"
- Store properties (verify grades.store.ts has none)

**Validation**:
- `grep -ri 'dashboard' apps/academics/src/routes/grades/ apps/academics/src/components/grades/ apps/academics/src/stores/grades.store.ts apps/academics/src/hooks/useGrades.ts` → zero matches
- Build succeeds

---

### Sprint 2: Fix Grade Calculation Engine — Stubs, Duplicates, Letter Grades

**Goal**: Fix all data integrity issues in the grade calculation engine so grades are correct and complete.

**Demoable Outcome**: Dual Enrollment Calculus students show grades reflecting only graded work (~80-95%). Letter grade column shows A/B/C/D/F. No duplicate assignments.

---

#### Ticket 2.1: Fix weighted grade calculation — skip ungraded-only categories from weighted sum

**File**: `server/application/microservices/academics/src/grades/grades.service.ts` — `calculateWeightedGrade()` (lines 672-787)

**Problem**: When a category has assignments where ALL entries have `earnedPoints === undefined` (stubs), the category contributes `0% × weight` and adds its weight to `totalWeight`, making normalization produce wrong grades.

**Fix**: After calculating earned/possible for a category, check if any assignments were actually scored. If not, emit the category in `categoryGrades` (for UI display) but skip from `weightedSum` and `totalWeight`:

```typescript
const hasScoredAssignments = effectiveAssignments.some(
  a => a.earnedPoints !== undefined || a.isMissing
);

if (!hasScoredAssignments) {
  categoryGrades.push({
    categoryId: cw.categoryId,
    categoryName: cw.categoryName,
    weight: cw.weight,
    earnedPoints: 0,
    possiblePoints: 0,
    percentage: 0,
    letterGrade: undefined,
  });
  continue; // Don't add to weightedSum or totalWeight
}
```

Note: The existing normalization at line 773 `(weightedSum / (totalWeight / 100))` handles partial weights correctly — if `totalWeight = 30` (two categories with weights 20 and 10), the math normalizes to 100%.

Note: A category with ONLY `isMissing: true` assignments (no scored, no stubs) correctly contributes 0% at full weight — missing work penalizes the grade.

**Validation**:
- Unit test: 5 categories, only 2 have scored assignments → weighted sum normalizes to those 2 categories
- Unit test: Tyler Brooks in Calculus (quizzes 94.5%, participation 98%, all else stubs) → ~95.67% (not 28.7%)
- Unit test: All categories scored → same result as before (no regression)
- Unit test: Category with only `isMissing` assignments → contributes 0% at full weight (correct penalty)

---

#### Ticket 2.2: Ensure stubs within a scored category don't inflate the denominator

**File**: `server/application/microservices/academics/src/grades/grades.service.ts` — inner assignment loop

**Changes**: Add explicit handling with clear comments for each assignment state:

```typescript
for (const a of effectiveAssignments) {
  if (a.isMissing) {
    possible += a.possiblePoints; // Missing: penalizes student
    continue;
  }
  if (a.earnedPoints === undefined) {
    continue; // Ungraded stub: skip entirely
  }
  // Scored assignment
  if (a.isExtraCredit) {
    earned += a.earnedPoints;
  } else {
    earned += a.earnedPoints;
    possible += a.possiblePoints;
  }
}
```

**Validation**:
- Unit test: Category with 3 graded + 2 stubs → percentage = graded earned / graded possible
- Unit test: `earnedPoints: 0` (scored zero) → contributes 0/possiblePoints
- Unit test: `earnedPoints: undefined` → does NOT contribute to denominator

---

#### Ticket 2.3: Fix duplicate assignment stubs in grade recording

**File**: `server/application/microservices/academics/src/grades/grades.service.ts` — `recordAssignmentGrade()` (line 170-176) and `recordBulkGrades()`

**Problem**: The dedup check at line 171 uses `assignmentId`. When bulk recording creates stubs with NEW assignmentIds for the same logical assignment (same `assignmentName` + `categoryId`), they're never deduped.

**Fix**: Before appending a new assignment, also check for matching `assignmentName` + `categoryId`:
```typescript
const assignments = [...(grade.assignments || [])];
// Check by ID first (exact match), then by name+category (semantic match)
let existingIdx = assignments.findIndex(a => a.assignmentId === assignmentId);
if (existingIdx < 0) {
  existingIdx = assignments.findIndex(
    a => a.assignmentName === assignmentGrade.assignmentName
      && a.categoryId === assignmentGrade.categoryId
      && a.earnedPoints === undefined // Only merge with stubs, not scored entries
  );
}
if (existingIdx >= 0) {
  assignments[existingIdx] = assignmentGrade;
} else {
  assignments.push(assignmentGrade);
}
```

**Validation**:
- Unit test: Record "Quiz 1" twice with different IDs → only 1 entry
- Unit test: Record "Quiz 1" as stub, then score it → stub updated, not duplicated
- Unit test: Two different assignments with same name but different categories → both kept
- Manual: Verify no duplicate assignments in Honors Chemistry gradebook

---

#### Ticket 2.4: Investigate and fix `letterGrade` always returning `null`

**Files**:
- `server/application/microservices/academics/src/grades/grades.service.ts` — `lookupLetterGrade()` (lines 811-827)
- `server/application/microservices/academics/src/grades/grading-policy.service.ts` — `getDefaultPolicyEntity()`

**Investigation**:
1. Query the actual grading policies in the pilot school's DynamoDB and inspect `gradingScale` entries — do they use integer boundaries (80-89) or decimal (80-89.99)?
2. If integer: `lookupLetterGrade(89.5, scale)` → 89.5 > 89 (B max), 89.5 < 90 (A min) → falls through all ranges → returns last entry's letter (likely F). This is the root cause.
3. If decimal (89.99): the lookup should work. Then trace `getDefaultPolicyEntity()` — is it returning null?

**Fix options** (implement whichever matches root cause):
- **If scale gap**: Change `lookupLetterGrade` to use `<` instead of `<=` for maxPercentage (so B becomes 80-89.99...) OR normalize scale ranges on policy creation to be contiguous
- **If policy not found**: Fix `getDefaultPolicyEntity()` query to match the school's partition key
- **If letterGrade computed but undefined**: The `?? null` at line 187 converts `undefined` to `null` correctly, so the issue is upstream in `lookupLetterGrade`

Also: Add the same runtime backfill logic from `getStudentGrades()` (lines 434-448) to `getSectionGrades()` for consistency until all grades are recalculated.

**Validation**:
- Unit test: `lookupLetterGrade(95, scale)` → `'A'`
- Unit test: `lookupLetterGrade(89.5, [B: 80-89, A: 90-100])` → `'B'` (not undefined)
- Unit test: `lookupLetterGrade(0, scale)` → `'F'`
- Integration: Record a grade → GET section grades → `letterGrade !== null`

---

#### Ticket 2.5: Add optimistic locking to grade recording

**File**: `server/application/microservices/academics/src/grades/grades.service.ts` — `recordAssignmentGrade()` DynamoDB update

**Problem**: Two concurrent grade recordings for the same student read-modify-write without a version condition. One can silently overwrite the other. The grading policy update at `grading-policy.service.ts:330` already uses `ConditionExpression: 'version = :expectedVersion'` — grade recording should match.

**Fix**: Add condition expression to the update:
```typescript
ConditionExpression: 'version = :expectedVersion',
ExpressionAttributeValues: {
  ...exprValues,
  ':expectedVersion': grade.version ?? 0,
}
```
With retry logic (up to 3 retries) on `ConditionalCheckFailedException` — re-read the grade, re-apply the assignment, re-calculate, and try again.

**Validation**:
- Unit test: Concurrent updates to same grade → second gets ConditionalCheckFailedException → retries successfully
- No silent data loss when two teachers record grades simultaneously

---

#### Ticket 2.6a: Unit tests — simple average scenarios

**New file**: `server/application/microservices/academics/src/grades/__tests__/grades-calculation.test.ts`

**Test cases**:
1. Simple average: 3 scored assignments → correct percentage
2. Simple average: includes extra credit → extra credit adds to earned only
3. Simple average: one excused assignment → excluded entirely
4. Simple average: `earnedPoints: 0` vs `earnedPoints: undefined` → 0 counts, undefined doesn't
5. Edge: all assignments excused → returns `numericGrade: 0`, no letter, no GPA (document: product decision — "N/A" may be better pedagogically)

**Validation**: `npm run test -- --testPathPattern=grades-calculation` → all pass

---

#### Ticket 2.6b: Unit tests — weighted grade scenarios (including stub fix)

**Test cases**:
6. Weighted: all categories scored → correct weighted average
7. Weighted: some categories empty (no assignments) → only populated categories weighted
8. Weighted: some categories have ONLY stubs → excluded from weighted sum (ticket 2.1)
9. Weighted: mix of stubs and scored in one category → only scored contribute (ticket 2.2)
10. Weighted: drop lowest in a category → correct
11. Weighted: missing assignment → contributes to denominator
12. Weighted: category with ONLY missing assignments → contributes 0% at full weight

**Validation**: All pass

---

#### Ticket 2.6c: Unit tests — letter grade, GPA, rounding, edge cases

**Test cases**:
13. Letter grade: boundary 89.5 with integer scale → explicitly define expected behavior
14. Letter grade: 90, 90.1, 59.9, 60 → correct letters
15. GPA lookup: grade above 100% (extra credit) → returns highest GPA
16. Rounding: up/down/nearest for 89.445 → correct
17. Edge: single assignment scored → correct calculation

**Note**: Test fixtures MUST use contiguous decimal boundaries (89.99, not 89) to match the auto-created default policy. Add a separate test with integer-boundary scales to validate the gap-handling fix from Ticket 2.4.

**Validation**: All pass

---

#### Ticket 2.7: Recalculate existing grades (3-phase: dry-run → validate → execute)

**File**: `server/application/microservices/academics/src/grades/grades.service.ts`

**Phase A — Dry-run utility**:
- Create `recalculateGradesForSchool(schoolId, dryRun = true)` method
- For each grade: re-run `calculateGrade()` with fixed logic, compare old vs new values
- In dry-run mode: log changes without writing to DynamoDB
- Output: `{ studentName, course, oldGrade, newGrade, oldLetter, newLetter }[]`
- Must respect `isFinal === true` — log finalized grades as "would change but is locked"

**Phase B — Validate output**:
- Run dry-run on pilot school
- Verify: Dual Enrollment Calculus students go from ~24-29% to ~80-95%
- Verify: Honors Chemistry and Algebra I grades are unchanged or only change letter grade
- Sign off before executing

**Phase C — Execute live**:
- Run with `dryRun = false`
- Store before/after values in an audit log
- Must be scoped to tenant via partition key (multi-tenant isolation)
- Only runnable by TenantAdmin (authorization check)

**Validation**:
- Dry-run output matches manual calculation
- After execution: GET section grades → grades are correct
- Finalized grades are not modified

---

### Sprint 3: Backend Aggregation API for Overview

**Goal**: Replace client-side N+1 aggregation with a single backend endpoint. Fix academicYearId filtering.

**Demoable Outcome**: Overview loads with 1 API call instead of 8+. Only shows grades for the current academic year.

**Prerequisite**: Sprint 2 complete (so aggregated data is correct).

---

#### Ticket 3.1: Create `GET /academics/grades/overview` backend endpoint

**Files**:
- `server/application/microservices/academics/src/grades/grades.controller.ts`
- `server/application/microservices/academics/src/grades/grades.service.ts`

**Endpoint**: `GET /academics/grades/overview?schoolId={schoolId}&academicYearId={yearId}`

**Response**:
```typescript
interface GradeOverviewResponse {
  totalStudentsGraded: number;
  averageGpa: number;
  averageGrade: number;
  passRate: number;
  atRiskCount: number;
  gradeDistribution: { range: string; count: number }[];
  coursePerformance: {
    courseId: string;
    courseName: string;
    sectionCount: number;
    studentCount: number;
    avgGrade: number;
    avgGpa: number;
    passRate: number;
  }[];
  atRiskStudents: {
    studentId: string;
    studentName: string;
    courseId: string;
    courseName: string;
    numericGrade: number;
    letterGrade: string | null;
  }[];
  totalSections: number;
  sectionsWithGrades: number;
}
```

**Implementation**:
- Query grade items for the school using GSI1 (tenant+school scope), filtered by academicYearId
- Aggregate in-memory on the server
- Ensure `RequestContext.tenantId` is used for partition key (multi-tenant isolation)

**Performance targets**:
- < 2s for 8 sections / 24 students (pilot school)
- < 5s for 50 sections / 500 students (medium school)
- For 200+ sections: consider materialized aggregation or caching (track as tech debt)

**Validation**:
- `curl GET /academics/grades/overview?schoolId=...&academicYearId=...` → 200 with correct stats
- Response filtered by academicYearId (doesn't include other years)
- Different tenantId → 403 or empty results (isolation)

---

#### Ticket 3.2: Add Zod schema for overview response in shared-types

**File**: `packages/shared-types/src/schemas/academics/grade.schema.ts`

**Changes**: Add `gradeOverviewResponseSchema` Zod schema and `GradeOverviewResponse` TS type

**Validation**: `pnpm build` in shared-types succeeds; type importable from `@aibrains/shared-types`

---

#### Ticket 3.3: Add frontend service method and React Query hook

**Files**:
- `edforge-saas-frontend/apps/academics/src/services/academics.service.ts`
- `edforge-saas-frontend/apps/academics/src/hooks/useGrades.ts`

**Changes**: Add `getGradeOverview()` service method, `useGradeOverview()` hook, `gradeKeys.overview()` query key

**Validation**: Build succeeds; hook returns typed `GradeOverviewResponse`

---

#### Ticket 3.4: Refactor Overview component to use backend endpoint

**File**: `edforge-saas-frontend/apps/academics/src/routes/grades/overview.tsx`

**Changes**:
- Remove `useAggregatedGrades()` hook (client-side aggregation, ~130 lines)
- Remove `useQueries` import
- Replace with `useGradeOverview(schoolId, academicYearId)` single call
- Remove `sections` prop dependency — update parent `index.tsx` accordingly
- This fixes the `_academicYearId` unused prop issue (now the backend filters by it)

**Validation**:
- Network tab: 1 API call instead of 8
- Overview renders same stat cards, chart, tables
- Loading/error/empty states work correctly

---

#### Ticket 3.5: Register overview route in API Gateway

**File**: API Gateway configuration (follow pattern from commit `c05393f`)

**Validation**: `curl` through production gateway returns 200

---

### Sprint 4: Assessment Type Classification (Formative vs Summative)

**Goal**: Add formative/summative distinction per US Dept of Education Ed Tech Developer's Guide.

**Demoable Outcome**: Assignments classified as formative or summative. Overview shows breakdown by type.

---

#### Ticket 4.1: Add `assessmentCategory` field to AssignmentGrade data model

**Files**:
- `packages/shared-types/src/schemas/academics/grade.schema.ts`
- `server/application/microservices/academics/src/common/entities/grade.entity.ts`

**Changes**:
```typescript
assessmentCategory?: 'formative' | 'summative';
```
Optional — backward compatible with existing data.

**Validation**: Build succeeds in shared-types and server

---

#### Ticket 4.2: Add auto-classification with policy-level override

**Files**:
- `server/application/microservices/academics/src/grades/grades.service.ts`
- `server/application/microservices/academics/src/common/entities/grading-policy.entity.ts`

**Changes**:
- Add `defaultAssessmentCategory?: 'formative' | 'summative'` to `CategoryWeight` in grading policy entity
- In `recordAssignmentGrade()`: If `assessmentCategory` is not explicitly provided, check the policy category's `defaultAssessmentCategory`. If that's also not set, infer from type:
  - Formative defaults: quizzes, homework, participation, classwork
  - Summative defaults: tests, exams, projects, midterm, final
  - Unknown: undefined

**Rationale**: Per Ed Tech Developer's Guide, the formative/summative distinction is about purpose, not type. A quiz CAN be summative. The policy-level override lets schools configure this correctly.

**Validation**:
- Unit test: `quizzes` with no override → `formative`
- Unit test: `quizzes` with policy override `summative` → `summative`
- Unit test: explicit `assessmentCategory` in request → not overridden

---

#### Ticket 4.3: Update BulkGradeModal and AssignmentEditor for assessment purpose

**Files**:
- `edforge-saas-frontend/apps/academics/src/components/grades/BulkGradeModal.tsx`
- `edforge-saas-frontend/apps/academics/src/components/grades/AssignmentEditor.tsx`

**Changes**: Add "Assessment Purpose" dropdown: Auto-detect (default) | Formative | Summative

**Validation**: Manual: select purpose → included in API payload

---

#### Ticket 4.4a: Add assessment breakdown to overview endpoint (backend)

**File**: `server/application/microservices/academics/src/grades/grades.service.ts`

**Changes**: Extend overview response with:
```typescript
assessmentBreakdown: {
  formative: { count: number; avgScore: number };
  summative: { count: number; avgScore: number };
  unclassified: { count: number; avgScore: number };
}
```
Handle existing data where `assessmentCategory` is undefined (counts as unclassified).

**Validation**: API returns correct breakdown; existing data shows as unclassified

---

#### Ticket 4.4b: Add assessment type breakdown card to overview (frontend)

**File**: `edforge-saas-frontend/apps/academics/src/routes/grades/overview.tsx`

**Changes**: Add "Assessment Type Performance" card:
- Formative: X assignments, avg Y%
- Summative: X assignments, avg Y%
- Insight text comparing the two

**Validation**: Manual: card renders with correct data

---

### Sprint 5: Overview Analytics Enhancement & Data Quality

**Goal**: Make the Overview actionable with progress tracking, attention panels, and category insights.

**Demoable Outcome**: Overview shows grading progress, sections needing attention, category breakdown, and full export.

---

#### Ticket 5.1a: Add grading progress tracking to overview endpoint (backend)

**Extend overview response**:
```typescript
gradingProgress: {
  totalAssignmentEntries: number;
  gradedEntries: number;
  ungradedStubs: number;
  completionRate: number;
}
```

**Validation**: Data matches: 40 entries, 20 scored → 50%

---

#### Ticket 5.1b: Add grading progress stat card to overview (frontend)

**Changes**: Add "Grading Progress" progress bar or stat card

**Validation**: Manual: renders correctly, updates after new grades

---

#### Ticket 5.2: Add "Sections Needing Attention" panel to overview

**Frontend changes**: Show sections where:
- No grades recorded
- Partially graded (some students missing)
- All stubs (assignments created, no scores)

Click section → switches to Gradebook tab with that section pre-selected.

**Validation**: Manual: empty sections appear; click navigates to gradebook

---

#### Ticket 5.3: Add category-level performance breakdown to overview

**Backend**: Extend response with per-category averages across the school.
**Frontend**: "Category Performance" table showing avg by category.

**Validation**: Data matches spot-check of API responses

---

#### Ticket 5.4: Add full gradebook CSV export

**Frontend**: "Export Gradebook CSV" button alongside at-risk export.
CSV columns: Student, Course, Section, Numeric Grade, Letter, GPA, Is Passing, Is Final

**Validation**: CSV downloads correctly, opens in Excel

---

### Sprint 6: Report Card & Student-Centric View

**Goal**: Student-centric grade views and printable report cards.

**Demoable Outcome**: Teachers can generate and print report cards per student.

**Dependencies**: Sprint 2 (correct grades + letter grades)

---

#### Ticket 6.1: Enhance student grades endpoint for multi-course portfolio

**Backend**: Ensure `getStudentGrades()` returns complete portfolio with cumulative GPA across courses.

**Validation**: API returns all courses for a student; GPA calculated correctly

---

#### Ticket 6.2a: Build report card component — data layout and routing

**File**: `edforge-saas-frontend/apps/academics/src/routes/grades/report-card.tsx`

**Changes**: Header (school, student, year, term), course table, category breakdown per course, cumulative GPA. Handle empty state (student with no grades).

**Validation**: All data renders correctly

---

#### Ticket 6.2b: Report card print CSS and export

**Changes**: Print-optimized CSS (`@media print`) — clean layout on letter-size paper, no dark theme artifacts, no navigation chrome.

**Validation**: Ctrl+P → clean print preview

---

#### Ticket 6.2c: Report card responsive and edge cases

**Changes**: Mobile-responsive layout, dark mode screen view, multi-term selector, empty state handling.

**Validation**: Renders on mobile, dark mode, no data scenarios

---

#### Ticket 6.3: Add report card link from gradebook

**File**: `edforge-saas-frontend/apps/academics/src/components/grades/GradebookGrid.tsx`

**Changes**: "View Report Card" icon on each student row.

**Validation**: Click → navigates to correct student's report card

---

## Technical Debt Items (Track, Don't Block)

| Item | Notes |
|------|-------|
| `dueDate`, `description`, `rubricId` on assignments | Full assignment management |
| Grade history/audit trail | Who changed what grade when |
| Grade import from CSV | Schools migrating from other EMIS |
| Grading period filter in overview | Add term dropdown to overview |
| Real-time grade notifications | WebSocket push on grade recording |
| Standards-based grading support | Proficiency levels instead of percentages |
| Standards-aligned gradebook | Map assignments to learning standards |
| Materialized overview aggregation | Cache for schools with 200+ sections |

---

## Sprint Dependencies & Priority Matrix

| Sprint | Priority | Risk | Dependencies | Parallelizable |
|--------|----------|------|-------------|----------------|
| Sprint 1 | P0 | Low (UI-only) | None | Yes — with Sprint 2 |
| Sprint 2 | P0 | High (data integrity) | None | Yes — with Sprint 1 |
| Sprint 3 | P1 | Medium (new endpoint) | Sprint 1 + Sprint 2 | No |
| Sprint 4 | P2 | Medium (schema evolution) | Sprint 3 | No |
| Sprint 5 | P2 | Low (enhancements) | Sprint 3 | Partially |
| Sprint 6 | P3 | Low (new feature) | Sprint 2 | Partially |

**Recommended execution**:
1. **Sprint 1 + Sprint 2 in parallel** (different stack layers)
2. **Sprint 3** after both complete
3. **Sprint 4 → Sprint 5 → Sprint 6** sequential

---

## Critical Path for "Correct Application"

The minimum to produce a **correct** application:
1. **Sprint 1, Ticket 1.1** — Tab alignment (UX consistency)
2. **Sprint 2, Tickets 2.1-2.4** — Grade calculation fix + letter grades + duplicate dedup
3. **Sprint 2, Ticket 2.7** — Recalculate existing bad grades (data repair)

Everything else is enhancement, performance, and new features.
