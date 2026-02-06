# EdForge Sprint Plan

## Current State Assessment

### Implemented and Working
- **Identity Service** (port 3010, NestJS): Auth (login/logout/refresh/MFA-ready), Users CRUD + preferences, Schools, ABAC Roles (per-school), Sessions + device tracking, Staff (Ed-Fi aligned), Credentials, Leave management, Academic Years, School Years, Tenants, Security (account locking, login history), Admin ops
- **Academics Service** (port 3011, NestJS): Students CRUD (profiles, guardians, medical, demographics), Enrollment lifecycle, Attendance tracking (daily/period)
- **Infrastructure** (CDK): 3-tier multi-tenant stacks (Basic/Advanced/Premium), VPC, ALB/NLB, API Gateway (`SpecRestApi` via `tenant-api-prod.json` Swagger spec), ECS Fargate/EC2, DynamoDB single-table (6 GSI per service), Cognito, EventBridge (SBT integration), CloudMap, CloudFront, S3
- **Shared Types** (`packages/shared-types`): Zod schema library for identity + academics domains
- **Frontend** (`client/AdminWeb`): React admin portal with Amplify auth, tenant management UI
- **Testing**: Jest (unit/integration/E2E), AWS mocks library (`@app/aws-mocks`), ~30% coverage
- **Deployment**: CDK orchestration, Docker builds, ECR push, install/cleanup scripts

### Not Implemented (Stubbed or Empty)
- **Grades**: Placeholder endpoint only (`students.controller.ts:205`); `grades/` directory is empty; entity + factory function exist in `grade.entity.ts`
- **Courses**: Entity + factory exist in `course.entity.ts`; `CourseSection` interface defined; no service/controller/module
- **Classrooms/Rooms**: Entity exists in `schedule.entity.ts` (physical `Classroom` with `roomId`, `roomNumber`, capacity); no service/controller
- **Schedules**: Entity exists in `schedule.entity.ts` (`Schedule` with `ScheduleSlot[]`); no service/controller; `scheduling/` directory is empty
- **Bell Schedules**: Entity + utility functions exist in identity service (`bell-schedule.entity.ts`); Zod schema in `shared-types`; no service/controller
- **Assignments**: `AssignmentGrade` interface nested inside `grade.entity.ts`; no standalone entity/service
- **Curriculum**: `curriculum/` directory is empty
- **CI/CD**: No GitHub Actions or pipeline
- **API Documentation**: No Swagger/OpenAPI setup
- **Parent/Student Portals**: Not implemented
- **Reporting/Analytics**: Not implemented
- **Webhooks**: Not implemented

### Key Architecture Details for Implementation
- **API Gateway routes** are defined in `server/lib/tenant-api-prod.json` (Swagger JSON, ~6000 lines), NOT in CDK TypeScript. New routes require adding path + `x-amazon-apigateway-integration` blocks to this JSON file.
- **Entities use a unified key pattern**: `PK=TENANT#{tenantId}`, `SK={EntityType}#{compositeKey}`. GSI1 is school-scoped (`GSI1PK=TENANT#{tid}#SCHOOL#{sid}`).
- **Three distinct concepts exist in the data model**: `Classroom` (physical room, `schedule.entity.ts`), `CourseSection` (course instance, `course.entity.ts`), and `Schedule` (time slot assignment, `schedule.entity.ts`). These are separate entities.
- **Bell schedules live in the identity service** (`bell-schedule.entity.ts`), alongside schools and academic years.
- **The `IdentityClientService`** in the academics service currently only supports `getSchool`, `validateSchoolExists`, `getCurrentAcademicYear`, and `getAcademicYears`. New cross-service lookups require adding methods here.
- **DynamoDB GSI changes**: Only 1 GSI can be added/deleted per CloudFormation update. GSI7-12 are commented out in `ecs-dynamodb.ts`.
- **EventBridge**: `EventServiceBase` constructor throws if `EVENT_BUS_NAME` env var is not set. Must be mocked in tests and set in local dev.

---

## Sprint 1: Course Catalog & Course Sections

**Goal**: Build the course catalog and course section (class instance) management. These are prerequisites for grades, scheduling, and student class assignment. Physical classrooms (rooms) are a separate concern addressed later.

**Demo**: Admin creates courses for a school, creates course sections with assigned teachers for an academic year, and sees sections listed under a school. Existing enrollment and attendance flows are unaffected.

### Tickets

#### SP1-1: Create `course.schema.ts` in shared-types
- **Description**: The DynamoDB entity `course.entity.ts` exists but there is no corresponding Zod schema in `packages/shared-types` for API validation. Create `packages/shared-types/src/schemas/academics/course.schema.ts` with schemas for: `CreateCourseRequest`, `UpdateCourseRequest`, `CourseResponse`, `CourseListResponse`, and `CourseFilterParams`. Fields should align with the existing `Course` interface in `course.entity.ts` (courseCode, courseName, schoolId, departmentId, gradeLevels, credits, creditType, subjectArea, courseType, prerequisites, typicalDuration). Export from `packages/shared-types/src/schemas/academics/index.ts`.
- **Files to create/modify**:
  - `packages/shared-types/src/schemas/academics/course.schema.ts` (create)
  - `packages/shared-types/src/schemas/academics/index.ts` (add export)
- **Validation**: `npm run build` in `packages/shared-types` succeeds; types are importable from `@edforge/shared-types`.

#### SP1-2: Create `course-section.schema.ts` in shared-types
- **Description**: The `CourseSection` interface exists in `course.entity.ts` but has no Zod schema. Create `packages/shared-types/src/schemas/academics/course-section.schema.ts` with schemas for: `CreateSectionRequest`, `UpdateSectionRequest`, `SectionResponse`, `SectionListResponse`, `SectionFilterParams`. Fields from the existing `CourseSection` interface: sectionNumber, sectionName, courseId, schoolId, academicYearId, termId, primaryTeacherId, coTeacherIds, roomId, maxEnrollment. Export from the academics index.
- **Files to create/modify**:
  - `packages/shared-types/src/schemas/academics/course-section.schema.ts` (create)
  - `packages/shared-types/src/schemas/academics/index.ts` (add export)
- **Validation**: `npm run build` succeeds; types importable.

#### SP1-3: Course service and CRUD endpoints
- **Description**: Implement `CoursesModule`, `CoursesService`, and `CoursesController` in the academics microservice. Courses represent subject offerings at a school (e.g., "Algebra 1", "US History"). Use the entity from `course.entity.ts` and the Zod schema from SP1-1. Persist with `PK=TENANT#{tenantId}`, `SK=COURSE#{schoolId}#{courseId}` (already defined in the entity factory). Validate `schoolId` against the identity service via `IdentityClientService.validateSchoolExists()`. Implement DTOs and mapper following existing patterns (e.g., `students/`).
- **Files to create**:
  - `server/application/microservices/academics/src/courses/courses.module.ts`
  - `server/application/microservices/academics/src/courses/courses.service.ts`
  - `server/application/microservices/academics/src/courses/courses.controller.ts`
  - `server/application/microservices/academics/src/common/dto/course.dto.ts`
  - `server/application/microservices/academics/src/common/mappers/course.mapper.ts`
- **Files to modify**:
  - `server/application/microservices/academics/src/academics.module.ts` (register CoursesModule)
- **Endpoints**:
  - `POST /academics/courses` — create course
  - `GET /academics/courses?schoolId=X` — list courses by school (uses GSI1)
  - `GET /academics/courses/:id` — get course
  - `PATCH /academics/courses/:id` — update course
  - `DELETE /academics/courses/:id` — soft delete (set isActive=false)
- **Validation**: `npm run test:academics` passes; manual curl against local service returns correct responses; course items visible in DynamoDB.

#### SP1-4: Course service unit tests
- **Description**: Write unit tests for `CoursesService`. Cover: create course (happy path), get course (found/not found), list courses by school (with pagination), update course, soft delete, duplicate course code error, invalid schoolId (identity service returns 404), Zod validation rejection for invalid input. Mock DynamoDB via `@app/aws-mocks` and `IdentityClientService`.
- **Files to create**:
  - `server/application/microservices/academics/src/courses/courses.service.spec.ts`
