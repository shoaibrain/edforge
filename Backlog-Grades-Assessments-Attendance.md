# Backlog: Grades, Assessments & Attendance

**Date:** 2026-02-25
**Branch:** `student-portal`
**Status:** Post-UAT deployment prep — P0 fixes from staff review applied

---

## Overview

This backlog consolidates all known bugs, feature gaps, and technical debt across the three core academic domains: **Grades**, **Assessments**, and **Attendance**. Items are categorized by priority (P0 = blocks release, P1 = next quarter, P2 = backlog, P3 = roadmap) and grouped by domain.

### Recent Completions (This Sprint)

- Attendance section context: `sectionId` + `courseName` persisted on attendance records
- Student schedule enrichment: `getStudentSections()` returns courseName, teacherName, roomNumber
- Shared types 0.9.2 published with all schema fixes
- Frontend portal pages migrated to shared type imports
- P0 TOCTOU race fix in `recordBulkAttendance` (condition expression)
- P0 version increment in bulk update expression
- P0 cache key tenant isolation
- P0 StatusBadge normalization (`in_progress` vs `in progress`)

---

## 1. GRADES

### 1.1 P0 — Critical Bugs (Blocks Pilot)

#### BUG-G1: Ungraded assignment stubs treated as zeros in weighted calculation
- **Impact**: Students with partial category completion show drastically wrong grades (85% actual → 28% displayed)
- **Root Cause**: `calculateWeightedGrade()` includes categories with `earnedPoints === undefined` stubs as 0% contribution
- **Fix**: Skip categories where ALL assignments are ungraded from `weightedSum` and `totalWeight`
- **File**: `server/.../grades/grades.service.ts` — calculation engine
- **Test**: `grades-calculation.spec.ts` — add case for mixed graded/ungraded categories
- **Ref**: Grades-Assessments-Sprint-Plan Sprint 2.1

#### BUG-G2: `letterGrade` always returns `null`
- **Impact**: Every API response shows `"letterGrade": null` despite configured grading policies
- **Root Cause**: `calculated.letterGrade` is `undefined` → stored as `null`. Boundary condition: 89.5 may fall between B (max 89) and A (min 90) with `<=` comparisons
- **Fix**: Investigate grading scale contiguity; fix `lookupLetterGrade()` boundary handling; apply consistent backfill in both `getStudentGrades()` and `getSectionGrades()`
- **File**: `server/.../grades/grades.service.ts`, `server/.../grades/grading-policy.service.ts`
- **Ref**: Grades-Assessments-Sprint-Plan Sprint 2.4

#### BUG-G3: Duplicate assignment stubs
- **Impact**: Students show 3+ duplicate assignment stubs with different IDs for the same assignment
- **Root Cause**: Dedup check uses `assignmentId` only; stubs with different IDs are never merged
- **Fix**: Add dedup by `assignmentName + categoryId` for unscored entries
- **File**: `server/.../grades/grades.service.ts`
- **Ref**: Grades-Assessments-Sprint-Plan Sprint 2.2

#### BUG-G4: No optimistic locking on grade recording
- **Impact**: Two concurrent grade recordings silently overwrite each other
- **Root Cause**: `recordAssignmentGrade()` reads-modifies-writes without version condition
- **Fix**: Add `version = :expectedVersion` condition expression (pattern exists in `GradingPolicyService` line 330)
- **File**: `server/.../grades/grades.service.ts`
- **Ref**: Grades-Assessments-Sprint-Plan Sprint 2.5

### 1.2 P1 — High Priority

| ID | Item | Impact | File(s) |
|----|------|--------|---------|
| FEAT-G1 | Backend grades overview aggregation endpoint | Frontend fires N+1 queries (one per section); no single API for dashboard | `grades.service.ts`, `grades.controller.ts` |
| FEAT-G2 | `academicYearId` filtering in overview | Shows grades across ALL years, not just current | `grades.service.ts` (destructured as `_academicYearId`, unused) |
| BUG-G5 | Runtime letterGrade backfill inconsistency | `getStudentGrades()` has backfill, `getSectionGrades()` does not | `grades.service.ts` |
| FEAT-G3 | Tab ordering fix: Dashboard → Overview, move to first position | EdForge convention: Overview is always first tab | Frontend academics app `grades/index.tsx` |
| DEBT-G1 | Parent grades page missing `error` state from useQuery | API errors show no feedback to parent | `ParentGradesPage.tsx` |

### 1.3 P2 — Medium Priority

