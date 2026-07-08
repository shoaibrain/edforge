# Sprint A.4 — Result Subsystem Backend: Sprint Plan

> **Drafted:** 2026-05-22
> **Status:** 🟡 Draft — awaiting sign-off before branch cut
> **Master-plan section:** `v1-master-epic-breakdown.md` §3 Sprint A.4 (lines 655–703)
> **Companion precedents:** [`a3-sprint-plan.md`](./a3-sprint-plan.md), [`a2-sprint-plan.md`](./a2-sprint-plan.md), [`c4-fe-sprint-plan.md`](./c4-fe-sprint-plan.md)

---

## 1. Why this sprint, why now

### Critical-path argument

A.4 is the immediate next link unlocked by A.3 (Exam) + D.1 (GradingPolicy). It primes the largest fan-out chain remaining in V1:

```
A.4 (Result) ─┬─→ C.4.3 Report Card render (needs ResultCard entity + courseScores[])
              ├─→ D.2.5 PromotionRule batch eval (reads ResultCard for academic-pass signal)
              ├─→ D.4.6 BLE result import (denormalizes ResultCard.courseScores[])
              ├─→ D.5.4 SEE result import (same pattern)
              └─→ C.9.5 Cross-year handoff (terminal `result.published` flips provisional → enrolled)
```

5+ downstream sprints depend on A.4. Beyond critical path: A.4 closes the **"Operate → Distribute"** product loop for V1 — without ResultCards, the operator has no document to issue to parents at term-end.

### Foundation in place (post-A.3 + D.1)

- ✅ `Exam` + `ExamCourse` + `ExamScore` entities (A.3 shipped 2026-05-22)
- ✅ `Exam.status` state machine including terminal `published` (A.3.8); `exam.closed` event published on transition (`packages/shared-types/src/events/exam.ts:35`)
- ✅ `ExamScore.enrollmentId` is the entity key per invariant 3 (A.3.4) — cross-year stability guaranteed
- ✅ `ExamScore` GSI2 student-centric + GSI3 per-enrollment (A.3.4)
- ✅ `GradingPolicy` + Nepal CEHRD scale incl. `NG`, with `gpaScale`, `isPassing`, `isTerminalFail` (D.1 shipped) — term-aggregation reads this
- ✅ `resultPublishedSchema` already exists in shared-types (`packages/shared-types/src/events/result.ts`) — A.4.5 emits, doesn't define
- ✅ `Course.academicSubject` descriptor (A.2.1) — A.4.2 `courseScores[].academicSubject` denormalizes for renderer aggregation
- ✅ Analytics Lambda pattern (`server/lib/analytics/lambda/aggregator/`, `rollup/`) — A.4.3 result-batch Lambda mirrors structure
- ✅ EventBridge bus + DLQ stack (`server/lib/shared-infra/event-dlq-stack.ts`) — A.4.3 Lambda subscribes via tenant-template-stack-basic rule

### Per §0 philosophy (CEO 2026-05-22)

Product completeness over pilot-fixture work. A.4 closes the term-end deliverable loop. The smoke target stays `dev-pabson-primary` (Saraswati has no course/exam data yet; operator-led when ready).

---

## 1.5 Architecture principle — Core Ed-Fi V6 + Edges by archetype (carry-over from A.2 / A.3)

**Same load-bearing discipline as A.2 + A.3.** Every implementation decision below MUST be evaluated against it.

### Statement (unchanged)

EdForge's data model is **Ed-Fi V6 at the Core** (canonical, archetype-blind entities, descriptors, validators, engines) with **archetype-specific Edges at the boundary** (seeds, catalogs, defaults — never inside service code).

### Layer mapping for A.4

| Layer | Lives in | Archetype-aware? | A.4 contributions |
|---|---|---|---|
| **Core — Ed-Fi V6 canonical** | `packages/shared-types/src/schemas/academics/result-card.schema.ts`, `server/application/microservices/academics/src/results/`, `server/application/microservices/academics/src/common/entities/result-card.entity.ts` | NO — must pass invariant-12 grep clean | A.4.1 term-aggregation engine (pure function); A.4.2 `ResultCard` entity (Ed-Fi `StudentAcademicRecord` analogue); A.4.3 batch Lambda; A.4.4 conduct/remark endpoints; A.4.5 publication state machine |
| **Edge — Archetype boundary** | `packages/shared-types/src/archetype/archetype-defaults.ts` (existing); `GradingPolicy` rows seeded per-tenant via D.1.3 lazy-seed | YES — already shipped | A.4.1 reads `archetypeDefaults[archetype].gradingPolicy` via D.1's lazy-seed; never branches on `tenant.archetype` directly |
| **Service runtime** | `server/application/microservices/academics/src/results/` | NO — treats every ResultCard identically | A.4.4 + A.4.5 controllers + services |

### Specific invariants A.4 enforces

1. **`ResultCard.enrollmentId` is the entity key.** Per invariant 3 + A.3.4 lineage. Preserves cross-AY identity through promotion (D.2.10) rewrites.
2. **`ResultCard.courseScores[]` carries denormalized `academicSubject` descriptor** (A.2 descriptor). Render path (C.4.3) and downstream BLE/SEE import paths can aggregate by subject without re-reading Course rows.
3. **Term-aggregation engine is a pure function.** Input: `ExamScore[]`, `ExamCourse[]`, `GradingPolicy`. Output: `{ totalScore, termGpa, courseScores: [{ courseId, academicSubject, score, grade, gpa }] }`. Zero DDB reads inside the function — all reads happen in the caller (service or Lambda) that hands data in.
4. **No `tenant.archetype` reads in `results/` src.** Per invariant 12 (clarified during A.3): explicit data-driven lookups via TenantMetadataReader + `getArchetypeDefaults()` ARE allowed; implicit `if (archetype === 'PABSON')` branching is rejected.
5. **R42 mitigation (carryover from A.3): bulk-written ExamScore rows may carry `studentId='unknown'`.** A.4.1 resolves `studentId` from `Enrollment` (looked up by `enrollmentId`) and writes the correct value onto `ResultCard.studentId` — the aggregation IS the resolution. Optional opportunistic write-behind on ExamScore.studentId is documented in §8 as an open decision.
6. **`exam.closed` is the only trigger for batch generation.** Operator clicks "Close Exam" → state machine fires `exam.closed` → EventBridge rule routes to result-batch Lambda → Lambda generates ResultCard rows. No manual "generate results" endpoint in V1.

