# Student Portal RBAC & End-to-End Implementation Sprint Plan

## Executive Summary

### Current State Assessment

The student portal in EdForge is **structurally scaffolded but functionally incomplete**. A student user can log in, land on `/home`, see role-appropriate sidebar links, but **every link leads to a 404 or 403**:

| Feature | Frontend Status | Backend Status | User Experience |
|---------|----------------|----------------|-----------------|
| Student Portal Dashboard (`/student-portal`) | Stub: "coming soon" div | N/A | Broken - useless stub |
| My Grades (`/student-portal/grades`) | **No route defined** | Self-service endpoint exists (`GET /students/:id/grades`) but requires `grades:view` — Student role only has `student-portal:grades` | **404 Page Not Found** |
| My Attendance (`/student-portal/attendance`) | **No route defined** | Self-service endpoint exists (`GET /students/:id/attendance`) but requires `attendance:view` — Student role only has `student-portal:attendance` | **404 Page Not Found** |
| My Schedule (`/student-portal/schedule`) | **No route defined** | Self-service endpoint exists (`GET /students/:id/sections`) but requires `scheduling:view` — Student role only has `student-portal:schedule` | **404 Page Not Found** |
| Assignments (`/student-portal/assignments`) | **No route defined** | **No endpoint exists** | **404 Page Not Found** |
| Curriculum (`/academics/curriculum`) | Route exists (admin page) | Requires `courses:view` — Student lacks this | **403 Forbidden** |
| Scheduling (`/academics/scheduling`) | Route exists (admin page) | Requires `scheduling:view` — Student lacks this | **403 Forbidden** |

### Root Causes Identified

1. **RBAC Permission String Mismatch**: Backend `DEFAULT_ROLE_PERMISSIONS` for Student role grants `student-portal:grades`, `student-portal:attendance`, `student-portal:schedule`, `student-portal:assignments` — but API endpoints use `@RequirePermission({ resource: 'grades', action: 'view' })` format. The `permission-matcher.ts` parses `student-portal:grades` as `resource=student-portal, actions=grades` — which never matches a check for `resource=grades, action=view`.

2. **Frontend ABAC Over-Grants**: Frontend `@edforge/abac` gives Student `courses:view`, `classrooms:view`, `teachers:view`, etc. — making sidebar links visible for resources the backend will deny.

3. **No Student Portal Routes**: Shell router has only a stub at `/student-portal`. Sub-routes (`/grades`, `/attendance`, `/schedule`, `/assignments`) are not defined — all return 404.

4. **No Student-Facing UI Components**: No page components exist that call the self-service API endpoints (`/students/:id/grades`, `/students/:id/attendance`, etc.).

5. **Navigation Redundancy**: Student-portal sidebar shows both "Dashboard" (`/student-portal`) and "Back to Home" — both serve the same purpose.

6. **Sidebar Links to Admin Pages**: Student home sidebar links to `/academics/curriculum` and `/academics/schoolcalendar` which are admin-facing pages that 403 for students.

---

## Sprint Breakdown

---

## Sprint 1: RBAC Permission Alignment & Backend Access Fix

**Goal**: Fix the permission system so Student and Parent users can access self-service data through existing API endpoints. Includes permission unit tests (security-critical changes require immediate test coverage).

**Demoable Outcome**: A Student user can call `GET /academics/students/:id/grades`, `GET /academics/students/:id/attendance`, `GET /academics/students/:id/sections` via curl/Postman and get scoped data (their own records only). Permission denials for unauthorized resources still work. All permission tests pass.

---

### Ticket 1.1: Add Standard Resource Permissions to Student & Parent Roles in Backend + Unit Tests

**Description**: Update `DEFAULT_ROLE_PERMISSIONS` in `role-assignment.entity.ts` to grant Student and Parent roles standard resource permissions that map to existing `@RequirePermission` checks on self-service endpoints. Write unit tests alongside the changes.

**Files**:
- `server/application/microservices/identity/src/common/entities/role-assignment.entity.ts`
- `server/application/microservices/identity/src/common/utils/__tests__/permission-matcher.spec.ts` (create/update)
- `server/application/microservices/identity/src/roles/__tests__/roles.service.spec.ts` (create/update)

**Current Student permissions**:
```
'student-portal:grades',
'student-portal:attendance',
'student-portal:schedule',
'student-portal:assignments'
```

**Target Student permissions** (keep existing + add standard resource permissions):
```
'student-portal:grades',
'student-portal:attendance',
'student-portal:schedule',
'student-portal:assignments',
'grades:view',
'attendance:view',
'scheduling:view',
'courses:view',
'enrollment:view'
```

**Target Parent permissions** (keep existing + add standard resource permissions):
```
'parent-portal:grades',
'parent-portal:attendance',
'parent-portal:schedule',
'parent-portal:fees',
'grades:view',
'attendance:view',
'scheduling:view',
'courses:view',
'enrollment:view'
```

