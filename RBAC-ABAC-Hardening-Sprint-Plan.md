# RBAC/ABAC Hardening Sprint Plan — EdForge EMIS

## Executive Summary

After a thorough audit of both frontend and backend RBAC/ABAC enforcement, this plan addresses the gaps between the well-designed permission architecture and its incomplete enforcement. The backend PermissionGuard properly blocks unauthorized API calls (security is sound), but the frontend lacks consistent permission-based UI rendering — causing users to see action buttons that fail silently when clicked. Additionally, the backend DataScopeService (row-level security for Teachers) exists but is not wired into any controller, and several API calls from the Overview page fire unnecessarily for roles that don't have the required permissions.

**Post-Review Updates:** This plan incorporates feedback from a staff engineer review. Key changes: (1) DataScopeService already exists with tests — Sprint 2 tasks updated to wire-in only, (2) frontend 403 handling prioritized earlier, (3) Grades GET endpoint schoolId fix added, (4) IDOR risk window between Sprint 1-2 documented, (5) performance testing added, (6) pagination+scope filtering concern added.

---

## Audit Findings Summary

### What's Working Well
1. **Backend PermissionGuard** — All endpoints decorated with `@RequirePermission`, TenantAdmin bypass, fail-closed design, audit logging
2. **Frontend ABAC engine** — Comprehensive `can()` function, `usePermission`/`useResourcePermissions` hooks, `RequirePermission` component
3. **Shell navigation filtering** — `useSecureNavItems` correctly hides nav items based on role permissions
4. **RoleSyncService bridge** — Staff→RoleAssignment sync working (assignments populated, sidebar renders)
5. **Backend enrollment, attendance, curriculum controllers** — All endpoints properly guarded
6. **Students list page** — Uses `useResourcePermissions('students')`, conditionally renders Add/Import/Withdraw
7. **Attendance module** — Uses `usePermission()` for view vs edit tab separation
8. **Curriculum page header** — PageActionsDropdown correctly checks `coursePerms.create`
9. **DataScopeService** — Already implemented with `resolveScope()`, Teacher section queries, `filterByStudentScope()`, and tests

### Critical Findings

| # | Issue | Layer | Severity |
|---|-------|-------|----------|
| F1 | Academics Overview calls `enrollment:summary` for all roles — Teacher gets 403 | Frontend | HIGH |
| F2 | Student profile API call missing `schoolId` → "School context required" 403 | Frontend | HIGH |
| F3 | Student profile page: `canEdit={true}` hardcoded — edit buttons visible to all | Frontend | HIGH |
| F4 | CourseTable empty-state "Add Course" button bypasses permission check | Frontend | HIGH |
| F5 | CourseTable row actions (Edit, Toggle Active) passed unconditionally | Frontend | MEDIUM |
| F6 | 403 errors handled silently — `console.warn` only, no user notification | Frontend | HIGH |
| F7 | No 403/Forbidden page or permission-denied component | Frontend | HIGH |
| F8 | DataScopeService not wired into any controller — row-level security not enforced | Backend | HIGH |
| F9 | Grades GET endpoint missing `schoolId` parameter — always returns 403 | Backend | HIGH |
| F10 | Data scope fails open — defaults to school-wide access on error | Backend | MEDIUM |
| F11 | Teacher scope resolution fragile — email-based staffId lookup can fail silently → school-wide access | Backend | MEDIUM |
| F12 | Multiple overview summary APIs fail with 403 for Teacher (red Xs in network) | Frontend | MEDIUM |
| F13 | "View Details" button on student drawer visible when profile will 403 | Frontend | MEDIUM |
| F14 | Resource naming inconsistency: backend `curriculum` vs frontend `courses` | Cross | LOW |

### IDOR Risk Window

**Important:** Between Sprint 1 (frontend gating) and Sprint 2 (DataScopeService wiring), a Teacher who manually constructs API URLs can access any student's data within their school (FERPA-sensitive). This is acceptable only because the backend PermissionGuard already validates school-level access. Full row-level security arrives in Sprint 2.

---

## Sprint 1: Frontend Permission Enforcement & 403 Handling

**Goal:** Every user-facing action button is gated by ABAC permission checks, and 403 errors produce clear, user-friendly feedback instead of silent failures.

**Demo criteria:** Login as Teacher → no edit/create buttons visible for unauthorized actions → attempting to access a restricted resource shows a permission-denied message → 403 API responses show toast notification.

**Addresses:** F1, F2, F3, F4, F5, F6, F7, F8 (partial), F12, F13

---

### Task 1.1: Add 403 toast notification to API interceptor

> **Priority: FIRST — deploy before any new backend guards to prevent silent 403 regressions**

**Files:**
- `edforge-saas-frontend/apps/shell/src/lib/api.ts`
- `edforge-saas-frontend/apps/academics/src/lib/api.ts`

