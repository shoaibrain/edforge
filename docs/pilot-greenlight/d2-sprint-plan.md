# Sprint D.2 — PromotionRule Entity + Workflow + Cross-Year Handoff: Sprint Plan

> **Drafted:** 2026-05-23
> **Status:** 🟡 Draft — awaiting sign-off before branch cut
> **Master-plan section:** [`v1-master-epic-breakdown.md`](./v1-master-epic-breakdown.md) §3 Sprint D.2 (lines 1191–1266)
> **Companion precedents:** [`a4-sprint-plan.md`](./a4-sprint-plan.md), [`a3-sprint-plan.md`](./a3-sprint-plan.md), [`a2-sprint-plan.md`](./a2-sprint-plan.md)

---

## 1. Why this sprint, why now

### Critical-path argument

D.2 is the immediate next link unlocked by A.4 (Result subsystem shipped 2026-05-23) + D.1 (GradingPolicy) + R41.A (CFN headroom recovered). It cashes in A.4's `result.published` event and primes the largest cross-year fan-out chain remaining in V1:

```
D.2 (PromotionRule + cross-year handoff) ─┬─→ D.3 ExternalAssessment (D.3.4 needs PromotionRule.gradeLevel binding)
                                          ├─→ D.4 BLE (D.4.7 retake flow reads PromotionRule)
                                          ├─→ D.5 SEE (same pattern)
                                          ├─→ D.6 NEB (D.6.4 binds PromotionRule)
                                          ├─→ D.7 StudentAcademicTrack (D.7.5 promotion commit updates track)
                                          └─→ H.1 (cross-year evidence sprint validates D.2.10 attendance preservation)
```

5+ downstream sprints depend on D.2. Beyond critical path: D.2 closes the **"Operate → Evaluate → Promote → Operate (next AY)"** product loop for V1 — without PromotionRule + cross-year handoff, the operator has no way to roll students into the next academic year while preserving cross-AY identity (invariant 3).

### Foundation in place (post-A.4 + D.1 + R41.A)

- ✅ `ResultCard` entity keyed by `enrollmentId` (A.4.2 shipped 2026-05-23) — D.2.4 evaluator reads `totalScore` + `termGpa` + `courseScores[]`
- ✅ `result.published` event with `isTerminal: boolean` (`packages/shared-types/src/events/result.ts:18`) — D.2.9 handler subscribes; isTerminal=true is the flip trigger
- ✅ `GradingPolicy` + `letterGrades[].isPassing` + `isTerminalFail` (D.1 shipped) — D.2.4 maps ResultCard.totalScore → eligibility against PromotionRule.passingThresholdPct
- ✅ `Exam.status = 'published'` + `exam.closed` triggering A.4.3 Lambda → `result.published` (A.4.5) — D.2.9 wires to this chain end-to-end
- ✅ `Enrollment.enrollmentId` keyed entity per invariant 3 (existing entity, S3.2 GSI casing shipped) — D.2.7 extends with `priorEnrollmentId` + `promotionDecision` write-once
- ✅ `Enrollment` state machine (`microservices/academics/src/common/utils/enrollment-state-machine.ts`) — D.2.8 extends with `provisional` state + new transitions
- ✅ `AcademicYear` entity in **identity** service (`microservices/identity/src/common/entities/academic-year.entity.ts`) — D.2.5 evaluation endpoint needs cross-service AY lookup
- ✅ `ArchetypeDefaults.boardExams[]` carries `passingThresholdPct: 35` for PABSON (`packages/shared-types/src/archetype/archetype-defaults.ts:53`) — D.2.3 seed reads
- ✅ Shared-types caret-pin discipline (R39) — Phase 1 pattern preserved
- ✅ R41 closed — shared-infra-stack template at ~6% of 1MB ceiling; **no Phase 0 gate; freely add API GW paths**

### Per §0 philosophy (CEO 2026-05-22)

Product completeness over pilot-fixture work. D.2 closes the year-end-to-year-start operator workflow loop and is the largest invariant-3 (cross-AY identity) implementation work in V1. Smoke target stays `dev-pabson-primary` (Saraswati has live AY but no published exam data; operator-led when ready).

---

## 1.5 Architecture principle — Core Ed-Fi V6 + Edges by archetype (carry-over from A.2 / A.3 / A.4)

**Same load-bearing discipline.** Every implementation decision below MUST be evaluated against it.

### Statement (unchanged)

EdForge's data model is **Ed-Fi V6 at the Core** (canonical, archetype-blind entities, descriptors, validators, engines) with **archetype-specific Edges at the boundary** (seeds, catalogs, defaults — never inside service code).

### Layer mapping for D.2

