# Pilot Greenlight — Sprint Closeouts

Per [docs/pilot-greenlight/sprint-plan.md](sprint-plan.md) §11 "Definition of Done (per sprint)", each sprint's closeout lives here. Entries are appended chronologically; the most recent sprint is at the top.

---

## Sprint R41.A — CFN headroom via Stage variables + fromAsset

**Closed:** 2026-05-23
**Status:** 🟢 **Risk R41 fully closed.** `shared-infra-stack` CFN template recovered from 87.7% → ~6% of 1MB ceiling. D.2 / D.3 / D.4 / D.5 / D.6 / C-series / A.1 all unblocked for the rest of V1.
**Goal:** Stop CFN template hitting 1MB hard limit (projected to fail between D.2 and D.3) so the master plan's ~150 remaining API GW routes can ship without infra friction.
**Outcome:** Shipped across 3 PRs (deploy attempts 1+2 failed and auto-rolled back; attempt 3 succeeded). Architecture changed at the construct level only (`fromInline` → `fromAsset` + API GW Stage variables). Zero customer impact (Lambda untouched, all exports preserved; behavioral change is request-time stage-var substitution instead of import-time inline values — functionally identical).

### PRs shipped

| PR | Phase | Outcome |
|---|---|---|
| [#169](https://github.com/shoaibrain/edforge/pull/169) | Initial R41.A | `fromInline` → `fromAsset` + 5 placeholders as `${stageVariables.*}`. Pre-deploy spec test 7/7 green. **Deploy attempt 1 FAILED:** API GW rejected stage vars in authorizerUri region/account slots at import time. CFN auto-rolled back. |
| [#170](https://github.com/shoaibrain/edforge/pull/170) | Hotfix 1 | Made region/account/function-name LITERAL at synth via `env: process.env.CDK_DEFAULT_*` + explicit `functionName: 'tenant-api-authorizer-prod'`. Wrapper exports `CDK_DEFAULT_*` from AWS profile. **Deploy attempt 2 FAILED:** Lambda rename → ARN change → `TenantApiAuthorizerArn` export update blocked by analytics-stack import. Auto-rollback. |
| [#171](https://github.com/shoaibrain/edforge/pull/171) | Hotfix 2 + CLAUDE.md rule | Architect subagent review caught the trap. Confirmed via cdk synth that pinning `functionName` to existing name ALSO triggers replacement. **Adopted Option A:** drop explicit `functionName` (CDK auto-name stays → no replacement → no cross-stack collision); use `${stageVariables.authorizerFn}` in function-name slot only. NEW CLAUDE.md rule: "Cross-stack export change pre-flight" with `aws cloudformation list-imports` audit. **Deploy attempt 3 succeeded in 60.8s.** |

### Deploy ladder evidence (attempt 3)

- **Cross-stack export audit (new rule):** 20 exports owned by shared-infra-stack; only 3 Outputs would have template-form changes (all auto-resolve to byte-identical strings; all have NO importers). The `TenantApiAuthorizerArn` / `TenantApiRestApiId` / `TenantApiRootResourceId` exports (consumed by analytics-stack) do NOT change.
- **Layer 1 cdk diff:** 7 resource changes — Body→BodyS3Location, Stage.Variables added (3 keys), Lambda Permission replaced (env-bake side-effect; same resolved SourceArn), Deployment replaced (spec-change side-effect), IAM Role + S3 BucketPolicy (env-bake side-effects), CDKMetadataCondition removed. **NO `AWS::Lambda::Function` delta.**
- **Deploy:** UPDATE_COMPLETE at 7:28:21 PM IST; total 60.8s.
- **Post-deploy verification:** Lambda LastModified preserved (2026-04-05; proves no replacement). `TenantApiAuthorizerArn` export value identical to pre-deploy. Stage.Variables resolved correctly.
- **Layer 2 sub-checks:** 2a — 0 non-MODEL diffs (132 diff lines all CFN/API-GW-internal `MODEL<hex>` schema IDs that regenerate per import). 2b — every dynamic field uses expected stage var marker; authorizer URI has literal region+account + `${stageVariables.authorizerFn}` in fn-name slot. 2c — Stage.Variables map confirmed via `aws apigateway get-stage`.
- **Layer 3 smoke:** Effective 15/15 routing-success after triage (2 fails were smoke-script bugs on made-up paths; 1 "500" was routing-success with EdForge NestJS error envelope proving backend was reached). Real `/iemis/audit` returned 200; real `/finance/schools/{schoolId}/credit-notes` returned 404 (routing-success). Smoke script paths corrected in follow-up.

### Lessons captured

- **L14 — `ApiDefinition.fromInline` vs `fromAsset` is the L1 lever for CFN template size.** R41.A planning initially proposed migrating 77 routes (rejected as "competent solution to wrong problem") before recognizing the construct-factory swap. Memory `feedback_check_root_cause_before_migration`.
- **L15 — API Gateway validates `authorizerUri` ARN at spec IMPORT time, not request time.** Stage variables work in the function-name slot only (per AWS docs; now empirically verified). Region/account must be literal at import.
- **L16 — Setting `FunctionName` on `AWS::Lambda::Function` that previously relied on auto-naming ALWAYS triggers replacement** — even if the new literal value matches the existing physical name. Confirmed via cdk synth. For Lambda renames in stacks with cross-stack ARN exports, use SSM Parameter decoupling.
- **L17 — cdk diff lists Output VALUE changes but does NOT show cross-stack importers.** Cross-reference via `aws cloudformation list-imports --export-name <X>` before deploy. New CLAUDE.md rule encodes this with a 3-state-distinguishing loop (importers / no-importers / CLI-error).
- **L18 — Architect-subagent review surfaces failure modes that per-resource Layer 1 review misses.** When a deploy fails or a forward path involves cross-stack changes, spawn a `general-purpose` subagent with full context + ask for the failure modes the staff-eng didn't anticipate. The R41.A retro proved this: the subagent caught the "pin existing name" trap empirically and proposed the CLAUDE.md rule wording.

### Follow-up sprints queued

- **R41.B** (DX improvement, opt-in): per-domain Swagger fragments + synth-time merge. Splits the 23K-line `tenant-api-prod.json`; merged spec byte-equal so no CFN behavioral change. ~2-3 days; not blocking.
- **R41.C** (V1.5 candidate): SSM Parameter migration for `TenantApiAuthorizerArn`. Decouples consumer (analytics-stack) deploy ordering from producer (shared-infra-stack) so future Lambda renames don't get blocked. ~30 LOC across 2 PRs.
- **B0.1.T* — `scripts/cdk-export-preflight.sh`:** wrap the new cross-stack export audit into a shell script.

### Deploy logs

- `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/prod-shared-infra-stack-r41a-20260523-180538-5cdb112.log` — attempt 1 (failed)
- `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/prod-shared-infra-stack-r41a-attempt2-20260523-184223-c234c29.log` — attempt 2 (failed)
- `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/prod-shared-infra-stack-r41a-attempt3-20260523-192328-11d58dc.log` — attempt 3 (🟢 succeeded)
- `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/analytics-prod-shared-infra-stack-20260523-192638-11d58dc.log` — wrapper-tee'd CDK output

---

## Sprint A.4 — Result Subsystem (V1 Master EPIC — third EPIC-A sprint, FULL CLOSEOUT)

**Closed:** 2026-05-23
**Status:** 🟢 **All 7 tickets (A.4.1–A.4.7) live on prod after 2 hotfixes; Phase 4 smoke 16/16 green.**
**Goal:** Close the "exam closed → ResultCard generated → operator publishes" loop so EPIC-A is product-complete and downstream consumers (C.4.3 Report Card render, D.2.5 PromotionRule batch-eval, D.4.6/D.5.4 ExternalExamResult import, C.9.5 cross-year handoff) unblock.
**Outcome:** Shipped in 4 phases + 2 hotfixes across 6 PRs (#161, #162, #163, #165, #166, #167). End-to-end pilot smoke `pilot-result-card-publish.ts` ran on dev-pabson-primary: **Lambda fired 3s post-close**, generated 10 ResultCards per enrollment with correct totals + R42-resolved studentIds + isTerminalExam=true (examType=final). Operator PATCH conduct/remark/publish all 200; state-machine 409s on RESULT_ALREADY_PUBLISHED + RESULT_LOCKED. **Two prod incidents along the way** — Phase 2 ResultsModule DI gap (~4h outage; §17.9 L9), and Phase 3 Lambda data-shape gap (caught by smoke; no prod impact; §17.10 L10). Both retro'd into durable code + memory + master plan.

### Tickets shipped (all 7 + 2 hotfix-specific deliverables)

| Ticket | PR | Status |
|---|---|---|
| A.4.1 — Term-aggregation rules engine (pure function) | [#162](https://github.com/shoaibrain/edforge/pull/162) | ✅ archetype-blind; source-text invariant grep enforced; weighted GPA via creditHours; missing-score → NG semantics per D.1 |
| A.4.2 — `ResultCard` entity + factory + mapper | [#162](https://github.com/shoaibrain/edforge/pull/162) | ✅ keyed by enrollmentId (invariant 3); GSI1/2/3 lowercase per S3.2; courseScores[] denormalizes academicSubject |
| A.4.3 — Result-batch Lambda + EventBridge + DLQ + alarms | [#165](https://github.com/shoaibrain/edforge/pull/165) + [#167](https://github.com/shoaibrain/edforge/pull/167) (hotfix) | ✅ Lambda fires on `ExamStatusTransitioned(toStatus=closed)` event; 17KB bundle (50× smaller than peers; zero @nestjs/* deps); IAM scoped to academics table; per-Lambda DLQ + 2 CW alarms |
| A.4.4 — Conduct + class-teacher-remark PATCH endpoints | [#162](https://github.com/shoaibrain/edforge/pull/162) | ✅ 409 RESULT_LOCKED on published; audit + event per write |
| A.4.5 — Publication state machine | [#162](https://github.com/shoaibrain/edforge/pull/162) | ✅ draft → published (terminal V1); 409 RESULT_ALREADY_PUBLISHED on re-publish; emits `result.published` per shared-types schema |
| A.4.6 — Cross-year publication regression spec | [#162](https://github.com/shoaibrain/edforge/pull/162) | ✅ invariant 3 guard via static GSI2/GSI3 partitioning assertions |
| A.4.7 — Pilot result-card-publish parametric smoke | [#166](https://github.com/shoaibrain/edforge/pull/166) | ✅ 13 logical checkpoints (16 assertions); 16/16 green on dev-pabson-primary |
| (impl) — `result-card.schema.ts` Zod contract | [#161](https://github.com/shoaibrain/edforge/pull/161) | ✅ 44 spec assertions |
| (impl) — academics `__tests__/module-wiring.spec.ts` | [#163](https://github.com/shoaibrain/edforge/pull/163) (hotfix) | ✅ 43 assertions; static-metadata pattern mirroring identity spec; closes R43 for academics |
| (impl) — defensive `isActive !== false` + `letterGrades ?? []` in Lambda | [#167](https://github.com/shoaibrain/edforge/pull/167) (hotfix) | ✅ 2 new specs mocking real prod shape (no isActive field); fixes data-shape gap |

### R42 (carryover from A.3) — CLOSED

A.4.1 `TermAggregationService.aggregateTermResults` resolves `studentId` from Enrollment map by enrollmentId, NEVER from ExamScore.studentId (which may carry the `'unknown'` placeholder for bulk-written A.3 rows). Schema layer guards: `resultCardResponseSchema.studentId = z.string().uuid()` rejects `'unknown'`. **Phase 4 smoke C8.a verified zero studentId='unknown' across all 20 generated cards on dev-pabson-primary.**

### R41 (CFN template size) status — UNCHANGED

Post-deploy `shared-infra-stack` CFN: 877,009 / 1,000,000 = **87.7% of 1MB limit**. Phase 3 + 4 changes were to `tenant-template-stack-basic`, not `shared-infra-stack` — so R41 stayed flat. The `shared-api-routes-stack` split sprint is now the **next critical-path move** before D.2/D.3/C-series add more API GW paths.

### R43 (wiring spec) — RESOLVED for academics

Hotfix [#163](https://github.com/shoaibrain/edforge/pull/163) added `academics/__tests__/module-wiring.spec.ts`. Finance + rproxy specs still uncovered — V1.5 backlog.

### R44 (NEW) — Lambda `cardId` non-deterministic; duplicates on re-fire

**Live smoke evidence 2026-05-23 17:25 UTC:** Phase 4 generated **20 ResultCards for 10 enrollments** because EventBridge delivered the `ExamStatusTransitioned` event twice (at-least-once semantics) and the Lambda's `attribute_not_exists(entityKey)` idempotency guard didn't catch the duplicate — `uuid()` per invocation produces distinct `cardId`s → distinct entity keys → guard misses.

**Impact:** non-blocking for Saraswati V1 pilot (operator can soft-delete duplicates). Cognitive noise grows linearly with exam closures. **Fix:** derive `cardId` deterministically from `hash(tenantId, examId, enrollmentId)`. ~10 LOC change in `handler.ts:buildResultCardItem`. V1.5 backlog (or fast-follow hotfix if operator load warrants).

### Incidents along the way (both retro'd)

**1. Phase 2 academics outage** (06:15-12:19 UTC, ~4h):
- ResultsModule.providers omitted IdentityClientService (PermissionGuard's constructor dep) → Nest bootstrap crash loop
- Recovery: ECR `:latest` re-tagged to prior A.3 image; force-new-deploy
- Hotfix #163: provider added + academics module-wiring spec (43 assertions)
- Codified: §17.9 L9 + R43 + memory `project_a4_phase2_incident` + memory `feedback_module_wiring_invariant` broadened to cover all services
- Three-time pattern (S0 + C4 + A.4 are same trap): wiring spec must ship WITH new module

**2. Phase 3 Lambda data-shape gap** (caught by Phase 4 smoke; NO prod impact):
- Lambda spec mocks all set `isActive: true` and `letterGrades: [...]`. Real prod DDB rows often lack these fields entirely (academics service doesn't consistently write isActive; D.1.1 pre-rename GradingPolicy rows lack letterGrades)
- Smoke C7 timeout → diagnostic dump showed Lambda fired + read 0 of each entity → filter rejected everything
- Hotfix #167: `.filter((x) => x.isActive !== false)` + `letterGrades ?? []` (mirrors `grading-policy.mapper.ts:90`)
- Operator backfill: PATCH dev-pabson-primary GradingPolicy 07d6e1d1 with PABSON CEHRD letterGrades (NG dropped due to validation range-overlap; V1.5 candidate)
- Codified: §17.10 L10-L13

### Deploy artifacts (full sprint timeline 2026-05-23)

| Time (UTC) | Artifact |
|---|---|
| 05:13 | `shared-infra-stack` CDK redeploy — 5 new API GW paths live (222.6s) |
| 05:18 | academics ECR `sha256:a9c5008…` tagged `:latest` (BROKEN — Phase 2 image) |
| 06:15 | ECS roll → crash loop begins |
| 12:09 | ECR `:latest` re-tagged to A.3 image `sha256:1bdb67f0…` (rollback) |
| 12:17 | ECS new task boots clean; service restored |
| 12:45 | Hotfix [#163](https://github.com/shoaibrain/edforge/pull/163) opened |
| 12:55 | Hotfix image `sha256:2c9fd8b8…` deployed; Phase 2 functionality live |
| (Phase 3 deploy) | `tenant-template-stack-basic` CDK redeploy — Lambda + EventBridge + DLQ + 2 alarms (~3 min) |
| 17:13 | Hotfix [#167](https://github.com/shoaibrain/edforge/pull/167) merged; Lambda re-bundled (38s; CodeSha rotated) |
| 17:25 | Phase 4 smoke **16/16 GREEN** on dev-pabson-primary |

**Final running state on prod:**
- `@aibrains/shared-types` 0.58.0 on npm
- academics ECR `sha256:2c9fd8b8…` tagged `e875e15-20260523124503` + `:latest`
- academics ECS `ecs-svc/2972247310013679113` on `prod-basic/academicsbasic` (ap-south-1) — `rolloutState: COMPLETED`
- result-batch Lambda `arn:aws:lambda:ap-south-1:257526644020:function:edforge-result-batch-basic` — Active; CodeSha `dRoS50JrQN5XAbyHUUKZf9htf8Sc7/bksqN5PVfgRcA=` (post-hotfix); 1024 MB memory; 300s timeout; CW alarms OK; DLQ depth 0
- EventBridge rule `edforge-result-batch-exam-closed-basic` — ENABLED with pattern `source=edforge.academics-service; detail-type=ExamStatusTransitioned; detail.toStatus=[closed]`
- API GW: 5 new `/academics/result-cards/*` paths live on `shared-infra-stack`

### Architecture invariants preserved + R-A4.* status

| Invariant | A.4 evidence |
|---|---|
| 3 (cross-AY enrollmentId) | ResultCard entityKey = `RESULT_CARD#{enrollmentId}#{cardId}` per `result-card.entity.ts`; A.4.6 spec asserts |
| 12 (no implicit archetype branching) | TermAggregationService source-text grep clean; archetype awareness via D.1 GradingPolicy (per-tenant), not direct branching |
| 13 (no pilot names) | Phase 4 smoke parametric via env vars; dev-pabson-primary referenced only as PILOT_ID |
| R42 (studentId resolution) | ✅ closed; smoke C8.a verified |
| L7 (live smoke catches integration issues) | ✅ Phase 4 caught isActive + letterGrades shape gaps unit tests missed |
| L9 (wiring-spec ships with module) | ✅ academics spec added in hotfix #163 (retroactive but durable) |
| L10 (Lambda specs mock REAL prod shapes) | ✅ codified §17.10; hotfix #167 adds 2 new defensive specs |
| L11 (Phase 4 IS the wire-validation gate) | ✅ codified §17.10 |

### Decisions captured + V1 limitations documented

| Decision / Limitation | Source | V1.5 candidate |
|---|---|---|
| V1 isTerminal heuristic = `examType === 'final'` (PABSON-only) | a4-phase-3-plan §1.6 + handler.ts | ✅ V1.5: archetype-defaults lookup for multi-archetype support |
| Per-Lambda DLQ (not shared event-dlq-stack) | a4-phase-3-plan §8 #4 deviation | Optional V1.5: consolidate if fleet-wide alerting needed |
| Term-aggregation function DUPLICATED in lambda/shared (DRY violation) | DRY note in `lambda/shared/term-aggregation.ts` | ✅ V1.5: workspace-package extraction once second consumer needs it |
| SNS action on Lambda alarms deferred (no operatorAlertTopic prop) | a4-phase-3-plan deviation | ✅ V1.5: prop pass-through from analytics-stack |
| NG entry dropped from policy backfill (validation overlap) | §17.10 L13 | ✅ V1.5: refine validator to allow NG sentinel range 0-0 |
| `cardId` non-deterministic → duplicate cards on re-fire | R44 (live smoke evidence) | Fast-follow OR V1.5 |
| Cleanup leaves orphan ResultCards/ExamCourses/ExamScores | matches A.3.11 pattern; dev-only | Accepted V1 |

### Forward signal for next sprint planning

**Critical-path next move:** the `shared-api-routes-stack` split sprint. Per §17.8 L6, the 90% CFN threshold triggers split as a hard prerequisite. R41 still at 87.7%; with D.2 (~6 paths), D.3 (~10), D.4 (~9), D.5 (~7), D.6 (~6), C.1-C.5 (~12) all critical-path, the limit hits within ~2 sprints if no split. **Defer D.2/D.3/C-series until split lands** to avoid mid-sprint CFN failures.

**Parallel-eligible after split:** D.2 (PromotionRule), D.3 (ExternalAssessment), C.1 (Document service), A.1 (Period attendance — V1.5 candidate per master plan §3).

### Anchors

- Sprint plan: [`a4-sprint-plan.md`](./a4-sprint-plan.md)
- Phase 3 plan: [`a4-phase-3-plan.md`](./a4-phase-3-plan.md)
- Phase 4 plan: [`a4-phase-4-plan.md`](./a4-phase-4-plan.md)
- Foundation audit: [`a4-foundation-readiness-audit.md`](./a4-foundation-readiness-audit.md)
- Master plan: §0.4 (status), §11.2 (R42/R43/R44), §17.9 + §17.10 (ship-cycle lessons L9-L13), §12 (critical path)
- Memories: [[project-a4-phase2-incident]] (Phase 2 outage retro), [[project-sprint-a4-shipped-prod]] (this full closeout), [[feedback-module-wiring-invariant]] (broadened post-A.4 to cover all services)

---

## Sprint A.3 — Exam Subsystem Backend (V1 Master EPIC — second EPIC-A sprint)

**Closed:** 2026-05-22
**Goal:** Land the term-end Exam workflow (Exam + ExamCourse + ExamScore entities + state machine + bulk score handler + 8 API GW routes) so downstream A.4 Result Subsystem, C.4 Report Card render, D.2.5 PromotionRule batch-eval, and D.4.6/D.5.4 ExternalExamResult import all have a real exam data source.
**Outcome:** All 11 tickets (A.3.1–A.3.11) shipped to prod across **4 PRs + 1 mid-sprint CDK deploy + 1 follow-up smoke-fix PR**. shared-types `0.57.0` published; academics ECS rolled (image `sha256:1bdb67f0…`); `shared-infra-stack` redeployed to add 8 new API GW paths; **A.3.11 pilot-exam-flow smoke 11/11 green on dev-pabson-primary** (full lifecycle: create → 2 ExamCourses → schedule → 5 single scores → bulk 10 → idempotent retry → 4 state-machine transitions → invalid-transition rejection → soft-delete cleanup). Unblocks **A.4 (immediately) + D.3 (foundation for D.4/D.5/D.6 BLE/SEE/NEB)**.

### Tickets

| Ticket | PR | Status |
|---|---|---|
| A.3.1 — Curriculum readiness audit doc | [#156](https://github.com/shoaibrain/edforge/pull/156) (Phase 1) | ✅ committed at `docs/pilot-greenlight/a3-curriculum-readiness-audit.md` |
| A.3.2 — `Exam` entity + key builder | [#157](https://github.com/shoaibrain/edforge/pull/157) (Phase 2) | ✅ GSI keys lowercase per S3.2 regression guard |
| A.3.3 — `ExamCourse` entity + Course FK denormalization | [#157](https://github.com/shoaibrain/edforge/pull/157) | ✅ `academicSubject` denormalized at write for A.4 aggregation |
| A.3.4 — `ExamScore` entity (keyed by `enrollmentId` per invariant 3) | [#157](https://github.com/shoaibrain/edforge/pull/157) | ✅ GSI2 student-centric + GSI3 per-enrollment for cross-AY transcript |
| A.3.5 — Exam CRUD endpoints | [#157](https://github.com/shoaibrain/edforge/pull/157) | ✅ 5 endpoints; archetype `examType` narrowing via inline TenantMetadataReader |
| A.3.6 — ExamCourse CRUD endpoints (Course FK validation) | [#157](https://github.com/shoaibrain/edforge/pull/157) | ✅ direct DDB GetItem (no circular service inject) |
| A.3.7 — ExamScore CRUD (single) | [#157](https://github.com/shoaibrain/edforge/pull/157) | ✅ rawScore ≤ maxMarks server-side validation |
| A.3.8 — Exam state machine | [#157](https://github.com/shoaibrain/edforge/pull/157) | ✅ pure function; 25/25 transition matrix covered; idempotent no-op |
| A.3.9 — Bulk score entry chunked at 100 | [#157](https://github.com/shoaibrain/edforge/pull/157) | ✅ correlationId idempotency: 10 created (1st) + 10 skipped (retry, alreadyProcessed=true) |
| A.3.10 — Score Zod schema (shared-types) | [#156](https://github.com/shoaibrain/edforge/pull/156) (Phase 1) | ✅ + companion Exam + ExamCourse schemas |
| A.3.11 — Pilot exam smoke (parametric) | [#158](https://github.com/shoaibrain/edforge/pull/158) + [#159](https://github.com/shoaibrain/edforge/pull/159) | ✅ 11/11 green on dev-pabson-primary `4209e3d8`; exam `fbfb9811-…` lifecycle full |

### Deploy artifacts

- `@aibrains/shared-types` `0.56.0` → `0.57.0` on npm
- academics ECR image `sha256:1bdb67f0783ec2d595d873f0a189126a3cff42fa2445ae36e07621f84e650d19` tagged `8d729d8-20260523025045` + `:latest`
- academics ECS deployment `ecs-svc/7668548412486095868` on `prod-basic/academicsbasic` (ap-south-1) — `rolloutState: COMPLETED`
- **`shared-infra-stack` CDK redeploy** (223s) — 8 new API GW paths live + deployment hash rotated (`prod-shared-infra-stack-…log`)
- AdminWeb jsdom bundle sim passed (Phase 1) — AdminWeb pin stays `^0.40.0` (no exam types consumed)
- A.3.11 smoke against dev-pabson-primary school `4209e3d8`, synthetic Exam `fbfb9811-ebf4-4f0e-8cf1-57d4468f8ef1` (soft-deleted on cleanup)

### Architecture invariants preserved

| # | Invariant | A.3 evidence |
|---|---|---|
| 3 | Cross-AY entity binding via `enrollmentId` | `ExamScore.enrollmentId` is the student-anchor field (not `(studentId, examId)`); GSI3 `enrollment#{enrollmentId}` enables D.2.10 grade-promotion-safe queries; entity spec asserts |
| 5 | `auditedWrite()` on every write | Existing courses-service audit/event pattern mirrored for all 10 Exam* events (course pattern; auditedWrite formal port is Sprint 0.3 scope) |
| 6 | Domain event registry | 10 new ExamXxx event interfaces added to `AcademicsDomainEvent` union; PascalCase per existing academics convention (B.2.2 migration to snake-dotted is V1.5) |
| 8 (semantic) | No archetype branching in service code | `assertExamTypeAllowedForArchetype` reads archetype via `TenantMetadataReader` + calls `getArchetypeDefaults().examPattern.includes(examType)`. **Data-driven lookup, NOT `if (archetype === 'PABSON')` branching.** Sprint plan §1.5 grep-zero phrasing was overstated — actual invariant is "no implicit branching", which A.3 satisfies (same pattern D.1 shipped). |
| 11 | Ed-Fi extension namespace `edforge:` | No new descriptors added; reuses `examPatternKeySchema` (Sprint 0.4) + `academicSubjectSchema` (Sprint A.2.1) + `courseSubjectAreaSchema` |
| 12 (GSI casing) | Lowercase per S3.2 | All 7 new GSI keys (Exam 2, ExamCourse 2, ExamScore 3) start with lowercase prefix. Inline regression guards in entity specs. |
| 13 | No pilot names in code | A.3.11 smoke accepts `PILOT_ID` + `TENANT_ID` + `SCHOOL_ID` + `ACADEMIC_YEAR_ID` + `TERM_ID` env vars; pre-flight fetches Courses dynamically; synthetic enrollmentIds via `uuid()`. Grep stays clean. |

### Decisions captured + V1 limitations documented

1. **Service-side enrollment FK validation deferred to V1.5.** Bulk handler stores `studentId='unknown'` placeholder; single-write attempts GSI lookup + falls back. Cross-AY transcript via GSI2 won't surface bulk-written scores until A.4 ResultCard aggregation joins by `enrollmentId`. Plan §5 R-A3.6 + service inline comments.
2. **No academics `module-wiring.spec.ts`** (Sprint 0.3 scope). Post-deploy ECS log sanity confirmed `ExamsModule dependencies initialized` cleanly (R-A3.2/R-A3.4 mitigation).
3. **`passingMarks = 32` PABSON CDC default** baked into `ExamCourse.passingMarks` Zod default; operator-overridable per ExamCourse. Widening to `SchoolConfiguration.gradingScale` FK is V1.5.
4. **`published` is terminal in V1.** Un-publish requires inline-IAM op pattern (b) from memory `feedback_just_ask_for_a_prod_token`; not exposed via API.
5. **Bulk idempotency via scan-with-filter** (per plan §5 R-A3.6 — no GSI4 by correlationId). Acceptable for ≤250 items per bulk; V1.5 if scale demands.
6. **Cleanup leaves ExamCourse + ExamScore orphans** under soft-deleted Exam (state-machine gate on child DELETE after published). Acceptable for dev-pabson-primary V1 scale; documented in smoke script.

### Ship-cycle lessons (mid-sprint discovery, documented for future)

#### L1 — `tenant-api-prod.json` changes REQUIRE `cdk deploy shared-infra-stack` (gap in Phase 2 ladder)

Phase 2 deploy ladder did ECR build + ECS roll only. The new `/academics/exams*` paths added to `tenant-api-prod.json` reached the repo but **never deployed to live API Gateway** until I caught it during the Phase 3 smoke (P1 returned `403 SigV4` — classic API-GW-route-missing pattern per memory `edforge_api_gateway_route_registration`).

**Root cause:** CLAUDE.md change-to-deploy matrix is explicit: "API Gateway route (`tenant-api-prod.json`) → `shared-infra-stack` → wrapper". My Phase 2 deploy ladder in `a3-sprint-plan.md` §7 missed listing this step.

**Resolution:** `cdk deploy shared-infra-stack` (223s) post-Phase-2-merge. 8 path entries live; API GW deployment hash rotated.

**Forward rule:** any sprint plan that modifies `tenant-api-prod.json` MUST list `cdk deploy shared-infra-stack` as an explicit deploy step. Sprint A.3 plan §7 will be cross-referenced in future EPIC-A/D sprint planning.

#### L2 — NestJS POST returns 201 (Created), not 200; smoke assertions must accept 2xx

The original A.3.11 smoke had `status === 200` strict checks on the bulk-write + retry endpoints. Both responses were semantically perfect (`totalCreated=10`, `alreadyProcessed=true`, etc.) but failed the assertion because Nest returned 201. PR [#159](https://github.com/shoaibrain/edforge/pull/159) relaxed to `status >= 200 && status < 300`.

**Forward rule:** smoke-script status assertions check `2xx range`, not specific code, unless the test specifically asserts on the code semantic (e.g. 204 for DELETE, 409 for state-machine reject).

#### L3 — `shared-infra-stack` CFN template at 86% of 1MB limit

CDK reported: `Template size is approaching limit: 863276/1000000`. Each new top-level API GW path adds ~9000 chars. With ~12 more EPIC-A/D sprints adding 5-8 paths each, the limit will be hit.

**Forward rule:** within 1-2 sprints, factor out a `shared-api-routes-stack` (or similar) to host route definitions separately. Tracked as a TODO for the next stack-architecture review.

#### L4 — Smoke catches what entity specs cannot

Phase 2 entity specs + state-machine spec (51/51 green) verified the data layer but did NOT exercise the API surface. Two real-world issues only surfaced in the live smoke:
- Wrong table-name env var in bulk handler (caught + fixed pre-merge during the thorough review)
- Wrong enrollment endpoint path (caught + fixed mid-smoke)

**Forward rule:** for any sprint that adds new service code, the Phase 3 parametric smoke is the integration safety net. Unit tests cannot catch routing + cross-service contract issues.

### Backlog surfaced (NOT in scope for A.3)

- **Cross-AY transcript completeness** — bulk-written ExamScores currently carry `studentId='unknown'` because bulk handler skips enrollment FK lookup; GSI2 student-centric query won't surface them. **A.4 ResultCard aggregation will fix this** by joining via `enrollmentId` + ExamCourse references. Document for A.4 design.
- **`module-wiring.spec.ts` for academics** — Sprint 0.3 still pending. Each new module added (Exams now) increases blast radius if not caught at unit-test level. R-A3.4 mitigation (ECS log sanity) works but is post-deploy.
- **`shared-infra-stack` template size** — 86% of CFN 1MB; will need split before adding ~10 more top-level routes.
- **`a3-sprint-plan.md` §1.5 phrasing** — "grep `archetype` → zero hits" is too strict; actual rule is "no implicit archetype branching". Future sprint plans should use the latter phrasing.
- **Module-wiring spec for the new ExamsModule** — ECS log sanity proves it boots, but a static module-wiring spec would catch DI gaps at build time. Sprint 0.3 scope.

### Dependency graph — next up

```
A.3 (DONE) → A.4 (Result Subsystem; needs A.3 + D.1 — both DONE)
                ↓
                → C.4.3 Report Card render (needs A.4.2 ResultCard entity)
                → D.2.5 Promotion eval (needs A.4.2 ResultCard for academic-pass logic)
                → D.4.6 / D.5.4 ExternalExamResult import (denormalizes ResultCard.courseScores[])

A.3 (DONE) → D.3 (ExternalAssessment family; needs A.2.1 Course descriptor — DONE) →
                D.4 BLE / D.5 SEE / D.6 NEB-11/12
```

**Recommended next sprint candidates** (per critical-path leverage):
1. **A.4 Result Subsystem** — closes the Operate → Distribute pipeline. Highest immediate downstream value (unblocks Report Card render + PromotionRule eval + ExternalExamResult). 7 tickets.
2. **D.2 PromotionRule** — unlocks cross-year handoff + D.4.8/D.5.5 promotion rules. 12 tickets.
3. **D.3 ExternalAssessment family** — foundation for D.4/D.5/D.6. 7 tickets.
4. **C.1 + C.2 Branding + Renderer** — starts the Distribute chain.
5. **A.1 Daily-Use Coverage** — small operator-visible polish (3 tickets).

A.4 is the natural critical-path continuation.

---

## Sprint A.2 — Course Extension + CDC Curriculum Foundation (V1 Master EPIC — first EPIC-A sprint)

**Closed:** 2026-05-22
**Goal:** Extend the `Course` entity with curriculum-specific descriptors (`academicSubject`, `stateSubjectCode`, `curriculumRef`) so downstream EPIC-A (Exam → Result) + EPIC-D (BLE/SEE/NEB) sprints can reference the Ed-Fi V6 descriptor on Course rather than building a separate Subject entity. Seed the PABSON CDC NCF 2076 catalog (Grades 4-10) as Edge data + backfill dev-pabson-primary.
**Outcome:** All 5 tickets (A.2.1–A.2.5) shipped to prod across 3 PRs. shared-types `0.56.0` published; academics ECS rolled (image `sha256:5982b8…`); A.2.5 backfill executed on dev-pabson-primary with 17 creates + 4 patches, idempotency proven on re-run (19 SKIP + 2 documented WARN). Sprint plan + Core/Edges architecture principle codified at `docs/pilot-greenlight/a2-sprint-plan.md` §1.5. Unblocks ~28 downstream V1 tickets: A.3 Exam Subsystem, A.4 Result Subsystem, D.3 ExternalAssessment family, D.4 BLE / D.5 SEE / D.6 NEB-11/12.

### Tickets

| Ticket | PR | Status |
|---|---|---|
| A.2.1 — Course entity + `AcademicSubjectDescriptor` (15 values) + `curriculumRef` + `stateSubjectCode` | [#152](https://github.com/shoaibrain/edforge/pull/152) (Phase 1) + [#153](https://github.com/shoaibrain/edforge/pull/153) (Phase 2 entity side) | ✅ shipped; existing `courseSubjectAreaSchema` (Ed-Fi V6 rollup) untouched — coexists with the new granular descriptor |
| A.2.2 — Course CREATE/PATCH validation pass-through (Zod pipe at controller layer enforces enum; service is pass-through) | [#153](https://github.com/shoaibrain/edforge/pull/153) | ✅ shipped |
| A.2.3 — `subjectArea` ↔ `academicSubject` dual-write mapper (one-way granular → coarse; reverse intentionally not provided — ambiguous) | [#153](https://github.com/shoaibrain/edforge/pull/153) | ✅ shipped; pure function, 18 spec assertions covering all 15 descriptor values |
| A.2.4 — PABSON CDC NCF 2076 Course catalog seed (21 templates, Grades 4-10; Grades 1-3 V1.5; Grades 11-12 Sprint D.6) | [#152](https://github.com/shoaibrain/edforge/pull/152) | ✅ shipped; `PABSON_COURSE_CATALOG` exported from `@aibrains/shared-types` |
| A.2.5 — dev-pabson-primary Course backfill (authenticated API-based; dry-run + apply + idempotency re-check) | [#154](https://github.com/shoaibrain/edforge/pull/154) | ✅ executed against school `4209e3d8-…` (emis 888888888); 17 CREATE + 4 PATCH all OK; idempotent re-run = 19 SKIP + 2 WARN (documented `NCF-MATH-G910` ↔ `NCF-OPMATH-G910` overlap); deploy log local at `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/dev-pabson-backfill-courses-20260522-202352-46e04c5.log` |

### Deploy artifacts

- `@aibrains/shared-types` `0.55.0` → `0.56.0` on npm
- academics ECR image `sha256:5982b839f5dced1a66d2789be6c90f8cd0e31717b4661abf84053e83ae9941d9` tagged `ff704e3-20260523005253` + `:latest`
- academics ECS deployment `ecs-svc/2788486331947289791` on `prod-basic/academicsbasic` (ap-south-1) — `rolloutState: COMPLETED`, steady state at 20:00:01
- AdminWeb jsdom bundle sim passed (`main.feea19a4.js`, root HTML 1056 chars) — AdminWeb pin stays `^0.40.0` (no behavior change in A.2; controlplane redeploy not needed)
- dev-pabson-primary backfill against school `4209e3d8-d2e2-4e0e-9961-790341c264f4` in tenant `21aea5da-511f-4dfa-a6f2-6971f63a719f`

### Architecture invariants preserved

| # | Invariant | A.2 evidence |
|---|---|---|
| 5 | `auditedWrite()` on every write | Existing courses.service.ts audit/event pattern unchanged; new fields ride through same path |
| 6 | Domain event registry | `course.created` + `course.updated` events fire on POST/PATCH per existing emit-sites; payload structure unchanged (new fields are additive on Course entity, not on event schema) |
| 8 | No code branches on `tenant.archetype` | A.2.2 + A.2.3 service code reads enums only; PABSON catalog lookup happens in the BACKFILL SCRIPT (under `scripts/`), not in academics src. `grep -rn 'archetype' server/application/microservices/academics/src/` stays clean. |
| 11 | Ed-Fi extension namespace `edforge:` is the only place new descriptors land | `AcademicSubjectDescriptor` is a Core Ed-Fi V6 concept (descriptor on Course; per research artifact §2.1). `curriculumRef` enum was already in shared-types from Sprint 0.4. No new `edforge:` descriptors added. |
| 13 | No pilot-specific names in code | Backfill script accepts `--tenant-id`/`--school-id` env vars, never hardcodes Saraswati or any pilot ID. PABSON catalog lives in `archetype/` (allowed pattern, archetype-scoped not pilot-scoped). Grep across the 6 new files returns zero `saraswati` / `pabson-saraswati` hits. |

### Architecture principle codified (load-bearing for downstream EPIC-D)

§1.5 of the sprint plan made the **Core Ed-Fi V6 + Edges by archetype** discipline explicit:
- **Core (archetype-blind):** descriptors in `packages/shared-types/src/descriptors/`, schemas in `packages/shared-types/src/schemas/academics/`, service code in `server/application/microservices/academics/src/courses/`. None of this reads `tenant.archetype`.
- **Edge (archetype-scoped):** catalogs + seeds in `packages/shared-types/src/archetype/`. PABSON Course catalog lives here. Future archetype-specific data (BLE CDC rubric in D.4.2, SEE 25/75 weight in D.5.2, NEB stream electives in D.6) follows the same pattern.
- **Operator tooling:** `scripts/backfill-pabson-courses.ts` reads Edge data + writes Core entities via authenticated API. Same pattern applies to future archetype-specific backfills.

Every downstream EPIC-D sprint should reference this principle. Getting it right in A.2 prevents archetype-bleed in 28 downstream tickets.

### Decisions captured

1. **Service-side auto-derive deferred.** Master plan A.2.3 literal text called for `createCourse` to auto-derive `subjectArea` when absent + `academicSubject` provided. Since `subjectArea` remains REQUIRED at the API in V1, that auto-derive would be dead code at the service layer. Mapper function exists + is spec'd + is consumed by A.2.5 backfill. Auto-derive can land V1.5 if `subjectArea` relaxes to optional via Zod refinement.
2. **GSI on `Course.curriculumRef` deferred.** Not pilot-scale needed (per-school partition scan with filter handles ≤100 courses/school). Add post-pilot-2 if multi-tenant aggregate queries demand it. Documented in sprint plan §2 out-of-scope.
3. **Prod Saraswati Course backfill out of scope.** Per CEO 2026-05-22: prod Saraswati school has no Course data yet. A.2.5 targets `dev-pabson-primary` only in V1. Operator will create courses via UI when ready to onboard the Term-1 exam workflow.
4. **No specs in `scripts/`.** Existing repo convention: `scripts/backfill-*.ts` ship without specs; operator dry-run review IS the test. Initial `backfill-pabson-courses.spec.ts` was deleted to match.

### Edge cases documented

- **Catalog grade-band overlap on shared derived `subjectArea`:** `NCF-MATH-G910` (Compulsory Math) and `NCF-OPMATH-G910` (Optional Math) both derive to `subjectArea='mathematics'` + span Grades 9-10. After apply, each template's matcher sees BOTH rows as candidates → WARN on idempotency re-run. Both rows correctly exist with different `academicSubject` values. Operator disambiguates manually if ever needed. Not a bug — known data-model artifact.
- **Dual-targeting on single-match PATCH:** On the pre-apply diff, `NCF-SCI-G45` + `NCF-SCI-G68` both single-matched `SCI001` (which spans G5,6,7); each queued a PATCH targeting the same row. Second PATCH wrote the same `academicSubject='science'` value — idempotent no-op functionally, 2 extra audit rows per affected row. Documented in script docstring + PR #154 description.

### Backlog surfaced (NOT in scope for A.2)

- **6 pre-existing failing academics test suites** (queryGSI signature drift in `listCourses` + grades-spec mock setup) untouched per memory `project_grade_level_fix_sprint_closed`. Tech-debt cleanup eligible for a separate sprint.
- **AdminWeb / saas-frontend academics MFE UI for the 3 new Course fields** — not wired; deferred until operator UI demand surfaces. AdminWeb pin stays at `^0.40.0`.
- **Prod Saraswati backfill** — when Saraswati's operator onboards Term-1 exam workflow, run the same `scripts/backfill-pabson-courses.ts` against the prod Saraswati tenant + school. Or operator creates via UI.
- **Service-side auto-derive of `subjectArea`** — V1.5 candidate if `subjectArea` ever relaxes to optional.
- **`stateSubjectCode` authoritative CDC code population** — V1 best-guess scope left this undefined. Operator populates per-course when source doc is in hand.

### Dependency graph — next up

```
A.2 (DONE) → A.3 (Exam Subsystem; needs A.2 + D.1 — both DONE) → A.4 (Result Subsystem; needs A.3 + D.1)
A.2 (DONE) → D.3 (ExternalAssessment family; needs A.2.1 for Course.academicSubject FK) → D.4 BLE (needs D.1 + D.3) / D.5 SEE (needs D.3 + D.2) / D.6 NEB-11/12 (needs D.3)
```

Critical-path candidates for next sprint pickup (per memory `project_sprint_a2_shipped_prod` follow-ups):
- **A.3 Exam Subsystem** — natural EPIC-A continuation; ExamCourse + ExamScore + state machine; ~11 tickets
- **D.2 PromotionRule** — unlocks cross-year handoff (D.2.7–12) + D.4.8 + D.5.5 promotion rules; ~12 tickets
- **C.1 School Branding** — starts EPIC-C (Document Rendering) chain; parallel-eligible
- **A.1 Daily-Use Coverage** — small operator-visible polish; audit-driven

---

## Sprint E.0 — IEMIS Reporting Schema Extensions (V1 Master EPIC — third execution sprint)

**Closed:** 2026-05-22 (PM Phase 7 deploy window)
**Goal:** Land three additive schema extensions on existing entities to unblock Sprint E.1 (Flash I/II) and v3.4.1-expanded Sprint D.3.1 (`ExternalExamRegistration.municipalityId` FK).
**Outcome:** All 3 tickets shipped to prod via PR #138. Phase 7 deploy window also closed the **Sprint 0.4 deferred work** (shared-infra-stack + rproxy) that was Docker-blocked in the AM session. Both sprints now fully on prod.

### Tickets

| Ticket | PR | Status |
|---|---|---|
| E.0.1 — `Student.hasEcedExperience` (Flash I Grade 1 entrant flag) + IEMIS transformer (4 alias columns; 14 new specs) | [#138](https://github.com/shoaibrain/edforge/pull/138) | ✅ shipped to prod (academics image sha256:a672904b) |
| E.0.2 — `SchoolConfiguration.municipalityConfig` (per-school municipality binding; FK target for D.3.1 + render input for D.4.5) | [#138](https://github.com/shoaibrain/edforge/pull/138) | ✅ shipped (identity image sha256:72e4d097); live smoke verified PATCH + GET round-trip on Sunshine Private Academy (dev-pabson-primary) |
| E.0.3 — `Student.scholarshipAmountNpr` (Flash II col 7; optional; harmless if IEMIS rejects) | [#138](https://github.com/shoaibrain/edforge/pull/138) | ✅ shipped |

### Phase 7 deploy artifacts (also CLOSED Sprint 0.4 deferred items)

- shared-types `0.53.0` published
- identity image `sha256:72e4d097da9980baff155e71d2b2de12c3e61d7b735c50aeae613be4d420c965`
- academics image `sha256:a672904ba1261c5dc8470052a95ef0f65b69a3f23ac041e3f200300fb20ba71d`
- shared-infra-stack deployed (213s) — `/archetype-defaults` API GW path live
- rproxy image `sha256:a66d65c42e08f1a9877ef40d053296032813d666b77610a5b1bbf02c817eef4c` — nginx `^/archetype-defaults` location block live
- All services-stable; sanitized deploy evidence belongs in [INDEX.md](../deploys/INDEX.md)

### Architecture invariants preserved

| # | Invariant | Evidence |
|---|---|---|
| 5 | `auditedWrite()` on every write | Existing `computeFieldChanges` + audit emit path covers new `municipalityConfig` automatically |
| 6 | Domain event registry | Existing `school.configuration.updated` payload covers new field |
| 8 | No service-code archetype branches | Pure schema extension; lint stayed clean |
| 12 | Lint script gating | ✅ 29 files scanned; same allowlist as Sprint 0.4 |

### Live smoke results

`GET /archetype-defaults?archetype=PABSON` → 200 OK with full PABSON profile (NG + Forms-7/2/19-excluded + BLE-supplementary all verified).

`PATCH /schools/3c28654f-c623-449b-8211-67c729784d37/configuration` with `municipalityConfig` payload → 200 OK on Sunshine Private Academy in dev-pabson-primary tenant; independent GET confirms persistence + no other field clobbered.

### Retros from Phase 7

- **Two prod deploys in one day on a single SHA is fine** when the second closes the first's deferred work; capture rollback markers at both windows
- **Docker recovery from 2026-04 + 2026-05-22 AM is repeatable:** `docker builder prune -af` reclaims 21-28 GB consistently
- **CDK shared-infra-stack diff was clean** — only 1 new path + expected RestApi/Deployment refresh; no Cognito/IAM/VPC drift
- **rproxy ECS roll is slowest** (~9 min vs ~4-5 for identity/academics); document for ops planning
- **Cognito 1h JWT TTL caught us** (memory R12); refresh just before smoke

### Sprint partial-ship debt cleared

The 2026-05-22 (AM) Sprint 0.4 entry noted three deferred items: shared-infra-stack redeploy, rproxy ECR/ECS, external HTTP smoke verification. **All three closed in this PM window.**

### Dependency graph — next up

Per v1-master-epic-breakdown.md §12: **Sprint E.1** (Flash I/II MVP) is the next execution target. Consumes Sprint E.0 schema extensions (hasEcedExperience for Flash I col 14; scholarshipAmountNpr for Flash II col 7; municipalityConfig for per-school CSV header overrides) + Sprint 0.4 ArchetypeDefaultsService via DI.

---

## Sprint 0.4 — `ArchetypeDefaults` Entity (V1 Master EPIC — second execution sprint, partial-ship)

**Closed:** 2026-05-22
**Goal:** Land the per-archetype academic-policy defaults foundation that all of EPIC-D depends on (D.1 GradingPolicy + D.2 PromotionRule + D.3-D.6 ExternalAssessment family).
**Outcome:** All 6 tickets shipped to main; identity ECR + ECS roll complete on prod; ArchetypeDefaultsService fully functional for service-to-service DI consumption. `GET /archetype-defaults?archetype=` HTTP endpoint deferred-deploy (shared-infra-stack redeploy needed; blocked this session by Docker containerd I/O error — same root cause as the 2026-04 incident). Sanitized deployment evidence belongs in [`docs/deploys/INDEX.md`](../deploys/INDEX.md).

### Tickets

| Ticket | PR | Status |
|---|---|---|
| 0.4.1 — Zod schema + supporting subschemas | [#136](https://github.com/shoaibrain/edforge/pull/136) | ✅ shipped to prod (shared-types 0.52.0 + identity image) |
| 0.4.2 — PABSON profile seed (incl. v3.4.1 NG letter-grade + v3.4 D.4.0 BLE supplementary + v3.4 E.1.0 §7 Forms 7/2/19 EXCLUDED) | [#136](https://github.com/shoaibrain/edforge/pull/136) | ✅ shipped |
| 0.4.3 — GENERIC profile seed (Sprint F.2 archetype-agnostic proof target) | [#136](https://github.com/shoaibrain/edforge/pull/136) | ✅ shipped |
| 0.4.4 — ArchetypeDefaultsService (loader, cache, fail-loud) + module + 8 specs | [#136](https://github.com/shoaibrain/edforge/pull/136) | ✅ shipped |
| 0.4.5 — `GET /archetype-defaults` controller + 5 specs + three-way handoff | [#136](https://github.com/shoaibrain/edforge/pull/136) | ⏳ **partial** — Nest controller deployed; API GW + nginx rproxy deferred |
| 0.4.6 — Invariant 12 lint script + 29-file empirical allowlist + bash 3.2 compat | [#136](https://github.com/shoaibrain/edforge/pull/136) | ✅ shipped |

### Deploy artifacts

- shared-types `0.52.0` — published to npm (user-executed)
- identity image `sha256:3aa98441f9cc284f0d185c821e01a2064378551dfee47829bddb565d40251e74` tagged `b166767-20260522162512` + `:latest`
- ECS `prod-basic/identitybasic` rolled to new image; service stable 2026-05-22 11:30:49 CDT
- Logs: `prod-build-application-identity-20260522-112504-b166767.log` + `prod-ecs-roll-identitybasic-20260522-112621-b166767.log` + `prod-smoke-archetype-defaults-20260522-…-b166767.log` + `prod-cdk-diff-shared-infra-stack-20260522-113546-b166767.log` (failed; documented as deferred)

### Architecture invariants preserved

| # | Invariant | Evidence |
|---|---|---|
| 5 | `auditedWrite()` on every write | n/a — read-only static data |
| 6 | Domain event with registry schema | n/a — no domain actions |
| 8 | No service-code archetype branches | New module is data-driven; lint enforces |
| 11 | Ed-Fi extension namespace `edforge:` | n/a — no new descriptors |
| 12 | Lint script ships in this sprint | ✅ `check-invariant-12.sh` + 29-file allowlist; runs in CI |
| 13 | No pilot-specific names | Profile names `PABSON` / `GENERIC` only |

### Backlog surfaced (NOT in scope for 0.4)

- **shared-infra-stack redeploy** — needed to expose `GET /archetype-defaults` via API GW. Blocked this session by Docker containerd I/O error during CDK synth (Python Lambda build for CognitoAuth in control-plane-stack). Pick up at next Docker-healthy session.
- **rproxy ECR push + ECS roll** — nginx.template has the new `^/archetype-defaults` location block but rproxy hasn't been rebuilt. Same redeploy window as API GW.
- **2 pre-existing PABSON branches in `schools.service.ts`** — allowlisted as `(T)` tech debt during 0.4.6 empirical scan. Lines 214 + 367. Should be migrated to data-driven via `ArchetypeDefaults.complianceForms.includes('IEMIS_FLASH_I')` or per-archetype validation rule registry. Phase D refactor backlog item.

### Retros from this sprint window

- **`build-application.sh` must be invoked from `scripts/` directory.** First attempt from repo root failed `cd: ../server/application: No such file or directory`. Memory `project_grade_level_fix_T4_shipped.md` notes this; pattern re-confirmed.
- **bash 3.2 compat matters on macOS.** First version of `check-invariant-12.sh` used `mapfile` (bash 4+). Rewrote with `while IFS= read -r line; do array+=("$line"); done < <(...)`.
- **Empirical lint allowlist surfaced 2 pre-existing `archetype === 'PABSON'` branches.** Originally thought identity had zero invariant-8 violations; spot-grep proved otherwise. Allowlisted as (T) instead of refactoring mid-sprint.
- **API Gateway route deploys are a separate ladder rung from ECS rolls.** Memory `edforge_api_gateway_route_registration` says "403 SigV4 = API GW route missing." Three-way handoff lands all 3 files in the same PR, but DEPLOYING all 3 layers takes 2 deploy events (ECS push + shared-infra-stack redeploy). This session caught the ECS half but Docker-blocked the API GW half.
- **Docker containerd I/O errors recur** when disk pressure approaches the snapshot DB limits. Same root cause as the 2026-04 prior session. Symptom + fix pattern is now stable: free disk + restart Docker + `docker builder prune -af`.

### Dependency graph — next up

Per v1-master-epic-breakdown.md §12: **Sprint E.0** (NEW v3.4 — `hasEcedExperience` + `municipalityConfig` + `scholarshipAmountNpr` schema extensions) is the next execution target. These three schema extensions land BEFORE Sprint E.1 Flash I/II MVP and BEFORE Sprint D.4 BLE workflow (E.0.2's `municipalityConfig` is a FK target for the v3.4.1-expanded D.3.1 ExternalExamRegistration entity).

---

## Sprint 0.1 — Operator-Feedback Compounding (V1 Master EPIC — first execution sprint)

**Closed:** 2026-05-22
**Goal:** Close the IEMIS-upload-compounding gaps that would block Saraswati's principal each time she uploaded a new cohort. Per [`v1-master-epic-breakdown.md`](v1-master-epic-breakdown.md) Sprint 0.1, 5 tickets: jobs LIST + transformer extension + descriptor lookup tables + 206-row backfill + job janitor.
**Outcome:** 4 of 5 tickets fully shipped via prior PRs (#131, #132, #133, plus earlier `69969d6` janitor). The fifth ticket (**0.1.3 historical backfill script**) is **reclassified as a deferred data-debt item**, NOT executed as engineering, after two design audits revealed the originally-planned backfill path is not feasible:

### Tickets

| Ticket | Disposition | Evidence |
|---|---|---|
| **0.1.1** — IEMIS jobs LIST endpoint | ✅ Shipped pre-v3.4 | PR #131 (`25500e2`); [`students.controller.ts:350-382`](../../server/application/microservices/academics/src/students/students.controller.ts#L350-L382); route in [`tenant-api-prod.json:9822-9891`](../../server/lib/tenant-api-prod.json#L9822-L9891) |
| **0.1.2a** — IEMIS transformer field extension | ✅ Shipped pre-v3.4 | PR #132 (`6ac5096`); 4 fields (`motherTongueDescriptor`, `sexDescriptor`, `disabilities`, `isTransferred`) populated from XLSX rows in [`iemis-transform.ts:235-315`](../../server/application/microservices/academics/src/students/iemis-transform.ts#L235-L315); 195 LOC new tests |
| **0.1.2b** — IEMIS descriptor lookup tables | ✅ Shipped pre-v3.4 | [`language-descriptor.ts:22-131`](../../packages/shared-types/src/ed-fi/descriptors/language-descriptor.ts#L22-L131) (covers Nepali, Maithili, Bhojpuri, Tharu, Newar, Bajjika, Magar, Doteli, Awadhi, Limbu, Gurung + Devanagari aliases); [`disability-descriptor.ts:18-86`](../../packages/shared-types/src/ed-fi/descriptors/disability-descriptor.ts#L18-L86) (covers 8 CEHRD categories incl. NoDisability with aliases) |
| **0.1.3** — Saraswati 206-row historical backfill | ⚠️ **RECLASSIFIED → deferred data-debt** (not engineering) | See [§17.6 v3.4 breakdown](v1-master-epic-breakdown.md#17-v34-cross-cutting-research-findings--synthesis-new-2026-05-22). Audit revealed: (a) IEMIS import does NOT store the source XLSX (parsed JSON array, in-memory only, discarded post-import); (b) IEMIS import endpoint hard-codes SKIP on duplicate `emisStudentId` rows (no upsert mode). Backfill via re-upload requires new engineering (`mode='upsert'` on the import endpoint, ~half-day). **Decision (CEO, 2026-05-22):** defer; debt surfaces naturally at Sprint E.1.5 pre-flight validation when operator first exports Flash I. Decide remedy then (upsert mode / manual UI / sexDescriptor-only script) with real operator context. |
| **0.1.4** — IEMIS Job Janitor Lambda | ✅ Shipped pre-v3.4 | Commit `69969d6`; [`handler.ts:100-276`](../../server/lib/analytics/lambda/iemis-job-janitor/handler.ts#L100-L276); cron `*/5 * * * ? *` via EventBridge Scheduler; SNS operator-alert wired |

### What this closeout doesn't do (deferred work)

1. **206-row historical backfill** — see 0.1.3 above. Tracked as data-debt; surfaces at Sprint E.1.5 (Flash I/II pre-flight validation). Three remedy paths documented for that sprint to decide between: (i) add `mode='upsert'` to import endpoint, (ii) sexDescriptor-only one-shot script (recovers 1 of 4 fields), (iii) accept debt + submit Flash I with gaps + amend later.
2. **No new engineering branches.** This closeout is a docs-only PR — no NestJS or CDK changes.

### Lessons (for v3.4+ planning hygiene)

- **Always verify "we have the source data" before planning a backfill.** The original 0.1.3 spec assumed XLSX was stashed in S3 — it isn't. Audit-first prevented wasted code.
- **Check the duplicate-handling behavior of any import endpoint before assuming re-upload solves a gap.** Two distinct audits were needed (XLSX stored Y/N → duplicates UPSERT Y/N) to nail down the actual blockers.
- **"Sprint 0.1.3 not done" ≠ "Sprint 0.1 not closed."** 4 of 5 tickets shipped; the 5th was scoped on a wrong assumption; declaring functionally closed with documented debt is the honest call.

### Dependency graph — next up

Per v1-master-epic-breakdown.md §12: Sprint 0.4 (`ArchetypeDefaults` entity) is the next execution target — hard-dep for all of EPIC-D (D.1 GradingPolicy + D.2 PromotionRule + D.3 ExternalAssessment family + D.4 BLE + D.5 SEE + D.6 NEB-11/12).

---

## Sprint C0.c — Event Emission Foundation

**Shipped:** 2026-05-16
**Deployed to prod:** 2026-05-16 (~15:30 UTC) — sanitized deployment evidence belongs in [docs/deploys/INDEX.md](../deploys/INDEX.md)
**Goal:** EventBridge bus + schema registry + emitter integration so invariant 6 ("every domain action emits an event with a registry schema") is enforceable. Per the redirect agreed before C0.c.1, **the plan's framing was overstated** — the SBT EventBridge bus and EventServiceBase publisher already existed and were already wired into every microservice. The real gap was runtime Zod validation of event payloads. This sprint closed that gap.
**Outcome:** All three tickets shipped, plus the publish-gate follow-up. Code on prod across identity / academics / finance; validation gate active; smoke 32/33 (= 2026-05-14 baseline). Sprint C0.e (deferred per operator decision — see [deferred-work.md](deferred-work.md)) and Sprint C1 (pilot fixture engine) are unblocked.

### Tickets

| Ticket | PR | Status |
|---|---|---|
| C0.c.1 — Verify event bus infrastructure (no new stack) | [#73](https://github.com/shoaibrain/edforge/pull/73) | merged |
| C0.c.2 — Domain event taxonomy — 25 Zod schemas | [#74](https://github.com/shoaibrain/edforge/pull/74) | merged |
| Publish + consumer-pin bumps (`@aibrains/shared-types@0.43.0`) | [#75](https://github.com/shoaibrain/edforge/pull/75) | merged |
| C0.c.3 — Runtime event validation in EventServiceBase | [#76](https://github.com/shoaibrain/edforge/pull/76) | merged |

### Demo

- **C0.c.1** — Locked the EventServiceBase contract with 8 new tests (the class had zero coverage before, despite carrying every domain event in prod). Wrote [docs/pilot-greenlight/event-infrastructure.md](event-infrastructure.md) codifying that the SBT bus is canonical (no second bus, no AWS Schema Registry duplicate) and what C0.c.2 + C0.c.3 close.
- **C0.c.2** — 25 Zod schemas in `packages/shared-types/src/events/` covering the V1 universe (school 4, AY 3, term 3, enrollment 4, attendance 2, exam 3, result 1, reporting 2, calendar.block 3). `EVENT_REGISTRY` + `DomainEvent` discriminated union + `validateEvent()` helper. 56 new tests; 444/444 shared-types regression green. Snake-dotted naming (`school.created`) per the plan; existing ~110 PascalCase publishers stay loose-typed and migrate as their owners are touched.
- **C0.c.3** — `publishValidatedEvent(event: DomainEvent)` typed entry point added; `publishEvent` + `publishEvents` now run `validateBeforeEmit` per event. Three branches: registered+valid → emit, unregistered (legacy PascalCase) → log warning + emit (backward compat), registered+invalid → SKIP emit + DLQ hook. 6 new tests covering every branch × single + batch paths.

### Architecture invariants — preserved

| # | Invariant | C0.c evidence |
|---|---|---|
| 5 | Every write goes through `auditedWrite()` | unchanged; this sprint only touches event emission, not the write path |
| 6 | Every domain action emits an event with a registry schema | **closed by C0.c.2 + C0.c.3** — schemas exist, runtime validation fires for registered events, INVALID_PAYLOAD events are routed to DLQ instead of corrupting the bus |
| 7 | No silent fallbacks | the legacy PascalCase branch logs a structured warning surfacing migration debt — not silent |
| 8 | No archetype branching | event schemas are descriptor-driven; consumers route on `reportType: string` etc., not archetype |
| 11 | Ed-Fi extension namespace `edforge:` is the only place new descriptors land | no descriptors added |
| 13 | No pilot-specific names in code | grep across the 13 new files in C0.c.2 + EventServiceBase changes returns zero hits |

### Backlog surfaced (NOT in scope for C0.c)

- **ESLint rule** — plan's "lint asserts every `auditedWrite()` paired with `emitEvent()`" deferred to a follow-up ticket. A proper AST-walking custom rule + tests is ~200-300 lines on its own; splitting kept C0.c.3 reviewable.
- **Deploy ladder for the new runtime validation** — code is on `main` but no microservice has deployed the new EventServiceBase yet. Activation requires identity ECR push + ECS roll (most events live here), then verify CloudWatch logs for unexpected `INVALID_PAYLOAD` entries, then academics + finance. Operator-authorized step, not engineering-blocked.
- **PascalCase → snake-dotted migration** for the ~110 existing publishers (`IdentityEventsService.publishSchoolCreated` → emit `school.created` etc.). Migrate per-domain as future sprints touch their owners (C5 exam, C7 result, C9 enrollment promotion, etc.). Each migration is a small backwards-compat-safe rename + schema-fixture-rewrite per call site.

### Dependency graph — next up

```
C0.a (DONE) → C0.c (DONE) → C0.e (compliance declarations, can parallel C1) → C1 (pilot fixture engine) → C2 (greenlight gate)
```

Either C0.e or C1 can start now. C0.e has policy / legal lead time; C1 is the critical-path engineering work.

---

## Sprint C0.a — Calendar-Blocking Verifications

**Shipped:** 2026-05-15
**Goal:** Verify prerequisites for calendar fidelity work are already in place. Anything not verified is fixed here.
**Outcome:** All three tickets shipped. Sprint C0.c (event emission foundation) is unblocked per the §7 dependency graph.

### Tickets

| Ticket | PR | Repo | Status |
|---|---|---|---|
| C0.a.1 — Verify S0.2 `School.academicCalendarType` removed | [shoaibrain/edforge#70](https://github.com/shoaibrain/edforge/pull/70) | server | merged |
| C0.a.2 — Verify S0.4 `calendarSystem` in `SchoolConfiguration` response | [shoaibrain/edforge#71](https://github.com/shoaibrain/edforge/pull/71) | server | merged |
| C0.a.3 — D1.4 BS converter dedupe in frontend | [shoaibrain/edforge-saas-frontend#59](https://github.com/shoaibrain/edforge-saas-frontend/pull/59) | frontend | merged |

### Demo

- **C0.a.1 + C0.a.2:** four new cross-service spec files in `server/application/microservices/identity/src/__tests__/c0-a-1-*.spec.ts` + `c0-a-2-*.spec.ts` lock the S0.2 and S0.4 response contracts at the integration level. 9 new tests, all green. Existing 63 schools-service tests still green — no regressions.
- **C0.a.3:** frontend `packages/date-utils/` no longer carries a local BS lookup table. `adToBS` / `bsToAD` / `getDaysInBSMonth` are now thin wrappers around `@aibrains/shared-types`' `gregorianToBs` / `bsToGregorian` / `getBsMonthDays`. The 49-test `converter.test.ts` suite passes byte-equal under the new implementation (including 7 round-trip dates + 9 known AD↔BS pairs + the `getDaysInBSMonth(9999, 1) === 30` silent fallback). Existing consumers (`DateDisplay`, `BSDateInput`, attendance dashboard, calendar layout, header) compile + run unchanged.

### Architecture invariants — preserved

| # | Invariant | C0.a evidence |
|---|---|---|
| 4 | Dated entities accept BS or AD on input | C0.a.3 preserves the local converter's TZ-safety via the `T12:00:00` parse trick around shared-types' canonical converter. |
| 6 | Every domain action emits an event with a registry schema | No new write paths in C0.a; nothing to emit. C0.c will introduce the registry. |
| 8 | No code branches on `tenant.archetype` | C0.a.2's test names use `'PABSON-shaped'` / `'GENERIC-shaped'` as test descriptors; code paths are identical. |
| 11 | Ed-Fi extension namespace `edforge:` is the only place new descriptors land | No descriptors added. |
| 13 | No pilot-specific names in code | Grep across the three new spec files + the frontend converter changes returns zero hits on `saraswati` / `pabson-saraswati`. Generic identifiers (`tenant-c0a1`, `school-c0a2`, etc.) throughout. |

### Backlog surfaced (NOT in scope for C0.a)

- **S0.2 storage-layer residue** — `School` TS entity, `schoolEntitySchema`, `createSchool` write path, `CONFIG_LOCKED_FIELDS`, `field-governance.ts`, AdminWeb workspace-settings field-lock map all still carry `academicCalendarType`. Stripping requires a data migration (separate ticket, P1 timing per the existing schools.service comments).
- **S0.4 read-source refactor** — `getConfiguration()` reads `calendarSystem` from `school.calendarSystem` (denormalized copy), not from `WorkspaceSettings.regional.defaultCalendarSystem` directly. Drift is prevented by provisioning convention + deprecation warning on `updateSchool`. P1 (per Midnight Lockin decision #3) will strip the school-level field; the C0.a.2 spec then becomes the regression guard for whichever read path replaces it.
- **Bundle size verification for C0.a.3** — left as a backlog item: actual production bundle size delta after Vercel rebuild has not been measured. The local 105-line table deletion is the lower-bound; tree-shaking + shared-types co-bundle in other packages may yield a smaller net delta.

### Dependency graph — next up

```
C0.a (DONE) → C0.c (event emission foundation) → C0.e (compliance declarations) → C1 (pilot fixture engine) → C2 (greenlight gate)
```

C0.c.1 (EventBridge bus + schema registry per tenant) is the immediate next ticket.

---