**Changes:**
In the response error interceptor, replace the `console.warn` for 403 with a toast notification:
```typescript
if (status === 403 && !isRedirecting) {
  const errorData = error.response?.data
  const message = errorData?.message || 'You don\'t have permission to perform this action'

  // Only show toast if caller hasn't opted for graceful degradation
  if (!error.config?.meta?.gracefulDegradation) {
    toast.error('Access Denied', { description: message })
  }
}
```

> **Review note:** Use `gracefulDegradation` instead of `suppress403Toast` to avoid accidentally silencing legitimate 403s. Callers opt in explicitly for degradable API calls (overview widgets).

**Validation:** Trigger a 403 from a button click → toast appears with specific permission message. Overview widget 403s → no toast spam.

---

### Task 1.2: Create `PermissionDenied` component and 403 route

**Files:**
- `edforge-saas-frontend/apps/shell/src/components/secure/PermissionDenied.tsx` (new)
- `edforge-saas-frontend/apps/shell/src/pages/forbidden.tsx` (new, if needed as route)

**Changes:**
Create a reusable `PermissionDenied` component:
```tsx
interface PermissionDeniedProps {
  resource?: string      // e.g., "student profile", "enrollment data"
  action?: string        // e.g., "view", "edit"
  message?: string       // Custom message override
  showBackButton?: boolean
}
```
- Shield icon with lock overlay
- Title: "Access Restricted"
- Description: "You don't have permission to {action} {resource}." or custom message
- "Go Back" button using `router.history.back()`
- "Go to Home" link
- Styling consistent with existing error boundaries

**Validation:** Render `<PermissionDenied resource="student profile" action="view" />` in Storybook or test page — clean, professional UI.

---

### Task 1.3: Fix student profile API — pass `schoolId` query parameter

**Files:**
- `edforge-saas-frontend/apps/academics/src/services/academics.service.ts` (~line 340)
- `edforge-saas-frontend/apps/academics/src/hooks/useStudents.ts` (or wherever profile query is invoked)
- `edforge-saas-frontend/apps/academics/src/routes/students/$studentId.tsx`

**Changes:**
```typescript
// BEFORE (line ~340 in academics.service.ts):
return apiGet<StudentProfileResponseDto>(`/academics/students/${studentId}/profile`)

// AFTER:
export function getStudentProfile(studentId: string, schoolId: string) {
  return apiGet<StudentProfileResponseDto>(
    `/academics/students/${studentId}/profile`,
    { params: { schoolId } }
  )
}
```

Update the hook and route to pass `schoolId` from `useActiveSchoolId()`.

**Validation:** Login as Teacher → navigate to student detail → network shows `?schoolId=...` in profile call → no "School context required" error. Profile loads.

---

### Task 1.4: Permission-gate student profile edit actions

**Files:**
- `edforge-saas-frontend/apps/academics/src/routes/students/$studentId.tsx`

**Changes:**
Replace hardcoded `canEdit={true}` with ABAC permission checks:
```typescript
import { useResourcePermissions } from '@edforge/abac'

const studentPerms = useResourcePermissions('students')

// ~Line 185:
<ProfileHeader
  student={student}
  onEdit={studentPerms.edit ? actions.openEdit : undefined}
  onEnroll={studentPerms.edit ? actions.openEnroll : undefined}
  canEdit={!!studentPerms.edit}
/>

// ~Line 253:
<FamilyTab
  student={student}
  onAddGuardian={studentPerms.edit ? actions.openAddGuardian : undefined}
  onEditGuardian={studentPerms.edit ? actions.openEditGuardian : undefined}
  canEdit={!!studentPerms.edit}
/>
```

Also gate "Add to Section", enrollment actions, and any other edit/create actions.

**Validation:** Login as Teacher → student profile → Edit Student, Add Guardian, Add to Section buttons NOT visible. Login as Principal → buttons visible.

---

### Task 1.5: Add permission-aware error handling to student profile page

**Files:**
- `edforge-saas-frontend/apps/academics/src/routes/students/$studentId.tsx`

**Changes:**
When student profile API returns 403, show `PermissionDenied` instead of "Failed to Load Profile":
```typescript
if (profileQuery.error) {
  const is403 = (profileQuery.error as any)?.response?.status === 403
  if (is403) {
    return <PermissionDenied
      resource="student profile"
      action="view"
      message="You don't have permission to view this student's profile. This student may not be in your assigned sections."
      showBackButton
    />
  }
  return <ErrorState ... />  // existing error handling for non-403
}
```

**Validation:** If a 403 occurs (e.g., after DataScopeService wired in Sprint 2), user sees "Access Restricted" message instead of "Failed to Load Profile".

---

### Task 1.6: Permission-gate Curriculum module actions