**Why keep both `student-portal:*` AND `grades:view`**: The `student-portal:*` permissions are used by the frontend sidebar ABAC checks (`sidebar-modules.ts` line 217: `permission: { action: 'view', resource: 'student-portal:grades' }`). The `grades:view` permissions are used by backend `@RequirePermission` guards. Both are needed until sidebar checks are migrated in a later ticket.

**Security note on `students:view`**: Do NOT add `students:view` to Student/Parent roles. While the self-service endpoints at `/students/:id/grades` check `grades:view` (not `students:view`), granting `students:view` would give Students access to the admin `GET /academics/students` listing endpoint. If DataScope filtering has a bug or the 1000-record scan limit (data-scope.service.ts line 319) misses records, this could expose other students' data. Students only need to call self-service endpoints that are already permission-gated by their specific resource (grades, attendance, scheduling).

**Unit Tests**:
- `permissionMatcher('grades:view', 'grades', 'view')` returns `true`
- `permissionMatcher('grades:create', 'grades', 'create')` returns `false` for Student
- `permissionMatcher('attendance:view', 'attendance', 'view')` returns `true`
- `permissionMatcher('scheduling:create', 'scheduling', 'create')` returns `false` for Student
- `permissionMatcher('students:view', 'students', 'view')` returns `false` for Student
- `permissionMatcher('students:edit', 'students', 'edit')` returns `false` for Student/Parent
- Parent can `grades:view` but not `grades:edit`
- Deny-wins override logic still works for all roles
- Run `RolesModule.onModuleInit()` validation — no errors

**Smoke Tests**:
- Student JWT → `GET /academics/students/:ownId/grades` → 200 (not 403)
- Student JWT → `GET /academics/students/:ownId/attendance` → 200
- Student JWT → `GET /academics/students/:ownId/sections` → 200
- Student JWT → `GET /academics/students/:otherId/grades` → 404 (data scope denies)
- Student JWT → `POST /academics/grades/record` → 403 (no create permission)
- Parent JWT → `GET /academics/students/:childId/grades` → 200
- Parent JWT → `GET /academics/students/:unrelatedId/grades` → 404

---

### Ticket 1.2: Write Unit Tests for DataScopeService Student & Parent Resolution

**Description**: Write unit tests verifying that `DataScopeService.resolveScope()` correctly resolves Student and Parent scopes. This is the critical security boundary — scope enforcement is what prevents cross-student data access.

**Files**:
- `server/application/microservices/academics/src/common/services/__tests__/data-scope.service.spec.ts` (create)

**Tests**:
- `resolveScope()` for Student user → returns `{ type: 'student', studentIds: [matchedStudentId] }` via email matching
- `resolveScope()` for Parent user → returns `{ type: 'student', studentIds: [childStudentId] }` via guardian matching
- `isStudentInScope(scope, ownStudentId)` → `true`
- `isStudentInScope(scope, otherStudentId)` → `false`
- When email match finds no student → scope resolves to empty `studentIds[]` → all data requests return empty results (not errors)
- When school has 0 students → scope resolution handles gracefully

**Validation**: All tests pass

---

### Ticket 1.3: Sync Frontend ABAC Permissions with Backend + Sidebar Cleanup

**Description**: Update `@edforge/abac` `ROLE_PERMISSIONS` for Student and Parent roles to match backend grants. Remove over-granted permissions. Also update the `home-student` and `student-portal` sidebar modules: remove broken admin-page links and remove the redundant Dashboard link.

**Files**:
- `edforge-saas-frontend/packages/abac/src/permissions.ts`
- `edforge-saas-frontend/apps/shell/src/config/sidebar-modules.ts`

**ABAC Changes for Student**:
- Keep: `dashboard:view`, `settings:view`, `courses:view`, `calendar:view`
- Keep: `student-portal:view`, `student-portal:grades:view`, `student-portal:attendance:view`, `student-portal:schedule:view`, `student-portal:assignments:view` (used by sidebar visibility checks)
- Add: `grades:view`, `attendance:view`, `scheduling:view`, `enrollment:view`
- Remove: `teachers:view`, `classes:view`, `classrooms:view`, `departments:view`
- Remove: `communications:view`, `announcements:view`, `messages:view,create,send`, `notifications:view`

**ABAC Changes for Parent**:
- Same pattern: remove non-functional grants, add self-service grants, keep portal visibility permissions

**Sidebar Changes for `home-student` module**:
- Keep: My Grades → `/student-portal/grades`, My Attendance → `/student-portal/attendance`, My Schedule → `/student-portal/schedule`, Assignments → `/student-portal/assignments`
- Remove: Curriculum → `/academics/curriculum` (will be re-added as `/student-portal/curriculum` in Sprint 3 when the page exists)
- Remove: School Calendar → `/academics/schoolcalendar` (will be re-added as `/student-portal/calendar` in Sprint 3)
- Keep: Settings → `/settings`