- **Validation**: `npm run test -- --testPathPattern=courses` passes with >80% branch coverage on the service file.

#### SP1-5: Add `getStaff` and `validateStaffExists` to IdentityClientService
- **Description**: The existing `IdentityClientService` in academics has no staff-related methods. Course sections need teacher validation (teachers are staff in the identity service). Add `getStaff(staffId: string): Promise<StaffResponse>` and `validateStaffExists(staffId: string): Promise<void>` methods, following the same HTTP client pattern used by `validateSchoolExists`. The identity service exposes `GET /staff/:id`.
- **Files to modify**:
  - `server/application/microservices/academics/src/common/services/identity-client.service.ts`
- **Validation**: Calling `validateStaffExists` with a valid staff ID resolves; with invalid ID throws NotFoundException; unit test with mocked HTTP client.

#### SP1-6: Course section service and CRUD endpoints
- **Description**: Implement `SectionsModule`, `SectionsService`, and `SectionsController`. A course section is a specific instance of a course in a given academic year (e.g., "Algebra 1 — Section 001, Mr. Smith"). Use the `CourseSection` interface from `course.entity.ts`. Persist with `PK=TENANT#{tenantId}`, `SK=SECTION#{schoolId}#{sectionId}`. Each section references a `courseId` (validated to exist), `academicYearId`, and `primaryTeacherId` (validated via `IdentityClientService.validateStaffExists` from SP1-5). Track `currentEnrollment` count.
- **Files to create**:
  - `server/application/microservices/academics/src/sections/sections.module.ts`
  - `server/application/microservices/academics/src/sections/sections.service.ts`
  - `server/application/microservices/academics/src/sections/sections.controller.ts`
  - `server/application/microservices/academics/src/common/entities/section.entity.ts` (standalone entity with key builder, extending `CourseSection`)
  - `server/application/microservices/academics/src/common/dto/section.dto.ts`
  - `server/application/microservices/academics/src/common/mappers/section.mapper.ts`
- **Files to modify**:
  - `server/application/microservices/academics/src/academics.module.ts` (register SectionsModule)
  - `server/application/microservices/academics/src/common/entities/base.entity.ts` (add `'SECTION'` to EntityType union, add `EntityKeyBuilder.section()`)
- **Endpoints**:
  - `POST /academics/sections` — create section
  - `GET /academics/sections?schoolId=X&academicYearId=Y` — list sections
  - `GET /academics/sections/:id` — get section
  - `PATCH /academics/sections/:id` — update section (change teacher, maxEnrollment, roomId)
  - `DELETE /academics/sections/:id` — soft delete
- **Validation**: CRUD works; course and teacher validation called; correct DynamoDB key pattern.

#### SP1-7: Course section unit tests
- **Description**: Unit tests for `SectionsService`. Cover: create section (happy path), course not found, teacher (staff) not found, list by school + academic year, update (change teacher), delete, maxEnrollment enforcement, duplicate section number within same course.
- **Files to create**:
  - `server/application/microservices/academics/src/sections/sections.service.spec.ts`
- **Validation**: >80% branch coverage on service.

#### SP1-8: Student-section enrollment (junction entity)
- **Description**: Create a `StudentSectionEnrollment` junction entity to link students to sections. This is separate from the school-level enrollment (which tracks school+gradeLevel). The existing enrollment entity already has a `sectionId?: string` field but this is for homeroom only. Create a new entity with `PK=TENANT#{tenantId}`, `SK=SEC_ENROLL#{studentId}#{sectionId}`. Also add a GSI pattern for querying "all students in a section" and "all sections for a student". Implement `StudentSectionService` with: enroll student in section, drop student from section, list students by section, list sections by student. Validate student has an active school enrollment, section exists, and section is not full.
- **Files to create**:
  - `server/application/microservices/academics/src/sections/student-section.service.ts`
  - `server/application/microservices/academics/src/common/entities/student-section.entity.ts`
- **Files to modify**:
  - `server/application/microservices/academics/src/sections/sections.module.ts` (add StudentSectionService)
  - `server/application/microservices/academics/src/sections/sections.controller.ts` (add endpoints)
- **Endpoints**:
  - `POST /academics/sections/:sectionId/students` — enroll student in section
  - `DELETE /academics/sections/:sectionId/students/:studentId` — drop student from section
  - `GET /academics/sections/:sectionId/students` — list students in section (roster)
  - `GET /academics/students/:studentId/sections?academicYearId=X` — list sections for student
- **Validation**: Student enrolled in section; currentEnrollment count incremented; dropping decrements; full section rejects enrollment.

#### SP1-9: Student-section enrollment unit tests
- **Description**: Tests for `StudentSectionService`: enroll (happy path), section full, student not enrolled in school, student already in section, drop student, list roster, list student's sections.
- **Files**:
  - `server/application/microservices/academics/src/sections/student-section.service.spec.ts`
- **Validation**: >80% branch coverage.

#### SP1-10: API Gateway routes for courses and sections in `tenant-api-prod.json`
- **Description**: Add API Gateway path entries to `server/lib/tenant-api-prod.json` for: `/academics/courses`, `/academics/courses/{id}`, `/academics/sections`, `/academics/sections/{id}`, `/academics/sections/{sectionId}/students`, `/academics/sections/{sectionId}/students/{studentId}`. Follow the existing pattern used by `/academics/students` and `/academics/enrollments` — each path needs `GET`, `POST`, `PATCH`, `DELETE` methods (as applicable) with `x-amazon-apigateway-integration` blocks pointing to `{{integration_uri}}` via `{{connection_id}}` VPC Link, plus `OPTIONS` for CORS.
- **Files to modify**:
  - `server/lib/tenant-api-prod.json`
- **Validation**: `cdk synth` succeeds; new paths appear in the synthesized CloudFormation template; JSON is valid.

#### SP1-11: EventBridge events for course and section lifecycle
- **Description**: Publish EventBridge events when courses and sections are created, updated, or deleted. Follow the existing pattern in `BaseEventService` (e.g., academics `events.service.ts`). Events: `CourseCreated`, `CourseUpdated`, `CourseDeleted`, `SectionCreated`, `SectionUpdated`, `SectionDeleted`, `StudentSectionEnrolled`, `StudentSectionDropped`. Include tenantId, schoolId, and entity ID in event detail. Ensure `EVENT_BUS_NAME` is set in test setup/mocks.
- **Files to modify**:
  - `server/application/microservices/academics/src/courses/courses.service.ts`
  - `server/application/microservices/academics/src/sections/sections.service.ts`
  - `server/application/microservices/academics/src/sections/student-section.service.ts`
  - `server/application/microservices/academics/src/common/services/events.service.ts` (add event type constants)
- **Validation**: Unit tests verify `eventBridge.putEvents` is called with correct `DetailType` and `Detail` payload. `EVENT_BUS_NAME` mocked in test setup.

---

## Sprint 2: Grades & Assessments

**Goal**: Build the grading system — assignments, grade recording, grade calculation, and GPA. Replace the placeholder grades endpoint. The grade data model uses the existing `Grade` entity (`grade.entity.ts`) which stores per-course-per-term composite grades, with `assignments[]` and `categoryGrades[]` as nested arrays. This aligns with the existing entity design (SK: `GRADE#{studentId}#{courseId}#{termId}`).

**Demo**: Teacher creates assignments for a section, records grades per student per assignment, views term grades with category breakdowns, and sees calculated GPA. The existing student profile endpoint returns real grade data.

### Tickets

#### SP2-1: Reconcile grade data model and document access patterns
- **Description**: The existing `grade.entity.ts` defines a `Grade` entity with `SK=GRADE#{studentId}#{courseId}#{termId}` containing nested `assignments: AssignmentGrade[]` and `categoryGrades: CategoryGrade[]`. The existing `GradingPolicy` interface defines scales and weights. Sprint 2 will use this embedded-assignments model (updating the `assignments[]` array within the Grade document) rather than creating standalone assignment entities. Document the access patterns:
  - Get a student's grade for a course+term: Query by `PK=TENANT#{tid}`, `SK=GRADE#{studentId}#{courseId}#{termId}`
  - Get all grades for a student in an academic year: GSI2 query `gsi2pk=studentId`, `gsi2sk begins_with GRADE#{yearId}`
  - Get all grades for a course+term across students: GSI1 query `gsi1pk=TENANT#{tid}#SCHOOL#{sid}`, `gsi1sk begins_with GRADE#{courseId}#{termId}`