**Files:**
- `edforge-saas-frontend/apps/academics/src/routes/curriculum/index.tsx`
- `edforge-saas-frontend/apps/academics/src/components/curriculum/CourseTable.tsx`
- `edforge-saas-frontend/apps/academics/src/routes/curriculum/$courseId.tsx`

**Changes in curriculum/index.tsx:**
Pass edit/create callbacks conditionally (the page already has `coursePerms` from `useResourcePermissions('courses')`):
```typescript
<CourseTable
  ...
  onAddCourse={coursePerms.create ? openCreateDrawer : undefined}     // was unconditional
  onEditCourse={coursePerms.edit ? openEditDrawer : undefined}        // was unconditional
  onToggleActive={coursePerms.edit ? handleToggleActive : undefined}  // was unconditional
  ...
/>
```

**Changes in CourseTable.tsx:**
Empty state "Add Course" button (line ~334-335) already checks `onAddCourse ? {...}` — with the above fix, it will be `undefined` for Teacher → button hidden. Also gate RowActions:
```typescript
{onEdit && <button onClick={...}>Edit Course</button>}
{onToggleActive && <button onClick={...}>{isActive ? 'Deactivate' : 'Activate'}</button>}
```

**Changes in curriculum/$courseId.tsx:**
Add permission checks to course detail page ActionsDropdown:
```typescript
const coursePerms = useResourcePermissions('courses')
{coursePerms.edit && <button onClick={onEdit}>Edit Course</button>}
{coursePerms.edit && <button onClick={onDeactivate}>Deactivate</button>}
```

**Validation:** Login as Teacher → Curriculum → no "Add Course" in empty state, no Edit/Toggle in row actions, no Edit on course detail. Login as Principal → full CRUD visible.

---

### Task 1.7: Make Academics Overview permission-aware (avoid unnecessary 403s)

**Files:**
- `edforge-saas-frontend/apps/academics/src/hooks/useAcademicsOverview.ts`
- `edforge-saas-frontend/apps/academics/src/routes/overview.tsx`

**Changes in useAcademicsOverview.ts:**
Use permission checks to skip API calls the user doesn't have access to:
```typescript
import { usePermission } from '@edforge/abac'

export function useAcademicsOverview(schoolId, academicYearId) {
  const canViewEnrollment = usePermission('view', 'enrollment', schoolId)

  const enrollment = useQuery({
    ...
    enabled: enabled && canViewEnrollment,  // Don't call if no permission
  })
  ...
}
```

For API calls that are made regardless but may 403 for some roles, mark them with `gracefulDegradation`:
```typescript
queryFn: () => getEnrollmentSummary(schoolId, yearId, { gracefulDegradation: true }),
```

**Changes in overview.tsx:**
Conditionally render enrollment chart:
```typescript
const canViewEnrollment = usePermission('view', 'enrollment', schoolId)

{canViewEnrollment ? (
  <WidgetErrorBoundary name="Enrollment Chart">
    <EnrollmentDistributionChart ... />
  </WidgetErrorBoundary>
) : null}
```

**Validation:** Login as Teacher → Academics Overview → NO 403 errors in network tab. "Total Enrolled" shows "—" gracefully. Sections, attendance, staff KPIs load normally.

---

### Task 1.8: Permission-gate Grades module pages

**Files:**
- `edforge-saas-frontend/apps/academics/src/routes/grades/` (all page files)

**Changes:**
Audit all Grades module pages and add permission checks:
- Grade recording: check `usePermission('create', 'grades')` before record/submit buttons
- Grade editing: check `usePermission('edit', 'grades')` before edit buttons
- Grade finalization: check `usePermission('edit', 'grades')` before finalize button
- Teacher has `grades: ['view', 'create', 'edit']` — most actions allowed
- Staff/Counselor have grades view-only — create/edit buttons hidden

**Validation:** Login as Staff → Grades → view-only, no create/edit buttons. Login as Teacher → create/edit visible.

---

### Task 1.9: Permission-gate Scheduling/Sections pages

**Files:**
- `edforge-saas-frontend/apps/academics/src/routes/scheduling/` (all page files)

**Changes:**
- Create Section: check `usePermission('create', 'scheduling')` — Teacher has only `scheduling: ['view']`
- Edit Section: check `usePermission('edit', 'scheduling')`
- Delete Section: check `usePermission('delete', 'scheduling')`
- Enroll Student in section: check `usePermission('edit', 'scheduling')`
- Drop Student: check `usePermission('delete', 'scheduling')`

**Validation:** Login as Teacher → Scheduling → view-only. Login as Principal → full CRUD.

---

### Task 1.10: TenantAdmin bypass regression tests

> **Review addition:** Verify TenantAdmin can still access every endpoint after permission gating is added.

**Files:**
- `edforge-saas-frontend/apps/academics/src/__tests__/permission-regression.test.ts` (new, or manual checklist)