**Sidebar Changes for `studentPortalModule`**:
- Remove: "OVERVIEW" group and "Dashboard" item (redundant with "Back to Home" button in Sidebar.tsx)

**Validation**:
- Unit test: `can(studentUser, { action: 'view', resource: 'grades' })` → `true`
- Unit test: `can(studentUser, { action: 'edit', resource: 'grades' })` → `false`
- Unit test: `can(studentUser, { action: 'view', resource: 'teachers' })` → `false`
- Visual: Student mock login → sidebar shows only working links (no Curriculum, no School Calendar, no Dashboard)
- Frontend build succeeds

---

### Ticket 1.4: Verify API Gateway Routes for Student Self-Service Endpoints

**Description**: Verify that the API Gateway configuration (`server/lib/tenant-api-prod.json`) exposes the student self-service endpoints. If any routes are missing, add them.

**File**: `server/lib/tenant-api-prod.json`

**Endpoints to verify**:
- `GET /academics/students/{id}/grades` — must be routable through API Gateway
- `GET /academics/students/{id}/attendance` — must be routable
- `GET /academics/students/{id}/attendance/summary` — must be routable
- `GET /academics/students/{id}/sections` — must be routable
- `GET /academics/students/{id}/enrollments` — must be routable

**Validation**:
- All endpoints are present in API Gateway config with proper `x-amazon-apigateway-integration`
- No CORS or method issues for these paths

---

## Sprint 2: Student Portal Core Pages — Grades & Attendance

**Goal**: Implement the two highest-value student portal pages with real API data. Students can view their grades (with GPA) and attendance records.

**Demoable Outcome**: Student logs in → clicks "My Grades" → sees their grades per course with GPA. Clicks "My Attendance" → sees attendance records with summary stats. Loading skeletons, empty states, and error states all work. Pages are accessible and theme-aware.

**Ticket Parallelization**: Tickets 2.1 and 2.2 can be developed in parallel. Ticket 2.3 depends on both. Tickets 2.4 and 2.5 depend on 2.3.

---

### Ticket 2.1: Create Student Identity Resolution Hook

**Description**: Create a React hook that resolves the current logged-in user's `studentId`. The frontend needs to know which studentId to pass in API calls.

**Approach (MVP)**: Call `GET /academics/students?schoolId={activeSchoolId}` — the DataScopeService filters this to only the student's own record. Extract the first (and only) result's `studentId`. This avoids any Identity service changes.

**File to create**: `edforge-saas-frontend/apps/shell/src/hooks/useStudentIdentity.ts`

**Hook API**:
```typescript
function useStudentIdentity(schoolId: string | null): {
  studentId: string | null
  studentProfile: StudentProfile | null
  isLoading: boolean
  error: Error | null
}
```

**Note**: Accepts `schoolId` as parameter since a student could theoretically be enrolled in multiple schools.

**Post-MVP improvement** (backlog): Add `linkedStudentId` to Identity service `/users/me` response for O(1) lookup instead of relying on DataScope filtering.

**Validation**:
- Hook returns correct studentId for student user when schoolId is provided
- Hook returns null when schoolId is null (disabled state)
- Hook returns null/error for non-student user
- React Query caching: second render doesn't re-fetch

---

### Ticket 2.2: Register Student Portal Layout Route + Create Layout Component

**Description**: Convert the existing stub `/student-portal` route from a leaf route to a TanStack Router **layout route** with `<Outlet />` for child routes. Create the layout component.

**Files**:
- `edforge-saas-frontend/apps/shell/src/router.tsx` — convert to layout route with children
- `edforge-saas-frontend/apps/shell/src/pages/student-portal/StudentPortalLayout.tsx` — create

**Router change** (TanStack Router pattern):
```typescript
// Convert from leaf route:
const studentPortalRoute = createRoute({
  path: '/student-portal',
  component: () => <div>Coming soon...</div>,
})

// To layout route with children:
const studentPortalRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/student-portal',
  component: StudentPortalLayout, // renders <Outlet />
})

const studentPortalIndexRoute = createRoute({
  getParentRoute: () => studentPortalRoute,
  path: '/',
  beforeLoad: () => { throw redirect({ to: '/student-portal/grades' }) },
})

// Add children in route tree:
studentPortalRoute.addChildren([
  studentPortalIndexRoute,
  studentPortalGradesRoute,
  studentPortalAttendanceRoute,
  // ... future routes
])
```

**Layout responsibilities**:
- Resolve `studentId` via `useStudentIdentity(activeSchoolId)` hook
- Show loading skeleton while resolving
- Show error state if student identity can't be resolved
- Provide `studentId` to child routes via React context (`StudentPortalContext`)
- Render `<Outlet />` for child page content
- Redirect `/student-portal` → `/student-portal/grades` (default landing)