- **Files to create**:
  - `docs/GRADE_DATA_MODEL.md` (access patterns and design decisions)
- **Validation**: Document reviewed; access patterns match existing GSI definitions in `ecs-dynamodb.ts`.

#### SP2-2: Grading policy service
- **Description**: Implement `GradingPolicyService` to manage grading policies per school. A grading policy defines the grade scale (A=90-100=4.0, B=80-89=3.0, etc.), category weights (homework=30%, tests=40%, quizzes=15%, participation=15%), and rounding rules. Use the existing `GradingPolicy` interface from `grade.entity.ts`. Persist with `PK=TENANT#{tenantId}`, `SK=GRADEPOLICY#{schoolId}#{policyId}`. Each school can have multiple policies; one is marked as default.
- **Files to create**:
  - `server/application/microservices/academics/src/grades/grading-policy.service.ts`
  - `server/application/microservices/academics/src/grades/grading-policy.controller.ts`
  - `server/application/microservices/academics/src/grades/grades.module.ts`
  - `server/application/microservices/academics/src/common/entities/grading-policy.entity.ts`
  - `server/application/microservices/academics/src/common/dto/grading-policy.dto.ts`
  - `server/application/microservices/academics/src/common/mappers/grading-policy.mapper.ts`
- **Files to modify**:
  - `server/application/microservices/academics/src/academics.module.ts` (register GradesModule)
  - `server/application/microservices/academics/src/common/entities/base.entity.ts` (add GRADEPOLICY to EntityType)
- **Endpoints**:
  - `POST /academics/grading-policies` — create policy
  - `GET /academics/grading-policies?schoolId=X` — list policies by school
  - `GET /academics/grading-policies/:id` — get policy
  - `PATCH /academics/grading-policies/:id` — update policy
- **Validation**: CRUD works; category weights sum to 100%; grade scale entries are contiguous (no gaps).

#### SP2-3: Grading policy unit tests
- **Description**: Tests for `GradingPolicyService`: create policy, get, list, update, weights don't sum to 100% (error), overlapping grade scale ranges (error), set default policy.
- **Files to create**:
  - `server/application/microservices/academics/src/grades/grading-policy.service.spec.ts`
- **Validation**: >80% branch coverage.

#### SP2-4: Grade recording service
- **Description**: Implement `GradesService` and `GradesController`. Uses the existing `Grade` entity with embedded `assignments[]`. Core operations: (1) Record an assignment grade for a student — find or create the `Grade` document for that student+course+term, append/update the `AssignmentGrade` in the `assignments[]` array, recalculate `categoryGrades[]` and overall `numericGrade`/`letterGrade`/`gpaPoints` using the school's grading policy. (2) Bulk record — submit grades for all students in a section for one assignment. (3) Get grades — return the full `Grade` document. Validate student is enrolled in a section for the course (via `StudentSectionService` from SP1-8).
- **Files to create**:
  - `server/application/microservices/academics/src/grades/grades.service.ts`
  - `server/application/microservices/academics/src/grades/grades.controller.ts`
  - `server/application/microservices/academics/src/common/dto/grade.dto.ts`
  - `server/application/microservices/academics/src/common/mappers/grade.mapper.ts`
- **Endpoints**:
  - `POST /academics/grades/record` — record a single assignment grade
  - `POST /academics/grades/record/bulk` — record grades for multiple students on one assignment
  - `GET /academics/grades?studentId=X&courseId=Y&termId=Z` — get grade document
  - `GET /academics/grades/section/:sectionId?termId=Z` — all grades for a section
  - `PATCH /academics/grades/:gradeId/finalize` — mark grade as final
- **Validation**: Recording a grade creates/updates Grade document; embedded assignment appears; category and overall grades recalculated; bulk record updates all students.

#### SP2-5: Grade recording unit tests
- **Description**: Tests for `GradesService`: record single assignment grade (new Grade doc created), record second assignment (existing doc updated), bulk record, recalculation with category weights, student not enrolled in section (error), score exceeds possiblePoints (error), finalize grade, grade already final (error), get section grades.
- **Files to create**:
  - `server/application/microservices/academics/src/grades/grades.service.spec.ts`
- **Validation**: >80% branch coverage.

#### SP2-6: GPA calculation service
- **Description**: Implement `GpaCalculatorService` within the grades module. Calculate GPA for a student by academic year. Query all Grade documents for a student via GSI2 (`gsi2pk=studentId`, `gsi2sk begins_with GRADE#{yearId}`). For each Grade: use `gpaPoints` * `credits` (from the course). GPA = sum(gpaPoints * credits) / sum(credits). Support both unweighted (standard 4.0) and weighted (honors/AP multipliers using `creditType` from Course entity). Return cumulative GPA and per-term GPAs.
- **Files to create**:
  - `server/application/microservices/academics/src/grades/gpa-calculator.service.ts`
- **Validation**: Unit tests with known inputs produce correct GPA values for unweighted and weighted scales; handles missing grades gracefully (excluded from calculation).

#### SP2-7: GPA calculation unit tests
- **Description**: Tests: single course, multiple courses with different credits, weighted (AP=5.0) vs unweighted (4.0), no final grades (returns null), partial grades (some courses graded), zero GPA, perfect 4.0, cumulative across terms.
- **Files to create**:
  - `server/application/microservices/academics/src/grades/gpa-calculator.service.spec.ts`
- **Validation**: All edge cases mathematically correct.

#### SP2-8: Replace placeholder grades endpoint on student profile
- **Description**: Replace the TODO placeholder in `students.controller.ts:205` with a real implementation. Wire `GET /academics/students/:id/grades` to `GradesService` to query actual grade documents by student + optional academicYearId/termId filters. Include GPA from `GpaCalculatorService`. Also update the student profile aggregation endpoint (`GET /academics/students/:id/profile`) to include a `grades` summary section with current term GPA and total credits earned.
- **Files to modify**:
  - `server/application/microservices/academics/src/students/students.controller.ts` (replace placeholder)
  - `server/application/microservices/academics/src/students/students.service.ts` (add grade summary to profile)
  - `server/application/microservices/academics/src/students/students.module.ts` (inject GradesModule)
- **Validation**: `GET /students/:id/grades` returns real grade data (not placeholder); `GET /students/:id/profile` includes grades summary; no more "Grades module not yet implemented" message.

#### SP2-9: Grade-related EventBridge events
- **Description**: Publish events: `GradeRecorded`, `GradeBulkRecorded`, `GradeFinalized`, `GradingPolicyCreated`, `GradingPolicyUpdated`. Follow existing event publishing pattern. Mock `EVENT_BUS_NAME` in test setup.
- **Files to modify**:
  - `server/application/microservices/academics/src/grades/grades.service.ts`
  - `server/application/microservices/academics/src/grades/grading-policy.service.ts`
- **Validation**: Events published with correct DetailType; verified via unit test mocks.

#### SP2-10: API Gateway routes for grades in `tenant-api-prod.json`
- **Description**: Add paths to `server/lib/tenant-api-prod.json` for: `/academics/grades/record`, `/academics/grades/record/bulk`, `/academics/grades`, `/academics/grades/{gradeId}/finalize`, `/academics/grades/section/{sectionId}`, `/academics/grading-policies`, `/academics/grading-policies/{id}`.
- **Files to modify**:
  - `server/lib/tenant-api-prod.json`
- **Validation**: `cdk synth` succeeds; JSON valid; paths in CloudFormation template.

---

## Sprint 3A: Bug Fixes & Identity Service Test Coverage

**Goal**: Fix known code-level TODOs and bugs in the identity service. Raise identity service test coverage to 60%+.

**Demo**: All known TODOs resolved. Identity service test suite runs with 60%+ coverage report. No regressions.

### Tickets

