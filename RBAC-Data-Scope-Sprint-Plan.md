# RBAC & Data Scope Hardening Sprint Plan

## Problem Statement

The current RBAC implementation has three categories of critical defects observed when a **Teacher** role user navigates the application:

### Defect 1: Toast Notification Spam (UX)
Multiple "Access Denied — School context required for this operation" toasts fire on Student Detail, Attendance Overview, and Staff Detail pages. The frontend makes API calls missing `schoolId`; the backend PermissionGuard throws 403; the global axios interceptor renders an aggressive toast per failure.

### Defect 2: Teacher Sees All Sections (Security)
A Teacher assigned only to "Mathematics grade 8" can view **all** sections (including "ABCMouse — CMouse first Grade") in both the Attendance and Grades section dropdowns. This is a data scope breach.

### Defect 3: Fail-Open Cascades Everywhere (Architecture)
`DataScopeService.resolveScope()` defaults to **school scope** (all data) on any error. `IdentityClientService.getUserRole()` catches all errors and returns `null`, which also triggers school scope. A single HTTP timeout in the identity service grants a Teacher full school-wide access. This is an unacceptable security posture.

---

## Root Cause Analysis

### Why Teachers see all sections:

```
resolveScope() → getUserRole(userId, schoolId, ctx, email)
                    → HTTP GET /users/{id}/roles/{schoolId}    → may fail
                    → getStaffByEmail(email, ctx)              → may fail or return null
                 → if getUserRole returns null → school scope (FAIL-OPEN) ← BUG
                 → if getUserRole throws      → school scope (FAIL-OPEN) ← BUG
                 → if staffId is undefined    → empty scope (correct)
                 → if resolveTeacherScope fails → school scope (FAIL-OPEN) ← BUG
```

Any failure in the identity service chain causes `resolveScope()` to return `{ type: 'school' }`, granting the Teacher access to **all** data in the school. The Teacher then sees every section, every student, every grade.

**Critical detail:** When `getUserRole()` succeeds (gets role=Teacher) but `getStaffByEmail()` throws a non-404 error, the _entire_ `getUserRole` catch block returns `null` — discarding the successfully-fetched role. This causes `resolveScope()` to hit its null-role path and grant school scope.

### Why toast notifications fire:

| Frontend Hook | Missing Param | Backend Response |
|---|---|---|
| `useStudentAttendanceSummary()` | `schoolId` | 403 "School context required" |
| `useStudentGrades()` | `schoolId` | 403 "School context required" |
| Staff detail `getStaff()` | `schoolId` | 403 "School context required" |

The global axios 403 interceptor calls `toast.error()` for every failure. There is a `gracefulDegradation` meta flag but no callers use it.

### Endpoints missing data scope filtering:

| Endpoint | Has DataScope? | Impact |
|---|---|---|
| `GET /sections` (listSections) | Yes, but fail-open | Teacher sees all sections on failure |
| `GET /students` (listStudents) | Yes, but fail-open | Teacher sees all students on failure |
| `GET /students/:id` (getStudent) | **No** | Any user sees any student's profile |
| `GET /students/:id/profile` (getStudentProfile) | **No** | Any user sees any student's full profile |
| `GET /enrollment` (listEnrollments) | **No** | Any user sees all enrollments |
| `GET /grades/section/:id` (getSectionGrades) | Yes, has check | Verify it works correctly |
| `GET /grades/:studentId` (getStudentGrades) | **No** | Any user sees any student's grades |
| `GET /grades` (getGrade by student/course) | **No** | Any user queries any grade |
| `POST /grades/record` (recordAssignmentGrade) | **No** | Teacher can grade any student |
| `POST /grades/record/bulk` (recordBulkGrades) | **No** | Teacher can bulk-grade any students |
| `POST /grades/finalize` (finalizeGrade) | **No** | Teacher can finalize any grade |
| `POST /grades/finalize/bulk` (bulkFinalizeGrades) | **No** | Teacher can bulk-finalize any grades |
| `GET /attendance/summary` (daily summary) | **No** | School-wide aggregation for all |
| `GET /attendance/trend` | **No** | Unscoped trend data |
| `GET /attendance/alerts` | **No** | School-wide alerts for all |
| `GET /attendance/student/:id` (getStudentAttendance) | **No** | Any user sees any student's records |
| `GET /attendance/student/:id/summary` | **No** | Any user sees any student's summary |
| `POST /sections/:id/students` (enrollStudent) | **No** | Teacher can enroll in any section |
| `DELETE /sections/:id/students/:sid` (dropStudent) | **No** | Teacher can drop from any section |

**Note:** Course, CourseOffering, GradingPolicy, and Classroom endpoints are school-level catalog resources and do NOT need data scope filtering (they are shared infrastructure, not student-scoped). They are correctly protected by PermissionGuard resource:action checks only.

---

## Sprint Overview

| Sprint | Goal | Demo |
|---|---|---|
| **Sprint 1** | Backend fail-closed + staff-user bridge | Teacher with no staffId gets empty scope (not school-wide access) |
| **Sprint 2** | Backend data scope on ALL list/read endpoints | Teacher only sees their sections/students in API responses |
| **Sprint 3** | Backend data scope on ALL write endpoints | Teacher cannot grade/record for students outside their scope |
| **Sprint 4** | Frontend schoolId propagation + graceful error handling | Zero toast spam; permission errors render as empty states |
| **Sprint 5** | Frontend role-conditional UI + section scoping | Teacher sees only their sections in dropdowns; CRUD buttons hidden per role |
| **Sprint 6** | Cross-role E2E validation + hardening | Smoke tests pass for all 7 roles; regression suite in CI |

---

## Sprint 1: Backend Fail-Closed & Staff-User Bridge

**Goal:** Eliminate the fail-open security hole. When data scope resolution fails for a Teacher, deny access instead of granting school-wide access. Ensure Teacher users reliably resolve to a staffId.

**Demo:** A Teacher whose `getStaffByEmail` lookup returns null gets empty scope (no data), not school-wide data. A Teacher with a valid staff record gets section-scoped results. All existing tests still pass.

---

### Task 1.1: Flip DataScopeService default to fail-closed

**File:** `server/application/microservices/academics/src/common/services/data-scope.service.ts`

**What:**
- Change the `DATA_SCOPE_FAIL_CLOSED` env var default from `false` to `true` (secure by default, opt-out to fail-open)
- In `resolveScope()`, when `getUserRole()` returns `null` (no role found / role fetch failed), throw `ForbiddenException` instead of granting school scope — null means "unknown user at this school" which should not get full access
- In `resolveScope()`, when role is `Teacher` and `resolveTeacherScope()` throws, return **empty section scope** (not school scope)
- In `resolveTeacherScope()`, change the catch block from returning school scope to returning empty scope
- Keep school scope for non-Teacher roles (Principal, Staff, etc.) since they legitimately have school-wide access

