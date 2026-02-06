# EdForge EMIS Entity Model & Architecture

**Purpose**: This document defines the complete entity model for EdForge's Education Management Information System (EMIS), aligned with the **Ed-Fi Alliance Data Standard v6**. It is intended for the backend engineering team to review the data architecture and ensure all services implement the correct entity relationships, API contracts, and business logic.

**Last Updated**: February 2026

---

## Table of Contents

1. [Terminology Guide](#1-terminology-guide)
2. [Entity Taxonomy](#2-entity-taxonomy)
3. [Entity Relationship Diagram](#3-entity-relationship-diagram)
4. [Entity Details & Ed-Fi Mapping](#4-entity-details--ed-fi-mapping)
5. [User vs Staff: The Current Gap](#5-user-vs-staff-the-current-gap)
6. [Enrollment Two-Tier Model](#6-enrollment-two-tier-model)
7. [Section Model: The Core Operational Unit](#7-section-model-the-core-operational-unit)
8. [API Contract Expectations](#8-api-contract-expectations)
9. [Backend Action Items](#9-backend-action-items)

---

## 1. Terminology Guide

These terms are used throughout EdForge. They must be consistent across frontend, backend, API documentation, and user-facing UI.

| Term | Ed-Fi Entity | Definition | Example |
|------|-------------|------------|---------|
| **Tenant** | `EducationOrganization` (LEA) | A school district or organization. The root isolation boundary for multi-tenancy. | "Springfield Public Schools" |
| **School** | `School` (subtype of `EducationOrganization`) | A single school within a tenant. All academic data is scoped to a school. | "Sprouts Academy" |
| **User** | _(no Ed-Fi equivalent)_ | A login account in Cognito. Has authentication credentials and a `globalRole`. Not an education-domain entity. | "shoaib.rain@outlook.com" with role TenantAdmin |
| **Staff** | `Staff` | An education-domain person employed by the district. Has an Ed-Fi `role` (teacher, principal, etc.), `schoolAssignments`, and employment lifecycle. A Staff record should be **linked to a User account** for login. | "John Snow, Teacher at Sprouts Academy" |
| **Student** | `Student` | A person enrolled as a learner. Has demographics, guardians, medical info. | "Jane Doe, Grade 5" |
| **Course** | `Course` + `CourseOffering` | A curriculum catalog entry. Abstract — no teacher, no schedule, no students. Defines subject area, credits, prerequisites, grade levels. | "Algebra I", "AP US History" |
| **Section** | `Section` | A **specific offering** of a course: it has a teacher, a room, a term, a max enrollment, and enrolled students. This is the operational unit where teaching and learning happen. Colloquially called a "class." | "Algebra I, Section 001, Mrs. Smith, Room 204, Fall 2025" |
| **Room** | `Location` | A **physical space** — room number, building, capacity. Rooms exist independently of sections. Multiple sections can use the same room at different times. | "Room 204", "Science Lab B" |
| **Academic Year** | `SchoolYearType` | A school year with start and end dates. Contains grading periods. | "2025-2026" |
| **Grading Period / Term** | `Session` + `GradingPeriod` | A subdivision of the academic year: semester, trimester, quarter, or full year. Sections and grades are tied to terms. | "Fall 2025", "Q1 2025-2026" |
| **Enrollment (Annual)** | `StudentSchoolAssociation` | A record that a student is enrolled at a school for a specific academic year and grade level. This is the administrative enrollment. | "Jane Doe enrolled at Sprouts Academy for 2025-2026 in Grade 5" |
| **Section Enrollment** | `StudentSectionAssociation` | A record that a student is enrolled in a specific section. This is the class schedule. | "Jane Doe is in Algebra I Section 001" |
| **Grade** | `Grade` | An academic grade for a student in a course/section for a term. | "Jane Doe: Algebra I, Q1 = 92%" |
| **Attendance** | `StudentSchoolAttendanceEvent` | A daily or period-level attendance record. | "Jane Doe: Present, 2025-10-15" |

### What "Classroom" Does NOT Mean

The word "classroom" is **ambiguous** and should be avoided in the data model:

- **Google Classroom**: A virtual course workspace. Maps closest to **Section** in Ed-Fi.
- **Physical classroom**: A room. Maps to **Location/Room** in Ed-Fi.
- **A class**: Colloquial for Section. "Mrs. Smith's class" = a Section.

**EdForge uses "Section" for the class and "Room" for the physical space.**

---

## 2. Entity Taxonomy

### Domain Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│  IDENTITY SERVICE (People & HR)                             │
│                                                             │
│  ┌─────────┐  ┌─────────┐  ┌────────────────────┐         │
│  │  Tenant  │──│  School  │──│  Staff             │         │
│  └─────────┘  └─────────┘  │  (schoolAssignments)│         │
│                             └────────────────────┘         │
│  ┌─────────┐  ┌─────────────────┐                          │
│  │  User   │  │  Academic Year   │                          │
│  │ (Cognito│  │  (Grading Periods)│                         │
│  └─────────┘  └─────────────────┘                          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  ACADEMICS SERVICE                                          │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                 │
│  │ Student  │  │  Course   │  │  Section  │                 │
│  └──────────┘  └──────────┘  └──────────┘                 │
│       │                            │                        │
│  ┌──────────┐              ┌──────────────┐                │
│  │Enrollment│              │Section Enroll │                │
│  │ (Annual) │              │(Student-Section)│              │
│  └──────────┘              └──────────────┘                │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                 │
│  │  Grade   │  │Attendance│  │  Room     │                 │
│  └──────────┘  └──────────┘  │ (deferred)│                 │
│                              └──────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Entity Relationship Diagram

```
TENANT (root)
  │
  ├── SCHOOL (1:N)
  │     │
  │     ├── STUDENT (1:N)
  │     │     └── ENROLLMENT [annual] (1:N per student, 1 per academic year)
  │     │           └── references: studentId, schoolId, academicYearId, gradeLevel
  │     │
  │     ├── COURSE (1:N)
  │     │     └── SECTION (1:N per course)
  │     │           ├── references: courseId, schoolId, academicYearId, termId?
  │     │           ├── references: primaryTeacherId → Staff/User
  │     │           ├── references: roomId? → Room
  │     │           │
  │     │           └── SECTION_ENROLLMENT [student-section] (M:N)
  │     │                 ├── references: studentId → Student
  │     │                 └── references: sectionId → Section
  │     │
  │     ├── STAFF (1:N, via schoolAssignments)
  │     │     └── StaffSchoolAssignment: schoolId, role, department, isPrimary
  │     │
  │     ├── ROOM (1:N, deferred)
  │     │     └── roomNumber, capacity, building
  │     │
  │     └── ACADEMIC_YEAR (1:N)
  │           └── GRADING_PERIOD (1:N per year)
  │                 └── periodType: semester | trimester | quarter | term | full_year
  │
  └── USER (1:N, login accounts)
        └── userId, email, globalRole, status
```

### Foreign Key Summary

| Entity | Field | References | Cardinality |
|--------|-------|------------|-------------|
| Student | `schoolId` | School | N:1 |
| Course | `schoolId` | School | N:1 |
| Section | `courseId` | Course | N:1 |
| Section | `schoolId` | School | N:1 |
| Section | `academicYearId` | Academic Year | N:1 |
| Section | `termId` | Grading Period | N:1 (optional) |
| Section | `primaryTeacherId` | Staff/User | N:1 |
| Section | `coTeacherIds[]` | Staff/User | N:M (max 5) |
| Section | `roomId` | Room | N:1 (optional) |
| Enrollment | `studentId` | Student | N:1 |
| Enrollment | `schoolId` | School | N:1 |
| Enrollment | `academicYearId` | Academic Year | N:1 |
| SectionEnrollment | `studentId` | Student | N:1 |
| SectionEnrollment | `sectionId` | Section | N:1 |
| Grade | `studentId` | Student | N:1 |
| Grade | `courseId` | Course | N:1 |
| Grade | `sectionId` | Section | N:1 (optional) |
| Grade | `termId` | Grading Period | N:1 |
| Grade | `teacherId` | Staff/User | N:1 |
| Attendance | `studentId` | Student | N:1 |
| Attendance | `schoolId` | School | N:1 |
| Attendance | `sectionId` | Section | N:1 (optional) |
| StaffSchoolAssignment | `staffId` | Staff | N:1 |
| StaffSchoolAssignment | `schoolId` | School | N:1 |

---

## 4. Entity Details & Ed-Fi Mapping

### 4.1 Staff (Ed-Fi: `Staff`)

**Ed-Fi fields** the backend MUST store:

| Field | Ed-Fi Field | Type | Required |
|-------|------------|------|----------|
| `staffId` | `id` | UUID | Yes |
| `staffUniqueId` | `staffUniqueId` | string | Yes |
| `firstName` | `firstName` | string | Yes |
| `lastSurname` | `lastSurname` | string | Yes |
| `middleName` | `middleName` | string | No |
| `generationCodeSuffix` | `generationCodeSuffix` | string | No |
| `birthDate` | `birthDate` | date | No |
| `gender` | `sexDescriptor` | enum | No |
| `email` | `electronicMail` | string | Yes |
| `phone` | `telephone` | string | No |
| `role` | _(custom)_ | enum: teacher, principal, vice_principal, counselor, librarian, nurse, admin_staff, support_staff, it_staff, substitute, contractor | Yes |
| `employmentType` | `employmentStatusDescriptor` | enum: full_time, part_time, contract, temporary, volunteer | Yes |
| `employmentStatus` | _(custom)_ | enum: active, on_leave, suspended, terminated, retired, resigned | Yes |
| `hireDate` | `hireDate` | date | Yes |
| `primarySchoolId` | _(custom)_ | UUID | Yes |
| `schoolAssignments[]` | `StaffEducationOrganizationAssignmentAssociation` | array | No |
| `highlyQualifiedTeacher` | `highlyQualifiedTeacher` | boolean | No |
| `hispanicLatinoEthnicity` | `hispanicLatinoEthnicity` | boolean | No |

### 4.2 Course (Ed-Fi: `Course` + `CourseOffering`)

| Field | Ed-Fi Field | Type | Required |
|-------|------------|------|----------|
| `courseId` | `id` | UUID | Yes |
| `courseCode` | `courseCode` | string | Yes |
| `courseName` | `courseTitle` | string | Yes |
| `subjectArea` | `academicSubjectDescriptor` | enum | Yes |
| `courseType` | _(custom)_ | enum: required, elective, honors, ap, ib, dual_enrollment, remedial, vocational | Yes |
| `creditType` | `courseLevelCharacteristicDescriptor` | enum | Yes |
| `credits` | `maximumAvailableCredits` | number | Yes |
| `gradeLevels[]` | `gradeLevelDescriptor` | string[] | No |
| `typicalDuration` | `academicTermDescriptor` | enum | No |
| `prerequisites[]` | _(custom)_ | string[] | No |

### 4.3 Section (Ed-Fi: `Section`)

| Field | Ed-Fi Field | Type | Required |
|-------|------------|------|----------|
| `sectionId` | `id` | UUID | Yes |
| `sectionNumber` | `sectionIdentifier` | string | Yes |
| `sectionName` | _(custom)_ | string | No |
| `courseId` | `courseOfferingReference` | UUID | Yes |
| `schoolId` | `schoolReference` | UUID | Yes |
| `academicYearId` | `sessionReference` | UUID | Yes |
| `termId` | `sessionReference` | UUID | No |
| `primaryTeacherId` | `staffSectionAssociation` (primary) | UUID | Yes |
| `coTeacherIds[]` | `staffSectionAssociation` | UUID[] | No |
| `roomId` | `locationReference` | UUID | No |
| `roomNumber` | _(denormalized from Room)_ | string | No |
| `maxEnrollment` | _(custom)_ | integer | Yes |
| `currentEnrollment` | _(computed)_ | integer | Yes |
| `isActive` | _(custom)_ | boolean | Yes |

### 4.4 Student (Ed-Fi: `Student`)

| Field | Ed-Fi Field | Type | Required |
|-------|------------|------|----------|
| `studentId` | `id` | UUID | Yes |
| `studentNumber` | `studentUniqueId` | string | Yes |
| `firstName` | `firstName` | string | Yes |
| `lastName` | `lastSurname` | string | Yes |
| `middleName` | `middleName` | string | No |
| `birthDate` | `birthDate` | date | Yes |
| `gender` | `sexDescriptor` | enum | Yes |
| `currentGradeLevel` | _(from active enrollment)_ | string | No |
| `status` | _(custom)_ | enum: active, inactive, graduated, transferred, withdrawn, suspended | Yes |

---

## 5. User vs Staff: The Current Gap

### What Exists Today

**Identity Service** provides:
- `User` entity stored in Cognito + DynamoDB
- Fields: `userId`, `email`, `firstName`, `lastName`, `globalRole` (TenantAdmin / TenantUser), `status`
- API: `GET /users` returns all tenant users
- These are **login accounts**, not education-domain entities

**Academics Service** expects:
- `Staff` entity with Ed-Fi fields
- Fields: `staffId`, `firstName`, `lastSurname`, `role` (teacher/principal/etc.), `schoolAssignments[]`, `employmentStatus`
- API: `GET /schools/{schoolId}/staff` should return staff assigned to that school
- Currently returns **empty** because no Staff records have been created

### The Gap

```
User (Identity Service)               Staff (Ed-Fi / Academics)
┌──────────────────────┐              ┌──────────────────────────┐
│ userId               │──── ? ────>  │ staffId                  │
│ email                │              │ staffUniqueId            │
│ firstName            │              │ firstName                │
│ lastName             │              │ lastSurname              │
│ globalRole:          │              │ role:                    │
│   TenantAdmin        │              │   teacher                │
│   TenantUser         │              │   principal              │
│ status:              │              │   counselor              │
│   active/pending     │              │   admin_staff            │
└──────────────────────┘              │ employmentStatus:        │
                                      │   active/on_leave        │
        NOT LINKED                    │ schoolAssignments[]      │
                                      │ hireDate                 │
                                      └──────────────────────────┘
```

### Frontend Workaround (Current)

The frontend falls back to `GET /users` when `GET /schools/{schoolId}/staff` returns empty, and normalizes User records into a Staff-compatible shape. This is a temporary measure.

### What the Backend Needs to Implement

See [Section 9: Backend Action Items](#9-backend-action-items).

---

## 6. Enrollment Two-Tier Model

Enrollment in EdForge is a **two-step process**, aligned with Ed-Fi:

### Tier 1: Annual Enrollment (StudentSchoolAssociation)

**"Student X is enrolled at School Y for Academic Year Z in Grade N."**

- Created during student registration (Sprint 3)
- One per student per academic year per school
- Sets the student's grade level for that year
- Status lifecycle: `pending` → `enrolled` → `withdrawn` / `transferred` / `graduated`
- API: `POST /academics/enrollments`

### Tier 2: Section Enrollment (StudentSectionAssociation)

**"Student X is enrolled in Section S of Course C."**

- Created from the Section Roster management UI (Sprint 5)
- Many per student (one per class they take)
- This builds the student's class schedule
- API: `POST /academics/sections/{sectionId}/students`

### The Complete Flow

```
1. REGISTER STUDENT
   POST /academics/students
   → Creates Student record with demographics

2. ANNUAL ENROLLMENT
   POST /academics/enrollments
   → Links Student to School + Academic Year + Grade Level
   → Student appears in school roster

3. SECTION ENROLLMENT (repeat for each class)
   POST /academics/sections/{sectionId}/students
   → Links Student to a specific Section
   → Student appears in teacher's class roster
   → Student can receive grades and attendance for that section
```

---

## 7. Section Model: The Core Operational Unit

A **Section** is the atomic unit of instruction in Ed-Fi. It is where teaching and learning happen.

```
Section = Course + Teacher + Room + Term + Students

┌─────────────────────────────────────────────────────┐
│  Section: "Algebra I, Section 001"                  │
│                                                     │
│  Course:     Algebra I (MATH-101)                   │
│  Teacher:    Mrs. Smith (primaryTeacherId)           │
│  Room:       Room 204 (roomId / roomNumber)          │
│  Term:       Fall 2025 (termId)                      │
│  Year:       2025-2026 (academicYearId)              │
│  Capacity:   30 max, 28 enrolled                     │
│  Status:     Active                                  │
│                                                     │
│  Enrolled Students:                                  │
│  ├── Jane Doe (enrolled 2025-08-15)                  │
│  ├── John Smith (enrolled 2025-08-15)                │
│  └── ... (28 total)                                  │
└─────────────────────────────────────────────────────┘
```

### Key Business Rules

1. A Course can have **multiple Sections** (different teachers, times, rooms)
2. A Section belongs to **exactly one Course**
3. A Section has **exactly one primary teacher** and up to **5 co-teachers**
4. A Section has a **max enrollment** — the system must prevent over-enrollment
5. A Section can optionally be assigned to a **Room** (physical location)
6. A Section is scoped to an **Academic Year** and optionally a **Term**
7. `currentEnrollment` must be kept in sync with the actual count of enrolled students
8. Soft delete via `isActive` flag — deactivation does not remove enrollment records

---

## 8. API Contract Expectations

These are the API contracts the frontend expects. The backend must implement them with the specified request/response shapes.

### 8.1 Staff/Teacher APIs

**`GET /schools/{schoolId}/staff`** — List staff assigned to a school

Expected response:
```json
{
  "items": [
    {
      "staffId": "uuid",
      "staffUniqueId": "string",
      "firstName": "John",
      "lastSurname": "Snow",
      "middleName": null,
      "email": "john.snow@school.edu",
      "role": "teacher",
      "employmentStatus": "active",
      "primarySchoolId": "uuid",
      "status": "active",
      "hireDate": "2024-08-01",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "hasMore": false,
  "total": 1
}
```

**`GET /staff/search/{term}`** — Search staff by name (autocomplete)

Same response shape as above, filtered by name match.

### 8.2 Section APIs

**`POST /academics/sections`** — Create section

Request body:
```json
{
  "courseId": "uuid",
  "schoolId": "uuid",
  "academicYearId": "uuid",
  "termId": "uuid (optional)",
  "sectionNumber": "001",
  "sectionName": "Algebra I - Period 3 (optional)",
  "primaryTeacherId": "uuid",
  "coTeacherIds": ["uuid"],
  "roomId": "uuid (optional)",
  "maxEnrollment": 30
}
```

Response: Full `SectionResponseDto` with `sectionId`, `currentEnrollment: 0`, `isActive: true`, and denormalized `courseName`, `courseCode`, `primaryTeacherName`, `roomNumber`.

### 8.3 Roster APIs

**`POST /academics/sections/{sectionId}/students?schoolId=`** — Enroll student

Request: `{ "studentId": "uuid" }`

Business rules:
- Must check `currentEnrollment < maxEnrollment` (reject if full)
- Must check student is not already enrolled in this section
- Must increment `currentEnrollment` on the Section record

**`DELETE /academics/sections/{sectionId}/students/{studentId}?schoolId=`** — Remove student

Business rules:
- Must decrement `currentEnrollment` on the Section record

### 8.4 Academic Year APIs

**`GET /schools/{schoolId}/academic-years`** — List academic years

Expected response (paginated):
```json
{
  "items": [
    {
      "yearId": "uuid",
      "schoolId": "uuid",
      "name": "2025-2026",
      "startDate": "2025-08-01",
      "endDate": "2026-06-15",
      "isCurrent": true,
      "status": "active"
    }
  ],
  "hasMore": false
}
```

**`GET /schools/{schoolId}/academic-years/{yearId}/grading-periods`** — List terms

Expected response (paginated):
```json
{
  "items": [
    {
      "periodId": "uuid",
      "yearId": "uuid",
      "name": "Fall 2025",
      "periodType": "semester",
      "startDate": "2025-08-01",
      "endDate": "2025-12-20",
      "sequence": 1,
      "isCurrent": true
    }
  ],
  "hasMore": false
}
```

---

## 9. Backend Action Items

### CRITICAL: Bridge User ↔ Staff

The most important gap to close. Options:

**Option A (Recommended): Auto-create Staff records from Users**

When a User is assigned to a school (or when the school admin adds them), automatically create a corresponding `Staff` record in the Academics service with:
- `staffId` = `userId` (or a linked UUID)
- `firstName` / `lastSurname` = from User record
- `role` = mapped from `globalRole` or set by admin during assignment
- `schoolAssignments[]` = the school they're assigned to
- `employmentStatus` = `active`

**Option B: Use Users directly as Staff**

Make `GET /schools/{schoolId}/staff` query the Users table (or a view that joins Users + school assignments) and return the result in `StaffResponseDto` shape.

### Required API Implementations

| Priority | API | Status | Notes |
|----------|-----|--------|-------|
| P0 | `GET /schools/{schoolId}/staff` returning real data | **Broken** — returns empty | Must return users/staff assigned to the school |
| P0 | `GET /staff/search/{term}` | Unknown | Needed for teacher autocomplete in forms |
| P1 | `POST /academics/sections` with `currentEnrollment` tracking | To verify | Must initialize `currentEnrollment: 0` |
| P1 | `POST /academics/sections/{id}/students` with capacity check | To verify | Must enforce `currentEnrollment < maxEnrollment` |
| P1 | `DELETE /academics/sections/{id}/students/{studentId}` with decrement | To verify | Must decrement `currentEnrollment` |
| P2 | `GET /schools/{schoolId}/academic-years` returning paginated | **Working** | Returns `{ items: [], hasMore: false }` |
| P2 | `GET /schools/{schoolId}/academic-years/{yearId}/grading-periods` | To verify | Needed for term selector in Section form |
| P2 | Room/Classroom CRUD | **Deferred** | Text input used for room field on frontend |

### Data Model Consistency Checks

1. **`StaffResponseDto` shape**: Ensure `GET /schools/{schoolId}/staff` returns records matching the Zod schema in `types/packages/shared-types/src/schemas/identity/staff.schema.ts`
2. **`SectionResponseDto` denormalized fields**: When creating/updating a Section, the response MUST include `courseName`, `courseCode`, `primaryTeacherName`, and `roomNumber` (denormalized from their respective entities)
3. **`currentEnrollment` consistency**: Must be kept in sync with the actual count of `StudentSectionAssociation` records for that section
4. **Pagination format**: All list endpoints must return `{ items: T[], hasMore: boolean, lastEvaluatedKey?: string, total?: number }`

### Ed-Fi Compliance Checklist

- [ ] Staff entity stores Ed-Fi required fields (`staffUniqueId`, `firstName`, `lastSurname`, `sexDescriptor`)
- [ ] Staff has `schoolAssignments[]` mapping to `StaffEducationOrganizationAssignmentAssociation`
- [ ] Course stores Ed-Fi descriptors (`academicSubjectDescriptor`, `courseLevelCharacteristicDescriptor`)
- [ ] Section maps to Ed-Fi Section with `sectionIdentifier` and `StaffSectionAssociation`
- [ ] Student enrollment maps to `StudentSchoolAssociation` (annual) and `StudentSectionAssociation` (section)
- [ ] Academic Year maps to `SchoolYearType`, Grading Period maps to `Session` + `GradingPeriod`
- [ ] All entities use soft delete (`isActive` or `status` field) — no hard deletes
