# Sprint A.3 — Exam Subsystem Backend: Sprint Plan

> **Drafted:** 2026-05-22
> **Status:** 🟡 Draft — awaiting sign-off before branch cut
> **Master-plan section:** `v1-master-epic-breakdown.md` §3 Sprint A.3 (lines 582–654)
> **Companion precedents:** [`a2-sprint-plan.md`](./a2-sprint-plan.md), [`c4-fe-sprint-plan.md`](./c4-fe-sprint-plan.md), [`c0-c-3-deploy-plan.md`](./c0-c-3-deploy-plan.md)

---

## 1. Why this sprint, why now

### Critical-path argument

A.3 is the natural next link in the EPIC-A pipeline and unlocks the largest downstream chain still pending in V1:

```
A.3 (Exam) ─┬─→ A.4 (Result) ─┬─→ C.4.3 Report Card render (needs ResultCard entity)
            │                  ├─→ D.2.5 PromotionRule batch eval (reads ResultCard for academic-pass)
            │                  └─→ D.4.6 / D.5.4 ExternalExamResult import (denormalizes ResultCard.courseScores[])
            └─→ Operator value: define term-end exams, enter marks, close exam → audit + events
```

One A.3 sprint primes 3+ downstream sprints. D.2 alone primes 1 (cross-year handoff, urgent ~10 months out).

### Foundation in place (post-A.2)