**Why:** A Teacher whose scope can't be resolved should see **nothing** rather than **everything**. An unknown user should be denied, not granted full access.

**Changes:**
```typescript
// Default to fail-closed (secure by default)
const FAIL_CLOSED = process.env.DATA_SCOPE_FAIL_CLOSED !== 'false';

// resolveScope — null role path:
if (!roleResponse) {
  this.logger.warn(`No role found for user ${userId} at school ${schoolId}`);
  throw new ForbiddenException('No role found at this school');
}

// resolveTeacherScope catch block:
// BEFORE: return { type: 'school', schoolId, role: 'Teacher' };
// AFTER:  return { type: 'section', schoolId, sectionIds: [], studentIds: [], role: 'Teacher' };

// resolveScope outer catch block:
// BEFORE: defaults to school scope when FAIL_CLOSED is not set
// AFTER:  defaults to throw ForbiddenException (since FAIL_CLOSED is now default true)
```

**Tests:**
- Unit test: `resolveTeacherScope` error → returns empty section scope (not school scope)
- Unit test: `resolveScope` with Teacher role + DynamoDB error → returns empty section scope
- Unit test: `getUserRole` returns null → throws ForbiddenException
- Unit test: `resolveScope` outer catch → throws ForbiddenException (default fail-closed)
- Unit test: `DATA_SCOPE_FAIL_CLOSED=false` → outer catch returns school scope (explicit opt-out)
- Verify existing tests still pass (no behavioral change for school-scope roles like Principal)

**Validation:** `npx jest --testPathPattern="data-scope"`

---

### Task 1.2: Fix getUserRole error handling to preserve role info

**File:** `server/application/microservices/academics/src/common/services/identity-client.service.ts`

**What:**
- Separate the try/catch for the roles HTTP call from the staff email lookup
- When `getUserRole()` successfully fetches the role (Teacher) but `getStaffByEmail()` throws, return `{ role: 'Teacher', staffId: undefined }` so `resolveScope` can apply the Teacher-without-staffId path (empty scope)
- `getUserRole` should only return `null` for HTTP 404 (no role found). For all other errors (timeout, 5xx), re-throw so the outer `resolveScope()` catch can apply fail-closed behavior
- Ensure the `ServiceUnavailableException` thrown by `handleError()` in `getStaffByEmail` is caught in the inner try/catch and doesn't propagate to the outer one

**Why:** Currently, if `getStaffByEmail` throws any error, the entire `getUserRole` catch block returns `null`, which causes `resolveScope` to grant school scope. The Teacher's successfully-fetched role information is discarded.

**Changes:**
```typescript
async getUserRole(...): Promise<{ role: string; staffId?: string } | null> {
  const cacheKey = `${userId}:${schoolId}`;
  // ... cache check ...

  let role: string;

  // Step 1: Fetch role (failure here = genuinely can't determine role)
  try {
    const response = await this.httpClient.get<{ role: string }>(
      `${this.identityServiceUrl}/users/${userId}/roles/${schoolId}`, {}, context,
    );
    role = response.data.role;
  } catch (error: any) {
    if (error.response?.status === 404) {
      this.roleCache.set(cacheKey, { data: null, cachedAt: Date.now() });
      return null; // Genuinely no role at this school
    }
    // Non-404: re-throw so resolveScope outer catch applies fail-closed
    this.logger.error(`getUserRole HTTP failed for ${userId} at ${schoolId}: ${error.message}`);
    throw error;
  }

  // Step 2: For Teachers, resolve staffId (failure here doesn't lose the role)
  let staffId: string | undefined;
  if (role === 'Teacher' && email) {
    try {
      const staff = await this.getStaffByEmail(email, context);
      staffId = staff?.staffId;
    } catch (error: any) {
      this.logger.warn(`Staff lookup failed for Teacher ${userId} (${email}): ${error.message}`);
      // staffId stays undefined → resolveScope returns empty Teacher scope
    }
    if (!staffId) {
      this.logger.warn(`Teacher ${userId} has no staffId for email ${email}`);
    }
  }

  const result = { role, staffId };
  this.roleCache.set(cacheKey, { data: result, cachedAt: Date.now() });
  return result;
}
```

**Tests:**
- Unit test: Role fetch succeeds, staff lookup throws ServiceUnavailableException → returns `{ role: 'Teacher', staffId: undefined }`
- Unit test: Role fetch succeeds, staff lookup returns null → returns `{ role: 'Teacher', staffId: undefined }`
- Unit test: Role fetch fails with 500 → **throws** (not returns null)
- Unit test: Role fetch fails with 404 → returns null, cached as null
- Unit test: Role fetch times out → **throws** (not returns null)

**Validation:** `npx jest --testPathPattern="data-scope|identity-client"`

---

### Task 1.3: Add `/staff/by-email` endpoint to Identity Service (if missing)

**Files:** `server/application/microservices/identity/src/staff/` (controller + service)

**What:**
- Verify the Identity Service has a `GET /staff/by-email?email=xxx` endpoint
- If missing, implement it: query DynamoDB for staff by email (GSI lookup or scan with filter)
- If existing, verify it works for the Teacher's email
- Ensure it returns `{ staffId, email, firstName, lastName, ... }` or 404

**Why:** `getUserRole()` calls `getStaffByEmail()` which hits this endpoint. If it doesn't exist or errors, the Teacher gets undefined staffId and (after Task 1.1) empty scope.

**Tests:**
- Integration test: `GET /staff/by-email?email=existing@school.org` → 200 with staff data
- Integration test: `GET /staff/by-email?email=unknown@school.org` → 404
- Integration test: `GET /staff/by-email` (no email param) → 400

**Validation:** `curl http://localhost:3010/staff/by-email?email=edforge.shoaibrain@gmail.com` returns staff data

---

### Task 1.4: Ensure staff records have email field populated

**What:**
- Audit the staff creation flow: when a staff record is created, does it store `email`?
- Audit the role assignment flow: when a Teacher role is assigned to a user, is a corresponding staff record created with matching email?
- If there's a gap (user has Teacher role assignment but no staff record), document the missing bridge and create a one-time backfill script or a sync mechanism

**Why:** The entire Teacher data scope chain depends on: User email → Staff record → staffId → Section primaryTeacherId. If any link is broken, the Teacher can't be scoped.

