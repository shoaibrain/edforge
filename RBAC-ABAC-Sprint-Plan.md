# EdForge RBAC/ABAC Security — Sprint Plan

> **Scope**: Implement enterprise-grade, FERPA-compliant role-based and attribute-based access control across all EdForge layers — infrastructure, services, and client.
>
> **Context**: EdForge is a multi-tenant K-12 SaaS education platform. Per FERPA and Ed-Fi Analytics Middle Tier patterns, student data access must be scoped by role: District (Superintendent), School (Principal), Section (Teacher), Child (Parent), Self (Student).

---

## Current State Assessment

### Architecture Overview

EdForge implements a multi-layer RBAC/ABAC system:

| Layer | Technology | What It Does |
|-------|-----------|-------------|
| **Infrastructure** | Cognito + API Gateway Lambda Authorizer + STS | JWT authentication → custom attributes (`tenantId`, `userRole`, `tenantTier`) → STS credential assumption → DynamoDB LeadingKeys ABAC policy |
| **Identity Service** | NestJS Guards + Decorators | `GlobalRoleGuard`, `PermissionGuard`, `@RequireGlobalRole`, `@RequirePermission` → role assignment CRUD → permission registry (21+ resources, 8 actions) |
| **Client** | React ABAC Engine + Zustand | 88-resource permission matrix → hooks (`usePermission`, `useCanAccess`) → `<RequirePermission>` wrapper → route protection |

### Global Roles
- **`TenantAdmin`** — Full tenant access, bypasses all permission checks
- **`TenantUser`** (aka `StandardUser` client-side) — Access scoped by school-level role assignments

### School Roles (with seniority for escalation prevention)
| Role | Seniority | Data Scope |
|------|-----------|------------|
| Principal | 100 | All students in school |
| VicePrincipal | 80 | All students in school |
| Teacher | 60 | Students in assigned sections |
| Accountant | 60 | Financial data for school |
| Counselor | 50 | Students in assigned programs |
| Nurse | 50 | Health records for school |
| Staff | 40 | Limited operational data |
| Student | 20 | Own data only |
| Parent | 10 | Own children only |

### Critical Gaps Identified

| # | Gap | Severity | Layer |
|---|-----|----------|-------|
| 1 | **Academics service has NO `@RequirePermission` guards** — any TenantUser can perform any operation (grades, attendance, students, enrollment, courses, sections, grading policies, course offerings — 63 endpoints unguarded) | **Critical** | Services |
| 2 | **No row-level security** — Teachers see ALL students in a school, not just their sections; Parents see ALL students, not just their children; Students see all student data | **Critical** | Services + Client |
| 3 | **CORS wildcard (`*`)** on API Gateway — any website can make credentialed requests to EdForge API | **High** | Infrastructure |
| 4 | **GSI queries lack LeadingKeys condition** — relies on app-level filtering for tenant isolation on secondary indexes | **High** | Infrastructure |
| 5 | **No audit trail persistence** for role changes or permission checks | **High** | Services |
| 6 | **No session invalidation on role revocation** — revoked users retain access until JWT expires (1 hour) | **High** | Services |
| 7 | **Permission override validation missing** — `permissionOverrides` accepted with `as any` cast, no registry validation | **High** | Services |
| 8 | **No field-level projection** — all roles see all student attributes (FERPA "minimum necessary" violation) | **Medium** | Services |
| 9 | **Client permissions stale mid-session** — role changes require logout/login | **Medium** | Client |
| 10 | **Security Policies page UI** inconsistent with rest of app design | **Medium** | Client |
| 11 | **No route-level permission guards** — checks happen in component render, not `beforeLoad` | **Medium** | Client |

---

## Sprint 1: Permission Guards on Academics Service + Infrastructure Quick Fixes

**Goal**: Close the critical gap where any authenticated TenantUser can perform unrestricted operations on ALL academics endpoints. Fix the CORS wildcard vulnerability. Validate permission overrides.

**Demoable Outcome**: A Teacher assigned to School A attempts to access grades at School B → 403. A Student attempts to edit grades → 403. A Parent attempts to create enrollment → 403. Only users with the correct role+permission at the correct school can access each endpoint. CORS rejects unauthorized origins.

---

### Ticket 1.0: Fix CORS wildcard on API Gateway
**Description**: Replace `Access-Control-Allow-Origin: *` with specific allowed origins. This is a single-file change that closes a trivially exploitable vulnerability.

**Files**:
- `server/lib/shared-infra/api-gateway.ts` (lines 32-43, OPTIONS integration)

**Changes**:
- Set `Access-Control-Allow-Origin` to `https://www.edforge.app` (prod) with environment-based config for `http://localhost:*` (dev)
- Restrict `Access-Control-Allow-Methods` to `GET,POST,PATCH,PUT,DELETE,OPTIONS`
- Restrict `Access-Control-Allow-Headers` to `Content-Type,Authorization,X-Tenant-Id,X-Correlation-Id`
- Add `Access-Control-Max-Age: 86400` for preflight caching

**Acceptance Criteria**:
- Browser request from `https://www.edforge.app` succeeds
- Browser request from `https://evil-site.com` gets CORS error
- Dev environment allows `localhost` origins
- Preflight caching works (no OPTIONS on every request)

**Validation**: Deploy to dev. Open browser console on unauthorized origin → CORS error. Open on `localhost` → works.

---

### Ticket 1.1: Create shared permission guard module for cross-service use
**Description**: The `PermissionGuard` and `@RequirePermission` decorator currently live in the identity microservice. The academics service needs to check permissions without circular dependencies.

**Architecture Decision**: Use **direct DynamoDB read** from the academics service (NOT an HTTP call to the identity service). The role assignment entity key structure (`PK: TENANT#{tenantId}, SK: USER#{userId}#ROLE#{schoolId}`) is predictable, and the `DEFAULT_ROLE_PERMISSIONS` map + `matchesPermission()` utility can evaluate permissions locally. This avoids HTTP round-trip latency (~100-500ms) and adds only ~10ms (single DynamoDB GetItem).

**Files**:
- `server/application/libs/auth/src/guards/permission.guard.ts` (new)
- `server/application/libs/auth/src/guards/permission-cache.ts` (new — in-memory cache with 60s TTL)
- `server/application/libs/auth/src/decorators/require-permission.decorator.ts` (new)
- `server/application/libs/auth/src/utils/permission-matcher.ts` (new — copy from identity service)
- `server/application/libs/auth/src/constants/default-role-permissions.ts` (new — copy from identity service)
- `server/application/libs/auth/src/index.ts` (re-export)

