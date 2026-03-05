# EdForge Enrollment Module: MVP Pilot Review & Sprint Plan

## Executive Summary

This document presents a comprehensive technical review of the Student Enrollment workflow in EdForge, covering both the frontend (Next.js/React) and backend (NestJS) implementations. The review is conducted against Ed-Fi Alliance Data Standard v6 best practices for the Enrollment Domain, with the goal of achieving MVP readiness for pilot school onboarding.

**Overall Assessment:** The enrollment system has a solid architectural foundation with proper tenant isolation, Ed-Fi descriptor alignment, and a well-structured multi-step wizard. However, several critical gaps, bugs, and missing features must be addressed before pilot deployment.

---

## Part 1: Comprehensive Technical Review

### 1.1 Ed-Fi Compliance Gap Analysis

The Ed-Fi Enrollment Domain centers on the **StudentSchoolAssociation (SSA)** entity with a composite natural key of `Student + School + EntryDate`. EdForge's enrollment entity maps to this concept but has several compliance gaps:

| Ed-Fi Requirement | EdForge Status | Gap |
|---|---|---|
| SSA natural key: Student + School + EntryDate | **Partial** - Uses `ENROLLMENT#{schoolId}#{yearId}#{studentId}` as SK | SK includes yearId but not EntryDate; re-enrollment same year with different entry dates would collide |
| One SSA per student per school year minimum | **Implemented** - Duplicate check enforced | OK |
| No multi-year enrollments | **Not enforced** - No system-level guard | Need end-of-year processing workflow |
| ExitWithdrawDate + ExitWithdrawType always paired | **Partial** - Withdrawal sets date but type descriptor handling is incomplete | exitWithdrawTypeDescriptor exists in entity but withdrawal flow doesn't require it |
| No-show handling via exit, not deletion | **Not implemented** - No no-show workflow | Need no-show exit type handling |
| End-of-year closure (zero open enrollments) | **Not implemented** | Need batch end-of-year processing |
| One primary school at a time | **Implemented** - Overlap check in createEnrollment | OK |
| New SSA on grade/residency/FTE/calendar change | **Not implemented** - Updates are in-place patches | Should close current + open new SSA |
| Delete only for data-entry mistakes | **Partially enforced** - Soft delete exists | No hard delete guard |
| Descriptors pre-loaded before enrollment | **Not enforced** - Descriptors are hardcoded strings, not validated against a registry | Acceptable for MVP |
| SEORA for non-enrollment accountability | **Not implemented** | Defer to post-MVP |
| StudentTransportation | **Not implemented** | Defer to post-MVP |
| CrisisEvent displaced students | **Not implemented** | Defer to post-MVP |

### 1.2 Backend Review

#### 1.2.1 Student Creation (POST /academics/students)

**What works well:**
- School validation via Identity Service with graceful degradation
- Atomic student number generation (`{SchoolCode}-{Year}-{Sequence}`) using DynamoDB counters
- Guardian data stored with `hasPortalAccess` flag and `userId` placeholder
- Duplicate detection endpoint for CSV imports
- ABAC permission guard (`students:create`)

**Issues found:**

1. **Student number uniqueness not validated at creation** - When `studentNumber` is manually provided, `StudentIdService.isUniqueIdTaken()` exists but is never called during creation. Risk: duplicate student numbers within a school.

2. **Guardian email not required when hasPortalAccess=true** - No validation enforcing that a guardian must have an email address if portal access is granted. This will cause failures when account creation is implemented.

3. **Medical info stored in plaintext** - All medical data (allergies, conditions, physician info, insurance) stored without field-level encryption. DynamoDB encryption-at-rest partially mitigates, but HIPAA best practice calls for field-level encryption for PII/PHI.

4. **No minimum guardian requirement** - A student can be created with zero guardians. For K-12, at least one guardian/emergency contact should be required.

5. **Enrollment events not published** - `EnrollmentCompleted`, `StudentWithdrawn`, and `StudentTransferred` event methods are defined in `AcademicsEventsService` but **never called** from enrollment operations. This breaks event-driven workflows (notifications, audit, analytics).

6. **Data from API response missing fields** - The student response omits `employer` and `occupation` from guardian data, and `dietaryRestrictions` from medicalInfo. These fields are sent in the request but silently dropped.

7. **Contact info `street1` missing** - Looking at the API payload and response, `street1` is absent but `street2` is present. The address schema has `street1` as optional, but the form and API don't enforce a primary street address.

#### 1.2.2 Enrollment Creation (POST /academics/enrollments)

**What works well:**
- Academic year validation (must be 'active' status)
- Entry date range validation within academic year
- Duplicate enrollment prevention (same student + school + year)
- Primary school overlap check across schools
- Ed-Fi descriptor fields properly stored
- Smart defaults (primarySchool=true, FTE=1.0, repeatGradeIndicator=false)
- Student record updated with current grade and primary school

**Issues found:**

1. **Planning year enrollment rejected but shown in UI** - Frontend shows academic years with 'planning' status and displays "Enrollment will be set to Pending" message, but the backend rejects non-active years with `BadRequestException`. This is a critical UX inconsistency - users will see an option they can't use.

2. **Enrollment status hardcoded to 'enrolled'** - Line 136 of enrollment.service.ts always sets `status: 'enrolled'` regardless of context. There's no 'pending' status path, no pre-registration workflow. The entity supports `pending` status but the service never sets it.

3. **No enrollment status lifecycle/state machine** - Valid transitions (enrolled→withdrawn, enrolled→transferred, enrolled→graduated) are not enforced. Any status can be set to any other status via PATCH.

4. **FTE validation gap** - Backend accepts any number for `fullTimeEquivalency` without range validation. Frontend Zod schema validates 0-1 range but backend DTO does not. Risk: Invalid FTE values (1.5, -0.5) stored if API called directly.

5. **Withdrawal flow incomplete** - `withdrawStudent()` updates enrollment and student status but:
   - Does NOT require `exitWithdrawTypeDescriptor` (Ed-Fi required)
   - Does NOT publish `StudentWithdrawn` event
   - Does NOT check for dependent section enrollments

6. **Transfer flow incomplete** - `transferStudent()` creates new enrollment at destination but:
   - Does NOT close the source enrollment with proper exit date/type
   - Does NOT publish `StudentTransferred` event
   - Does NOT handle transfer documents

7. **Re-enrollment same year different dates** - SK is `ENROLLMENT#{schoolId}#{yearId}#{studentId}` which means a student can only have ONE enrollment per school per year. Ed-Fi requires separate SSAs when a student withdraws and re-enrolls. This is a data model limitation.

#### 1.2.3 Identity Service & Portal Access

