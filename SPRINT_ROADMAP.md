# EdForge EMIS — Sprint Roadmap & Task Breakdown (v2)

**Purpose**: Exhaustive, atomic task breakdown for building a robust, scalable, enterprise-grade Education Management Information System (EMIS) aligned with Ed-Fi Data Standard v6.

**Architecture**: NestJS microservices (Identity @ 3010, Academics @ 3011), DynamoDB single-table design, Cognito auth, CDK infrastructure, Zod validation, EventBridge events.

**Conventions**:
- Every task is an atomic, committable unit of work
- Every task includes tests or a validation method
- Every sprint produces demoable, runnable software
- Sprints build on each other incrementally

**Review Notes**: This plan has been reviewed by a senior architect. Key improvements from review:
- Sprint 3 scoped down (Staff CRUD already exists in Identity service)
- Enrollment integrity tasks merged for atomic TransactWriteItems
- Audit/Compliance sprint moved earlier (before Reporting, per FERPA)
- Production readiness items (logging, health checks, graceful shutdown) moved into Sprint 4
- Sprint 6 (Scheduling) decoupled from Sprint 5 (Rooms)
- Added: attendance event publishing, co-teacher validation, caching, GSI rationalization, Ed-Fi descriptor alignment
- Enhanced promotion rules with subject-specific requirements and IEP accommodations

---

## Completed Work Summary

### Sprint 1 (COMPLETE): Course Catalog & Sections
- Course entity, service, controller, mapper, schema (CRUD + soft delete)
- Section entity, service, controller, mapper, schema (CRUD + soft delete)
- Section enrollment (student-section association) with roster management
- IdentityClientService staff validation methods
- API Gateway routes for courses, sections, section enrollment
- EventBridge events for course/section/enrollment mutations
- Smoke tests for SP1 flow
- Unit tests for courses, sections, section enrollment

### Sprint 2 (COMPLETE): Grades, Grading Policies & GPA
- Grade entity with embedded assignments and category grades
- Grading policy entity (scale, category weights, rounding rules)
- Grade recording service with policy-based calculation
- Bulk grade recording
- Grade finalization (lock)
- GPA calculator (weighted: AP/Honors on 5.0 scale)
- Grading policy CRUD
- Grade data model documentation
- Unit tests for grades, grading policy, GPA calculator

---

## Sprint 3: Staff Integration & API Contract Alignment

**Goal**: The Identity service already has a complete Staff module (entity, service, controller, API Gateway routes). The P0 gap — `GET /schools/{schoolId}/staff` returning empty — is caused by missing seed data, potential GSI key pattern mismatch, or incorrect IdentityClientService integration. This sprint diagnoses the root cause, fixes it, adds teacher name denormalization to sections, and aligns all API contracts with the frontend expectations.

**Demo**: List staff by school returns real data, search staff by name works for teacher autocomplete, create a section with a real teacher from the staff list and see the teacher's name denormalized on the section response.

### SP3-1: Diagnose staff endpoint — root cause analysis
**Description**: The Identity service has a fully implemented Staff module at `identity/src/staff/` with controller, service, entity, and API Gateway routes already defined. Investigate why `GET /schools/{schoolId}/staff` returns empty.

**Files**:
- `server/application/microservices/identity/src/staff/staff.controller.ts`
- `server/application/microservices/identity/src/staff/staff.service.ts`
- `server/application/microservices/identity/src/common/entities/staff.entity.ts`
- `server/lib/tenant-template/ecs-dynamodb.ts`

**Acceptance Criteria**:
- Verify GSI1 key pattern for Staff entity includes tenant prefix (`TENANT#{tid}#SCHOOL#{sid}`) — if not, fix to match the pattern used by Academics service
- Verify API Gateway route `/schools/{schoolId}/staff` correctly proxies to Identity service (check `tenant-api-prod.json`)
- Verify the StaffController's `listStaffBySchool()` method calls the service correctly with the tenant context
- If seed data is the issue: document that Staff records must be created for existing Users (see SP3-2)
- Write a minimal integration test: POST a staff member via Identity API, then GET `/schools/{schoolId}/staff` and verify it appears
- Document root cause and fix in a brief ADR (architecture decision record) comment in the code

**Validation**: `GET /schools/{schoolId}/staff` returns at least one staff member after fix. Unit test confirming GSI1 key includes tenant prefix.

---

### SP3-2: User-to-Staff bridge mechanism
**Description**: Create a mechanism to link User accounts to Staff records. When an admin assigns a User to a school with an education role, a corresponding Staff record should be created (or linked) in the Identity service.

**Files**:
- `server/application/microservices/identity/src/staff/staff.service.ts`
- `server/application/microservices/identity/src/users/users.service.ts`

**Acceptance Criteria**:
- `assignUserAsStaff(userId, schoolId, role)` — creates a Staff record linked to the User
  - Copies `firstName`, `lastSurname`, `email` from User record
  - Sets `linkedUserId` field on Staff entity to enable cross-reference
  - Sets `schoolAssignments[0] = { schoolId, role, isPrimary: true }`
  - Publishes `staff.created` event