**Validation**:
- `/student-portal` redirects to `/student-portal/grades`
- Layout renders loading skeleton while identity resolves
- Layout renders error message if identity resolution fails
- Child routes render inside layout's `<Outlet />`
- Build succeeds

---

### Ticket 2.3: Implement My Grades Page

**Description**: Build the student grades page that fetches and displays the student's grades per course with GPA calculation. Includes loading skeletons, empty states, error states, accessibility, and dark mode support.

**File to create**: `edforge-saas-frontend/apps/shell/src/pages/student-portal/StudentGradesPage.tsx`

**Data source**: `GET /academics/students/:studentId/grades?schoolId={activeSchoolId}`

**Important**: Verify the actual response shape from the backend DTO before building UI. Check `GradeResponseDto` and `GpaResult` types in `server/application/microservices/academics/src/grades/` to confirm exact field names.

**UI Components**:
- Page header with student name and GPA summary card
- Term selector (if multiple terms)
- Grades table: Course Name | Section | Score | Letter Grade | Status
- Loading skeleton that matches final layout shape (no layout shift)
- Empty state: "No grades have been recorded yet. Your grades will appear here once your teachers record them."
- Error state for API failures with retry button
- React Query hook inline (no separate service layer — keep it simple for MVP)

**Acceptance Criteria**:
- Grades display correctly for student with recorded grades
- Empty state shows for student with no grades
- Loading skeleton appears during fetch, matches final layout
- API error → shows error state with retry (not crash)
- Dark mode: all colors use CSS variables / Tailwind theme tokens
- Accessibility: table has proper `<th>` headers with `scope`, screen reader labels
- Breadcrumb shows: Home > Student Portal > My Grades

**Breadcrumb**: Add `'student-portal' → 'Student Portal'` and `'grades' → 'My Grades'` to `ROUTE_LABELS` in `Breadcrumbs.tsx`.

---

### Ticket 2.4: Implement My Attendance Page

**Description**: Build the student attendance page showing attendance records and summary statistics. Includes loading skeletons, empty states, error states, accessibility, and dark mode support.

**File to create**: `edforge-saas-frontend/apps/shell/src/pages/student-portal/StudentAttendancePage.tsx`

**Data sources**:
- Summary: `GET /academics/students/:studentId/attendance/summary?schoolId=...&academicYearId=...`
- Records: `GET /academics/students/:studentId/attendance?schoolId=...`

**UI Components**:
- Summary cards: Total Days, Present, Absent, Late, Excused, Attendance Rate (%)
- Attendance rate visual (progress bar or donut chart)
- Date-range filter
- Records table: Date | Status | Period | Notes
- Color-coded status badges (green=present, red=absent, yellow=late, blue=excused)
- Loading skeleton matching final layout
- Empty state: "No attendance records yet. Attendance will be tracked starting from your enrollment date."
- Error state with retry button

**Acceptance Criteria**:
- Summary stats display correctly
- Records table paginates or scrolls
- Color coding works for all statuses and in dark mode (use semantic colors)
- API error → shows error state
- Empty state for new student with no attendance
- Accessibility: cards have ARIA labels, table has proper headers
- Breadcrumb shows: Home > Student Portal > My Attendance

**Breadcrumb**: Add `'attendance' → 'My Attendance'` to `ROUTE_LABELS` in `Breadcrumbs.tsx`.

---

### Ticket 2.5: Add FERPA Audit Logging for Student Data Access

**Description**: Add structured audit log entries (at INFO level) for all student data access through self-service endpoints. FERPA requires audit trails for student record access. Currently `DataScopeService` logs at debug level which is filtered in production.

**Files**:
- `server/application/microservices/academics/src/common/services/data-scope.service.ts`
- `server/application/microservices/academics/src/students/students.controller.ts`

**Log format**: Each entry must include: timestamp, userId, studentId accessed, resource type (grades/attendance/sections), schoolId, action outcome (allowed/denied).

**Validation**:
- Student accessing own grades → INFO-level audit log entry with all required fields
- Parent accessing child's attendance → INFO-level audit log entry
- Permission denial → audit log entry (verify existing logging is at correct level)
- Check console/CloudWatch for proper audit trail entries

---

## Sprint 3: Student Portal — Schedule & Navigation Polish

**Goal**: Complete the schedule page, add 403 handling, and ensure all navigation is clean. The core student portal (grades, attendance, schedule) is fully functional.

**Demoable Outcome**: Student logs in → My Grades works → My Attendance works → My Schedule works → no 404s or 403s on any sidebar link. Assignments shows "Coming Soon". Any direct-URL access to admin pages shows a friendly Access Denied page.

---

### Ticket 3.1: Implement My Schedule Page

**Description**: Build the student schedule page showing enrolled sections with meeting times. Includes route registration, loading/empty/error states, accessibility.

**Files**:
- `edforge-saas-frontend/apps/shell/src/pages/student-portal/StudentSchedulePage.tsx` (create)
- `edforge-saas-frontend/apps/shell/src/router.tsx` (add route as child of studentPortalRoute)
- `edforge-saas-frontend/apps/shell/src/components/layout/Breadcrumbs.tsx` (add label)