**What exists:**
- Cognito user creation with `AdminCreateUserCommand`
- School-level roles including `Parent` (seniority: 10) and `Student` (seniority: 20)
- Default permissions for Parent: `parent-portal:grades`, `parent-portal:attendance`, `parent-portal:schedule`, `parent-portal:fees`
- Default permissions for Student: `student-portal:grades`, `student-portal:attendance`, `student-portal:schedule`, `student-portal:assignments`
- Tenant feature toggles: `parentPortal`, `studentPortal`
- `RoleSyncService` for bridging staff→ABAC roles

**What's completely missing:**
- No workflow to create parent user accounts when `hasPortalAccess=true`
- No event from Academics→Identity when guardian portal access is granted
- No parent-to-student data scope filtering (parents can't see only their own children)
- No student account creation flow
- No parent/student onboarding email
- No `userId` linkage back to guardian record after account creation
- No account lifecycle management (deactivate when enrollment ends)

### 1.3 Frontend Review

#### 1.3.1 Multi-Step Registration Wizard

**Architecture:** Custom `@edforge/wizard` package + React Hook Form + Zod validation. 6 steps: Personal → Contact → Guardians → Medical → Enrollment → Review.

**What works well:**
- Step-scoped Zod validation schemas
- Duplicate detection between Step 1→2 transition
- Smart defaults for enrollment fields
- Academic year auto-selection
- Enrollment date constraint to academic year range
- Progressive disclosure (transfer fields show only for transfer type)
- Framer Motion transitions

#### 1.3.2 CONFIRMED BUG: Medical Form Data Loss

**Root Cause Identified:** Shallow merge in `WizardContext.updateData()` combined with dual data management (React Hook Form + direct wizard updates).

**Reproduction Steps:**
1. In Medical step, add tags to Allergies, Medications, Conditions, or Dietary Restrictions
2. Then type in any Physician Information field (physicianName, physicianPhone, etc.)
3. Observe: all tag data is wiped

**Technical Explanation:**

The bug is in `useWizardForm.ts` line 52 and `WizardContext.tsx` line 113:

```
[useWizardForm.ts:52] - RHF watch fires with only RHF-registered fields
    → calls updateData(values) where values.medicalInfo only has physician fields
    → does NOT include TagInput arrays (allergies, medications, etc.)

[WizardContext.tsx:113] - Shallow merge: setFormData(prev => ({...prev, ...data}))
    → data.medicalInfo = { physicianName: 'Dr. Smith', ... } (no arrays)
    → Overwrites prev.medicalInfo entirely
    → Tag arrays are lost
```

TagInput components bypass React Hook Form - they call `updateTags()` → `updateData()` directly. When a physician TextField changes, RHF's watch callback fires with values that only contain RHF-registered fields. The `medicalInfo` object in those values has physician fields but NOT the tag arrays. The shallow spread in `updateData` then replaces the entire `medicalInfo` object, losing the tags.

**Fix:** Deep merge in `updateData`, or register tag arrays with RHF, or merge at the `medicalInfo` level before calling `updateData`.

#### 1.3.3 IEP/504 Plan Fields Need Removal

Per requirements, Special Education features are deferred to post-MVP. Currently present:

**Frontend:**
- `MedicalStep.tsx` lines 127-157: "Special Education" section with IEP checkbox, 504 Plan checkbox, Special Programs tags, Accommodations tags
- `student.form.ts` lines 175-176: `hasIEP` and `has504Plan` in Zod schema
- `student.form.ts` lines 269-270: `hasIEP: false, has504Plan: false` in defaults

**Backend:**
- `student.mapper.ts` lines 274-275: `hasIEP: undefined, has504Plan: undefined`
- Entity schema includes these fields

#### 1.3.4 Enrollment Type Radio Layout

Currently rendered as vertical radio group (`direction="vertical"` in `EnrollmentStep.tsx` line 140). The RadioGroupField component supports `direction: 'horizontal' | 'vertical'`. Changing to horizontal would reduce vertical space significantly since there are only 4 options with short labels.

#### 1.3.5 Enrollment Configuration Section

The "Enrollment Configuration - Additional enrollment parameters with smart defaults" section contains:

| Field | Purpose | Default | Ed-Fi Alignment |
|---|---|---|---|
| **Primary School** | Marks this as the student's primary enrollment. Backend prevents multiple primary enrollments per academic year across schools. | `true` (checked) | `StudentSchoolAssociation.PrimarySchool` |
| **FTE** | Full-Time Equivalency. 1.0 = full-time student, 0.5 = half-time. Used for funding calculations and state reporting. | `1.0` | `StudentSchoolAssociation.FullTimeEquivalency` |
| **Repeat Grade** | Indicates student is repeating the same grade level. Affects state reporting, academic tracking, and grade promotion logic. | `false` (unchecked) | `StudentSchoolAssociation.RepeatGradeIndicator` |

**Issues:** "Smart defaults" is just pre-populating these 3 fields with sensible values. The label "Additional enrollment parameters with smart defaults" is confusing - should be clearer.

#### 1.3.6 Repeat Grade Business Logic

The `repeatGradeIndicator` checkbox:
- **What it does now:** Stores a boolean flag on the enrollment entity. No business logic attached.
- **What it should do (Ed-Fi):** When `repeatGradeIndicator=true`, the student's `entryGradeLevelDescriptor` should match their previous year's grade level. State reporting uses this to identify retained students. No special business logic is triggered in EdForge currently - it's purely a reporting flag.
- **MVP Assessment:** Storing the flag is sufficient for MVP. Business logic (preventing grade promotion, triggering counselor notifications) can be added post-MVP.

#### 1.3.7 Enrollment Page Design Assessment

**Current issues:**
- Page looks basic and premature for pilot deployment
- Enrollment Type radio buttons take excessive vertical space
- "Enrollment Configuration" section title unclear
- No progress auto-save (data lost on page refresh)
- No confirmation dialog when skipping optional steps
- Transfer fields lack required validation when transfer type selected
- No visual hierarchy distinguishing required vs optional sections
- Date fields don't show validation feedback until form submission
- No tooltip or help icons explaining Ed-Fi fields to non-technical staff

#### 1.3.8 Student Directory & Enrollment Dashboard

**Student Directory** shows proper data including student names, IDs, grades, status, enrollment dates, contact info. However:
- Student table shows partial student IDs (e.g., "82414f67") instead of full names in the enrollment dashboard
- No avatar/initials on enrollment dashboard (present on student directory)
- Enrollment dashboard "Type" column shows "New" but this isn't mapping to Ed-Fi EntryType

#### 1.3.9 API Payload/Response Analysis

From the provided API calls:

**Student Creation Payload Issues:**
- `contactInfo.address` has `street2` but no `street1` - this should be validated
- `guardians[].employer` and `guardians[].occupation` are sent but not returned in response - data silently dropped
- `medicalInfo.dietaryRestrictions` sent as empty array but not in response object

**Enrollment Creation Payload:**
- `entryGradeLevelDescriptor: "First grade"` - correct Ed-Fi mapping
- `entryTypeDescriptor: "Original entry into a United States school"` - correct
- `enrollmentTypeDescriptor: "Current"` - correct (all types map to "Current")
- `residencyStatusDescriptor: "Not a resident of this state"` - correct
- Missing: `calendarCode` (acceptable for MVP)

**Student Profile Endpoint (GET /students/:id/profile):**
- Returns aggregated view with student data + enrollments + attendance
- Attendance queries use date range parameters - properly scoped

### 1.4 Portal Access Architecture Review

#### 1.4.1 Current State

When `hasPortalAccess=true` is checked for a guardian:
1. The flag is stored in the guardian object within the student DynamoDB record
2. No user account is created
3. No notification is sent
4. The `userId` field on the guardian remains `undefined`

#### 1.4.2 Required Architecture for MVP

**Minimum Viable Portal Access:**

1. **During Enrollment (hasPortalAccess=true):**
   - Validate guardian has email address
   - After student + enrollment created successfully, call Identity Service to create parent user
   - Identity Service creates Cognito user with temporary password
   - Assigns `Parent` role at the student's school
   - Stores `userId` back in guardian record
   - Sends welcome email with login credentials

2. **From Student Profile (post-enrollment):**
   - "Grant Portal Access" button on guardian detail
   - "Create Student Account" button on student profile
   - Same flow as enrollment but triggered from profile page

3. **Data Scope for Parents:**
   - Parent can only view their linked student(s)
   - DataScopeService needs `parent` scope type: `{ type: 'student', studentIds: [linked] }`

4. **Account Lifecycle:**
   - When student withdraws/transfers → deactivate parent account at that school
   - When guardian `hasPortalAccess` toggled off → deactivate parent user

---

## Part 2: Sprint Plan

### Sprint 1: Critical Bug Fixes & Data Integrity
**Goal:** Fix blocking bugs and ensure data integrity for all enrollment operations.

#### Ticket 1.1: Fix Medical Form Data Loss Bug
**Description:** Fix the shallow merge bug in `WizardContext.updateData()` that causes TagInput data (allergies, medications, conditions, dietary restrictions) to be wiped when physician information fields are edited.

**Technical Approach:** Implement deep merge for nested objects in `updateData`, or ensure the `useWizardForm` watch callback merges RHF values with existing wizard data at the nested object level before calling `updateData`.

**Files to modify:**
- `packages/wizard/src/WizardContext.tsx` - Change `updateData` to perform deep merge for nested objects
- OR `apps/academics/src/hooks/useWizardForm.ts` - Merge RHF watch values with existing data before calling updateData

**Validation:**
1. Add allergies/medications/conditions/dietary tags
2. Edit physician name/phone
3. Verify tags are preserved
4. Navigate forward and back - verify tags persist
5. Submit form - verify all medical data in API payload

#### Ticket 1.2: Remove IEP/504 Plan Fields (Special Education Deferral)
**Description:** Remove Special Education fields (IEP checkbox, 504 Plan checkbox) from the Medical step and form schemas. Special Programs and Accommodations tag inputs should also be removed as they are part of the Special Education feature set.

**Files to modify:**
- `apps/academics/src/components/students/registration/steps/MedicalStep.tsx` - Remove "Special Education" section (lines 127-157)
- `apps/academics/src/schemas/student.form.ts` - Remove `hasIEP`, `has504Plan` from schema and defaults
- `server/application/microservices/academics/src/common/mappers/student.mapper.ts` - Remove `hasIEP`/`has504Plan` mapping

**Validation:** Enrollment form medical step no longer shows Special Education section. Form submission succeeds without IEP/504 fields.

#### Ticket 1.3: Fix Guardian Data Fields Being Dropped
**Description:** Guardian `employer` and `occupation` fields are sent in the student creation payload but silently dropped from the API response and possibly not persisted. Also, `medicalInfo.dietaryRestrictions` is sent but not returned.

**Files to investigate/modify:**
- `server/application/microservices/academics/src/common/mappers/student.mapper.ts` - Ensure employer/occupation are included in entity→DTO mapping
- `server/application/microservices/academics/src/common/entities/student.entity.ts` - Verify Guardian interface includes employer/occupation
- Verify `dietaryRestrictions` is mapped in medicalInfo

**Validation:** Create student with guardian employer/occupation. GET student profile - verify fields returned. Same for dietaryRestrictions.

#### Ticket 1.4: Require Guardian Email When Portal Access Enabled
**Description:** Add validation that guardian must have a valid email address when `hasPortalAccess` is set to `true`. This is a prerequisite for portal account creation.

**Files to modify:**
- `apps/academics/src/schemas/student.form.ts` - Add conditional Zod refinement on guardian schema
- `server/application/microservices/academics/src/students/dto/create-student.dto.ts` - Add backend validation
- `apps/academics/src/components/students/registration/GuardianForm.tsx` - Show email as required when portal access checked

**Validation:** Try to submit with portal access checked but no email → see validation error. Uncheck portal access → email becomes optional again.

#### Ticket 1.5: Fix Planning Year Status Frontend/Backend Mismatch
**Description:** Frontend shows academic years with 'planning' status and displays "Enrollment will be set to Pending" but backend rejects non-active years. Either remove planning years from the frontend dropdown, or implement pending enrollment support in the backend.

**Recommended approach for MVP:** Remove planning year display from frontend enrollment form. Only show active years. Planning year enrollment is a post-MVP feature.

**Files to modify:**
- `apps/academics/src/components/students/registration/steps/EnrollmentStep.tsx` - Filter `eligibleYears` to only `status === 'active'`
- Remove the "Planning status" amber warning banner

**Validation:** Only active academic years appear in the enrollment form dropdown. No confusing "pending" messaging.

#### Ticket 1.6: Add FTE Range Validation to Backend
**Description:** Backend accepts any number for `fullTimeEquivalency` without range validation (0.0-1.0). Frontend validates but API can be called directly.

**Files to modify:**
- `server/application/microservices/academics/src/enrollment/dto/create-enrollment.dto.ts` - Add Zod `.min(0).max(1)` validation

**Validation:** Call API directly with FTE=1.5 → 400 error. FTE=0.5 → success. FTE=-0.1 → 400 error.

#### Ticket 1.7: Require exitWithdrawTypeDescriptor on Withdrawal
**Description:** When withdrawing a student, `exitWithdrawTypeDescriptor` should be required (Ed-Fi mandate). Currently the withdrawal flow doesn't require it.

**Files to modify:**
- `server/application/microservices/academics/src/enrollment/dto/withdraw-student.dto.ts` - Make `exitWithdrawTypeDescriptor` required
- `server/application/microservices/academics/src/enrollment/enrollment.service.ts` - Validate and store descriptor
- Frontend withdrawal dialog - Add exit type selector

**Validation:** Attempt withdrawal without exit type → 400 error. Withdrawal with exit type → success, stored in enrollment.

---

### Sprint 2: Enrollment Lifecycle & Event Publishing
**Goal:** Implement proper enrollment status lifecycle, event publishing, and core Ed-Fi compliance.

#### Ticket 2.1: Implement Enrollment Status State Machine
**Description:** Enforce valid enrollment status transitions. Define allowed transitions and reject invalid ones.

**Valid transitions:**
- `enrolled` → `withdrawn`, `transferred`, `graduated`, `completed`
- `pending` → `enrolled`, `withdrawn` (canceled)
- `withdrawn` → (terminal - new enrollment required for re-enrollment)
- `transferred` → (terminal)
- `graduated` → (terminal)

**Files to modify:**
- `server/application/microservices/academics/src/enrollment/enrollment.service.ts` - Add `validateStatusTransition()` method
- Add status transition map as constant

**Validation:** Attempt invalid transition (withdrawn→enrolled) → 400 error. Valid transition (enrolled→withdrawn) → success.

#### Ticket 2.2: Publish Enrollment Events
**Description:** Call event publishers for enrollment lifecycle operations. Events are already defined in `AcademicsEventsService` but never invoked.

**Files to modify:**
- `server/application/microservices/academics/src/enrollment/enrollment.service.ts`:
  - `createEnrollment()` → call `publishEnrollmentCompleted()`
  - `withdrawStudent()` → call `publishStudentWithdrawn()`
  - `transferStudent()` → call `publishStudentTransferred()`

**Validation:** Create enrollment → check EventBridge for EnrollmentCompleted event. Withdraw → check for StudentWithdrawn event. Verify fire-and-forget pattern (error logged, not thrown).

#### Ticket 2.3: Fix Transfer Flow - Close Source Enrollment
**Description:** When transferring a student, the source enrollment must be properly closed with `exitWithdrawDate` and `exitWithdrawTypeDescriptor` before creating the new enrollment.

**Files to modify:**
- `server/application/microservices/academics/src/enrollment/enrollment.service.ts` - `transferStudent()`:
  - Set `exitWithdrawDate` on source enrollment
  - Set `exitWithdrawTypeDescriptor` to appropriate transfer type
  - Set source enrollment status to `transferred`
  - Then create destination enrollment

**Validation:** Transfer student from School A to School B. Verify School A enrollment has exitWithdrawDate and status='transferred'. Verify School B enrollment has entryDate and status='enrolled'.

#### Ticket 2.4: Validate Student Number Uniqueness
**Description:** When `studentNumber` is manually provided in the student creation payload, validate it's unique within the school before persisting.

**Files to modify:**
- `server/application/microservices/academics/src/students/students.service.ts` - Call `StudentIdService.isUniqueIdTaken()` when `studentNumber` is provided

**Validation:** Create student with manual studentNumber "TEST-001". Create another with same number → 409 Conflict. Different number → success.

#### Ticket 2.5: Validate Address Has street1 When Address Provided
**Description:** When an address object is provided, `street1` should be present. Currently `street2` can exist without `street1`.

**Files to modify:**
- `apps/academics/src/schemas/student.form.ts` - Add Zod refinement: if any address field is filled, `street1` is encouraged (warning, not blocking for MVP)
- `apps/academics/src/components/students/registration/steps/ContactInfoStep.tsx` - Ensure street1 field is prominently positioned

**Validation:** Fill city/state/zip but not street1 → soft warning displayed. Fill street1 → no warning.

---

### Sprint 3: Enrollment UI Polish & UX Improvements
**Goal:** Improve the enrollment form design, layout, and user experience to pilot-ready quality.

#### Ticket 3.1: Change Enrollment Type to Horizontal Radio Layout
**Description:** Change the enrollment type radio group from vertical to horizontal layout to reduce page height.

**Files to modify:**
- `apps/academics/src/components/students/registration/steps/EnrollmentStep.tsx` - Change `direction="vertical"` to `direction="horizontal"` on RadioGroupField (line 140)

**Validation:** Enrollment type options render in a horizontal row. Descriptions still visible. Responsive on mobile (wrap to vertical on small screens).

#### Ticket 3.2: Improve Enrollment Configuration Section
**Description:** Rename "Enrollment Configuration - Additional enrollment parameters with smart defaults" to something clearer like "Enrollment Settings". Add tooltip/help icons explaining each field. Improve visual grouping.

**Files to modify:**
- `apps/academics/src/components/students/registration/steps/EnrollmentStep.tsx`:
  - Rename section header
  - Add help text/tooltips for Primary School, FTE, Repeat Grade
  - Improve layout with consistent styling

**Validation:** Section header is clearer. Each field has contextual help explaining its purpose. Non-technical school staff can understand what each field means.

#### Ticket 3.3: Add Required Validation for Transfer Fields
**Description:** When enrollment type is "transfer", the Previous School Name field should be required. Currently it's optional even for transfers.

**Files to modify:**
- `apps/academics/src/schemas/student.form.ts` - Add conditional Zod refinement
- `apps/academics/src/components/students/registration/steps/EnrollmentStep.tsx` - Mark field as required in UI

**Validation:** Select transfer type → Previous School Name shows as required. Submit without it → validation error. Select non-transfer type → field not required.

#### Ticket 3.4: Improve Enrollment Step Visual Design
**Description:** Improve the overall visual design of the enrollment step to match the polish of the Student Directory page. Add proper section dividers, consistent spacing, and visual hierarchy.

**Files to modify:**
- `apps/academics/src/components/students/registration/steps/EnrollmentStep.tsx` - Restyle sections with consistent design language
- Ensure proper responsive behavior on all screen sizes

**Validation:** Side-by-side comparison with Student Directory page - consistent design language. Clean section dividers. Good mobile layout.

#### Ticket 3.5: Add Progress Auto-Save to Wizard
**Description:** Persist wizard form data to localStorage/sessionStorage so data isn't lost on page refresh. Clear on successful submission.

**Files to modify:**
- `packages/wizard/src/WizardContext.tsx` - Add sessionStorage persistence for formData and currentStep
- `apps/academics/src/components/students/registration/RegistrationWizard.tsx` - Initialize wizard with persisted data, clear on submit

**Validation:** Fill Step 1-3, refresh page → data preserved, returns to correct step. Submit form → sessionStorage cleared. Open new tab → starts fresh.

#### Ticket 3.6: Add Confirmation When Skipping Optional Steps
**Description:** When navigating past optional steps (Guardians, Medical) without filling any data, show a brief confirmation: "You haven't added any [guardians/medical info]. You can add this later from the student profile. Continue?"

**Files to modify:**
- `apps/academics/src/components/students/registration/RegistrationWizard.tsx` - Add skip confirmation logic for optional steps

**Validation:** Skip guardians step → confirmation dialog. Click continue → proceeds. Click go back → returns to step. Fill any data → no confirmation.

#### Ticket 3.7: Fix Enrollment Dashboard Student Names
**Description:** The enrollment dashboard table shows partial student IDs (e.g., "82414f67") instead of full student names. The student directory page shows names correctly - the enrollment dashboard should match.

**Files to modify:**
- Enrollment dashboard table component - Use `fullName` field instead of studentId fragment

**Validation:** Enrollment dashboard table shows full student names, not ID fragments.

---

### Sprint 4: Portal Access - Parent Account Creation
**Goal:** Implement the core portal access workflow: when `hasPortalAccess=true`, create a parent user account.

#### Ticket 4.1: Add Parent Account Creation API Endpoint
**Description:** Add an endpoint to the Identity Service that creates a parent user account with proper role assignment. Should accept guardian details and student linkage.

**Endpoint:** `POST /users/parent-accounts`

**Request:**
```json
{
  "email": "parent@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "schoolId": "...",
  "studentId": "...",
  "guardianId": "...",
  "relationship": "father"
}
```

**Files to modify:**
- `server/application/microservices/identity/src/users/users.controller.ts` - Add endpoint
- `server/application/microservices/identity/src/users/users.service.ts` - Add `createParentAccount()` method
- Create parent user in Cognito with `TenantUser` global role
- Auto-assign `Parent` school role via RoleSyncService
- Return userId

**Validation:** Call endpoint with valid guardian data → Cognito user created, role assigned, userId returned. Call with existing email → appropriate error/idempotent handling.

#### Ticket 4.2: Integrate Parent Account Creation into Enrollment Flow
**Description:** After successful student creation and enrollment, if any guardian has `hasPortalAccess=true`, call the Identity Service to create their parent account.

**Files to modify:**
- `server/application/microservices/academics/src/students/students.service.ts` - After student creation, iterate guardians with `hasPortalAccess=true`, call Identity Service
- `server/application/microservices/academics/src/common/services/identity-client.service.ts` - Add `createParentAccount()` HTTP client method
- Update guardian record with returned `userId`

**Error handling:** Parent account creation failure should NOT roll back student creation. Log error, store flag for retry.

**Validation:** Create student with guardian having portalAccess=true → Identity Service creates user → guardian record has userId. Create student with portalAccess=false → no Identity Service call.

#### Ticket 4.3: Add "Grant Portal Access" Button to Student Profile
**Description:** On the student profile page, guardians section, add a button to grant/revoke portal access for individual guardians. This allows granting access after enrollment.

**Files to modify:**
- Student profile guardians tab/section component
- Add "Grant Access" / "Revoke Access" button per guardian
- Call PATCH /students/:id to update guardian hasPortalAccess
- On grant: trigger parent account creation
- On revoke: deactivate parent account

**Validation:** View student profile → see guardians with portal access status. Click "Grant Access" → account created, status updates. Click "Revoke Access" → account deactivated.

#### Ticket 4.4: Add Student Account Creation from Profile
**Description:** Add a "Create Student Account" action on the student profile page. Requires student email. Creates a student user with `Student` role.

**Files to modify:**
- Student profile page - Add "Create Account" button
- `server/application/microservices/identity/src/users/users.service.ts` - Add `createStudentAccount()` method
- Auto-assign `Student` school role

**Validation:** Student profile with email → "Create Account" button visible. Click → account created with Student role. Student without email → button disabled with "Email required" tooltip.

#### Ticket 4.5: Implement Parent Data Scope Filtering
**Description:** Extend `DataScopeService` to support parent scope. Parents should only see data for their linked student(s).

**Files to modify:**
- `server/application/microservices/academics/src/common/services/data-scope.service.ts` - Add `parent` scope type
- Query parent's linked students from User→Guardian→Student relationship
- Filter all student-related queries (attendance, grades, enrollments) by linked studentIds

**Validation:** Create parent account linked to Student A. Login as parent → can see Student A data. Cannot see Student B data. Cannot access other school data.

---

### Sprint 5: Ed-Fi Compliance Hardening & Operational Readiness
**Goal:** Complete Ed-Fi compliance features and operational tooling needed for pilot deployment.

#### Ticket 5.1: Implement No-Show Handling
**Description:** Add a "Mark as No-Show" action for enrolled students who never attended. Sets `exitWithdrawDate` and `exitWithdrawTypeDescriptor` to a no-show value per Ed-Fi guidelines (do NOT delete the enrollment).

**Files to modify:**
- Add no-show exit type to Ed-Fi descriptors
- `server/application/microservices/academics/src/enrollment/enrollment.service.ts` - Add `markNoShow()` method
- Frontend enrollment dashboard - Add "No-Show" action in student row menu

**Validation:** Mark student as no-show → enrollment has exitWithdrawDate and no-show exit type. Enrollment status changes to 'withdrawn'. Student appears in no-show report.

#### Ticket 5.2: Implement End-of-Year Enrollment Closure
**Description:** Add batch operation to close all open enrollments for a completed academic year. Sets `exitWithdrawDate` to last day of school and appropriate `exitWithdrawTypeDescriptor`.

**Files to modify:**
- `server/application/microservices/academics/src/enrollment/enrollment.service.ts` - Add `closeAcademicYearEnrollments()` method
- Frontend admin panel - Add "Close Year" action
- Validate all enrollments have exit dates after closure

**Validation:** Run end-of-year closure → all enrollments for that year have exit dates. No open-ended enrollments remain. Report shows closure summary.

#### Ticket 5.3: Add Enrollment Audit Trail
**Description:** Log all enrollment status changes with timestamps, user IDs, and reasons. This is critical for compliance and dispute resolution.

**Files to modify:**
- Add audit log entries on enrollment create, update, withdraw, transfer
- Store audit trail in separate DynamoDB items or append to enrollment record
- Frontend student profile - Show enrollment history/timeline

**Validation:** Create enrollment → audit entry logged. Withdraw → audit entry with reason. Transfer → audit entries for both source and destination.

#### Ticket 5.4: Add Enrollment Data Export (CSV)
**Description:** Add ability to export enrollment data for a school/academic year as CSV. Required for state reporting and district data submission.

**Files to modify:**
- `server/application/microservices/academics/src/enrollment/enrollment.controller.ts` - Add `GET /enrollments/export` endpoint
- Generate CSV with Ed-Fi aligned column headers
- Include all descriptor fields for state reporting

**Validation:** Export enrollments for academic year → CSV file with all enrollment records. All Ed-Fi fields present. CSV parseable by standard tools.

#### Ticket 5.5: Add Enrollment Summary/Analytics Dashboard Improvements
**Description:** Enhance the enrollment dashboard with:
- Enrollment trends over time chart
- Grade level distribution visualization
- Entry type breakdown
- Pending vs active status counts
- Recent enrollment activity feed

**Files to modify:**
- `apps/academics/src/components/enrollment/EnrollmentDashboard.tsx` - Add visualization components
- Backend summary endpoint already exists - may need additional aggregation

**Validation:** Dashboard shows meaningful analytics. Charts render correctly with real data. Responsive on tablet/desktop.

#### Ticket 5.6: Enrollment Form - Add Help/Tooltip System for Ed-Fi Fields
**Description:** Add contextual help icons and tooltips for all Ed-Fi descriptor fields (Entry Type, Residency Status, Enrollment Type, FTE, etc.) so non-technical school staff understand what each field means and why it matters.

**Files to modify:**
- `apps/academics/src/components/students/registration/steps/EnrollmentStep.tsx` - Add Tooltip components
- Create help text content for each Ed-Fi field

**Validation:** Hover over help icon → tooltip with clear explanation. All Ed-Fi fields have help text. Non-technical user can understand field purpose.

---

## Part 3: Issue Summary Matrix

| # | Issue | Severity | Sprint | Ticket |
|---|---|---|---|---|
| 1 | Medical form data loss bug (shallow merge) | **Critical** | 1 | 1.1 |
| 2 | IEP/504 fields present (should be deferred) | **High** | 1 | 1.2 |
| 3 | Guardian employer/occupation data dropped | **Medium** | 1 | 1.3 |
| 4 | No email validation when portal access enabled | **High** | 1 | 1.4 |
| 5 | Planning year shown but rejected by backend | **High** | 1 | 1.5 |
| 6 | FTE backend validation missing | **Medium** | 1 | 1.6 |
| 7 | Withdrawal missing exitWithdrawType | **High** | 1 | 1.7 |
| 8 | No enrollment status state machine | **High** | 2 | 2.1 |
| 9 | Enrollment events never published | **High** | 2 | 2.2 |
| 10 | Transfer doesn't close source enrollment | **Critical** | 2 | 2.3 |
| 11 | Student number uniqueness not validated | **Medium** | 2 | 2.4 |
| 12 | Address allows street2 without street1 | **Low** | 2 | 2.5 |
| 13 | Enrollment type takes too much vertical space | **Low** | 3 | 3.1 |
| 14 | Enrollment config section label unclear | **Low** | 3 | 3.2 |
| 15 | Transfer fields not required for transfer type | **Medium** | 3 | 3.3 |
| 16 | Enrollment page design needs polish | **Medium** | 3 | 3.4 |
| 17 | No form auto-save | **Medium** | 3 | 3.5 |
| 18 | No skip confirmation for optional steps | **Low** | 3 | 3.6 |
| 19 | Enrollment dashboard shows IDs not names | **Medium** | 3 | 3.7 |
| 20 | Portal access doesn't create user accounts | **Critical** | 4 | 4.1-4.5 |
| 21 | No-show handling missing | **Medium** | 5 | 5.1 |
| 22 | No end-of-year closure | **Medium** | 5 | 5.2 |
| 23 | No enrollment audit trail | **Medium** | 5 | 5.3 |
| 24 | No enrollment data export | **Medium** | 5 | 5.4 |

---

## Part 4: MVP Readiness Verdict

### Must-Have for Pilot (Sprints 1-3):
- Fix medical form data loss bug
- Remove IEP/504 fields
- Fix planning year mismatch
- Fix guardian data being dropped
- Require exit type on withdrawal
- UI polish (layout, labels, names in dashboard)

### Should-Have for Pilot (Sprint 4):
- Portal access actually creating user accounts
- Parent data scope filtering
- Student account creation from profile

### Nice-to-Have (Sprint 5):
- No-show handling
- End-of-year closure
- Enrollment audit trail
- Data export
- Dashboard analytics improvements

### Post-MVP (Deferred):
- Special Education (IEP, 504 Plan)
- SEORA (non-enrollment accountability)
- StudentTransportation
- CrisisEvent displaced students
- Multi-enrollment same year (re-enrollment after withdrawal)
- Calendar code assignment
- Pending enrollment for planning years
- Enrollment status lifecycle full enforcement

---

## Part 5: Architect Review Feedback & Incorporated Improvements

The following improvements were identified by a senior architect review of the initial sprint plan. All critical and high-priority items have been incorporated into the revised sprint plan above (Part 6).

### 5.1 Missing Tickets Identified

**5.1.1 CRITICAL: Orphaned Student Recovery**
The wizard creates a student (POST /students) then enrollment (POST /enrollments) as two separate API calls. If the enrollment fails (network error, validation failure), the student exists without enrollment. Need a recovery mechanism.

**5.1.2 CRITICAL: Withdrawal Does Not Cascade to Section Enrollments**
`withdrawStudent()` updates enrollment status and student status but does NOT deactivate active section enrollments (`SEC_ENROLL` records). A withdrawn student would still appear on class rosters.

**5.1.3 HIGH: Rate Limiting on Creation Endpoints**
POST /academics/students and POST /academics/enrollments have no rate limiting. A runaway script or misconfigured CSV import could create thousands of records. CSV import has a 500-row limit, but direct API access is unlimited.

**5.1.4 MEDIUM: Input Sanitization for PII Free-Text Fields**
Student names, guardian names, addresses, and medical notes are stored as-is. The medical `notes` field (up to 2000 chars) is particularly risky for XSS when rendered in the frontend.

**5.1.5 MEDIUM: Primary School Race Condition**
The primary school overlap check uses an eventually-consistent GSI2 query. Two simultaneous enrollment requests at different schools could both pass the check. Need conditional write on student record to atomically claim primary school status.

**5.1.6 MEDIUM: WCAG 2.1 AA Accessibility**
No accessibility ticket for the enrollment wizard. Keyboard navigation, screen reader announcements for step changes, focus management on step transitions, and error announcements via `aria-live` regions are needed.

**5.1.7 LOW: `canPickup` Field Not Persisted**
Guardian `canPickup` is in the DTO schema but not in the Guardian entity interface. The mapper hardcodes `canPickup: true`. Should be added to the entity and mapped properly. (Added to Ticket 1.3)

### 5.2 Ticket Quality Improvements

**5.2.1 Split Ticket 1.7 into Backend + Frontend**
- Ticket 1.7a: Backend - Make `exitWithdrawTypeDescriptor` required in withdraw DTO
- Ticket 1.7b: Frontend - Add exit type selector to withdrawal dialog

**5.2.2 Split Ticket 4.1 into Service + Controller + Test**
- Ticket 4.1a: Identity Service `createParentAccount()` method
- Ticket 4.1b: REST endpoint with RBAC guard
- Ticket 4.1c: Integration smoke test

**5.2.3 Ticket 3.5 Depends on Ticket 1.1**
Auto-save must persist the unified data source. Since the wizard uses dual state management (RHF + WizardContext), the auto-save implementation depends on how Ticket 1.1 resolves the merge issue.

### 5.3 Sprint Reordering Recommendations

| Ticket | Original Sprint | Recommended Sprint | Reason |
|---|---|---|---|
| 2.2 (Event Publishing) | Sprint 2 | **Sprint 1** | Trivial implementation (3 fire-and-forget calls), blocks Sprint 4 portal access |
| 2.4 (Student Number Uniqueness) | Sprint 2 | **Sprint 1** | Data integrity issue, minimal code change |
| 3.7 (Dashboard Student Names) | Sprint 3 | **Sprint 1** | User-facing defect undermining pilot confidence |
| 1.6 (FTE Validation) | Sprint 1 | **Verify first** | Shared-types Zod schema may already have `min(0).max(1)` - verify before implementing |

### 5.4 Ed-Fi Compliance Additions

**5.4.1 Re-enrollment Guard (Sprint 2)**
SK `ENROLLMENT#{schoolId}#{yearId}#{studentId}` prevents multiple enrollments per student/school/year. Before the full data model fix (appending entryDate to SK), add a guard that rejects re-enrollment with a clear error when a withdrawn enrollment exists for the same SK.

**5.4.2 Transfer Must Set Both Exit Fields (Ticket 2.3 Enhancement)**
`transferStudent()` sets `endDate` but NOT `exitWithdrawDate` (Ed-Fi canonical). Also missing `exitWithdrawTypeDescriptor`. Both must be set on the source enrollment.

**5.4.3 Legacy Date Field Deprecation (Sprint 2)**
The enrollment entity has `entryDate` (Ed-Fi canonical) AND `enrollmentDate`, `startDate`, `endDate`, `withdrawalDate` (legacy). The mapper falls back: `entryDate: entity.entryDate || entity.enrollmentDate`. Add a cleanup ticket to stop writing legacy fields and use only canonical fields.

### 5.5 Portal Access Architecture Recommendations

**5.5.1 Event-Driven Over Synchronous**
Instead of the Academics service directly calling Identity Service's user creation endpoint (which requires service-to-service auth), use the event-driven approach:
1. Academics publishes `ParentPortalAccessRequested` event
2. Identity subscribes, creates account with service-level credentials
3. Identity publishes `ParentAccountCreated` event back
4. Academics updates guardian's `userId`

This matches the existing fire-and-forget event pattern and avoids synchronous cross-service dependency during enrollment.

**5.5.2 Simpler MVP Alternative: Deferred Invite Pattern**
For initial pilot, consider:
1. Validate email on `hasPortalAccess=true` (Ticket 1.4)
2. Store flag on guardian record
3. Admin action: "Send portal invitations" - batch creates accounts for all eligible guardians
4. Invite email with self-registration link using signed token
5. Parent creates own account, auto-links to student

This avoids Tickets 4.1-4.5 complexity for initial pilot.

**5.5.3 HARD BLOCKER: Parent Data Scope (Ticket 4.5)**
`DataScopeService` currently defaults Parent role to school scope (line 144-145: fallback to school-level access). If parent accounts are created without Ticket 4.5, parents would see ALL students' data. **Ticket 4.5 must ship BEFORE or WITH Tickets 4.1-4.4.** This is a privacy violation / legal risk otherwise.

### 5.6 Testing Strategy Requirements

Each ticket should include:
- **Unit tests**: Specific test cases for the logic being changed
- **Smoke test**: Script at `scripts/smoke-tests/` (matches existing project pattern)
- **Manual QA**: Specific checklist items

**Per-ticket test requirements:**

| Ticket | Unit Tests | Smoke Test | Manual QA |
|---|---|---|---|
| 1.1 | `updateData` deep merge preserves nested arrays; physician change doesn't overwrite tags | Full wizard flow with medical data | Fill tags → edit physician → verify tags persist |
| 1.7 | Withdrawal rejects missing exit type; accepts valid exit type | Withdrawal with exit type → verify stored | UI shows exit type selector |
| 2.1 | One test per valid transition; one per invalid transition (~10 tests) | State transition attempts via API | N/A |
| 2.2 | Mock events service, verify called with correct args; verify fire-and-forget | Create enrollment → check EventBridge | N/A |
| 4.5 | Parent scope returns only linked students; rejects other students | Login as parent → verify student visibility | Parent portal shows only their children |

**Sprint-level smoke tests:** Add a smoke test script per sprint at `scripts/smoke-tests/enrollment-sprint-N.sh`.

### 5.7 Risk Assessment

| Rank | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | Medical form data loss (1.1) | Staff won't trust system with health data - showstopper | Fix first. Straightforward deep merge. Recommend approach: change `WizardContext.updateData` to deep merge (lower blast radius than refactoring RHF integration) |
| 2 | Transfer flow corruption (2.3) | Transfers produce corrupt data - source enrollment not closed. Transfers from other systems are common during pilot onboarding | End-to-end test before pilot |
| 3 | Parent data scope missing (4.5) | Parents can see ALL students. Privacy violation, legal risk | Hard block parent portal launch on this ticket |
| 4 | SK collision on re-enrollment | Silently overwrites enrollment if student withdraws and re-enrolls same year | Add guard with clear error message |
| 5 | Planning year mismatch (1.5) | Users repeatedly attempt planning year enrollment, get confusing errors. Dominates support tickets | Quick frontend filter fix |
| 6 | No auto-save (3.5) | Page refresh loses 10+ minutes of data entry during busy enrollment periods | sessionStorage persistence (depends on 1.1 fix) |

---

## Part 6: Revised Sprint Plan (Post-Review)

Incorporating all architect review feedback, the revised sprint plan reorders and adds tickets for maximum pilot readiness.

### Sprint 1: Critical Bug Fixes & Data Integrity (REVISED)
**Goal:** Fix all blocking bugs, data integrity issues, and user-facing defects.

| # | Ticket | Type | Priority |
|---|---|---|---|
| 1.1 | Fix Medical Form Data Loss Bug (shallow merge → deep merge) | Bug Fix | **P0** |
| 1.2 | Remove IEP/504 Plan Fields (Special Education deferral) | Feature Removal | **P0** |
| 1.3 | Fix Guardian & Medical Data Fields Being Dropped (employer, occupation, dietaryRestrictions, canPickup) | Bug Fix | **P1** |
| 1.4 | Require Guardian Email When Portal Access Enabled | Validation | **P1** |
| 1.5 | Fix Planning Year Frontend/Backend Mismatch (filter to active only) | Bug Fix | **P1** |
| 1.6 | Verify FTE Backend Validation (may already be handled by shared-types Zod) | Verification | **P2** |
| 1.7a | Backend: Require exitWithdrawTypeDescriptor on Withdrawal | Compliance | **P1** |
| 1.7b | Frontend: Add Exit Type Selector to Withdrawal Dialog | UI | **P1** |
| 1.8 | Publish Enrollment Events (moved from Sprint 2 - trivial, unblocks Sprint 4) | Integration | **P1** |
| 1.9 | Validate Student Number Uniqueness (moved from Sprint 2 - data integrity) | Validation | **P2** |
| 1.10 | Fix Enrollment Dashboard Student Names (moved from Sprint 3 - user-facing) | Bug Fix | **P1** |
| 1.11 | Add HTML Sanitization for Free-Text PII Fields (NEW) | Security | **P1** |
| 1.12 | Sprint 1 Smoke Test Script | Testing | **P1** |

### Sprint 2: Enrollment Lifecycle & Ed-Fi Compliance (REVISED)
**Goal:** Implement enrollment status lifecycle, fix transfer flow, add compliance guards.

| # | Ticket | Type | Priority |
|---|---|---|---|
| 2.1 | Implement Enrollment Status State Machine | Compliance | **P1** |
| 2.2 | Fix Transfer Flow - Close Source Enrollment (exitWithdrawDate + exitWithdrawTypeDescriptor) | Bug Fix | **P0** |
| 2.3 | Cascade Withdrawal to Section Enrollments (NEW) | Bug Fix | **P1** |
| 2.4 | Add Re-enrollment Guard (reject with clear error when withdrawn enrollment exists for same SK) (NEW) | Compliance | **P1** |
| 2.5 | Deprecate Legacy Date Fields (use entryDate/exitWithdrawDate only) (NEW) | Cleanup | **P2** |
| 2.6 | Add Rate Limiting on Creation Endpoints (NEW) | Security | **P2** |
| 2.7 | Validate Address Has street1 When Address Provided | Validation | **P3** |
| 2.8 | Handle Orphaned Student Recovery (student created, enrollment fails) (NEW) | Resilience | **P1** |
| 2.9 | Sprint 2 Smoke Test Script | Testing | **P1** |

### Sprint 3: Enrollment UI Polish & UX (REVISED)
**Goal:** Bring the enrollment form to pilot-ready visual quality and UX.

| # | Ticket | Type | Priority |
|---|---|---|---|
| 3.1 | Change Enrollment Type to Horizontal Radio Layout | UI | **P2** |
| 3.2 | Improve Enrollment Configuration Section (rename, add tooltips) | UI | **P2** |
| 3.3 | Add Required Validation for Transfer Fields | Validation | **P1** |
| 3.4 | Improve Enrollment Step Visual Design (match Student Directory polish) | UI | **P1** |
| 3.5 | Add Progress Auto-Save to Wizard (depends on 1.1) | UX | **P1** |
| 3.6 | Add Confirmation When Skipping Optional Steps | UX | **P2** |
| 3.7 | Add WCAG 2.1 AA Accessibility to Enrollment Wizard (NEW) | Accessibility | **P1** |
| 3.8 | Add Help/Tooltip System for Ed-Fi Fields | UX | **P2** |
| 3.9 | Sprint 3 Smoke Test Script | Testing | **P1** |

### Sprint 4: Portal Access - Parent Account Creation (REVISED)
**Goal:** Implement parent/student account creation. Data scope filtering is a HARD PREREQUISITE.

| # | Ticket | Type | Priority |
|---|---|---|---|
| 4.1 | Implement Parent Data Scope Filtering (MOVED TO FIRST - hard prerequisite) | Security | **P0** |
| 4.2a | Identity Service: Add `createParentAccount()` method | Backend | **P1** |
| 4.2b | Identity Controller: Expose POST /users/parent-accounts with RBAC guard | Backend | **P1** |
| 4.3 | Integrate Parent Account Creation into Enrollment Flow (event-driven) | Integration | **P1** |
| 4.4 | Add "Grant Portal Access" Button to Student Profile | UI | **P1** |
| 4.5 | Add Student Account Creation from Profile | Feature | **P2** |
| 4.6 | Sprint 4 Integration Smoke Test | Testing | **P1** |

### Sprint 5: Operational Readiness & Reporting (REVISED)
**Goal:** Operational tooling for pilot deployment.

| # | Ticket | Type | Priority |
|---|---|---|---|
| 5.1 | Implement No-Show Handling | Compliance | **P2** |
| 5.2 | Implement End-of-Year Enrollment Closure | Compliance | **P1** |
| 5.3 | Add Enrollment Audit Trail | Compliance | **P1** |
| 5.4 | Add Enrollment Data Export (CSV) | Reporting | **P1** |
| 5.5 | Enrollment Dashboard Analytics Improvements | UI | **P2** |
| 5.6 | Sprint 5 Smoke Test Script | Testing | **P1** |

---

## Part 7: Post-MVP Backlog

Items explicitly deferred from the MVP pilot:

| Item | Reason for Deferral |
|---|---|
| Special Education (IEP, 504 Plan, Accommodations) | Separate module, not needed for enrollment |
| SEORA (non-enrollment accountability) | Complex Ed-Fi concept, not required for basic enrollment |
| StudentTransportation | Separate operational concern |
| CrisisEvent (displaced students) | Edge case, not expected during pilot |
| Multi-enrollment re-enrollment (SK data model fix) | Requires DynamoDB migration, guard is sufficient for MVP |
| Calendar code on enrollment | Can be added post-enrollment |
| Pending enrollment for planning years | Planning year enrollment requires separate workflow |
| Enrollment status full lifecycle audit | Basic state machine in Sprint 2 is sufficient |
| Parent/Student portal UI | Account creation is in scope; the portal views are post-MVP |
| Ed-Fi descriptor validation registry | Hardcoded descriptors acceptable for MVP |
| Primary school race condition fix (conditional write) | Guard in place; conditional write optimization for scale |
| Field-level encryption for medical PII | DynamoDB encryption-at-rest is sufficient for MVP |
