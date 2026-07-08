# Sprint D.3 — ExternalAssessment Family (Foundation): Sprint Plan

> **Drafted:** 2026-05-24
> **Revised:** 2026-05-24 (v2 — staff-architect critical review pass; Ed-Fi V6 alignment table, uniqueness-lock pattern, 4×4 state-machine matrix, mapper round-trip contract, rollback plan, validation-layer split)
> **Status:** 🟡 Draft v2 — awaiting sign-off before branch cut
> **Master-plan section:** [`v1-master-epic-breakdown.md`](./v1-master-epic-breakdown.md) §6 Sprint D.3 (lines 1268–1322)
> **Companion precedents:** [`d2-sprint-plan.md`](./d2-sprint-plan.md), [`a4-sprint-plan.md`](./a4-sprint-plan.md), [`a3-sprint-plan.md`](./a3-sprint-plan.md), [`a2-sprint-plan.md`](./a2-sprint-plan.md)

---

## 1. Why this sprint, why now

### Critical-path argument

D.3 is the largest single unblock remaining in the V1 dependency graph. Three downstream board-exam sprints — D.4 (BLE Grade 8, **research-resolved**), D.5 (SEE Grade 10), D.6 (NEB-11/12) — are all gated on the entity family shipped here. Without D.3:

```
D.3 (ExternalAssessment family) ─┬─→ D.4 BLE 9 tickets (research-resolved; ready to execute)
                                 ├─→ D.5 SEE 6 tickets
                                 ├─→ D.6 NEB-11/12 5 tickets
                                 ├─→ C.4 Templates (C.4.3 admit-card render reads `ExternalExamAdmitCard.pdfS3Url`)
                                 └─→ E.2 Discipline soft (E.2 cross-references InternalAssessment for participation rubric)
```

~25 downstream tickets unblock at D.3 ship. Beyond critical path: D.3 closes the **"Exam → External Authority Submission → Result Import → Promotion"** product loop pattern that BLE / SEE / NEB all share — one generic entity family, three concrete archetypes.

### Foundation in place (post-D.2 ship 2026-05-24)

- ✅ `Course` entity with `academicSubject: AcademicSubjectDescriptor` (A.2.1) — D.3.0 `RubricCategory.academicSubject?` references; D.3.2 `InternalAssessment.courseId` FKs against
- ✅ `AcademicSubjectDescriptor` 15-value enum from CDC catalog (A.2.1) — D.3.0 `academicSubject?` validator + D.3.4 `ExternalExamResult.courseResults[].academicSubject`
- ✅ `SchoolConfiguration.municipalityConfig` (E.0.2) — D.3.1 `ExternalExamRegistration.municipalityId` FK target; D.4.5 admit-card render reads logo from this
- ✅ `GradingPolicy` with `NG` letter-grade + `isPassing`/`isTerminalFail` flags (D.1) — D.3.4 `ExternalExamResult.courseResults[].letterGrade` accepts `NG`
- ✅ `Enrollment` entity with `priorEnrollmentId` + cross-AY GSI10 (D.2.7) — D.3.4 + D.3.5 join chain works across AY rollover
- ✅ `PromotionRule` entity (D.2.1) — D.4.8 BLE Grade 8 → 9 rule will read `ExternalExamResult.overallStatus`
- ✅ Module-wiring spec discipline (academics `__tests__/module-wiring.spec.ts` since A.4 incident) — D.3.6 extends this in the SAME PR that introduces the new module
- ✅ R41-mitigated CFN template (~6% of 1MB ceiling) — no Phase 0 headroom gate
- ✅ Shared-types caret-pin discipline (R39) — Phase 1 pattern preserved (bump `^0.59.0` in `server/application/package.json` + `server/package.json` together)
- ✅ Three-way handoff lint (`scripts/check-route-drift.ts`) — D.3 introduces **no controllers**, so handoff is empty; lint passes trivially

### Per §0 philosophy (CEO 2026-05-22)

Product completeness over pilot-fixture work. D.3 is purely **architectural foundation** — six green-field entities, zero controllers, zero API GW routes, zero Lambda. The risk profile is the lowest of any recent sprint. The investment is large only in the sense that it unblocks the largest downstream surface area in V1.

---

## 1.5 Architecture principle — Core Ed-Fi V6 + Edges by archetype (carry-over)

**Same load-bearing discipline.** Every implementation decision below MUST be evaluated against it.

### Statement (unchanged)

EdForge's data model is **Ed-Fi V6 at the Core** (canonical, archetype-blind entities, descriptors, validators, engines) with **archetype-specific Edges at the boundary** (seeds, catalogs, defaults — never inside service code).

### Layer mapping for D.3

| Layer | Lives in | Archetype-aware? | D.3 contributions |
|---|---|---|---|
| **Core — Ed-Fi V6 canonical** | `packages/shared-types/src/schemas/academics/external-exam-*.schema.ts`, `microservices/academics/src/external-exams/`, `microservices/academics/src/common/entities/external-*.entity.ts` | NO — must pass invariant-12 grep clean | All 6 entities are archetype-blind. `examType` is a discriminator (`'BLE' \| 'SEE' \| 'NEB_11' \| 'NEB_12'`), not an archetype branch |
| **Edge — Archetype boundary** | (D.3 does NOT ship any seed; D.4.2 + D.5.x + D.6.x seed `RubricCategory` rows per archetype × examType pairing) | YES — at D.4 onwards | D.3 only ships the SHAPE; D.4 BLE seed lives in `packages/shared-types/src/archetype/ble-cdc-rubric.ts` (separate sprint) |
| **Service runtime** | (D.3 ships NO controllers; D.4 onwards adds them under `external-exams.module.ts` which D.3.6 registers) | NO | D.3 wires the module shell + module-wiring spec entry; concrete service classes land in D.4/D.5/D.6 |

### Specific invariants D.3 enforces

1. **No `tenant.archetype` reads in `external-exams/` src.** Per invariant 12. `examType` discriminator is **not** an archetype branch — every archetype that runs BLE-style exams uses the same `examType='BLE'` entity row.
2. **`Course.courseId` is the FK target for all course-bearing fields.** Per A.2.0 resolution: `D.3.0.academicSubject?` is a descriptor (cross-cutting taxonomy), but `D.3.2.courseId` + `D.3.4.courseResults[].courseId` are FK references to `Course`. No new `Subject` entity; D.3 does not regress this discipline.
3. **`AcademicSubjectDescriptor` enum is the canonical taxonomy.** All `academicSubject?` fields validate against the 15-value enum from A.2.1. No raw strings.
4. **`letterGrade` accepts the full GradingPolicy taxonomy including `NG`.** D.3.4 `courseResults[].letterGrade` is a Zod enum union sourced from `GRADING_POLICY_LETTER_GRADES` (D.1) including `'NG'` (Not Graded — per D.4.0 + D.5.0 research). Schema spec asserts.
5. **`ExternalExamRegistration.status` is a state machine.** Legal: `DRAFT → SUBMITTED_TO_IEMIS → SYMBOL_ASSIGNED` (one-way each); `* → CANCELLED` (one-way terminal). Illegal: any reverse direction; `SYMBOL_ASSIGNED → CANCELLED` rejected at service-layer (operator must un-submit via support flow).
6. **`symbolNumber` is unique within `(examType, examYear)`.** **GSI13 is read-side ONLY** (DDB does not enforce uniqueness on GSI keys; `attribute_not_exists(gsi13pk)` on an UpdateItem only protects the same row). Enforced via a dedicated `EXTERNAL_EXAM_SYMBOL_LOCK` entity (deterministic key `EXT_EXAM_SYMBOL_LOCK#{examType}#{examYear}#{symbolNumber}`) written in the same `TransactWriteItems` as the registration update with `attribute_not_exists(entityKey)` on the lock. Mirror of `PROMOTION_RULE_LOCK` + `EXTERNAL_EXAM_REGISTRATION_LOCK`. Conflict → 409 `SYMBOL_NUMBER_CONFLICT`.
7. **`isSupplementary` is a per-courseResult flag, not a row-level flag.** A student can supplement 1 of 3 failed subjects and pass 2 outright; `ExternalExamResult.courseResults[]` carries the flag per entry. Aggregate `overallStatus` derived from current letterGrades after any supplementary overwrite.
8. **D.3 ships zero controllers + zero API GW routes.** The `external-exams.module.ts` shell exists only for module-wiring + future D.4/D.5/D.6 imports.

### Anti-pattern guardrails (rejected at PR review)

