# IEMIS Import — Post-Mortem & EdForge EMIS Completeness Report

**Date:** 2026-04-22
**Author:** Claude (pair-programming with Shoaib)
**Tenant observed:** `testtenant007` (Ramro Academy School / RAS)
**School observed:** `7031d447-313c-4624-a218-00a0d2a793cc` (Nepal-config, IEMIS-eligible)
**Source file:** `Students_2082_All.xlsx` — 779 rows from Saraswati English Boarding School
**Import correlation ID (commit run):** `5e7dbf66-3697-409c-a5b2-d59071cbd475`
**Status:** Backend processing **successful in full** (779/779 students created). Frontend experience **degraded** (Vercel 504). Downstream EMIS entity graph **incomplete** (no enrollment, no academic year, no section roster, no parent user provisioning, no Ed-Fi descriptors emitted).

---

## 1. Executive summary

The IEMIS import pipeline — backend API Gateway route, xlsx parser, dry-run preview, transformer, dedup, create loop — now works end-to-end for 779-row datasets. CloudWatch logs confirm 779 of 779 Student records were created in the academics DynamoDB table during the commit run at 2026-04-22T14:22:56 UTC, with 0 failures and 0 duplicates.

However, the import's **actual completeness as an EMIS operation is approximately 30-40%**. What got written:

- ✅ Student entity (one per IEMIS row)
- ✅ `emisStudentId` + GSI7 (dedup key)
- ✅ Nested guardian records (with a data-integrity bug — see §5.2)
- ✅ Nested address (heuristic parsing)
- ✅ BS→Gregorian DOB
- ✅ Grade normalization (including new `ECD/PPC` handling)

What got dropped / wasn't created:

- ❌ **Enrollment record** (no Student-to-School-to-AcademicYear-to-Grade tie)
- ❌ **AcademicYear reference** (`Year: 2082` from IEMIS is ignored)
- ❌ **Section / Classroom roster** (`Section` column ignored; Section entity must pre-exist anyway per product decision)
- ❌ **Parent entity** (parents are inline nested records, not first-class entities)
- ❌ **User account for parents** (no portal access)
- ❌ **Ed-Fi descriptors** (Language, Disability, Sex, Race)
- ❌ **Mother Tongue** column ignored
- ❌ **Disability Type** column ignored
- ❌ **Is Transferred** column ignored

The Student dashboard rendering "Total Enrolled: 0" despite 779 Student rows being in DDB is the product visible expression of the enrollment gap — the dashboard counts `Enrollment` rows, which the IEMIS import doesn't create.

---

## 2. Post-mortem: what actually happened on the 2026-04-22 14:22 import

### 2.1 Timeline from CloudWatch

| UTC time | Phase | Detail |
|---|---|---|
| 14:22:30.698 | Dry-run starts (`a3518189-…`) | 779 rows received |
| 14:22:35.487 | Dry-run completes | `transformed=779 valid=779 failed=0 findings=42 durationMs=4789` |
| 14:22:56.843 | Commit starts (`5e7dbf66-…`) | dryRun=false |
| 14:23:01.567 | First createStudent succeeds | `Aachal Kumari Mandal` — first of 779 |
| … | 778 more creates in parallel batches of 10 | |
| 14:24:08.766 | Commit completes | `succeeded=779 failed=0 skipped=0 durationMs=71923` |
| 14:25:07.877 | User re-uploads (`e4aa5066-…`) | Thinking the import failed |
| 14:25:12.748 | Second dry-run completes | `valid=779 would-skip=779 duplicates=779` — GSI7 dedup prevented double-creation |

### 2.2 Why the user saw a 504

The commit path ran for **71.9 seconds** on the backend. Vercel's proxy timeout is ~25s, API Gateway REST's hard integration cap is 29s. Both returned 504 to the browser long before the backend finished. The backend kept working; the operator saw "Something went wrong" in the toast.

GSI7 dedup on the second dry-run (14:25:07) caught this: re-uploading the same file marked all 779 rows as duplicates. The import was **idempotent by design** — no double-creation. So while the UX felt like a failure, the data layer was correct.

### 2.3 Why commit is slow even after the LRU-cache fix