| ID | Item | Impact | Notes |
|----|------|--------|-------|
| FEAT-G4 | Formative/summative assessment classification | Required by US Dept of Ed; `assessmentCategory` field exists but not populated | Grade Sprint 4 |
| FEAT-G5 | ARIA tab attributes for WCAG 2.1 | Tab navigation not accessible | Missing `role="tab"`, `aria-selected` |
| DEBT-G2 | Frontend grade overview N+1 → single API call | 8 parallel `GET /grades/section/:id` requests | Depends on FEAT-G1 |

### 1.4 P3 — Roadmap

| ID | Item | Notes |
|----|------|-------|
| FEAT-G6 | Transcript / report card generation | No printable report card component exists |
| FEAT-G7 | Grade history / audit trail | No tracking of who changed what grade when; needed for compliance |
| FEAT-G8 | Standards-based grading | Entire model is percentage-based; proficiency levels unsupported |
| FEAT-G9 | Ed-Fi `StudentGrade` interoperability | Current model maps loosely; formal Ed-Fi resource mapping needed |

---

## 2. ASSESSMENTS (ASSIGNMENTS)

### 2.0 Current State

Assessments are **schema-defined but not implemented as a backend service**. Assignment data is currently embedded as `AssignmentGrade[]` arrays within Grade entities. Comprehensive Zod schemas exist in `assignment.schema.ts` (254 lines) including rubric support, submission types, late penalties, and standards alignment — but no backend service or controller implements them.

### 2.1 P1 — Foundation (Must build before GA)

| ID | Item | Description | Dependencies |
|----|------|-------------|--------------|
| FEAT-A1 | Assignment entity design | Separate DynamoDB entity for assignments (currently embedded in Grade); SK pattern: `ASSIGNMENT#{sectionId}#{assignmentId}` | None |
| FEAT-A2 | Assignment CRUD service + controller | Create, read, update, delete assignments; routes: `POST/GET/PATCH/DELETE /academics/assignments` | FEAT-A1 |
| FEAT-A3 | Assignment lifecycle (draft → published → closed) | Schema has `AssignmentStatus` enum; needs enforcement in service | FEAT-A2 |
| FEAT-A4 | Teacher assignment creation UI | Create assignments, set due dates, assign to sections | FEAT-A2 |
| FEAT-A5 | Student assignment list view | Student portal page showing assigned work, due dates, status | FEAT-A2 |

### 2.2 P2 — Enhancement

| ID | Item | Description |
|----|------|-------------|
| FEAT-A6 | Submission tracking | Track when students submitted; `submittedAt`, `isLate` flags |
| FEAT-A7 | Rubric grading interface | CRUD for rubrics with criteria/levels; criterion evaluation scoring |
| FEAT-A8 | Late work penalty calculation | `latePenaltyPercent`, `latePenaltyPerDay` from schema → automatic deduction |
| FEAT-A9 | Assignment categories/grouping | Group by unit/chapter/period; link to grading policy categories |
| FEAT-A10 | Parent assignment visibility | Parent portal page showing child's assigned work and progress |

### 2.3 P3 — Roadmap

| ID | Item | Notes |
|----|------|-------|
| FEAT-A11 | Resubmission workflow | Allow multiple attempts with configurable max retries |
| FEAT-A12 | Assignment extensions | Extend deadlines for individual students |
| FEAT-A13 | File upload / attachment management | Schema supports `online_upload` submission type; needs S3 integration |
| FEAT-A14 | Standards alignment | `learningStandardIds[]` in schema; map to Ed-Fi `LearningStandard` |
| FEAT-A15 | LMS integration | Sync with Google Classroom, Canvas, etc. |
| FEAT-A16 | Peer review / collaborative assignments | Not in schema; future educational feature |

---

## 3. ATTENDANCE

### 3.1 P0 — Critical Bugs (Blocks Pilot)

#### BUG-AT1: `totalStudents` counts records, not enrolled students
- **Impact**: All dashboard metrics are wrong. School with 500 enrolled, 200 recorded shows `totalStudents: 200` and inflated 95% rate (real rate: 38%)
- **Root Cause**: `getDailyAttendanceSummary()` sets `totalStudents: result.items.length` (only attendance records)
- **Fix**: Query enrollments, use `enrolledStudents.length` as denominator
- **File**: `server/.../attendance/attendance.service.ts`
- **Ref**: Attendance-Module-Sprint-Plan Sprint 1.1

#### BUG-AT2: `tardy` status silently dropped from daily summary
- **Impact**: Records stored as `tardy` are not counted in any summary category — silent data loss
- **Root Cause**: `getDailyAttendanceSummary()` only handles `case 'late':`; no `case 'tardy':` fallthrough
- **Fix**: Add `case 'tardy':` as fallthrough to `case 'late':` in both summary methods
- **File**: `server/.../attendance/attendance.service.ts`
- **Ref**: Attendance-Module-Sprint-Plan Sprint 1.2