- `if (tenant.archetype === 'PABSON') rubric.weight = 30` → reject (the rubric is read from `RubricCategory` rows that D.4.2 / D.5.x / D.6.x seed per archetype)
- Hardcoded BLE-specific fields on the `ExternalExamRegistration` entity (e.g. `BLEsubjectsList`) → reject (use the generic `courses[]` + `examType` discriminator)
- New `Subject` entity → reject (A.2.0 resolved: extend `Course`; D.3 honors)
- A controller landing in D.3 — reject. Controllers are D.4/D.5/D.6 scope; D.3 is foundation only
- A seed row landing in D.3 (e.g. PABSON RubricCategory rows) — reject. Seeds are D.4 (BLE) / D.5 (SEE) / D.6 (NEB) scope; D.3 ships shape only
- Using GSI11 or GSI12 for symbolNumber reverse-lookup — reject (those slots are reserved for Staff-by-department / Parent-student per `gsi-inventory.md`; D.3 claims **GSI13** instead)
- Mapping `letterGrade` directly to numeric GPA inside the entity — reject (mapper layer, not entity layer)
- Constraining `letterGrade` to a Zod enum union (e.g. `z.enum(['A+', 'A', …, 'NG'])`) → reject. Per D.1 design, `letterGrade` is a free string capped at `max(5)`; runtime validation against the school's active `GradingPolicy.letterGrades[].letter` is service-layer responsibility, not schema. Different archetypes ship different vocabularies (PABSON: A+/A/B+/B/C+/C/D/NG; potential future US archetype: A/B/C/D/F).

### Ed-Fi V6 alignment (canonical concept → EdForge entity mapping)

For each new D.3 entity we identify the closest Ed-Fi V6.1+ canonical concept. EdForge entities are named natively (following the A.3/A.4 precedent of `Exam`/`ResultCard` rather than Ed-Fi `Assessment`/`StudentAssessment`), but the docstring on each entity MUST log the Ed-Fi alignment namespace per master-plan §1.5 + the precedent set by `promotion-rule.schema.ts:8`.

| EdForge entity (D.3) | Ed-Fi V6 closest concept | Namespace docstring | Notes |
|---|---|---|---|
| `RubricCategory` | `AssessmentReportingMethod` + `LearningStandardItem` | `edforge:AssessmentItemRubric` | EdForge stores the rubric category once + weight; D.4 maps to per-student score |
| `ExternalExamRegistration` | `StudentAssessmentRegistration` (V6.1) | `edforge:StudentExternalAssessmentRegistration` | EdForge stores `symbolNumber` (Nepal-specific authority artifact); Ed-Fi has no exact analogue |
| `InternalAssessment` | `StudentAssessmentScoreResult` (component portion) | `edforge:InternalAssessmentScore` | Per-(student, course, rubric category) component score; aggregates to the internal-50% portion in D.4 |
| `ExternalExamAdmitCard` | (Nepal-specific; no Ed-Fi analogue) | `edforge:ExternalAssessmentAdmitCard` | Print-artifact entity; pdfS3Url populated by C.4.3 renderer |
| `ExternalExamResult` | `StudentAssessment` + `StudentAssessmentScoreResult[]` | `edforge:StudentExternalAssessment` | `courseResults[]` analogue to `StudentAssessmentScoreResult[]`; `letterGrade` aligns with `PerformanceLevelDescriptor` (free-string, looked up against `GradingPolicy.letterGrades[]`) |
| `ExternalExamRetake` | `StudentAssessmentRegistration` with retake context | `edforge:ExternalAssessmentRetake` | No clean Ed-Fi mapping; we model retake as its own entity, FK-back to original result |
| `ExternalExamRegistrationLock` (NEW v2 — uniqueness lock) | (no Ed-Fi analogue; storage-engine primitive) | `edforge:ExternalAssessmentRegistrationLock` | Mirrors `PROMOTION_RULE_LOCK` pattern (D.2). Deterministic key `(schoolId, studentId, examType, examYear)` enforced via TransactWriteItems + `attribute_not_exists(entityKey)` |

**Why NOT model `ExternalExamSession` / `Assessment` (Ed-Fi `Assessment` analogue):** Considered + rejected during v2 review. Each ExternalExamRegistration carries `examType`, `examYear`, `municipalityId` — but the exam-window dates + subject lists are sourced from `SchoolConfiguration.municipalityConfig` (E.0.2, already shipped) + `archetypeDefaults.boardExams[examType]` (0.4, already shipped). The authority-side state (CEHRD/NEB issues symbolNumbers, sets exam centers) is OUT of EdForge's control surface; modeling it as an internal entity creates a fiction. We import authority decisions into the per-student registration row, not into a parent session.

### Schema-level vs service-level validation split

Each entity ships TWO validation layers; per ticket we MUST be explicit which fact lives where:

| Validation | Lives in | When it runs | D.3 examples |
|---|---|---|---|
| **Shape, format, range, enum membership** | Zod schema | At HTTP boundary (NestJS pipe) | `examType ∈ {'BLE'|'SEE'|'NEB_11'|'NEB_12'}`; `weight: 0–100`; `letterGrade.length ≤ 5`; `courses: string[]` non-empty |
| **FK existence, archetype constraints, uniqueness, state transitions** | Service layer (D.4 onwards) | At write time, before DDB call | `studentId` exists in `Student`; `municipalityId` matches `SchoolConfiguration.municipalityConfig.municipalityId`; `letterGrade` is in the school's active `GradingPolicy.letterGrades[].letter`; state-machine transition is legal |
| **Atomic uniqueness, idempotency, race-safety** | DDB condition expression on lock entities | At write commit | `attribute_not_exists(entityKey)` on `EXTERNAL_EXAM_REGISTRATION_LOCK` (per-student-per-year uniqueness) + `attribute_not_exists(entityKey)` on `EXTERNAL_EXAM_SYMBOL_LOCK` (symbolNumber uniqueness); `attribute_exists(status) AND status = :expected` for state-machine transition. **Never** rely on `attribute_not_exists(gsi13pk)` — DDB GSIs do not enforce uniqueness across rows. |

D.3 ships ONLY Zod schemas + state-machine validator helpers. **D.4 service code wires the FK/uniqueness/atomic-condition layers.** The D.3 plan is explicit on this split so D.4 implementers don't accidentally push validation up into Zod (which the Nest pipe runs synchronously without DB access) or down past DDB conditions (where race-safety breaks).

---

## 2. Scope

### In-scope

| Ticket | Summary | Sized |
|---|---|---|
| D.3.0 | `RubricCategory` entity + Zod schema + factory + mapper | S |
| D.3.1 | `ExternalExamRegistration` entity + Zod schema + state-machine util + factory + mapper + **registration-lock entity (NEW v2)** | M |
| D.3.2 | `InternalAssessment` entity + Zod schema + factory + mapper | S |
| D.3.3 | `ExternalExamAdmitCard` entity + Zod schema + factory + mapper | S |
| D.3.4 | `ExternalExamResult` entity (incl. `courseResults[]` with free-string letterGrade per D.1 + `isSupplementary` per D.4.0) + Zod schema + factory + mapper | M |
| D.3.5 | `ExternalExamRetake` entity (Grade-increment; NEB-only at usage; entity is generic) + Zod schema + factory + mapper | S |
| D.3.6 | `external-exams.module.ts` shell + module-wiring spec extension (R-D3.1 mitigation) | S |
| (implicit) | `gsi-inventory.md` updated to claim **GSI13** sparse — `symbolNumber → ExternalExamRegistration` reverse-lookup | XS |
| (implicit) | `ecs-dynamodb.ts` adds GSI13 sparse definition; CDK deploy required (low-risk; sparse, no backfill) | XS |
| (implicit) | `EntityType` union extended in `base.entity.ts` with **8** new tokens (6 entities + 2 locks) | XS |
| (implicit) | `EntityKeyBuilder` extended with **8** new key functions (6 entities + 2 locks) | XS |
| (implicit) | `enrollment-state-machine.ts` is unchanged (Enrollment state machine is not touched by D.3) | — |

### Out-of-scope (deferred, with reason)

| Item | Why |
|---|---|
| BLE registration controller + endpoints | D.4.1 scope |
| BLE internal-assessment mark entry + CDC rubric seed | D.4.2 + D.4.3 scope |
| BLE IEMIS-CSV export | D.4.4 scope |
| BLE admit-card render trigger | D.4.5 scope (calls C.4.3 renderer + populates `ExternalExamAdmitCard.pdfS3Url`) |
| BLE IEMIS-ledger result import | D.4.6 scope |
| BLE Grade Increment (supplementary) endpoints | D.4.7 scope |
| BLE Grade 8 → 9 promotion-rule data | D.4.8 scope (seeds a PromotionRule row that reads `ExternalExamResult.overallStatus`) |
| SEE-specific seeds / endpoints | D.5 scope |
| NEB-11/12 cumulative GPA logic + Grade-Increment | D.6 scope |
| Synthetic BLE smoke (registration → export → marks → admit-card → result → supplementary → promotion) | D.4.9 scope (uses all D.3 entities through D.4 controllers) |
| `municipalityConfig` PATCH endpoint changes | Already shipped (E.0.2) |
| Frontend UI for any of these entities | Frontend MFE follow-up post-D.4 |
| GSI11 + GSI12 reuse | Reserved for Staff-by-department + Parent-student per `gsi-inventory.md`; D.3 uses GSI13 instead |
| EventBridge events for D.3 entity writes | D.3 ships entities only; no writes happen in this sprint. D.4/D.5/D.6 controllers emit `exam.ble_*` / `exam.see_*` / `exam.neb_*` events at their respective write paths |