#### SP3A-1: Fix auth.service.ts system client security concern
- **Description**: Address the TODO at `auth.service.ts`: "Why are we using getSystemClient instead of tenant scoped client?" Investigate whether the login flow should use tenant-scoped TVM credentials for DynamoDB operations. The login flow needs to look up a user by email (GSI1 query) before the tenant is fully resolved, which may justify using the system client for the initial lookup. If the system client is intentional, add a code comment explaining why (cross-tenant email lookup before tenant resolution) and remove the TODO. If tenant-scoped is correct, refactor.
- **Files to modify**:
  - `server/application/microservices/identity/src/auth/auth.service.ts`
- **Validation**: Login flow works; existing auth tests pass; TODO removed.

#### SP3A-2: Fix user status sync with Cognito
- **Description**: Address the TODO: "this is not safe. Status should be in sync with cognito." On login, after Cognito authentication succeeds, query the Cognito user status (`AdminGetUser` API). If Cognito says the user is disabled/force-change-password, update the DynamoDB record status to match. If the DynamoDB record says disabled but the user authenticated successfully via Cognito, treat Cognito as authoritative and update DynamoDB to active.
- **Files to modify**:
  - `server/application/microservices/identity/src/auth/auth.service.ts`
- **Validation**: Disabling user in Cognito prevents login and updates DynamoDB status; unit test covers sync logic; TODO removed.

#### SP3A-3: Fix tier detection fallback
- **Description**: Address the TODO about `|| 'basic'` default tier detection in `users.service.ts`. If the tier cannot be determined from environment variables or tenant metadata, this silently falls back to 'basic' which could use wrong DynamoDB credentials/table. Replace with: (1) check env var `TIER`, (2) if missing, log a warning and use 'basic' with explicit log message, OR throw a configuration error in production mode. Add a code comment explaining the decision.
- **Files to modify**:
  - `server/application/microservices/identity/src/users/users.service.ts`
- **Validation**: Missing tier logs a warning; in production mode (`NODE_ENV=production`), throws error; TODO removed.

#### SP3A-4: TenantAdmin self-demotion prevention
- **Description**: Address the TODO: "TenantAdmin should never be able to demote themself." In the role assignment / user update logic, add a check: if the requesting user's `userId` matches the target userId AND the update changes `globalRole` from `TenantAdmin` to `TenantUser`, return 403 Forbidden with message "Cannot demote your own admin role. Another admin must perform this action."
- **Files to modify**:
  - `server/application/microservices/identity/src/users/users.service.ts` or `server/application/microservices/identity/src/roles/roles.service.ts` (whichever handles globalRole changes)
- **Validation**: Self-demotion attempt returns 403; other role operations unaffected; unit test covers this case.

#### SP3A-5: Auth module test coverage (80%+ branches)
- **Description**: Expand `auth.service.spec.ts` tests. Cover: successful login (Cognito auth + session creation + DynamoDB lookup), failed login (wrong password — Cognito throws), locked account (failed attempt count exceeded), token refresh (valid refresh token, expired refresh token), logout (session invalidation), session creation with device info, Cognito status sync (SP3A-2), multiple concurrent sessions.
- **Files to modify**:
  - `server/application/microservices/identity/src/auth/auth.service.spec.ts`
- **Validation**: `npm run test:coverage` shows `auth.service.ts` at 80%+ branches.

#### SP3A-6: Users module test coverage (80%+ branches)
- **Description**: Expand `users.service.spec.ts` tests. Cover: create user (DynamoDB + Cognito), get user (found, not found), list users (pagination with lastEvaluatedKey), update user (partial update, preferences update), delete user (DynamoDB + Cognito), duplicate email error, self-demotion prevention (SP3A-4), tier detection behavior (SP3A-3).
- **Files to modify**:
  - `server/application/microservices/identity/src/users/users.service.spec.ts`
- **Validation**: 80%+ branch coverage.

#### SP3A-7: Roles module test coverage (80%+ branches)
- **Description**: Write/expand tests for `RolesService`. Cover: assign school role, remove school role, list roles by user, list roles by school, duplicate role assignment (error), invalid school (error), invalid user (error), role with permissions array.
- **Files to create/modify**:
  - `server/application/microservices/identity/src/roles/roles.service.spec.ts`
- **Validation**: 80%+ branch coverage.

#### SP3A-8: Schools module test coverage (80%+ branches)
- **Description**: Write/expand tests for `SchoolsService`. Cover: create school, get school (found, not found), list schools (by tenant), update school, duplicate school code (error).
- **Files to create/modify**:
  - `server/application/microservices/identity/src/schools/schools.service.spec.ts`
- **Validation**: 80%+ branch coverage.

#### SP3A-9: Staff, Credentials, Leave module test coverage (60%+ branches each)
- **Description**: Write unit tests for `StaffService`, `CredentialsService`, and `LeaveService`. For each: cover create, get, list (with filters), update, delete/cancel. For credentials: cover verify workflow and expiring credentials query. For leave: cover approve, reject, cancel, date validation.
- **Files to create**:
  - `server/application/microservices/identity/src/staff/staff.service.spec.ts`
  - `server/application/microservices/identity/src/credentials/credentials.service.spec.ts`
  - `server/application/microservices/identity/src/leave/leave.service.spec.ts`
- **Validation**: 60%+ branch coverage on each service.

#### SP3A-10: Raise Jest coverage thresholds to 60%
- **Description**: Update `jest.config.js` global coverage thresholds from 20/30/30/30 to 50/50/50/50. Update per-file overrides for `auth.service.ts` and `users.service.ts` to 80%. Verify all tests pass at new thresholds.
- **Files to modify**:
  - `server/application/jest.config.js`
- **Validation**: `npm run test:coverage` passes with new thresholds.

---

## Sprint 3B: Academics Service Test Coverage

**Goal**: Raise academics service test coverage to 60%+. Includes tests for all Sprint 1 and Sprint 2 services plus existing students/enrollment/attendance.

**Demo**: Full test suite (identity + academics) runs green with 60%+ coverage report across all services.

### Tickets

#### SP3B-1: Students module test coverage (80%+ branches)
- **Description**: Write/expand tests for `StudentsService`. Cover: create student (with guardian validation, medical info), get student (found, not found), list by school (pagination), update student (partial, guardian update), soft delete, student profile aggregation (enrollments + attendance summary), identity service school validation.
- **Files to create/modify**:
  - `server/application/microservices/academics/src/students/students.service.spec.ts`
- **Validation**: 80%+ branch coverage.

#### SP3B-2: Enrollment module test coverage (80%+ branches)
- **Description**: Write/expand tests for `EnrollmentService`. Cover: create enrollment, update status (active → withdrawn, active → transferred, active → graduated), list by student, list by school+year, invalid student (error), invalid school (error), re-enrollment after withdrawal.
- **Files to create/modify**:
  - `server/application/microservices/academics/src/enrollment/enrollment.service.spec.ts`
- **Validation**: 80%+ branch coverage.

#### SP3B-3: Attendance module test coverage (80%+ branches)
- **Description**: Write/expand tests for `AttendanceService`. Cover: record attendance (single), bulk attendance, daily summary by school, student attendance summary, update attendance, date range queries, duplicate attendance prevention (same student+date+period), invalid student.
- **Files to create/modify**:
  - `server/application/microservices/academics/src/attendance/attendance.service.spec.ts`
- **Validation**: 80%+ branch coverage.

#### SP3B-4: Integration test — course → section → student enrollment → grade recording
- **Description**: Write an integration test exercising the full Sprint 1+2 flow: create a course, create a grading policy, create a section, enroll a student in the section, create an assignment grade, verify the Grade document is created with recalculated scores, verify GPA endpoint returns a value. Use the integration test setup with mock AWS services.
- **Files to create**:
  - `server/application/test/integration/academics.integration.spec.ts`
- **Validation**: `npm run test:integration` passes; test covers the happy path end-to-end.

---

## Sprint 4: CI/CD Pipeline & API Documentation

**Goal**: Automate build and test. Generate API documentation. Make the project CI-ready.

**Demo**: Push to `dev` triggers automated tests. Swagger UI serves live API docs at `/api/docs` on each service.

### Tickets