The LRU cache in `DynamoDBClientService.getClient()` solved the dedup-phase latency (~4.8s for 779-row dedup vs the prior 40s). But the **commit phase is still slow** (~67 seconds for 779 individual createStudent calls) because each `createStudent` does more than one DDB put:

Per-row cost on the commit path:
1. `dynamoDBClient.getClient()` — now cached (~µs)
2. `validateStudentNumberUnique()` — DDB Query ~15ms
3. `findByEmisStudentId()` — GSI7 query ~15ms
4. `identityClient.getSchool()` — **HTTP call to identity service** ~50ms (not cached)
5. `dynamoDBClient.putItem()` (student entity) — ~15ms
6. `eventsService.publishSchoolCreated()` — non-blocking, negligible

Batched 10-parallel: ~100-150ms per batch. 78 batches × 150ms ≈ 12s theoretical minimum. Observed 67s. The gap is mostly the HTTP call in step 4 (the identity service is across ECS Service Connect + Node.js event-loop contention on 10 parallel in-flight HTTP calls per batch). There's also some serialization in the SDK layer for concurrent DDB puts.

### 2.4 Why the dashboard shows Total Enrolled = 0

Despite 779 Student rows in DDB:
- `Dashboard.TotalEnrolled` is computed from the `Enrollment` entity, not the `Student` entity
- IEMIS import doesn't create `Enrollment` records
- `AcademicYear` doesn't exist for this school yet
- Result: the dashboard sees 0 enrollments, 0 grade levels covered, 0% attendance

This is not a rendering bug — it's the correct display of a real data-gap: student-creation ≠ student-enrollment in EdForge's data model, and only student-creation happened.

---

## 3. Fundamental mismatch: IEMIS flat rows vs EdForge EMIS entity graph

IEMIS exports are **reporting snapshots** — flat, denormalized, one-row-per-student. EdForge is a **live EMIS system** — normalized, referential, event-driven, with time-series state.

### 3.1 The IEMIS row model

Each row carries:
- Identity fields (Student Id, FullName, Gender, DOB)
- A single point-in-time "Current Class" string
- A single point-in-time "Year" (BS)
- Inline parent names as text
- Semi-structured address strings
- Enum-ish reporting fields (Mother Tongue, Disability Type)

There are **no foreign keys**, no sectionIds, no parentIds. Everything is text.

### 3.2 The EdForge EMIS entity graph

```
Tenant
 └── School
      ├── AcademicYear (status: planning | active | completed | archived)
      │    └── Enrollment (student ↔ grade ↔ year, with state machine)
      │         └── StudentSectionAssociation (student ↔ section, many-to-many)
      ├── Section (pre-created by user; NOT auto-created)
      │    ├── classPeriod / bellSchedule / location
      │    └── SectionRoster
      └── Student
           ├── Guardian[] (currently nested — anti-pattern)
           ├── contactInfo (nested)
           ├── medicalInfo (nested)
           ├── status (separate lifecycle from Enrollment)
           └── Ed-Fi descriptors (missing today)

Identity service:
 └── User (for portal login)
      ├── GlobalRole: TenantAdmin | TenantUser
      └── Linked to Student (self) or Parent (guardian)
```

A proper IEMIS→EdForge import MUST resolve each flat field into the correct node of this graph. Today it only resolves into the `Student` node.

### 3.3 Field-by-field mapping matrix