### Already-shipped foundation (post-D.2)

- A.2.1 `AcademicSubjectDescriptor` 15-value enum + descriptor validator
- A.2.5 PABSON Course catalog backfilled on dev-pabson-primary (21 Grade-4–10 rows; FK target ready)
- E.0.2 `SchoolConfiguration.municipalityConfig` (municipalityId, municipalityName, municipalityLogoS3Url, exportHeaders) — FK target for D.3.1
- D.1.2 `GRADING_POLICY_LETTER_GRADES` + `NG` token — `letterGrade` validator source
- D.2.7 `Enrollment.priorEnrollmentId` + GSI10 — D.3.4 + D.3.5 join chain across AY
- A.4.2 `ResultCard` keyed by `enrollmentId` + `isTerminalExam` — proves the "per-student × per-exam × per-course" shape D.3.2 + D.3.4 mirror
- `auditedWrite()` + `publishAcademicsEvent()` pattern (academics-events.service.ts) — D.4/D.5/D.6 use this; D.3 ships zero writes
- Existing `external-exams/` directory does **not** exist yet — D.3.6 creates it
- R41-mitigated CFN template — D.3 adds 0 new API GW routes + 1 new GSI (~minimal CFN delta)

---

## 3. PR cadence — 2 phases (smaller than D.2 because no controllers / no smoke)

### Phase 1 — shared-types schemas + specs (1 PR)

**Branch:** `sprint/d3-phase1-shared-types-schemas`

**Files (NEW):**
- `packages/shared-types/src/schemas/academics/rubric-category.schema.ts` + `.spec.ts` (D.3.0)
- `packages/shared-types/src/schemas/academics/external-exam-registration.schema.ts` + `.spec.ts` (D.3.1; includes state-machine validator)
- `packages/shared-types/src/schemas/academics/internal-assessment.schema.ts` + `.spec.ts` (D.3.2)
- `packages/shared-types/src/schemas/academics/external-exam-admit-card.schema.ts` + `.spec.ts` (D.3.3)
- `packages/shared-types/src/schemas/academics/external-exam-result.schema.ts` + `.spec.ts` (D.3.4)
- `packages/shared-types/src/schemas/academics/external-exam-retake.schema.ts` + `.spec.ts` (D.3.5)

**Files (MODIFIED):**
- `packages/shared-types/src/index.ts` — re-export new schemas
- `packages/shared-types/package.json` — bump to `0.59.0`

**Phase 1 DoD:**
- All 6 schema files + 6 spec files green (each spec ≥10 assertions per §1.4 invariant gate)
- `npm view @aibrains/shared-types` shows `0.59.0` post-publish
- `npm install` at repo root succeeds; lockfile committed
- jsdom AdminWeb bundle sim passes (R39 trap mitigation; bundle includes new exports but is non-load-bearing on AdminWeb today)
- No new CDK / no new ECS / no Phase 1 deploy — Phase 1 is publish-only

**Acceptance:** PR carries the 12 new files + lockfile + package.json bump; CI green; merged to main.

### Phase 2 — academics entities + module + CDK GSI13 + ECS roll (1 PR + 2 deploys)

**Branch:** `sprint/d3-phase2-academics-entities`

**Files (NEW):**
- `microservices/academics/src/common/entities/rubric-category.entity.ts` + `.spec.ts` (D.3.0)
- `microservices/academics/src/common/entities/external-exam-registration.entity.ts` + `.spec.ts` (D.3.1)
- `microservices/academics/src/common/entities/internal-assessment.entity.ts` + `.spec.ts` (D.3.2)
- `microservices/academics/src/common/entities/external-exam-admit-card.entity.ts` + `.spec.ts` (D.3.3)
- `microservices/academics/src/common/entities/external-exam-result.entity.ts` + `.spec.ts` (D.3.4)
- `microservices/academics/src/common/entities/external-exam-retake.entity.ts` + `.spec.ts` (D.3.5)
- `microservices/academics/src/common/mappers/rubric-category.mapper.ts` + `.spec.ts`
- `microservices/academics/src/common/mappers/external-exam-registration.mapper.ts` + `.spec.ts`
- `microservices/academics/src/common/mappers/internal-assessment.mapper.ts` + `.spec.ts`
- `microservices/academics/src/common/mappers/external-exam-admit-card.mapper.ts` + `.spec.ts`
- `microservices/academics/src/common/mappers/external-exam-result.mapper.ts` + `.spec.ts`
- `microservices/academics/src/common/mappers/external-exam-retake.mapper.ts` + `.spec.ts`
- `microservices/academics/src/external-exams/external-exams.module.ts` (D.3.6 shell; declares + exports zero providers initially; placeholder for D.4)
- `microservices/academics/src/external-exams/external-exam-registration.state-machine.ts` + `.spec.ts` (D.3.1)

**Files (MODIFIED):**
- `microservices/academics/src/common/entities/base.entity.ts` — extend `EntityType` union with **8** tokens (6 entities + 2 locks) + extend `EntityKeyBuilder` with **8** key functions (6 entities + 2 locks)
- `microservices/academics/src/academics.module.ts` — import `ExternalExamsModule` (R-D3.1 mitigation; landed in same PR)
- `microservices/academics/src/__tests__/module-wiring.spec.ts` — register `ExternalExamsModule` in watchlist (≥7 new assertions; covers the 6 entity types + 1 lock type that are reachable via the module)
- `server/application/package.json` — bump `@aibrains/shared-types` to `^0.59.0`
- `server/package.json` — bump `@aibrains/shared-types` to `^0.59.0` (cd1 trap mitigation per memory `edforge_shared_types_caret_pin`)
- `server/lib/tenant-template/ecs-dynamodb.ts` — add GSI13 sparse declaration (NEW lines mirroring GSI9/GSI10 sparse pattern)
- `docs/pilot-greenlight/gsi-inventory.md` — claim GSI13 in "Claimed in this sprint" + bump next-free slot to GSI14

**Phase 2 DoD:**
- All entity unit specs + mapper round-trip specs + state-machine specs green
- `nest build academics` clean
- `__tests__/module-wiring.spec.ts` green with new module entries — module-wiring invariant honored
- `cdk diff tenant-template-stack-basic` shows GSI13 add only (no other resource churn); pre-flight per CLAUDE.md "Cross-stack export change pre-flight" (none affected; sparse GSI add does not change exports)
- `cdk diff shared-infra-stack` empty (no API GW changes)
- CDK deploy `tenant-template-stack-basic` succeeds (GSI13 ACTIVE on all 3 tables identity/academics/finance; sparse so no backfill needed)
- `aws dynamodb describe-table edforge-academics-basic` confirms GSI13 ACTIVE
- ECR push academics + force-new-deployment academicsbasic; service-stable
- CloudWatch logs show clean Nest bootstrap with `ExternalExamsModule dependencies initialized`
- No live smoke needed (no endpoints to hit); reachability proven by Nest module init + module-wiring spec

**Acceptance:** PR carries the entity + mapper + module-wiring spec + CDK GSI13 add + version-pin bumps; CI green; merged; deploy clean; module-init verified in CloudWatch.

---

## 4. Per-ticket detail (with §1.1 atomic conventions)

### D.3.0 — `RubricCategory` entity + Zod schema

**Files:** Phase 1 (schema) + Phase 2 (entity + mapper).
- NEW `packages/shared-types/src/schemas/academics/rubric-category.schema.ts` + `.spec.ts`
- NEW `microservices/academics/src/common/entities/rubric-category.entity.ts` + `.spec.ts`
- NEW `microservices/academics/src/common/mappers/rubric-category.mapper.ts` + `.spec.ts`

**Entity shape:**
```typescript
export interface RubricCategory extends BaseEntity {
  entityType: 'RUBRIC_CATEGORY';
  categoryId: string;
  schoolId: string;
  examType: 'BLE' | 'SEE' | 'NEB_11' | 'NEB_12';
  academicSubject?: AcademicSubjectDescriptor;     // nullable for cross-subject categories (attendance/conduct)
  categoryName: string;                            // e.g. 'unitTests', 'projectWork', 'participation'
  weight: number;                                  // % of internal-assessment total (e.g. 30 for unitTests)
  archetypeDefaultId?: string;                     // FK to archetype-defaults seed origin (audit)
  cdcReference?: string;                           // free-text link to CDC rubric publication
  isActive: boolean;
  // GSI1: school scope — gsi1pk='TENANT#{tid}#SCHOOL#{schoolId}', gsi1sk='RUBRIC#{examType}#{categoryId}'
}
```

**Schema spec coverage:**
- `examType` accepts the 4 union values; rejects raw strings
- `academicSubject` accepts descriptor enum; rejects raw strings; **nullable** valid
- `weight: 0` valid; `-1` invalid; `100` valid; `101` invalid
- `categoryName: ''` invalid; `'unitTests'` valid
- Round-trip create → response with stable types

