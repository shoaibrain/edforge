# GB2 — Lifecycle seeding: trace-audit + design (GB2.1)

> Status: design locked 2026-06-04. Deliverable of ticket **GB2.1** (trace-audit).
> Implements the GB2 goal: the archetype tables already *define* board exams +
> curriculum ref + exam patterns; nothing *applies* them when a PABSON school is
> set up. This wires archetype-driven seeding at the right seam, idempotently,
> reusing the existing seed pattern.

## Which hook owns seeding — the seam decision

**Seed-on-empty at the read path, mirroring `PromotionRulesService.ensureDefaultRule` (D.2.3, itself mirroring D.1.3's grading-policy seed).** NOT a school-create hook.

Rationale (grep-confirmable):
- `PromotionRulesService.ensureDefaultRule`
  ([promotion-rules.service.ts:576](../../server/application/microservices/academics/src/promotion-rules/promotion-rules.service.ts#L576))
  is the established pattern: a list/GET that returns empty for a school triggers
  a lazy seed from the archetype table, writes under a lock with
  `attribute_not_exists(entityKey)` (TransactWrite), and on
  `TransactionCanceledException` re-reads the concurrent winner's row.
- Read-path seeding is **self-healing for already-provisioned schools** — the two
  active PABSON tenants (Saraswati, dev-pabson-primary) get board exams on first
  list, with no migration. A school-create hook would miss them and need a
  backfill for the common case; GB2.9's backfill then only covers schools that
  never hit the list endpoint.
- Archetype is resolved exactly as D.2.3 does: `TenantMetadataReaderService`
  reads the tenant METADATA row's `archetype`, then `getGovernanceProfile(archetype)`
  / `getArchetypeDefaults(archetype)`; unknown/missing → GENERIC fallback (fail-soft).

## What gets seeded

`getGovernanceProfile(archetype).boardExams` — for PABSON: BLE@8 (municipality,
50/50, supp), SEE@10 (NEB, 25/75, supp), NEB_11, NEB_12 (NEB, 25/75; NEB_12 supp).
GENERIC → `[]` (nothing seeded; seed-on-empty is a no-op).

## Storage model — new `BoardExam` definition entity, main-table keyed

Board exams are **definitions** (which national/municipal exams a school has), not
student results — the latter are the separate `external-exam-*` entity family
(registration/result/admit-card/retake). No existing entity holds the per-school
definitions, so GB2.2 adds a `BoardExam` entity.

- Key: `EntityKeyBuilder.boardExam(schoolId, examType)` →
  `SCHOOL#<schoolId>#BOARDEXAM#<examType>` on the **main table** (PK = tenantId).
- List by school: `Query` PK = tenantId + `begins_with(entityKey, 'SCHOOL#<id>#BOARDEXAM#')`
  — same convention as promotion rules / academic years. **No new GSI** ⇒ **no
  infra deploy**; GB2 ships as an academics ECR + ECS rolling update only
  (confirm via empty `cdk diff tenant-template-stack-basic`).
- `examType` is the natural per-school unique key (one BLE, one SEE per school),
  so `attribute_not_exists(entityKey)` is the idempotency guard. Concurrency: on
  `ConditionalCheckFailedException` for a row, treat as already-seeded and
  re-query (mirrors D.2.3 race recovery).

## Ticket build order + deploy footprint

| Ticket | What | Deploy |
|---|---|---|
| GB2.1 | This design note (seam + storage decision) | none |
| GB2.2 | `BoardExam` entity + `EntityKeyBuilder.boardExam` + `getOrSeedBoardExams` (idempotent, concurrency-safe) + unit test | none (code) |
| GB2.3 | `GET /schools/:schoolId/board-exams` → seed-on-empty then re-query; three-way route registration (controller + tenant-api-prod.json + nginx `/schools` prefix already covers it) | academics ECR/ECS |
| GB2.4 | Default `primaryCurriculumRef` from profile at course-create when DTO omits (PABSON→`CDC_NCF_2076`, GENERIC→`CCSS`); operator override wins | academics ECR/ECS |
| GB2.5 | `GET` endpoint surfacing `GovernanceProfile.examPattern` for the setup checklist; three-way registration | academics ECR/ECS |
| GB2.6 | CloudWatch alarm on re-seed signal (>1 seed/school/day) in `tenant-template-stack-basic` | `tenant-template-stack-basic` (only if alarm added) |
| GB2.7 | shared-types publish + pin bump **only if** a GovernanceProfile slot type changed (it does not for 2.2–2.5) | publish (likely skipped) |
| GB2.8 | Deploy academics; deploy `tenant-template-stack-basic` only if GB2.6 added the alarm | ECR/ECS (+ infra if 2.6) |
| GB2.9 | Backfill for already-provisioned schools that never hit the list endpoint (dry-run first) | script |

**Edge cases folded in (from the orchestration §3 hardening table):**
- GB2.2: seed only board exams whose `grade` ∈ the school's `enabledGradeLevels`
  (don't seed SEE for a grade-5-max school). Concurrency proven by unit test.
- GB2.2: seed-on-empty checks `count === 0` only — a partial set (operator
  deleted one) is operator-owned, **never re-seeded** (no top-up).
- GB2.4: curriculum default must apply on **both** UI course-create and bulk-import.