#### SP4-1: GitHub Actions CI workflow — lint and unit tests
- **Description**: Create a GitHub Actions workflow that runs on push to `dev` and PRs to `main`. Jobs: (1) Install dependencies (root monorepo, `server/application`, `packages/shared-types`). (2) Run lint. (3) Run unit tests with coverage. (4) Upload coverage report as artifact. Use Node.js 20. Cache `node_modules` via `actions/cache`.
- **Files to create**:
  - `.github/workflows/ci.yml`
- **Validation**: Push to `dev` triggers workflow; tests run and report pass/fail; coverage artifact downloadable.

#### SP4-2: GitHub Actions CI workflow — CDK synth validation
- **Description**: Add a CI job (in same workflow or separate) that runs `cdk synth` to validate CDK code compiles. Triggered on PRs that modify `server/lib/**` or `server/bin/**`. Requires minimal AWS credentials (OIDC-based assume role with `sts:GetCallerIdentity` only, or set `CDK_DEFAULT_ACCOUNT` and `CDK_DEFAULT_REGION` env vars for synth-only mode).
- **Files to modify**:
  - `.github/workflows/ci.yml` (add job)
- **Validation**: PR touching CDK code triggers synth; synth succeeds or fails with clear error.

#### SP4-3: GitHub Actions CD workflow — deploy to dev (manual trigger)
- **Description**: Create a deployment workflow triggered via `workflow_dispatch`. Steps: build Docker images, push to ECR, run `cdk deploy --all --require-approval never`. Requires AWS credentials with deployment permissions (stored as GitHub secrets). Include environment selection input (dev/staging).
- **Files to create**:
  - `.github/workflows/deploy.yml`
- **Validation**: Manual trigger deploys; ECR images updated; ECS services restart.

#### SP4-4: NestJS Swagger/OpenAPI for identity service
- **Description**: Add `@nestjs/swagger` and `swagger-ui-express` dependencies. Configure Swagger in `identity/src/main.ts` with `SwaggerModule.setup('api/docs', app, document)`. Annotate all identity controllers with `@ApiTags`, `@ApiOperation`, `@ApiResponse`, `@ApiBearerAuth`. Use `createZodDto` from `nestjs-zod` to auto-generate schemas from Zod DTOs.
- **Files to modify**:
  - `server/application/package.json` (add `@nestjs/swagger`, `swagger-ui-express`)
  - `server/application/microservices/identity/src/main.ts` (Swagger setup)
  - All identity controllers (add decorators)
- **Validation**: `http://localhost:3010/api/docs` shows Swagger UI with all identity endpoints documented with request/response schemas.

#### SP4-5: NestJS Swagger/OpenAPI for academics service
- **Description**: Same as SP4-4 for the academics service at port 3011.
- **Files to modify**:
  - `server/application/microservices/academics/src/main.ts`
  - All academics controllers
- **Validation**: `http://localhost:3011/api/docs` shows Swagger UI.

#### SP4-6: Docker multi-stage build optimization
- **Description**: Optimize `Dockerfile.identity` and `Dockerfile.academics` with multi-stage builds. Stage 1: install all dependencies + build TypeScript. Stage 2: copy compiled JS + production `node_modules` only. Add `.dockerignore` if missing (exclude `node_modules`, `.git`, `test/`, `*.spec.ts`). Target: image size < 200MB.
- **Files to modify**:
  - `server/application/Dockerfile.identity`
  - `server/application/Dockerfile.academics`
  - `server/application/.dockerignore` (create if missing)
- **Validation**: `docker build` succeeds for both; `docker images` shows reduced size; services start from optimized images.

#### SP4-7: Health check consolidation
- **Description**: Verify both services expose `/health`, `/health/ready`, `/health/live` consistently via the `@app/health` library. Readiness probe should verify DynamoDB table accessibility (DescribeTable call). Liveness probe returns 200 if process is running. Update ECS task definition health check config in `server/lib/tenant-template/services.ts` to use these paths.
- **Files to verify/modify**:
  - `server/application/libs/health/` (verify)
  - `server/lib/tenant-template/services.ts` (ECS health check config)
- **Validation**: Health endpoints return correct status; ECS task definitions use health check paths in CDK synth output.

---

## Sprint 5: Bell Schedules & Class Scheduling

**Goal**: Implement bell schedules (period definitions) and schedule assignment (which section meets when/where). Bell schedules are managed in the identity service (alongside schools). Schedules linking sections to time slots are in the academics service. Connect scheduling to attendance for period validation.

**Demo**: Admin defines a bell schedule with periods for a school. A section is assigned to a specific period and room. Period-based attendance validates against the schedule. A student's daily schedule shows their classes in order.

### Tickets

#### SP5-1: Bell schedule service and CRUD in identity service
- **Description**: Implement `BellScheduleService` and `BellScheduleController` in the **identity service** (where schools live). The entity, key builder, factory function, and utility functions already exist in `bell-schedule.entity.ts`. Create the module, service, controller, DTOs, and mapper. The bell schedule Zod schema exists in `packages/shared-types/src/schemas/identity/bell-schedule.schema.ts`. Persist with `PK=TENANT#{tenantId}`, `SK=SCHOOL#{schoolId}#BELL#{bellScheduleId}` (already defined). Include period overlap validation using the existing `validatePeriodsNoOverlap()` utility.
- **Files to create**:
  - `server/application/microservices/identity/src/bell-schedules/bell-schedules.module.ts`
  - `server/application/microservices/identity/src/bell-schedules/bell-schedules.service.ts`
  - `server/application/microservices/identity/src/bell-schedules/bell-schedules.controller.ts`
  - `server/application/microservices/identity/src/common/dto/bell-schedule.dto.ts`
  - `server/application/microservices/identity/src/common/mappers/bell-schedule.mapper.ts`
- **Files to modify**:
  - `server/application/microservices/identity/src/identity.module.ts` (register BellSchedulesModule)
- **Endpoints** (on identity service, port 3010):
  - `POST /bell-schedules` — create bell schedule
  - `GET /bell-schedules?schoolId=X` — list by school
  - `GET /bell-schedules/:id` — get bell schedule
  - `PATCH /bell-schedules/:id` — update
  - `DELETE /bell-schedules/:id` — delete
- **Validation**: CRUD works; period overlap rejected; `validatePeriodsNoOverlap` called; items use correct SK pattern.

#### SP5-2: Bell schedule unit tests
- **Description**: Tests for `BellScheduleService`: create, get, list by school, update, delete, overlapping periods (error), period startTime >= endTime (error), set default schedule, deactivate schedule.
- **Files to create**:
  - `server/application/microservices/identity/src/bell-schedules/bell-schedules.service.spec.ts`
- **Validation**: >80% branch coverage.

#### SP5-3: Add `getBellSchedule` and `getBellSchedules` to IdentityClientService in academics
- **Description**: The academics service needs to read bell schedules from the identity service for schedule validation and student schedule views. Add `getBellSchedule(schoolId, bellScheduleId)` and `getBellSchedules(schoolId)` methods to `IdentityClientService` in academics, following the existing HTTP client pattern.
- **Files to modify**:
  - `server/application/microservices/academics/src/common/services/identity-client.service.ts`
- **Validation**: Methods return bell schedule data; unit test with mocked HTTP client covers happy path and not-found.

#### SP5-4: Schedule assignment service (section → time slot → room)
- **Description**: Implement `ScheduleService` in the academics service using the existing `Schedule` entity from `schedule.entity.ts`. A schedule entry links a section to time slots (period, day, room). The entity already has `SK=SCHEDULE#{schoolId}#{scheduleId}`, `slots: ScheduleSlot[]`, and references `sectionId`, `courseId`, `teacherId`, `roomId`. Validate: bell schedule period exists (via `IdentityClientService` SP5-3), section exists, no room conflict (same room, same period, same day), no teacher conflict (same teacher, two sections, same period).
- **Files to create**:
  - `server/application/microservices/academics/src/scheduling/scheduling.module.ts`
  - `server/application/microservices/academics/src/scheduling/scheduling.service.ts`
  - `server/application/microservices/academics/src/scheduling/scheduling.controller.ts`
  - `server/application/microservices/academics/src/common/dto/schedule.dto.ts`
  - `server/application/microservices/academics/src/common/mappers/schedule.mapper.ts`