**AC:**
- Schema + factory + mapper; module-wiring updated; Ed-Fi alignment: entity extension namespace logged as `edforge:AssessmentItemRubric` in docstring per master plan
- `tenantId` carries bare UUID per memory `edforge_identity_ddb_bare_uuid_partition_key`
- GSI casing lowercase per S3.2

**Deps:** 0.4.1 ✅, A.2.1 ✅.

---

### D.3.1 — `ExternalExamRegistration` entity + state machine

**Files:** Phase 1 (schema) + Phase 2 (entity + state machine + mapper).
- NEW `packages/shared-types/src/schemas/academics/external-exam-registration.schema.ts` + `.spec.ts`
- NEW `microservices/academics/src/common/entities/external-exam-registration.entity.ts` + `.spec.ts`
- NEW `microservices/academics/src/external-exams/external-exam-registration.state-machine.ts` + `.spec.ts`
- NEW `microservices/academics/src/common/mappers/external-exam-registration.mapper.ts` + `.spec.ts`

**Entity shape:**
```typescript
export interface ExternalExamRegistration extends BaseEntity {
  entityType: 'EXTERNAL_EXAM_REGISTRATION';
  registrationId: string;
  studentId: string;
  enrollmentId: string;
  schoolId: string;
  examType: 'BLE' | 'SEE' | 'NEB_11' | 'NEB_12';
  examYear: number;                                // BS year (e.g. 2083)
  examAuthority: string;                           // municipality CEHRD code for BLE; 'NEB' literal for SEE/NEB
  municipalityId?: string;                         // FK to SchoolConfiguration.municipalityConfig.municipalityId
  symbolNumber?: string;                           // assigned post-submission; uniqueness enforced via GSI13 sparse
  examCenter?: string;                             // assigned post-submission
  courses: string[];                               // array of Course.courseId per A.2.0 rename
  registrationDate: string;                        // ISO Gregorian
  status: 'DRAFT' | 'SUBMITTED_TO_IEMIS' | 'SYMBOL_ASSIGNED' | 'CANCELLED';
  // GSI1: cohort query — gsi1pk='TENANT#{tid}#SCHOOL#{schoolId}', gsi1sk='EXT_EXAM_REG#{examType}#{examYear}#{registrationId}'
  // GSI2: cross-AY student view — gsi2pk='TENANT#{tid}#ENROLLMENT#{enrollmentId}', gsi2sk='EXT_EXAM_REG#{examType}'
  // GSI13: sparse symbolNumber reverse-lookup — gsi13pk='SYMBOL#{symbolNumber}', gsi13sk='EXT_EXAM_REG#{registrationId}' (populated only when symbolNumber is set)
}
```

**State-machine transition matrix (4×4 = 16 cells; canonical breakdown: 4 legal transitions + 4 idempotent no-ops + 8 illegal):**

| from \ to | DRAFT | SUBMITTED_TO_IEMIS | SYMBOL_ASSIGNED | CANCELLED |
|---|---|---|---|---|
| **DRAFT** | ◯ idempotent no-op | ✅ submit | ❌ illegal (must go through SUBMITTED_TO_IEMIS) | ✅ operator-cancel |
| **SUBMITTED_TO_IEMIS** | ❌ illegal (forward-only; un-submit is support-flow) | ◯ idempotent | ✅ authority-assigns-symbol | ✅ operator-cancel (rare; support-flow) |
| **SYMBOL_ASSIGNED** | ❌ illegal | ❌ illegal | ◯ idempotent | ❌ illegal (post-assignment cancel requires support-flow with audit-trail; not auto-allowed) |
| **CANCELLED** | ❌ illegal (terminal) | ❌ illegal | ❌ illegal | ◯ idempotent |

**Companion uniqueness-lock entity (mirror of `PROMOTION_RULE_LOCK` from D.2):**

```typescript
export interface ExternalExamRegistrationLock extends BaseEntity {
  entityType: 'EXTERNAL_EXAM_REGISTRATION_LOCK';
  schoolId: string;
  studentId: string;
  examType: 'BLE' | 'SEE' | 'NEB_11' | 'NEB_12';
  examYear: number;
  registrationId: string;                           // FK to ExternalExamRegistration that claimed this lock
}
// entityKey: 'EXT_EXAM_REG_LOCK#{schoolId}#{studentId}#{examType}#{examYear}'
```

D.4 controllers will write the lock + the registration in a single `TransactWriteItems` with `attribute_not_exists(entityKey)` on the lock. Race-safe; one winner per `(schoolId, studentId, examType, examYear)`. Soft-cancel of the registration (transition to `CANCELLED`) MUST also delete the lock so re-registration is allowed.

**Schema spec coverage:**
- `status` accepts the 4 union values; rejects raw strings
- `examType` same
- `examYear` accepts integer in `[2000, 2090]` — matches the supported BS range of the shared `bikram-sambat.ts` converter (`packages/shared-types/src/utils/bikram-sambat.ts:8`). Do NOT introduce a separate BS range constant; reuse the converter's bounds (export from shared-types if a named constant doesn't exist yet). Negative invalid; non-integer invalid; out-of-range values rejected by the same Zod validator that protects every other BS-year field
- `courses: []` valid (empty cohort allowed at schema; service-layer rejects in D.4 with 4xx); `courses` length ≤ 15 (sanity cap)
- `symbolNumber: '' ` invalid (must be ≥1 char or undefined); `undefined` valid
- `municipalityId: undefined` valid (NEB-11/12/SEE leave undefined); `examAuthority='NEB'` literal when `examType ∈ {'NEB_11','NEB_12','SEE'}` (cross-field refinement)
- Round-trip create → response → update → response with stable types

**State machine spec coverage (16 cells; canonical 4 legal + 4 idempotent + 8 illegal):**
- 4 legal transitions green: DRAFT→SUBMITTED_TO_IEMIS, DRAFT→CANCELLED, SUBMITTED_TO_IEMIS→SYMBOL_ASSIGNED, SUBMITTED_TO_IEMIS→CANCELLED
- 4 idempotent no-ops asserted (one per row diagonal: DRAFT→DRAFT, SUBMITTED_TO_IEMIS→SUBMITTED_TO_IEMIS, SYMBOL_ASSIGNED→SYMBOL_ASSIGNED, CANCELLED→CANCELLED) — no error, no state change
- 8 illegal transitions explicitly rejected (every cell marked ❌ in the matrix above)
- Helper returns `{ ok: true } | { ok: false, reason: 'illegal_transition', from, to }` (not throwing — caller decides HTTP status)
- Idempotent same-state returns `{ ok: true, noop: true }`

**AC:**
- Schema + factory + mapper + state-machine + uniqueness-lock entity green
- Ed-Fi alignment: `edforge:StudentExternalAssessmentRegistration` namespace logged in docstring
- GSI13 sparse populated only when `symbolNumber` is set; transition into `SUBMITTED_TO_IEMIS` does NOT populate it (only `SYMBOL_ASSIGNED` does)
- GSI13 documented as read-side ONLY in entity docstring; symbol-number uniqueness enforced by `EXTERNAL_EXAM_SYMBOL_LOCK` entity (D.4 writes lock + registration in single `TransactWriteItems` with `attribute_not_exists(entityKey)` on the lock → 409 `SYMBOL_NUMBER_CONFLICT`)
- Uniqueness-lock entity ships with the registration entity in the same PR; entity spec exercises the lock's `entityKey` builder

**Deps:** 0.3.1 ✅, A.2.1 ✅, E.0.2 ✅, D.2.7 ✅ (`Enrollment.priorEnrollmentId` so GSI2 cross-AY join is sound).

---

### D.3.2 — `InternalAssessment` entity

**Files:** Phase 1 (schema) + Phase 2 (entity + mapper).
- NEW `packages/shared-types/src/schemas/academics/internal-assessment.schema.ts` + `.spec.ts`
- NEW `microservices/academics/src/common/entities/internal-assessment.entity.ts` + `.spec.ts`
- NEW `microservices/academics/src/common/mappers/internal-assessment.mapper.ts` + `.spec.ts`

**Entity shape:**
```typescript
export interface InternalAssessment extends BaseEntity {
  entityType: 'INTERNAL_ASSESSMENT';
  assessmentId: string;
  registrationId: string;                           // FK to ExternalExamRegistration
  studentId: string;
  enrollmentId: string;
  schoolId: string;
  examType: 'BLE' | 'SEE' | 'NEB_11' | 'NEB_12';
  courseId: string;                                 // FK to Course (per A.2.0 rename — replaces older subjectId)
  rubricCategoryId: string;                         // FK to RubricCategory
  score: number;
  maxScore: number;
  enteredBy: string;                                // userId of staff
  enteredAt: string;                                // ISO Gregorian
  status: 'DRAFT' | 'LOCKED_FOR_IEMIS';
  // GSI1: by school — gsi1pk='TENANT#{tid}#SCHOOL#{schoolId}', gsi1sk='INT_ASSESS#{registrationId}#{assessmentId}'
  // GSI2: by enrollment — gsi2pk='TENANT#{tid}#ENROLLMENT#{enrollmentId}', gsi2sk='INT_ASSESS#{examType}#{courseId}'
}
```