**Data source**: `GET /academics/students/:studentId/sections?schoolId={activeSchoolId}`

**UI Components**:
- Weekly schedule grid view (Mon-Fri, period/time slots)
- List view toggle (table format)
- Section cards: Course Name | Teacher | Room | Period | Time
- Current day highlight
- Loading skeleton, empty state ("You are not enrolled in any classes yet. Contact your school administrator."), error state

**Acceptance Criteria**:
- Schedule grid renders with enrolled sections
- List/grid toggle works
- Empty state for unenrolled student
- Dark mode, accessibility, breadcrumbs all work
- Breadcrumb: Home > Student Portal > My Schedule

---

### Ticket 3.2: Add Assignments "Coming Soon" Route

**Description**: Register the `/student-portal/assignments` route with a proper Coming Soon page. There is no assignments entity or endpoint in the backend, so this page will show a structured placeholder until the assignments feature is built.

**Files**:
- `edforge-saas-frontend/apps/shell/src/router.tsx` (add route)

**Implementation**: Use the existing `ComingSoon` component (already in the codebase at `components/layout/ComingSoon.tsx`) or a simple informational page: "Assignments are coming soon. Check back later for homework, projects, and assessment information."

**Validation**:
- Navigate to `/student-portal/assignments` → shows Coming Soon (not 404)
- Build succeeds

---

### Ticket 3.3: Handle 403 Errors Gracefully — Access Denied Page

**Description**: When a Student user navigates via URL to an admin page (e.g., `/academics/students`), show a user-friendly "Access Denied" page instead of a raw error or blank screen.

**Files**:
- `edforge-saas-frontend/apps/shell/src/components/layout/AccessDenied.tsx` (create)
- `edforge-saas-frontend/apps/shell/src/lib/api.ts` (update 403 handling for GET requests)

**UI Components**:
- Lock icon
- "Access Denied" heading
- "You don't have permission to view this page" message
- "Go to My Portal" button → `/student-portal/grades` (for Student role) or `/home` (generic)
- "Go Home" button → `/home`

**Integration**: Update the axios response interceptor to detect 403 on GET requests. For GET 403s, instead of just toasting, set an error state that the page component can render as an AccessDenied view.

**Validation**:
- Student navigates to `/academics/students` via URL → sees Access Denied page (not blank or raw error)
- Buttons navigate correctly
- Non-GET 403s (POST/PUT/PATCH) still show toast (existing behavior)

---

### Ticket 3.4: Add Curriculum & Calendar Sidebar Links Back (Now Pointing to Student Portal Routes)

**Description**: Now that Sprint 3 is building student portal routes, re-add Curriculum and School Calendar to the student home sidebar — but pointing to student-facing routes.

**File**: `edforge-saas-frontend/apps/shell/src/config/sidebar-modules.ts`

**Changes to `home-student` module**:
- Add under RESOURCES group: Curriculum → `/student-portal/curriculum`
- Add under RESOURCES group: School Calendar → `/student-portal/calendar`

**Note**: These routes need to be registered as well. For now, they render the existing curriculum/calendar pages if the student has `courses:view` permission (granted in Sprint 1). If the admin curriculum page doesn't work for students due to edit-mode UI, create lightweight read-only wrappers.

**Validation**:
- Sidebar shows Curriculum and School Calendar links
- Clicking them doesn't 403 or 404
- Student sees read-only view (no create/edit buttons)

---

## Sprint 4A: Parent Portal Foundation

**Goal**: Set up parent portal infrastructure — identity resolution, layout, child selector, overview page.

**Demoable Outcome**: Parent logs in → sees children overview cards → can select a child. Layout is ready for data pages.

---

### Ticket 4A.1: Create Parent Identity & Children Resolution Hook + Backend Endpoint

**Description**: Create a hook that resolves the parent's linked children. The backend `DataScopeService` resolves parent scope via guardian matching, but the frontend needs an explicit way to get the list of children.

**Approach (MVP)**: Same as student identity — call `GET /academics/students?schoolId={activeSchoolId}` as the Parent user. DataScope filtering returns only linked children. Extract children from the response.

**Files**:
- `edforge-saas-frontend/apps/shell/src/hooks/useParentChildren.ts` (create)

**Hook API**:
```typescript
function useParentChildren(schoolId: string | null): {
  children: StudentProfile[]
  activeChild: StudentProfile | null
  setActiveChild: (studentId: string) => void
  isLoading: boolean
  error: Error | null
}
```

**Validation**:
- Returns correct children for parent user
- Returns empty array for non-parent user
- `setActiveChild` correctly updates active child
- Persists active child selection across page navigations

---

### Ticket 4A.2: Register Parent Portal Routes + Create Layout with Child Selector