| IEMIS column | Current behavior | Correct EMIS target | Status |
|---|---|---|---|
| `Student Id` | → `Student.emisStudentId` + GSI7 key | Same | ✅ correct |
| `IEMIS Code` | Warn on school mismatch | Same | ✅ correct |
| `Current School` | Ignored | Redundant with IEMIS Code | ✅ correct |
| `FullName` | Split on last space → firstName/lastName | Split + also emit Ed-Fi `firstSurname`, `otherNames` | ⚠️ partially correct |
| `Gender` | → `Student.gender` enum | Same + Ed-Fi `sexDescriptor` URI | ⚠️ missing descriptor |
| `DOB` | BS→Gregorian → `Student.dateOfBirth` | Same | ✅ correct |
| `CurrentClass` | Normalize → `Student.currentGradeLevel` **string** | Emit Ed-Fi `gradeLevelDescriptor` URI (canonical, not versioned entity) + create `Enrollment` row | ❌ partial — no descriptor, no Enrollment |
| `Section` | **Dropped** | Look up Section by `(schoolId, gradeLevel, sectionName)`; **fail the row if not found** (user pre-creates sections) → `StudentSectionAssociation` | ❌ dropped |
| `Year` | **Dropped** | Look up `AcademicYear` for school; **fail the row if not found** → link to Enrollment | ❌ dropped |
| `Is Transferred` | **Dropped** | → `Enrollment.entryType: 'transferIn'` + Ed-Fi `StudentSchoolAssociation.entryType` | ❌ dropped |
| `Father Name` / `Mother Name` / `Guardian Name` | Inline `Student.guardians[]` | Look up or create `Parent` entity; create `StudentParentAssociation` | ❌ anti-pattern |
| `Guardian Contact Number` | Inline `Student.guardians[n].phone` | `Parent.phone` on canonical Parent entity | ❌ anti-pattern |
| `Permanent Address` / `Temporary Address` | Regex-parse → `Student.contactInfo.address` | Same + emit Ed-Fi `StudentEducationOrganizationAssociation.addresses[]` | ⚠️ heuristic, no descriptor output |
| `Mother Tongue` | **Dropped** | → `Student.homeLanguage` string + Ed-Fi `languageDescriptor` URI | ❌ dropped |
| `Disability Type` | **Dropped** | → `Student.disabilityDescriptors[]` array of Ed-Fi URIs | ❌ dropped |
| `Age` | Ignored | Derivable from DOB | ✅ correct (ignore) |
| `S.N` | Ignored (used only for finding.row) | Same | ✅ correct |

---

## 4. User-corrected design decisions (applied in this report)

Two of my earlier proposals were overridden by product direction. Recording them here so the roadmap reflects the intended direction.

### 4.1 Section handling: require pre-existing, do NOT auto-create

**Original proposal:** at import, look up Section by `(schoolId, gradeLevel, sectionName)`; **create if absent**.

**User correction:** "Not create if absent, user will be required to create all the sections for their school before they import the students."

**Rationale:** section creation is an operational act with capacity, teacher assignment, classroom period, bell schedule, and location context — none of which IEMIS provides. Auto-creating a Section with only a name like `"A"` leaves an underconfigured entity that propagates into scheduling, attendance, and grading downstream. Better UX: block the import with a clear error ("Section `A` in Grade 2 does not exist — create sections first") and let the operator resolve properly.

**Implementation impact:** the IEMIS transformer should emit a row-level error (not warning) when `Section` is present but the Section doesn't exist in EdForge. When `Section` is absent in the source row, no section association is attempted.

### 4.2 Grade Level: canonical Ed-Fi descriptors, not entity versioning

**Original proposal option:** consider modeling `GradeLevel` as a separate entity.

**User correction:** "We don't want to version them. We want to rather use canonical descriptors."

**Rationale:** Ed-Fi already standardized this. `uri://ed-fi.org/GradeLevelDescriptor#SecondGrade` is the canonical identifier. There's no value in EdForge maintaining its own mutable GradeLevel entity — that's reinventing a fixed vocabulary. The current design (string enum `"ECD"`, `"1"`..`"12"`) is acceptable internally; the gap is that we don't additionally emit the canonical Ed-Fi descriptor URI in the Student response and for downstream integrations.

**Implementation impact:** add a pure mapping function `gradeLevelToEdFiDescriptor(code: string): string` in shared-types. Emit the descriptor on Student responses alongside the short code. No entity versioning.

---

## 5. Bugs & data-integrity issues discovered during this import

### 5.1 `guardianId` collision (HIGH severity)

**File:** `server/application/microservices/academics/src/common/mappers/student.mapper.ts:233`

```ts
guardianId: dto.guardianId || `guardian-${Date.now()}`,
```

When a single `createStudent` call processes 3 guardians (father + mother + guardian), the mapper runs three times **synchronously within the same millisecond**. `Date.now()` returns the same value. All three guardians for that student end up with the identical `guardianId`.

**Observed in the 2026-04-22 import (verbatim from the API):**

```json
"guardians": [
  { "guardianId": "guardian-1776867816949", "relationship": "father",   "firstName": "Md. Sariphool" },
  { "guardianId": "guardian-1776867816949", "relationship": "mother",   "firstName": "Hajurul" },
  { "guardianId": "guardian-1776867816949", "relationship": "guardian", "firstName": "Md. Sariphool" }
]
```

