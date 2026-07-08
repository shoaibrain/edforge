# Sprint A.4 Phase 3 — Result-Batch Lambda + EventBridge: Focused Plan

> **Drafted:** 2026-05-23 (post Phase 1+2 ship + #163 hotfix + #164 docs closeout)
> **Status:** 🟡 Draft — awaiting sign-off before branch cut
> **Parent plan:** [`a4-sprint-plan.md`](./a4-sprint-plan.md) §3 Phase 3 + §4 A.4.3
> **Companion precedents:** A.3 Phase 2 (academics ECR + CDK redeploy), analytics rollup Lambda (`server/lib/analytics/lambda/rollup/handler.ts`)
> **Discipline anchor:** [v1-master-epic-breakdown.md §17.9 L9](./v1-master-epic-breakdown.md) + memory `feedback_module_wiring_invariant` + memory `project_a4_phase2_incident`

---

## 1. Why this phase, why now

A.4 Phase 1+2 shipped 2026-05-23 (after a ~4h incident; recovered + hotfixed; full retro in §17.9 L9). The **operator-facing API surface is live** (`GET /result-cards`, `PATCH /conduct`, `PATCH /remark`, `PATCH /publish`). What's missing is the **automated generation path**: when an operator transitions an Exam to `closed`, no ResultCard rows materialize. Phase 3 wires that path:

```
operator PATCH /exams/:id/status closed
    ↓
academics service emits exam.closed event to SBT bus
    ↓ (Phase 3 wiring)
EventBridge rule routes to result-batch Lambda
    ↓
Lambda: reads ExamScore[], ExamCourse[], Enrollment, GradingPolicy → calls aggregateTermResults()
    ↓
Lambda: TransactWriteItems chunked at 100 → ResultCard rows (status=draft) live in DDB
    ↓
operator GET /result-cards?examId=… sees them
    ↓
operator PATCH /conduct + /remark + /publish on each card
```

Without Phase 3, ResultCard rows must be hand-created via DDB PutItem — not a real operator workflow. **Phase 3 closes the loop and unlocks C.9.5 cross-year handoff** (which consumes `result.published.isTerminal`).

---

## 1.5 R43 + L9 explicit check (incident discipline)

**Per §17.9 L9 forward rule:** "if §3 file list contains any new `.module.ts` for a service whose `__tests__/module-wiring.spec.ts` doesn't yet exist, that spec is a Phase 2 deliverable, NOT a Sprint 0.3 deferral."

**Phase 3 R43 audit:**
- Phase 3 creates a Lambda (`server/lib/result-generation/lambda/result-batch/handler.ts`) — NOT a NestJS module. esbuild bundles Lambda code as a standalone handler; no Nest DI graph involved.
- No new `*.module.ts` files in Phase 3. ✅ R43 does not apply.
- **L7 (live smoke catches what unit tests don't) DOES apply.** Phase 3 must include synthetic `put-events` test in the deploy ladder + Phase 4 end-to-end smoke (covered as A.4.7).

**Document this audit IN the Phase 3 PR description.** Future me reading the L9 rule will look for this audit; making it explicit prevents the "should I worry?" loop.

---

## 1.6 Architecture invariants Phase 3 enforces

Same Core Ed-Fi V6 + Edges principle as the rest of A.4 (per `a4-sprint-plan.md` §1.5). Phase 3-specific:

1. **Lambda is archetype-blind.** It reads `GradingPolicy` from DDB by `schoolId` (the per-school policy, possibly lazy-seeded from ArchetypeDefaults per D.1.3). It does NOT call `getArchetypeDefaults()` directly. The aggregation engine consumes the resolved policy.
2. **Lambda is enrollment-scoped per invariant 3.** Each ResultCard write uses `enrollmentId` as the keying field. Cross-AY safety stays the academics service's responsibility.
3. **R42 mitigation continues in Phase 3.** Lambda's `aggregateTermResults()` call reads `studentId` from the Enrollment map keyed by enrollmentId — never from `ExamScore.studentId`. Schema layer guard (`resultCardResponseSchema.studentId = z.string().uuid()`) catches any regression at API serialization.
4. **Idempotent re-invocation.** `TransactWriteItems` chunks use `attribute_not_exists(entityKey)` per chunk → safe re-fire of the same `exam.closed` event (ECS could replay; EventBridge can deliver-twice).

---

## 2. Scope

### In-scope (Phase 3 only)

| Ticket | Summary | Sized |
|---|---|---|
| A.4.3 | Result-batch Lambda + EventBridge `exam.closed` rule + DLQ subscription + CloudWatch alarms | L |
| (impl) | Lambda unit test (synthetic event detail → mocked DDB → assert ResultCard chunks written) | S |
| (impl) | Cold-start budget validation post-deploy (≤45s p95 per AC) | XS |
| (impl) | Synthetic `put-events` test as part of deploy ladder | XS |

### Out-of-scope (Phase 4 + later)

| Item | Why |
|---|---|
| Pilot smoke (A.4.7) | Phase 4 (separate PR; depends on Phase 3 live) |
| EventBridge schema registry entries for `exam.closed` payload | Already exists in shared-types `events/exam.ts` + `events/taxonomy.ts:103` |
| Per-tenant Lambda concurrency limits | V1.5 — single tenant (Saraswati + dev-pabson-primary) doesn't need rate-limiting |
| Auto-retry of failed chunks with backoff | Lambda's default 2-attempt retry + DLQ is sufficient for V1 |
| Pre-compute classRank/sectionRank | V1.5 (entity has nullable fields; renderer falls back) |
| Multi-region Lambda | V1 single-region (ap-south-1) only |

### Already-shipped foundation

- `exam.closed` event schema (A.3 / `shared-types/events/exam.ts:35`) ✅
- `exam.closed` registered in event taxonomy (`shared-types/events/taxonomy.ts:103`) ✅
- ResultCard entity factory + GSI keys (A.4.2) ✅
- Term-aggregation pure function (A.4.1) ✅
- `resultPublishedSchema` event already in taxonomy for downstream (Phase 3 NOT emitting it; that's the publish endpoint's job) ✅
- Existing Lambda patterns at `server/lib/analytics/lambda/aggregator/` + `rollup/` ✅
- `event-dlq-stack` already deployed (Phase 3 just attaches a target to the existing DLQ) ✅

---

## 3. PR cadence — 1 PR

**Single PR.** Phase 3 is Lambda code + CDK changes to one stack (`tenant-template-stack-basic`). Splitting into two PRs (Lambda vs CDK) is artificial overhead — they ship together or not at all.

### Files

**NEW:**
- `server/lib/result-generation/lambda/result-batch/handler.ts` — Lambda entry point.
- `server/lib/result-generation/lambda/result-batch/handler.spec.ts` — unit test (mocked DDB).
- `server/lib/result-generation/lambda/shared/types.ts` — internal types (event detail shape, IDs).

**MODIFIED:**
- `server/lib/tenant-template/tenant-template-stack.ts` (or wherever the basic tier is declared — verify before writing) — declare Lambda + EventBridge rule + DLQ subscription + alarms. Mirror the existing analytics-stack `ReportAggregatorEventRule` pattern (`analytics-stack.ts:1126-1166`).

### Why this is ONE PR, not split

A Lambda without an EventBridge rule never fires. An EventBridge rule without a Lambda target throws at synth. They're functionally one unit. The existing analytics-stack patterns (rollup + report-aggregator) declare them together; Phase 3 follows the same shape.

### NO shared-types changes

Phase 3 consumes `examClosedSchema` (existing) + writes ResultCard entities (existing factory). Zero new exports. shared-types stays at 0.58.0. **R39 caret-pin trap does NOT apply to Phase 3.**

### NO NestJS module changes

Per §1.5 R43 audit: Phase 3 doesn't touch `academics.module.ts` or any service module. **The L9 wiring-spec rule doesn't trigger.** (But the L7 live-smoke rule DOES — see deploy ladder.)

### NO `tenant-api-prod.json` changes

Phase 3 wires a Lambda to EventBridge, not a new HTTP route. **R40 mandatory `shared-infra-stack` redeploy does NOT apply.** shared-infra-stack stays at 87.7% — R41 unaffected.

---

## 4. Per-ticket detail

### A.4.3 — Batch result generation Lambda

**Files:** as above.

**Handler signature + flow:**
```typescript
import { Handler } from 'aws-lambda';
import type { ExamClosedEvent } from '@aibrains/shared-types';

interface ExamClosedEventBridge {
  source: 'edforge.academics-service';   // or whatever academics sets
  'detail-type': 'exam.closed';
  detail: ExamClosedEvent;
}

export const handler: Handler<ExamClosedEventBridge> = async (event) => {
  const { tenantId, examId, schoolId, academicYearId, termId, isTerminal } = event.detail;

  // 1. Read Exam, ExamCourse[], ExamScore[], Enrollment map, GradingPolicy from DDB
  // 2. Call aggregateTermResults({...})  ← reuses A.4.1 pure function
  // 3. For each AggregatedEnrollmentRow:
  //      - Build ResultCard entity via createResultCardEntity(tenantId, uuid(), { ... isTerminalExam: isTerminal })
  // 4. Chunk at 100 → TransactWriteItems with attribute_not_exists(entityKey) per item
  // 5. Per chunk: catch ConditionalCheckFailedException → log as idempotent skip (NOT error)
  // 6. Return { examId, chunksWritten, cardsCreated, cardsSkippedIdempotent, durationMs }
};
```

**Why import the term-aggregation service from academics src?** The function is pure and exported. esbuild can resolve the import path; the academics package doesn't need to be a runtime dep of the Lambda (esbuild bundles statically). Confirm via `bundle` output during cdk synth.

**Validation:**
- Lambda unit test: synthetic event detail → mock DDB Get/Query/TransactWrite responses → assert correct ResultCard rows produced.
- Cold-start budget: ≤45s p95 measured post-deploy (CW Lambda Insights or x-ray).
- 200-enrollment exam → 200 cards in <30s p50 / <90s p95 (Phase 4 smoke validates with synthetic 10-enrollment case; production-scale validation is Pilot 2 scope).
- DLQ catches synthetic Lambda failure (e.g., DDB TransactWrite all-fail) → alarm fires → SNS publishes to operator topic.

**Acceptance criteria:**
- 200 enrollments → 200 cards in <30s p50 / <90s p95 (target; smoke verifies smaller scale)
- DLQ catches Lambda failures
- CloudWatch alarm on Lambda errors >0 in 5min → SNS operator topic
- Cold-start ≤45s (memorySize: 1024 MB to start; tune if needed)
- ResultCard rows idempotent (`attribute_not_exists` guard) — re-run on same exam is a no-op
- Lambda IAM scoped to academics table read+write ONLY (no Identity table access)
- **No new NestJS module** → R43 docs gate clean

**Deps:** A.4.1 ✅ + A.4.2 ✅ + A.3.8 ✅ (`exam.closed` event emission).

### EventBridge rule + DLQ + alarm CDK wiring

**Files:** `tenant-template-stack.ts` (verify exact file name + tier scoping pattern before writing).

**Rule declaration (mirroring `analytics-stack.ts:1126`):**
```typescript
new events.Rule(this, 'ResultBatchExamClosedRule', {
  ruleName: 'edforge-result-batch-exam-closed',
  description: 'Routes exam.closed → result-batch Lambda',
  eventBus: events.EventBus.fromEventBusName(this, 'SbtEventBusForResults', props.eventBusName),
  eventPattern: {
    source: ['edforge.academics-service'],     // VERIFY at draft time against AcademicsEventsService.eventSource
    detailType: ['exam.closed'],
  },
  targets: [
    new eventsTargets.LambdaFunction(this.resultBatchLambda, {
      deadLetterQueue: this.eventDlq,           // re-uses existing event-dlq-stack DLQ
      maxEventAge: cdk.Duration.minutes(60),
      retryAttempts: 2,
    }),
  ],
});

// Alarm: any Lambda error pages immediately
const errors = this.resultBatchLambda.metricErrors({ period: cdk.Duration.minutes(5), statistic: 'Sum' });
new cloudwatch.Alarm(this, 'ResultBatchLambdaErrorsAlarm', {
  alarmName: 'edforge-result-batch-lambda-errors',
  alarmDescription: 'Result-batch Lambda errored. ResultCard generation halted for the affected exam.',
  metric: errors,
  threshold: 1,
  evaluationPeriods: 1,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
}).addAlarmAction(new cwActions.SnsAction(this.operatorAlertTopic));
```

**DLQ depth alarm (already exists in event-dlq-stack OR add specifically for this Lambda):** verify before adding. If event-dlq-stack already alarms on per-rule DLQ depth, no new alarm needed; if it's a single fleet DLQ, this Lambda needs its own depth alarm.

---

## 5. Risks (Phase 3 specific)

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-A4P3.1 | Lambda cold-start >45s — first invocation after deploy times out | M | M | memorySize 1024 MB (matches rollup precedent); validate p95 via CW Lambda Insights post-deploy. If >45s, raise to 1792 MB or pre-warm via scheduled invocation. |
| R-A4P3.2 | EventBridge rule pattern mismatch — `source` or `detail-type` differs from what academics service emits | M | H | **MANDATORY pre-deploy verification:** grep `AcademicsEventsService.eventSource` in academics src + cross-check against the rule's `source: []` field. PR review checkpoint. Synthetic put-events test in deploy ladder catches runtime mismatch. |
| R-A4P3.3 | DLQ silent — Lambda fails, no operator alert | M | H | Per-Lambda CloudWatch alarm on `Errors` metric is the primary detector (mandatory in PR). DLQ depth alarm is the secondary (verify event-dlq-stack covers per-rule depth; if not, declare one in this PR). |
| R-A4P3.4 | Term-aggregation import-path break — Lambda esbuild can't resolve `../../microservices/academics/src/results/term-aggregation.service.ts` due to tsconfig path config | M | H | **Verify cdk synth Lambda bundle output during PR review.** If esbuild errors, restructure: extract `aggregateTermResults` to a workspace-shared package (creates same trap as `@edforge/*` per memory `edforge_workspace_only_packages_docker_trap` — Docker can't resolve workspaces; Lambdas CAN per esbuild). |
| R-A4P3.5 | Lambda IAM too broad — task role granted unnecessary perms | L | M | Scope to academics-only: `dynamodb:GetItem/Query/TransactWriteItems` on `edforge-academics-basic` only; no Identity table access. PR review checkbox. |
| R-A4P3.6 | Re-invocation on same `exam.closed` event creates duplicate ResultCards | L (mitigated) | M | `attribute_not_exists(entityKey)` guard on TransactWriteItems → ConditionalCheckFailed = idempotent skip, not error. Lambda increments `cardsSkippedIdempotent` counter. EventBridge retry semantics handled. |
| R-A4P3.7 | CFN template size for `tenant-template-stack-basic` — Lambda + rule + alarm adds resources | L | L | tenant-template-stack-basic is independent of shared-infra-stack (R41). Check current size in `cdk diff` output. If approaching 1MB hard limit, defer (unlikely; tenant-template is the smallest stack). |
| R-A4P3.8 | Lambda Node.js runtime drift — NODEJS_20_X EOL approaching | L | L | Match existing analytics Lambda runtime (NODEJS_20_X per `analytics-stack.ts:1177`). Codebase-wide upgrade is V1.5 backlog. |

**Risks NOT applicable to Phase 3 (explicit dismissal):**
- R-A4.2 (R39 caret-pin trap) — no shared-types changes
- R-A4.3 (NestJS module wiring) — no module changes
- R43 (wiring-spec) — Lambda is not a NestJS module
- R40 (tenant-api-prod.json deploy gap) — no API GW route changes
- R41 (CFN template at 87.7%) — Phase 3 changes `tenant-template-stack-basic`, not `shared-infra-stack`

---

## 6. Invariant gate

| Invariant | Phase 3 disposition |
|---|---|
| Pure function preserved | YES — `aggregateTermResults` is reused via import; not duplicated in Lambda code |
| Invariant 3 enrollmentId keying | YES — Lambda uses `createResultCardEntity` which enforces it |
| Invariant 12 archetype-blind | YES — Lambda reads policy from DDB; no `tenant.archetype` reads |
| Invariant 13 no pilot names | YES — Lambda is fully parametric over event detail |
| R42 studentId resolution | YES — Lambda passes Enrollment map to aggregation function |
| Audit + event paired | N/A — Lambda emits a `result.batch_generated` event per chunk (NOT a write that needs audit; the writes themselves ARE the audit-able operation; ResultCard entities have createdBy='lambda' for traceability) |
| Three-way route handoff | N/A — no HTTP routes |
| L7 live smoke | YES — synthetic put-events in deploy ladder + Phase 4 end-to-end smoke |
| L9 module-wiring spec | N/A — no new NestJS module |

---

## 7. Deploy ladder (with post-incident discipline)

```
Phase 3 PR
  ├── (CI green: cdk synth tenant-template-stack-basic; jest Lambda spec)
  ├── (Reviewer approval — Shoaib)
  ├── Merge PR to main
  ├── cdk diff tenant-template-stack-basic (tee'd) ← MANDATORY review step
  │    └── Verify ONLY new resources: result-batch Lambda + rule + alarm
  │    └── No destructive changes to existing services
  │    └── No churn on shared-infra-stack
  ├── (Reviewer approval — diff matches expectation)
  ├── cdk deploy tenant-template-stack-basic prod (via ./scripts/deploy.sh wrapper)
  ├── (Wait deploy complete; ~3-5 min expected)
  ├── Verify resources created:
  │    ├── aws lambda get-function --function-name edforge-result-batch-lambda
  │    ├── aws events list-rules --name-prefix edforge-result-batch
  │    └── aws sqs get-queue-attributes (DLQ — depth should be 0)
  ├── Synthetic put-events test (THE PHASE 3 LIVE-SMOKE GATE):
  │    └── aws events put-events --entries '[{... source=edforge.academics-service, detail-type=exam.closed, detail=<synthetic with bogus examId>}]'
  │    └── Wait 30s
  │    └── CW log filter on /aws/lambda/edforge-result-batch-lambda for "Lambda invoked" + termination
  │    └── EXPECTED: Lambda fires, returns 0 cardsCreated (bogus examId means no ExamCourses found), no error
  │    └── If Lambda DOESN'T fire: EventBridge rule pattern mismatch (R-A4P3.2) → DEBUG before declaring deploy successful
  ├── Verify alarm provisioning settled (~5min for CW alarm state to populate)
  └── Skip end-to-end smoke until Phase 4 (separate PR + execution)
```

**Critical post-deploy gate (per L9 + project_a4_phase2_incident learning):** the gate is the synthetic `put-events` test, NOT `services-stable` (Lambda has no ECS concept). If the synthetic put-events doesn't surface in CW Lambda logs within 30s, EventBridge wiring is broken and must be debugged before Phase 4 can start.

---

## 8. Open decisions (need sign-off before branch cut)

1. **Lambda location.** `server/lib/result-generation/lambda/result-batch/handler.ts` (new top-level domain `result-generation/`) vs reusing `server/lib/analytics/lambda/result-batch/handler.ts`. Master plan says result-generation; existing convention is analytics. *Recommendation:* `result-generation/` — Lambda is not analytics, and a new domain dir is cheap. Confirms the sprint plan §3 Phase 3.

2. **Lambda memorySize.** Mirror analytics rollup (1024 MB) or start at 512 MB and grow? Trade-off: 1024 MB cold-start ~4s p95 vs 512 MB ~6-8s. Result-batch workload is DDB-bound (low CPU); 512 MB likely fine. *Recommendation:* start at 1024 MB matching the proven rollup precedent. Reduce to 512 MB in V1.5 after measured workload data.

3. **Term-aggregation import path.** Lambda imports `aggregateTermResults` directly from `../../../application/microservices/academics/src/results/term-aggregation.service.ts` via relative path? OR extract aggregation to a workspace package? *Recommendation:* import directly via relative path; esbuild handles statically. Workspace-package extraction triggers `edforge_workspace_only_packages_docker_trap` if ANY other Docker-built service ever imports it — premature abstraction.

4. **DLQ — shared event-dlq-stack vs per-Lambda DLQ.** Reuse the existing fleet DLQ (simpler; existing alarm patterns apply) vs declare a per-Lambda DLQ (per-stream isolation; more resources). *Recommendation:* reuse the existing fleet DLQ. Add a per-Lambda CW alarm on `Errors` as the primary detector; DLQ depth is the secondary.

5. **Should Phase 3 also include the `result.batch_generated` event emission per chunk?** Sprint plan §A.4.3 mentions it for observability. *Recommendation:* yes — emit `result.batch_generated` per chunk with `{ examId, chunkIndex, chunkSize, cardsCreated, cardsSkipped }`. Cheap to emit; helps debug at scale. Add to shared-types `events/result.ts` IF schema is new (it's not declared today; one-line schema add → bump 0.58.0 → 0.59.0). Actually — to avoid R39 cycle in Phase 3, leave the event un-schema'd for now (Lambda emits as freeform JSON to operator topic; only `result.published` from operator action goes through the formal schema). V1.5: properly schema the operational event.

6. **`source` field on the EventBridge rule.** What does `AcademicsEventsService.eventSource` actually set today? *Pre-deploy verification:* grep `eventSource` in `academics-events.service.ts` + cross-reference the rule's source[] array.

7. **Cold-start vs reserved concurrency.** For V1 with low expected volume (<5 exam closures/day across all tenants), reserved concurrency isn't needed. *Recommendation:* no reserved concurrency.

---

## 9. Definition of Done (Phase 3)

- [ ] A.4.3 ticket meets §1.1 atomic DoD (Files + Validation + AC + Deps + Risk)
- [ ] PR merged to main
- [ ] R43 audit explicit in PR description ("No new NestJS module — Lambda is esbuild-bundled, R43 N/A")
- [ ] Phase 3 deploy log: `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/prod-cdk-diff-tenant-template-stack-basic-<ts>-<sha>.log` + `prod-cdk-deploy-tenant-template-stack-basic-<ts>-<sha>.log`
- [ ] Post-deploy resource verification: Lambda + EventBridge rule + alarm visible via AWS CLI
- [ ] **Synthetic put-events test PASSED** — CW Lambda Insights shows the invocation + 0-card success
- [ ] No regressions in academics ECS service (already running hotfix image) — services-stable confirms
- [ ] R41 status check: `tenant-template-stack-basic` template size logged (Phase 3 should add <50KB)
- [ ] No regressions in A.2 / A.3 / A.4 P1+2 / D.1 / E.0 / E.1 / 0.4 smokes (regression bundle re-run pre-merge)

---

## 10. What this plan deliberately does NOT include

- Pilot smoke (A.4.7) — Phase 4 scope; depends on Phase 3 live
- shared-types `result.batch_generated` event schema — deferred per §8 #5 (Lambda emits freeform; V1.5 formalizes)
- AdminWeb / saas-frontend ResultCard UI — post-A.4 follow-up
- ClassRank / SectionRank computation — V1.5
- Re-aggregation on score correction after Exam→closed transition — V1 requires Exam→in_progress + re-score + re-close + Lambda re-fires
- Cross-tenant Lambda (e.g., one Lambda for all schools in a tenant) — already covered: one Lambda invocation per `exam.closed` event handles all enrolled students for that one exam
- shared-api-routes-stack split (R41) — separate immediately-following sprint per A.4 Phase 0 decision

---

## Sign-off requested

Open decisions in §8 are the gates. Once signed off:
1. Cut feature branch: `sprint/a4-phase-3-result-batch-lambda` on the server repo.
2. Per memory `feedback_explicit_cd_per_git`: every git op starts with explicit `cd <repo-root>` in the same invocation.
3. Begin implementation against the file list in §3.
4. After PR merges, deploy ladder in §7 strictly — including the synthetic put-events live-smoke gate.