**Tests:**
- Smoke test script: For each Teacher user, verify `GET /staff/by-email?email={user.email}` returns a staff record
- Smoke test script: For each staff record with role Teacher, verify they have a section with `primaryTeacherId = staffId`

**Validation:** Run smoke test against deployed environment; all Teacher users resolve to a staff record

---

### Task 1.5: Add `filterBySectionScope` helper to DataScopeService

**File:** `server/application/microservices/academics/src/common/services/data-scope.service.ts`

**What:**
- Add a `filterBySectionScope<T extends { sectionId?: string }>(scope: DataScope, items: T[]): T[]` helper method
- Follows the same pattern as `filterByStudentScope` — returns all items for school scope, filters by `sectionIds` set for section scope
- This prevents duplicate section-filtering logic across sections, grades, and attendance services

**Why:** Multiple Sprint 2/3 tasks need to filter lists by section scope. Centralizing this in DataScopeService keeps the pattern consistent.

**Tests:**
- Unit test: school scope → all items returned
- Unit test: section scope with matching sectionIds → filtered items
- Unit test: section scope with empty sectionIds → empty array

**Validation:** `npx jest --testPathPattern="data-scope"`

---

### Task 1.6: Parallelize resolveTeacherScope enrollment queries

**File:** `server/application/microservices/academics/src/common/services/data-scope.service.ts`

**What:**
- In `resolveTeacherScope()`, enrollment queries for each section currently run sequentially in a `for` loop
- Change to `Promise.all()` so enrollment lookups for all sections run in parallel
- This reduces latency from `O(N * queryTime)` to `O(queryTime)` for Teachers with multiple sections