### 3.2 P1 — High Priority

| ID | Item | Impact | Notes |
|----|------|--------|-------|
| BUG-AT3 | `remote` status handled nowhere | Valid in schema, falls through switch → counted in total but no category | Add `case 'remote':` → count as attending |
| FEAT-AT1 | Grade-level breakdown (`byGradeLevel`) | Dashboard shows placeholder text; government reporting blocked | Requires enrollment integration |
| FEAT-AT2 | Section completion tracking | Admin can't see which teachers/sections recorded attendance today | Need section completion summary |
| FEAT-AT3 | Correction workflow UI | PATCH endpoint exists but no UI for teachers to fix mistakes | Frontend-only |
| DEBT-AT1 | N+1 query storms | `getAttendanceAlerts()` = O(2N+1) DynamoDB ops; `getAttendanceTrend()` = 1 per date | Needs batch queries + parallelization |
| DEBT-AT2 | 8 DTO fields always `undefined` | `studentNumber`, `classroomName`, `minutesLate`, `minutesEarly`, `attendanceType`, `locationVerified`, `excuseType`, `minutesPresent` | False API contract |
| BUG-AT4 | Academic year context missing | Dashboard uses hardcoded `Date.now() - 90 days` instead of academic year start | Incorrect date scoping |
| DEBT-AT3 | Hardcoded thresholds (90% alert, 90-day lookback) | No school-level configuration | Extract to school settings |
| BUG-AT5 | Empty `academicYearId` in bulk attendance path | Bulk attendance doesn't validate or pass `academicYearId` | P1-5 from staff review |
| DEBT-AT4 | Missing section entity logged at `debug` not `warn` | Silent failures during enrichment are hard to diagnose | P1-7 from staff review |
| DEBT-AT5 | Overview red color on API failure | `attendanceRate` defaults to 0 → shows red indicator on error | P1-10 from staff review |

### 3.3 P2 — Medium Priority

| ID | Item | Impact | Notes |
|----|------|--------|-------|
| FEAT-AT4 | Excuse categorization | Structured reporting blocked; `excuseType` enum exists but never populated | Backend schema supports `medical`, `family_emergency`, `religious`, etc. |
| FEAT-AT5 | Period-level attendance tracking | Schema supports it, partially implemented | Full per-period breakdown for secondary schools |
| FEAT-AT6 | Chart tooltip enhancement | Trend API returns full data but tooltip only shows `%` | Underutilized data payload |
| FEAT-AT7 | Student drill-down from alerts | Hooks defined but unused in UI | Missing workflow |
| BUG-AT6 | Partial save clears dirty flag | Bulk save treats 50 records as all-or-nothing; if 3 fail, dirty flag clears | Data loss on intermittent connectivity |
| DEBT-AT6 | Parent attendance page missing `error` state | API errors show no feedback to parent | P1-9 from staff review |

### 3.4 P3 — Roadmap

| ID | Item | Notes |
|----|------|-------|
| FEAT-AT8 | Parent/student absence notifications | Push notifications or email for unexcused absences |
| FEAT-AT9 | Makeup class tracking | Record makeup attendance for excused absences |
| FEAT-AT10 | Geofence / location-based check-in | `locationVerified` field exists in schema |
| FEAT-AT11 | Ed-Fi `StudentSchoolAttendanceEvent` export | Formal mapping to Ed-Fi data standard |
| FEAT-AT12 | Biometric / RFID attendance integration | Hardware integration for automated check-in |

---

## 4. CROSS-CUTTING TECHNICAL DEBT

### 4.1 Frontend

| ID | Item | Domain | Priority |
|----|------|--------|----------|
| DEBT-X1 | `as any` casts in schedule pages | Schedule | P1 |
| DEBT-X2 | Parent portal pages missing `error` state from `useQuery` | All portals | P1 |
| DEBT-X3 | No frontend unit tests for any portal page | All | P2 |
| DEBT-X4 | Schedule phantom fields (`dayOfWeek`, `startTime`, `endTime`, `periodName`) not backed by API | Schedule | P2 |

### 4.2 Backend

| ID | Item | Domain | Priority |
|----|------|--------|----------|
| DEBT-X5 | N+1 `getItem` in `getStudentSections` → use `batchGetItems` | Schedule | P1 |
| DEBT-X6 | Data scope filtering not enforced on all query paths | All | P1 |
| DEBT-X7 | Unit test coverage gaps (attendance service, grade calculation edge cases) | All | P2 |
| DEBT-X8 | Denormalization drift (courseName changes not backfilled) | Grades, Attendance | P2 |
| DEBT-X9 | Overview query fan-out (multiple parallel queries instead of aggregate) | Grades, Attendance | P2 |