**Implementation Details**:
```
1. Guard extracts userId, tenantId from JWT TenantContext
2. Guard extracts schoolId from route params OR query OR body (configurable via decorator)
3. Guard validates schoolId is in user's active role assignments
4. Cache check: {userId}:{schoolId} → cached role + permissions (60s TTL)
5. Cache miss: DynamoDB GetItem for role assignment entity
6. Evaluate: matchesPermission(role, resource, action, overrides)
7. TenantAdmin → bypass (no DynamoDB call, no cache check)
8. Denied → ForbiddenException with structured error
```

**Acceptance Criteria**:
- Guard reads role assignment directly from DynamoDB (single GetItem)
- In-memory cache with 60-second TTL per `{userId}:{schoolId}` key
- TenantAdmin bypass without any DB call
- `schoolId` extraction from params, query, and body (priority: params > query > body)
- Validates that user has an **active** role at the requested school (not just any role)
- 403 response: `{ error: 'Forbidden', message: 'Permission denied: {resource}:{action} at school {schoolId}', code: 'PERMISSION_DENIED' }`
- Structured CloudWatch log on every denial: userId, tenantId, schoolId, resource, action, timestamp
- Unit tests: guard logic, cache hit/miss, TenantAdmin bypass, schoolId extraction, expired role rejection

**Validation**: Unit tests pass. Integration test: deploy to dev, call academics endpoint with invalid role → 403.

---

### Ticket 1.2: Add `@RequirePermission` to Grades controller (7 endpoints)
**Description**: Apply the shared permission guard to every endpoint in the grades controller.

**Files**:
- `server/application/microservices/academics/src/grades/grades.controller.ts`

**Endpoint → Permission Mapping**:

| Endpoint | Resource | Action | schoolId Source |
|----------|----------|--------|----------------|
| `POST /academics/grades/record` | `grades` | `create` | Body (DTO) |
| `POST /academics/grades/record/bulk` | `grades` | `create` | Body (DTO) |
| `GET /academics/grades` | `grades` | `view` | Query param |
| `GET /academics/grades/overview` | `grades` | `view` | Query param `schoolId` |
| `GET /academics/grades/section/:sectionId` | `grades` | `view` | Query param `schoolId` |
| `POST /academics/grades/finalize/bulk` | `grades` | `approve` | Body `schoolId` |
| `PATCH /academics/grades/:gradeId/finalize` | `grades` | `approve` | Body or lookup |

**Acceptance Criteria**:
- Every endpoint has `@UseGuards(JwtAuthGuard, PermissionGuard)` and `@RequirePermission(...)` decorators
- Test matrix (parameterized tests):

| Role | record | record/bulk | GET grades | overview | section | finalize/bulk | finalize |
|------|--------|-------------|------------|----------|---------|---------------|----------|
| Principal | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| Teacher | 200 | 200 | 200 | 200 | 200 | 403 | 403 |
| Student | 403 | 403 | 200 | 403 | 403 | 403 | 403 |
| Parent | 403 | 403 | 200 | 403 | 403 | 403 | 403 |
| No role at school | 403 | 403 | 403 | 403 | 403 | 403 | 403 |

**Validation**: Deploy. Run parameterized test suite. All cells match expected status codes.

---

### Ticket 1.3: Add `@RequirePermission` to Attendance controller (10 endpoints)
**Description**: Apply permission guards to all attendance endpoints.

**Files**:
- `server/application/microservices/academics/src/attendance/attendance.controller.ts`

**Endpoint → Permission Mapping**:

| Endpoint | Resource | Action | schoolId Source |
|----------|----------|--------|----------------|
| `POST /academics/attendance` | `attendance` | `create` | Body (DTO) |
| `POST /academics/attendance/bulk` | `attendance` | `create` | Body (DTO) |
| `GET /academics/attendance` | `attendance` | `view` | Query `schoolId` |
| `GET /academics/attendance/summary` | `attendance` | `view` | Query `schoolId` |
| `GET /academics/attendance/student/:studentId` | `attendance` | `view` | (resolve from student) |
| `GET /academics/attendance/student/:studentId/summary` | `attendance` | `view` | Query `schoolId` |
| `GET /academics/attendance/overview` | `attendance` | `view` | Query `schoolId` |
| `GET /academics/attendance/trend` | `attendance` | `view` | Query `schoolId` |
| `GET /academics/attendance/alerts` | `attendance` | `view` | Query `schoolId` |
| `PATCH /academics/attendance/:date/:studentId` | `attendance` | `edit` | Body (DTO) |

**Acceptance Criteria**:
- All 10 endpoints guarded
- Role × endpoint test matrix (same structure as 1.2)
- Teacher can create/edit attendance; Student/Parent can only view
- Accountant gets 403 on all attendance endpoints (not in their permission set)

**Validation**: Parameterized test suite passes.

---

### Ticket 1.4: Add `@RequirePermission` to Students controller (14 endpoints)
**Description**: The Students controller is the most FERPA-sensitive — it provides direct access to student PII, bulk import, and a profile aggregation endpoint. This is the highest-priority controller after Grades/Attendance.

**Files**:
- `server/application/microservices/academics/src/students/students.controller.ts`

**Endpoint → Permission Mapping**:

| Endpoint | Resource | Action | schoolId Source |
|----------|----------|--------|----------------|
| `POST /academics/students` | `students` | `create` | Body (DTO) |
| `GET /academics/students` | `students` | `view` | Query `schoolId` |
| `GET /academics/students/check-duplicate` | `students` | `view` | Query `schoolId` |
| `POST /academics/students/check-duplicate` | `students` | `view` | Body `schoolId` |
| `POST /academics/students/import` | `students` | `create` | Body `schoolId` |
| `GET /academics/students/:id/profile` | `students` | `view` | (resolve from student) |
| `GET /academics/students/:id/enrollments` | `enrollment` | `view` | (resolve from student) |
| `GET /academics/students/:id/attendance/summary` | `attendance` | `view` | Query `schoolId` |
| `GET /academics/students/:id/attendance` | `attendance` | `view` | (resolve from student) |
| `GET /academics/students/:id/sections` | `scheduling` | `view` | (resolve from student) |
| `GET /academics/students/:id/grades` | `grades` | `view` | (resolve from student) |
| `GET /academics/students/:id` | `students` | `view` | (resolve from student) |
| `PATCH /academics/students/:id` | `students` | `edit` | (resolve from student) |
| `DELETE /academics/students/:id` | `students` | `delete` | (resolve from student) |

**Note**: Several endpoints don't have `schoolId` in the request. The guard must resolve it by looking up the student's school from the student record. Add a `resolveSchoolId` option to the decorator that accepts a param name (`:id`) to look up.

**Acceptance Criteria**:
- All 14 endpoints guarded
- `schoolId` resolution from student record works for endpoints without explicit schoolId
- Bulk import requires `students:create`
- Student profile returns 403 for roles without `students:view`
- Role × endpoint test matrix