**Changes:**
Create a test or manual verification checklist:
- TenantAdmin → all modules accessible
- TenantAdmin → all CRUD buttons visible
- TenantAdmin → all API calls succeed (no 403)
- TenantAdmin → school selector shows all schools + "Create School"

**Validation:** Full pass through all modules as TenantAdmin with no regressions.

---

## Sprint 2: Backend Data Scope Integration (Row-Level Security)

**Goal:** Teachers see only students in their assigned sections. The existing DataScopeService is wired into all relevant services. The system moves from "any Teacher can see all school data" to "Teachers see only their section's students."

**Demo criteria:** Login as Teacher assigned to Math Period 1 → Students page shows only students enrolled in that section → Attendance scoped → Grades scoped.

**Note:** DataScopeService (`data-scope.service.ts`) and its tests (`data-scope.service.spec.ts`) already exist with full implementation. This sprint wires the existing service into controllers/services.

---

### Task 2.1: Wire DataScopeService into Students service

**Files:**
- `server/application/microservices/academics/src/students/students.service.ts`
- `server/application/microservices/academics/src/students/students.module.ts`

**Changes:**
Inject `DataScopeService`. For `listStudents()`, `getStudentProfile()`, `getStudentById()`:
```typescript
const scope = await this.dataScopeService.resolveScope(context.userId, schoolId, context)

if (scope.type === 'section') {
  // Post-fetch filter (MVP) — query-level filter in Task 2.5
  return this.dataScopeService.filterByStudentScope(students, scope)
}
```

For write operations (`createStudent`, `updateStudent`, `deleteStudent`), scope is not needed — these are gated by PermissionGuard (`students:create/edit/delete`) which Teachers don't have.

**Validation:** Teacher with section assignment → only sees their students. Teacher with no sections → sees empty list.

---

### Task 2.2: Wire DataScopeService into Attendance service

**Files:**
- `server/application/microservices/academics/src/attendance/attendance.service.ts`
- `server/application/microservices/academics/src/attendance/attendance.module.ts`

**Changes:**
- `getAttendance()`: filter by section scope
- `getSummary()`: scope to Teacher's sections
- `getOverview()`: scope `sectionCompletion` to Teacher's sections
- `createAttendance()` / `bulkCreate()`: verify section belongs to Teacher

**Validation:** Teacher → Attendance → sees only their sections in section completion. Creates attendance only for their sections.

---

### Task 2.3: Wire DataScopeService into Grades service

**Files:**
- `server/application/microservices/academics/src/grades/grades.service.ts`
- `server/application/microservices/academics/src/grades/grades.module.ts`

**Changes:**
- `getGrades()`, `getGradesBySection()`: filter by section scope
- `recordGrade()`: verify student is in a section assigned to Teacher
- `getOverview()`: scope to Teacher's sections

**Validation:** Teacher → Grades → records/views only for their section's students.

---

### Task 2.4: Wire DataScopeService into Sections service

**Files:**
- `server/application/microservices/academics/src/sections/sections.service.ts`
- `server/application/microservices/academics/src/sections/sections.module.ts`

**Changes:**
For `listSections()`, filter to Teacher's assigned sections:
```typescript
const scope = await this.dataScopeService.resolveScope(...)
if (scope.type === 'section') {
  return sections.filter(s => scope.sectionIds.includes(s.sectionId))
}
```

**Validation:** Teacher → Sections page → only their assigned sections visible.

---

### Task 2.5: Fix Grades GET endpoint — add `schoolId` parameter

**Files:**
- `server/application/microservices/academics/src/grades/grades.controller.ts` (~line 78-87)

**Changes:**
The `GET /academics/grades` endpoint is missing `schoolId` in its query parameters. The PermissionGuard requires it:
```typescript
@Get()
@UseGuards(PermissionGuard)
@RequirePermission({ resource: 'grades', action: 'view' })
async getGrade(
  @Query('studentId') studentId: string,
  @Query('courseId') courseId: string,
  @Query('termId') termId: string,
  @Query('schoolId') schoolId: string,     // ADD THIS
  @TenantCredentials() tenant: TenantContext,
  @Req() req: Request,
): Promise<GradeResponseDto> {
  ...
}
```

Also update the corresponding frontend API call to pass `schoolId`.

**Validation:** `GET /academics/grades?studentId=...&courseId=...&termId=...&schoolId=...` succeeds instead of "School context required".

---

### Task 2.6: Configurable fail mode for DataScopeService

**Files:**
- `server/application/microservices/academics/src/common/services/data-scope.service.ts`

**Changes:**
```typescript
// Current (line ~118-123): fails open
catch (error: any) {
  return { type: 'school', schoolId }  // Grants school-wide access on error
}

// New: configurable
catch (error: any) {
  this.scopeFailureCounter.inc()  // Metrics
  if (process.env.DATA_SCOPE_FAIL_CLOSED === 'true') {
    throw new ForbiddenException('Unable to resolve data scope — access denied')
  }
  this.logger.warn(`Scope resolution failed, defaulting to school scope: ${error.message}`)
  return { type: 'school', schoolId }
}
```