**Description**: Add parent portal layout route with child selector component. Convert stub `/parent-portal` to layout route with `<Outlet />`.

**Files**:
- `edforge-saas-frontend/apps/shell/src/router.tsx` (add parent portal layout route + child routes)
- `edforge-saas-frontend/apps/shell/src/pages/parent-portal/ParentPortalLayout.tsx` (create)

**Routes**:
```
/parent-portal               → redirect to /parent-portal/overview
/parent-portal/overview      → ParentOverviewPage
/parent-portal/grades        → ParentGradesPage (Sprint 4B)
/parent-portal/attendance    → ParentAttendancePage (Sprint 4B)
/parent-portal/schedule      → ParentSchedulePage (Sprint 4B)
/parent-portal/fees          → Coming Soon placeholder
```

**Layout responsibilities**:
- Resolve children via `useParentChildren(activeSchoolId)`
- Show child selector dropdown/tabs at top
- Provide active child context to child routes
- Loading/error states

**Validation**:
- `/parent-portal` redirects to `/parent-portal/overview`
- Child selector displays all linked children
- Layout renders loading state while children resolve
- Build succeeds

---

### Ticket 4A.3: Implement Parent Overview Page

**Description**: Dashboard showing all children with summary cards.

**File**: `edforge-saas-frontend/apps/shell/src/pages/parent-portal/ParentOverviewPage.tsx` (create)

**UI Components**:
- Child cards: Name, Grade Level, School, Attendance Rate, GPA
- Click card → navigate to child details (sets active child + navigates to grades)
- Empty state if no children linked: "No students are linked to your account. Please contact your school administrator."

**Validation**:
- Cards display for each linked child
- Click sets active child and navigates
- Empty state displays correctly

---

### Ticket 4A.4: Update Parent Sidebar Navigation

**Description**: Fix `home-parent` sidebar module to point to implemented parent portal routes. Remove broken links to admin pages.

**File**: `edforge-saas-frontend/apps/shell/src/config/sidebar-modules.ts`

**Changes**: Update parent home module to only include working routes. Remove Dashboard redundancy (same pattern as student portal fix in Sprint 1).

**Validation**:
- All parent sidebar links work (no 404s or 403s)
- "Back to Home" button works from parent portal pages

---

## Sprint 4B: Parent Portal Data Pages

**Goal**: Implement parent grades, attendance, and schedule pages using shared components from student portal.

**Demoable Outcome**: Parent logs in → selects child → views child's grades, attendance, and schedule. Switching children updates all data.

---

### Ticket 4B.1: Extract Shared Grade/Attendance/Schedule Components

**Description**: Refactor the student portal pages (from Sprint 2/3) to extract the data display components into reusable shared components. The page-level components handle data fetching; the display components handle rendering.

**Files**:
- `edforge-saas-frontend/apps/shell/src/components/portal/GradesDisplay.tsx` (extract from StudentGradesPage)
- `edforge-saas-frontend/apps/shell/src/components/portal/AttendanceDisplay.tsx` (extract from StudentAttendancePage)
- `edforge-saas-frontend/apps/shell/src/components/portal/ScheduleDisplay.tsx` (extract from StudentSchedulePage)
- Update student portal pages to use extracted components

**Validation**:
- Student portal pages still work identically after refactor
- Extracted components accept data via props (no internal fetching)
- Build succeeds

---

### Ticket 4B.2: Implement Parent Grades Page

**Description**: Parent grades page using shared `GradesDisplay` component with data fetched for active child.

**File**: `edforge-saas-frontend/apps/shell/src/pages/parent-portal/ParentGradesPage.tsx` (create)

**Validation**:
- Data displays for selected child
- Switching children updates data
- Loading/empty/error states work

---

### Ticket 4B.3: Implement Parent Attendance Page

**File**: `edforge-saas-frontend/apps/shell/src/pages/parent-portal/ParentAttendancePage.tsx` (create)

**Validation**: Same as 4B.2 but for attendance data.

---

### Ticket 4B.4: Implement Parent Schedule Page

**File**: `edforge-saas-frontend/apps/shell/src/pages/parent-portal/ParentSchedulePage.tsx` (create)

**Validation**: Same as 4B.2 but for schedule data.

---

## Sprint 5: End-to-End Testing & Production Hardening

**Goal**: Comprehensive smoke testing, edge case handling, and production readiness.

**Demoable Outcome**: Full demo flow: Admin enrolls student → student portal account created → student logs in → views grades/attendance/schedule → parent logs in → views child's data. All edge cases handled.

---

### Ticket 5.1: Write Smoke Test Script for Student Portal Flow

**File**: `scripts/smoke-tests/student-portal-smoke.sh`