**Validation**: Parameterized test suite. Manual test: Student role can view own profile but gets 403 on create/import.

---

### Ticket 1.5: Add `@RequirePermission` to Enrollment controller (9 endpoints)
**Description**: Guard all enrollment management endpoints.

**Files**:
- `server/application/microservices/academics/src/enrollment/enrollment.controller.ts`

**Endpoint → Permission Mapping**:

| Endpoint | Resource | Action | schoolId Source |
|----------|----------|--------|----------------|
| `POST /academics/enrollments` | `enrollment` | `create` | Body (DTO) |
| `GET /academics/schools/:schoolId/years/:yearId/enrollments` | `enrollment` | `view` | Param `:schoolId` |
| `GET /academics/schools/:schoolId/years/:yearId/enrollments/summary` | `enrollment` | `view` | Param `:schoolId` |
| `GET /academics/students/:studentId/enrollment` | `enrollment` | `view` | (resolve from student) |
| `GET /academics/schools/:schoolId/years/:yearId/students/:studentId/enrollment` | `enrollment` | `view` | Param `:schoolId` |
| `PATCH /academics/schools/:schoolId/years/:yearId/students/:studentId/enrollment` | `enrollment` | `edit` | Param `:schoolId` |
| `POST /academics/schools/:schoolId/years/:yearId/students/:studentId/withdraw` | `enrollment` | `edit` | Param `:schoolId` |
| `POST /academics/schools/:schoolId/years/:yearId/students/:studentId/transfer` | `enrollment` | `edit` | Param `:schoolId` |
| `GET /academics/schools/:schoolId/academic-years/:yearId/calendars` | `scheduling` | `view` | Param `:schoolId` |

**Acceptance Criteria**:
- All 9 endpoints guarded
- SchoolId correctly extracted from URL path params
- Withdrawal and transfer require `enrollment:edit`
- Role × endpoint test matrix

**Validation**: Parameterized test suite passes.

---

### Ticket 1.6: Add `@RequirePermission` to Courses, Sections, GradingPolicy, CourseOffering controllers (22 endpoints)
**Description**: Guard the remaining academics controllers.

**Files**:
- `server/application/microservices/academics/src/courses/courses.controller.ts` (5 endpoints)
- `server/application/microservices/academics/src/sections/sections.controller.ts` (8 endpoints)
- `server/application/microservices/academics/src/grades/grading-policy.controller.ts` (4 endpoints)
- `server/application/microservices/academics/src/courses/course-offering.controller.ts` (5 endpoints)

**Mapping**:

| Controller | Resource | View | Create | Edit | Delete |
|-----------|----------|------|--------|------|--------|
| Courses | `curriculum` | ✓ | ✓ | ✓ | ✓ |
| Sections | `scheduling` | ✓ | ✓ | ✓ | ✓ |
| GradingPolicy | `grades` | ✓ | ✓ | ✓ | — |
| CourseOffering | `curriculum` | ✓ | ✓ | ✓ | ✓ |

**Section-specific endpoints**:
- `POST /sections/:id/students` → `enrollment:create`
- `GET /sections/:id/students` → `students:view`
- `DELETE /sections/:id/students/:studentId` → `enrollment:delete`

**Acceptance Criteria**:
- All 22 endpoints across 4 controllers guarded
- SchoolId from query params for all
- Role × endpoint test matrix for each controller

**Validation**: Parameterized test suite. 0 unguarded endpoints in academics service.

---

### Ticket 1.7: Validate permission overrides against registry
**Description**: The `assignRole()` method accepts `permissionOverrides` with an `as any` cast, allowing arbitrary permission injection. Fix by validating overrides against the `PERMISSION_REGISTRY`.

**Files**:
- `server/application/microservices/identity/src/roles/roles.service.ts` (line ~158)
- `server/application/microservices/identity/src/common/constants/permission-registry.ts`

**Changes**:
- Remove `as any` cast on `permissionOverrides`
- Call `validatePermissionsAgainstRegistry()` on every role assignment that includes overrides
- Reject invalid resource:action pairs with 400 Bad Request
- Reject wildcard overrides (`*:*`) — these are only valid as default role permissions, not user overrides

**Acceptance Criteria**:
- Invalid override `{ resource: 'nonexistent', action: 'view' }` → 400
- Wildcard override `{ resource: '*', action: '*' }` → 400
- Valid override `{ resource: 'grades', action: 'approve' }` → accepted
- Unit tests for validation

**Validation**: Attempt to assign role with invalid override via API → 400 error.

---

### Ticket 1.8: Update client to handle 403 responses gracefully
**Description**: Surface permission denials to users with toast notifications and AccessDenied pages.

**Files**:
- `edforge-saas-frontend/apps/shell/src/lib/api.ts` (update 403 handler)
- `edforge-saas-frontend/apps/shell/src/components/common/AccessDenied.tsx` (enhance)

**Acceptance Criteria**:
- 403 response triggers toast: "You don't have permission to perform this action"
- If page initial load returns 403, show AccessDenied component
- AccessDenied shows user's current role and suggests contacting admin
- No infinite redirect loops

**Validation**: Log in as Student → navigate to grades management URL → see AccessDenied page.

---

## Sprint 2: Row-Level Security — Section, Child, and Self Scoping

**Goal**: Implement Ed-Fi compliant data access scopes so Teachers see only students in their sections, Parents see only their children, and Students see only their own data. Add entity-school membership validation on writes. Audit GSI tenant isolation. Add session invalidation on role changes.

**Demoable Outcome**: Teacher logs in → sees only grades for students in their assigned sections. Parent logs in → sees only their child's data. Student logs in → sees only their own records. Admin revokes a role → user immediately loses access.

---

### Ticket 2.0: Audit all GSI query patterns for tenant isolation
**Description**: Before implementing row-level security, verify that the foundation (tenant isolation) is solid. Systematically review every GSI query to confirm tenantId is in the partition key.

**Files**: All files calling `queryGSI()` across identity and academics services

**Deliverable**: Markdown table documenting:

| File | Line | GSI | PK Value | TenantId in PK? | Risk |
|------|------|-----|----------|-----------------|------|
| ... | ... | ... | ... | Yes/No | Safe/Needs Fix |

**Acceptance Criteria**:
- Every GSI query documented
- Risk assessment for each (Safe if tenantId in PK, Needs Fix if not)
- If any "Needs Fix" found, create follow-up ticket for Sprint 7
- If all safe, document and deprioritize Sprint 7 Ticket 7.2

**Validation**: Review table. Confirm no undocumented GSI queries.

---