### Anti-pattern guardrails (rejected at PR review)

- `if (tenant.archetype === 'PABSON') gpa = nepalScale(score)` → reject (read from `gradingPolicy` row)
- Hardcoded grade boundaries (`if (score >= 90) grade = 'A+'`) → reject (read from `GradingPolicy.scale[]`)
- Service code that calls `examScoresService.list()` inside term-aggregation → reject (pure function MUST receive scores via parameter)
- Result-batch Lambda that processes >1 exam per invocation → reject (one Lambda invocation = one exam = one term's worth of cards; bulk pagination internal to the invocation)

---

## 2. Scope

### In-scope

| Ticket | Summary | Sized |
|---|---|---|
| A.4.1 | Term-aggregation rules engine (pure function, archetype-blind); reads `gradingScale` from D.1 GradingPolicy | M |
| A.4.2 | `ResultCard` entity (academics) — keyed by `enrollmentId`; `courseScores[]` denormalizes `academicSubject` | M |
| A.4.3 | Batch result generation Lambda + EventBridge `exam.closed` rule + DLQ + alarm | L |
| A.4.4 | Conduct + class-teacher-remark endpoints — `PATCH /academics/result-cards/{cardId}/conduct`, `PATCH /academics/result-cards/{cardId}/remark` | S |
| A.4.5 | Publication state machine — `PATCH /academics/result-cards/{cardId}/publish`; emits `result.published`; cannot un-publish; cannot double-publish | S |
| A.4.6 | Cross-year publication regression spec (invariant 3 guard) | XS |
| A.4.7 | Parametric pilot result smoke — `scripts/smoke-tests/pilot-result-card-publish.ts` | S |
| (implicit) | `result-card.schema.ts` Zod schemas in shared-types | S |
| (implicit) | `result-card.mapper.ts` entity↔DTO round-trip | S |
| (implicit) | gsi-inventory.md updates for ResultCard GSIs | XS |

### Out-of-scope (deferred, with reason)

| Item | Why |
|---|---|
| Frontend ResultCard UI (operator close-exam → view-cards → publish flow) | Post-A.4 follow-up; saas-frontend academics MFE wiring is separate work; A.4 ships API + Lambda only |
| Report Card PDF render (C.4.3) | Sprint C.4 scope; depends on A.4.2 entity (this sprint) + C.2 document service |
| ClassRank + SectionRank calculation | A.4 ships fields on entity but leaves them null in V1 (operator can sort by `totalScore` in UI; rank-as-data is V1.5 because tie-breaking rules are archetype-specific edge data not yet seeded) |
| Re-aggregation on score correction (PATCH ExamScore after Exam.status=closed) | V1: ExamScore is locked once Exam transitions to closed (A.3.8 + A.3.7 EXAM_LOCKED guard). Score correction requires Exam → in_progress transition (state machine allows this) → re-PATCH score → re-close exam → result-batch Lambda re-runs. V1.5: in-place re-aggregate endpoint |
| Un-publish ResultCard | `published` is terminal in V1 (same as Exam). Un-publish = inline-policy DDB op pattern (b) from memory `feedback_just_ask_for_a_prod_token` |
| Academics `module-wiring.spec.ts` | Sprint 0.3 scope (per daily-use audit gap #8). A.4 introduces `ResultsModule`; relies on post-deploy ECS log sanity (same as A.3) |
| Full `auditedWrite()` migration | Sprint 0.3 scope. A.4 uses existing audit/event pattern |
| ExamScore.studentId opportunistic backfill on aggregation | V1: deferred to §8 open decision; A.4.1 reads correct studentId from Enrollment and stamps on ResultCard, but does NOT write-behind to ExamScore. Backfill is a one-shot script if/when needed |

### Already-shipped foundation (post-A.3 + D.1)

- `Exam.status` state machine + `exam.closed` event (A.3.8) — A.4.3 Lambda subscribes
- `ExamScore.enrollmentId` keying (A.3.4) — A.4.1 joins by this key
- `GradingPolicy.scale[]` with `gpaScale` + `isPassing` + `isTerminalFail` (D.1.3 lazy-seed) — A.4.1 maps raw-score → grade + gpa
- `Course.academicSubject` (A.2.1) — A.4.2 denormalizes
- `resultPublishedSchema` (`packages/shared-types/src/events/result.ts`) — A.4.5 emits; `isTerminal` field already declared for C.9.5 cross-year handoff
- Existing nginx `^/academics` location block — all A.4 routes ride this; **no new nginx prefix needed** (override of master plan A.4.4 "new `/result-cards` prefix" — see §8 open decision)

---

## 3. PR cadence — 4 phases

**More phases than A.3 (3) because Lambda + EventBridge + entity + smoke are distinct deploy targets.** Phase boundaries chosen so each PR is independently revertable and the deploy ladder reads naturally.

### Phase 0 — R41 template-size gate (DECISION ONLY — no code)

**Trigger:** A.3 closeout flagged shared-infra-stack CFN at 86% (863276/1000000). A.4 adds ~5 new API GW paths × ~9KB each = ~45KB more → projected ~91% post-A.4. **§17.8 forward rule fires at >90% threshold.**

**Decision needed (see §8 #1):**
- **(a) Proceed with A.4 as-is** — accept ~91%; queue dedicated `shared-api-routes-stack` split as the next sprint after A.4 (before D.2/D.3 land). *Recommended.*
- **(b) Pause A.4; do the split sprint first** — defensive but delays critical-path A.4 by ~1 week.
- **(c) Fold split into A.4 Phase 1** — adds ~50% to sprint size; bundles unrelated architectural work into a result-subsystem PR. *Not recommended.*

**This phase is a sign-off step, not code.** Phase 1 doesn't start until decision is taken.

### Phase 1 — shared-types schemas + readiness audit (1 PR)

**Tickets:** A.4.2 schema half + A.4.6 (regression spec lives in academics src so technically Phase 2, but the contract test pattern follows A.3 Phase 1 placement)

**Files:**
- NEW `packages/shared-types/src/schemas/academics/result-card.schema.ts` — `resultCardCourseScoreSchema`, `createResultCardSchema`, `updateResultCardSchema` (conduct/remark), `resultCardResponseSchema`, `resultCardFilterSchema`, `resultCardStatusSchema` (enum: `draft | published`), `resultCardPublishSchema`
- NEW spec: `result-card.schema.spec.ts` — ≥40 assertions (positives + negatives for enum/range/FK-shape + nested `courseScores[]`)
- NEW `docs/pilot-greenlight/a4-foundation-readiness-audit.md` — confirms A.3 + D.1 + A.2 shipped; cites the 3 entity GSIs A.4.1 reads from; flags R41 status + R42 mitigation strategy
- MODIFIED `packages/shared-types/src/schemas/academics/index.ts` — barrel
- MODIFIED `packages/shared-types/src/index.ts` — re-export
- MODIFIED `packages/shared-types/package.json` — 0.57.0 → 0.58.0
- MODIFIED `server/application/package.json` + `server/package.json` — `^0.57.0` → `^0.58.0` (R39 mitigation, SAME PR)

**Deploy:** publish `@aibrains/shared-types@0.58.0` → npm verify → root lockfile refresh → AdminWeb jsdom sim (per CLAUDE.md per-sprint publish checklist) → merge PR → controlplane redeploy IF AdminWeb consumes ResultCard types (grep `client/AdminWeb/src/` for `ResultCard`; if zero hits, skip).

### Phase 2 — academics service entities + controllers + state machine + cross-year spec (1 PR)

**Tickets:** A.4.1 + A.4.2 + A.4.4 + A.4.5 + A.4.6

**Files:**
- NEW `server/application/microservices/academics/src/common/entities/result-card.entity.ts` + `.spec.ts`
- NEW `server/application/microservices/academics/src/common/mappers/result-card.mapper.ts`
- NEW `server/application/microservices/academics/src/results/term-aggregation.service.ts` + `.spec.ts` — pure function `aggregateTermResults(input): AggregateResult`
- NEW `server/application/microservices/academics/src/results/result-cards.service.ts` + `.spec.ts` — CRUD + publish state machine + conduct/remark
- NEW `server/application/microservices/academics/src/results/result-cards.controller.ts` — A.4.4 + A.4.5 endpoints
- NEW `server/application/microservices/academics/src/results/results.module.ts` — declares full provider list
- NEW `server/application/microservices/academics/src/results/cross-year-publication.spec.ts` — A.4.6 invariant-3 guard
- MODIFIED `server/application/microservices/academics/src/academics.module.ts` — import `ResultsModule`
- MODIFIED `server/application/microservices/academics/src/common/entities/index.ts` — export
- MODIFIED `server/application/microservices/academics/src/common/services/academics-events.service.ts` — add `publishResultCardCreated`, `publishResultCardUpdated`, `publishResultPublished` (the last maps directly onto `resultPublishedSchema`)
- MODIFIED `server/lib/tenant-api-prod.json` — add ~5 new path entries:
  - `/academics/result-cards/{cardId}` (GET)
  - `/academics/result-cards/{cardId}/conduct` (PATCH)
  - `/academics/result-cards/{cardId}/remark` (PATCH)
  - `/academics/result-cards/{cardId}/publish` (PATCH)
  - `/academics/result-cards` (GET — LIST with filters `termId` / `examId` / `enrollmentId`)

**No nginx.template change** — all routes under existing `^/academics` location block.

**Deploy:**
- academics ECR build + push + ECS rolling update `academicsbasic` on `ap-south-1` (tee'd to logs)
- `cdk deploy shared-infra-stack` for the 5 new API GW paths (per A.3 L1 lesson; **mandatory** for any `tenant-api-prod.json` change)
- Wait services-stable + post-deploy ECS log sanity (Nest bootstrap + `ResultsModule dependencies initialized`)
- Skip smoke until Phase 4

### Phase 3 — result-batch Lambda + EventBridge wiring (1 PR)

**Tickets:** A.4.3

**Files:**
- NEW `server/lib/result-generation/lambda/result-batch/handler.ts` — Lambda entry point; consumes `exam.closed` event detail; lists `ExamScore` rows for examId; calls term-aggregation; writes `ResultCard` rows via TransactWriteItems chunked at 100 (mirrors A.3.9 pattern)
- NEW `server/lib/result-generation/lambda/result-batch/handler.spec.ts` — Lambda unit tests
- NEW `server/lib/result-generation/lambda/shared/types.ts` — Lambda-internal types
- MODIFIED `server/lib/tenant-template/tenant-template-stack-basic.ts` — declare Lambda + EventBridge rule on `exam.closed` + DLQ (re-uses existing EventBridge DLQ stack) + CloudWatch alarm on Lambda errors >0 in 5min + alarm on DLQ depth ≥1
- MODIFIED `server/lib/tenant-template/iam.ts` (or equivalent) — Lambda execution role with DDB read/write on academics table

**Deploy:**
- `cdk diff tenant-template-stack-basic` (tee'd) → review
- `cdk deploy tenant-template-stack-basic` (per profile; A.4 ships prod only per memory `feedback_pr_first_no_more_uat`)
- Verify Lambda + EventBridge rule + DLQ created via `aws lambda get-function` + `aws events list-rules` + `aws sqs get-queue-attributes`
- Manual EventBridge `put-events` test with synthetic `exam.closed` payload → verify Lambda invocation in CloudWatch Logs
- Wait alarm provisioning to settle

### Phase 4 — parametric pilot smoke + execution (1 PR + operator-led run)

**Tickets:** A.4.7

**Files:**
- NEW `scripts/smoke-tests/pilot-result-card-publish.ts` — parametric (`PILOT_ID` env-driven), covers:
  1. Confirm Exam exists from A.3.11 smoke target on `dev-pabson-primary` school `4209e3d8-…` (or create a fresh synthetic Exam + 3 ExamCourses + 10 ExamScores)
  2. Transition Exam to `closed` via PATCH state-machine endpoint → 200 + `exam.closed` event
  3. Poll for ResultCard rows: GET `/academics/result-cards?examId={examId}` until count ≥ 10 (or 30s timeout) — verifies Lambda fired
  4. Verify ResultCard.totalScore matches sum of ExamScore.rawScore for enrollment
  5. Verify ResultCard.termGpa within expected range [0.0, 4.0] (or D.1 PABSON scale max)
  6. PATCH conduct on first 3 cards → 200 + audit
  7. PATCH remark on first 3 cards → 200 + audit
  8. PATCH publish on first card → 200 + `result.published` event (with `isTerminal: false` since not last term)
  9. Attempt re-publish same card → 409 `RESULT_ALREADY_PUBLISHED`
  10. Attempt PATCH conduct on published card → 409 `RESULT_LOCKED`
  11. Cross-AY query: GET ResultCards by enrollmentId via GSI → confirm card surfaces (R42 sanity)
  12. Cleanup: soft-delete synthetic Exam + cascade ExamCourse/ExamScore/ResultCard rows (or leave for inspection — operator's call)

**Deploy:** no infra change. Script execution against `dev-pabson-primary`. Fresh Cognito JWT to `/tmp/dev-jwt.txt` per memory `feedback_just_ask_for_a_prod_token`. Operator-led per `feedback_commit_and_deploy_approval`.

---

## 4. Per-ticket detail (with §1.1 atomic conventions)

### A.4.1 — Term-aggregation rules engine

**Files:** Phase 2.
- `microservices/academics/src/results/term-aggregation.service.ts` (NEW)
- `microservices/academics/src/results/term-aggregation.service.spec.ts` (NEW)

**Function signature:**
```typescript
export interface TermAggregationInput {
  exam: Exam;
  examCourses: ExamCourse[];
  examScores: ExamScore[];                  // ALL scores for this exam
  enrollments: Map<string, Enrollment>;     // enrollmentId → Enrollment (for studentId resolution per R42)
  gradingPolicy: GradingPolicy;             // active policy from D.1
}

export interface TermAggregationOutput {
  perEnrollment: Map<string, {
    enrollmentId: string;
    studentId: string;                       // resolved from Enrollment (R42 mitigation)
    courseScores: Array<{
      courseId: string;
      examCourseId: string;
      academicSubject: AcademicSubjectDescriptor;  // denormalized
      rawScore: number;
      maxMarks: number;
      grade: string;                         // from GradingPolicy.scale[]
      gpa: number;                           // from GradingPolicy.scale[].gpaScale
      isPassing: boolean;                    // from GradingPolicy
      isTerminalFail: boolean;
    }>;
    totalScore: number;
    totalMaxMarks: number;
    termGpa: number;                         // weighted by ExamCourse.creditHours (default 1.0)
    overallGrade: string;                    // derived from termGpa via GradingPolicy
  }>;
}

export function aggregateTermResults(input: TermAggregationInput): TermAggregationOutput;
```

**Validation:**
- Unit tests with PABSON 32-pass `GradingPolicy` (incl. `NG` for absent) + synthetic exam fixtures
- Property test: monotonic raw-score → monotonic GPA (within same scale)
- Property test: missing ExamScore (no row) → `NG` grade (per D.1 "Not Graded" semantics)
- Edge case: `rawScore = 0` → fails (or `NG` per policy)
- Edge case: `rawScore = maxMarks` → max grade
- Edge case: enrollment with no scores at all → 0 courseScores; termGpa = 0; isTerminalFail = false (no scores ≠ terminal fail)
- **Explicit archetype-grep assertion: `grep -rn 'archetype' microservices/academics/src/results/` returns zero hits**
- Pure-function assertion: spec asserts NO DDB SDK imports inside `term-aggregation.service.ts`
- Zero `tenant.archetype` reads

**AC:**
- Pure function; zero side-effects; zero DDB reads inside
- Archetype-grep clean
- Tested against D.1 PABSON CEHRD scale (incl. `NG` + 32-pass) + synthetic GENERIC scale
- Returns `studentId` resolved from Enrollment for every aggregation row (R42 mitigation)

**Deps:** D.1.3 ✅ (GradingPolicy + scale) + A.3.2/A.3.3/A.3.4 ✅ (Exam family).

### A.4.2 — `ResultCard` entity

**Files:** Phase 2.
- `microservices/academics/src/common/entities/result-card.entity.ts` (NEW)
- `microservices/academics/src/common/entities/result-card.entity.spec.ts` (NEW)
- `microservices/academics/src/common/mappers/result-card.mapper.ts` (NEW)

**Entity shape:**
```typescript
export interface ResultCard extends BaseEntity {
  entityType: 'RESULT_CARD';
  cardId: string;
  enrollmentId: string;                     // KEYED here per invariant 3
  examId: string;
  termId: string;
  academicYearId: string;
  schoolId: string;
  studentId: string;                        // resolved from Enrollment at aggregation (R42 mitigation)
  courseScores: Array<{
    courseId: string;
    examCourseId: string;
    academicSubject: AcademicSubjectDescriptor;   // denormalized
    rawScore: number;
    maxMarks: number;
    grade: string;
    gpa: number;
    isPassing: boolean;
    isTerminalFail: boolean;
  }>;
  totalScore: number;
  totalMaxMarks: number;
  termGpa: number;
  overallGrade: string;
  classRank?: number | null;                // V1: null; V1.5 computes
  sectionRank?: number | null;              // V1: null; V1.5 computes
  conduct?: string | null;                  // V1: free-text operator field (PATCH endpoint)
  classTeacherRemark?: string | null;       // V1: free-text
  status: ResultCardStatus;                 // 'draft' | 'published'
  publishedAt?: string | null;
  publishedBy?: string | null;
  isTerminalExam: boolean;                  // copied from Exam at aggregation time; flips C.9.5 cross-year handoff
  // GSI Keys (lowercase per S3.2)
  gsi1pk: string;                           // 'tenant#{tid}#school#{schoolId}'
  gsi1sk: string;                           // 'result-card#{academicYearId}#{termId}#{examId}#{enrollmentId}'
  gsi2pk: string;                           // 'enrollment#{enrollmentId}'  for cross-AY transcript
  gsi2sk: string;                           // 'result-card#{academicYearId}#{termId}#{examId}'
  gsi3pk: string;                           // 'exam#{examId}'  for "list all cards for this exam"
  gsi3sk: string;                           // 'result-card#{enrollmentId}'
}
```

**Validation:**
- Entity factory unit test
- Contract test (entity ↔ schema round-trip)
- GSI casing assertion inline (lowercase per S3.2)
- Cross-AY query test: 2 cards under same enrollmentId in different academicYears → both via GSI2

**AC:**
- Keyed by `enrollmentId` (NOT `(studentId, examId)`) — invariant 3 guard
- `courseScores[]` denormalizes `academicSubject` per invariant 2
- `studentId` resolved at aggregation time (R42)
- `isTerminalExam` populated from Exam — drives `result.published` event `isTerminal` field per C.9.5
- `tenantId` carries bare UUID per memory `edforge_identity_ddb_bare_uuid_partition_key`
- `classRank` + `sectionRank` are nullable in V1 (V1.5 fills)

**Deps:** A.3.4 ✅ + A.4.1.

### A.4.3 — Batch result generation Lambda

**Files:** Phase 3.
- `server/lib/result-generation/lambda/result-batch/handler.ts` (NEW)
- `server/lib/result-generation/lambda/result-batch/handler.spec.ts` (NEW)
- `server/lib/result-generation/lambda/shared/types.ts` (NEW)
- `tenant-template-stack-basic.ts` modified — Lambda + EventBridge rule + alarms

**Handler flow:**
```
1. Parse exam.closed event detail (examId, schoolId, tenantId, academicYearId, termId, isTerminal)
2. List all ExamCourse rows for examId (DDB Query GSI2 by exam#{examId})
3. List all ExamScore rows for examId (DDB Query GSI by exam#{examId}, paginated)
4. List all unique enrollmentIds from scores (or fetch from school enrollment list per termId)
5. BatchGetItem on Enrollment by enrollmentId (resolves studentId per R42)
6. Read GradingPolicy for tenant (via D.1.3 lazy-seed read)
7. Call term-aggregation.service.aggregateTermResults(input)
8. Build ResultCard rows from output, status='draft'
9. TransactWriteItems chunked at 100 (mirrors A.3.9 pattern):
     For each chunk: transactWrite([Put(ResultCard × 100)]) with attribute_not_exists
10. Emit one academics_event per chunk { eventType: 'result.batch_generated', examId, chunkSize, count }
11. On failure: send to DLQ; CloudWatch alarm fires
```

**EventBridge wiring:**
- Rule pattern: `{ "source": ["edforge.academics"], "detail-type": ["exam.closed"] }`
- Target: result-batch Lambda
- Retry: 2 attempts, 60s window
- DLQ: existing EventBridge DLQ from `event-dlq-stack`
- CloudWatch alarm: Lambda errors >0 in 5min → SNS to operator topic

**Validation:**
- Lambda unit: synthetic event detail → mocked DDB SDK → assert ResultCard chunks written
- Lambda integration via local invocation (or deployed dev env)
- Cold-start budget: ≤45s per master plan A.4.3 AC
- 200-enrollment exam → 200 cards in <30s p50 / <90s p95 — measured in deploy validation
- DLQ catches synthetic Lambda failure (e.g., TransactWriteItems all-fail) → alarm fires

**AC:**
- 200 enrollments → 200 cards in <30s p50 / <90s p95
- DLQ catches Lambda failures
- CloudWatch alarm on DLQ depth ≥1
- Cold-start ≤45s
- ResultCard rows idempotent (`attribute_not_exists` guard) — re-run on same exam is a no-op
- Lambda IAM scoped to academics table read+write (no Identity table access)

**Deps:** A.4.1 + A.4.2.

### A.4.4 — Conduct + class-teacher-remark endpoints

**Files:** Phase 2.
- `result-cards.controller.ts` (NEW)
- `result-cards.service.ts` (NEW)
- `tenant-api-prod.json` paths added

**Endpoints:**
- `PATCH /academics/result-cards/{cardId}/conduct` — body: `{ conduct: string }`
- `PATCH /academics/result-cards/{cardId}/remark` — body: `{ classTeacherRemark: string }`

**Validation:**
- jest integration: PATCH conduct → 200 + audit row + `result-card.updated` event
- 409 `RESULT_LOCKED` if card.status === 'published'
- Authorization: caller has class-teacher role on the section (V1: deferred to RBAC sprint; A.4 uses existing JWT auth; granular RBAC is C.X scope)
- Free-text length cap (e.g., 2000 chars) enforced at Zod schema level

**AC:**
- 200 on success + audit + event
- 409 `RESULT_LOCKED` after publish
- Three-way handoff: Nest controller + tenant-api-prod.json (nginx covered by existing `^/academics`)

**Deps:** A.4.2.

### A.4.5 — Publication state machine

**Files:** Phase 2.
- `result-cards.service.ts` `publish()` method
- `result-cards.controller.ts` `PATCH /academics/result-cards/{cardId}/publish` endpoint

**Endpoint:**
- `PATCH /academics/result-cards/{cardId}/publish` — body: `{}` (no body; idempotency via cardId)

**State machine:**
```
draft ─→ published   (single irreversible transition; published is terminal in V1)

Idempotent re-call:
   PATCH publish on already-published card → 409 RESULT_ALREADY_PUBLISHED (not 200)
   (Difference from Exam state machine where same-state is 200 no-op:
    publish is operationally significant — operator must KNOW it's already done)
```

**On publish:**
- Set `card.status = 'published'`, `card.publishedAt = now`, `card.publishedBy = ctx.userId`
- Emit `result.published` event with `{ cardId, enrollmentId, schoolId, termId, examId, isTerminal: card.isTerminalExam, publishedAt }` — payload matches existing `resultPublishedSchema`
- Audit row per publish

**Validation:**
- Integration: PATCH publish → 200 + audit + event with correct `isTerminal` (true for terminal exam, false otherwise)
- 409 `RESULT_ALREADY_PUBLISHED` on second call
- Verify event payload conforms to `resultPublishedSchema` (Zod parse in spec)
- Cross-link: C.9.5 cross-year handoff (when shipped) reads `isTerminal: true` to flip provisional enrollments

**AC:**
- Single transition; `published` is terminal
- `isTerminal` correctly populated from Exam (terminal-exam flag) at aggregation time
- `result.published` event payload validates against shared-types schema
- Audit + event paired per invariant

**Deps:** A.4.2.

### A.4.6 — Cross-year publication regression spec (invariant 3 guard)

**Files:** Phase 2.
- `microservices/academics/src/results/cross-year-publication.spec.ts` (NEW)

**Scenario:**
- Seed: 1 enrollment under AY1 termId-1 examId-1; 1 enrollment under AY2 (same studentId, different enrollmentId) termId-2 examId-2
- Generate ResultCards for both (mock Lambda or call aggregation directly)
- Publish AY1 card after AY2 card already created
- Assertions:
  - AY1 card has `enrollmentId` = AY1 enrollment's id (NOT AY2's)
  - GSI2 query by AY1 enrollmentId returns AY1 card only
  - GSI2 query by AY2 enrollmentId returns AY2 card only
  - GSI3 query by `exam#{AY1 examId}` returns AY1 card only
  - Cross-AY transcript (GSI2 scan with studentId filter) returns BOTH cards

**Validation:**
- jest integration with synthetic DDB (or actual academics table in dev)
- ≥10 assertions covering enrollment-id distinctness + GSI partitioning

**AC:**
- All assertions green
- No enrollmentId reuse across AYs (regression guard)
- Demonstrates invariant 3 is preserved through promotion + publication

**Deps:** A.4.2 + A.4.5.

### A.4.7 — Pilot result smoke (parametric)

**Files:** Phase 4.
- `scripts/smoke-tests/pilot-result-card-publish.ts` (NEW)

**Behavior:** see §3 Phase 4 above (12 checkpoints).

**AC:**
- Smoke on `dev-pabson-primary` exits 0
- Smoke on Saraswati prod: SKIPPED (no course/exam data yet)
- Full lifecycle: exam-close → Lambda fires → cards generated → conduct/remark PATCH → publish → result.published event verified
- R42 sanity: ResultCard rows have non-`unknown` studentIds (proves A.4.1 resolution worked)
- Cleanup verified or documented

**Deps:** A.4.1–A.4.6 + A.4.3.

---

## 5. Risks & mitigations (sprint-level)

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-A4.1 | R41 carry-through — shared-infra-stack CFN at ~91% after A.4 deploy; D.2/D.3/C-series adds will push over 100% | H | H | Phase 0 decision gate. Recommended path: ship A.4, then queue dedicated `shared-api-routes-stack` split sprint (~2-3 days) before D.2/D.3 land. Track as architecture TODO in §11.2 R41 |
| R-A4.2 | Shared-types caret-pin trap (R39): server/* package.json pins not bumped same PR; Docker builds fail TS2305 | M | H | Bump `server/application/package.json` + `server/package.json` pins in Phase 1 PR SAME commit. Refresh root `package-lock.json` (same pattern as A.2 + A.3 Phase 1) |
| R-A4.3 | New `ResultsModule` not registered → Nest bootstrap crash post-deploy | M | H | Post-deploy ECS log inspection mandatory (look for `ResultsModule dependencies initialized`); pre-deploy grep `academics.module.ts` imports for `ResultsModule`. Sprint 0.3 will land formal `module-wiring.spec.ts` for academics |
| R-A4.4 | Lambda cold-start exceeds 45s budget under cold-cache | L | M | A.4.3 AC documents budget; CDK declares `memorySize: 1024 MB` (matches existing rollup Lambda); X-Ray + CloudWatch Logs verify cold-start time during deploy validation; if >45s, increase memory or pre-warm with EventBridge schedule |
| R-A4.5 | EventBridge rule misfires (e.g., wrong source/detail-type pattern) → Lambda never invoked when exam closes | M | H | Manual `put-events` test with synthetic `exam.closed` payload post-deploy validates rule → Lambda → DDB write chain end-to-end; Phase 3 explicit checkpoint |
| R-A4.6 | DLQ silent — Lambda fails but no operator alert | M | H | CloudWatch alarm on DLQ depth ≥1 mandatory in Phase 3 PR; alarm fires SNS to operator topic; same pattern as existing analytics Lambda alerts |
| R-A4.7 | R42 — ExamScore.studentId='unknown' for bulk-written scores propagates to ResultCard.studentId via aggregation | L (mitigated) | H | A.4.1 explicitly resolves `studentId` from Enrollment by `enrollmentId` BEFORE writing ResultCard; ExamScore.studentId is NOT read at aggregation time (only enrollmentId is). Spec asserts. Opportunistic ExamScore.studentId write-behind is §8 open decision |
| R-A4.8 | Term-aggregation produces inconsistent grades for boundary cases (e.g., score = passingMarks - 1 vs passingMarks) | M | M | A.4.1 unit-table covers boundary: `isPassing: false` at `score = passingMarks - 1`; `isPassing: true` at `score = passingMarks`. GradingPolicy.scale[] is the source of truth; spec asserts |
| R-A4.9 | ClassRank/SectionRank fields persist as null in V1 → frontend may render "rank: --" which looks broken to operator | L | L | Entity factory + schema document nullable in V1; frontend renders fallback ("Ranking available next term") per pilot-onboarding briefing. V1.5 sprint computes |
| R-A4.10 | Bulk-generated ResultCards overflow DDB TransactWriteItems 100-limit if school has >100 enrolled students per term | M | M | Mirror A.3.9 chunking — chunk at 100 internally in Lambda; loop until all chunks written. Saraswati pilot has ~30 students/section × ~12 sections = ~360/exam max → 4 chunks. Per-chunk audit + event |
| R-A4.11 | Re-running result-batch Lambda on same exam (e.g., manual EventBridge re-publish) creates duplicate ResultCard rows | L (mitigated) | M | `attribute_not_exists(cardId)` guard on TransactWriteItems → ConditionalCheckFailed on duplicate → chunk-level rollback → idempotent (same as A.3.9 idempotency pattern). Document in Lambda docstring |
| R-A4.12 | Result generation for terminal exam doesn't correctly flip `isTerminalExam: true` → C.9.5 cross-year handoff misfires | L | H | Read `Exam.examType` against `archetypeDefaults[archetype].examPattern.terminalKey` (or similar marker) at aggregation; spec covers terminal + non-terminal cases. Cross-link to C.9.5 design when that sprint kicks off |

---

## 6. Invariant gate (per `v1-master-epic-breakdown.md` §1.4)

| Invariant | A.4 disposition |
|---|---|
| Audit + event paired (Sprint 0.2.7 lint) | YES — `publishResultCardCreated`, `publishResultCardUpdated` (conduct/remark), `publishResultPublished` mirror existing pattern. Lambda publishes per-chunk `result.batch_generated` for batch generation. Sprint 0.3 will port to formal auditedWrite |
| Three-way route handoff | YES — Nest controllers + `tenant-api-prod.json` paths added; nginx NOT changed (`/academics/result-cards/*` rides existing `^/academics` prefix) |
| Shared-types changed → minor bump + npm publish + AdminWeb jsdom sim | YES — Phase 1 follows CLAUDE.md per-sprint publish checklist end to end. Pre-deploy grep `client/AdminWeb/src/` for `ResultCard`; controlplane redeploy is OPTIONAL if zero hits |
| New NestJS module → module-wiring.spec.ts SAME PR | DEFERRED — academics has no spec yet (Sprint 0.3 scope). Post-deploy ECS log sanity is the gate |
| New GSI → gsi-inventory.md BEFORE CDK deploy | YES — ResultCard GSI1 + GSI2 (enrollment-centric) + GSI3 (exam-centric) documented in Phase 2 PR |
| Invariant 13 (no pilot names in code) | A.4.7 smoke accepts `PILOT_ID` env; loads fixture from `packages/pilot-fixtures/` by ID. Service code archetype-blind |
| Invariant 12 (no implicit archetype branching) | A.4.1 reads `GradingPolicy` from D.1 (per-tenant entity), not from `tenant.archetype`. Explicit `getArchetypeDefaults()` lookups ARE allowed per A.3 §17.8 L5 clarification |
| Invariant 3 (cross-AY identity via enrollmentId) | A.4.2 keyed by enrollmentId; A.4.6 explicit regression spec; A.4.1 resolves studentId from Enrollment without re-using ExamScore.studentId |
| `as any` cast smell | None expected; aggregation function is fully typed via shared-types DTOs |
| New EventBridge rule + DLQ + alarm | YES — Phase 3 CDK; mirrors existing analytics Lambda pattern; alarm fires to operator SNS topic |
| Lambda cold-start budgeted | YES — A.4.3 AC <45s; CDK memorySize: 1024 MB |

---

## 7. Deploy ladder (per CLAUDE.md + memory `feedback_pr_first_no_more_uat`)

```
Phase 0 — DECISION GATE (no code)
  └── §8 #1 R41 split-stack decision signed off

Phase 1 PR (shared-types schemas + foundation audit + caret-pin bumps)
  ├── (CI green: typecheck, lint, jest, AdminWeb build)
  ├── (Reviewer approval — Shoaib)
  ├── npm publish @aibrains/shared-types@0.58.0
  ├── npm view @aibrains/shared-types version  (verify; 30s propagation)
  ├── npm install (root, refresh lockfile)
  ├── Local AdminWeb rebuild + jsdom sim  ← BLOCKING if fails
  ├── Merge PR to main
  └── controlplane-stack redeploy (CONDITIONAL — only if AdminWeb consumes ResultCard types)

Phase 2 PR (academics entities + controllers + state machine + cross-year spec)
  ├── (CI green; nest build academics; jest A.4 specs)
  ├── (Reviewer approval — final review per memory `feedback_consult_before_code_changes`)
  ├── Merge PR to main
  ├── cdk diff shared-infra-stack (5 new API GW paths) → tee'd
  ├── (Reviewer approval — diff matches expectation)
  ├── cdk deploy shared-infra-stack  ← MANDATORY per A.3 L1 lesson
  ├── scripts/build-application.sh academics (tee'd)
  ├── aws ecs update-service --force-new-deployment academicsbasic (ap-south-1)
  ├── Wait for services-stable
  ├── ECS log sanity: filter `ResultsModule dependencies initialized` + Nest bootstrap success (R-A4.3 mitigation)
  └── Skip smoke until Phase 4

Phase 3 PR (result-batch Lambda + EventBridge + DLQ + alarms)
  ├── (CI green; cdk synth tenant-template-stack-basic; jest lambda specs)
  ├── (Reviewer approval)
  ├── Merge PR to main
  ├── cdk diff tenant-template-stack-basic (Lambda + rule + alarms) → tee'd
  ├── (Reviewer approval — diff matches expectation; no destructive changes to existing services)
  ├── cdk deploy tenant-template-stack-basic
  ├── Manual EventBridge put-events with synthetic exam.closed payload (R-A4.5 mitigation)
  ├── Verify Lambda invocation in CloudWatch Logs (CloudWatch Logs Insights filter)
  ├── Verify alarm provisioning (CW alarms list) + DLQ visible in SQS
  └── Skip smoke until Phase 4

Phase 4 PR (parametric smoke + execution)
  ├── (CI green; script type-checks via tsc)
  ├── (Reviewer approval — script only)
  ├── Merge PR to main
  ├── Request fresh Cognito JWT → /tmp/dev-jwt.txt (Write tool, NOT heredoc)
  ├── Confirm dev-pabson-primary AY + Term + Exam fixtures exist
  ├── PILOT_ID=dev-pabson-primary npx ts-node scripts/smoke-tests/pilot-result-card-publish.ts --dry-run
  ├── (User reviews dry-run output)
  ├── PILOT_ID=dev-pabson-primary npx ts-node scripts/smoke-tests/pilot-result-card-publish.ts (full run)
  ├── tee log to ${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/dev-pabson-smoke-pilot-result-card-publish-<ts>-<sha>.log
  └── Verify cleanup + R42 sanity (no studentId='unknown' on ResultCard rows)
```

**No UAT** per memory `feedback_pr_first_no_more_uat`. Per-step user-in-the-loop authorization via `AskUserQuestion` for CDK deploys + ECS roll + smoke execution.

---

## 8. Open decisions (need sign-off before branch cut)

1. **R41 split-stack decision (Phase 0 gate).** Current shared-infra-stack CFN at 86% post-A.3; A.4 projected ~91%. Options:
   - **(a) Proceed with A.4 as-is + queue split sprint next.** *Recommended.* Trade-off: defers architectural work by ~1 sprint; risk of D.2/D.3 also pushing forward and hitting 100% if split sprint slips.
   - **(b) Pause A.4; do split sprint first.** Trade-off: delays critical-path A.4 by ~3-5 days for ~2-3 day split.
   - **(c) Fold split into A.4 Phase 1.** Trade-off: bundles unrelated architectural change into result-subsystem PR; harder to review.

2. **ResultCard route prefix.** Master plan A.4.4 calls for new top-level `/result-cards` prefix (would need new nginx block). Recommended deviation: namespace under existing `/academics/result-cards/*` (no nginx change, no rproxy redeploy, simpler three-way handoff). *Recommendation: use `/academics/result-cards/*`.*

3. **Result-batch Lambda location.** Master plan A.4.3 path is `server/lib/result-generation/result-batch-lambda.ts`. Existing convention is folder-based: `server/lib/analytics/lambda/<name>/handler.ts`. Recommendation: new top-level domain folder `server/lib/result-generation/lambda/result-batch/handler.ts` (mirrors analytics structure but separate domain). *Recommendation: follow folder-per-lambda convention; new domain dir.*

4. **ExamScore.studentId opportunistic backfill at aggregation.** When A.4.1 resolves `studentId` from Enrollment for ResultCard, should it ALSO write-behind to fix `ExamScore.studentId='unknown'` rows? Options:
   - **(a) No** — keep aggregation pure; ResultCard is the system of truth for resolved studentId; ExamScore.studentId stays 'unknown' on bulk-written rows. *Recommendation.*
   - **(b) Yes opportunistic** — write-behind in same Lambda invocation; adds latency + complexity for marginal benefit (ResultCard is the read path post-aggregation anyway).
   - **(c) One-shot backfill script** — write a separate `scripts/backfill-exam-score-studentid.ts` to run once if/when needed.

5. **ResultCard publish on already-published — 409 or 200 no-op?** A.3 Exam state-machine made same-state a 200 no-op; A.4 plan above proposes 409 RESULT_ALREADY_PUBLISHED. Inconsistent with A.3 but operationally appropriate (publish is a significant event; operator should KNOW it's done). *Recommendation: 409 with structured errorCode.*

6. **classRank / sectionRank in V1.** Confirm null-in-V1, V1.5 compute. *Recommendation: confirm null; document on operator-onboarding briefing.*

7. **AdminWeb consumption check.** Pre-Phase 1, grep `client/AdminWeb/src/` for `ResultCard` references. If zero hits, controlplane redeploy is OPTIONAL. *Recommendation: grep before publishing 0.58.0; document result in Phase 1 PR description.*

8. **A.4.7 smoke target — dev-pabson-primary only?** Per CEO 2026-05-22: prod Saraswati has no course/exam/score data. *Confirmed; mirror A.3.11 target.*

9. **Phase count — 4 vs 3.** A.4 has 4 phases (decision gate + shared-types + academics + Lambda + smoke). Could merge Phase 3 Lambda into Phase 2 if Lambda is small enough; cleaner to keep separate for CDK-deploy isolation. *Recommendation: 4 phases.*

---

## 9. Definition of Done (Sprint A.4)

- [ ] All 7 tickets meet §1.1 per-ticket DoD (Files + Validation + AC + Deps + Risk)
- [ ] Phase 0 R41 decision signed off + documented in §11.2 R41 update
- [ ] All 4 PRs merged to main
- [ ] Phase 1 deploy log: shared-types 0.58.0 npm publish evidence + optional controlplane redeploy log
- [ ] Phase 2 deploy logs: `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/prod-cdk-deploy-shared-infra-stack-<ts>-<sha>.log` (per A.3 L1 lesson) + `prod-build-application-academics-<ts>-<sha>.log` + `prod-ecs-roll-academicsbasic-<ts>-<sha>.log`
- [ ] Phase 3 deploy logs: `prod-cdk-diff-tenant-template-stack-basic-<ts>-<sha>.log` + `prod-cdk-deploy-tenant-template-stack-basic-<ts>-<sha>.log`
- [ ] Phase 4 smoke log: `dev-pabson-smoke-pilot-result-card-publish-<ts>-<sha>.log` with exit 0
- [ ] Phase 2 post-deploy ECS log sanity: `ResultsModule dependencies initialized` captured (R-A4.3 mitigation)
- [ ] Phase 3 EventBridge synthetic event test: Lambda invocation captured in CW Logs (R-A4.5 mitigation)
- [ ] Phase 4 R42 sanity: no `studentId='unknown'` on ResultCard rows
- [ ] Closeout entry added to `docs/pilot-greenlight/sprint-closeouts.md`
- [ ] Status table in `v1-master-epic-breakdown.md` §0.4 updated: `A.4 🟢 shipped <date>` + PRs/logs
- [ ] Memory written: `project_sprint_a4_shipped_prod.md`
- [ ] Risk register §11.2 updated if new R-A4.* surface in implementation
- [ ] `docs/pilot-greenlight/gsi-inventory.md` updated with ResultCard GSIs
- [ ] No regressions in A.2 / A.3 / D.1 / E.0 / E.1 / 0.4 smokes (regression bundle re-run pre-merge of Phase 2)

---

## 10. What this plan deliberately does NOT include

- Report Card PDF rendering — Sprint C.4 scope
- ClassRank/SectionRank calculation — V1.5
- Frontend ResultCard UI (operator close-exam → cards → publish) — saas-frontend academics MFE follow-up
- Re-aggregation on score correction post-publish — V1.5 (V1: requires Exam → in_progress → re-score → re-close → Lambda re-runs)
- Un-publish ResultCard — V1.5 (inline-policy operator-led for now)
- Academics `module-wiring.spec.ts` — Sprint 0.3
- Full `auditedWrite()` migration — Sprint 0.3
- PascalCase → snake-dotted event migration — Sprint B.2.2, V1.5
- ExamScore.studentId backfill — §8 #4 (recommendation: separate one-shot script if/when needed)
- Cross-school result aggregation (chain reporting) — pilot 2 + multi-school scope
- `shared-api-routes-stack` split — separate immediately-following sprint per §8 #1 (a)

---

## Sign-off requested

Open decisions in §8 above are the gates. Once signed off:
1. Cut feature branch: `sprint/a4-phase-0` (the R41 decision gate doc) or `sprint/a4-phase-1-shared-types` (if Phase 0 inlines into Phase 1 PR description) on the server repo.
2. Per memory `feedback_explicit_cd_per_git`: every git op starts with explicit `cd <repo-root>` in the same invocation.
3. Begin Phase 1 implementation.
