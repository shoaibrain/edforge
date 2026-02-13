# EdForge Education Organization Domain — Full-Stack Sprint Plan

**Document Version:** 2.1
**Created:** February 9, 2026
**Last Updated:** February 10, 2026
**Module:** Education Organization Domain (Staff & Education Org Enhancement)
**Total Sprints:** 7 (Sprint 1 split into 1A/1B)
**Ed-Fi Alignment:** [Education Organization Domain v5](https://docs.ed-fi.org/reference/data-exchange/data-standard/model-reference/education-organization-domain/), [Staff Domain](https://docs.ed-fi.org/reference/data-exchange/data-standard/model-reference/staff-domain/)

---

## Executive Summary

This plan enhances EdForge's Education Organization and Staff management from basic implementations to a robust, Ed-Fi compliant EMIS platform. **Version 2.1** is a full-stack plan covering backend (NestJS/DynamoDB), shared-types (`@aibrains/shared-types` on npm), and frontend (React micro-frontend) changes as atomic, testable tasks.

### What Changed in v2.0 → v2.1

1. **Full-stack scope**: Every feature includes backend API, shared-types schema, and frontend UI tasks
2. **Shared-types is now an npm package**: `@aibrains/shared-types` on the public registry — no more local `types/packages/` references
3. **Backend architecture understood**: DynamoDB single-table design, NestJS microservices (Identity + Academics), existing Staff/Credential/Leave modules
4. **Frontend architecture understood**: Module Federation micro-frontends, Shell host + People/Academics/etc. remotes
5. **Existing code leveraged**: Staff, Credential, Leave schemas/services already exist and need enhancement, not greenfield
6. **v2.1 review fixes**: Split oversized tasks (1A.8 → 4 sub-tasks, 1A.9 → 3 sub-tasks), added EventBridge events, added frontend testing infrastructure, moved networks to Sprint 6, added leave management UI, added backend integration tests, consolidated Sprint 3 form tasks

### Current State Assessment

**Backend (server/application)**:
- **Identity microservice**: Users, Auth, Schools, Roles, Sessions, Security, Staff, Credentials, Leave, Academic Years, Tenants
- **Academics microservice**: Students, Enrollment, Attendance, Courses, Sections, Grades
- **Staff module exists**: Basic CRUD (`POST/GET/PATCH/DELETE /staff`), Ed-Fi aligned entity in DynamoDB
- **Credentials module exists**: Full CRUD + verification + expiration alerts at `staff/:staffId/credentials/*` and `credentials/expiring` — **no new backend work needed for credentials**
- **Leave module exists**: Full leave request lifecycle (create, approve, reject, cancel, balance) — **no new backend work needed for leave**
- **Missing**: No SEA, LEA, ESC entities. No EdOrg hierarchy. No staff school assignments as separate entity. No employment history tracking.
- **DynamoDB single-table**: `edforge-identity-{tier}` table with `TENANT#{tid}` PK pattern
- **EventBridge**: Existing event publishing for User, School, Staff, Credential, Leave entity changes — new EdOrg entities must follow this pattern

**Frontend (edforge-saas-frontend)**:
- **Shell app**: Host MFE with settings pages (schools, workspace, security, etc.)
- **People app**: Staff directory with basic `CreateUserModal` (5 fields), staff detail page with tabs
- **Academics app**: 21+ routes for students, courses, grades, attendance
- **Packages**: `@edforge/ui`, `@edforge/abac`, `@edforge/forms`, `@edforge/wizard`, `@edforge/auth`, `@edforge/types`
- **`@edforge/types`**: Internal frontend-only types (auth, person, tenant). These are **UI-layer types** distinct from `@aibrains/shared-types` (API contracts). `SchoolRole` in `@edforge/types` must align with `schoolRoleSchema` in shared-types.
- **Testing**: Zero test files in frontend apps. Testing infrastructure (Vitest) must be set up.
- **Missing**: No organization hierarchy page. No LEA/SEA/ESC UI. Staff creation is User-only. No staff wizard. No leave management UI (backend exists).

**Shared Types (`@aibrains/shared-types@0.1.1`)**:
- 100+ Zod schemas covering identity and academics
- Staff schema exists with Ed-Fi fields (staffUniqueId, demographics, employment, school assignments)
- Credential schema exists with full Ed-Fi fields (credentialIdentifier, types, grade levels, verification status)
- Leave schema exists with full lifecycle (request, approve, reject, cancel, balance)
- School schema exists (basic — no LEA reference, no identification codes, no Ed-Fi categories)
- Ed-Fi mappers exist: `staff.mapper.ts` (toEdFiStaff, toEdFiStaffAssignment, toEdFiStaffBatch), `credential.mapper.ts`, `calendar.mapper.ts`
- **Missing**: No SEA, LEA, ESC schemas. No EdOrg hierarchy types. No EdOrg descriptor constants. No education org mapper.

### Tech Stack

| Layer | Stack |
|-------|-------|
| **Backend** | NestJS 10, TypeScript 5, DynamoDB (single-table), EventBridge, AWS Cognito, Jest |
| **Shared Types** | Zod 3.24, TypeScript 5, npm (`@aibrains/shared-types`) |
| **Frontend** | React 19, TypeScript 5.6, TanStack Router, Zustand, React Query, Tailwind CSS 4, Rsbuild, Module Federation |
| **Frontend Packages** | `@edforge/ui`, `@edforge/abac`, `@edforge/forms`, `@edforge/wizard`, `@edforge/auth`, `@edforge/types` |

### Shared-Types Update Workflow

Every sprint that modifies `@aibrains/shared-types`:
1. Edit schemas in `packages/shared-types/src/`
2. Run tests: `npm test` in `packages/shared-types/`
3. Bump version in `packages/shared-types/package.json`
4. Publish: `npm publish` from `packages/shared-types/`
5. Update backend: `npm install @aibrains/shared-types@<version>` in `server/application/` (use exact version, not range)
6. Update frontend: `pnpm update @aibrains/shared-types` in `edforge-saas-frontend/`

### Definition of Done (DoD)

Each task must satisfy:

1. Code compiles with zero TypeScript errors
2. Backend: Unit tests pass for new services/controllers (Jest)
3. Backend: Error responses use existing `ExceptionFilter` pattern (`{ statusCode, message, error, errorCode?, field? }`)
4. Frontend: Component renders without runtime errors in dev server
5. Frontend: Visual appearance matches EdForge design system
6. Shared-types: Schema tests pass (valid data passes, invalid data fails with correct error paths)
7. Accessibility: keyboard navigable, proper ARIA labels (frontend)
8. Both light and dark themes tested (frontend)
9. New shared-types version published and consumed by both consumers

### Scope & Out-of-Scope

**In Scope:**
- StateEducationAgency, LocalEducationAgency, School, EducationServiceCenter
- EducationOrganizationNetwork + EducationOrganizationNetworkAssociation
- OrganizationDepartment enhancement, AccountabilityRating
- EducationOrganizationIdentificationCode, EducationOrganizationIndicator
- Staff creation wizard, profile enhancement, assignments, credentials, leave management UI
- Full-stack: DynamoDB entities, NestJS APIs, EventBridge events, Zod schemas, React UI

**Out of Scope (Phase 2):**
- CommunityOrganization, CommunityProvider, PostSecondaryInstitution
- EducationOrganizationPeerAssociation
- Bulk CSV/Excel import of organizations
- Organization merge/split operations
- Print/export organization chart as PDF

---

## Sprint 1A: Data Foundation — Schemas, Backend Entities & APIs

**Goal:** Create the complete data foundation for the core EdOrg hierarchy (SEA, LEA, ESC — **no networks yet**): Zod schemas in shared-types, DynamoDB entity definitions, NestJS endpoints, EventBridge events, staff assignment/history endpoints, and ABAC permissions. No UI in this sprint.

**Note:** Network entities (EducationOrganizationNetwork, NetworkAssociation) are deferred to Sprint 6 where the Network UI is built. This keeps Sprint 1A focused on the core hierarchy that all subsequent sprints depend on.

**Demo:** Run backend test suite showing all new EdOrg endpoints respond correctly. Run shared-types tests showing schema validation. Query the hierarchy endpoint and see the tree structure. Show ABAC permission checks working for new resources.

---

### Task 1A.1: Add Ed-Fi Education Organization Descriptor Constants to Shared-Types

**Repo:** `packages/shared-types`
**File:** `src/schemas/identity/education-org-descriptors.ts` (new)
**Update:** `src/schemas/identity/index.ts`, `src/index.ts`

**Description:** Define all Ed-Fi descriptor constants for the Education Organization domain as Zod enums and typed constant arrays.

**Implementation:**
- Define descriptor constant arrays with `{ value, label, uri }` shape:
  - `SCHOOL_CATEGORY_DESCRIPTORS` (All Levels, Elementary, High, Middle, Secondary, Ungraded)
  - `SCHOOL_TYPE_DESCRIPTORS` (Regular, Special Education, Career and Technical Education, Alternative)
  - `LEA_CATEGORY_DESCRIPTORS` (Independent, Charter LEA, Intermediate, Supervisory Union, Other)
  - `OPERATIONAL_STATUS_DESCRIPTORS` (Active, Added, Changed Agency, Closed, Inactive, New)
  - `INSTITUTION_TELEPHONE_NUMBER_TYPE_DESCRIPTORS` (Main, Administrative, Fax, Attendance)
  - `EDUCATION_ORGANIZATION_IDENTIFICATION_SYSTEM_DESCRIPTORS` (NCES, SEA, DUNS, Federal)
  - `ADDRESS_TYPE_DESCRIPTORS` (Physical, Mailing, Shipping)
  - `GRADE_LEVEL_DESCRIPTORS` (PK through 12, Postsecondary, Ungraded — Ed-Fi URI format)
- Each descriptor URI follows `uri://ed-fi.org/{Namespace}#{Value}` pattern
- Export all from barrel index

**Validation:**
- `npm run build` succeeds in `packages/shared-types`
- All descriptor arrays are non-empty, all URIs match Ed-Fi pattern
- **Test:** `education-org-descriptors.test.ts` — verify array lengths, URI format, no duplicates

---

### Task 1A.2: Create Education Organization Base Schemas (Zod)

**Repo:** `packages/shared-types`
**File:** `src/schemas/identity/education-organization.schema.ts` (new)

**Description:** Zod schemas for the EducationOrganization abstract base type and shared sub-types used by all concrete org entities.

**Implementation:**
- `educationOrgTypeSchema` enum: `'stateEducationAgency' | 'localEducationAgency' | 'school' | 'educationServiceCenter' | 'educationOrganizationNetwork' | 'organizationDepartment' | 'communityOrganization' | 'communityProvider' | 'postSecondaryInstitution'` (includes future types for forward compatibility)
- `operationalStatusSchema` enum: `'active' | 'inactive' | 'added' | 'changed' | 'closed' | 'new' | 'reopened' | 'future'`
- `educationOrgAddressSchema`: addressTypeDescriptor, streetNumberName, apartmentRoomSuiteNumber, city, stateAbbreviationDescriptor, postalCode, nameOfCounty, countyFIPSCode, latitude, longitude
- `educationOrgIdentificationCodeSchema`: identificationCode, educationOrganizationIdentificationSystemDescriptor
- `educationOrgIndicatorSchema`: indicatorDescriptor, designatedBy, indicatorValue, indicatorLevelDescriptor, indicatorGroupDescriptor
- `institutionTelephoneSchema`: telephoneNumber, institutionTelephoneNumberTypeDescriptor
- `educationOrgCategorySchema`: educationOrganizationCategoryDescriptor (required on all Ed-Fi education org entities)
- `accountabilityRatingSchema`: schoolYear, title, rating, ratingOrganization, ratingDate
- Export all types via barrel

**Validation:**
- All schemas compile and produce correct TypeScript types via `z.infer<>`
- **Test:** `education-organization.schema.test.ts` — valid data passes, invalid data fails, required fields enforced

---

### Task 1A.3: Create LEA, SEA, and ESC Schemas

**Repo:** `packages/shared-types`
**Files:**
- `src/schemas/identity/local-education-agency.schema.ts` (new)
- `src/schemas/identity/state-education-agency.schema.ts` (new)
- `src/schemas/identity/education-service-center.schema.ts` (new)

**Description:** Zod schemas for LEA (school district), SEA (state department), and ESC (regional service agency) CRUD operations.

**Implementation:**
- **LEA:** `leaCategorySchema` enum, `createLocalEducationAgencySchema` (localEducationAgencyId, nameOfInstitution, categories[], optional: shortName, webSite, operationalStatusDescriptor, addresses[], identificationCodes[], telephones[], stateEducationAgencyId, educationServiceCenterId, parentLocalEducationAgencyId, charterStatusDescriptor), `leaAccountabilitySchema`, `updateLocalEducationAgencySchema`, `leaResponseSchema`, `leaListResponseSchema`
- **SEA:** `createStateEducationAgencySchema` (stateEducationAgencyId, nameOfInstitution, categories[], etc.), `seaResponseSchema`. No parent reference (root entity).
- **ESC:** `createEducationServiceCenterSchema` (educationServiceCenterId, nameOfInstitution, stateEducationAgencyReference, etc.), `escResponseSchema`

**Validation:**
- **Tests:** `local-education-agency.schema.test.ts`, `state-education-agency.schema.test.ts`, `education-service-center.schema.test.ts`
- Required fields enforced, UUIDs validated, numeric Ed-Fi IDs are positive integers

---

### Task 1A.4: Create Hierarchy Response Schema

**Repo:** `packages/shared-types`
**File:** `src/schemas/identity/education-org-hierarchy.schema.ts` (new)

**Description:** Schema for the hierarchy tree API response.

**Implementation:**
- `hierarchyNodeSchema`: id, name, type (educationOrgTypeSchema), edfiId, status, children[] (recursive), schoolCount?, studentCount?, staffCount?
- `organizationHierarchyResponseSchema`: `{ sea: hierarchyNode | null, unassigned: hierarchyNode[] }` — orphaned schools without LEA parent

**Validation:**
- **Test:** `education-org-hierarchy.schema.test.ts` — recursive node validation, empty hierarchy, full hierarchy

---

### Task 1A.5: Enhance School Schema with EdOrg Fields + Publish v0.2.0

**Repo:** `packages/shared-types`
**Update:** `src/schemas/identity/school.schema.ts`
**Update:** `package.json` (version bump to 0.2.0)

**Description:** Add EdOrg hierarchy reference and Ed-Fi fields to school schema, then publish.

**Implementation:**
- Add optional fields to `createSchoolSchema` and `schoolResponseSchema`:
  - `localEducationAgencyId` (UUID), `identificationCodes[]`, `schoolCategories[]`, `schoolTypeDescriptor`, `gradeLevels[]`, `telephones[]`, `accountabilityRatings[]`, `charterStatusDescriptor`, `administrativeFundingControlDescriptor`, `titleIPartASchoolDesignationDescriptor`
- All new fields optional for backwards compatibility
- Bump version to 0.2.0, run full test suite, build, publish
- Update both backend and frontend to `@aibrains/shared-types@0.2.0`

**Validation:**
- Existing school tests still pass
- **Test:** New field cases added to school schema tests
- Both backend and frontend compile after update

---

### Task 1A.6: Create DynamoDB Entity Definitions for EdOrg Entities

**Repo:** `server/application`
**Files:**
- `microservices/identity/src/common/entities/state-education-agency.entity.ts` (new)
- `microservices/identity/src/common/entities/local-education-agency.entity.ts` (new)
- `microservices/identity/src/common/entities/education-service-center.entity.ts` (new)

**Description:** Define DynamoDB entity interfaces for core EdOrg entities following the existing single-table design pattern.

**Implementation:**
- **Key design** (single-table, `edforge-identity-{tier}`):

| Entity | PK | SK | GSI1 | Notes |
|--------|----|----|------|-------|
| SEA | `TENANT#{tid}` | `SEA#{seaId}` | — | One per tenant (singleton) |
| LEA | `TENANT#{tid}` | `LEA#{leaId}` | `TENANT#{tid}#SEA#{seaId}` | Query LEAs by SEA |
| ESC | `TENANT#{tid}` | `ESC#{escId}` | `TENANT#{tid}#SEA#{seaId}` | Query ESCs by SEA |

- Each entity includes: `entityType`, `tenantId`, all Ed-Fi fields from schemas, audit fields (createdAt, createdBy, updatedAt, updatedBy, version)
- LEA entity includes hierarchy refs: `stateEducationAgencyId`, `educationServiceCenterId`, `parentLocalEducationAgencyId`

**Validation:**
- TypeScript compiles, entity interfaces match shared-types schemas, key patterns follow existing conventions

---

### Task 1A.7a: Create SEA Endpoints (Backend)

**Repo:** `server/application`
**Files:**
- `microservices/identity/src/education-organizations/education-organizations.module.ts` (new)
- `microservices/identity/src/education-organizations/education-organizations.controller.ts` (new)
- `microservices/identity/src/education-organizations/education-organizations.service.ts` (new)
- `microservices/identity/src/common/dto/zod-dtos.ts` (update — add `CreateSeaDtoZ`)

**Description:** Create the NestJS EdOrg module with SEA singleton endpoints (2 routes — simplest entity, establishes the module).

**Implementation:**
- Create module, controller, service scaffolding
- `CreateSeaDtoZ` via `createZodDto(createStateEducationAgencySchema)`
- Routes:
  - `GET /education-organizations/sea` — get tenant's SEA (return 404 if none)
  - `PUT /education-organizations/sea` — create or update SEA
- Service: DynamoDB put/get using `DynamoDBClientService`
- Protected with `@RequirePermission({ resource: 'education-organizations', action: 'manage' })`
- Register module in Identity app module

**Validation:**
- **Test:** `education-organizations-sea.service.spec.ts` — create SEA, get SEA, update SEA, tenant isolation
- GET returns 404 when no SEA exists, 200 with data when it does
- PUT is idempotent (create or update)

---

### Task 1A.7b: Create LEA Endpoints (Backend)

**Repo:** `server/application`
**Update:** `education-organizations.controller.ts`, `education-organizations.service.ts`, `zod-dtos.ts`

**Description:** Add LEA CRUD endpoints (5 routes + pagination).

**Implementation:**
- Add `CreateLeaDtoZ`, `UpdateLeaDtoZ`
- Routes:
  - `GET /education-organizations/leas` — list LEAs (paginated, support `?seaId=` filter)
  - `POST /education-organizations/leas` — create LEA (validates SEA reference exists)
  - `GET /education-organizations/leas/:leaId` — get detail
  - `PATCH /education-organizations/leas/:leaId` — update
  - `DELETE /education-organizations/leas/:leaId` — soft-delete (set status to 'inactive')
- Validate parent references (SEA, ESC, parent LEA) exist within tenant

**Validation:**
- **Test:** `education-organizations-lea.service.spec.ts` — full CRUD, pagination, reference validation, soft-delete
- 400 for invalid references, 404 for missing LEA, proper pagination metadata

---

### Task 1A.7c: Create ESC Endpoints (Backend)

**Repo:** `server/application`
**Update:** `education-organizations.controller.ts`, `education-organizations.service.ts`, `zod-dtos.ts`

**Description:** Add ESC CRUD endpoints (5 routes).

**Implementation:**
- Add `CreateEscDtoZ`, `UpdateEscDtoZ`
- Routes: CRUD pattern same as LEA (`/education-organizations/escs/...`)
- Validates SEA reference

**Validation:**
- **Test:** `education-organizations-esc.service.spec.ts` — CRUD, reference validation
- Same patterns as LEA tests

---

### Task 1A.7d: Create Hierarchy Assembly Endpoint (Backend)

**Repo:** `server/application`
**Update:** `education-organizations.controller.ts`, `education-organizations.service.ts`

**Description:** Implement the hierarchy tree assembly endpoint — the most algorithmically complex single endpoint.

**Implementation:**
- Route: `GET /education-organizations/hierarchy`
- Query params: `?depth=N` (0=full, 1=top-level), `?parentId=UUID` (lazy-load subtree)
- **Algorithm:**
  1. Query all EdOrg entities for tenant: SEA (SK begins_with `SEA#`), LEAs (SK begins_with `LEA#`), ESCs (SK begins_with `ESC#`), Schools (SK begins_with `SCHOOL#`)
  2. Build parent-child map from reference fields (`stateEducationAgencyId`, `educationServiceCenterId`, `localEducationAgencyId`)
  3. Identify orphaned schools (no `localEducationAgencyId`)
  4. Compute aggregate counts (schoolCount per LEA, etc.)
  5. Return `{ sea: HierarchyNode | null, unassigned: SchoolNode[] }`
- **Performance:** For tenants with >100 schools, use in-memory filter approach (query all schools for tenant, filter by `localEducationAgencyId` in application code). Defer GSI optimization to Phase 2.
- Support `?depth=1` returning only SEA + direct children (no school details)

**Validation:**
- **Test:** `hierarchy-assembly.spec.ts` — empty tenant, flat tenant (schools only, no hierarchy), full hierarchy, orphaned schools, depth filtering, large tenant (100+ entities mock)
- Response matches `organizationHierarchyResponseSchema`

---

### Task 1A.8: Add EventBridge Events for EdOrg Entity Changes

**Repo:** `server/application`
**Update:** `microservices/identity/src/common/services/identity-events.service.ts`

**Description:** Add EventBridge event types for EdOrg entities, following the existing pattern for User/School/Staff events.

**Implementation:**
- Define new event interfaces: `SEACreatedEvent`, `SEAUpdatedEvent`, `LEACreatedEvent`, `LEAUpdatedEvent`, `LEADeletedEvent`, `ESCCreatedEvent`, `ESCUpdatedEvent`, `ESCDeletedEvent`
- Add to `IdentityDomainEvent` union type
- Add convenience publish methods: `publishSEACreated()`, `publishLEACreated()`, etc.
- Call from EdOrg service in all create/update/delete operations
- Include entity data and tenantId in event payload

**Validation:**
- **Test:** Verify events are published during CRUD operations (mock EventBridge in unit tests)
- Event payloads contain entity data and tenantId
- No regression on existing events

---

### Task 1A.9a: Create Staff Assignment Entity + CRUD Endpoints (Backend)

**Repo:** `server/application`
**Update:** `microservices/identity/src/staff/staff.controller.ts`, `staff.service.ts`
**File:** `microservices/identity/src/common/entities/staff-assignment.entity.ts` (new)

**Description:** Add staff school assignment as a separate DynamoDB entity with CRUD endpoints.

**Implementation:**
- **Entity:**

| Entity | PK | SK | GSI1 | Notes |
|--------|----|----|------|-------|
| STAFF_ASSIGNMENT | `TENANT#{tid}` | `STAFF#{staffId}#ASSIGN#{assignmentId}` | `TENANT#{tid}#SCHOOL#{schoolId}` | Query assignments by school |

- **Routes:**
  - `GET /staff/:staffId/assignments` — list school assignments
  - `POST /staff/:staffId/assignments` — assign to school (validates school exists)
  - `PATCH /staff/:staffId/assignments/:assignmentId` — update (FTE, role, dates)
  - `DELETE /staff/:staffId/assignments/:assignmentId` — remove
- Enforce: exactly one primary assignment, FTE range 0.0–1.0

**Validation:**
- **Test:** `staff-assignments.service.spec.ts` — CRUD, primary flag enforcement, school validation
- Cannot remove last primary assignment

---

### Task 1A.9b: Create Employment History Endpoints (Backend)

**Repo:** `server/application`
**Update:** `microservices/identity/src/staff/staff.controller.ts`, `staff.service.ts`

**Description:** Add employment status change tracking (append-only history).

**Implementation:**
- **Entity:**

| Entity | PK | SK | Notes |
|--------|----|----|-------|
| STAFF_EMP_HISTORY | `TENANT#{tid}` | `STAFF#{staffId}#EMPHIST#{timestamp}` | Append-only log |

- **Routes:**
  - `POST /staff/:staffId/employment-status` — record status change (creates history entry, updates staff entity status)
  - `GET /staff/:staffId/employment-history` — list status changes (most recent first)
- Each entry: `{ status, effectiveDate, reason, notes, changedBy, changedAt }`

**Validation:**
- **Test:** `staff-employment-history.spec.ts` — record change, list history, immutability
- History entries are append-only (no update/delete)

---

### Task 1A.9c: Atomic Staff + User Creation with Cognito (Backend)

**Repo:** `server/application`
**Update:** `microservices/identity/src/staff/staff.service.ts`

**Description:** Enhance `POST /staff` to atomically create Staff record + Cognito user + User record when `createUserAccount: true`.

**Implementation:**
- Accept optional `createUserAccount` boolean + `userAccountConfig` (email, globalRole, generateTemporaryPassword) in request body
- When `createUserAccount: true`:
  1. Create Staff record in DynamoDB
  2. Create Cognito user via `CredentialVendor`
  3. Create User record in DynamoDB with link to Staff
  4. On step 2 or 3 failure: delete Staff record (rollback)
- Publish `StaffCreated` event (and `UserCreated` if account created)

**Validation:**
- **Test:** `staff-atomic-creation.spec.ts` — success path, Cognito failure → rollback, User creation failure → rollback
- Staff record does not persist if user creation fails
- Works correctly when `createUserAccount: false` (staff-only creation)

---

### Task 1A.10a: Add ABAC Resources — Backend

**Repo:** `server/application`
**Update:** Permission-related files in `microservices/identity/src/common/`

**Description:** Add EdOrg resources to the backend permission system.

**Implementation:**
- Add resources: `education-organizations`, `state-education-agency`, `local-education-agency`, `education-service-center`
- Add to role-permission mappings: TenantAdmin = full CRUD, Principal = view, Teacher = view, Staff = view
- Apply `@RequirePermission()` on all EdOrg controller routes

**Validation:**
- TenantAdmin can access all EdOrg endpoints
- Non-admin roles receive 403 for write operations

---

### Task 1A.10b: Add ABAC Resources — Frontend

**Repo:** `edforge-saas-frontend`
**Update:** `packages/abac/src/permissions.ts`

**Description:** Add EdOrg resources to the frontend ABAC engine.

**Implementation:**
- Add to `Resource` type: `'education-organizations'`, `'state-education-agency'`, `'local-education-agency'`, `'education-service-center'`, `'education-org-network'`, `'accountability-ratings'`
- Add to `ROLE_PERMISSIONS`: TenantAdmin = full CRUD, Principal = view + edit own school, Teacher/Staff = view only
- Update `RESOURCE_LABELS`
- Ensure `SchoolRole` values in `@edforge/types` align with `schoolRoleSchema` in `@aibrains/shared-types`

**Validation:**
- `can(adminUser, { action: 'create', resource: 'local-education-agency' })` → true
- `can(teacherUser, { action: 'create', resource: 'local-education-agency' })` → false
- **Test:** `education-org-permissions.test.ts` — role-resource matrix
- No regression on existing permissions

---

### Task 1A.11: Update School Entity to Support LEA Reference (Backend)

**Repo:** `server/application`
**Update:** `microservices/identity/src/schools/schools.service.ts`, `schools.controller.ts`

**Description:** Add `localEducationAgencyId` to School entity and update CRUD.

**Implementation:**
- Add `localEducationAgencyId` (optional UUID) to School DynamoDB entity
- Update `POST /schools` and `PATCH /schools/:schoolId` to accept `localEducationAgencyId`
- Validate referenced LEA exists within tenant on create/update
- Update `GET /schools` to support `?leaId=UUID` filter parameter (in-memory filter for now — all schools for tenant are already queried, filter by `localEducationAgencyId` in service code)
- **Note:** DynamoDB GSI for School→LEA lookup deferred to Phase 2 optimization. MVP uses in-memory filtering.

**Validation:**
- **Test:** Add cases to `schools.service.spec.ts` for LEA reference
- Schools can be created/updated with or without LEA (backwards compatible)
- Invalid LEA reference returns 400

---

### Task 1A.12: Backend Integration Tests for EdOrg Endpoints

**Repo:** `server/application`
**File:** `test/integration/education-organizations.integration.spec.ts` (new)

**Description:** HTTP-level integration tests for all EdOrg endpoints.

**Implementation:**
- Test each route at the HTTP level (supertest or equivalent)
- Scenarios: DTO validation (bad input → 400 with Zod errors), tenant isolation (missing tenant → 401/403), 404 for missing entities, soft-delete behavior, hierarchy assembly correctness
- Use `TestDataFactory` from `libs/test-utils` for test data setup

**Validation:**
- All integration tests pass
- Tests cover happy path + error cases for each endpoint

---

### Task 1A.13: Dev Seed Script for EdOrg Entities

**Repo:** `server/application`
**File:** `scripts/seed-edorg.ts` (new, or add to existing seed script)

**Description:** Create sample EdOrg data for development and demo.

**Implementation:**
- Creates: 1 SEA, 3 LEAs (with different categories), 1 ESC, assigns existing schools to LEAs
- Idempotent (safe to re-run)
- Uses DynamoDBClientService directly

**Validation:**
- Script runs without errors
- Hierarchy endpoint returns populated tree after seeding

---

## Sprint 1B: Hierarchy Visualization UI (Frontend)

**Goal:** Build the read-only hierarchy visualization tree and the Organization settings page. Consumes the backend APIs from Sprint 1A.

**Demo:** Navigate to Settings → Organization to see the education organization hierarchy tree with existing schools displayed. Tree renders with proper icons, expand/collapse, entity type badges, status indicators. Orphaned schools in "Unassigned Schools" section.

---

### Task 1B.0: Frontend Testing Infrastructure (Vitest)

**Repo:** `edforge-saas-frontend`
**Files:** `vitest.config.ts` (new, workspace root), `test-utils/` (new)
**Update:** `turbo.json`, root `package.json`

**Description:** Set up Vitest in the frontend monorepo. Currently zero test files exist.

**Implementation:**
- Install `vitest`, `@testing-library/react`, `@testing-library/jest-dom` at workspace root
- Create `vitest.config.ts`: TypeScript support, path aliases matching tsconfig, test pattern `**/*.test.{ts,tsx}`
- Add `"test": "vitest run"`, `"test:watch": "vitest"` to root package.json
- Add `test` pipeline to turbo.json
- Create `test-utils/` with helpers:
  - `renderWithProviders(component)` — wraps in React Query, ABAC, Router providers
  - `expectSchemaValid(schema, data)`, `expectSchemaInvalid(schema, data, expectedPath?)`
- Create sample test to verify setup works

**Validation:**
- `pnpm test` runs and passes
- Sample test executes with correct output

---

### Task 1B.1: Create Education Organization Service Layer (Frontend)

**Repo:** `edforge-saas-frontend`
**File:** `apps/shell/src/services/education-org.service.ts` (new)

**Description:** API service functions for EdOrg CRUD, following existing `tenant.service.ts` pattern.

**Implementation:**
- Import from `lib/api.ts` (apiGet, apiPost, apiPatch, apiDelete, apiPut)
- **SEA:** getStateEducationAgency(), createOrUpdateStateEducationAgency(data)
- **LEA:** getLocalEducationAgencies(), getLocalEducationAgency(id), createLocalEducationAgency(data), updateLocalEducationAgency(id, data), deleteLocalEducationAgency(id)
- **ESC:** getEducationServiceCenters(), getEducationServiceCenter(id), createEducationServiceCenter(data), updateEducationServiceCenter(id, data), deleteEducationServiceCenter(id)
- **Hierarchy:** getOrganizationHierarchy(depth?, parentId?)
- All typed with `@aibrains/shared-types` DTOs
- Use existing `version` field in PATCH body for optimistic concurrency (not HTTP ETag — matching existing backend pattern)

**Validation:**
- TypeScript compiles with correct types
- Pattern matches `tenant.service.ts`

---

### Task 1B.2: Create Education Organization React Query Hooks (Frontend)

**Repo:** `edforge-saas-frontend`
**File:** `apps/shell/src/hooks/useEducationOrgs.ts` (new)

**Description:** React Query hooks for all EdOrg data fetching.

**Implementation:**
- Query key factory: `edOrgKeys` with `all`, `hierarchy`, `leas`, `lea(id)`, `sea`, `escs`, `esc(id)`
- Query hooks: `useOrganizationHierarchy()` (staleTime: 5min), `useLocalEducationAgencies()`, `useLocalEducationAgency(id)`, `useStateEducationAgency()`, `useEducationServiceCenters()`
- Mutation hooks: `useCreateLea()`, `useUpdateLea()`, `useDeleteLea()`, `useCreateOrUpdateSea()`, `useCreateEsc()`, `useUpdateEsc()`, `useDeleteEsc()`
- All mutations invalidate `edOrgKeys.hierarchy()`

**Validation:**
- Hooks return proper loading/error/data states
- Query invalidation works after mutations

---

### Task 1B.3: Create Organization Hierarchy Tree Component (Frontend)

**Repo:** `edforge-saas-frontend`
**File:** `apps/shell/src/components/settings/OrganizationHierarchyTree.tsx` (new)

**Description:** Interactive tree visualization for SEA → ESC → LEA → Schools.

**Implementation:**
- Recursive `TreeNode` component: expand/collapse (Framer Motion), type badge (color-coded), name (truncated + tooltip), status dot, count pills, indent lines, click-to-navigate
- `OrganizationHierarchyTree` wrapper: expand/collapse all, search/filter, empty state, loading skeleton
- Orphaned schools section below tree
- Accessibility: `role="tree"`, `role="treeitem"`, `aria-expanded`, keyboard nav
- Performance: collapse children by default for LEAs with >20 schools

**Validation:**
- Tree renders with hierarchy data, expand/collapse animated, keyboard works, empty state, dark mode

---

### Task 1B.4: Create Organization Settings Page & Route (Frontend)

**Repo:** `edforge-saas-frontend`
**File:** `apps/shell/src/pages/settings/organization.tsx` (new)
**Update:** `apps/shell/src/router.tsx`, settings sidebar navigation

**Description:** New settings page with hierarchy tree and action buttons.

**Implementation:**
- Page header: "Organization Structure", subtitle
- Tabs (Framer Motion): Hierarchy (default), Details (summary cards)
- Quick actions: "Set Up State Agency" (if no SEA), "Add District/LEA", "Add Service Center"
- ABAC permission gating on buttons
- Stats bar: Total Orgs, Active Schools, Students, Staff
- Lazy route in `router.tsx`, sidebar nav item (icon `Building2`, between Workspace and School Settings)

**Validation:**
- Page renders at `/settings/organization`, sidebar nav works, buttons respect permissions

---

### Task 1B.5: Orphaned School Assignment Workflow (Frontend)

**Repo:** `edforge-saas-frontend`
**File:** `apps/shell/src/components/settings/OrphanedSchoolsBanner.tsx` (new)

**Description:** Banner + modal for assigning orphaned schools to LEAs.

**Implementation:**
- Banner: "X schools are not assigned to a district." + "Assign Schools" button
- Modal: table of orphaned schools, bulk select → LEA dropdown → assign, individual dropdown per row
- Submit: `PATCH /schools/:schoolId` with `{ localEducationAgencyId }` per school
- Invalidates hierarchy query

**Validation:**
- Banner shows when orphaned schools exist, hidden when all assigned, assignments work

---

## Sprint 2: Education Organization Hierarchy CRUD

**Goal:** Enable full CRUD for LEA, SEA, and ESC through the organization hierarchy page.

**Demo:** Create an SEA, add LEAs, add ESCs, see hierarchy update in real-time. Edit and view details. Link school creation to LEA.

---

### Task 2.1: Create SEA Setup Form (Frontend)

**Repo:** `edforge-saas-frontend`
**File:** `apps/shell/src/components/settings/SEASetupForm.tsx` (new)

**Description:** Form for creating/editing the singleton SEA.

**Implementation:**
- React Hook Form + Zod (`createStateEducationAgencySchema`)
- Sections: Identity, Address (multiple), Contact (phones with type), Identification Codes
- `@edforge/ui` Modal (size `lg`)
- Submit → toast → invalidate hierarchy → close

**Validation:**
- All fields render, validation works, create/update succeeds

---

### Task 2.2: Create LEA Form (Frontend)

**Repo:** `edforge-saas-frontend`
**File:** `apps/shell/src/components/settings/LEAForm.tsx` (new)

**Description:** Create/edit form for Local Education Agencies.

**Implementation:**
- Collapsible sections: Basic Info (LEA ID, name, category, status), Hierarchy (SEA/ESC/Parent LEA dropdowns), Address & Contact, ID Codes
- Edit mode: pre-populate, LEA ID read-only
- Mutations invalidate `edOrgKeys.hierarchy()` and `edOrgKeys.leas()`

**Validation:**
- Create/edit modes work, hierarchy dropdowns load, submission refreshes tree

---

### Task 2.3: Create ESC Form (Frontend)

**Repo:** `edforge-saas-frontend`
**File:** `apps/shell/src/components/settings/ESCForm.tsx` (new)

**Description:** Create/edit form for Education Service Centers.

**Implementation:**
- Basic Info, Hierarchy (SEA ref), Address & Contact, ID Codes
- Modal (size `lg`), mutations invalidate hierarchy

**Validation:**
- Form renders, SEA dropdown loads, create/edit works

---

### Task 2.4: Integrate CRUD into Hierarchy Page (Frontend)

**Repo:** `edforge-saas-frontend`
**Update:** `apps/shell/src/pages/settings/organization.tsx`

**Description:** Wire create/edit/delete flows into hierarchy page.

**Implementation:**
- Create buttons → open appropriate form modals
- Tree node context menu: Edit, View Details, Add Child, Delete
- Delete confirmation (impact warning, name-typing for LEAs with schools)
- `useModalState()` pattern, ABAC checks

**Validation:**
- All create/edit/delete flows work through hierarchy page

---

### Task 2.5: Create Education Organization Detail Page (Frontend)

**Repo:** `edforge-saas-frontend`
**File:** `apps/shell/src/pages/settings/education-org-detail.tsx` (new)
**Update:** `apps/shell/src/router.tsx` — route `/settings/organization/:orgType/:orgId`

**Description:** Detail page for SEA, LEA, or ESC entity.

**Implementation:**
- Dynamic route (`orgType = sea | lea | esc`), page header with type badge + name + Ed-Fi ID
- Tabs: Overview, Schools (LEA only), Child Orgs, Indicators, Accountability (LEA only), Statistics
- 404 handling for invalid IDs

**Validation:**
- Renders for each org type, tabs work, schools tab correct for LEA

---

### Task 2.6: Link School Creation to LEA (Frontend)

**Repo:** `edforge-saas-frontend`
**Update:** `apps/shell/src/pages/settings/schools.tsx`

**Description:** Add LEA selector to school creation form.

**Implementation:**
- LEA dropdown after "School Type" in Basic Info section
- Fetch via `useLocalEducationAgencies()`, optional field
- Pre-select LEA when creating from hierarchy page ("Add School" on LEA node)

**Validation:**
- Dropdown appears, pre-selection works, existing creation still works without LEA

---

## Sprint 3: Enhanced School Creation with Ed-Fi Compliance

**Goal:** Enhance school form with Ed-Fi fields and create Ed-Fi organization mappers.

**Demo:** Create school with NCES ID, categories, grade descriptors, charter status. View Ed-Fi JSON preview.

---

### Task 3.1: Add Ed-Fi Identity Fields Section to School Form (Frontend)

**Repo:** `edforge-saas-frontend`
**Update:** `apps/shell/src/pages/settings/schools.tsx`

**Description:** Add Identification Codes + School Categories + Grade Level Descriptors sections.

**Implementation:**
- **Identification Codes** collapsible section: dynamic list with `useFieldArray` (System dropdown + Code text), uses `EDUCATION_ORGANIZATION_IDENTIFICATION_SYSTEM_DESCRIPTORS`
- **School Categories**: multi-select tag input using `SCHOOL_CATEGORY_DESCRIPTORS`, separate `schoolTypeDescriptor` dropdown using `SCHOOL_TYPE_DESCRIPTORS`, auto-suggest categories from internal school type
- **Grade Levels**: keep existing grade range UI, compute `gradeLevels[]` from range using `GRADE_LEVEL_DESCRIPTORS`, display as read-only pills, "Additional Grade Levels" multi-select for non-contiguous

**Validation:**
- All three sub-sections render and collapse/expand
- Dynamic add/remove works for ID codes
- Multi-select for categories and grade levels works
- Auto-suggestions from school type work

---

### Task 3.2: Add Ed-Fi Classification Fields Section to School Form (Frontend)

**Repo:** `edforge-saas-frontend`
**Update:** `apps/shell/src/pages/settings/schools.tsx`

**Description:** Add Phone Numbers + Charter/Federal Classification + Accountability Ratings sections.

**Implementation:**
- **Phone Numbers**: dynamic list (Phone + Type Descriptor from `INSTITUTION_TELEPHONE_NUMBER_TYPE_DESCRIPTORS`), first auto-set to "Main", keep simple `phone` mapped to first "Main"
- **Federal & State Classification** collapsible section: Charter Status, Charter Approval Agency Type (conditional), Administrative Funding Control, Title I Designation. Auto-show charter fields when school type = "charter"
- **Accountability & Ratings** collapsible section: dynamic list (Title, Rating, Organization, School Year, Date)

**Validation:**
- Phone add/remove works, defaults to Main
- Charter fields conditional on school type
- Accountability entries add/remove
- All data in create payload

---

### Task 3.3: Create Ed-Fi Education Organization Mappers + Publish v0.3.0

**Repo:** `packages/shared-types`
**File:** `src/mappers/edfi/education-org.mapper.ts` (new)
**Update:** `package.json` (version bump to 0.3.0)

**Description:** Mapper functions converting EdForge EdOrg data to Ed-Fi format, then publish.

**Implementation:**
- `toEdFiSchool(school)` → Ed-Fi School JSON (schoolId, nameOfInstitution, categories, gradeLevels, addresses, identificationCodes, telephones, localEducationAgencyReference)
- `toEdFiLocalEducationAgency(lea)` → Ed-Fi LEA JSON
- `toEdFiStateEducationAgency(sea)` → Ed-Fi SEA JSON
- `toEdFiEducationServiceCenter(esc)` → Ed-Fi ESC JSON
- `toEdFiDescriptorUri(namespace, value)` → `uri://ed-fi.org/{namespace}#{value}`
- Batch conversion functions
- Bump to v0.3.0, test, build, publish, update consumers

**Validation:**
- **Test:** `education-org.mapper.test.ts` — valid Ed-Fi format, correct URIs, null/undefined → omitted
- Both consumers compile

---

### Task 3.4: Add Ed-Fi Preview Panel to School Creation (Frontend)

**Repo:** `edforge-saas-frontend`
**File:** `apps/shell/src/components/settings/EdFiPreview.tsx` (new)
**Update:** `apps/shell/src/pages/settings/schools.tsx`

**Description:** Collapsible preview panel showing real-time Ed-Fi JSON.

**Implementation:**
- Collapsible panel at form bottom, uses `toEdFiSchool()` on `useWatch()` form data
- JSON syntax highlighting, validation indicators (green/amber/red), "Copy JSON" button

**Validation:**
- Real-time updates, formatted JSON, copy works

---

## Sprint 4: Staff Creation Wizard — Core Flow

**Goal:** Replace `CreateUserModal` with multi-step Staff Creation Wizard. Backend atomic creation from Sprint 1A.

**Demo:** People → Staff → "Add Staff" → wizard: Personal Info → Contact → Employment → Assignment → Review → Submit creates Staff + User atomically.

---

### Task 4.1: Create Staff Service Layer (Frontend)

**Repo:** `edforge-saas-frontend`
**File:** `apps/people/src/services/staff.service.ts` (new)

**Description:** Dedicated staff service calling Identity backend endpoints.

**Implementation:**
- Staff CRUD: `createStaff(data)` (POST /staff with `createUserAccount` flag), `getStaff(id)`, `updateStaff(id, data)`, `deleteStaff(id)`, `listStaff(filters)`, `searchStaff(term)`
- Assignments: `getStaffAssignments(id)`, `assignStaffToSchool(id, data)`, `updateStaffAssignment(id, aid, data)`, `removeStaffAssignment(id, aid)`
- Employment: `updateEmploymentStatus(id, data)`, `getEmploymentHistory(id)`
- Sections: `getStaffSections(id)` — **Note:** This calls `GET /staff/:id/sections`. For Sprint 4, if backend cross-service call is not ready, use a frontend orchestration pattern (call Academics service directly to get sections for a teacher, join with staff data).
- Credentials: `getStaffCredentials(id)`, `addCredential(id, data)`, `updateCredential(id, cid, data)`, `deleteCredential(id, cid)` — **Note:** These call the **already-existing** backend credential endpoints. No new backend work needed.
- Leave: `getLeaveRequests(id)`, `createLeaveRequest(id, data)`, `getLeaveBalance(id)` — **Note:** These call **already-existing** backend leave endpoints.
- All typed with `@aibrains/shared-types` DTOs

**Validation:**
- TypeScript compiles, matches existing service patterns

---

### Task 4.2: Define Staff Wizard Configuration (Frontend)

**Repo:** `edforge-saas-frontend`
**File:** `apps/people/src/config/staff-wizard.config.tsx` (new)

**Description:** Wizard step config using `@edforge/wizard` types.

**Implementation:**
- 5 steps with step-level Zod schemas (subsets of `createStaffSchema`):
  1. Personal Info: firstName, lastSurname, staffUniqueId, etc.
  2. Contact & Address: email, phones, addresses, emergency contacts
  3. Employment: role, type, hireDate, department, title, account setup
  4. School Assignment: primarySchoolId, FTE, additional assignments
  5. Review & Submit: read-only summary

**Validation:**
- Compiles, each step schema validates independently

---

### Task 4.3: Create Staff Wizard Steps (Frontend)

**Repo:** `edforge-saas-frontend`
**Files:**
- `apps/people/src/components/staff/wizard/PersonalInfoStep.tsx` (new)
- `apps/people/src/components/staff/wizard/ContactStep.tsx` (new)
- `apps/people/src/components/staff/wizard/EmploymentStep.tsx` (new)
- `apps/people/src/components/staff/wizard/AssignmentStep.tsx` (new)
- `apps/people/src/components/staff/wizard/ReviewStep.tsx` (new)

**Description:** All 5 wizard step components.

**Implementation:**
- **Personal Info**: two-column grid, First/Last Name, Staff ID (auto-generate), Maiden Name, DOB, Gender, Ethnicity
- **Contact**: email + type, phone list + types, address list + types, emergency contacts
- **Employment**: role dropdown, employment type, hire date, department, title, experience, HQT (conditional on teacher), account setup toggle (email pre-filled, global role, temp password)
- **Assignment**: primary school (searchable, shows "School (LEA)" for disambiguation), role at school, department, begin date, FTE slider, additional assignments, total FTE indicator
- **Review**: summary cards per step, "Edit" links, missing fields show em-dash, submit button with loading, calls `staffService.createStaff()`, success → toast + navigate to detail

**Validation:**
- Each step validates independently, required fields enforced
- Assignment: FTE 0.0-1.0, only one primary
- Review: edit links navigate correctly, submit works

---

### Task 4.4: Wire Staff Wizard into Staff Directory (Frontend)

**Repo:** `edforge-saas-frontend`
**Update:** `apps/people/src/routes/staff.tsx`

**Description:** Replace "Add Staff" to launch wizard.

**Implementation:**
- Split button: "Add Staff Member" (wizard) + dropdown "Quick Add User" (old modal)
- Mount `WizardModal` with config, on complete invalidate queries

**Validation:**
- Wizard opens, quick add still works, list refreshes after creation

---

### Task 4.5: Enhanced Staff Directory Filters (Frontend)

**Repo:** `edforge-saas-frontend`
**Update:** `apps/people/src/routes/staff.tsx`

**Description:** Filter bar for staff directory.

**Implementation:**
- Collapsible filter bar: Role, Department, School, Employment Status, Employment Type, Staff ID search
- Filter chips + "Clear All", URL query params for shareable views
- Updated DataTable columns: Role, Department, School (hideable)

**Validation:**
- Filters compose (AND), chips removable, URL reflects state

---

## Sprint 5: Staff Profile Enhancement & Full Management

**Goal:** Enhance staff detail page with full Ed-Fi demographics, assignment CRUD, credentials, leave management, and employment history.

**Demo:** View staff profile with full demographics, manage assignments, credentials, leave requests, employment history timeline.

---

### Task 5.1: Enhance Staff Detail Page — Overview Tab (Frontend)

**Repo:** `edforge-saas-frontend`
**Update:** `apps/people/src/routes/staff/detail.tsx`

**Description:** Show full Ed-Fi demographics, contact, and employment data.

**Implementation:**
- **Dual fetch:** Add `useQuery(['staff', staffId])` alongside existing user query. Resolve staffId from URL or via userId lookup (handle case where User exists but no linked Staff record).
- Cards: Demographics (name, ID, DOB, gender, ethnicity), Contact (emails/phones/addresses with type badges), Employment (role, type, status, hire date, department, FTE, experience), Emergency Contacts
- Inline edit buttons (pencil → edit modal) with ABAC checks
- Handle no-staff fallback: show User data only with "Complete Staff Profile" CTA

**Validation:**
- Staff data loads, type badges render, empty fields show em-dash, no-staff fallback works

---

### Task 5.2: Enhance Staff Detail Page — Assignments Tab (Frontend)

**Repo:** `edforge-saas-frontend`
**Update:** `apps/people/src/routes/staff/detail.tsx`

**Description:** Full assignment CRUD with FTE tracking.

**Implementation:**
- DataTable: School, Role, Department, FTE, Begin/End Date, Status (Primary badge), Actions
- Add/Edit Assignment modal, Remove with confirmation
- FTE total with overcommitment warning, primary assignment protection

**Validation:**
- CRUD works, FTE accurate, primary enforced

---

### Task 5.3: Create Staff Credentials Management (Frontend)

**Repo:** `edforge-saas-frontend`
**File:** `apps/people/src/components/staff/CredentialsSection.tsx` (new)
**File:** `apps/people/src/components/staff/CredentialModal.tsx` (new)

**Description:** Credentials tab consuming **already-existing** backend endpoints.

**Implementation:**
- Card layout: type badge, credential ID, field, grade levels, issue/expiration dates
- Expiration colors: green (>6mo), amber (<=6mo), red (expired)
- Create/Edit modal using `createCredentialSchema` from shared-types
- Service calls to existing `staff/:staffId/credentials/*` endpoints
- Empty state + "Add Credential" CTA

**Validation:**
- Cards render, expiration colors correct, CRUD works

---

### Task 5.4: Add Staff Employment History Timeline (Frontend)

**Repo:** `edforge-saas-frontend`
**File:** `apps/people/src/components/staff/EmploymentHistory.tsx` (new)

**Description:** Timeline of employment status changes.

**Implementation:**
- Vertical timeline with date nodes, status badges, reason, notes, changed by
- "Update Status" button → modal (new status, date, reason, notes)
- Calls `staffService.updateEmploymentStatus()`

**Validation:**
- Chronological rendering, color-coded badges, update works

---

### Task 5.5: Staff Section Associations — Read-Only (Frontend)

**Repo:** `edforge-saas-frontend`
**File:** `apps/people/src/components/staff/SectionAssociations.tsx` (new)

**Description:** Teacher's class/section associations (read-only).

**Implementation:**
- Show only for teaching roles
- **Cross-service pattern:** Frontend calls Academics service directly (`GET /academics/sections?teacherId={staffId}`) to get section data, then joins with staff info client-side. This avoids needing Identity→Academics backend communication.
- Table: Course, Section, Period, Room, School, Term + "View in Academics" link
- Group by school, stats summary

**Validation:**
- Renders for teaching staff, non-teaching see message, links work

---

### Task 5.6: Staff Leave Management Tab (Frontend)

**Repo:** `edforge-saas-frontend`
**File:** `apps/people/src/components/staff/LeaveManagement.tsx` (new)

**Description:** Leave management consuming **already-existing** backend endpoints.

**Implementation:**
- **Leave Balance card:** display accrued/used/pending/available per leave type (calls existing `GET /leave/balance/:staffId`)
- **Leave Requests table:** list with status badges, date range, type, reason (calls existing `GET /leave/requests?staffId=`)
- **Create Leave Request** modal: type dropdown (from `leaveTypeSchema`), date range, duration type, reason, notes, emergency contact
- **Approve/Reject** actions (for managers): approve/reject buttons on pending requests with optional comments
- ABAC: staff can see own leave, managers can approve/reject for their school's staff

**Validation:**
- Balance displays correctly, request list renders, create/approve/reject works

---

## Sprint 6: Ed-Fi Integration, Networks & Polish

**Goal:** Complete EdOrg domain with network management, Ed-Fi export, onboarding wizard, and cross-cutting polish.

**Demo:** View complete hierarchy with networks, export Ed-Fi JSON, guided onboarding for new tenants.

---

### Task 6.1: Create EdOrg Network Schemas + Backend Endpoints

**Repo:** `packages/shared-types` + `server/application`
**Shared-types files:**
- `src/schemas/identity/education-org-network.schema.ts` (new)
**Backend files:**
- `microservices/identity/src/common/entities/education-org-network.entity.ts` (new)
- `microservices/identity/src/common/entities/network-association.entity.ts` (new)
- Update `education-organizations.controller.ts`, `education-organizations.service.ts`

**Description:** Full-stack network entity: schemas, DynamoDB entities, API endpoints.

**Implementation:**
- **Schemas:** `createEducationOrgNetworkSchema` (networkPurposeDescriptor, nameOfInstitution, etc.), `createNetworkAssociationSchema` (networkId, memberOrgId, memberType, beginDate, endDate?), response schemas
- **DynamoDB entities:**

| Entity | PK | SK | GSI1 |
|--------|----|----|------|
| NETWORK | `TENANT#{tid}` | `NETWORK#{networkId}` | — |
| NET_ASSOC | `TENANT#{tid}` | `NETWORK#{nid}#MEMBER#{orgId}` | `TENANT#{tid}#ORG#{orgId}` |

- **Backend routes:** CRUD for `/education-organizations/networks`, member management (`POST .../members`, `PATCH .../members/:mid`, `DELETE .../members/:mid`)
- EventBridge events for network changes
- Bump shared-types to v0.4.0, publish, update consumers

**Validation:**
- Schema tests, backend unit tests for network CRUD + member management
- Both consumers compile

---

### Task 6.2: Create Network Management UI (Frontend)

**Repo:** `edforge-saas-frontend`
**File:** `apps/shell/src/components/settings/OrgNetworkManager.tsx` (new)
**File:** `apps/shell/src/components/settings/OrgNetworkForm.tsx` (new)

**Description:** UI for managing networks and their member associations.

**Implementation:**
- Network list DataTable, Network Form modal, Member Management panel
- New "Networks" tab on Organization settings page
- Add hooks/service functions for network endpoints

**Validation:**
- Network CRUD works, member add/remove works, historical members visible

---

### Task 6.3: Organization Setup Onboarding Wizard (Frontend)

**Repo:** `edforge-saas-frontend`
**File:** `apps/shell/src/components/settings/OrgSetupOnboarding.tsx` (new)

**Description:** Guided onboarding for new tenants (moved from Sprint 2 to reduce scope).

**Implementation:**
- Trigger: when `!sea && leas.length === 0`
- Inline steps: Set Up State Agency → Create First District → Assign Schools → Done
- Skip options, stores completion in preferences

**Validation:**
- Appears for new tenants, steps create entities, skip works, doesn't reappear

---

### Task 6.4: Enhanced Ed-Fi Staff Mapper

**Repo:** `packages/shared-types`
**Update:** `src/mappers/edfi/staff.mapper.ts`

**Description:** Add missing Ed-Fi mapper functions. Existing: `toEdFiStaff`, `toEdFiStaffAssignment`, `toEdFiStaffBatch`. Missing: `toEdFiCredential`, `toEdFiStaffSchoolAssociation`.

**Implementation:**
- New: `toEdFiCredential()` — maps credential to Ed-Fi Credential entity
- New: `toEdFiStaffSchoolAssociation()` — distinct from existing assignment mapper, includes academicSubjects, gradeLevels, programAssignment
- Update `toEdFiStaffBatch()` to include credentials and school associations

**Validation:**
- **Test:** New mapper functions produce valid Ed-Fi format
- Existing mapper tests still pass

---

### Task 6.5: Create Ed-Fi Export Preview Dashboard (Frontend)

**Repo:** `edforge-saas-frontend`
**File:** `apps/shell/src/pages/settings/edfi-export-preview.tsx` (new)
**Update:** `apps/shell/src/router.tsx`

**Description:** Page for previewing/validating Ed-Fi export data.

**Implementation:**
- Route: `/settings/organization/edfi-preview`
- Entity type selector, split view (EdForge ↔ Ed-Fi JSON), validation panel, batch validation, copy/download

**Validation:**
- Valid Ed-Fi JSON produced, validation identifies gaps, copy/download works

---

### Task 6.6: Enhance Organization Department Management (Frontend)

**Repo:** `edforge-saas-frontend`
**Update:** Settings department management component

**Description:** Support Ed-Fi OrganizationDepartment with parent org references.

**Implementation:**
- Enhanced form: parent org dropdown (school or LEA), academic subject descriptor, department head
- Allow LEA-level departments

**Validation:**
- Departments at school and LEA level, subject descriptor works

---

### Task 6.7: Error Boundaries & Loading Skeletons (Frontend)

**Repo:** `edforge-saas-frontend`

**Description:** Error boundaries and skeleton states across all new pages.

**Implementation:**
- Error boundaries around hierarchy tree, org detail tabs, wizard steps, form modals
- Loading skeletons matching page layouts

**Validation:**
- Errors caught gracefully, skeletons consistent

---

### Task 6.8: Form Dirty State Warnings & Toast Audit (Frontend)

**Repo:** `edforge-saas-frontend`

**Description:** Unsaved changes warnings and toast consistency.

**Implementation:**
- `useBeforeUnload` + TanStack Router guards for all forms
- Every CRUD op has success/error toast, no duplicates

**Validation:**
- Warnings on all dirty forms, all CRUD ops have toasts

---

### Task 6.9: Responsive Design & Accessibility Audit (Frontend)

**Repo:** `edforge-saas-frontend`

**Description:** Combined responsive + a11y + dark mode audit.

**Implementation:**
- Test at 1024/1280/1440/1920px, fix layout issues
- Tab order, screen reader labels, focus management, ARIA attributes
- Color contrast WCAG AA, dark mode with CSS variable tokens

**Validation:**
- All breakpoints correct, keyboard-only navigation works, dark mode correct

---

## Appendix A: Schema Additions Summary

| Schema File | New/Modified | Package |
|-------------|-------------|---------|
| `education-org-descriptors.ts` | New | shared-types |
| `education-organization.schema.ts` | New | shared-types |
| `local-education-agency.schema.ts` | New | shared-types |
| `state-education-agency.schema.ts` | New | shared-types |
| `education-service-center.schema.ts` | New | shared-types |
| `education-org-hierarchy.schema.ts` | New | shared-types |
| `education-org-network.schema.ts` | New (Sprint 6) | shared-types |
| `school.schema.ts` | Modified | shared-types |
| `education-org.mapper.ts` | New | shared-types |
| `staff.mapper.ts` | Modified (Sprint 6) | shared-types |

## Appendix B: Backend Entity Key Design (DynamoDB)

| Entity | PK | SK | GSI1 |
|--------|----|----|------|
| SEA | `TENANT#{tid}` | `SEA#{seaId}` | — |
| LEA | `TENANT#{tid}` | `LEA#{leaId}` | `TENANT#{tid}#SEA#{seaId}` |
| ESC | `TENANT#{tid}` | `ESC#{escId}` | `TENANT#{tid}#SEA#{seaId}` |
| NETWORK | `TENANT#{tid}` | `NETWORK#{networkId}` | — |
| NET_ASSOC | `TENANT#{tid}` | `NETWORK#{nid}#MEMBER#{orgId}` | `TENANT#{tid}#ORG#{orgId}` |
| STAFF_ASSIGN | `TENANT#{tid}` | `STAFF#{sid}#ASSIGN#{aid}` | `TENANT#{tid}#SCHOOL#{schoolId}` |
| STAFF_EMP_HIST | `TENANT#{tid}` | `STAFF#{sid}#EMPHIST#{ts}` | — |
| SCHOOL (updated) | `TENANT#{tid}` | `SCHOOL#{schoolId}` | (no new GSI — in-memory filter for MVP) |

**Note:** School→LEA GSI deferred to Phase 2 optimization. MVP uses in-memory filtering after querying all schools for a tenant.

## Appendix C: API Endpoints Summary

| Service | Endpoint | Methods | Status |
|---------|----------|---------|--------|
| EdOrg | `/education-organizations/sea` | GET, PUT | New (Sprint 1A) |
| EdOrg | `/education-organizations/leas` | GET, POST | New (Sprint 1A) |
| EdOrg | `/education-organizations/leas/:id` | GET, PATCH, DELETE | New (Sprint 1A) |
| EdOrg | `/education-organizations/escs` | GET, POST | New (Sprint 1A) |
| EdOrg | `/education-organizations/escs/:id` | GET, PATCH, DELETE | New (Sprint 1A) |
| EdOrg | `/education-organizations/hierarchy` | GET | New (Sprint 1A) |
| EdOrg | `/education-organizations/networks` | GET, POST | New (Sprint 6) |
| EdOrg | `/education-organizations/networks/:id` | GET, PATCH, DELETE | New (Sprint 6) |
| EdOrg | `/education-organizations/networks/:id/members` | POST | New (Sprint 6) |
| EdOrg | `/education-organizations/networks/:id/members/:mid` | PATCH, DELETE | New (Sprint 6) |
| Staff | `/staff` | GET, POST (atomic w/ user) | Enhanced (Sprint 1A) |
| Staff | `/staff/:id` | GET, PATCH, DELETE | Existing |
| Staff | `/staff/:id/assignments` | GET, POST | New (Sprint 1A) |
| Staff | `/staff/:id/assignments/:aid` | PATCH, DELETE | New (Sprint 1A) |
| Staff | `/staff/:id/credentials` | GET, POST | **Already exists** |
| Staff | `/staff/:id/credentials/:cid` | GET, PATCH, DELETE | **Already exists** |
| Staff | `/staff/:id/employment-status` | POST | New (Sprint 1A) |
| Staff | `/staff/:id/employment-history` | GET | New (Sprint 1A) |
| Leave | `/leave/requests` | GET, POST | **Already exists** |
| Leave | `/leave/requests/:id` | PATCH | **Already exists** |
| Leave | `/leave/balance/:staffId` | GET | **Already exists** |

## Appendix D: Component Dependency Graph

```
Sprint 1A (Data Foundation) — no dependencies
├── Tasks 1A.1–1A.4: Shared-types schemas (can run in parallel)
├── Task 1A.5: School schema enhancement + Publish v0.2.0 (blocks 1A.6+)
├── Tasks 1A.6–1A.7d: DynamoDB entities + Backend endpoints (can start after 1A.5)
│   ├── 1A.7a: SEA endpoints (establishes module)
│   ├── 1A.7b: LEA endpoints (depends on 1A.7a for module)
│   ├── 1A.7c: ESC endpoints (depends on 1A.7a for module)
│   └── 1A.7d: Hierarchy assembly (depends on 1A.7a-c)
├── Task 1A.8: EventBridge events (after 1A.7a-c)
├── Tasks 1A.9a-c: Staff enhancements (independent of EdOrg work)
├── Tasks 1A.10a-b: ABAC (backend + frontend, independent)
├── Task 1A.11: School LEA reference (after 1A.7b for LEA validation)
├── Task 1A.12: Integration tests (after all backend tasks)
└── Task 1A.13: Dev seed script (after all backend tasks)

Sprint 1B (Hierarchy UI) — depends on Sprint 1A
├── Task 1B.0: Frontend testing infrastructure
├── Tasks 1B.1-1B.2: Service layer + hooks
├── Task 1B.3: Hierarchy tree component
├── Task 1B.4: Organization settings page + route
└── Task 1B.5: Orphaned school assignment

Sprint 2 (Hierarchy CRUD) — depends on Sprint 1B
├── Tasks 2.1–2.3: SEA, LEA, ESC forms
├── Task 2.4: CRUD integration on hierarchy page
├── Task 2.5: Organization detail page
└── Task 2.6: School → LEA link

Sprint 3 (Enhanced School) — depends on Sprint 2
├── Task 3.1: Ed-Fi identity fields (ID codes + categories + grades)
├── Task 3.2: Ed-Fi classification fields (phones + charter + accountability)
├── Task 3.3: Ed-Fi org mappers + Publish v0.3.0
└── Task 3.4: Ed-Fi preview panel

Sprint 4 (Staff Wizard) — depends on Sprint 1A + Sprint 2
├── Task 4.1: Staff service layer
├── Task 4.2: Wizard configuration
├── Task 4.3: All 5 wizard step components
├── Task 4.4: Wizard integration into staff directory
└── Task 4.5: Staff directory filters

Sprint 5 (Staff Profile) — depends on Sprint 4
├── Task 5.1: Enhanced overview tab
├── Task 5.2: Assignments tab (CRUD)
├── Task 5.3: Credentials management (existing backend)
├── Task 5.4: Employment history timeline
├── Task 5.5: Section associations (frontend orchestration)
└── Task 5.6: Leave management (existing backend)

Sprint 6 (Integration & Polish) — depends on Sprints 3 + 5
├── Task 6.1: Network schemas + backend (full-stack)
├── Task 6.2: Network management UI
├── Task 6.3: Onboarding wizard
├── Task 6.4: Enhanced staff mapper
├── Task 6.5: Ed-Fi export preview dashboard
├── Task 6.6: Department enhancement
├── Task 6.7: Error boundaries & skeletons
├── Task 6.8: Form dirty state & toasts
└── Task 6.9: Responsive & accessibility audit
```

### Parallel Execution Opportunities

- **Sprints 3 and 4** can run in parallel: Sprint 3 touches Shell app (school forms), Sprint 4 touches People app (staff wizard). Coordinate on shared-types v0.3.0 timing.
- **Within Sprint 1A:** Schema tasks (1A.1-1A.4) can run in parallel. Backend tasks (1A.6-1A.7d) can start once v0.2.0 is published. Staff tasks (1A.9a-c) are independent of EdOrg tasks.

## Appendix E: Task Count Summary

| Sprint | Tasks | Shared-Types | Backend | Frontend |
|--------|-------|-------------|---------|----------|
| 1A | 16 | 5 | 10 | 1 |
| 1B | 6 | 0 | 0 | 6 |
| 2 | 6 | 0 | 0 | 6 |
| 3 | 4 | 1 | 0 | 3 |
| 4 | 5 | 0 | 0 | 5 |
| 5 | 6 | 0 | 0 | 6 |
| 6 | 9 | 1 | 1 | 7 |
| **Total** | **52** | **7** | **11** | **34** |

## Appendix F: Review & Improvement Log

### v2.1 Review (Senior Engineering Manager + Ed-Fi Domain Expert)

**Critical Fixes Applied:**
1. **C1:** Task 1A.8 split into 4 sub-tasks (SEA, LEA, ESC, Hierarchy endpoints) — was 20+ routes in one task
2. **C2:** Task 1A.9 split into 3 sub-tasks (Assignments, History, Atomic creation) — conflated unrelated concerns
3. **C3:** Added EventBridge events task (1A.8) — existing pattern was not followed for new entities
4. **C4:** Credential endpoints marked as **already existing** — no new backend work needed
5. **C5:** School→LEA GSI deferred to Phase 2 — MVP uses in-memory filtering to avoid DynamoDB infrastructure change
6. **C6:** Added backend integration tests task (1A.12)

**High Fixes Applied:**
1. **H1:** Added leave management UI (Task 5.6) — backend exists, needs frontend
2. **H2:** Documented `@edforge/types` vs `@aibrains/shared-types` boundary in Current State Assessment
3. **H3:** Split ABAC task into separate backend (1A.10a) and frontend (1A.10b) tasks
4. **H4:** Moved network work from Sprint 1A to Sprint 6 — reduces Sprint 1A overload
5. **H5:** Hierarchy assembly is now a dedicated task (1A.7d) with algorithm specification
6. **H6:** Cross-service staff sections: frontend orchestration pattern specified (calls Academics directly)
7. **H7:** Added frontend testing infrastructure task (1B.0)

**Medium Fixes Applied:**
1. **M1:** Added dev seed script (Task 1A.13)
2. **M3:** Shared-types publish merged into last schema task per sprint (not standalone)
3. **M4:** Onboarding wizard moved from Sprint 2 to Sprint 6
4. **M6:** Sprint 3 school form tasks consolidated (7→4) to reduce merge conflicts

### Risk Register

| Risk | Task(s) | Mitigation |
|------|---------|------------|
| Hierarchy assembly performance | 1A.7d | In-memory filter for MVP; test with 100+ entities; defer GSI |
| Atomic staff+user creation | 1A.9c | Saga pattern; dedicated tests for partial failure |
| Sprint 1A size (16 tasks) | Sprint 1A | Parallelizable; staff work independent of EdOrg |
| Shared-types version coordination | 1A.5, 3.3, 6.1 | Use exact versions; publish gates sprint transitions |
| School form merge conflicts | 3.1, 3.2 | Consolidated to 2 tasks (was 7) |