### Ticket 2.1: Create DataScopeService with role-based scope resolution
**Description**: Centralized service that resolves data access scope based on user's role at a school. Build this FIRST, then integrate into data queries in subsequent tickets.

**Files**:
- `server/application/microservices/academics/src/common/services/data-scope.service.ts` (new)
- `server/application/microservices/academics/src/common/services/data-scope.service.spec.ts` (new)

**Interface**:
```typescript
interface DataScope {
  type: 'all' | 'school' | 'sections' | 'children' | 'self';
  schoolId: string;
  sectionIds?: string[];   // For Teacher scope
  studentIds?: string[];   // For Parent/Student scope
}

class DataScopeService {
  async resolveScope(tenantContext: TenantContext, schoolId: string): Promise<DataScope>
}
```

**Scope Resolution by Role**:
| Role | Scope Type | Data Access |
|------|-----------|------------|
| TenantAdmin | `all` | All students across all schools |
| Principal | `school` | All students in their school |
| VicePrincipal | `school` | All students in their school |
| Teacher | `sections` | Students in their assigned sections |
| Counselor | `school` | All students (for support services) |
| Nurse | `school` | All students (for health records) |
| Accountant | `school` | All students (for billing) |
| Staff | `school` | All students (view only, limited fields) |
| Parent | `children` | Only their linked children |
| Student | `self` | Only their own record |

**Acceptance Criteria**:
- Single method resolves scope based on role
- Teacher scope calls `SectionsService.listSections(schoolId, { teacherId })` to get assigned section IDs
- Parent scope looks up `childrenIds` from user profile
- Student scope resolves own `studentId` from user-student link
- Comprehensive unit tests for ALL 10 roles (not just 5)
- Edge cases: user with no sections → empty sections array; parent with no children → empty studentIds

**Validation**: Unit test suite with 100% role coverage passes.

---

### Ticket 2.2: Verify teacher-section assignment query capability
**Description**: Confirm that `SectionsService.listSections(schoolId, context, limit, cursor, { teacherId })` already supports filtering sections by teacher. If it does, no new code is needed. If not, add a GSI or query pattern.

**Files**:
- `server/application/microservices/academics/src/sections/sections.service.ts`

**Acceptance Criteria**:
- Can query all sections assigned to a specific teacher at a school
- Query uses GSI (not scan + filter)
- Returns section IDs and basic metadata
- If new GSI needed, document the key structure and add to DynamoDB table definition

**Validation**: Query sections for Teacher A → returns exactly their assigned sections. Query for Teacher B → different results.

---

### Ticket 2.3: Implement section-scoped grade queries for Teachers
**Description**: Filter grade query results through the DataScopeService so Teachers see only their sections' students.

**Files**:
- `server/application/microservices/academics/src/grades/grades.service.ts`

**Logic**:
```
const scope = await dataScopeService.resolveScope(context, schoolId)
switch (scope.type) {
  case 'all':
  case 'school': return allGradesForSchool
  case 'sections': return gradesFilteredBySectionIds(scope.sectionIds)
  case 'children': return gradesFilteredByStudentIds(scope.studentIds)
  case 'self': return gradesFilteredByStudentIds(scope.studentIds)
}
```

**Acceptance Criteria**:
- Teacher sees grades ONLY for their sections
- Principal/VicePrincipal sees ALL grades for school
- Parent sees only their children's grades
- Student sees only their own grades
- Query uses GSI-based filtering where possible (not post-fetch filter)
- Integration test with 2 teachers, each assigned different sections, verifying data isolation

**Validation**: Teacher A → Section A students only. Teacher B → Section B students only. Cross-check: Teacher A tries `sectionId=B` → empty results.

---

### Ticket 2.4: Implement section-scoped attendance queries for Teachers
**Description**: Same DataScopeService pattern for attendance data.

**Files**:
- `server/application/microservices/academics/src/attendance/attendance.service.ts`

**Acceptance Criteria**:
- Teacher sees and records attendance ONLY for their sections
- Attempting to record attendance for another teacher's section → 403
- Parent sees only their children's attendance
- Student sees only their own attendance
- Integration test

**Validation**: Teacher A marks attendance for Section A → success. Teacher A marks attendance for Section B → 403.

---

### Ticket 2.5: Implement parent-child and student-self data scoping
**Description**: Ensure parent→child and student→self relationships work end-to-end for grades, attendance, and student profile.

**Files**:
- `server/application/microservices/academics/src/grades/grades.service.ts`
- `server/application/microservices/academics/src/attendance/attendance.service.ts`
- `server/application/microservices/academics/src/students/students.controller.ts`

**Acceptance Criteria**:
- Parent sees only their children's grades, attendance, and profiles
- Parent with 2 children sees both children's data
- Parent with 0 linked children gets empty results (not error)
- Student sees only their own grades, attendance, and profile
- Student cannot access another student by manipulating URL (IDOR protection)
- Integration tests for each

**Validation**: Parent with 2 children → sees both. Attempt `GET /students/:otherChildId/grades` → empty/403.

---

### Ticket 2.6: Validate entity-school membership on write operations
**Description**: Prevent horizontal privilege escalation where a Teacher at School A submits `{ schoolId: "A", studentId: "student-from-B" }`. The permission guard passes (Teacher has `grades:create` at School A) but the grade targets a student at School B.

**Files**:
- `server/application/microservices/academics/src/common/validators/entity-school-validator.ts` (new)
- Apply to: `grades.service.ts`, `attendance.service.ts`, `enrollment.controller.ts`

**Logic**: On every write operation, verify that the target entity (studentId, sectionId) belongs to the claimed schoolId.

**Acceptance Criteria**:
- `recordGrade({ schoolId: A, studentId: from-B })` → 400 "Student does not belong to this school"
- `recordAttendance({ schoolId: A, studentId: from-B })` → 400
- `enrollStudent(sectionId: from-A, studentId: from-B)` → 400
- Validation happens BEFORE the DynamoDB write
- Unit tests for validator

**Validation**: Attempt cross-school write → 400. Same-school write → 200.

---

### Ticket 2.7: Add session invalidation on role mutations
**Description**: When a user's role is changed or revoked, invalidate all their active sessions so they re-authenticate with fresh claims. The identity service already has `invalidateAllUserSessions()` — wire it up.

**Files**:
- `server/application/microservices/identity/src/roles/roles.service.ts`
- `server/application/microservices/identity/src/auth/auth.service.ts`

**Acceptance Criteria**:
- `assignRole()`, `changeRole()`, `deactivateRole()` all call `invalidateAllUserSessions()` for the target user
- Session invalidation includes Cognito global sign-out
- Next API call from invalidated user returns 401
- Client handles 401 → redirect to login
- Tests verify session invalidation is called on each mutation

