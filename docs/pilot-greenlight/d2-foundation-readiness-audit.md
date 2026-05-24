# Sprint D.2 — Foundation Readiness Audit

> **Drafted:** 2026-05-23
> **Companion to:** [`d2-sprint-plan.md`](./d2-sprint-plan.md) Phase 1
> **Purpose:** confirm prerequisite shipped work + flag risks before Phase 2 implementation.

This audit verifies — before Phase 2 (academics service code) lands — that every entity, event, schema, and infrastructure primitive D.2 depends on exists on `main`. A red row here is a Phase 1 blocker.

---

## 1. Hard dependencies (must be on `main`)

| Dependency | Status | Anchor | Notes |
|---|---|---|---|
| **A.4 Result Subsystem** | 🟢 shipped 2026-05-23 | [`project_sprint_a4_shipped_prod`](../../packages/) (memory) + PRs #161/#162/#163/#165/#166/#167 | Provides `ResultCard` entity (keyed by `enrollmentId` per invariant 3), `result.published` event, batch Lambda |
| **D.1 GradingPolicy** | 🟢 shipped 2026-05-22 | [`project_sprint_d1_shipped_prod`](../../packages/) (memory) + PRs #146-#151 | Provides lazy-seed pattern D.2.3 mirrors; `letterGrades[].isPassing` + `isTerminalFail` consumed by D.2.4 evaluator |
| **0.4 ArchetypeDefaults entity** | 🟢 shipped 2026-05-22 | [`project_sprint_e_0_shipped_prod`](../../packages/) (memory) | Phase 1 EXTENDS `archetypeDefaults` schema with `promotionDefaults` (PABSON 35/80, GENERIC 60/90); D.2.3 lazy-seed reads this |
| **R41 CFN headroom recovery** | 🟢 closed 2026-05-23 | [`project_sprint_r41a_shipped_prod`](../../packages/) (memory) + PRs #169/#170/#171 | shared-infra-stack at ~6% of 1MB ceiling; D.2 ~6 new API GW paths well within. Cross-stack export pre-flight rule (CLAUDE.md) applies |
| **Enrollment entity + state machine** | 🟢 pre-existing | [`enrollment.entity.ts`](../../server/application/microservices/academics/src/common/entities/enrollment.entity.ts) + [`enrollment-state-machine.ts`](../../server/application/microservices/academics/src/common/utils/enrollment-state-machine.ts) | Phase 2 EXTENDS both with `priorEnrollmentId` + `promotionDecision` fields + `provisional` status row |
| **academics module-wiring spec** | 🟢 shipped 2026-05-23 (A.4 hotfix PR #163) | [`__tests__/module-wiring.spec.ts`](../../server/application/microservices/academics/src/__tests__/module-wiring.spec.ts) (43 assertions, 11 modules) | D.2 Phase 2 + Phase 3 EXTEND this spec for `PromotionRulesModule` + `PromotionModule` + transition handler — closes [[feedback-module-wiring-invariant]] gap that bit A.4 |
| **Shared-types caret-pin discipline** | 🟢 established | CLAUDE.md per-sprint publish checklist | Phase 1 bumps `server/application/package.json` + `server/package.json` pins same PR |

**Verdict: all dependencies green; no Phase 1 blocker.**

---

## 2. Entity GSIs D.2 reads (no new index required for Phase 1; GSI4 lands Phase 3)

| Entity | Existing GSI | Used by | D.2 ticket |
|---|---|---|---|
| `Enrollment` | **GSI1** (`gsi1pk=tenant#{tid}#school#{schoolId}, gsi1sk=ENROLLMENT#{ay}#{gradeLevel}`) | School-scope enrollments by AY + grade — D.2.5 cohort lookup | D.2.5 |
| `Enrollment` | **GSI2** (`gsi2pk=studentId, gsi2sk=ENROLLMENT#{ay}`) | Student-centric cross-AY query — D.2.11 timeline | D.2.11 |
| `Enrollment` | **GSI4 (NEW — Phase 3)** (`gsi4pk=prior-enrollment#{priorEnrollmentId}, gsi4sk=ENROLLMENT#{ay}`) | priorEnrollmentId-centric lookup — D.2.9 handler + D.2.10 flip | D.2.7 + D.2.10 |
| `ResultCard` | **GSI2** (`gsi2pk=enrollment#{enrollmentId}, gsi2sk=result-card#{ay}#{termId}#{examId}`) | Terminal-card lookup by enrollment — D.2.5 evaluator input | D.2.5 |
| `ResultCard` | **GSI3** (`gsi3pk=exam#{examId}, gsi3sk=result-card#{enrollmentId}`) | All cards for an exam — secondary lookup | D.2.4 (optional) |
| `PromotionRule` | **GSI1 (NEW — Phase 2)** (`gsi1pk=tenant#{tid}#school#{schoolId}, gsi1sk=promotion-rule#{gradeLevel}#{ruleId}`) | school + gradeLevel filter — D.2.2 LIST | D.2.1 |

GSI4 lazy-fills (sparse — only rows with `priorEnrollmentId` set carry the keys). Per §8 #1 of the sprint plan, no backfill needed.

---

## 3. Event chain D.2 wires into

```
operator closes exam (A.3.8)
  → exam.closed (PascalCase ExamStatusTransitioned, detail.toStatus='closed') on SbtEventBus
    → result-batch Lambda (A.4.3)
      → writes ResultCard rows (status='draft')

operator publishes ResultCard (A.4.5)
  → result.published event (Zod schema: packages/shared-types/src/events/result.ts)
    → [D.2.9] in-process @OnEvent handler in academics NestJS
      → if isTerminal: lookup provisional Enrollments by GSI4
        → [D.2.10] atomic provisional → enrolled flip (chunked TransactWriteItems)
```

**Status of each link:**
- ✅ `exam.closed` → result-batch Lambda — wired in [`tenant-template-stack.ts:315`](../../server/lib/tenant-template/tenant-template-stack.ts)
- ✅ ResultCard write — A.4.3 Lambda handler [`result-batch/handler.ts`](../../server/lib/result-generation/lambda/result-batch/handler.ts)
- ✅ A.4.5 `result.published` event emit — [`result-cards.service.ts`](../../server/application/microservices/academics/src/results/result-cards.service.ts) `publish()` method via `publishResultPublished()`
- 🔲 D.2.9 handler (in-process @OnEvent) — Phase 3
- 🔲 D.2.10 atomic flip — Phase 3

---

## 4. Phase 1 contract — what THIS PR ships

Phase 1 PR (this branch `sprint/d2-phase-1-shared-types`) ships:

1. **`packages/shared-types/src/schemas/archetype-defaults.schema.ts`** — new `promotionDefaultsSchema` nested in top-level `archetypeDefaultsSchema`
2. **`packages/shared-types/src/archetype/archetype-defaults.ts`** — PABSON `promotionDefaults: { passingThresholdPct: 35, minAttendancePct: 80 }`, GENERIC `60/90`
3. **`packages/shared-types/src/archetype/archetype-defaults.spec.ts`** — 2 new assertions locking the PABSON + GENERIC values
4. **`packages/shared-types/src/schemas/academics/promotion-rule.schema.ts`** (NEW) — full PromotionRule CRUD shape + promotionDecisionSchema enum
5. **`packages/shared-types/src/schemas/academics/promotion-rule.schema.spec.ts`** (NEW) — ≥40 assertions (positive + boundary + negative + enum + pagination)
6. **`packages/shared-types/src/schemas/academics/promotion-evaluation.schema.ts`** (NEW) — D.2.5 evaluation request/response + D.2.6 commit request/response with refined targetGradeLevel constraint
7. **`packages/shared-types/src/schemas/academics/promotion-evaluation.schema.spec.ts`** (NEW) — ≥20 assertions
8. **`packages/shared-types/src/schemas/enrollment/enrollment.schema.ts`** — `provisional` added to `enrollmentStatusSchema`; `priorEnrollmentId` + `promotionDecision` added to `enrollmentResponseSchema`
9. **`packages/shared-types/src/schemas/enrollment/enrollment.schema.spec.ts`** (NEW) — narrow coverage of D.2 additions only
10. **`packages/shared-types/src/schemas/academics/index.ts`** — barrel adds new modules
11. **`packages/shared-types/src/index.ts`** — re-exports `promotionDefaultsSchema` + `PromotionDefaults` (the academics module is already aggregated via `schemas/*`)
12. **`packages/shared-types/package.json`** — 0.58.0 → 0.59.0
13. **`server/application/package.json`** + **`server/package.json`** — `^0.58.0` → `^0.59.0`
14. **`package-lock.json`** — refreshed via root `npm install`

**Phase 1 does NOT ship service code.** That arrives in Phase 2.

---

## 5. Risks identified in foundation review (carryover or new)

| ID | Risk | Disposition |
|---|---|---|
| R-D2.2 (sprint plan) | Caret-pin trap (R39) | Phase 1 PR bumps `server/application/package.json` + `server/package.json` SAME commit |
| R-D2.3 (sprint plan) | Module-wiring trap | Phase 2 + Phase 3 PR EXTEND existing academics module-wiring spec IN-PR. This is the first sprint where the invariant is enforced from PR-1 not post-incident |
| R-D2.5 / R-D2.6 (sprint plan) | NestJS @OnEvent ordering + EventEmitterModule registration | Phase 3 wires `EventEmitterModule.forRoot()` (if not already present) + module-wiring spec asserts provider registration |
| **NEW (this audit)** | Circular import between `enrollment.schema.ts` and `promotion-rule.schema.ts`? | Checked: enrollment imports `promotionDecisionSchema` FROM promotion-rule.schema; promotion-rule does NOT import enrollment. No cycle. |
| **NEW (this audit)** | Double-export of `promotionDecisionSchema` via both `academics/index.ts` and `enrollment/index.ts`? | Checked: enrollment.schema.ts uses the import locally but does NOT re-export. Single source: `academics/promotion-rule.schema.ts`. No conflict. |

---

## 6. Decision points already resolved (per sprint plan §8)

- **§8 #1 — Enrollment GSI4 sparse:** APPROVED. GSI4 keys set only when `priorEnrollmentId` is set; legacy rows invisible to the index. Phase 3 ships.
- **§8 #2 — `minAttendancePct` source:** APPROVED — added to `archetypeDefaultsSchema.promotionDefaults` in this PR.
- **§8 #4 — In-process @OnEvent for D.2.9:** APPROVED for V1. Phase 3 implements.
- **§8 #7 — `conditional` in V1:** APPROVED — schema accepts the value (audit trail); operationally treated identically to `promoted`.

§8 #3 (cross-service AY lookup), §8 #5 (graduated decision boundary), §8 #6 (attendance recompute), §8 #9 (smoke target), §8 #10 (phase count) all stand as recommended in the sprint plan; revisit at Phase 2 / Phase 3 implementation.

---

## 7. Sign-off check

- [x] All hard dependencies on `main` (§1)
- [x] No GSI conflicts with existing entities (§2)
- [x] Event chain endpoints exist + functional (§3)
- [x] Phase 1 file manifest written (§4)
- [x] Risks identified + mitigations linked (§5)
- [x] Sprint-plan §8 decisions resolved or scheduled (§6)

**Phase 1 is unblocked.** Proceeding with version bumps + lockfile refresh + npm publish.