**Schema spec coverage:**
- `status` accepts the 2 union values
- `score`: number ≥0; rejects negative
- `score ≤ maxScore` is a Zod `.refine()` cross-field check; spec includes both pass + fail cases
- `enrollmentId` non-empty string (UUID validation deferred to service layer)
- Round-trip green
- **Cross-AY traceability spec:** entity spec includes a test that constructs InternalAssessment rows for the SAME `studentId` across TWO different `enrollmentId`s (Grade 7 → Grade 8 promotion) and asserts:
  - Both rows construct cleanly
  - GSI2 keys differ (each binds to its own `enrollmentId`)
  - Reading by `enrollmentId` returns one cohort's rows only (proving cross-AY isolation works)

**AC:**
- Schema + factory + mapper; archetype-defaulted internal-weight is **NOT** applied at the entity layer — applied at result-aggregation time (D.4.6 / D.5.x / D.6.x); D.3 entity is raw score + maxScore only
- `enrollmentId` is the FK that ties this row to a specific AY (not studentId-only) — invariant 3 (cross-AY identity) honored at storage layer
- `LOCKED_FOR_IEMIS` is one-way at the **state machine helper** (forward only); reverse-via-support-flow IS allowed at the service layer but routes through a dedicated D.4.3 PATCH endpoint with a `supportFlowReason` audit field. **D.3 does NOT enforce the unlock semantics** — only the forward transition. IEMIS-rejection unlock flow is D.4.3 scope.

**Deps:** A.2.1 ✅, D.3.1, D.3.0.

---

### D.3.3 — `ExternalExamAdmitCard` entity

**Files:** Phase 1 + Phase 2.
- NEW `packages/shared-types/src/schemas/academics/external-exam-admit-card.schema.ts` + `.spec.ts`
- NEW `microservices/academics/src/common/entities/external-exam-admit-card.entity.ts` + `.spec.ts`
- NEW `microservices/academics/src/common/mappers/external-exam-admit-card.mapper.ts` + `.spec.ts`

**Entity shape:**
```typescript
export interface ExternalExamAdmitCard extends BaseEntity {
  entityType: 'EXTERNAL_EXAM_ADMIT_CARD';
  admitCardId: string;
  registrationId: string;                           // FK to ExternalExamRegistration (1:1)
  studentId: string;
  schoolId: string;
  externalRollNumber: string;                       // mirrors ExternalExamRegistration.symbolNumber (denormalized for read path)
  examCenterName: string;
  examCenterAddress: string;
  examDates: string[];                              // ISO Gregorian, sorted ascending
  pdfS3Url?: string;                                // populated by C.4.3 renderer post-D.3 (D.4.5 scope)
  issuedAt: string;                                 // ISO Gregorian
  // GSI1: by school — gsi1pk='TENANT#{tid}#SCHOOL#{schoolId}', gsi1sk='ADMIT_CARD#{registrationId}'
}
```

**Schema spec coverage:**
- `examDates: []` invalid (must have ≥1 entry)
- `pdfS3Url` accepts S3 URL or undefined
- Round-trip green

**AC:** Factory + mapper; admit-card per registration is 1:1; D.3 ships shape only — render happens at D.4.5 / D.5.3 / D.6.x.

**Deps:** D.3.1.

---

### D.3.4 — `ExternalExamResult` entity

**Files:** Phase 1 + Phase 2.
- NEW `packages/shared-types/src/schemas/academics/external-exam-result.schema.ts` + `.spec.ts`
- NEW `microservices/academics/src/common/entities/external-exam-result.entity.ts` + `.spec.ts`
- NEW `microservices/academics/src/common/mappers/external-exam-result.mapper.ts` + `.spec.ts`

**Entity shape:**
```typescript
export interface ExternalExamResult extends BaseEntity {
  entityType: 'EXTERNAL_EXAM_RESULT';
  resultId: string;
  registrationId: string;                           // FK to ExternalExamRegistration
  studentId: string;
  enrollmentId: string;
  schoolId: string;
  examType: 'BLE' | 'SEE' | 'NEB_11' | 'NEB_12';
  courseResults: ExternalExamCourseResult[];        // per-course breakdown
  cumulativeGpa?: number;                           // NEB-11/12 only (4.0 scale)
  overallStatus: 'passed' | 'failed' | 'failed_with_supplementary_eligible';
  importedAt: string;                               // ISO Gregorian
  // GSI1: by school — gsi1pk='TENANT#{tid}#SCHOOL#{schoolId}', gsi1sk='EXT_RESULT#{examType}#{resultId}'
  // GSI2: by enrollment — gsi2pk='TENANT#{tid}#ENROLLMENT#{enrollmentId}', gsi2sk='EXT_RESULT#{examType}'
}

export interface ExternalExamCourseResult {
  courseId: string;                                 // FK to Course
  academicSubject: AcademicSubjectDescriptor;       // denormalized from Course at write time
  letterGrade: GradingPolicyLetterGrade;            // includes 'NG' per D.1 + D.4.0 + D.5.0
  gpaPoints: number;                                // 4.0 scale lookup (e.g. A+=4.0, A=3.6, B+=3.2, ..., NG=0)
  internalScore?: number;                           // sum across InternalAssessment rows for this (registration, course)
  externalScore?: number;                           // imported from authority ledger
  isSupplementary: boolean;                         // true if this entry was overwritten by D.4.7 retake import
}
```

**Schema spec coverage:**
- `letterGrade` is `gradeLetterSchema` (free string, `max(5)`) — sourced from existing `packages/shared-types/src/schemas/academics/grade.schema.ts:350`; spec includes `'A+'`, `'NG'`, `''` (invalid), `'too-long-grade'` (invalid). Runtime check that the value is in the school's active `GradingPolicy.letterGrades[].letter` is **service-layer** (D.4.6 / D.5.x / D.6.x) — NOT schema.
- `gpaPoints` `0–5` per `letterGradeEntrySchema.gpaPoints` (existing D.1 range; D.1 supports both 4.0 and 5.0 scales; cap at 5 not 4)
- `cumulativeGpa` optional; same range
- `overallStatus` accepts the 3 union values
- `courseResults` ≥1 entry, ≤15 entries (sanity cap; BLE caps at 9, NEB-XII at 7, so 15 is generous)
- Per-courseResult `isSupplementary` defaults false
- Cross-field refinement: if any `courseResults[i].isSupplementary === true`, the result row MUST be the version after a `D.4.7 / D.5.4 / D.6.5` supplementary-import write (D.4 enforces; D.3 just stores)
- Round-trip green; **mapper round-trip preserves `isSupplementary` per courseResult through serialize → deserialize cycle** (explicit test case)

**AC:**
- Schema + factory + mapper
- `overallStatus` derivation rule lives in D.4.6 / D.5.x / D.6.x service layer; entity just stores the result (per-result-row, NOT computed at read time)
- D.3 mapper round-trip preserves `isSupplementary` per courseResult
- Mapper round-trip is **idempotent**: `toEntity(toDto(e))` deep-equals `e` for all 6 entities (asserted by mapper spec)

**Deps:** D.3.1, A.2.1 ✅.

---

### D.3.5 — `ExternalExamRetake` entity (Grade Increment)

**Files:** Phase 1 + Phase 2.
- NEW `packages/shared-types/src/schemas/academics/external-exam-retake.schema.ts` + `.spec.ts`
- NEW `microservices/academics/src/common/entities/external-exam-retake.entity.ts` + `.spec.ts`
- NEW `microservices/academics/src/common/mappers/external-exam-retake.mapper.ts` + `.spec.ts`

**Entity shape:**
```typescript
export interface ExternalExamRetake extends BaseEntity {
  entityType: 'EXTERNAL_EXAM_RETAKE';
  retakeId: string;
  originalResultId: string;                         // FK to ExternalExamResult
  studentId: string;
  enrollmentId: string;
  schoolId: string;
  examType: 'BLE' | 'SEE' | 'NEB_11' | 'NEB_12';
  courses: string[];                                // courses being retaken (subset of original courseResults[].courseId)
  retakeDate: string;                               // ISO Gregorian
  fee?: number;                                     // optional municipality-set retake fee
  status: 'REGISTERED' | 'SAT' | 'RESULT_IMPORTED' | 'CANCELLED';
  // GSI1: by school — gsi1pk='TENANT#{tid}#SCHOOL#{schoolId}', gsi1sk='EXT_RETAKE#{retakeId}'
  // GSI2: by enrollment — gsi2pk='TENANT#{tid}#ENROLLMENT#{enrollmentId}', gsi2sk='EXT_RETAKE#{examType}'
}
```

**Schema spec coverage:**
- `status` accepts the 4 union values
- `courses: []` invalid (must be ≥1)
- Round-trip green