- **Files to modify**:
  - `server/application/microservices/academics/src/academics.module.ts` (register SchedulingModule)
- **Endpoints**:
  - `POST /academics/schedules` — create schedule for a section
  - `GET /academics/schedules?schoolId=X&academicYearId=Y` — list schedules
  - `GET /academics/schedules/:id` — get schedule
  - `PATCH /academics/schedules/:id` — update (change room, time)
  - `DELETE /academics/schedules/:id` — delete
- **Validation**: Schedule created with correct slots; room conflict detected; teacher conflict detected; bell schedule period validated.

#### SP5-5: Schedule assignment unit tests
- **Description**: Tests: create schedule (happy path), room conflict (error), teacher conflict (error), invalid bell schedule period (error), section not found (error), update schedule, delete, list by school.
- **Files to create**:
  - `server/application/microservices/academics/src/scheduling/scheduling.service.spec.ts`
- **Validation**: >80% branch coverage.

#### SP5-6: Connect period-based attendance to bell schedule
- **Description**: Update the attendance module: when recording period-based attendance (where `period` field is provided), validate that the period name exists in an active bell schedule for the school. Use `IdentityClientService.getBellSchedules(schoolId)` (SP5-3) to fetch bell schedules. If period is invalid, return 400. Add `bellScheduleId` to the attendance record for auditability. Daily attendance (no period) is unaffected.
- **Files to modify**:
  - `server/application/microservices/academics/src/attendance/attendance.service.ts`
  - `server/application/microservices/academics/src/common/entities/attendance.entity.ts` (add bellScheduleId field)
- **Validation**: Invalid period name returns 400; valid period succeeds and includes bellScheduleId; daily attendance (no period) still works; existing attendance tests still pass.

#### SP5-7: Student daily schedule endpoint
- **Description**: Add `GET /academics/students/:id/schedule?date=YYYY-MM-DD` endpoint. Logic: (1) Get student's active section enrollments (`StudentSectionService`). (2) Get the schedule for each section (`ScheduleService`). (3) Filter slots by day-of-week matching the requested date. (4) Fetch bell schedule from identity to get period times. (5) Return ordered list: `[{ periodName, startTime, endTime, courseName, sectionNumber, teacherName, roomNumber }]`.
- **Files to modify**:
  - `server/application/microservices/academics/src/students/students.controller.ts`
  - `server/application/microservices/academics/src/students/students.service.ts`
- **Validation**: Returns correct schedule for a weekday; respects day-of-week slots; empty result for weekends or non-school days.

#### SP5-8: Student schedule unit tests
- **Description**: Tests: student with multiple sections on MWF, student with TTh classes only on Thursday, no active enrollment (empty), weekend returns empty, date in the past.
- **Files**: Update `students.service.spec.ts`.
- **Validation**: All cases pass.

#### SP5-9: API Gateway routes for bell schedules and scheduling in `tenant-api-prod.json`
- **Description**: Add paths to `server/lib/tenant-api-prod.json` for: `/bell-schedules`, `/bell-schedules/{id}`, `/academics/schedules`, `/academics/schedules/{id}`. Bell schedule paths route to identity service; schedule paths route to academics service.
- **Files to modify**:
  - `server/lib/tenant-api-prod.json`
- **Validation**: `cdk synth` succeeds; paths in template.

---

## Sprint 6: Physical Classrooms & Reporting

**Goal**: Implement physical classroom (room) management and build reporting capabilities — attendance reports, grade reports, enrollment summaries with CSV export.

**Demo**: Admin manages physical rooms. Admin generates an attendance report for a school/date range, a section grade report, and an enrollment summary. Reports downloadable as CSV.

### Tickets

#### SP6-1: Physical classroom (room) service and CRUD
- **Description**: Implement `ClassroomsModule`, `ClassroomsService`, `ClassroomsController` in academics for physical room management. The entity already exists in `schedule.entity.ts` as `Classroom` (physical room with roomId, roomNumber, capacity, roomType, features, building, floor). Persist with `PK=TENANT#{tenantId}`, `SK=CLASSROOM#{schoolId}#{roomId}` (already defined in `createClassroomEntity`).
- **Files to create**:
  - `server/application/microservices/academics/src/classrooms/classrooms.module.ts`
  - `server/application/microservices/academics/src/classrooms/classrooms.service.ts`
  - `server/application/microservices/academics/src/classrooms/classrooms.controller.ts`
  - `server/application/microservices/academics/src/common/dto/classroom.dto.ts`
  - `server/application/microservices/academics/src/common/mappers/classroom.mapper.ts`
- **Endpoints**:
  - `POST /academics/classrooms` — create room
  - `GET /academics/classrooms?schoolId=X` — list rooms by school (GSI1)
  - `GET /academics/classrooms/:id` — get room
  - `PATCH /academics/classrooms/:id` — update room
  - `DELETE /academics/classrooms/:id` — soft delete
- **Validation**: CRUD works; rooms scoped to school; capacity and features stored correctly.

#### SP6-2: Physical classroom unit tests
- **Description**: Tests: create room, get, list by school, update, delete, duplicate room number in same school+building (error).
- **Files**: `classrooms.service.spec.ts`
- **Validation**: >80% branch coverage.

#### SP6-3: Attendance report service
- **Description**: Implement `AttendanceReportService`. Inputs: schoolId, dateRange (startDate, endDate), optional gradeLevel filter. Output: per-student attendance summary (total days, present, absent, late, excused, attendance rate %). Support pagination. Query attendance records via GSI3 (`TENANT#{tid}#SCHOOL#{sid}#DATE#{d}`).
- **Files to create**:
  - `server/application/microservices/academics/src/attendance/attendance-report.service.ts`
- **Endpoints** (add to attendance controller):
  - `GET /academics/attendance/reports?schoolId=X&startDate=Y&endDate=Z&gradeLevel=G` — attendance report
- **Validation**: Correct aggregates; pagination works; date range filtering works.

#### SP6-4: Attendance report unit tests
- **Description**: Tests: single student, multiple students, date range, grade level filter, perfect attendance, zero attendance, pagination.
- **Files**: `attendance-report.service.spec.ts`
- **Validation**: >80% coverage.

#### SP6-5: Grade report service (section report and student report card)
- **Description**: Implement `GradeReportService`. (1) Section report: all students with their assignment grades, category averages, and overall grade for a course+term. Query GSI1 (`gsi1pk=TENANT#{tid}#SCHOOL#{sid}`, `gsi1sk begins_with GRADE#{courseId}#{termId}`). (2) Student report card: all courses with grades and GPA for an academic year. Query GSI2 (`gsi2pk=studentId`, `gsi2sk begins_with GRADE#{yearId}`).
- **Files to create**:
  - `server/application/microservices/academics/src/grades/grade-report.service.ts`
- **Endpoints** (add to grades controller):
  - `GET /academics/grades/reports/section/:sectionId?termId=X` — section grade report
  - `GET /academics/grades/reports/student/:studentId?academicYearId=X` — student report card
- **Validation**: Section report lists all students with correct averages; student report shows all courses with GPA.

#### SP6-6: Grade report unit tests
- **Description**: Tests: section with multiple students, weighted categories, student across multiple sections, empty section, no grades yet.
- **Files**: `grade-report.service.spec.ts`
- **Validation**: >80% coverage.

#### SP6-7: Enrollment report service
- **Description**: Implement `EnrollmentReportService`. Output: total enrolled by school, breakdown by grade level, breakdown by status (active/withdrawn/transferred/graduated), enrollment trends (new enrollments per month over academic year).
- **Files to create**:
  - `server/application/microservices/academics/src/enrollment/enrollment-report.service.ts`
- **Endpoints**:
  - `GET /academics/enrollments/reports?schoolId=X&academicYearId=Y` — enrollment report
- **Validation**: Correct counts; monthly trends calculated.

#### SP6-8: Enrollment report unit tests
- **Files**: `enrollment-report.service.spec.ts`
- **Validation**: >80% coverage.