- If Staff record already exists for this userId, update the school assignment (don't duplicate)
- Admin UI workflow: when inviting a user and selecting "Teacher" role → auto-creates Staff
- Batch operation: `syncExistingUsersToStaff(schoolId)` — creates Staff records for all Users assigned to a school who lack Staff records

**Validation**: Unit test: create User → assignUserAsStaff → GET /schools/{schoolId}/staff returns the new staff member. Batch sync test: 3 users without staff records → syncExistingUsersToStaff → 3 staff records created.

---

### SP3-3: IdentityClientService — staff resolution methods in Academics
**Description**: Update the Academics service's `IdentityClientService` to call the real staff endpoints for fetching staff details (name, role) needed for section denormalization.

**Files**:
- `server/application/microservices/academics/src/common/services/identity-client.service.ts`

**Acceptance Criteria**:
- `getStaffMember(ctx, staffId)` — fetches full StaffResponseDto from Identity service via `GET /staff/{staffId}`
- `getSchoolStaff(ctx, schoolId)` — fetches paginated staff list via `GET /schools/{schoolId}/staff`
- `searchStaff(ctx, searchTerm)` — proxies to `GET /staff/search/{term}`
- `validateStaffExists(ctx, staffId)` — returns boolean, reuses `getStaffMember` internally
- Error handling: logs warning and throws `NotFoundException` if Identity service returns 404
- Timeout: 5s with 1 retry
- Short-TTL cache: cache staff member lookups for 60s in-memory (LRU, max 100 entries) to avoid redundant HTTP calls during section creation

**Validation**: Unit test with HTTP mocks. Test cache hit: two getStaffMember calls within 60s → only one HTTP call.

---

### SP3-4: Section creation — denormalize teacher name and verify course info
**Description**: When creating or updating a Section, resolve `primaryTeacherId` to a real staff name and store `primaryTeacherName`. Also verify the mapper exposes all four denormalized fields (`courseName`, `courseCode`, `primaryTeacherName`, `roomNumber`).

**Files**:
- `server/application/microservices/academics/src/sections/sections.service.ts`
- `server/application/microservices/academics/src/common/mappers/section.mapper.ts`

**Acceptance Criteria**:
- `createSection()` calls `identityClient.getStaffMember()` to resolve teacher name
- `primaryTeacherName` stored as `"{firstName} {lastSurname}"` on the section entity
- `updateSection()` re-resolves teacher name if `primaryTeacherId` changes
- If teacher lookup fails, section creation fails with descriptive error (not a silent null)
- `sectionEntityToDto()` includes `courseName`, `courseCode`, `primaryTeacherName`, `roomNumber` in response
- All four denormalized fields present in every section response (list, get, create, update)
- If any denormalized field is null/undefined, it's returned as `null` (not omitted)

**Validation**: Unit test: create section → verify `primaryTeacherName` in response. Update section with new teacherId → verify name changes. Verify all four denormalized fields appear in list response.

---

### SP3-5: Course entity — align enum values with Ed-Fi descriptors
**Description**: The Course entity's `courseType` enum has `required | elective | enrichment | remedial` but the frontend document expects `required | elective | honors | ap | ib | dual_enrollment | remedial | vocational`. Align both the entity and the Zod schema.

**Files**:
- `server/application/microservices/academics/src/common/entities/course.entity.ts`
- `packages/shared-types/src/schemas/academics/course.schema.ts`

**Acceptance Criteria**:
- `courseType` enum updated to: `required | elective | honors | ap | ib | dual_enrollment | remedial | vocational`
- `creditType` enum updated to match `courseLevelCharacteristicDescriptor`: `academic | elective | honors | ap | ib | dual_enrollment`
- `subjectArea` enum verified against Ed-Fi `academicSubjectDescriptor`
- Existing course records with old enum values remain valid (no breaking migration needed — DynamoDB is schemaless)
- Zod schema and entity type both updated in sync

**Validation**: `npm run build:shared-types` succeeds. Create a course with `courseType: 'ap'` → success. Create with invalid type → 400.

---

### SP3-6: Pagination contract alignment audit
**Description**: Audit ALL list endpoints across both services and ensure they return the consistent pagination format. Known issue: `StaffController.searchStaff()` returns a raw array instead of pagination envelope.

**Files**:
- All controller files in both Identity and Academics services

**Acceptance Criteria**:
- Every `list*` / `get*BySchool` / `search*` endpoint returns `{ items: T[], hasMore: boolean, lastEvaluatedKey?: string, total?: number }`
- Fix `StaffController.searchStaff()` to wrap results in pagination envelope
- `total` included where computationally cheap (not required for GSI scans)
- `lastEvaluatedKey` included when results are paginated
- No endpoint returns a raw array `[]` — always wrapped in pagination envelope
- Consistent naming: `items` (not `data`, `results`, `records`)

**Validation**: Grep all controllers for list/search endpoints; verify response shapes. Add assertions to smoke tests.

---

### SP3-7: Smoke test — Staff integration end-to-end
**Description**: Write a smoke test exercising the full staff-section flow.

**Files**:
- `scripts/smoke-tests/academics-sp3-staff-flow.ts`

**Acceptance Criteria**:
- Test creates a staff member via Identity service `POST /staff`
- Test lists staff for the school via `GET /schools/{schoolId}/staff` and finds the new member
- Test searches staff by partial name via `GET /staff/search/{term}` and finds match
- Test creates a section with the staff member as `primaryTeacherId`
- Test verifies section response has correct `primaryTeacherName`
- Test verifies `currentEnrollment: 0` on new section
- Test verifies pagination format on all list responses
- Test cleans up created resources

**Validation**: `npm run smoke:academics-sp3` passes.

---

## Sprint 4: Data Integrity, Observability & Hardening

**Goal**: Harden the system for production use. Enforce all business rules with DynamoDB transactions, fix error handling, add missing validation (co-teachers, student existence, academic year), establish structured logging, health checks, and graceful shutdown. These observability items are moved here from Sprint 12 because they are prerequisites for safe integration testing and debugging.

**Demo**: Attempt to over-enroll a full section (rejected), attempt to enroll a student in the same section twice (rejected), update a course name and see it reflected in all sections, see structured error responses for all failure modes, view service health status.

### SP4-1: DynamoDB TransactWriteItems support
**Description**: Add transaction capability to the DynamoDBClientService. Required for atomic enrollment operations (write enrollment + increment counter + capacity check in one transaction).

**Files**:
- `server/application/microservices/academics/src/common/services/dynamodb-client.service.ts`

**Acceptance Criteria**:
- `transactWrite(items: TransactWriteItem[])` — wraps DynamoDB `TransactWriteItems` API
- Each item can be: Put (with condition), Update (with condition), Delete (with condition), ConditionCheck
- Returns success or throws specific error (TransactionCanceledException with cancellation reasons)
- Handles `TransactionConflictException` with automatic retry (1 retry, exponential backoff)
- Max 100 items per transaction (DynamoDB limit)

**Validation**: Unit test: transact-write 2 items successfully. Transact-write with failing condition → TransactionCanceledException. Verify cancellation reason is surfaced.

---

### SP4-2: Section enrollment integrity — capacity, duplicates, atomic counters
**Description**: Combine capacity enforcement, duplicate prevention, and atomic counter management into a single transactional enrollment operation using TransactWriteItems. This replaces the current read-then-write pattern which has race conditions.

**Files**:
- `server/application/microservices/academics/src/sections/section-enrollment.service.ts`
- `server/application/microservices/academics/src/sections/sections.service.ts`

**Acceptance Criteria**:
- `enrollStudent()` uses `TransactWriteItems` with two operations:
  1. `Put` SectionEnrollment with condition `attribute_not_exists(pk)` (prevents duplicates)
  2. `Update` Section with `SET currentEnrollment = currentEnrollment + :one` and condition `currentEnrollment < :max`
- If transaction fails due to condition 1: `ConflictException("Student is already enrolled in this section")`
- If transaction fails due to condition 2: `ConflictException("Section is full (${current}/${max})")`
- `dropStudent()` uses `TransactWriteItems`:
  1. `Update` SectionEnrollment with `SET isActive = :false, droppedAt = :now`
  2. `Update` Section with `SET currentEnrollment = currentEnrollment - :one` and condition `currentEnrollment > :zero`
- Allow re-enrollment after drop: new enrollment record with new timestamp (old record stays as history)
- Add admin reconciliation endpoint `POST /academics/sections/:id/recount` that recalculates `currentEnrollment` from actual active enrollments

**Validation**: Unit tests:
- Enroll 2 students → count=2. Attempt 3rd when max=2 → ConflictException.
- Enroll same student twice → ConflictException.
- Drop student → count decrements. Re-enroll → new enrollment created.
- Corrupt count manually → recount → corrected.
- Concurrent enrollment test: simulate 2 simultaneous enrollments when 1 slot remains → exactly 1 succeeds.

---

### SP4-3: Student and annual enrollment validation before section enrollment
**Description**: Before enrolling a student in a section, validate that the student exists AND has an active annual enrollment at the school for the relevant academic year. This is an Ed-Fi compliance requirement.

**Files**:
- `server/application/microservices/academics/src/sections/section-enrollment.service.ts`

**Acceptance Criteria**:
- Before enrollment transaction, verify:
  1. Student exists (query by studentId)
  2. Student has active annual enrollment at the section's school for the section's academic year
- If student doesn't exist: `NotFoundException("Student not found")`
- If no active annual enrollment: `BadRequestException("Student is not enrolled at this school for the current academic year")`
- Validation is done before the transaction (not inside it) to give specific error messages

**Validation**: Unit test: student without annual enrollment → BadRequestException. Student with annual enrollment → proceeds to section enrollment.

---

### SP4-4: Co-teacher validation in section creation
**Description**: `createSection()` validates `primaryTeacherId` but not `coTeacherIds[]`. Add validation for co-teachers.

**Files**:
- `server/application/microservices/academics/src/sections/sections.service.ts`

**Acceptance Criteria**:
- If `coTeacherIds[]` is provided, validate each ID against Identity service
- Reject if any co-teacher ID is invalid with `BadRequestException("Co-teacher not found: {staffId}")`
- Reject if `coTeacherIds` contains more than 5 entries (Ed-Fi max)
- Reject if `primaryTeacherId` appears in `coTeacherIds` (can't be both primary and co-teacher)
- Denormalize co-teacher names (store `coTeacherNames[]` array on section)

**Validation**: Unit test: create section with invalid co-teacher → 400. Create with >5 co-teachers → 400. Create with primary in co-teacher list → 400.

---

### SP4-5: Academic year and term validation in section creation
**Description**: `createSection()` accepts `academicYearId` and `termId` but never validates them. A section could reference a non-existent or archived academic year.

**Files**:
- `server/application/microservices/academics/src/sections/sections.service.ts`
- `server/application/microservices/academics/src/common/services/identity-client.service.ts`

**Acceptance Criteria**:
- `createSection()` validates `academicYearId` against Identity service (`GET /schools/{schoolId}/academic-years/{yearId}`)
- Reject if academic year doesn't exist or is archived
- If `termId` provided, validate it belongs to the academic year
- Add `validateAcademicYear(ctx, schoolId, yearId)` and `validateTerm(ctx, schoolId, yearId, termId)` to IdentityClientService
- Cache academic year/term validation for 5 minutes (they rarely change)

**Validation**: Unit test: create section with non-existent academicYearId → 404. Create with archived year → 400. Create with termId from wrong year → 400.

---

### SP4-6: Attendance service — EventBridge event publishing
**Description**: The AttendanceService publishes zero events. All other services publish events consistently. Add event publishing to attendance operations.

**Files**:
- `server/application/microservices/academics/src/attendance/attendance.service.ts`
- `server/application/microservices/academics/src/common/services/academics-events.service.ts`

**Acceptance Criteria**:
- `recordAttendance()` publishes `attendance.recorded` event with: studentId, date, status, schoolId
- `recordBulkAttendance()` publishes `attendance.bulk_recorded` event with: count, schoolId, date
- `updateAttendance()` publishes `attendance.updated` event with: studentId, date, oldStatus, newStatus
- Events published via `AcademicsEventsService` (same pattern as other services)
- Events are non-blocking (fire-and-forget)

**Validation**: Unit test with EventBridge mock: record attendance → verify event published with correct detail-type and payload.

---

### SP4-7: Denormalization consistency — course name propagation
**Description**: When a Course's `courseName` or `courseCode` is updated, propagate the change to all Sections referencing that course.

**Files**:
- `server/application/microservices/academics/src/courses/courses.service.ts`
- `server/application/microservices/academics/src/sections/sections.service.ts`

**Acceptance Criteria**:
- `updateCourse()` checks if `courseName` or `courseCode` changed
- If changed, queries all sections for that courseId (GSI query) and batch-updates their denormalized fields
- Uses `BatchWriteItem` (max 25 items per batch, paginate if more)
- Logs warning if propagation partially fails (does not roll back course update)
- Publishes `course.updated` event with `fieldsChanged` metadata

**Validation**: Unit test: create course + 3 sections → update course name → verify all 3 sections have new name.

---

### SP4-8: Denormalization consistency — teacher name propagation via events
**Description**: When a staff member's name changes in Identity service, sections referencing that teacher should update. Use event-driven propagation instead of on-read refresh (which would cause N HTTP calls on list requests).

**Files**:
- `server/application/microservices/academics/src/sections/sections.service.ts`
- `server/application/microservices/academics/src/common/services/academics-events.service.ts`

**Acceptance Criteria**:
- Academics service subscribes to `staff.updated` events from EventBridge
- When event includes name change (`fieldsChanged` contains `firstName` or `lastSurname`):
  - Query all sections where `primaryTeacherId` matches the staffId
  - Update `primaryTeacherName` on each section
  - Also update `coTeacherNames[]` where `coTeacherIds[]` contains the staffId
- Event handler is idempotent (safe to process same event twice)
- If Identity service doesn't yet publish `staff.updated` events, add the event publishing there
- Fallback: `updateSection()` always re-resolves teacher name when `primaryTeacherId` is in the update payload

**Validation**: Unit test: mock `staff.updated` event → verify section teacherName updated. Verify idempotency: process same event twice → no duplicate updates.

---

### SP4-9: Error handling standardization
**Description**: Standardize all error responses across Academics service. Fix known generic Error throws.

**Files**:
- All controller and service files in Academics service
- `server/application/microservices/academics/src/grades/grades.controller.ts` (line ~109)

**Acceptance Criteria**:
- Fix `grades.controller.ts:109` — replace `throw new Error(...)` with `throw new BadRequestException(...)`
- All errors use NestJS HttpException subclasses (no generic `Error`)
- Consistent error shape: `{ statusCode, message, error }`
- Error messages include entity type + ID when relevant (e.g., `"Student 'abc-123' not found"`)
- Grep all service files for `throw new Error` — must find zero occurrences

**Validation**: Grep verification. Run smoke tests and verify all error responses have consistent shape.

---

### SP4-10: Input validation — Zod pipe enforcement audit
**Description**: Audit all controller endpoints and ensure every request body, query param, and path param is validated through Zod schemas. Include co-teacher array validation.

**Files**:
- All controllers in Academics service
- Corresponding Zod schemas in `packages/shared-types/`

**Acceptance Criteria**:
- Every `@Body()` parameter uses `ZodValidationPipe` or equivalent
- Every UUID path param validated as UUID format
- Every query param with known enum validated against the enum
- Every date param validated as ISO date string
- Every numeric param has min/max bounds (maxEnrollment: 1-500, credits: 0-20)
- `coTeacherIds` validated as array of UUIDs with max length 5
- Missing schemas created in shared-types

**Validation**: Send malformed requests to each endpoint (bad UUID, invalid enum, negative number) — all return 400.

---

### SP4-11: Soft delete cascade rules
**Description**: Enforce cascade behavior when entities are soft-deleted.

**Files**:
- `server/application/microservices/academics/src/courses/courses.service.ts`
- `server/application/microservices/academics/src/sections/sections.service.ts`
- `server/application/microservices/academics/src/sections/section-enrollment.service.ts`

**Acceptance Criteria**:
- `deleteCourse()` → sets `isActive=false` on course + all its sections + all section enrollments
- `deleteSection()` → sets `isActive=false` on section + all its section enrollments
- Cascade is logged (number of affected child records)
- Cascade publishes events for each affected child: `section.deactivated`, `section-enrollment.deactivated`
- `listSections()` with `isActive=true` filter excludes deactivated sections
- `getSectionRoster()` excludes deactivated enrollments
- Decrement `currentEnrollment` to 0 on deactivated sections

**Validation**: Unit test: create course → 2 sections → 3 enrollments each. Delete course → verify all cascaded to isActive=false. List active sections returns 0.

---

### SP4-12: Structured logging
**Description**: Establish consistent structured logging across both services. Moved from Sprint 12 — needed for debugging during hardening.

**Files**:
- All service files in both microservices

**Acceptance Criteria**:
- Every service method logs: method entry (DEBUG), success (INFO), error (ERROR)
- Log format: `{ timestamp, level, service, method, tenantId, userId, entityId, duration_ms, error? }`
- No PII in logs (no student names, emails, medical info — only IDs)
- Request correlation ID (`X-Request-ID` header) propagated through all logs
- Use existing `@app/logger` consistently

**Validation**: Trigger operations, verify log output matches format. Grep logs for PII patterns.

---

### SP4-13: Health check enhancement
**Description**: Upgrade health endpoints for production ALB health checks. Moved from Sprint 12.

**Files**:
- Both services' health modules

**Acceptance Criteria**:
- `/health` returns: `{ status, uptime, version, dependencies: { dynamodb: ok|degraded, identity_service: ok|degraded, eventbridge: ok|degraded } }`
- Dependency checks run with 2s timeout
- Health endpoint is unauthenticated (for ALB health checks)
- Returns 503 if any critical dependency is down

**Validation**: Mock DynamoDB failure → verify health returns 503 with degraded status.

---

### SP4-14: Graceful shutdown
**Description**: Ensure clean shutdown on SIGTERM/SIGINT. Moved from Sprint 12 — data corruption risk without it.

**Files**:
- `server/application/microservices/academics/src/main.ts`
- `server/application/microservices/identity/src/main.ts`

**Acceptance Criteria**:
- On SIGTERM: stop accepting new requests, finish in-flight requests (30s timeout), flush logs, exit 0
- On SIGINT: same behavior
- ECS task definition uses `stopTimeout: 30`
- Pending DynamoDB writes completed before shutdown

**Validation**: Send SIGTERM during active request → verify request completes and process exits cleanly.

---

### SP4-15: Smoke test — data integrity scenarios
**Description**: Write smoke tests covering all hardening scenarios.

**Files**:
- `scripts/smoke-tests/academics-sp4-integrity.ts`

**Acceptance Criteria**:
- Test over-enrollment rejection (section at capacity)
- Test duplicate enrollment rejection (same student same section)
- Test cascade soft-delete (course → sections → enrollments)
- Test currentEnrollment accuracy after multiple enroll/drop operations
- Test error response shapes (404, 409, 400)
- Test invalid input rejection (bad UUID, missing required fields)
- Test student without annual enrollment → section enrollment rejected
- Test co-teacher validation (invalid ID, >5 co-teachers)

**Validation**: `npm run smoke:academics-sp4` passes.

---

## Sprint 5: Classroom & Room Management

**Goal**: Implement the Room/Classroom entity as a first-class CRUD resource. The entity definition exists but has no controller or service. After this sprint, admins can manage rooms, assign them to sections, and track room utilization.

**Demo**: Create rooms with capacity/features, assign a room to a section, list rooms by building, see room number on section responses.

### SP5-1: Room schema in shared-types
**Description**: Create Zod schemas for Room CRUD DTOs.

**Files**:
- `packages/shared-types/src/schemas/academics/classroom.schema.ts` (update existing)

**Acceptance Criteria**:
- `CreateRoomDto`: roomNumber (required), roomName, building, floor, wing, capacity (positive int, max 500), roomType (enum), features (array), isAccessible
- `UpdateRoomDto`: partial, roomId immutable
- `RoomResponseDto`: all fields + audit timestamps
- `RoomListResponseDto`: pagination envelope `{ items, hasMore }`

**Validation**: Build shared-types; schema tests for valid/invalid inputs.

---

### SP5-2: Room service and mapper
**Description**: Implement Room CRUD service and entity ↔ DTO mapper in Academics.

**Files**:
- `server/application/microservices/academics/src/classrooms/classrooms.service.ts` (new)
- `server/application/microservices/academics/src/common/mappers/classroom.mapper.ts` (new)
- `server/application/microservices/academics/src/common/mappers/index.ts` (re-export)

**Acceptance Criteria**:
- `createRoom()` — validates school, checks roomNumber unique within school+building
- `listRooms()` — by school with filters (building, floor, roomType, isAvailable, capacity min)
- `getRoom()` — by roomId
- `updateRoom()` — merge updates, roomNumber immutable
- `deleteRoom()` — soft delete (isActive=false)
- Publishes `room.created`, `room.updated`, `room.deleted` events
- `classroomEntityToDto()` and `createRoomDtoToEntity()` mappers
- Handles all fields including features[] array and accessibility info

**Validation**: Unit tests for each service method and mapper.

---

### SP5-3: Room controller and module
**Description**: HTTP endpoints for room management.

**Files**:
- `server/application/microservices/academics/src/classrooms/classrooms.controller.ts` (new)
- `server/application/microservices/academics/src/classrooms/classrooms.module.ts` (new)
- `server/application/microservices/academics/src/academics.module.ts` (import new module)

**Acceptance Criteria**:
- `POST /academics/rooms` — create room
- `GET /academics/rooms` — list rooms (query: schoolId, building, floor, roomType)
- `GET /academics/rooms/:id` — get room
- `PATCH /academics/rooms/:id` — update room
- `DELETE /academics/rooms/:id` — soft delete
- All endpoints guarded with JwtAuthGuard
- Pagination format: `{ items, hasMore }`

**Validation**: Controller unit tests; manual curl test.

---

### SP5-4: Room ↔ Section integration
**Description**: When a room is assigned to a section, denormalize `roomNumber`. When a room is deleted, clear the reference.

**Files**:
- `server/application/microservices/academics/src/sections/sections.service.ts`

**Acceptance Criteria**:
- `createSection()` with `roomId` → resolves room and stores `roomNumber` on section
- `updateSection()` with new `roomId` → re-resolves and updates `roomNumber`
- When Room is soft-deleted, find all sections referencing it and clear `roomId`/`roomNumber`
- Optional warning log if room capacity < section maxEnrollment

**Validation**: Create room → create section with roomId → verify roomNumber. Delete room → verify section roomId cleared.

---

### SP5-5: API Gateway routes for rooms
**Files**: `server/lib/tenant-api-prod.json`

**Acceptance Criteria**:
- All room CRUD routes proxied to Academics service
- OPTIONS methods for CORS

**Validation**: `cdk synth` succeeds.

---

### SP5-6: Smoke test — room management flow
**Files**: `scripts/smoke-tests/academics-sp5-rooms.ts`

**Acceptance Criteria**:
- Create room → list rooms → verify present
- Assign room to section → verify roomNumber on section
- Update room capacity → verify updated
- Delete room → verify section roomId cleared

**Validation**: Smoke test passes.

---

## Sprint 6: Scheduling & Bell Schedules

**Goal**: Implement the scheduling system. Does NOT depend on Sprint 5 (rooms are optional in schedules). After this sprint, admins can define bell schedules, assign time slots to sections, detect scheduling conflicts (teacher, room if available, student), and view teacher schedules.

**Demo**: Define a bell schedule, assign time slots to sections, view a teacher's daily schedule, detect a teacher double-booking conflict.

### SP6-1: Bell schedule schema in shared-types
**Files**: `packages/shared-types/src/schemas/identity/bell-schedule.schema.ts` (update existing)

**Acceptance Criteria**:
- `CreateBellScheduleDto`: schoolId, scheduleName, scheduleType (regular|assembly|halfDay|exam), periods[] with periodNumber, periodName, startTime (HH:MM), endTime (HH:MM), isInstructional
- `BellScheduleResponseDto`: all fields + audit
- Time validation: endTime > startTime, no overlapping periods

**Validation**: Schema tests.

---

### SP6-2: Section schedule schema in shared-types
**Files**: `packages/shared-types/src/schemas/academics/schedule.schema.ts` (new)

**Acceptance Criteria**:
- `CreateSectionScheduleDto`: sectionId, slots[] with dayOfWeek (0-6), periodNumber, startTime, endTime, roomId?
- `SectionScheduleResponseDto`: includes resolved section name, teacher name, room number
- `TeacherScheduleResponseDto`: all slots for a teacher grouped by day
- `ConflictDetailDto`: conflicting section name, teacher/room/student, time range, day

**Validation**: Schema tests.

---

### SP6-3: Schedule service with conflict detection
**Description**: Implement scheduling logic with conflict detection for teachers, rooms, and students.

**Files**:
- `server/application/microservices/academics/src/schedules/schedules.service.ts` (new)

**Acceptance Criteria**:
- `assignSchedule(sectionId, slots[])` — creates schedule records
- `getTeacherSchedule(teacherId, academicYearId)` — all slots grouped by day
- `getRoomSchedule(roomId, academicYearId)` — all slots for room (if rooms module available)
- `getSectionSchedule(sectionId)` — schedule for specific section
- `detectConflicts(newSlots, sectionId)` — checks for:
  - **Teacher conflict**: same teacher, overlapping time, same day
  - **Room conflict**: same room, overlapping time, same day (only if roomId provided)
  - **Student conflict**: any student enrolled in this section already has another section at overlapping time
- Multi-day patterns supported (MWF vs TTh): slots specify individual days
- Returns `ConflictException` with `conflicts[]` array detailing each conflict
- Option to force-assign with `force: true` flag (TenantAdmin only) — logs override for audit

**Validation**: Unit tests: no conflict → success. Teacher conflict → detected. Room conflict → detected. Student conflict → detected. Force override → success with log.

---

### SP6-4: Schedule controller and module
**Files**:
- `server/application/microservices/academics/src/schedules/schedules.controller.ts` (new)
- `server/application/microservices/academics/src/schedules/schedules.module.ts` (new)
- `server/application/microservices/academics/src/academics.module.ts` (import)

**Acceptance Criteria**:
- `POST /academics/sections/:id/schedule` — assign schedule
- `GET /academics/sections/:id/schedule` — get section schedule
- `GET /academics/schedules/teacher/:teacherId` — teacher's full schedule
- `GET /academics/schedules/room/:roomId` — room's full schedule (returns empty if rooms module not deployed)
- `DELETE /academics/sections/:id/schedule` — clear schedule

**Validation**: Controller tests.

---

### SP6-5: API Gateway routes for schedules
**Files**: `server/lib/tenant-api-prod.json`

**Validation**: `cdk synth` succeeds.

---

### SP6-6: Smoke test — scheduling flow
**Files**: `scripts/smoke-tests/academics-sp6-schedule.ts`

**Acceptance Criteria**:
- Assign schedule to section → get schedule → verify slots
- Assign overlapping teacher schedule → conflict detected
- Force override → success
- View teacher schedule → grouped by day correctly

**Validation**: Smoke test passes.

---

## Sprint 7: Audit, Compliance & FERPA

**Goal**: FERPA compliance, audit logging, data retention, and security hardening. Moved earlier than originally planned — audit must be in place BEFORE reporting endpoints (Sprint 8) which access PII-heavy data like transcripts.

**Demo**: View audit trail for a student record, see who accessed PII data, verify data retention TTLs are set, see rate limiting in action.

### SP7-1: Audit log entity and service
**Files**:
- `server/application/microservices/academics/src/common/services/audit-log.service.ts` (new)
- `server/application/microservices/academics/src/common/entities/audit-log.entity.ts` (new)

**Acceptance Criteria**:
- `AuditLogEntity`: auditId, entityType, entityId, action (create|update|delete|read_pii|finalize|export), userId, userEmail, timestamp, changes (before/after diff), ipAddress
- Key: `PK=TENANT#{tid}, SK=AUDIT#{timestamp}#{auditId}`
- GSI: entity-scoped query (reuse existing GSI with sparse key pattern to avoid new GSI)
- TTL: 2 years (FERPA) — `ttl` attribute set on creation
- `logMutation(ctx, entityType, entityId, action, changes)` — non-blocking (fire-and-forget via `setImmediate`)
- `queryAuditLog(entityType, entityId, dateRange?)` — paginated

**Validation**: Unit test: log 3 mutations, query by entity → verify all 3 in chronological order.

---

### SP7-2: Audit decorator for controllers
**Files**:
- `server/application/microservices/academics/src/common/decorators/audited.decorator.ts` (new)

**Acceptance Criteria**:
- `@Audited('student', 'create')` on method → logs after successful execution
- Captures request context (userId, IP) automatically
- Captures response entity ID automatically
- Non-blocking: uses `setImmediate`
- Does not slow response time

**Validation**: Apply to one controller method, verify audit log created.

---

### SP7-3: Apply audit logging to all mutation endpoints
**Files**: All controllers in Academics service

**Acceptance Criteria**:
- Every POST (create) endpoint audited
- Every PATCH (update) endpoint audited with before/after diff
- Every DELETE (soft delete) endpoint audited
- Grade finalization audited
- Bulk operations log summary (not individual records)

**Validation**: Run smoke tests → verify audit logs exist for each mutation.

---

### SP7-4: PII access logging
**Files**:
- `server/application/microservices/academics/src/students/students.service.ts`

**Acceptance Criteria**:
- `getStudentProfile()` logs PII access with action `read_pii`
- Log includes which PII fields were accessed (medicalInfo, guardians, demographics)
- Access log is separate from mutation audit (distinguished by action type)

**Validation**: Fetch student profile → verify PII access audit log entry created.

---

### SP7-5: Data retention policy enforcement
**Files**:
- All entity factory functions
- `server/lib/tenant-template/ecs-dynamodb.ts`

**Acceptance Criteria**:
- Audit logs: 2 year TTL
- Soft-deleted records: 7 year retention (FERPA)
- Active records: no TTL
- Attendance records: 5 year TTL after academic year ends
- Session records (Identity): 90 day TTL
- Verify DynamoDB table has TTL enabled on `ttl` attribute

**Validation**: Create entity with TTL → verify `ttl` attribute set correctly in epoch seconds.

---

### SP7-6: Audit log query endpoint
**Files**:
- `server/application/microservices/academics/src/common/controllers/audit.controller.ts` (new)

**Acceptance Criteria**:
- `GET /academics/audit-log` — query: entityType, entityId, action, startDate, endDate, userId
- Paginated response
- Requires TenantAdmin role
- Supports CSV export via `Accept: text/csv` header
- Returns `200 OK` with `X-Idempotent-Replayed: true` header for replayed idempotent requests

**Validation**: Query audit log with various filters.

---

### SP7-7: Security headers and rate limiting
**Files**:
- `server/application/microservices/academics/src/main.ts`
- `server/application/microservices/identity/src/main.ts`

**Acceptance Criteria**:
- Helmet middleware for security headers
- Rate limiting: 100 requests/minute per tenant (configurable)
- Rate limiting: 10 requests/minute for auth endpoints
- 429 response with `Retry-After` header
- CORS origins restricted to known domains in production

**Validation**: Send 101 requests quickly → verify 429 on 101st.

---

## Sprint 8: Assignment Management (First-Class Entity)

**Goal**: Break assignments out of embedded grade documents into first-class entities. After this sprint, teachers can manage assignments independently and record grades against them with automatic calculation.

**Demo**: Teacher creates an assignment for a section, publishes it, records grades for students, grades auto-calculate using assignment metadata as the single source of truth.

### SP8-1: Assignment entity
**Files**:
- `server/application/microservices/academics/src/common/entities/assignment.entity.ts` (new)
- `server/application/microservices/academics/src/common/entities/base.entity.ts` (add ASSIGNMENT to EntityType)
- `server/application/microservices/academics/src/common/entities/index.ts` (re-export)

**Acceptance Criteria**:
- `AssignmentEntity`: assignmentId, sectionId, courseId, schoolId, teacherId, academicYearId, termId
- Fields: assignmentName, assignmentType enum, categoryId, categoryName
- Grading: possiblePoints, weight, isExtraCredit, rubricId?
- Dates: dueDate, assignedDate, closedDate
- Status: isPublished, isActive
- Key: `PK=TENANT#{tid}, SK=ASSIGNMENT#{sectionId}#{assignmentId}`
- GSI: section-scoped query (reuse existing GSI with sparse key)
- Keep Grade entity item size under 200KB even with rubric data (validate max assignment count per grade)

**Validation**: Entity factory test; key pattern test; item size calculation test.

---

### SP8-2: Assignment schema in shared-types
**Files**: `packages/shared-types/src/schemas/academics/assignment.schema.ts` (update existing)

**Acceptance Criteria**:
- `CreateAssignmentDto`, `UpdateAssignmentDto`, `AssignmentResponseDto`, `AssignmentListResponseDto`
- Rubric support: `rubric?: { criteria: { name, description, maxPoints, levels: { label, points }[] }[] }`

**Validation**: Schema tests.

---

### SP8-3: Assignment service and mapper
**Files**:
- `server/application/microservices/academics/src/assignments/assignments.service.ts` (new)
- `server/application/microservices/academics/src/common/mappers/assignment.mapper.ts` (new)

**Acceptance Criteria**:
- `createAssignment()` — validates section exists, teacher matches
- `listAssignments(sectionId, filters?)` — by section with filters
- `getAssignment()` — by ID
- `updateAssignment()` — merge updates
- `deleteAssignment()` — soft delete
- `publishAssignment()` — sets isPublished=true, records assignedDate
- `closeAssignment()` — sets closedDate
- Publishes events
- Mapper handles all fields

**Validation**: Unit tests for each method.

---

### SP8-4: Assignment controller and module
**Files**:
- `server/application/microservices/academics/src/assignments/assignments.controller.ts` (new)
- `server/application/microservices/academics/src/assignments/assignments.module.ts` (new)

**Acceptance Criteria**:
- `POST /academics/sections/:sectionId/assignments` — create
- `GET /academics/sections/:sectionId/assignments` — list
- `GET /academics/assignments/:id` — get
- `PATCH /academics/assignments/:id` — update
- `DELETE /academics/assignments/:id` — soft delete
- `PATCH /academics/assignments/:id/publish` — publish
- `PATCH /academics/assignments/:id/close` — close

**Validation**: Controller tests.

---

### SP8-5: Grade recording — link to Assignment entity (new path)
**Description**: Add new grade recording path that references standalone Assignment entities, using assignment metadata as the single source of truth for possiblePoints, category, and weight.

**Files**:
- `server/application/microservices/academics/src/grades/grades.service.ts`

**Acceptance Criteria**:
- New method `recordGradeFromAssignment(assignmentId, studentId, earnedPoints)`
- Service fetches assignment to get possiblePoints, categoryId, weight (not from request body)
- Grade calculation uses assignment metadata
- Validates assignment exists and is published
- Rejects grading a closed assignment

**Validation**: Unit test: create assignment (100 pts) → record grade (85) → verify 85%. Grade non-existent assignment → 404. Grade closed assignment → 400.

---

### SP8-6: Grade recording — backward compatibility shim
**Description**: Keep the existing grade recording path working for cases where assignments are not yet standalone entities.

**Files**:
- `server/application/microservices/academics/src/grades/grades.service.ts`

**Acceptance Criteria**:
- Existing `recordAssignmentGrade()` still accepts inline possiblePoints/categoryId/weight
- If `assignmentId` is provided, route to new path (SP8-5)
- If `assignmentId` is NOT provided, use legacy inline fields
- Log deprecation warning when legacy path is used
- Both paths produce identical Grade entity structure

**Validation**: Unit test: record grade with legacy fields → success with deprecation log. Record with assignmentId → success via new path.

---

### SP8-7: API Gateway routes for assignments
**Files**: `server/lib/tenant-api-prod.json`

**Validation**: `cdk synth` succeeds.

---

### SP8-8: Smoke test — assignment + grading flow
**Files**: `scripts/smoke-tests/academics-sp8-assignments.ts`

**Acceptance Criteria**:
- Create assignment → publish → record grades → verify calculation
- Close assignment → attempt grade → rejected
- Legacy grade recording still works
- Verify Grade entity item size with many assignments

**Validation**: Smoke test passes.

---

## Sprint 9: Reporting & Academic Records

**Goal**: Generate transcripts, report cards, and enrollment reports. Read-only aggregation endpoints. Audit logging (Sprint 7) is already in place to log PII access.

**Demo**: Generate a student transcript, a section grade report for a teacher, a school enrollment summary.

### SP9-1: Transcript service
**Files**:
- `server/application/microservices/academics/src/reports/transcript.service.ts` (new)

**Acceptance Criteria**:
- `generateTranscript(studentId, academicYearId?)` returns:
  - Student info (name, studentNumber, school)
  - Per academic year: courses with grade, credits, GPA
  - Cumulative GPA across all years
  - Total credits earned
- Scoped to single year if `academicYearId` provided
- Caches result for 5 minutes (in-memory LRU)
- Logs PII access via audit service

**Validation**: Unit test: student with grades across 2 terms, 3 courses → verify aggregation.

---

### SP9-2: Report card service
**Files**:
- `server/application/microservices/academics/src/reports/report-card.service.ts` (new)

**Acceptance Criteria**:
- `generateReportCard(studentId, termId)` returns:
  - Student info
  - Per section: courseName, teacher, numericGrade, letterGrade, gpaPoints, teacherComment
  - Term GPA
  - Attendance summary for term period
  - Conduct/effort grades if present
- Logs PII access via audit service

**Validation**: Unit test with mock grades and attendance.

---

### SP9-3: Section grade report service
**Files**:
- `server/application/microservices/academics/src/reports/section-report.service.ts` (new)

**Acceptance Criteria**:
- `generateSectionReport(sectionId, termId)` returns:
  - Section info (course, teacher, enrollment count)
  - Per student: name, numericGrade, letterGrade, assignment breakdown
  - Class statistics: mean, median, min, max, standard deviation
  - Grade distribution (A/B/C/D/F counts)

**Validation**: Unit test with 5 students, varying grades, verify statistics.

---

### SP9-4: Enrollment report service
**Files**:
- `server/application/microservices/academics/src/reports/enrollment-report.service.ts` (new)

**Acceptance Criteria**:
- `generateEnrollmentReport(schoolId, academicYearId)` returns:
  - Total enrolled students
  - Breakdown by grade level, status, enrollment type
  - Gender distribution
  - Month-over-month trend

**Validation**: Unit test with varied enrollment data.

---

### SP9-5: Reports controller and module
**Files**:
- `server/application/microservices/academics/src/reports/reports.controller.ts` (new)
- `server/application/microservices/academics/src/reports/reports.module.ts` (new)

**Acceptance Criteria**:
- `GET /academics/reports/transcript/:studentId` — query: academicYearId?
- `GET /academics/reports/report-card/:studentId` — query: termId (required)
- `GET /academics/reports/section/:sectionId` — query: termId (required)
- `GET /academics/reports/enrollment` — query: schoolId, academicYearId
- All return JSON (PDF generation deferred)
- Require TenantAdmin or relevant teacher role
- All PII access audited

**Validation**: Controller tests.

---

### SP9-6: API Gateway routes and smoke test
**Files**:
- `server/lib/tenant-api-prod.json`
- `scripts/smoke-tests/academics-sp9-reports.ts`

**Validation**: `cdk synth` succeeds. Smoke test passes.

---

## Sprint 10: End-of-Term & End-of-Year Processing

**Goal**: Batch operations for closing academic periods. After this sprint, admins can close a term (finalize all grades), close a year (archive enrollments), and promote students with configurable rules.

**Demo**: Close a term — all unfinalised grades get finalized. Close a year — students promoted with subject-specific requirements.

### SP10-1: Term close service
**Files**:
- `server/application/microservices/academics/src/term-processing/term-close.service.ts` (new)

**Acceptance Criteria**:
- `closeTerm(schoolId, termId)`:
  - Queries all Grade entities for the term
  - For each unfinalised grade: sets `isFinal=true`, `publishedAt=now`
  - Returns summary: `{ totalGrades, finalized, alreadyFinal, errors }`
  - Publishes `term.closed` event
- Handles large batches with pagination (25 items per batch write)
- Idempotent: safe to run multiple times

**Validation**: Unit test: 30 grades → close term → verify all finalized.

---

### SP10-2: Year close service
**Files**:
- `server/application/microservices/academics/src/term-processing/year-close.service.ts` (new)

**Acceptance Criteria**:
- `closeYear(schoolId, academicYearId)`:
  - Verifies all terms in the year are closed
  - Updates all active enrollments to status `completed`
  - Updates academic year status to `archived`
  - Returns summary
- Does NOT auto-promote
- Publishes `year.closed` event

**Validation**: Unit test with multi-term year.

---

### SP10-3: Student promotion service
**Files**:
- `server/application/microservices/academics/src/term-processing/promotion.service.ts` (new)

**Acceptance Criteria**:
- `promoteStudents(schoolId, fromYearId, toYearId, promotionRules)`:
  - **Promotion rules support**:
    - Minimum cumulative GPA threshold (configurable, e.g., 1.0)
    - Minimum attendance rate threshold (configurable, e.g., 80%)
    - Subject-specific passing: must pass required subjects (e.g., Math AND English)
    - Credit accumulation thresholds by grade level
  - **Special cases**:
    - IEP/504 accommodations: students with active IEP may have modified promotion criteria
    - Admin override: `overrides: [{ studentId, action: 'promote' | 'retain' }]` to manually override rules
  - Grade level progression: K → 1 → 2 → ... → 12 → graduated
  - Grade 12 with passing grades → status `graduated`
  - Returns: `{ promoted, retained, graduated, overridden, details[] }`
- Publishes `students.promoted` event
- Idempotent: running twice produces same result

**Validation**: Unit test: 5 students with varied GPAs/attendance → verify promotion/retention/graduation. Test IEP accommodation override. Test admin manual override.

---

### SP10-4: Term processing controller and module
**Files**:
- `server/application/microservices/academics/src/term-processing/term-processing.controller.ts` (new)
- `server/application/microservices/academics/src/term-processing/term-processing.module.ts` (new)

**Acceptance Criteria**:
- `POST /academics/term-processing/close-term` — body: { schoolId, termId }
- `POST /academics/term-processing/close-year` — body: { schoolId, academicYearId }
- `POST /academics/term-processing/promote` — body: { schoolId, fromYearId, toYearId, promotionRules, overrides? }
- All require TenantAdmin role
- All return processing summary
- All audited

**Validation**: Controller tests.

---

### SP10-5: API Gateway routes and smoke test
**Files**:
- `server/lib/tenant-api-prod.json`
- `scripts/smoke-tests/academics-sp10-term-processing.ts`

**Validation**: `cdk synth` succeeds. Smoke test passes.

---

## Sprint 11: Notification Foundation

**Goal**: Event-driven notification system for attendance alerts, grade postings, and enrollment changes.

**Demo**: Mark student absent → notification event published. Post final grade → notification event published.

### SP11-1: Notification event schemas
**Files**: `packages/shared-types/src/schemas/notifications/` (new directory)

**Acceptance Criteria**:
- `AttendanceNotificationEvent`: studentId, studentName, date, status, parentEmail
- `GradeNotificationEvent`: studentId, courseName, grade, isFinal, termName
- `EnrollmentNotificationEvent`: studentId, action, schoolName
- All events include tenantId, schoolId, timestamp

**Validation**: Schema tests.

---

### SP11-2: Notification publisher service
**Files**:
- `server/application/microservices/academics/src/common/services/notification-publisher.service.ts` (new)

**Acceptance Criteria**:
- Publishes to EventBridge with detail-type `notification.*`
- `publishAttendanceAlert()` — when status is absent/tardy
- `publishGradePosted()` — when grade is finalized
- Non-blocking fire-and-forget
- Configurable: notifications can be disabled per school (feature flag in school configuration)

**Validation**: Unit test with EventBridge mock.

---

### SP11-3: Integrate notification triggers
**Files**:
- `server/application/microservices/academics/src/attendance/attendance.service.ts`
- `server/application/microservices/academics/src/grades/grades.service.ts`
- `server/application/microservices/academics/src/enrollment/enrollment.service.ts`

**Acceptance Criteria**:
- `recordAttendance()` with absent → triggers attendance notification
- `finalizeGrade()` → triggers grade notification
- `withdrawStudent()` → triggers enrollment notification
- Notifications opt-in: only if school has notifications enabled

**Validation**: Unit tests verifying notification publisher called in correct scenarios.

---

### SP11-4: Smoke test — notification events
**Files**: `scripts/smoke-tests/academics-sp11-notifications.ts`

**Validation**: Smoke test verifies events are published to EventBridge.

---

## Sprint 12: Performance, Metrics & Production Readiness

**Goal**: Prepare for production scale. CloudWatch metrics, dashboards, alarms, DynamoDB optimization, load testing, GSI rationalization. Structured logging, health checks, and graceful shutdown were already done in Sprint 4.

**Demo**: View CloudWatch dashboard, run load test with 100 concurrent users, verify alarms trigger on error spike.

### SP12-1: CloudWatch metrics and dashboards
**Files**:
- `server/application/microservices/academics/src/common/services/metrics.service.ts` (new)

**Acceptance Criteria**:
- Custom metrics: `api.latency` (p50/p95/p99), `api.errors`, `dynamodb.consumed_capacity`, `enrollment.count`, `grade.calculation_duration`
- Metrics batched and published every 60 seconds
- CloudWatch dashboard definition (CDK or JSON): API latency, error rate, DynamoDB capacity, per-tenant usage
- Alarms:
  - API error rate > 5% for 5 min → alarm
  - DynamoDB throttled requests > 0 → alarm
  - Identity service health failing → alarm
  - P95 latency > 2s → alarm

**Validation**: Trigger operations, verify metrics in CloudWatch.

---

### SP12-2: DynamoDB query optimization
**Files**: All service files that query DynamoDB

**Acceptance Criteria**:
- All queries use `ProjectionExpression` to fetch only needed fields
- Batch operations use `BatchGetItem` / `BatchWriteItem`
- Large scans use parallel scan with segment parameter
- Query results limited with `Limit` matching page size
- Consistent reads only for writes, eventual reads for lists

**Validation**: Before/after consumed capacity comparison.

---

### SP12-3: GSI rationalization
**Description**: Audit all GSI usage across both services. Current state: 6 active GSIs with 6 more planned. Approaching DynamoDB's 20 GSI limit. Optimize by using sparse and overloaded GSIs.

**Files**:
- `server/lib/tenant-template/ecs-dynamodb.ts`
- All entity files with GSI key builders

**Acceptance Criteria**:
- Document all GSI usage patterns (which entity types use which GSIs)
- Identify overloaded GSIs (same GSI, different entity types with non-overlapping key prefixes)
- Convert low-volume GSIs to `KEYS_ONLY` or `INCLUDE` projection (instead of ALL)
- Consolidate where possible (e.g., audit log can reuse existing GSI with sparse key)
- Ensure total active GSIs stay under 15 to leave headroom
- Document hot partition risk mitigation for school-scoped GSI1

**Validation**: Count total GSIs before and after. Verify all queries still work after consolidation.

---

### SP12-4: Idempotency for create operations
**Description**: Add idempotency support for critical create operations to prevent duplicates from network retries.

**Files**:
- `server/application/microservices/academics/src/students/students.service.ts`
- `server/application/microservices/academics/src/enrollment/enrollment.service.ts`
- `server/application/microservices/academics/src/sections/section-enrollment.service.ts`

**Acceptance Criteria**:
- Accept optional `X-Idempotency-Key` header on POST endpoints
- If key seen before (within 24h TTL): return `200 OK` with original response body and `X-Idempotent-Replayed: true` header
- Store idempotency records in DynamoDB with TTL
- No key provided → behavior unchanged (backwards compatible)
- Idempotency check is tenant-scoped

**Validation**: POST with key → 201. Retry same key → 200 with `X-Idempotent-Replayed: true`. Different key → 201.

---

### SP12-5: Load test infrastructure
**Files**: `scripts/load-tests/academics-load.ts` (new)

**Acceptance Criteria**:
- Script simulating:
  - 50 concurrent users creating students
  - 100 concurrent users reading student lists
  - 20 concurrent users recording grades
  - 10 concurrent users recording bulk attendance
- Measures: latency (p50/p95/p99), error rate, throughput
- **Performance targets**:
  - Reads: p95 < 500ms
  - Writes: p95 < 1s
  - Error rate: < 0.1%
  - Zero DynamoDB throttling events

**Validation**: Run against staging, verify targets met.

---

### SP12-6: Smoke test — full regression suite
**Files**: `scripts/smoke-tests/academics-full-regression.ts`

**Acceptance Criteria**:
- Orchestrates all previous smoke tests in sequence
- Pre-seeds test data, runs all test modules, cleans up
- Single command: `npm run smoke:regression`
- Reports pass/fail for each sprint's test module

**Validation**: Full regression passes.

---

## Dependency Graph (Revised)

```
Sprint 1-2 (COMPLETE)
    │
Sprint 3 (Staff Integration) ──────────┐
                                         │
                                    Sprint 4 (Hardening + Observability)
                                         │
                        ┌────────────────┼────────────────┐
                        │                │                │
                   Sprint 5         Sprint 6         Sprint 7
                   (Rooms)       (Scheduling)     (Audit/FERPA)
                        │                │                │
                        │                │                │
                        └────────┬───────┘                │
                                 │                        │
                            Sprint 8                      │
                         (Assignments) ◄──────────────────┘
                                 │
                            Sprint 9
                          (Reporting)
                                 │
                           Sprint 10
                        (Term Processing)
                                 │
                           Sprint 11
                        (Notifications)
                                 │
                           Sprint 12
                      (Perf + Production)
```

**Critical Path**: 3 → 4 → 7 → 8 → 9 → 10

**Parallelizable**:
- Sprint 5 (Rooms), Sprint 6 (Scheduling), Sprint 7 (Audit) can all run in parallel after Sprint 4
- Sprint 11 (Notifications) can run in parallel with Sprint 10

---

## Task Count Summary

| Sprint | Tasks | Focus |
|--------|-------|-------|
| 3 | 7 | Staff integration, API contracts, Ed-Fi alignment |
| 4 | 15 | Data integrity, transactions, validation, observability |
| 5 | 6 | Room/Classroom management |
| 6 | 6 | Scheduling, conflict detection |
| 7 | 7 | Audit, compliance, FERPA, rate limiting |
| 8 | 8 | Assignment management, grade linking |
| 9 | 6 | Reporting, transcripts, report cards |
| 10 | 5 | End-of-term/year processing, promotion |
| 11 | 4 | Notifications |
| 12 | 6 | Performance, metrics, GSI optimization, load testing |
| **Total** | **70** | |

---

## Architecture Decision Records (ADRs)

### ADR-1: DynamoDB Transactions for Enrollment
**Decision**: Use `TransactWriteItems` for section enrollment instead of read-then-write.
**Reason**: Prevents race conditions where two concurrent enrollments both pass capacity check.
**Trade-off**: Transactions cost 2x WCU and have 100-item limit.

### ADR-2: Event-Driven Teacher Name Propagation
**Decision**: Use EventBridge `staff.updated` events to propagate name changes to sections, instead of on-read refresh.
**Reason**: On-read refresh would cause N HTTP calls on list requests. Event-driven is eventually consistent but avoids N+1 query pattern.

### ADR-3: Audit Before Reporting
**Decision**: Sprint 7 (Audit/FERPA) is scheduled before Sprint 9 (Reporting).
**Reason**: FERPA requires PII access logging. Transcripts and report cards are PII-heavy. Audit must be in place before those endpoints ship.

### ADR-4: Sparse GSI Pattern
**Decision**: Reuse existing GSIs with sparse key patterns for new entity types (audit logs, assignments) instead of creating new GSIs.
**Reason**: DynamoDB 20 GSI limit per table. With 12+ GSIs planned, must conserve headroom.

### ADR-5: Staff Exists in Identity Service
**Decision**: Staff CRUD lives in the Identity service (not Academics). Academics resolves staff via HTTP calls with short-TTL caching.
**Reason**: Staff is an HR/identity domain concept. The P0 gap was missing seed data and integration, not missing code.