| Layer | Lives in | Archetype-aware? | D.2 contributions |
|---|---|---|---|
| **Core — Ed-Fi V6 canonical** | `packages/shared-types/src/schemas/academics/promotion-rule.schema.ts`, `server/application/microservices/academics/src/promotion-rules/`, `server/application/microservices/academics/src/promotion/`, `microservices/academics/src/enrollment/` | NO — must pass invariant-12 grep clean | D.2.1 `PromotionRule` entity (Ed-Fi `PromotionPolicy` analogue under `edforge:` extension namespace); D.2.4 pure-function evaluator; D.2.7 Enrollment field additions; D.2.8 state machine; D.2.10 provisional→final flip |
| **Edge — Archetype boundary** | `packages/shared-types/src/archetype/archetype-defaults.ts` (existing); `PromotionRule` rows seeded per-tenant via D.2.3 (mirror D.1.3 lazy-seed pattern) | YES — already shipped | D.2.3 reads `archetypeDefaults[archetype].boardExams[i].passingThresholdPct` + a new `minAttendancePct` field IF needed (see §8 #2); never branches on `tenant.archetype` directly |
| **Service runtime** | `server/application/microservices/academics/src/promotion-rules/`, `…/promotion/`, `…/students/student-timeline.controller.ts`, `…/enrollment/enrollment-transition-handler.service.ts` | NO — treats every PromotionRule identically | D.2.2 + D.2.5 + D.2.6 + D.2.9 + D.2.11 controllers / services |

### Specific invariants D.2 enforces

1. **`Enrollment.enrollmentId` is the entity key — invariant 3.** D.2.10's flip rewrites `gradeLevel` on the prior enrollment row (or creates a new row in target AY linked via `priorEnrollmentId`) without changing `enrollmentId`. Attendance, ExamScore, and ResultCard rows all remain bound to the original `enrollmentId` post-flip. **§5 R-D2.1 + D.2.10's invariant-3 guard test verify.**
2. **`PromotionRule` evaluation is a pure function.** Input: `{ resultCards: ResultCard[], attendancePct: number, rule: PromotionRule }`. Output: `{ eligible: boolean, retainedReason?: 'subject_failure' | 'attendance_failure' | 'subjects_required_missing' }`. Zero DDB reads inside the function — all reads happen in the caller.
3. **No `tenant.archetype` reads in `promotion/` or `promotion-rules/` src.** Per invariant 12: explicit data-driven lookups via TenantMetadataReader + `getArchetypeDefaults()` ARE allowed (used only by the D.2.3 seed path); implicit `if (archetype === 'PABSON')` branching is rejected.
4. **`promotionDecision` is write-once on the source-AY enrollment.** First PATCH that sets the field is the system-of-record decision. Second PATCH returns 409 `PROMOTION_DECISION_LOCKED`. D.2.7 enforces at the entity-write layer via `attribute_not_exists(promotionDecision)` condition expression.
5. **`provisional` is non-terminal and reversible only forward.** `provisional → enrolled` (D.2.10 flip); `provisional → withdrawn` (operator deletes a provisional row pre-flip). NO transition: `enrolled → provisional` (rejected at state-machine validation).
6. **D.2.9 handler is idempotent on `result.published` re-delivery.** Same cardId + same enrollmentId → no double-flip. Implementation: D.2.10's TransactWriteItems uses `attribute_not_exists(promotionDecision)` + version check, so a re-fired handler is a no-op on already-flipped rows.
7. **Atomicity per chunk in D.2.6 + D.2.10.** Both use chunked TransactWriteItems at 100 rows max (DDB hard limit). Failure of any item in a chunk rolls the chunk back; the next chunk proceeds. Per-chunk audit + event.
8. **Cross-year smoke (D.2.12) covers the full operator-printed loop.** Two AYs, two cohorts, two terminal exams, full promotion → flip → attendance preservation → timeline.

### Anti-pattern guardrails (rejected at PR review)

- `if (tenant.archetype === 'PABSON') rule.passingThresholdPct = 35` → reject (read from PromotionRule entity, which D.2.3 seeded from `archetypeDefaults`)
- Hardcoded `passingThresholdPct` in evaluator (`if (avgScore < 35) retain`) → reject (read from PromotionRule.passingThresholdPct)
- Service code that calls `resultCardsService.list()` inside evaluator → reject (pure function MUST receive cards via parameter)
- D.2.9 handler that re-queries the same provisional row in a loop → reject (one cardId → one flip TransactWrite; idempotent via condition expression)
- D.2.10 flip that mutates `enrollmentId` → reject (invariant 3 violation; rewrite `gradeLevel` + add `priorEnrollmentId` instead)
- D.2.11 timeline that joins across AY via studentId-only query without enrollmentId distinctness → reject (every row in the response must carry its own `enrollmentId`)

---

## 2. Scope

### In-scope

| Ticket | Summary | Sized |
|---|---|---|
| D.2.1 | `PromotionRule` entity + Zod schema + factory | S |
| D.2.2 | PromotionRule CRUD endpoints (5 new API GW paths under `/academics/promotion-rules`) | M |
| D.2.3 | PABSON default PromotionRule seed (lazy-seed mirror of D.1.3) | S |
| D.2.4 | Pure-function evaluator `evaluatePromotion(input): EvaluationOutput` | M |
| D.2.5 | Batch promotion-evaluation endpoint (POST `/academics/schools/{schoolId}/academic-years/{fromAyId}/promote-from`) | M |
| D.2.6 | Cross-year promotion commit (POST `…/promote-from/{targetAyId}/commit`, chunked at 100) | M |
| D.2.7 | `Enrollment.priorEnrollmentId` + `promotionDecision` write-once fields + GSI4 (priorEnrollmentId-centric) | M |
| D.2.8 | `provisional` EnrollmentStatus + state-machine extensions | S |
| D.2.9 | NestJS `enrollment-transition-handler.service.ts` subscribing to `result.published` (terminal-only) | M |
| D.2.10 | Atomic provisional→final flip (chunked at 100 per TransactWriteItems) | M |
| D.2.11 | Cross-AY `GET /academics/students/{studentId}/timeline` endpoint | S |
| D.2.12 | Parametric pilot cross-year smoke (`scripts/smoke-tests/pilot-cross-year-handoff.ts`) | M |
| (implicit) | `promotion-rule.schema.ts` + `promotion-evaluation.schema.ts` Zod schemas in shared-types | S |
| (implicit) | `promotion-rule.mapper.ts` entity↔DTO round-trip | S |
| (implicit) | `gsi-inventory.md` updates for PromotionRule GSI1 + Enrollment new GSI4 | XS |
| (implicit) | `academics/__tests__/module-wiring.spec.ts` extension — register new `PromotionRulesModule` + `PromotionModule` + augmented `EnrollmentModule` (R-D2.3 mitigation; closes a known gap from A.4 post-incident retro) | S |

### Out-of-scope (deferred, with reason)

| Item | Why |
|---|---|
| Frontend PromotionRule UI (operator review → commit decisions) | Post-D.2 follow-up; saas-frontend academics MFE wiring is separate work; D.2 ships API + handler + smoke only |
| Frontend cross-year timeline UI | Same — D.2.11 ships the read endpoint; UI binding is MFE follow-up |
| D.2 → D.3 binding (`RubricCategory` etc. references PromotionRule) | D.3 sprint scope; D.2.1 entity ships with shape ready for D.3 FK |
| D.2 → D.7 binding (StudentAcademicTrack updated by promotion commit) | D.7 sprint scope; D.2.6 commit emits `enrollment.promoted` event that D.7 subscribes to |
| Re-evaluation on score correction post-publish | V1: ResultCard published is terminal (A.4.5); score correction requires un-publish (V1.5). D.2.4 evaluator is pure, so re-run is trivial once that ships |
| Multi-target-AY promotion (e.g., grade-skip) | V1: one source AY → one target AY; D.2.6 enforces. V1.5 if pilot requests |
| Conditional/probation promotion decisions | V1: `promotionDecision: 'promoted' \| 'retained' \| 'conditional' \| 'graduated' \| 'withdrawn' \| 'transferred_out'`. `conditional` IS in the enum but the workflow (re-evaluation after probation window) is V1.5; D.2 commits leave the decision recorded without follow-up automation |
| Bulk promotion-rule editor / template library | V1: per-grade rule, lazy-seeded; operator edits via D.2.2 single-row PATCH. V1.5 |
| Re-aggregation of attendance at promotion time | V1: attendance is read at evaluation time (D.2.5 input), not stored. The %-attendance figure shown to operator IS the current snapshot |
| Cross-school promotion (transfer-out → another school's enrollment) | V1: D.2 covers same-school AY rollover only. Transfer-out is existing `Enrollment.status = 'transferred'` flow; cross-school re-enrollment is operator-led |
| `auditedWrite()` migration across promotion endpoints | Sprint 0.3 scope. D.2 uses existing audit/event pattern matching A.4 |
| EventBridge-Lambda implementation of D.2.9 (vs in-process NestJS handler) | See §8 #4. V1 recommendation: in-process `@OnEvent` via existing EventEmitter pattern (lower op surface); EventBridge-Lambda is V1.5 if cross-service decoupling becomes valuable |

### Already-shipped foundation (post-A.4 + D.1 + R41.A)

- `ResultCard` entity keyed by `enrollmentId` + `isTerminalExam` field (A.4.2) — D.2.4 evaluator + D.2.9 trigger
- `result.published` event with `isTerminal: boolean` (A.4.5) — D.2.9 subscribes; only terminal exams trigger flip
- `Exam.examType` + PABSON examPattern `[unit_test, terminal, send_up, pre_board, final]` (A.3) — `final` is the V1 terminal-trigger marker (consistent with A.4.3 Lambda's V1 simplification)
- `GradingPolicy.letterGrades[].isPassing` + `isTerminalFail` (D.1) — D.2.4 can derive subject-pass from ResultCard.courseScores[].isPassing without re-evaluating
- `Enrollment` entity + state machine (existing) — D.2.7 extends entity, D.2.8 extends state machine
- `AcademicYear` entity in identity service (existing) — D.2.5 cross-service AY lookup via TenantMetadataReader pattern OR HTTP (see §8 #3)
- `ArchetypeDefaults.boardExams[].passingThresholdPct` (`PABSON: 35`) — D.2.3 seeds from this
- `auditedWrite()` + `publishAcademicsEvent()` pattern in academics-events.service.ts — D.2.* writes follow the same pattern
- Existing nginx `^/academics` location block — all D.2 routes ride this; **no new nginx prefix needed**
- R41-mitigated CFN template (~59KB / ~6% of 1MB) — no Phase 0 gate; D.2's ~10 new API GW paths add ~90KB → projected ~15% post-D.2; well within ceiling

---

## 3. PR cadence — 4 phases

Phase boundaries chosen so each PR is independently revertable and the deploy ladder reads naturally. **No Phase 0 R41 gate** — closed 2026-05-23 via R41.A; shared-infra-stack template at ~6% of 1MB.

### Phase 1 — shared-types schemas + Enrollment field additions + module-wiring spec extension (1 PR)

**Tickets:** D.2.1 schema half + D.2.7 schema half + caret-pin bumps

**Files:**
- NEW `packages/shared-types/src/schemas/academics/promotion-rule.schema.ts` — `promotionRuleSchema`, `createPromotionRuleSchema`, `updatePromotionRuleSchema`, `promotionRuleResponseSchema`, `promotionRuleFilterSchema`
- NEW `packages/shared-types/src/schemas/academics/promotion-evaluation.schema.ts` — `promotionEvaluationRequestSchema`, `promotionEvaluationResponseSchema`, `promotionCommitRequestSchema`, `promotionCommitResponseSchema`
- MODIFIED `packages/shared-types/src/schemas/academics/enrollment.schema.ts` (or create if absent) — add `priorEnrollmentId?: string`, `promotionDecision?: enum`, extend `EnrollmentStatus` enum with `provisional`
- NEW spec: `promotion-rule.schema.spec.ts` — ≥40 assertions (positives + negatives for `passingThresholdPct` 0-100 range, `gradeLevel` non-empty, `subjectsRequired[]` array of descriptors)
- NEW spec: `promotion-evaluation.schema.spec.ts` — request/response round-trip ≥20 assertions
- MODIFIED spec: `enrollment.schema.spec.ts` — add `priorEnrollmentId` + `promotionDecision` round-trip + provisional status
- NEW `docs/pilot-greenlight/d2-foundation-readiness-audit.md` — confirms A.4 + D.1 + R41.A shipped; cites the 3 entity GSIs D.2 reads; flags R-D2.* status
- MODIFIED `packages/shared-types/src/schemas/academics/index.ts` — barrel
- MODIFIED `packages/shared-types/src/index.ts` — re-export
- MODIFIED `packages/shared-types/package.json` — 0.58.0 → 0.59.0
- MODIFIED `server/application/package.json` + `server/package.json` — `^0.58.0` → `^0.59.0` (R39 mitigation, SAME PR)
- MODIFIED `package-lock.json` (refreshed via root `npm install`)

**Deploy:**
- publish `@aibrains/shared-types@0.59.0` → `npm view @aibrains/shared-types version` verify (30s propagation) → root lockfile refresh
- Local AdminWeb rebuild + jsdom sim (per CLAUDE.md per-sprint publish checklist) → BLOCKING if fails
- Merge PR
- controlplane-stack redeploy: **CONDITIONAL** — only if AdminWeb consumes new types. Pre-merge grep `client/AdminWeb/src/` for `PromotionRule|promotionDecision|priorEnrollmentId|promote-from`. If zero hits, skip (saves ~12 min of pipeline runtime).

### Phase 2 — PromotionRule entity + CRUD + seed + evaluator + Enrollment field migrations + state machine + cross-year regression spec (1 PR)

**Tickets:** D.2.1 entity half + D.2.2 + D.2.3 + D.2.4 + D.2.7 entity half + D.2.8 + (implicit) module-wiring spec extension

**Files:**
- NEW `server/application/microservices/academics/src/common/entities/promotion-rule.entity.ts` + `.spec.ts`
- NEW `server/application/microservices/academics/src/common/mappers/promotion-rule.mapper.ts`
- NEW `server/application/microservices/academics/src/promotion-rules/promotion-rules.service.ts` + `.spec.ts` — CRUD + lazy-seed `ensureDefaultPolicy(schoolId, gradeLevel)` mirroring `GradingPolicyService.ensureDefaultPolicy` (D.1.3)
- NEW `server/application/microservices/academics/src/promotion-rules/promotion-rules.controller.ts` — D.2.2 endpoints
- NEW `server/application/microservices/academics/src/promotion-rules/promotion-rules.module.ts` — declares full provider list (per [[feedback-module-wiring-invariant]])
- NEW `server/application/microservices/academics/src/promotion/promotion-evaluator.service.ts` + `.spec.ts` — D.2.4 pure function
- NEW `server/application/microservices/academics/src/promotion/promotion.module.ts` — wraps evaluator + future batch service
- MODIFIED `server/application/microservices/academics/src/common/entities/enrollment.entity.ts` — add `priorEnrollmentId?`, `promotionDecision?` fields + write-once helper
- MODIFIED `server/application/microservices/academics/src/common/entities/base.entity.ts` — extend `EnrollmentStatus` with `'provisional'`
- MODIFIED `server/application/microservices/academics/src/common/utils/enrollment-state-machine.ts` — add `provisional` row in VALID_TRANSITIONS with `Set(['enrolled', 'withdrawn'])`; assert `enrolled → provisional` is NOT in any allowed set
- MODIFIED `server/application/microservices/academics/src/common/utils/enrollment-state-machine.spec.ts` — extend coverage to 100% of provisional transitions (valid + invalid)
- MODIFIED `server/application/microservices/academics/src/common/mappers/enrollment.mapper.ts` — round-trip new fields
- NEW `server/application/microservices/academics/src/promotion/cross-year-promotion.spec.ts` — invariant-3 regression: 2 enrollments same studentId in 2 AYs; flip AY1 enrollment; AY1 ResultCards/Attendance/ExamScore all still reference the original `enrollmentId` post-flip
- MODIFIED `server/application/microservices/academics/src/academics.module.ts` — import `PromotionRulesModule`, `PromotionModule`
- MODIFIED `server/application/microservices/academics/src/__tests__/module-wiring.spec.ts` — register new modules (closes [[feedback-module-wiring-invariant]] gap that bit A.4)
- MODIFIED `server/application/microservices/academics/src/common/services/academics-events.service.ts` — add `publishPromotionRuleCreated`, `publishPromotionRuleUpdated`, `publishEnrollmentPromotionDecided`
- MODIFIED `server/lib/tenant-api-prod.json` — add 5 new path entries:
  - `/academics/promotion-rules` (GET LIST with filters `schoolId`/`gradeLevel`, POST)
  - `/academics/promotion-rules/{ruleId}` (GET, PATCH, DELETE)
  - (note: per §1.5 three-way handoff rule, `^/academics` nginx prefix already covers — no nginx.template change)

**Deploy:**
- academics ECR build + push + ECS rolling update `academicsbasic` on `ap-south-1` (tee'd to logs)
- `cdk deploy shared-infra-stack` for the 2 new API GW path entries (per A.3 L1 lesson; **mandatory** for any `tenant-api-prod.json` change)
- Wait services-stable + post-deploy ECS log sanity: `PromotionRulesModule dependencies initialized`, `PromotionModule dependencies initialized` (R-D2.3 mitigation)
- Cross-stack export pre-flight per CLAUDE.md (shared-infra-stack has TenantApiAuthorizerArn/RestApiId/RootResourceId importers) — verify only Output-value changes are NON-template-form (additions to paths only)
- Skip smoke until Phase 4 (entities + CRUD are exercised by Phase 3 endpoints anyway)

### Phase 3 — batch evaluation + commit + transition-handler + atomic flip + timeline (1 PR)

**Tickets:** D.2.5 + D.2.6 + D.2.9 + D.2.10 + D.2.11 + Enrollment GSI4 + module-wiring extension for any new sub-modules

**Files:**
- NEW `server/application/microservices/academics/src/promotion/promotion-batch.service.ts` + `.spec.ts` — D.2.5 evaluation endpoint backing service (reads ResultCards via GSI2 enrollment-centric or GSI3 exam-centric depending on §8 #6 decision)
- NEW `server/application/microservices/academics/src/promotion/promotion-batch.controller.ts` — D.2.5 + D.2.6 endpoints
- NEW `server/application/microservices/academics/src/promotion/promotion-commit.service.ts` + `.spec.ts` — D.2.6 chunked TransactWriteItems
- NEW `server/application/microservices/academics/src/enrollment/enrollment-transition-handler.service.ts` + `.spec.ts` — D.2.9 NestJS `@OnEvent('result.published')` subscriber; calls D.2.10
- NEW `server/application/microservices/academics/src/enrollment/enrollment-flip.service.ts` + `.spec.ts` — D.2.10 atomic provisional→final flip (chunked); single function `promoteProvisionalToEnrolled(provisionalIds[], context): FlipResult`
- NEW `server/application/microservices/academics/src/students/student-timeline.controller.ts` + `.spec.ts` — D.2.11 endpoint
- NEW `server/application/microservices/academics/src/students/student-timeline.service.ts` + `.spec.ts` — queries Enrollment GSI2 (studentId-centric) + traverses `priorEnrollmentId` chain
- MODIFIED `server/application/microservices/academics/src/enrollment/enrollment.entity.ts` — declare GSI4 (new) `gsi4pk: prior-enrollment#{priorEnrollmentId}`, `gsi4sk: ENROLLMENT#{academicYearId}` for D.2.10 efficient lookup
- MODIFIED `server/application/microservices/academics/src/enrollment/enrollment.service.ts` — set GSI4 keys when creating provisional Enrollment via D.2.6 commit
- MODIFIED `server/lib/tenant-template/ecs-dynamodb.ts` — declare GSI4 on academics table (PK + SK + projection)
- MODIFIED `server/application/microservices/academics/src/academics.module.ts` — import new modules
- MODIFIED `server/application/microservices/academics/src/enrollment/enrollment.module.ts` — register transition-handler + flip service; declare common-service providers (per [[feedback-module-wiring-invariant]])
- MODIFIED `server/application/microservices/academics/src/__tests__/module-wiring.spec.ts` — extend to new modules
- MODIFIED `server/application/microservices/academics/src/common/services/academics-events.service.ts` — add `publishEnrollmentPromoted`, `publishEnrollmentFlipped`, `publishCrossYearTimelineQueried`
- MODIFIED `docs/pilot-greenlight/gsi-inventory.md` — document Enrollment GSI4 + PromotionRule GSI1
- MODIFIED `server/lib/tenant-api-prod.json` — add 3 new path entries:
  - `/academics/schools/{schoolId}/academic-years/{fromAyId}/promote-from` (POST D.2.5)
  - `/academics/schools/{schoolId}/academic-years/{fromAyId}/promote-from/{targetAyId}/commit` (POST D.2.6)
  - `/academics/students/{studentId}/timeline` (GET D.2.11)

**Deploy:**
- `cdk diff tenant-template-stack-basic` (tee'd) — review Enrollment GSI4 addition (DDB index creation; backfill considerations per §5 R-D2.4)
- `cdk diff shared-infra-stack` (tee'd) — review API GW path additions
- Cross-stack export pre-flight per CLAUDE.md
- `cdk deploy tenant-template-stack-basic` (GSI4 add — non-disruptive index addition; existing rows lazy-fill on next write)
- `cdk deploy shared-infra-stack` (new paths)
- academics ECR build + push + ECS rolling update `academicsbasic` (tee'd)
- Wait services-stable + post-deploy ECS log sanity: `EnrollmentTransitionHandler subscribed to result.published`, all new modules initialized
- Skip smoke until Phase 4
- Manual EventBridge synthetic event NOT needed — D.2.9 is in-process NestJS @OnEvent, not EventBridge-routed (per §8 #4)

### Phase 4 — parametric pilot smoke + execution (1 PR + operator-led run)

**Tickets:** D.2.12

**Files:**
- NEW `scripts/smoke-tests/pilot-cross-year-handoff.ts` — parametric (`PILOT_ID` env-driven; defaults to `dev-pabson-primary` per invariant 13)

**Smoke checkpoints** (mirrors A.4.7's 12-step structure but with cross-year scope):
1. Confirm Pilot tenant + School + Active AY1 + (next-AY) AY2 + terminal Exam in AY1 exist (or create synthetic AY2 + 10 provisional enrollments)
2. Confirm A.4 fixture: 10 ResultCards under AY1 terminal Exam status=`published` (or publish via A.4.5 endpoint as smoke setup)
3. Confirm PromotionRule(s) exist for AY1's gradeLevel range (or lazy-seed via D.2.3 first-GET)
4. GET `/academics/promotion-rules?schoolId=…&gradeLevel=…` → 200 + ≥1 rule
5. POST `/academics/schools/{schoolId}/academic-years/{ay1Id}/promote-from?targetAyId={ay2Id}&gradeLevel={gradeLevel}` → 200 + list of 10 suggestions (e.g., 9 promoted + 1 retained)
6. POST `…/promote-from/{ay2Id}/commit` with the 10 decisions → 200 + 10 provisional enrollments created in AY2
7. GET enrollment by GSI4 (priorEnrollmentId-centric query) → 10 rows with status=`provisional`
8. PATCH `/academics/exams/{ay1TerminalExamId}/status` to publish (or confirm already published) → triggers `result.published` events with `isTerminal: true` for each card
9. Poll: GET ay2 enrollments via GSI4 until status=`enrolled` for the 9 promoted, status unchanged for the 1 retained (or 30s timeout)
10. Verify D.2.10 attendance preservation: the 1 retained student's prior-AY attendance still references the original `enrollmentId` (invariant 3 guard); query Attendance rows by `gsi2pk=enrollmentId-of-retained-student` → all rows intact
11. GET `/academics/students/{retainedStudentId}/timeline` → 2 enrollments returned: AY1 enrollment (`promotionDecision: 'retained'`) + AY2 provisional with `priorEnrollmentId` filled
12. GET `/academics/students/{promotedStudentId}/timeline` → 2 enrollments returned: AY1 (`promoted`) + AY2 (`enrolled`, `priorEnrollmentId` filled)
13. Idempotency probe: replay the `result.published` event by re-publishing a card (or directly invoking the handler in test mode) → no double-flip; D.2.9 returns no-op
14. Re-PATCH `promotionDecision` on AY1 enrollment → 409 `PROMOTION_DECISION_LOCKED`
15. Cleanup: soft-delete synthetic AY2 + cascade provisional enrollments + ResultCard rows (or leave for inspection — operator's call)

**Deploy:** no infra change. Script execution against `dev-pabson-primary`. Fresh Cognito JWT to `/tmp/dev-jwt.txt` per memory `feedback_just_ask_for_a_prod_token`. Operator-led per `feedback_commit_and_deploy_approval`.

---

## 4. Per-ticket detail (with §1.1 atomic conventions)

### D.2.1 — `PromotionRule` entity + Zod schema

**Files:** Phase 1 (schema) + Phase 2 (entity).
- NEW `packages/shared-types/src/schemas/academics/promotion-rule.schema.ts`
- NEW `packages/shared-types/src/schemas/academics/promotion-rule.schema.spec.ts`
- NEW `microservices/academics/src/common/entities/promotion-rule.entity.ts`
- NEW `microservices/academics/src/common/entities/promotion-rule.entity.spec.ts`
- NEW `microservices/academics/src/common/mappers/promotion-rule.mapper.ts`

**Entity shape:**
```typescript
export interface PromotionRule extends BaseEntity {
  entityType: 'PROMOTION_RULE';
  ruleId: string;
  schoolId: string;
  gradeLevel: string;                              // e.g. '5', '6', '7'; canonical PABSON grade tokens
  archetypeId: string;                             // 'PABSON' | 'GENERIC' — write-time stamp for audit traceability
  passingThresholdPct: number;                     // 0-100; PABSON default 35
  minAttendancePct: number;                        // 0-100; PABSON default 80 (operator-editable)
  subjectsRequired: AcademicSubjectDescriptor[];   // empty[] = all subjects; non-empty = these specific subjects MUST pass
  archetypeDefaulted: boolean;                     // true if seeded by D.2.3; flips to false on first operator-edit (D.2.2 PATCH)
  description?: string;                            // free-text operator note
  isActive: boolean;                               // soft-delete via this (default true; PATCH to false retires the rule)
  // GSI Keys (lowercase per S3.2)
  gsi1pk: string;                                  // 'tenant#{tid}#school#{schoolId}'
  gsi1sk: string;                                  // 'promotion-rule#{gradeLevel}#{ruleId}'
}
```

**Schema spec coverage:**
- `passingThresholdPct: 0` valid; `-1` invalid; `100` valid; `101` invalid
- `minAttendancePct` same range
- `subjectsRequired: []` valid (= "all subjects must pass")
- `subjectsRequired: [validDescriptor]` valid; `subjectsRequired: ['raw_string']` invalid (must be `AcademicSubjectDescriptor`)
- `gradeLevel: ''` invalid; missing invalid; `gradeLevel: '7'` valid
- `archetypeId: 'PABSON'` valid; `archetypeId: 'NOT_AN_ARCHETYPE'` valid at schema (Zod is shape-only; runtime check in service)
- Round-trip create → response → update → response with stable types

**Entity factory unit:**
- Returns entity with `entityKey: EntityKeyBuilder.promotionRule(schoolId, ruleId)`
- `gsi1pk`/`gsi1sk` use lowercase casing per S3.2
- Default `isActive: true`, `archetypeDefaulted: true` when invoked from seed path

**AC:**
- Schema + factory; module-wiring updated; Ed-Fi alignment: entity extension namespace logged as `edforge:PromotionPolicy` in entity docstring (per master plan)
- `tenantId` carries bare UUID per memory `edforge_identity_ddb_bare_uuid_partition_key`
- GSI casing lowercase per S3.2

**Deps:** 0.4.1 ✅ (archetype defaults).

### D.2.2 — PromotionRule CRUD endpoints

**Files:** Phase 2.
- NEW `microservices/academics/src/promotion-rules/promotion-rules.controller.ts`
- NEW `microservices/academics/src/promotion-rules/promotion-rules.service.ts` + `.spec.ts`
- NEW `microservices/academics/src/promotion-rules/promotion-rules.module.ts`
- MODIFIED `server/lib/tenant-api-prod.json` (2 path entries)

**Endpoints (three-way handoff: Nest controller + API GW path + nginx `^/academics` existing block):**
- `GET /academics/promotion-rules?schoolId=…&gradeLevel=…` — LIST with filters (gradeLevel optional)
- `POST /academics/promotion-rules` — create
- `GET /academics/promotion-rules/{ruleId}` — single
- `PATCH /academics/promotion-rules/{ruleId}` — partial update (sets `archetypeDefaulted: false` on any PATCH)
- `DELETE /academics/promotion-rules/{ruleId}` — soft-delete (sets `isActive: false`)

**Validation:**
- jest integration: each verb returns correct status + audit row + event
- 400 on schema violation
- 404 on missing ruleId
- 409 on (schoolId, gradeLevel, isActive: true) duplicate-create attempt — unique constraint via condition expression on PutItem
- Route-drift lint: `scripts/check-route-drift.ts` passes (Nest controller + tenant-api-prod.json + nginx all in lockstep)

**AC:**
- CRUD + audit + event per write
- Three-way route handoff verified by lint
- PATCH clears `archetypeDefaulted` flag

**Deps:** D.2.1.

### D.2.3 — PABSON default PromotionRule seed (lazy-seed pattern)

**Files:** Phase 2.
- Inline in `promotion-rules.service.ts` — `ensureDefaultRule(schoolId: string, gradeLevel: string, context: RequestContext)`

**Pattern mirrors D.1.3 (`GradingPolicyService.ensureDefaultPolicy`):**
- Triggered on first `GET /academics/promotion-rules?schoolId=…&gradeLevel=…` returning empty result
- Read archetype via `TenantMetadataReader.getTenantMetadata(tenantId).archetype` (already inlined into academics — see `tenant-metadata-reader.service.ts`)
- Resolve `archetypeDefaults[archetype]` — for PABSON: `passingThresholdPct: 35`, `minAttendancePct: 80` (the latter operator-confirmed by champion field visit per master plan D.2.3 comment)
- Build PromotionRule entity with `archetypeDefaulted: true`
- Write via `putItem` with `attribute_not_exists(entityKey)` (idempotent; concurrent first-GET safe)
- Emit `promotion-rule.created` event

**Fallback (per D.1.3 precedent):**
- Tenant METADATA missing → US-default scale = passingThresholdPct: 60, minAttendancePct: 90, `archetype: 'GENERIC'`; log warning; operator-visible GET should NOT 5xx

**Validation:**
- Integration: first GET on a PABSON tenant with no rules → 200 + lazy-seeded rule for the queried gradeLevel
- Second concurrent GET → no duplicate (ConditionalCheckFailed swallowed; second caller reads the first's row)
- Tenant without METADATA → fallback US-default with warning log captured

**AC:**
- PABSON tenants have defaults on first read; backfill script for existing rows NOT needed (lazy-seed handles)
- ConditionalCheckFailed-on-concurrent-create swallowed
- Audit + event paired

**Deps:** D.2.1 + 0.4.2.

### D.2.4 — Pure-function promotion evaluator

**Files:** Phase 2.
- NEW `microservices/academics/src/promotion/promotion-evaluator.service.ts`
- NEW `microservices/academics/src/promotion/promotion-evaluator.service.spec.ts`

**Function signature:**
```typescript
export interface PromotionEvaluationInput {
  enrollmentId: string;
  resultCards: ResultCard[];                   // ALL terminal-AY cards for this enrollment (typically 1, but engine handles N)
  attendancePct: number;                       // current AY attendance % at evaluation time (caller computes)
  rule: PromotionRule;                         // the rule in scope (resolved by caller via schoolId + gradeLevel)
}

export interface PromotionEvaluationOutput {
  enrollmentId: string;
  eligible: boolean;
  suggestedDecision: 'promoted' | 'retained' | 'graduated';
  retainedReasons: Array<'subject_failure' | 'attendance_failure' | 'subjects_required_missing' | 'no_terminal_card'>;
  details: {
    overallPassedSubjects: number;
    overallFailedSubjects: number;
    failedSubjectIds: string[];                // courseIds where any card has isPassing=false
    attendancePct: number;
    passingThresholdPct: number;
    minAttendancePct: number;
  };
}

export function evaluatePromotion(input: PromotionEvaluationInput): PromotionEvaluationOutput;
```

**Logic:**
- If `resultCards.length === 0`: eligible=false, retainedReasons=['no_terminal_card'], suggestedDecision='retained' (operator sees as "needs review")
- Compute overall avg score across cards (weighted by maxMarks)
- Check `subjectsRequired`: if non-empty, every required subject's card row must `isPassing === true`; missing required subject → retainedReasons add 'subjects_required_missing'
- Subject-pass: if ANY courseScores[].isPassing === false in any card, retainedReasons += 'subject_failure'
- Attendance: if `attendancePct < rule.minAttendancePct`, retainedReasons += 'attendance_failure'
- If all clean → eligible=true, suggestedDecision='promoted'
- Special-case: rule.gradeLevel === final-grade-of-archetype (PABSON: '10', '12'): suggestedDecision='graduated' instead of 'promoted' on eligible=true. (Final-grade lookup via archetype defaults; see §8 #5 for what reads this)

**Validation:**
- Unit table-driven: ≥30 assertions covering every combination of pass/fail per branch
- All-pass + ≥minAttendance → eligible + 'promoted'
- One subject fail → retained + 'subject_failure'
- Below attendance threshold → retained + 'attendance_failure'
- Missing required subject → retained + 'subjects_required_missing'
- Multiple reasons stacked → all surface in retainedReasons[]
- No cards → retained + 'no_terminal_card'
- Final-grade boundary → 'graduated' on success
- **Explicit archetype-grep assertion:** `grep -rn 'archetype' microservices/academics/src/promotion/` returns zero hits (the only allowed grep hit is `archetypeId` field reference, which is data not branching)
- Pure-function assertion: spec asserts NO DDB SDK imports in `promotion-evaluator.service.ts`
- Property test: monotonic attendancePct → monotonic eligibility (same input rule + cards)

**AC:**
- Pure function; zero side-effects; zero DDB reads
- Archetype-grep clean (no implicit branching)
- Returns suggestedDecision matching master-plan field types

**Deps:** D.2.1.

### D.2.5 — Batch promotion-evaluation endpoint

**Files:** Phase 3.
- NEW `microservices/academics/src/promotion/promotion-batch.controller.ts`
- NEW `microservices/academics/src/promotion/promotion-batch.service.ts` + `.spec.ts`
- MODIFIED `tenant-api-prod.json` (1 new path)

**Endpoint:**
- `POST /academics/schools/{schoolId}/academic-years/{fromAyId}/promote-from?targetAyId={targetAyId}&gradeLevel={gradeLevel}` — request body optional (`{ enrollmentIds?: string[] }` to restrict scope; absent = all enrolments in the AY+gradeLevel)

**Flow:**
1. Authorize: caller has school-admin role on schoolId (existing JWT auth + role check)
2. Validate: fromAyId ≠ targetAyId; both exist via identity cross-service call (or DDB direct read on identity table — see §8 #3)
3. List Enrollments by GSI1 (school-scope) with `begins_with(ENROLLMENT#{fromAyId}#{gradeLevel})` — paginated
4. For each enrollment:
   - Resolve active PromotionRule via PromotionRulesService (lazy-seed if absent — D.2.3)
   - Query terminal ResultCards by GSI2 enrollment-centric with `isTerminalExam: true` filter (or AY filter on gsi2sk)
   - Compute attendancePct (call existing Attendance service — see §8 #6 for the integration)
   - Invoke `evaluatePromotion()` → output
5. Aggregate outputs into response array
6. Audit row: `promotion.evaluated` with `{ fromAyId, targetAyId, gradeLevel, evaluatedCount, suggestionsByDecision: {promoted: 9, retained: 1, graduated: 0} }`
7. Emit `promotion.batch_evaluated` event

**Response shape:**
```typescript
{
  fromAyId: string;
  targetAyId: string;
  gradeLevel: string;
  evaluatedCount: number;
  results: PromotionEvaluationOutput[];        // one per enrolled student
  pagination?: { nextCursor?: string };        // optional pagination if >500 enrolments (defensive cap; PABSON sections ~30-40)
}
```

**Validation:**
- Integration on `dev-pabson-primary` (Phase 4 smoke fully validates)
- Unit: service returns deterministic output given mocked DDB reads + fixture cards
- 404 if fromAyId or targetAyId not found
- 400 if same AY (`fromAyId === targetAyId`)
- 403 if non-school-admin role
- Read-only: NO Enrollment writes, NO PromotionRule mutations

**AC:**
- Suggests but doesn't commit (operator review before D.2.6)
- Idempotent: re-call returns same suggestions (modulo attendance recompute)
- Audit row + event

**Deps:** D.2.4 + A.4.2 ✅ (ResultCard) + existing Attendance service.

### D.2.6 — Cross-year promotion commit (chunked)

**Files:** Phase 3.
- NEW `microservices/academics/src/promotion/promotion-commit.service.ts` + `.spec.ts`
- Endpoint added to `promotion-batch.controller.ts`
- MODIFIED `tenant-api-prod.json` (1 new path)

**Endpoint:**
- `POST /academics/schools/{schoolId}/academic-years/{fromAyId}/promote-from/{targetAyId}/commit` with body:
```typescript
{
  decisions: Array<{
    enrollmentId: string;
    decision: 'promoted' | 'retained' | 'conditional' | 'graduated' | 'withdrawn' | 'transferred_out';
    targetGradeLevel?: string;                  // required for 'promoted' + 'conditional'; absent for others
    correlationId?: string;                     // operator-supplied idempotency key
  }>;
}
```

**Flow (chunked at 100 per TransactWriteItems — DDB hard limit):**
1. Authorize + validate (same as D.2.5)
2. Idempotency dedupe: dedupe by `correlationId` if supplied; reject duplicate within request
3. Chunk decisions[] at 100
4. For each chunk: build TransactWriteItem list:
   - **Update existing AY1 Enrollment**: `set promotionDecision = :decision` with condition `attribute_not_exists(promotionDecision)` → write-once enforcement
   - **Put new AY2 provisional Enrollment** (only for `promoted` + `conditional` decisions): new enrollmentId, status='provisional', `priorEnrollmentId: ay1EnrollmentId`, gradeLevel=targetGradeLevel, GSI keys including new GSI4
   - For `retained`: NO new enrollment row created (operator may manually retain via existing flow or use the timeline to add a new AY2 enrollment with same gradeLevel as AY1)
   - For `graduated`: NO new enrollment + AY1 status transitions to `graduated` via state machine
   - For `withdrawn` / `transferred_out`: AY1 status transitions via state machine
5. Execute TransactWriteItems per chunk; on `TransactionCanceledException` parse per-op cancellation reasons and surface in 409 response detail
6. Per-chunk audit row + `enrollment.promoted` event with chunk metadata
7. Aggregate response: `{ committedCount, chunksTotal, chunksSucceeded, failures?: [...] }`

**Validation:**
- Integration: 200 students promoted in 2 chunks (100+100) → both chunks succeed atomically
- Force-failure chunk via duplicate enrollmentId → 409 with parsed per-op detail; OTHER chunks proceed (per-chunk atomicity, not per-request atomicity)
- Idempotency: replay with same correlationId → no-op; replay without correlationId + same decisions → 409 PROMOTION_DECISION_LOCKED on already-committed rows
- AY1 enrollment.promotionDecision is write-once: second PATCH → 409

**AC:**
- Atomic per chunk
- Idempotent on correlationId; otherwise 409 on already-decided rows
- One audit row + `enrollment.promoted` event per chunk (not per row — keeps event volume sane)

**Deps:** D.2.5 + D.2.7 + D.2.8.

### D.2.7 — `Enrollment.priorEnrollmentId` + `promotionDecision` write-once

**Files:** Phase 1 (schema) + Phase 2 (entity + state machine + mapper) + Phase 3 (GSI4).
- MODIFIED `packages/shared-types/src/schemas/academics/enrollment.schema.ts` — add fields
- MODIFIED `microservices/academics/src/common/entities/enrollment.entity.ts` — add fields + GSI4
- MODIFIED `microservices/academics/src/common/mappers/enrollment.mapper.ts` — round-trip
- MODIFIED `server/lib/tenant-template/ecs-dynamodb.ts` — declare GSI4 on academics table

**Fields:**
```typescript
// Add to Enrollment interface:
priorEnrollmentId?: string;                                    // FK to source-AY enrollment
promotionDecision?:                                            // write-once via condition expression
  'promoted' | 'retained' | 'conditional' | 'graduated' | 'withdrawn' | 'transferred_out';

// GSI4 — priorEnrollmentId-centric:
gsi4pk: string;                                                // 'prior-enrollment#{priorEnrollmentId}' OR undefined for rows without priorEnrollmentId
gsi4sk: string;                                                // 'ENROLLMENT#{academicYearId}'
```

**Why GSI4:** D.2.10 must efficiently look up "all rows whose `priorEnrollmentId === X`" to flip them on `result.published` of X's terminal exam. Without GSI4, scan is needed (cost + latency unbounded).

**Validation:**
- Schema unit: round-trip both fields
- Entity unit: factory produces GSI4 keys only when priorEnrollmentId set; undefined gsi4pk omitted from item per DDB sparse-index pattern
- Integration: second PATCH of `promotionDecision` → 409 `PROMOTION_DECISION_LOCKED`
- DDB-level: condition expression `attribute_not_exists(promotionDecision)` fires correctly

**AC:**
- Fields on enrollment; write-once enforced at DDB layer (not service layer)
- GSI4 declared in CDK + tested via Phase 3 deploy validation

**Deps:** 0.4.1 (no schema dep).

### D.2.8 — `provisional` EnrollmentStatus + state-machine extension

**Files:** Phase 2.
- MODIFIED `microservices/academics/src/common/entities/base.entity.ts` — extend `EnrollmentStatus` enum to include `'provisional'`
- MODIFIED `microservices/academics/src/common/utils/enrollment-state-machine.ts` — add `provisional: new Set(['enrolled', 'withdrawn'])` to VALID_TRANSITIONS
- MODIFIED `microservices/academics/src/common/utils/enrollment-state-machine.spec.ts` — 100% transition coverage

**Transition rules:**
```typescript
// New row in VALID_TRANSITIONS:
provisional: new Set(['enrolled', 'withdrawn']),

// Existing rows do NOT add `provisional` as a target — `enrolled → provisional` is REJECTED.
// `pending → provisional` is ALSO rejected — provisional is created directly via D.2.6 commit, not transitioned to from pending.
```

**Validation spec:**
- Asserts `isValidTransition('provisional', 'enrolled')` → true
- Asserts `isValidTransition('provisional', 'withdrawn')` → true
- Asserts `isValidTransition('provisional', 'transferred')` → false (provisional rows are pre-flip; transfers go via D.2.6 'transferred_out' decision)
- Asserts `isValidTransition('enrolled', 'provisional')` → false
- Asserts `isValidTransition('pending', 'provisional')` → false
- Asserts `isValidTransition('withdrawn', 'provisional')` → false
- Asserts allowed-transitions list for `'provisional'` returns exactly `['enrolled', 'withdrawn']`

**AC:**
- 100% transition coverage (every (from, to) pair tested for valid/invalid)
- Rejection list explicit + documented in state-machine source

**Deps:** D.2.7.

### D.2.9 — Result-publish handler (in-process NestJS @OnEvent)

**Files:** Phase 3.
- NEW `microservices/academics/src/enrollment/enrollment-transition-handler.service.ts` + `.spec.ts`

**Pattern: in-process NestJS `@OnEvent('result.published')` via NestJS's `EventEmitter` module (not EventBridge cross-process).** See §8 #4 for V1 vs V1.5 trade-offs.

**Handler:**
```typescript
@Injectable()
export class EnrollmentTransitionHandler {
  constructor(
    private readonly enrollmentService: EnrollmentService,
    private readonly enrollmentFlipService: EnrollmentFlipService,    // D.2.10
    private readonly logger: Logger,
  ) {}

  @OnEvent('result.published')
  async handleResultPublished(event: ResultPublishedEvent): Promise<void> {
    if (!event.isTerminal) {
      // Non-terminal publishes don't trigger flip (Term-1/Term-2 publishes are no-ops for promotion)
      return;
    }

    // Query for provisional next-AY enrollment via GSI4
    // (priorEnrollmentId-centric lookup; sparse index, only flips rows that ARE provisional)
    const provisionals = await this.enrollmentService.findProvisionalsByPriorEnrollmentId(event.enrollmentId);

    if (provisionals.length === 0) {
      this.logger.warn(`No provisional enrollments for prior enrollmentId=${event.enrollmentId}; result.published is a no-op`);
      return;
    }

    // Idempotency: D.2.10 internally uses attribute_not_exists guards;
    // a re-fired handler on already-flipped rows is a no-op.
    await this.enrollmentFlipService.promoteProvisionalToEnrolled(
      provisionals.map(p => p.enrollmentId),
      { tenantId: event.tenantId, userId: 'system:enrollment-transition-handler', source: 'result.published' },
    );
  }
}
```

**Why in-process NestJS @OnEvent (vs EventBridge-Lambda mirroring A.4.3):**
- Both publisher (A.4.5 ResultCardsService.publish) and subscriber (D.2.9) live in the same NestJS service (academics). In-process EventEmitter avoids deploy-time coupling to a separate Lambda.
- Lower operational surface (no new Lambda, no new EventBridge rule, no new DLQ — same Nest task definition handles both).
- Same NestJS process → transactional context can be inspected (Nest's RequestContext available if extracted from `event.context`).
- Cross-service decoupling (academics-publish → other-service-consume) is a V1.5 concern; in V1 only academics consumes `result.published`.
- **Trade-off:** if the academics task crashes between event emit and handler execution, the flip is lost. Mitigation: handler is idempotent + Phase 4 smoke explicitly probes idempotency. V1.5 EventBridge-Lambda removes the in-process coupling.

**Validation:**
- Unit: handler subscribes to `result.published`; idempotent on re-delivery (mock provisional rows; D.2.10 receives correct IDs; second invocation on same event is no-op via D.2.10 guards)
- Integration: A.4.5 publish → in-process event → handler invoked; assert via test-only spy on `publishResultPublished` + `EventEmitter` listeners
- Negative: `isTerminal: false` → handler returns early, no D.2.10 call

**AC:**
- Handler fires on `result.published` with `isTerminal: true`; ignores non-terminal events
- Idempotent on re-delivery
- Logged as `system:enrollment-transition-handler` source on D.2.10 audit rows

**Deps:** D.2.8 + A.4.5 ✅.

### D.2.10 — Atomic provisional→final flip (chunked)

**Files:** Phase 3.
- NEW `microservices/academics/src/enrollment/enrollment-flip.service.ts` + `.spec.ts`

**Function signature:**
```typescript
promoteProvisionalToEnrolled(
  provisionalEnrollmentIds: string[],
  context: { tenantId: string; userId: string; source: string },
): Promise<{ flipped: number; skipped: number; failures: Array<{enrollmentId, reason}> }>;
```

**Flow (chunked at 100 per TransactWriteItems):**
1. For each chunk of 100 enrollmentIds:
   - Build TransactWriteItems with Update operations:
     - `set status = 'enrolled'`, `set updatedAt = now()`, `set updatedBy = context.userId`
     - condition: `status = 'provisional'` AND `attribute_exists(priorEnrollmentId)` — idempotent (already-enrolled rows are skipped, not failed)
   - Execute TransactWriteItems
   - Parse `TransactionCanceledException` per-op reasons: `ConditionalCheckFailed` is a "skip" (idempotent re-flip), other reasons are "failures"
2. Aggregate { flipped, skipped, failures } across chunks
3. Per-chunk audit row + `enrollment.flipped` event
4. Return result

**Invariant 3 guard:**
- `enrollmentId` is NEVER mutated by the flip — only `status` changes
- `gradeLevel` is NEVER mutated by the flip — provisional rows already carry the target gradeLevel from D.2.6
- Existing ResultCard / Attendance / ExamScore rows under this enrollmentId remain untouched (they were prior-AY rows; the flip applies to the NEW provisional row, not the prior one)
- For the retained-cohort case: NO flip happens (no provisional row was created); the prior-AY enrollment retains gradeLevel + status='enrolled' (or whatever its current state); attendance under the prior-AY enrollmentId remains intact

**Validation:**
- Integration: 10 provisional rows + handler invocation → 9 flip to enrolled, 1 was never created (retained)
- Attendance preservation: query Attendance rows by `gsi2pk = enrollmentId-of-retained-student` → all rows intact (R-D2.1 + invariant-3 explicit spec)
- Idempotency: re-call same enrollmentIds → second call returns skipped=N, flipped=0
- Cross-chunk failure: force one Update to fail conditionally; assert that chunk rolls back but other chunks proceed; failures array surfaces the canceled enrollmentId

**AC:**
- Atomic per chunk; failure rolls back chunk
- Audit + event per chunk (not per row)
- Idempotent on retry (ConditionalCheckFailed = skip, not error)
- Invariant 3 guard: spec asserts attendance under retained-student enrollmentId still has prior-AY rows accessible

**Deps:** D.2.9.

### D.2.11 — Cross-AY `GET /students/:id/timeline` endpoint

**Files:** Phase 3.
- NEW `microservices/academics/src/students/student-timeline.controller.ts` + `.spec.ts`
- NEW `microservices/academics/src/students/student-timeline.service.ts` + `.spec.ts`
- MODIFIED `tenant-api-prod.json` (1 new path)

**Endpoint:**
- `GET /academics/students/{studentId}/timeline?fromAyId=…&toAyId=…&cursor=…&limit=…` — all params optional; default: all AYs ascending; default limit 50

**Implementation:**
- Query Enrollment GSI2 (studentId-centric) with `begins_with(ENROLLMENT#)` — paginated
- Sort by academicYearId ascending (lexicographic on AY ID — V1 assumes AY IDs are time-sortable; if not, dual-pass: collect AY IDs, fetch each from identity service, sort by year-start date)
- Return array with full Enrollment shape + denormalized AY context (yearLabel, startDate, endDate from identity)
- Every row carries its own `enrollmentId` (invariant 3 guard — explicit assertion in spec)
- `priorEnrollmentId` filled where set; chain can be reconstructed by client
- Cursor pagination per existing convention

**Response shape:**
```typescript
{
  studentId: string;
  enrollments: Array<{
    enrollmentId: string;
    academicYearId: string;
    academicYear: { yearId, label, startDate, endDate };       // denormalized from identity
    gradeLevel: string;
    status: EnrollmentStatus;
    priorEnrollmentId?: string;
    promotionDecision?: PromotionDecision;
    entryDate: string;
    exitWithdrawDate?: string;
    schoolId: string;
  }>;
  pagination?: { nextCursor?: string };
}
```

**Validation:**
- Integration across two AYs on `dev-pabson-primary`: GET timeline returns 2 enrollments (AY1 + AY2 with priorEnrollmentId chain)
- Every row carries `enrollmentId` (invariant 3 spec assertion: `assert(every row has enrollmentId)`)
- Cursor pagination works for >50 rows (synthetic 200-AY test fixture)
- 404 on missing studentId
- Empty array for student with no enrollments

**AC:**
- Returns full chain sorted ascending
- Route registered per §1.5 three-way handoff
- Cross-link for D.7 StudentAcademicTrack: D.7 will denormalize this data; D.2.11 is the runtime source

**Deps:** D.2.7.

### D.2.12 — Parametric cross-year smoke

**Files:** Phase 4.
- NEW `scripts/smoke-tests/pilot-cross-year-handoff.ts`

**Behavior:** see §3 Phase 4 above (15 checkpoints).

**AC:**
- Smoke on `dev-pabson-primary` exits 0
- Smoke on Saraswati prod: SKIPPED (no published terminal exam yet; operator-led when ready)
- Full lifecycle: AY1+AY2 → batch eval → commit → terminal publish → flip → timeline → idempotency probe → write-once probe
- Invariant 3 explicit: attendance under retained-student enrollmentId surfaces correctly post-flip
- Cleanup verified or documented (operator may keep AY2 fixture for D.3 / D.4 work)

**Deps:** D.2.6 + D.2.10 + D.2.11.

---

## 5. Risks & mitigations (sprint-level)

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-D2.1 | **Invariant 3 violation in D.2.10:** flip rewrites `enrollmentId` or `gradeLevel` on the prior-AY row → attendance/ExamScore/ResultCard rows orphaned | L (mitigated) | **CRITICAL** | D.2.10 only writes status='enrolled' on the NEW provisional row; NEVER touches the prior-AY enrollmentId. Explicit spec in D.2.10.spec.ts. R29 (master plan §11.2) is closely related — H.1 evidence sprint also validates |
| R-D2.2 | Shared-types caret-pin trap (R39): server/* package.json pins not bumped same PR; Docker builds fail TS2305 | M | H | Bump `server/application/package.json` + `server/package.json` pins in Phase 1 PR SAME commit. Refresh root `package-lock.json` (same pattern as A.2 + A.3 + A.4 Phase 1) |
| R-D2.3 | **New modules not registered → Nest bootstrap crash post-deploy** (academics outage; [[feedback-module-wiring-invariant]] — this trap has hit prod 4 times now: PR #59, #120/#121, A.4 PR #161, hypothetically D.2 if we don't ship the wiring spec) | M | H | **Mandatory:** Phase 2 PR extends `academics/__tests__/module-wiring.spec.ts` (added during A.4 hotfix #163) to register `PromotionRulesModule` + `PromotionModule` + new `EnrollmentTransitionHandler` provider IN THE SAME PR. Post-deploy ECS log inspection mandatory (Nest "dependencies initialized" lines for every new module) |
| R-D2.4 | DDB GSI4 addition on Enrollment is non-disruptive in CDK BUT the existing 1500+ rows in `dev-pabson-primary` won't have gsi4pk/sk until lazy-fill on next write → D.2.10 lookup by GSI4 returns empty for legacy rows during transition window | L | M | GSI4 is SPARSE (only set when priorEnrollmentId is set, i.e., only on NEW provisional rows from D.2.6 onward) → legacy rows are correctly invisible to GSI4. No backfill needed. Document in PR description. **§8 #1 open decision** validates this |
| R-D2.5 | EventEmitter @OnEvent ordering: A.4.5 publish path emits result.published BEFORE the DDB write commits → handler reads stale state | L | M | A.4.5's publish is sequential: DDB write THEN event emit (verified in [`result-cards.service.ts`](../../server/application/microservices/academics/src/results/result-cards.service.ts)). D.2.9 handler reads via GSI4 on the NEW provisional row written by D.2.6 — independent of the just-published ResultCard. No race possible |
| R-D2.6 | NestJS @OnEvent silently dropped if no EventEmitterModule registered → handler never fires | M | H | Phase 3 PR includes `EventEmitterModule.forRoot()` in `academics.module.ts` IF not already present; module-wiring spec asserts `EnrollmentTransitionHandler` provider is registered + has `@OnEvent` decorator |
| R-D2.7 | Cross-service AY lookup in D.2.5: academics needs to verify (fromAyId, targetAyId) exist in identity; bare HTTP call introduces inter-service latency + failure-mode coupling | M | M | §8 #3 open decision. Recommended path: DDB direct read on identity table via `TenantMetadataReader` pattern (already used for tenant.archetype lookup) — same DB, same IAM. Avoids HTTP coupling |
| R-D2.8 | D.2.6 commit produces orphan provisional row if AY1 PATCH succeeds but AY2 Put fails | L (mitigated) | M | TransactWriteItems atomicity per chunk — either both ops succeed or both fail. CDK + DDB enforce; spec covers via forced-failure test |
| R-D2.9 | A.4 result-batch Lambda's V1 `isTerminal` simplification (`Exam.examType === 'final'` only) misses non-PABSON archetype final exams → terminal trigger never fires for V1.5 archetypes | L (V1) | L (V1) | V1 only PABSON in prod; `final` is correct terminal marker per archetype defaults. A.4 handler.ts:20 documents the V1.5 fix path. D.2 inherits this limitation but doesn't worsen it |
| R-D2.10 | Smoke checkpoint #10 (attendance preservation) requires Attendance rows under the retained-student's prior-AY enrollmentId to exist; if `dev-pabson-primary` has no attendance for the fixture cohort, the assertion is vacuous | M | M | Pre-smoke seed: create ≥1 Attendance row per fixture enrollment IF none exist (per Phase 4 smoke setup). Document as fixture pre-condition in script header |
| R-D2.11 | D.2.6 commit response `failures` array is parsed from `TransactionCanceledException.CancellationReasons` — boto/SDK quirk: order may not match input order on some SDK versions | L | L | Spec verifies SDK version 3.x preserves order; document in service docstring. If future SDK breaks, fallback to enrollmentId-keyed reasons map |
| R-D2.12 | Cross-stack export change pre-flight (R41 lesson): Phase 2 + Phase 3 both touch tenant-api-prod.json → shared-infra-stack deploys → potential Output churn on TenantApiAuthorizerArn / RestApiId / RootResourceId | L (mitigated) | M | Per CLAUDE.md cross-stack export pre-flight rule. Path-only additions to API GW spec don't churn the 3 importers' Output VALUES (those track RestApi.restApiId which doesn't change on path adds). Verify via `aws cloudformation list-exports` snapshot before each deploy |
| R-D2.13 | D.2.11 timeline cursor pagination: legacy Enrollment GSI2SK uses `ENROLLMENT#{yearId}` — sort by gsi2sk doesn't guarantee year-start-date order if AY IDs are random UUIDs | L | L | V1: AY IDs in `dev-pabson-primary` are time-sortable per Saraswati activation logs. Document assumption. If pilot tenant uses non-time-sortable IDs, fall back to denormalize startDate into Enrollment row (V1.5) |
| R-D2.14 | Operator confusion: PromotionRule auto-seeded on first GET vs operator-created; archetypeDefaulted flag UI distinction not yet shipped (frontend out-of-scope) | M | L | D.2.3 lazy-seed sets `archetypeDefaulted: true`; D.2.2 PATCH clears it. API response surfaces flag; operator-onboarding briefing will explain. Frontend MFE follow-up renders the badge |
| R-D2.15 | D.2.5 batch eval with very large cohort (>500) hits API GW 30s timeout if attendance recompute is slow | L | M | Phase 4 smoke target ~10 enrollments; defensive pagination cap at 500 per request (§4 D.2.5 response shape). Larger cohorts: operator splits by gradeLevel or section. V1.5 async via Lambda if needed |
| R-D2.16 | `as any` cast smell: cross-service Enrollment-Identity AY lookup tempts a cast | L | L | Reject at PR review per [[feedback-module-wiring-invariant]] L3. Either declare a TenantMetadataReader extension method `getAcademicYear(ayId)` with proper return type, or surface the typed shape from identity via shared-types |
| R-D2.17 | "Test fixture leak" — D.2.12 smoke creates synthetic AY2 + provisional enrollments in `dev-pabson-primary`; if not cleaned, leaves stale data that bleeds into D.3+ smokes | L | L | Smoke script asks user (interactive prompt or env-var DRY_RUN=true) whether to retain or clean. Master cleanup script `scripts/cleanup-orphans/orphan-cross-year-fixtures.ts` follow-up if needed |

---

## 6. Invariant gate (per `v1-master-epic-breakdown.md` §1.4)

| Invariant | D.2 disposition |
|---|---|
| Audit + event paired (Sprint 0.2.7 lint) | YES — `publishPromotionRuleCreated`, `publishPromotionRuleUpdated`, `publishEnrollmentPromotionDecided`, `publishEnrollmentFlipped`, `publishPromotionBatchEvaluated` all paired with audit rows. Sprint 0.3 will port to formal auditedWrite |
| Three-way route handoff | YES — Nest controllers + `tenant-api-prod.json` paths added (3 in Phase 2, 3 in Phase 3); nginx NOT changed (all routes under existing `^/academics` prefix). Route-drift lint enforces |
| Shared-types changed → minor bump + npm publish + AdminWeb jsdom sim | YES — Phase 1 follows CLAUDE.md per-sprint publish checklist end-to-end. Pre-merge grep `client/AdminWeb/src/` for `PromotionRule\|promotionDecision\|priorEnrollmentId\|promote-from`; controlplane redeploy OPTIONAL if zero hits |
| New NestJS module → module-wiring.spec.ts SAME PR | YES — academics now HAS a wiring spec (added during A.4 hotfix PR #163). Phase 2 + Phase 3 BOTH extend the spec to register new modules. **This closes the loop on [[feedback-module-wiring-invariant]] — D.2 is the first sprint where the rule is enforced from PR-1 not PR-N+hotfix** |
| New GSI → gsi-inventory.md BEFORE CDK deploy | YES — Enrollment GSI4 + PromotionRule GSI1 documented in Phase 3 PR; gsi-inventory.md updated atomically with `ecs-dynamodb.ts` change |
| Invariant 13 (no pilot names in code) | D.2.12 smoke accepts `PILOT_ID` env; defaults to `dev-pabson-primary` (the smoke fixture tenant, not a real pilot). Service code archetype-blind. No `pabson` or `saraswati` literals in `src/` |
| Invariant 12 (no implicit archetype branching) | D.2.4 evaluator reads from `PromotionRule` (per-tenant entity), not `tenant.archetype`. D.2.3 seed path uses explicit `getArchetypeDefaults()` lookup (allowed per A.3 §17.8 L5). archetype-grep clean in `promotion/` and `promotion-rules/` src |
| Invariant 3 (cross-AY identity via enrollmentId) | **PRIMARY INVARIANT THIS SPRINT.** D.2.7 adds priorEnrollmentId WITHOUT replacing enrollmentId as key. D.2.10 spec explicitly asserts attendance preservation under retained-student enrollmentId. D.2.11 timeline returns every row's own enrollmentId. R-D2.1 mitigation triple-binds the guard |
| `as any` cast smell | None expected. Cross-service AY lookup is typed via shared-types + TenantMetadataReader extension method (§8 #3) |
| New EventBridge rule + DLQ + alarm | N/A — D.2.9 uses in-process NestJS @OnEvent, not EventBridge (§8 #4). No new infra primitive |
| Lambda cold-start budgeted | N/A — D.2 ships no Lambdas |
| CFN headroom (R41) | YES — post-D.2 projected ~15% of 1MB ceiling (60KB + ~30KB for 6 new paths); well within. Cross-stack export pre-flight required for the 2 shared-infra-stack deploys (per CLAUDE.md rule) |

---

## 7. Deploy ladder (per CLAUDE.md + memory `feedback_pr_first_no_more_uat`)

```
Phase 1 PR (shared-types schemas + Enrollment field schemas + caret-pin bumps)
  ├── (CI green: typecheck, lint, jest schema specs, AdminWeb build)
  ├── (Reviewer approval — Shoaib)
  ├── npm publish @aibrains/shared-types@0.59.0
  ├── npm view @aibrains/shared-types version  (verify; 30s propagation)
  ├── npm install (root, refresh lockfile)
  ├── Local AdminWeb rebuild + jsdom sim  ← BLOCKING if fails
  ├── Pre-merge grep client/AdminWeb/src/ for PromotionRule|priorEnrollmentId|promote-from
  ├── Merge PR to main
  └── controlplane-stack redeploy (CONDITIONAL — only if AdminWeb consumes new types; expected: skip)

Phase 2 PR (PromotionRule entity + CRUD + seed + evaluator + Enrollment field migrations + state machine + module-wiring spec)
  ├── (CI green; nest build academics; jest D.2.1/2/3/4/7/8 specs; module-wiring.spec.ts passes)
  ├── (Reviewer approval — final review per memory `feedback_consult_before_code_changes`)
  ├── Merge PR to main
  ├── Cross-stack export pre-flight snapshot:
  │     aws cloudformation list-exports --query "Exports[?contains(ExportingStackId, 'shared-infra-stack')]" → snapshot-before.json
  ├── cdk diff shared-infra-stack (2 new API GW paths) → tee'd
  ├── (Reviewer approval — diff matches expectation; no Output value changes for the 3 importers)
  ├── cdk deploy shared-infra-stack  ← MANDATORY per A.3 L1 lesson
  ├── Re-snapshot exports; diff vs before → confirm Output values byte-identical for importers
  ├── scripts/build-application.sh academics (tee'd)
  ├── aws ecs update-service --force-new-deployment academicsbasic (ap-south-1)
  ├── Wait for services-stable
  ├── ECS log sanity (R-D2.3): all 3 lines must appear in CloudWatch Logs for academics service:
  │     - "PromotionRulesModule dependencies initialized"
  │     - "PromotionModule dependencies initialized"
  │     - Nest bootstrap success (no "MODULE_NOT_FOUND" / "Cannot find injectable")
  └── Skip smoke until Phase 4

Phase 3 PR (batch eval + commit + transition-handler + atomic flip + timeline + GSI4 + EventEmitter wiring)
  ├── (CI green; cdk synth tenant-template-stack-basic; jest D.2.5/6/9/10/11 specs + cross-year regression spec)
  ├── (Reviewer approval)
  ├── Merge PR to main
  ├── cdk diff tenant-template-stack-basic (GSI4 add) → tee'd
  ├── (Reviewer approval — DDB index add only; no destructive changes; legacy rows lazy-fill)
  ├── Cross-stack export pre-flight for tenant-template-stack-basic (no exports today; verify still none)
  ├── cdk deploy tenant-template-stack-basic
  ├── cdk diff shared-infra-stack (3 new API GW paths) → tee'd
  ├── Cross-stack export pre-flight snapshot vs after
  ├── cdk deploy shared-infra-stack
  ├── scripts/build-application.sh academics (tee'd)
  ├── aws ecs update-service --force-new-deployment academicsbasic
  ├── Wait services-stable + post-deploy ECS log sanity:
  │     - "EnrollmentTransitionHandler" listed in module init
  │     - "EventEmitterModule" present in providers list
  └── Skip smoke until Phase 4

Phase 4 PR (parametric smoke + execution)
  ├── (CI green; script type-checks via tsc)
  ├── (Reviewer approval — script only)
  ├── Merge PR to main
  ├── Request fresh Cognito JWT → /tmp/dev-jwt.txt (Write tool, NOT heredoc)
  ├── Confirm dev-pabson-primary AY1 + AY2 + Terminal Exam + 10 ResultCards (or smoke creates synthetic AY2)
  ├── Pre-smoke seed: ≥1 Attendance row per fixture enrollment (R-D2.10 mitigation)
  ├── PILOT_ID=dev-pabson-primary npx ts-node scripts/smoke-tests/pilot-cross-year-handoff.ts --dry-run
  ├── (User reviews dry-run output)
  ├── PILOT_ID=dev-pabson-primary npx ts-node scripts/smoke-tests/pilot-cross-year-handoff.ts (full run)
  ├── tee log to ${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/dev-pabson-smoke-pilot-cross-year-handoff-<ts>-<sha>.log
  └── Verify cleanup + invariant 3 sanity (Attendance under retained enrollmentId still queryable)
```

**No UAT** per memory `feedback_pr_first_no_more_uat`. Per-step user-in-the-loop authorization via `AskUserQuestion` for CDK deploys + ECS roll + smoke execution.

**Cross-stack export pre-flight applies to BOTH shared-infra-stack deploys** per the R41-lesson CLAUDE.md rule.

---

## 8. Open decisions (need sign-off before branch cut)

1. **Enrollment GSI4 (priorEnrollmentId-centric) — sparse or not?**
   - **(a) Sparse** (recommended): only rows with priorEnrollmentId set carry gsi4pk/sk. Legacy rows (no priorEnrollmentId) absent from GSI4. D.2.10 lookup is correct (legacy rows have no provisional state).
   - **(b) Non-sparse**: every row carries gsi4pk='NULL' or similar marker. Wastes index space; no real benefit since legacy rows are never queried by D.2.10.
   - *Recommendation: (a) sparse.*

2. **PromotionRule field `minAttendancePct` — where does the PABSON default value come from?**
   - The master plan (line 1209) says "passingPct=35, minAttendancePct=80 — confirmed by champion field visit." `passingThresholdPct: 35` is in `archetypeDefaults.boardExams[].passingThresholdPct`. **`minAttendancePct: 80` is NOT in current archetypeDefaults.**
   - **Options:**
     - **(a) Add `minAttendancePct: number` to `archetypeDefaults` schema + bump shared-types 0.59.0** — clean, lets D.2.3 read like every other default. *Recommended.*
     - **(b) Hardcode `80` in D.2.3 seed for PABSON case** — works but couples seed to literal value; violates invariant 12 spirit if `if archetype === 'PABSON' return 80`. Reject.
     - **(c) Make minAttendancePct null-default and require operator to set on first PATCH** — cleaner from "no implicit policy" angle but breaks lazy-seed UX (operator sees empty field on every first GET).
   - *Recommendation: (a) extend archetypeDefaults schema in Phase 1.*

3. **Cross-service AY lookup in D.2.5: HTTP vs DDB-direct?**
   - **(a) DDB direct read** on identity table via `TenantMetadataReader` extension method `getAcademicYear(tenantId, ayId)`. Pattern matches existing tenant.archetype lookup. Same IAM (already grants identity-table read). *Recommended.*
   - **(b) HTTP to identity service** via existing internal-service-call pattern. Adds latency + failure-mode coupling; benefit is "less direct DDB access from academics."
   - *Recommendation: (a) DDB direct read.*

4. **D.2.9 handler: in-process @OnEvent or EventBridge-Lambda?**
   - **(a) In-process NestJS @OnEvent** via `EventEmitterModule` (NestJS built-in). Lower op surface; both publisher (A.4.5) and subscriber live in same academics task. *Recommended for V1.*
   - **(b) EventBridge rule → Lambda → DDB write** mirroring A.4.3. Higher op surface (new Lambda, rule, DLQ, alarm); benefit is cross-service decoupling.
   - **(c) Both** — emit to EventBridge AND in-process. Redundant in V1.
   - *Recommendation: (a) for V1; (b) is V1.5 if cross-service decoupling becomes valuable.*

5. **`graduated` decision boundary — where does "final grade" come from?**
   - D.2.4 evaluator suggests `'graduated'` when student passes at the archetype's final grade (PABSON: '10' for SEE-graduation, '12' for NEB-graduation).
   - **Options:**
     - **(a) Read from `archetypeDefaults[archetype].boardExams` and treat the highest `grade` value as the graduation boundary** — works for PABSON (NEB_12 grade=12); also future-proof.
     - **(b) Hardcode in D.2.4** — violates invariant 12.
     - **(c) Add explicit `finalGrade: number` field to `archetypeDefaults`** — cleanest but adds another field.
   - *Recommendation: (a) — `Math.max(...boardExams.map(e => parseInt(e.grade))).toString()`.*

6. **D.2.5 attendance recompute: read existing aggregate or compute on-demand?**
   - D.2.5 needs `attendancePct` per enrollment in fromAyId. Options:
     - **(a) Read existing daily-rollup aggregate** (per fix T6 — Curriculum tab uses cached byGradeLevel from `home-stats` Lambda). Faster, possibly stale.
     - **(b) Compute on-demand by querying Attendance rows** — slower for large cohorts, fresher.
   - *Recommendation: (b) for V1.* Cohort size ≤500 per defensive cap; on-demand is correct (operator just published terminal results; should evaluate against the freshest attendance). Cache invalidation complexity not worth it in V1.

7. **D.2.6 commit behavior for `conditional` decision**
   - Master plan enum includes `conditional` (probationary promotion). What does the commit actually do?
     - **(a)** Create AY2 provisional Enrollment same as `promoted` BUT with `status='provisional'` permanently (operator manually flips after probation window). Same shape as `promoted`; differs only in metadata.
     - **(b)** Reject `conditional` in V1; operator must use `promoted` or `retained`. *Recommended.*
   - *Recommendation: (b) — accept the decision value (audit trail), but treat operationally identical to `promoted` for V1. V1.5 adds the probation-window state machine.*

8. **AdminWeb consumption check** — pre-Phase 1, grep `client/AdminWeb/src/` for D.2 types. Expected: zero hits (no promotion UI in V1). Controlplane redeploy OPTIONAL. *Recommendation: confirm + skip redeploy.*

9. **D.2.12 smoke target — dev-pabson-primary only?**
   - Saraswati has live AY but no published terminal exam in prod yet. D.2.12 needs an AY with published terminal results.
   - *Confirmed: smoke targets `dev-pabson-primary` (operator-led when Saraswati ready).*

10. **Phase count — 4 vs 3.** D.2 could merge Phase 3 into Phase 2 (entity + endpoints in one PR), but Phase 3 introduces in-process EventEmitter wiring that's worth isolating for deploy validation. *Recommendation: 4 phases.*

---

## 9. Definition of Done (Sprint D.2)

- [ ] All 12 tickets meet §1.1 per-ticket DoD (Files + Validation + AC + Deps + Risk)
- [ ] All 4 PRs merged to main
- [ ] Phase 1 deploy log: shared-types 0.59.0 npm publish evidence + lockfile refresh + optional controlplane redeploy log
- [ ] Phase 2 deploy logs: `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/prod-cdk-deploy-shared-infra-stack-<ts>-<sha>.log` + `prod-build-application-academics-<ts>-<sha>.log` + `prod-ecs-roll-academicsbasic-<ts>-<sha>.log` + cross-stack export pre-flight evidence
- [ ] Phase 3 deploy logs: `prod-cdk-diff-tenant-template-stack-basic-<ts>-<sha>.log` + `prod-cdk-deploy-tenant-template-stack-basic-<ts>-<sha>.log` + `prod-cdk-deploy-shared-infra-stack-<ts>-<sha>.log` + `prod-build-application-academics-<ts>-<sha>.log` + `prod-ecs-roll-academicsbasic-<ts>-<sha>.log` + cross-stack export pre-flight evidence (both deploys)
- [ ] Phase 4 smoke log: `dev-pabson-smoke-pilot-cross-year-handoff-<ts>-<sha>.log` with exit 0
- [ ] Phase 2 + Phase 3 post-deploy ECS log sanity captured: all new modules listed in Nest bootstrap output (R-D2.3 + R-D2.6 mitigation)
- [ ] **academics module-wiring spec extended IN-PR (not post-incident) — first sprint where this happens cleanly per [[feedback-module-wiring-invariant]]**
- [ ] Cross-year regression spec (D.2 Phase 2) passes — invariant 3 explicit guard
- [ ] Phase 4 R-D2.1 sanity: attendance under retained-student enrollmentId still queryable post-flip
- [ ] Closeout entry added to `docs/pilot-greenlight/sprint-closeouts.md`
- [ ] Status table in `v1-master-epic-breakdown.md` §0.4 updated: `D.2 🟢 shipped <date>` + PRs/logs
- [ ] §11.2 R29 (cross-year handoff attendance preservation) marked mitigated post-Phase-4
- [ ] Memory written: `project_sprint_d2_shipped_prod.md`
- [ ] Risk register §11.2 updated if new R-D2.* surface in implementation
- [ ] `docs/pilot-greenlight/gsi-inventory.md` updated with Enrollment GSI4 + PromotionRule GSI1
- [ ] No regressions in A.2 / A.3 / A.4 / D.1 / E.0 / E.1 / 0.4 smokes (regression bundle re-run pre-merge of Phase 3)

---

## 10. What this plan deliberately does NOT include

- Frontend PromotionRule UI — saas-frontend academics MFE follow-up
- Frontend cross-year timeline UI — same
- D.3 RubricCategory binding to PromotionRule — D.3 sprint scope (entity FK ships ready)
- D.7 StudentAcademicTrack updated by promotion commit — D.7 sprint scope (subscribes to `enrollment.promoted` event)
- Re-evaluation on score correction post-publish — V1.5 (requires un-publish flow which is V1.5 too)
- Multi-target-AY promotion (grade-skip) — V1.5
- Conditional/probation promotion workflow automation — V1.5 (V1 accepts the decision value for audit but treats as `promoted` operationally; §8 #7)
- Bulk PromotionRule template library — V1.5
- Re-aggregation of attendance at promotion time — V1 reads fresh per-call
- Cross-school promotion (transfer-out → another school's enrollment) — existing Enrollment.status='transferred' flow
- `auditedWrite()` migration across promotion endpoints — Sprint 0.3 scope
- EventBridge-Lambda implementation of D.2.9 — V1.5 (§8 #4)
- ResultCard un-publish flow that re-runs D.2 — V1.5
- D.2.10 SNS-page alarm on flip failure — V1.5 (tenant-template-stack lacks operator-alert SNS topic until V1.5 wires the cross-stack import)
- ECS task autoscaling on D.2.5 batch eval load — V1 cohorts ≤500; defensive cap

---

## Sign-off requested

Open decisions in §8 above are the gates. Once signed off:
1. Cut feature branch `sprint/d2-phase-1-shared-types` on server repo (and `sprint/d2-phase-1-shared-types` on frontend if any AdminWeb consumption surfaces — expected: not needed).
2. Per memory `feedback_explicit_cd_per_git`: every git op starts with explicit `cd <repo-root>` in the same invocation.
3. Begin Phase 1 implementation.

**Cross-references at branch-cut time:**
- A.4 shipped 🟢 (memory `project_sprint_a4_shipped_prod` at line 122 of MEMORY.md)
- D.1 shipped 🟢 (memory `project_sprint_d1_shipped_prod`)
- R41.A shipped 🟢 (memory `project_sprint_r41a_shipped_prod`) — CFN headroom + cross-stack export pre-flight rule applies
- Master plan §3 Sprint D.2 (lines 1191–1266) — canonical ticket list
- Companion plans: `a4-sprint-plan.md`, `a3-sprint-plan.md`, `a2-sprint-plan.md`