**Validation**: Admin revokes Teacher's role → Teacher's next API call → 401 → redirected to login → re-login shows updated role.

---

### Ticket 2.8: Update client ABAC engine for row-level entity checks
**Description**: Update client-side UI filtering to match server-side scoping (defense in depth).

**Files**:
- `edforge-saas-frontend/packages/abac/src/engine.ts`
- `edforge-saas-frontend/apps/academics/src/` (grade and attendance components)

**Acceptance Criteria**:
- Teacher UI section dropdown only shows assigned sections
- Parent UI shows only their children in student views
- Student UI shows only their own data (no student selector)
- Client-side filters match server-side scoping

**Validation**: Log in as Teacher → section dropdown shows only assigned sections. Log in as Parent → only child's data card.

---

## Sprint 3: Security Policies Page UI Redesign

**Goal**: Redesign the Security Policies page to match the elegant tabbed design pattern used in Grades & Assessments. Fix duplicate API calls. Streamline role management UX.

**Demoable Outcome**: A polished, consistent Security Policies page with clean tabs, data tables, expandable permission matrices, and a streamlined role assignment workflow.

---

### Ticket 3.1: Refactor Security Policies page to use shared tab component
**Description**: Refactor to use the same tab component pattern as Grades & Assessments (`Overview | Gradebook | Grading Policies`).

**Files**:
- `edforge-saas-frontend/apps/shell/src/pages/settings/rbac-security.tsx`

**Design**:
```
RBAC Security
Manage roles, permissions, and user access across your organization

[Roles & Permissions]  [User Assignments]  [Audit Log]
────────────────────────────────────────────────────────
```

**Acceptance Criteria**:
- Tab component matches Grades & Assessments style
- Tab state persists in URL query param (`?tab=roles`, `?tab=users`, `?tab=audit`)
- Smooth tab transitions (no layout shift)
- Page header consistent with other settings pages
- Responsive on mobile

**Validation**: Visual comparison with Grades & Assessments → consistent design language.

---

### Ticket 3.2: Redesign System Roles with expandable permission matrix
**Description**: Replace the card grid with an information-dense table. Row click expands to show the full permission matrix grouped by module.

**Files**:
- `edforge-saas-frontend/apps/shell/src/pages/settings/rbac-security.tsx` (Roles tab)
- `edforge-saas-frontend/apps/shell/src/components/settings/PermissionMatrix.tsx` (new)

**Design**:
```
System Roles — Pre-defined roles provided by EdForge

| Role         | Category      | Description                   | Permissions | Users |
|-------------|---------------|-------------------------------|-------------|-------|
| ▶ Principal | Administrator | Full school access            | 64          | 2     |
| ▼ Teacher   | Educator      | Classroom management, grading | 35          | 5     |
  ├── Academics
  │   ├── Students      ✓ View  ✗ Create  ✗ Edit  ✗ Delete
  │   ├── Grades        ✓ View  ✓ Create  ✓ Edit  ✗ Delete
  │   └── Attendance    ✓ View  ✓ Create  ✓ Edit  ✗ Delete
  ├── Finance
  │   └── (No permissions)
  └── Administration
      └── (No permissions)
```

**Acceptance Criteria**:
- Table shows all 6 system roles with live permission counts from ABAC engine
- User count fetched from backend
- Row click expands to show permission matrix grouped by category (Academics, Finance, Administration, etc.)
- Action columns: View, Create, Edit, Delete, Manage, Approve, Export, Send
- Checkmark/cross icons for granted/denied
- Collapsible module groups
- Sort by name, category, or permission count

**Validation**: All 6 roles render. Click Teacher → see 35 permissions organized by module.

---

### Ticket 3.3: Redesign User Assignments tab with data table
**Description**: Replace list view with proper data table. Add filtering, sorting, school assignment badges. Fix duplicate API call.

**Files**:
- `edforge-saas-frontend/apps/shell/src/pages/settings/rbac-security.tsx` (Users tab)
- `edforge-saas-frontend/apps/shell/src/services/users.service.ts`

**Design**:
```
User Assignments

[Search users...]  [Filter by Role ▼]  [Filter by School ▼]  [+ Assign User]

| User         | Email                   | Global Role   | Assignments                | Status  | ✎ |
|-------------|-------------------------|---------------|----------------------------|---------|---|
| Shoaib Rain | shoaib.rain@outlook.com | Tenant Admin  | Principal @ Westfield HS   | Active  | ✎ |
| Sarah Rain  | murphys18@icloud.com    | Standard User | Teacher @ Lucas HS         | Pending | ✎ |
```

**Acceptance Criteria**:
- Sortable columns (name, email, role, status)
- Search by name and email
- Filter by role, school
- Assignments column shows role @ school badges
- Edit button opens detail modal
- Pagination for large user lists
- **Single API call** for users (eliminate duplicate `/api/users?limit=100` + `/api/users?limit=50`)
- React Query deduplication for shared data between tabs

**Validation**: All users render. Filter by "Tenant Admin" → correct count. Network tab shows exactly 2 API calls (users + schools).

---

### Ticket 3.4: Redesign Assign User Role modal
**Description**: Streamlined step-by-step flow with duplicate prevention and better feedback.

**Files**:
- `edforge-saas-frontend/apps/shell/src/components/modals/AssignUserModal.tsx`

**Improvements**:
- Step indicator (1: Select User → 2: Select School → 3: Select Role → 4: Confirm)
- Show user's existing assignments in step 2 (disable schools where they already have a role, or show "Change Role" option)
- Role cards show permission count
- Confirmation summary before submit
- Error handling with retry
- Success toast and auto-close

**Acceptance Criteria**:
- Step indicator shows progress
- Schools with existing assignments show current role badge
- Duplicate assignment blocked or offered as role change
- Confirmation step summarizes: User → School → Role
- Mutation invalidates correct query keys
- Error toast on failure with retry

**Validation**: Assign new role → success. Try duplicate → see warning. Modal closes and table refreshes.

---

### Ticket 3.5: Implement Audit Log tab (placeholder UI)
**Description**: Build the Audit Log tab UI, ready to connect to real data in Sprint 4. Shows clean empty state for now.

**Files**:
- `edforge-saas-frontend/apps/shell/src/pages/settings/rbac-security.tsx` (Audit tab)
- `edforge-saas-frontend/apps/shell/src/components/settings/AuditLogTable.tsx` (new)

**Design**:
```
Audit Log — Track role and permission changes

[Filter by Date ▼]  [Filter by Action ▼]  [Filter by User ▼]  [Export CSV]

| Timestamp          | User        | Action         | Details                      | Performed By |
|-------------------|-------------|----------------|------------------------------|-------------|
| (empty state: "Audit logging will be available soon")                                      |
```