#### SP6-9: CSV export service
- **Description**: Extend `@app/csv-parser` library to support CSV generation. Add `CsvExportService` that takes an array of objects + column definitions (header, field, formatter) and returns a CSV string. Handle special characters (commas, quotes, newlines). Support custom date/number formatting.
- **Files to create/modify**:
  - `server/application/libs/csv-parser/src/csv-export.service.ts`
  - `server/application/libs/csv-parser/src/csv-parser.module.ts` (register)
- **Validation**: Unit test generates valid CSV from known input.

#### SP6-10: CSV export unit tests
- **Files**: `csv-export.service.spec.ts`
- **Validation**: >80% coverage; special character handling tested.

#### SP6-11: Export format support on report endpoints
- **Description**: Add `?format=csv` query parameter to all report endpoints (SP6-3, SP6-5, SP6-7). When `format=csv`, set `Content-Type: text/csv` and `Content-Disposition: attachment; filename={report-name}.csv`. Default format is JSON.
- **Files to modify**:
  - Attendance, grades, enrollment controllers (add response header logic)
- **Validation**: `?format=csv` returns downloadable CSV; default returns JSON.

#### SP6-12: API Gateway routes for classrooms and reports in `tenant-api-prod.json`
- **Files to modify**: `server/lib/tenant-api-prod.json`
- **Validation**: `cdk synth` succeeds.

---

## Sprint 7: Bulk Operations & Data Import

**Goal**: CSV import for students, users, and enrollments with validation, error reporting, and partial success handling.

**Demo**: Admin uploads a CSV of students; system validates all rows, reports row-level errors, and creates valid students. Same for bulk user creation and enrollment.

### Tickets

#### SP7-1: Bulk import base service
- **Description**: Create a `BulkImportService` in `@app/csv-parser`. Generic pipeline: parse CSV → validate each row against a provided Zod schema → collect errors → batch write valid rows to DynamoDB (using `BatchWriteItem`, max 25 per batch) → return result `{ total, succeeded, failed, errors: [{ row, field, message }] }`.
- **Files to create**:
  - `server/application/libs/csv-parser/src/bulk-import.service.ts`
- **Validation**: Unit test with mixed valid/invalid rows returns correct counts.

#### SP7-2: Bulk import unit tests
- **Description**: Tests: all valid, all invalid, mixed, empty CSV, wrong headers, >25 items (batched), DynamoDB write failure (partial success reported).
- **Files**: `bulk-import.service.spec.ts`
- **Validation**: >80% coverage.

#### SP7-3: Bulk student import endpoint
- **Description**: Add `POST /academics/students/import` accepting CSV (multipart/form-data). Map columns to student schema. Validate each row via Zod. Create valid students. Return import result with row-level errors. Duplicate studentNumber detection within CSV and against existing records.
- **Files to create**:
  - `server/application/microservices/academics/src/students/students-import.service.ts`
- **Files to modify**:
  - `server/application/microservices/academics/src/students/students.controller.ts` (add endpoint)
- **Validation**: CSV creates students; invalid rows reported; duplicates detected.

#### SP7-4: Bulk student import unit tests
- **Files**: `students-import.service.spec.ts`
- **Validation**: >80% coverage.

#### SP7-5: Bulk user import endpoint
- **Description**: Add `POST /users/import` to identity service. Accept CSV with email, firstName, lastName, globalRole. Create users in DynamoDB and Cognito. If Cognito creation fails for a row, roll back the DynamoDB entry for that row. Return import result.
- **Files to create**:
  - `server/application/microservices/identity/src/users/users-import.service.ts`
- **Files to modify**:
  - `server/application/microservices/identity/src/users/users.controller.ts`
- **Validation**: CSV creates users in both systems; Cognito failure rolls back DynamoDB for that row.

#### SP7-6: Bulk user import unit tests
- **Files**: `users-import.service.spec.ts`
- **Validation**: >80% coverage.

#### SP7-7: Bulk enrollment import endpoint
- **Description**: Add `POST /academics/enrollments/import`. Accept CSV with studentNumber (resolved to studentId), schoolId, academicYearId, gradeLevel. Validate students, school, academic year exist.
- **Files to create**:
  - `server/application/microservices/academics/src/enrollment/enrollment-import.service.ts`
- **Files to modify**:
  - `server/application/microservices/academics/src/enrollment/enrollment.controller.ts`
- **Validation**: CSV creates enrollments; validation errors per row.

#### SP7-8: Bulk enrollment import unit tests
- **Files**: `enrollment-import.service.spec.ts`
- **Validation**: >80% coverage.

---

## Sprint 8: Admin Dashboard & Frontend

**Goal**: Build out the admin dashboard with school, user, and student management views. Connect the React frontend to APIs.

**Demo**: Admin logs in, sees dashboard with stats, manages schools, creates/edits users, views student lists and profiles — all from the browser.

### Tickets

#### SP8-1: Typed API client service layer
- **Description**: Create a typed API client in the React app wrapping Axios. Include JWT token from Amplify auth, X-Tenant-Id header injection, error interceptor (401 → redirect to login, 403 → show forbidden, 5xx → toast). Organize by domain.
- **Files to create**:
  - `client/AdminWeb/src/services/api-client.ts` (base Axios instance + interceptors)
  - `client/AdminWeb/src/services/identity-api.ts` (identity endpoints)
  - `client/AdminWeb/src/services/academics-api.ts` (academics endpoints)
- **Validation**: API calls from browser attach JWT; 401 redirects to login.

#### SP8-2: Dashboard page with statistics
- **Description**: Dashboard showing: total schools, total users, total students, active enrollments, today's attendance rate. Use MUI Cards. Fetch from respective API list endpoints (with count-only or limit=1 for efficiency).
- **Files to create/modify**:
  - `client/AdminWeb/src/pages/Dashboard/Dashboard.tsx`
  - `client/AdminWeb/src/pages/Dashboard/StatCard.tsx`
- **Validation**: Dashboard loads with data from API.

#### SP8-3: School management page
- **Description**: School list (MUI DataGrid) + detail/edit page + create dialog. Form validation via Zod schemas from `@edforge/shared-types`.
- **Files to create**:
  - `client/AdminWeb/src/pages/Schools/SchoolList.tsx`
  - `client/AdminWeb/src/pages/Schools/SchoolDetail.tsx`
  - `client/AdminWeb/src/pages/Schools/SchoolForm.tsx`
- **Validation**: CRUD operations work from UI.

#### SP8-4: User management page
- **Description**: User list with role badges, detail page with profile + preferences + role assignments. Create user form. Role assignment dialog (select school + role).
- **Files to create**:
  - `client/AdminWeb/src/pages/Users/UserList.tsx`
  - `client/AdminWeb/src/pages/Users/UserDetail.tsx`
  - `client/AdminWeb/src/pages/Users/UserForm.tsx`
  - `client/AdminWeb/src/pages/Users/RoleAssignment.tsx`
- **Validation**: User CRUD and role assignment work from UI.

#### SP8-5: Student list and profile page
- **Description**: Student list filtered by school (DataGrid). Student profile with tabs: Demographics, Guardians, Medical, Enrollments, Attendance, Grades.
- **Files to create**:
  - `client/AdminWeb/src/pages/Students/StudentList.tsx`
  - `client/AdminWeb/src/pages/Students/StudentProfile.tsx`
  - `client/AdminWeb/src/pages/Students/StudentForm.tsx`
- **Validation**: Student list loads; profile tabs show data.

#### SP8-6: Navigation, routing, and layout
- **Description**: Set up React Router routes for all pages. Sidebar navigation (MUI Drawer) with icons. Routes: `/dashboard`, `/schools`, `/schools/:id`, `/users`, `/users/:id`, `/students`, `/students/:id`. Breadcrumbs. Auth-protected routes.
- **Files to modify**:
  - `client/AdminWeb/src/App.tsx`
  - `client/AdminWeb/src/components/Layout/`
- **Validation**: All routes navigable; sidebar highlights active; unauthenticated redirected.

#### SP8-7: Error handling and loading states
- **Description**: Global error boundary, toast notifications (MUI Snackbar), skeleton loading states. Reusable `LoadingState`, `ErrorState`, `EmptyState` components.
- **Files to create**:
  - `client/AdminWeb/src/components/common/LoadingState.tsx`
  - `client/AdminWeb/src/components/common/ErrorState.tsx`
  - `client/AdminWeb/src/components/common/EmptyState.tsx`
  - `client/AdminWeb/src/components/common/ErrorBoundary.tsx`