**Validation:** `DATA_SCOPE_FAIL_CLOSED=true` → scope error returns 403. `=false` → existing behavior (fail-open for MVP).

---

### Task 2.7: Fail-closed when Teacher lacks staffId

> **Review addition:** Silent privilege escalation — Teacher without staffId gets school-wide access

**Files:**
- `server/application/microservices/academics/src/common/services/data-scope.service.ts`

**Changes:**
Currently (line ~110): `if (role === 'Teacher' && staffId)` — if staffId is undefined, Teacher falls through to school scope. Fix:
```typescript
if (role === 'Teacher') {
  if (!staffId) {
    this.logger.warn(`Teacher ${userId} has no staffId — restricting to empty scope`)
    return { type: 'section', schoolId, sectionIds: [], studentIds: [] }
  }
  return this.resolveTeacherScope(staffId, schoolId, context)
}
```

**Validation:** Teacher without staff record → sees empty student list (no data), not school-wide data.

---

### Task 2.8: Improve Teacher staffId resolution

**Files:**
- `server/application/microservices/academics/src/common/services/identity-client.service.ts`
- `server/application/microservices/academics/src/common/services/data-scope.service.ts`

**Changes:**
Current: staffId is resolved by email lookup via Identity Service. Improve:
1. Return `staffId` in the `getUserRole` response from Identity Service (it's available from RoleAssignment/Staff entities)
2. Cache staffId resolution with 10-minute TTL
3. Log warning when email-based lookup fails

**Validation:** Teacher login → data scope resolves using staffId from role response → no email lookup dependency.

---

### Task 2.9: Address pagination inconsistency with scope filtering

> **Review addition:** Post-fetch filtering breaks pagination (50 items requested → 5 returned after scope filter)

**Files:**
- `server/application/microservices/academics/src/students/students.service.ts`

**Changes:**
For Teacher scope, evaluate two approaches:
- **Option A (recommended for MVP):** Over-fetch and post-filter, adjusting `hasMore` flag. Simple but wastes bandwidth.
- **Option B (future):** Push scope into the DynamoDB query by querying section enrollments first, then fetching students by ID batch. More efficient but complex.

Implement Option A with a note for Option B optimization:
```typescript
// For section-scoped queries, fetch more items to compensate for post-filter reduction
const fetchLimit = scope.type === 'section' ? limit * 3 : limit
const items = await this.fetchStudents(schoolId, { ...filters, limit: fetchLimit })
const scoped = this.dataScopeService.filterByStudentScope(items, scope)
return { items: scoped.slice(0, limit), hasMore: scoped.length > limit }
```

**Validation:** Teacher with 5 students in their section, page size 20 → returns 5 items, `hasMore: false`.

---

## Sprint 3: Role-Specific UX Adaptation

**Goal:** Each role sees a tailored experience — the Overview page adapts its widgets, Teacher gets a "My Sections" view, and the system communicates clearly what each role can and cannot do.

**Demo criteria:** Teacher → Overview shows teaching-relevant stats (no enrollment chart) → "My Sections" widget → Students defaults to section-scoped. Principal → full school-wide dashboard.

---

### Task 3.1: Create Teacher-specific "My Sections" overview widget

**Files:**
- `edforge-saas-frontend/apps/academics/src/components/overview/MySectionsWidget.tsx` (new)

**Changes:**
Widget showing Teacher's assigned sections:
- Section name, period, room, student count
- Quick action links: "Take Attendance", "Enter Grades"
- "No sections assigned" empty state with guidance
- Replaces Enrollment chart position for Teacher role

**Validation:** Teacher with 2 sections → widget shows both. Teacher with 0 → empty state guidance.

---

### Task 3.2: Permission-aware Overview layout

**Files:**
- `edforge-saas-frontend/apps/academics/src/routes/overview.tsx`

**Changes:**
Conditionally render widgets based on role:
```typescript
const canViewEnrollment = usePermission('view', 'enrollment', schoolId)

{canViewEnrollment ? (
  <EnrollmentDistributionChart ... />
) : (
  <MySectionsWidget schoolId={schoolId} />
)}
```

Adjust KPI stat cards: hide "Total Enrolled" for roles without enrollment permission, replace with "My Students" count for Teacher.

**Validation:** Teacher overview: My Sections + Attendance + Alerts. Principal overview: Enrollment + Attendance + Alerts.

---

### Task 3.3: Teacher "My Students" filter on Students page

**Files:**
- `edforge-saas-frontend/apps/academics/src/routes/students/index.tsx`

**Changes:**
For Teacher role, add a scope toggle:
```typescript
const isTeacher = user.assignments[activeSchoolId] === 'Teacher'
const [scope, setScope] = useState<'my' | 'all'>(isTeacher ? 'my' : 'all')
```
- "My Students" (default for Teacher): backend returns section-scoped data (Sprint 2)
- "All Students": shows all school students (if `students:view` permits)

**Validation:** Teacher → Students defaults to "My Students" → only their section's students. Toggle → all school students.

---

### Task 3.4: Per-role home dashboard quick actions

**Files:**
- `edforge-saas-frontend/apps/shell/src/pages/home.tsx`

**Changes:**
Enhance quick actions section based on role:
- **Teacher:** "Take Attendance", "Enter Grades", "View My Sections"
- **Principal/VP:** "View Overview", "Manage Staff", "View Reports"
- **Staff/Counselor/Nurse:** Role-appropriate actions based on their permissions

Use `useResourcePermissions` to determine which quick actions to show.

**Validation:** Teacher → Home shows teaching actions. Principal → management actions.

---

### Task 3.5: Align backend/frontend permission resource naming

**Files:**
- `server/application/microservices/academics/src/courses/courses.controller.ts`
- `server/application/microservices/academics/src/courses/course-offering.controller.ts`
- `server/application/microservices/identity/src/common/constants/permission-registry.ts`
- `server/application/microservices/identity/src/common/entities/role-assignment.entity.ts`

**Changes:**
Backend courses controller uses `curriculum` resource, frontend uses `courses`. Align to `courses`:
```typescript
// courses.controller.ts
@RequirePermission({ resource: 'courses', action: 'create' })  // was 'curriculum'
```

Update `permission-registry.ts` and `DEFAULT_ROLE_PERMISSIONS` to use `courses` where appropriate.

> **Review note:** Verify this doesn't cause 403 regressions by checking that the Identity Service's `checkPermission` resolves `courses` correctly.

**Validation:** Teacher → Curriculum page → view works (backend checks `courses:view`). Principal → create works.

---

## Sprint 4: Backend Hardening & Verification

**Goal:** Backend permission system is production-ready with timeouts, caching, comprehensive test coverage, and verified behavior for all role-endpoint combinations.

**Demo criteria:** All API endpoints tested with each role → correct 200/403 → performance benchmarks met → no regression from data scope.

---

### Task 4.1: Add request timeout and retry to Identity Client

**Files:**
- `server/application/microservices/academics/src/common/services/identity-client.service.ts`

**Changes:**
```typescript
private readonly REQUEST_TIMEOUT = 5000  // 5 seconds
private readonly MAX_RETRIES = 2
private readonly BACKOFF_BASE = 100  // ms

async checkPermission(...) {
  for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
    try {
      const response = await Promise.race([
        this.httpClient.post(...),
        this.timeout(this.REQUEST_TIMEOUT)
      ])
      return response.data
    } catch (error) {
      if (attempt === this.MAX_RETRIES) {
        return { allowed: false, reason: 'Permission check unavailable' }
      }
      await this.sleep(this.BACKOFF_BASE * Math.pow(2, attempt))
    }
  }
}
```

**Validation:** Simulate Identity Service delay → request times out → access denied → no hanging.

---

### Task 4.2: Add permission decision caching

**Files:**
- `server/application/microservices/academics/src/common/guards/permission.guard.ts`
- `server/application/microservices/academics/src/common/services/permission-cache.service.ts` (new)

**Changes:**
In-memory LRU cache:
- Key: `${userId}:${schoolId}:${resource}:${action}`
- TTL: 5 minutes (configurable via env)
- Max entries: 10,000
- Eviction: LRU

```typescript
const cacheKey = `${userId}:${schoolId}:${resource}:${action}`
const cached = this.permissionCache.get(cacheKey)
if (cached !== undefined) return cached

const result = await this.identityClient.checkPermission(...)
this.permissionCache.set(cacheKey, result.allowed, TTL)
return result.allowed
```

**Validation:** Same user making 10 API calls → 1 Identity Service call → 9 cache hits. TTL expires → fresh check.

---

### Task 4.3: Create permission matrix integration tests

**Files:**
- `server/application/microservices/academics/test/permission-matrix.e2e-spec.ts` (new)

**Changes:**
Test every endpoint × every role:
```typescript
const MATRIX = [
  ['GET',  '/academics/students',      'Teacher',    200],
  ['GET',  '/academics/students',      'Staff',      200],
  ['POST', '/academics/students',      'Teacher',    403],
  ['POST', '/academics/students',      'Principal',  200],
  ['GET',  '/academics/courses',       'Teacher',    200],
  ['POST', '/academics/courses',       'Teacher',    403],
  // ... all endpoints × all roles
  // ALWAYS include TenantAdmin → 200 for every endpoint
]
```

**Validation:** All matrix entries pass. TenantAdmin bypass verified for every endpoint.

---

### Task 4.4: Data scope integration tests

**Files:**
- `server/application/microservices/academics/src/common/services/data-scope.service.spec.ts` (update)

**Changes:**
Add tests for all wiring from Sprint 2:
- Teacher with sections → only their students returned from Students service
- Teacher with no sections → empty results
- Teacher with email lookup failure → empty scope (not school-wide)
- Principal → school-wide scope
- VicePrincipal → school-wide scope
- Fail-open vs fail-closed mode behavior
- Pagination with post-filter scope

**Validation:** All test cases pass.

---

### Task 4.5: Performance test for concurrent permission checks

> **Review addition:** 50 Teachers at 8 AM marking attendance creates burst traffic

**Files:**
- `server/application/microservices/academics/test/performance/permission-load.test.ts` (new)

**Changes:**
Simulate 50 concurrent permission checks:
```typescript
const requests = Array(50).fill(null).map((_, i) =>
  permissionGuard.canActivate(mockContext({ role: 'Teacher', userId: `teacher-${i}` }))
)
const start = Date.now()
await Promise.all(requests)
const p99 = Date.now() - start

expect(p99).toBeLessThan(2000)  // 2 seconds for 50 concurrent checks
```

**Validation:** p99 < 2s with caching enabled. p99 < 5s without caching. Identify if Identity Service is a bottleneck.

---

### Task 4.6: End-to-end role verification checklist

**No code changes — manual verification for each role**

For each role (Principal, VicePrincipal, Teacher, Counselor, Nurse, Staff, Accountant):
1. Login → Sidebar shows correct nav items
2. School Selector → Shows assigned schools, no "Create School" (for non-admin)
3. Academics Overview → Widgets appropriate, no 403 in network tab
4. Students → List visible, CRUD buttons match permissions
5. Student Profile → View works, edit/delete gated correctly
6. Attendance → View works, recording gated by `attendance:create`
7. Grades → View works, recording gated by `grades:create`
8. Curriculum → View works, create/edit gated correctly
9. Scheduling → View works, create/edit gated correctly
10. Enrollment → Access gated for roles without `enrollment:view`

**Validation:** 7 roles × 10 areas = 70 verification points pass.

---

## Sprint 5: Advanced ABAC Features (Future)

**Goal:** Enterprise-grade features: permission overrides, temporary elevated access, comprehensive audit trail, parent/student portal scoping.

---

### Task 5.1: Implement permission override system

The `RoleAssignment` entity already has `permissionOverrides: PermissionOverride[]`. Implement the check in PermissionGuard: after role-based check, evaluate overrides (deny-wins). Allows granting a specific Teacher `enrollment:view` without changing their role.

### Task 5.2: Implement temporary role assignments (expiration)

`RoleAssignment.expiresAt` already exists. Add background job to deactivate expired assignments. PermissionGuard checks expiry before granting.

### Task 5.3: Enhanced audit trail

DynamoDB audit entity with write sharding (10 shards). Query API for compliance reporting. Integration with existing `AuditLoggerService`.

### Task 5.4: Parent/Student portal scoping

Implement `student` and `parent` scope types in DataScopeService. Parent sees only linked children's data. Student sees only their own.

### Task 5.5: Frontend E2E permission tests

> **Review addition:** Playwright tests for critical permission scenarios

Playwright tests:
- Teacher cannot see Admin buttons
- Navigating to restricted URL shows access denied
- 403 toast appears on unauthorized action
- TenantAdmin can access everything

---

## Sprint Dependency Graph

```
Sprint 1: Frontend Permission Enforcement
├── 1.1: 403 toast (FIRST - foundation)
├── 1.2: PermissionDenied component (foundation)
├── 1.3: Fix student profile schoolId (bug fix, independent)
├── 1.4: Gate student profile edits (depends on 1.2)
├── 1.5: Student profile 403 handling (depends on 1.2, 1.3)
├── 1.6: Gate Curriculum actions (independent)
├── 1.7: Overview permission-aware APIs (independent)
├── 1.8: Gate Grades module (independent)
├── 1.9: Gate Scheduling module (independent)
└── 1.10: TenantAdmin regression (after 1.1-1.9)

Sprint 2: Backend Data Scope (depends on Sprint 1 for frontend handling)
├── 2.1: Wire into Students service (independent)
├── 2.2: Wire into Attendance service (independent)
├── 2.3: Wire into Grades service (independent)
├── 2.4: Wire into Sections service (independent)
├── 2.5: Fix Grades GET schoolId (independent)
├── 2.6: Configurable fail mode (independent)
├── 2.7: Fail-closed for Teacher without staffId (independent)
├── 2.8: Improve staffId resolution (depends on 2.7)
└── 2.9: Pagination + scope filtering (depends on 2.1)

Sprint 3: Role-Specific UX (can parallel with Sprint 2)
├── 3.1: MySectionsWidget (independent)
├── 3.2: Permission-aware overview layout (depends on 3.1)
├── 3.3: Teacher "My Students" filter (depends on Sprint 2)
├── 3.4: Per-role home quick actions (independent)
└── 3.5: Resource naming alignment (independent)

Sprint 4: Hardening & Verification (depends on Sprint 2)
├── 4.1: Identity Client timeouts (independent)
├── 4.2: Permission caching (depends on 4.1)
├── 4.3: Permission matrix tests (depends on Sprint 2)
├── 4.4: Data scope tests (depends on Sprint 2)
├── 4.5: Performance tests (depends on 4.2)
└── 4.6: E2E role verification (depends on all above)

Sprint 5: Advanced Features (future)
├── 5.1-5.4: Enterprise features
└── 5.5: Frontend E2E tests
```

---

## Role Permission Matrix — Current vs Target

### Teacher
| Area | Current State | Target State |
|------|--------------|-------------|
| Sidebar nav | ✓ Correct modules | Same |
| School selector | ✓ Shows assigned schools, no Create | Same |
| Overview | ✗ Calls enrollment → 403, red Xs in network | ✓ Skip enrollment, show My Sections widget |
| Students list | ✓ View, no create/delete | ✓ Scoped to assigned sections |
| Student profile | ✗ canEdit=true, missing schoolId | ✓ View-only, schoolId passed |
| Student drawer | ✗ "View Details" leads to 403 | ✓ Profile loads correctly |
| Attendance | ✓ View + create working | ✓ Scoped to assigned sections |
| Grades | ~ View + create + edit | ✓ Scoped to assigned sections |
| Curriculum | ✗ Empty-state "Add Course" visible | ✓ View-only everywhere |
| Scheduling | ~ View-only | ✓ View only assigned sections |
| Enrollment | ✓ Not in nav | Same |

### Principal
| Area | Current | Target |
|------|---------|--------|
| All modules | ✓ Full access, school-wide | Same |

### VicePrincipal
| Area | Current | Target |
|------|---------|--------|
| Most modules | ✓ Similar to Principal | Same |
| Deletes | Need to verify | ✓ No delete on most resources |

### Counselor
| Area | Current | Target |
|------|---------|--------|
| Special programs | Should have full access | ✓ Full CRUD |
| Students | View-only | ✓ View-only |
| Scheduling | View-only | ✓ View-only |

### Nurse
| Area | Current | Target |
|------|---------|--------|
| Students | View-only | ✓ View-only |
| Health records | Future | Future sprint |

### Staff (General)
| Area | Current | Target |
|------|---------|--------|
| Most modules | Backend blocks writes | ✓ Frontend also hides write buttons |

### Accountant
| Area | Current | Target |
|------|---------|--------|
| Finance | Full access | ✓ Full CRUD billing/expenses |
| Students | View-only | ✓ View-only |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| DataScopeService breaks Teacher workflows | Medium | High | Fail-open default (MVP), gradual rollout, monitoring |
| IDOR between Sprint 1 and Sprint 2 | Low | Medium | Backend school-level guard in place; section-level in Sprint 2 |
| Permission cache stale after role change | Low | Medium | 5-min TTL; Sprint 5 adds cache invalidation on role mutation |
| Identity Service timeout cascading | Medium | Medium | Circuit breaker + caching (Sprint 4) |
| Teacher without staffId gets wrong scope | Medium | High | Task 2.7 fails-closed for missing staffId |
| Pagination breaks with post-filter scope | Medium | Low | Task 2.9 over-fetches as MVP; query-level optimization later |
| Resource name mismatch (curriculum vs courses) | Low | Low | Task 3.5 aligns naming |
| TenantAdmin bypass regression | Low | High | Task 1.10 + Task 4.3 matrix tests |

---

## Review Feedback Incorporated

This plan was reviewed by a senior staff engineer. Key feedback incorporated:

1. **DataScopeService already exists** — Sprint 2 updated to wire-in only (no creation tasks)
2. **Frontend 403 handling must ship first** — Task 1.1 is explicitly first in Sprint 1
3. **Use `gracefulDegradation` not `suppress403Toast`** — prevents accidentally silencing real 403s
4. **Grades GET endpoint missing schoolId** — Added as Task 2.5
5. **Teacher without staffId = silent privilege escalation** — Added as Task 2.7
6. **Pagination + scope filtering inconsistency** — Added as Task 2.9
7. **Performance testing** — Added as Task 4.5
8. **TenantAdmin regression tests** — Added as Task 1.10 and baked into Task 4.3
9. **IDOR risk window documented** — Between Sprint 1-2, acknowledged in Risk Assessment
10. **Sprint 3 (UI) can parallel Sprint 2** — Dependency graph updated