**Acceptance Criteria**:
- Table structure with filter controls
- Clean empty state message
- Responsive layout
- Ready to wire up to API (typed interfaces for audit events)

**Validation**: Tab renders with empty state. Filter controls are visible but non-functional.

---

## Sprint 4: Audit Trail & FERPA Compliance Logging

**Goal**: Implement persistent audit logging for role changes, permission checks, and data access events. Required for FERPA compliance.

**Demoable Outcome**: Admin opens Audit Log tab → sees complete history of role changes and data access events with timestamps, actors, and details.

---

### Ticket 4.1: Create audit log DynamoDB entity with write sharding
**Description**: Define the audit log entity with a sharded partition key to handle high-write throughput (50 Teachers marking attendance at 8 AM).

**Files**:
- `server/application/microservices/identity/src/common/entities/audit-log.entity.ts` (new)
- `server/lib/tenant-template/ecs-dynamodb.ts` (add GSI if needed)

**Schema**:
```
PK: TENANT#{tenantId}#AUDIT#SHARD#{eventId % 10}
SK: {timestamp}#{eventId}
GSI: user-based lookup (userId as PK, timestamp as SK)
TTL: configurable retention (default 2 years for FERPA)

Attributes:
  eventType: 'ROLE_ASSIGNED' | 'ROLE_CHANGED' | 'ROLE_DEACTIVATED' | 'PERMISSION_DENIED' | 'DATA_ACCESSED' | 'DATA_EXPORTED'
  actorUserId, actorEmail
  targetUserId, targetEmail (who was affected)
  resource, action
  schoolId
  details: { before, after } (for changes)
  recordCount (for data access events)
  ipAddress, userAgent
  timestamp: ISO string
```

**Acceptance Criteria**:
- 10 write shards to distribute throughput
- TTL configured for FERPA retention (2 years default)
- GSI for user-based audit lookup
- Read queries aggregate across all shards and merge by timestamp
- Unit tests for entity creation

**Validation**: Write audit event → query back → correct data. Write 1000 events → distributed across shards.

---

### Ticket 4.2: Create AuditService with non-blocking writes
**Description**: Service to persist audit events. Non-blocking — failures don't block the original operation.

**Files**:
- `server/application/microservices/identity/src/audit/audit.service.ts` (new)
- `server/application/microservices/identity/src/audit/audit.module.ts` (new)

**Methods**:
- `logRoleChange(actor, target, changeType, details)` — role assignment/change/deactivation
- `logPermissionDenied(userId, resource, action, schoolId)` — permission denial
- `logDataAccess(userId, resource, schoolId, scope, recordCount)` — data access (debounced: same user+resource within 5 min → single entry)
- `logDataExport(userId, resource, schoolId, exportDetails)` — data export