- **Validation**: Loading skeletons during fetch; error toast on failure; error boundary catches render errors.

#### SP8-8: Frontend build and S3 deployment
- **Description**: Update `scripts/build-application.sh` to include React app build (`npm run build` in `client/AdminWeb`). Upload assets to S3 bucket (from SharedInfraStack). Verify CloudFront distribution serves the app with proper cache-control headers.
- **Files to modify**:
  - `scripts/build-application.sh`
  - `server/lib/shared-infra/static-site-distro.ts` (verify)
- **Validation**: React app builds and deploys to S3; accessible via CloudFront URL.

---

## Sprint 9: Audit Logging & Advanced Identity

**Goal**: Add audit logging for FERPA compliance, implement permission overrides, and prepare SSO/SAML foundation.

**Demo**: All sensitive operations create audit log entries queryable by admin. Permission overrides grant/deny fine-grained access. Cognito SAML provider configured for federated login.

### Tickets

#### SP9-1: Audit log service
- **Description**: Create `AuditLogService` and `AuditModule` in shared libs. Records sensitive operations: user CRUD, role changes, login/logout, student record access, grade modifications, enrollment changes. Store in DynamoDB with `PK=TENANT#{tenantId}`, `SK=AUDIT#{timestamp}#{eventId}`. Fields: actor (userId), action (string), targetEntity (type + id), beforeValues (JSON), afterValues (JSON), ipAddress, userAgent, timestamp. Include an `@Audited(action)` method decorator for auto-logging. TTL set to 2 years (FERPA).
- **Files to create**:
  - `server/application/libs/audit/src/audit.service.ts`
  - `server/application/libs/audit/src/audit.module.ts`
  - `server/application/libs/audit/src/audit.decorator.ts`
  - `server/application/libs/audit/src/audit.entity.ts`
  - `server/application/libs/audit/index.ts`
- **Validation**: Audit entries created via decorator; queryable by actor, action, date range.

#### SP9-2: Audit log unit tests
- **Files**: `audit.service.spec.ts`
- **Validation**: >80% coverage; decorator auto-logging tested.

#### SP9-3: Apply audit logging to sensitive operations
- **Description**: Apply `@Audited` decorator to: user create/update/delete, role assign/remove, login/logout, student create/update/delete, enrollment changes, grade recording/finalization.
- **Files to modify**: All relevant service files in identity and academics.
- **Validation**: Each decorated method creates audit entry; existing tests pass.

#### SP9-4: Permission override service
- **Description**: Allow TenantAdmins to grant or revoke specific permissions for a user beyond their role defaults. Store with `PK=TENANT#{tenantId}`, `SK=PERM_OVERRIDE#{userId}#{permission}`, with `action: 'grant' | 'deny'`. Auth guards check overrides after role permissions (deny overrides win).
- **Files to create/modify**:
  - `server/application/microservices/identity/src/roles/permission-override.service.ts`
  - `server/application/libs/auth/` (update guards)
- **Validation**: Grant override allows access; deny blocks; removing override restores default.

#### SP9-5: Permission override unit tests
- **Files**: `permission-override.service.spec.ts`
- **Validation**: >80% coverage.

#### SP9-6: Cognito SAML federation CDK configuration
- **Description**: Add CDK constructs to create a SAML identity provider in the Cognito user pool when `CDK_PARAM_USE_FEDERATION=true`. Support metadata URL input. Map SAML attributes to Cognito custom attributes (custom:tenantId, custom:role). Add CDK parameter for SAML metadata URL.
- **Files to modify**:
  - `server/lib/tenant-template/identity-provider.ts`
- **Validation**: `cdk synth` with federation enabled includes SAML provider; Cognito shows IdP.

#### SP9-7: Federated login auto-provisioning in auth service
- **Description**: Update `AuthService` to handle federated (SAML) users. Detect federated identity via JWT `identities` claim. On first login: auto-create DynamoDB user record from SAML attributes. On subsequent login: update last login. Map SAML role attributes to EdForge roles.
- **Files to modify**:
  - `server/application/microservices/identity/src/auth/auth.service.ts`
- **Validation**: Federated user auto-provisioned; subsequent login reuses record.

#### SP9-8: Federated login unit tests
- **Files**: Update `auth.service.spec.ts`
- **Validation**: First-time and returning federated user scenarios tested.

---

## Sprint 10: E2E Testing & Production Readiness

**Goal**: Comprehensive E2E testing, error standardization, input sanitization, and production hardening.

**Demo**: Full E2E test suite passes. Error responses are consistent. Auto-scaling configured. Production deployment checklist complete.

### Tickets

#### SP10-1: E2E test — full tenant lifecycle
- **Description**: Update `tenant-onboarding.e2e.spec.ts` to cover: create tenant → create admin → create school → create academic year → create grading policy → create courses → create sections → enroll students in sections → record attendance → record grades → verify reports.
- **Files to modify**: `server/application/test/e2e/tenant-onboarding.e2e.spec.ts`
- **Validation**: E2E test passes.

#### SP10-2: E2E test — multi-tenant data isolation
- **Description**: Create two tenants; verify Tenant A cannot access Tenant B's data via API or data leakage in list queries.
- **Files to create**: `server/application/test/e2e/tenant-isolation.e2e.spec.ts`
- **Validation**: All cross-tenant access blocked.

#### SP10-3: E2E test — security hardening
- **Description**: Expand `security.e2e.spec.ts`: expired token, tampered token, missing tenant header, NoSQL injection in query params, XSS in text fields, rate limiting, CORS headers.
- **Files to modify**: `server/application/test/e2e/security.e2e.spec.ts`
- **Validation**: All security tests pass.

#### SP10-4: Error response standardization
- **Description**: Ensure all endpoints return consistent error shape: `{ statusCode, error, message, correlationId, details? }`. Register global exception filter in both services. No stack traces in production.
- **Files to modify**:
  - `server/application/libs/exceptions/`
  - Both service `main.ts` files
- **Validation**: Invalid requests return structured JSON; 500s include correlationId, no stack trace.

#### SP10-5: Request validation and sanitization
- **Description**: Verify Zod pipes on all controllers. Add `trim()` and `max(500)` to string fields in schemas. Reject HTML tags in text inputs. Enforce pagination max 100 per page.
- **Files to modify**: shared-types schemas, controllers
- **Validation**: Oversized strings rejected; HTML stripped/rejected; pagination >100 returns 400.

#### SP10-6: ECS auto-scaling configuration
- **Description**: Configure ECS service auto-scaling: scale at 70% CPU, scale in at 30%. Min: 1 (dev), 2 (prod). Max: 4/8/16 by tier. Add CDK parameter `CDK_PARAM_STAGE` to toggle min/max.
- **Files to modify**: `server/lib/tenant-template/services.ts`
- **Validation**: Auto-scaling in CDK synth output.

#### SP10-7: DynamoDB billing mode configuration
- **Description**: Add CDK parameter `CDK_PARAM_DYNAMO_BILLING=ON_DEMAND|PROVISIONED`. On-demand for dev; provisioned with auto-scaling (min 5, max 100 RCU/WCU, 70% target) for production.
- **Files to modify**: `server/lib/tenant-template/ecs-dynamodb.ts`
- **Validation**: Both modes produce valid CDK synth output.

#### SP10-8: Raise Jest coverage to 80%
- **Description**: Update `jest.config.js` thresholds to 80/80/80/80. Fix remaining coverage gaps across all services.
- **Files to modify**: `server/application/jest.config.js`
- **Validation**: `npm run test:coverage` passes at 80%.

#### SP10-9: Production deployment runbook
- **Description**: Create comprehensive runbook: pre-deployment checks, deployment steps, post-deployment verification (health checks, smoke tests), rollback procedure, monitoring alerts.
- **Files to create**: `docs/PRODUCTION_DEPLOYMENT.md`
- **Validation**: A developer unfamiliar with the project can follow it end-to-end.