- ✅ `Course` entity carries `academicSubject` + `curriculumRef` + `stateSubjectCode` (A.2.1 shipped via [#152](https://github.com/shoaibrain/edforge/pull/152))
- ✅ `PABSON_COURSE_CATALOG` seeded on `dev-pabson-primary` (A.2.5 ran 2026-05-22; 17 CREATE + 4 PATCH; idempotency proven)
- ✅ `examPatternKeySchema` enum in shared-types — `unit_test | terminal | send_up | pre_board | final | monthly_test` ([archetype-defaults.schema.ts:86](../../packages/shared-types/src/schemas/archetype-defaults.schema.ts#L86))
- ✅ `PABSON.examPattern = ['unit_test', 'terminal', 'send_up', 'pre_board', 'final']` in archetype-defaults table ([archetype-defaults.ts](../../packages/shared-types/src/archetype/archetype-defaults.ts))
- ✅ `GradingPolicy` with CEHRD scale + `NG` (D.1 shipped) — A.4's term-aggregation will consume this; A.3 itself doesn't need it for raw-score persistence
- ✅ Existing `Grade.courseId` mark-entry path (kept for non-exam grading); A.3's `ExamScore` is a parallel structured path with state machine + lifecycle
- ✅ nginx `/academics` prefix already routed — all A.3 new routes ride this block, no nginx change

### Per §0 philosophy (CEO 2026-05-22)

Product completeness drives V1; Saraswati's calendar does not gate sprint priorities. A.3 closes a Nepal-archetype-completeness gap (Term-end exam workflow exists in concept but isn't first-class in the data model today). The Operate → Distribute pipeline rides on this.

---

## 1.5 Architecture principle — Core Ed-Fi V6 + Edges by archetype (carry-over from A.2)

**Same load-bearing discipline as A.2 — every implementation decision below MUST be evaluated against it.**

### Statement (unchanged from `a2-sprint-plan.md` §1.5)

EdForge's data model is **Ed-Fi V6 at the Core** (canonical, archetype-blind entities, descriptors, validators, engines) with **archetype-specific Edges at the boundary** (seeds, catalogs, defaults — never inside service code).

### Layer mapping for A.3

| Layer | Lives in | Archetype-aware? | A.3 contributions |
|---|---|---|---|
| **Core — Ed-Fi V6 canonical** | `packages/shared-types/src/schemas/academics/`, `server/application/microservices/academics/src/exams/`, `server/application/microservices/academics/src/common/entities/exam.entity.ts` | NO — must pass invariant-12 grep clean | A.3.2 `Exam` entity (Ed-Fi `Assessment` analogue); A.3.3 `ExamCourse` (Ed-Fi `AssessmentSection`); A.3.4 `ExamScore` (Ed-Fi `StudentAssessmentScoreResult`); A.3.5-A.3.9 CRUD + state machine + bulk |
| **Edge — Archetype boundary** | `packages/shared-types/src/archetype/archetype-defaults.ts` `PABSON.examPattern` | YES — already shipped 0.4 | A.3 reads this for `examType` validation; does NOT introduce new edge data |
| **Service runtime** | `server/application/microservices/academics/src/exams/` | NO — treats every exam identically | A.3.5-A.3.9 controllers + services |

### Specific invariants A.3 enforces

1. **`Exam.examType` is a Core descriptor value**, not an archetype-specific string. Validates against `examPatternKeySchema` at the Zod pipe; the *set* of valid values for a given school is determined by `archetypeDefaults[archetype].examPattern` (read at validation time, no archetype branch in service code).
2. **`ExamCourse.courseId` is a Core FK to A.2's Course entity.** The Course carries `academicSubject` descriptor for downstream aggregation (A.4 ResultCard, D.4.6 BLE result import). Validated at write time against existing Course rows for the school.
3. **`ExamScore.enrollmentId` is the entity key** (per invariant 3 + master plan A.3.4) — NOT `(studentId, examId)`. This preserves cross-year integrity: when a student's enrollment row is rewritten during grade promotion (D.2.10), the ExamScore stays bound to the prior-AY enrollment.
4. **Term-aggregation engine (Sprint A.4) reads `gradingScale` from `SchoolConfiguration`** via `archetypeDefaults` lookup — archetype-blind compute over data-driven config. A.3 doesn't introduce term-aggregation (that's A.4) but lays the data shape.
5. **Service code stays `grep 'archetype' → 0 hits`** in `server/application/microservices/academics/src/exams/`. Any conditional behavior is data-driven via the descriptor enums.

### Anti-pattern guardrails (rejected at PR review)

- `if (tenant.archetype === 'PABSON') exam.allowedTypes = […]` → reject (read from `archetypeDefaults[archetype].examPattern` instead)
- `passingMarks = 32 // PABSON CDC default` → reject (read from SchoolConfiguration default per A.3.3 spec)
- Hardcoded `'send_up'` or `'pre_board'` in service code → reject (validate against `examPatternKeySchema` only)
- Bulk score endpoint that doesn't chunk → reject (DDB TransactWriteItems max 100/op per A.3.9 spec)

---

## 2. Scope

### In-scope

| Ticket | Summary | Sized |
|---|---|---|
| A.3.1 | Curriculum readiness audit doc (confirms A.2 + dev-pabson-primary backfill done) | XS |
| A.3.2 | `Exam` entity (academics) — `examId`, `examName`, `termId`, `examType`, `startDate`, `endDate`, `status`; GSI1 school-scope, GSI2 term-scope | M |
| A.3.3 | `ExamCourse` entity — `examCourseId`, `examId`, `courseId` FK, `maxMarks`, `passingMarks`, `creditHours` | M |
| A.3.4 | `ExamScore` entity — `examScoreId`, `examId`, `examCourseId`, `enrollmentId` (keyed), `rawScore`, `status`, `enteredBy/At`; GSI2 student-centric for cross-AY | M |
| A.3.5 | Exam CRUD endpoints — `POST/GET/LIST /academics/exams` + `PATCH/DELETE /academics/exams/{examId}` | M |
| A.3.6 | ExamCourse CRUD — `POST/GET/LIST /academics/exams/{examId}/courses` with Course FK validation | M |
| A.3.7 | ExamScore CRUD (single) — `POST/GET/LIST /academics/exams/{examId}/scores` | M |
| A.3.8 | Exam state machine — `PATCH /academics/exams/{examId}/status` with audit + event per valid transition; 409 on invalid | S |
| A.3.9 | Bulk score entry — `POST /academics/exams/{examId}/scores/bulk` chunked at 100 + correlation ID idempotency | M |
| A.3.10 | Score-validation Zod schemas (shared-types) — `exam.schema.ts`, `exam-course.schema.ts`, `exam-score.schema.ts` | S |
| A.3.11 | Parametric pilot exam smoke — `scripts/smoke-tests/pilot-exam-flow.ts` accepts `PILOT_ID` env | S |

### Out-of-scope (deferred, with reason)

| Item | Why |
|---|---|
| Term-aggregation engine (A.4.1) | Sprint A.4 scope; A.3 ships the raw-score persistence + state machine. Aggregation reads ExamScore + GradingPolicy → ResultCard, which A.4 entity (A.4.2) doesn't exist yet. |
| `ResultCard` entity | A.4 scope |
| Result generation Lambda (A.4.3) | A.4 scope |
| Conduct + remarks endpoints (A.4.4) | A.4 scope (depends on A.4.2 ResultCard) |
| Frontend exam UI | Post-A.3 follow-up; operator can use API directly via curl / Postman initially; saas-frontend academics MFE wiring is separate work |
| Academics `module-wiring.spec.ts` | Sprint 0.3 scope (per daily-use audit gap #8). A.3 introduces a new `exams.module.ts`; we rely on post-deploy ECS log sanity for Nest bootstrap verification (per memory `feedback_module_wiring_invariant`). Risk-tracked in §5. |
| Full `auditedWrite()` migration for exam writes | Sprint 0.3 scope. A.3 uses existing courses-service-style audit/event pattern (same precedent as A.2 + D.1). |
| `ExamCourse.passingMarks` from SchoolConfiguration FK | V1 fallback: PABSON default `32` (CDC standard) hardcoded in catalog seed; operator can override per-ExamCourse on POST. Reading from SchoolConfiguration is a follow-up Sprint A.3.x or V1.5 enhancement. (See §8 Open decisions.) |
| Re-grading / score correction with audit trail beyond updatedAt | V1 ships `PATCH /academics/exams/{examId}/scores/{scoreId}` allowing updates while `Exam.status` is in `{ entered, locked }`; per-cell history is V1.5 |
| New nginx prefix | N/A — all A.3 routes ride existing `/academics` location block |

### Already-shipped foundation (post-A.2)

- `examPatternKeySchema` enum (Sprint 0.4) — A.3.2 reuses, does NOT redefine
- `PABSON.examPattern` archetype-default data (Sprint 0.4) — A.3.5 reads at validation time
- `Course.academicSubject` (Sprint A.2) — A.3.3 ExamCourse.courseId FK enables downstream aggregation
- Existing courses.service audit/event pattern (`publishCourseCreated`, `publishCourseUpdated`) — A.3 mirrors this for exam.created / exam.updated / exam.status_transitioned / exam.scores_recorded
- nginx `^/academics` location block — all A.3 routes covered

---

## 3. PR cadence — 3 phases

### Phase 1 — shared-types Zod schemas + A.3.1 audit doc (1 PR)

**Tickets:** A.3.1 + A.3.10 (+ implicit Exam + ExamCourse schemas needed by Phase 2)

**Files:**
- NEW `docs/pilot-greenlight/a3-curriculum-readiness-audit.md` (A.3.1)
- NEW `packages/shared-types/src/schemas/academics/exam.schema.ts` — `createExamSchema`, `updateExamSchema`, `examResponseSchema`, `examFilterSchema`, `examStatusSchema` (enum: `draft | scheduled | in_progress | closed | published`), `examStateTransitionSchema`
- NEW `packages/shared-types/src/schemas/academics/exam-course.schema.ts` — `createExamCourseSchema`, `updateExamCourseSchema`, `examCourseResponseSchema`
- NEW `packages/shared-types/src/schemas/academics/exam-score.schema.ts` (A.3.10) — `createExamScoreSchema`, `updateExamScoreSchema`, `bulkExamScoreSchema` (with `correlationId` + `scores[]`), `examScoreResponseSchema`, `examScoreFilterSchema`
- NEW spec files: `exam.schema.spec.ts`, `exam-course.schema.spec.ts`, `exam-score.schema.spec.ts` (≥30 assertions covering enum/range/FK-shape validation positives + negatives)
- MODIFIED `packages/shared-types/src/schemas/academics/index.ts` — barrel exports
- MODIFIED `packages/shared-types/src/index.ts` — re-export per academics barrel
- MODIFIED `packages/shared-types/package.json` — 0.56.0 → 0.57.0
- MODIFIED `server/application/package.json` + `server/package.json` — caret pins `^0.56.0` → `^0.57.0` (R39 mitigation, SAME PR)

**Deploy:** publish `@aibrains/shared-types@0.57.0` → npm verify → root lockfile refresh → AdminWeb jsdom sim (per CLAUDE.md per-sprint publish checklist) → merge PR → controlplane redeploy IF AdminWeb consumes new exam types (it probably won't in V1; verify with grep before deploying).

### Phase 2 — academics service entities + controllers + state machine + bulk (1 PR)

**Tickets:** A.3.2 + A.3.3 + A.3.4 + A.3.5 + A.3.6 + A.3.7 + A.3.8 + A.3.9

**Files:**
- NEW `server/application/microservices/academics/src/common/entities/exam.entity.ts` — `Exam` interface + `createExamEntity` factory + `EntityKeyBuilder.exam(...)` + `GSIKeyBuilder.examScope(...)` (or reuse existing)
- NEW `server/application/microservices/academics/src/common/entities/exam.entity.spec.ts` — entity factory + GSI casing (lowercase per S3.2 convention) + cross-AY query shape
- NEW `server/application/microservices/academics/src/common/entities/exam-course.entity.ts` + `.spec.ts`
- NEW `server/application/microservices/academics/src/common/entities/exam-score.entity.ts` + `.spec.ts` (keyed by `enrollmentId` per invariant 3)
- NEW `server/application/microservices/academics/src/exams/exams.module.ts`
- NEW `server/application/microservices/academics/src/exams/exams.controller.ts` — A.3.5 Exam CRUD + A.3.8 state-machine PATCH
- NEW `server/application/microservices/academics/src/exams/exams.service.ts` — A.3.5 CRUD impl + A.3.8 state-machine transitions service (with audit/event emit)
- NEW `server/application/microservices/academics/src/exams/exam-state-machine.ts` — pure-function state-machine util (allowed transitions table + `validateTransition()`)
- NEW `server/application/microservices/academics/src/exams/exam-courses.controller.ts` — A.3.6
- NEW `server/application/microservices/academics/src/exams/exam-courses.service.ts` — A.3.6 with Course FK validation (calls existing courses.service.getCourse)
- NEW `server/application/microservices/academics/src/exams/exam-scores.controller.ts` — A.3.7 + A.3.9 bulk
- NEW `server/application/microservices/academics/src/exams/exam-scores.service.ts` — A.3.7 single + A.3.9 bulk-chunked-TransactWriteItems
- NEW `server/application/microservices/academics/src/common/mappers/exam.mapper.ts`, `exam-course.mapper.ts`, `exam-score.mapper.ts` — entity↔DTO round-trip
- NEW spec files for service tests (4 services × ~10 specs each ≈ 40 assertions)
- MODIFIED `server/application/microservices/academics/src/academics.module.ts` — import `ExamsModule`
- MODIFIED `server/application/microservices/academics/src/common/entities/index.ts` — export new entities
- MODIFIED `server/application/microservices/academics/src/common/services/academics-events.service.ts` — add `publishExamCreated`, `publishExamUpdated`, `publishExamStatusTransitioned`, `publishExamScoreRecorded`, `publishExamScoresBulkRecorded` (PascalCase per existing pattern; B.2.2 migration to snake-dotted is V1.5)
- MODIFIED `server/lib/tenant-api-prod.json` — add ~6 new path entries:
  - `/academics/exams` (POST, GET)
  - `/academics/exams/{examId}` (GET, PATCH, DELETE)
  - `/academics/exams/{examId}/status` (PATCH)
  - `/academics/exams/{examId}/courses` (POST, GET)
  - `/academics/exams/{examId}/courses/{examCourseId}` (GET, PATCH, DELETE)
  - `/academics/exams/{examId}/scores` (POST, GET)
  - `/academics/exams/{examId}/scores/bulk` (POST)
  - `/academics/exams/{examId}/scores/{scoreId}` (GET, PATCH)

**No nginx.template change** — all routes under existing `^/academics` location block.

**Deploy:** academics ECR build + push + ECS rolling update `academicsbasic` on `ap-south-1`; tee deploy logs; wait services-stable; post-deploy ECS log sanity check (Nest bootstrap + DI graph healthy — proxy for missing module-wiring spec per §5 R-A3.4).

### Phase 3 — parametric pilot smoke + execution (1 PR + operator-led run)

**Tickets:** A.3.11

**Files:**
- NEW `scripts/smoke-tests/pilot-exam-flow.ts` — parametric (`PILOT_ID` env), covers:
  1. Create Term-1 exam (`POST /academics/exams`) → 201 with `examId`
  2. Transition `draft → scheduled` via state machine → 200 + audit
  3. Add 5 ExamCourses referencing real Course rows from the school (assumes A.2.5 backfill has run; for prod Saraswati, smoke skips this and just exercises the synthetic-course path)
  4. POST 10 individual ExamScores → 201 each
  5. POST bulk 20 scores with correlationId → 200 + chunked
  6. Retry the same bulk POST → 200 idempotent (correlationId match)
  7. Transition `scheduled → in_progress → closed → published` → each 200 + event
  8. Attempt invalid transition (`published → in_progress`) → 409 `EXAM_STATE_INVALID_TRANSITION`
  9. Cleanup: DELETE the synthetic Exam + cascade ExamCourses + ExamScores

**Deploy:** no infra change. Script execution against `dev-pabson-primary` school `4209e3d8-…` (same target as A.2.5). Fresh Cognito JWT to `/tmp/dev-jwt.txt` per memory `feedback_just_ask_for_a_prod_token`. Operator-led — request authorization per `feedback_commit_and_deploy_approval`.

---

## 4. Per-ticket detail (with §1.1 atomic conventions)

### A.3.1 — Curriculum / Course extension readiness audit

**Files:** Phase 1.
- `docs/pilot-greenlight/a3-curriculum-readiness-audit.md` (NEW; ~50 lines)

**Validation:** confirms A.2 shipped + dev-pabson-primary backfilled with `academicSubject` + `curriculumRef` populated; cites A.2 closeout entry; flags prod Saraswati does NOT yet have Course data (operator-led when ready).

**AC:** Audit committed; readiness confirmed for `dev-pabson-primary`; explicit "prod Saraswati NOT in scope for A.3.11 smoke" call-out (per CEO 2026-05-22).

**Deps:** A.2.1–A.2.5 (all ✅).

### A.3.2 — `Exam` entity

**Files:** Phase 2.
- `microservices/academics/src/common/entities/exam.entity.ts` (NEW)

**Entity shape** (mirrors existing Course pattern):
```typescript
export interface Exam extends BaseEntity {
  entityType: 'EXAM';
  examId: string;
  examName: string;
  schoolId: string;
  termId: string;
  academicYearId: string;
  examType: ExamPatternKey;           // 'unit_test' | 'terminal' | 'send_up' | 'pre_board' | 'final' | 'monthly_test'
  startDate: string;                  // ISO date
  endDate: string;                    // ISO date
  status: ExamStatus;                 // 'draft' | 'scheduled' | 'in_progress' | 'closed' | 'published'
  description?: string;
  totalMaxMarks?: number;             // denormalized sum of ExamCourse.maxMarks (read-side convenience)
  // GSI Keys (lowercase per S3.2)
  gsi1pk: string;  // 'tenant#{tid}#school#{schoolId}'
  gsi1sk: string;  // 'exam#{academicYearId}#{termId}#{examName}'
  gsi2pk: string;  // 'term#{termId}'  for cross-school term queries
  gsi2sk: string;  // 'exam#{status}#{startDate}'
}
```

**Validation:**
- Entity factory unit (`createExamEntity({...})` returns valid)
- Contract test (entity-vs-schema mapper round-trips all fields)
- GSI casing assertion inline (all gsi*pk/sk produced lowercase per S3.2 + memory `project_s3_2_gsi_casing_shipped`)
- Cross-AY query shape via GSI2 (`begins_with(gsi2pk, 'term#')` returns all exams for a term across schools)

**AC:**
- Factory + contract green
- GSI keys lowercase (regression guard against the S3.2 trap)
- Module-wiring NOT updated (academics has no spec yet — see §5 R-A3.4)
- `tenantId` column carries bare UUID per memory `edforge_identity_ddb_bare_uuid_partition_key`
- Entity exported from `common/entities/index.ts`

**Deps:** A.2.1 ✅ + 0.4 ✅ (examPatternKey enum).

### A.3.3 — `ExamCourse` entity

**Files:** Phase 2.
- `microservices/academics/src/common/entities/exam-course.entity.ts` (NEW)

**Entity shape:**
```typescript
export interface ExamCourse extends BaseEntity {
  entityType: 'EXAM_COURSE';
  examCourseId: string;
  examId: string;
  schoolId: string;
  courseId: string;                   // FK to Course (A.2.1)
  // Denormalized for query convenience (write-time copy from Course)
  courseName?: string;
  courseCode?: string;
  academicSubject?: AcademicSubjectDescriptor;  // A.2 descriptor — enables A.4 aggregation by subject
  maxMarks: number;                   // 0-1000, validated on POST
  passingMarks: number;               // default 32 (PABSON CDC), operator-overridable; future: SchoolConfiguration FK
  creditHours?: number;               // optional weighting for term-aggregation
  // GSI Keys (lowercase)
  gsi1pk: string;  // 'tenant#{tid}#school#{schoolId}'
  gsi1sk: string;  // 'exam-course#{examId}#{courseCode}'
  gsi2pk: string;  // 'exam#{examId}'  for "list courses on this exam"
  gsi2sk: string;  // 'course#{courseCode}'
}
```

**Validation:**
- Entity factory unit
- Contract test
- FK validation at write time: `createExamCourse()` service path calls existing `coursesService.getCourse(courseId, schoolId, ctx)` → 404 if Course doesn't exist
- Denormalization round-trip: `courseName`, `courseCode`, `academicSubject` copied at write; not re-read for updates

**AC:**
- FK validation on POST returns 404 with errorCode `COURSE_NOT_FOUND` if `courseId` not found
- `passingMarks` defaults to 32 if not provided (PABSON CDC; documented; widening to SchoolConfiguration is V1.5)
- `0 ≤ passingMarks ≤ maxMarks` invariant enforced (4xx `PASSING_MARKS_EXCEEDS_MAX` otherwise)
- `0 < maxMarks ≤ 1000`
- Academic subject denormalized at write so A.4 aggregation doesn't need extra GetItem per row

**Deps:** A.2.1 ✅ + A.3.2.

### A.3.4 — `ExamScore` entity (keyed by `enrollmentId` per invariant 3)

**Files:** Phase 2.
- `microservices/academics/src/common/entities/exam-score.entity.ts` (NEW)

**Entity shape:**
```typescript
export interface ExamScore extends BaseEntity {
  entityType: 'EXAM_SCORE';
  examScoreId: string;
  examId: string;
  examCourseId: string;               // FK to ExamCourse
  enrollmentId: string;               // KEYED here, NOT (studentId, examId) — per invariant 3
  // Denormalized for query + audit convenience
  schoolId: string;
  studentId: string;                  // copy from Enrollment at write
  rawScore: number;                   // 0 ≤ rawScore ≤ ExamCourse.maxMarks
  status: ExamScoreStatus;            // 'entered' | 'locked'
  enteredBy: string;                  // userId
  enteredAt: string;                  // ISO timestamp
  correlationId?: string;             // bulk-write idempotency marker (A.3.9)
  // GSI Keys (lowercase)
  gsi1pk: string;  // 'tenant#{tid}#school#{schoolId}'
  gsi1sk: string;  // 'exam-score#{examId}#{examCourseId}#{enrollmentId}'
  gsi2pk: string;  // 'student#{studentId}'  for cross-AY student transcript lookup
  gsi2sk: string;  // 'exam-score#{academicYearId}#{termId}#{examId}'
  gsi3pk?: string; // 'enrollment#{enrollmentId}'  for "all exam scores for this enrollment"
  gsi3sk?: string; // 'exam-score#{examId}'
}
```

**Validation:**
- Entity factory unit
- Contract test
- Cross-AY query test: 2 scores under same studentId in different academicYears → both returnable via GSI2 (`begins_with(gsi2sk, 'exam-score#')`)
- Key shape invariant: `enrollmentId` populated at write; never `studentId#examId` composite

**AC:**
- References `enrollmentId` (not `(studentId, examId)`) per invariant 3
- References `examCourseId` (not legacy `examSubjectId`) per A.2.0 / v3.4 rename
- Cross-year aggregation works (GSI2 student-centric)
- `enteredBy` audit field populated from JWT context.userId

**Deps:** A.3.3.

### A.3.5 — Exam CRUD endpoints

**Files:** Phase 2.
- `exams.controller.ts` (NEW): `POST /exams`, `GET /exams/:examId`, `GET /exams` (LIST with filters), `PATCH /exams/:examId`, `DELETE /exams/:examId`
- `exams.service.ts` (NEW): CRUD impl
- `tenant-api-prod.json` MODIFIED — new paths (§3 Phase 2 file list)

**Validation:**
- jest integration: POST → 201 + entity; GET → 200; LIST with `termId` filter via GSI2; PATCH → 200 + version++; DELETE → 204 (soft-delete `isActive=false`)
- Live curl post-deploy: 4-curl smoke (POST + GET + LIST + PATCH)
- Validates `startDate ≤ endDate` at POST/PATCH
- Validates `examType` ∈ `archetypeDefaults[archetype].examPattern` (read at validation time; archetype-blind in service code per invariant 12)

**AC:**
- 2xx on happy path; 4xx with errorCode on validation failures
- Audit row per write (existing `auditedWrite` pattern from courses-service style)
- Event per write (`exam.created` / `exam.updated`) — PascalCase per existing academics events convention (B.2.2 migration to snake-dotted is V1.5 scope)
- Three-way handoff: Nest controller + `tenant-api-prod.json` (no nginx change — `/academics/exams` rides existing prefix per §3)

**Deps:** A.3.2.

### A.3.6 — ExamCourse CRUD endpoints

**Files:** Phase 2.
- `exam-courses.controller.ts` + `exam-courses.service.ts` (NEW)
- `tenant-api-prod.json` paths added

**Validation:**
- jest integration: POST `/academics/exams/:examId/courses` with valid `courseId` → 201
- FK rejection: POST with `courseId` not found → 404 `COURSE_NOT_FOUND`
- FK rejection: POST with `examId` not found → 404 `EXAM_NOT_FOUND`
- `passingMarks > maxMarks` → 400 `PASSING_MARKS_EXCEEDS_MAX`
- LIST `/academics/exams/:examId/courses` → 200 with array

**AC:**
- Validates against existing Course rows (via `coursesService.getCourse`)
- 4xx on invalid FK; structured errorCodes per project convention
- Downstream queries can aggregate by `Course.academicSubject` for A.4 dashboard
- Denormalized `courseName` + `courseCode` + `academicSubject` populated at write

**Deps:** A.3.3 + A.3.5.

### A.3.7 — ExamScore CRUD endpoints (single)

**Files:** Phase 2.
- `exam-scores.controller.ts` + `exam-scores.service.ts` (NEW; bulk shares same controller in A.3.9)

**Endpoints:**
- `POST /academics/exams/{examId}/scores` (single) — request: `{ examCourseId, enrollmentId, rawScore }`
- `GET /academics/exams/{examId}/scores/{scoreId}` — single
- `GET /academics/exams/{examId}/scores` — LIST with optional filters (`examCourseId`, `enrollmentId`, cursor pagination)

**Validation:**
- jest integration: POST valid → 201
- POST with `rawScore > maxMarks` → 400 `SCORE_EXCEEDS_MAX`
- POST with `exam.status === 'closed'` or `'published'` → 409 `EXAM_LOCKED`
- POST with `exam.status === 'draft'` → 409 `EXAM_NOT_SCHEDULED` (must be in `scheduled` or `in_progress` to accept scores)
- POST with non-existent `examCourseId` → 404
- POST with non-existent `enrollmentId` (validate against academics enrollment service) → 404

**AC:**
- Validates `0 ≤ rawScore ≤ maxMarks` (reads maxMarks from referenced ExamCourse at write time)
- State machine guard: only `scheduled` + `in_progress` accept score writes
- 409 with `EXAM_LOCKED` for closed/published; 409 `EXAM_NOT_SCHEDULED` for draft
- 404 on missing FKs with distinct errorCodes (`EXAM_COURSE_NOT_FOUND`, `ENROLLMENT_NOT_FOUND`)
- Audit + event per write

**Deps:** A.3.4 + A.3.5.

### A.3.8 — Exam state machine

**Files:** Phase 2.
- `exam-state-machine.ts` (NEW) — pure function `validateTransition(current, next): ValidationResult`
- `exams.controller.ts` PATCH `/exams/:examId/status` endpoint
- `exams.service.ts` `transitionStatus()` method (audit + event per transition)

**State graph:**
```
draft ─→ scheduled ─→ in_progress ─→ closed ─→ published
   ↑                                              │
   └──────────────────────────────────────────────┘  (only operator-override re-open? V1: NO; published is terminal)

Allowed back-edges:
   scheduled ─→ draft   (operator un-schedules before window opens)
   in_progress ─→ scheduled  (operator postpones)

Rejected transitions: anything else → 409 EXAM_STATE_INVALID_TRANSITION
```

**Validation:**
- Unit-table: every valid transition pair (positive) + every invalid pair (negative)
- Integration: PATCH status → 200 + audit row + `exam.status_transitioned` event
- Idempotent re-call (target status === current status) → 200 (NOT 409), no audit + no event (transition was a no-op)
- 100% transition coverage in spec

**AC:**
- Pure function; archetype-blind (no `tenant.archetype` reads)
- Idempotent re-call returns 200 (per master plan A.3.8 AC)
- Audit + event per VALID transition; no audit on no-op
- `published` is terminal in V1; un-publish requires operator-led inline DDB ops (out of scope)

**Deps:** A.3.5.

### A.3.9 — Bulk score entry chunked at 100

**Files:** Phase 2.
- `exam-scores.service.ts` `recordBulk(scores: BulkExamScorePayload, ctx): BulkResult`
- `exam-scores.controller.ts` `POST /academics/exams/{examId}/scores/bulk` endpoint

**Bulk payload shape:**
```typescript
{
  correlationId: string;              // client-generated UUID for idempotency
  scores: Array<{
    examCourseId: string;
    enrollmentId: string;
    rawScore: number;
  }>;
}
```

**Chunking + atomicity:**
- DDB `TransactWriteItems` max 100 items per transaction
- Chunk the `scores[]` at 100; each chunk = 1 transaction
- Per-chunk: `transactWrite([Put(ExamScore × 100)])` with `attribute_not_exists(entityKey)` for idempotency
- Failure of one chunk → rolls back THAT chunk only; other chunks retain on retry
- ONE `exam.scores_recorded` event per successful chunk (NOT per score) with `{ chunkSize, examId, correlationId, count }` payload

**Idempotency:**
- Each ExamScore carries `correlationId` from request
- Re-POST with same correlationId + matching `examId` → service detects via GSI4 (`correlation#{correlationId}`) or simple-scan-with-filter on small batch sizes (V1; index optimization V1.5)
- Returns `{ alreadyProcessed: true, scoresCreated: 0, scoresSkipped: N }` on full match
- Partial-match (some scores match, some new) → 409 `BULK_PARTIAL_RETRY_NOT_SUPPORTED` (operator must split and retry cleanly)

**Validation:**
- Integration with 250-score payload → 3 chunks, all OK
- Retry with same correlationId → 200 idempotent (0 new writes)
- One chunk failure (synthetic `ConditionalCheckFailedException`) → rolls back ONLY that chunk
- Per-chunk audit row + per-chunk event

**AC:**
- Atomic per chunk
- Failure rolls back chunk not whole bulk
- ONE event per chunk with count in payload
- correlationId enables idempotent retries

**Deps:** A.3.7.

### A.3.10 — Score validation Zod schemas

**Files:** Phase 1 (above).
- `packages/shared-types/src/schemas/academics/exam-score.schema.ts` (NEW) — `createExamScoreSchema`, `bulkExamScoreSchema`, `examScoreResponseSchema`, `examScoreFilterSchema`
- Also Phase 1: corresponding `exam.schema.ts` + `exam-course.schema.ts` (implicitly required by A.3.2/A.3.3 even though not explicitly listed in master plan)

**Validation:**
- Schema unit tests (range, enum, FK-shape positives + negatives)
- Integration negatives: each invalid input shape returns expected errorCode

**AC:**
- 4xx errors structured per project errorCode schema (e.g. `INVALID_PAYLOAD` with `details: { fieldPath, code, expected }`)
- All shapes type-derive correctly (TS infers DTO types from Zod schemas)
- Coverage ≥85% on the schemas (positives + negatives)

**Deps:** A.3.4.

### A.3.11 — Pilot exam smoke (parametric)

**Files:** Phase 3.
- `scripts/smoke-tests/pilot-exam-flow.ts` (NEW)

**Behavior:**
- Accepts `PILOT_ID` env var (e.g. `pabson-saraswati-bs-2083` or `dev-pabson-primary`)
- Loads fixture data: `TENANT_ID`, `SCHOOL_ID`, target academic year + term, target courses
- Runs full lifecycle (9-step sequence in §3 Phase 3 above)
- Tears down synthetic Exam at end (DELETE)
- Exit 0 on full green, 1 on any check fail, 2 on config error

**AC:**
- Smoke on `dev-pabson-primary` exits 0 (the target with A.2.5 backfill)
- Smoke on Saraswati prod: SKIPPED in V1 per CEO 2026-05-22 (no Course data yet); operator runs when ready
- Full lifecycle (create → schedule → add courses → score → close → publish + invalid-transition rejection) exits 0
- Audit + events captured at every step (verifiable post-run via CloudWatch or DDB Scan with filter)

**Deps:** A.3.1–A.3.10.

---

## 5. Risks & mitigations (sprint-level)

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-A3.1 | Shared-types caret-pin trap (R39): server/* package.json pins not bumped same PR; CodeBuild fails TS2305 | M | H | Bump `server/application/package.json` + `server/package.json` pins in Phase 1 PR SAME commit. Refresh `package-lock.json` at root. (Same pattern as A.2 Phase 1.) |
| R-A3.2 | New entity module `ExamsModule` not registered → ECS task crashes on Nest bootstrap (per memory `feedback_module_wiring_invariant` — twice took prod down) | M | H | Post-deploy ECS log inspection mandatory (`aws logs filter-log-events` looking for Nest bootstrap success). Pre-deploy: explicit grep across `academics.module.ts` imports verifying `ExamsModule` listed. Sprint 0.3 will land the proper `module-wiring.spec.ts` in academics. |
| R-A3.3 | Three-way route handoff drift: new `/academics/exams*` paths added to `tenant-api-prod.json` but mismatched with Nest controller — 403 SigV4 on smoke | M | M | Per memory `edforge_api_gateway_route_registration`: every new endpoint touches 3 places. nginx is auto-covered by existing `^/academics` prefix; only Nest controller + `tenant-api-prod.json` change. Smoke (A.3.11) catches mismatch at runtime. Pre-merge: visual diff inspection of `tenant-api-prod.json` paths vs Nest controller `@Get/@Post/@Patch` decorators. |
| R-A3.4 | Missing `academics/__tests__/module-wiring.spec.ts` — A.3 adds new module without the safety net | (accepted) | H if it breaks | Sprint 0.3 deferral (per master plan §0.4 status). For A.3: post-deploy ECS log sanity is the gate. If Nest crashes at bootstrap → rollback ECS task definition + diagnose → fix → re-roll. Same precedent as D.1. |
| R-A3.5 | `tenantId` column shape: legacy entities use `TENANT#{tid}` in comments but bare UUID stored (per memory `edforge_identity_ddb_bare_uuid_partition_key`); A.3 factories must use bare UUID | L | M | Mirror existing Course/Grade factory pattern (bare UUID assignment). Entity-file comment uses logical `TENANT#{tid}` notation for human readability; factory writes bare UUID. Spec asserts. |
| R-A3.6 | Bulk-score idempotency via correlationId — slow O(N) scan if no index, or extra GSI cost | L | L | V1: simple-scan-with-filter on per-chunk basis (≤100 items per chunk × ≤10 chunks per typical exam class = manageable). GSI4 by correlationId is V1.5 if needed at scale. Document trade-off in script docstring. |
| R-A3.7 | `passingMarks` default of 32 baked into A.3.3 — won't be right for non-PABSON GENERIC tenants | M | L | V1 default 32 documented in entity factory + tenant-api-prod.json schema as "PABSON CDC default; operator-overridable per ExamCourse on POST". GENERIC tenants override on creation. V1.5: read default from `SchoolConfiguration.gradingScale` at write time. Open decision §8.2. |
| R-A3.8 | ExamScore.enrollmentId integrity across cross-year promotion (D.2.10 rewrites Enrollment.gradeLevel; ExamScore.enrollmentId must NOT break) | L | H | Invariant 3 explicit guard in A.3.4 spec: `enrollmentId` is the key, NOT `(studentId, examId)`. D.2.10 should preserve enrollmentId across rewrites (its job, not A.3's). Cross-year smoke (D.2.12) will validate when D.2 ships. |
| R-A3.9 | Score write while exam in wrong state (e.g. `draft` or `published`) — operator gets stuck | L | M | A.3.7 returns distinct errorCodes (`EXAM_NOT_SCHEDULED` for draft / `EXAM_LOCKED` for closed/published). Operator-facing UI surfaces the state with clear next action. State-machine PATCH endpoint (A.3.8) is the recovery path. |
| R-A3.10 | Existing 6 failing academics test suites (per memory `project_grade_level_fix_sprint_closed`) untouched but might mask A.3 regressions in unrelated areas | L | L | Per A.2 Phase 2 precedent: my diff is additive (new files + targeted modifications). `git diff main` confirms before commit. Failing suites are queryGSI signature drift + grades mock setup — unrelated to exams. |

---

## 6. Invariant gate (per `v1-master-epic-breakdown.md` §1.4)

| Invariant | A.3 disposition |
|---|---|
| Audit + event paired (Sprint 0.2.7 lint) | YES — `publishExamCreated`, `publishExamUpdated`, `publishExamStatusTransitioned`, `publishExamScoreRecorded`, `publishExamScoresBulkRecorded` mirror existing courses-service pattern. Audit row written via existing `auditedWrite()` analogue. Sprint 0.3 will port to formal auditedWrite later. |
| Three-way route handoff | YES — Nest controllers + `tenant-api-prod.json` paths added; nginx NOT changed (existing `^/academics` prefix covers all sub-paths per CLAUDE.md §1.5). |
| Shared-types changed → minor bump + npm publish + AdminWeb jsdom sim | YES — Phase 1 follows CLAUDE.md per-sprint publish checklist end to end. AdminWeb likely doesn't consume new exam types in V1 (grep `client/AdminWeb/src/` for `Exam` pre-deploy); if no hits, controlplane redeploy is OPTIONAL. |
| New NestJS module → module-wiring.spec.ts SAME PR | DEFERRED — academics has no spec yet (Sprint 0.3 scope). A.3 relies on post-deploy ECS log sanity check (R-A3.4). |
| New GSI → gsi-inventory.md BEFORE CDK deploy | YES — `docs/pilot-greenlight/gsi-inventory.md` updated with: Exam GSI1 + GSI2; ExamCourse GSI1 + GSI2; ExamScore GSI1 + GSI2 + GSI3. Single-table DDB, no CDK change (GSIs declared on the existing academics table). |
| Invariant 13 (no pilot names in code) | A.3.11 smoke accepts `PILOT_ID` env; loads fixture data from `packages/pilot-fixtures/` via `pilotId`. Service code archetype-blind. |
| Invariant 12 (no `tenant.archetype` reads in academics src) | A.3 reads `examType` enum from validated payload (Zod pipe). `examPatternKey` enum membership is enforced at write but the per-archetype subset comes from `archetypeDefaults[archetype].examPattern` read at validation time (not in service handler). Grep stays clean. |
| `as any` cast smell | None expected; entity factories are well-typed. |

---

## 7. Deploy ladder (per CLAUDE.md + memory `feedback_pr_first_no_more_uat`)

```
Phase 1 PR (shared-types schemas + audit doc + caret-pin bumps)
  ├── (CI green: typecheck, lint, jest, AdminWeb build)
  ├── (Reviewer approval — Shoaib)
  ├── npm publish @aibrains/shared-types@0.57.0
  ├── npm view @aibrains/shared-types version  (verify; 30s propagation)
  ├── npm install (root, refresh lockfile)
  ├── Local AdminWeb rebuild + jsdom sim  ← BLOCKING if fails
  ├── Merge PR to main
  └── controlplane-stack redeploy (CONDITIONAL — only if AdminWeb consumes new types)

Phase 2 PR (academics entities + controllers + state machine + bulk)
  ├── (CI green; nest build academics; jest A.3 specs)
  ├── (Reviewer approval)
  ├── Merge PR to main
  ├── scripts/build-application.sh academics (tee'd to docs/deploys/prod-build-application-academics-...)
  ├── aws ecs update-service --force-new-deployment academicsbasic (ap-south-1)
  ├── Wait for services-stable
  ├── ECS log sanity: filter Nest bootstrap success (NestApplication startup messages); module DI graph (R-A3.2 + R-A3.4 mitigation)
  └── Skip-the-curl smoke until Phase 3 (Phase 3 is the smoke)

Phase 3 PR (parametric smoke + execution)
  ├── (CI green; script type-checks via tsc)
  ├── (Reviewer approval — script only; no merge gate on prod write)
  ├── Merge PR to main
  ├── Request fresh Cognito JWT → /tmp/dev-jwt.txt (Write tool, NOT heredoc)
  ├── Confirm dev-pabson-primary AY + Term fixtures exist (or create via existing API endpoints)
  ├── PILOT_ID=dev-pabson-primary npx ts-node scripts/smoke-tests/pilot-exam-flow.ts --dry-run (lists what it WILL do without writes)
  ├── (User reviews dry-run output)
  ├── PILOT_ID=dev-pabson-primary npx ts-node scripts/smoke-tests/pilot-exam-flow.ts (full run)
  ├── tee log to docs/deploys/dev-pabson-smoke-pilot-exam-flow-<ts>-<sha>.log
  └── Verify cleanup: synthetic Exam soft-deleted; no orphan ExamCourses/ExamScores
```

**No UAT** per memory `feedback_pr_first_no_more_uat`. Per-step user-in-the-loop authorization via `AskUserQuestion` for the ECS roll + smoke execution (mirrors A.2 Phase 2 + Phase 3 pattern).

---

## 8. Open decisions (need sign-off before branch cut)

1. **Phase grouping confirmation.** 3 PRs (Phase 1 = shared-types + audit, Phase 2 = academics service, Phase 3 = smoke) as proposed? *Recommendation: yes; matches A.2 cadence.*
2. **`passingMarks` default in ExamCourse.** V1 hardcoded `32` (PABSON CDC standard, operator-overridable per ExamCourse on POST), or read from `SchoolConfiguration.gradingScale` at write time (cleaner but needs SchoolConfiguration FK + 1 extra GetItem per ExamCourse write)? *Recommendation: V1 hardcoded `32` + operator-overridable; document as "best-guess default; widening to SchoolConfiguration FK is V1.5 enhancement."*
3. **bulk-score idempotency strategy.** V1 client-generated `correlationId` + per-chunk scan-with-filter for duplicate detection, OR add a NEW GSI4 by correlationId for O(1) idempotency check? *Recommendation: V1 scan-with-filter (chunks ≤100 each; cost negligible). GSI4 lands V1.5 if scale demands it.*
4. **Exam state machine — terminal `published`.** Is `published → in_progress` ever allowed in V1? *Recommendation: NO; published is terminal in V1. Un-publish requires inline-policy DDB op pattern (b) from memory `feedback_just_ask_for_a_prod_token` — operator-led, out of scope.*
5. **A.3.11 smoke target — dev-pabson-primary only (V1)?** Per CEO 2026-05-22: prod Saraswati has no Course data. Smoke against dev-pabson-primary only? *Confirmed; mirror A.2.5 target.*
6. **AdminWeb consumption check.** Does AdminWeb today reference any of the to-be-added `Exam*` types? If yes, Phase 1 must include AdminWeb pin bump + jsdom sim + controlplane redeploy. *Recommendation: pre-Phase 1, grep `client/AdminWeb/src/` for `Exam` references; if zero, skip controlplane redeploy.*
7. **Backfill consideration.** Existing Grade rows on `dev-pabson-primary` use the legacy `Grade.courseId` mark-entry path. Does A.3 deprecate this or coexist? *Recommendation: COEXIST — Grade entity stays for non-exam grading (classwork, daily marks). ExamScore is the structured exam-only path. No backfill needed; legacy data unaffected.*

---

## 9. Definition of Done (Sprint A.3)

- [ ] All 11 tickets meet §1.1 per-ticket DoD (Files + Validation + AC + Deps + Risk)
- [ ] All 3 PRs merged to main
- [ ] Phase 1 deploy log: `docs/deploys/prod-shared-types-publish-0.57.0-<ts>-<sha>.log` (informal — npm publish step) + controlplane redeploy log IF needed
- [ ] Phase 2 deploy logs: `docs/deploys/prod-build-application-academics-<ts>-<sha>.log` + `docs/deploys/prod-ecs-roll-academicsbasic-<ts>-<sha>.log`
- [ ] Phase 3 smoke log: `docs/deploys/dev-pabson-smoke-pilot-exam-flow-<ts>-<sha>.log` with exit 0
- [ ] Phase 2 post-deploy ECS log sanity: Nest bootstrap success message captured (R-A3.4 mitigation)
- [ ] Phase 3 cleanup verified: no orphan Exam/ExamCourse/ExamScore rows on dev-pabson-primary
- [ ] Closeout entry added to `docs/pilot-greenlight/sprint-closeouts.md`
- [ ] Status table in `v1-master-epic-breakdown.md` §0.4 updated: `A.3 🟢 shipped <date>` + PRs/logs
- [ ] Memory written: `project_sprint_a3_shipped_prod.md`
- [ ] Risk register §11.2 updated if new R-A3.* surface in implementation
- [ ] `docs/pilot-greenlight/gsi-inventory.md` updated with new GSIs
- [ ] No regressions in A.2 / D.1 / E.0 / E.1 / 0.4 smokes (regression bundle re-run pre-merge of Phase 2)

---

## 10. What this plan deliberately does NOT include

- A.4 Result Subsystem — term-aggregation engine, ResultCard entity, result-gen Lambda, conduct/remarks endpoints; that's the immediately-next sprint
- Frontend exam UI (AdminWeb / saas-frontend academics MFE) — separate post-A.3 follow-up
- Academics `module-wiring.spec.ts` — Sprint 0.3 scope
- Full `auditedWrite()` migration — Sprint 0.3 scope
- PascalCase → snake-dotted event migration (`exam.created` vs `ExamCreated`) — Sprint B.2.2, V1.5
- GSI4 on ExamScore.correlationId — V1.5 if scale demands
- `Exam.totalMaxMarks` auto-recompute on ExamCourse mutation — V1 manual recompute on operator action; V1.5 trigger-driven
- Cross-school exam aggregation (multi-school chain reporting) — pilot 2 + multi-school scope

---

## Sign-off requested

Open decisions in §8 above are the gates. Once signed off:
1. Cut feature branch: `sprint/a3-phase-1-shared-types` (Phase 1) on the server repo. Per memory `feedback_explicit_cd_per_git`: every git op starts with explicit `cd <repo-root>` in the same invocation.
2. Begin Phase 1 implementation.