**Acceptance Criteria**:
- All methods are fire-and-forget (catch errors internally, log to CloudWatch, don't throw)
- Batch writes for performance (buffer up to 25 events or 5 seconds)
- Debounce data access logs (same user+resource+school within 5 min → update count, don't create new entry)
- Unit tests with mocked DynamoDB

**Validation**: Call methods → verify DynamoDB writes. Failure in audit write doesn't affect caller.

---

### Ticket 4.3: Integrate audit logging into RolesService
**Description**: Wire audit service into every role mutation.

**Files**:
- `server/application/microservices/identity/src/roles/roles.service.ts`

**Events**:
- `assignRole()` → `ROLE_ASSIGNED`
- `changeRole()` → `ROLE_CHANGED` (with before/after)
- `deactivateRole()` → `ROLE_DEACTIVATED` (with reason)
- `updateRole()` → `ROLE_UPDATED` (with changed fields)
- `checkPermission()` when denied → `PERMISSION_DENIED`

**Acceptance Criteria**:
- Every role mutation creates audit entry
- Includes actor (who made change) and target (who was affected)
- Only denials logged for permission checks (not successes, to avoid noise)
- Existing tests still pass, no performance degradation

**Validation**: Assign role → query audit → see `ROLE_ASSIGNED` event.

---

### Ticket 4.4: Integrate audit logging into academics data access
**Description**: Log when student data is accessed with scope metadata.

**Files**:
- `server/application/microservices/academics/src/common/interceptors/data-access-audit.interceptor.ts` (new)

**Logic**:
- NestJS interceptor applied globally to academics module
- After successful responses, log: userId, resource, schoolId, scope type, record count
- Debounce: same user+resource within 5 min → single entry
- Log data exports separately with `DATA_EXPORTED` event type

**Acceptance Criteria**:
- Data access logged with scope metadata
- Debounce prevents log flooding
- Export operations (if any) create `DATA_EXPORTED` entries
- Integration test

**Validation**: Teacher accesses gradebook → audit shows `DATA_ACCESSED` with section scope and student count.

---

### Ticket 4.5: Create audit log query API
**Description**: API endpoints for querying audit events.

**Files**:
- `server/application/microservices/identity/src/audit/audit.controller.ts` (new)

**Endpoints**:
- `GET /audit/events` — paginated, filtered query (dateRange, eventType, userId, schoolId)
- `GET /audit/events/export` — CSV export for compliance reports

**Acceptance Criteria**:
- Cursor-based pagination
- Filters: date range, event type, actor, target, school
- TenantAdmin only
- Results sorted descending by timestamp
- CSV export with proper headers
- Aggregates across all 10 write shards for reads
- Unit + integration tests

**Validation**: Query with filters → correct results. Export → valid CSV.

---

### Ticket 4.6: Connect Audit Log tab to real API
**Description**: Wire the placeholder Audit Log tab (Sprint 3) to real audit data.

**Files**:
- `edforge-saas-frontend/apps/shell/src/services/audit.service.ts` (new)
- `edforge-saas-frontend/apps/shell/src/components/settings/AuditLogTable.tsx`

**Acceptance Criteria**:
- Fetches real audit events via React Query
- Filters work (date picker, event type, user search)
- Pagination with "Load More"
- CSV export triggers download
- Loading states and error handling

**Validation**: Assign a role → Audit tab → event appears. Filter → correct results. Export → valid CSV.

---

## Sprint 5: Client Security Hardening

**Goal**: Route-level permission guards, mid-session permission sync, and proactive token refresh.

**Demoable Outcome**: User whose role is revoked mid-session gets immediately redirected. Routes protected before components load. Token refresh is seamless.

---

### Ticket 5.1: Add route-level permission guards via TanStack Router `beforeLoad`
**Description**: Check permissions BEFORE component loads to prevent flash of restricted content.

**Files**:
- `edforge-saas-frontend/apps/shell/src/router.tsx`

**Route → Permission Mapping**:

| Route | Required Permission |
|-------|-------------------|
| `/settings/security-policies` | `settings:manage` |
| `/settings/school/*` | `settings:view` |
| `/academics/grades/*` | `grades:view` |
| `/academics/attendance/*` | `attendance:view` |
| `/finance/*` | `billing:view` |

**Acceptance Criteria**:
- `beforeLoad` checks permissions and redirects to `/access-denied` if unauthorized
- No flash of restricted content
- TenantAdmin always passes
- Redirect preserves intended URL for potential "Request Access" flow

**Validation**: Log in as Student → navigate to settings → immediate redirect (no flash).

---

### Ticket 5.2: Implement mid-session permission sync
**Description**: On window focus, check if permissions changed. Update UI if so.

**Files**:
- `edforge-saas-frontend/apps/shell/src/hooks/usePermissionSync.ts` (new)
- `edforge-saas-frontend/apps/shell/src/lib/shell-context.tsx`

**Logic**:
```
window.addEventListener('focus', debounced(async () => {
  const fresh = await fetchUserAssignments()
  if (changed(current, fresh)) {
    updateAuthStore(fresh)
    toast.info('Your permissions have been updated')
  }
}, 60000)) // max once per 60s
```

**Acceptance Criteria**:
- Fetch latest assignments on window focus (debounced, max once per 60s)
- If changed, update store + show notification
- If active school role revoked, switch to next available school or show access-denied
- No unnecessary refetches

**Validation**: Admin revokes role → user switches tab → sees toast → restricted UI disappears.

---

### Ticket 5.3: Implement proactive token refresh
**Description**: Refresh token before expiration to prevent 401 interruptions during long sessions.

**Files**:
- `edforge-saas-frontend/apps/shell/src/hooks/useTokenRefresh.ts` (new)

**Logic**: Calculate exact expiry from JWT `exp` claim. Set single `setTimeout` for `(exp - 5 minutes)`. After refresh, set new timer from new token's `exp`.

**Acceptance Criteria**:
- Token refreshed 5 minutes before expiration (one-shot timer, not polling)
- Refresh failure → logout with message
- Timer reset after each successful refresh
- Background tab doesn't refresh excessively

**Validation**: Verify automatic refresh in network tab. No 401 errors during extended session.

---

### Ticket 5.4: Add DynamoDB role verification for sensitive write operations
**Description**: For grade submission and attendance creation, verify role in DynamoDB (not just JWT) to catch recently-demoted users.

**Files**:
- `server/application/microservices/academics/src/grades/grades.controller.ts`
- `server/application/microservices/academics/src/attendance/attendance.controller.ts`

**Sensitive Endpoints (DB verification)**:
- `POST /grades/record`, `POST /grades/record/bulk`, `POST/PATCH /grades/finalize`
- `POST /attendance`, `POST /attendance/bulk`, `PATCH /attendance`

**Read Endpoints (JWT-only is acceptable)**:
- All GET endpoints

**Acceptance Criteria**:
- Write endpoints verify role in DynamoDB (~50ms additional latency, acceptable for writes)
- Read endpoints remain fast (JWT-only, with cache)
- Revoke role in DB → user can still view (cached JWT) but cannot submit (DB check fails) → returns 403

**Validation**: Revoke teacher role in DB → teacher reads → ok. Teacher writes → 403.

---

## Sprint 6: Custom Roles, Permission Overrides & Advanced ABAC

**Goal**: Enable tenant administrators to create custom roles and manage per-user permission overrides.

**Demoable Outcome**: Admin creates "Department Head" custom role → assigns to user → user sees exactly the permitted features.

---

### Ticket 6.1: Custom role CRUD API endpoints
**Description**: API for managing tenant-defined custom roles that inherit from base system roles.

**Files**:
- `server/application/microservices/identity/src/roles/custom-roles.controller.ts` (new)
- `server/application/microservices/identity/src/roles/custom-roles.service.ts` (new)
- `server/application/microservices/identity/src/common/entities/custom-role.entity.ts` (new)

**Endpoints**:
- `POST /roles/custom` — Create
- `GET /roles/custom` — List
- `GET /roles/custom/:roleId` — Get
- `PATCH /roles/custom/:roleId` — Update
- `DELETE /roles/custom/:roleId` — Delete (blocked if users assigned)

**Schema**:
```typescript
{
  roleId: string, tenantId: string, name: string, description: string,
  baseRole: SchoolRole,
  permissionOverrides: { resource: string, action: string, effect: 'allow' | 'deny' }[],
  createdBy: string, createdAt: string
}
```

**Acceptance Criteria**:
- CRUD with validation (name uniqueness, valid base role, valid permissions via registry)
- Cannot delete role with active assignments
- TenantAdmin only
- Unit + integration tests

**Validation**: Create "Dept Head" based on Teacher + `grades:approve` → verify in DB → assign to user.

---

### Ticket 6.2: Update permission checking for custom roles
**Description**: Modify `checkPermission()` to resolve custom role permissions by merging base + overrides.

**Files**:
- `server/application/microservices/identity/src/roles/roles.service.ts`

**Logic**: base role permissions → apply custom role overrides → apply per-user overrides → deny-wins

**Acceptance Criteria**:
- Custom role permissions correctly resolved
- Deny overrides take precedence
- Cache custom role definitions (avoid repeated reads)
- Backward compatible with system roles
- Unit tests for merge logic edge cases

**Validation**: Custom role "Teacher+Approve" → user can approve grades. "Teacher-Delete" → user cannot delete.

---

### Ticket 6.3: Update client ABAC engine for custom roles
**Description**: Fetch custom role definitions from API and merge with base permissions client-side.

**Files**:
- `edforge-saas-frontend/packages/abac/src/permissions.ts`
- `edforge-saas-frontend/packages/abac/src/engine.ts`
- `edforge-saas-frontend/apps/shell/src/services/roles.service.ts` (new)

**Acceptance Criteria**:
- Custom role permissions fetched on login
- Cached in auth store
- ABAC engine resolves custom permissions
- UI correctly reflects custom capabilities

**Validation**: User with custom role → correct features visible/hidden.

---

### Ticket 6.4: Build Custom Roles management UI
**Description**: Custom Roles section in the Roles & Permissions tab with create/edit/delete and permission editor.

**Files**:
- `edforge-saas-frontend/apps/shell/src/pages/settings/rbac-security.tsx`
- `edforge-saas-frontend/apps/shell/src/components/settings/CustomRoleEditor.tsx` (new)

**Design**:
```
Custom Roles — Tenant-defined roles for specific needs

[+ Create Custom Role]

| Name          | Base Role | Overrides | Users | Actions     |
|--------------|-----------|-----------|-------|-------------|
| Dept Head    | Teacher   | +3 / -1   | 2     | Edit Delete |

Create/Edit Dialog:
  Name: [...]  Base Role: [Teacher ▼]
  Permission Overrides: ☑ grades:approve → Allow
  [Preview Effective Permissions] [Cancel] [Save]
```

**Acceptance Criteria**:
- Create/edit/delete custom roles
- Toggle individual permissions on/off
- Preview shows effective permissions (base + overrides)
- Delete blocked if users assigned
- Live permission count updates

**Validation**: Create custom role → assign to user → user sees correct features.

---

### Ticket 6.5: Build per-user permission override UI
**Description**: In user assignment detail, allow TenantAdmin to set per-user permission overrides.

**Files**:
- `edforge-saas-frontend/apps/shell/src/components/settings/UserPermissionOverrides.tsx` (new)

**Design**: Table showing role default + override toggle for each resource:action. Allow/Deny/Default toggle. Save and Reset buttons.

**Acceptance Criteria**:
- Shows base role permissions with override toggles
- Changes persisted via PATCH role assignment API
- Overrides visually highlighted
- Reset button removes all overrides
- Confirmation dialog

**Validation**: Add override → save → user gets extra permission. Remove → reverts.

---

### Ticket 6.6: Add Superintendent / District Admin role
**Description**: Ed-Fi district-level scope. Spans all schools within tenant.

**Files**:
- Permission registry, role assignment entity, client ABAC permissions, auth types

**Acceptance Criteria**:
- `Superintendent` role (seniority 90)
- Same permissions as Principal but applies across ALL schools
- Assignment uses special marker (`schoolId: '*'` or dedicated flag)
- DataScopeService resolves as district-level scope
- Client: school selector shows "All Schools"

**Validation**: Superintendent → view grades at any school. Switch schools → data accessible everywhere.

---

## Sprint 7: Infrastructure Hardening

**Goal**: Fix GSI tenant isolation (if issues found in 2.0), add rate limiting, clean up expired roles efficiently.

**Demoable Outcome**: Security audit confirms all data access paths are protected by IAM policy. Rate limiting prevents abuse.

---

### Ticket 7.1: Refactor GSI partition keys to include tenantId (if needed)
**Description**: Based on findings from Ticket 2.0, fix any GSI where tenantId is not in the partition key.

**Prerequisite**: Ticket 2.0 findings. Skip if all GSIs already include tenantId.

**Acceptance Criteria**:
- All GSI PKs include tenantId
- Data migration script if needed
- IAM policy updated for GSI LeadingKeys enforcement
- Integration tests

**Validation**: Cross-tenant GSI query → IAM policy blocks it.

---

### Ticket 7.2: Add tenant isolation integration tests
**Description**: Automated tests verifying cross-tenant data isolation on every query path.

**Files**:
- `server/application/microservices/academics/src/test/tenant-isolation.integration.spec.ts` (new)
- `server/application/microservices/identity/src/test/tenant-isolation.integration.spec.ts` (new)

**Acceptance Criteria**:
- Test each query path: main table PK, GSI1-GSI6
- Two test tenants with separate credentials
- Tenant A creds cannot read Tenant B data
- Tests run in CI pipeline

**Validation**: CI runs tenant isolation tests on every PR. All pass.

---

### Ticket 7.3: Add API rate limiting per tenant
**Description**: Prevent abuse with tiered rate limits.

**Files**:
- `server/lib/shared-infra/api-gateway.ts`
- `server/application/microservices/identity/src/common/guards/rate-limit.guard.ts` (new)

**Acceptance Criteria**:
- API Gateway throttle by tier: BASIC 50/s, ADVANCED 100/s, PREMIUM 500/s
- App-level: 10 role changes/min per user
- 429 response when exceeded
- Rate limit headers in responses

**Validation**: Rapid requests → first N succeed, rest get 429.

---

### Ticket 7.4: Add expired role cleanup via GSI/TTL
**Description**: Replace full table scan in `cleanupExpiredRoles()` with efficient query.

**Files**:
- `server/application/microservices/identity/src/roles/roles.service.ts`
- DynamoDB table definition (add GSI with `expiresAt` sort key)

**Acceptance Criteria**:
- Cleanup queries only roles expiring within window (not all roles)
- Uses GSI or DynamoDB TTL for automatic cleanup
- No full table scans

**Validation**: Create expired role → cleanup runs → role deactivated. No scan operations in CloudWatch metrics.

---

## Summary — Sprint Roadmap

| Sprint | Focus | Tickets | MVP Critical? |
|--------|-------|---------|--------------|
| **1** | Permission Guards + CORS Fix | 9 tickets | **YES** |
| **2** | Row-Level Security + Session Invalidation + GSI Audit | 9 tickets | **YES** |
| **3** | Security Policies UI Redesign | 5 tickets | No (cosmetic) |
| **4** | Audit Trail & FERPA Logging | 6 tickets | Partially (4.1-4.3 for pilot) |
| **5** | Client Security Hardening | 4 tickets | Partially (5.1 for pilot) |
| **6** | Custom Roles & Advanced ABAC | 6 tickets | No (post-pilot) |
| **7** | Infrastructure Hardening | 4 tickets | Partially (7.2 for pilot) |

### MVP Pilot Launch Minimum
**Must Have**: Sprint 1 (all) + Sprint 2 (all) = 18 tickets
**Should Have**: Sprint 3 + Tickets 4.1-4.3 + Ticket 5.1 + Ticket 7.2 = 11 tickets
**Defer Post-Pilot**: Sprint 6 + remaining Sprint 4/5/7 = 14 tickets

**Total**: 43 tickets across 7 sprints

### Dependency Graph
```
Sprint 1 ──────┐
               ├──→ Sprint 2 (needs guards before scoping)
               │        │
               │        ├──→ Sprint 4 (needs events to log)
               │        │
               │        └──→ Sprint 5 (needs server enforcement before client hardening)
               │                 │
               │                 └──→ Sprint 6 (needs full enforcement before custom roles)
               │
               └──→ Sprint 3 (independent, can parallel with Sprint 2)
                        │
                        └──→ Sprint 4 Ticket 4.6 (audit UI needs Sprint 3 tab)

Sprint 7 ─── can run in parallel with Sprints 3+ (Ticket 2.0 must complete first)
```

### Testing Strategy Requirements (Cross-Cutting)
Every sprint must include:
1. **Role × Endpoint test matrix** — parameterized tests for every guarded endpoint against all roles
2. **IDOR tests** — verify users cannot access entities they shouldn't by manipulating IDs in URLs/bodies
3. **Cross-tenant smoke test** — verify tenant isolation on at least one query path
4. **Negative tests** — expired roles, revoked sessions, invalid permissions all return appropriate errors