**Test Steps**:
1. Authenticate as TenantAdmin → create student → enroll
2. Verify student portal account created (check Cognito)
3. Authenticate as Student user
4. `GET /academics/students/:id/grades` → expect 200
5. `GET /academics/students/:id/attendance` → expect 200
6. `GET /academics/students/:id/sections` → expect 200
7. `GET /academics/students/:id/enrollment` → expect 200
8. `GET /academics/students/:otherId/grades` → expect 404 (scope denial)
9. `POST /academics/grades/record` → expect 403 (no create permission)
10. `GET /academics/students` → expect 200 with only own data (verify count = 1)

---

### Ticket 5.2: Write Smoke Test Script for Parent Portal Flow

**File**: `scripts/smoke-tests/parent-portal-smoke.sh`

**Test Steps**:
1. Authenticate as Parent user
2. `GET /academics/students?schoolId=...` → expect 200 with only linked children
3. `GET /academics/students/:childId/grades` → expect 200
4. `GET /academics/students/:childId/attendance` → expect 200
5. `GET /academics/students/:unrelatedId/grades` → expect 404

---

### Ticket 5.3: Write Frontend Component Tests for Portal Pages

**Description**: Add component tests using React Testing Library for all portal pages.

**Test Cases**:
- Grades page renders loading skeleton initially
- Grades page renders grade data after fetch resolves
- Grades page shows empty state when API returns empty grades array
- Grades page shows error state on API failure with retry button
- Attendance page renders summary cards with correct values
- Schedule page renders grid view and toggles to list view
- All pages handle missing studentId gracefully (show layout loading state)

---

### Ticket 5.4: Verify Permission Cache Invalidation on Role Change

**Description**: The Academics service caches permission decisions for 5 minutes (LRU cache, 300s TTL). Verify that role changes are reflected within the cache TTL.

**Test**:
1. Student calls endpoint → 200 (permission cached)
2. Admin revokes Student role assignment
3. Wait for cache TTL (5 min)
4. Student calls same endpoint → 403

**If cache invalidation is too slow**: Consider adding event-driven cache bust via `AcademicsEventsService` when role changes occur, or reducing TTL for portal users.

---

## Sprint 6: Final Audit & Polish

**Goal**: Verification pass for accessibility, responsive design, and dark mode across all portal pages. This is an audit sprint — quality attributes should already be baked into each page, this sprint catches any remaining issues.

**Demoable Outcome**: Full portal experience passes accessibility audit, works on mobile, and looks correct in dark mode.

---

### Ticket 6.1: Accessibility & Responsive Design Audit

**Description**: Run axe-core on all portal pages. Test at 768px, 1024px, 1440px viewports. Fix any violations.

**Checks**:
- Zero axe-core critical/serious violations
- All tables have proper `<th>` headers with `scope`
- Color contrast meets WCAG AA in both themes
- No horizontal scrolling at any breakpoint
- Touch targets are at least 44x44px on mobile
- Tab order follows logical reading order
- Skip link works to skip sidebar

---

### Ticket 6.2: Dark Mode & Theme Verification

**Description**: Visual verification of all portal pages in both light and dark modes.

**Checks**:
- No hardcoded colors
- Status badges (attendance) readable in both modes
- GPA cards, summary stats, charts are theme-aware
- Consistent with existing EdForge design system

---

## Dependency Graph

```
Sprint 1 (RBAC Fix + Tests) ──► Sprint 2 (Grades + Attendance)
                                       │
                                       ▼
                                 Sprint 3 (Schedule + Nav + 403 Handling)
                                       │
                                       ├──► Sprint 4A (Parent Foundation)
                                       │         │
                                       │         ▼
                                       │    Sprint 4B (Parent Data Pages)
                                       │         │
                                       ▼         ▼
                                 Sprint 5 (E2E Testing + Hardening)
                                       │
                                       ▼
                                 Sprint 6 (Final Audit)
```

Sprint 1 is a **hard prerequisite** — nothing works without fixing permissions.
Sprint 2 depends on Sprint 1 (permissions must work before UI can fetch data).
Sprint 3 depends on Sprint 2 (schedule page uses same patterns).
Sprints 4A and 4B can overlap with Sprint 3 if team capacity allows (parent portal reuses student components).
Sprint 5 is a testing/hardening pass after all features are implemented.
Sprint 6 is a final audit — should be lightweight if earlier sprints followed acceptance criteria.

---

## File Impact Summary

### Backend Files Modified
| File | Sprint | Change |
|------|--------|--------|
| `identity/src/common/entities/role-assignment.entity.ts` | 1 | Add Student/Parent standard resource permissions |
| `academics/src/common/services/data-scope.service.ts` | 2 | Upgrade audit logging from debug to INFO level |
| `academics/src/students/students.controller.ts` | 2 | Add audit log annotations |

### Backend Files Created
| File | Sprint | Purpose |
|------|--------|---------|
| `identity/src/common/utils/__tests__/permission-matcher.spec.ts` | 1 | Permission matcher unit tests |
| `identity/src/roles/__tests__/roles.service.spec.ts` | 1 | Role permission unit tests |
| `academics/src/common/services/__tests__/data-scope.service.spec.ts` | 1 | Data scope unit tests |
| `scripts/smoke-tests/student-portal-smoke.sh` | 5 | E2E smoke test |
| `scripts/smoke-tests/parent-portal-smoke.sh` | 5 | E2E smoke test |