**Impact:**
- `linkGuardianToUser(guardianId)` uses `findIndex(g => g.guardianId === guardianId)` — always returns the first match (the father), never the mother or third guardian.
- Parent-portal provisioning will silently link the wrong person.
- De-duplication across siblings (same parent → multiple children) becomes impossible by ID.

**Fix:** replace `Date.now()` with `uuid()` in the mapper. One-line change, no migration needed (existing IDs stay as-is; linking code still works against the first-match for father, which is the intended primary contact anyway).

**Priority:** immediate — should ship before any operator uses the Guardian Portal features.

### 5.2 `studentNumber` assignment under race condition (MEDIUM severity)

The student numbers auto-increment per school per year: `RAS-2026-00003`, `RAS-2026-00384`, etc. For 779 concurrent creates (batched 10-parallel), the numbering order depends on DDB arrival time, not xlsx row order. The correlation between IEMIS `S.N` and EdForge `studentNumber` is essentially random.

**Not a bug** — but operators expecting "row 1 in xlsx → student #1" will be confused. Worth documenting.

### 5.3 UI dashboard reads Enrollment, not Student (EXPECTED, not a bug)

"Total Enrolled: 0" after 779 students imported. Root cause: dashboard queries `Enrollment` table, IEMIS import only writes `Student` table. Closing this requires creating Enrollment records on import — see §6 roadmap.

### 5.4 Vercel 504 on long backend calls (ARCHITECTURAL)

API Gateway REST has a 29s hard timeout. Vercel proxy has ~25s. Long bulk operations hit this even when the backend succeeds. The LRU cache fix got us to 71s for 779-row commits — still over the cap. Options:
- **Async job pattern** (POST returns jobId immediately, worker processes async, frontend polls status)
- **Chunked commit** (client splits 779 into 150-row chunks, 5 API calls, each <20s)
- **Direct ECS → client via presigned SSE stream** (complex, new infra)

Async job pattern is the correct long-term architecture. For V1 pilot — the dry-run is fast enough that operators know the data is valid; the commit can run server-side asynchronously while the operator does other work.

---

## 6. Roadmap: Completing EdForge as an EMIS

### 6.1 Sprint naming convention

We've been calling each increment `Phase 3.x`. I'll keep that pattern.

### 6.2 Immediate (next sprint — pilot-critical)

| # | Name | Effort | Blocks |
|---|---|---|---|
| 3.2 | `guardianId` collision fix | 30 min | Parent portal correctness |
| 3.3 | Async job pattern for IEMIS commit | 1-2 days | Eliminates Vercel 504 for operator |
| 3.4 | AcademicYear + Enrollment creation on IEMIS import | 1-2 days | Dashboard "Total Enrolled" works; multi-year history |
| 3.5 | Student status state machine | 2-3 hours | Prevents invalid status transitions |

### 6.3 Pre-pilot completeness (within 2 weeks)

| # | Name | Effort | Unblocks |
|---|---|---|---|
| 3.6 | Ed-Fi descriptors: sex, language, disability, grade-level, race | 3-4 hours | Federal reporting |
| 3.7 | `Mother Tongue` + `Disability Type` captured from IEMIS | 1 hour | Bilingual ed + IDEA tracking |
| 3.8 | Section pre-existence check on IEMIS import (fail row if missing) | 2-3 hours | Classroom attendance / scheduling |
| 3.9 | `Is Transferred` → Enrollment.entryType | 1 hour | Audit trail |
| 3.10 | Parent entity + StudentParentAssociation (replace nested guardians) | 1-2 days | Parent portal, sibling dedup |

### 6.4 Post-pilot infrastructure

| # | Name | Effort | Unblocks |
|---|---|---|---|
| 3.11 | Reverse IEMIS sync (push EdForge → government portal) | 1-2 weeks | Compliance automation |
| 3.12 | Bulk attendance + bulk grade import (reuse import pipeline) | 1 week | Teacher workflow |
| 3.13 | EventBridge fan-out for StudentCreated, Enrolled, ParentLinked | 3-4 hours | Analytics correctness |
| 3.14 | Full Ed-Fi API surface on Student responses | 2-3 days | Third-party integrations |

---