### 4.3 Ed-Fi Alignment

| ID | Gap | Current State | Target |
|----|-----|---------------|--------|
| EDFI-1 | Attendance events | Single daily record per student | Separate `StudentSchoolAttendanceEvent` + `StudentSectionAttendanceEvent` |
| EDFI-2 | Grade resources | Custom grade entity | Map to Ed-Fi `Grade`, `StudentGrade` |
| EDFI-3 | Learning standards | `learningStandardIds[]` not populated | Map to Ed-Fi `LearningStandard`, `LearningObjective` |
| EDFI-4 | Grading period | Uses `termId` loosely | Map to Ed-Fi `GradingPeriod` |
| EDFI-5 | Report cards | No implementation | Map to Ed-Fi `ReportCard` |

---

## 5. RECOMMENDED EXECUTION ORDER

### Phase 1: P0 Bug Fixes (1-2 weeks)
> Goal: Data integrity for pilot schools

1. **BUG-G1**: Fix weighted grade calculation (stubs as zeros)
2. **BUG-G2**: Fix letterGrade returning null
3. **BUG-G3**: Fix duplicate assignment stubs
4. **BUG-G4**: Add optimistic locking to grade recording
5. **BUG-AT1**: Fix totalStudents denominator
6. **BUG-AT2**: Fix tardy status handling

### Phase 2: P1 Aggregation & Performance (2-3 weeks)
> Goal: Dashboard performance and correct metrics

7. **FEAT-G1**: Grades overview aggregation endpoint
8. **FEAT-AT1**: Grade-level attendance breakdown
9. **DEBT-AT1**: Batch queries for attendance alerts/trend
10. **DEBT-X5**: `batchGetItems` for student sections

### Phase 3: Assessment Foundation (3-4 weeks)
> Goal: Teachers can create and manage assignments

11. **FEAT-A1**: Assignment entity design
12. **FEAT-A2**: Assignment CRUD service + controller
13. **FEAT-A3**: Assignment lifecycle
14. **FEAT-A4**: Teacher assignment creation UI
15. **FEAT-A5**: Student assignment list view

### Phase 4: Polish & Compliance (2-3 weeks)
> Goal: Error handling, accessibility, Ed-Fi prep

16. **DEBT-X2**: Error states on all portal pages
17. **FEAT-G5**: ARIA tab attributes
18. **FEAT-AT3**: Attendance correction workflow UI
19. **FEAT-AT4**: Excuse categorization
20. **EDFI-1 through EDFI-3**: Initial Ed-Fi resource mapping

### Phase 5: Advanced Features (Ongoing)
> Goal: Report cards, rubrics, notifications

21. **FEAT-G6**: Transcript / report card generation
22. **FEAT-A7**: Rubric grading interface
23. **FEAT-AT8**: Absence notifications
24. **FEAT-G8**: Standards-based grading exploration

---

## Key Files Reference

| Domain | Component | Path |
|--------|-----------|------|
| Grades | Service | `server/application/microservices/academics/src/grades/grades.service.ts` |
| Grades | GPA Calculator | `server/application/microservices/academics/src/grades/gpa-calculator.service.ts` |
| Grades | Grading Policy | `server/application/microservices/academics/src/grades/grading-policy.service.ts` |
| Grades | Entity | `server/application/microservices/academics/src/common/entities/grade.entity.ts` |
| Grades | Schema | `packages/shared-types/src/schemas/academics/grade.schema.ts` |
| Grades | Student Portal | `edforge-saas-frontend/apps/shell/src/pages/student-portal/StudentGradesPage.tsx` |
| Grades | Parent Portal | `edforge-saas-frontend/apps/shell/src/pages/parent-portal/ParentGradesPage.tsx` |
| Assessments | Schema | `packages/shared-types/src/schemas/academics/assignment.schema.ts` |
| Attendance | Service | `server/application/microservices/academics/src/attendance/attendance.service.ts` |
| Attendance | Entity | `server/application/microservices/academics/src/common/entities/attendance.entity.ts` |
| Attendance | Mapper | `server/application/microservices/academics/src/common/mappers/attendance.mapper.ts` |
| Attendance | Schema | `packages/shared-types/src/schemas/academics/attendance.schema.ts` |
| Attendance | Student Portal | `edforge-saas-frontend/apps/shell/src/pages/student-portal/StudentAttendancePage.tsx` |
| Attendance | Parent Portal | `edforge-saas-frontend/apps/shell/src/pages/parent-portal/ParentAttendancePage.tsx` |
| Sprint Plans | Grades | `Grades-Assessments-Sprint-Plan.md` |
| Sprint Plans | Attendance | `Attendance-Module-Sprint-Plan.md` |