### Frontend Files Modified
| File | Sprint | Change |
|------|--------|--------|
| `packages/abac/src/permissions.ts` | 1 | Align Student/Parent permissions |
| `apps/shell/src/config/sidebar-modules.ts` | 1, 3, 4A | Fix nav links progressively |
| `apps/shell/src/router.tsx` | 2, 3, 4A | Add portal routes progressively |
| `apps/shell/src/components/layout/Breadcrumbs.tsx` | 2, 3 | Add portal labels |
| `apps/shell/src/lib/api.ts` | 3 | 403 handling for GET requests |

### Frontend Files Created
| File | Sprint | Purpose |
|------|--------|---------|
| `apps/shell/src/hooks/useStudentIdentity.ts` | 2 | Student ID resolution |
| `apps/shell/src/pages/student-portal/StudentPortalLayout.tsx` | 2 | Layout with Outlet + context |
| `apps/shell/src/pages/student-portal/StudentGradesPage.tsx` | 2 | Grades page |
| `apps/shell/src/pages/student-portal/StudentAttendancePage.tsx` | 2 | Attendance page |
| `apps/shell/src/pages/student-portal/StudentSchedulePage.tsx` | 3 | Schedule page |
| `apps/shell/src/components/layout/AccessDenied.tsx` | 3 | 403 page |
| `apps/shell/src/hooks/useParentChildren.ts` | 4A | Parent children resolution |
| `apps/shell/src/pages/parent-portal/ParentPortalLayout.tsx` | 4A | Parent layout + child selector |
| `apps/shell/src/pages/parent-portal/ParentOverviewPage.tsx` | 4A | Parent children overview |
| `apps/shell/src/components/portal/GradesDisplay.tsx` | 4B | Shared grades component |
| `apps/shell/src/components/portal/AttendanceDisplay.tsx` | 4B | Shared attendance component |
| `apps/shell/src/components/portal/ScheduleDisplay.tsx` | 4B | Shared schedule component |
| `apps/shell/src/pages/parent-portal/ParentGradesPage.tsx` | 4B | Parent grades view |
| `apps/shell/src/pages/parent-portal/ParentAttendancePage.tsx` | 4B | Parent attendance view |
| `apps/shell/src/pages/parent-portal/ParentSchedulePage.tsx` | 4B | Parent schedule view |

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| **DataScopeService email matching fails for student** | Student can't see their own data | Unit tests in Ticket 1.2; smoke tests in Ticket 5.1. Post-MVP: add `linkedStudentId` to Identity service for O(1) lookup |
| **DataScope 1000-student scan limit** | Schools with 1000+ students: email match could miss the student, causing false access denial | Document limit. Post-MVP: add GSI on `student.email` or `student.userId` for O(1) lookup |
| **Permission cache serves stale grants after role revocation** | Security exposure window (up to 5 min) | Ticket 5.4 addresses this. Consider event-driven invalidation post-MVP |
| **Frontend ABAC and backend RBAC drift again in future** | New features break for student/parent | Add CI validation that compares frontend and backend permission definitions |
| **Calendar/assessment data may not exist for demo** | Pages look empty | Empty states baked into every page ticket. Add seed data script for demo |
| **API Gateway missing routes for self-service endpoints** | Frontend 404s even with correct permissions | Ticket 1.4 explicitly verifies API Gateway configuration |
| **TanStack Router layout route conversion breaks existing routes** | All student portal routes stop working | Ticket 2.2 explicitly covers the conversion pattern |
| **FERPA audit logging at debug level in production** | No audit trail for student data access, compliance risk | Ticket 2.5 upgrades to INFO-level structured logging |

---

## Scope Decisions

### Included in MVP (Sprints 1-3)
- Permission fixes (backend + frontend ABAC sync)
- Student Grades page with real data
- Student Attendance page with real data
- Student Schedule page with real data
- Loading/empty/error states on all pages
- Access Denied (403) graceful handling
- Sidebar navigation fixes
- Unit tests for security-critical changes
- FERPA audit logging

### Included but Non-MVP (Sprints 4-6)
- Parent Portal (4A + 4B)
- E2E smoke test scripts
- Frontend component tests
- Permission cache validation
- Accessibility/responsive audit

### Excluded (Backlog)
- Assignments page (no backend entity/endpoint — show Coming Soon)
- Student curriculum page (nice-to-have read-only view)
- Student calendar page (nice-to-have read-only view)
- Home page widget customization for Student/Parent roles
- `linkedStudentId` on Identity service (O(1) student lookup)
- GSI for student email (handles schools with 1000+ students)
- Event-driven permission cache invalidation