**Changes:**
```typescript
// BEFORE: sequential loop
for (const sectionId of sectionIds) {
  const enrollments = await this.dynamoDBClient.queryGSI<SectionEnrollment>(...);
  for (const enrollment of enrollments.items) {
    if (enrollment.studentId) studentIdSet.add(enrollment.studentId);
  }
}

// AFTER: parallel queries
const enrollmentResults = await Promise.all(
  sectionIds.map(sectionId =>
    this.dynamoDBClient.queryGSI<SectionEnrollment>(
      client, 'gsi1',
      GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
      `SEC_ENROLL#${sectionId}#`, 'begins_with',
      'isActive = :isActive', { ':isActive': true },
    )
  )
);
for (const result of enrollmentResults) {
  for (const enrollment of result.items) {
    if (enrollment.studentId) studentIdSet.add(enrollment.studentId);
  }
}
```

**Tests:**
- Unit test: Teacher with 3 sections → all 3 enrollment queries fire in parallel → correct combined studentIds
- Existing tests still pass

**Validation:** `npx jest --testPathPattern="data-scope"`

---

### Task 1.7: Comprehensive DataScopeService tests

**File:** `server/application/microservices/academics/src/common/services/data-scope.service.spec.ts`

**What:**
Add/update tests for the full scope resolution chain:
- Teacher with valid staffId + assigned sections → section scope with correct sectionIds/studentIds
- Teacher with valid staffId + no sections → empty section scope
- Teacher with undefined staffId (staff lookup fails) → empty section scope (**not** school scope)
- Teacher with undefined staffId (staff lookup returns null) → empty section scope
- `resolveTeacherScope` DynamoDB error → empty section scope (**not** school scope)
- Principal role → school scope
- Non-Teacher unknown role → school scope (MVP default)
- `getUserRole` returns null (404) → throws ForbiddenException
- `getUserRole` throws (timeout/5xx) → throws ForbiddenException (fail-closed default)
- `DATA_SCOPE_FAIL_CLOSED=false` → outer catch returns school scope
- Multi-school Teacher → different scope per school (scope keyed by `userId:schoolId`)

**Validation:** `npx jest --testPathPattern="data-scope" --verbose`

---

## Sprint 2: Backend Data Scope on All Read Endpoints

**Goal:** Every list/read endpoint in the Academics service applies DataScopeService filtering. A Teacher only receives data for their assigned sections and enrolled students.

**Demo:** Teacher API calls to `/sections`, `/students`, `/grades`, `/attendance`, `/enrollment` return only their scoped data. Queries for out-of-scope students return empty results (not 403).

---

### Task 2.1: Wire DataScopeService into student read endpoints

**Files:**
- `server/application/microservices/academics/src/students/students.service.ts`
- `server/application/microservices/academics/src/students/students.controller.ts`

**What:**
- `getStudent()` (single student by ID): resolve scope, check `isStudentInScope()` — return 403 if out of scope
- `getStudentProfile()` (full profile with attendance/grades): resolve scope, check `isStudentInScope()` — return 403 if out of scope
- `listStudents()` already has scope filtering — verify it works correctly with the new fail-closed default (if scope resolution fails, Teacher gets empty list, not all students)

**Why:** Currently a Teacher can view any student's profile by navigating directly to the URL. The backend returns full data regardless of the caller's section scope.

**Tests:**
- Unit test: Teacher calls `getStudent` for in-scope student → student data returned
- Unit test: Teacher calls `getStudent` for out-of-scope student → 403
- Unit test: Principal calls `getStudent` for any student → student data returned
- Unit test: `listStudents` with failed scope resolution → empty list (not all students)

**Validation:** `npx jest --testPathPattern="students"`

---

### Task 2.2: Wire DataScopeService into Enrollment Service

**File:** `server/application/microservices/academics/src/enrollment/enrollment.service.ts`

**What:**
- Inject `DataScopeService` into `EnrollmentService`
- In `listEnrollments()`: resolve scope, filter results by `filterByStudentScope()`
- In `getEnrollment()`: resolve scope, check `isStudentInScope()` — return null/empty if out of scope
- In `getStudentEnrollmentHistory()`: resolve scope, check `isStudentInScope()`

**Why:** Currently returns all enrollments for the school regardless of the caller's role.

**Tests:**
- Unit test: Teacher scope → only returns enrollments for students in their sections
- Unit test: Principal scope → returns all enrollments
- Unit test: Teacher queries out-of-scope student enrollment → empty result

**Validation:** `npx jest --testPathPattern="enrollment"`

---

### Task 2.3: Wire DataScopeService into individual Grade endpoints

**File:** `server/application/microservices/academics/src/grades/grades.service.ts`

**What:**
- `getGrade()` (single grade lookup by student/course/term): resolve scope, check `isStudentInScope()` — return null if out of scope
- `getStudentGrades()` (all grades for a student): resolve scope, check `isStudentInScope()` — return empty if out of scope
- `getSectionGrades()`: resolve scope, check `isSectionInScope(sectionId)` — return empty if Teacher doesn't own that section
- `getGradeOverview()` already has scope filtering — verify it works correctly

**Why:** Currently, `getGrade()`, `getStudentGrades()`, and `getSectionGrades()` return data for any student/section regardless of caller's scope.

**Tests:**
- Unit test: Teacher calls `getStudentGrades` for in-scope student → grades returned
- Unit test: Teacher calls `getStudentGrades` for out-of-scope student → empty
- Unit test: Teacher calls `getSectionGrades` for out-of-scope section → empty
- Unit test: Principal calls `getStudentGrades` for any student → grades returned

**Validation:** `npx jest --testPathPattern="grades"`

---

### Task 2.4: Wire DataScopeService into Attendance summary/trend/alerts endpoints

**File:** `server/application/microservices/academics/src/attendance/attendance.service.ts`

**What:**
- `getDailyAttendanceSummary()`: resolve scope, filter attendance records before aggregation
- `getAttendanceTrend()`: resolve scope, filter trend data to scoped students/sections
- `getAttendanceAlerts()`: resolve scope, filter alerts to only students within scope
- Verify `getAttendanceByDate()` and `getAttendanceOverview()` scope filtering is correct

**Why:** Summary, trend, and alerts endpoints currently return school-wide aggregations/data even for Teachers.

**Tests:**
- Unit test: Teacher daily summary → counts only their students' attendance
- Unit test: Teacher trend → only includes their sections' data
- Unit test: Teacher alerts → only shows at-risk students in their scope
- Unit test: Principal daily summary → school-wide counts

**Validation:** `npx jest --testPathPattern="attendance"`

---

### Task 2.5: Add scope check to student-specific attendance endpoints

**Files:** `server/application/microservices/academics/src/attendance/attendance.controller.ts` + `attendance.service.ts`

**What:**
- `GET /attendance/student/:studentId/summary`: resolve scope, check `isStudentInScope(studentId)` — return empty summary if out of scope (not 403, to support graceful degradation)
- `GET /attendance/student/:studentId` (raw attendance records): resolve scope, check `isStudentInScope(studentId)` — return empty if out of scope
- Ensure `schoolId` is required as a query parameter for these endpoints

**Why:** These endpoints are called from the Student Detail Overview tab. Without schoolId, the PermissionGuard throws 403 (causing toast). Without scope check, any user can query any student's attendance.

**Tests:**
- Unit test: Teacher queries own student → summary returned
- Unit test: Teacher queries out-of-scope student → empty summary
- Unit test: Endpoint called without schoolId → 400 (not 403, see Task 2.7)

**Validation:** `npx jest --testPathPattern="attendance"`

---

### Task 2.6: Add scope check to student-specific grades endpoint

**Files:** `server/application/microservices/academics/src/grades/grades.controller.ts` + `grades.service.ts`

**What:**
- `GET /students/:studentId/grades`: resolve scope, check `isStudentInScope(studentId)` — return empty if out of scope
- Ensure `schoolId` is accepted as a query parameter

**Why:** Same pattern as Task 2.5 — called from Student Detail Overview tab without schoolId.

**Tests:**
- Unit test: Teacher queries own student grades → grades returned
- Unit test: Teacher queries out-of-scope student → empty
- Unit test: Missing schoolId → 400

**Validation:** `npx jest --testPathPattern="grades"`

---

### Task 2.7: Update PermissionGuard to return 400 (not 403) for missing schoolId

**File:** `server/application/microservices/academics/src/common/guards/permission.guard.ts`

**What:**
- Change the response when `schoolId` is missing from `ForbiddenException` (403) to `BadRequestException` (400)
- Update error message to: `"Missing required parameter: schoolId"`

**Why:** Missing schoolId is a client error (bad request), not an authorization failure. Using 400 makes the error semantically correct and allows the frontend to distinguish between "you forgot a parameter" and "you don't have permission." The frontend interceptor only toasts on 403, not 400.

**IMPORTANT deployment note:** This change MUST be deployed together with Sprint 4's frontend changes (Task 4.4/4.5), since the current frontend 403 interceptor handles this case. If deployed alone, the frontend would show a raw unhandled 400 error. Bundle this task with Sprint 4 deployment OR add 400 handling to the frontend interceptor first.

**Tests:**
- Update existing permission.guard.spec.ts: `should throw BadRequestException when schoolId is missing`
- Update permission-matrix.spec.ts if it tests missing schoolId scenarios

**Validation:** `npx jest --testPathPattern="permission"`

---

### Task 2.8: Comprehensive backend data scope integration tests

**File:** New file `server/application/microservices/academics/src/common/services/data-scope-integration.spec.ts`

**What:**
Create an integration test suite that validates data scope across all services:
- Mock a Teacher with 2 sections and 5 students
- For each service (sections, students, grades, attendance, enrollment):
  - Verify list endpoints return only scoped data
  - Verify single-item endpoints return empty/403 for out-of-scope items
  - Verify Principal gets all data
  - Verify TenantAdmin gets all data

**Validation:** `npx jest --testPathPattern="data-scope-integration"`

---

## Sprint 3: Backend Write Authorization

**Goal:** Teachers can only create/update records for students within their scope. Write operations validate scope before persisting.

**Demo:** Teacher attempts to record a grade for an out-of-scope student → receives 403. Teacher records a grade for their own student → succeeds.

---

### Task 3.1: Add scope validation to grade recording (single + bulk)

**File:** `server/application/microservices/academics/src/grades/grades.service.ts`

**What:**
- In `recordAssignmentGrade()`: resolve scope, validate `isSectionInScope(sectionId)` and `isStudentInScope(studentId)` before writing
- In `recordBulkGrades()`: resolve scope, validate the sectionId and ALL studentIds in the batch are in scope — reject entire batch if any is out of scope
- Throw `ForbiddenException('You do not have access to grade this student')` if out of scope
- Add the check BEFORE the DynamoDB put, not after

**Why:** Currently a Teacher can record grades for any student in any section.

**Tests:**
- Unit test: Teacher records single grade for in-scope student → success
- Unit test: Teacher records single grade for out-of-scope student → 403
- Unit test: Teacher bulk records grades with all in-scope students → success
- Unit test: Teacher bulk records grades with one out-of-scope student → 403 (entire batch)
- Unit test: Principal records grade for any student → success

**Validation:** `npx jest --testPathPattern="grades"`

---

### Task 3.2: Add scope validation to grade finalization (single + bulk)

**File:** `server/application/microservices/academics/src/grades/grades.service.ts`

**What:**
- In `finalizeGrade()`: resolve scope, validate student is in scope
- In `bulkFinalizeGrades()`: resolve scope, validate `isSectionInScope(sectionId)` for the target section

**Tests:**
- Unit test: Teacher finalizes own student grade → success
- Unit test: Teacher finalizes out-of-scope student grade → 403
- Unit test: Teacher bulk-finalizes own section → success
- Unit test: Teacher bulk-finalizes out-of-scope section → 403

**Validation:** `npx jest --testPathPattern="grades"`

---

### Task 3.3: Add scope validation to attendance recording (single + bulk + update)

**File:** `server/application/microservices/academics/src/attendance/attendance.service.ts`

**What:**
- In `recordAttendance()`: resolve scope, validate section and student are in scope
- In `bulkRecordAttendance()`: resolve scope, validate ALL students in the batch are in scope — reject entire batch if any student is out of scope
- In `updateAttendance()`: resolve scope, verify the attendance record's student is in scope before allowing update
- Throw `ForbiddenException` for out-of-scope writes

**Why:** A Teacher should only record/modify attendance for their assigned sections.

**Tests:**
- Unit test: Teacher records attendance for in-scope section → success
- Unit test: Teacher records attendance for out-of-scope section → 403
- Unit test: Teacher bulk records with one out-of-scope student → 403 (entire batch rejected)
- Unit test: Teacher updates own student's attendance → success
- Unit test: Teacher updates out-of-scope student's attendance → 403

**Validation:** `npx jest --testPathPattern="attendance"`

---

### Task 3.4: Add scope validation to section enrollment/drop

**File:** `server/application/microservices/academics/src/sections/sections.service.ts`

**What:**
- In `enrollStudentInSection()`: resolve scope, validate `isSectionInScope(sectionId)` — Teacher can only add students to their own sections
- In `removeStudentFromSection()`: resolve scope, validate `isSectionInScope(sectionId)` — Teacher can only drop students from their own sections

**Why:** Teachers should not be able to modify rosters for sections they don't teach.

**Tests:**
- Unit test: Teacher enrolls student in own section → success
- Unit test: Teacher enrolls student in other section → 403
- Unit test: Principal enrolls student in any section → success

**Validation:** `npx jest --testPathPattern="sections"`

---

### Task 3.5: Add scope validation to enrollment mutations

**File:** `server/application/microservices/academics/src/enrollment/enrollment.service.ts`

**What:**
- In `createEnrollment()`: resolve scope, validate `isStudentInScope(studentId)` for Teachers
- In `updateEnrollment()`: resolve scope, validate `isStudentInScope(studentId)`
- In `withdrawStudent()`: resolve scope, validate `isStudentInScope(studentId)`
- In `transferStudent()`: resolve scope, validate `isStudentInScope(studentId)`

**Why:** Teachers should only be able to modify enrollment for students in their scope. Note: most enrollment mutations are typically Principal-level operations (via PermissionGuard), but adding scope checks provides defense-in-depth.

**Tests:**
- Unit test: Teacher creates enrollment for in-scope student → success
- Unit test: Teacher creates enrollment for out-of-scope student → 403

**Validation:** `npx jest --testPathPattern="enrollment"`

---

### Task 3.6: Write authorization test matrix

**File:** New file `server/application/microservices/academics/src/common/guards/write-authorization.spec.ts`

**What:**
Create a comprehensive test that validates write authorization for every role × write endpoint combination:
- Teacher: can write to own sections/students only
- Principal: can write to all sections/students
- Staff/Counselor/Nurse/Accountant: cannot write grades/attendance (permission denied at guard level)
- VicePrincipal: can write attendance (has `attendance:create`), scoped to school

**Validation:** `npx jest --testPathPattern="write-authorization"`

---

## Sprint 4: Frontend schoolId Propagation & Graceful Error Handling

**Goal:** Eliminate all toast notification spam. Every API call includes `schoolId`. Permission errors render as empty states, not toasts.

**Demo:** Teacher navigates through all pages — zero "Access Denied" toasts. Missing data shows clean empty states with helpful messages.

---

### Task 4.1: Add schoolId to useStudentAttendanceSummary hook

**Files:**
- `edforge-saas-frontend/apps/academics/src/hooks/useAttendance.ts`
- `edforge-saas-frontend/apps/academics/src/services/academics.service.ts`

**What:**
- Add `schoolId` parameter to `UseStudentAttendanceSummaryOptions` interface
- Pass `schoolId` as query param in `getStudentAttendanceSummary()` service function
- Update the `OverviewTab` component to pass `schoolId` from `useActiveSchoolId()`

**Tests:**
- Verify the hook passes schoolId to the API call
- Verify OverviewTab doesn't trigger 403 toast

**Validation:** Open Student Detail page as Teacher — no "Access Denied" toast for attendance summary

---

### Task 4.2: Add schoolId to useStudentGrades hook

**Files:**
- `edforge-saas-frontend/apps/academics/src/hooks/useGrades.ts`
- `edforge-saas-frontend/apps/academics/src/services/academics.service.ts`

**What:**
- Add `schoolId` parameter to `useStudentGrades()` hook
- Pass `schoolId` as query param in `getStudentGrades()` service function
- Update `OverviewTab` to pass schoolId

**Tests:**
- Verify the hook passes schoolId to the API call
- Verify OverviewTab doesn't trigger 403 toast

**Validation:** Open Student Detail page as Teacher — no "Access Denied" toast for grades

---

### Task 4.3: Add schoolId to Staff Detail API calls

**Files:**
- `edforge-saas-frontend/apps/people/src/services/staff.service.ts`
- `edforge-saas-frontend/apps/people/src/routes/staff/detail.tsx`

**What:**
- Add `schoolId` parameter to `getStaff()` service function
- Pass `schoolId` from the active school context in the staff detail page
- If the staff endpoint doesn't need RBAC (People module might not use PermissionGuard), verify whether the `@RequirePermission` decorator is applied and adjust accordingly

**Tests:**
- Verify staff detail page loads without 403 toast

**Validation:** Navigate to Staff Directory → Staff Detail as Teacher — no "Access Denied" toast

---

### Task 4.4: Audit ALL frontend API calls for missing schoolId

**Files:** All files in `edforge-saas-frontend/apps/*/src/services/` and `edforge-saas-frontend/apps/*/src/hooks/`

**What:**
- Search for all `apiGet`, `apiPost`, `apiPatch`, `apiDelete` calls
- For each call to an `/academics/` endpoint, verify `schoolId` is included
- Fix any remaining calls that omit schoolId
- Create a checklist of all endpoints and their schoolId status
- Add a CI grep check: `grep -r "apiGet.*'/academics/" --include="*.ts" | grep -v schoolId` should return zero matches (prevents regressions)

**Tests:**
- Grep-based validation: every `apiGet('/academics/` call includes `schoolId` in params

**Validation:** Full frontend smoke test — navigate all pages as Teacher — zero 403 toasts

---

### Task 4.5: Replace aggressive 403 toast with graceful degradation

**Files:**
- `edforge-saas-frontend/apps/academics/src/lib/api.ts`
- `edforge-saas-frontend/apps/people/src/lib/api.ts`
- `edforge-saas-frontend/apps/shell/src/lib/api.ts`

**What:**
- Change the 403 interceptor to suppress toasts for GET requests (read failures = component handles gracefully)
- Only show toast for 403 on POST/PUT/PATCH/DELETE (write operations where user explicitly tried an action)
- For GET 403s, let the React Query error bubble up to the component level
- Also handle 400 errors for missing schoolId (from Task 2.7) — suppress toast, let component handle

**Changes:**
```typescript
if (status === 403 && !isRedirecting) {
  const errorData = error.response?.data as Record<string, unknown> | undefined
  const message = (errorData?.message as string) || 'You don\'t have permission...'
  const method = error.config?.method?.toUpperCase()

  // Only toast on write operations (user explicitly took an action)
  // For reads, let the error bubble to the component for graceful degradation
  if (method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    toast.error('Access Denied', { description: message })
  }
}
```

**Why:** GET 403s should render as empty states in the component, not as toasts. Toasts should only fire when a user explicitly performs an action that fails.

**Tests:**
- Manual test: Teacher navigates to page with insufficient permissions → sees empty state, not toast
- Manual test: Teacher tries to create a record without permission → sees toast (expected)

**Validation:** Full app navigation as Teacher — zero unexpected toasts

---

### Task 4.6: Add permission-aware error boundaries to data components

**Files:**
- `edforge-saas-frontend/apps/academics/src/components/students/profile/OverviewTab.tsx`
- Other components that display attendance/grades data

**What:**
- Wrap data-fetching hooks in error handling that detects 403 responses
- Render an `AccessRestricted` empty state component instead of crashing or showing nothing
- Design: subtle info card with lock icon
- Different messaging for "permission denied" vs "no data":
  - Permission denied (403): "This content is restricted. Contact your administrator."
  - No data in scope (empty response): "No records found for your assigned sections."
  - Missing data (loading): Standard loading spinner

**Tests:**
- Component renders `AccessRestricted` when API returns 403
- Component renders normal empty state when API returns empty data

**Validation:** Teacher opens Student Detail → attendance card shows "No records found for your assigned sections" (not toast)

---

## Sprint 5: Frontend Role-Conditional UI & Section Scoping

**Goal:** The frontend renders role-appropriate views. Teachers see only their assigned sections in all dropdowns. CRUD buttons are hidden based on permissions. Direct URL navigation to restricted pages is blocked.

**Demo:** Teacher sees 1 section in dropdowns (their assigned section only). No Create/Delete buttons visible. Principal sees all sections and all buttons. Teacher navigating to `/enrollment/create` gets redirected.

---

### Task 5.1: Backend sections endpoint returns scoped sections (verify)

**File:** `server/application/microservices/academics/src/sections/sections.service.ts`

**What:**
- Verify that after Sprint 1 fixes (fail-closed), the `listSections()` endpoint correctly filters sections for Teachers
- Confirm the `useSections` hook on the frontend will automatically receive only the teacher's sections since the backend filters them
- Add debug logging to trace the scope resolution path

**Tests:**
- Integration test: Teacher user calls `GET /sections?schoolId=xxx` → only their sections returned
- Integration test: Principal user calls same endpoint → all sections returned

**Validation:** Call sections endpoint with Teacher JWT → response contains only assigned sections

---

### Task 5.2: Hide CRUD action buttons based on role permissions

**Files:**
- `edforge-saas-frontend/apps/academics/src/routes/attendance/index.tsx`
- `edforge-saas-frontend/apps/academics/src/routes/grades/index.tsx`
- `edforge-saas-frontend/apps/academics/src/routes/students/$studentId.tsx`
- Other pages with Create/Edit/Delete buttons

**What:**
- Use `useResourcePermissions(resource)` to check available actions per role
- Conditionally render action buttons:
  - Teacher: Show "Record Grade" (create), "Edit Attendance" (edit) — but NOT "Delete Student", "Create Student"
  - Staff: Show only view-related UI, no record/edit buttons
  - Counselor: Show only student view
  - Principal: Show all buttons
- Use the `can()` helper for inline permission checks:
  ```tsx
  {permissions.create && <Button>Add Student</Button>}
  ```

**Tests:**
- Component test: render with Teacher permissions → no Delete button
- Component test: render with Principal permissions → Delete button visible

**Validation:** Login as Teacher → no "Create Student", "Delete" buttons visible. Login as Principal → all buttons visible.

---

### Task 5.3: Add role-aware empty states to section dropdowns

**Files:**
- Attendance page section dropdown
- Grades page section dropdown

**What:**
- When the section list is empty (Teacher with no assignments), show a helpful message:
  - "You are not assigned to any sections. Contact your administrator."
- When sections are loaded, pre-select the first section (Teacher typically has 1-3)
- For Principal/VP, show "All Sections" option or keep current behavior

**Tests:**
- Component test: empty section list → shows assignment message
- Component test: Teacher with 1 section → auto-selects it

**Validation:** Login as Teacher → section dropdown shows only assigned sections. Login as Principal → shows all sections.

---

### Task 5.4: Hide sidebar navigation items + add route guards

**Files:**
- `edforge-saas-frontend/apps/shell/src/config/sidebar-modules.ts`
- Sidebar rendering component
- Route configuration files (TanStack Router `beforeLoad` guards)

**What:**
- Verify the sidebar renderer checks the `permission` field on each nav item using `can()`
- Teacher should not see nav items for resources they can't access
- **Additionally**: Add `beforeLoad` route guards in TanStack Router for protected routes
  - If a Teacher navigates directly to `/enrollment/create` (via URL), the route guard checks permissions and redirects to a "Not Authorized" page
  - This prevents direct-URL bypass of sidebar hiding (which is cosmetic only)

**Why:** Sidebar hiding is UX polish; route guards are security. Both are needed.

**Tests:**
- Component test: Teacher sidebar → shows only permitted modules
- Route guard test: Teacher navigates to restricted route → redirected

**Validation:** Login as Teacher → sidebar shows only permitted modules. Manually enter restricted URL → redirected to "Not Authorized" page.

---

### Task 5.5: Student Detail page — scope-aware access

**Files:**
- `edforge-saas-frontend/apps/academics/src/routes/students/$studentId.tsx`
- `edforge-saas-frontend/apps/academics/src/components/students/profile/OverviewTab.tsx`

**What:**
- The backend (Sprint 2, Task 2.1) now returns 403 for out-of-scope students
- On the frontend, when the `useStudentProfile` hook returns a 403 error, render an "Access Restricted" page instead of broken/empty UI
- Design: centered message with lock icon — "You don't have access to view this student's profile. This student is not enrolled in your sections."
- If the student IS in scope, show full detail page as before

**Tests:**
- Teacher navigates to in-scope student → full detail page
- Teacher navigates to out-of-scope student → "Access Restricted" page (not broken UI)

**Validation:** Teacher opens URL for out-of-scope student → sees clean "Access Restricted" page

---

### Task 5.6: Attendance page — scope-aware dashboard cards

**File:** `edforge-saas-frontend/apps/academics/src/routes/attendance/dashboard.tsx`

**What:**
- The Attendance Overview tab shows school-wide stats (Present/Absent/Late/Excused counts)
- For Teachers, these should reflect only their sections' students (backend returns scoped data per Sprint 2)
- Add a scope indicator label:
  - Teacher: "Showing data for your 2 sections (45 students)"
  - Principal: "Showing school-wide data (320 students)"

**Tests:**
- Component test: Teacher view shows scoped label
- Component test: Principal view shows school-wide label

**Validation:** Login as Teacher → attendance dashboard shows "Your sections" label with correct counts

---

## Sprint 6: Cross-Role E2E Validation & Hardening

**Goal:** Comprehensive validation that every role works correctly end-to-end. Regression test suite that can run in CI. Performance optimization for data scope resolution.

**Demo:** Automated smoke test suite passes for all 7 school roles + TenantAdmin. Permission matrix validated end-to-end.

---

### Task 6.1: Add DataScope cache to eliminate repeated resolution

**File:** `server/application/microservices/academics/src/common/services/data-scope.service.ts`

**What:**
- Add an in-memory cache to `DataScopeService` so subsequent `resolveScope()` calls within the same session reuse the resolved scope
- Cache key: `userId:schoolId`, TTL: 5 minutes (matches permission cache)
- Use the same LRU pattern as `PermissionGuard.permissionCache`

**Why:** Without caching, every API call by a Teacher triggers 1 identity service HTTP call + 1-N DynamoDB queries. For a page that makes 5 API calls, this is 5 × (identity call + DynamoDB queries) — adding significant latency.

**Tests:**
- Unit test: second call within TTL uses cached scope
- Unit test: call after TTL re-resolves scope
- Unit test: different schoolId doesn't use cache

**Validation:** `npx jest --testPathPattern="data-scope"`

---

### Task 6.2: Add role/scope cache invalidation on role change events

**Files:**
- `server/application/microservices/academics/src/common/services/identity-client.service.ts`
- `server/application/microservices/academics/src/common/services/data-scope.service.ts`
- New event listener module

**What:**
- The Identity service publishes `SchoolRoleChanged` events when a user's role is modified
- Create an event listener in the Academics service that consumes this event and:
  - Invalidates the `roleCache` entry in `IdentityClientService` for the affected `userId:schoolId`
  - Invalidates the DataScope cache entry (from Task 6.1) for the same key
- As a complementary measure, reduce the role cache TTL from 10 minutes to 3 minutes (limits staleness window even if events are missed)

**Why:** Without cache invalidation, when a Principal changes a Teacher's role, the cached role in the Academics service is stale for up to 10 minutes. During this window, the Teacher retains their old scope — a security-relevant delay.

**Note:** In a multi-pod/ECS deployment, the event must be consumed by every running instance (via SNS/SQS fan-out or similar). Document this requirement for production.

**Tests:**
- Unit test: `SchoolRoleChanged` event received → roleCache and scope cache invalidated
- Unit test: Subsequent `resolveScope` after invalidation → fresh resolution

**Validation:** `npx jest --testPathPattern="identity-client|data-scope"`

---

### Task 6.3: Create role-based smoke test scripts

**File:** `scripts/smoke-tests/rbac-smoke-test.sh` (or `.ts`)

**What:**
Create smoke test scripts that exercise the full RBAC system for each role:
- For each of the 7 roles (Principal, VicePrincipal, Teacher, Staff, Counselor, Nurse, Accountant):
  - Login/get JWT for a test user with that role
  - Call every academics endpoint
  - Verify allowed endpoints return 200 with data
  - Verify denied endpoints return 403
  - For Teacher: verify only scoped data is returned (sections, students, grades, attendance)
- For TenantAdmin:
  - Verify all endpoints return 200 (no permission checks)

**Tests:** Self-testing (smoke test IS the test)

**Validation:** `./scripts/smoke-tests/rbac-smoke-test.sh` — all assertions pass

---

### Task 6.4: Create E2E permission matrix test

**File:** `scripts/smoke-tests/permission-matrix-e2e.ts`

**What:**
- Port the backend `permission-matrix.spec.ts` approach to an E2E test
- For each role × endpoint combination, make an actual HTTP call and verify the response
- Verify the response matches the expected permission matrix
- Include data scope verification for Teacher role

**Tests:** Self-testing

**Validation:** `npx ts-node scripts/smoke-tests/permission-matrix-e2e.ts` — all 147+ checks pass

---

### Task 6.5: Create Teacher data scope E2E test

**File:** `scripts/smoke-tests/teacher-scope-e2e.ts`

**What:**
- Create a test specifically for Teacher data scope:
  - Setup: Teacher assigned to Section A (students 1-5), NOT Section B (students 6-10)
  - `GET /sections` → only Section A
  - `GET /students` → only students 1-5
  - `GET /grades?sectionId=A` → grades for students 1-5
  - `GET /grades?sectionId=B` → empty
  - `POST /grades/record` for student 1 → success
  - `POST /grades/record` for student 6 → 403
  - `GET /attendance/overview` → only Section A data
  - `GET /enrollment` → only students 1-5 enrollment
  - `GET /students/:outOfScopeId` → 403

**Tests:** Self-testing

**Validation:** `npx ts-node scripts/smoke-tests/teacher-scope-e2e.ts` — all assertions pass

---

### Task 6.6: Frontend visual regression for each role

**What:**
- Document a manual test checklist (or create Playwright tests if time permits) for each role:
  - Login as role
  - Navigate to each sidebar item
  - Verify: correct buttons visible/hidden
  - Verify: correct data shown (scoped for Teacher)
  - Verify: no toasts, no errors in console
  - Verify: section dropdowns show correct options
  - Verify: empty states are clean and helpful
  - Verify: direct URL navigation to restricted routes → redirect

**Checklist per role:**
| Page | Teacher | Staff | Counselor | Principal |
|---|---|---|---|---|
| Attendance Overview | Scoped stats | View-only, school-wide | N/A (no access) | All stats |
| Attendance Daily Entry | Own sections | N/A | N/A | All sections |
| Grades Gradebook | Own sections | N/A | N/A | All sections |
| Students List | Own students | View-only, all | View-only, all | All + CRUD |
| Student Detail | In-scope only | View-only | View-only | Full access |
| Enrollment | Scoped | View-only | N/A | All + CRUD |
| Sidebar | Limited items | Limited items | Limited items | All items |

**Validation:** Completed checklist with screenshots for each role

---

### Task 6.7: Production readiness checklist

**What:**
Document and verify:
- [ ] `DATA_SCOPE_FAIL_CLOSED` defaults to `true` (secure by default, set in code per Task 1.1)
- [ ] `PERMISSION_CACHE_TTL_MS` set to appropriate value (300000 = 5 min default)
- [ ] Role cache TTL reduced to 3 minutes (per Task 6.2)
- [ ] Identity service `/staff/by-email` endpoint deployed and responding
- [ ] All Teacher users have corresponding staff records with email
- [ ] All staff records assigned as primaryTeacherId in sections match staffId
- [ ] Role change events (SchoolRoleChanged) consumed by all Academics service pods
- [ ] Backend compiles with 0 errors
- [ ] Frontend typechecks with 0 errors
- [ ] All unit tests pass
- [ ] Smoke tests pass for all roles
- [ ] No console errors during frontend navigation
- [ ] API Gateway routes updated if any new endpoints added

**Validation:** All checkboxes marked

---

## File Index

### Backend files modified across all sprints:

| File | Sprints |
|---|---|
| `server/.../common/services/data-scope.service.ts` | 1, 6 |
| `server/.../common/services/data-scope.service.spec.ts` | 1 |
| `server/.../common/services/identity-client.service.ts` | 1, 6 |
| `server/.../common/guards/permission.guard.ts` | 2 |
| `server/.../common/guards/permission.guard.spec.ts` | 2 |
| `server/.../students/students.service.ts` | 2 |
| `server/.../students/students.controller.ts` | 2 |
| `server/.../sections/sections.service.ts` | 3, 5 |
| `server/.../enrollment/enrollment.service.ts` | 2, 3 |
| `server/.../grades/grades.service.ts` | 2, 3 |
| `server/.../grades/grades.controller.ts` | 2 |
| `server/.../attendance/attendance.service.ts` | 2, 3 |
| `server/.../attendance/attendance.controller.ts` | 2 |
| Identity service staff endpoints | 1 |

### Frontend files modified across all sprints:

| File | Sprints |
|---|---|
| `edforge-saas-frontend/apps/academics/src/hooks/useAttendance.ts` | 4 |
| `edforge-saas-frontend/apps/academics/src/hooks/useGrades.ts` | 4 |
| `edforge-saas-frontend/apps/academics/src/services/academics.service.ts` | 4 |
| `edforge-saas-frontend/apps/academics/src/lib/api.ts` | 4 |
| `edforge-saas-frontend/apps/people/src/lib/api.ts` | 4 |
| `edforge-saas-frontend/apps/shell/src/lib/api.ts` | 4 |
| `edforge-saas-frontend/apps/people/src/services/staff.service.ts` | 4 |
| `edforge-saas-frontend/apps/academics/src/components/students/profile/OverviewTab.tsx` | 4, 5 |
| `edforge-saas-frontend/apps/academics/src/routes/attendance/index.tsx` | 5 |
| `edforge-saas-frontend/apps/academics/src/routes/attendance/dashboard.tsx` | 5 |
| `edforge-saas-frontend/apps/academics/src/routes/grades/index.tsx` | 5 |
| `edforge-saas-frontend/apps/academics/src/routes/students/$studentId.tsx` | 5 |
| `edforge-saas-frontend/apps/shell/src/config/sidebar-modules.ts` | 5 |
| Route configuration (TanStack Router guards) | 5 |

### New files:

| File | Sprint |
|---|---|
| `server/.../common/services/data-scope-integration.spec.ts` | 2 |
| `server/.../common/guards/write-authorization.spec.ts` | 3 |
| Event listener module for role change cache invalidation | 6 |
| `scripts/smoke-tests/rbac-smoke-test.sh` | 6 |
| `scripts/smoke-tests/permission-matrix-e2e.ts` | 6 |
| `scripts/smoke-tests/teacher-scope-e2e.ts` | 6 |

---

## Review Feedback Incorporated

This plan was reviewed by a staff engineer subagent. The following critical and high-priority items from the review are now addressed:

| Priority | Issue | Resolution |
|---|---|---|
| **Critical** | `resolveScope()` outer catch still fails open after Task 1.1 | Task 1.1 now flips default to fail-closed (`DATA_SCOPE_FAIL_CLOSED !== 'false'`) |
| **Critical** | `DATA_SCOPE_FAIL_CLOSED` default is false, deployed in Sprint 6 | Moved to Sprint 1; default is now `true` in code |
| **Critical** | `getUserRole` returning null grants school scope | Task 1.1 now throws ForbiddenException on null role |
| **High** | `listStudents`, `getStudent`, `getStudentProfile` missing scope | Added Task 2.1 |
| **High** | `getSectionGrades` missing scope check | Added to Task 2.3 |
| **High** | `bulkFinalizeGrades` missing scope check | Added to Task 3.2 |
| **High** | `recordBulkGrades` missing scope check | Added to Task 3.1 |
| **High** | `getStudentAttendance` (raw records) missing scope | Added to Task 2.5 |
| **High** | Role cache invalidation on role change | Added Task 6.2 |
| **High** | `getUserRole` non-404 errors should throw, not return null | Updated Task 1.2 |
| **Medium** | Enrollment write endpoints missing scope | Added Task 3.5 |
| **Medium** | No `filterBySectionScope` helper | Added Task 1.5 |
| **Medium** | Attendance alerts missing scope | Added to Task 2.4 |
| **Medium** | Task 2.7 (400 vs 403) deployment coupling | Added deployment note to Task 2.7 |
| **Medium** | Missing route-level guards (TanStack Router) | Added to Task 5.4 |
| **Low** | Sequential enrollment queries in resolveTeacherScope | Added Task 1.6 (parallelize with Promise.all) |
| **Low** | Multi-school teacher test missing | Added to Task 1.7 |