**AC:**
- Factory + mapper
- BLE eligibility rule (`NG ≤ 3 subjects`) is service-layer (D.4.7); entity allows any number of courses (rule enforced at retake creation, not entity write)
- D.6.5 NEB Grade Increment uses the same entity; archetype-agnostic at the entity layer

**Deps:** D.3.4.

---

### D.3.6 — Module-wiring update + state-machine helper export

**Files:** Phase 2.
- NEW `microservices/academics/src/external-exams/external-exams.module.ts` (empty shell; declares + exports zero providers initially; placeholder for D.4)
- NEW `microservices/academics/src/external-exams/index.ts` (re-export of state-machine helper from D.3.1)
- MODIFIED `microservices/academics/src/academics.module.ts` — `imports: [..., ExternalExamsModule]`
- MODIFIED `microservices/academics/src/__tests__/module-wiring.spec.ts` — add `ExternalExamsModule` to the watchlist (+1 module entry); add assertion `expect(modulesInWatchlist).toContain(ExternalExamsModule)`

**AC:**
- `nest build academics` clean
- module-wiring spec extended with new module entry per the post-A.4 invariant
- Empty module compiles + bootstraps under jest (smoke-style "module loads without provider errors" assertion)
- `__tests__/module-wiring.spec.ts` reaches ≥44 assertions (was 43 post-A.4; +1 for ExternalExamsModule)

**Deps:** 0.3.2 ✅ (academics audit shipped) — actually 0.3 is not yet shipped per status table; we depend on the existing A.4 wiring-spec scaffolding instead, which is the same file. **Override: D.3.6 depends on the existing `__tests__/module-wiring.spec.ts` from PR #163 (A.4 hotfix), not on Sprint 0.3.** Update the master-plan dep field to reflect this.

---

## 4.1 Mapper round-trip contract (apply to all 6 mappers)

Each `*.mapper.ts` MUST export pure functions adhering to this contract:

```typescript
export function toEntity(dto: CreateXxxDto, ctx: WriteContext): XxxEntity;
export function toDto(entity: XxxEntity): XxxResponseDto;
// Optional, deferred V1.5: export function toEdFi(entity: XxxEntity): EdFiResource;
```