## 7. Proposed async-job pattern for Phase 3.3

This is the most impactful structural change. Sketch:

```
POST /academics/students/import/iemis
  { students: [...], schoolId, dryRun?: true }

  → dryRun=true: synchronous (already fast enough at ~5s for 779 rows)
    returns { succeeded, failed, skipped, findings, duplicates }

POST /academics/students/import/iemis/jobs
  { students: [...], schoolId }

  → returns 202 Accepted + { jobId, status: 'queued' }
    publishes to SQS, worker Lambda picks up, processes in background
    completes in however long it takes (no proxy timeout concerns)

GET /academics/students/import/iemis/jobs/:jobId
  → returns { status: 'queued' | 'running' | 'completed' | 'failed',
              progress: { processed, total }, result?: IemisImportResult }
  → frontend polls every 5s
```

Timing budget:
- Dry-run: stays synchronous, <10s
- Commit: async. Even 2 minutes doesn't matter — operator sees "Importing 779 students…" progress bar and keeps working.

Backend changes:
- New SQS queue `edforge-academics-iemis-import-jobs`
- New worker Lambda (or reuse aggregator Lambda pattern)
- Job state stored in a new DDB item or the existing academics table with `entityKey: JOB#<jobId>`
- Idempotent processing (consumer checks if job already completed before redoing work)

Frontend changes:
- `POST /jobs` instead of `POST /` for commit
- Polling hook (TanStack Query with `refetchInterval: 5000` until status='completed')
- Reuse the existing `IemisImportResults` component for final render

This is a clean architectural move, not a patch. It aligns with how every mature EMIS/SIS handles bulk operations (PowerSchool, Infinite Campus, Skyward, Ellucian).

---

## 8. Appendix A — CloudWatch receipts

**Dry-run (2026-04-22T14:22:30 UTC, correlation `a3518189-…`):**
```
importStudentsIemis: entry schoolId=7031d447-… rows=779 dryRun=true
importStudentsIemis(dryRun): transformed=779 valid=779 failed=0 findings=42 durationMs=4789
```

**Commit (2026-04-22T14:22:56 UTC, correlation `5e7dbf66-…`):**
```
importStudentsIemis: entry schoolId=7031d447-… rows=779 dryRun=false
… 779 "Student created: X (uuid)" entries …
importStudentsIemis: succeeded=779 failed=0 skipped=0 findings=42 durationMs=71923
```

**Second dry-run (14:25:07, correlation `e4aa5066-…`):** all 779 marked as duplicates via GSI7 — proves idempotency.

## 9. Appendix B — What's on the Student entity today

Direct fields written by the IEMIS import:
- `studentId` (uuid), `studentNumber` (auto-gen), `emisStudentId`
- `firstName`, `lastName`, `dateOfBirth`, `gender`
- `currentGradeLevel` (string, not descriptor)
- `status: "pending"` (not yet `"active"` — enrollment activation missing)
- `contactInfo.address` when source had a real permanent/temporary address
- `guardians[]` nested array (with the `guardianId` collision bug)

Not written by the IEMIS import (but the fields exist on the entity):
- `enrollmentDate`, `withdrawalDate`
- `academicCalendarType`, `primaryLanguage`, `homeLanguage`
- `specialPrograms`, `accommodations`
- `medicalInfo`
- `portalUserId`
- Ed-Fi descriptors: `sexDescriptor`, `raceDescriptor`, `ethnicityDescriptor`, `languageDescriptor`, `disabilityDescriptors[]`, `gradeLevelDescriptor`, `birthCountryDescriptor`

## 10. Sign-off

This report represents the state as-of 2026-04-22 after deploying:
- `b53525f` — Phase 4 observability
- `0a358e8` — API Gateway route for IEMIS
- `bb75925` — dedup parallelization (superseded by cache)
- `3f3141e` — shared-client threading (superseded by cache)
- `3b9a4c7` — ECD/PPC normalization + tenant-scoped DDB client LRU cache

Commit history is on branch `sprint/phase-4-observability` at github.com/shoaibrain/edforge.

Next action: prioritize the six items in §6.2 for the next sprint. Start with the `guardianId` fix (30 min; ships first). Then the async-job pattern (Phase 3.3) — it's the architectural cornerstone that unblocks every future bulk operation.