**Round-trip invariants asserted by `*.mapper.spec.ts`:**
1. **Idempotency:** `toEntity(toDto(e), ctx)` deep-equals `e` (audit fields excluded since they're write-time-generated)
2. **DTO is JSON-safe:** `JSON.parse(JSON.stringify(toDto(e)))` deep-equals `toDto(e)` (no Date objects, no functions, no Symbols)
3. **Optional preservation:** `toDto` does NOT add `undefined` keys; absent fields stay absent
4. **Sparse GSI preservation:** entities WITH a sparse GSI key (e.g. `gsi13pk` on ExternalExamRegistration) ↔ DTOs preserve the field; entities WITHOUT it (e.g. registration still in `DRAFT` status) ↔ DTOs OMIT the field entirely (not `undefined`, not `null`)
5. **Cross-entity FK preservation:** entity-to-DTO round-trip preserves all FK fields (`studentId`, `enrollmentId`, `schoolId`, `registrationId`, etc.) byte-for-byte
6. **Letter-grade preservation:** for `ExternalExamResult.courseResults[].letterGrade`, the string value passes through unchanged — no normalization, no case-folding, no whitespace trimming (the GradingPolicy.letterGrades[] lookup happens at service layer; mapper is byte-pass-through)
7. **Numeric precision:** for `gpaPoints`, `cumulativeGpa`, `score`, `internalScore`, `externalScore` — IEEE 754 round-trip preserved (no `parseFloat(value.toFixed(2))` reformatting; the entity stores what was written; display-formatting is UI concern)

**Anti-patterns rejected at PR review:**
- `toEntity` reading from the network / DDB / env — mapper must be pure
- `toDto` mutating its input — mapper must not modify the entity
- Mapper computing `overallStatus` or any aggregation — that's service-layer
- Mapper looking up GradingPolicy or any other entity — that's service-layer

---

## 5. Risks & mitigations (sprint-level)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **R-D3.1** — New `ExternalExamsModule` ships without module-wiring spec entry (repeat of A.4 incident) | M | P0 outage (academics crash-loop on bootstrap, full prod down) | D.3.6 ships the wiring-spec entry **in the same PR** as `external-exams.module.ts`; CI blocks merge if missing. Post-deploy CloudWatch check for `ExternalExamsModule dependencies initialized` line. Per memory [[feedback-module-wiring-invariant]] |
| **R-D3.2** — shared-types `^0.59.0` caret-pin trap (docker build resolves from npm registry, not workspace symlinks) | H if missed | Docker build fails with TS2305 / TS2741 | Phase 2 PR bumps `server/application/package.json` + `server/package.json` in lockstep; refresh root lockfile via `npm install`. Per memory [[edforge-shared-types-caret-pin]] |
| **R-D3.3** — GSI13 add triggers CDK template churn we didn't expect | L | Deploy fails or rolls back | Pre-deploy `cdk diff tenant-template-stack-basic --exclusively` review; check for cross-stack-export changes (none expected; GSI add is purely internal to the tenant tables). Per CLAUDE.md "Cross-stack export change pre-flight" |
| **R-D3.4** — `letterGrade` schema validation drift | M | A future change to D.1's `gradeLetterSchema` (e.g. tightening from `max(5)` to an enum) breaks D.3.4 round-trip | D.3.4 schema imports `gradeLetterSchema` from `grade.schema.ts:350` directly (no local copy). If D.1 ever tightens, D.3 picks up automatically. Spec includes `'A+'` + `'NG'` + `''` (invalid) + 6-char string (invalid) explicit cases |
| **R-D3.5** — `examType` enum drift across the 6 new entities | M | Inconsistent validation across entities | Single `examTypeSchema` const in `external-exam-shared.schema.ts` (NEW; one file); all 6 schemas import. Spec asserts every schema rejects raw string `'BLE'` (must be the enum literal, not arbitrary string) |
| **R-D3.6** — `entityKey` builder methods forgotten in `base.entity.ts` extension | L | Service-layer code can't construct keys; runtime errors at D.4 wire-time | base.entity.ts changes are part of Phase 2 PR; entity spec exercises `EntityKeyBuilder.externalExamRegistration(…)` + 5 sibling methods + the lock builder. Catch at PR review |
| **R-D3.7** — State-machine validator helper buggy under concurrent transitions | L | D.4.x writes race + corrupt status field | State-machine spec includes 4×4 = 16-case matrix (per §4 D.3.1). Concurrency is enforced at write-time via `attribute_exists(status) AND status = :expected` condition expression (D.4 scope; D.3 ships the validator helper that constructs the expression) |
| **R-D3.8** — Mapper round-trip drops `isSupplementary` on `ExternalExamCourseResult[]` | L | Supplementary results "stick" but then disappear on next read | Mapper round-trip contract in §4.1; mapper spec exercises `isSupplementary=true` on 1 of 3 courseResults; asserts deserialize preserves all fields |
| **R-D3.9** — D.3 entities ship without specs for the **`NG`** letter-grade case | M | D.4.6 result-import code branches on `NG` paths that aren't covered by tests | Phase 1 spec for D.3.4 includes an `NG` case AND a mixed pass/fail/`NG` case |
| **R-D3.10** (NEW v2) — Uniqueness-lock entity ships without spec for soft-cancel-then-re-register flow | L | Operator cancels registration and tries to re-register; gets 409 because lock isn't released | Lock entity spec asserts that on `CANCELLED` transition, D.4 service-layer DELETEs the lock row in the same `TransactWriteItems` as the registration update. D.3 spec for the lock entity documents this contract; D.4 implementer's checklist references it |
| **R-D3.11** (NEW v2 — Ed-Fi alignment drift) | L | Future Ed-Fi V7+ adds a canonical entity that overlaps with one of ours; we ship a parallel concept | Docstring on each entity logs the namespace mapping. When Ed-Fi V7+ ships, an explicit migration ticket re-evaluates the mapping. V1 scope: accept the alignment table as-is |

---

## 6. Invariant gate (per `v1-master-epic-breakdown.md` §1.4)

Run BEFORE merge of Phase 2 PR.

- [ ] Files changed match listed Files (no scope creep)
- [ ] Validation passes — every entity has factory + spec; every mapper has round-trip spec; state-machine has happy + illegal cases
- [ ] AC reviewer-checkable (no "tested locally")
- [ ] All architecture invariants (v1 plan §4) preserved — invariant 12 grep clean for `tenant.archetype` reads under `external-exams/`
- [ ] Audit + event paired — N/A for D.3 (no writes happen this sprint); D.4 wires this in
- [ ] Three-way route registration — N/A for D.3 (no new endpoints)
- [ ] If shared-types changed: minor bump (`0.59.0`) + npm publish + AdminWeb jsdom sim
- [ ] If new NestJS module: module-wiring spec updated SAME PR — D.3.6
- [ ] If new GSI: `gsi-inventory.md` updated BEFORE CDK deploy — GSI13 claim

---

## 7. Deploy ladder (per CLAUDE.md + memory `feedback_pr_first_no_more_uat`)

### Phase 1 — shared-types publish

```bash
# After Phase 1 PR merges
cd packages/shared-types && npm version 0.59.0 && npm publish
npm view @aibrains/shared-types version            # expect 0.59.0
cd ../.. && npm install                            # refresh lockfile
git add package-lock.json && git commit -m "chore: bump shared-types lockfile post-0.59.0"
# Push to main (no CDK / no ECS deploy on Phase 1)
```

**No AdminWeb redeploy needed** — D.3 exports are not consumed by AdminWeb in this sprint. (D.4 might.)

### Phase 2 — academics ECS roll + CDK GSI13 add

```bash
# 1. cdk diff first (logged)
cd server && AWS_PROFILE=prod CDK_NAG_ENABLED=false npx cdk diff tenant-template-stack-basic 2>&1 | \
  tee ${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/prod-cdk-diff-tenant-template-stack-basic-$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD).log

# 2. Expected diff: GSI13 add on identity + academics + finance tables (sparse; no replacement; no exports affected)
# 3. Cross-stack export pre-flight: no shared-infra-stack exports change

# 4. Deploy
source server/.env.prod && AWS_PROFILE=prod ./scripts/deploy.sh tenant-template-stack-basic prod --exclusively
# Wait for GSI13 ACTIVE on all 3 tables (sparse → no backfill, ACTIVE in seconds)

# 5. Build + push academics image
cd /Users/shoaibrain/edforge/scripts && AWS_PROFILE=prod ./build-application.sh academics 2>&1 | \
  tee "${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/prod-build-application-academics-$(date +%Y%m%d-%H%M%S)-$(cd .. && git rev-parse --short HEAD).log"

# 6. Force ECS rolling deploy
AWS_PROFILE=prod aws ecs update-service --cluster prod-basic --service academicsbasic \
  --force-new-deployment --region ap-south-1 2>&1 | tee "${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/prod-ecs-roll-academicsbasic-$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD).log"

# 7. Wait for service-stable + verify new task is running new image
AWS_PROFILE=prod aws ecs wait services-stable --cluster prod-basic --services academicsbasic --region ap-south-1

# 8. CloudWatch sanity check — Nest bootstrap clean + ExternalExamsModule initialized
AWS_PROFILE=prod aws logs tail tenant-template-stack-basic-academicsTaskDefacademicscontainerLogGroup7AACD3D6-cihubcl839p8 \
  --region ap-south-1 --since 5m | grep -E "(NestApplication|ExternalExamsModule|ERROR)" | head -20
```

**No shared-infra-stack deploy** — D.3 introduces no API GW routes.

**No live smoke required** — entities don't have endpoints yet. D.4 controllers will smoke at D.4.9. Phase 2 acceptance = clean Nest bootstrap + module-init log line + module-wiring spec green.

---

## 8. Open decisions (need sign-off before branch cut)

1. **GSI13 vs reuse?** Master plan says "GSI by symbolNumber for ledger-import reverse-lookup." `gsi-inventory.md` reserves GSI11 + GSI12 for other patterns and says "use GSI13+ for new patterns." **Decision proposed: claim GSI13 sparse.** (Alternative: scan-with-filter on existing GSI1 — rejected because the read happens during D.4.6 result-import which scans 100s of rows per file; sparse GSI is the right pattern.)
2. **`isSupplementary` placement — per-courseResult vs per-resultRow?** Master plan says per-courseResult (D.3.4 entity shape). This allows a student to supplement 1 of 3 subjects and pass the other 2 outright. **Decision proposed: per-courseResult (master-plan default).** No alternative considered.
3. **`overallStatus` enum vs computed?** Three values: `'passed' | 'failed' | 'failed_with_supplementary_eligible'`. The third is derived from `NG count ≤ 3` for BLE (per D.4.0). **Decision proposed: store as enum (denormalized at write time); D.4.6 computes + writes.** Avoids re-deriving on every read.
4. **`cumulativeGpa` field placement?** NEB-11/12 only. **Decision proposed: nullable on `ExternalExamResult` (NEB writes it; BLE/SEE leave undefined).** Alternative: separate `NebExamResult` entity — rejected (overdesign; archetype-bound).
5. **State-machine helper module location?** `microservices/academics/src/external-exams/external-exam-registration.state-machine.ts` ← this places it inside the new module dir. **Decision proposed: keep there; D.4 controllers import from same module.** Alternative: under `common/utils/` — rejected (state machine is exam-registration-specific, not cross-cutting like `enrollment-state-machine.ts` which is touched by 4 services).
6. **D.3.5 retake status enum scope?** `'REGISTERED' | 'SAT' | 'RESULT_IMPORTED' | 'CANCELLED'`. Master plan says fewer states (`status` without enumerating). **Decision proposed: 4 states above; covers the lifecycle from register → sit-the-exam → import-result.** Sign-off requested.
7. **`examYear` BS range validation?** **Decision proposed: align with the shared `bikram-sambat.ts` converter's supported range `[2000, 2090]`** (per `packages/shared-types/src/utils/bikram-sambat.ts:8`). Rationale: don't fork BS-year bounds across modules; the converter's range is authoritative and already vetted (covers ~60 years from BS 2000 = AD 1944 through BS 2090 = AD 2033). PABSON pilot is BS 2083; range is generous on both ends. If the converter's data table extends in a future update, examYear automatically inherits. Counter-proposal (rejected): tighter range like [2080, 2100] would diverge from the shared converter and forbid historical-cohort backfill on Day-N if it ever happens.
8. **(NEW v2) — Uniqueness lock for `(schoolId, studentId, examType, examYear)`?** Master plan §D.3.1 does not enumerate this concern. Staff-architect review (this doc v2) recommends mirroring the `PROMOTION_RULE_LOCK` pattern from D.2.1. **Decision proposed: claim `EXTERNAL_EXAM_REGISTRATION_LOCK` entity type + key builder in D.3.1 scope; D.4 uses it in writes.** Alternative: defer to D.4 — rejected (the entity-type token + key builder are foundation concerns; D.4 should consume, not invent).
9. **(NEW v2) — Skip `ExternalExamSession` / `Assessment` parent entity?** Considered: would be the Ed-Fi `Assessment` analogue holding exam-window dates + subject lists. **Decision proposed: skip.** Reason: exam-window dates + authority info live on `SchoolConfiguration.municipalityConfig` (E.0.2, shipped) + `archetypeDefaults.boardExams[examType]` (0.4, shipped). Each registration is a self-contained event against those config rows. Authority-side state (CEHRD/NEB-issued symbol numbers, exam centers) is OUT of EdForge's control; modeling it internally creates fiction. Counterargument: storage duplication of `examYear` + `examAuthority` + `municipalityId` across student registrations is ~100 bytes × 30 students per cohort = ~3KB/year. Trivial.
10. **(NEW v2) — Schema-level vs service-level letterGrade enum enforcement?** D.1 currently uses `gradeLetterSchema = z.string().min(1).max(5)` (free string, NOT enum). My v1 plan proposed sourcing from a non-existent `GRADING_POLICY_LETTER_GRADES` enum. **Decision proposed: stay consistent with D.1 — `letterGrade` is free string at Zod schema; runtime validation against `GradingPolicy.letterGrades[].letter` is service-layer (D.4).** Rationale: different archetypes ship different letter vocabularies; a hardcoded enum would be archetype-blind in name only.
11. **(NEW v2) — `RubricCategory.academicSubject?=undefined` semantics?** **Decision proposed: `undefined` means "applies to all subjects"** (e.g. 'participation' or 'conduct' rubrics). D.4 onwards documents this in seed comments + service-layer aggregation logic.
12. **(NEW v2) — `courseResults[]` max length?** **Decision proposed: `max(15)`.** BLE caps at 9, NEB-XII at 7. 15 is generous through V1.5.

---

## 9. Definition of Done (Sprint D.3)

- [ ] All 6 entities have entity files + specs + factory tests
- [ ] All 6 entities have mappers + round-trip specs
- [ ] `ExternalExamRegistration` state-machine helper + 16-case spec (canonical: 4 legal + 4 idempotent + 8 illegal)
- [ ] `EntityType` union + `EntityKeyBuilder` extended with 8 new tokens + 8 new key methods (6 entities + 2 locks)
- [ ] `external-exams.module.ts` registered in `academics.module.ts`
- [ ] `__tests__/module-wiring.spec.ts` carries `ExternalExamsModule` watchlist entry
- [ ] `gsi-inventory.md` claims GSI13 sparse; next-free-slot bumped to GSI14
- [ ] `ecs-dynamodb.ts` adds GSI13 sparse declaration
- [ ] shared-types `0.59.0` published; `server/application/package.json` + `server/package.json` both bumped
- [ ] AdminWeb jsdom sim passes post-publish (R39 trap mitigation)
- [ ] `cdk diff tenant-template-stack-basic` shows GSI13-only delta
- [ ] CDK deploy succeeds; GSI13 ACTIVE on identity + academics + finance tables
- [ ] academics ECR image rolled; service-stable; Nest bootstrap clean
- [ ] CloudWatch confirms `ExternalExamsModule dependencies initialized`
- [ ] Master-plan §0.4 rolling status table updated to mark D.3 🟢
- [ ] Sprint close-out memory written (`project_sprint_d3_shipped_prod.md`)

---

## 10. What this plan deliberately does NOT include

- **No controllers.** Master plan explicitly scopes D.3 as foundation; controllers land in D.4 (BLE) / D.5 (SEE) / D.6 (NEB-11/12).
- **No seed rows.** Per-archetype + per-examType RubricCategory seeds (e.g. PABSON-BLE 4 categories: unitTests + projectWork + participation + subjectActivities) land in D.4.2 / D.5.x / D.6.x via the **lazy-seed pattern** (mirror D.1.3 + D.2.3), NOT tenant-seeder Lambda.
- **No event emissions.** No writes happen in D.3; event taxonomy `exam.ble_*` / `exam.see_*` / `exam.neb_*` arrives with D.4 onwards.
- **No EventBridge / Lambda.** Result-import is operator-driven via D.4.6 / D.5.x / D.6.x synchronous endpoints, not async pipelines like A.4.
- **No frontend.** AdminWeb + edforge-saas-frontend UI work is a post-D.4 follow-up.
- **No backfill.** Sparse GSI13 has nothing to backfill on existing rows (symbolNumber never existed before).
- **No live smoke.** D.4.9 BLE smoke exercises all D.3 entities end-to-end; D.5.x and D.6.x add their own.
- **No `ExternalExamSession` / `Assessment` parent entity.** §8 decision #9 — exam-window dates live on `SchoolConfiguration.municipalityConfig`; archetype defaults via `archetypeDefaults.boardExams[]`.
- **No `RubricCategory.cdcReference` URL validation.** Free-text for V1; tighten to URL Zod validator in V1.5 if useful.
- **No FK existence validation at the schema layer.** Service-layer concern (D.4); §1.6 layer split is explicit.
- **No IEMIS-rejection unlock flow.** State-machine helper enforces forward-only `DRAFT → LOCKED_FOR_IEMIS`; D.4.3 PATCH endpoint owns the reverse with `supportFlowReason` audit field.
- **No automated post-deploy wiring-check.** Manual CloudWatch grep is acceptable for D.3 (empty module shell, zero providers). Automated wiring-check is a B0.1 follow-up.
- **No Ed-Fi V7+ alignment migration tickets.** Per R-D3.11: docstring namespace mapping is the entry point; explicit migration is V1.5+.

---

## 11. Rollback plan (per CLAUDE.md "Executing actions with care")

### Phase 1 rollback (shared-types only)

If `0.59.0` ships broken (Zod schema bug discovered post-publish):

```bash
# 1. Publish 0.59.1 with fix from a hotfix branch (preferred — npm doesn't allow unpublish after 24h)
cd packages/shared-types && npm version 0.59.1 && npm publish

# 2. If catastrophic and within 24h: npm unpublish
npm unpublish @aibrains/shared-types@0.59.0

# 3. Revert the version-pin commit on main (Phase 2 PR not yet merged, so academics still on 0.58.x)
```

**Blast radius:** Zero — Phase 1 ships shared-types only; no ECS roll. AdminWeb does not consume D.3 exports in this sprint.

### Phase 2 rollback — CDK GSI13 add

```bash
# 1. Find prior-good academics ECR image digest (post-D.2 ship)
AWS_PROFILE=prod aws ecr describe-images --repository-name academics --region ap-south-1 \
  --query 'sort_by(imageDetails,& imagePushedAt)[*].{tags:imageTags,pushed:imagePushedAt}' --output table

# Expected prior-good: sha256:9ebae71a0f91... (D.2 ship 2026-05-24)

# 2. Re-tag prior digest as :latest + force ECS roll
aws ecr batch-get-image --repository-name academics --image-ids imageTag=<prior-tag> \
  --region ap-south-1 --query 'images[].imageManifest' --output text > /tmp/manifest.json
AWS_PROFILE=prod aws ecr put-image --repository-name academics --image-tag latest \
  --image-manifest "$(cat /tmp/manifest.json)" --region ap-south-1
AWS_PROFILE=prod aws ecs update-service --cluster prod-basic --service academicsbasic \
  --force-new-deployment --region ap-south-1

# 3. The GSI13 add does NOT need rollback — sparse + no rows reference it.
#    Reverting the CDK template will eventually remove it on the next clean deploy,
#    but leaving it in place is harmless (extra storage cost: zero for sparse).
```

**Blast radius:** Academics service rolls back to D.2 ship. PromotionRules / Enrollment / ResultCards continue to function. The GSI13 sparse index remains in DDB but has zero rows; no consumer reads it without the new academics image.

### Phase 2 rollback — shared-types pin bump

If `^0.59.0` causes Docker build failures (academics image fails to build):

```bash
# 1. Revert the Phase 2 PR commit on main
git revert <phase-2-merge-sha>

# 2. Push; CI rebuilds; Docker resolves ^0.58.0; image builds cleanly
# 3. shared-types 0.59.0 remains on npm registry (harmless; future Phase 2 retry consumes it)
```

**Detection:** Docker build in CI fails with `TS2305: Module '"@aibrains/shared-types"' has no exported member 'rubricCategorySchema'` (or similar). The CI gate catches this before merge.

---

## 12. Phase 2 PR review checklist (for the reviewer)

Reviewer of `sprint/d3-phase2-academics-entities` PR walks this list explicitly:

- [ ] All 6 entity files exist + each has a `.spec.ts` companion with ≥10 assertions
- [ ] `external-exam-registration.entity.spec.ts` includes the 16-cell state-machine matrix test
- [ ] `external-exam-registration-lock.entity.ts` exists with `entityKey: 'EXT_EXAM_REG_LOCK#…'` builder
- [ ] All 6 mappers exist + each has a `.spec.ts` with the §4.1 round-trip-contract test suite (7 invariants)
- [ ] `base.entity.ts` `EntityType` union extended with 8 tokens (6 entities + 2 locks)
- [ ] `EntityKeyBuilder` extended with 7 functions; spec exercises each
- [ ] `external-exams.module.ts` exists + registered in `academics.module.ts.imports[]`
- [ ] `__tests__/module-wiring.spec.ts` lists `ExternalExamsModule` in watchlist; assertion count ≥44
- [ ] `ecs-dynamodb.ts` GSI13 declaration mirrors GSI9 / GSI10 sparse pattern (commented + sparse population semantics + sample queries)
- [ ] `gsi-inventory.md` "Claimed in this sprint" section updated with GSI13 entry; "next free slot" bumped to GSI14
- [ ] `server/application/package.json` AND `server/package.json` both bumped to `@aibrains/shared-types: ^0.59.0`
- [ ] `package-lock.json` refreshed at repo root and committed
- [ ] No new tenant-api-prod.json entries (D.3 ships no routes)
- [ ] No new lines in `nginx.template` (D.3 ships no routes)
- [ ] Invariant-12 grep clean: `grep -rE "tenant\.archetype|context\.archetype" server/application/microservices/academics/src/external-exams/` returns nothing
- [ ] No service code under `external-exams/` (D.3 is foundation; service classes are D.4+)
- [ ] Docstrings on each entity log the Ed-Fi V6 alignment namespace per §1.5 table
- [ ] Letter-grade fields use existing `gradeLetterSchema` from `grade.schema.ts:350` (no local enum copy)
- [ ] `examType` sourced from single `external-exam-shared.schema.ts` const (no copy across 6 schemas)
- [ ] `cdk diff tenant-template-stack-basic` log attached to PR description, expected delta: GSI13 add only
- [ ] No cross-stack export changes (run the §7 pre-flight script + paste output)

---

## Sign-off requested

- [ ] D.3 sprint plan **v2** approved → cut `sprint/d3-phase1-shared-types-schemas` branch
- [ ] Open decisions #1–#12 (incl. NEW v2 #8–#12) settled (or accepted as-proposed)
- [ ] GSI13 claim is the right move (vs scan-with-filter — see §8 #1)
- [ ] Uniqueness-lock pattern mirroring `PROMOTION_RULE_LOCK` (NEW v2 §8 #8) is the right call
- [ ] Skipping `ExternalExamSession` parent entity (NEW v2 §8 #9) is the right architectural choice — confirmed Ed-Fi V6 alignment table maps registration directly to `StudentAssessmentRegistration`
- [ ] R-D3.1 / R-D3.2 / R-D3.3 (+ NEW v2 R-D3.10 / R-D3.11) mitigations are sufficient
- [ ] §11 Rollback plan is realistic (Phase 1 + Phase 2 distinct rollback paths)
- [ ] §12 PR-review checklist is comprehensive enough that a non-author reviewer can independently verify the work
